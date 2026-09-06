// server/__tests__/log-rotation.test.cjs — SUREC ICI LOG ROTASYONU.
//
// SORUN: rotasyon `deploy/run.sh` icinde bir kabuk fonksiyonuydu ve YALNIZCA surec
// BASLARKEN calisiyordu. Haftalarca ayakta kalan bir prod sureci log dosyasini bir
// sonraki yeniden baslatmaya kadar SINIRSIZ buyutuyordu.
//
// NEDEN KABUKTAN COZULEMEZ: dosyayi kabuk yonlendirmesi aciyor, fd'yi SUREC tutuyor.
// Disaridan `mv` surecin yazdigi inode'u degistirmez — rotasyon SESSIZCE hicbir sey
// yapmamis olur.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const log = require('../log.cjs');

// Her test kendi dizininde calisir; ortam degiskenleri sonra geri alinir.
function withLogger(env, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logrot-'));
  const saved = {};
  const applied = { LOG_DIR: dir, LOG_TO_STDOUT: '0', ...env };
  for (const [k, v] of Object.entries(applied)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    const res = log.install({ envName: 'probe' });
    try {
      return fn(dir, res);
    } finally {
      log.uninstall();
    }
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const rotatedFiles = (dir) =>
  fs.readdirSync(dir).filter((n) => /\.app\.log\.\d{14}(-\d+)?$/.test(n));

// ── ROTASYON GERCEKTEN OLUYOR ───────────────────────────────────────────────

test('LR1 esik asilinca dosya DONDURULUR (surec ayakta kalirken)', () => {
  withLogger({ LOG_MAX_BYTES: '65536', LOG_KEEP: '5' }, (dir) => {
    for (let i = 0; i < 4000; i++) console.log('x'.repeat(60));
    assert.ok(rotatedFiles(dir).length >= 1, 'hic rotasyon olmadi — dosya sinirsiz buyur');
    assert.ok(fs.existsSync(path.join(dir, 'probe.app.log')), 'aktif dosya yok');
  });
});

test('LR2 AYNI SANIYEDEKI rotasyonlar birbirini EZMEZ', () => {
  // Damga SANIYE cozunurlukludur. Cakisma korumasi olmadan `rename` hedefi sessizce
  // eziyordu: 64KB esikle ~18 rotasyon beklenen bir kosuda geriye TEK dosya kaliyor,
  // digerlerinin tamami KAYBOLUYORDU. Sessiz veri kaybi.
  withLogger({ LOG_MAX_BYTES: '65536', LOG_KEEP: '10' }, (dir) => {
    for (let i = 0; i < 20000; i++) console.log('x'.repeat(60));
    assert.equal(
      rotatedFiles(dir).length,
      10,
      'ayni saniyede uretilen rotasyonlar birbirini ezmis — log kaybi',
    );
  });
});

test('LR3 `keep` sayisi ASILMAZ (disk sinirsiz dolmaz)', () => {
  withLogger({ LOG_MAX_BYTES: '65536', LOG_KEEP: '3' }, (dir) => {
    for (let i = 0; i < 20000; i++) console.log('y'.repeat(60));
    assert.equal(rotatedFiles(dir).length, 3, 'eski rotasyonlar budanmiyor');
  });
});

// ── ICERIK KORUNUYOR ────────────────────────────────────────────────────────

test('LR4 mesaj METNI degistirilmez (348 cagri oldugu gibi kalir)', () => {
  withLogger({ LOG_MAX_BYTES: '1048576' }, (dir) => {
    console.log('[Ansible] islem tamam', { id: 7 });
    console.error('[Server] hata:', new Error('patladi'));
    const body = fs.readFileSync(path.join(dir, 'probe.app.log'), 'utf8');
    assert.match(body, /\[Ansible\] islem tamam \{"id":7\}/, 'mesaj/argumanlar kayboldu');
    assert.match(body, /\[LOG\]/, 'seviye yazilmiyor');
    assert.match(body, /\[ERROR\]/, 'hata seviyesi yazilmiyor');
    assert.match(body, /patladi/, 'Error yigini yazilmiyor');
  });
});

test('LR5 UTF-8 (Turkce) bozulmadan yazilir', () => {
  withLogger({ LOG_MAX_BYTES: '1048576' }, (dir) => {
    console.log('[Test] ğüşiöç ĞÜŞİÖÇ'); // ascii-ok
    const body = fs.readFileSync(path.join(dir, 'probe.app.log'), 'utf8');
    assert.match(body, /ğüşiöç ĞÜŞİÖÇ/, 'Turkce karakterler bozulmus');
  });
});

// ── LOGLAMA UYGULAMAYI DUSURMEZ ─────────────────────────────────────────────

test('LR6 dosya acilamazsa uygulama AYAKTA kalir ve console CALISMAYA devam eder', () => {
  // Log kaybi, hizmet kaybindan iyidir.
  const saved = { LOG_DIR: process.env.LOG_DIR, LOG_TO_STDOUT: process.env.LOG_TO_STDOUT };
  // Var olan bir DOSYAYI dizin olarak vermek `mkdirSync`i dusurur.
  const f = path.join(os.tmpdir(), `logrot-file-${Date.now()}`);
  fs.writeFileSync(f, 'x');
  process.env.LOG_DIR = path.join(f, 'alt');
  process.env.LOG_TO_STDOUT = '0';
  try {
    const res = log.install({ envName: 'probe' });
    assert.equal(res.ok, false, 'acilamayan dosyada kurulum basarili sayildi');
    // En onemlisi: console HALA CALISIYOR ve patlamiyor.
    assert.doesNotThrow(() => console.log('[Test] logger yokken de calisir'));
  } finally {
    log.uninstall();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(f, { force: true });
  }
});

test('LR7 `LOG_DISABLED=1` ile tamamen kapatilabilir', () => {
  withLogger({ LOG_DISABLED: '1' }, (dir) => {
    assert.deepEqual(fs.readdirSync(dir), [], 'kapaliyken dosya olusturuldu');
  });
});

// ── AYAR SINIRLARI ──────────────────────────────────────────────────────────

test('LR8 sayisal ayarlar kelepcelenir (0/negatif esik surekli rotasyon yapardi)', () => {
  assert.equal(log.numEnv('0', log.DEFAULT_MAX_BYTES, { min: 65536, max: 1e9 }), 65536);
  assert.equal(log.numEnv('-5', log.DEFAULT_KEEP, { min: 1, max: 50 }), 1);
  assert.equal(log.numEnv('abc', log.DEFAULT_KEEP, { min: 1, max: 50 }), log.DEFAULT_KEEP);
  assert.equal(log.numEnv(undefined, log.DEFAULT_KEEP, { min: 1, max: 50 }), log.DEFAULT_KEEP);
});

test('LR9 rotasyon damgasi SIRALANABILIR (budama ada gore siraliyor)', () => {
  const a = log.stamp(new Date('2026-01-02T03:04:05Z'));
  const b = log.stamp(new Date('2026-01-02T03:04:06Z'));
  assert.equal(a, '20260102030405');
  assert.ok(a < b, 'damga siralanabilir degil — budama yanlis dosyayi silerdi');
});

// ── GERCEKTEN BAGLI MI ──────────────────────────────────────────────────────

test('LR10 sunucu acilisinda KURULUYOR (yazilip cagrilmayan modul olmasin)', () => {
  // Bu depoda tekrar eden hata sinifi: modul yazilir, test edilir ve HICBIR YERDEN
  // cagrilmaz (`refreshDrift` aynen boyle yasandi).
  const idx = fs
    .readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
  assert.match(
    idx.replace(/\s+/g, ' ').replace(/'/g, '"'),
    /require\("\.\/log\.cjs"\)\.install\(/,
    'log modulu acilista kurulmuyor — rotasyon hic calismaz',
  );
});

test('LR11 kabuk rotasyonu ARTIK TEK BASINA sorumlu degil (belge ile davranis uyumlu)', () => {
  // `run.sh` yorumu hala "asil rotasyon burada" diyorsa, bir sonraki gelistirici
  // surec ici rotasyonu fark etmeyip iki yerde birden ayar arar.
  const sh = fs.readFileSync(path.join(__dirname, '..', '..', 'deploy', 'run.sh'), 'utf8');
  assert.match(sh, /server\/log\.cjs/, 'run.sh surec ici rotasyondan hic soz etmiyor');
  assert.match(sh, /app\.log/, 'operator yeni log dosyasinin adini goremez');
});
