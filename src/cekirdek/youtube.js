// YouTube veri katmanı: masaüstü Python sürümünde yt-dlp'nin yaptığı işler, youtubei.js (YouTube'un iç API'si) ile.
// API anahtarı ve kota yok. Electron'da (ve ileride Capacitor'da) tarayıcı kısıtı (CORS) olmadığı için doğrudan çalışır.
import { Innertube, UniversalCache } from 'youtubei.js';
import { bosluk, sayiOku } from './metin.js';

// Arama dili (hl) başına bir istemci: YouTube sonuçları arayüz diline göre sıralar
const istemciler = new Map();
async function istemci(dil = 'en') {
  dil = dil || 'en';
  if (!istemciler.has(dil)) {
    istemciler.set(dil, Innertube.create({
      lang: dil, location: 'US', retrieve_player: true, generate_session_locally: true,
      cache: new UniversalCache(false),
    }).catch(h => { istemciler.delete(dil); throw h; }));
  }
  return istemciler.get(dil);
}

const metin = x => (x === null || x === undefined ? '' : typeof x === 'string' ? x : x.text ?? x.toString?.() ?? '');

// youtubei.js kendi ayrıştırıcı uyarılarını konsola basıyor; günlüğü kirletmesin
try {
  const { Log } = await import('youtubei.js');
  Log.setLevel(Log.Level.NONE);
} catch { /* eski sürüm */ }

// ---------------------------------------------------------------- 1) video araması
const SIRA = { alaka: 'relevance', puan: 'rating', tarih: 'upload_date', izlenme: 'view_count' };
const TARIH = { hepsi: 'all', saat: 'hour', bugun: 'today', hafta: 'week', ay: 'month', yil: 'year' };
const SURE = { hepsi: 'all', kisa: 'short', orta: 'medium', uzun: 'long' }; // kısa <4 dk, orta 4–20, uzun >20

/** Python motor.ara ile aynı alanlar: id, baslik, izlenme, sure, url, kanal, kanal_id, sorgu. */
export async function ara(sorgu, sira = 'izlenme', tarih = 'ay', sure = 'hepsi', adet = 80, dil = 'en') {
  const yt = await istemci(dil);
  const filtre = { type: 'video', sort_by: SIRA[sira] || 'relevance' };
  if (TARIH[tarih] && TARIH[tarih] !== 'all') filtre.upload_date = TARIH[tarih];
  if (SURE[sure] && SURE[sure] !== 'all') filtre.duration = SURE[sure];
  let s = await yt.search(sorgu, filtre);
  const sonuc = [], gorulen = new Set();
  for (let sayfa = 0; sayfa < 25; sayfa++) {
    for (const v of s.results || []) {
      if (sonuc.length >= adet) break;
      const id = v.video_id || v.id;
      const kanalId = v.author?.id;
      if (v.type !== 'Video' || !id || id.length !== 11 || !kanalId || !kanalId.startsWith('UC') || gorulen.has(id)) continue;
      gorulen.add(id);
      sonuc.push({
        id, baslik: metin(v.title), izlenme: sayiOku(metin(v.view_count)), sure: v.duration?.seconds ?? null,
        url: `https://www.youtube.com/watch?v=${id}`, kanal: v.author?.name || '', kanal_id: kanalId, sorgu,
      });
    }
    if (sonuc.length >= adet || !s.has_continuation) break;
    try { s = await s.getContinuation(); } catch { break; }
  }
  return sonuc;
}

// ---------------------------------------------------------------- 2) kanal sayfası
const BIRIM = { second: 1, minute: 60, hour: 3600, day: 86400, week: 7 * 86400, month: 30 * 86400, year: 365 * 86400 };
/** "2 weeks ago", "Streamed 3 days ago" → yaklaşık yayın zamanı (Unix sn). yt-dlp approximate_date ile aynı yaklaşım. */
export function goreceliZaman(metinIfade, simdi = Date.now() / 1000) {
  const m = String(metinIfade || '').match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/i);
  return m ? Math.round(simdi - Number(m[1]) * BIRIM[m[2].toLowerCase()]) : null;
}

function lockupVideo(n) {
  // Yeni kanal ızgarası (LockupView), eski (Video/GridVideo) ve Shorts (ShortsLockupView / ReelItem)
  if (n.type === 'LockupView') {
    const satirlar = n.metadata?.metadata?.metadata_rows || [];
    const parcalar = satirlar.flatMap(r => (r.metadata_parts || []).map(p => metin(p.text)));
    const rozet = (n.content_image?.overlays || []).flatMap(o => o.badges || []).map(b => b.text).find(t => /^\d+(:\d+)+$/.test(t || ''));
    return {
      id: n.content_id, baslik: metin(n.metadata?.title),
      izlenme: sayiOku(parcalar.find(p => /view/i.test(p))),
      yayin: parcalar.find(p => /ago|önce/i.test(p)) || null,
      zaman: goreceliZaman(parcalar.find(p => /ago/i.test(p))),
      sure: rozet ? rozet.split(':').reduce((a, x) => a * 60 + Number(x), 0) : null,
    };
  }
  if (n.type === 'ShortsLockupView') {
    const id = n.on_tap_endpoint?.payload?.videoId || n.entity_id?.replace(/^shorts-shelf-item-/, '');
    return { id, baslik: metin(n.overlay_metadata?.primary_text), izlenme: sayiOku(metin(n.overlay_metadata?.secondary_text)), yayin: null, sure: null };
  }
  if (n.type === 'ReelItem') return { id: n.id, baslik: metin(n.title), izlenme: sayiOku(metin(n.views)), yayin: null, sure: null };
  if (n.id && n.title) {
    return { id: n.video_id || n.id, baslik: metin(n.title), izlenme: sayiOku(metin(n.view_count) || metin(n.short_view_count)),
      yayin: metin(n.published) || null, zaman: goreceliZaman(metin(n.published)), sure: n.duration?.seconds ?? null };
  }
  return null;
}

const kanalNesneleri = new Map(); // kısa süreli: aynı taramada aynı kanalın ikinci sekmesi için
async function kanal(kanalId) {
  const yt = await istemci('en');
  if (!kanalNesneleri.has(kanalId)) {
    kanalNesneleri.set(kanalId, yt.getChannel(kanalId));
    setTimeout(() => kanalNesneleri.delete(kanalId), 10 * 60 * 1000).unref?.(); // süreci açık tutmasın
  }
  return kanalNesneleri.get(kanalId);
}

function kanalBasligi(k) {
  const satirlar = k.header?.content?.metadata?.metadata_rows || [];
  const parcalar = satirlar.flatMap(r => (r.metadata_parts || []).map(p => metin(p.text)));
  return {
    ad: k.metadata?.title || '',
    abone: sayiOku(parcalar.find(p => /subscriber/i.test(p))),
    handle: parcalar.find(p => p.startsWith('@')) || null,
    video_sayisi: sayiOku(parcalar.find(p => /video/i.test(p))),
    avatar: (k.metadata?.avatar || []).sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || null,
    aciklama: (k.metadata?.description || '').slice(0, 600),
  };
}

/** Kanalın son N videosu (sekme: videos | shorts) + ad + abone. motor.kanal_profili ile aynı alanlar. */
export async function kanalSekmesi(kanalId, sekme = 'videos', n = 30) {
  const k = await kanal(kanalId);
  let sayfa = sekme === 'shorts' ? await k.getShorts() : await k.getVideos();
  const videolar = [], gorulen = new Set();
  for (let i = 0; i < 20 && videolar.length < n; i++) {
    for (const node of sayfa.videos || []) {
      const v = lockupVideo(node);
      if (v?.id && !gorulen.has(v.id)) { gorulen.add(v.id); videolar.push(v); }
      if (videolar.length >= n) break;
    }
    if (videolar.length >= n || !sayfa.has_continuation) break;
    try { sayfa = await sayfa.getContinuation(); } catch { break; }
  }
  return { ...kanalBasligi(k), videolar };
}

/** Kanal girdisi (@handle, kanal linki, UC… kimliği ya da video linki) → kanal kimliği. */
export async function kanalCoz(girdi) {
  let g = String(girdi || '').trim();
  if (!g) throw new Error('Kanal linki veya @handle gerekli');
  if (/^UC[\w-]{22}$/.test(g)) return g;
  const yt = await istemci('en');
  if (/^https?:\/\//.test(g) || g.includes('youtube.com') || g.includes('youtu.be')) {
    if (!g.startsWith('http')) g = 'https://' + g;
    const m = g.match(/youtube\.com\/channel\/(UC[\w-]{22})/);
    if (m) return m[1];
    const vid = g.match(/(?:v=|youtu\.be\/|shorts\/|live\/)([\w-]{11})/);
    if (vid) return (await yt.getBasicInfo(vid[1])).basic_info.channel_id; // video linki → kanalı
  } else {
    g = 'https://www.youtube.com/' + (g.startsWith('@') ? g : '@' + g);
  }
  const r = await yt.resolveURL(g);
  const id = r?.payload?.browseId;
  if (!id?.startsWith('UC')) throw new Error('Kanal bulunamadı. Linki veya @handle\'ı kontrol et.');
  return id;
}

/** Bir sekmenin tüm videoları (en fazla n; kesim verilirse o zamandan eski ilk videoda durur). sekme: videos | shorts | streams */
export async function kanalTumSekme(kanalId, sekme = 'videos', n = 2000, kesim = null) {
  const k = await kanal(kanalId);
  let sayfa;
  try { sayfa = sekme === 'shorts' ? await k.getShorts() : sekme === 'streams' ? await k.getLiveStreams() : await k.getVideos(); }
  catch { return { ...kanalBasligi(k), videolar: [] }; } // sekme yok
  const videolar = [], gorulen = new Set();
  for (let i = 0; i < 200 && videolar.length < n; i++) {
    let dur = false;
    for (const node of sayfa.videos || []) {
      const v = lockupVideo(node);
      if (!v?.id || gorulen.has(v.id)) continue;
      gorulen.add(v.id);
      videolar.push(v);
      if (kesim && v.zaman && v.zaman < kesim) { dur = true; break; }
      if (videolar.length >= n) break;
    }
    if (dur || videolar.length >= n || !sayfa.has_continuation) break;
    try { sayfa = await sayfa.getContinuation(); } catch { break; }
  }
  return { ...kanalBasligi(k), videolar };
}

/** En beğenilen yorumlar: kanal sahibinin ve sabitlenmiş yorumlar atlanır (genelde kendi reklamı). */
export async function yorumlar(videoId, adet = 20) {
  try {
    const yt = await istemci('en');
    const c = await yt.getComments(videoId, 'TOP_COMMENTS');
    return (c.contents || []).map(t => t.comment).filter(x => x && !x.author_is_channel_owner && !x.is_pinned)
      .slice(0, adet).map(x => ({ metin: metin(x.content).slice(0, 500), begeni: sayiOku(x.like_count) || 0 }));
  } catch { return []; }
}

/** Kanalın "Hakkında" bilgisi: ülke (İngilizce ad), katılım, toplam izlenme, açıklama. */
export async function kanalHakkinda(kanalId) {
  const k = await kanal(kanalId);
  const h = await k.getAbout();
  const m = h.metadata || h;
  return {
    ulke: m.country ? metin(m.country) : '',
    katilim: metin(m.joined_date).replace(/^Joined\s+/i, '') || null,
    toplam_izlenme: sayiOku(metin(m.view_count)),
    abone: sayiOku(metin(m.subscriber_count)),
    video_sayisi: sayiOku(metin(m.video_count)),
    aciklama: (metin(m.description) || '').slice(0, 600),
    aciklama_tam: metin(m.description) || '',
    linkler: (m.links || []).map(l => metin(l.link) || metin(l.title)).filter(Boolean).slice(0, 12),
  };
}

// ---------------------------------------------------------------- 3) video ayrıntısı
/** Video ayrıntısı: orijinal başlık, kesin yayın zamanı, beğeni, yorum, kategori, etiketler, açıklama, canlı mı. */
export async function videoBilgisi(videoId) {
  const yt = await istemci('en');
  const info = await yt.getInfo(videoId, { client: 'WEB' });
  const b = info.basic_info || {};
  const mf = info.page?.[0]?.microformat || {};
  const panel = (info.page?.[1]?.engagement_panels || []).find(p => /comment/i.test(metin(p?.header?.title)));
  const yayin = mf.publish_date || mf.upload_date;
  return {
    info,
    baslik: b.title || null,
    zaman: yayin ? Date.parse(yayin) / 1000 : null,
    begeni: b.like_count ?? null,
    yorum: panel ? sayiOku(metin(panel.header?.contextual_info)) : null,
    izlenme: b.view_count ?? null,
    sure: b.duration ?? null,
    kategori: mf.category || b.category || null,
    canli: !!(b.is_live || b.is_live_content || b.is_post_live_dvr),
    etiketler: (b.keywords || []).slice(0, 15),
    etiketler_tum: (b.keywords || []).slice(0, 40),
    aciklama: (b.short_description || '').slice(0, 600),
    aciklama_tam: (b.short_description || '').slice(0, 4000),
    // "en çok tekrar izlenen anlar": 100 noktalık yoğunluk (0–1)
    isi: (info.heat_map?.heat_markers || []).map(m => Math.round((m.heat_marker_intensity_score_normalized || 0) * 1000) / 1000),
    // bölümler (chapters): açıklamadaki zaman damgalı satırlar (YouTube bölümleri de buradan üretir)
    bolum: ((b.short_description || '').match(/^\s*\(?\d{1,2}:\d{2}(?::\d{2})?\)?\s+\S/gm) || []).length >= 3
      ? (b.short_description.match(/^\s*\(?\d{1,2}:\d{2}(?::\d{2})?\)?\s+\S/gm) || []).length : 0,
    kanal_id: b.channel_id || null,
    kanal: b.author || null,
  };
}

// ---------------------------------------------------------------- 4) altyazı (kanca + transkript)
export class AltyaziSiniri extends Error {}
let altyaziSon = 0, altyaziZinciri = Promise.resolve();

async function altyaziIndir(url) {
  // istekleri tek tek ve aralıklı gönder; 429'da bekleyip yeniden dene (motor._altyazi_indir)
  const is_ = altyaziZinciri.then(async () => {
    for (const bekle of [0, 4000, 10000]) {
      await new Promise(r => setTimeout(r, Math.max(0, 800 - (Date.now() - altyaziSon)) + bekle));
      altyaziSon = Date.now();
      const r = await fetch(url);
      if (r.status === 429) continue;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const t = await r.text();
      return t ? JSON.parse(t) : { events: [] };
    }
    throw new AltyaziSiniri('YouTube altyazı isteklerini geçici olarak sınırladı (429). Birkaç dakika sonra tekrar dene.');
  });
  altyaziZinciri = is_.catch(() => {});
  return is_;
}

/** [(saniye, metin)]: önce elle yüklenen altyazı, sonra otomatik (asr). dil boşsa videonun kendi dili. */
export async function altyaziSatirlari(info, dil = '', sinirSn = null) {
  const izler = info?.captions?.caption_tracks || [];
  if (!izler.length) return [];
  const otoDil = izler.find(t => t.kind === 'asr')?.language_code;
  const hedef = dil || otoDil || 'en';
  const adaylar = [
    ...izler.filter(t => t.kind !== 'asr' && (t.language_code === hedef || t.language_code.startsWith(hedef + '-'))),
    ...izler.filter(t => t.kind === 'asr' && t.language_code === hedef),
    ...izler.filter(t => t.kind === 'asr'),
  ];
  for (const iz of adaylar) {
    let veri;
    try { veri = await altyaziIndir(iz.base_url + '&fmt=json3'); }
    catch (h) { if (h instanceof AltyaziSiniri) throw h; continue; }
    const satirlar = [];
    for (const ev of veri.events || []) {
      const t = (ev.tStartMs || 0) / 1000;
      if (sinirSn && t > sinirSn) break;
      const m = bosluk((ev.segs || []).map(s => s.utf8 || '').join(''));
      if (m) satirlar.push([Math.round(t * 10) / 10, m]);
    }
    if (satirlar.length) return satirlar;
  }
  return [];
}

// ---------------------------------------------------------------- 5) kanal araması + öneriler
/** Kanal araması (tür = kanal): id, ad, abone, açıklama. */
export async function kanallariAra(sorgu, dil = 'en', adet = 100) {
  const yt = await istemci(dil);
  let s = await yt.search(sorgu, { type: 'channel' });
  const sonuc = [], gorulen = new Set();
  for (let sayfa = 0; sayfa < 25; sayfa++) {
    for (const c of s.results || []) {
      const id = c.author?.id || c.id;
      if (c.type !== 'Channel' || !id?.startsWith('UC') || gorulen.has(id)) continue;
      gorulen.add(id);
      // abone: yeni düzende "subscriber_count" alanında handle, "video_count" alanında abone metni gelebiliyor
      const adaylar = [metin(c.subscriber_count), metin(c.video_count)];
      sonuc.push({ id, ad: c.author?.name || metin(c.title), abone: dil === 'en' ? sayiOku(adaylar.find(t => /subscriber/i.test(t))) : null,
        aciklama: metin(c.description_snippet).slice(0, 200) });
      if (sonuc.length >= adet) break;
    }
    if (sonuc.length >= adet || !s.has_continuation) break;
    try { s = await s.getContinuation(); } catch { break; }
  }
  return sonuc;
}

/** YouTube arama kutusunun otomatik tamamlama önerileri (anahtarsız). */
export async function oneriler(sorgu, dil = 'en') {
  try {
    const u = 'https://suggestqueries.google.com/complete/search?' + new URLSearchParams({ client: 'firefox', ds: 'yt', hl: dil || 'en', q: sorgu });
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    return (await r.json())[1] || [];
  } catch { return []; }
}
