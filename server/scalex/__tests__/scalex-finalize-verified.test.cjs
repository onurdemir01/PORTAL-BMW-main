// server/scalex/__tests__/scalex-finalize-verified.test.cjs
// GERI ALMA KARARI: "uygulandi mi" ile "OK mi" AYNI SORU DEGIL.
//
// URETIM (2026-09-17, AWX is #3326330). Kullanicinin cumlesi: "dedi ama ayakta
// aslında" ve "sanki backend job ile ui anlasamadi".
//
//   * Betik: `STATE;OK;Deleted restore state ConfigMap ... after successful restore`
//   * Cluster: DeploymentConfig replicas=1, readyReplicas=1, pod Running
//   * Portal: "geri alinamadi", deneme sayaci +1, satir listede ASILI kaldi
//
// SEBEP: PR #98 ile acmada pod'un hazir olmasi butceyi gecince betik UYARIP isi
// BASARILI sayiyor (kullanici karari). O hedef `WARN` doner ve `finalizeOperation`
// `t.status !== 'OK'` diye bakip `recordRestoreFailure` cagiriyordu.
//
// BU TEST `finalizeOperation`I GERCEKTEN CAGIRIR. Kaynak taramasi bu sinifi
// gormezdi: kosul dogru yazilip YANLIS alani okuyabilir.
//
// NODE TEST MODUL TAKLIDI KULLANMIYORUZ, BILEREK. O ozellik `--experimental-
// test-module-mocks` bayragini ister (Node 22.3+) ve Jenkins "node20" ile kosuyor;
// kosucu (scripts/run-tests.cjs) bayrak yoksa o ozelligi kullanan dosyalari
// ATLIYOR — bu fixin en onemli bekcisinin CI'da HIC kosmamasi demek olurdu.
// DIKKAT: kosucu dosya ICERIGINDE o API'nin adini ARIYOR, yani adini yorumda
// ANMAK BILE dosyayi atlatir. Bunun yerine require ONBELLEGI yamaniyor:
// `index.cjs` `db` ve
// `state`i NESNE olarak tutuyor (sonradan yamanabilir), `auditPortal`i ise
// DESTRUCTURE ediyor — o yuzden index.cjs YUKLENMEDEN ONCE yamanmali.
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const calls = { cleared: [], failed: [], stopped: [], audit: [] };

const audit = require('../../audit/index.cjs');
audit.auditPortal = (_req, action, p) => calls.audit.push({ action, ...p });

const db = require('../../db/index.cjs');
db.query = async (sqlText) => {
  if (String(sqlText).includes('SELECT * FROM scalex_operations')) {
    return {
      rows: [
        {
          id: 11,
          status: 'RUNNING',
          username: 'uxmid',
          username_groups: null,
          env: 'test',
          tenant: 'ark',
          namespace: 'ark-server-push-test',
          cluster_name: 'gbocptest1',
          action: 'restore',
          execution_mode: 'apply',
        },
      ],
    };
  }
  return { rows: [], rowCount: 0 };
};

const state = require('../state.cjs');
state.clearRestored = async (a) => calls.cleared.push(a);
state.recordRestoreFailure = async (a) => calls.failed.push(a);
state.upsertStopped = async (a) => calls.stopped.push(a);

const { finalizeOperation } = require('../index.cjs');

function target(over = {}) {
  return {
    cluster: 'gbocptest1',
    app: 'server-push-reg-ch-v0',
    kind: 'DeploymentConfig',
    status: 'OK',
    detail: '',
    verified: true,
    ...over,
  };
}

async function run(targets, action = 'restore') {
  await finalizeOperation({
    serverId: 1,
    jobId: 3326330,
    status: { status: 'successful', finished: true },
    parsed: {
      mode: 'apply',
      action,
      overallStatus: 'WARN',
      counts: {},
      targets,
    },
  });
}

beforeEach(() => {
  calls.cleared.length = 0;
  calls.failed.length = 0;
  calls.stopped.length = 0;
  calls.audit.length = 0;
});

// FZ1 — ASIL DUZELTME. Bu tam olarak is #3326330'un hedef satiri.
test('FZ1 WARN ama `verified` olan geri alma BASARILI sayilir', async () => {
  await run([
    target({
      status: 'WARN',
      verified: true,
      detail: 'Replica değişikliği uygulandı, pod hazır olmayı sürdürüyor. applied=yes aciliyor, 0/1',
    }),
  ]);
  assert.equal(calls.failed.length, 0, 'ayakta olan uygulama "geri alinamadi" yazildi');
  assert.equal(calls.cleared.length, 1, 'ayna satiri temizlenmedi — liste asili kalir');
  assert.equal(calls.cleared[0].appName, 'server-push-reg-ch-v0');
});

// FZ2 — GEVSEMEDIGINI KANITLA. Gercek bir basarisizlik hala basarisiz.
test('FZ2 FAIL ve `verified: false` hala geri alma HATASI', async () => {
  await run([target({ status: 'FAIL', verified: false, detail: '0 olmasi 10 dk gecti' })]);
  assert.equal(calls.cleared.length, 0, 'basarisiz geri alma ayna satirini SILDI');
  assert.equal(calls.failed.length, 1, 'basarisizlik kaydedilmedi');
  assert.match(calls.failed[0].error, /10 dk/, 'sebep kaydedilmedi');
});

// FZ3 — BELIRTECSIZ WARN de hata. Kural "her WARN'i gecerli say" DEGIL.
test('FZ3 `verified: false` olan WARN hala geri alma HATASI', async () => {
  await run([target({ status: 'WARN', verified: false, detail: 'HPA pin failed' })]);
  assert.equal(calls.failed.length, 1, 'dogrulanmamis WARN basarili sayildi');
  assert.equal(calls.cleared.length, 0);
});

// FZ4 — GERIYE UYUM. Paket 7 `verified` GONDERMEZ; eski davranis surmeli, yoksa
// AWX'e yeni paket kopyalanana kadar her WARN "basarili" sayilirdi.
test('FZ4 `verified` alani HIC gelmezse eski davranis (yalniz status)', async () => {
  const t = target({ status: 'WARN', detail: 'eski paket' });
  delete t.verified;
  await run([t]);
  assert.equal(calls.failed.length, 1, 'alan yokken WARN basarili sayildi — paket 7 ile tehlikeli');
  assert.equal(calls.cleared.length, 0);
});

// FZ5 — DURDURMA YOLU. Dogrulanmis bir durdurma WARN dahi olsa aynaya YAZILMALI;
// yoksa gercekten durmus bir uygulama listede HIC gorunmez ve geri ALINAMAZ.
test('FZ5 dogrulanmis WARN durdurma aynaya yazilir', async () => {
  await run([target({ status: 'WARN', verified: true, detail: 'HPA pin failed hpa=x' })], 'stop');
  assert.equal(calls.stopped.length, 1, 'durmus uygulama aynaya yazilmadi — geri alinamaz');
  assert.equal(calls.stopped[0].appName, 'server-push-reg-ch-v0');
});

// FZ6 — IZDE AYRIM. "OK" ile "uyarili" ayni sey degil; denetim kaydi hangisinin
// yasandigini soylemeli.
test('FZ6 uyarili geri alma denetim izinde AYIRT EDILIYOR', async () => {
  await run([target({ status: 'WARN', verified: true })]);
  const ev = calls.audit.find((a) => a.action === 'scalex_mirror_update');
  assert.ok(ev, 'ayna guncelleme izi yok');
  assert.match(JSON.parse(ev.detail).restored[0], /\(uyarili\)/, 'iz OK ile uyariliyi ayirmiyor');
});
