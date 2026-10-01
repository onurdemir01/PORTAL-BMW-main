// server/ansible/__tests__/fixtures/kabuk.cjs
//
// KABUK BETIKLERINI KOSTURAN BEKCILER ICIN PLATFORM KOPRUSU.
//
// Betikler uretimde Linux'ta kosar; bekciler gelistirici makinesinde de kosmak
// zorunda (bkz. "Bekciler platformdan bagimsiz olmali"). Windows'ta bash Git
// Bash/MSYS2'dir ve uc varsayim sessizce patlar:
//
//   1. `/bin/bash` NODE icin yoktur. Cygwin ad uzayinda vardir ama
//      `spawnSync('/bin/bash')` Windows'ta ENOENT verir: `status` 0 yerine
//      `null` doner. `assert.equal(r.status, 0)` "null !== 0" diye duser ve
//      bekci neyi korudugunu degil harness'i anlatir.
//   2. ':' ILE BIRLESTIRILEN WINDOWS YOLLARI. `C:\a:C:\b` cygwin'e POSIX
//      listesi gibi gorunur; ilk oge donusturulur, SONRAKI her oge `C` ve
//      `\a` diye IKIYE boler. Bir dizin eklenince kaza fark edilmez (ilk oge
//      calisir), IKI dizin eklenince (shim + sahte oc) ikincisi yok olur.
//      Ayni tuzak `OCP_OC_PATHS` gibi ':' ayirmali kendi degiskenlerimizde de
//      var.
//   3. `ps -eo args=` Git Bash'te YOKTUR ("unknown option -- o"). Cikisi bos
//      kalir, `grep` eslesmez ve "parola argv'de gorunmuyor" bekcisi hep
//      yesil yanar: KOR BEKCI. `ps -ef` ayni bilgiyi tasir.
//
// Bu modul uc sorunun karsiligini verir: `BASH`, `posixYol`/`posixListe` ve
// `PS_ARGV_KOMUTU`. Hepsi Linux'ta birebir eski davranis.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const WINDOWS = process.platform === 'win32';

/**
 * `spawnSync`e verilecek bash. Windows'ta MUTLAK NATIVE yol olmak zorunda:
 * cocuga POSIX bir PATH veriyoruz ve node calistirilabiliri COCUGUN PATH'inde
 * arar — `'bash'` orada bulunamaz (`spawnSync bash ENOENT`), `/bin/bash` ise
 * Windows'ta hic yok. O yuzden EBEVEYNIN native PATH'inde bir kez aranir.
 * Windows disinda eski davranis: PATH'ten cozulen `bash`.
 */
function bashBul() {
  if (!WINDOWS) return 'bash';
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    if (!d) continue;
    for (const ad of ['bash.exe', 'bash']) {
      const aday = path.join(d, ad);
      try {
        if (fs.statSync(aday).isFile()) return aday;
      } catch {
        /* sonraki aday */
      }
    }
  }
  return 'bash';
}

const BASH = bashBul();

const HAS_CYGPATH =
  WINDOWS && spawnSync('cygpath', ['-u', 'C:\\'], { stdio: 'ignore' }).status === 0;

/** cygpath yoksa son care: `C:\a\b` -> `/c/a/b` (MSYS2 kok eslemesi). */
function elleCevir(p) {
  const s = String(p).replace(/\\/g, '/');
  const m = /^([A-Za-z]):\/(.*)$/.exec(s);
  return m ? `/${m[1].toLowerCase()}/${m[2]}` : s;
}

const yolOnbellek = new Map();

/**
 * Tek bir yolu bash'in gorebilecegi bicime cevirir. Windows disinda kimlik
 * fonksiyonu: bekcinin Linux'taki davranisi degismez.
 */
function posixYol(p) {
  if (!WINDOWS || p == null || p === '') return p;
  const anahtar = String(p);
  if (!yolOnbellek.has(anahtar)) {
    yolOnbellek.set(
      anahtar,
      HAS_CYGPATH
        ? execFileSync('cygpath', ['-u', anahtar], { encoding: 'utf8' }).trim()
        : elleCevir(anahtar),
    );
  }
  return yolOnbellek.get(anahtar);
}

/**
 * ':' ayirmali yol LISTESI kurar. Windows'ta her oge ayri ayri cevrilir;
 * `mirasPath` true ise `process.env.PATH` (';' ayirmali) de POSIX listesine
 * donusturulup sona eklenir.
 */
function posixListe(ogeler, { mirasPath = false } = {}) {
  const temiz = (Array.isArray(ogeler) ? ogeler : [ogeler]).filter(Boolean);
  const parcalar = temiz.map(posixYol);
  if (mirasPath) {
    const miras = process.env.PATH || '';
    if (miras) {
      if (!WINDOWS) parcalar.push(miras);
      else if (HAS_CYGPATH)
        parcalar.push(execFileSync('cygpath', ['-u', '-p', miras], { encoding: 'utf8' }).trim());
      else parcalar.push(miras.split(';').filter(Boolean).map(elleCevir).join(':'));
    }
  }
  return parcalar.join(':');
}

/** `pathEk`/`dir` gibi dizinleri + mirasi iceren, bash'e verilebilir PATH. */
function kabukPath(...dizinler) {
  return posixListe(dizinler.flat(), { mirasPath: true });
}

/**
 * Tum sureclerin TAM komut satirini basan `ps`. Git Bash `-eo` bilmez ama
 * `-ef`in COMMAND kolonu da argv'nin tamamini tasir. Cikis BOS kalirsa
 * (yani ps hic ise yaramadiysa) `PS_ARGV_KOMUTU` cagiranin kor kalmamasi icin
 * `ps_yok` basar: bekci "sizinti yok" ile "bakamadim"i ayirt edebilsin.
 */
const PS_ARGV_KOMUTU = '{ ps -eo args= 2>/dev/null || ps -ef 2>/dev/null || echo ps_yok; }';

/** Alt surec acmayan senkron bekleme (`sleep` cagirmaz). */
function bekle(saniye) {
  const paylasimli = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(paylasimli, 0, 0, Math.round(saniye * 1000));
}

module.exports = { WINDOWS, BASH, posixYol, posixListe, kabukPath, PS_ARGV_KOMUTU, bekle };
