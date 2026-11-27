// server/ai-analyst/__tests__/portal-araclari.test.js - AI Analist'in portal-yerli araclari
// (portal-tools.cjs): envanter, log cekme / analiz, Splunk, playbook kaydindan turetilen araclar,
// Admin'e ozel AWX baslatma araci ve rol / gorunurluk kapisi.
//
// Gercek AWX / DB / Splunk / LLM yok: araclarin cagri aninda okudugu modul islevleri sahtelenir
// (runner, envanter, analizci, denetim kaydi, Splunk istemcisi, playbook kaydi, gorunurluk).
// Bekleme / pending yolunun temeli portal-tools.test.js'te; burada geri kalan davranis.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const runner = require('../../ansible/runner.cjs');
const envanter = require('../../inventory/index.cjs');
const analizci = require('../../logx/ai-analyzer.cjs');
const denetim = require('../../logx/audit.cjs');
const splunk = require('../../splunk/client.cjs');
const kayit = require('../../ansible/playbook-registry.cjs');
const gorunurluk = require('../../auth/visibility.cjs');
const pt = require('../portal-tools.cjs');

pt._setQuickCheckDelayMs(1);

const KULLANICI = { username: 'ayse', role: 'User' };
const ADMIN = { username: 'yonetici', role: 'Admin' };
const TABAN = [
  'portal_logx_list_hosts',
  'portal_inventory_lookup',
  'portal_logx_fetch_log',
  'portal_logx_analyze_log',
  'portal_logx_job_result',
  'portal_splunk_search',
];
const CIZGI = '─'.repeat(40);

/**
 * Playbook kaydi ve gorunurluk: her test kendi kayitlarini / kararini kurar.
 * @param {any} t
 * @param {{ kayitlar?: any[], gorur?: (u: any, k: string) => boolean }} [secenek]
 */
function kur(t, { kayitlar = [], gorur = () => true } = {}) {
  t.mock.method(kayit, 'listEnabled', async () => kayitlar);
  t.mock.method(kayit, 'getEffectiveTemplateId', (r) => r.templateId ?? null);
  return t.mock.method(gorunurluk, 'canSee', async (u, k) => gorur(u, k));
}

async function araclar(t, user = KULLANICI, secenek) {
  kur(t, secenek);
  return pt.getPortalTools(user);
}

async function arac(t, ad, user, secenek) {
  const a = (await araclar(t, user, secenek)).find((x) => x.name === ad);
  assert.ok(a, `${ad} arac listesinde olmali`);
  return a;
}

/** AWX sahtesi: launchJob cagrilarini dondurur; durum ve cikti testten verilir. */
function awx(t, { durum = 'successful', cikti = '', jobId = 501 } = {}) {
  t.mock.method(runner, 'isConfigured', () => true);
  const launch = t.mock.method(runner, 'launchJob', async () => ({ jobId, status: 'pending' }));
  t.mock.method(runner, 'getJobStatus', async () => ({ status: durum ?? undefined }));
  t.mock.method(runner, 'getJobOutput', async () => ({ output: cikti }));
  return launch;
}

async function ortamla(vars, fn) {
  const eski = {};
  for (const [k, v] of Object.entries(vars)) {
    eski[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(eski)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('AT1 host listesi: host basina gruplar, tekrarlari ve bos hostu atar, arar, siralar, 25 ile sinirlar', async (t) => {
  t.mock.method(envanter, 'getHostsForAiTools', async () => [
    { host: 'srv-b', env: 'test', app: 'app1' },
    { host: 'srv-b', env: 'test', app: 'app1' },
    { host: 'srv-b', env: 'prod', app: 'app2' },
    { host: '  ', env: 'x', app: 'y' },
    { host: 'srv-a', env: null, app: null },
    ...['a1', 'a2', 'a3', 'a4', 'a5'].map((app) => ({ host: ' srv-c ', env: 'qa', app })),
  ]);
  const a = await arac(t, 'portal_logx_list_hosts');
  assert.equal(
    await a.exec(),
    [
      '3 host bulundu (ilk 3 gösteriliyor):',
      'srv-a | env=- | uygulamalar: -',
      'srv-b | env=test/prod | uygulamalar: app1, app2',
      'srv-c | env=qa | uygulamalar: a1, a2, a3, a4 (+1)',
    ].join('\n'),
  );
  // Arama: host adinda ya da uygulama adinda, buyuk / kucuk harf duyarsiz, bosluk kirpilir.
  assert.match(await a.exec({ search: ' SRV-B ' }), /^1 host bulundu[^\n]*\nsrv-b \|/);
  assert.match(await a.exec({ search: 'A5' }), /^1 host bulundu[^\n]*\nsrv-c \|/);
  assert.equal(
    await a.exec({ search: 'yok' }),
    'Eşleşen host bulunamadı — arama terimini değiştirin veya boş bırakın.',
  );

  t.mock.method(envanter, 'getHostsForAiTools', async () =>
    Array.from({ length: 30 }, (_, i) => ({ host: `h${String(29 - i).padStart(2, '0')}` })),
  );
  const cok = (await a.exec()).split('\n');
  assert.equal(cok[0], '30 host bulundu (ilk 25 gösteriliyor):');
  assert.equal(cok.length, 26);
  assert.equal(cok[1], 'h00 | env=- | uygulamalar: -');
  assert.equal(cok[25], 'h24 | env=- | uygulamalar: -');
});

test('AT2 envanter kaydi: tam eslesme kismiden once, kismi eslesme, bulunamadi, zorunlu alan', async (t) => {
  t.mock.method(envanter, 'getHostsForAiTools', async () => [
    { host: 'web012', env: 'test', app: 'z' },
    { host: 'web01', env: 'prod', app: 'a' },
    { host: 'web01', env: 'prod', app: 'b' },
    { host: 'bos01' },
  ]);
  const a = await arac(t, 'portal_inventory_lookup');
  await assert.rejects(a.exec({}), /hostname zorunlu\./);
  assert.equal(
    await a.exec({ hostname: ' WEB01 ' }),
    'hostname: web01\nenvironment: prod\nuygulama sayısı: 2\nuygulamalar: a, b',
  );
  assert.match(await a.exec({ hostname: 'eb012' }), /^hostname: web012\n/);
  assert.equal(
    await a.exec({ hostname: 'bos01' }),
    'hostname: bos01\nenvironment: -\nuygulama sayısı: 0\nuygulamalar: -',
  );
  assert.equal(
    await a.exec({ hostname: 'zzz' }),
    '"zzz" envanterde (EnvanterApps) bulunamadı — hostname\'i doğrulamak için portal_logx_list_hosts kullan.',
  );
});

test('AT3 log cekme: zorunlu alanlar, AWX / sablon yoksa acik hata, satir siniri, basarisiz is', async (t) => {
  const a = await arac(t, 'portal_logx_fetch_log');
  await assert.rejects(a.exec({ hostname: 'h1' }), /hostname ve logFilePath zorunlu\./);
  await assert.rejects(a.exec({ logFilePath: '/l' }), /hostname ve logFilePath zorunlu\./);

  t.mock.method(runner, 'isConfigured', () => false);
  await assert.rejects(
    a.exec({ hostname: 'h1', logFilePath: '/l' }),
    /AWX yapılandırılmamış — log çekme kullanılamaz\./,
  );

  const launch = awx(t, { cikti: 'satir' });
  await ortamla({ AWX_LOG_FETCH_TEMPLATE_ID: undefined }, () =>
    assert.rejects(
      a.exec({ hostname: 'h1', logFilePath: '/l' }),
      /AWX_LOG_FETCH_TEMPLATE_ID tanımlı değil — log çekme kullanılamaz\./,
    ),
  );
  assert.equal(launch.mock.callCount(), 0);

  await ortamla({ AWX_LOG_FETCH_TEMPLATE_ID: '42' }, async () => {
    for (const [lines, beklenen] of [
      [undefined, '200'],
      ['abc', '200'],
      [50, '50'],
      [9999, '500'],
    ]) {
      await a.exec({ hostname: 'h1', logFilePath: '/l', lines });
      assert.deepEqual(launch.mock.calls.at(-1).arguments, [
        42,
        { target_host: 'h1', log_file_path: '/l', grep_pattern: '', lines: beklenen },
        'h1',
      ]);
    }
    await a.exec({ hostname: 'h1', logFilePath: '/l', grepPattern: 'ERROR' });
    assert.equal(launch.mock.calls.at(-1).arguments[1].grep_pattern, 'ERROR');

    awx(t, { durum: 'failed', jobId: 777 });
    await assert.rejects(
      a.exec({ hostname: 'h1', logFilePath: '/l' }),
      /Log çekme job'ı başarısız: failed \(job #777\)/,
    );
  });
});

test('AT4 log cekme sonucu: PII maskelenir ve basliga yazilir, filtre basliga girer, uzun cikti bastan kirpilir', async (t) => {
  const a = await arac(t, 'portal_logx_fetch_log');
  await ortamla({ AWX_LOG_FETCH_TEMPLATE_ID: '42' }, async () => {
    awx(t, { cikti: 'giris ali@ornek.com\ntckn 12345678901' });
    assert.equal(
      await a.exec({ hostname: 'h1', logFilePath: '/var/log/a.log', grepPattern: 'giris|tckn' }),
      `[h1:/var/log/a.log] son 200 satır, filtre: giris|tckn — 2 PII değeri maskelendi\n${CIZGI}\ngiris [EMAIL]\ntckn [TCKN]`,
    );

    const uzun = `${'B'.repeat(5000)}\n${'S'.repeat(4999)}`;
    awx(t, { cikti: uzun });
    const metin = await a.exec({ hostname: 'h1', logFilePath: '/l', lines: 10 });
    assert.equal(
      metin,
      `[h1:/l] son 10 satır\n${CIZGI}\n…(baş taraf kırpıldı)\n${uzun.slice(-8000)}`,
    );
  });
});

test('AT5 log analizi: LogX AI ozeti bicimlenir; baglam varsayilani, kullanici adi ve bos listeler', async (t) => {
  const analiz = t.mock.method(analizci, 'analyze', async () => ({
    provider: 'yerel',
    model: 'm1',
    maskedCount: 3,
    summary: 'Bellek doldu',
    severity: 'high',
    possibleCauses: ['heap kucuk', 'sizinti'],
    recommendations: ['Xmx artir'],
  }));
  await ortamla({ AWX_LOG_FETCH_TEMPLATE_ID: '42' }, async () => {
    awx(t, { cikti: 'l1\nl2' });
    const a = await arac(t, 'portal_logx_analyze_log');
    const r = await a.exec({ hostname: 'h1', logFilePath: '/l' });
    assert.equal(
      r.text,
      '[h1:/l] LogX AI analizi (yerel/m1, 3 PII maskelendi):\nÖZET: Bellek doldu\nSEVİYE: high\n' +
        'OLASI NEDENLER:\n- heap kucuk\n- sizinti\nÖNERİLER:\n- Xmx artir',
    );
    assert.deepEqual(analiz.mock.calls[0].arguments, [['l1', 'l2'], 'Host: h1, dosya: /l', 'ayse']);

    analiz.mock.mockImplementation(async () => ({
      provider: 'p',
      model: 'm',
      maskedCount: 0,
      summary: 'Temiz',
      severity: 'low',
      possibleCauses: [],
    }));
    // Oturumsuz cagri: kullanici adi 'anonymous'.
    const anonim = (await pt.getPortalTools()).find((x) => x.name === 'portal_logx_analyze_log');
    const r2 = await anonim.exec({ hostname: 'h1', logFilePath: '/l', context: 'deploy sonrasi' });
    assert.equal(
      r2.text,
      '[h1:/l] LogX AI analizi (p/m, 0 PII maskelendi):\nÖZET: Temiz\nSEVİYE: low\n',
    );
    assert.deepEqual(analiz.mock.calls[1].arguments.slice(1), ['deploy sonrasi', 'anonymous']);
  });
});

test('AT6 is sonucu: basarisiz is kaydi siler ve soyler; durum alani bossa "bilinmiyor"', async (t) => {
  pt._pendingJobs.clear();
  const a = await arac(t, 'portal_logx_fetch_log');
  const sonuc = await arac(t, 'portal_logx_job_result');
  await ortamla({ AWX_LOG_FETCH_TEMPLATE_ID: '42' }, async () => {
    awx(t, { durum: null, jobId: 61 });
    assert.match(await a.exec({ hostname: 'h1', logFilePath: '/l' }), /jobId=61/);
    assert.equal(
      (await sonuc.exec({ jobId: '61' })).text,
      'Job #61 hâlâ çalışıyor (durum=bilinmiyor). Birkaç saniye sonra tekrar deneyin.',
    );
    assert.ok(pt._pendingJobs.has(61));

    awx(t, { durum: 'failed', jobId: 61 });
    assert.equal((await sonuc.exec({ jobId: 61 })).text, 'Job #61 başarısız oldu: durum=failed.');
    assert.equal(pt._pendingJobs.has(61), false);
    assert.match((await sonuc.exec({ jobId: 61 })).text, /bekleyen bir kayıt bulunamadı/);
  });
});

test('AT7 Splunk: yapilandirilmamissa hata; pencere 1-60 dk, baslik aranan pencereyi yazar; en cok 5 ornek', async (t) => {
  const a = await arac(t, 'portal_splunk_search');
  t.mock.method(splunk, 'isConfigured', () => false);
  await assert.rejects(
    a.exec({ product: 'nginx' }),
    /Splunk yapılandırılmamış \(SPLUNK_BASE_URL\/SPLUNK_TOKEN\)\./,
  );

  t.mock.method(splunk, 'isConfigured', () => true);
  const ara = t.mock.method(splunk, 'search', async () => ({
    eventCount: 7,
    sample: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'],
  }));
  assert.equal(
    (await a.exec({ product: 'nginx', windowMinutes: 500 })).text,
    'Splunk "nginx" (son 60 dk): 7 kayıt bulundu.\nÖrnek kayıtlar:\ne1\ne2\ne3\ne4\ne5',
  );
  assert.deepEqual(ara.mock.calls[0].arguments, [{ product: 'nginx', windowMinutes: 60 }]);
  for (const [girdi, pencere] of [
    [undefined, 15],
    ['abc', 15],
    [-5, 1],
    [0, 15],
    [30, 30],
  ]) {
    const r = await a.exec({ product: 'jboss', windowMinutes: girdi });
    assert.equal(ara.mock.calls.at(-1).arguments[0].windowMinutes, pencere);
    assert.match(r.text, new RegExp(`^Splunk "jboss" \\(son ${pencere} dk\\)`));
  }

  ara.mock.mockImplementation(async () => ({ eventCount: 0, sample: [] }));
  assert.equal(
    (await a.exec({ product: 'httpd' })).text,
    'Splunk "httpd" (son 15 dk): 0 kayıt bulundu.\n',
  );
});

const KAYITLAR = [
  {
    keyName: 'jvm_heap',
    displayName: 'JVM heap',
    description: 'Heap durumu.',
    handler: 'host_target',
    templateId: 77,
  },
  { keyName: 'gizli', displayName: 'Gizli', handler: 'host_target', templateId: 78 },
  { keyName: 'ayarsiz', displayName: 'Ayarsiz', handler: 'host_target', templateId: null },
  { keyName: 'ocp_pod', displayName: 'OCP pod', handler: 'ocp_cluster', templateId: 79 },
];

test('AT8 playbook kaydi: sablonu olmayan ve gorunurlugu kapali arac sunulmaz; kayit / motor hatasi sohbeti dusurmez', async (t) => {
  const gor = kur(t, { kayitlar: KAYITLAR, gorur: (u, k) => k !== 'aitool:gizli' });
  let adlar = (await pt.getPortalTools(KULLANICI)).map((x) => x.name);
  assert.deepEqual(adlar, [...TABAN, 'portal_playbook_jvm_heap', 'portal_playbook_ocp_pod']);
  assert.deepEqual(
    gor.mock.calls.map((c) => c.arguments[1]),
    ['aitool:jvm_heap', 'aitool:gizli', 'aitool:ocp_pod'],
  );
  assert.equal(gor.mock.calls[0].arguments[0], KULLANICI);

  const jvm = (await pt.getPortalTools(KULLANICI)).find(
    (x) => x.name === 'portal_playbook_jvm_heap',
  );
  assert.match(jvm.description, /^Heap durumu\. Önce portal_logx_list_hosts/);

  // Kayit okunamazsa: registry araclari yok, temel araclar yerinde.
  kayit.listEnabled.mock.mockImplementation(async () => {
    throw new Error('db yok');
  });
  adlar = (await pt.getPortalTools(KULLANICI)).map((x) => x.name);
  assert.deepEqual(adlar, TABAN);

  // Gorunurluk motoru dusmusse araclar engellenmez (belgelenmis davranis).
  kayit.listEnabled.mock.mockImplementation(async () => [KAYITLAR[1]]);
  gorunurluk.canSee.mock.mockImplementation(async () => {
    throw new Error('motor yok');
  });
  adlar = (await pt.getPortalTools(KULLANICI)).map((x) => x.name);
  const gizli = (await pt.getPortalTools(KULLANICI)).find(
    (x) => x.name === 'portal_playbook_gizli',
  );
  assert.deepEqual(adlar, [...TABAN, 'portal_playbook_gizli']);
  assert.match(gizli.description, /^Gizli Önce portal_logx_list_hosts/);
});

test('AT9 host hedefli playbook: zorunlu host, AWX girdisi, cikti sondan 8000, pending ve sonradan sonuc', async (t) => {
  pt._pendingJobs.clear();
  const a = await arac(t, 'portal_playbook_jvm_heap', KULLANICI, { kayitlar: KAYITLAR });
  await assert.rejects(a.exec({}), /hostname zorunlu\./);

  t.mock.method(runner, 'isConfigured', () => false);
  await assert.rejects(a.exec({ hostname: 'h1' }), /^Error: AWX yapılandırılmamış\.$/);

  const cikti = `${'x'.repeat(9000)}SON`;
  const launch = awx(t, { cikti });
  const r = await a.exec({ hostname: 'h1' });
  assert.deepEqual(launch.mock.calls[0].arguments, [77, { target_hosts: 'h1' }, 'h1']);
  assert.equal(r.text, `[h1] JVM heap:\n${CIZGI}\n${cikti.slice(-8000)}`);

  awx(t, { durum: 'failed', jobId: 88 });
  await assert.rejects(a.exec({ hostname: 'h1' }), /Job başarısız: failed \(job #88\)/);

  awx(t, { durum: 'running', jobId: 89 });
  const p = await a.exec({ hostname: 'h2' });
  assert.match(p.text, /henüz tamamlanmadı \(jobId=89\)/);
  awx(t, { durum: 'successful', jobId: 89, cikti: 'heap %40' });
  const sonuc = await arac(t, 'portal_logx_job_result');
  assert.equal((await sonuc.exec({ jobId: 89 })).text, `[h2] JVM heap:\n${CIZGI}\nheap %40`);
});

test('AT10 OCP playbook: cluster tam / kismi eslesme, bulunamadi, jump host yok, namespace yedegi', async (t) => {
  const a = await arac(t, 'portal_playbook_ocp_pod', KULLANICI, { kayitlar: KAYITLAR });
  await assert.rejects(a.exec({}), /clusterName zorunlu\./);
  t.mock.method(runner, 'getOcpClusters', () => [
    { name: 'ocp-ank-yedek', display: 'Ankara Yedek', jumpHost: 'jump9' },
    { name: 'ocp-ank', display: 'Ankara OCP', jumpHost: 'jump1', namespace: 'ns-def' },
    { name: 'ocp-ist', display: 'Istanbul', jumpHost: '' },
  ]);
  const launch = awx(t, { cikti: 'pod listesi' });

  // Tam ad eslesmesi, listede once gelen kismi eslesmeden onceliklidir.
  let r = await a.exec({ clusterName: 'OCP-ANK' });
  assert.deepEqual(launch.mock.calls[0].arguments, [
    79,
    { jump_host: 'jump1', namespace: 'ns-def', label_selector: '' },
    'jump1',
  ]);
  assert.equal(r.text, `[Ankara OCP] OCP pod:\n${CIZGI}\npod listesi`);

  r = await a.exec({ clusterName: 'ankara ocp', namespace: 'odeme', labelSelector: 'app=x' });
  assert.deepEqual(launch.mock.calls[1].arguments[1], {
    jump_host: 'jump1',
    namespace: 'odeme',
    label_selector: 'app=x',
  });

  await a.exec({ clusterName: 'yedek' });
  assert.deepEqual(launch.mock.calls[2].arguments[1], {
    jump_host: 'jump9',
    namespace: '',
    label_selector: '',
  });

  assert.equal(
    (await a.exec({ clusterName: 'ocp-ist' })).text,
    '"Istanbul" cluster\'ı için jump/bastion host tanımlı değil — Admin > OCP Yapılandırma > OCP Cluster Hiyerarşisi\'nden ekleyin.',
  );
  assert.equal(
    (await a.exec({ clusterName: 'izmir' })).text,
    '"izmir" adında kayıtlı bir OCP cluster bulunamadı. Kayıtlı cluster\'lar: Ankara Yedek, Ankara OCP, Istanbul',
  );
  runner.getOcpClusters.mock.mockImplementation(() => []);
  assert.match((await a.exec({ clusterName: 'izmir' })).text, /Kayıtlı cluster'lar: \(yok\)$/);
  assert.equal(launch.mock.callCount(), 3);
});

test('AT11 AWX baslatma araci yalniz Admin ve feature:ai_infra_launch acikken sunulur', async (t) => {
  const baslat = ['portal_ansible_run_template', 'portal_ansible_job_status'];
  let adlar = (await araclar(t, KULLANICI)).map((x) => x.name);
  assert.deepEqual(adlar, TABAN);

  adlar = (await pt.getPortalTools(ADMIN)).map((x) => x.name);
  assert.deepEqual(adlar, [...TABAN, ...baslat]);
  const sorulan = gorunurluk.canSee.mock.calls.at(-1).arguments;
  assert.deepEqual(sorulan, [ADMIN, 'feature:ai_infra_launch']);

  gorunurluk.canSee.mock.mockImplementation(async (u, k) => k !== 'feature:ai_infra_launch');
  adlar = (await pt.getPortalTools(ADMIN)).map((x) => x.name);
  assert.deepEqual(adlar, TABAN);
  // Rol adi tam eslesir.
  gorunurluk.canSee.mock.mockImplementation(async () => true);
  adlar = (await pt.getPortalTools({ username: 'x', role: 'admin' })).map((x) => x.name);
  assert.deepEqual(adlar, TABAN);
});

/** Baslatma araci 3 sn bekler: zamanlayici sahte, ilerletilir. */
async function baslatVeBekle(t, a, girdi) {
  const p = a.exec(girdi);
  await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(3000);
  return p;
}

test("AT12 AWX baslatma: allowlist kontrolu runner'da; basari ve hata denetime yazilir, durum yedegi", async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const a = await arac(t, 'portal_ansible_run_template', ADMIN);
  const kayitla = t.mock.method(denetim, 'log', async () => {});
  const launch = t.mock.method(runner, 'launchJob', async () => ({
    jobId: 900,
    status: 'pending',
  }));
  const durum = t.mock.method(runner, 'getJobStatus', async () => ({ status: 'running' }));

  let r = await baslatVeBekle(t, a, { templateId: '12', extraVars: { a: 1 }, limit: 'h1' });
  assert.deepEqual(launch.mock.calls[0].arguments, [12, { a: 1 }, 'h1']);
  assert.deepEqual(durum.mock.calls[0].arguments, [900]);
  assert.equal(
    r.text,
    'AWX job başlatıldı: templateId=12, jobId=900, durum=running (henüz sonuçlanmamış olabilir — portal_ansible_job_status ile takip edin).',
  );
  assert.deepEqual(kayitla.mock.calls[0].arguments, [
    {
      username: 'yonetici',
      role: 'Admin',
      action: 'ai_ansible_launch',
      result: 'success',
      detail: 'templateId=12 extraVars={"a":1} limit=h1 jobId=900',
    },
  ]);

  // Varsayilanlar ve durum okunamazsa baslatma durumu; denetim yazilamasa da sonuc doner.
  durum.mock.mockImplementation(async () => {
    throw new Error('awx yok');
  });
  kayitla.mock.mockImplementation(async () => {
    throw new Error('db yok');
  });
  r = await baslatVeBekle(t, a, { templateId: 12 });
  assert.deepEqual(launch.mock.calls[1].arguments, [12, {}, '']);
  assert.match(r.text, /jobId=900, durum=pending \(/);
  assert.equal(
    kayitla.mock.calls[1].arguments[0].detail,
    'templateId=12 extraVars={} limit=- jobId=900',
  );

  // Uzun extraVars denetim kaydinda 500 karakterle sinirli.
  kayitla.mock.mockImplementation(async () => {});
  await baslatVeBekle(t, a, { templateId: 12, extraVars: { v: 'y'.repeat(900) } });
  const detay = kayitla.mock.calls[2].arguments[0].detail;
  assert.equal(
    detay,
    `templateId=12 extraVars=${JSON.stringify({ v: 'y'.repeat(900) }).slice(0, 500)} limit=- jobId=900`,
  );

  // Runner reddederse (or. allowlist disi): hata aynen yukari, denetime 'error'.
  launch.mock.mockImplementation(async () => {
    throw new Error('Template 99 izin listesinde degil');
  });
  await assert.rejects(
    a.exec({ templateId: 99, limit: 'h9' }),
    /Template 99 izin listesinde degil/,
  );
  assert.deepEqual(kayitla.mock.calls[3].arguments[0], {
    username: 'yonetici',
    role: 'Admin',
    action: 'ai_ansible_launch',
    result: 'error',
    detail: 'templateId=99 extraVars={} limit=h9 error=Template 99 izin listesinde degil',
  });
  assert.equal(durum.mock.callCount(), 3);
});

test('AT13 AWX is durumu: sayisal jobId, eksik zamanlar "-"', async (t) => {
  const a = await arac(t, 'portal_ansible_job_status', ADMIN);
  const durum = t.mock.method(runner, 'getJobStatus', async () => ({
    status: 'successful',
    started: '2026-11-27T10:00:00Z',
  }));
  assert.equal(
    (await a.exec({ jobId: '7' })).text,
    'Job #7: durum=successful, başladı=2026-11-27T10:00:00Z, bitti=-',
  );
  assert.deepEqual(durum.mock.calls[0].arguments, [7]);
  durum.mock.mockImplementation(async () => ({ status: 'pending' }));
  assert.equal((await a.exec({ jobId: 8 })).text, 'Job #8: durum=pending, başladı=-, bitti=-');
});

test('AT14 bekleyen isler: en cok 200 kayit, en eskisi duser; ayni is yeniden sorulursa sona alinir', async (t) => {
  pt._pendingJobs.clear();
  const a = await arac(t, 'portal_logx_fetch_log');
  let siradaki = 1;
  t.mock.method(runner, 'isConfigured', () => true);
  t.mock.method(runner, 'launchJob', async () => ({ jobId: siradaki, status: 'pending' }));
  t.mock.method(runner, 'getJobStatus', async () => ({ status: 'running' }));
  await ortamla({ AWX_LOG_FETCH_TEMPLATE_ID: '42' }, async () => {
    for (; siradaki <= 200; siradaki++) await a.exec({ hostname: 'h', logFilePath: '/l' });
    assert.equal(pt._pendingJobs.size, 200);
    // 5 numarali is yeniden bekleniyor: kaydi tazelenir ve sona alinir (yerinde kalmaz).
    siradaki = 5;
    await a.exec({ hostname: 'h', logFilePath: '/yeni' });
    assert.equal(pt._pendingJobs.size, 200);
    assert.equal(pt._pendingJobs.get(5).logFilePath, '/yeni');
    assert.ok(pt._pendingJobs.has(1));
    // Bes yeni is: en eski bes (1-4 ve 6) duser; sona alinan 5 kalir.
    for (siradaki = 201; siradaki <= 205; siradaki++)
      await a.exec({ hostname: 'h', logFilePath: '/l' });
    assert.equal(pt._pendingJobs.size, 200);
    for (const id of [1, 2, 3, 4, 6]) assert.equal(pt._pendingJobs.has(id), false, `is ${id}`);
    for (const id of [5, 7, 200, 205]) assert.ok(pt._pendingJobs.has(id), `is ${id}`);
  });
});

test('AT15 bekleyen isler 15 dk sonra 5 dakikalik suprurmede silinir; tazeler kalir', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 });
  const yol = require.resolve('../portal-tools.cjs');
  delete require.cache[yol];
  const taze = require('../portal-tools.cjs');
  taze._setQuickCheckDelayMs(1);
  t.after(() => {
    delete require.cache[yol];
  });
  kur(t);
  const a = (await taze.getPortalTools(KULLANICI)).find((x) => x.name === 'portal_logx_fetch_log');
  let id = 1;
  t.mock.method(runner, 'isConfigured', () => true);
  t.mock.method(runner, 'launchJob', async () => ({ jobId: id, status: 'pending' }));
  t.mock.method(runner, 'getJobStatus', async () => ({ status: 'running' }));
  await ortamla({ AWX_LOG_FETCH_TEMPLATE_ID: '42' }, async () => {
    await a.exec({ hostname: 'h', logFilePath: '/l' }); // t=0
    t.mock.timers.tick(10 * 60_000);
    id = 2;
    await a.exec({ hostname: 'h', logFilePath: '/l' }); // t=10 dk
    t.mock.timers.tick(5 * 60_000); // t=15 dk: 1 numara tam 15 dk, henuz silinmez
    assert.deepEqual([...taze._pendingJobs.keys()], [1, 2]);
    t.mock.timers.tick(5 * 60_000); // t=20 dk
    assert.deepEqual([...taze._pendingJobs.keys()], [2]);
    t.mock.timers.tick(10 * 60_000); // t=30 dk
    assert.equal(taze._pendingJobs.size, 0);
  });
});
