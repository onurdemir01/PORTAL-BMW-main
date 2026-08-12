// server/logx/v2/playbook-readiness.cjs — LogX'in kullandigi AWX job template'lerinin
// launch'a HAZIR olup olmadigi.
//
// NEDEN VAR (2026-08-10, uretim): "Bu namespace'i tara" 503 donuyordu ve sebep hicbir
// ekranda gorunmuyordu. Gercek sebep AWX'teydi: `BMW Portal - LogX_OCP_App_Discovery`
// (template 2193) uzerinde Variables > "Prompt on launch" KAPALI. O kutu kapaliyken AWX
// launch cagrisiyla gelen extra_vars'i SESSIZCE yok sayar; portal isi baslatsa bile
// playbook bos girdiyle calisip duser.
//
// Iki tuketici var ve GORDUKLERI FARKLI:
//   - Admin (`/admin/playbook-readiness`): template adi/ID, AWX sunucu no, bulundu-mu —
//     duzeltmeyi yapacak kisinin ihtiyaci olan her sey.
//   - Sihirbaz (`/playbook-readiness`): yalnizca `{ keyName, ready, reason }`. Sihirbaz
//     doomed bir job'i HIC baslatmasin diye vardir; altyapi ayrintisi sizdirmaz.
'use strict';

// LogX'in bagli oldugu bes playbook kaydi.
const LOGX_KEYS = [
  'logx_legacy_discovery', 'logx_legacy_transfer',
  'logx_ocp_namespace_discovery', 'logx_ocp_app_discovery', 'logx_ocp_discover_fetch',
];

// Ayrintili satirlar (admin gorunumu). AWX okunamazsa alanlar `null` kalir —
// "bilinmiyor" ile "kapali" AYRI gosterilir, fail-open kurali burada da gecerlidir.
async function getRows(keys = LOGX_KEYS) {
  const playbookRegistry = require('../../ansible/playbook-registry.cjs');
  const preflight = require('../../ansible/template-preflight.cjs');
  const rows = [];
  for (const keyName of keys) {
    const row = await playbookRegistry.getByKey(keyName).catch(() => null);
    const templateId = row ? playbookRegistry.getEffectiveTemplateId(row) : null;
    const serverId = row?.awxServerId || Number(process.env.AWX_LOGX_SERVER_ID) || 1;
    const tpl = templateId ? await preflight.findTemplate(serverId, templateId) : null;
    rows.push({
      keyName,
      displayName: row?.displayName || keyName,
      enabled: row ? row.enabled !== false : false,
      templateId: templateId || null,
      awxServerId: serverId,
      foundOnAwx: templateId ? Boolean(tpl) : null,
      templateName: tpl?.name || null,
      promptOnLaunch: tpl ? tpl.ask_variables !== false : null,
      // Limit icin "Prompt on launch". BUGUN HICBIR AKIS limit gondermiyor (bkz.
      // server/opsx/index.cjs'teki not) — bu alan yalnizca BILGI: kutu acilirsa cluster
      // alt kumesi ozelligi geri getirilebilir. `ready` hesabina KATILMAZ.
      limitPrompt: tpl ? tpl.ask_limit !== false : null,
    });
  }
  return rows;
}

// Sihirbazin gordugu sadelestirilmis bicim. `ready === false` YALNIZCA kesin bir engel
// varsa doner; "bilinmiyor" (AWX okunamadi) HAZIR sayilir — mesru bir isi metadata
// eksikligi yuzunden durdurmak, cozdugu problemden buyuk olurdu (fail-open).
function toPublic(rows) {
  return rows.map((r) => {
    if (r.enabled === false) {
      return { keyName: r.keyName, ready: false, reason: 'disabled' };
    }
    if (!r.templateId) {
      return { keyName: r.keyName, ready: false, reason: 'template_missing' };
    }
    if (r.promptOnLaunch === false) {
      return { keyName: r.keyName, ready: false, reason: 'prompt_on_launch_disabled' };
    }
    return { keyName: r.keyName, ready: true, reason: null };
  });
}

module.exports = { LOGX_KEYS, getRows, toPublic };
