// Metin yardımcıları: Python sürümündeki (motor.py) kurallarla birebir aynı davranmak için.
// JavaScript'te \w ve \b yalnızca İngilizce harfleri tanır; Türkçe başlıklarda "kelime sınırı" bozulmasın diye
// desenler `ure()` ile Unicode'a çevrilir.

const H = '\\p{L}\\p{N}_';
/** Python'un Unicode \w / \b davranışı: \w → harf+rakam+_, \b → Unicode kelime sınırı. */
export function ure(desen, bayrak = '') {
  let cikti = '', sinif = false;
  for (let i = 0; i < desen.length; i++) {
    const c = desen[i];
    if (c === '\\' && i + 1 < desen.length) {
      const n = desen[i + 1];
      if (n === 'w') cikti += sinif ? H : `[${H}]`;
      else if (n === 'W') cikti += sinif ? '\\P{L}' : `[^${H}]`;
      else if (n === 'b' && !sinif) cikti += `(?:(?<=[${H}])(?![${H}])|(?<![${H}])(?=[${H}]))`;
      else cikti += c + n;
      i++;
      continue;
    }
    if (c === '[' && !sinif) sinif = true;
    else if (c === ']' && sinif) sinif = false;
    cikti += c;
  }
  return new RegExp(cikti, bayrak.includes('u') ? bayrak : bayrak + 'u');
}

export const DURAKLAR = new Set(`a an the of in on at to for and or but is are was were be been with by from as it its this that
these those you your i my me we our they their he she his her what why how who when where which vs v
into than then so if not no do does did can will just about over under up down out all any
bir ve ile için bu şu o de da mi mı mu mü ne neden nasıl gibi kadar daha en çok her`.split(/\s+/));

const TR_HARF = /[ğüşöçıİĞÜŞÖÇ]/;
/** Türkçeye duyarlı küçük harf: 'LEPİSTES BAKIMI' → 'lepistes bakımı'. */
export function kucuk(metin) {
  metin = metin || '';
  if (TR_HARF.test(metin)) metin = metin.replace(/I/g, 'ı').replace(/İ/g, 'i');
  return metin.toLowerCase().replace(/̇/g, '');
}

const KELIME = ure("[\\w']+", 'g');
const RAKAM = /^\p{Nd}+$/u;
/** Başlığın kelimeleri; salt rakamlar "N" olur. */
export function kelimeler(baslik) {
  return (kucuk(baslik).replace(/’/g, "'").match(KELIME) || []).map(w => (RAKAM.test(w) ? 'N' : w));
}

export const bosluk = m => (m || '').replace(/\s+/g, ' ').trim();

export const ARAMA_DILLERI = { tr: 'Türkçe', en: 'İngilizce', de: 'Almanca', fr: 'Fransızca', es: 'İspanyolca', pt: 'Portekizce' };
export const SURE_DILIMLERI = [['< 4 dk', 0, 240], ['4–8 dk', 240, 480], ['8–20 dk', 480, 1200], ['20–60 dk', 1200, 3600], ['60+ dk', 3600, 1e9]];

/** Sorguların tüm çevirilerindeki anlamlı kelimelerin kökleri (egyptian→egyp, mythology→myth). */
export function konuKokleri(ceviriler) {
  const kokler = new Set();
  for (const c of Object.values(ceviriler || {})) {
    for (const q of Object.values(c)) {
      for (const w of kelimeler(q)) {
        const n = [...w].length;
        if (w !== 'N' && !DURAKLAR.has(w) && n >= 3) kokler.add(n >= 5 ? [...w].slice(0, 4).join('') : w);
      }
    }
  }
  return kokler;
}

/** Python statistics.median ile aynı (çift sayıda ortadaki ikisinin ortalaması). */
export function medyan(l) {
  const s = l.filter(x => x !== null && x !== undefined && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const o = s.length >> 1;
  return s.length % 2 ? s[o] : (s[o - 1] + s[o]) / 2;
}

/** round(x, n) */
export const yuvarla = (x, n = 0) => (x === null || x === undefined ? null : Math.round(x * 10 ** n) / 10 ** n);

/** Counter: Map tabanlı sayaç (ekleme sırası korunur, Python Counter gibi). */
export class Sayac extends Map {
  ekle(k, n = 1) { this.set(k, (this.get(k) || 0) + n); return this; }
  enCok(n = Infinity) { return [...this.entries()].sort((a, b) => b[1] - a[1]).slice(0, n); }
  nesne() { return Object.fromEntries(this); }
}

/** "121,377 views", "1.2M views", "87.7K subscribers", "228" → sayı. */
export function sayiOku(metin) {
  if (metin === null || metin === undefined) return null;
  if (typeof metin === 'number') return metin;
  const s = String(metin?.text ?? metin).trim();
  if (!s || /^no\b/i.test(s)) return /^no\b/i.test(s) ? 0 : null;
  const m = s.match(/([\d.,]+)\s*([KMB])?\b/i);
  if (!m) return null;
  if (m[2]) {
    const k = { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase()];
    return Math.round(parseFloat(m[1].replace(/,/g, '')) * k);
  }
  return parseInt(m[1].replace(/[.,]/g, ''), 10);
}

/** Eş zamanlı iş sınırı (ThreadPoolExecutor karşılığı). Sıra korunur. */
export async function havuz(liste, adet, is_) {
  const sonuc = new Array(liste.length);
  let i = 0;
  const isci = async () => {
    while (i < liste.length) {
      const j = i++;
      sonuc[j] = await is_(liste[j], j);
    }
  };
  await Promise.all(Array.from({ length: Math.min(adet, liste.length) }, isci));
  return sonuc;
}

export const simdiSn = () => Date.now() / 1000;

/** "2026-11-24 14:05" (yerel saat) — Python datetime.now().strftime("%Y-%m-%d %H:%M") */
export function zamanDamgasi(t = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

/** "20261124-140512" — dosya adları için */
export function dosyaDamgasi(t = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`;
}

export function slug(metin, varsayilan = 'tarama') {
  return (kucuk(metin).replace(ure('[^\\w]+', 'g'), '-').replace(/^-+|-+$/g, '').slice(0, 50)) || varsayilan;
}
