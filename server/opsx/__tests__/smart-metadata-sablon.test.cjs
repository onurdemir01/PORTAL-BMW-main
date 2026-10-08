// server/opsx/__tests__/smart-metadata-sablon.test.cjs — SM1..SM3 (2026-10-08).
//
// OpsX production Smart onayi, OpsX Smart penceresinde yazilan metadata sablonunu KULLANMIYORDU:
// buildSmartMetadata sabit bir nesne donduruyordu ({islem, platform, uretimSebebi, ...}). Bu adlar
// hicbir Smart flow'unun ElementName'iyle eslesmedigi icin bilet acilamazdi; pencerenin
// "Onizle"si ise sablonu dogru gosteriyordu (Self Servis isleyicisi) - yaniltici.
// Kullanici (2026-10-08): "OpsX -> Legacy -> JBoss tarafi icin Smart onayini aktif edecegim."
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

async function kapiyiKos(metadataFields) {
  let yakalanan = null;
  const geri = [
    sahte('../config.cjs', { getConfig: async () => ({ smart: { legacy: { enabled: true, flowKey: 'FLOW-JBOSS', metadataFields } } }) }),
    sahte('../../ansible/runner.cjs', {
      getTemplateLaunchSettingsOnServer: async () => ({ askLimitOnLaunch: true }),
      prefillSurveyDefaultsOnServer: async (_s, _t, ev) => ev,
    }),
    sahte('../../ansible/change-gates.cjs', {
      openSmartTicket: async (args) => { yakalanan = args; return { ticketId: 'T-1', smartTicketId: 1 }; },
    }),
  ];
  const gaYol = require.resolve('../prod-approval.cjs');
  delete require.cache[gaYol];
  try {
    const ga = require(gaYol);
    await ga.opsxProductionKapisi({
      platform: 'legacy', serverId: 1, templateId: 9,
      extraVars: { application: 'GBCCSECURETRACKER', operation: 'restart', jboss_version: 'jboss8' },
      limitValue: 'GBJBOP18',
      etiketler: [{ alan: 'ortam', deger: ['Production'] }, { alan: 'sunucu', deger: ['GBJBOP18'] }],
      req: { session: { user: { username: 'onur', mail: 'o@x' } } },
      islemAdi: 'Legacy restart',
      ozet: { uygulama: 'GBCCSECURETRACKER', sunucular: 'GBJBOP18', islem: 'restart' },
    }).catch(() => {});
  } finally {
    delete require.cache[gaYol];
    geri.reverse().forEach((g) => g());
  }
  assert.ok(yakalanan, 'Smart bileti hic acilmaya calisilmadi (kapi erken dondu)');
  return yakalanan;
}

const CTX = { username: 'onur', email: 'o@x', templateName: 'OpsX: Legacy restart', templateId: 9, extraVars: { application: 'GBCCSECURETRACKER', operation: 'restart', jboss_version: 'jboss8' } };

test('SM1 sablon VARSA kullanilir: Smart alan adlari + {{extraVars.*}} + {{opsx.*}}', async () => {
  const sablon = 'ShortDefinition: OpsX JBoss {{extraVars.operation}} - {{extraVars.application}}\n' +
    'JRDESTAPPLICATION_1: {{opsx.uygulama}}\nSERVERSET_TechValue: {{opsx.sunucular}}\n# JOBTYPE: <yorum>';
  const a = await kapiyiKos(sablon);
  const md = a.buildSmartMetadata(a.overrides.smartApproval.metadataFields, CTX);
  assert.deepEqual(md, {
    ShortDefinition: 'OpsX JBoss restart - GBCCSECURETRACKER',
    JRDESTAPPLICATION_1: 'GBCCSECURETRACKER',
    SERVERSET_TechValue: 'GBJBOP18',
  }, 'OpsX sablonu yok sayip sabit nesne gonderiyor');
});

test('SM2 sablon BOSSA eski davranis (OpsX ozeti) - geri uyumluluk', async () => {
  const a = await kapiyiKos('');
  const md = a.buildSmartMetadata('', CTX);
  // Legacy'de ozet.islem (restart) islemAdi'nin USTUNE yazilir - eski siralama korunur.
  assert.equal(md.islem, 'restart');
  assert.equal(md.platform, 'legacy');
  assert.equal(md.uygulama, 'GBCCSECURETRACKER');
  assert.equal(md.talepEden, 'onur');
});

test('SM3 sablonda tanimsiz degisken talebi NET hatayla durdurur (yanlis bilet acilmaz)', async () => {
  const a = await kapiyiKos('X: {{opsx.olmayan_alan}}');
  assert.throws(() => a.buildSmartMetadata(a.overrides.smartApproval.metadataFields, CTX), /Smart metadata alanı "X" oluşturulamadı/);
});
