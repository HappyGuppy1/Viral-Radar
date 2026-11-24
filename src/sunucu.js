// Yerel sunucu (sunucu.py): yalnızca 127.0.0.1'e bağlanır; arayüz (src/arayuz/index.html) bu adresleri çağırır.
// Electron penceresi bu sunucunun adresini açar. İleride mobil sürümde aynı `islemler` doğrudan sayfa içinden çağrılabilir.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOSYA, gunluk } from './cekirdek/yollar.js';
import * as motor from './cekirdek/motor.js';
import * as hesaplar from './cekirdek/hesaplar.js';
import * as videoAnaliz from './cekirdek/video_analiz.js';
import * as kanalAra from './cekirdek/kanal_ara.js';
import * as kanal from './cekirdek/kanal.js';
import * as baslikAnaliz from './cekirdek/baslik_analiz.js';
import { sorguCevirileri } from './cekirdek/ceviri.js';
import { hepsiniKaydet } from './cekirdek/onbellek.js';
import { ARAMA_DILLERI, dosyaDamgasi, slug } from './cekirdek/metin.js';
import { kat } from './cekirdek/ortak.js';
import { AltyaziSiniri } from './cekirdek/youtube.js';

const ARAYUZ = path.join(path.dirname(fileURLToPath(import.meta.url)), 'arayuz');
const DOSYA_ADI = /^[\w-]+\.json$/;
const ISLER = new Map();

// ---------------------------------------------------------------- arka plan işleri
class Is {
  constructor(parametre, isci = null) {
    this.id = Math.random().toString(16).slice(2, 12);
    Object.assign(this, { parametre, isci, durum: 'calisiyor', asama: 'basliyor', yuzde: 0, log: [], dosya: null, hata: null });
    this.iptal = { iptal: false };
    setImmediate(() => this.calis());
  }

  ilerleme = (asama, yuzde, mesaj) => {
    this.asama = asama;
    if (yuzde !== null && yuzde !== undefined) this.yuzde = Math.round(yuzde * 10) / 10;
    this.log.push(`${new Date().toTimeString().slice(0, 8)}  ${mesaj}`);
  };

  async calis() {
    try {
      if (this.isci) {
        this.dosya = await this.isci(this.parametre, this.ilerleme, this.iptal);
        this.ilerleme('bitti', 100, 'Tamamlandı');
      } else {
        const sonuc = await motor.tara(this.parametre, this.ilerleme, this.iptal);
        const gorulen = oncekiVideolar();
        for (const v of sonuc.sonuclar) v.yeni = !gorulen.has(v.id);
        sonuc.kayitli = false; // "Raporu kaydet" ile Kayıtlar'a girer
        const ad = `${dosyaDamgasi()}-${slug(sonuc.parametre.sorgular.join(' '))}.json`;
        fs.writeFileSync(path.join(DOSYA.taramalar, ad), JSON.stringify(sonuc, null, 1), 'utf8');
        this.dosya = ad;
      }
      this.durum = 'bitti';
    } catch (h) {
      if (h instanceof motor.Iptal) { this.durum = 'iptal'; this.ilerleme('iptal', null, 'İptal edildi'); return; }
      this.durum = 'hata'; this.hata = String(h.message || h);
      this.ilerleme('hata', null, `Hata: ${this.hata}`);
      gunluk(`İş hatası: ${h.stack || h}`);
    }
  }

  ozet() {
    return { id: this.id, durum: this.durum, asama: this.asama, yuzde: this.yuzde, log: this.log.slice(-200), dosya: this.dosya, hata: this.hata };
  }
}

function isBaslat(parametre, isci) {
  const i = new Is(parametre, isci);
  ISLER.set(i.id, i);
  return { id: i.id };
}

const jsonOku = yol => JSON.parse(fs.readFileSync(yol, 'utf8'));

function oncekiVideolar() {
  const gorulen = new Set();
  for (const f of fs.readdirSync(DOSYA.taramalar).filter(f => f.endsWith('.json'))) {
    try { for (const v of jsonOku(path.join(DOSYA.taramalar, f)).sonuclar) gorulen.add(v.id); } catch { /* bozuk dosya */ }
  }
  return gorulen;
}

function taramalar() {
  const liste = [];
  for (const f of fs.readdirSync(DOSYA.taramalar).filter(f => f.endsWith('.json')).sort().reverse()) {
    try {
      const yol = path.join(DOSYA.taramalar, f), d = jsonOku(yol);
      if (!motor.gecmisteMi(yol, d)) continue;
      liste.push({ dosya: f, zaman: d.zaman, sorgular: d.parametre.sorgular, outlier: d.sonuclar.length, yeni: d.sonuclar.filter(v => v.yeni).length,
        format: d.parametre.format, tarih: d.parametre.tarih, dil: d.parametre.arama_dili || 'en' });
    } catch { /* bozuk dosya */ }
  }
  return liste;
}

function taramaDosyasi(ad) {
  if (!DOSYA_ADI.test(ad || '') || !fs.existsSync(path.join(DOSYA.taramalar, ad))) { const h = new Error('dosya yok'); h.kod = 404; throw h; }
  return [ad, jsonOku(path.join(DOSYA.taramalar, ad))];
}

// ---------------------------------------------------------------- dışa aktarma
const CSV_ALANLAR = ['skor', 'izlenme', 'taban', 'abone', 'vsr', 'vph', 'etkilesim', 'yas_gun', 'tarih', 'sure',
  'baslik', 'baslik_gorunen', 'kanal', 'ulke', 'link', 'sorgu', 'arama', 'diller', 'yeni', 'bayraklar', 'kanca'];

function csvYap(d) {
  const hucre = x => { const s = String(x ?? ''); return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const satirlar = [CSV_ALANLAR.join(';')];
  for (const v of d.sonuclar) {
    satirlar.push(CSV_ALANLAR.map(a => hucre(a === 'bayraklar' ? (v.bayraklar || []).map(b => b.kod).join(', ')
      : a === 'diller' ? (v.diller || []).join(', ') : typeof v[a] === 'boolean' ? (v[a] ? 'True' : 'False') : v[a])).join(';'));
  }
  return '﻿' + satirlar.join('\r\n') + '\r\n';
}

function ozetMd(a) {
  const t = x => (x || '').replace(/\|/g, '/');
  const bl = a.bulgular || {};
  let s = ['', '## Özet: bu aramada ne patlıyor?', '', (bl.giris || []).join(' ')];
  for (const b of bl.bolumler || []) {
    s.push('', `### ${b.baslik}`, '', b.aciklama || '', '');
    for (const m of b.maddeler || []) {
      s.push(`- ${m.ton === 'iyi' ? '✅' : m.ton === 'kotu' ? '❌' : '➖'} **${m.metin}** ${m.alt || ''}`);
      s = s.concat((m.ornekler || []).slice(0, 2).map(o => `  - [${t(o.baslik)}](${o.link}) — ${o.kanal || ''}, normalinin ${kat(o.skor)}`));
    }
    if (b.kelimeler?.length) s.push('', '**Daha çok izlenen:** ' + b.kelimeler.map(x => `${x.kelime} (${x.metin})`).join(', '));
    if (b.kelimeler_az?.length) s.push('', '**Daha az izlenen:** ' + b.kelimeler_az.map(x => `${x.kelime} (${x.metin})`).join(', '));
    s = s.concat((b.videolar || []).map((v, i) => `${i + 1}. [${t(v.baslik)}](${v.link}) — ${v.kanal || ''} · normalinin ${kat(v.skor)}`));
  }
  return s;
}

function mdYap(d) {
  const p = d.parametre, de = d.desenler, sayi = x => Number(x).toLocaleString('en-US');
  let s = [`# Viral videolar taraması — ${p.sorgular.join(', ')}`, '',
    `- **Zaman:** ${d.zaman} · **Arama dili:** ${p.arama_dili || 'en'} · **Biçim:** ${p.format} · **Tarih:** ${p.tarih} · ` +
    `**Abone:** ${sayi(p.min_abone)}–${sayi(p.max_abone)} · **Min skor:** ${p.min_skor}x`,
    `- **İstatistik:** ${JSON.stringify(d.istatistik)}`];
  if (p.genisleme?.length) s.push(`- **Alt konular (genişletme):** ${p.genisleme.join(', ')}`);
  if (d.analiz?.bulgular) s = s.concat(ozetMd(d.analiz));
  if (p.arama_dili === 'tumu') s.push('- **Aranan çeviriler:** ' + Object.values(p.ceviriler || {}).flatMap(c => Object.entries(c).map(([dil, q]) => `${dil}: ${q}`)).join(' · '));
  s.push('', '## Sonuçlar', '', '| Skor | İzlenme | Abone | VPH | Gün | Başlık | Kanal | Bayrak |', '|---|---|---|---|---|---|---|---|');
  for (const v of d.sonuclar) {
    s.push(`| ${v.skor}x | ${sayi(v.izlenme)} | ${v.abone || '?'} | ${v.vph ?? ''} | ${v.yas_gun ?? ''} | ${v.yeni ? '🆕 ' : ''}[${v.baslik.replace(/\|/g, '/')}](${v.link}) | ${v.kanal} | ${(v.bayraklar || []).map(b => b.kod).join(', ')} |`);
  }
  s.push('', '## Desenler', '', `Outlier: ${de.n.outlier} · Tüm adaylar: ${de.n.tum} · Medyan başlık uzunluğu: ${de.baslik_uzunlugu.outlier} / ${de.baslik_uzunlugu.tum} karakter`, '',
    '| Özellik | Outlier % | Tüm % | Fark |', '|---|---|---|---|');
  s = s.concat(de.ozellikler.map(o => `| ${o.ad.replace(/\|/g, '\\|')} | ${o.outlier} | ${o.tum} | ${o.fark >= 0 ? '+' : ''}${o.fark} |`));
  s.push('', '**Tekrar eden kalıplar:** ' + (de.kaliplar.slice(0, 15).map(k => `“${k.kalip}” (${k.video} video / ${k.kanal} kanal)`).join(', ') || '—'));
  const kancalar = d.sonuclar.filter(v => v.kanca).slice(0, 15);
  if (kancalar.length) s.push('', '## Kancalar (ilk 60 sn)', '', ...kancalar.map(v => `- **${v.baslik}** (${v.skor}x): ${v.kanca.slice(0, 400)}`));
  return s.join('\n') + '\n';
}

// ---------------------------------------------------------------- yönlendirme
const HENUZ_YOK = { hata: 'Bu bölüm yeni sürüme henüz taşınmadı (Kanal karşılaştır sıradaki aşamada).' };
const yanit = (kod, govde, tur = 'application/json; charset=utf-8', ek = {}) => ({ kod, govde, tur, ek });

async function get(u) {
  const q = u.searchParams, yol = u.pathname;
  if (yol === '/' || yol === '/index.html') return yanit(200, fs.readFileSync(path.join(ARAYUZ, 'index.html')), 'text/html; charset=utf-8');
  if (yol === '/api/varsayilan') return yanit(200, motor.VARSAYILAN);
  if (yol === '/api/is') { const i = ISLER.get(q.get('id')); return i ? yanit(200, i.ozet()) : yanit(404, { hata: 'iş yok' }); }
  if (yol === '/api/taramalar') return yanit(200, taramalar());
  if (yol === '/api/tarama') return yanit(200, taramaDosyasi(q.get('dosya'))[1]);
  if (yol === '/api/disa') {
    const [ad, d] = taramaDosyasi(q.get('dosya'));
    const csv = (q.get('tur') || 'csv') === 'csv';
    return yanit(200, csv ? csvYap(d) : mdYap(d), csv ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8',
      { 'Content-Disposition': `attachment; filename="${ad.replace('.json', csv ? '.csv' : '.md')}"` });
  }
  if (yol === '/api/transkript') {
    const vid = q.get('id') || '';
    if (!/^[\w-]{11}$/.test(vid)) return yanit(400, { hata: 'geçersiz video' });
    const dil = q.get('dil') || '';
    try { return yanit(200, await motor.transkript(vid, dil)); }
    catch (h) {
      if (!(h instanceof AltyaziSiniri)) throw h;
      try { const [satirlar, hesap] = await hesaplar.apifyTranskript(vid, dil); return yanit(200, { satirlar, kaynak: `Apify (${hesap})` }); }
      catch (h2) { return yanit(429, { hata: `${h.message} Apify yedeği de kullanılamadı: ${h2.message}` }); }
    }
  }
  if (yol === '/api/hazir') return yanit(200, fs.existsSync(DOSYA.hazir) ? jsonOku(DOSYA.hazir) : []);
  if (yol === '/api/hesaplar') return yanit(200, hesaplar.liste());
  if (yol === '/api/kanal-ara/gecmis') return yanit(200, kanalAra.gecmis());
  if (yol === '/api/kanal-ara/yukle') return yanit(200, kanalAra.yukle(q.get('dosya')));
  if (yol === '/api/kanal/gecmis') return yanit(200, kanal.gecmis());
  if (yol === '/api/kanal/yukle') return yanit(200, kanal.yukle(q.get('dosya')));
  if (yol === '/api/kanal/disa') {
    const ad = q.get('dosya'), d = kanal.yukle(ad);
    const cikti = ((d.genel.ad || 'kanal').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'kanal') + '-' + ad.split('/')[1].replace('.json', '.md');
    return yanit(200, kanal.raporMd(d), 'text/markdown; charset=utf-8', { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(cikti)}` });
  }
  if (yol === '/api/grup/gecmis') return yanit(200, []);
  if (/^\/api\/grup\//.test(yol)) return yanit(501, HENUZ_YOK);
  return yanit(404, { hata: 'bulunamadı' });
}

async function post(u, g, kapat) {
  const yol = u.pathname;
  if (yol === '/api/tara') return yanit(200, isBaslat(g));
  if (yol === '/api/kanal-ara') return yanit(200, isBaslat(g, kanalAra.kanalAra));
  if (yol === '/api/kanal/analiz') return yanit(200, isBaslat(g, kanal.analiz));
  if (yol === '/api/kanal/kayit') return yanit(200, kanal.kayit(g.dosya, g.kayitli ?? true));
  if (yol === '/api/kanal/baslik-gemini') return yanit(200, isBaslat(g, kanal.baslikGemini));
  if (yol === '/api/kanal/baslik-uret') {
    if (!(g.konu || '').trim()) return yanit(400, { hata: 'Önce video konusunu yaz' });
    return yanit(200, await baslikAnaliz.baslikUret(kanal.yukle(g.dosya), g.konu.trim(), parseInt(g.adet || 10, 10)));
  }
  if (yol === '/api/kanal-ara/kayit') return yanit(200, kanalAra.kayit(g.dosya, g.kayitli ?? true));
  if (yol === '/api/iptal') { const i = ISLER.get(g.id); if (i) i.iptal.iptal = true; return yanit(200, { tamam: !!i }); }
  if (yol === '/api/kapat') {
    for (const i of ISLER.values()) i.iptal.iptal = true;
    setTimeout(kapat, 300);
    return yanit(200, { tamam: true });
  }
  if (yol === '/api/tarama/kayit') {
    const [ad] = taramaDosyasi(g.dosya);
    return yanit(200, motor.kayitIsaretle(path.join(DOSYA.taramalar, ad), g.kayitli ?? true));
  }
  if (yol === '/api/tarama/baslik-gemini') {
    const [ad] = taramaDosyasi(g.dosya);
    return yanit(200, isBaslat({}, async (_, ilerleme) => {
      const yolu = path.join(DOSYA.taramalar, ad), d = jsonOku(yolu);
      if (!d.analiz?.baslik) throw new Error('Bu taramada başlık analizi yok; derin analiz için yeniden tara');
      ilerleme('gemini', 10, 'Patlayan ve normal başlıklar yapay zekâya gönderildi. EVREN ile 2–5 dk sürebilir');
      d.analiz.baslik.gemini = await videoAnaliz.baslikGemini(d);
      fs.writeFileSync(yolu, JSON.stringify(d, null, 1), 'utf8');
      return ad;
    }));
  }
  if (yol === '/api/tarama/baslik-uret') {
    if (!(g.konu || '').trim()) return yanit(400, { hata: 'Önce video konusunu yaz' });
    const [, d] = taramaDosyasi(g.dosya);
    return yanit(200, await videoAnaliz.baslikUret(d, g.konu.trim(), parseInt(g.adet || 10, 10)));
  }
  if (yol === '/api/alt-konular') {
    const sorgular = (g.sorgular || []).map(s => s.trim()).filter(Boolean);
    if (!sorgular.length) return yanit(400, { hata: 'Önce en az bir konu yaz' });
    return yanit(200, await motor.altKonuOnerileri(sorgular, g.dil || 'en'));
  }
  if (yol === '/api/cevir') {
    const sorgular = (g.sorgular || []).map(s => s.trim()).filter(Boolean);
    return yanit(200, { diller: ARAMA_DILLERI, ceviriler: await sorguCevirileri(sorgular, Object.keys(ARAMA_DILLERI)) });
  }
  if (yol === '/api/hesaplar/oncelik') return yanit(200, hesaplar.aiOncelikYap(g.hizmet || ''));
  if (yol.startsWith('/api/hesaplar/')) {
    const islem = yol.split('/').pop(), hizmet = g.hizmet || 'apify';
    if (!hesaplar.HIZMETLER[hizmet]) return yanit(400, { hata: 'bilinmeyen hizmet' });
    if (islem === 'ekle') return yanit(200, await hesaplar.ekle(hizmet, g.token || '', g.ad || ''));
    if (islem === 'sil') return yanit(200, hesaplar.sil(hizmet, g.ad || ''));
    if (islem === 'aktif') return yanit(200, hesaplar.aktifYap(hizmet, g.ad || ''));
    if (islem === 'test') return yanit(200, await hesaplar.testEt(hizmet, g.ad || ''));
  }
  if (yol === '/api/hazir') {
    let liste = fs.existsSync(DOSYA.hazir) ? jsonOku(DOSYA.hazir) : [];
    liste = liste.filter(h => h.ad !== g.ad);
    if (!g.sil) liste.unshift({ ad: g.ad, parametre: g.parametre });
    fs.writeFileSync(DOSYA.hazir, JSON.stringify(liste, null, 1), 'utf8');
    return yanit(200, liste);
  }
  if (/^\/api\/grup(\/|$)/.test(yol)) return yanit(501, HENUZ_YOK);
  return yanit(404, { hata: 'bulunamadı' });
}

/** Sunucuyu başlatır; { adres, kapat } döndürür. port 0 = boş bir port seç. */
export function baslat(port = 0, kapatIstegi = () => {}) {
  const sunucu = http.createServer(async (istek, cevap) => {
    const u = new URL(istek.url, 'http://127.0.0.1');
    let y;
    try {
      if (istek.method === 'POST') {
        let govde = '';
        for await (const parca of istek) govde += parca;
        y = await post(u, govde ? JSON.parse(govde) : {}, kapatIstegi);
      } else {
        y = await get(u);
      }
    } catch (h) {
      if (h.kod !== 404) gunluk(`${istek.method} ${u.pathname}: ${h.stack || h}`);
      y = yanit(h.kod || 500, { hata: h.kod === 404 ? 'dosya yok' : String(h.message || h) });
    }
    const veri = Buffer.isBuffer(y.govde) ? y.govde : Buffer.from(typeof y.govde === 'string' ? y.govde : JSON.stringify(y.govde), 'utf8');
    cevap.writeHead(y.kod, { 'Content-Type': y.tur, 'Content-Length': veri.length, 'Cache-Control': 'no-store', ...y.ek });
    cevap.end(veri);
  });
  return new Promise((coz, reddet) => {
    sunucu.once('error', reddet);
    sunucu.listen(port, '127.0.0.1', () => coz({
      adres: `http://127.0.0.1:${sunucu.address().port}`,
      kapat: () => new Promise(c => { hepsiniKaydet(); sunucu.close(() => c()); sunucu.closeAllConnections?.(); }),
    }));
  });
}
