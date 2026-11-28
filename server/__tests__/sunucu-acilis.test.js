'use strict';
// SUNUCU ACILISI (server/index.cjs) — giris noktasi GERCEK bir alt surecte, DB'siz acilir.
//
// Giris noktasi `main()`i yuklenir yuklenmez calistirir; onceki bekciler onu yalniz kaynak metni
// olarak okuyordu (log kurulumu sirasi, telafi korumalari, bellek nabzi). Burada davranisi sinanir:
//   SA1 gelistirme acilisi: ortam dosyasi sirasi, kurum ayari uyarilari, /api 404'u JSON, bozuk
//       JSON govdesi JSON hata (iliski kimligi logda), soket hatasi 400, yakalanmamis red ve
//       istisna sureci dusurmez;
//   SA2 APP_ENV argumandan (kucuk harfe, bosluksuz), DB override'i PORT'u degistirir, kurum ayari
//       tamsa uyari yok, uretimde TRUST_PROXY tanimliysa uyari yok;
//   SA3 APP_ENV ortamdan argumana ustun; acilis adimlarinin hatalari (tablo kurulumu, override,
//       istege bagli modul) acilisi durdurmaz; uretimde TRUST_PROXY yoksa uyari; kurum ayari
//       dosyasi okunamazsa sebep yazilir;
//   SA4 kimlik dogrulama modulu baslatilamazsa sunucu ACILMAZ (cikis 1).
// Alt surec fixtures/acilis-on.cjs ile yuklenir: dotenv etkisiz (gelistiricinin .env'i gercek DB
// adresi tasiyabilir), port 0, hata enjeksiyonu, SIGTERM'de duzgun cikis (kapsam yazilsin).
// Ortamdan yalniz yol ve kapsam degiskenleri gecer; LOG_DIR gecici dizindir (depoya yazilmaz).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const KOK = path.join(__dirname, '..', '..');
const GIRIS = path.join(KOK, 'server', 'index.cjs');
const ON = path.join(__dirname, 'fixtures', 'acilis-on.cjs');
const ACILIS_SURESI_MS = 60_000;
const GECEN = ['PATH', 'HOME', 'TMPDIR', 'SystemRoot', 'NODE_V8_COVERAGE'];

function geciciDizin(t, ad) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `${ad}-`));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

/** Sunucuyu acar; dinlemeye baslayinca ya da surec bitince doner. */
async function ac(t, { env = {}, argv = [], sahte } = {}) {
  const logDir = geciciDizin(t, 'acilis-log');
  const ortam = { SESSION_STORE: 'memory', PORT: '0', LOG_DIR: logDir, ...env };
  for (const ad of GECEN) if (process.env[ad] !== undefined) ortam[ad] = process.env[ad];
  if (sahte) ortam.ACILIS_SAHTE = JSON.stringify(sahte);
  const cocuk = spawn(process.execPath, ['-r', ON, GIRIS, ...argv], {
    cwd: KOK,
    env: ortam,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const s = { cocuk, logDir, cikti: '', stdout: '', port: null, cikisKodu: null };
  const bitti = new Promise((resolve) =>
    cocuk.on('exit', (kod) => {
      s.cikisKodu = kod;
      resolve(kod);
    }),
  );
  s.bitti = bitti;
  t.after(async () => {
    if (s.cikisKodu === null) {
      cocuk.kill('SIGTERM');
      await bitti;
    }
  });
  await new Promise((resolve, reject) => {
    const sure = setTimeout(
      () => reject(new Error(`sunucu ${ACILIS_SURESI_MS} ms icinde acilmadi:\n${s.cikti}`)),
      ACILIS_SURESI_MS,
    );
    // Port satiri ve acilis satiri ayni tikte stdout'a yazilir; stderr araya giremesin diye
    // yalniz stdout'ta aranir.
    cocuk.stdout.setEncoding('utf8').on('data', (parca) => {
      s.cikti += parca;
      s.stdout += parca;
      const m = /\[acilis-on\] port (\d+)\n[^\n]*\[Server\] listening on/.exec(s.stdout);
      if (m && s.port === null) {
        s.port = Number(m[1]);
        clearTimeout(sure);
        resolve();
      }
    });
    cocuk.stderr.setEncoding('utf8').on('data', (parca) => (s.cikti += parca));
    bitti.then(() => {
      clearTimeout(sure);
      resolve();
    });
  });
  return s;
}

async function kapat(s) {
  s.cocuk.kill('SIGTERM');
  return s.bitti;
}

async function iste(s, yol, { method = 'GET', govde, basliklar = {} } = {}) {
  const r = await fetch(`http://127.0.0.1:${s.port}${yol}`, {
    method,
    body: govde,
    headers: basliklar,
  });
  const metin = await r.text();
  let json = null;
  try {
    json = JSON.parse(metin);
  } catch {
    /* JSON degil */
  }
  return { status: r.status, headers: r.headers, metin, json };
}

/** Ham soket: HTTP ayristiricisinin reddettigi istek satiri gonderir. */
function hamIstek(port, satir) {
  return new Promise((resolve, reject) => {
    const soket = net.connect(port, '127.0.0.1');
    let yanit = '';
    soket.setEncoding('utf8');
    soket.on('data', (p) => (yanit += p));
    soket.on('end', () => resolve(yanit));
    soket.on('error', reject);
    soket.write(satir);
  });
}

/** Cikti satiri gorunene kadar bekler (asenkron loglar dinleme satirindan sonra da gelebilir). */
async function bekle(s, desen, ad) {
  const son = Date.now() + 10_000;
  while (!desen.test(s.cikti)) {
    assert.ok(Date.now() < son, `${ad} gorunmedi:\n${s.cikti}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const dotenvSirasi = (s) => [...s.cikti.matchAll(/\[acilis-on\] dotenv (\S+)/g)].map((m) => m[1]);

test('SA1 gelistirme acilisi: DB yok, kurum ayari yok; hatalar JSON, surec dusmez', async (t) => {
  const s = await ac(t, { sahte: { yakalanmamis: true } });
  assert.ok(s.port, `sunucu acilmadi:\n${s.cikti}`);

  assert.deepEqual(dotenvSirasi(s), ['.env.local', '.env'], 'APP_ENV yokken ortam dosyasi sirasi');
  assert.match(
    s.cikti,
    /\[kurum-ayari\] KURUM_AYAR_DOSYASI tanimli degil: nginx, OCP ve Crypto Hub/,
  );
  assert.match(s.cikti, /\[kurum-ayari\] PORTAL_DEFAULT_REQUESTER_EMAIL tanimli degil/);
  assert.match(
    s.cikti,
    /\[Server\] listening on :0 {2}· {2}ortam=\(APP_ENV yok — \.env\.local\/\.env\) {2}· {2}NODE_ENV=\(unset\)/,
  );
  assert.doesNotMatch(s.cikti, /TRUST_PROXY tanimli degil/, 'gelistirmede TRUST_PROXY uyarisi');
  assert.ok(fs.existsSync(path.join(s.logDir, 'dev.app.log')), 'surec ici log dosyasi yok');

  // Eslesmeyen /api yolu Express'in HTML'i degil JSON (nginx-red 404'u 409'a cevirir).
  let r = await iste(s, '/api/olmayan-uc');
  assert.equal(r.json?.ok, false, r.metin);
  assert.equal(r.json.error, 'Not Found');
  assert.equal(r.json.upstreamStatus, 404);

  // Bozuk JSON govdesi: genel hata katmani JSON doner; iliski kimligi sunucu logunda.
  r = await iste(s, '/api/olmayan-uc', {
    method: 'POST',
    govde: '{',
    basliklar: { 'content-type': 'application/json' },
  });
  assert.equal(r.status, 400);
  assert.match(r.headers.get('content-type'), /application\/json/);
  assert.equal(r.json.ok, false);
  assert.match(r.json.correlationId, /^[0-9a-f-]{36}$/);
  await bekle(
    s,
    new RegExp(`\\[Server\\] \\[${r.json.correlationId}\\] POST /api/olmayan-uc hata:`),
    'iliski kimlikli hata satiri',
  );

  // Express'e hic ulasmayan soket hatasi: 400 ve teshis satiri.
  const ham = await hamIstek(s.port, 'BOZUK\r\n\r\n');
  assert.match(ham, /^HTTP\/1\.1 400 Bad Request\r\n/);
  await bekle(
    s,
    /\[Server\] clientError remotePort=\d+ .*HPE_INVALID_METHOD/,
    'clientError satiri',
  );

  // Yakalanmamis red ve istisna loglanir, surec ayakta kalir.
  await bekle(s, /\[Server\] Yakalanmamis promise reddi: Error: sahte red/, 'red satiri');
  await bekle(s, /\[Server\] Yakalanmamis istisna: Error: sahte istisna/, 'istisna satiri');
  r = await iste(s, '/api/olmayan-uc');
  assert.equal(r.json?.error, 'Not Found', 'yakalanmamis hatadan sonra sunucu yanit vermiyor');

  assert.equal(await kapat(s), 0);
});

test('SA2 APP_ENV argumandan; override PORT; kurum ayari tam; uretimde TRUST_PROXY varsa uyari yok', async (t) => {
  const d = geciciDizin(t, 'acilis-kurum');
  const ayar = path.join(d, 'kurum-ayari.json');
  fs.writeFileSync(ayar, '{}');
  const s = await ac(t, {
    argv: [' Test '],
    // Override uygulanmazsa sunucu 5'i dinlemeye calisirdi (acilis satiri `:5` yazardi).
    env: {
      PORT: '5',
      NODE_ENV: 'production',
      LOG_TO_STDOUT: '1', // uretimde log yalniz dosyaya gider (server/log.cjs)
      TRUST_PROXY: '1',
      KURUM_AYAR_DOSYASI: ayar,
      PORTAL_DEFAULT_REQUESTER_EMAIL: 'istekci@ornek.invalid',
    },
    sahte: { envOverrides: { PORT: '0' } },
  });
  assert.ok(s.port, `sunucu acilmadi:\n${s.cikti}`);
  assert.deepEqual(dotenvSirasi(s), ['.env.test', '.env.local', '.env'], 'ortam dosyasi onceligi');
  assert.match(
    s.cikti,
    /\[Server\] listening on :0 {2}· {2}ortam=test {2}· {2}NODE_ENV=production/,
  );
  assert.doesNotMatch(s.cikti, /\[kurum-ayari\]/, 'kurum ayari tamken uyari');
  assert.doesNotMatch(s.cikti, /TRUST_PROXY tanimli degil/);
  assert.ok(
    fs.existsSync(path.join(s.logDir, 'test.app.log')),
    'log dosyasi ortam adini tasimiyor',
  );
  assert.equal(await kapat(s), 0);
});

test('SA3 APP_ENV ortamdan ustun; acilis adimlarinin hatalari acilisi durdurmaz', async (t) => {
  const s = await ac(t, {
    argv: ['prod'],
    env: {
      APP_ENV: 'QA',
      NODE_ENV: 'production',
      LOG_TO_STDOUT: '1',
      KURUM_AYAR_DOSYASI: '/yok/kurum-ayari.json',
    },
    sahte: {
      setupTablesBoz: true,
      envOverrides: 'boz',
      boz: [['opsx/index.cjs', 'initOpsX']],
    },
  });
  assert.ok(s.port, `sunucu acilmadi:\n${s.cikti}`);
  assert.deepEqual(dotenvSirasi(s), ['.env.qa', '.env.local', '.env']);
  assert.match(s.cikti, /ortam=qa {2}· {2}NODE_ENV=production/);
  assert.match(s.cikti, /\[kurum-ayari\] KURUM_AYAR_DOSYASI okunamadi \(kurum-ayari\.json\)/);
  assert.match(s.cikti, /\[DB\] setupTables hata: sahte setupTables hatasi/);
  assert.match(s.cikti, /\[EnvOverrides\] yukleme hata: sahte override hatasi/);
  assert.match(s.cikti, /\[Server\] opsX baslatilamadi \(atlandi\): sahte initOpsX hatasi/);
  assert.match(s.cikti, /\[Guvenlik\] TRUST_PROXY tanimli degil: tek atlama \(1\) varsayiliyor/);
  // Baslatilamayan modulun uclari yok; diger moduller calisir.
  const r = await iste(s, '/api/opsx/olmayan');
  assert.equal(r.json?.error, 'Not Found');
  assert.match(s.cikti, /\[Auth\] module mounted at \/api\/auth/);
  assert.equal(await kapat(s), 0);
});

test('SA4 kimlik dogrulama baslatilamazsa sunucu acilmaz', async (t) => {
  const s = await ac(t, { sahte: { boz: [['auth/index.cjs', 'initAuth']] } });
  assert.equal(s.port, null, 'kimlik dogrulamasiz sunucu dinlemeye basladi');
  assert.equal(await s.bitti, 1);
  assert.match(s.cikti, /\[Server\] baslatma hatasi: Error: sahte initAuth hatasi/);
});
