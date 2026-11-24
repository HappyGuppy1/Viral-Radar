// Kanal bul (kanal_ara.py): bir konuda video üreten kanalları bulur ve filtreler.
// Akış:
//   1) sorgular  : tek dil ya da "Tümü" (sorgu 6 dile çevrilir)
//   2) adaylar   : kanal araması + konudaki videoların kanalları + son ayın EN YENİ videoları + alt konularla aynı aramalar
//   3) ön filtre : abone aralığı (kanal aramasından gelenlerde profil çekmeden)
//   4) profil    : son 30 uzun video → medyan izlenme, son yükleme, aylık yükleme, konu odağı
//   5) filtre    : abone, medyan izlenme, son yükleme (aktiflik), konu odağı / yapay zekâ ilgisi, ülke
import fs from 'node:fs';
import path from 'node:path';
import { Onbellek } from './onbellek.js';
import * as yt from './youtube.js';
import { sorguCevirileri } from './ceviri.js';
import { aiUret } from './hesaplar.js';
import { DOSYA } from './yollar.js';
import * as motor from './motor.js';
import { ARAMA_DILLERI, DURAKLAR, havuz, kelimeler, kucuk, medyan, Sayac, simdiSn, dosyaDamgasi, yuvarla, zamanDamgasi } from './metin.js';

const PROFILLER = new Onbellek('kanal_ozetleri', 24);
const KARARLAR = new Onbellek('ilgi_kararlari', 24 * 7); // yapay zekâ ilgi kararı: konu + kanal → {ilgili, puan, neden}
const GEMINI_PAKET = 12;
const ULKE_ESDEGER = { 'Türkiye': ['Türkiye', 'Turkey'], 'United States': ['United States', 'USA'], 'United Kingdom': ['United Kingdom', 'UK'], 'South Korea': ['South Korea', 'Korea'] };

export const VARSAYILAN = {
  sorgular: [], arama_dili: 'en', ceviriler: null, ulke: '',
  min_abone: 1000, max_abone: 500000, min_medyan: 0, max_son_yukleme_gun: 90,
  min_konu_orani: 30, kanal_basina: 100, video_basina: 100, video_kaynagi: true, haric: '',
  gemini_dogrula: true, min_gemini_puan: 30, genislet: true, genislet_adet: 8, max_sonuc: 0,
};

/** Konu odağı için sıkı eşleşme: çevirinin TAM kelimesi + ekleri ("aquarium" → aquariums ✓, aquarius ✗). */
function tamKelimeler(ceviriler) {
  const s = new Set();
  for (const c of Object.values(ceviriler)) for (const q of Object.values(c)) for (const w of kelimeler(q)) if (w !== 'N' && !DURAKLAR.has(w) && [...w].length >= 3) s.add(w);
  return [...s];
}

function ilgiliBaslik(baslik, kelimelerL, haric) {
  if (haric.length && haric.some(h => kucuk(baslik).includes(h))) return false;
  return kelimeler(baslik).some(w => kelimelerL.some(t => w.startsWith(t)));
}

/** Son 30 uzun video: abone, medyan izlenme, son yükleme, aylık yükleme, başlıklar, avatar. */
export async function kanalOzeti(kanalId) {
  const v = PROFILLER.al(kanalId);
  if (v && 'aciklama' in v) return v;
  let k;
  try { k = await yt.kanalSekmesi(kanalId, 'videos', 30); }
  catch (h) { return { hata: String(h.message).slice(0, 150) }; }
  const vids = k.videolar.filter(x => x.id), simdi = simdiSn();
  const zaman = vids.map(x => x.zaman).filter(Boolean).sort((a, b) => b - a);
  const izl = vids.map(x => x.izlenme).filter(x => x !== null && x !== undefined);
  const enIyi = vids.reduce((m, x) => ((x.izlenme || 0) > (m?.izlenme || 0) ? x : m), null);
  const d = {
    ad: k.ad, handle: k.handle, abone: k.abone, avatar: k.avatar,
    video_n: vids.length, medyan: izl.length ? medyan(izl) : null,
    en_iyi: enIyi?.baslik || '', en_iyi_izlenme: izl.length ? Math.max(...izl) : null,
    son_yukleme_gun: zaman.length ? Math.round((simdi - zaman[0]) / 86400) : null,
    aylik: yuvarla(zaman.filter(z => simdi - z <= 90 * 86400).length / 3, 1),
    basliklar: vids.map(x => x.baslik || ''),
    aciklama: (k.aciklama || '').slice(0, 600),
  };
  PROFILLER.koy(kanalId, d);
  return d;
}

/** Kanalları paketler halinde yapay zekâya sorar: {kanal_id: {ilgili, puan, neden}}. */
async function yzIlgi(kanallar, sorgular, ceviriler, ilerleme, alt = []) {
  const terimler = [...new Set(Object.values(ceviriler).flatMap(c => Object.values(c)))].sort();
  const imza = sorgular.map(kucuk).sort().join('|'); // karar konuya özgü
  const sonuc = {};
  for (const a of kanallar) { const k = KARARLAR.al(`${imza}:${a.id}`); if (k) sonuc[a.id] = k; }
  const sorulacak = kanallar.filter(a => !sonuc[a.id]);
  if (Object.keys(sonuc).length) ilerleme('gemini', 90, `${Object.keys(sonuc).length} kanalın kararı önbellekten; ${sorulacak.length} kanal yapay zekâya soruluyor`);
  let bitti = 0;
  const sor = async paket => {
    const liste = paket.map(a => ({ id: a.id, ad: a.ad || '', aciklama: (a.aciklama || '').slice(0, 300), son_basliklar: (a.basliklar || []).slice(0, 12) }));
    const istem = `Araştırılan konu: ${sorgular.join(', ')} (diğer dillerde: ${terimler.join(', ')})` + (alt.length ? `; alt konuları da dahil: ${alt.join(', ')}` : '') + '.\n' +
      'Aşağıdaki YouTube kanallarının HER BİRİ için, kanalın bu konuda ya da alt konularında DÜZENLİ içerik üretip üretmediğine karar ver. ' +
      'Kanal adına, açıklamasına ve son video başlıklarına birlikte bak; başlıkta kelime geçmese de konu aynıysa ilgilidir ' +
      "(ör. akvaryum konusunda 'lepistes üretimi', 'betta bakımı', 'aquascape', 'karides', 'balık hastalığı' ilgilidir). " +
      "Karma kanallar da ilgilidir: son başlıkların kabaca %25'i veya daha fazlası konudaysa (ör. evcil hayvan kanalı, " +
      'düzenli akvaryum videoları da var) ilgili=true ve puan 35-70.\n' +
      "İlgisiz say: aynı kelimeyi başka anlamda kullananlar (ör. burç/horoskop 'Kova/Acuario/Aquário', marka, şarkı, çizgi film), " +
      'konuya yalnızca bir-iki videoda değinen genel kanallar (vlog, haber, çocuk, oyun).\n' +
      'Konuyu yalnızca arka plan/ekran koruyucu/rahatlama/uyku videosu olarak kullananlara ilgili=true ama puan ≤ 25 ver.\n' +
      'puan: 0-100 (100 = tamamen bu konuya odaklı kanal). Emin değilsen ilgili=true de, puanı düşük ver. ' +
      'neden: en fazla 12 kelimelik Türkçe gerekçe.\n' +
      'Yalnızca JSON döndür: {"kanallar": [{"id": "...", "ilgili": true, "puan": 85, "neden": "..."}]}\n\n' + JSON.stringify(liste);
    const [yanit, kaynak] = await aiUret(istem, 0);
    for (const k of (Array.isArray(yanit) ? yanit : yanit?.kanallar) || []) {
      if (k && typeof k === 'object' && k.id) {
        const karar = { ilgili: !!k.ilgili, puan: parseInt(k.puan || 0, 10) || 0, neden: String(k.neden || '').slice(0, 120) };
        sonuc[k.id] = karar;
        KARARLAR.koy(`${imza}:${k.id}`, { ...karar });
      }
    }
    bitti += paket.length;
    ilerleme('gemini', 90 + 6 * bitti / Math.max(1, sorulacak.length), `İlgi değerlendirmesi: ${bitti}/${sorulacak.length} (${kaynak})`);
  };
  const paketler = [];
  for (let i = 0; i < sorulacak.length; i += GEMINI_PAKET) paketler.push(sorulacak.slice(i, i + GEMINI_PAKET));
  try { await havuz(paketler, 12, sor); } finally { KARARLAR.kaydet(); }
  return sonuc;
}

export async function kanalAra(parametre, ilerleme = () => {}, iptal = { iptal: false }) {
  const p = { ...VARSAYILAN, ...parametre };
  p.sorgular = (p.sorgular || []).map(s => s.trim()).filter(Boolean);
  if (!p.sorgular.length) throw new Error('En az bir anahtar kelime gerekli');
  for (const [k, ust] of [['kanal_basina', 500], ['video_basina', 500], ['max_sonuc', 1000]]) p[k] = Math.max(0, Math.min(ust, parseInt(p[k] || 0, 10) || 0));
  p.kanal_basina = Math.max(1, p.kanal_basina); p.video_basina = Math.max(1, p.video_basina);
  const kontrol = () => { if (iptal.iptal) throw new motor.Iptal(); };
  const basla = Date.now();
  const tumDiller = p.arama_dili === 'tumu';
  const diller = tumDiller ? Object.keys(ARAMA_DILLERI) : [p.arama_dili];
  if (tumDiller) { ilerleme('arama', 2, `Anahtar kelimeler ${diller.length} dile çevriliyor`); p.ceviriler = await sorguCevirileri(p.sorgular, diller, p.ceviriler); }
  else p.ceviriler = Object.fromEntries(p.sorgular.map(s => [s, { [diller[0]]: s }]));
  const haric = (p.haric || '').split(/[,\n]/).map(h => kucuk(h.trim())).filter(Boolean);

  // 0) alt konularla genişletme: küçük kanallar çoğu zaman alt konuda görünür (yalnızca ADAY bulmak için)
  p.genisleme = [];
  if (p.genislet) {
    kontrol();
    ilerleme('arama', 3, 'Alt konular çıkarılıyor (genişletme)');
    p.genisleme = await motor.altKonular(p.sorgular, p.arama_dili, p.genislet_adet);
    if (p.genisleme.length) {
      ilerleme('arama', 5, 'Alt konular: ' + p.genisleme.join(', '));
      p.genisleme_ceviriler = tumDiller ? await sorguCevirileri(p.genisleme, diller) : Object.fromEntries(p.genisleme.map(t => [t, { [diller[0]]: t }]));
    }
  }
  const kelimelerL = tamKelimeler({ ...p.ceviriler, ...(p.genisleme_ceviriler || {}) });

  // 1) adaylar
  const adaylar = new Map();
  const aday = (kid, ad, dil, ek = {}) => {
    if (!adaylar.has(kid)) adaylar.set(kid, { id: kid, ad, diller: [], kaynak: new Set(), eslesen_video: 0, eslesen_izlenme: 0 });
    const a = adaylar.get(kid);
    if (!a.diller.includes(dil)) a.diller.push(dil);
    for (const [k, v] of Object.entries(ek)) if (v !== null && v !== undefined) a[k] = v;
    return a;
  };
  const gorevler = [];
  for (const [ana, kaynak] of [[true, p.ceviriler], [false, p.genisleme_ceviriler || {}]]) {
    const kb = ana ? p.kanal_basina : Math.max(20, Math.floor(p.kanal_basina / 2)), vb = ana ? p.video_basina : Math.max(30, Math.floor(p.video_basina / 2));
    for (const [s, c] of Object.entries(kaynak)) {
      for (const d of diller) {
        const q = c[d] || s;
        gorevler.push(['kanal', q, d, kb]);
        if (p.video_kaynagi) gorevler.push(['video', q, d, vb], ['yeni', q, d, vb]);
      }
    }
  }
  let i = 0;
  await havuz(gorevler, 8, async ([tur, q, d, n]) => {
    if (iptal.iptal) return;
    try {
      if (tur === 'kanal') {
        for (const k of await yt.kanallariAra(q, d, n)) aday(k.id, k.ad, d, { abone: k.abone, aciklama: k.aciklama }).kaynak.add('kanal araması');
      } else {
        const bulunan = tur === 'video' ? await yt.ara(q, 'alaka', 'yil', 'hepsi', n, d) : await yt.ara(q, 'tarih', 'ay', 'hepsi', n, d);
        for (const v of bulunan) {
          const a = aday(v.kanal_id, v.kanal, d);
          a.kaynak.add(tur === 'video' ? 'video araması' : 'yeni videolar');
          a.eslesen_video += 1;
          a.eslesen_izlenme += v.izlenme || 0;
        }
      }
    } catch (h) { ilerleme('arama', null, `⚠ Arama hatası “${q}” (${d}): ${String(h.message).slice(0, 100)}`); }
    i++;
    if (i % 4 === 0 || i === gorevler.length) ilerleme('arama', 6 + 20 * i / gorevler.length, `Aramalar: ${i}/${gorevler.length} · ${adaylar.size} aday kanal`);
  });
  kontrol();
  const istat = { aday: adaylar.size, arama: gorevler.length };
  const elenen = [];
  const ele = (a, sebep, tur) => elenen.push({ id: a.id, ad: a.ad || '', abone: a.abone ?? null, son_yukleme_gun: a.son_yukleme_gun ?? null,
    avatar: a.avatar ?? null, puan: a.gemini_puan ?? null, konu_orani: a.konu_orani ?? null, sebep, tur, link: `https://www.youtube.com/channel/${a.id}` });
  const sayi = x => Number(x).toLocaleString('tr-TR');

  // 2) abone ön filtresi
  const aboneUygun = a => a.abone === null || a.abone === undefined || (p.min_abone <= a.abone && a.abone <= p.max_abone);
  const liste = [...adaylar.values()].filter(aboneUygun);
  for (const a of adaylar.values()) if (!aboneUygun(a)) ele(a, `abone aralığı dışında (${sayi(a.abone)})`, 'abone');
  istat.on_filtre = liste.length;
  ilerleme('profil', 26, `${adaylar.size} aday kanal bulundu, ${liste.length} tanesinin son videoları inceleniyor (önbellekte olmayanlar ~1 sn)`);

  // 3) profil
  let j = 0;
  await havuz(liste, 12, async a => {
    if (iptal.iptal) return;
    const o = await kanalOzeti(a.id);
    if (!('hata' in o)) {
      for (const k of ['ad', 'handle', 'avatar', 'video_n', 'medyan', 'en_iyi', 'en_iyi_izlenme', 'son_yukleme_gun', 'aylik']) if (o[k] !== null && o[k] !== undefined) a[k] = o[k];
      if (o.abone !== null && o.abone !== undefined) a.abone = o.abone;
      if (o.aciklama) a.aciklama = o.aciklama;
      a.basliklar = o.basliklar; // yapay zekâ değerlendirmesi için; kayıttan önce silinir
      const ilgili = o.basliklar.filter(b => ilgiliBaslik(b, kelimelerL, haric));
      a.konu_orani = o.basliklar.length ? Math.round(100 * ilgili.length / o.basliklar.length) : 0;
      a.aciklama_eslesme = ilgiliBaslik(a.aciklama || '', kelimelerL, haric);
      a.ornek = ilgili.length ? ilgili.slice(0, 3) : o.basliklar.slice(0, 3);
    }
    j++;
    if (j % 5 === 0 || j === liste.length) ilerleme('profil', 26 + 64 * j / Math.max(1, liste.length), `Kanallar: ${j}/${liste.length}`);
  });
  kontrol();

  // 4) sayısal filtreler
  const sayisalSebep = a => {
    if (a.video_n === null || a.video_n === undefined) return ['uzun video yok / kanal okunamadı', 'video'];
    if (a.abone === null || a.abone === undefined) return ['abone sayısı gizli', 'abone'];
    if (!aboneUygun(a)) return [`abone aralığı dışında (${sayi(a.abone)})`, 'abone'];
    if (haric.length && haric.some(h => kucuk(`${a.ad || ''} ${a.aciklama || ''}`).includes(h))) return ['hariç kelime geçiyor', 'haric'];
    if ((a.medyan || 0) < p.min_medyan) return [`medyan izlenme düşük (${Math.trunc(a.medyan || 0)})`, 'medyan'];
    if (p.max_son_yukleme_gun && (a.son_yukleme_gun === null || a.son_yukleme_gun === undefined || a.son_yukleme_gun > p.max_son_yukleme_gun)) {
      return [`son ${p.max_son_yukleme_gun} günde uzun video yok (son: ${a.son_yukleme_gun ?? '?'} gün önce)`, 'aktiflik'];
    }
    return [null, null];
  };
  let sonuc = [];
  for (const a of liste) { const [sebep, tur] = sayisalSebep(a); sebep ? ele(a, sebep, tur) : sonuc.push(a); }
  istat.sayisal = sonuc.length;

  // 5) konuyla ilgi: yapay zekâ ya da kelime yöntemi
  istat.ilgi_yontemi = 'kelime';
  if (p.gemini_dogrula && sonuc.length) {
    ilerleme('gemini', 90, `${sonuc.length} kanal yapay zekâ ile değerlendiriliyor (ad, açıklama, başlıklar). EVREN ile birkaç dakika sürebilir`);
    try {
      const kararlar = await yzIlgi(sonuc, p.sorgular, p.ceviriler, ilerleme, p.genisleme);
      for (const a of sonuc) { const k = kararlar[a.id]; if (k) Object.assign(a, { gemini_ilgili: k.ilgili, gemini_puan: k.puan, gemini_neden: k.neden }); }
      const gecer = a => (!('gemini_ilgili' in a) ? (a.konu_orani || 0) >= p.min_konu_orani : a.gemini_ilgili && a.gemini_puan >= p.min_gemini_puan);
      const kalan = [];
      for (const a of sonuc) {
        if (gecer(a)) kalan.push(a);
        else ele(a, 'gemini_ilgili' in a ? `yapay zekâ: ${a.gemini_neden || 'ilgisiz'} (puan ${a.gemini_puan ?? '?'})` : `konu odağı düşük (%${a.konu_orani || 0})`, 'ilgi');
      }
      sonuc = kalan;
      istat.ilgi_yontemi = 'gemini';
    } catch (h) {
      istat.gemini_hata = String(h.message).slice(0, 150);
      ilerleme('gemini', null, `⚠ Yapay zekâ kullanılamadı, kelime yöntemine geçildi: ${String(h.message).slice(0, 100)}`);
    }
  }
  if (istat.ilgi_yontemi === 'kelime') {
    const esik = p.min_konu_orani; // açıklamada konu geçiyorsa başlık eşiği yarıya iner
    const kalan = [];
    for (const a of sonuc) {
      if ((a.konu_orani || 0) >= esik || (a.aciklama_eslesme && (a.konu_orani || 0) >= esik / 2)) kalan.push(a);
      else ele(a, `konu odağı düşük (%${a.konu_orani || 0}, eşik %${esik})`, 'ilgi');
    }
    sonuc = kalan;
  }

  // 6) sıralama + üst sınır + ülke
  sonuc.sort((a, b) => (b.gemini_puan || 0) - (a.gemini_puan || 0) || (b.konu_orani || 0) - (a.konu_orani || 0));
  if (p.ulke && sonuc.length) {
    ilerleme('ulke', 97, `${sonuc.length} kanalın ülkesi kontrol ediliyor`);
    const ulkeler = await havuz(sonuc, 4, a => motor.kanalUlkesi(a.id));
    sonuc.forEach((a, k) => { a.ulke = ulkeler[k] || ''; });
    const hedef = ULKE_ESDEGER[p.ulke] || [p.ulke];
    for (const a of sonuc) if (!hedef.includes(a.ulke)) ele(a, `ülke farklı (${a.ulke || 'belirtilmemiş'})`, 'ulke');
    sonuc = sonuc.filter(a => hedef.includes(a.ulke));
  }
  istat.sinir_oncesi = sonuc.length;
  if (p.max_sonuc) sonuc = sonuc.slice(0, p.max_sonuc);
  if (!p.ulke && sonuc.length) {
    ilerleme('ulke', 97, `${sonuc.length} kanalın ülkesi okunuyor`);
    const ulkeler = await havuz(sonuc, 4, a => motor.kanalUlkesi(a.id));
    sonuc.forEach((a, k) => { a.ulke = ulkeler[k] || ''; });
  }
  for (const a of sonuc) {
    delete a.basliklar;
    a.kaynak = [...a.kaynak].sort();
    a.izlenme_abone = a.medyan && a.abone ? yuvarla(a.medyan / a.abone, 2) : null;
    a.link = `https://www.youtube.com/channel/${a.id}`;
  }
  for (const a of adaylar.values()) if (a.kaynak instanceof Set) a.kaynak = [...a.kaynak].sort();
  PROFILLER.kaydet();
  motor.KANALLAR.kaydet();
  Object.assign(istat, { sonuc: sonuc.length, sure_sn: yuvarla((Date.now() - basla) / 1000, 1) });
  ilerleme('bitti', 100, `Tamamlandı: ${sonuc.length} kanal · ${istat.sure_sn} sn`);
  const sira = { ilgi: 0, aktiflik: 1, abone: 2, medyan: 3, ulke: 4, haric: 5, video: 6 };
  elenen.sort((a, b) => (sira[a.tur] ?? 9) - (sira[b.tur] ?? 9) || (b.puan || 0) - (a.puan || 0) || (b.konu_orani || 0) - (a.konu_orani || 0));
  const turSay = new Sayac();
  for (const e of elenen) turSay.ekle(e.tur);
  istat.elenen = turSay.nesne();
  const kayit = { parametre: p, zaman: zamanDamgasi(), istatistik: istat, kanallar: sonuc, elenenler: elenen.slice(0, 1500), kayitli: false };
  const ad = `${dosyaDamgasi()}.json`;
  fs.writeFileSync(path.join(DOSYA.kanalAramalari, ad), JSON.stringify(kayit), 'utf8');
  return ad;
}

// ---------------------------------------------------------------- kayıtlar
function yol(dosya) {
  if (!(dosya || '').endsWith('.json') || /[/\\]|\.\./.test(dosya)) { const h = new Error('dosya yok'); h.kod = 404; throw h; }
  const y = path.join(DOSYA.kanalAramalari, dosya);
  if (!fs.existsSync(y)) { const h = new Error('dosya yok'); h.kod = 404; throw h; }
  return y;
}

export function gecmis() {
  const l = [];
  for (const f of fs.readdirSync(DOSYA.kanalAramalari).filter(f => f.endsWith('.json')).sort().reverse()) {
    try {
      const y = path.join(DOSYA.kanalAramalari, f), d = JSON.parse(fs.readFileSync(y, 'utf8'));
      if (motor.gecmisteMi(y, d)) l.push({ dosya: f, zaman: d.zaman, sorgular: d.parametre.sorgular, kanal: d.kanallar.length });
    } catch { /* bozuk dosya */ }
  }
  return l;
}

export const kayit = (dosya, kayitli) => motor.kayitIsaretle(yol(dosya), kayitli);
export const yukle = dosya => JSON.parse(fs.readFileSync(yol(dosya), 'utf8'));
