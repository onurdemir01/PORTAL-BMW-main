// server/ansible/change-gates.cjs — DEGISIKLIK KAPILARI (OCO penceresi + Smart onayi).
//
// NEDEN AYRI BIR MODUL: bu mantik `runner.cjs` icinde `launch-ss` handler'inin GOVDESINE
// gomuluydu. Sonucu: Self Service disindaki hicbir akista kapi YOKTU — OpsX, LogX ve
// Telnet dogrudan `runner.launchJobOnServer()` cagiriyor. ScaleX (OCP replica
// durdurma) ayni kapilardan gecmek zorunda ve mantigi ikinci kez yazmak, biri duzelince
// digerinin sessizce eski kalmasi demekti.
//
// Ayrica Smart bileti acma blogu `runner.cjs` icinde UC KEZ kopyalanmisti (launch-ss,
// ss/test/run, launchOrRequestApproval) ve uc kopya birbirinden INCE farklarla ayriliyordu.
// Burada tek govde var; farklar acik parametreye donusturuldu (bkz. openSmartTicket).
//
// ── DAVRANIS SOZLESMESI ─────────────────────────────────────────────────────────
// Bu cikarma bir DAVRANIS DEGISIKLIGI DEGILDIR. Kod satir satir tasindi; tek fark
// `res.status().json()` cagrilarinin yerine KARAR NESNESI donulmesi (modul Express'e
// bagli kalmasin, ScaleX de ayni kapiyi kullanabilsin diye).
//
// Karar nesnesi UC bicimde doner ve BASKASI OLAMAZ:
//   { outcome: 'proceed' }                      → cagiran akisa devam eder
//   { outcome: 'error',   status, body }        → cagiran `res.status(status).json(body)`
//   { outcome: 'respond', body }                → cagiran `res.json(body)`  (HTTP 200)
//
// SET KAPALI OLMAK ZORUNDA. Kapinin karari artik modul sinirini bir STRING olarak
// geciyor; cagiran tarafta `proceed` disinda ele alinmayan her deger sessizce ISI
// CALISTIRIR. Kapi satir-iciyken bu sinif mumkun degildi (`return res...` ya vardi ya
// yoktu). Bu yuzden hem burada hem cagiranda beyaz liste var: `OUTCOMES` disinda bir
// deger uretilirse ya da cagirana ulasirsa FAIL-CLOSED davranilir.
//
// `change-gates-parity.test.cjs` bu sozlesmenin eski davranisla birebir ayni oldugunu
// kilitler. Degistirmeden once o testi oku.
'use strict';

// Kapinin uretebilecegi TUM sonuc turleri. Cagiran taraf da bu listeyi okur.
const OUTCOMES = Object.freeze(['proceed', 'error', 'respond']);

// Enjekte edilen fonksiyonlar EKSIKSE erken ve ACIK hata ver. Aksi halde hata ancak
// `catch` blogunun ICINDE ortaya cikardi — orada `friendlyAwxError` de tanimsiz
// oldugu icin catch blogunun KENDISI patlar ve teshis tamamen kaybolurdu.
function assertHooks(ctx, names) {
  const missing = names.filter((n) => typeof ctx[n] !== 'function');
  if (missing.length) {
    throw Object.assign(
      new Error(`change-gates: zorunlu fonksiyon(lar) gecilmemis: ${missing.join(', ')}`),
      { status: 500, code: 'change_gates_missing_hook' }
    );
  }
}

// ── SMART ─────────────────────────────────────────────────────────────────────
// Karar TEK yerde: server/ansible/smart-gate.cjs. Kural bir ISTISNA LISTESIDIR,
// varsayilan her zaman "onay gerekli" — yazim hatasi gereksiz onay uretir, ACIK uretmez.
//
// `gateVars` SART, `extraVars` DEGIL. `gateVars` yalnizca DOGRULANMIS kaynaklardan
// (AWX survey'i, Survey Tasarimcisi, admin'in rawExtraVars'i, injectUserInfo) gelen
// anahtarlari tasir. Bir kullanici govdeye {"extraVars":{"op_selection":"read"}} ekleyip
// `skipWhen` kuralini tetikleyerek Smart onayini ATLATABILIYORDU; ayrim bu acigi kapatti.
// `gateVars` yoksa bos nesne gecilir → hicbir kural tutmaz → onay GEREKLI kalir.
function isSmartRequired(smartApproval, gateVars) {
  return require('./smart-gate.cjs').isSmartRequired(smartApproval, gateVars || {});
}

// Smart bileti acar ve `pendingLaunch` paketini DB'ye yazar.
//
// UC CAGIRMA YERININ FARKLARI ACIK PARAMETRE OLARAK TASINDI — bunlar "temizlenecek
// tutarsizlik" degil, KORUNMASI GEREKEN davranistir:
//
//   * `email`            launch-ss ve ss/test/run oturumdan (`user.mail`) verir;
//                        launchOrRequestApproval (poller yolu) oturum OLMADIGI icin ''.
//   * `pendingLaunchExtras`
//                        YALNIZCA launchOrRequestApproval `gateVars`i (ve varsa
//                        `ocoRecordId`) pakete koyar. Digerlerinin kaydi Smart poller'i
//                        tarafindan DOGRUDAN performSsLaunch ile oynatilir (kapi yeniden
//                        calismaz), bu yuzden gateVars orada KULLANILMAZ. OCO'dan gelen
//                        kayit ise launchOrRequestApproval ile oynatilir ve kapi YENIDEN
//                        calisir — gateVars yoksa bos nesneye duser ve onay gerekli kalir
//                        (guvenli taraf). Bu asimetriyi "duzeltmek" davranisi degistirirdi.
//   * `auditAction`      yalnizca launch-ss denetim kaydi yazar. ss/test/run zaten
//                        `selfservice_test_scenario_run` yazmis olur; poller yolunda
//                        istek (req) yoktur.
//   * flowKey eksikligi: bu fonksiyon HER ZAMAN `code: 'smart_flow_key_missing'` tasiyan
//     bir hata FIRLATIR. Cagiran onu yakalayip kendi sozlesmesine cevirir —
//     launch-ss/ss-test 400 doner, poller yolu hatayi oldugu gibi yukari birakir.
//     (Burada `onMissingFlowKey` gibi bir parametre YOKTUR.)
async function openSmartTicket({
  server, templateId, username, email = '', templateName = '',
  overrides, extraVars, detail, resolvedLaunchOptions, specFields,
  pendingLaunchExtras = {},
  buildSmartMetadata,
  auditAction = null,
  req = null,
}) {
  const smartClient = require('../smart/client.cjs');
  const smartStore = require('../smart/store.cjs');

  const flowKey = String(overrides.smartApproval.flowKey || '').trim();
  if (!flowKey) {
    const err = new Error('Bu servis için Smart Flow Key tanımlanmamış.');
    err.code = 'smart_flow_key_missing';
    throw err;
  }

  // Smart'in metadataData.metadatas[].key alani, GetMetaDataOperationalRequestByFlowName'in
  // dondurdugu `ElementName` degeriyle BIREBIR eslesmeli. Sabit {application, requestedBy}
  // hicbir gercek flow'un ElementName'iyle eslesmedigi icin Smart bunu "400 Invalid Request"
  // ile reddediyordu; admin artik "Alanlari Getir" ile gercek adlari gorup esleyebiliyor.
  const metadataFieldsRaw = String(overrides.smartApproval.metadataFields || '').trim();
  const metadata = buildSmartMetadata(metadataFieldsRaw, {
    username, email, templateName, templateId, extraVars,
  });
  // Servis bazinda RFF token override'i; bos ise createTicket() global SMART_RFF_TOKEN'a duser.
  const integrationKey = String(overrides.smartApproval.integrationKey || '').trim();

  const created = await smartClient.createTicket({
    flowKey, username, metadata, integrationKey: integrationKey || undefined,
  });

  // BURADAN SONRASI KRITIK: Smart bileti DIS SISTEMDE ARTIK ACILDI. Yerel kayit
  // duserse kullaniciya "Smart talebi acilamadi" demek YANLIS olur — bilet ortada
  // duruyor ve numarasi kaybolursa yetim kalir. Hatayi ayirip bilet numarasini
  // mesaja koyuyoruz.
  let ticket;
  try {
    ticket = await smartStore.createTicket({
      externalTicketId: created.ticketId,
      username,
      awxServerId: server.id,
      awxTemplateId: templateId,
      flowKey,
      pendingLaunch: {
        detail, extraVars, resolvedLaunchOptions, specFields, overrides, username, templateName,
        ...pendingLaunchExtras,
      },
    });
  } catch (storeErr) {
    throw Object.assign(
      new Error(`Smart talebi AÇILDI (kayıt no: ${created.ticketId}) ancak portal kaydı yazılamadı: ${storeErr.message}`),
      { status: 500, code: 'smart_ticket_store_failed', externalTicketId: created.ticketId }
    );
  }

  if (auditAction) {
    require('../audit/index.cjs').auditPortal(req, auditAction, {
      detail: JSON.stringify({ awxServerId: server.id, templateId, flowKey, ticketId: created.ticketId }),
    });
  }

  return { ticketId: ticket.id, externalTicketId: created.ticketId, flowKey };
}

// ── OCO ───────────────────────────────────────────────────────────────────────
// Admin bu servis icin "OCO Kontrolu"nu actiysa VE talep PRODUCTION ise
// (env|ortam = prod|production — bkz. server/oco/prod-detect.cjs; kural BILINCLI olarak
// yapilandirilamaz, DB'de kalmis bayat bir ayar prod tespitini sessizce kapatabilirdi),
// is once OCO kaydinin planlanan kesinti penceresine karsi dogrulanir.
//
// Smart onayindan ONCE calisir: penceresi gecmis bir OCO icin Smart'ta bosuna talep
// acmak, hem gurultu hem de kullaniciyi bekletip sonra reddetmek olurdu.
//
// ISTEMCI ILE EL SIKISMA (3 adim, hepsi ayni endpoint):
//   1) ocoNumber yoksa       → 400 { ocoRequired: true }
//   2) pencere HENUZ baslamadiysa ve ocoAction yoksa
//                            → 400 { ocoDecisionRequired: true, oco: {...} }
//   3) ocoAction 'schedule'  → kayit olusturulur, kesinti saatinde tetiklenir
//      ocoAction 'later'     → hicbir sey yapilmaz, kullanici o saatte geri gelir
//   Pencere ACIKSA hicbir soru sorulmaz, akis normal devam eder.
// PROD TESPITI IKI KAYNAKTAN da okunur — `extraVars` VE `gateVars`.
//
// NEDEN: `isProductionRequest` yalnizca `env` / `ortam` anahtarlarina bakar. Self
// Service'te bu dogru calisir, cunku orada `gateVars` `extraVars`in SUZULMUS ALT
// KUMESIDIR (runner.cjs: guvenilmez anahtarlar atilir) — yani `env` her iki yerde de
// ayni degerle bulunur. Ama ScaleX ortami playbook sozlesmesi geregi
// `target_environment` adiyla gonderiyor; `env`/`ortam` YALNIZCA `gateVars`ta var.
// Sonuc: `extraVars`e tek basina bakildiginda `env=prod` bir ScaleX stop islemi
// PRODUCTION SAYILMIYOR ve OCO kapisi hic ateslenmiyordu — kesinti penceresi
// dogrulanmadan prod'da replica 0'a inilebiliyordu.
//
// BIRLESIM (VEYA), kesisim degil: kapinin yalnizca ACILMASI yonunde etki eder,
// hicbir yerde KAPANMASINI saglamaz. `gateVars`e gecmek (extraVars yerine) yanlis
// olurdu — Self Service'te guvenilmez kaynaktan gelen `env: prod` `gateVars`ten
// atiliyor ama `extraVars`te kaliyor; bugun OCO onun icin de calisiyor ve bu
// davranisin ZAYIFLAMAMASI gerekiyor.
function isOcoGateApplicable(overrides, extraVars, gateVars) {
  if (!overrides.ocoCheck?.enabled) return false;
  const { isProductionRequest } = require('../oco/prod-detect.cjs');
  return isProductionRequest(extraVars) || isProductionRequest(gateVars);
}

async function evaluateOcoGate({
  server, templateId, username, req,
  overrides, extraVars, gateVars, detail, resolvedLaunchOptions, specFields, templateName,
  ocoNumber: rawOcoNumber, ocoAction: rawOcoAction,
  createOcoAwxSchedule, friendlyAwxError,
}) {
  assertHooks({ createOcoAwxSchedule, friendlyAwxError }, ['createOcoAwxSchedule', 'friendlyAwxError']);
  const ocoClient = require('../oco/client.cjs');
  const ocoWindow = require('../oco/window.cjs');
  const ocoStore = require('../oco/store.cjs');
  const audit = require('../audit/index.cjs');

  const ocoNumber = String(rawOcoNumber || '').trim();
  if (!ocoNumber) {
    return { outcome: 'error', status: 400, body: { ok: false, ocoRequired: true, message: 'Bu PRODUCTION talebi için OCO numarası gerekli.' } };
  }

  let order;
  try {
    order = await ocoClient.getChangeOrder(ocoNumber);
  } catch (ocoErr) {
    return { outcome: 'error', status: ocoErr.status || 502, body: { ok: false, ocoRequired: true, message: ocoErr.message } };
  }

  const pi = ocoWindow.extractPlannedInterruption(order.payload);
  if (!pi || !pi.startDate) {
    return { outcome: 'error', status: 400, body: { ok: false, message: `OCO ${ocoNumber} kaydında planlanan kesinti (PlannedInterruption) bilgisi yok — işlem yapılmadı.` } };
  }
  const w = ocoWindow.evaluateWindow({ startDate: pi.startDate, endDate: pi.endDate });
  if (!w.ok) return { outcome: 'error', status: 400, body: { ok: false, message: w.message } };

  const ocoInfo = {
    ocoNumber,
    subject: order.result?.OcoWfIdSubject || order.result?.Subject || '',
    startText: w.startText, endText: w.endText,
    windowStartText: w.windowStartText, windowEndText: w.windowEndText,
    equal: w.equal, phase: w.phase,
  };

  if (w.phase === 'expired') {
    audit.auditPortal(req, 'selfservice_oco_expired', {
      detail: JSON.stringify({ templateId, ocoNumber, windowEnd: w.windowEndText }),
    });
    return { outcome: 'error', status: 400, body: { ok: false, ocoExpired: true, oco: ocoInfo, message: w.message } };
  }

  if (w.phase === 'before') {
    const ocoAction = String(rawOcoAction || '').trim();
    if (ocoAction !== 'schedule' && ocoAction !== 'later') {
      return { outcome: 'error', status: 400, body: { ok: false, ocoDecisionRequired: true, oco: ocoInfo, message: w.message } };
    }
    if (ocoAction === 'later') {
      return { outcome: 'respond', body: { ok: true, ocoDeferred: true, oco: ocoInfo } };
    }
    const pendingLaunch = { detail, extraVars, resolvedLaunchOptions, specFields, overrides, username, templateName };

    // ZAMANLAMA NEREDE TUTULUR?
    //   * Varsayilan: AWX'te NATIVE bir schedule. Is kesinti saatinde AWX tarafindan
    //     tetiklenir; Portal'in o anda ayakta olmasi GEREKMEZ ve zamanlama AWX
    //     arayuzunde de gorunur.
    //   * ISTISNA: bu servis icin Smart onayi da gerekiyorsa AWX'e devretmek ONAY
    //     KAPISINI TAMAMEN ATLARDI — AWX schedule'i hicbir onaya bakmadan job'i
    //     baslatir. O durumda Portal'in kendi zamanlamasi kullanilir; poller kesinti
    //     saatinde launchOrRequestApproval'i cagirir ve Smart bileti ORADA acilir.
    //     Iki mekanizma da ayni tabloda, status ile ayrilir.
    const smartAlsoRequired = isSmartRequired(overrides.smartApproval, gateVars);
    if (!smartAlsoRequired) {
      const schedName = `PORTAL_OCO_${ocoNumber}_${templateId}_${Date.now()}`;
      let sched;
      try {
        sched = await createOcoAwxSchedule(server, templateId, detail, {
          name: schedName, runAt: w.windowStart, extraVars, resolvedLaunchOptions,
          requester: req?.session?.user,
        });
      } catch (schedErr) {
        const { status, message } = schedErr.status ? schedErr : friendlyAwxError(schedErr);
        return { outcome: 'error', status: status || 502, body: { ok: false, message: `AWX zamanlaması oluşturulamadı: ${message || schedErr.message}` } };
      }
      const rec = await ocoStore.createAwxScheduled({
        username, awxServerId: server.id, awxTemplateId: templateId,
        ocoNumber, ocoSubject: ocoInfo.subject,
        runAt: w.windowStart, windowEnd: w.windowEnd,
        awxScheduleId: sched.scheduleId, pendingLaunch,
      });
      audit.auditPortal(req, 'selfservice_oco_awx_scheduled', {
        detail: JSON.stringify({ templateId, ocoNumber, runAt: w.windowStartText, scheduleId: rec.id, awxScheduleId: sched.scheduleId, rrule: sched.rrule }),
      });
      return {
        outcome: 'respond',
        body: {
          ok: true, ocoScheduled: true, scheduleId: rec.id,
          awxScheduleId: sched.scheduleId, awxScheduleName: sched.scheduleName,
          oco: ocoInfo,
        },
      };
    }

    const rec = await ocoStore.create({
      username, awxServerId: server.id, awxTemplateId: templateId,
      ocoNumber, ocoSubject: ocoInfo.subject,
      runAt: w.windowStart, windowEnd: w.windowEnd,
      pendingLaunch,
    });
    audit.auditPortal(req, 'selfservice_oco_scheduled', {
      detail: JSON.stringify({ templateId, ocoNumber, runAt: w.windowStartText, scheduleId: rec.id, viaPortalPoller: true }),
    });
    return { outcome: 'respond', body: { ok: true, ocoScheduled: true, scheduleId: rec.id, viaSmart: true, oco: ocoInfo } };
  }

  // phase === 'inside': pencere acik, akis normal devam eder (Smart onayi varsa o devreye girer).
  audit.auditPortal(req, 'selfservice_oco_ok', {
    detail: JSON.stringify({ templateId, ocoNumber, window: `${w.windowStartText} - ${w.windowEndText}` }),
  });
  return { outcome: 'proceed' };
}

// ── BIRLESIK KAPI ─────────────────────────────────────────────────────────────
// `launch-ss`'in kapi bolumunun tamami. Sira DEGISTIRILEMEZ: once OCO, sonra Smart.
async function runChangeGates(ctx) {
  assertHooks(ctx, ['createOcoAwxSchedule', 'friendlyAwxError', 'buildSmartMetadata']);
  const {
    server, templateId, username, req,
    overrides, extraVars, gateVars, detail, resolvedLaunchOptions, specFields, templateName,
    ocoNumber, ocoAction,
    createOcoAwxSchedule, friendlyAwxError, buildSmartMetadata,
    smartAuditAction = 'selfservice_smart_ticket_open',
  } = ctx;

  if (isOcoGateApplicable(overrides, extraVars, gateVars)) {
    const ocoDecision = await evaluateOcoGate({
      server, templateId, username, req,
      overrides, extraVars, gateVars, detail, resolvedLaunchOptions, specFields, templateName,
      ocoNumber, ocoAction, createOcoAwxSchedule, friendlyAwxError,
    });
    if (ocoDecision.outcome !== 'proceed') return ocoDecision;
  }

  if (!isSmartRequired(overrides.smartApproval, gateVars)) return { outcome: 'proceed' };

  let opened;
  try {
    opened = await openSmartTicket({
      server, templateId, username,
      email: req?.session?.user?.mail || '',
      templateName, overrides, extraVars, detail, resolvedLaunchOptions, specFields,
      buildSmartMetadata, auditAction: smartAuditAction, req,
    });
  } catch (smartErr) {
    if (smartErr.code === 'smart_flow_key_missing') {
      return { outcome: 'error', status: 400, body: { ok: false, message: 'Bu servis için Smart Flow Key tanımlanmamış — yöneticiye başvurun.' } };
    }
    if (smartErr.code === 'smart_ticket_store_failed') {
      return { outcome: 'error', status: smartErr.status || 500, body: { ok: false, message: smartErr.message, externalTicketId: smartErr.externalTicketId } };
    }
    return { outcome: 'error', status: smartErr.status || 502, body: { ok: false, message: `Smart talebi açılamadı: ${smartErr.message}` } };
  }
  return {
    outcome: 'respond',
    body: { ok: true, pendingApproval: true, ticketId: opened.ticketId, externalTicketId: opened.externalTicketId },
  };
}

module.exports = {
  OUTCOMES,
  isSmartRequired,
  isOcoGateApplicable,
  evaluateOcoGate,
  openSmartTicket,
  runChangeGates,
};
