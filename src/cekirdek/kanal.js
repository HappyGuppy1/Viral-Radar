// Kanal analizi (kanal.py): bir kanalın herkese açık verisinden tam analiz (anahtarsız).
// Akış:
//   1) envanter  : uzun videolar (yaklaşık tarihle), Shorts, canlı yayınlar → izlenme, süre
//   2) hakkında  : abone, toplam izlenme, video sayısı, katılım tarihi, ülke, açıklama, bağlantılar
//   3) skor      : her uzun video için kanal normaline göre kat (komşu ±10 videonun medyanı, kendisi hariç)
//   4) ayrıntı   : son N uzun video → kesin tarih, beğeni, yorum, etiket, bölüm, açıklama, ısı haritası
//   5) yorumlar  : en çok patlayan 5 videonun en beğenilen yorumları (isteğe bağlı)
//   6) analiz    : genel bakış, gidişat, gün×saat, başlık desenleri, içerik, izleyici, büyüme
import fs from 'node:fs';
import path from 'node:path';
import { Onbellek } from './onbellek.js';
import * as yt from './youtube.js';
import * as baslikAnaliz from './baslik_analiz.js';
import * as motor from './motor.js';
import { DOSYA } from './yollar.js';
import { havuz, medyan, Sayac, simdiSn, SURE_DILIMLERI, ure, yuvarla, zamanDamgasi, dosyaDamgasi } from './metin.js';

export const AYRINTILAR = new Onbellek('kanal_videolar', 12);
const GUNLER = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const EN_ESKI_GUN = 5 * 365; // analizler yalnızca son 5 yılın videolarına bakar
export const VARSAYILAN = { kanal: '', detay_adet: 60, yorum: true };

const SPONSOR = ure(String.raw`\b(sponsor\w*|use code|promo code|discount code|partnered|indirim kodu|iş birliği)\b`, 'i');
const AFFILIATE = /(amzn\.to|amazon\.[a-z.]+\/|affiliate|[?&]ref=|[?&]via=|geni\.us|bit\.ly)/i;
const BULTEN = /(newsletter|substack|beehiiv|kit\.com|convertkit|mailchimp|bülten)/i;
const URL_ALAN = /https?:\/\/(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})/gi;

// Türkiye saati (UTC+3): gün×saat ve aylar buna göre
const trTarih = sn => new Date((sn + 3 * 3600) * 1000);
const trHaftaGunu = sn => (trTarih(sn).getUTCDay() + 6) % 7; // Pzt = 0
const trSaat = sn => trTarih(sn).getUTCHours();
const trAy = sn => trTarih(sn).toISOString().slice(0, 7);
const trGun = sn => trTarih(sn).toISOString().slice(0, 10);

/** Liste yeniden eskiye sıralı: 5 yıldan eski ilk videoda kes (tarihi bilinmeyenler aradaysa kalır). */
function sonYillar(videolar) {
  const sinir = simdiSn() - EN_ESKI_GUN * 86400;
  const i = videolar.findIndex(v => v.zaman && v.zaman < sinir);
  return i >= 0 ? videolar.slice(0, i) : videolar;
}

// ---------------------------------------------------------------- video ayrıntısı
export async function videoAyrinti(videoId) {
  const v = AYRINTILAR.al(videoId);
  if (v) return v;
  let d;
  try {
    const b = await yt.videoBilgisi(videoId);
    d = { baslik: b.baslik, zaman: b.zaman, izlenme: b.izlenme, begeni: b.begeni, yorum: b.yorum, sure: b.sure,
      etiketler: b.etiketler_tum, kategori: b.kategori, bolum: b.bolum, aciklama: b.aciklama_tam, canli: b.canli, isi: b.isi };
  } catch (h) { return { hata: String(h.message).slice(0, 150) }; }
  AYRINTILAR.koy(videoId, d);
  return d;
}

// ---------------------------------------------------------------- yardımcı hesaplar
/** Kanal büyüdükçe normal değişir: her video, yayın sırasına göre ±pencere komşusunun medyanıyla kıyaslanır. */
function komsuSkor(videolar, pencere = 10) {
  videolar.forEach((v, i) => {
    const komsu = videolar.slice(Math.max(0, i - pencere), i + pencere + 1).filter(w => w !== v && w.izlenme !== null && w.izlenme !== undefined).map(w => w.izlenme);
    v.normal = medyan(komsu);
    v.skor = v.izlenme !== null && v.izlenme !== undefined && v.normal ? yuvarla(v.izlenme / v.normal, 2) : null;
  });
}

function gunSaat(videolar) {
  const tablo = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const gunSkor = Array.from({ length: 7 }, () => []);
  for (const v of videolar) {
    if (v.kesin_tarih && v.zaman) {
      tablo[trHaftaGunu(v.zaman)][trSaat(v.zaman)] += 1;
      if (v.skor !== null && v.skor !== undefined) gunSkor[trHaftaGunu(v.zaman)].push(v.skor);
    }
  }
  return { tablo, gun_skor: GUNLER.map((gun, g) => ({ gun, adet: gunSkor[g].length, medyan_skor: gunSkor[g].length ? yuvarla(medyan(gunSkor[g]), 2) : null })) };
}

function gidisat(videolar) {
  const aylar = new Map();
  for (const v of videolar) if (v.zaman) { const a = trAy(v.zaman); if (!aylar.has(a)) aylar.set(a, []); aylar.get(a).push(v); }
  return [...aylar].sort((a, b) => a[0].localeCompare(b[0])).map(([ay, l]) => ({
    ay, adet: l.length, medyan: medyan(l.map(v => v.izlenme)), en_iyi: l.reduce((m, v) => ((v.izlenme || 0) > (m.izlenme || 0) ? v : m)).baslik }));
}

function isiOrtalama(videolar, nokta = 50) {
  const egriler = [];
  for (const v of videolar) { const isi = v.isi || []; if (isi.length >= 10) egriler.push(Array.from({ length: nokta }, (_, i) => isi[Math.floor(i * isi.length / nokta)])); }
  if (!egriler.length) return null;
  const ort = Array.from({ length: nokta }, (_, i) => yuvarla(egriler.reduce((t, e) => t + e[i], 0) / egriler.length, 3));
  const zirveler = [];
  for (const v of videolar) {
    const isi = v.isi || [];
    if (isi.length >= 10 && v.sure) {
      const bas = Math.max(1, Math.floor(isi.length / 20)); // ilk %5 (giriş) hariç en yoğun an
      let j = bas;
      for (let k = bas; k < isi.length; k++) if (isi[k] > isi[j]) j = k;
      zirveler.push({ id: v.id, baslik: v.baslik, yuzde: Math.round(100 * j / isi.length), saniye: Math.trunc(v.sure * j / isi.length), skor: v.skor ?? null });
    }
  }
  return { ortalama: ort, video: egriler.length, zirveler };
}

// ---------------------------------------------------------------- ana akış
export async function analiz(parametre, ilerleme = () => {}, iptal = { iptal: false }) {
  const p = { ...VARSAYILAN, ...parametre };
  const kontrol = () => { if (iptal.iptal) throw new motor.Iptal(); };
  const basla = Date.now();
  ilerleme('envanter', 2, `Kanal çözülüyor: ${p.kanal}`);
  const kid = await yt.kanalCoz(p.kanal);
  const url = `https://www.youtube.com/channel/${kid}`;
  ilerleme('envanter', 4, `Kanal okunuyor: ${url}`);
  const kesim = simdiSn() - EN_ESKI_GUN * 86400;
  const bilgi = await yt.kanalTumSekme(kid, 'videos', 2000, kesim);
  if (!bilgi.ad) throw new Error("Kanal bulunamadı. Linki veya @handle'ı kontrol et.");
  kontrol();
  const shorts = await yt.kanalTumSekme(kid, 'shorts', 300, kesim);
  const canli = await yt.kanalTumSekme(kid, 'streams', 200, kesim);
  ilerleme('hakkinda', 12, `${bilgi.videolar.length} uzun video, ${shorts.videolar.length} Shorts, ${canli.videolar.length} canlı yayın. Hakkında sayfası okunuyor`);
  let hk = {};
  try { hk = await yt.kanalHakkinda(kid); } catch { hk = {}; }

  const kayit = (e, tur) => ({ id: e.id, baslik: e.baslik || '', izlenme: e.izlenme ?? null, sure: e.sure ?? null, zaman: e.zaman ?? null, tur,
    kanal_id: kid, kanal: bilgi.ad || '' }); // desen motoru bu alanları bekliyor
  const uzunV = sonYillar(bilgi.videolar.map(e => kayit(e, 'uzun')));
  const shortsV = sonYillar(shorts.videolar.map(e => kayit(e, 'shorts')));
  const canliV = sonYillar(canli.videolar.map(e => kayit(e, 'canli')));
  komsuSkor(uzunV); // yeni → eski sırada

  // ayrıntı: son N uzun video
  const hedef = uzunV.slice(0, p.detay_adet);
  ilerleme('ayrinti', 15, `Son ${hedef.length} videonun ayrıntısı çekiliyor (beğeni, etiket, ısı haritası)`);
  let i = 0;
  await havuz(hedef, 3, async v => {
    if (iptal.iptal) return;
    const d = await videoAyrinti(v.id);
    if (!('hata' in d)) {
      for (const k of ['begeni', 'yorum', 'etiketler', 'kategori', 'bolum', 'aciklama', 'canli', 'isi']) v[k] = d[k] ?? null;
      if (d.zaman) { v.zaman = d.zaman; v.kesin_tarih = true; }
      if (d.izlenme) v.izlenme = d.izlenme;
      if (d.baslik) v.baslik = d.baslik;
      v.ayrinti = true;
    }
    i++;
    ilerleme('ayrinti', 15 + 65 * i / Math.max(1, hedef.length), `Ayrıntılar: ${i}/${hedef.length}`);
  });
  kontrol();
  AYRINTILAR.kaydet();
  komsuSkor(uzunV); // izlenmeler güncellendi
  const simdi = simdiSn();
  for (const v of uzunV) {
    v.yas_gun = v.zaman ? yuvarla((simdi - v.zaman) / 86400, 1) : null;
    v.kapak = `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`;
    v.link = `https://www.youtube.com/watch?v=${v.id}`;
    if (v.begeni !== null && v.begeni !== undefined && v.izlenme) v.etkilesim = yuvarla(100 * v.begeni / v.izlenme, 2);
    v.baslik_ozellik = baslikAnaliz.ozellikler(v.baslik);
  }

  // yorumlar: kanal içinde en çok patlayan 5 ayrıntılı video
  const yorumBloklari = [];
  if (p.yorum) {
    const aday = uzunV.filter(v => v.ayrinti && v.skor).sort((a, b) => b.skor - a.skor).slice(0, 5);
    for (let k = 0; k < aday.length; k++) {
      kontrol();
      ilerleme('yorum', 80 + 15 * (k + 1) / Math.max(1, aday.length), `Yorumlar: ${k + 1}/${aday.length}`);
      yorumBloklari.push({ id: aday[k].id, baslik: aday[k].baslik, skor: aday[k].skor, yorumlar: await yt.yorumlar(aday[k].id) });
    }
  }
  ilerleme('analiz', 96, 'Analiz hesaplanıyor');
  const sonuc = hesapla(p, url, kid, bilgi, hk, uzunV, shortsV, canliV, yorumBloklari);
  sonuc.istatistik = { sure_sn: yuvarla((Date.now() - basla) / 1000, 1), ayrinti: uzunV.filter(v => v.ayrinti).length };
  return kaydet(sonuc);
}

function katilimTarihi(metin) {
  const t = Date.parse(String(metin || '').replace(/^Joined\s+/i, ''));
  return Number.isNaN(t) ? null : new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function hesapla(p, url, kid, bilgi, hk, uzunV, shortsV, canliV, yorumBloklari) {
  const simdi = simdiSn();
  const olgun = uzunV.filter(v => (v.yas_gun || 0) >= 7); // en yeni videolar henüz izlenme topluyor
  const izl = uzunV.map(v => v.izlenme).filter(x => x !== null && x !== undefined);
  const zamanlar = uzunV.map(v => v.zaman).filter(Boolean).sort((a, b) => b - a);
  const araliklar = zamanlar.slice(0, 21).map((a, k) => (k + 1 < Math.min(21, zamanlar.length) ? (a - zamanlar[k + 1]) / 86400 : null)).filter(x => x !== null);
  const son90 = zamanlar.filter(z => simdi - z <= 90 * 86400).length;
  const ayrintili = uzunV.filter(v => v.ayrinti);
  const genel = {
    ad: bilgi.ad, id: kid, handle: bilgi.handle, url, abone: bilgi.abone ?? hk.abone ?? null,
    abone_metni: bilgi.abone !== null && bilgi.abone !== undefined ? `${bilgi.abone.toLocaleString('en-US')} subscribers` : null,
    toplam_izlenme: hk.toplam_izlenme ?? null, video_sayisi: hk.video_sayisi ?? bilgi.video_sayisi ?? null,
    uzun: uzunV.length, shorts: shortsV.length, canli: canliV.length,
    katilim: katilimTarihi(hk.katilim), ulke: hk.ulke || '', aciklama: hk.aciklama_tam || bilgi.aciklama || '', linkler: hk.linkler || [],
    medyan: medyan(izl), ortalama: izl.length ? Math.round(izl.reduce((a, b) => a + b, 0) / izl.length) : null,
    medyan_son10: medyan(olgun.slice(0, 10).map(v => v.izlenme)),
    medyan_shorts: medyan(shortsV.map(v => v.izlenme)), medyan_canli: medyan(canliV.map(v => v.izlenme)),
    son_yukleme_gun: zamanlar.length ? Math.round((simdi - zamanlar[0]) / 86400) : null,
    aylik_yukleme: yuvarla(son90 / 3, 1), ortalama_aralik_gun: araliklar.length ? yuvarla(medyan(araliklar), 1) : null,
    medyan_etkilesim: medyan(ayrintili.map(v => v.etkilesim)),
    outlier_orani: olgun.length ? yuvarla(100 * olgun.filter(v => (v.skor || 0) >= 2).length / olgun.length, 1) : null,
    avatar: bilgi.avatar || null,
  };
  const baslik = baslikAnaliz.analiz(olgun);
  const dilimler = SURE_DILIMLERI.map(([ad, a, b]) => {
    const l = olgun.filter(v => v.sure !== null && v.sure !== undefined && a <= v.sure && v.sure < b);
    return { ad, adet: l.length, medyan_skor: l.length ? yuvarla(medyan(l.map(v => v.skor)) || 0, 2) : null, medyan_izlenme: medyan(l.map(v => v.izlenme)) };
  });
  const etiket = new Sayac(), alanlar = new Sayac(), kategori = new Sayac();
  for (const v of ayrintili) {
    for (const t of new Set((v.etiketler || []).map(x => x.toLowerCase()))) etiket.ekle(t);
    for (const d of new Set([...(v.aciklama || '').matchAll(URL_ALAN)].map(m => m[1].toLowerCase()))) alanlar.ekle(d);
    if (v.kategori) kategori.ekle(v.kategori);
  }
  const icerik = {
    sure: dilimler,
    format: [{ ad: 'Uzun video', adet: uzunV.length, medyan: genel.medyan }, { ad: 'Shorts', adet: shortsV.length, medyan: genel.medyan_shorts },
      { ad: 'Canlı yayın', adet: canliV.length, medyan: genel.medyan_canli }],
    etiketler: etiket.enCok(30).map(([etiketAd, adet]) => ({ etiket: etiketAd, adet })),
    etiketsiz: ayrintili.filter(v => !(v.etiketler || []).length).length,
    bolum_orani: ayrintili.length ? Math.round(100 * ayrintili.filter(v => v.bolum).length / ayrintili.length) : null,
    sponsor: ayrintili.filter(v => SPONSOR.test(v.aciklama || '')).length,
    affiliate: ayrintili.filter(v => AFFILIATE.test(v.aciklama || '')).length,
    bulten: ayrintili.filter(v => BULTEN.test(v.aciklama || '')).length,
    alan_adlari: alanlar.enCok(12).map(([alan, adet]) => ({ alan, adet })),
    kategori: kategori.enCok(3),
    ayrintili: ayrintili.length,
  };
  const skorlu = olgun.filter(v => v.skor);
  return {
    parametre: p, zaman: zamanDamgasi(), genel, videolar: uzunV, shorts: shortsV.slice(0, 60), canli: canliV.slice(0, 30),
    en_iyi: [...skorlu].sort((a, b) => b.skor - a.skor).slice(0, 10), en_kotu: [...skorlu].sort((a, b) => a.skor - b.skor).slice(0, 5),
    gidisat: gidisat(uzunV), gun_saat: gunSaat(uzunV), baslik, icerik,
    izleyici: { isi: isiOrtalama(ayrintili), yorumlar: yorumBloklari },
  };
}

// ---------------------------------------------------------------- kayıt + büyüme
export function kaydet(sonuc) {
  const g = sonuc.genel, klasor = path.join(DOSYA.kanallar, g.id);
  fs.mkdirSync(klasor, { recursive: true });
  const anlikYol = path.join(klasor, 'anliklar.json');
  const anliklar = fs.existsSync(anlikYol) ? JSON.parse(fs.readFileSync(anlikYol, 'utf8')) : [];
  anliklar.push({ zaman: sonuc.zaman, abone: g.abone, toplam_izlenme: g.toplam_izlenme, video_sayisi: g.video_sayisi, uzun: g.uzun, shorts: g.shorts });
  fs.writeFileSync(anlikYol, JSON.stringify(anliklar, null, 1), 'utf8');
  sonuc.buyume = buyume(anliklar);
  const ad = `analiz-${dosyaDamgasi()}.json`;
  sonuc.kayitli = false; // "Raporu kaydet" ile Kayıtlar'a girer
  fs.writeFileSync(path.join(klasor, ad), JSON.stringify(sonuc), 'utf8');
  return `${g.id}/${ad}`;
}

function buyume(anliklar) {
  if (anliklar.length < 2) return { anliklar, not: 'İlk kayıt. Kanalı ileride tekrar analiz ettikçe büyüme burada birikir.' };
  const ilk = anliklar[0], son = anliklar.at(-1);
  const zaman = z => Date.parse(z.replace(' ', 'T'));
  const gun = Math.max(1e-9, (zaman(son.zaman) - zaman(ilk.zaman)) / 86400000);
  const fark = k => (son[k] !== null && son[k] !== undefined && ilk[k] !== null && ilk[k] !== undefined ? (son[k] || 0) - (ilk[k] || 0) : null);
  return { anliklar, gun: yuvarla(gun, 1), abone_farki: fark('abone'), izlenme_farki: fark('toplam_izlenme'), video_farki: fark('video_sayisi'),
    gunluk_abone: fark('abone') !== null && gun >= 1 ? Math.round(fark('abone') / gun) : null,
    gunluk_izlenme: fark('toplam_izlenme') !== null && gun >= 1 ? Math.round(fark('toplam_izlenme') / gun) : null };
}

export function gecmis() {
  const liste = [];
  if (!fs.existsSync(DOSYA.kanallar)) return liste;
  const dosyalar = [];
  for (const k of fs.readdirSync(DOSYA.kanallar)) {
    const kl = path.join(DOSYA.kanallar, k);
    if (!fs.statSync(kl).isDirectory()) continue;
    for (const f of fs.readdirSync(kl).filter(f => /^analiz-.*\.json$/.test(f))) dosyalar.push([path.join(kl, f), `${k}/${f}`]);
  }
  dosyalar.sort((a, b) => fs.statSync(b[0]).mtimeMs - fs.statSync(a[0]).mtimeMs);
  for (const [yolu, ad] of dosyalar) {
    try {
      const d = JSON.parse(fs.readFileSync(yolu, 'utf8'));
      if (!motor.gecmisteMi(yolu, d)) continue;
      liste.push({ dosya: ad, zaman: d.zaman, ad: d.genel.ad, abone: d.genel.abone, video: d.genel.uzun });
    } catch { /* bozuk dosya */ }
  }
  return liste;
}

function yol(dosya) {
  if (!/^UC[\w-]{22}\/analiz-[\d-]+\.json$/.test(dosya || '')) { const h = new Error('dosya yok'); h.kod = 404; throw h; }
  const y = path.join(DOSYA.kanallar, dosya);
  if (!fs.existsSync(y)) { const h = new Error('dosya yok'); h.kod = 404; throw h; }
  return y;
}

export const kayit = (dosya, kayitli) => motor.kayitIsaretle(yol(dosya), kayitli);

export function yukle(dosya) {
  const y = yol(dosya), d = JSON.parse(fs.readFileSync(y, 'utf8'));
  if (d.baslik?.surum !== baslikAnaliz.SURUM) { // eski analiz: başlık bölümünü kayıtlı videolardan yeniden hesapla
    d.baslik = baslikAnaliz.analiz(d.videolar.filter(v => (v.yas_gun || 0) >= 7));
    fs.writeFileSync(y, JSON.stringify(d), 'utf8');
  }
  return d;
}

/** Başlık sekmesindeki yapay zekâ derin analizi (sunucu işi); sonucu analiz dosyasına kaydeder. */
export async function baslikGemini(p, ilerleme = () => {}) {
  const d = yukle(p.dosya);
  ilerleme('gemini', 10, `${d.genel.ad}: başlıklar yapay zekâya gönderildi (formül, alt konu, tetikleyici). EVREN ile 2–5 dk sürebilir`);
  d.baslik.gemini = await baslikAnaliz.geminiAnaliz(d);
  fs.writeFileSync(yol(p.dosya), JSON.stringify(d), 'utf8');
  return p.dosya;
}

// ---------------------------------------------------------------- Markdown rapor
function baslikMd(b) {
  if (b.yetersiz) return ['', '## Başlık analizi', '', `Yetersiz veri (${b.n} olgun video).`];
  const t = x => (x || '').replace(/\|/g, '/'), k = x => (x !== null && x !== undefined ? `${x}x` : '–');
  let s = ['', '## Başlık analizi', '',
    `${b.n} olgun video · ${b.patlayan} patlayan (%${b.patlama_orani}). Kaldıraç = özelliği taşıyan videoların medyan katı ÷ taşımayanların. ` +
    'Güven: ≥6 video güçlü, 3–5 orta, 2 zayıf.', '',
    '### Formül, tetikleyici ve yapı etiketleri', '', '| Grup | Etiket | Video | Kat (var/yok) | Kaldıraç | İsabet | Güven | En iyi örnek |',
    '|---|---|---|---|---|---|---|---|'];
  s = s.concat(b.etiketler.map(e => `| ${e.grup} | ${t(e.ad)} | ${e.video} | ${k(e.kat_var)} / ${k(e.kat_yok)} | ${e.kaldirac || '–'} | %${e.isabet} | ${e.guven} | ${t(e.ornekler[0].baslik)} (${k(e.ornekler[0].skor)}) |`));
  for (const [ad, anahtar] of [['Kalıplar', 'genel'], ['Başlangıç kalıpları', 'baslangic'], ['Bitiş kalıpları', 'bitis'], ['Ek / seri imzası', 'ek']]) {
    const l = b.kaliplar[anahtar];
    if (l.length) {
      s.push('', `### ${ad}`, '', '| Kalıp | Video | Kat | Kaldıraç | Örnek |', '|---|---|---|---|---|');
      s = s.concat(l.slice(0, 20).map(x => `| ${t(x.kalip)} | ${x.video} | ${k(x.kat_var)} | ${x.kaldirac || '–'} | ${t(x.ornekler[0].baslik)} |`));
    }
  }
  const kel = b.kelimeler;
  s.push('', '### Kelime etkisi', '', '- **Güçlendiren:** ' + (kel.guclendiren.slice(0, 15).map(x => `${x.kelime} (${x.kaldirac}, ${x.video})`).join(', ') || '—'),
    '- **Zayıflatan:** ' + (kel.zayiflatan.slice(0, 15).map(x => `${x.kelime} (${x.kaldirac}, ${x.video})`).join(', ') || '—'),
    '', '### Uzunluk', '', '| Karakter | Video | Medyan kat | İsabet |', '|---|---|---|---|');
  s = s.concat(b.uzunluk.karakter.map(x => `| ${x.ad} | ${x.video} | ${k(x.kat)} | ${x.isabet !== null ? '%' + x.isabet : '–'} |`));
  const g = b.gemini;
  if (g) {
    s.push('', '### Yapay zekâ derin analizi', '', g.ozet || '', '', '**Formüller**', '');
    s = s.concat(g.formuller.map(f => `- \`${f.sablon}\` — ${f.video} video, medyan ${k(f.kat_var)}. ${f.aciklama || ''}`));
    s = s.concat(['', '**Alt konular**', ''], g.alt_konular.map(a => `- ${a.ad}: ${a.video} video, medyan ${k(a.kat_var)}`));
    s = s.concat(['', '**Tetikleyiciler**', ''], g.tetikleyiciler.map(x => `- ${x.ad} (${k(x.kat_var)}): ${x.aciklama}`));
    s = s.concat(['', '**Kaçınılacaklar**', ''], g.kacinilacaklar.map(x => `- ${x.madde} (${k(x.kat_var)})`));
    s = s.concat(['', '**Kurallar**', ''], g.kurallar.map((r, i) => `${i + 1}. ${r}`));
  }
  return s;
}

export function raporMd(d) {
  const g = d.genel, b = d.baslik, ic = d.icerik;
  const n = x => (typeof x === 'number' ? Math.round(x).toLocaleString('tr-TR') : '–');
  let s = [`# Kanal Analizi — ${g.ad}`, '', `- **Link:** ${g.url} · **Analiz:** ${d.zaman}`,
    `- **Abone:** ${n(g.abone)} · **Toplam izlenme:** ${n(g.toplam_izlenme)} · **Video:** ${g.uzun} uzun / ${g.shorts} Shorts / ${g.canli} canlı`,
    `- **Katılım:** ${g.katilim || '–'} · **Ülke:** ${g.ulke || '–'}`,
    `- **Medyan izlenme:** ${n(g.medyan)} (son 10: ${n(g.medyan_son10)}) · **Ayda yükleme:** ${g.aylik_yukleme} · ` +
    `**Ortalama aralık:** ${g.ortalama_aralik_gun} gün · **Patlayan oranı (≥2x):** %${g.outlier_orani}`, '',
    '## En çok patlayan 10 video (kanal normaline göre)', '', '| Kat | İzlenme | Tarih | Başlık |', '|---|---|---|---|'];
  for (const v of d.en_iyi) s.push(`| ${v.skor}x | ${n(v.izlenme)} | ${v.zaman ? trGun(v.zaman) : '–'} | [${v.baslik.replace(/\|/g, '/')}](${v.link}) |`);
  s = s.concat(baslikMd(b));
  s.push('', '## İçerik', '', '| Süre | Video | Medyan kat |', '|---|---|---|');
  s = s.concat(ic.sure.map(x => `| ${x.ad} | ${x.adet} | ${x.medyan_skor !== null ? x.medyan_skor : '–'}x |`));
  s.push('', `- Bölüm (chapters) kullanımı: %${ic.bolum_orani} · Sponsor izi: ${ic.sponsor} · Affiliate: ${ic.affiliate} · Bülten/e-posta: ${ic.bulten} (ayrıntılı ${ic.ayrintili} videoda)`,
    '- En sık etiketler: ' + ic.etiketler.slice(0, 20).map(t => t.etiket).join(', '));
  const isi = d.izleyici.isi;
  if (isi) {
    s.push('', '## İzleyici', '', `- Isı haritası ${isi.video} videoda. Videolarda en yoğun tekrar izlenen an (giriş hariç):`);
    s = s.concat(isi.zirveler.slice(0, 10).map(z => `  - %${z.yuzde} (${Math.floor(z.saniye / 60)}:${String(z.saniye % 60).padStart(2, '0')}) · ${z.baslik}`));
  }
  for (const yb of d.izleyici.yorumlar) {
    s = s.concat(['', `**Yorumlar: ${yb.baslik}** (${yb.skor}x)`], yb.yorumlar.slice(0, 5).map(y => `- (${y.begeni} 👍) ${y.metin.slice(0, 200)}`));
  }
  return s.join('\n') + '\n';
}
