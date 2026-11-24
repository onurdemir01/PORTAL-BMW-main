// server/ansible/__tests__/nginx-paket-dokum.test.js - Nginx Hub dokum betiginin @@SPAPKG bolumu GERCEK bash ile
// (2026-11-23, PR-R). Gecici bir nginx agaci (conf.d + applications) kurulur, betik NGINX_PREFIX / NGINX_APPS /
// NGINX_PKG_CACHE ile kosar; nginx ikilisi yok (`-t` fail, bu bolum icin onemsiz).
//
// NEDEN: e145178a (main'e PR'siz) paket ozetini `find -type f` ile cikariyordu: symlink hic listelenmiyordu. Iki
// sunucuda ayni adli bag (`assets -> /paylasilan/<host>/lib`) farkli kutuphanelere gidince SPAPKG satirlari bayt bayt
// ayniydi ("her zaman ve her sartta esit" guvencesi bozuluyordu; alpine'de kanitlandi). Kullanici karari: hedefi
// izle. Betigin bash bolumunu kosturan test yoktu (paket-tutarlilik.test.js yalniz ayristiriciyi sinar).
//   NP1 bag hedefi farkli iki sunucu: icerik ozeti FARKLI (eskiden ayni)
//   NP2 ayni sunucuda bag hedefinin icerigi degisince ozet degisir; onbellek eski ozeti dondurmez
//   NP3 kirik bag ve dongu: durum okunamadi (esit sayilmaz)
//   NP4 dosya siniri asilinca okunamadi (disari giden bag cok buyuk agaca gidebilir)
//   NP5 bagsiz uygulamada parmak izi eski algoritmayla ayni: onbellek isabeti korunur (gereksiz sha256 yok)
//   NP6 sinir GIRDI sayar: dosyasi az ama dizini cok agaca giden bag da durdurulur (gezinti sinirsiz degil)
//   NP7 find zaman asimina duserse (timeout 124) okunamadi; timeout komutu yoksa uygulamalar yine olculur
// bash 4+ (iliskisel dizi) ve GNU find (-printf) gerekir; yoksa gerekceyle atlanir (CI Ubuntu'da kosar).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BETIK = path.join(
  __dirname,
  '..',
  'playbooks',
  'bmw_portal',
  'nginx_console',
  'files',
  'nginx_console_dump.sh',
);
const bashSurum = Number(
  spawnSync('bash', ['-c', 'echo ${BASH_VERSINFO[0]}'], { encoding: 'utf8' }).stdout?.trim() || 0,
);
const gnuFind =
  spawnSync('find', ['.', '-maxdepth', '0', '-printf', 'x'], { encoding: 'utf8' }).stdout === 'x';
const sha = spawnSync('sha256sum', ['--version'], { stdio: 'ignore' }).status === 0;
const ATLA = {
  skip:
    (process.platform === 'win32' && 'POSIX kabuk gerekir') ||
    (bashSurum < 4 && `bash ${bashSurum || 'yok'}: betik bash 4+ ister (uretim RHEL 8/9)`) ||
    (!gnuFind && 'GNU find (-printf) yok') ||
    (!sha && 'sha256sum yok'),
};

/** Gecici nginx agaci: conf.d/app.conf her uygulamayi gosterir. */
function agac(kok, uygulamalar) {
  const prefix = path.join(kok, 'nginx');
  const apps = path.join(prefix, 'applications');
  fs.mkdirSync(path.join(prefix, 'conf.d'), { recursive: true });
  fs.mkdirSync(path.join(prefix, 'conf'), { recursive: true });
  fs.mkdirSync(apps, { recursive: true });
  const conf = [];
  for (const [ad, dosyalar] of Object.entries(uygulamalar)) {
    const d = path.join(apps, 'ns1', ad);
    fs.mkdirSync(d, { recursive: true });
    for (const [rel, icerik] of Object.entries(dosyalar)) {
      const p = path.join(d, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      if (icerik && typeof icerik === 'object' && icerik.bag) fs.symlinkSync(icerik.bag, p);
      else fs.writeFileSync(p, icerik);
    }
    conf.push(`location /${ad}/ { root ${apps}/ns1/${ad}; }`);
  }
  fs.writeFileSync(path.join(prefix, 'conf.d', 'app.conf'), `${conf.join('\n')}\n`);
  return { prefix, apps };
}

function paketler(a, ek = {}, pathOnEk = null) {
  const r = spawnSync('bash', [BETIK], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NGINX_PREFIX: a.prefix,
      NGINX_BIN: '/nonexistent/nginx',
      NGINX_ERRLOG: '/dev/null',
      NGINX_APPS: a.apps,
      NGINX_PKG_CACHE: a.onbellek || path.join(path.dirname(a.prefix), 'onbellek'),
      ...(pathOnEk ? { PATH: `${pathOnEk}:${process.env.PATH}` } : {}),
      ...ek,
    },
    timeout: 60000,
  });
  const satirlar = r.stdout.split('\n');
  const i = satirlar.indexOf('@@SPAPKG');
  assert.ok(i >= 0, `@@SPAPKG yok: ${r.stderr}`);
  const j = satirlar.indexOf('@@END', i);
  const bolum = satirlar.slice(i + 1, j).filter(Boolean);
  return Object.fromEntries(
    bolum.map((l) => {
      const p = l.split('\t');
      return [p[1], { durum: p[2], icerik: p[4], config: p[5], dosya: p[6] }];
    }),
  );
}

const PAKET = { 'index.html': '<html>1</html>', 'main.js': 'uygulama', 'config.json': '{}' };

test('NP1 bag hedefi farkli iki sunucu: icerik ozeti farkli', ATLA, () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'np1-'));
  try {
    const ortak = (host, metin) => {
      const lib = path.join(kok, 'paylasilan', host, 'lib');
      fs.mkdirSync(lib, { recursive: true });
      fs.writeFileSync(path.join(lib, 'lib.js'), metin);
      return lib;
    };
    const h1 = agac(path.join(kok, 'h1'), {
      ui: { ...PAKET, assets: { bag: ortak('h1', 'lib-v1') } },
    });
    const h2 = agac(path.join(kok, 'h2'), {
      ui: { ...PAKET, assets: { bag: ortak('h2', 'lib-v2-FARKLI') } },
    });
    const a = paketler(h1).ui;
    const b = paketler(h2).ui;
    assert.equal(a.durum, 'var');
    assert.equal(b.durum, 'var');
    assert.equal(
      a.dosya,
      '3',
      'bagin icindeki dosya sayilmadi (index.html, main.js, assets/lib.js)',
    );
    assert.notEqual(a.icerik, b.icerik, 'farkli kutuphaneye giden bag esit gorundu');
    assert.equal(a.config, b.config);
  } finally {
    fs.rmSync(kok, { recursive: true, force: true });
  }
});

test('NP2 bag hedefinin icerigi degisince ozet degisir; onbellek eskiyi dondurmez', ATLA, () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'np2-'));
  try {
    const lib = path.join(kok, 'paylasilan', 'lib');
    fs.mkdirSync(lib, { recursive: true });
    fs.writeFileSync(path.join(lib, 'lib.js'), 'lib-v1');
    const h = agac(path.join(kok, 'h'), { ui: { ...PAKET, assets: { bag: lib } } });
    const once = paketler(h).ui.icerik;
    assert.equal(paketler(h).ui.icerik, once, 'degismeyen pakette ozet ayni (onbellekten)');
    fs.writeFileSync(path.join(lib, 'lib.js'), 'lib-v2');
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(lib, 'lib.js'), t, t);
    assert.notEqual(paketler(h).ui.icerik, once, 'bag hedefi degisti ama ozet ayni kaldi');
  } finally {
    fs.rmSync(kok, { recursive: true, force: true });
  }
});

test('NP3 kirik bag ve dongu okunamadi', ATLA, () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'np3-'));
  try {
    const h = agac(path.join(kok, 'h'), {
      kirik: { ...PAKET, assets: { bag: path.join(kok, 'yok') } },
      dongu: { ...PAKET, 'alt/geri': { bag: '..' } },
      temiz: PAKET,
    });
    const p = paketler(h);
    assert.equal(p.kirik.durum, 'okunamadi', 'kirik bag esit sayilabilir');
    assert.equal(p.dongu.durum, 'okunamadi', 'dongulu bag esit sayilabilir');
    assert.equal(p.temiz.durum, 'var');
  } finally {
    fs.rmSync(kok, { recursive: true, force: true });
  }
});

test('NP4 dosya siniri asilinca okunamadi', ATLA, () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'np4-'));
  try {
    const h = agac(path.join(kok, 'h'), {
      buyuk: { ...PAKET, 'a.js': '1', 'b.js': '2', 'c.js': '3' },
      kucuk: { 'index.html': 'x' },
    });
    const p = paketler(h, { NGINX_PKG_DOSYA_SINIRI: '4' });
    assert.equal(p.buyuk.durum, 'okunamadi');
    assert.equal(p.kucuk.durum, 'var');
  } finally {
    fs.rmSync(kok, { recursive: true, force: true });
  }
});

test('NP5 bagsiz uygulamada parmak izi eski algoritmayla ayni (onbellek isabeti)', ATLA, () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'np5-'));
  try {
    const h = agac(path.join(kok, 'h'), { ui: PAKET });
    const onbellek = path.join(kok, 'onbellek');
    paketler({ ...h, onbellek });
    const kayit = fs.readFileSync(onbellek, 'utf8').trim().split('\t');
    // Eski algoritma: `find . -type f -printf '%P\t%s\t%T@\t%C@\n' | sort | sha256sum | cut -c1-16`
    const eski = spawnSync(
      'bash',
      [
        '-c',
        'cd "$1" && LC_ALL=C find . -type f -printf \'%P\\t%s\\t%T@\\t%C@\\n\' | LC_ALL=C sort | sha256sum | cut -c1-16',
        '_',
        path.join(h.apps, 'ns1', 'ui'),
      ],
      { encoding: 'utf8' },
    ).stdout.trim();
    assert.equal(kayit[0], 'ns1/ui');
    assert.equal(
      kayit[1],
      eski,
      'bagsiz pakette iz degisti: dagitim sonrasi tum onbellek bosa gider',
    );
  } finally {
    fs.rmSync(kok, { recursive: true, force: true });
  }
});

test('NP6 sinir girdi sayar: dizin dolu agaca giden bag durdurulur', ATLA, () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'np6-'));
  try {
    const dev = path.join(kok, 'dev-agac');
    for (let i = 0; i < 40; i++) fs.mkdirSync(path.join(dev, `d${i}`, 'alt'), { recursive: true });
    fs.writeFileSync(path.join(dev, 'tek.js'), 'x');
    const h = agac(path.join(kok, 'h'), { ui: { ...PAKET, dis: { bag: dev } } });
    assert.equal(paketler(h, { NGINX_PKG_DOSYA_SINIRI: '30' }).ui.durum, 'okunamadi');
    assert.equal(paketler(h, { NGINX_PKG_DOSYA_SINIRI: '500' }).ui.durum, 'var');
  } finally {
    fs.rmSync(kok, { recursive: true, force: true });
  }
});

test('NP7 find zaman asimi okunamadi; timeout komutu yoksa olcum surer', ATLA, () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'np7-'));
  try {
    const h = agac(path.join(kok, 'h'), { ui: PAKET });
    const sahte = path.join(kok, 'bin');
    fs.mkdirSync(sahte);
    fs.writeFileSync(path.join(sahte, 'timeout'), '#!/bin/sh\nexit 124\n', { mode: 0o755 });
    assert.equal(paketler(h, {}, sahte).ui.durum, 'okunamadi', 'zaman asimi esit sayilabilir');
    // timeout komutu yoksa (sahte kaldirildi; gercek coreutils PATH'te olsa da betik onu bulur) olcum surer.
    fs.rmSync(path.join(sahte, 'timeout'));
    assert.equal(paketler(h, {}, sahte).ui.durum, 'var');
  } finally {
    fs.rmSync(kok, { recursive: true, force: true });
  }
});
