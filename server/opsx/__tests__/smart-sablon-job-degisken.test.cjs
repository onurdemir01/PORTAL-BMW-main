// server/opsx/__tests__/smart-sablon-job-degisken.test.cjs — SJ1..SJ3 (2026-10-09).
//
// Kullanici: "job type degiskeni jobdan gelmeli." Hata: "Smart metadata alani JOBTYPE olusturulamadi
// ... {{extraVars.job_type}}" - talep isten ONCE acildigi icin elde yalniz gonderilen degerler ve
// ZORUNLU survey varsayilanlari vardi. Sablon artik AWX template'inde TANIMLI degerleri de gorur;
// AWX'e giden extra_vars ise DEGISMEZ.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function sahte(yol, exports) {
  const p = require.resolve(yol);
  const eski = require.cache[p];
  const m = new Module(p, null);
  m.exports = exports;
  m.loaded = true;
  require.cache[p] = m;
  return () => { if (eski) require.cache[p] = eski; else delete require.cache[p]; };
}

async function kos(metadataFields, varsayilan) {
  let yakalanan = null;
  const geri = [
    sahte('../config.cjs', { getConfig: async () => ({ smart: { legacy: { enabled: true, flowKey: 'FLOW', metadataFields } } }) }),
    sahte('../../ansible/runner.cjs', {
      getTemplateLaunchSettingsOnServer: async () => ({ askLimitOnLaunch: true }),
      prefillSurveyDefaultsOnServer: async (_s, _t, ev) => ev,
      getTemplateVariableDefaultsOnServer: async () => { if (varsayilan instanceof Error) throw varsayilan; return varsayilan; },
    }),
    sahte('../../ansible/change-gates.cjs', { openSmartTicket: async (a) => { yakalanan = a; return { ticketId: 'T', smartTicketId: 1 }; } }),
  ];
  const yol = require.resolve('../prod-approval.cjs');
  delete require.cache[yol];
  try {
    await require(yol).opsxProductionKapisi({
      platform: 'legacy', serverId: 1, templateId: 9,
      extraVars: { application: 'APP', operation: 'restart' },
      limitValue: 'GBJBOP18',
      etiketler: [{ alan: 'ortam', deger: ['Production'] }],
      req: { session: { user: { username: 'onur' } } },
      islemAdi: 'Legacy restart',
      ozet: { uygulama: 'APP', sunucular: 'GBJBOP18', islem: 'restart' },
    }).catch(() => {});
  } finally { delete require.cache[yol]; geri.reverse().forEach((g) => g()); }
  assert.ok(yakalanan, 'bilet acilmaya calisilmadi');
  return yakalanan;
}
const CTX = { username: 'onur', templateName: 'x', templateId: 9, extraVars: { application: 'APP', operation: 'restart' } };

test('SJ1 {{extraVars.job_type}} AWX template\'indeki degerle dolar (survey/Variables)', async () => {
  const a = await kos('JOBTYPE: {{extraVars.job_type}}\nJRENV: Production', { job_type: 'jvm_restart' });
  assert.deepEqual(a.buildSmartMetadata('JOBTYPE: {{extraVars.job_type}}\nJRENV: Production', CTX), { JOBTYPE: 'jvm_restart', JRENV: 'Production' });
});

test('SJ2 gonderilen deger template varsayilanindan ONCE gelir; AWX\'e giden extra_vars DEGISMEZ', async () => {
  const a = await kos('JOBTYPE: {{extraVars.job_type}}', { job_type: 'jvm_restart', application: 'ESKI' });
  const m = a.buildSmartMetadata('APP: {{extraVars.application}}', CTX);
  assert.equal(m.APP, 'APP', 'template varsayilani gonderilen degeri ezdi');
  assert.ok(!('job_type' in a.extraVars), 'template varsayilani AWX\'e giden extra_vars\'a karisti');
});

test('SJ3 template okunamazsa talep YINE acilir (eski davranis)', async () => {
  const a = await kos('JOBTYPE: sabit', new Error('AWX yok'));
  assert.deepEqual(a.buildSmartMetadata('JOBTYPE: sabit', CTX), { JOBTYPE: 'sabit' });
});
