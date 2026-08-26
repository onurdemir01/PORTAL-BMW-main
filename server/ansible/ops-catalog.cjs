// server/ansible/ops-catalog.cjs — "Operasyon Katalogu": hangi is, hangi ortamda,
// hangi onaylardan gecer?
//
// TASARIM KARARI (kullanici, 2026-08-26): rapor ELLE TUTULAN bir Excel DEGIL, CANLI
// yapilandirmadan uretilir; disari aktarim ayri bir uctan verilir. Gerekce: bir admin
// Smart/OCO anahtarini cevirdigi anda elle tutulan tablo YANLIS olur - ve bu tabloda
// yanlis olmamasi gereken tam da o bilgidir.
//
// VERI IKI KAYNAKTAN GELIR:
//   1) OTOMATIK — Self Service servis yapilandirmasi (ansible_ss_items +
//      ansible_ss_customizations): Smart gerekli mi, hangi flowKey, OCO gerekli mi.
//   2) ELLE — onay MERCII (kim onaylayacak). Bu bilgi Portal'da YOKTUR: Smart'ta
//      flow tanuminin icindedir ve elimizdeki iki Smart ucu (metadata alanlari,
//      talep durumu) onaylayan kisi/grup DONDURMEZ. Bu yuzden (flowKey, ortam) ->
//      onay mercii eslemesi approval_approvers tablosunda ELLE tutulur.
//
// DURUSTLUK NOTU: LogX / OpsX / FileX / Telnet akislarinda BUGUN hicbir onay kapisi
// YOKTUR - Smart ve OCO kontrolleri yalnizca Self Service (Otomasyon) launch yolunda
// (server/ansible/runner.cjs) uygulanir. Katalog bunu "kapi yok" olarak ACIKCA yazar;
// bos birakmak ya da "yok sayilir" demek raporu yaniltici kilardi.
'use strict';

const db = require('../db/index.cjs');
const { ALL_ENVS } = require('./request-env.cjs');
const { isSmartRequired, resolveFlowKey } = require('./smart-gate.cjs');

const ENV_LABELS = { dev: 'DEV', test: 'TEST', qa: 'QA', prod: 'PROD' };

// Onay kapisi OLMAYAN moduller. Katalogda gorunurler ki "unutulmus" degil, "bilerek
// kapisiz" olduklari anlasilsin.
const UNGATED_MODULES = [
  { module: 'LogX', note: 'Log indirme akisi — AWX dogrudan tetiklenir, onay kapisi tanimli degil.' },
  { module: 'OpsX', note: 'Uygulama operasyonlari — AWX dogrudan tetiklenir, onay kapisi tanimli degil.' },
  { module: 'FileX', note: 'Dosya aktarimi — AWX dogrudan tetiklenir, onay kapisi tanimli degil.' },
  { module: 'Telnet', note: 'Baglanti testi — AWX dogrudan tetiklenir, onay kapisi tanimli degil.' },
];

async function listApprovers() {
  try {
    const { rows } = await db.query(
      `SELECT flow_key, env, approver, note FROM approval_approvers`
    );
    const map = new Map();
    for (const r of rows) map.set(`${r.flow_key}|${r.env}`, { approver: r.approver, note: r.note });
    return map;
  } catch {
    // Tablo henuz yoksa katalog YINE de uretilir; onay mercii kolonu bos kalir.
    return new Map();
  }
}

async function upsertApprover({ flowKey, env, approver, note }) {
  const fk = String(flowKey || '').trim();
  const ev = String(env || '').trim().toLowerCase();
  if (!fk) throw Object.assign(new Error('flowKey gerekli.'), { status: 400 });
  if (!ALL_ENVS.includes(ev)) throw Object.assign(new Error(`Gecersiz ortam: ${env}`), { status: 400 });
  await db.query(
    `MERGE approval_approvers AS t
       USING (SELECT $1 AS flow_key, $2 AS env) AS s
          ON t.flow_key = s.flow_key AND t.env = s.env
     WHEN MATCHED THEN UPDATE SET approver = $3, note = $4, updated_at = GETUTCDATE()
     WHEN NOT MATCHED THEN INSERT (flow_key, env, approver, note) VALUES ($1, $2, $3, $4);`,
    [fk, ev, String(approver || '').trim() || null, String(note || '').trim() || null]
  );
}

// readSsItems / readCustom runner.cjs'in kapali kapsaminda oldugu icin disaridan
// ENJEKTE edilir - bu modul DB'ye kendi basina baglanir ama SS katalogunu okumanin
// tek dogru yolu runner'in kendi okuyucularidir (goc/fallback mantigi orada).
async function buildCatalog({ readSsItems, readCustom, getServerById }) {
  const approvers = await listApprovers();
  const rows = [];

  for (const item of readSsItems()) {
    const custom = readCustom(item.awxServerId, item.awxTemplateId) || {};
    const sa = custom.smartApproval;
    const ocoOn = !!custom.ocoCheck?.enabled;
    const server = getServerById ? getServerById(item.awxServerId) : null;

    for (const env of ALL_ENVS) {
      // Kapi kararlari CALISMA ZAMANINDAKI ILE AYNI fonksiyonlardan gelir - rapor ile
      // gercek davranisin ayrisma ihtimali boylece ortadan kalkar.
      const smartOn = isSmartRequired(sa, { env }, env);
      const flowKey = smartOn ? resolveFlowKey(sa, { env }, env) : '';
      const appr = flowKey ? approvers.get(`${flowKey}|${env}`) : null;

      rows.push({
        module: 'Otomasyon',
        serviceId: item.id,
        service: item.title,
        awxServerId: item.awxServerId,
        awxServerName: server?.name || '',
        awxTemplateId: item.awxTemplateId,
        enabled: !!item.enabled,
        env,
        envLabel: ENV_LABELS[env],
        smartRequired: smartOn,
        flowKey,
        ocoRequired: ocoOn && env === 'prod',
        // OCO acik ama ortam prod degilse bunu ayrica belirtmek gerekiyor: "hayir"
        // gorup "bu serviste OCO yok" diye okunmasin.
        ocoConfigured: ocoOn,
        approver: appr?.approver || '',
        approverNote: appr?.note || '',
        note: '',
      });
    }
  }

  for (const m of UNGATED_MODULES) {
    for (const env of ALL_ENVS) {
      rows.push({
        module: m.module, serviceId: '', service: '(tum akislar)',
        awxServerId: null, awxServerName: '', awxTemplateId: null, enabled: true,
        env, envLabel: ENV_LABELS[env],
        smartRequired: false, flowKey: '',
        ocoRequired: false, ocoConfigured: false,
        approver: '', approverNote: '', note: m.note,
      });
    }
  }

  return rows;
}

const CSV_COLUMNS = [
  ['module', 'Modül'],
  ['service', 'Servis'],
  ['envLabel', 'Ortam'],
  ['smartRequired', 'Smart onayı'],
  ['flowKey', 'Smart Flow Key'],
  ['approver', 'Onay mercii'],
  ['ocoRequired', 'OCO kontrolü'],
  ['awxServerName', 'AWX sunucusu'],
  ['awxTemplateId', 'Template ID'],
  ['enabled', 'Servis etkin'],
  ['note', 'Not'],
];

function csvCell(v) {
  // Boolean'lar da TIRNAKLANIR: erken donup tirnaksiz birakmak, ayni sutunda bazi
  // hucreleri tirnakli bazilarini tirnaksiz yapiyordu. Bicimin tutarli olmasi
  // ayristirmayi da okumayi da kolaylastirir.
  const s = v === true ? 'Evet' : v === false ? 'Hayır' : (v == null ? '' : String(v));
  // Excel'de formul enjeksiyonu: "=", "+", "-", "@" ile baslayan hucreler formul olarak
  // yorumlanir. Bu tablo servis ADLARI iceriyor ve adlar kullanici girdisi - bastaki
  // isareti notrlemek SART.
  const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
  return '"' + safe.replace(/"/g, '""') + '"';
}

// TR yerelli Excel noktali virgulle ayrilmis CSV bekler; BOM olmadan da Turkce
// karakterler bozulur. Ikisi de bilerek ekleniyor.
function toCsv(rows) {
  const head = CSV_COLUMNS.map(([, label]) => csvCell(label)).join(';');
  const body = rows.map((r) => CSV_COLUMNS.map(([key]) => csvCell(r[key])).join(';'));
  return '﻿' + [head, ...body].join('\r\n') + '\r\n';
}

module.exports = { buildCatalog, listApprovers, upsertApprover, toCsv, UNGATED_MODULES, CSV_COLUMNS };
