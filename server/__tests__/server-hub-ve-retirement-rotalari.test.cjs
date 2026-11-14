'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

function setMockModule(relPath, exportsValue, backups) {
  const resolved = require.resolve(relPath);
  if (!backups.has(resolved)) {
    backups.set(resolved, require.cache[resolved] || null);
  }
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsValue,
  };
}

function restoreModules(backups, selfPaths) {
  for (const [resolved, orig] of backups.entries()) {
    if (orig) require.cache[resolved] = orig;
    else delete require.cache[resolved];
  }
  for (const sp of selfPaths) {
    try {
      delete require.cache[require.resolve(sp)];
    } catch {
      /* yoksay */
    }
  }
}

test('server/server-hub/index + reboot-check: overview, findings, host, scan, fix, autostart, karsilastirma, reboot-check', async (t) => {
  const backups = new Map();
  const today = new Date().toISOString().slice(0, 10);
  const rcRows = new Map([
    [
      1,
      {
        id: 1,
        hosts_json: JSON.stringify(['APP01']),
        sonra_hedef_json: JSON.stringify(['APP01']),
        notes: 'bakim',
        status: 'once_kosuyor',
        created_by: 'alice',
        created_at: new Date().toISOString(),
        once_job_id: 9901,
        once_server_id: 0,
        once_at: null,
        once_json: null,
        sonra_job_id: null,
        sonra_server_id: 0,
        sonra_at: null,
        sonra_json: null,
        ozet_json: null,
      },
    ],
  ]);
  let rcSeq = 2;

  setMockModule(
    '../inventory/mssql.cjs',
    {
      query: async (sqlText) => {
        if (sqlText.includes('sys.columns') && sqlText.includes('dbo.Inventory')) {
          return {
            recordset: [
              { name: 'host' },
              { name: 'env' },
              { name: 'jboss_version' },
              { name: 'rha_version' },
            ],
          };
        }
        if (sqlText.includes('sys.columns')) {
          return {
            recordset: [
              { tbl: 'Server_Hub_Hosts', name: 'host' },
              { tbl: 'Server_Hub_Hosts', name: 'scan_date' },
              { tbl: 'Server_Hub_Hosts', name: 'products' },
              { tbl: 'Server_Hub_Hosts', name: 'scan_ver' },
              { tbl: 'Server_Hub_Hosts', name: 'loaded_at' },
              { tbl: 'Server_Hub_Jvms', name: 'host' },
              { tbl: 'Server_Hub_Jvms', name: 'scan_date' },
              { tbl: 'Server_Hub_Jvms', name: 'gen' },
              { tbl: 'Server_Hub_Jvms', name: 'jvm' },
              { tbl: 'Server_Hub_Jvms', name: 'grp' },
              { tbl: 'Server_Hub_Jvms', name: 'running' },
              { tbl: 'Server_Hub_Jvms', name: 'auto_start' },
              { tbl: 'Server_Hub_Jvms', name: 'running_src' },
              { tbl: 'Server_Hub_Jvms', name: 'cfg_src' },
              { tbl: 'Server_Hub_Jvms', name: 'jvm_arg_diff' },
              { tbl: 'Server_Hub_Web', name: 'host' },
              { tbl: 'Server_Hub_Web', name: 'scan_date' },
              { tbl: 'Server_Hub_Web', name: 'product' },
              { tbl: 'Server_Hub_Web', name: 'running' },
              { tbl: 'Server_Hub_Web', name: 'syntax' },
              { tbl: 'Server_Hub_Web', name: 'detail' },
              { tbl: 'Server_Hub_Web', name: 'check_class' },
              { tbl: 'Server_Hub_Web', name: 'vhost_trust' },
              { tbl: 'Server_Hub_Web', name: 'running_src' },
              { tbl: 'Server_Hub_Vhosts', name: 'host' },
              { tbl: 'Server_Hub_Vhosts', name: 'scan_date' },
              { tbl: 'Server_Hub_Vhosts', name: 'product' },
              { tbl: 'Server_Hub_Vhosts', name: 'listen' },
              { tbl: 'Server_Hub_Vhosts', name: 'server_name' },
              { tbl: 'Server_Hub_Vhosts', name: 'proxy_targets' },
              { tbl: 'Server_Hub_Vhosts', name: 'conf_file' },
              { tbl: 'Server_Hub_Vhosts', name: 'req_24h' },
              { tbl: 'Server_Hub_Vhosts', name: 'req_7d' },
            ],
          };
        }
        if (sqlText.includes('OBJECT_ID')) {
          if (sqlText.includes('Server_Hub_Hosts')) return { recordset: [{ oid: 101 }] };
          return { recordset: [{ oid: 102 }] };
        }
        if (sqlText.includes('FROM dbo.Server_Hub_Jvms')) {
          return {
            recordset: [
              {
                host: 'APP01',
                scan_date: today,
                gen: 7,
                jvm: 'orders-srv',
                grp: 'g1',
                running: 1,
                auto_start: 'false',
                server_state: 'STARTED',
                ports: '8080',
                running_src: 'ps',
                cfg_src: 'host.xml',
                jvm_arg_fark: 0,
              },
              {
                host: 'APP01',
                scan_date: today,
                gen: 8,
                jvm: 'billing-srv',
                grp: 'g2',
                running: 1,
                auto_start: 'true',
                server_state: 'STARTED',
                ports: '8180',
                running_src: 'ps',
                cfg_src: 'host.xml',
                jvm_arg_fark: 0,
              },
            ],
          };
        }
        if (sqlText.includes('FROM dbo.Server_Hub_Web')) {
          return {
            recordset: [
              {
                host: 'APP01',
                scan_date: today,
                product: 'APACHE',
                running: 1,
                syntax: 'ok',
                detail: 'Syntax OK',
                check_class: 'syntax_ok',
                vhost_trust: 'trusted',
                running_src: 'ps',
              },
            ],
          };
        }
        if (sqlText.includes('FROM dbo.Server_Hub_Vhosts')) {
          return {
            recordset: [
              {
                host: 'APP01',
                scan_date: today,
                product: 'APACHE',
                listen: '443',
                server_name: 'orders.example.internal',
                aliases: '',
                access_log: '/var/log/httpd/orders.log',
                proxy_targets: 'http://127.0.0.1:8080',
                req_24h: 100,
                req_7d: 500,
                hc_24h: 10,
                shared: 0,
                sampled: 0,
                conf_file: '/etc/httpd/conf.d/orders.conf',
              },
            ],
          };
        }
        if (sqlText.includes('FROM dbo.Server_Hub_Init'))
          return {
            recordset: [
              {
                host: 'APP01',
                scan_date: today,
                root: '/etc/init.d',
                file: 'jboss',
                status: 'ok',
                sha512: 'abc',
              },
            ],
          };
        if (sqlText.includes('FROM dbo.Server_Hub_Jboss'))
          return {
            recordset: [
              {
                host: 'APP01',
                scan_date: today,
                gen: 7,
                host_name: 'APP01',
                host_state: 'running',
                cli: 'ok',
                note: '',
              },
            ],
          };
        if (sqlText.includes('FROM dbo.Server_Hub_Ips'))
          return {
            recordset: [
              {
                host: 'APP01',
                scan_date: today,
                ip: '198.51.100.10',
                iface: 'eth0',
                used_by: 'httpd',
                is_primary: 1,
              },
            ],
          };
        if (sqlText.includes('FROM dbo.Server_Hub_Sshd'))
          return {
            recordset: [
              {
                host: 'APP01',
                scan_date: today,
                max_sessions: 50,
                max_startups: '10:30:100',
                active_sessions: 2,
              },
            ],
          };
        if (sqlText.includes('FROM dbo.Server_Hub_Hosts')) {
          return {
            recordset: [
              {
                host: 'APP01',
                scan_date: today,
                products: 'JBOSS,APACHE',
                wall_s: 2,
                cpu_s: 1,
                note: '',
                scan_ver: '3',
                loaded_at: new Date().toISOString(),
              },
            ],
          };
        }
        if (sqlText.includes('MWAppsInventory'))
          return {
            recordset: [
              { Host: 'APP01', ApplicationName: 'orders-srv', Env: 'PROD', jboss_version: '7' },
            ],
          };
        if (sqlText.includes('dbo.Inventory'))
          return {
            recordset: [{ host: 'APP01', env: 'PROD', site: 'Pendik', owner_team: 'Core' }],
          };
        return { recordset: [] };
      },
      sql: { NVarChar: () => 'nvarchar', Int: 'int' },
    },
    backups,
  );

  setMockModule(
    '../db/index.cjs',
    {
      query: async (sqlText, params = []) => {
        if (sqlText.includes('SELECT * FROM reboot_checks WHERE id')) {
          const r = rcRows.get(Number(params[0]));
          return { rows: r ? [r] : [] };
        }
        if (sqlText.includes('FROM reboot_checks')) {
          return { rows: [...rcRows.values()] };
        }
        if (sqlText.includes('INSERT INTO reboot_checks')) {
          const id = rcSeq++;
          rcRows.set(id, {
            id,
            hosts_json: params[0],
            notes: params[1],
            status: 'once_kosuyor',
            created_by: params[2],
            created_at: new Date().toISOString(),
            once_job_id: params[3],
            once_server_id: params[4],
          });
          return { rows: [{ id }] };
        }
        if (sqlText.includes('UPDATE reboot_checks SET status = $1, once_json')) {
          const r = rcRows.get(Number(params[3]));
          if (r) {
            r.status = params[0];
            r.once_json = params[1];
            r.ozet_json = params[2];
            r.once_at = new Date().toISOString();
          }
          return { rows: [], rowCount: 1 };
        }
        if (sqlText.includes("UPDATE reboot_checks SET status = 'sonra_kosuyor'")) {
          const r = rcRows.get(Number(params[3]));
          if (r) {
            r.status = 'sonra_kosuyor';
            r.sonra_job_id = params[0];
            r.sonra_server_id = params[1];
            r.sonra_hedef_json = params[2];
          }
          return { rows: [], rowCount: 1 };
        }
        if (sqlText.includes('UPDATE reboot_checks SET status = $1, sonra_json')) {
          const r = rcRows.get(Number(params[3]));
          if (r) {
            r.status = params[0];
            r.sonra_json = params[1];
            r.ozet_json = params[2];
            r.sonra_at = new Date().toISOString();
          }
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
    },
    backups,
  );

  setMockModule(
    '../auth/index.cjs',
    {
      requireAuth: (req, _res, next) => {
        req.session = {
          user: {
            username: req.headers['x-user'] || 'alice',
            role: req.headers['x-role'] || 'Admin',
          },
        };
        next();
      },
    },
    backups,
  );
  setMockModule(
    '../auth/visibility.cjs',
    {
      requireVisiblePrefix: () => (_req, _res, next) => next(),
      canSee: () => true,
    },
    backups,
  );
  setMockModule(
    '../auth/ek-sayfa-kapisi.cjs',
    {
      ekSayfaKapisi: () => (_req, _res, next) => next(),
    },
    backups,
  );
  setMockModule('../audit/index.cjs', { auditPortal: () => {} }, backups);
  setMockModule(
    '../server-hub/ayarlar.cjs',
    {
      oku: async () => ({
        seviyeler: {},
        kokYoksay: [],
        limitler: { tara: 20, reboot: 20, hazirlik: 20 },
        okunamadi: false,
      }),
      limit: async () => 20,
      mount: () => {},
    },
    backups,
  );
  setMockModule(
    '../server-hub/ear-hub-verisi.cjs',
    {
      earSonDurum: async () => ({
        okunamadi: false,
        hostlar: [],
        hosts: new Map(),
        retireAdaylari: new Map(),
      }),
    },
    backups,
  );
  setMockModule(
    '../server-hub/capraz-veri.cjs',
    {
      caprazVeri: async () => ({
        okunamadi: false,
        ocpApps: new Set(),
        dtUsage: new Map(),
        retireMap: new Map(),
      }),
      caprazDurumu: () => ({ okunamadi: false, kaynaklar: {} }),
    },
    backups,
  );
  setMockModule(
    '../ansible/playbook-registry.cjs',
    {
      getByKey: async (k) => ({ key: k, enabled: true, awxServerId: 0 }),
      getEffectiveTemplateId: () => 401,
    },
    backups,
  );
  setMockModule(
    '../ansible/template-preflight.cjs',
    {
      assertRegistryPlaybook: async () => {},
      assertTemplateAcceptsExtraVars: async () => {},
      sablonOku: async (_sid, id) => ({
        id: id || 401,
        name: 'mock.yml',
        ask_variables_on_launch: true,
      }),
      sablonKontrol: () => {},
    },
    backups,
  );
  setMockModule(
    '../ansible/runner.cjs',
    {
      launchJobOnServer: async () => ({ jobId: 9901, status: 'pending' }),
      getJobStatusOnServer: async (_sid, jid) => ({
        status: 'successful',
        artifacts: {
          reboot_check_result: {
            sunucular: {
              APP01:
                Number(jid) === 9901
                  ? {
                      goruntu_ok: true,
                      goruntu: ['SURUM|1', 'BOOT|b1', 'URUN|JBOSS7', 'JVM|JBOSS7|orders-srv'],
                    }
                  : {
                      once_var: true,
                      son_olculdu: true,
                      goruntu: ['SURUM|1', 'BOOT|b2', 'URUN|JBOSS7', 'JVM|JBOSS7|orders-srv'],
                      son_goruntu: ['SURUM|1', 'BOOT|b2', 'URUN|JBOSS7', 'JVM|JBOSS7|orders-srv'],
                      islemler: [],
                      son_fark: [],
                    },
            },
          },
          server_hub_fix_result: { ok: true, changed: true },
        },
      }),
      getJobOutputOnServer: async () => ({ output: 'TASK [ok]' }),
    },
    backups,
  );

  delete require.cache[require.resolve('../server-hub/reboot-check.cjs')];
  delete require.cache[require.resolve('../server-hub/index.cjs')];
  const {
    initServerHub,
    rebootKontroluUcu,
    retirementAnalizi,
  } = require('../server-hub/index.cjs');

  const app = express();
  initServerHub(app);
  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    srv.closeAllConnections?.();
    srv.close();
    restoreModules(backups, ['../server-hub/index.cjs', '../server-hub/reboot-check.cjs']);
  });
  const base = `http://127.0.0.1:${srv.address().port}`;

  // Auth gate + exported helper
  assert.equal(
    (await fetch(`${base}/api/server-hub/overview`, { headers: { 'x-role': 'User' } })).status,
    403,
  );
  assert.equal(rebootKontroluUcu({ path: '/reboot-check/1', method: 'GET' }), true);
  assert.equal(rebootKontroluUcu({ path: '/fix', method: 'POST' }), false);

  // Overview, host-adlari, findings, host detail
  const ov = await (await fetch(`${base}/api/server-hub/overview?fresh=1`)).json();
  assert.equal(ov.ok, true, JSON.stringify(ov));
  assert.equal(ov.hosts.length, 1);
  assert.equal(
    (await (await fetch(`${base}/api/server-hub/host-adlari`)).json()).hosts[0],
    'APP01',
  );
  const fnd = await (await fetch(`${base}/api/server-hub/findings`)).json();
  assert.equal(fnd.ok, true);
  assert.equal((await fetch(`${base}/api/server-hub/host/APP01`)).status, 200);
  assert.equal((await fetch(`${base}/api/server-hub/host/bad host!`)).status, 400);

  // Scan + fix + autostart + karsilastirma + job-status
  assert.equal(
    (
      await fetch(`${base}/api/server-hub/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hosts: [] }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${base}/api/server-hub/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hosts: ['APP01'] }),
      })
    ).status,
    200,
  );
  const fixable = fnd.findings.find((f) => f.fix);
  if (fixable) {
    const fx = await fetch(`${base}/api/server-hub/fix`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        host: 'APP01',
        code: fixable.code,
        fixKey: JSON.stringify(fixable.fix),
        confirmed: false,
      }),
    });
    assert.equal(fx.status, 200);
  }
  assert.equal(
    (
      await fetch(`${base}/api/server-hub/jvm-autostart`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ host: 'APP01', gen: 8, jvm: 'billing-srv', enable: true }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${base}/api/server-hub/jvm-autostart`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          confirmed: true,
          host: 'APP01',
          gen: 8,
          jvm: 'billing-srv',
          enable: true,
        }),
      })
    ).status,
    400,
  );
  const asRes = await fetch(`${base}/api/server-hub/jvm-autostart`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      confirmed: true,
      host: 'APP01',
      gen: 7,
      jvm: 'orders-srv',
      enable: true,
    }),
  });
  assert.equal(asRes.status, 200, await asRes.text());
  assert.equal((await fetch(`${base}/api/server-hub/iliski/karsilastirma`)).status, 200);
  assert.equal(
    (await (await fetch(`${base}/api/server-hub/job-status/0/9901`)).json()).result.changed,
    true,
  );

  const anal = await retirementAnalizi([{ host: 'APP01', appName: 'orders-srv', gen: 7 }]);
  assert.equal(anal.hedefler.length, 1);

  // Reboot-check full lifecycle (list -> progress once -> trigger sonra -> progress sonra -> rapor HTML)
  assert.equal((await fetch(`${base}/api/server-hub/reboot-check`)).status, 200);
  assert.equal(
    (
      await fetch(`${base}/api/server-hub/reboot-check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hosts: ['APP01'], not: 'test' }),
      })
    ).status,
    200,
  );
  const onceProg = await (await fetch(`${base}/api/server-hub/reboot-check/1`)).json();
  assert.equal(onceProg.ok, true);
  assert.equal(
    (
      await fetch(`${base}/api/server-hub/reboot-check/1/sonra`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ onay: false }),
      })
    ).status,
    400,
  );
  // Note: launchJobOnServer returns jobId 9901 unless incremented; bump sonra_job_id so second poll hits the 'sonra' artifact branch
  const sonraPost = await fetch(`${base}/api/server-hub/reboot-check/1/sonra`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ onay: true }),
  });
  assert.equal(sonraPost.status, 200, await sonraPost.clone().text());
  rcRows.get(1).sonra_job_id = 9902;
  const sonraProg = await (await fetch(`${base}/api/server-hub/reboot-check/1`)).json();
  assert.equal(sonraProg.kayit.durum, 'tamam');
  const repRes = await fetch(`${base}/api/server-hub/reboot-check/1/rapor`);
  assert.equal(repRes.status, 200);
  assert.match(await repRes.text(), /APP01/);
});

test('server/retirement/index: config, create, discover, dns-ip, stop-toplu, delete-now, rollback, job-status, poller', async (t) => {
  const backups = new Map();
  let capturedPoller = null;
  let capturedChecker = null;
  let capturedWeb = null;

  const stopIzin = JSON.stringify({
    durum: 'ok',
    jobId: 7101,
    at: new Date().toISOString(),
    izinler: ['onay:orders-api|JBoss7|ctrl', 'stop:orders-api'],
  });
  const rollbackIzin = JSON.stringify({
    durum: 'ok',
    jobId: 7201,
    at: new Date().toISOString(),
    izinler: ['onay:geri-al:orders-api-t|JBoss8|ctrl', 'restore:orders-api-t'],
  });

  const recordRow = {
    id: 10,
    app: 'orders-api',
    smart_no: 'CHG100',
    oco_no: 'OCO100',
    owner_email: 'team@example.internal',
    requested_by: 'alice',
    delete_after_days: 45,
    planned_delete_at: '2026-12-30',
    dns_reuse: 0,
    lb_reuse: 0,
    dns_turleri_json: '{}',
    status: 'open',
    stop_at: null,
    scc_notified_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const targetsList = [
    {
      id: 101,
      record_id: 10,
      host: 'APP01',
      site: 'Pendik',
      env: 'PROD',
      app_name: 'orders-api',
      jboss_gen: 7,
      app_path: '/sw/jboss/orders-api',
      status: 'planned',
      last_job_id: 7101,
      delete_job_id: null,
      rollback_job_id: null,
      stopped_at: null,
      deleted_at: null,
      stop_izin_json: stopIzin,
      web_json: JSON.stringify([
        {
          host: 'WEB01',
          product: 'APACHE',
          serverName: 'orders.example.internal',
          confFile: '/etc/httpd/conf.d/orders.conf',
        },
      ]),
      web_result_json: JSON.stringify([
        {
          host: 'WEB01',
          product: 'APACHE',
          serverName: 'orders.example.internal',
          confFile: '/etc/httpd/conf.d/orders.conf',
          status: 'ok',
        },
      ]),
      rollback_onkontrol_json: rollbackIzin,
      delete_onkontrol_json: null,
      diger_surumler: null,
    },
    {
      id: 102,
      record_id: 10,
      host: 'APP02',
      site: 'Ankara',
      env: 'TEST',
      app_name: 'orders-api-t',
      jboss_gen: 8,
      app_path: '/sw/jboss/orders-api-t',
      status: 'stopped',
      last_job_id: 7102,
      delete_job_id: null,
      rollback_job_id: null,
      stopped_at: new Date().toISOString(),
      deleted_at: null,
      stop_izin_json: stopIzin,
      web_json: JSON.stringify([]),
      web_result_json: JSON.stringify([]),
      rollback_onkontrol_json: rollbackIzin,
      delete_onkontrol_json: null,
      diger_surumler: null,
    },
  ];

  setMockModule(
    '../db/index.cjs',
    {
      query: async (sqlText, params = []) => {
        if (sqlText.includes('FROM retirement_records ORDER BY'))
          return { rows: [{ ...recordRow, n_targets: 2, n_stopped: 1 }] };
        if (sqlText.includes('SELECT record_id, env, app_name')) return { rows: targetsList };
        if (sqlText.includes('FROM retirement_records WHERE id'))
          return { rows: Number(params[0]) === 10 ? [recordRow] : [] };
        if (sqlText.includes('FROM retirement_targets WHERE record_id'))
          return { rows: targetsList };
        if (sqlText.includes('SELECT dns_turleri_json FROM retirement_records'))
          return { rows: [{ dns_turleri_json: recordRow.dns_turleri_json }] };
        if (sqlText.includes('UPDATE retirement_records SET dns_turleri_json')) {
          recordRow.dns_turleri_json = params[0];
          return { rows: [], rowCount: 1 };
        }
        if (sqlText.includes('INSERT INTO retirement_records')) return { rows: [{ id: 10 }] };
        if (sqlText.includes('SELECT host, delete_onkontrol_json'))
          return {
            rows: [
              { host: 'APP01', delete_onkontrol_json: null, rollback_onkontrol_json: rollbackIzin },
            ],
          };
        if (sqlText.includes('SELECT rollback_onkontrol_json FROM retirement_targets'))
          return { rows: [{ rollback_onkontrol_json: rollbackIzin }] };
        if (sqlText.includes('SELECT status, last_job_id FROM retirement_targets'))
          return { rows: [{ status: 'planning', last_job_id: 7101 }] };
        if (sqlText.includes('SELECT COUNT(*) AS n FROM retirement_targets'))
          return { rows: [{ n: 1 }] };
        return { rows: [], rowCount: 1 };
      },
    },
    backups,
  );

  setMockModule(
    '../auth/index.cjs',
    {
      requireAuth: (req, _res, next) => {
        req.session = {
          user: {
            username: req.headers['x-user'] || 'alice',
            role: req.headers['x-role'] || 'Admin',
          },
        };
        next();
      },
    },
    backups,
  );
  setMockModule(
    '../auth/visibility.cjs',
    {
      requireVisiblePrefix: () => (_req, _res, next) => next(),
      canSee: () => true,
    },
    backups,
  );
  setMockModule(
    '../auth/ek-sayfa-kapisi.cjs',
    {
      ekSayfaKapisi: () => (_req, _res, next) => next(),
    },
    backups,
  );
  setMockModule('../audit/index.cjs', { auditPortal: () => {} }, backups);
  setMockModule(
    '../server-hub/index.cjs',
    {
      retirementAnalizi: async (t) => ({
        okunamadi: false,
        hedefler: (t || []).map((x) => ({ ...x, karar: 'SILINEBILIR', maddeler: [] })),
      }),
    },
    backups,
  );
  setMockModule(
    '../retirement/discover.cjs',
    {
      searchApps: async () => [{ app: 'orders-api', envCount: 2 }],
      discover: async () => ({
        targets: [
          {
            host: 'APP01',
            site: 'Pendik',
            env: 'PROD',
            appName: 'orders-api',
            gen: 7,
            appPath: '/sw/jboss/orders-api',
            inPlace: false,
            digerSurumler: [],
            web: [
              {
                host: 'WEB01',
                product: 'APACHE',
                serverName: 'orders.example.internal',
                confFile: '/etc/httpd/conf.d/orders.conf',
              },
            ],
          },
        ],
        summary: { bySite: { Pendik: 1, Ankara: 0 } },
      }),
    },
    backups,
  );
  setMockModule(
    '../retirement/ayar.cjs',
    {
      sccAyar: async () => ({
        to: 'scc@example.internal',
        cc: '',
        kaynak: 'db',
        guncelleyen: 'alice',
        guncellendi: null,
        dbHatasi: null,
      }),
      sccKaydet: async () => ({
        ok: true,
        ayar: {
          to: 'scc@example.internal',
          cc: '',
          kaynak: 'db',
          guncelleyen: 'alice',
          guncellendi: new Date().toISOString(),
        },
      }),
    },
    backups,
  );
  setMockModule(
    '../retirement/is-ciktisi.cjs',
    {
      mount: () => {},
      hedefIsleri: () => [],
      isGecmisiOku: async () => [],
      maskele: (x) => x,
      maskeleDerin: (x) => x,
    },
    backups,
  );
  setMockModule(
    '../retirement/dns-ip.cjs',
    {
      dnsIpHesapla: async () => ({
        ipIade: [],
        dnsSil: [{ ad: 'orders.example.internal', tur: 'intranet' }],
      }),
    },
    backups,
  );
  setMockModule(
    '../retirement/poller.cjs',
    {
      startPoller: (launcher, checker, webLauncher) => {
        capturedPoller = launcher;
        capturedChecker = checker;
        capturedWeb = webLauncher;
      },
      kayitCanli: async () => ({ kosan: 0 }),
      zamanlayici: () => ({ calisiyor: false }),
      awxDurumu: () => ({ status: 'running' }),
      webSimdi: async () => ({ kosan: 1, kilitli: false }),
    },
    backups,
  );
  setMockModule(
    '../oco/client.cjs',
    {
      getChangeOrder: async () => ({
        payload: {
          PlannedStartDate: '2099-01-01T22:00:00Z',
          PlannedEndDate: '2099-01-02T04:00:00Z',
        },
      }),
      httpStatus: () => 502,
    },
    backups,
  );
  setMockModule(
    '../oco/window.cjs',
    {
      extractPlannedInterruption: () => ({
        startDate: '2099-01-01T22:00:00Z',
        endDate: '2099-01-02T04:00:00Z',
      }),
      evaluateWindow: () => ({
        ok: true,
        windowStart: new Date('2099-01-01T22:00:00Z'),
        windowEnd: new Date('2099-01-02T04:00:00Z'),
        windowStartText: '22:00',
        windowEndText: '04:00',
      }),
      nextRunAt: () => ({
        mode: 'schedule',
        runAt: new Date('2099-01-01T22:00:00Z'),
        text: '2099-01-01 22:00',
        reason: 'OCO window future',
      }),
    },
    backups,
  );
  setMockModule(
    '../ansible/playbook-registry.cjs',
    {
      getByKey: async (k) => ({ key: k, enabled: true, awxServerId: 0 }),
      getEffectiveTemplateId: () => 701,
    },
    backups,
  );
  setMockModule(
    '../ansible/template-preflight.cjs',
    {
      assertRegistryPlaybook: async () => {},
      assertTemplateAcceptsExtraVars: async () => {},
      BEKLENEN_PLAYBOOK: {
        app_retirement_stop: 'app_retirement_stop.yml',
        app_retirement_delete: 'app_retirement_delete.yml',
      },
    },
    backups,
  );
  setMockModule(
    '../ansible/runner.cjs',
    {
      launchJobOnServer: async () => ({ jobId: 7301, status: 'pending' }),
      getJobStatusOnServer: async () => ({
        status: 'successful',
        artifacts: {
          app_retirement_stop_result: {
            line: 'APP01\torders-api\tPLAN\tready',
            plan_only: true,
            steps: [],
          },
          app_retirement_delete_result: { line: 'APP01\torders-api\tOK\tdeleted' },
          app_retirement_rollback_result: { line: 'APP01\torders-api\tOK\trestored' },
          server_hub_fix_result: { line: 'WEB01\thttpd\tOK\tretired' },
        },
      }),
      getJobOutputOnServer: async () => ({ output: 'OK' }),
    },
    backups,
  );
  setMockModule(
    '../opsx/index.cjs',
    {
      extractStatsKey: (art, key) => art?.[key] || null,
    },
    backups,
  );

  delete require.cache[require.resolve('../retirement/index.cjs')];
  const { initRetirement, _webGeriAl } = require('../retirement/index.cjs');

  const app = express();
  initRetirement(app);
  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    srv.closeAllConnections?.();
    srv.close();
    restoreModules(backups, ['../retirement/index.cjs']);
  });
  const base = `http://127.0.0.1:${srv.address().port}`;

  assert.equal(
    (await fetch(`${base}/api/retirement/config`, { headers: { 'x-role': 'User' } })).status,
    403,
  );
  assert.equal((await fetch(`${base}/api/retirement/config`)).status, 200);
  assert.equal(
    (
      await fetch(`${base}/api/retirement/config/scc`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: 'scc@example.internal' }),
      })
    ).status,
    200,
  );
  assert.equal((await fetch(`${base}/api/retirement/apps?q=orders`)).status, 200);
  assert.equal((await fetch(`${base}/api/retirement/discover?app=orders-api`)).status, 200);
  assert.equal(
    (
      await fetch(`${base}/api/retirement`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          app: 'orders-api',
          smartNo: 'CHG100',
          ocoNo: 'OCO100',
          targets: [{ host: 'APP01', appName: 'orders-api', gen: 7 }],
        }),
      })
    ).status,
    200,
  );
  assert.equal((await fetch(`${base}/api/retirement`)).status, 200);
  assert.equal((await fetch(`${base}/api/retirement/10`)).status, 200);
  assert.equal((await fetch(`${base}/api/retirement/10/canli`)).status, 200);
  assert.equal((await fetch(`${base}/api/retirement/10/dns-ip`)).status, 200);
  assert.equal(
    (
      await fetch(`${base}/api/retirement/10/dns-tur`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ad: 'orders.example.internal', tur: 'intranet' }),
      })
    ).status,
    200,
  );

  // Scheduled PROD stop + immediate test plan + cikar + delete-now
  const schedStop = await fetch(`${base}/api/retirement/10/stop-toplu`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tids: [101], confirmed: true }),
  });
  assert.equal(schedStop.status, 200);
  assert.equal((await schedStop.json()).scheduled, true);
  targetsList[0].status = 'pending';
  assert.equal(
    (
      await fetch(`${base}/api/retirement/10/stop-toplu`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tids: [101], confirmed: false }),
      })
    ).status,
    200,
  );
  targetsList[0].status = 'pending';
  assert.equal(
    (
      await fetch(`${base}/api/retirement/10/targets/101/cikar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ neden: 'kapsam disi' }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/retirement/10/delete-now`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmApp: 'orders-api' }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/retirement/10/targets/102/delete-now`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmApp: 'orders-api-t' }),
      })
    ).status,
    200,
  );

  // Rollback (both plan & confirmed) + job-status + cancel
  assert.equal(
    (
      await fetch(`${base}/api/retirement/10/targets/102/rollback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmed: false }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/retirement/10/targets/102/rollback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmed: true, onKontrolJobId: 7201 }),
      })
    ).status,
    200,
  );
  assert.equal(
    (await fetch(`${base}/api/retirement/10/targets/101/job-status/0/7101`)).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/retirement/10/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'test' }),
      })
    ).status,
    200,
  );

  // Invoke poller launcher, checker, webLauncher & _webGeriAl directly
  assert.ok(capturedPoller && capturedChecker && capturedWeb);
  await capturedPoller('stop', {
    recordId: 10,
    targetId: 101,
    host: 'APP01',
    application: 'orders-api',
    gen: 7,
    smartNo: 'CHG100',
    izinler: [],
  });
  await capturedPoller('delete', {
    recordId: 10,
    targetId: 102,
    host: 'APP02',
    application: 'orders-api-t',
    gen: 8,
    smartNo: 'CHG100',
    planOnly: false,
    izinler: [{ tip: 'rm' }],
  });
  const chk = await capturedChecker('delete', { host: 'APP01', job_id: 7101 });
  assert.equal(chk.terminal, true);
  assert.equal(chk.ok, true);
  await capturedWeb({
    webHost: 'WEB01',
    product: 'APACHE',
    confFile: '/etc/httpd/conf.d/orders.conf',
    serverName: 'orders.example.internal',
  });
  await _webGeriAl(10, 101, 'alice');
});
