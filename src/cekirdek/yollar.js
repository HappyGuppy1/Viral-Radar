// Kullanıcı verisinin yeri: Belgeler\Viral Radar (StudioFlow'daki Documents\StudioFlow düzeniyle aynı mantık).
// Program kodu kurulum klasöründe, kullanıcı verisi ve API anahtarları burada durur; kaldırma işlemi veriye dokunmaz.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function belgeler() {
  // Electron çalışıyorsa onun "documents" yolunu kullan (OneDrive'a taşınmış Belgeler dahil); yoksa ev klasörü
  if (globalThis.__VR_BELGELER) return globalThis.__VR_BELGELER;
  return path.join(os.homedir(), 'Documents');
}

export const KOK = process.env.VIRAL_RADAR_VERI || path.join(belgeler(), 'Viral Radar');
export const AYARLAR = path.join(KOK, 'Ayarlar');
export const VERI = path.join(KOK, 'Veri');
export const ONBELLEK = path.join(KOK, 'Onbellek');
export const KAYITLAR = path.join(KOK, 'Kayitlar');

export const DOSYA = {
  hesaplar: path.join(AYARLAR, 'api-hesaplari.txt'),
  hazir: path.join(AYARLAR, 'hazir-sorgular.json'),
  taramalar: path.join(VERI, 'taramalar'),
  kanalAramalari: path.join(VERI, 'kanal_aramalari'),
  kanallar: path.join(VERI, 'kanallar'),
  gruplar: path.join(VERI, 'gruplar'),
  gunluk: path.join(KAYITLAR, 'viral-radar.log'),
};

export function klasorleriHazirla() {
  for (const k of [AYARLAR, VERI, ONBELLEK, KAYITLAR, DOSYA.taramalar, DOSYA.kanalAramalari, DOSYA.kanallar, DOSYA.gruplar]) {
    fs.mkdirSync(k, { recursive: true });
  }
  const oku = path.join(KOK, 'BENİ OKU.txt');
  if (!fs.existsSync(oku)) {
    fs.writeFileSync(oku, [
      'Viral Radar kullanıcı klasörü',
      '',
      'Ayarlar\\api-hesaplari.txt : API anahtarların (yalnızca bu bilgisayarda durur, kimseyle paylaşma).',
      'Ayarlar\\hazir-sorgular.json: kaydettiğin arama ayarları.',
      'Veri\\                     : taramalar, kanal aramaları, kanal analizleri ve karşılaştırmalar.',
      'Onbellek\\                 : YouTube verisinin geçici kopyası (silinebilir, yeniden oluşur).',
      'Kayitlar\\                 : program günlüğü (sorun bildirirken işe yarar).',
      '',
      'Programı kaldırmak bu klasörü silmez.',
    ].join('\r\n'), 'utf8');
  }
}

export function gunluk(mesaj) {
  try {
    fs.appendFileSync(DOSYA.gunluk, `${new Date().toISOString()}  ${mesaj}\n`, 'utf8');
  } catch { /* günlük yazılamazsa program durmasın */ }
}
