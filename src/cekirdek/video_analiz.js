// Viral videolar analizi (video_analiz.py): patlayanlar aynı aramadaki tüm adaylarla aynı ölçüyle karşılaştırılır;
// bir ifade/kelime ancak birden çok kanalda tekrar ediyorsa nişin bulgusudur. Konu dışı videolar yapay zekâyla elenir.
import { Onbellek } from './onbellek.js';
import { aiUret } from './hesaplar.js';
import * as baslikAnaliz from './baslik_analiz.js';
import { ARAMA_DILLERI, SURE_DILIMLERI, havuz as esZamanli, konuKokleri, kucuk, medyan, Sayac, yuvarla } from './metin.js';
import { DOLGU, fark, kat, kucukBas } from './ortak.js';

const KARARLAR = new Onbellek('video_ilgi', 24 * 7); // konu + video → {ilgili, puan, neden}
const PAKET = 25;
const MIN_KANAL = 3;
const ABONE_DILIM = [['1 bin altı', 0, 1e3], ['1–10 bin', 1e3, 1e4], ['10–100 bin', 1e4, 1e5], ['100 bin – 1 milyon', 1e5, 1e6], ['1 milyon üstü', 1e6, 1e12]];
const SUPHELI = new Set(['olu_abone', 'az_video', 'asiri_vsr', 'dusuk_begeni']);
export const HAVUZ_ALANLARI = ['id', 'baslik', 'skor', 'izlenme', 'sure', 'kanal_id', 'kanal', 'abone', 'konu', 'diller', 'link'];

// ---------------------------------------------------------------- yapay zekâ ile konu kontrolü
/** {video_id: {ilgili, puan, neden}}. Hesap yoksa HesapYok fırlatır. */
export async function videoIlgi(videolar, sorgular, alt = [], ilerleme = () => {}) {
  const imza = sorgular.map(kucuk).sort().join('|');
  const sonuc = {};
  for (const v of videolar) { const k = KARARLAR.al(`${imza}:${v.id}`); if (k) sonuc[v.id] = k; }
  const sorulacak = videolar.filter(v => !sonuc[v.id]);
  if (Object.keys(sonuc).length) ilerleme('ilgi', null, `${Object.keys(sonuc).length} videonun konu kararı önbellekten; ${sorulacak.length} video yapay zekâya soruluyor`);
  let bitti = 0;
  const sor = async paket => {
    const liste = paket.map(v => ({ id: v.id, baslik: v.baslik || '', kanal: v.kanal || '', etiketler: (v.etiketler || []).slice(0, 8), aciklama: (v.aciklama || '').slice(0, 160) }));
    const istem = `Araştırılan konu: ${sorgular.join(', ')}` + (alt.length ? `; alt konuları da dahil: ${alt.join(', ')}` : '') + '.\n' +
      'Aşağıdaki YouTube videolarının HER BİRİ için, videonun bu konuyla (veya alt konularıyla) gerçekten ilgili olup olmadığına karar ver. ' +
      'Başlığa, kanal adına, etiketlere ve açıklamaya birlikte bak; başlıkta konu kelimesi geçmese de içerik konudaysa ilgilidir ' +
      "(ör. akvaryum konusunda 'Kuhli Loach Care Guide', 'betta bakımı', 'karides üretimi' ilgilidir).\n" +
      "İlgisiz say: aynı kelimeyi başka anlamda kullananlar (burç 'Kova/Acuario', marka, şarkı, çizgi film, oyun), " +
      'konuyu yalnızca arka plan/rahatlama/uyku sesi olarak kullananlar, konuyla bağı olmayan genel videolar.\n' +
      'puan: 0-100 (100 = tam bu konu). neden: en fazla 10 kelimelik Türkçe gerekçe. Emin değilsen ilgili=true, puan düşük.\n' +
      'Yalnızca JSON döndür: {"videolar": [{"id": "...", "ilgili": true, "puan": 80, "neden": "..."}]}\n\n' + JSON.stringify(liste);
    const [yanit, kaynak] = await aiUret(istem, 0);
    for (const k of (Array.isArray(yanit) ? yanit : yanit?.videolar) || []) {
      if (k && typeof k === 'object' && k.id) {
        const karar = { ilgili: !!k.ilgili, puan: parseInt(k.puan || 0, 10) || 0, neden: String(k.neden || '').slice(0, 120) };
        sonuc[k.id] = karar;
        KARARLAR.koy(`${imza}:${k.id}`, { ...karar });
      }
    }
    bitti += paket.length;
    ilerleme('ilgi', null, `Konu kontrolü: ${bitti}/${sorulacak.length} (${kaynak})`);
  };
  const paketler = [];
  for (let i = 0; i < sorulacak.length; i += PAKET) paketler.push(sorulacak.slice(i, i + PAKET));
  try { await esZamanli(paketler, 8, sor); }
  finally { KARARLAR.kaydet(); }
  return sonuc;
}

// ---------------------------------------------------------------- analiz
const med = l => { const m = medyan(l); return m === null ? null : yuvarla(m, 2); };

function oranTablosu(gruplar, esik, sira = null) {
  const girdiler = sira === null ? [...gruplar] : sira.map(a => [a, gruplar.get(a) || []]);
  return girdiler.map(([ad, l]) => {
    const pat = l.filter(v => v._p ?? v.skor >= esik);
    return { ad, aday: l.length, patlayan: pat.length, oran: l.length ? Math.round(100 * pat.length / l.length) : null,
      kat: med(l.map(v => v.skor)), kanal: new Set(pat.map(v => v.kanal_id)).size,
      ornekler: [...pat].sort((a, b) => b.skor - a.skor).slice(0, 2).map(baslikAnaliz.ornek) };
  });
}

const grupla = (liste, anahtar) => {
  const m = new Map();
  for (const v of liste) for (const k of [].concat(anahtar(v) ?? [])) { if (!m.has(k)) m.set(k, []); m.get(k).push(v); }
  return m;
};

/** secilen: son elemeden geçen patlayanlar; havuz: aynı aramadaki kat değeri hesaplanmış tüm adaylar. */
export function analiz(secilen, havuz, p) {
  const esik = p.min_skor || 3;
  havuz = havuz.filter(v => v.skor !== null && v.skor !== undefined && v.baslik);
  if (havuz.length < 20 || secilen.length < 3) return { yetersiz: true, n: havuz.length, patlayan: secilen.length };
  const patId = new Set(secilen.map(v => v.id));
  for (const v of havuz) v._p = patId.has(v.id);
  const baslik = baslikAnaliz.analiz(havuz, MIN_KANAL);
  const konular = grupla(havuz, v => v.konu || '?');
  const abone = grupla(havuz.filter(v => v.abone !== null && v.abone !== undefined), v => ABONE_DILIM.find(([, x, y]) => x <= v.abone && v.abone < y)[0]);
  const sure = grupla(havuz.filter(v => v.sure !== null && v.sure !== undefined), v => SURE_DILIMLERI.find(([, x, y]) => x <= v.sure && v.sure < y)?.[0] ?? []);
  const diller = grupla(havuz, v => (v.diller || []).map(d => ARAMA_DILLERI[d] || d));
  const kanalSay = new Sayac();
  for (const v of secilen) kanalSay.ekle(v.kanal_id);
  const tekrar = kanalSay.enCok().filter(([, c]) => c >= 2).slice(0, 20).map(([k, c]) => {
    const v = secilen.find(x => x.kanal_id === k);
    return { kanal: v.kanal, kanal_id: k, adet: c, abone: v.abone ?? null };
  });
  const temiz = secilen.filter(v => !(v.bayraklar || []).some(b => SUPHELI.has(b.kod)));
  const a = {
    surum: 1, n: havuz.length, patlayan: secilen.length, esik,
    oran: Math.round(100 * secilen.length / havuz.length),
    kanal: new Set(havuz.map(v => v.kanal_id)).size,
    baslik,
    konular: oranTablosu(konular, esik).sort((x, y) => (y.oran || 0) - (x.oran || 0)),
    abone: oranTablosu(abone, esik, ABONE_DILIM.map(x => x[0])),
    sure: oranTablosu(sure, esik, SURE_DILIMLERI.map(x => x[0])),
    diller: oranTablosu(diller, esik).sort((x, y) => (y.oran || 0) - (x.oran || 0)),
    tekrar_eden_kanallar: tekrar,
    // vitrin: ölü abone / az videolu / şişirilmiş kanalların uç katları listeyi doldurmasın
    en_iyi: [...(temiz.length ? temiz : secilen)].sort((x, y) => y.skor - x.skor).slice(0, 12)
      .map(v => ({ ...baslikAnaliz.ornek(v), kapak: v.kapak ?? null, sure: v.sure ?? null, zaman: null })),
  };
  for (const v of havuz) delete v._p;
  a.bulgular = bulgular(a, p);
  return a;
}

// ---------------------------------------------------------------- sade özet
function tabloBulgu(l, genel, ne, minAday) {
  l = l.filter(x => x.aday >= minAday && x.oran !== null);
  if (l.length < 2) return [];
  return [...l].sort((a, b) => b.oran - a.oran).map(x => {
    const ton = x.oran >= genel * 1.3 && x.patlayan >= 3 ? 'iyi' : x.oran <= genel * 0.7 ? 'kotu' : 'notr';
    return { ton, metin: `${ne(x.ad)}: her 100 videodan ${x.oran} tanesi patlamış`,
      alt: `${x.aday} video tarandı, ${x.patlayan} tanesi patladı (${x.kanal} farklı kanal). Genel ortalama 100'de ${genel}.`,
      ornekler: ton === 'iyi' ? x.ornekler : [] };
  });
}

export function bulgular(a, p) {
  const b = a.baslik, genel = a.oran;
  const giris = [`Bu aramada ${a.kanal} kanaldan ${a.n} video tarandı; ${a.patlayan} tanesi kendi kanalının normal izlenmesinin ` +
    `en az ${kat(a.esik).replace(' katı', '')} katını yaptı (her 100 videodan ${genel}).`,
  'Aşağıdaki bulgular patlayanları, aynı aramadaki diğer videolarla karşılaştırır; tek kanalın şansı sayılmasın diye ' +
    `her tarz, ifade ve kelimenin en az ${MIN_KANAL} farklı kanalda geçmesi gerekir.`];
  const bolumler = [];
  const konu = tabloBulgu(a.konular, genel, ad => `“${ad}”`, 15);
  if (konu.length) bolumler.push({ baslik: 'Hangi konular daha çok patlıyor?', aciklama: 'Aranan konu ve alt konulara göre patlama oranı. ' +
    'Oranı yüksek alt konu, küçük kanalın bile tutturabildiği konu demektir.', maddeler: konu });

  if (!b.yetersiz) {
    const et = b.etiketler.filter(e => e.kanal >= MIN_KANAL && e.video >= 8 && e.kaldirac);
    const guc = e => (Math.min(e.kaldirac, 3) - 1) * Math.sqrt(e.video); // küçük örneklem büyük kaldıraç üretir
    const iyi = et.filter(e => e.kaldirac >= 1.15).sort((x, y) => guc(y) - guc(x)).slice(0, 6);
    const kotu = et.filter(e => e.kaldirac <= 0.87).sort((x, y) => x.kaldirac - y.kaldirac).slice(0, 4);
    const madde = (e, ton) => ({ ton, metin: `${e.ad} — ${kucukBas(e.aciklama)}`,
      alt: `Bu tarz başlıklı videolar kanalının normalinden ${fark(e.kaldirac)} izlenmiş (${e.video} video, ${e.kanal} kanal). Bu tarzda normalin 2 katını geçme oranı %${e.isabet}.`,
      ornekler: ton === 'iyi' ? (e.ornekler || []).slice(0, 3) : [] });
    bolumler.push({ baslik: 'Başlıkta işe yarayan tarzlar', aciklama: 'Taranan tüm videolarda, bu tarzı kullananlar kullanmayanlardan daha çok izlenmiş.',
      maddeler: iyi.length ? iyi.map(e => madde(e, 'iyi')) : [{ ton: 'notr', metin: 'Belirgin şekilde öne çıkan bir başlık tarzı yok.' }] });
    if (kotu.length) bolumler.push({ baslik: 'Kaçınılacak tarzlar', aciklama: 'Bu tarz başlıklı videolar normalin altında kalmış.', maddeler: kotu.map(e => madde(e, 'kotu')) });

    const kal = (b.kaliplar.genel || []).filter(x => x.kanal >= MIN_KANAL && (x.kaldirac || 0) >= 1.3 && x.video >= 4 &&
      x.kalip.split(' ').some(w => [...w].length >= 3 && w !== 'N'));
    const secilen = [];
    for (const x of [...kal].sort((m, n) => n.kanal - m.kanal || n.kaldirac - m.kaldirac)) {
      if (!secilen.some(y => x.kalip.includes(y.kalip) || y.kalip.includes(x.kalip))) secilen.push(x);
    }
    if (secilen.length) bolumler.push({ baslik: 'Patlayan başlıklarda tekrar eden ifadeler', aciklama: 'Birden çok kanalda geçen ve geçtiği videoları yukarı taşıyan kelime grupları.',
      maddeler: secilen.slice(0, 8).map(x => ({ ton: 'iyi', metin: '“' + x.kalip.split(' ').map(w => (w === 'N' ? '[sayı]' : w)).join(' ') + '”',
        alt: `${x.kanal} kanalda ${x.video} videoda geçiyor; bu videolar kanalının normalinin ${kat(x.kat_var)} izlenmiş.`, ornekler: (x.ornekler || []).slice(0, 2) })) });

    // aranan konu/alt konu kelimeleri zaten her başlıkta: bulgu değil
    const kokler = [...konuKokleri({ ...(p.ceviriler || {}), ...(p.genisleme_ceviriler || {}) })];
    const uygun = x => !x.konu && !DOLGU.has(x.kelime) && x.kanal >= MIN_KANAL + 1 && x.video >= 8 && !kokler.some(k => x.kelime.startsWith(k));
    const cip = (x, ton) => ({ kelime: x.kelime, ton, ornekler: x.ornekler || [], metin: `${fark(x.kaldirac)} · ${x.kanal} kanal · ${x.video} video` });
    const art = b.kelimeler.guclendiren.filter(uygun).slice(0, 14).map(x => cip(x, 'iyi'));
    const az = b.kelimeler.zayiflatan.filter(uygun).slice(0, 10).map(x => cip(x, 'kotu'));
    if (art.length || az.length) bolumler.push({ baslik: 'Başlıkta geçen kelimeler', aciklama: 'Geçtiği videoların daha çok / daha az izlendiği kelimeler ' +
      `(aranan konu kelimeleri ve dolgu kelimeler hariç; en az ${MIN_KANAL + 1} kanal, 8 video).`, kelimeler: art, kelimeler_az: az });
  }

  let pratik = [];
  for (const [tablo, ne, enAz] of [[a.sure, ad => `${ad} süren videolar`, 15], [a.abone, ad => `${ad} aboneli kanallar`, 15]]) {
    const m = tabloBulgu(tablo, genel, ne, enAz).filter(x => x.ton !== 'notr');
    pratik = pratik.concat(m.slice(0, 1), m.slice(1).filter(x => x.ton === 'kotu').slice(-1));
  }
  if (a.diller.length > 1) pratik = pratik.concat(tabloBulgu(a.diller, genel, ad => `${ad} aramalar`, 20).filter(x => x.ton !== 'notr').slice(0, 2));
  if (pratik.length) bolumler.push({ baslik: 'Süre, kanal büyüklüğü ve dil', aciklama: 'Patlama oranının en yüksek ve en düşük olduğu gruplar.', maddeler: pratik });
  bolumler.push({ baslik: 'En çok patlayan videolar', aciklama: 'Kanalının normaline göre en çok izlenenler. Başlıklarını yukarıdaki bulgularla birlikte incele.', videolar: a.en_iyi });
  return { giris, bolumler };
}

// ---------------------------------------------------------------- yapay zekâ derin analizi + başlık üretici
function yzVerisi(d, adet = 160) {
  const h = (d.havuz || []).filter(v => v.skor !== null && v.skor !== undefined);
  const pat = [...d.sonuclar].sort((a, b) => b.skor - a.skor).slice(0, adet / 2);
  const ids = new Set(pat.map(v => v.id));
  const diger = h.filter(v => !ids.has(v.id));
  // Python random.Random(1).shuffle ile aynı tohum: yeniden üretilebilir karıştırma
  let tohum = 1;
  const rast = () => ((tohum = (tohum * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = diger.length - 1; i > 0; i--) { const j = Math.floor(rast() * (i + 1)); [diger[i], diger[j]] = [diger[j], diger[i]]; }
  const secim = [...pat, ...diger.slice(0, adet - pat.length)].map(v => ({ ...v, yas_gun: 30 })); // olgunluk süzgecinden geçsin
  return { genel: { ad: `${d.parametre.sorgular.join(', ')} (YouTube araması: ${secim.length} video, farklı kanallar)` },
    videolar: secim, baslik: d.analiz?.baslik };
}

export const baslikGemini = d => baslikAnaliz.geminiAnaliz(yzVerisi(d));
export const baslikUret = (d, konu, adet = 10) => baslikAnaliz.baslikUret(yzVerisi(d), konu, adet);
