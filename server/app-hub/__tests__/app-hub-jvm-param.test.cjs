// server/app-hub/__tests__/app-hub-jvm-param.test.cjs - JP1..JP7 (2026-11-11).
//
// Application Hub: JBoss JVM parametresi degistir / ekle (server_hub_fix action=jboss_jvm_option).
// Kilitler:
//   JP1 izin listesi: tek belirtec; tirnak/bosluk/$/;/virgul/parantez/*** yok; komut calistiran sinif
//       (OnError, OnOutOfMemoryError, javaagent) yok; parola/anahtar desenli -D anahtari yazilmaz
//   JP2 plan: plan_only=true, prod kapisi CAGRILMAZ; is gecmisi ve denetimde -D degeri GIZLI
//   JP3 uygula: JVM adi elle yazilmadan 428; prod kapisi Legacy platformuyla, ortam + sunucu etiketiyle
//       cagrilir; ortam BILINMIYORSA uretim sayilir; Smart talebi acilirsa is BASLATILMAZ
//   JP4 hedef taramadan: bayat / sema okunamadi / taramada yok / tanimsiz surec -> 400, is yok
//   JP5 durum ucu: RESULT satiri cozulur; baska eylemin isi reddedilir; OK sonrasi onbellek silinir
//   JP6 genel denetim katmani bu ucu ATLAR (govdeyi acik yazardi); uc kendi maskeli kaydini yazar
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');

function sahte(yol, exp) {
  const m = new Module(yol, null);
  m.loaded = true;
  m.exports = exp;
  require.cache[yol] = m;
}

const kayit = { launch: [], gecmis: [], denetim: [], kapi: [], onbellek: 0 };
const hub = { hosts: [], schemaUnknown: false };
let kapiYaniti = { proceed: true };
let durum = { status: 'successful', artifacts: {} };

sahte(require.resolve('../../server-hub/index.cjs'), {
  HOST_RE: /^[A-Z0-9][A-Z0-9-]{1,30}$/,
  getAssessment: async () => ({ hosts: hub.hosts, schemaUnknown: hub.schemaUnknown }),
  onbellekSil: () => {
    kayit.onbellek += 1;
  },
});
sahte(require.resolve('../../ansible/playbook-registry.cjs'), {
  getByKey: async (k) => ({ key: k, enabled: true, awxServerId: 2 }),
  getEffectiveTemplateId: () => 77,
});
sahte(require.resolve('../../ansible/template-preflight.cjs'), {
  assertRegistryPlaybook: async () => {},
  assertTemplateAcceptsExtraVars: async () => {},
});
sahte(require.resolve('../../ansible/runner.cjs'), {
  launchJobOnServer: async (serverId, templateId, extraVars) => {
    kayit.launch.push({ serverId, templateId, extraVars });
    return { jobId: 900 + kayit.launch.length, status: 'pending' };
  },
  getJobStatusOnServer: async () => durum,
});
sahte(require.resolve('../../opsx/prod-approval.cjs'), {
  opsxProductionKapisi: async (p) => {
    kayit.kapi.push(p);
    return kapiYaniti;
  },
});
sahte(require.resolve('../../opsx/index.cjs'), {
  extractStatsKey: (art, k) => (art && art[k]) || null,
});
const isler = new Set();
sahte(require.resolve('../../db/index.cjs'), {
  query: async (t, p) => {
    if (/^SELECT TOP 1 id FROM ansible_job_history/.test(t)) return { rows: isler.has(`${p[0]}|${p[1]}`) ? [{ id: 1 }] : [] };
    kayit.gecmis.push(p);
    return { rows: [] };
  },
});
sahte(require.resolve('../../auth/index.cjs'), {
  requireAdmin: (req, res, next) => (req.session && req.session.user && req.session.user.role === 'Admin' ? next() : res.status(403).json({ ok: false })),
});
sahte(require.resolve('../../auth/visibility.cjs'), { requireVisiblePrefix: () => (_q, _s, n) => n() });
const muaf = [];
sahte(require.resolve('../../audit/index.cjs'), {
  auditMutations: (_p, o) => {
    muaf.push(...((o && o.exclude) || []));
    return (_q, _s, n) => n();
  },
  auditPortal: (_req, eylem, o) => kayit.denetim.push({ eylem, detail: o.detail }),
});

const J = require('../jvm-param.cjs');
// Gercek uretim tespiti (sahte kapi yalniz cagriyi kaydeder; etiketlerin GERCEKTEN prod sayildigi buradan).
const jest_uretim = () => {
  const p = require.resolve('../../opsx/prod-approval.cjs');
  const sahteMod = require.cache[p];
  delete require.cache[p];
  try {
    return require('../../opsx/prod-approval.cjs');
  } finally {
    require.cache[p] = sahteMod;
  }
};
const { createRouter } = require('../index.cjs');

async function istek(method, yol, govde) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, _r, n) => {
    req.session = { user: { username: 'onur', role: 'Admin' } };
    n();
  });
  app.use('/api/app-hub', createRouter());
  const srv = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/app-hub${yol}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: govde ? JSON.stringify(govde) : undefined,
    });
    return { status: r.status, body: await r.json() };
  } finally {
    srv.close();
  }
}
function filo(ek = {}) {
  hub.schemaUnknown = false;
  hub.hosts = [
    {
      host: 'GOJBAP01',
      env: 'TEST',
      envGroup: 'Non-Production',
      fresh: true,
      scanDate: '2026-11-11',
      jvms: [{ name: 'MUSTERI', gen: 8, source: 'cli', cfgSrc: 'CLI' }],
      ...ek,
    },
  ];
}
const sifirla = () => {
  kayit.launch.length = 0;
  kayit.gecmis.length = 0;
  kayit.denetim.length = 0;
  kayit.kapi.length = 0;
  kapiYaniti = { proceed: true };
};
const govde = (ek = {}) => ({ host: 'GOJBAP01', gen: 8, jvm: 'MUSTERI', parametre: '-Dapp.env=prod', ...ek });

test('JP1 izin listesi ve sir anahtari', () => {
  for (const iyi of ['-Dapp.env=prod', '-Dbayrak', '-Xmx2g', '-Xms512m', '-Xss1m', '-XX:+UseG1GC', '-XX:-UseG1GC', '-XX:MaxMetaspaceSize=512m', '-Dlog.path=/vhosting/logs/a.log', '-Durl=http://x:8080/a'])
    assert.equal(J.parametreDogrula(iyi).ok, true, `kabul edilmeli: ${iyi}`);
  for (const kotu of ['', 'Dx=1', '-Dx="a b"', '-Dx=a b', '-Dx=$(id)', '-Dx=a;b', '-Dx=a,b', '-Dx=***', '-Dx=a`b`', '-XX:OnOutOfMemoryError=kill', '-XX:OnError=x', '-javaagent:/a.jar', '-agentlib:jdwp', '-Djava.security.manager=allow', '-Xmx2g -Dx=1', '-Ddb.password=x', '-Dapi.key=x', '-Dkeystore.pass=x', '-Dsecret=x', '-Xmx2g' + String.fromCharCode(10) + '-Dx=1',
    // inceleme 2026-11-11: baska dosyadan secenek / sinif yukleyen, uzak yonetim acan, TLS degistiren
    '-XX:VMOptionsFile=/tmp/x', '-XX:Flags=/tmp/x', '-Djava.ext.dirs=/tmp', '-Djava.class.path=/tmp', '-Djava.system.class.loader=x.Y', '-Dcom.sun.management.jmxremote.authenticate=false', '-Dcom.sun.management.jmxremote.port=9010', '-Djava.rmi.server.hostname=x', '-Djavax.net.ssl.trustStore=/tmp/t'])
    assert.equal(J.parametreDogrula(kotu).ok, false, `reddedilmeli: ${kotu}`);
  assert.equal(J.anahtar('-XX:+UseG1GC'), J.anahtar('-XX:-UseG1GC'));
  assert.equal(J.anahtar('-Dapp.env=a'), '-Dapp.env');
  // Sir anahtari zaten reddedilir: sir olmayan deger onaylayan gorsun diye ACIK; sir desenli yine gizli.
  assert.equal(J.goster('-Dapp.env=prod'), '-Dapp.env=prod');
  assert.equal(J.goster('-Ddb.password=x'), '-Ddb.password=<gizli>');
  assert.equal(J.goster('-Xmx2g'), '-Xmx2g');
});

test('JP2 plan: plan_only, prod kapisi yok, kayitlarda deger acik (sir anahtari zaten reddedilir)', async () => {
  filo({ env: 'PROD' });
  sifirla();
  const r = await istek('POST', '/jboss/jvm-param', govde());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.plan, true);
  assert.equal(kayit.kapi.length, 0, 'plan prod kapisina gitti');
  assert.equal(kayit.launch.length, 1);
  const ev = kayit.launch[0].extraVars;
  assert.deepEqual([ev.action, ev.plan_only, ev.target_host, ev.jvm, ev.gen, ev.jvm_option], ['jboss_jvm_option', true, 'GOJBAP01', 'MUSTERI', 8, '-Dapp.env=prod']);
  assert.ok(JSON.stringify(kayit.gecmis).includes('Application Hub JVM parametresi plan'), 'is gecmisi sablon adi (durum ucu sahiplik kontrolu buna bakar)');
  assert.ok(kayit.denetim.some((d) => d.eylem === 'app_hub_jvm_param_plan'));
  assert.equal(r.body.parametre, '-Dapp.env=prod');
});

test('JP3 uygula: onay metni, prod kapisi (ortam bilinmiyorsa uretim), Smart talebi acilirsa is yok', async () => {
  filo();
  sifirla();
  let r = await istek('POST', '/jboss/jvm-param', govde({ apply: true }));
  assert.equal(r.status, 428);
  r = await istek('POST', '/jboss/jvm-param', govde({ apply: true, onayMetni: 'musteri' }));
  assert.equal(r.status, 428, 'buyuk/kucuk harf farkli ad kabul edildi');
  assert.equal(kayit.launch.length, 0);
  r = await istek('POST', '/jboss/jvm-param', govde({ apply: true, onayMetni: 'MUSTERI' }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(kayit.kapi.length, 1);
  assert.equal(kayit.kapi[0].platform, 'legacy');
  assert.deepEqual(kayit.kapi[0].etiketler, [
    { alan: 'ortam', deger: 'TEST' },
    { alan: 'sunucu', deger: 'GOJBAP01' },
  ]);
  assert.equal(kayit.launch[0].extraVars.plan_only, false);
  // FAIL-CLOSED: yalniz envGroup Non-Production prod disi; BILINMIYOR / bos / PROD -> prod etiketi
  for (const [env, envGroup] of [['', undefined], ['BILINMIYOR', 'Bilinmiyor'], ['PROD', 'Production'], ['TEST', undefined]]) {
    filo({ env, envGroup });
    sifirla();
    await istek('POST', '/jboss/jvm-param', govde({ apply: true, onayMetni: 'MUSTERI' }));
    assert.match(String(kayit.kapi[0].etiketler[0].deger), /prod/i, `${env}/${envGroup} prod sayilmadi`);
    const { uretimIstegi } = jest_uretim();
    assert.equal(uretimIstegi(kayit.kapi[0].etiketler).uretim, true, `${env}/${envGroup}: gercek uretim tespiti prod demedi`);
  }
  filo({ env: 'TEST', envGroup: 'Non-Production' });
  sifirla();
  await istek('POST', '/jboss/jvm-param', govde({ apply: true, onayMetni: 'MUSTERI' }));
  assert.equal(jest_uretim().uretimIstegi(kayit.kapi[0].etiketler).uretim, false, 'Non-Production test sunucusu prod sayildi');
  assert.equal(kayit.kapi[0].ozet.uygulama, 'MUSTERI', 'uygulama adi JVM adindan gelmeli');
  // Smart talebi acildi -> is baslatilmaz
  sifirla();
  kapiYaniti = { proceed: false, body: { ok: true, pendingApproval: true, externalTicketId: 'S-1', message: 'Smart talebi açıldı' } };
  r = await istek('POST', '/jboss/jvm-param', govde({ apply: true, onayMetni: 'MUSTERI' }));
  assert.equal(r.status, 200);
  assert.equal(r.body.pendingApproval, true);
  assert.equal(kayit.launch.length, 0, 'Smart onayi beklerken is baslatildi');
});

test('JP4 hedef taramadan dogrulanir', async () => {
  const durumlar = [
    [{ fresh: false }, /bayat/],
    [{ jvms: [] }, /taramada yok/],
    [{ jvms: [{ name: 'MUSTERI', gen: 8, source: 'cli', cfgSrc: 'UNAVAILABLE' }] }, /tanım kaynağında yok/],
  ];
  for (const [ek, msj] of durumlar) {
    filo(ek);
    sifirla();
    const r = await istek('POST', '/jboss/jvm-param', govde());
    assert.equal(r.status, 400, JSON.stringify(ek));
    assert.match(r.body.error, msj);
    assert.equal(kayit.launch.length, 0);
  }
  filo();
  hub.schemaUnknown = true;
  sifirla();
  assert.equal((await istek('POST', '/jboss/jvm-param', govde())).status, 400);
  filo();
  sifirla();
  assert.equal((await istek('POST', '/jboss/jvm-param', govde({ gen: 7 }))).status, 400, 'yanlis nesil kabul edildi');
  assert.equal((await istek('POST', '/jboss/jvm-param', govde({ parametre: '-Dx=$(id)' }))).status, 400);
  assert.equal(kayit.launch.length, 0);
});

test('JP5 durum ucu', async () => {
  // Sahiplik: yalniz bu ucun baslattigi (is gecmisinde kayitli) isler okunur.
  const yok = await istek('GET', '/jboss/jvm-param/2/999');
  assert.equal(yok.body.upstreamStatus || yok.status, 404, JSON.stringify(yok.body));
  for (const j of [901, 902, 903]) isler.add(`2|${j}`);
  durum = { status: 'running', artifacts: {} };
  let r = await istek('GET', '/jboss/jvm-param/2/901');
  assert.deepEqual([r.body.finished, r.body.status], [false, 'running']);
  const once = kayit.onbellek;
  durum = { status: 'successful', artifacts: { server_hub_fix_result: { action: 'jboss_jvm_option', plan_only: false, line: 'RESULT\tjboss_jvm_option\tOK\tMUSTERI: -Dapp.env=<gizli> degistirildi' } } };
  r = await istek('GET', '/jboss/jvm-param/2/901');
  assert.deepEqual([r.body.finished, r.body.sonuc, r.body.plan], [true, 'OK', false]);
  assert.match(r.body.mesaj, /degistirildi/);
  assert.equal(kayit.onbellek, once + 1, 'OK sonrasi onbellek silinmedi');
  durum = { status: 'successful', artifacts: { server_hub_fix_result: { action: 'jboss_jvm_option', plan_only: true, line: 'RESULT\tjboss_jvm_option\tPLAN\tMUSTERI ...' } } };
  r = await istek('GET', '/jboss/jvm-param/2/902');
  assert.deepEqual([r.body.sonuc, r.body.plan], ['PLAN', true]);
  durum = { status: 'successful', artifacts: { server_hub_fix_result: { action: 'jboss_retire', line: 'RESULT\tjboss_retire\tOK\tx' } } };
  assert.equal((await istek('GET', '/jboss/jvm-param/2/903')).status, 400);
  assert.equal((await istek('GET', '/jboss/jvm-param/x/1')).status, 400);
});

test('JP6 genel denetim katmani bu ucu atlar', async () => {
  await istek('GET', '/jboss/jvm-param/2/1');
  assert.ok(muaf.includes('/jboss/jvm-param'), `muaf: ${muaf.join(',')}`);
});

test('JP7 sozlesme: Portal ve betik izin listesi ayni (Ansible deposu yaninda ise)', (t) => {
  const betik = path.join(__dirname, '..', '..', '..', '..', '..', '..', 'Downloads', 'Compressed', 'gar_bmt_ansible_scripts', 'bmw_automation_folder', 'server_hub', 'files', 'server_hub_fix.sh');
  const yol = process.env.SERVER_HUB_FIX_SH || betik;
  if (!fs.existsSync(yol)) return t.skip('server_hub_fix.sh bu makinede yok (SERVER_HUB_FIX_SH ile verilebilir)');
  const s = fs.readFileSync(yol, 'utf8');
  const m = /^JVMOPT_RE='([^']+)'/m.exec(s);
  assert.ok(m, 'betikte JVMOPT_RE yok');
  assert.equal(m[1], J.JVMOPT_RE.source, 'Portal ve betik izin listesi farkli');
  const y = /^JVMOPT_YASAK_RE='([^']+)'/m.exec(s);
  assert.ok(y, 'betikte JVMOPT_YASAK_RE yok');
  assert.equal(y[1], J.JVMOPT_YASAK_RE.source, 'Portal ve betik yasak listesi farkli');
});
