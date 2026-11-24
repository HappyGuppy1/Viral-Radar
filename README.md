# Viral Radar

Küçük kanallarda, kanalın kendi normalinin çok üstüne çıkan ("patlayan") YouTube videolarını bulan,
o konuda içerik üreten kanalları keşfeden ve kanalları analiz eden masaüstü programı.

> **Sürüm 0.1 (ilk sürüm).** Windows için. Hata bulursan bir [issue](https://github.com/HappyGuppy1/Viral-Radar/issues) aç;
> **Belgeler\Viral Radar\Kayitlar\viral-radar.log** dosyasını eklersen sorunu bulmak kolaylaşır.

## Kurulum

1. [Releases](https://github.com/HappyGuppy1/Viral-Radar/releases) sayfasından son sürümün
   **`Viral-Radar-Setup-x.y.z.exe`** dosyasını indir.
2. Çift tıkla, kurulumu tamamla. Masaüstüne ve Başlat menüsüne **Viral Radar** kısayolu gelir.

İlk açılışta program, kendi klasörünü **Belgeler\Viral Radar** altında oluşturur:

| Klasör | İçinde ne var |
|---|---|
| `Ayarlar\api-hesaplari.txt` | API anahtarların. Yalnızca bu bilgisayarda durur; kimseyle paylaşma. |
| `Ayarlar\hazir-sorgular.json` | Kaydettiğin arama ayarları |
| `Veri\` | Kaydettiğin taramalar ve analizler |
| `Onbellek\` | YouTube verisinin geçici kopyası (silinebilir) |
| `Kayitlar\` | Program günlüğü (sorun bildirirken işe yarar) |

Programı kaldırmak bu klasörü silmez.

## Ne yapar?

**Keşfet**

- **Viral videolar:** Konuya göre arar, her videonun izlenmesini kanalının son 30 videosunun medyanıyla
  karşılaştırır. Normalin en az N katı izlenenleri listeler: kapak, kat, abone, izlenme/saat,
  beğeni oranı, şüpheli durum uyarıları, ilk 60 saniyenin metni (kanca) ve transkript.
  **Başlık analizi** sekmesi patlayan başlıklardaki tarzları, tekrar eden ifadeleri ve kelimeleri çıkarır.
- **Kanal bul:** Bir konuda video üreten kanalları bulur: kanal araması, konudaki videoların kanalları ve son ayın
  yeni videoları. Abone aralığı, aktiflik (son yükleme), medyan izlenme, konu odağı ve ülkeye göre süzer;
  neden elendiklerini de gösterir. Seçtiğin kanalları tek tıkla karşılaştırmaya gönderebilirsin.

**Analiz et**

- **Kanal analizi:** Tek bir kanalın genel bakışı, tüm videoları (kanal normaline göre kat), gidişatı,
  gün×saat yükleme düzeni, başlık tarzları ve kalıpları, içerik (süre, etiket, bölüm, sponsor izleri),
  izleyici (en çok tekrar izlenen anlar, en beğenilen yorumlar) ve zamanla büyümesi.
- **Kanal karşılaştır:** 2–300 kanalı tek tek analiz edip birleştirir: kanalların çoğunda işe yarayan başlık
  tarzları, birden çok kanalda tutan ifadeler ve kelimeler, süre ve gün etkisi, konu dışı videoların ayıklanması.

**Kayıtlar:** "Raporu kaydet" dediğin tüm sonuçlar tek listede. Program her açılışta boş başlar.

YouTube verisi için **API anahtarı gerekmez**. Anahtarlar yalnızca isteğe bağlı yapay zekâ özellikleri
(alt konu önerisi, konu kontrolü, başlık derin analizi) ve transkript yedeği için kullanılır.

## API hesapları (isteğe bağlı)

Programın sağ üstündeki ayar simgesinden eklenir. Her anahtar kaydedilmeden önce denenir.

| Hizmet | Ne için |
|---|---|
| EVREN (DeepSeek) | Yapay zekâ işleri |
| Gemini | Yapay zekâ işleri |
| Cloudflare Workers AI | Yapay zekâ işleri (Account ID + token) |
| Apify | YouTube altyazıyı engellediğinde transkript yedeği |

Yapay zekâ işleri **yalnızca seçtiğin hizmetle ve tek modelle** yapılır; o hizmet yanıt vermezse başka
hizmete geçilmez. Aynı hizmete birden çok hesap eklersen kotası dolanın yerine sıradaki kullanılır.

## Geliştirme

[Node.js](https://nodejs.org/) 22 veya üstü gerekir.

```
npm install
npm run baslat      # programı geliştirme kipinde açar
npm run sunucu      # yalnızca yerel sunucu: http://127.0.0.1:8770
npm run paketle     # dist\Viral-Radar-Setup-x.y.z.exe üretir
```

| Dosya | Görev |
|---|---|
| `src/main.js` | Electron: kullanıcı klasörü, yerel sunucu, pencere |
| `src/sunucu.js` | Yerel sunucu (yalnızca 127.0.0.1); arayüzün çağırdığı adresler |
| `src/arayuz/index.html` | Arayüz (tek dosya) |
| `src/cekirdek/youtube.js` | YouTube verisi ([youtubei.js](https://github.com/LuanRT/YouTube.js)) |
| `src/cekirdek/motor.js` | Viral video taraması: arama, kanal tabanı, skor, ayrıntı, uyarılar, desenler |
| `src/cekirdek/video_analiz.js` | Taramanın analizi ve sade özeti |
| `src/cekirdek/baslik_analiz.js` | Başlık tarzları, kalıplar, kelimeler; yapay zekâ derin analizi |
| `src/cekirdek/kanal_ara.js` | Kanal bul |
| `src/cekirdek/kanal.js` | Kanal analizi |
| `src/cekirdek/grup.js` | Kanal karşılaştır |
| `src/cekirdek/hesaplar.js` | API hesapları ve yapay zekâ çağrıları |

Çekirdek (`src/cekirdek/`) Electron'a bağlı değildir; ileride aynı kodla telefon sürümü yapılabilmesi için
ayrı tutulur.

## Lisans

[MIT](LICENSE). YouTube verisi [youtubei.js](https://github.com/LuanRT/YouTube.js) (MIT) ile okunur.
Viral Radar YouTube veya Google ile bağlantılı değildir.
