// scripts/arac-yolu.cjs — gelistirme betiklerinin calistirdigi dis araclarin (git, npm, npx, docker,
// zip, gitleaks, cygpath) MUTLAK yolu. Arac PATH'te ARANMAZ; yalniz sabit, sistemin yonettigi
// dizinlerde ve Node'un kendi kurulum dizininde (npm / npx onun yaninda) aranir.
//
// NEDEN (2026-11-18, kurumsal Sonar taklidi K15, kural S4036): komutu adiyla calistirmak PATH'teki
// ilk eslesmeyi calistirir; PATH'e yazilabilir bir dizin (./node_modules/.bin, kullanici dizini)
// girerse ayni adli baska bir program calisir. Kurumsal Sonar scripts/'i uretim kodu sayar ve bu
// cagrilari bulgu olarak gosterir. Duzeltme kuralin istedigi: araci sabit dizinden mutlak yolla
// calistirmak. Bulunamazsa sessizce PATH'e dusulmez; hangi dizinlere bakildigi soylenir.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Platforma gore guvenilir dizinler (sira onemli: ilk bulunan kullanilir). Saf islev. */
function dizinler({
  platform = process.platform,
  env = process.env,
  node = process.execPath,
} = {}) {
  const nodeDizini = (platform === 'win32' ? path.win32 : path.posix).dirname(node);
  if (platform === 'win32') {
    const pf = env.ProgramFiles || 'C:\\Program Files';
    const sys = env.SystemRoot || 'C:\\Windows';
    return [
      nodeDizini,
      path.win32.join(pf, 'Git', 'cmd'),
      path.win32.join(pf, 'Git', 'usr', 'bin'),
      path.win32.join(pf, 'Docker', 'Docker', 'resources', 'bin'),
      path.win32.join(sys, 'System32'),
    ];
  }
  return [nodeDizini, '/usr/bin', '/bin', '/usr/local/bin', '/opt/homebrew/bin'];
}

/** Windows'ta denenecek uzantilar; digerlerinde ad aynen. */
const uzantilar = (platform) => (platform === 'win32' ? ['.exe', '.cmd', ''] : ['']);

/**
 * Aracin mutlak yolu. Yoksa `zorunlu` ise hata, degilse null.
 * `var_` (test icin) dosya var mi denetimi; varsayilan: calistirilabilir dosya.
 */
function aracYolu(
  ad,
  {
    zorunlu = true,
    platform = process.platform,
    env = process.env,
    node = process.execPath,
    var_ = calistirilabilir,
  } = {},
) {
  if (!/^[a-z][a-z0-9-]*$/.test(ad)) throw new Error(`gecersiz arac adi: ${ad}`);
  if (ad === 'node') return node;
  const liste = dizinler({ platform, env, node });
  const birlestir = platform === 'win32' ? path.win32.join : path.posix.join;
  for (const d of liste)
    for (const u of uzantilar(platform)) {
      const yol = birlestir(d, ad + u);
      if (var_(yol)) return yol;
    }
  if (!zorunlu) return null;
  throw new Error(`${ad} guvenli dizinlerde bulunamadi (${liste.join(', ')})`);
}

function calistirilabilir(yol) {
  try {
    const s = fs.statSync(yol);
    if (!s.isFile()) return false;
    if (process.platform !== 'win32') fs.accessSync(yol, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Windows'ta .cmd araclari (npm, npx) kabuk ister ve kabuk komut yolunu tirnaklamaz: bosluklu yol
 * ("C:\Program Files\nodejs\npm.cmd") tirnaklanir. Digerlerinde yol aynen.
 */
function kabukIcin(yol, platform = process.platform) {
  return platform === 'win32' && /\s/.test(yol) ? `"${yol}"` : yol;
}

module.exports = { aracYolu, dizinler, kabukIcin };
