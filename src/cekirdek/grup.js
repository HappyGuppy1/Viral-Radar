// Kanal karşılaştır (grup.py): birden çok kanal tek tek Kanal analizi'nden geçer, sonra birleştirilir.
// Akış:
//   1) her kanal  : kanal.analiz (aynı anda 3 kanal) → kendi analiz dosyası (grup üyesi olarak işaretlenir)
//   2) birleştir  : kanalların olgun videoları tek havuzda; kat her videonun KENDİ kanal normaline göre olduğu için
//                   farklı büyüklükteki kanallar karşılaştırılabilir
//   3) ortak      : her başlık etiketi için kanal kanal kaldıraç matrisi → "kaç kanalda işe yarıyor"
//   4) başlık     : birleşik havuzda başlık analizi (kalıplarda kaç farklı kanalda geçtiği de var)
//   5) içerik     : süre dilimleri, YouTube etiketleri (kaç kanal kullanıyor), gün performansı
// Seçim çubuğundan gelen grup dosyası: {"tur": "youtube-analiz-kanal-grubu", "ad": ..., "kanallar": [{"id", "ad", ...}]}
import fs from 'node:fs';
import path from 'node:path';
import * as baslikAnaliz from './baslik_analiz.js';
import * as kanal from './kanal.js';
import * as motor from './motor.js';
import { DOSYA } from './yollar.js';
import { DURAKLAR, havuz as esZamanli, kelimeler, kucuk, medyan, Sayac, SURE_DILIMLERI, yuvarla, zamanDamgasi, dosyaDamgasi } from './metin.js';
import { DOLGU, SOZLUK_DISI, fark, kat, kucukBas, sayiYaz } from './ortak.js';

export const VARSAYILAN = { kanallar: [], ad: '', detay_adet: 30, yorum: false };
const GRUP_SURUM = 5;
const EN_FAZLA_KANAL = 300;
const PARALEL = 3; // aynı anda analiz edilen kanal (daha fazlası YouTube'dan 429 riskini artırır)
const VIDEO_ALANLARI = ['id', 'baslik', 'skor', 'izlenme', 'normal', 'link', 'kapak', 'sure', 'zaman', 'kesin_tarih',
  'yas_gun', 'etkilesim', 'baslik_ozellik', 'kanal', 'kanal_id'];
const med = l => { const m = medyan(l); return m === null ? null : yuvarla(m, 2); };
const sec = (v, alanlar) => Object.fromEntries(alanlar.map(k => [k, v[k] ?? null]));

/** Metin (satır/virgül) ya da liste → tekrarsız kanal girdileri. */
function kanalListesi(girdi) {
  if (typeof girdi === 'string') girdi = girdi.split(/[\n,;]+/);
  const temiz = [];
  for (let g of girdi || []) {
    g = (g && typeof g === 'object' ? (g.id || g.link || '') : String(g)).trim();
    if (g && !temiz.includes(g)) temiz.push(g);
  }
  return temiz.slice(0, EN_FAZLA_KANAL);
}

// ---------------------------------------------------------------- ana akış
export async function analiz(parametre, ilerleme = () => {}, iptal = { iptal: false }) {
  const p = { ...VARSAYILAN, ...parametre };
  const kanallar = kanalListesi(p.kanallar);
  if (kanallar.length < 2) throw new Error('Karşılaştırma için en az 2 kanal gerekli');
  const basla = Date.now(), n = kanallar.length;
  const oran = new Array(n).fill(0), sonuclar = new Array(n).fill(null), hatalar = [];
  ilerleme('kanallar', 1, `${n} kanal analiz edilecek (aynı anda ${PARALEL} kanal, kanal başına son ${p.detay_adet} video ayrıntılı)`);
  await esZamanli([...Array(n).keys()], PARALEL, async i => {
    const alt = (asama, yuzde, mesaj) => {
      if (yuzde !== null && yuzde !== undefined) oran[i] = yuzde / 100;
      ilerleme('kanallar', 2 + 88 * oran.reduce((a, b) => a + b, 0) / n, `[${i + 1}/${n}] ${mesaj}`);
    };
    try {
      if (iptal.iptal) throw new motor.Iptal();
      const dosya = await kanal.analiz({ kanal: kanallar[i], detay_adet: p.detay_adet, yorum: p.yorum }, alt, iptal);
      sonuclar[i] = [dosya, kanal.yukle(dosya)];
      alt('bitti', 100, `✓ ${sonuclar[i][1].genel.ad} tamamlandı`);
    } catch (h) {
      if (h instanceof motor.Iptal) throw h;
      oran[i] = 1;
      hatalar.push({ kanal: kanallar[i], hata: String(h.message).slice(0, 200) });
      ilerleme('kanallar', null, `⚠ [${i + 1}/${n}] ${kanallar[i]}: ${String(h.message).slice(0, 120)}`);
    }
  });
  if (iptal.iptal) throw new motor.Iptal();
  const tamam = sonuclar.filter(Boolean);
  if (tamam.length < 2) throw new Error('En az 2 kanal analiz edilebilmeli. Hatalar: ' + hatalar.map(h => h.hata).join('; '));
  ilerleme('birlestir', 92, `${tamam.length} kanal birleştiriliyor: konu dışı videolar ayıklanıyor, ortak başlık kalıpları ve özet çıkarılıyor`);
  const sonuc = birlestir(tamam, p);
  sonuc.hatalar = hatalar;
  sonuc.istatistik.sure_sn = yuvarla((Date.now() - basla) / 1000, 1);
  return kaydet(sonuc);
}

// ---------------------------------------------------------------- niş sözlüğü (konu dışı videoları ayıklamak için)
function nisSozlugu(tamam) {
  const sayac = new Sayac();
  for (const [, d] of tamam) {
    const vs = d.videolar.filter(v => v.baslik), say = new Sayac();
    for (const v of vs) for (const w of new Set(kelimeler(v.baslik))) if ([...w].length >= 4 && !DURAKLAR.has(w) && w !== 'N') say.ekle(w);
    const esik = Math.max(2, 0.06 * vs.length);
    for (const [w, c] of say) if (c >= esik) sayac.ekle(w);
  }
  const esikK = tamam.length >= 10 ? Math.max(3, Math.round(0.02 * tamam.length)) : 2;
  return sayac.enCok().filter(([w, c]) => c >= esikK && !SOZLUK_DISI.has(w)).map(([w]) => w);
}

const kacis = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Kök eşleşmesi: acuario → acuarios, aquarium → aquariumanlage; uzun kelimeler içte de (pflanzenaquarium). */
function konuDeseni(sozluk) {
  const kisa = sozluk.filter(s => [...s].length < 6).map(kacis), uzun = sozluk.filter(s => [...s].length >= 6).map(kacis);
  const parca = [...(kisa.length ? [`(?<![\\p{L}\\p{N}_])(?:${kisa.join('|')})`] : []), ...(uzun.length ? [`(?:${uzun.join('|')})`] : [])];
  return parca.length ? new RegExp(parca.join('|'), 'u') : null;
}
const konuIci = (baslik, desen) => desen.test(kucuk(baslik).replace(/’/g, "'"));

export function birlestir(tamam, p) {
  const tekil = new Map();
  for (const [dosya, d] of tamam) if (!tekil.has(d.genel.id)) tekil.set(d.genel.id, [dosya, d]); // aynı kanal iki kez girildiyse bir kez say
  tamam = [...tekil.values()];
  const sozluk = tamam.length >= 3 ? nisSozlugu(tamam) : [];
  const desen = konuDeseni(sozluk);
  const kanalOzet = [], tumUzun = [];
  let havuzL = [], disi = [];
  for (const [dosya, d] of tamam) {
    const g = d.genel, b = d.baslik || {};
    d.videolar = d.videolar.filter(v => (v.yas_gun || 0) <= kanal.EN_ESKI_GUN); // son 5 yıl
    const olgun = d.videolar.filter(v => (v.yas_gun || 0) >= 7 && v.skor !== null && v.skor !== undefined);
    for (const v of d.videolar) {
      v.kanal = g.ad; v.kanal_id = g.id;
      if (!v.baslik_ozellik) v.baslik_ozellik = baslikAnaliz.ozellikler(v.baslik);
      v.konu_ici = desen === null || konuIci(v.baslik, desen);
      tumUzun.push(v);
    }
    havuzL = havuzL.concat(olgun.filter(v => v.konu_ici));
    disi = disi.concat(olgun.filter(v => !v.konu_ici));
    kanalOzet.push({
      dosya, id: g.id, ad: g.ad, handle: g.handle ?? null, avatar: g.avatar ?? null, url: g.url ?? null, ulke: g.ulke ?? null,
      abone: g.abone ?? null, medyan: g.medyan ?? null, medyan_son10: g.medyan_son10 ?? null, uzun: g.uzun ?? null, shorts: g.shorts ?? null,
      aylik_yukleme: g.aylik_yukleme ?? null, son_yukleme_gun: g.son_yukleme_gun ?? null, patlama_orani: g.outlier_orani ?? null,
      etkilesim: g.medyan_etkilesim ?? null, olgun: olgun.length, en_guclu: b.ozet?.en_guclu || [],
      en_iyi: (d.en_iyi || [])[0] ?? null, konu_disi: olgun.filter(v => !v.konu_ici).length,
    });
  }
  if (sozluk.length && havuzL.length < 0.4 * (havuzL.length + disi.length)) { // sözlük nişi tutturamadıysa ayıklama yapma
    havuzL = havuzL.concat(disi); disi = [];
    for (const v of tumUzun) v.konu_ici = true;
    for (const k of kanalOzet) k.konu_disi = 0;
  }
  const minKanal = tamam.length >= 5 ? Math.max(2, Math.round(0.03 * tamam.length)) : 1;
  const baslik = baslikAnaliz.analiz(havuzL, minKanal);
  for (const l of Object.values(baslik.kaliplar || {})) l.sort((a, b) => b.kanal - a.kanal || baslikAnaliz.siraKarsilastir(a, b)); // nişte ortak kalıp önce
  const ortak = ortakMatris(tamam, baslik);
  const patlayan = havuzL.filter(v => v.skor >= baslikAnaliz.PATLAMA);
  const kanalSay = new Sayac();
  for (const v of patlayan) kanalSay.ekle(v.kanal_id);
  for (const k of kanalOzet) k.patlayan = kanalSay.get(k.id) || 0;
  const vitrin = havuzL.filter(v => (v.izlenme || 0) >= 1000);
  const ad = p.ad || kanalOzet.slice(0, 3).map(k => k.ad).join(', ') + (kanalOzet.length > 3 ? ` +${kanalOzet.length - 3}` : '');
  return {
    tur: 'grup', surum: GRUP_SURUM, ad,
    nis: { sozluk: sozluk.slice(0, 60), konu_ici: havuzL.length, konu_disi: disi.length, min_kanal: minKanal,
      disi_ornek: [...disi].sort((a, b) => b.skor - a.skor).slice(0, 8).map(baslikAnaliz.ornek) },
    parametre: { ad: p.ad, detay_adet: p.detay_adet, yorum: p.yorum, kanallar: kanalOzet.map(k => k.url || k.id) },
    zaman: zamanDamgasi(),
    genel: { ad: p.ad || 'Kanal grubu', kanal: kanalOzet.length, video: havuzL.length, patlayan: patlayan.length,
      patlama_orani: havuzL.length ? Math.round(100 * patlayan.length / havuzL.length) : null,
      medyan_abone: med(kanalOzet.map(k => k.abone)), medyan_izlenme: med(kanalOzet.map(k => k.medyan)), aylik_yukleme: med(kanalOzet.map(k => k.aylik_yukleme)) },
    kanallar: kanalOzet, ortak, baslik,
    icerik: icerik(havuzL, tamam),
    kelime_kanal: kelimeTutarlilik(havuzL, kanalOzet.length),
    en_iyi: [...(vitrin.length ? vitrin : havuzL)].sort((a, b) => b.skor - a.skor).slice(0, 30).map(v => sec(v, VIDEO_ALANLARI)),
    videolar: [...tumUzun].sort((a, b) => (b.zaman || 0) - (a.zaman || 0)).map(v => sec(v, [...VIDEO_ALANLARI, 'konu_ici'])),
    istatistik: { kanal: kanalOzet.length, video: havuzL.length },
  };
}

/** Başlık kelimesi kanal kanal: kelimeyi taşıyan videolar o kanalın diğer videolarından daha mı çok izleniyor? */
function kelimeTutarlilik(havuzL, kanalN) {
  const kanalVid = new Map(), kelime = new Map(), kume = new Map();
  for (const v of havuzL) {
    const k = new Set(kelimeler(v.baslik).filter(w => [...w].length >= 3 && w !== 'N' && !DURAKLAR.has(w) && !DOLGU.has(w)));
    kume.set(v, k);
    if (!kanalVid.has(v.kanal_id)) kanalVid.set(v.kanal_id, []);
    kanalVid.get(v.kanal_id).push(v);
    for (const w of k) { if (!kelime.has(w)) kelime.set(w, []); kelime.get(w).push(v); }
  }
  const minVideo = kanalN >= 50 ? 20 : 8;
  const minOlcu = Math.max(3, Math.min(10, Math.round(0.05 * kanalN)));
  const tavan = Math.max(0.3, 1.5 / Math.max(1, kanalN)); // bir kanalın kelimenin videolarındaki en fazla payı
  const l = [];
  for (const [w, vs] of kelime) {
    const say = new Sayac();
    for (const v of vs) say.ekle(v.kanal_id);
    if (vs.length < minVideo || say.size < minOlcu || Math.max(...say.values()) > tavan * vs.length) continue;
    const oranlar = [];
    for (const kid of say.keys()) {
      const varL = kanalVid.get(kid).filter(v => kume.get(v).has(w)).map(v => v.skor);
      const yok = kanalVid.get(kid).filter(v => !kume.get(v).has(w)).map(v => v.skor);
      const my = yok.length >= 3 ? med(yok) : null;
      if (my) oranlar.push(med(varL) / my);
    }
    if (oranlar.length < minOlcu) continue;
    const yarar = oranlar.filter(o => o >= 1.1).length, zarar = oranlar.filter(o => o <= 0.9).length;
    const net = (yarar - zarar) / oranlar.length;
    if (Math.abs(net) < 0.4) continue;
    const ornek = [], gorulen = new Set();
    for (const v of [...vs].sort((a, b) => b.skor - a.skor)) { // farklı kanallardan örnek
      if (!gorulen.has(v.kanal_id) && (v.izlenme || 0) >= 500) { gorulen.add(v.kanal_id); ornek.push(baslikAnaliz.ornek(v)); }
      if (ornek.length === 2) break;
    }
    l.push({ kelime: w, video: vs.length, olculen: oranlar.length, yarar, zarar, net: yuvarla(net, 2), etki: yuvarla(med(oranlar), 2), ornekler: ornek });
  }
  const sira = (a, b) => Math.abs(b.net) - Math.abs(a.net) || b.olculen - a.olculen;
  return { artiran: l.filter(x => x.net > 0).sort(sira).slice(0, 16), azaltan: l.filter(x => x.net < 0).sort(sira).slice(0, 10) };
}

/** Etiket × kanal kaldıraç matrisi: bir özellik nişin genelinde mi işe yarıyor, yoksa tek kanalın şansı mı? */
function ortakMatris(tamam, baslik) {
  const nis = new Map((baslik.etiketler || []).map(e => [e.ad, e]));
  const satirlar = [];
  for (const [grup, ad, aciklama] of [...baslikAnaliz.ETIKETLER, ...baslikAnaliz.YAPILAR]) {
    const hucreler = [], olculen = [];
    let yarar = 0, zarar = 0, kullanan = 0;
    for (const [, d] of tamam) {
      const e = (d.baslik?.etiketler || []).find(x => x.ad === ad);
      if (e) {
        kullanan++;
        if (e.video >= 2 && e.kaldirac !== null && e.kaldirac !== undefined) {
          olculen.push(e.kaldirac);
          yarar += e.kaldirac >= 1.1; zarar += e.kaldirac <= 0.9;
        }
      }
      hucreler.push(e ? { video: e.video, kaldirac: e.kaldirac ?? null, guven: e.guven } : null);
    }
    if (!kullanan) continue;
    const n = nis.get(ad) || {};
    satirlar.push({ grup, ad, aciklama, hucreler, kullanan, olculen: olculen.length, yarar, zarar, medyan_kaldirac: med(olculen),
      nis_kaldirac: n.kaldirac ?? null, nis_video: n.video ?? null, nis_isabet: n.isabet ?? null, ornekler: (n.ornekler || []).slice(0, 4) });
  }
  satirlar.sort((a, b) => (b.yarar - b.zarar) - (a.yarar - a.zarar) || (b.nis_kaldirac || 0) - (a.nis_kaldirac || 0));
  return { kanallar: tamam.map(([, d]) => d.genel.ad), satirlar };
}

function icerik(havuzL, tamam) {
  const dilimler = SURE_DILIMLERI.map(([ad, a, b]) => {
    const l = havuzL.filter(v => v.sure !== null && v.sure !== undefined && a <= v.sure && v.sure < b);
    return { ad, video: l.length, kat: med(l.map(v => v.skor)), isabet: l.length ? Math.round(100 * l.filter(v => v.skor >= 2).length / l.length) : null,
      kanal: new Set(l.map(v => v.kanal_id)).size };
  });
  const etiketKanal = new Map(), etiketVideo = new Sayac();
  for (const [, d] of tamam) {
    for (const v of d.videolar) {
      for (const t of new Set((v.etiketler || []).map(x => x.toLowerCase()))) {
        if (!etiketKanal.has(t)) etiketKanal.set(t, new Set());
        etiketKanal.get(t).add(d.genel.id);
        etiketVideo.ekle(t);
      }
    }
  }
  const etiketler = [...etiketKanal].filter(([, k]) => k.size >= 2).map(([t, k]) => [t, k.size, etiketVideo.get(t)]).sort((a, b) => b[1] - a[1] || b[2] - a[2]);
  return { sure: dilimler, gun: kanal.gunSaat(havuzL).gun_skor,
    etiketler: etiketler.slice(0, 40).map(([etiket, k, video]) => ({ etiket, kanal: k, video })),
    format: tamam.map(([, d]) => ({ ad: d.genel.ad, uzun: d.genel.uzun, shorts: d.genel.shorts, canli: d.genel.canli,
      medyan_uzun: d.genel.medyan, medyan_shorts: d.genel.medyan_shorts })) };
}

// ---------------------------------------------------------------- kayıt
export function kaydet(sonuc) {
  sonuc.kayitli = false; // "Raporu kaydet" ile Kayıtlar'a girer
  const ad = `grup-${dosyaDamgasi()}.json`;
  fs.writeFileSync(path.join(DOSYA.gruplar, ad), JSON.stringify(sonuc), 'utf8');
  for (const k of sonuc.kanallar) uyeIsaretle(k.dosya, 'grup'); // üye analizler tek kanal listesinde görünmesin
  return ad;
}

function uyeIsaretle(dosya, deger) {
  try {
    const y = kanal.yol(dosya), d = JSON.parse(fs.readFileSync(y, 'utf8'));
    if (d.kayitli !== true) { d.kayitli = deger; fs.writeFileSync(y, JSON.stringify(d), 'utf8'); } // tek başına kaydedilmiş analize dokunma
  } catch { /* üye dosyası yok */ }
}

function yol(dosya) {
  if (!/^grup-[\d-]+\.json$/.test(dosya || '')) { const h = new Error('dosya yok'); h.kod = 404; throw h; }
  const y = path.join(DOSYA.gruplar, dosya);
  if (!fs.existsSync(y)) { const h = new Error('dosya yok'); h.kod = 404; throw h; }
  return y;
}

export const kayit = (dosya, kayitli) => motor.kayitIsaretle(yol(dosya), kayitli);

export function gecmis() {
  const liste = [];
  for (const f of fs.readdirSync(DOSYA.gruplar).filter(f => /^grup-.*\.json$/.test(f)).sort().reverse()) {
    try {
      const y = path.join(DOSYA.gruplar, f), d = JSON.parse(fs.readFileSync(y, 'utf8'));
      if (motor.gecmisteMi(y, d)) liste.push({ dosya: f, zaman: d.zaman, ad: d.ad, kanal: d.genel.kanal });
      else if (!fs.existsSync(y)) for (const k of d.kanallar) uyeIsaretle(k.dosya, false); // süresi dolup silindi → üyeleri serbest bırak
    } catch { /* bozuk dosya */ }
  }
  return liste;
}

export function yukle(dosya) {
  let d = JSON.parse(fs.readFileSync(yol(dosya), 'utf8'));
  if ((d.surum || 1) < GRUP_SURUM) d = yenidenHesapla(dosya, d);
  d.bulgular = bulgular(d);
  return d;
}

function yenidenHesapla(dosya, eski) {
  const tamam = [];
  for (const k of eski.kanallar) { try { tamam.push([k.dosya, kanal.yukle(k.dosya)]); } catch { /* üye yok */ } }
  if (tamam.length < 2) return eski;
  const yeni = birlestir(tamam, { ...VARSAYILAN, ad: eski.parametre?.ad || '', detay_adet: eski.parametre?.detay_adet ?? 30, yorum: !!eski.parametre?.yorum });
  for (const k of ['ad', 'zaman', 'hatalar', 'kayitli']) if (k in eski) yeni[k] = eski[k];
  yeni.genel.ad = yeni.ad;
  if (eski.istatistik?.sure_sn) yeni.istatistik.sure_sn = eski.istatistik.sure_sn;
  if (eski.baslik?.gemini) yeni.baslik.gemini = eski.baslik.gemini;
  fs.writeFileSync(yol(dosya), JSON.stringify(yeni), 'utf8');
  return yeni;
}

// ---------------------------------------------------------------- sade özet (Özet sekmesi ve raporun başı)
function dilimBulgu(l, adAlani, katAlani, sayiAlani, toplam, ne) {
  l = l.filter(x => x[katAlani] !== null && x[katAlani] !== undefined && (x[sayiAlani] || 0) >= Math.max(20, 0.04 * toplam));
  if (l.length < 2) return null;
  const iyi = l.reduce((m, x) => (x[katAlani] > m[katAlani] ? x : m)), kotu = l.reduce((m, x) => (x[katAlani] < m[katAlani] ? x : m));
  if (iyi[katAlani] / Math.max(kotu[katAlani], 0.01) < 1.1) {
    return { ton: 'notr', metin: `${ne} belirgin bir fark yaratmıyor.`,
      alt: `En iyi dilim (${iyi[adAlani]}) ile en zayıfı (${kotu[adAlani]}) arasında %10'dan az fark var. Buna göre karar verme.` };
  }
  return { ton: 'iyi', metin: `${ne}: en iyi sonuç ${iyi[adAlani]}.`,
    alt: `${iyi[adAlani]} videolar kanalının normalinin ${kat(iyi[katAlani])} izleniyor; en zayıf dilim ${kotu[adAlani]} ` +
      `(${kat(kotu[katAlani])}). Aradaki fark ${fark(iyi[katAlani] / kotu[katAlani]).replace(' daha fazla', '')}.` };
}

export function bulgular(d) {
  const g = d.genel, b = d.baslik || {}, o = d.ortak || {}, nis = d.nis || {};
  if (b.yetersiz) return { giris: [], bolumler: [] };
  const kanalN = g.kanal;
  const giris = [`${kanalN} kanalın ${sayiYaz(g.video)} videosu incelendi.`];
  if (nis.konu_disi) giris.push(`Konu dışı ${sayiYaz(nis.konu_disi)} video (araba, yemek, oyun gibi) analizden çıkarıldı.`);
  if (g.patlama_orani !== null && g.patlama_orani !== undefined) {
    giris.push(`Bu nişte her 100 videodan ${g.patlama_orani} tanesi kendi kanalının normal izlenmesinin 2 katını geçiyor; ` +
      'aşağıdaki bulgular bu “tutan” videoların başlıklarını tutmayanlarla karşılaştırır.');
  }
  const bolumler = [];
  const esik = Math.max(3, Math.round(0.1 * kanalN));
  const satir = (o.satirlar || []).filter(x => x.olculen >= esik && x.medyan_kaldirac);
  const madde = (x, ton) => ({ ton, metin: `${x.ad} — ${kucukBas(x.aciklama)}`,
    alt: `Bu tarz başlıklar kanalın normalinden ${fark(x.medyan_kaldirac)} izleniyor. ` +
      `Ölçülebilen ${x.olculen} kanaldan ${x.yarar} kanalda işe yarıyor, ${x.zarar} kanalda ters etki yapıyor.`,
    ornekler: ton === 'iyi' ? (x.ornekler || []).slice(0, 3) : [] });
  const iyi = satir.filter(x => x.medyan_kaldirac >= 1.08 && x.yarar >= 1.5 * Math.max(1, x.zarar))
    .sort((a, c) => (c.yarar - c.zarar) / c.olculen - (a.yarar - a.zarar) / a.olculen || c.medyan_kaldirac - a.medyan_kaldirac).slice(0, 6);
  const kotu = satir.filter(x => x.medyan_kaldirac <= 0.95 && x.zarar > x.yarar).sort((a, c) => a.medyan_kaldirac - c.medyan_kaldirac).slice(0, 4);
  bolumler.push({ baslik: 'Başlıkta işe yarayan tarzlar', aciklama: 'Kanalların çoğunda tutarlı şekilde daha çok izlenen başlık tarzları. Tek kanalın şansı değil, nişin geneli.',
    maddeler: iyi.length ? iyi.map(x => madde(x, 'iyi')) : [{ ton: 'notr', metin: 'Kanalların çoğunda ortak işe yarayan bir başlık tarzı yok.' }] });
  if (kotu.length) bolumler.push({ baslik: 'Kaçınılacak tarzlar', aciklama: 'Kanalların çoğunda bu tarz başlıklı videolar normalin altında kalıyor.', maddeler: kotu.map(x => madde(x, 'kotu')) });

  const mk = nis.min_kanal || 2;
  const adaylar = (b.kaliplar?.genel || []).filter(x => x.kanal >= Math.max(mk, 3) && (x.kaldirac || 0) >= 1.3 && x.video >= 4 &&
    x.kalip.split(' ').some(w => [...w].length >= 3 && w !== 'N'));
  const secilen = [];
  for (const x of [...adaylar].sort((a, c) => c.kanal - a.kanal || c.kaldirac - a.kaldirac)) {
    if (!secilen.some(y => x.kalip.includes(y.kalip) || y.kalip.includes(x.kalip))) secilen.push(x);
  }
  if (secilen.length) {
    bolumler.push({ baslik: 'Birden çok kanalda tutan ifadeler', aciklama: 'Başlıkta geçtiğinde videoyu yukarı taşıyan kelime grupları. Kendi başlığında kullanmak için en somut ipuçları.',
      maddeler: secilen.slice(0, 8).map(x => ({ ton: 'iyi', metin: '“' + x.kalip.split(' ').map(w => (w === 'N' ? '[sayı]' : w)).join(' ') + '”',
        alt: `${x.kanal} kanalda ${x.video} videoda geçiyor; bu videolar kanalının normalinin ${kat(x.kat_var)} izlenmiş.`, ornekler: (x.ornekler || []).slice(0, 2) })) });
  }
  const kk = d.kelime_kanal || {};
  const cip = (x, ton) => ({ kelime: x.kelime, ton, metin: `${ton === 'iyi' ? x.yarar : x.zarar} / ${x.olculen} kanalda ${ton === 'iyi' ? 'daha çok' : 'daha az'} izleniyor`, ornekler: x.ornekler || [] });
  if (kk.artiran?.length || kk.azaltan?.length) {
    bolumler.push({ baslik: 'Başlıkta geçen kelimeler: hangi konular daha çok izleniyor?',
      aciklama: 'Her kelime her kanalda ayrı ölçüldü: bu kelimeyi içeren videolar, aynı kanalın diğer videolarından daha mı çok izleniyor? ' +
        'Yalnızca çok kanalda geçen ve kanalların çoğunda aynı sonucu veren kelimeler listelendi. ' +
        'Ör. “55 / 59 kanalda daha çok” = bu kelimeyi kullanan 59 kanalın 55 tanesinde o videolar kanalın diğer videolarından daha çok izlenmiş.',
      kelimeler: (kk.artiran || []).map(x => cip(x, 'iyi')), kelimeler_az: (kk.azaltan || []).map(x => cip(x, 'kotu')) });
  }
  const pratik = [];
  const u = b.uzunluk?.karakter || [];
  let x = dilimBulgu(u.map(y => ({ ...y, ad: y.ad.replace(' karakter', '') + ' karakterlik başlıklı' })), 'ad', 'kat', 'video', b.n || 0, 'Başlık uzunluğu');
  if (x) { const pm = b.uzunluk?.patlayan_medyan; if (pm) x.alt += ` Tutan videoların başlıkları ortalama ${pm} karakter.`; pratik.push(x); }
  x = dilimBulgu((d.icerik?.sure || []).map(y => ({ ...y, ad: y.ad + ' süren' })), 'ad', 'kat', 'video', g.video, 'Video süresi');
  if (x) pratik.push(x);
  const GUN = { Pzt: 'Pazartesi', Sal: 'Salı', 'Çar': 'Çarşamba', Per: 'Perşembe', Cum: 'Cuma', Cmt: 'Cumartesi', Paz: 'Pazar' };
  const gun = (d.icerik?.gun || []).map(y => ({ ...y, ad: (GUN[y.gun] || y.gun) + ' yüklenen' }));
  x = dilimBulgu(gun, 'ad', 'medyan_skor', 'adet', gun.reduce((t, y) => t + (y.adet || 0), 0), 'Yükleme günü');
  if (x) pratik.push(x);
  if (pratik.length) bolumler.push({ baslik: 'Uzunluk, süre ve gün', aciklama: 'Başlık uzunluğu, video süresi ve yükleme gününe göre izlenme.', maddeler: pratik });
  bolumler.push({ baslik: 'Nişte en çok tutan videolar', aciklama: 'Kendi kanalının normaline göre en çok izlenenler (en az 1.000 izlenme). ' +
    'Başlıklarını incele: yukarıdaki tarzların gerçek örnekleri.', videolar: (d.en_iyi || []).slice(0, 12) });
  return { giris, bolumler };
}

/** Yapay zekâ için dengeli örnek: her kanaldan eşit sayıda en yeni olgun video. */
function yapayZekaVerisi(d, adet = 160) {
  const kanallar = new Map();
  for (const v of d.videolar) {
    if ((v.yas_gun || 0) >= 7 && v.skor !== null && v.skor !== undefined) { if (!kanallar.has(v.kanal_id)) kanallar.set(v.kanal_id, []); kanallar.get(v.kanal_id).push(v); }
  }
  const pay = Math.max(5, Math.floor(adet / Math.max(1, kanallar.size)));
  return { genel: { ad: `${d.ad} (niş: ${kanallar.size} kanal)` }, videolar: [...kanallar.values()].flatMap(l => l.slice(0, pay)), baslik: d.baslik };
}

export async function baslikGemini(p, ilerleme = () => {}) {
  const d = yukle(p.dosya);
  ilerleme('gemini', 10, `${d.ad}: ${d.genel.kanal} kanalın başlıkları yapay zekâya gönderildi. Yanıt birkaç dakika sürebilir, sayfadan ayrılma`);
  d.baslik.gemini = await baslikAnaliz.geminiAnaliz(yapayZekaVerisi(d));
  delete d.bulgular;
  fs.writeFileSync(yol(p.dosya), JSON.stringify(d), 'utf8');
  return p.dosya;
}

export const baslikUret = (dosya, konu, adet = 10) => baslikAnaliz.baslikUret(yapayZekaVerisi(yukle(dosya)), konu, adet);

// ---------------------------------------------------------------- Markdown rapor
export function raporMd(d) {
  const g = d.genel, n = sayiYaz, t = x => (x || '').replace(/\|/g, '/');
  const bl = d.bulgular || bulgular(d);
  let s = [`# ${d.ad} — kanal karşılaştırma`, '', `*${d.zaman} · ${g.kanal} kanal · ${n(g.video)} video*`, '', bl.giris.join(' '), '', '## 1. Özet: bu nişte ne işe yarıyor?'];
  for (const b of bl.bolumler) {
    s.push('', `### ${b.baslik}`, '', b.aciklama || '', '');
    for (const m of b.maddeler || []) {
      s.push(`- ${m.ton === 'iyi' ? '✅' : m.ton === 'kotu' ? '❌' : '➖'} **${m.metin}** ${m.alt || ''}`);
      s = s.concat((m.ornekler || []).slice(0, 2).map(o => `  - [${t(o.baslik)}](${o.link}) — ${o.kanal || ''}, normalinin ${kat(o.skor)}`));
    }
    if (b.kelimeler?.length) s.push('', '**Daha çok izlenen:** ' + b.kelimeler.map(x => `${x.kelime} (${x.metin.replace(' izleniyor', '')})`).join(', '));
    if (b.kelimeler_az?.length) s.push('', '**Daha az izlenen:** ' + b.kelimeler_az.map(x => `${x.kelime} (${x.metin.replace(' izleniyor', '')})`).join(', '));
    s = s.concat((b.videolar || []).map((v, i) => `${i + 1}. [${t(v.baslik)}](${v.link}) — ${v.kanal} · ${n(v.izlenme)} izlenme · normalinin ${kat(v.skor)}`));
  }
  s.push('', '## 2. Başlık tarzları kanal kanal', '',
    'Her kanal kendi içinde ölçüldü. *İşe yarıyor*: o tarzdaki başlıklar kanalın diğer videolarından en az %10 fazla izleniyor; ' +
    '*ters*: en az %10 az. *Etkisi*: kanallardaki etkinin ortancası.', '',
    '| Başlık tarzı | Ne demek | Ölçülen kanal | İşe yarıyor | Ters etki | Etkisi |', '|---|---|---|---|---|---|');
  for (const r of d.ortak.satirlar) s.push(`| ${t(r.ad)} | ${t(r.aciklama)} | ${r.olculen} | ${r.yarar} | ${r.zarar} | ${r.medyan_kaldirac ? fark(r.medyan_kaldirac) : '–'} |`);
  s.push('', '## 3. Ayrıntılı başlık analizi (tüm kanalların videoları tek havuzda)', '',
    'Terimler: **kat** = videonun izlenmesi ÷ kanalının normal izlenmesi; **kaldıraç** = özelliği taşıyan videoların ortanca katı ÷ taşımayanların ' +
    '(1,3 = %30 daha fazla); **isabet** = taşıyanların yüzde kaçı normalin 2 katını geçti.');
  s = s.concat(kanal.baslikMd(d.baslik).slice(3));
  s.push('', '## 4. Kanallar', '', '| Kanal | Abone | Normal izlenme | Tutan video oranı | Ayda video | En güçlü başlık tarzı |', '|---|---|---|---|---|---|');
  s = s.concat([...d.kanallar].sort((a, b) => (b.abone || 0) - (a.abone || 0)).map(c =>
    `| [${t(c.ad)}](${c.url}) | ${n(c.abone)} | ${n(c.medyan)} | %${c.patlama_orani ?? '–'} | ${c.aylik_yukleme ?? '–'} | ${c.en_guclu.slice(0, 2).map(e => e.ad).join(', ') || '–'} |`));
  s.push('', '## 5. Video süresi', '', '| Süre | Video | Kanal | Normalin kaç katı (ortanca) | Tutan oranı |', '|---|---|---|---|---|');
  s = s.concat(d.icerik.sure.map(x => `| ${x.ad} | ${n(x.video)} | ${x.kanal} | ${x.kat ? kat(x.kat) : '–'} | ${x.isabet !== null ? '%' + x.isabet : '–'} |`));
  s.push('', '**Ortak YouTube etiketleri** (en az 2 kanal; parantezde kanal sayısı): ' + d.icerik.etiketler.slice(0, 25).map(e => `${e.etiket} (${e.kanal})`).join(', '));
  const nis = d.nis || {};
  if (nis.konu_disi) {
    s.push('', '## Konu dışı sayılan videolar', '', `Başlığında nişin ortak kelimelerinden (${nis.sozluk.slice(0, 25).join(', ')}…) hiçbiri geçmeyen ${n(nis.konu_disi)} video analize katılmadı. En çok izlenenleri:`, '');
    s = s.concat(nis.disi_ornek.map(o => `- ${t(o.baslik)} — ${o.kanal || ''}`));
  }
  if (d.hatalar?.length) s = s.concat(['', '## Analiz edilemeyen kanallar', ''], d.hatalar.map(h => `- ${h.kanal}: ${h.hata}`));
  return s.join('\n') + '\n';
}
