// server/server-hub/__tests__/reboot-check-awx.test.js - Reboot Kontrolu: AWX'te (workflow ya da elle) kosan
// reboot_check islerinin Portal'a alimi (2026-11-17).
//
// Kullanici: "bu job'i unix admin ekibime versem ... kendi Ansible workflow'larina ekleseler remediation calisir mi?
// portal'a veri gelir mi? ... iki turlu de sistem calissin ... direkt ansible'dan calistirildigi takdirde portal'da
// goruntuleme sansimiz varsa onu da yapalim."
//
//   RA1  sablon yoksa AWX'e gidilmez; tarama en cok 2 dk'da bir; Portal'in kendi isi (once ya da sonra) ALINMAZ ve
//        detayi okunmaz; set_stats'siz / baska sablon / sunucusuz is alinmaz ve bir daha okunmaz; AWX okunamazsa
//        yeniden denenir
//   RA2  workflow: once isi AWX kaynakli kayit acar (ilerlet ile once_hazir, once_json Portal biciminde); ayni workflow'un
//        sonra isi AYNI kayda baglanir ve Portal'in degerlendirmesiyle (sonraOzeti) sonuclanir; isler eskiden yeniye
//   RA3  workflow'suz sonra isi: once'si sonradan ONCE alinmis, sunuculari kapsayan EN YENI AWX kaydina baglanir; baska
//        workflow'un kaydina, sonra'si dolu ya da sunuculari kapsamayan kayda BAGLANMAZ
//   RA4  eslesmeyen sonra isi: rc_once (workflow artifacts / extra_vars) varsa once goruntusu ondan kurulur ve tek basina
//        kayit acilir; yoksa once'siz kayit (not "once goruntusu bulunamadi")
//   RA5  ayni is iki kez alinmaz (iki tur, iki surec: SQL UPDLOCK + HOLDLOCK); yazilan kolonlar DDL'de / ALTER'de var
//   RA6  sunucu adi yazimi korunur (kucuk harfli target_hosts: once_hazir, once_hata DEGIL); eslestirme harf duyarsiz
//   RA7  liste satiri kaynak / awxWorkflowId tasir; Portal kaydinda kaynak null
//   RA8  rcOnceOf: yalniz JSON, rc_once sozluk, satir dizisi; bozuk / YAML / dizi -> null
'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const KOK = path.join(__dirname, '..', '..');
const DB_YOLU = path.join(KOK, 'db', 'index.cjs');
const REG_YOLU = path.join(KOK, 'ansible', 'playbook-registry.cjs');
const RUNNER_YOLU = path.join(KOK, 'ansible', 'runner.cjs');
const DDL = fs.readFileSync(path.join(KOK, 'db', 'mssql-setup.cjs'), 'utf8');

const sahteModul = (yol, exports) => {
  require.cache[yol] = { id: yol, filename: yol, loaded: true, exports };
};

// Gercek goruntu bicimi (reboot-check.test.js ile ayni): BOOT satiri + izlenen urun satiri.
const BOOT = (h) => [`BOOT|${h}||`, 'URUN|NGINX||'];
const ONCE_SONUC = (hostlar) => ({
  faz: 'once',
  sunucular: Object.fromEntries(
    hostlar.map((h) => [h, { faz: 'once', betik_surum: '4', goruntu_ok: true, goruntu: BOOT(h) }]),
  ),
});
const SONRA_SONUC = (hostlar) => ({
  faz: 'sonra',
  sunucular: Object.fromEntries(
    hostlar.map((h) => [
      h,
      {
        faz: 'sonra',
        betik_surum: '4',
        once_var: true,
        son_olculdu: true,
        son_fark: [],
        islemler: [],
        plan: [],
        goruntu: BOOT(h),
        son_goruntu: BOOT(h),
        durulma: 'ok',
      },
    ]),
  ),
});

/**
 * Bellek ici reboot_checks: modulun ve reboot-check.cjs ilerlet/kayit'in kullandigi ifadeler. Bilinmeyen SQL hata
 * firlatir (sessizce gecmesin).
 */
function sahteDb() {
  const satirlar = [];
  let sira = 0;
  const sorgular = [];
  const isVar = (s, j) =>
    satirlar.some(
      (r) =>
        (r.once_server_id === s && r.once_job_id === j) ||
        (r.sonra_server_id === s && r.sonra_job_id === j),
    );
  const simdi = () => new Date();
  const mod = {
    satirlar,
    sorgular,
    async query(sql, p = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      sorgular.push(q.slice(0, 60));
      if (
        q.startsWith(
          'SELECT TOP 1 id FROM reboot_checks WHERE (once_server_id = $1 AND once_job_id = $2)',
        )
      ) {
        return {
          rows: satirlar
            .filter(
              (r) =>
                isVar(p[0], p[1]) &&
                ((r.once_server_id === p[0] && r.once_job_id === p[1]) ||
                  (r.sonra_server_id === p[0] && r.sonra_job_id === p[1])),
            )
            .slice(0, 1),
        };
      }
      if (
        q.includes(
          'INSERT INTO reboot_checks (hosts_json, notes, status, created_by, once_job_id, once_server_id, kaynak, awx_workflow_id)',
        )
      ) {
        assert.match(q, /WITH \(UPDLOCK, HOLDLOCK\)/);
        if (isVar(p[4], p[3])) return { rows: [{ id: null }] };
        const id = ++sira;
        satirlar.push({
          id,
          hosts_json: p[0],
          notes: p[1],
          status: 'once_kosuyor',
          created_by: p[2],
          created_at: simdi(),
          once_job_id: p[3],
          once_server_id: p[4],
          kaynak: 'AWX',
          awx_workflow_id: p[5],
          once_at: null,
          once_json: null,
          sonra_job_id: null,
          sonra_server_id: null,
          sonra_at: null,
          sonra_hedef_json: null,
          sonra_json: null,
          ozet_json: null,
          updated_at: simdi(),
        });
        return { rows: [{ id }] };
      }
      if (
        q.includes(
          'INSERT INTO reboot_checks (hosts_json, notes, status, created_by, once_json, once_at, ozet_json, sonra_job_id',
        )
      ) {
        assert.match(q, /WITH \(UPDLOCK, HOLDLOCK\)/);
        if (isVar(p[6], p[5])) return { rows: [{ id: null }] };
        const id = ++sira;
        satirlar.push({
          id,
          hosts_json: p[0],
          notes: p[1],
          status: 'sonra_kosuyor',
          created_by: p[2],
          created_at: simdi(),
          once_json: p[3],
          once_at: p[3] == null ? null : simdi(),
          ozet_json: p[4],
          sonra_job_id: p[5],
          sonra_server_id: p[6],
          sonra_hedef_json: p[7],
          kaynak: 'AWX',
          awx_workflow_id: p[8],
          once_job_id: null,
          once_server_id: null,
          sonra_at: null,
          sonra_json: null,
          updated_at: simdi(),
        });
        return { rows: [{ id }] };
      }
      if (q.includes("UPDATE reboot_checks SET status = 'sonra_kosuyor', sonra_job_id = $1")) {
        assert.match(q, /WITH \(UPDLOCK, HOLDLOCK\)/);
        const r = satirlar.find((x) => x.id === p[3]);
        if (!r || r.sonra_job_id != null || r.status !== 'once_hazir' || isVar(p[1], p[0]))
          return { rows: [{ n: 0 }] };
        Object.assign(r, {
          status: 'sonra_kosuyor',
          sonra_job_id: p[0],
          sonra_server_id: p[1],
          sonra_hedef_json: p[2],
          sonra_json: null,
          updated_at: simdi(),
        });
        return { rows: [{ n: 1 }] };
      }
      if (
        q.startsWith(
          "SELECT TOP 50 * FROM reboot_checks WHERE kaynak = 'AWX' AND once_server_id = $1 AND sonra_job_id IS NULL AND status = 'once_hazir' AND once_job_id IS NOT NULL AND once_job_id < $2",
        )
      ) {
        // Sira AWX is numarasiyla (once < sonra) - SQL metni birebir; ice alma ani (once_at) kullanilmaz.
        assert.match(
          q,
          /AND once_job_id IS NOT NULL AND once_job_id < \$2 AND created_at >= DATEADD\(day, -7, SYSUTCDATETIME\(\)\) ORDER BY once_job_id DESC$/,
        );
        assert.doesNotMatch(q, /once_at/);
        return {
          rows: satirlar
            .filter(
              (r) =>
                r.kaynak === 'AWX' &&
                r.once_server_id === p[0] &&
                r.sonra_job_id == null &&
                r.status === 'once_hazir' &&
                r.once_job_id != null &&
                r.once_job_id < p[1],
            )
            .sort((a, b) => b.once_job_id - a.once_job_id)
            .slice(0, 50),
        };
      }
      if (q.startsWith('SELECT TOP 1 1 AS var FROM ansible_job_history WHERE job_id = $1')) {
        if (mod.gecmisPatlar) throw new Error('gecmis okunamadi');
        return { rows: (mod.portalIsleri || []).includes(p[0]) ? [{ var: 1 }] : [] };
      }
      if (q === 'SELECT * FROM reboot_checks WHERE id = $1')
        return { rows: satirlar.filter((r) => r.id === p[0]) };
      if (
        q.startsWith('UPDATE reboot_checks SET status = $1, once_json = $2, once_at = GETUTCDATE()')
      ) {
        const r = satirlar.find((x) => x.id === p[3] && x.status === 'once_kosuyor');
        if (r)
          Object.assign(r, {
            status: p[0],
            once_json: p[1],
            once_at: mod.onceAt || simdi(),
            ozet_json: p[2],
            updated_at: simdi(),
          });
        return { rows: [] };
      }
      if (
        q.startsWith(
          'UPDATE reboot_checks SET status = $1, sonra_json = $2, sonra_at = GETUTCDATE()',
        )
      ) {
        const r = satirlar.find((x) => x.id === p[3] && x.status === 'sonra_kosuyor');
        if (r)
          Object.assign(r, {
            status: p[0],
            sonra_json: p[1],
            sonra_at: simdi(),
            ozet_json: p[2],
            updated_at: simdi(),
          });
        return { rows: [] };
      }
      throw new Error(`beklenmeyen sorgu: ${q.slice(0, 160)}`);
    },
  };
  return mod;
}

let awx;
let rc;
let db;
beforeEach(() => {
  for (const k of Object.keys(require.cache))
    if (/reboot-check(-awx)?\.cjs$/.test(k)) delete require.cache[k];
  db = sahteDb();
  sahteModul(DB_YOLU, db);
  sahteModul(REG_YOLU, {
    getByKey: async () => ({ enabled: true, awxServerId: 2 }),
    getEffectiveTemplateId: () => 77,
  });
  awx = require('../reboot-check-awx.cjs');
  rc = require('../reboot-check.cjs');
  awx._sifirlaForTest();
});
afterEach(() => {
  for (const y of [DB_YOLU, REG_YOLU, RUNNER_YOLU]) delete require.cache[y];
});

/** Sahte AWX: isler { id: { status, artifacts, workflowJobId, started, extraVarsHam, templateId } }. */
function awxKur(isler, { liste = null, okunamaz = new Set() } = {}) {
  const okunan = [];
  sahteModul(RUNNER_YOLU, {
    redactSecrets: (s) => s,
    listTemplateJobsOnServer: async (serverId, templateId) => {
      assert.deepEqual([serverId, templateId], [2, 77]);
      return (liste || Object.keys(isler).map(Number)).map((id) => ({
        id,
        status: 'successful',
        finished: '2026-11-17T10:00:00Z',
      }));
    },
    getJobStatusOnServer: async (serverId, jobId) => {
      okunan.push(jobId);
      if (okunamaz.has(jobId)) throw new Error('AWX zaman asimi');
      const j = isler[jobId];
      return {
        jobId,
        status: 'successful',
        templateId: 77,
        launchedBy: 'unix-ekip',
        created: '2026-11-17T09:00:00Z',
        extraVarsHam: '',
        ...j,
      };
    },
  });
  return okunan;
}

test('RA1 sablon yok / 2 dk siniri / Portal isi / alinmayan isler', async () => {
  sahteModul(REG_YOLU, { getByKey: async () => null, getEffectiveTemplateId: () => null });
  let liste = 0;
  sahteModul(RUNNER_YOLU, {
    listTemplateJobsOnServer: async () => {
      liste += 1;
      return [];
    },
  });
  assert.deepEqual(await awx.awxIsleriniAl({ simdi: 1_000_000 }), { atlandi: 'template_yok' });
  assert.equal(liste, 0);
  assert.equal(
    await awx.awxIsleriniAl({ simdi: 1_000_000 + 60_000 }),
    null,
    '2 dk dolmadan tarama yok',
  );

  sahteModul(REG_YOLU, {
    getByKey: async () => ({ enabled: true, awxServerId: 2 }),
    getEffectiveTemplateId: () => 77,
  });
  // Portal'in kendi kaydi: once 10, sonra 11.
  db.satirlar.push({
    id: 900,
    once_server_id: 2,
    once_job_id: 10,
    sonra_server_id: 2,
    sonra_job_id: 11,
    status: 'tamam',
  });
  const okunan = awxKur(
    {
      10: { artifacts: { reboot_check_result: ONCE_SONUC(['A']) } },
      11: { artifacts: { reboot_check_result: SONRA_SONUC(['A']) } },
      12: { artifacts: {} },
      13: { templateId: 99, artifacts: { reboot_check_result: ONCE_SONUC(['A']) } },
      14: { artifacts: { reboot_check_result: { faz: 'once', sunucular: { 'kotu ad': {} } } } },
      15: { artifacts: { reboot_check_result: { faz: 'baska', sunucular: { A: {} } } } },
      16: {},
    },
    { okunamaz: new Set([16]) },
  );
  const r = await awx.awxIsleriniAl({ simdi: 2_000_000, zorla: true });
  assert.deepEqual(r, { alinan: [] });
  assert.deepEqual(
    okunan.sort((a, b) => a - b),
    [12, 13, 14, 15, 16],
    'Portal isinin (10, 11) detayi okunmaz',
  );
  assert.equal(db.satirlar.length, 1, 'hicbir kayit acilmadi');
  okunan.length = 0;
  await awx.awxIsleriniAl({ simdi: 3_000_000, zorla: true });
  assert.deepEqual(okunan, [16], 'kesin alinmayan is bir daha okunmaz; okunamayan yeniden denenir');
});

test('RA2 workflow: once kayit acar, ayni workflow sonra ayni kayda baglanir ve Portal kuralla sonuclanir', async () => {
  awxKur(
    {
      // Bilerek ters sira: alim eskiden yeniye gider (once once).
      502: {
        workflowJobId: 7000,
        started: '2026-11-17T09:30:00Z',
        artifacts: { reboot_check_result: SONRA_SONUC(['GBNGXT13']) },
      },
      501: {
        workflowJobId: 7000,
        started: '2026-11-17T08:00:00Z',
        artifacts: {
          reboot_check_result: ONCE_SONUC(['GBNGXT13']),
          rc_once: { GBNGXT13: BOOT('GBNGXT13') },
        },
      },
    },
    { liste: [502, 501] },
  );
  db.onceAt = new Date('2026-11-17T08:05:00Z');
  const r = await awx.awxIsleriniAl({ simdi: Date.parse('2026-11-17T10:00:00Z'), zorla: true });
  assert.equal(r.alinan.length, 2);
  assert.equal(db.satirlar.length, 1, 'once ve sonra TEK kayit');
  const k = db.satirlar[0];
  assert.equal(k.kaynak, 'AWX');
  assert.equal(k.awx_workflow_id, 7000);
  assert.deepEqual([k.once_job_id, k.sonra_job_id], [501, 502]);
  assert.match(k.created_by, /^awx:unix-ekip$/);
  assert.match(k.notes, /AWX'ten alındı: iş #501, workflow #7000, başlatan unix-ekip/);
  assert.deepEqual(JSON.parse(k.hosts_json), ['GBNGXT13']);
  assert.equal(k.status, 'tamam', 'Portal degerlendirmesi: fark yok, olculdu -> tamam');
  const ozet = JSON.parse(k.ozet_json);
  assert.equal(ozet.once.alinan, 1);
  assert.equal(ozet.sonra.sorunsuz, 1);
  // Alinan kayit Portal'in rc_once girdisini kurabilir (Portal'dan sonra da calisir).
  assert.deepEqual(rc.onceGirdisi(JSON.parse(k.once_json).sunucular), {
    GBNGXT13: BOOT('GBNGXT13'),
  });
});

test("RA3 workflow'suz sonra: kapsayan en yeni once kaydina; baska workflow / dolu / kapsamayan / sonraki once kayda degil", async () => {
  const t = (s) => new Date(s);
  const ekle = (o) =>
    db.satirlar.push({
      kaynak: 'AWX',
      once_server_id: 2,
      sonra_job_id: null,
      sonra_server_id: null,
      status: 'once_hazir',
      once_json: JSON.stringify(ONCE_SONUC(['A', 'B'])),
      awx_workflow_id: null,
      ...o,
    });
  ekle({
    id: 1,
    once_job_id: 1,
    hosts_json: '["A","B"]',
    once_at: t(new Date(Date.now() - 3600_000).toISOString()),
  }); // uygun ama eski
  ekle({
    id: 2,
    once_job_id: 2,
    hosts_json: '["A","B"]',
    once_at: t(new Date(Date.now() - 1800_000).toISOString()),
  }); // uygun, en yeni
  ekle({
    id: 3,
    once_job_id: 3,
    hosts_json: '["A"]',
    once_at: t(new Date(Date.now() - 600_000).toISOString()),
  }); // B'yi kapsamaz
  ekle({
    id: 4,
    once_job_id: 4,
    hosts_json: '["A","B"]',
    once_at: t(new Date(Date.now() - 300_000).toISOString()),
    awx_workflow_id: 55,
  }); // baska workflow
  ekle({
    id: 5,
    // AWX'te sonra isinden (700) SONRA kosmus once (is numarasi buyuk): baglanmaz. Sira is numarasiyla (once_at degil).
    once_job_id: 800,
    hosts_json: '["A","B"]',
    once_at: t(new Date(Date.now() - 60_000).toISOString()),
  }); // sonradan kosmus
  ekle({
    id: 6,
    once_job_id: 6,
    hosts_json: '["A","B"]',
    once_at: t(new Date(Date.now() - 100_000).toISOString()),
    sonra_job_id: 66,
    sonra_server_id: 2,
    status: 'tamam',
  });
  awxKur(
    {
      700: {
        workflowJobId: 99,
        started: new Date().toISOString(),
        artifacts: { reboot_check_result: SONRA_SONUC(['a', 'B']) },
      },
    },
    { liste: [700] },
  );
  await awx.awxIsleriniAl({ zorla: true });
  const bagli = db.satirlar.filter((r) => r.sonra_job_id === 700);
  assert.deepEqual(
    bagli.map((r) => r.id),
    [2],
    'kucuk harfli a dahil, kapsayan en yeni kayit',
  );
  assert.equal(db.satirlar.length, 6, 'yeni kayit acilmadi');
});

test("RA4 eslesmeyen sonra: rc_once varsa once ondan, yoksa once'siz kayit", async () => {
  awxKur({
    801: {
      artifacts: { reboot_check_result: SONRA_SONUC(['C']) },
      extraVarsHam: JSON.stringify({ rc_faz: 'sonra', rc_once: { C: BOOT('C') } }),
    },
    // rc_once verilmeyen sunucuda playbook once_var false yazar (rc_once_var: host rc_once'ta degil).
    802: {
      artifacts: {
        reboot_check_result: {
          faz: 'sonra',
          sunucular: { D: { ...SONRA_SONUC(['D']).sunucular.D, once_var: false } },
        },
      },
      extraVarsHam: 'rc_faz: sonra\n',
    },
  });
  await awx.awxIsleriniAl({ zorla: true });
  const c = db.satirlar.find((r) => r.sonra_job_id === 801);
  const d = db.satirlar.find((r) => r.sonra_job_id === 802);
  assert.ok(c && d);
  assert.deepEqual(rc.onceGirdisi(JSON.parse(c.once_json).sunucular), { C: BOOT('C') });
  assert.equal(c.status, 'tamam');
  assert.doesNotMatch(c.notes, /bulunamadı/);
  assert.equal(d.once_json, null);
  assert.match(d.notes, /önce görüntüsü bulunamadı/);
  assert.notEqual(d.status, 'tamam', 'once goruntusu olmayan sunucu sorunsuz sayilmaz');
});

test("RA5 ayni is iki kez alinmaz; yazilan kolonlar DDL/ALTER'de", async () => {
  awxKur({ 901: { artifacts: { reboot_check_result: ONCE_SONUC(['E']) } } });
  await awx.awxIsleriniAl({ zorla: true });
  awx._sifirlaForTest();
  await awx.awxIsleriniAl({ zorla: true });
  // Ikinci surec: on denetimi gecmis gibi dogrudan SQL'e gelir; UPDLOCK kosulu eklemez.
  const r = await db.query(awx.ONCE_EKLE_SQL, ['["E"]', 'x', 'awx:x', 901, 2, null]);
  assert.equal(r.rows[0].id, null);
  assert.equal(db.satirlar.filter((x) => x.once_job_id === 901).length, 1);
  for (const kolon of ['kaynak', 'awx_workflow_id'])
    assert.match(
      DDL,
      new RegExp(`ALTER TABLE reboot_checks ADD ${kolon} `),
      `${kolon} ALTER ile eklenir`,
    );
  for (const kolon of [
    'hosts_json',
    'notes',
    'status',
    'created_by',
    'once_job_id',
    'once_server_id',
    'once_json',
    'once_at',
    'ozet_json',
    'sonra_job_id',
    'sonra_server_id',
    'sonra_hedef_json',
  ])
    assert.match(DDL, new RegExp(`\\b${kolon}\\s+(INT|NVARCHAR|DATETIME2)`), `${kolon} DDL'de`);
});

test('RA6 kucuk harfli hedef: yazim korunur, once_hazir', async () => {
  awxKur({ 950: { artifacts: { reboot_check_result: ONCE_SONUC(['gbngxt13']) } } });
  await awx.awxIsleriniAl({ zorla: true });
  const k = db.satirlar[0];
  assert.deepEqual(JSON.parse(k.hosts_json), ['gbngxt13']);
  assert.equal(k.status, 'once_hazir');
});

test('RA7 liste satiri kaynak / awxWorkflowId tasir', () => {
  const kaynak = fs.readFileSync(path.join(KOK, 'server-hub', 'reboot-check.cjs'), 'utf8');
  assert.match(
    kaynak,
    /sonra_job_id, sonra_server_id, sonra_at, ozet_json, kaynak, awx_workflow_id FROM reboot_checks/,
  );
  assert.match(kaynak, /kaynak: r\.kaynak === 'AWX' \? 'AWX' : null/);
});

test('RA8 rcOnceOf', () => {
  assert.deepEqual(
    awx.rcOnceOf(JSON.stringify({ rc_once: { a: ['BOOT|1', 2], 'kotu ad': ['x'], b: 'x' } })),
    { a: ['BOOT|1', '2'] },
  );
  for (const v of [
    '',
    'rc_once: {}',
    '{bozuk',
    JSON.stringify({ rc_once: [] }),
    JSON.stringify({ rc_once: {} }),
    JSON.stringify({}),
  ])
    assert.equal(awx.rcOnceOf(v), null, v);
});

// Dogrulama bulgulari (2026-11-17):
//   RA9  ayni workflow'da iki once (parti 1: A,B; parti 2: C,D): sonra isi rc_once'unun sunuculariyla DOGRU kayda baglanir,
//        workflow'un en yeni kaydina degil; kapsamayan kayda hic baglanmaz
//   RA10 Portal'in baslattigi is (ansible_job_history'de; yeniden calistirmada kayittan dusen eski sonra isi) ALINMAZ;
//        gecmis okunamazsa is alinmaz ve sonraki turda yeniden denenir
//   RA11 gec alinan once (ice alma ani sonra isinin baslangicindan SONRA) yine eslesir: sira is numarasiyla
test('RA9 ayni workflow iki once: rc_once ile dogru kayit', async () => {
  awxKur(
    {
      601: { workflowJobId: 9000, artifacts: { reboot_check_result: ONCE_SONUC(['A', 'B']) } },
      602: { workflowJobId: 9000, artifacts: { reboot_check_result: ONCE_SONUC(['C', 'D']) } },
      603: {
        workflowJobId: 9000,
        artifacts: { reboot_check_result: SONRA_SONUC(['A', 'B']) },
        extraVarsHam: JSON.stringify({ rc_faz: 'sonra', rc_once: { A: BOOT('A'), B: BOOT('B') } }),
      },
    },
    { liste: [601, 602, 603] },
  );
  await awx.awxIsleriniAl({ zorla: true });
  const ab = db.satirlar.find((r) => r.once_job_id === 601);
  const cd = db.satirlar.find((r) => r.once_job_id === 602);
  assert.equal(ab.sonra_job_id, 603, 'parti 1 sonra isi parti 1 kaydina');
  assert.equal(cd.sonra_job_id, null, 'parti 2 kaydi bos kalir');
  assert.equal(db.satirlar.length, 2, 'tek basina kayit acilmadi');
});

test('RA10 Portal gecmisindeki is alinmaz; gecmis okunamazsa yeniden denenir', async () => {
  const okunan = awxKur({ 701: { artifacts: { reboot_check_result: SONRA_SONUC(['A']) } } });
  db.portalIsleri = [701];
  let r = await awx.awxIsleriniAl({ zorla: true });
  assert.deepEqual(r, { alinan: [] });
  assert.equal(db.satirlar.length, 0);
  assert.deepEqual(okunan, [], 'Portal isinin AWX detayi okunmaz');
  // gecmis okunamadi: alinmaz, bakildi'ya yazilmaz
  awx._sifirlaForTest();
  db.portalIsleri = [];
  db.gecmisPatlar = true;
  r = await awx.awxIsleriniAl({ zorla: true });
  assert.equal(db.satirlar.length, 0);
  db.gecmisPatlar = false;
  r = await awx.awxIsleriniAl({ zorla: true });
  assert.equal(db.satirlar.length, 1, 'gecmis okununca is alinir');
});

test('RA11 gec alinan once yine eslesir (sira is numarasiyla)', async () => {
  db.satirlar.push({
    id: 50,
    kaynak: 'AWX',
    once_server_id: 2,
    once_job_id: 640,
    sonra_job_id: null,
    sonra_server_id: null,
    status: 'once_hazir',
    hosts_json: '["A"]',
    once_json: JSON.stringify(ONCE_SONUC(['A'])),
    // ice alma ani sonra isinin baslangicindan SONRA (ayni turda / gecikmeli alim)
    once_at: new Date(Date.now() + 3600_000),
    awx_workflow_id: null,
  });
  awxKur({
    650: {
      started: new Date().toISOString(),
      artifacts: { reboot_check_result: SONRA_SONUC(['A']) },
    },
  });
  await awx.awxIsleriniAl({ zorla: true });
  assert.equal(db.satirlar.find((r) => r.id === 50).sonra_job_id, 650);
  assert.equal(db.satirlar.length, 1);
});

test("RA9b iki aday da sunuculari kapsiyor: rc_once hangi once'den geldiyse o kayit secilir (en yeni degil)", async () => {
  awxKur(
    {
      611: { workflowJobId: 9100, artifacts: { reboot_check_result: ONCE_SONUC(['A', 'B']) } },
      612: { workflowJobId: 9100, artifacts: { reboot_check_result: ONCE_SONUC(['A', 'B', 'C']) } },
      613: {
        workflowJobId: 9100,
        artifacts: { reboot_check_result: SONRA_SONUC(['A', 'B']) },
        extraVarsHam: JSON.stringify({ rc_faz: 'sonra', rc_once: { A: BOOT('A'), B: BOOT('B') } }),
      },
    },
    { liste: [611, 612, 613] },
  );
  await awx.awxIsleriniAl({ zorla: true });
  assert.equal(
    db.satirlar.find((r) => r.once_job_id === 611).sonra_job_id,
    613,
    'rc_once {A,B} -> A,B kaydi',
  );
  assert.equal(
    db.satirlar.find((r) => r.once_job_id === 612).sonra_job_id,
    null,
    'daha yeni A,B,C kaydi secilmez',
  );
});
