// server/retirement/__tests__/hedef-cikar.test.cjs — HC1..HC3 (2026-10-13).
//
// Kullanici: "yalniz JBoss 7 uygulamasini retirement'a dahil etmek isterken JBoss 8'i de istemim disi
// surece soktu". Iki kapi: (1) yeni kayitta surum karisiksa hicbir hedef ON SECILI degil; (2) mevcut
// kayittan HENUZ DOKUNULMAMIS hedef cikarilabilir - durdurulmus hedef cikarilamaz (uygulama kapali kalirdi).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const IDX = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const EKRAN = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'server_hub', 'RetirementTab.tsx'), 'utf8');
const UC = IDX.slice(IDX.indexOf("router.post('/:id/targets/:tid/cikar'"), IDX.indexOf("router.post('/:id/targets/:tid/refresh-status'"));

test('HC1 yalniz dokunulmamis hedef cikarilir; durdurulmus / is suren / silinen REDDEDILIR', () => {
  const m = /const CIKARILABILIR = new Set\(\[([^\]]+)\]\)/.exec(IDX);
  assert.ok(m, 'CIKARILABILIR yok');
  const izinli = m[1].split(',').map((x) => x.trim().replace(/'/g, ''));
  for (const yasak of ['stopped', 'stopping', 'planning', 'deleting', 'deleted', 'rolling_back', 'rollback_failed'])
    assert.ok(!izinli.includes(yasak), `${yasak} hedef kayittan cikarilabiliyor`);
  assert.ok(izinli.includes('stop_scheduled'), 'zamanlanmis STOP iptal edilemiyor');
  assert.match(UC, /if \(!CIKARILABILIR\.has\(t\.status\)\)/);
});

test("HC2 yazim kosullu (durum degismediyse) ve zamanlama + dondurulmus web listesi temizlenir; yarim STOP'lu hedef cikarilamaz", () => {
  assert.match(UC, /WHERE id = \$2 AND record_id = \$3 AND status = \$4/, 'yazim durum kosulsuz - yaris');
  assert.match(UC, /scheduled_at = NULL/, 'zamanlanmis STOP iptal edilmiyor');
  assert.match(UC, /web_result_json = NULL/, 'dondurulmus web listesi kaliyor');
  assert.match(UC, /t\.status === 'failed' && \(t\.webSonuc \|\| \[\]\)\.some\(\(w\) => w\.status === 'ok'\)/, "vhost'u kalkmis yarim STOP hedefi cikarilabiliyor");
  assert.match(UC, /addEvent\(/, 'olay yazilmiyor');
});

test('HC3 yeni kayitta JBoss surumu karisiksa hicbir hedef on secili degil', () => {
  assert.match(EKRAN, /setSel\(surumler\.size > 1 \? new Set\(\) : new Set\(d\.targets\.map/, 'karisik surumde tum hedefler on seciliyor');
});
