// Geliştirme için: programı Electron olmadan, yalnızca sunucu olarak çalıştırır.
//   node src/gelistirici.js [port]   → http://127.0.0.1:8770
// VIRAL_RADAR_VERI ortam değişkeniyle ayrı bir deneme klasörü kullanılabilir.
const { klasorleriHazirla, KOK } = await import('./cekirdek/yollar.js');
klasorleriHazirla();
const { baslat } = await import('./sunucu.js');
const port = Number(process.argv[2]) || 8770;
const s = await baslat(port, () => s.kapat().then(() => process.exit(0)));
console.log(`Viral Radar sunucusu: ${s.adres}  (veri: ${KOK})`);
