// server/nginx-expose/index.cjs - "API'yi internete ac".
//
// TEST ortamindaki bir API tanimini, internete acik sunucuya (varsayilan GBNGXT07)
// kopyalayan AWX job'ini tetikler. Arkasindaki playbook:
//   gar_bmt_ansible_scripts/bmw_nginx/api_expose/api_expose.yml
//
// LISTE KAYNAGI: dbo.NginxRateLimitInventory. Bir satir = (host, config_file,
// api_location). Bir API = BIR DOSYA (<api>.conf); icindeki `location` bloklari o
// API'nin yollaridir - ekranda "dosya + icindeki API'ler" boyle gosterilir.
//
// CHANNEL BURADA BILINMEZ: envanter yalnizca `basename` sakliyor (bkz.
// ratelimit_loader.py), yani <channel>-<env>-apis dizin adi kayitli DEGIL. Bu yuzden
// channel extra_vars'a KONMAZ; playbook onu kaynak sunucuda arar ve birden fazla
// eslesme bulursa acik hata verir. Portal'in tahmin etmesi yanlis dosyayi tasirdi.
'use strict';

const express = require('express');

const CONFIG_NAME = 'nginx-expose';
const DEFAULT_TARGET = 'GBNGXT07';

/**
 * Envanter satirlarini "dosya + icindeki yollar" seklinde gruplar.
 *
 * YALNIZCA TEST: ortam sunucu adindan turer (envanterde ortam kolonu yok) ve playbook
 * da yalnizca env=test kabul eder. Ikisi ayrisirsa buton gorunur ama is REDDEDILIRDI -
 * kullanici acisindan sebepsiz bir hata olurdu.
 *
 * Bir API = BIR DOSYA; ayni dosya birden fazla sunucuda bulunabilir (mirror), o yuzden
 * hostlar toplanir ve yollar TEKILLESTIRILIR.
 */
function groupTestApis(recordset) {
  const { envOfHost } = require('../audit/nginx-hosts.cjs');
  const testRows = (recordset || []).filter((x) => envOfHost(x.host) === 'TEST');

  const byFile = new Map();
  for (const x of testRows) {
    const file = String(x.config_file || '').trim();
    if (!file) continue;
    if (!byFile.has(file)) {
      byFile.set(file, {
        configFile: file,
        api: file.replace(/\.conf$/i, ''),
        hosts: new Set(),
        locations: new Map(),
      });
    }
    const e = byFile.get(file);
    e.hosts.add(String(x.host || '').trim());
    const loc = String(x.api_location || '').trim();
    if (loc && !e.locations.has(loc)) {
      e.locations.set(loc, {
        path: loc,
        ipRateLimit: x.ip_rate_limit || null,
        serverRateLimit: x.server_rate_limit || null,
      });
    }
  }

  return {
    rows: [...byFile.values()]
      .map((e) => ({
        configFile: e.configFile,
        api: e.api,
        hosts: [...e.hosts].sort(),
        locations: [...e.locations.values()].sort((a, b) => a.path.localeCompare(b.path)),
      }))
      .sort((a, b) => a.configFile.localeCompare(b.configFile)),
    hosts: [...new Set(testRows.map((x) => String(x.host || '').trim()))].sort(),
  };
}

function initNginxExpose(app) {
  const db = require('../db/index.cjs');
  const { requireAuth, requireAdmin, getRequestUser } = require('../auth/index.cjs');
  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));
  router.use(requireAuth);

  async function readConfig() {
    try {
      const { rows } = await db.query(
        `SELECT data FROM portal_config_blobs WHERE name = $1`,
        [CONFIG_NAME],
      );
      const raw = rows?.[0]?.data;
      const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw || {};
      return {
        awxServerId: Number(cfg.awxServerId) || 0,
        templateId: Number(cfg.templateId) || 0,
        targetHost: String(cfg.targetHost || DEFAULT_TARGET).trim() || DEFAULT_TARGET,
      };
    } catch {
      return { awxServerId: 0, templateId: 0, targetHost: DEFAULT_TARGET };
    }
  }

  // -- Liste: TEST ortamindaki API dosyalari + icindeki yollar ----------------
  router.get('/apis', async (req, res) => {
    try {
      const { query, sql } = require('../inventory/mssql.cjs');

      const dateRes = await query(
        `SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d FROM dbo.NginxRateLimitInventory`,
      );
      const scanDate = dateRes.recordset?.[0]?.d || null;
      if (!scanDate) {
        return res.json({ ok: true, scanDate: null, hosts: [], rows: [], config: await readConfig() });
      }

      const r = await query(
        `SELECT host, config_file, api_location, ip_rate_limit, server_rate_limit
           FROM dbo.NginxRateLimitInventory
          WHERE scan_date = @d
          ORDER BY config_file, api_location, host`,
        [{ name: 'd', type: sql.NVarChar(10), value: scanDate }],
      );

      const { rows, hosts } = groupTestApis(r.recordset || []);
      res.json({ ok: true, scanDate, hosts, rows, config: await readConfig() });
    } catch (err) {
      res.status(503).json({ ok: false, message: err.message });
    }
  });

  // -- Yapilandirma (hangi AWX sunucusu / job template) -----------------------
  router.put('/config', requireAdmin, async (req, res) => {
    const awxServerId = Number(req.body?.awxServerId) || 0;
    const templateId = Number(req.body?.templateId) || 0;
    const targetHost = String(req.body?.targetHost || DEFAULT_TARGET).trim() || DEFAULT_TARGET;
    if (awxServerId <= 0 || templateId <= 0) {
      return res.status(400).json({ ok: false, message: 'AWX sunucusu ve template ID zorunlu.' });
    }
    const data = JSON.stringify({ awxServerId, templateId, targetHost });
    try {
      const ex = await db.query(`SELECT 1 FROM portal_config_blobs WHERE name = $1`, [CONFIG_NAME]);
      if (ex.rows.length) {
        await db.query(`UPDATE portal_config_blobs SET data = $2 WHERE name = $1`, [CONFIG_NAME, data]);
      } else {
        await db.query(`INSERT INTO portal_config_blobs (name, data) VALUES ($1, $2)`, [CONFIG_NAME, data]);
      }
      res.json({ ok: true, config: { awxServerId, templateId, targetHost } });
    } catch (err) {
      res.status(503).json({ ok: false, message: err.message });
    }
  });

  // -- Eylem: API'yi internete ac --------------------------------------------
  router.post('/open', async (req, res) => {
    const api = String(req.body?.api || '').trim();
    const sourceHost = String(req.body?.sourceHost || '').trim();
    if (!api || !sourceHost) {
      return res.status(400).json({ ok: false, message: 'api ve sourceHost zorunlu.' });
    }

    const cfg = await readConfig();
    if (!cfg.awxServerId || !cfg.templateId) {
      // Yapilandirilmamis: sessizce basarisiz olmak yerine NE yapilmasi gerektigi soylenir.
      return res.status(409).json({
        ok: false,
        message:
          'İnternete açma job\'ı henüz yapılandırılmamış. AWX sunucusu ve job template ' +
          'seçildikten sonra buton çalışır (api_expose.yml için açılan template).',
      });
    }

    // ANTI-TAMPER: istemcinin gonderdigi sunucu, envanterde GERCEKTEN o API'yi barindiran
    // ve TEST ortaminda olan bir host mu? Aksi halde istemci istedigi hostu yazip
    // baska bir ortamdan kopyalatabilirdi.
    try {
      const { query, sql } = require('../inventory/mssql.cjs');
      const { envOfHost } = require('../audit/nginx-hosts.cjs');
      const chk = await query(
        `SELECT TOP (1) 1 AS ok
           FROM dbo.NginxRateLimitInventory
          WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.NginxRateLimitInventory)
            AND host = @h AND config_file = @f`,
        [
          { name: 'h', type: sql.NVarChar(64), value: sourceHost },
          { name: 'f', type: sql.NVarChar(255), value: api + '.conf' },
        ],
      );
      if (!chk.recordset?.length || envOfHost(sourceHost) !== 'TEST') {
        return res.status(400).json({
          ok: false,
          message: `${api} envanterde ${sourceHost} (TEST) üzerinde bulunamadı.`,
        });
      }
    } catch (err) {
      return res.status(503).json({ ok: false, message: err.message });
    }

    try {
      const { launchJobOnServer } = require('../ansible/runner.cjs');
      const user = getRequestUser(req) || {};
      const job = await launchJobOnServer(
        cfg.awxServerId,
        cfg.templateId,
        {
          api,
          env: 'test',
          source_host: sourceHost,
          target_host: cfg.targetHost,
          requester_name: user.displayName || user.username || '',
          requester_email: user.email || '',
        },
        '',
        user.username || null,
      );
      res.json({ ok: true, job, targetHost: cfg.targetHost });
    } catch (err) {
      res.status(err.status || 503).json({ ok: false, message: err.message });
    }
  });

  app.use('/api/nginx-expose', router);
}

module.exports = {
  initNginxExpose,
  _groupTestApis: groupTestApis,
  _CONFIG_NAME: CONFIG_NAME,
  _DEFAULT_TARGET: DEFAULT_TARGET,
};
