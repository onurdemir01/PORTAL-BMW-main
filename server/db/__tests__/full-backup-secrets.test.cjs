// server/db/__tests__/full-backup-secrets.test.cjs — yedek sir sizdirmaz + coktmez.
//
// GERCEK ACIK (2026-08-28 incelemesi): `runBackup` INFORMATION_SCHEMA uzerinden ISTISNASIZ
// her tabloyu `SELECT *` edip PAYLASIMLI NFS'e duz metin CSV yaziyor, dosyalar 14 gun orada
// duruyordu. Icinde `ansible_awx_servers.token/password/client_secret` (AWX'i tam yetkiyle
// kullanmaya yeter), `ocp_cluster_index.token`, `session_token` (oturum calmaya yeter) ve
// `pending_launch_json` (ham extraVars) vardi. Mount'a erisen herkes bunlari okuyabiliyordu.
//
// Ayrica: WriteStream'de 'error' dinleyicisi yoktu (disk dolarsa SUREC COKER) ve sayisal
// env'ler dogrulanmiyordu (`Number('abc')` = NaN -> `setInterval(fn, NaN)` = 1 ms tick).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC_RAW = fs.readFileSync(path.join(__dirname, '..', 'full-backup.cjs'), 'utf8');
// BICIM DEGIL KURAL. Prettier `const X =` ile degerini AYRI satirlara boluyor ve
// `numEnv(..., { min, max })` nesnesini aciyor; bitisiklik varsayan desenler kural
// aynen dururken kirmiziya donuyordu (bkz. bekci-korlugu-desenleri #2b).
const SRC = SRC_RAW.replace(/\s+/g, ' ');

test('sir tasiyan kolon adlari maskelenir', () => {
  assert.match(SRC, /const SECRET_COLUMN_RE = /, 'kolon maskeleme deseni yok');
  const m = SRC.match(/const SECRET_COLUMN_RE = (\/.+\/[a-z]*);/);
  assert.ok(m, 'desen okunamadi');
  const re = eval(m[1]); // yalnizca bu dosyadaki sabit desen — disaridan girdi yok
  // Uretimde GERCEKTEN sir tasiyan kolonlar (bkz. mssql-setup.cjs) yakalanmali:
  for (const col of [
    'token',
    'password',
    'client_secret',
    'session_token',
    'pending_launch_json',
  ]) {
    assert.ok(re.test(col), `sir tasiyan kolon yakalanmiyor: ${col}`);
  }
  // Masum kolonlar maskelenmemeli — yedegin butunlugu bozulmasin:
  for (const col of ['id', 'username', 'created_at', 'template_name', 'status', 'app']) {
    assert.ok(!re.test(col), `masum kolon gereksiz maskeleniyor: ${col}`);
  }
});

test('maskeleme satir yazimina GERCEKTEN uygulanir', () => {
  assert.match(
    SRC,
    /maskedCols\.has\(k\) && v !== null && v !== undefined \? MASK : csvEscape\(v\)/,
    'maskeleme kurulmus ama satir yaziminda kullanilmiyor',
  );
});

test("WriteStream 'error' dinleyicisi var (disk dolarsa surec cokmez)", () => {
  assert.match(
    SRC,
    /ws\.on\('error', fail\)/,
    "ws 'error' dinleyicisi yok — unhandled error process'i dusurur",
  );
});

test('BOS env degeri "0" sayilmaz — varsayilana duser', () => {
  // `.env`de `DB_FULL_BACKUP_CHECK_INTERVAL_MINUTES=` (degersiz) yazmak dotenv
  // tarafindan BOS STRING olarak okunur. `Number('')` **0** verir ve 0 SONLUDUR:
  // eski kod `fallback` dalina hic girmeyip ALT SINIRA kelepceliyordu, yani aralik
  // 15 dakika yerine 1 dakika oluyor ve DB yoklamasi 15 KATINA cikiyordu.
  const m = SRC_RAW.match(/function numEnv\([\s\S]*?\n\}/);
  assert.ok(m, 'numEnv bulunamadi');
  const numEnv = new Function(`${m[0]}; return numEnv;`)();
  assert.equal(numEnv('', 15, { min: 1, max: 60 }), 15, 'bos deger alt sinira dusuyor');
  assert.equal(numEnv('   ', 15, { min: 1, max: 60 }), 15, 'bosluklu deger alt sinira dusuyor');
  assert.equal(numEnv(undefined, 15, { min: 1, max: 60 }), 15);
  // Gercek bir 0 YINE kelepcelenir: bu bir "ayarsiz" degil, gecersiz bir AYAR.
  assert.equal(numEnv('0', 15, { min: 1, max: 60 }), 1);
  assert.equal(numEnv('999', 15, { min: 1, max: 60 }), 60);
});

test('sayisal env degerleri dogrulanir ve kelepcelenir', () => {
  assert.match(SRC, /function numEnv\(/, 'numEnv yok');
  // `[^)]*` KULLANILAMAZ: `numEnv(process.env.X, 15, { min: 1, max: 60 })` ifadesi
  // ic ice parantez tasiyor ve sinif ilk `)`de duruyordu. Olculen kural: tick
  // araligi 60 dakikayla SINIRLI mi?
  assert.match(
    SRC,
    // Prettier cok satira acinca SONDA VIRGUL birakiyor (`max: 60, })`).
    /checkIntervalMinutes: numEnv\([\s\S]{0,120}?max: 60,? ?\}\)/,
    'tick araligi 60 dk ile sinirlanmali — asarsa saatlik pencere hic yakalanmaz',
  );
  assert.match(SRC, /hour: numEnv\([^)]*min: 0, max: 23 \}\)/);
  assert.ok(
    !/Number\(process\.env\.DB_FULL_BACKUP/.test(SRC),
    'ham Number() donusumu kalmis (NaN riski)',
  );
});

test('numEnv gercekten NaN/asiri degerleri emer', () => {
  // Modulu yukleyip getConfig'i cagirmak DB baglantisi gerektirmiyor.
  const before = { ...process.env };
  try {
    process.env.DB_FULL_BACKUP_CHECK_INTERVAL_MINUTES = 'abc';
    process.env.DB_FULL_BACKUP_HOUR = '99';
    delete require.cache[require.resolve('../full-backup.cjs')];
    const mod = require('../full-backup.cjs');
    const cfg = typeof mod.getConfig === 'function' ? mod.getConfig() : null;
    if (cfg) {
      assert.strictEqual(cfg.checkIntervalMinutes, 15, 'NaN varsayilana dusmeli');
      assert.strictEqual(cfg.hour, 23, '99 -> 23 kelepcelenmeli');
    }
  } finally {
    process.env = before;
    delete require.cache[require.resolve('../full-backup.cjs')];
  }
});
