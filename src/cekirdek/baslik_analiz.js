// Başlık analizi (baslik_analiz.py): hangi formül, tetikleyici, kalıp, kelime ve uzunluğun kanal normaline göre
// daha iyi çalıştığını ölçer. Ölçü: video sayısı, medyan kat (var/yok), kaldıraç = var ÷ yok,
// isabet = taşıyanların ≥2x olma oranı, güven (≥6 güçlü · 3-5 orta · 2 zayıf).
import { DURAKLAR, kelimeler, kucuk, medyan, Sayac, ure, yuvarla } from './metin.js';
import { aiUret } from './hesaplar.js';

export const SURUM = 2;
export const PATLAMA = 2.0;

const SAYI_SONRASI_DEGIL = String.raw`(?:gün|günlük|günde|ay|ayda|aylık|yıl|yıllık|saat|saatte|dakika|dakikada|dk|saniye|hafta|haftalık|tl|lira|dolar|euro|day|days|hour|hours|minutes?|mins?|seconds?|years?|months?|weeks?|k|m|bin|milyon|x|kat|cm|lt|litre|l)\b`;
const r = String.raw;
export const ETIKETLER = [
  ['Formül', 'Liste / sayılı', "Belirli sayıda madde: '7 balık', 'top 10'",
    r`(?<![\d.,%:])\b(?:[2-9]|[1-4]\d|50|100)\s+(?!${SAYI_SONRASI_DEGIL})[a-zçğıöşü]|\btop\s*\d+|\(\s*\d+\s*adet\s*\)`],
  ['Formül', 'Nasıl / rehber', 'Bir işi öğretiyor',
    r`\b(how to|how i|how we|guide|tutorial|step by step|setup|set up|nasıl|rehber\w*|adım adım|kurulum\w*|yapım\w*|bakım\w*|tüyo\w*|ipuç\w*|ipucu)\b`],
  ['Formül', 'Açıklama / neden', 'Bir şeyin nedenini/ne olduğunu anlatıyor',
    r`\b(why|what is|what are|explained|the reason|science|neden|niçin|niye|nedir|nelerdir|ne zaman|nereden|nerede|ne olur|nasıl oluşur)\b`],
  ['Formül', 'Soru', 'Başlık soru soruyor', r`\?|\b(m[ıiuü]|m[ıiuü]d[ıiuü]r|m[ıiuü]y[ıiuü]z)\b`],
  ['Formül', 'Karşılaştırma', 'İki şeyi kıyaslıyor',
    r`\bvs\.?\b|\bversus\b|\b(which is better|hangisi\w*|karşı|kıyas\w*|karşılaştır\w*|farkı|farkları)\b`],
  ['Formül', 'Deneme / meydan okuma', 'Bir şeyi deniyor, test ediyor',
    r`\b(i tried|we tried|tried|trying|tested|testing|test ettim|challenge|surviv\w*|for \d+ (?:days|hours|weeks)|denedim|denedik|deniyorum|deney\w*)\b`],
  ['Formül', 'Kişisel deneyim', "Birinci tekil/çoğul anlatım: 'yaptım', 'my', 'kendi'",
    r`\b(i|i'm|i've|my|we|we're|our|ben|benim|bizim|kendi\w*)\b|\b(?!(?:artık|açık|kayık|sıcak|yanık|kırık|bozuk)\b)\w{2,}(?:d|t)(?:ım|im|um|üm|ık|ik|uk|ük)\b|\b\w+(?:ıyor|iyor|uyor|üyor)(?:um|uz)\b|\b\w+l[ae]r[ıi]m\w*`],
  ['Formül', 'Dönüşüm / süreç', 'Önce-sonra, sıfırdan, gelişim günlüğü',
    r`\b(before|after|from (?:0|zero|scratch)|transform\w*|makeover|journey|progress|sıfırdan|baştan|öncesi|sonrası|dönüşüm\w*|gelişim\w*|son durum|\d+ (?:günlük|aylık|haftalık))\b`],
  ['Formül', 'Seri / bölüm', 'Seri parçası: part 2, bölüm 3, vlog',
    r`\b(part|bölüm|episode|ep|sezon|season)\s*\.?\s*(\d+|[ivx]+)\b|#\d+|\b(vlog|son part)\b`],
  ['Formül', 'Belgesel / hikâye', 'Tarih, köken, hikâye anlatımı',
    r`\b(story|stories|history|documentary|origin\w*|evolve\w*|tarih\w*|hikaye\w*|hikâye\w*|belgesel|köken\w*|anavatan\w*)\b`],
  ['Tetikleyici', 'Merak boşluğu', "Bilgiyi saklıyor: 'bu', 'sır', 'kimse bilmiyor', 'aslında'",
    r`\b(this|these|secret\w*|nobody|no one|hidden|what happens|here's why|you won't|surprising|unexpected|sır\w*|gizli\w*|kimse\w*|bilinmeyen|bilmediğiniz|aslında|meğer|işte|bu|bunu|bunlar\w*)\b`],
  ['Tetikleyici', 'Para / kazanç / fiyat', 'Para, kazanç, ucuz/pahalı, satış',
    r`(\$|₺|\btl\b|\blira\b|dolar|\beuro\b|\bmoney\b|\bprofit\w*|\bcheap\w*|\bexpensive\b|\bbudget\b|\bsell\w*|\bbusiness\b|\bincome\b|\bpara\w*|\bkazan\w*|\bucuz\w*|\bpahalı\w*|\bsat(?:tık|tım|mak|ış\w*|ıyor\w*)\b|\bbedava\b|\bücretsiz\b|\bmaliyet\w*|\bfiyat\w*|\bbütçe\w*)`],
  ['Tetikleyici', 'Uyarı / hata / korku', 'Kayıptan kaçınma: hata, sakın, dikkat, tehlike',
    r`\b(mistakes?|don'?t|never|stop|avoid|warning|danger\w*|deadly|kills?|killed|wrong|worst|scam\w*|problem\w*|hata\w*|yapmayın|sakın|asla|dikkat|tehlike\w*|ölüm\w*|öldür\w*|kötü|dolandırıcı\w*|zarar\w*|boşa|sorun\w*|kriz\w*|felaket\w*|son!?)\b`],
  ['Tetikleyici', 'Üstünlük / uç değer', 'En iyi/kötü/pahalı, dünyanın en…, ilk, rekor',
    r`\b(best|worst|top|most|biggest|largest|smallest|ultimate|perfect|cheapest|rarest|world'?s|record|first|en \w+|dünyanın|rekor\w*|ilk)\b`],
  ['Tetikleyici', 'Şaşkınlık / duygu', 'Güçlü duygu kelimesi: inanılmaz, şok, sonunda',
    r`\b(insane|crazy|shocking|shocked|unbelievable|amazing|incredible|wow|omg|finally|explosion|nonstop|inanılmaz|şok\w*|çılgın\w*|muhteşem|harika|efsane\w*|sonunda|nihayet|vay|patlama\w*)\b`],
  ['Tetikleyici', 'Gerçek / efsane yıkma', 'Doğru sanılanı düzeltiyor: gerçek, yanlış, aslında',
    r`\b(truth|real|really|actually|myths?|facts?|lies?|honest\w*|gerçek\w*|yanlış\w*|doğru bilinen|yalan\w*|aslında)\b`],
  ['Tetikleyici', 'Yenilik / aciliyet', 'Yeni, artık, yıl, şimdi',
    r`\b(20\d\d|new|now|today|latest|update\w*|yeni|artık|şimdi|hemen|güncel\w*|bugün)\b`],
  ['Tetikleyici', 'Kolaylık / hız', 'Kolay, basit, hızlı, kısa sürede',
    r`\b(easy|easiest|simple|quick\w*|fast\w*|instant\w*|in \d+ (?:min\w*|second\w*|day\w*)|kolay\w*|basit\w*|pratik|hızlı\w*|kısa sürede|zahmetsiz|\d+ dakikada|\d+ günde)\b`],
  ['Tetikleyici', 'Sonuç / kanıt vaadi', 'Kesin sonuç, işe yarayan, yüzde, çözüm',
    r`(\d+\s*%|%\s*\d+|\b(proven|guaranteed|works?|results?|that actually|işe yarayan|kesin\w*|garanti\w*|sonuç\w*|çözüm\w*|kanıt\w*|\d+ kat)\b)`],
  ['Tetikleyici', 'Hedef kitle hitabı', 'İzleyiciye/kitleye doğrudan seslenme: sen/siz, yeni başlayanlar',
    r`\b(you|your|you're|beginners?|newbies?|sen|senin|siz|sizin|yeni başlayan\w*|acemi\w*|herkes\w*|\w+(?:sınız|siniz|sunuz|sünüz|ınız|iniz|unuz|ünüz)\w*)\b`],
];
const EMOJI = /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u;
const BUYUK_KELIME = ure(r`\b[A-ZÇĞİÖŞÜ]{3,}\b`);
export const YAPILAR = [
  ['Yapı', 'Ünlem !', 'Başlıkta ünlem var', t => t.includes('!')],
  ['Yapı', 'Ayraç ( | - : )', 'İki parçalı başlık: ana vaat + ek', t => /\s[|\-–—]\s|\S:\s|\|/.test(t)],
  ['Yapı', 'Parantez eki', 'Sonda/arada (...) veya [...] eki', t => /[(\[][^)\]]+[)\]]/.test(t)],
  ['Yapı', 'Tamamı BÜYÜK HARF', 'Başlığın neredeyse tamamı büyük harf', t => buyukOrani(t) >= 0.85],
  ['Yapı', 'Vurgu kelimesi BÜYÜK', 'Bir-iki kelime büyük harfle vurgulanmış', t => buyukOrani(t) < 0.85 && BUYUK_KELIME.test(t)],
  ['Yapı', 'Emoji', 'Başlıkta emoji var', t => EMOJI.test(t)],
  ['Yapı', 'Rakam', 'Başlıkta rakam var', t => /\d/.test(t)],
];
const KARAKTER_DILIM = [['≤ 40 karakter', 0, 41], ['41–60', 41, 61], ['61–80', 61, 81], ['80+', 81, 1e6]];
const KELIME_DILIM = [['≤ 6 kelime', 0, 7], ['7–9', 7, 10], ['10–12', 10, 13], ['13+', 13, 1e6]];
const DERLI = ETIKETLER.map(([g, a, ac, d]) => [g, a, ac, ure(d, 'i')]);

function buyukOrani(t) {
  const harf = [...t].filter(c => /\p{L}/u.test(c));
  return harf.length >= 8 ? harf.filter(c => c !== c.toLowerCase() && c === c.toUpperCase()).length / harf.length : 0;
}

const med = l => { const m = medyan(l); return m === null ? null : yuvarla(m, 2); };

/** Başlığın taşıdığı tüm etiketler (çok etiketli). */
export function ozellikler(baslik) {
  const k = kucuk(baslik);
  return [...DERLI.filter(([, , , d]) => d.test(k)).map(x => x[1]), ...YAPILAR.filter(([, , , f]) => f(baslik)).map(x => x[1])];
}

export const ornek = v => ({ baslik: v.baslik, skor: v.skor ?? null, link: v.link ?? null, izlenme: v.izlenme ?? null, kanal: v.kanal ?? null });

/** Bir özelliği taşıyan videolar (var) ↔ taşımayanlar. */
export function olcu(varL, tum) {
  const idler = new Set(varL.map(v => v.id));
  const yok = tum.filter(v => !idler.has(v.id));
  const mv = med(varL.map(v => v.skor)), my = med(yok.map(v => v.skor));
  const n = varL.length;
  const sirali = [...varL].sort((a, b) => b.skor - a.skor);
  return {
    video: n, pay: tum.length ? Math.round(100 * n / tum.length) : 0,
    kanal: new Set(varL.map(v => v.kanal_id).filter(Boolean)).size,
    kat_var: mv, kat_yok: my, kaldirac: mv !== null && my ? yuvarla(mv / my, 2) : null,
    isabet: n ? Math.round(100 * varL.filter(v => v.skor >= PATLAMA).length / n) : null,
    patlayan: varL.filter(v => v.skor >= PATLAMA).length,
    guven: n >= 6 ? 'güçlü' : n >= 3 ? 'orta' : 'zayıf',
    ornekler: sirali.slice(0, 4).map(ornek), en_kotu: n >= 3 ? ornek(sirali.at(-1)) : null,
  };
}

const GUVEN = { 'güçlü': 0, orta: 1, 'zayıf': 2 };
export const siraKarsilastir = (a, b) => GUVEN[a.guven] - GUVEN[b.guven] || (b.kaldirac || 0) - (a.kaldirac || 0);

/** Başlıkların ≥%30'unda geçen kelimeler kanalın konusudur (kalıp değil). */
function konuKelimeleri(videolar) {
  const say = new Sayac();
  for (const v of videolar) for (const w of new Set(kelimeler(v.baslik))) if (!DURAKLAR.has(w) && w !== 'N') say.ekle(w);
  const esik = Math.max(3, 0.3 * videolar.length);
  return new Set([...say].filter(([, c]) => c >= esik).map(([w]) => w));
}

const kumeEsit = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
const ekle = (m, k, id) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(id); };

function kaliplar(videolar, konu, minVideo, minKanal = 1) {
  const gruplar = new Map(), bas = new Map(), son = new Map(), ek = new Map();
  const dolgu = w => konu.has(w) || DURAKLAR.has(w) || w === 'N';
  const EK = /(?:\s[|\-–—]\s|\|)\s*([^|\-–—]+)$|([(\[][^)\]]+[)\]])\s*[!?.]*\s*$/;
  for (const v of videolar) {
    const k = kelimeler(v.baslik);
    for (const n of [2, 3, 4, 5]) {
      for (let i = 0; i + n <= k.length; i++) {
        const g = k.slice(i, i + n);
        if (DURAKLAR.has(g[0]) && DURAKLAR.has(g.at(-1))) continue;
        if (g.every(dolgu)) continue; // yalnızca konu/dolgu kelimesinden oluşuyor
        ekle(gruplar, g.join(' '), v.id);
      }
    }
    if (k.length >= 4) {
      ekle(bas, k.slice(0, 2).join(' '), v.id); ekle(bas, k.slice(0, 3).join(' '), v.id);
      ekle(son, k.slice(-2).join(' '), v.id); ekle(son, k.slice(-3).join(' '), v.id);
    }
    const m = v.baslik.match(EK);
    if (m) ekle(ek, kucuk((m[1] || m[2]).trim()).replace(/\d+/g, 'N'), v.id);
  }
  const sozluk = new Map(videolar.map(v => [v.id, v]));
  const topla = d => {
    const kumeler = [];
    for (const [g, ids] of [...d].sort((a, b) => b[0].length - a[0].length)) { // aynı kümeyi kapsayan daha uzun kalıp varsa kısayı at
      if (ids.size >= minVideo && !kumeler.some(([sg, s]) => kumeEsit(ids, s) && sg.includes(g))) kumeler.push([g, ids]);
    }
    return kumeler.map(([g, ids]) => ({ kalip: g, ...olcu([...ids].map(i => sozluk.get(i)), videolar) }))
      .filter(x => x.kanal >= minKanal || !x.kanal) // çoklu analizde tek kanalın alışkanlığı niş kalıbı değildir
      .sort(siraKarsilastir);
  };
  return { genel: topla(gruplar).slice(0, 40), baslangic: topla(bas).slice(0, 15), bitis: topla(son).slice(0, 15), ek: topla(ek).slice(0, 15) };
}

function kelimeEtkisi(videolar, konu, minKanal = 1) {
  const gruplar = new Map();
  for (const v of videolar) for (const w of new Set(kelimeler(v.baslik))) if (!DURAKLAR.has(w) && w !== 'N' && [...w].length >= 3) ekle(gruplar, w, v.id);
  const sozluk = new Map(videolar.map(v => [v.id, v]));
  let l = [...gruplar].filter(([, ids]) => ids.size >= 3 && ids.size < videolar.length)
    .map(([w, ids]) => ({ kelime: w, konu: konu.has(w), ...olcu([...ids].map(i => sozluk.get(i)), videolar) }))
    .filter(x => x.kaldirac !== null && (x.kanal >= minKanal || !x.kanal));
  for (const x of l) { delete x.en_kotu; x.ornekler = x.ornekler.slice(0, 2); }
  return {
    guclendiren: l.filter(x => x.kaldirac >= 1.25).sort((a, b) => b.kaldirac - a.kaldirac).slice(0, 25),
    zayiflatan: l.filter(x => x.kaldirac <= 0.8).sort((a, b) => a.kaldirac - b.kaldirac).slice(0, 25),
  };
}

const dilimler = (videolar, olc, d) => d.map(([ad, a, b]) => {
  const l = videolar.filter(v => a <= olc(v) && olc(v) < b);
  return { ad, video: l.length, kat: med(l.map(v => v.skor)), isabet: l.length ? Math.round(100 * l.filter(v => v.skor >= PATLAMA).length / l.length) : null };
});

/** olgun: en az 7 günlük, skoru olan videolar. minKanal: kalıp/kelimenin en az kaç farklı kanalda geçmesi gerektiği. */
export function analiz(olgun, minKanal = 1) {
  const videolar = olgun.filter(v => v.skor !== null && v.skor !== undefined && v.baslik);
  if (videolar.length < 5) return { surum: SURUM, yetersiz: true, n: videolar.length };
  for (const v of videolar) v.baslik_ozellik = ozellikler(v.baslik);
  const konu = konuKelimeleri(videolar);
  const etiketler = [];
  for (const [grup, ad, aciklama] of [...ETIKETLER, ...YAPILAR]) {
    const varL = videolar.filter(v => v.baslik_ozellik.includes(ad));
    if (varL.length) etiketler.push({ grup, ad, aciklama, ...olcu(varL, videolar) });
  }
  etiketler.sort(siraKarsilastir);
  const etiketAdlari = ETIKETLER.map(e => e[1]);
  const etiketsiz = videolar.filter(v => !etiketAdlari.some(e => v.baslik_ozellik.includes(e)));
  const minVideo = videolar.length < 60 ? 2 : 3;
  const patlayan = videolar.filter(v => v.skor >= PATLAMA);
  const kal = kaliplar(videolar, konu, minVideo, minKanal);
  const karakter = dilimler(videolar, v => [...v.baslik].length, KARAKTER_DILIM);
  const kelimeN = dilimler(videolar, v => kelimeler(v.baslik).length, KELIME_DILIM);
  const guclu = etiketler.filter(e => e.guven !== 'zayıf' && (e.kaldirac || 0) > 1.1);
  const uygunDilim = karakter.filter(d => d.video >= 3);
  return {
    surum: SURUM, n: videolar.length, patlayan: patlayan.length,
    patlama_orani: Math.round(100 * patlayan.length / videolar.length),
    konu_kelimeleri: [...konu].sort(),
    etiketler, etiketsiz: etiketsiz.length,
    kaliplar: kal,
    kelimeler: kelimeEtkisi(videolar, konu, minKanal),
    uzunluk: { karakter, kelime: kelimeN, patlayan_medyan: med(patlayan.map(v => [...v.baslik].length)), tum_medyan: med(videolar.map(v => [...v.baslik].length)) },
    ozet: {
      en_guclu: guclu.slice(0, 3).map(e => ({ ad: e.ad, kaldirac: e.kaldirac, video: e.video })),
      en_zayif: etiketler.filter(e => e.guven !== 'zayıf' && (e.kaldirac ?? 9) < 0.9).sort((a, b) => a.kaldirac - b.kaldirac).slice(0, 3)
        .map(e => ({ ad: e.ad, kaldirac: e.kaldirac, video: e.video })),
      en_iyi_kalip: (k => (k ? { kalip: k.kalip, kaldirac: k.kaldirac, video: k.video } : null))(kal.genel.find(k => (k.kaldirac || 0) > 1)),
      en_iyi_uzunluk: uygunDilim.length ? uygunDilim.reduce((m, d) => ((d.kat || 0) > (m.kat || 0) ? d : m)) : null,
    },
  };
}

// ---------------------------------------------------------------- yapay zekâ derin analizi + başlık üretici
export async function geminiAnaliz(d) {
  const olgun = d.videolar.filter(v => (v.yas_gun || 0) >= 7);
  const l = olgun.filter(v => v.skor !== null && v.skor !== undefined && v.baslik).slice(0, 160);
  const liste = l.map((v, i) => ({ i, baslik: v.baslik, kat: v.skor }));
  if (l.length < 5) throw new Error('Yapay zekâ analizi için en az 5 olgun video gerekli');
  const istem = `Bir YouTube kanalının (${d.genel?.ad}) başlıklarını analiz et. Her başlığın 'kat' değeri, videonun kanalın ` +
    'normal izlenmesinin kaç katı yaptığıdır (1 = normal, 2+ = patlamış, 0.5 = normalin yarısı).\n' +
    'Amaç: Bu nişte video üretecek biri için hangi başlık FORMÜLLERİNİN, ALT KONULARIN ve PSİKOLOJİK TETİKLEYİCİLERİN ' +
    'işe yaradığını çıkarmak. Konuyu değil, tekrar kullanılabilir yapıyı bul.\n' +
    'Kurallar:\n' +
    "- formuller: başlıklardaki TEKRAR EDEN yapıları GENELLENMİŞ, yer tutuculu şablon olarak yaz (ör. '[Kitle] İçin En [İyi/Kötü] [N] [Konu]!', " +
    "'[Konu] ile Para Kazanılır mı? [Gerçek vaadi]!', '[Konu] Neden Bu Kadar [Sıfat]? | [Seri adı]'). Tek bir başlığın kopyası formül DEĞİLDİR: " +
    'şablon, kanaldaki EN AZ 3 başlığa uymalı (farklı konularla). Her formüle uyan TÜM başlıkların i numaralarını ver (hem başarılı hem başarısız ' +
    'olanlar; performansı biz hesaplayacağız). Şablonu başlıkların diliyle yaz. 5-12 formül; başarılı ve başarısız formülleri birlikte kapsa.\n' +
    '- alt_konular: başlıkları içerik alt konusuna göre 4-12 kümeye ayır (Türkçe kısa ad). Her başlık tam olarak bir kümede olsun.\n' +
    '- tetikleyiciler: başarılı başlıklarda öne çıkan duygu/vaat (merak, para, korku, üstünlük, kolaylık, kimlik/hedef kitle...), ' +
    'her biri için kısa Türkçe açıklama ve örnek i numaraları. 3-8 madde.\n' +
    '- kacinilacaklar: normalin altında kalan başlıkların ortak özellikleri, örnek i numaralarıyla. 2-6 madde.\n' +
    '- kurallar: bu nişte başlık yazarken uygulanacak 5-8 net, uygulanabilir Türkçe kural.\n' +
    '- ozet: 2-3 cümlelik Türkçe özet.\n' +
    'Yalnızca JSON döndür: {"formuller":[{"sablon":"","aciklama":"","idler":[0]}],"alt_konular":[{"ad":"","idler":[0]}],' +
    '"tetikleyiciler":[{"ad":"","aciklama":"","idler":[0]}],"kacinilacaklar":[{"madde":"","idler":[0]}],"kurallar":[""],"ozet":""}\n\n' +
    JSON.stringify(liste);
  const [yanit, kaynak] = await aiUret(istem, 0.2);
  if (!yanit || typeof yanit !== 'object' || Array.isArray(yanit)) throw new Error('Yapay zekâ beklenen biçimde yanıt vermedi');
  const bagla = x => {
    const ids = [...new Set((x.idler || []).filter(i => Number.isInteger(i) && i >= 0 && i < l.length))].sort((a, b) => a - b);
    const o = ids.length ? olcu(ids.map(i => l[i]), l) : { video: 0 };
    delete o.en_kotu;
    return o;
  };
  const nesneler = a => (Array.isArray(a) ? a : []).filter(x => x && typeof x === 'object');
  const sonuc = {
    kaynak, n: l.length,
    formuller: nesneler(yanit.formuller).map(f => ({ sablon: String(f.sablon ?? ''), aciklama: String(f.aciklama ?? ''), ...bagla(f) }))
      .filter(x => x.video >= 2).sort((a, b) => (a.guven === 'zayıf') - (b.guven === 'zayıf') || (b.kat_var || 0) - (a.kat_var || 0)),
    alt_konular: nesneler(yanit.alt_konular).map(k => ({ ad: String(k.ad ?? ''), ...bagla(k) })).sort((a, b) => (b.kat_var || 0) - (a.kat_var || 0)),
    tetikleyiciler: nesneler(yanit.tetikleyiciler).map(t => ({ ad: String(t.ad ?? ''), aciklama: String(t.aciklama ?? ''), ...bagla(t) })),
    kacinilacaklar: nesneler(yanit.kacinilacaklar).map(t => ({ madde: String(t.madde ?? ''), ...bagla(t) })),
    kurallar: (Array.isArray(yanit.kurallar) ? yanit.kurallar : []).map(String).slice(0, 10),
    ozet: String(yanit.ozet || ''),
  };
  for (const k of nesneler(yanit.alt_konular)) for (const i of k.idler || []) if (Number.isInteger(i) && i >= 0 && i < l.length) l[i].alt_konu = String(k.ad ?? '');
  return sonuc;
}

export async function baslikUret(d, konu, adet = 10) {
  const b = d.baslik || {}, g = b.gemini || {};
  const olgun = d.videolar.filter(v => v.skor !== null && v.skor !== undefined && (v.yas_gun || 0) >= 7).sort((a, c) => c.skor - a.skor);
  const formuller = (g.formuller || []).slice(0, 10).map(f => ({ sablon: f.sablon, kat: f.kat_var }));
  const tetik = (b.etiketler || []).filter(e => e.guven !== 'zayıf').slice(0, 12).map(e => ({ ad: e.ad, kaldirac: e.kaldirac }));
  const istem = `Video konusu: ${konu}\n` +
    `Aşağıda bir YouTube kanalının (${d.genel?.ad}) en çok patlayan başlıkları (kat = normalin kaç katı), ` +
    'kanıtlanmış başlık formülleri ve tetikleyici etiketlerinin kaldıraçları (1\'den büyük = işe yarıyor) var.\n' +
    `Bu verilere dayanarak konu için ${adet} farklı YouTube başlığı öner. Başlıkların dili, kanalın başlıklarının çoğunluğunun dili olsun. ` +
    'Kaldıracı yüksek tetikleyicileri ve en yüksek katlı formülleri kullan, kaldıracı 1\'in altında olanlardan kaçın. ' +
    'Her öneri için hangi formül/tetikleyiciyi kullandığını ve kısa Türkçe gerekçe yaz. Clickbait yalan vaat kullanma.\n' +
    'Yalnızca JSON: {"oneriler":[{"baslik":"","formul":"","gerekce":""}]}\n\n' +
    JSON.stringify({ en_iyi_basliklar: olgun.slice(0, 25).map(v => ({ baslik: v.baslik, kat: v.skor })), formuller, tetikleyiciler: tetik });
  const [yanit, kaynak] = await aiUret(istem, 0.7);
  const oneriler = (Array.isArray(yanit) ? yanit : yanit?.oneriler) || [];
  return { kaynak, konu, oneriler: oneriler.filter(o => o && typeof o === 'object')
    .map(o => ({ baslik: String(o.baslik ?? ''), formul: String(o.formul ?? ''), gerekce: String(o.gerekce ?? ''), ozellik: ozellikler(String(o.baslik ?? '')) })) };
}
