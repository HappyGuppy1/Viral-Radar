// Viral videolar motoru (motor.py): küçük kanallarda, kanalın kendi normalini aşan videoları bulur.
// Akış:
//   1) arama   : konu başına YouTube araması (tarih / süre / sıralama filtreli)
//   2) taban   : her kanalın son N videosunun izlenme MEDYANI (aday video hariç)
//   3) skor    : outlier = izlenme / taban · VSR = izlenme / abone · VPH = izlenme / saat
//   4) detay   : finalistler için tarih, beğeni, yorum, açıklama, kanca (ilk 60 sn altyazı)
//   5) bayrak  : sahte trafik / ölü abone / yapay zekâ / az veri gibi şüpheli durumlar
//   6) desen   : outlier başlıklarının ortak özellikleri ve tekrar eden kalıplar
import fs from 'node:fs';
import { Onbellek } from './onbellek.js';
import * as yt from './youtube.js';
import { sorguCevirileri } from './ceviri.js';
import { aiUret, HesapYok } from './hesaplar.js';
import * as videoAnaliz from './video_analiz.js';
import {
  ARAMA_DILLERI, DURAKLAR, SURE_DILIMLERI, havuz, kelimeler, konuKokleri, kucuk, medyan, Sayac, simdiSn, ure, yuvarla, zamanDamgasi,
} from './metin.js';

export class Iptal extends Error {}

const SHORTS_SN = 180;
export const VARSAYILAN = {
  sorgular: [], siralar: ['izlenme', 'alaka'], tarih: 'ay', yt_sure: 'oto', format: 'uzun', min_sure_dk: 0, max_sure_dk: 0,
  ulke: '', sorgu_basina: 80, min_izlenme: 10000, min_abone: 0, max_abone: 100000, min_skor: 3.0, taban_video: 30, detay_adet: 40,
  max_yas_gun: 0, kanca: false, muzik_haric: true, konu_eslesme: true, haric: '', dil: '', arama_dili: 'en',
  yalniz_arama_dili: false, genislet: true, genislet_adet: 6, ai_ilgi: true,
};
const YT_SURE = new Set(['hepsi', 'kisa', 'uzun', 'orta']);
const EN_ESKI_GUN = 5 * 365;
const DETAY_SINIRI = 200;
const ULKE_ESDEGER = { 'Türkiye': ['Türkiye', 'Turkey'], 'United States': ['United States', 'USA'], 'United Kingdom': ['United Kingdom', 'UK'], 'South Korea': ['South Korea', 'Korea'] };
const CANLI_BASLIK = ure(String.raw`🔴|\b24/7\b|\blive ?stream|\bcanlı yayın`, 'i');
const YZ_KALIPLARI = ure(String.raw`\b(ai[- ]generated|ai voice|ai narrat\w*|elevenlabs|text[- ]to[- ]speech|tts|midjourney|made with ai|faceless|yapay zeka ile|ai art|ai animation|sora|veo ?\d?|kling|(full )?ai (film|movie|cinema|story|stories|animation|video)s?|\w+ ai films?)\b`, 'i');

export const KANALLAR = new Onbellek('kanallar', 24);
export const DETAYLAR = new Onbellek('videolar', 12);

const shortsMu = v => (v.url || '').includes('/shorts/') || (v.sure !== null && v.sure !== undefined && v.sure <= SHORTS_SN);

function ytSureSec(minSn, maxSn) {
  if (maxSn && maxSn <= 240) return 'kisa';
  if (minSn >= 1200) return 'uzun';
  if (minSn >= 240 && maxSn && maxSn <= 1200) return 'orta';
  return 'hepsi';
}

// ---------------------------------------------------------------- 2) kanal tabanı
export async function kanalProfili(kanalId, sekme = 'videos', n = 30) {
  const anahtar = `${kanalId}:${sekme}:${n}`;
  const v = KANALLAR.al(anahtar);
  if (v) return v;
  let profil;
  try {
    const k = await yt.kanalSekmesi(kanalId, sekme, n);
    profil = { ad: k.ad, abone: k.abone, videolar: k.videolar.map(x => ({ id: x.id, izlenme: x.izlenme })) };
  } catch (h) {
    profil = { ad: '', abone: null, videolar: [], hata: String(h.message).slice(0, 200) };
  }
  KANALLAR.koy(anahtar, profil);
  return profil;
}

/** Kanalın "Hakkında" sayfasındaki ülke (İngilizce ad). Belirtilmemişse "", erişilemezse null. */
export async function kanalUlkesi(kanalId) {
  const anahtar = `${kanalId}:ulke`;
  const v = KANALLAR.al(anahtar);
  if (v) return v.ulke;
  try {
    const h = await yt.kanalHakkinda(kanalId);
    KANALLAR.koy(anahtar, { ulke: h.ulke || '' });
    return h.ulke || '';
  } catch { return null; } // önbelleğe yazma: sonra tekrar denensin
}

function taban(profil, haricId) {
  const izl = profil.videolar.filter(v => v.id !== haricId && v.izlenme !== null && v.izlenme !== undefined).map(v => v.izlenme);
  return [izl.length ? medyan(izl) : null, izl.length];
}

// ---------------------------------------------------------------- 4) detay + kanca
export async function detay(videoId, kanca = true, dil = '') {
  const anahtar = `${videoId}:${kanca ? 1 : 0}:${dil}`;
  const v = DETAYLAR.al(anahtar);
  if (v && 'canli' in v) return v;
  let d;
  try {
    const b = await yt.videoBilgisi(videoId);
    d = { baslik: b.baslik, zaman: b.zaman, begeni: b.begeni, yorum: b.yorum, izlenme: b.izlenme, sure: b.sure,
      dil: null, kategori: b.kategori, canli: b.canli, etiketler: b.etiketler, aciklama: b.aciklama, kanca: '' };
    if (kanca) {
      try { d.kanca = (await yt.altyaziSatirlari(b.info, dil, 60)).map(s => s[1]).join(' '); }
      catch (h) {
        if (h instanceof yt.AltyaziSiniri) { d.kanca_hata = 'YouTube altyazıyı geçici olarak sınırladı'; return d; } // önbelleğe yazma
      }
    }
  } catch (h) {
    d = { hata: String(h.message).slice(0, 200) };
  }
  DETAYLAR.koy(anahtar, d);
  return d;
}

export async function transkript(videoId, dil = '') {
  const b = await yt.videoBilgisi(videoId);
  return { baslik: b.baslik, dil, satirlar: await yt.altyaziSatirlari(b.info, dil) };
}

// ---------------------------------------------------------------- 5) bayraklar
export function bayraklar(v) {
  const b = [];
  const izl = v.izlenme || 0, abone = v.abone, tb = v.taban;
  if ((v.begeni === null || v.begeni === undefined) && v.detay_var) b.push(['begeni_gizli', 'Beğeni sayısı gizli']);
  else if (v.begeni !== null && v.begeni !== undefined && izl && v.begeni / izl * 1000 < 1.5) b.push(['dusuk_begeni', "1.000 izlenmede 1,5'ten az beğeni: reklamla/satın alınmış trafik olabilir"]);
  if (v.detay_var && !v.yorum) b.push(['yorum_kapali', 'Yorum yok veya kapalı']);
  if (abone && tb !== null && tb !== undefined && tb < abone * 0.01) b.push(['olu_abone', "Kanalın tipik videosu abonesinin %1'inden az izleniyor: abone sayısı güvenilmez"]);
  if (abone && izl / abone > 200) b.push(['asiri_vsr', 'İzlenme aboneyi 200 kattan fazla aşıyor: dağıtım taşması veya şişirme olabilir']);
  if ((v.taban_n || 0) < 4) b.push(['az_video', "Kanalda taban için 4'ten az video var: skor güvenilmez"]);
  if (YZ_KALIPLARI.test(`${v.baslik || ''} ${v.kanal || ''} ${v.aciklama || ''} ${(v.etiketler || []).join(' ')}`)) b.push(['yapay_zeka', 'Başlık/kanal/açıklamada yapay zeka veya faceless üretim izi']);
  if (v.canli) b.push(['canli', 'Canlı yayın kaydı: izlenme yayın boyunca birikmiş olabilir']);
  if (v.kategori === 'Music') b.push(['muzik', 'Müzik kategorisinde: konu değil şarkı/ses izleniyor olabilir']);
  return b.map(([kod, aciklama]) => ({ kod, aciklama }));
}

// ---------------------------------------------------------------- 6) desenler
const OZELLIKLER = [
  ['Rakam içeriyor', t => /\d/.test(t)],
  ['Yıl (20xx)', t => ure(String.raw`\b20\d\d\b`).test(t)],
  ['Soru işareti', t => t.includes('?')],
  ['Ünlem', t => t.includes('!')],
  ['Dikey çizgi |', t => t.includes('|')],
  ['İki nokta :', t => t.includes(':')],
  ['Parantez / köşeli', t => /[([]/.test(t)],
  ['BÜYÜK HARF kelime', t => ure(String.raw`\b[A-ZÇĞİÖŞÜ]{3,}\b`).test(t)],
  ['Emoji', t => /[\u{1F300}-\u{1FAFF}☀-➿]/u.test(t)],
  ['Sen/you hitabı', t => ure(String.raw`\b(you|your|sen|senin|siz|sizin)\b`, 'i').test(t)],
  ['Ben/I anlatımı', t => ure(String.raw`\b(i|my|i'm|ben|benim)\b`, 'i').test(t)],
  ['Kapsam/üstünlük (every, all, best, tüm…)', t => ure(String.raw`\b(every|all|best|worst|most|biggest|ultimate|complete|entire|full|tüm|bütün|her|en)\b`, 'i').test(t)],
  ['Süre vaadi (in N minutes…)', t => ure(String.raw`\b(in|under)\s+\d+\s*(min|minutes|seconds|hours|dakika|saniye|saat)`, 'i').test(t)],
];

function konuylaIlgili(v, kokler) {
  const metin = [v.baslik || '', v.baslik_gorunen || '', (v.etiketler || []).join(' '), v.aciklama || ''].join(' ');
  return kelimeler(metin).some(k => kokler.some(kok => k.startsWith(kok)));
}

export function desenler(outlierlar, tumAdaylar, sorgular = []) {
  const sorguKelimeleri = new Set(sorgular.flatMap(s => kelimeler(s)));
  const pay = (liste, f) => (liste.length ? yuvarla(100 * liste.filter(v => f(v.baslik)).length / liste.length, 1) : 0);
  const ozellik = OZELLIKLER.map(([ad, f]) => ({ ad, outlier: pay(outlierlar, f), tum: pay(tumAdaylar, f) }));
  for (const o of ozellik) o.fark = yuvarla(o.outlier - o.tum, 1);
  ozellik.sort((a, b) => b.fark - a.fark);

  const dilim = liste => {
    const s = new Sayac();
    for (const v of liste) for (const [ad, a, b] of SURE_DILIMLERI) if (v.sure !== null && v.sure !== undefined && a <= v.sure && v.sure < b) s.ekle(ad);
    const n = [...s.values()].reduce((a, b) => a + b, 0) || 1;
    return Object.fromEntries(SURE_DILIMLERI.map(([ad]) => [ad, yuvarla(100 * (s.get(ad) || 0) / n, 1)]));
  };

  const say = new Sayac(), kanallar = new Map();
  for (const v of outlierlar) {
    const k = kelimeler(v.baslik), goruldu = new Set();
    for (const n of [2, 3, 4]) {
      for (let i = 0; i + n <= k.length; i++) {
        const g = k.slice(i, i + n);
        if (DURAKLAR.has(g[0]) || DURAKLAR.has(g.at(-1)) || g.every(w => sorguKelimeleri.has(w) || DURAKLAR.has(w))) continue;
        goruldu.add(g.join(' '));
      }
    }
    for (const g of goruldu) {
      say.ekle(g);
      if (!kanallar.has(g)) kanallar.set(g, new Set());
      kanallar.get(g).add(v.kanal_id);
    }
  }
  const kaliplar = [...say].filter(([, c]) => c >= 2).map(([g, c]) => ({ kalip: g, video: c, kanal: kanallar.get(g).size }))
    .sort((a, b) => b.kanal - a.kanal || b.video - a.video || b.kalip.length - a.kalip.length);
  const secilen = [];
  for (const k of kaliplar) if (!secilen.some(s => s.kalip.includes(k.kalip) && k.video === s.video)) secilen.push(k);

  const kanalSay = new Sayac();
  for (const v of outlierlar) kanalSay.ekle(v.kanal_id);
  const tekrarEden = kanalSay.enCok().filter(([, c]) => c >= 2).slice(0, 20).map(([k, c]) => {
    const v = outlierlar.find(x => x.kanal_id === k);
    return { kanal: v.kanal, kanal_id: k, adet: c, abone: v.abone ?? null };
  });
  const uzunluk = l => (l.length ? yuvarla(medyan(l.map(v => [...v.baslik].length)), 1) : null);
  return {
    ozellikler: ozellik,
    sure: { outlier: dilim(outlierlar), tum: dilim(tumAdaylar) },
    baslik_uzunlugu: { outlier: uzunluk(outlierlar), tum: uzunluk(tumAdaylar) },
    kaliplar: secilen.slice(0, 30),
    tekrar_eden_kanallar: tekrarEden,
    n: { outlier: outlierlar.length, tum: tumAdaylar.length },
  };
}

// ---------------------------------------------------------------- alt konu önerileri
function baslikIfadeleri(sorgu, basliklar, adet = 12) {
  const tohum = new Set(kelimeler(sorgu)), say = new Sayac();
  for (const b of basliklar) {
    const k = kelimeler(b).filter(w => w !== 'N'), gor = new Set();
    for (const n of [2, 3]) {
      for (let i = 0; i + n <= k.length; i++) {
        const g = k.slice(i, i + n);
        if (DURAKLAR.has(g[0]) || DURAKLAR.has(g.at(-1)) || g.every(w => tohum.has(w))) continue;
        gor.add(g.join(' '));
      }
    }
    for (const g of gor) say.ekle(g);
  }
  const secilen = [];
  for (const [g, c] of say.enCok(100)) {
    if (c >= 3 && !secilen.some(s => g.includes(s) || s.includes(g))) secilen.push(g);
    if (secilen.length === adet) break;
  }
  return secilen;
}

/** Üç kaynak: YouTube önerileri, ilk arama başlıklarındaki sık ifadeler, yapay zekâ (hesap ekliyse). */
export async function altKonuOnerileri(sorgular, dil = 'en') {
  dil = ['', 'tumu'].includes(dil) ? 'en' : dil;
  const tohumlar = new Set(sorgular.map(s => s.trim().toLowerCase()));
  let youtube = [], basliklar = [];
  for (const s of sorgular) {
    youtube = youtube.concat((await yt.oneriler(s, dil)).filter(o => !tohumlar.has(o.toLowerCase())));
    try { basliklar = basliklar.concat((await yt.ara(s, 'alaka', 'yil', 'hepsi', 60, dil)).map(v => v.baslik)); } catch { /* arama olmazsa öneri yine çıkar */ }
  }
  const sonuc = { youtube: [...new Set(youtube)].slice(0, 15), basliklar: baslikIfadeleri(sorgular.join(' '), basliklar).filter(i => !tohumlar.has(i)), gemini: [], gemini_not: '' };
  const istem = `YouTube'da şu konu(lar)daki videoları araştırıyorum: ${sorgular.join(', ')}.\n` +
    `Bu konunun izleyicilerin gerçekten aradığı ALT KONULARINI ve yakın konularını kapsayan 12 farklı YouTube ` +
    `arama sorgusu üret. Her biri 2-5 kelime, ${ARAMA_DILLERI[dil] || 'English'} dilinde, YouTube'da yazılacağı gibi doğal olsun. ` +
    'Aynı ifadenin varyasyonlarını tekrarlama; farklı alt başlıklara yay (kişiler, olaylar, türler, sorunlar, ' +
    'formatlar). Konuyla aynı adı taşıyan alakasız şeyleri (çizgi film, marka, şarkı) ekleme.\n' +
    'Yalnızca JSON döndür: {"sorgular": ["...", "..."]}';
  try {
    const [yanit, kaynak] = await aiUret(istem);
    sonuc.gemini = ((Array.isArray(yanit) ? yanit : yanit?.sorgular) || []).filter(q => typeof q === 'string' && !tohumlar.has(q.trim().toLowerCase())).map(q => q.trim()).slice(0, 15);
    sonuc.gemini_not = kaynak;
  } catch (h) {
    if (!(h instanceof HesapYok)) throw h;
    sonuc.gemini_not = h.message;
  }
  return sonuc;
}

/** Genişletme için alt konu arama terimleri: önce yapay zekâ, olmazsa YouTube otomatik tamamlama (kanal_ara.alt_konular). */
export async function altKonular(sorgular, dil, adet = 8) {
  dil = ['', 'tumu'].includes(dil) ? 'en' : dil;
  const istem = `YouTube'da şu konuda içerik üreten TÜM kanalları bulmak istiyorum: ${sorgular.join(', ')}.\n` +
    `Bu konunun içindeki, kanalların sık video yaptığı ${adet} ALT KONUYU arama terimi olarak yaz ` +
    '(ör. aquarium → betta fish, guppy breeding, aquascape, shrimp tank, planted tank, cichlid, fish tank setup, goldfish). ' +
    `Her biri 1-3 kelime, ${ARAMA_DILLERI[dil] || 'İngilizce'} dilinde, konunun KENDİSİNE ait olsun (yan/ilgisiz konu değil). ` +
    'Yalnızca JSON: {"terimler": ["..."]}';
  const tohum = new Set(sorgular.map(s => s.trim().toLowerCase()));
  let terimler = [];
  try {
    const [yanit] = await aiUret(istem, 0.2);
    terimler = ((Array.isArray(yanit) ? yanit : yanit?.terimler) || []).filter(t => typeof t === 'string' && t.trim() && !tohum.has(t.trim().toLowerCase())).map(t => t.trim());
  } catch { terimler = []; }
  if (!terimler.length) for (const s of sorgular) terimler.push(...(await yt.oneriler(s, dil)).filter(o => !tohum.has(o.toLowerCase())));
  return [...new Set(terimler)].slice(0, adet);
}

const haricMi = (v, haric) => { const m = kucuk(`${v.baslik || ''} ${v.kanal || ''}`); return haric.some(h => m.includes(h)); };

// ---------------------------------------------------------------- ana akış
export async function tara(parametre, ilerleme = () => {}, iptal = { iptal: false }) {
  const p = { ...VARSAYILAN, ...parametre };
  p.sorgular = (p.sorgular || []).map(s => s.trim()).filter(Boolean);
  if (!p.sorgular.length) throw new Error('En az bir arama sorgusu gerekli');
  const kontrol = () => { if (iptal.iptal) throw new Iptal(); };
  const basla = Date.now();
  const istat = {};

  // 1) arama
  const minSn = p.min_sure_dk * 60, maxSn = p.max_sure_dk * 60;
  const ytSure = YT_SURE.has(p.yt_sure) ? p.yt_sure : ytSureSec(minSn, maxSn);
  const tumDiller = p.arama_dili === 'tumu';
  const diller = tumDiller ? Object.keys(ARAMA_DILLERI) : [p.arama_dili];
  if (tumDiller) {
    ilerleme('arama', 2, `Sorgular ${diller.length} dile çevriliyor`);
    p.ceviriler = await sorguCevirileri(p.sorgular, diller, p.ceviriler);
  } else {
    p.ceviriler = Object.fromEntries(p.sorgular.map(s => [s, { [diller[0]]: s }])); // tek dil: sorgu yazıldığı gibi aranır
  }
  // 0) alt konularla genişletme: küçük kanalların patlayan videoları çoğu zaman alt konu aramasında görünür
  p.genisleme = []; p.genisleme_ceviriler = {};
  if (p.genislet) {
    ilerleme('arama', 3, 'Alt konular çıkarılıyor (genişletme)');
    p.genisleme = await altKonular(p.sorgular, p.arama_dili, p.genislet_adet);
    if (p.genisleme.length) {
      ilerleme('arama', 4, 'Alt konular: ' + p.genisleme.join(', '));
      p.genisleme_ceviriler = tumDiller ? await sorguCevirileri(p.genisleme, diller) : Object.fromEntries(p.genisleme.map(t => [t, { [diller[0]]: t }]));
    }
  }
  const adaylar = new Map();
  const isler = [];
  for (const s of p.sorgular) for (const d of diller) for (const r of p.siralar) isler.push([s, p.ceviriler[s][d], d, r, p.sorgu_basina]);
  for (const [s, c] of Object.entries(p.genisleme_ceviriler)) for (const d of diller) for (const r of p.siralar) isler.push([s, c[d], d, r, Math.max(30, Math.floor(p.sorgu_basina / 2))]);
  let bitti = 0;
  await havuz(isler, 8, async ([s, q, d, r, adet]) => {
    if (iptal.iptal) return;
    let bulunan = [];
    try { bulunan = await yt.ara(q, r, p.tarih, ytSure, adet, d); }
    catch (h) { ilerleme('arama', null, `⚠ Arama hatası “${q}”: ${String(h.message).slice(0, 120)}`); }
    for (const v of bulunan) {
      Object.assign(v, { sorgu: s, arama: q, konu: s });
      if (!adaylar.has(v.id)) adaylar.set(v.id, { ...v, diller: [] });
      const onceki = adaylar.get(v.id);
      if (!onceki.diller.includes(d)) onceki.diller.push(d); // videoyu hangi dillerdeki aramalar buldu
    }
    bitti++;
    ilerleme('arama', 5 + 25 * bitti / isler.length, `Aranıyor (${bitti}/${isler.length}): “${q}” (${d.toUpperCase()}, ${r})`);
  });
  kontrol();
  const tum = [...adaylar.values()].filter(v => v.izlenme !== null && v.izlenme !== undefined);
  istat.aranan = adaylar.size;

  // biçim + süre + izlenme ön filtresi
  const bicimUygun = v => {
    if (p.format === 'uzun' && (v.sure === null || v.sure === undefined || shortsMu(v))) return false;
    if (p.format === 'shorts' && !shortsMu(v)) return false;
    const s = v.sure;
    return !(s !== null && s !== undefined && ((minSn && s < minSn) || (maxSn && s > maxSn)));
  };
  const haric = (p.haric || '').split(/[,\n]/).map(h => kucuk(h.trim())).filter(Boolean);
  // min izlenme yalnızca patlayan listesi için: karşılaştırma havuzunda normal videolar da olmalı
  let on = tum.filter(v => bicimUygun(v) && !CANLI_BASLIK.test(v.baslik));
  if (haric.length) { const once = on.length; on = on.filter(v => !haricMi(v, haric)); istat.haric = once - on.length; }
  istat.on_filtre = on.length;
  ilerleme('kanal', 30, `${adaylar.size} video bulundu, ${on.length} tanesi ön filtreyi geçti`);

  // 2) kanal tabanları
  const gerek = [...new Set(on.map(v => `${v.kanal_id}|${shortsMu(v) ? 'shorts' : 'videos'}`))];
  const profiller = new Map();
  let i = 0;
  await havuz(gerek, 10, async anahtar => {
    if (iptal.iptal) return;
    const [k, s] = anahtar.split('|');
    profiller.set(anahtar, await kanalProfili(k, s, p.taban_video));
    i++;
    if (i % 5 === 0 || i === gerek.length) ilerleme('kanal', 30 + 40 * i / Math.max(1, gerek.length), `Kanal tabanları: ${i}/${gerek.length}`);
  });
  kontrol();
  istat.kanal = gerek.length;

  // 3) skor. havuz = kat değeri hesaplanan tüm adaylar: Analiz sekmesi patlayanları bunlarla karşılaştırır
  let secilen = [];
  const havuzL = [], elenenler = [];
  const ele = (v, tur, sebep) => elenenler.push({ id: v.id, baslik: v.baslik || '', kanal: v.kanal || '', kanal_id: v.kanal_id, skor: v.skor ?? null,
    izlenme: v.izlenme ?? null, abone: v.abone ?? null, link: v.link || v.url, tur, sebep });
  for (const v of on) {
    const pr = profiller.get(`${v.kanal_id}|${shortsMu(v) ? 'shorts' : 'videos'}`);
    if (!pr) continue;
    const abone = pr.abone;
    const [tb, tn] = taban(pr, v.id);
    if (!tb) continue;
    Object.assign(v, { abone: abone ?? null, taban: tb, taban_n: tn, skor: yuvarla(v.izlenme / tb, 2),
      vsr: abone ? yuvarla(v.izlenme / abone, 2) : null, kanal: v.kanal || pr.ad });
    if (abone !== null && abone !== undefined && !(p.min_abone <= abone && abone <= p.max_abone)) {
      if (v.skor >= p.min_skor && v.izlenme >= p.min_izlenme) ele(v, 'abone', `Kanal ${abone.toLocaleString('tr-TR')} abone: aralık dışı`);
      continue;
    }
    havuzL.push(v);
    if (v.skor >= p.min_skor && v.izlenme >= p.min_izlenme) secilen.push(v);
  }
  secilen.sort((a, b) => b.skor - a.skor);
  secilen = secilen.slice(0, DETAY_SINIRI);
  istat.outlier = secilen.length;

  // 3b) kanal ülkesi
  ilerleme('ulke', 70, `${secilen.length} outlier bulundu, kanal ülkeleri kontrol ediliyor`);
  const kanalIds = [...new Set(secilen.map(v => v.kanal_id))];
  const ulkeler = new Map(await havuz(kanalIds, 4, async k => [k, await kanalUlkesi(k)]));
  for (const v of secilen) v.ulke = ulkeler.get(v.kanal_id) || '';
  if (p.ulke) {
    const hedef = ULKE_ESDEGER[p.ulke] || [p.ulke];
    for (const v of secilen) if (!hedef.includes(v.ulke)) ele(v, 'ulke', `Kanal ülkesi: ${v.ulke || 'belirtilmemiş'}`);
    secilen = secilen.filter(v => hedef.includes(v.ulke));
    ilerleme('ulke', 74, `Ülke filtresi (${p.ulke}): ${secilen.length} video kaldı`);
  }
  kontrol();

  // 4) detay: canlı yayın ve orijinal başlık için TÜM outlier'lar, kanca yalnızca ilk N için
  const simdi = simdiSn();
  ilerleme('detay', 75, `${secilen.length} video için ayrıntı çekiliyor (kanca: ilk ${Math.min(secilen.length, p.detay_adet)})`);
  let j = 0;
  await havuz(secilen, 3, async (v, sira) => {
    if (iptal.iptal) return;
    const d = await detay(v.id, p.kanca && sira < p.detay_adet, p.dil);
    if (!('hata' in d)) {
      v.detay_var = true;
      if (d.baslik && d.baslik.trim() !== v.baslik.trim()) Object.assign(v, { baslik_gorunen: v.baslik, baslik: d.baslik, ceviri: true });
      for (const k of ['begeni', 'yorum', 'dil', 'kategori', 'canli', 'etiketler', 'aciklama', 'kanca', 'kanca_hata']) v[k] = d[k] ?? null;
      if (d.sure) v.sure = d.sure;
      if (d.izlenme) {
        v.izlenme = d.izlenme;
        v.skor = yuvarla(v.izlenme / v.taban, 2);
        v.vsr = v.abone ? yuvarla(v.izlenme / v.abone, 2) : null;
      }
      if (d.zaman) {
        const saat = Math.max(1, (simdi - d.zaman) / 3600);
        v.tarih = new Date(d.zaman * 1000).toISOString().slice(0, 10);
        v.yas_gun = yuvarla(saat / 24, 1);
        v.vph = yuvarla(v.izlenme / saat, 1);
      }
      if (v.begeni !== null && v.begeni !== undefined && v.izlenme) v.etkilesim = yuvarla(100 * v.begeni / v.izlenme, 2);
    }
    j++;
    ilerleme('detay', 75 + 23 * j / Math.max(1, secilen.length), `Ayrıntılar: ${j}/${secilen.length}`);
  });
  kontrol();
  const suz = (kosul, tur, sebep) => {
    const kalan = [];
    for (const v of secilen) (kosul(v) ? kalan.push(v) : ele(v, tur, typeof sebep === 'function' ? sebep(v) : sebep));
    secilen = kalan;
  };
  const enEski = Math.min(p.max_yas_gun || EN_ESKI_GUN, EN_ESKI_GUN);
  suz(v => v.yas_gun === null || v.yas_gun === undefined || v.yas_gun <= enEski, 'yas', v => `${(Math.round(v.yas_gun / 365 * 10) / 10).toString().replace('.', ',')} yıllık video`);
  if (p.muzik_haric) suz(v => v.kategori !== 'Music', 'muzik', 'Müzik kategorisi');
  if (p.yalniz_arama_dili && !tumDiller) suz(v => !v.ceviri, 'dil', 'Başlık başka dilde');
  suz(v => !v.canli, 'canli', 'Canlı yayın kaydı'); // canlı yayın kayıtları her zaman elenir
  if (haric.length) suz(v => !haricMi(v, haric), 'haric', 'Hariç kelime geçiyor');
  if (maxSn) suz(v => (v.sure || 0) <= maxSn, 'sure', 'Süre sınırı aşıyor');
  const kokler = [...konuKokleri({ ...p.ceviriler, ...p.genisleme_ceviriler })];
  p.ilgi_yontemi = 'kapali';
  if (p.konu_eslesme && secilen.length) {
    const once = secilen.length;
    let kararlar = null;
    if (p.ai_ilgi) {
      ilerleme('ilgi', 98, `${secilen.length} patlayan video yapay zekâ ile konu açısından kontrol ediliyor`);
      try { kararlar = await videoAnaliz.videoIlgi(secilen, p.sorgular, p.genisleme, ilerleme); p.ilgi_yontemi = 'yapay_zeka'; }
      catch (h) { ilerleme('ilgi', null, `⚠ Yapay zekâ kontrolü yapılamadı (${String(h.message).slice(0, 100)}); kelime eşleşmesi kullanılıyor`); }
    }
    if (kararlar) {
      for (const v of secilen) { const k = kararlar[v.id]; if (k) { v.ilgi_puan = k.puan; v.ilgi_neden = k.neden; } }
      suz(v => !kararlar[v.id] || (kararlar[v.id].ilgili && kararlar[v.id].puan >= 30), 'konu', v => 'Konu dışı: ' + (kararlar[v.id]?.neden || 'yapay zekâ ilgisiz buldu'));
    } else {
      p.ilgi_yontemi = 'kelime';
      suz(v => konuylaIlgili(v, kokler), 'konu', 'Başlıkta/etiketlerde konu kelimesi yok');
    }
    istat.konu_disi = once - secilen.length;
  }
  for (const v of secilen) {
    v.bayraklar = bayraklar(v);
    v.kapak = `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`;
    v.link = shortsMu(v) ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`;
  }
  KANALLAR.kaydet();
  DETAYLAR.kaydet();

  // analiz havuzu: konuyla ilgili adaylar + son patlayan listesi; elenen patlayanlar çıkar
  const elenenId = new Set(elenenler.map(e => e.id));
  const son = new Map(secilen.map(v => [v.id, v]));
  let analizHavuzu = havuzL.filter(v => !elenenId.has(v.id) && (son.has(v.id) || konuylaIlgili(v, kokler))).map(v => son.get(v.id) || v);
  if (p.ilgi_yontemi === 'yapay_zeka') { // kelime eşleşmesi yanıltabilir (betta → "beta hCG"): karşılaştırma havuzu da yapay zekâdan geçer
    const digerleri = analizHavuzu.filter(v => !son.has(v.id));
    ilerleme('ilgi', 99, `Karşılaştırma havuzundaki ${digerleri.length} video yapay zekâ ile konu açısından kontrol ediliyor`);
    try {
      const k2 = await videoAnaliz.videoIlgi(digerleri, p.sorgular, p.genisleme, ilerleme);
      analizHavuzu = analizHavuzu.filter(v => son.has(v.id) || !k2[v.id] || (k2[v.id].ilgili && k2[v.id].puan >= 30));
    } catch (h) { ilerleme('ilgi', null, `⚠ Havuz konu kontrolü yapılamadı (${String(h.message).slice(0, 100)})`); }
  }
  const havuzKayit = analizHavuzu.map(v => Object.fromEntries(videoAnaliz.HAVUZ_ALANLARI.map(k => [k, v[k] ?? null])));
  for (const v of havuzKayit) v.link = v.link || `https://www.youtube.com/watch?v=${v.id}`;
  istat.havuz = analizHavuzu.length;
  const turSay = new Sayac();
  for (const e of elenenler) turSay.ekle(e.tur);
  istat.elenen = turSay.nesne();
  ilerleme('analiz', 99, `Analiz: ${secilen.length} patlayan, ${analizHavuzu.length} adayla karşılaştırılıyor`);
  const analiz = videoAnaliz.analiz(secilen, havuzKayit.map(v => ({ ...v })), p);
  istat.sure_sn = yuvarla((Date.now() - basla) / 1000, 1);
  ilerleme('bitti', 100, `Tamamlandı: ${secilen.length} outlier · ${istat.sure_sn} sn`);
  return {
    parametre: p, zaman: zamanDamgasi(), istatistik: istat, sonuclar: secilen,
    elenenler: [...elenenler].sort((a, b) => (b.skor || 0) - (a.skor || 0)).slice(0, 400),
    havuz: havuzKayit, analiz,
    // desenler: başlığı çevrilmiş videolar dışarıda (çeviri başlık, gerçek başlık değildir)
    desenler: desenler(secilen.filter(v => !v.ceviri), tum.filter(bicimUygun), Object.values(p.ceviriler).flatMap(c => Object.values(c))),
  };
}

// ---------------------------------------------------------------- kayıt (geçmişte görünme)
const KAYITSIZ_SAKLAMA_GUN = 7;

/** Sonuç dosyasını kaydedildi/kaydedilmedi olarak işaretler. Yalnızca kaydedilenler Kayıtlar'da görünür. */
export function kayitIsaretle(yol, kayitli) {
  const d = JSON.parse(fs.readFileSync(yol, 'utf8'));
  d.kayitli = !!kayitli;
  fs.writeFileSync(yol, JSON.stringify(d), 'utf8');
  return { tamam: true, kayitli: d.kayitli };
}

/** Kayıtlar listesi için: kaydedilmiş mi? Kaydedilmemiş ve 7 günden eski dosyayı siler. */
export function gecmisteMi(yol, d) {
  const kayitli = d.kayitli ?? true;
  if (kayitli === true) return true;
  if (kayitli === 'grup') return false; // çoklu analizin üyesi: tek kanal listesinde görünmez, grup durdukça silinmez
  try { if (Date.now() - fs.statSync(yol).mtimeMs > KAYITSIZ_SAKLAMA_GUN * 86400_000) fs.unlinkSync(yol); } catch { /* silinemedi */ }
  return false;
}
