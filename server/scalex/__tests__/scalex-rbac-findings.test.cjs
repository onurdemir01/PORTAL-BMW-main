// server/scalex/__tests__/scalex-rbac-findings.test.cjs
//
// OKUNAMAYAN TIPLERIN BIRIKIMI. Kesif bunlari zaten raporluyordu ama rapor yalnizca
// o anki KULLANICININ ekraninda kaliyordu: ayni talep platform ekibine tekrar tekrar
// aciliyor, hangi namespace'te neyin eksik oldugu hicbir yerde toplu durmuyordu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../../db/index.cjs');
const findings = require('../rbac-findings.cjs');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const codeOnly = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
const norm = (s) => s.replace(/\s+/g, ' ').replace(/'/g, '"');

// DB'yi sahte bir sorgu toplayiciyla degistirir (repo genelindeki `withDb` deseni).
async function withDb(fn) {
  const orig = db.query;
  const calls = [];
  db.query = async (sql, params) => {
    calls.push({ sql, params });
    // UPDATE 0 satir etkilesin ki INSERT yolu da sinansin.
    if (/^\s*UPDATE/i.test(sql)) return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [] };
  };
  try {
    await fn(calls);
  } finally {
    db.query = orig;
  }
}

// ── NEDEN AYRIMI ────────────────────────────────────────────────────────────

test('RB1 yalnizca OKUNAMAYAN ve BILINEN nedenli satirlar yazilir', async () => {
  await withDb(async (calls) => {
    const r = await findings.record({
      env: 'test',
      tenant: 'ark',
      namespace: 'ns1',
      kindReports: [
        {
          cluster: 'c1',
          kind: 'sts',
          resource: 'statefulsets.apps',
          readable: false,
          reason: 'no_permission',
          verb: 'list',
        },
        {
          cluster: 'c1',
          kind: 'ds',
          resource: 'daemonsets.apps',
          readable: false,
          reason: 'api_absent',
          verb: 'list',
        },
        // OKUNABILEN tip yazilmaz — bu bir eksik degil.
        {
          cluster: 'c1',
          kind: 'deploy',
          resource: 'deployments.apps',
          readable: true,
          reason: null,
          verb: null,
        },
        // BILINMEYEN neden yazilmaz: ekran "istenebilir mi" kararini bu alandan
        // veriyor, oraya tanimadigimiz bir etiket koymak kullaniciyi yaniltirdi.
        {
          cluster: 'c1',
          kind: 'x',
          resource: 'x.y',
          readable: false,
          reason: 'uydurma',
          verb: 'list',
        },
      ],
    });
    assert.equal(r.written, 2, 'yazilan satir sayisi yanlis');
    const inserts = calls.filter((c) => /INSERT INTO scalex_rbac_findings/i.test(c.sql));
    assert.equal(inserts.length, 2);
    const reasons = inserts.map((c) => c.params[6]).sort();
    assert.deepEqual(reasons, ['api_absent', 'no_permission']);
  });
});

test('RB2 cluster ya da kind BOS olan satir ATLANIR (anlamsiz kayit)', async () => {
  await withDb(async (calls) => {
    const r = await findings.record({
      env: 'test',
      tenant: 'ark',
      namespace: 'ns1',
      kindReports: [
        { cluster: '', kind: 'sts', readable: false, reason: 'no_permission' },
        { cluster: 'c1', kind: '', readable: false, reason: 'no_permission' },
      ],
    });
    assert.equal(r.written, 0);
    assert.equal(calls.filter((c) => /INSERT/i.test(c.sql)).length, 0);
  });
});

test('RB3 `first_seen_at` KORUNUR — UPDATE yalnizca `last_seen_at` tazeler', () => {
  // Bir eksigin NE ZAMANDIR durdugu, kac kez karsilasildigindan daha cok sey anlatir.
  const src = norm(codeOnly(read('rbac-findings.cjs')));
  const upd = src.slice(src.indexOf('UPDATE scalex_rbac_findings'));
  assert.match(upd.slice(0, 300), /last_seen_at = GETUTCDATE\(\)/, 'son gorulme tazelenmiyor');
  assert.ok(
    !/first_seen_at = /.test(upd.slice(0, 300)),
    'UPDATE `first_seen_at`i de eziyor — eksigin ne zamandir durdugu kaybolur',
  );
});

test('RB4 yazim BEST-EFFORT: DB patlarsa kesif akisi DURMAZ', async () => {
  const orig = db.query;
  db.query = async () => {
    throw new Error('DB yok');
  };
  try {
    const r = await findings.record({
      env: 'test',
      tenant: 'ark',
      namespace: 'ns1',
      kindReports: [{ cluster: 'c1', kind: 'sts', readable: false, reason: 'no_permission' }],
    });
    assert.equal(r.written, 0, 'hata yutulmadi');
  } finally {
    db.query = orig;
  }
});

// ── SQL KURALI ──────────────────────────────────────────────────────────────

test('RB5 SQL metninde SABLON DEGISKENI yok (bu modulun kurali)', () => {
  // Sabit bile olsa, enjeksiyon incelemesini "bu deger nereden geliyor?" sorusuna
  // mahkum ediyor. `TOP 500` elle yazili; asagidaki bekci sabitle esitligini tutar.
  const src = read('rbac-findings.cjs');
  const sqlBlocks = src.match(/`[^`]*(?:SELECT|INSERT|UPDATE|DELETE)[^`]*`/gi) || [];
  assert.ok(sqlBlocks.length >= 4, 'SQL bloklari bulunamadi — test yanlis yere bakiyor');
  for (const b of sqlBlocks) {
    assert.ok(!/\$\{/.test(b), `SQL metninde sablon degiskeni var: ${b.slice(0, 80)}`);
  }
});

test('RB6 `LIST_LIMIT` ile SQL`deki TOP AYNI sayi', () => {
  // Ikisi ayrisirsa ekran "500 kayit var" derken sorgu baska bir sayi donerdi.
  const src = read('rbac-findings.cjs');
  const tops = [...src.matchAll(/SELECT TOP (\d+)/g)].map((m) => Number(m[1]));
  assert.ok(tops.length >= 1, 'TOP bulunamadi');
  for (const t of tops) {
    assert.equal(t, findings.LIST_LIMIT, 'SQL TOP ile LIST_LIMIT ayrismis');
  }
});

// ── GERCEKTEN BAGLI MI ──────────────────────────────────────────────────────

test('RB7 kesif tamamlandiginda birikim GERCEKTEN cagriliyor', () => {
  // Bu depoda tekrar eden hata sinifi: fonksiyon yazilir, test edilir ve HICBIR
  // YERDEN CAGRILMAZ (`refreshDrift` aynen boyle yasandi). Tanim degil, KARAR
  // NOKTASINDAKI CAGRI aranir.
  const idx = norm(codeOnly(read('index.cjs')));
  assert.match(
    idx,
    /if \(status\.finished && parsed && parsed\.mode === "workloads"\) \{[\s\S]{0,200}rbacFindings\.record\(/,
    'kesif bitince RBAC bulgulari kaydedilmiyor — birikim hic dolmaz',
  );
});

test('RB8 admin uclari yalnizca YONETICIYE acik', () => {
  const idx = norm(codeOnly(read('index.cjs')));
  // SINIRLAR SART. Ilk surum listeyi yalnizca BASLANGICTAN itibaren 400 karakter
  // kesiyordu; liste kapisi silindiginde pencere SILME ucunun kapisina ulasip
  // eslesiyor ve bekci YESIL kaliyordu (mutasyonla yakalandi). Her route KENDI
  // araliginda olculmeli.
  const listAt = idx.indexOf('"/admin/rbac-findings"');
  const delAt = idx.indexOf('"/admin/rbac-findings/:id"');
  assert.ok(listAt > 0 && delAt > listAt, 'admin uclari bulunamadi — sinirlar kaymis');

  const listRoute = idx.slice(listAt, delAt);
  assert.match(
    listRoute,
    /currentUser\(req\)\.role !== "Admin"[\s\S]{0,80}403/,
    'bulgu listesi yonetici disina acik',
  );

  // Silme ucunun sonu: kendisinden SONRAKI ilk route tanimi.
  const afterDel = idx.slice(delAt);
  const nextRoute = afterDel.slice(30).search(/router\.(get|post|put|delete|patch)\(/);
  const delRoute = nextRoute >= 0 ? afterDel.slice(0, 30 + nextRoute) : afterDel;
  assert.match(
    delRoute,
    /currentUser\(req\)\.role !== "Admin"[\s\S]{0,80}403/,
    'silme ucu yonetici disina acik',
  );
});

test('RB9 gecersiz kimlikle silme REDDEDILIR', async () => {
  for (const bad of ['abc', '-1', '0', '1; DROP TABLE x']) {
    await assert.rejects(() => findings.remove(bad), /Gecersiz kayit kimligi/);
  }
});
