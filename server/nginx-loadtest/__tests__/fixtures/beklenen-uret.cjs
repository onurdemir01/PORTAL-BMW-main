#!/usr/bin/env node
// server/nginx-loadtest/__tests__/fixtures/beklenen-uret.cjs -- karsilastir-beklenen.json'u YENIDEN uretir.
//
// Kullanim: node beklenen-uret.cjs <karsilastir.py yolu>      (PYTHON=<komut> ile python secilir)
// Yalniz fikstur katalogu (senaryolar.cjs) ya da uretec (kurgu.cjs) degistiginde elle kosulur; test
// kosusu python GEREKTIRMEZ. Adimlar:
//   1. Her ADIM icin Python duzeni gecici dizine yazilir (kurgu.cjs pythonDuzeniYaz).
//   2. `python -I karsilastir_referans.py` el kitinin karsilastir.py'sini DEGISTIRMEDEN yukleyip tam
//      hassasiyetli sonucu JSON'a yazar.
//   3. Capraz kontrol: her karar ayrica karsilastir.py'nin KENDI komut satiriyla kosulur ve karar.txt'nin
//      ilk satiri ayni olmali (modul olarak yukleme ile CLI ayni sonucu vermeli).
//   4. Her adimin parmak izi eklenir: test, uretecin hala ayni baytlari urettigini bununla dogrular.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ADIMLAR, KARARLAR } = require('./senaryolar.cjs');
const { parmakIzi, pythonDuzeniYaz } = require('./kurgu.cjs');

// Kayit basina tek satir JSON: yalniz ilkel deger (ya da ilkel dizi) tasiyan nesneler tek satira yazilir,
// ust yapilar girintili kalir. Dosya ~400 KB yerine ~1/3; satir bazli fark okunur kalir.
function yaprakMi(x) {
  const ilkel = (v) => v === null || typeof v !== 'object';
  if (Array.isArray(x)) return x.every(ilkel);
  return Object.values(x).every((v) => ilkel(v) || (Array.isArray(v) && v.every(ilkel)));
}

function yaz(x, girinti) {
  if (x === null || typeof x !== 'object' || yaprakMi(x)) return JSON.stringify(x);
  const ic = girinti + ' ';
  if (Array.isArray(x)) return x.length ? `[\n${x.map((e) => ic + yaz(e, ic)).join(',\n')}\n${girinti}]` : '[]';
  const anahtarlar = Object.keys(x).sort();
  return `{\n${anahtarlar.map((k) => `${ic}${JSON.stringify(k)}: ${yaz(x[k], ic)}`).join(',\n')}\n${girinti}}`;
}

function main(argv) {
  const betik = argv[0];
  if (!betik || !fs.existsSync(betik)) {
    console.error('kullanim: node beklenen-uret.cjs <karsilastir.py yolu>');
    return 2;
  }
  const python = process.env.PYTHON || 'python3';
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'yuktesti-beklenen-'));
  try {
    const izler = {};
    for (const a of ADIMLAR) {
      const dosyalar = a.uret();
      pythonDuzeniYaz(kok, a.ad, dosyalar);
      izler[a.ad] = parmakIzi(dosyalar);
    }
    const durumlar = KARARLAR.map((k) => ({ ref: k.ref, aday: k.aday, ...(k.py || {}) }));
    const durumYolu = path.join(kok, '..', `${path.basename(kok)}-durumlar.json`);
    const cikti = path.join(kok, '..', `${path.basename(kok)}-cikti.json`);
    fs.writeFileSync(durumYolu, JSON.stringify(durumlar));
    const r = spawnSync(python, ['-I', path.join(__dirname, 'karsilastir_referans.py'), betik, kok, durumYolu, cikti], { encoding: 'utf8' });
    if (r.status !== 0) {
      console.error(`referans kosusu basarisiz (rc=${r.status}):\n${r.stdout}\n${r.stderr}`);
      return 1;
    }
    const sonuc = JSON.parse(fs.readFileSync(cikti, 'utf8'));
    fs.rmSync(durumYolu, { force: true });
    fs.rmSync(cikti, { force: true });
    for (const k of sonuc.kararlar) {
      const d = k.durum;
      const arg = ['-I', betik, kok, '--referans', d.ref, '--aday', d.aday];
      for (const [ad, bayrak] of [['esik_cpu', '--esik-cpu'], ['esik_p95', '--esik-p95'], ['esik_zarar', '--esik-zarar'], ['kademe_cpu', '--kademe-cpu'], ['kademe_p95', '--kademe-p95']]) {
        if (d[ad] !== undefined) arg.push(bayrak, String(d[ad]));
      }
      const c = spawnSync(python, arg, { encoding: 'utf8' });
      const ilk = c.status === 0 ? fs.readFileSync(path.join(kok, 'karar.txt'), 'utf8').split('\n')[0].replace('KARAR: ', '') : `rc=${c.status}`;
      if (ilk !== k.karar) {
        console.error(`CLI capraz kontrolu tutmadi: ${d.ref}->${d.aday}: modul=${k.karar} cli=${ilk}\n${c.stderr}`);
        return 1;
      }
    }
    sonuc.parmak_izleri = izler;
    const hedef = path.join(__dirname, 'karsilastir-beklenen.json');
    fs.writeFileSync(hedef, yaz(sonuc, '') + '\n');
    console.log(`yazildi: ${hedef} (adim=${ADIMLAR.length}, karar=${sonuc.kararlar.length}, python=${sonuc.python})`);
    return 0;
  } finally {
    fs.rmSync(kok, { recursive: true, force: true });
  }
}

process.exitCode = main(process.argv.slice(2));
