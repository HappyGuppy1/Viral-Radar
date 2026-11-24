// Sorgu çevirisi ("Tümü" dil): Google Translate'in anahtarsız uç noktası; 90 gün önbellekte.
import { Onbellek } from './onbellek.js';

const CEVIRILER = new Onbellek('ceviriler', 24 * 90);

/** [çeviri, algılanan_kaynak_dil] */
export async function cevir(metin, hedef) {
  const anahtar = `${hedef}:${metin.toLowerCase()}`;
  const v = CEVIRILER.al(anahtar);
  if (v) return [v.metin, v.kaynak];
  const u = 'https://translate.googleapis.com/translate_a/single?' + new URLSearchParams({ client: 'gtx', sl: 'auto', tl: hedef, dt: 't', q: metin });
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Çeviri HTTP ${r.status}`);
  const d = await r.json();
  const ceviri = d[0].map(p => p[0]).join('').trim(), kaynak = d[2];
  CEVIRILER.koy(anahtar, { metin: ceviri, kaynak });
  return [ceviri, kaynak];
}

/** {sorgu: {dil: arama_metni}}. Kullanıcının düzelttiği çeviriler (elle) önceliklidir; sorgunun kendi dili aynen kalır. */
export async function sorguCevirileri(sorgular, diller, elle = {}) {
  const sonuc = {};
  for (const s of sorgular) {
    sonuc[s] = {};
    for (const dil of diller) {
      if (elle?.[s]?.[dil]) { sonuc[s][dil] = elle[s][dil].trim(); continue; }
      try {
        const [c, kaynak] = await cevir(s, dil);
        sonuc[s][dil] = kaynak === dil ? s : c;
      } catch { sonuc[s][dil] = s; } // çeviri alınamazsa aynen ara
    }
  }
  CEVIRILER.kaydet();
  return sonuc;
}
