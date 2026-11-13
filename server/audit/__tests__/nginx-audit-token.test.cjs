// server/audit/__tests__/nginx-audit-token.test.cjs - nginx_audit degisim belirteci (2026-11-13).
//
// NT1 belirtec tum cekirdek parcalari + Files tasir; Files yoksa 'yok' (hata degil).
// NT2 cekirdek sorgu duserse hata firlatilir (warm-cache "atla" sayar; bos belirtec "degisti" sanilmaz).
// NT3 ayni gun yeniden yazim (MAX(id) artar) belirteci degistirir.
// NT4 Prod Tasima belirteci tarihli kaynaklari da tasir; tablo yoksa 'yok'.
// NT5 denetim.cjs: iki sicak onbellek de belirtec + seri ile kurulu; istisna yaz/sil hesabi tazeler.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { nginxAuditToken, migrationToken } = require('../nginx-audit-token.cjs');

function sahteSorgu({ cekirdek = { d: '2026-11-13', h_id: 10, sv_id: 20, l_id: 30, u_id: 40, st_id: 50 }, files = 60, yok = [], hata = [] } = {}) {
  const kayit = [];
  const q = async (text) => {
    kayit.push(text);
    for (const t of hata) if (text.includes(t)) throw new Error('Login timeout');
    for (const t of yok) if (text.includes(t)) throw Object.assign(new Error(`Invalid object name '${t}'.`), { number: 208 });
    if (text.includes('Nginx_Audit_Settings')) return { recordset: [cekirdek] };
    if (text.includes('Nginx_Audit_Files')) return { recordset: [{ f_id: files }] };
    const m = /FROM (dbo\.\w+)/.exec(text);
    return { recordset: [{ d: `${m[1]}-gun` }] };
  };
  q.kayit = kayit;
  return q;
}

test('NT1 belirtec cekirdek parcalar + Files; Files yoksa yok', async () => {
  assert.equal(await nginxAuditToken(sahteSorgu()), '2026-11-13,10,20,30,40,50,60');
  assert.equal(await nginxAuditToken(sahteSorgu({ yok: ['Nginx_Audit_Files'] })), '2026-11-13,10,20,30,40,50,yok');
  const q = sahteSorgu();
  await nginxAuditToken(q);
  assert.ok(q.kayit.every((s) => !/Nginx_Audit_Settings\s+WHERE/.test(s)), 'belirtec agir tabloyu taradi');
  assert.ok(q.kayit.some((s) => /MAX\(id\) FROM dbo\.Nginx_Audit_Settings/.test(s)));
});

test('NT2 cekirdek sorgu duserse hata firlatilir', async () => {
  await assert.rejects(nginxAuditToken(sahteSorgu({ hata: ['Nginx_Audit_Hosts'] })), /Login timeout/);
});

test('NT3 ayni gun yeniden yazim belirteci degistirir', async () => {
  const a = await nginxAuditToken(sahteSorgu());
  const b = await nginxAuditToken(sahteSorgu({ cekirdek: { d: '2026-11-13', h_id: 11, sv_id: 20, l_id: 30, u_id: 40, st_id: 50 } }));
  assert.notEqual(a, b);
});

test('NT4 Prod Tasima belirteci tarihli kaynaklari tasir; tablo yoksa yok', async () => {
  const t = await migrationToken(sahteSorgu({ yok: ['Nginx_Spa_Traffic'] }));
  assert.equal(t, '2026-11-13,10,20,30,40,50,60|dbo.Nginx_Config_Audit-gun,dbo.Nginx_Intranet_Audit-gun,yok');
});

test('NT5 denetim.cjs: sicak onbellekler belirtecli ve seri; istisna degisimi hesabi tazeler', () => {
  const LF = String.fromCharCode(10);
  const src = fs
    .readFileSync(path.join(__dirname, '..', 'denetim.cjs'), 'utf8')
    .split(LF)
    .filter((l) => !l.trim().startsWith('//'))
    .join(LF);
  const blok = (ad) => {
    const i = src.indexOf(`name: '${ad}'`);
    assert.ok(i > 0, `${ad} onbellegi yok`);
    return src.slice(i, src.indexOf(LF + '  });', i));
  };
  for (const [ad, fn] of [['nginx-audit', 'nginxAuditToken'], ['nginx-migration', 'migrationToken']]) {
    const b = blok(ad);
    assert.match(b, new RegExp(`token: \\(\\) => ${fn}\\(anaHavuzSorgu\\)`), `${ad}: belirtec yok (her 10 dk 1,56M satir)`);
    assert.match(b, /seri: 'tbmwans-agir'/, `${ad}: seri zincire girmiyor`);
    assert.match(b, /maxAgeMs: /, `${ad}: azami yas emniyeti yok`);
  }
  // Belirtec ANA havuzdan (uzun havuzun 4 baglantisini isgal etmez).
  assert.match(src, /const anaHavuzSorgu = \(text\) => require\('\.\.\/inventory\/mssql\.cjs'\)\.query\(text\)/);
  // Istisna yaz/sil: kosulsuz 10 dk'lik tur artik yok, sicak hesap hemen tazelenmeli.
  for (const ucu of ["router.put('/nginx-audit/exceptions/:host'", "router.delete('/nginx-audit/exceptions/:host'"]) {
    const i = src.indexOf(ucu);
    assert.ok(i > 0, ucu);
    const govde = src.slice(i, src.indexOf('router.', i + 10));
    assert.ok(govde.includes('nginxAuditWarm.run()'), `${ucu}: istisna degisimi sicak hesaba yansimiyor`);
  }
});
