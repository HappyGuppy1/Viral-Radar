// Basit dosya önbelleği (motor.py Onbellek). Her kayıt `_t` (saniye) taşır; süresi geçen okunmaz,
// kaydederken süresinin 3 katından eski kayıtlar atılır.
import fs from 'node:fs';
import path from 'node:path';
import { ONBELLEK } from './yollar.js';

const TUM = [];

export class Onbellek {
  constructor(ad, ttlSaat) {
    this.yol = path.join(ONBELLEK, `${ad}.json`);
    this.ttl = ttlSaat * 3600;
    this.degisti = false;
    try { this.d = JSON.parse(fs.readFileSync(this.yol, 'utf8')); } catch { this.d = {}; }
    TUM.push(this);
  }

  al(anahtar) {
    const v = this.d[anahtar];
    return v && Date.now() / 1000 - (v._t || 0) < this.ttl ? v : null;
  }

  koy(anahtar, deger) {
    deger._t = Date.now() / 1000;
    this.d[anahtar] = deger;
    this.degisti = true;
  }

  kaydet() {
    if (!this.degisti) return;
    const simdi = Date.now() / 1000;
    const taze = Object.fromEntries(Object.entries(this.d).filter(([, v]) => simdi - (v._t || 0) < this.ttl * 3));
    fs.mkdirSync(path.dirname(this.yol), { recursive: true });
    const gecici = this.yol + '.gecici';
    fs.writeFileSync(gecici, JSON.stringify(taze), 'utf8');
    fs.renameSync(gecici, this.yol);
    this.degisti = false;
  }
}

export function hepsiniKaydet() {
  for (const o of TUM) {
    try { o.kaydet(); } catch { /* bir önbellek yazılamazsa diğerleri yine yazılsın */ }
  }
}
