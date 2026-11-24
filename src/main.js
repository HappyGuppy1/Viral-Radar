// Electron ana süreci: kullanıcı klasörünü hazırlar, yerel sunucuyu başlatır, pencereyi açar.
import { app, BrowserWindow, Menu, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = path.dirname(fileURLToPath(import.meta.url));
let pencere = null, sunucu = null;

if (!app.requestSingleInstanceLock()) {
  app.quit(); // program zaten açık: ikinci kopya açılmaz, var olan pencere öne gelir
} else {
  app.on('second-instance', () => {
    if (!pencere) return;
    if (pencere.isMinimized()) pencere.restore();
    pencere.focus();
  });

  app.whenReady().then(async () => {
    // Belgeler klasörü (OneDrive'a taşınmışsa onun yolu) yollar.js yüklenmeden önce bildirilmeli
    globalThis.__VR_BELGELER = app.getPath('documents');
    const { klasorleriHazirla, gunluk } = await import('./cekirdek/yollar.js');
    klasorleriHazirla();
    process.on('uncaughtException', h => gunluk(`Yakalanmayan hata: ${h.stack || h}`));
    process.on('unhandledRejection', h => gunluk(`Yakalanmayan söz: ${h?.stack || h}`));

    const { baslat } = await import('./sunucu.js');
    sunucu = await baslat(0, () => app.quit());

    Menu.setApplicationMenu(null);
    pencere = new BrowserWindow({
      width: 1440, height: 900, minWidth: 900, minHeight: 600, show: false,
      backgroundColor: '#010102', title: 'Viral Radar', icon: path.join(KOK, 'arayuz', 'viral-radar.ico'),
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    pencere.once('ready-to-show', () => pencere.show());
    // YouTube ve diğer dış bağlantılar varsayılan tarayıcıda açılır; program penceresi yalnızca kendi sayfasını gösterir
    pencere.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    pencere.webContents.on('will-navigate', (olay, url) => {
      if (!url.startsWith(sunucu.adres)) { olay.preventDefault(); shell.openExternal(url); }
    });
    await pencere.loadURL(sunucu.adres);
  });

  app.on('window-all-closed', () => app.quit());

  // kapanırken önbelleği kaydet, sunucuyu durdur
  app.on('before-quit', olay => {
    if (!sunucu) return;
    const s = sunucu;
    sunucu = null;
    olay.preventDefault();
    s.kapat().finally(() => app.quit());
  });
}
