// server/__tests__/tls-dogrulama.test.cjs — ic servislerde TLS sertifika dogrulamasi (2026-11-12).
//
// AWX / OCP API / Nobetci istekleri `rejectUnauthorized: false` ile gidiyordu (kimlik bilgisi
// dogrulanmamis baglantidan). Artik server/util/tls-guven.cjs uzerinden dogrulama HER ZAMAN acik.
// Testler GERCEK bir yerel HTTPS sunucusuna karsi kosar; test CA'si ve sertifika her kosuda openssl
// ile gecici dizinde uretilir (depoya ozel anahtar girmez). openssl yoksa davranis testleri atlanir.
//   TD1  kaynak bekcisi: server/ ve scripts/ altinda sabit `rejectUnauthorized: false` yok
//   TD2  bekci gercekten yakaliyor (sentetik bozuk kaynak) ve yanlis alarm vermiyor
//   TD3  CA tanimsiz: istek DOGRULAMADA durur, sunucuya hic istek ulasmaz, hata cozum yolunu soyler
//   TD4  <ONEK>_TLS_CA ile ayni sunucu dogrulanir
//   TD5  ek CA verilince NODE_EXTRA_CA_CERTS (sistem paketi) KAYBOLMAZ (alt surec)
//   TD6  acil cikis <ONEK>_TLS_DOGRULAMA=kapali: anlik gecerli, UYARI loglanir, geri alinca yine dogrular
//   TD7  sunucuAdi: IP'ye baglanip gercek ada gore dogrular; yanlis ad reddedilir (Nobetci NOBETCI_API_HOST)
//   TD8  zorunlu ek CA okunamazsa ACIK hata; http: hedefe TLS alani eklenmez
//   TD9  onbellek: ayni dosya ayni baglam; dosya degisince yeniden kurulur
//   TD10 AWX yolu (runner): CA yoksa Bearer token GITMEZ ve hata AWX_TLS_CA'yi soyler; CA ile calisir
//   TD11 OCP yoklamalari (runner + LogX ocp-health): dogrulanamazsa token gitmez, "erisilemedi" + cozum
//   TD12 MCP guvensiz kipi hesaplanir (kaynakta sabit false yok) ve kurumsal CA varken yok sayilir
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFileSync, execFile } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const tg = require('../util/tls-guven.cjs');

const TLS_ENV = [
  'AWX_TLS_CA',
  'AWX_TLS_DOGRULAMA',
  'OCP_TLS_CA',
  'OCP_TLS_DOGRULAMA',
  'NOBETCI_TLS_CA',
  'NOBETCI_TLS_DOGRULAMA',
  'CORP_CA_CERT_PATH',
];
function envTemizle() {
  for (const k of TLS_ENV) delete process.env[k];
  tg._sifirla();
}

// ── Kaynak bekcisi ──────────────────────────────────────────────────────────
// Satir bazli: `//` ya da `*` ile baslayan yorum satirlari atlanir (blok yorum ayiklayicisi
// yorumdaki `/*` ile dosyayi yutabiliyordu; bkz. bellek "yorum /* tuzagi").
const KAPALI_DESENLERI = [
  /\brejectUnauthorized['"]?\s*[:=]\s*(false|0|null|undefined|!\s*1|!\s*true|''|"")(?![\w.])/,
  /NODE_TLS_REJECT_UNAUTHORIZED['"]?\]?\s*=\s*['"`]?0/,
];
function kapaliSatirlar(metin) {
  const bulunan = [];
  metin.split('\n').forEach((satir, i) => {
    const t = satir.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    if (KAPALI_DESENLERI.some((d) => d.test(satir))) bulunan.push(`${i + 1}: ${t}`);
  });
  return bulunan;
}
function kaynakDosyalari(dizin) {
  const out = [];
  for (const e of fs.readdirSync(dizin, { withFileTypes: true })) {
    const tam = path.join(dizin, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      out.push(...kaynakDosyalari(tam));
    } else if (/\.(c|m)?js$/.test(e.name)) out.push(tam);
  }
  return out;
}

test('TD1 server/ ve scripts/ altinda sabit `rejectUnauthorized: false` yok', () => {
  const ihlal = [];
  for (const kok of ['server', 'scripts']) {
    for (const f of kaynakDosyalari(path.join(ROOT, kok))) {
      for (const s of kapaliSatirlar(fs.readFileSync(f, 'utf8')))
        ihlal.push(`${path.relative(ROOT, f)}:${s}`);
    }
  }
  assert.deepEqual(
    ihlal,
    [],
    'TLS dogrulamasi kaynakta kapatilmis; server/util/tls-guven.cjs kullanin',
  );
  // Bekcinin taradigi kume bos degil (yanlis dizin = kor bekci).
  assert.ok(kaynakDosyalari(path.join(ROOT, 'server')).some((f) => f.endsWith('runner.cjs')));
});

test('TD2 bekci sentetik bozuk kaynagi yakaliyor, dogruyu gecir', () => {
  const bozuk = [
    '  rejectUnauthorized: false,',
    'const o = { rejectUnauthorized:false };',
    "  'rejectUnauthorized': false,",
    'tlsOpts.rejectUnauthorized = false;',
    '  rejectUnauthorized: !1,',
    '  rejectUnauthorized: 0 }',
    "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';",
    "process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';",
  ];
  for (const b of bozuk) assert.equal(kapaliSatirlar(b).length, 1, `yakalanmadi: ${b}`);
  const dogru = [
    '  rejectUnauthorized: true,',
    '  rejectUnauthorized: dogrula,',
    '  rejectUnauthorized: falseyDegil,',
    "  rejectUnauthorized: process.env.LDAP_REJECT_UNAUTHORIZED !== 'false',",
    '// eskiden rejectUnauthorized: false idi',
    ' * rejectUnauthorized: false yasak',
  ];
  for (const d of dogru) assert.deepEqual(kapaliSatirlar(d), [], `yanlis alarm: ${d}`);
});

// ── Gercek HTTPS sunucusu ───────────────────────────────────────────────────
let gecici = null;
let sunucu = null;
let port = 0;
let istekler = [];
let OPENSSL_YOK = false;

function openssl(args, cwd) {
  execFileSync('openssl', args, { cwd, stdio: 'pipe' });
}

before(async () => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'pipe' });
  } catch {
    OPENSSL_YOK = true;
    return;
  }
  gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-dogrulama-'));
  const ext = path.join(gecici, 'ext.cnf');
  fs.writeFileSync(
    ext,
    'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' +
      'subjectAltName=DNS:localhost,IP:127.0.0.1\n',
  );
  for (const ad of ['ca', 'ca2']) {
    openssl(
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        `${ad}.key`,
        '-out',
        `${ad}.pem`,
        '-days',
        '2',
        '-subj',
        `/CN=Portal Test ${ad}`,
        '-addext',
        'basicConstraints=critical,CA:TRUE',
        '-addext',
        'keyUsage=critical,keyCertSign,cRLSign',
      ],
      gecici,
    );
  }
  for (const [ad, ca] of [
    ['srv', 'ca'],
    ['srv2', 'ca2'],
  ]) {
    openssl(
      [
        'req',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        `${ad}.key`,
        '-out',
        `${ad}.csr`,
        '-subj',
        '/CN=localhost',
      ],
      gecici,
    );
    openssl(
      [
        'x509',
        '-req',
        '-in',
        `${ad}.csr`,
        '-CA',
        `${ca}.pem`,
        '-CAkey',
        `${ca}.key`,
        '-CAcreateserial',
        '-out',
        `${ad}.pem`,
        '-days',
        '2',
        '-extfile',
        'ext.cnf',
      ],
      gecici,
    );
  }
  sunucu = https.createServer(
    {
      key: fs.readFileSync(path.join(gecici, 'srv.key')),
      cert: fs.readFileSync(path.join(gecici, 'srv.pem')),
    },
    (req, res) => {
      istekler.push({ url: req.url, authorization: req.headers.authorization || null });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ results: [{ username: 'tls-test', id: 7 }], gitVersion: 'v1' }));
    },
  );
  await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
  port = sunucu.address().port;
});

after(async () => {
  envTemizle();
  if (sunucu) await new Promise((r) => sunucu.close(r));
  if (gecici) fs.rmSync(gecici, { recursive: true, force: true });
});

const yol = (ad) => path.join(gecici, ad);
const hedef = () => new URL(`https://127.0.0.1:${port}/api/v2/me/`);

function iste(anahtar, url, ek = {}) {
  return new Promise((resolve) => {
    let opts;
    try {
      opts = tg.tlsSecenekleri(anahtar, url, ek);
    } catch (e) {
      resolve({ hata: e });
      return;
    }
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'GET',
        agent: false,
        headers: { Authorization: 'Bearer GIZLI_TOKEN' },
        ...opts,
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ durum: res.statusCode }));
      },
    );
    req.on('error', (e) => resolve({ hata: tg.tlsHatasiAcikla(e, anahtar, url.hostname) }));
    req.end();
  });
}

const atla = () => (OPENSSL_YOK ? 'openssl yok' : false);

test('TD3 CA tanimsiz: dogrulamada durur, istek sunucuya ulasmaz, hata cozum yolunu soyler', async (t) => {
  if (atla()) return t.skip(atla());
  envTemizle();
  istekler = [];
  const r = await iste('awx', hedef());
  assert.ok(r.hata, 'dogrulanmamis sertifika kabul edildi');
  assert.ok(tg.tlsHatasiMi(r.hata), `sertifika hatasi bekleniyordu: ${r.hata.code}`);
  assert.match(r.hata.message, /AWX TLS sertifikasi dogrulanamadi/);
  assert.match(r.hata.message, /AWX_TLS_CA/);
  assert.match(r.hata.message, /npm run tls:dene/);
  assert.equal(istekler.length, 0, 'dogrulanmamis baglantidan istek (ve token) gitti');
});

test('TD4 <ONEK>_TLS_CA ile ayni sunucu dogrulanir; baska entegrasyonu etkilemez', async (t) => {
  if (atla()) return t.skip(atla());
  envTemizle();
  process.env.AWX_TLS_CA = yol('ca.pem');
  istekler = [];
  assert.deepEqual(await iste('awx', hedef()), { durum: 200 });
  assert.equal(istekler[0].authorization, 'Bearer GIZLI_TOKEN');
  const ocp = await iste('ocp', hedef());
  assert.ok(ocp.hata && tg.tlsHatasiMi(ocp.hata), 'AWX CA`si OCP`ye de sizdi');
  // Yanlis CA (ca2) verilirse yine reddedilir.
  process.env.AWX_TLS_CA = yol('ca2.pem');
  const yanlis = await iste('awx', hedef());
  assert.ok(yanlis.hata && tg.tlsHatasiMi(yanlis.hata), 'yanlis CA ile kabul edildi');
});

test('TD5 ek CA verilince NODE_EXTRA_CA_CERTS (sistem paketi) kaybolmaz', async (t) => {
  if (atla()) return t.skip(atla());
  // Ikinci sunucu ca2 ile imzali; ca2 YALNIZ NODE_EXTRA_CA_CERTS'te. AWX_TLS_CA=ca (ilk sunucu).
  // Explicit `ca` varsayilan depoyu birakirsa ikinci sunucu reddedilir.
  const betik = `
    const https = require('https');
    const tg = require(${JSON.stringify(path.join(ROOT, 'server/util/tls-guven.cjs'))});
    const iste = (u) => new Promise((r) => {
      const url = new URL(u);
      const q = https.request({ hostname: url.hostname, port: url.port, path: '/', agent: false,
        ...tg.tlsSecenekleri('awx', url) }, (res) => { res.resume(); r(res.statusCode); });
      q.on('error', (e) => r(e.code));
      q.end();
    });
    (async () => {
      const srv2 = https.createServer({ key: require('fs').readFileSync(process.argv[1] + '/srv2.key'),
        cert: require('fs').readFileSync(process.argv[1] + '/srv2.pem') }, (q, s) => s.end('ok'));
      await new Promise((r) => srv2.listen(0, '127.0.0.1', r));
      const a = await iste('https://127.0.0.1:' + process.argv[2] + '/');
      const b = await iste('https://127.0.0.1:' + srv2.address().port + '/');
      console.log(JSON.stringify([a, b]));
      srv2.close();
    })();`;
  // ASENKRON alt surec: spawnSync bu surecin olay dongusunu durdurur ve alt surecin baglandigi
  // ilk sunucu (bu surecte) cevap veremez -> kilitlenme.
  const r = await new Promise((resolve) => {
    execFile(
      process.execPath,
      ['-e', betik, gecici, String(port)],
      {
        env: { ...process.env, NODE_EXTRA_CA_CERTS: yol('ca2.pem'), AWX_TLS_CA: yol('ca.pem') },
        timeout: 20000,
      },
      (err, stdout, stderr) => resolve({ err, stdout: String(stdout), stderr: String(stderr) }),
    );
  });
  const satir = r.stdout.trim().split('\n').pop();
  assert.deepEqual(
    JSON.parse(satir || 'null'),
    [200, 200],
    `alt surec: ${r.stdout} ${r.stderr} ${r.err || ''}`,
  );
});

test('TD6 acil cikis: anlik gecerli, UYARI loglanir, geri alinca yine dogrular', async (t) => {
  if (atla()) return t.skip(atla());
  envTemizle();
  const uyarilar = [];
  const eski = console.warn;
  console.warn = (...a) => uyarilar.push(a.join(' '));
  try {
    process.env.NOBETCI_TLS_DOGRULAMA = 'kapali';
    assert.deepEqual(await iste('nobetci', hedef()), { durum: 200 });
    assert.deepEqual(await iste('nobetci', hedef()), { durum: 200 });
    const kapali = uyarilar.filter((u) => /Nobetci API: sertifika dogrulamasi KAPALI/.test(u));
    assert.equal(kapali.length, 1, `durum degisiminde TEK uyari bekleniyordu: ${uyarilar}`);
    assert.match(kapali[0], /NOBETCI_TLS_CA/);
    // Baska entegrasyon etkilenmez.
    const awx = await iste('awx', hedef());
    assert.ok(awx.hata, 'NOBETCI kacisi AWX`i de kapatti');
    // Yalniz tam 'kapali' kapatir.
    process.env.NOBETCI_TLS_DOGRULAMA = 'acik';
    assert.ok((await iste('nobetci', hedef())).hata, 'acik degerinde dogrulama kapali kaldi');
    process.env.NOBETCI_TLS_DOGRULAMA = 'false';
    assert.ok((await iste('nobetci', hedef())).hata, "'false' dogrulamayi kapatmamali");
    process.env.NOBETCI_TLS_DOGRULAMA = ' KAPALI ';
    assert.deepEqual(await iste('nobetci', hedef()), { durum: 200 });
  } finally {
    console.warn = eski;
  }
});

test('TD7 sunucuAdi: IP`ye baglanip gercek ada gore dogrular; yanlis ad reddedilir', async (t) => {
  if (atla()) return t.skip(atla());
  envTemizle();
  process.env.NOBETCI_TLS_CA = yol('ca.pem');
  assert.deepEqual(
    tg.tlsSecenekleri('nobetci', hedef(), { sunucuAdi: 'localhost' }).servername,
    'localhost',
  );
  assert.equal(
    tg.tlsSecenekleri('nobetci', hedef(), { sunucuAdi: '10.0.0.1' }).servername,
    undefined,
  );
  assert.deepEqual(await iste('nobetci', hedef(), { sunucuAdi: 'localhost' }), { durum: 200 });
  const r = await iste('nobetci', hedef(), { sunucuAdi: 'baska.ornek' });
  assert.equal(r.hata && r.hata.code, 'ERR_TLS_CERT_ALTNAME_INVALID');
  assert.match(r.hata.message, /Nobetci API TLS sertifikasi dogrulanamadi/);
  // Kaynak: Nobetci NOBETCI_API_HOST ile baglanirken gercek adi veriyor.
  const src = fs.readFileSync(path.join(ROOT, 'server/nobetci/index.cjs'), 'utf8');
  assert.match(
    src,
    /tlsSecenekleri\("nobetci", parsed, \{ sunucuAdi: hostOverride \? parsed\.hostname : undefined \}\)/,
  );
});

test('TD8 zorunlu ek CA okunamazsa acik hata; bos PEM reddedilir; http: hedefe TLS alani yok', (t) => {
  if (atla()) return t.skip(atla());
  envTemizle();
  process.env.AWX_TLS_CA = yol('olmayan.pem');
  assert.throws(() => tg.tlsSecenekleri('awx', hedef()), /AWX_TLS_CA okunamadi/);
  fs.writeFileSync(yol('bos.pem'), 'sertifika yok\n');
  process.env.AWX_TLS_CA = yol('bos.pem');
  assert.throws(
    () => tg.tlsSecenekleri('awx', hedef()),
    /AWX_TLS_CA dosyasinda PEM sertifikasi yok/,
  );
  // Paylasilan CORP_CA_CERT_PATH okunamazsa atlanir (AWX bozulmaz), uyari bir kez.
  envTemizle();
  process.env.CORP_CA_CERT_PATH = yol('olmayan-kurum.pem');
  const o = tg.tlsSecenekleri('awx', hedef());
  assert.equal(o.rejectUnauthorized, true);
  assert.equal(o.secureContext, undefined);
  assert.deepEqual(tg.tlsSecenekleri('awx', new URL('http://127.0.0.1/')), {});
  assert.throws(() => tg.tlsSecenekleri('bilinmeyen', hedef()), /bilinmeyen entegrasyon/);
});

test('TD9 onbellek: ayni dosya ayni baglam; dosya degisince yeniden kurulur', (t) => {
  if (atla()) return t.skip(atla());
  envTemizle();
  fs.copyFileSync(yol('ca.pem'), yol('donen.pem'));
  process.env.OCP_TLS_CA = yol('donen.pem');
  const a = tg.tlsSecenekleri('ocp', hedef()).secureContext;
  const b = tg.tlsSecenekleri('ocp', hedef()).secureContext;
  assert.ok(a);
  assert.equal(a, b, 'her istekte yeniden kuruluyor');
  fs.appendFileSync(yol('donen.pem'), fs.readFileSync(yol('ca2.pem')));
  const ileri = new Date(Date.now() + 5000);
  fs.utimesSync(yol('donen.pem'), ileri, ileri);
  const c = tg.tlsSecenekleri('ocp', hedef()).secureContext;
  assert.notEqual(c, a, 'sertifika donusu fark edilmedi');
});

test('TD10 AWX yolu: CA yoksa Bearer token gitmez ve hata AWX_TLS_CA`yi soyler; CA ile calisir', async (t) => {
  if (atla()) return t.skip(atla());
  envTemizle();
  const runner = require('../ansible/runner.cjs');
  process.env.AWX_9_URL = `https://127.0.0.1:${port}`;
  process.env.AWX_9_NAME = 'TLS test';
  try {
    istekler = [];
    await assert.rejects(runner.whoAmIWithTokenOnServer(9, 'GIZLI_TOKEN'), (e) => {
      assert.match(e.message, /AWX TLS sertifikasi dogrulanamadi/);
      assert.match(e.message, /AWX_TLS_CA/);
      return true;
    });
    assert.equal(istekler.length, 0, 'AWX token`i dogrulanmamis baglantidan gitti');
    process.env.AWX_TLS_CA = yol('ca.pem');
    const me = await runner.whoAmIWithTokenOnServer(9, 'GIZLI_TOKEN');
    assert.equal(me.username, 'tls-test');
    assert.equal(istekler.at(-1).authorization, 'Bearer GIZLI_TOKEN');
  } finally {
    delete process.env.AWX_9_URL;
    delete process.env.AWX_9_NAME;
  }
});

test('TD11 OCP yoklamalari: dogrulanamazsa token gitmez, "erisilemedi" + cozum; CA ile erisilir', async (t) => {
  if (atla()) return t.skip(atla());
  envTemizle();
  const { _probeClusterApiVersion } = require('../ansible/runner.cjs');
  const { _probeApiUrl } = require('../logx/v2/ocp-health.cjs');
  const api = `https://127.0.0.1:${port}`;
  istekler = [];
  for (const sonuc of [
    await _probeClusterApiVersion({ apiUrl: api, token: 'GIZLI_TOKEN' }),
    await _probeApiUrl(api, 'GIZLI_TOKEN'),
  ]) {
    assert.equal(sonuc.ok, false);
    assert.match(sonuc.message, /OCP API TLS sertifikasi dogrulanamadi/);
    assert.match(sonuc.message, /OCP_TLS_CA/);
  }
  assert.equal(istekler.length, 0, 'OCP token`i dogrulanmamis baglantidan gitti');
  process.env.OCP_TLS_CA = yol('ca.pem');
  assert.equal((await _probeClusterApiVersion({ apiUrl: api, token: 'GIZLI_TOKEN' })).ok, true);
  assert.equal((await _probeApiUrl(api, 'GIZLI_TOKEN')).ok, true);
  assert.equal(istekler.length, 2);
  // Zorunlu CA okunamazsa yoklama ASILI kalmaz / firlatmaz: anlamli sonuc doner.
  process.env.OCP_TLS_CA = yol('olmayan.pem');
  assert.match(
    (await _probeClusterApiVersion({ apiUrl: api, token: 'x' })).message,
    /OCP_TLS_CA okunamadi/,
  );
  assert.match((await _probeApiUrl(api, 'x')).message, /OCP_TLS_CA okunamadi/);
});

test('TD12 MCP guvensiz kipi hesaplanir ve kurumsal CA varken yok sayilir', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/mcp/client.cjs'), 'utf8');
  assert.match(src, /const dogrula = !\(guvensizIstendi && corporateFileCount === 0\);/);
  assert.match(src, /rejectUnauthorized: dogrula,\n\s+servername: target\.hostname/);
});
