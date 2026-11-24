// grup.py'deki, birden çok modülün kullandığı yazım yardımcıları ve dolgu kelime listeleri.

/** 3.456 → "3,5 katı", 12.3 → "12 katı" */
export const kat = x => (x < 10 ? x.toFixed(1).replace('.', ',') : x.toFixed(0)) + ' katı';

/** Kaldıraç → okunur cümle parçası: 1,28 → '%28 daha fazla', 0,91 → '%9 daha az'. */
export function fark(k) {
  if (k >= 2) return `${kat(k).replace(' katı', '')} kat daha fazla`;
  return `%${Math.round(Math.abs(k - 1) * 100)} daha ${k >= 1 ? 'fazla' : 'az'}`;
}

export const kucukBas = m => (m ? ({ 'İ': 'i', I: 'ı' }[m[0]] || m[0].toLowerCase()) + m.slice(1) : m);

export const sayiYaz = x => (typeof x === 'number' ? Math.round(x).toLocaleString('tr-TR') : '–');

export const SOZLUK_DISI = new Set(`que para como con los las del por una com dos das der die und mit ein eine den von dem new how what
dan ang sa ng mga yang dengan untuk ini itu ist auf vom zum zur fur für pra uma meu minha mais muy más nos este esta esto
son sus all day part video videos vlog shorts short live update first best top here's every most need make full
beautiful blue black white wild easy world step room small big amazing stunning rare premium quality mini community collection
episode tips explained colorful yeni parte cómo semana`.split(/\s+/));

// başlıkta konu taşımayan dolgu kelimeler (çok dilli): kelime analizinde sayılmaz
export const DOLGU = new Set([...SOZLUK_DISI, ...`não mais todos todas tudo isso esse essa ele ela seu sua muito como porque cuando donde quien
only just really very much more less also even still again ever never always some any other another same each own
videos channel subscribe like comment share coming soon today tomorrow yesterday now here there this that these those
will would could should can may might must let get got have has had being doing going make made want see look
und oder aber nicht auch noch nur sehr mehr wie was wer wir ihr sie ich mein dein unser bir şey çok daha bile ama veya
yang dan atau tidak ini itu ke di dari ang mga ng sa na ko mo`.split(/\s+/)]);
