// API hesapları (StudioFlow'daki api-hesaplari.txt biçimi): hizmet başına birden çok hesap.
//
// Yer: Belgeler\Viral Radar\Ayarlar\api-hesaplari.txt
//     gemini.aktif = ana
//     gemini.ana.gemini_key = AIza...
//     cloudflare.ev.cf_account_id = 023e...
//     cloudflare.ev.cf_token = cfut_...
//
// Anahtarlar hiçbir zaman tam olarak arayüze gönderilmez veya günlüğe yazılmaz; yalnızca maskeli hali gösterilir.
// KURAL: yapay zekâ işleri YALNIZCA seçilen hizmetle ve TEK modelle yapılır; hizmetler/modeller arası otomatik geçiş yok.
// Aynı hizmetin hesapları arasında (kota/yetki) geçiş serbesttir, model değişmez.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DOSYA } from './yollar.js';

const BASLIK = '# Viral Radar API hesapları. Bu dosyayı paylaşma.\n';

export const HIZMETLER = {
  apify: {
    label: 'Apify',
    kullanim: 'Transkript yedeği: YouTube altyazıyı engellediğinde (429) Viral videolar › **Transkript** düğmesi Apify ile çalışır.',
    link: 'https://console.apify.com/settings/integrations',
    adimlar: 'apify.com → ücretsiz kayıt ol → Settings → **API & Integrations** → **Personal API tokens** → ' +
      "token'ı kopyala (`apify_api_` ile başlar). Ücretsiz plan her ay **$5** kullanım hakkı verir; " +
      'transkript video başına ~$0,003. Birden fazla hesap eklersen biri dolunca sıradaki kullanılır.',
    alan: 'apify_token',
  },
  gemini: {
    label: 'Gemini',
    kullanim: 'Yapay zekâ işleri: Viral videolar › **Alt konu öner**, alt konularla genişletme, konu kontrolü, ' +
      'Başlık analizi ve başlık üretici · Kanal bul › ilgi doğrulaması · Kanal analizi / karşılaştır › Başlık derin analizi. ' +
      'Tek model. Ücretsiz kotası model başına günlüktür.',
    link: 'https://aistudio.google.com/apikey',
    adimlar: 'Google AI Studio → **Get API key** → **Create API key** → anahtarı kopyala. Ücretsiz katman yeterli, kredi kartı istemez.',
    alan: 'gemini_key',
  },
  evren: {
    label: 'EVREN (DeepSeek)',
    kullanim: 'Aynı yapay zekâ işleri. Model: yalnızca **deepseek-v4.1-flash** (başka modele geçmez). ' +
      'Yavaştır: istek sırada bekleyebildiği için tek yanıt 20 sn – 3 dk sürebilir.',
    link: 'https://evren.ssyz.org.tr/',
    adimlar: "evren.ssyz.org.tr → kayıt ol / giriş yap → **API anahtarı** oluştur → token'ı kopyala (`evr` ile başlar). " +
      'Açık modelleri (DeepSeek, Qwen, GLM) OpenAI uyumlu API ile sunar. Kalan kredi test satırında görünür.',
    alan: 'evren_token',
  },
  cloudflare: {
    label: 'Cloudflare Workers AI',
    kullanim: 'Aynı yapay zekâ işleri, tek model (akıl yürüten model: yavaş ama dikkatli). Her hesabın günlük ücretsiz nöron bütçesi var; ' +
      'kotası dolan hesabın yerine sıradaki geçer. StudioFlow kuruluysa onun Cloudflare hesapları da kendiliğinden kullanılır.',
    link: 'https://dash.cloudflare.com/?to=/:account/api-tokens',
    adimlar: "Cloudflare paneli → **Account API Tokens** → Workers AI izinli token oluştur. Eklerken **Account ID ve token'ı aralarında boşlukla** yapıştır " +
      '(Account ID panelin sağ altında yazar). Test düğmesi yalnızca token\'ı doğrular, nöron harcamaz.',
    alan: 'cf_token',
  },
};
export const AI_HIZMETLER = ['evren', 'gemini', 'cloudflare'];

const EVREN_URL = 'https://evren-llmapi.ssyz.org.tr/v1';
const EVREN_MODEL = 'deepseek-v4.1-flash';
const CF_API = 'https://api.cloudflare.com/client/v4';
const CF_AZAMI_TOKEN = 16000, CF_ZAMAN = 300_000;

// StudioFlow kuruluysa: varsayılan metin modelleri ve Cloudflare hesapları oradan (tek kaynak)
const SF_AYAR = path.join(os.homedir(), 'Documents', 'StudioFlow', 'Ayarlar');
const SF_HESAPLAR = path.join(SF_AYAR, 'api-hesaplari.txt');
const SF_KOTA = path.join(SF_AYAR, 'kota-bekleme.json');
const SF_METIN_ORTAK = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'StudioFlow', 'uygulama', 'studioflow', 'saglayicilar', 'metin_ortak.py');
const YEDEK_MODEL = { gemini: 'gemini-3.8-flash', cloudflare: '@cf/nvidia/nemotron-3-120b-a12b' };

export class HesapYok extends Error {}

// ---------------------------------------------------------------- dosya
function anahtarDosyasiOku(yol) {
  const veri = {};
  try {
    for (let satir of fs.readFileSync(yol, 'utf8').split(/\r?\n/)) {
      satir = satir.trim();
      if (satir && !satir.startsWith('#') && satir.includes('=')) {
        const i = satir.indexOf('=');
        veri[satir.slice(0, i).trim()] = satir.slice(i + 1).trim();
      }
    }
  } catch { /* dosya yok */ }
  return veri;
}
const oku = () => anahtarDosyasiOku(DOSYA.hesaplar);

function yaz(veri) {
  fs.mkdirSync(path.dirname(DOSYA.hesaplar), { recursive: true });
  const satirlar = [BASLIK, ...Object.entries(veri).filter(([k]) => k.startsWith('ayar.')).map(([k, v]) => `${k} = ${v}`), ''];
  for (const h of Object.keys(HIZMETLER)) {
    if (veri[`${h}.aktif`]) satirlar.push(`${h}.aktif = ${veri[`${h}.aktif`]}`);
    for (const [k, v] of Object.entries(veri)) if (k.startsWith(h + '.') && !k.endsWith('.aktif')) satirlar.push(`${k} = ${v}`);
    satirlar.push('');
  }
  fs.writeFileSync(DOSYA.hesaplar, satirlar.join('\n'), 'utf8');
}

const hesapAdi = ad => (ad || '').trim().replace(/[.\s=]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'hesap';
export const maskele = t => (t && t.length > 16 ? `${t.slice(0, 10)}…${t.slice(-4)}` : '•••');

/** [[ad, token]] — aktif hesap başta. Cloudflare'de token = [hesapKimligi, token]. */
export function hesaplar(hizmet) {
  if (hizmet === 'cloudflare') return cfHesaplari().map(h => [h.ad, [h.hesap, h.token]]);
  const veri = oku(), alan = HIZMETLER[hizmet].alan, aktif = veri[`${hizmet}.aktif`];
  const liste = Object.entries(veri).filter(([k]) => k.startsWith(hizmet + '.') && k.endsWith('.' + alan)).map(([k, v]) => [k.split('.')[1], v]);
  return liste.sort((a, b) => (a[0] !== aktif) - (b[0] !== aktif));
}

// ---------------------------------------------------------------- Cloudflare hesapları (kendi dosyası + StudioFlow)
function sfBekleyenler() {
  try {
    const d = JSON.parse(fs.readFileSync(SF_KOTA, 'utf8')), simdi = Date.now(), s = {};
    for (const k of d.hesaplar || []) if (k.hizmet === 'cloudflare' && Date.parse(k.acilis) > simdi) s[k.ad] = k.acilis;
    return s;
  } catch { return {}; }
}

function cfListesi(veri, kaynak, bekleyen = {}) {
  const adlar = [...new Set(Object.keys(veri).filter(k => k.startsWith('cloudflare.') && k.split('.').length === 3).map(k => k.split('.')[1]))];
  const aktif = veri['cloudflare.aktif'];
  adlar.sort((a, b) => (a !== aktif) - (b !== aktif));
  return adlar.map(ad => ({ ad, hesap: veri[`cloudflare.${ad}.cf_account_id`] || '', token: veri[`cloudflare.${ad}.cf_token`] || '',
    kaynak, bekliyor: bekleyen[ad] || null })).filter(h => h.hesap && h.token);
}

/** Kendi hesapların önce, sonra StudioFlow'unkiler (kota bekleyenler varsayılan olarak çıkarılır). */
export function cfHesaplari(bekleyenlerDahil = false) {
  const kendi = cfListesi(oku(), 'viral-radar');
  const sf = cfListesi(anahtarDosyasiOku(SF_HESAPLAR), 'studioflow', sfBekleyenler())
    .filter(h => !kendi.some(k => k.token === h.token));
  const l = [...kendi, ...sf];
  return bekleyenlerDahil ? l : l.filter(h => !h.bekliyor);
}

// ---------------------------------------------------------------- model seçimi
function sfModel(hizmet) {
  try {
    const kod = fs.readFileSync(SF_METIN_ORTAK, 'utf8');
    const blok = kod.slice(kod.indexOf(`"${hizmet}": {`));
    const m = blok.match(/"models":\s*\[\s*"([^"]+)"/);
    if (m) return m[1];
  } catch { /* StudioFlow kurulu değil */ }
  return YEDEK_MODEL[hizmet];
}
export const aiModel = h => (h === 'evren' ? EVREN_MODEL : sfModel(h));

// ---------------------------------------------------------------- testler
async function apifyIstek(yol, token, govde, zaman = 30_000) {
  const r = await fetch('https://api.apify.com/v2/' + yol, {
    method: govde ? 'POST' : 'GET', body: govde ? JSON.stringify(govde) : undefined,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(zaman) });
  if (!r.ok) { const h = new Error(`HTTP ${r.status}`); h.kod = r.status; throw h; }
  return r.json();
}

async function apifyTest(token) {
  let d;
  try { d = (await apifyIstek('users/me', token)).data; }
  catch (h) { return { gecerli: false, hata: [401, 403].includes(h.kod) ? 'Token geçersiz' : String(h.message).slice(0, 120) }; }
  const s = { gecerli: true, kullanici: d.username, plan: d.plan?.id };
  try {
    const lim = (await apifyIstek('users/me/limits', token)).data;
    s.kullanim = Math.round((lim.current?.monthlyUsageUsd || 0) * 1000) / 1000;
    s.limit = lim.limits?.maxMonthlyUsageUsd;
    s.yenilenme = (lim.monthlyUsageCycle?.endAt || '').slice(0, 10);
  } catch { /* limit okunamadı */ }
  return s;
}

async function geminiTest(anahtar) {
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': anahtar }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return { gecerli: false, hata: [400, 401, 403].includes(r.status) ? 'Anahtar geçersiz' : `HTTP ${r.status}` };
    const modeller = ((await r.json()).models || []).map(m => m.name.split('/').pop());
    const m = aiModel('gemini');
    return { gecerli: true, model: m, aciklama: `${modeller.length} model erişilebilir · kullanılacak: ${m}` + (modeller.includes(m) ? '' : ' (bu anahtarda yok!)') };
  } catch (h) { return { gecerli: false, hata: String(h.message).slice(0, 120) }; }
}

const evrenIstek = (yol, token, govde, zaman = 30_000) => fetch(`${EVREN_URL}/${yol}`, {
  method: govde ? 'POST' : 'GET', body: govde ? JSON.stringify(govde) : undefined, signal: AbortSignal.timeout(zaman),
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' } });

async function evrenTest(token) {
  let modeller;
  try {
    const r = await evrenIstek('models', token);
    if (!r.ok) return { gecerli: false, hata: [401, 403].includes(r.status) ? 'Token geçersiz' : `HTTP ${r.status}` };
    modeller = ((await r.json()).data || []).map(m => m.id);
  } catch (h) { return { gecerli: false, hata: String(h.message).slice(0, 120) }; }
  let kredi = null;
  try { // kalan kredi yalnızca yanıtın usage alanında geliyor → en ucuz yönlendirmeyle tek kelimelik istek
    const y = await (await evrenIstek('chat/completions', token, { model: 'auto', messages: [{ role: 'user', content: '1' }], max_tokens: 1 }, 40_000)).json();
    kredi = y.usage?.evren?.credits_remaining_cr ?? null;
  } catch { /* kredi okunamadı */ }
  return { gecerli: true, model: modeller.includes(EVREN_MODEL) ? EVREN_MODEL : null,
    aciklama: `${modeller.length} model · kullanılacak: ${modeller.includes(EVREN_MODEL) ? EVREN_MODEL : EVREN_MODEL + ' bu token’da yok!'}` + (kredi !== null ? ` · kalan kredi: ${kredi}` : '') };
}

async function cfTest([hesap, token]) {
  // Workers AI çağrısı yok, nöron harcamaz. Kullanıcı (cfut_) ve hesap (cfat_) token'ları için iki adres.
  for (const adres of [`${CF_API}/user/tokens/verify`, `${CF_API}/accounts/${hesap}/tokens/verify`]) {
    try {
      const r = await fetch(adres, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(20_000) });
      if (r.ok) { const d = await r.json(); if (d.success) return { gecerli: true, aciklama: `token ${d.result?.status || 'active'} · Workers AI için hazır` }; }
      else if (![401, 403].includes(r.status)) return { gecerli: false, hata: `HTTP ${r.status}` };
    } catch (h) { return { gecerli: false, hata: String(h.message).slice(0, 120) }; }
  }
  return { gecerli: false, hata: 'Token geçersiz ya da bu hesaba yetkisi yok' };
}

const hizmetTest = (h, t) => ({ apify: apifyTest, gemini: geminiTest, evren: evrenTest, cloudflare: cfTest })[h](t);

// ---------------------------------------------------------------- üretim
export function jsonAyikla(metin) {
  metin = String(metin).trim().replace(/^\s*```(?:json)?|```\s*$/g, '');
  const ilk = [metin.indexOf('{'), metin.indexOf('[')].filter(i => i >= 0);
  const bas = ilk.length ? Math.min(...ilk) : 0;
  const son = Math.max(metin.lastIndexOf('}'), metin.lastIndexOf(']'));
  return JSON.parse(son > bas ? metin.slice(bas, son + 1) : metin);
}

async function evrenUret(istem, sicaklik) {
  let sonHata = 'EVREN hesabı ekli değil (API hesapları sayfasından ekle)';
  for (const [ad, token] of hesaplar('evren')) {
    const govde = { model: EVREN_MODEL, messages: [{ role: 'user', content: istem }], temperature: sicaklik,
      reasoning_effort: 'low', max_tokens: 32768, stream: true, stream_options: { include_usage: true } };
    let r;
    try { r = await evrenIstek('chat/completions', token, govde, 420_000); }
    catch (h) { sonHata = `EVREN ${ad}/${EVREN_MODEL}: ${String(h.message).slice(0, 100)}`; continue; }
    if (!r.ok) {
      sonHata = `EVREN ${ad}/${EVREN_MODEL}: HTTP ${r.status}`;
      if ([401, 402, 403, 429].includes(r.status) || r.status >= 500) continue; // sıradaki hesap, aynı model
      throw new HesapYok(sonHata);
    }
    let metin = '';
    for (const satir of (await r.text()).split('\n')) {
      const s = satir.trim();
      if (!s.startsWith('data:') || s.endsWith('[DONE]')) continue;
      try { for (const c of JSON.parse(s.slice(5)).choices || []) metin += c.delta?.content || ''; } catch { /* yarım satır */ }
    }
    try { return [jsonAyikla(metin), `EVREN ${ad} · ${EVREN_MODEL}`]; }
    catch (h) { throw new HesapYok(`EVREN ${ad}/${EVREN_MODEL}: geçersiz yanıt (${String(h.message).slice(0, 80)})`); }
  }
  throw new HesapYok(sonHata);
}

async function geminiUret(istem, sicaklik) {
  let sonHata = 'Gemini hesabı ekli değil (API hesapları sayfasından ekle)';
  const model = aiModel('gemini');
  for (const [ad, anahtar] of hesaplar('gemini')) {
    for (let deneme = 0; deneme < 2; deneme++) {
      let r;
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST', signal: AbortSignal.timeout(300_000),
          headers: { 'x-goog-api-key': anahtar, 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: istem }] }],
            generationConfig: { temperature: sicaklik, responseMimeType: 'application/json', maxOutputTokens: 32768 } }) });
      } catch (h) { sonHata = `${ad}/${model}: ${String(h.message).slice(0, 100)}`; break; } // bağlantı/zaman aşımı → sıradaki hesap
      if (!r.ok) {
        sonHata = `${ad}/${model}: HTTP ${r.status}`;
        if ([500, 503, 504].includes(r.status) && deneme === 0) { await new Promise(x => setTimeout(x, 3000)); continue; }
        if ([401, 403, 429].includes(r.status) || r.status >= 500) break; // sıradaki hesap
        throw new HesapYok(sonHata); // 400/404: model ya da istek sorunu, başka hesapta da aynı
      }
      try {
        const d = await r.json();
        return [JSON.parse((d.candidates[0].content.parts || []).map(p => p.text || '').join('')), `${ad} · ${model}`];
      } catch (h) {
        sonHata = `${ad}/${model}: geçersiz yanıt (${String(h.message).slice(0, 80)})`;
        if (deneme === 0) continue;
        throw new HesapYok(sonHata);
      }
    }
  }
  throw new HesapYok(sonHata);
}

let cfSon = null; // son başarılı hesap: sıradaki istek önce onu dener
async function cloudflareUret(istem, sicaklik) {
  const liste = cfHesaplari();
  if (!liste.length) throw new HesapYok('Cloudflare: kullanılabilir hesap yok (hepsi kota bekliyor ya da hiç eklenmemiş)');
  liste.sort((a, b) => (a.ad !== cfSon) - (b.ad !== cfSon));
  const model = aiModel('cloudflare'), kisa = model.split('/').pop();
  let sonHata = '';
  for (const { ad, hesap, token } of liste) {
    let r;
    try {
      r = await fetch(`${CF_API}/accounts/${hesap}/ai/run/${model}`, {
        method: 'POST', signal: AbortSignal.timeout(CF_ZAMAN),
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: istem }], temperature: sicaklik, max_tokens: CF_AZAMI_TOKEN }) });
    } catch (h) { sonHata = `Cloudflare ${ad}/${kisa}: ${String(h.message).slice(0, 100)}`; continue; }
    if (!r.ok) {
      sonHata = `Cloudflare ${ad}/${kisa}: HTTP ${r.status}`;
      if ([401, 403, 429].includes(r.status) || r.status >= 500) continue; // aynı modelle sıradaki hesap
      throw new HesapYok(sonHata);
    }
    try {
      const sonuc = (await r.json()).result || {};
      const m = sonuc.response || sonuc.choices?.[0]?.message?.content || '';
      cfSon = ad;
      return [typeof m === 'object' ? m : jsonAyikla(m), `Cloudflare ${ad} · ${kisa}`];
    } catch (h) { throw new HesapYok(`Cloudflare ${ad}/${kisa}: geçersiz yanıt (${String(h.message).slice(0, 80)})`); }
  }
  throw new HesapYok(sonHata || 'Cloudflare: yanıt alınamadı');
}

export function aiOncelik() {
  const o = oku()['ayar.ai_oncelik'] || 'evren';
  return AI_HIZMETLER.includes(o) ? o : 'evren';
}

export function aiOncelikYap(hizmet) {
  if (!AI_HIZMETLER.includes(hizmet)) return { tamam: false, hata: 'bilinmeyen hizmet' };
  const veri = oku();
  veri['ayar.ai_oncelik'] = hizmet;
  yaz(veri);
  return { tamam: true };
}

/** Yapay zekâ ile JSON üretimi: YALNIZCA seçili hizmet. [yanıt, kaynak] döndürür. */
export async function aiUret(istem, sicaklik = 0.4) {
  const h = aiOncelik();
  try {
    if (h === 'cloudflare') return await cloudflareUret(istem, sicaklik);
    return h === 'evren' ? await evrenUret(istem, sicaklik) : await geminiUret(istem, sicaklik);
  } catch (e) {
    if (e instanceof HesapYok) throw new HesapYok(`Seçili yapay zekâ yanıt vermedi (${e.message}). Başka hizmete geçilmedi; API hesapları sayfasından değiştirebilirsin.`);
    throw e;
  }
}

// ---------------------------------------------------------------- arayüz işlemleri
export function liste() {
  const veri = oku(), oncelik = aiOncelik();
  return Object.entries(HIZMETLER).map(([h, bilgi]) => {
    const { alan, ...gorunen } = bilgi;
    const hesapListesi = h === 'cloudflare'
      ? cfHesaplari(true).map(x => ({ ad: x.ad, maske: maskele(x.token), bekliyor: x.bekliyor, kaynak: x.kaynak }))
      : hesaplar(h).map(([ad, t]) => ({ ad, maske: maskele(t) }));
    return { ...gorunen, id: h, aktif: veri[`${h}.aktif`] || null, ai: AI_HIZMETLER.includes(h), oncelikli: h === oncelik,
      model: AI_HIZMETLER.includes(h) ? aiModel(h) : null, hesaplar: hesapListesi };
  });
}

export async function ekle(hizmet, token, ad = '') {
  let kimlik;
  if (hizmet === 'cloudflare') {
    const p = String(token || '').trim().split(/[\s:;,]+/).filter(Boolean);
    if (p.length !== 2) return { tamam: false, hata: "Account ID ve token'ı aralarında boşlukla yapıştır" };
    kimlik = p;
    token = p[1];
  } else {
    token = String(token || '').replace(/\s+/g, '');
    if (hizmet === 'apify' && !token.startsWith('apify_api_')) return { tamam: false, hata: "Apify token'ı apify_api_ ile başlamalı" };
  }
  if (token.length < 20) return { tamam: false, hata: 'Anahtar çok kısa; tamamını kopyaladığından emin ol' };
  const test = await hizmetTest(hizmet, kimlik || token);
  if (!test.gecerli) return { tamam: false, hata: test.hata || 'Token doğrulanamadı' };
  const veri = oku(), alan = HIZMETLER[hizmet].alan;
  const mevcut = hizmet === 'cloudflare' ? cfListesi(veri, 'viral-radar') : hesaplar(hizmet).map(([a, t]) => ({ ad: a, token: t }));
  if (mevcut.some(h => h.token === token)) return { tamam: false, hata: 'Bu token zaten ekli' };
  let temel = hesapAdi(ad || test.kullanici || (AI_HIZMETLER.includes(hizmet) ? 'anahtar' : 'hesap')), yeniAd = temel;
  for (let i = 2; mevcut.some(h => h.ad === yeniAd); i++) yeniAd = `${temel}-${i}`;
  if (hizmet === 'cloudflare') veri[`cloudflare.${yeniAd}.cf_account_id`] = kimlik[0];
  veri[`${hizmet}.${yeniAd}.${alan}`] = token;
  veri[`${hizmet}.aktif`] ??= yeniAd;
  yaz(veri);
  return { tamam: true, ad: yeniAd, test };
}

export function sil(hizmet, ad) {
  const veri = oku();
  if (hizmet === 'cloudflare' && !veri[`cloudflare.${ad}.cf_token`]) return { tamam: false, hata: 'StudioFlow hesapları buradan silinmez' };
  delete veri[`${hizmet}.${ad}.${HIZMETLER[hizmet].alan}`];
  if (hizmet === 'cloudflare') delete veri[`cloudflare.${ad}.cf_account_id`];
  if (veri[`${hizmet}.aktif`] === ad) {
    const kalan = Object.keys(veri).find(k => k.startsWith(hizmet + '.') && k.endsWith('.' + HIZMETLER[hizmet].alan));
    if (kalan) veri[`${hizmet}.aktif`] = kalan.split('.')[1]; else delete veri[`${hizmet}.aktif`];
  }
  yaz(veri);
  return { tamam: true };
}

export function aktifYap(hizmet, ad) {
  const veri = oku();
  if (!veri[`${hizmet}.${ad}.${HIZMETLER[hizmet].alan}`]) return { tamam: false, hata: 'Hesap yok' };
  veri[`${hizmet}.aktif`] = ad;
  yaz(veri);
  return { tamam: true };
}

export async function testEt(hizmet, ad) {
  if (hizmet === 'cloudflare') {
    const h = cfHesaplari(true).find(x => x.ad === ad);
    return h ? cfTest([h.hesap, h.token]) : { gecerli: false, hata: 'Hesap yok' };
  }
  const t = new Map(hesaplar(hizmet)).get(ad);
  return t ? hizmetTest(hizmet, t) : { gecerli: false, hata: 'Hesap yok' };
}

// ---------------------------------------------------------------- Apify (transkript yedeği)
async function apifyCalistir(aktor, girdi, zaman = 300) {
  let sonHata = 'Apify hesabı ekli değil (API hesapları sayfasından ekle)';
  for (const [ad, token] of hesaplar('apify')) {
    try { return [await apifyIstek(`acts/${aktor}/run-sync-get-dataset-items?timeout=${zaman}`, token, girdi, (zaman + 30) * 1000), ad]; }
    catch (h) {
      sonHata = `${ad}: ${h.message}`;
      if ([401, 402, 403, 429].includes(h.kod)) continue;
      throw h;
    }
  }
  throw new HesapYok(sonHata);
}

export async function apifyTranskript(videoId, dil = '') {
  const girdi = { youtube_url: [`https://www.youtube.com/watch?v=${videoId}`], include_metadata: false };
  if (dil) girdi.languages = [dil, 'en'];
  const [sonuc, hesap] = await apifyCalistir('johnvc~YoutubeTranscripts', girdi, 180);
  const kayit = sonuc.find(s => s.video_id === videoId || s.timestamped) || {};
  const satirlar = (kayit.timestamped || []).map(p => [Math.round((p.start || 0) * 10) / 10, (p.text || '').replace(/\n/g, ' ').trim()]).filter(s => s[1]);
  return [satirlar, hesap];
}
