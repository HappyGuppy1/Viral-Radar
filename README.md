# Viral Radar

Küçük kanallarda, kanalın kendi normalinin çok üstüne çıkan ("patlayan") YouTube videolarını bulan,
o konuda içerik üreten kanalları keşfeden ve kanalları analiz eden masaüstü programı.

> **Sürüm 0.1 (erken sürüm).** Şu an **Viral videolar** ve **Kayıtlar** çalışıyor.
> Kanal bul, Kanal analizi ve Kanal karşılaştır bir sonraki sürümde geliyor.

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
- **Kanal bul:** *(yakında)* bir konuda video üreten kanalları bulur ve filtreler.

**Analiz et** *(yakında)*

- **Kanal analizi:** tek bir kanalın performansı, yayın düzeni, başlıkları, izleyicisi ve büyümesi.
- **Kanal karşılaştır:** birden çok kanalın ortak başlık kalıpları ve kanal kanal karşılaştırma.

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
| `src/cekirdek/hesaplar.js` | API hesapları ve yapay zekâ çağrıları |

Çekirdek (`src/cekirdek/`) Electron'a bağlı değildir; ileride aynı kodla telefon sürümü yapılabilmesi için
ayrı tutulur.

## Lisans

[MIT](LICENSE). YouTube verisi [youtubei.js](https://github.com/LuanRT/YouTube.js) (MIT) ile okunur.
Viral Radar YouTube veya Google ile bağlantılı değildir.
