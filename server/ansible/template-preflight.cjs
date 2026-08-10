// server/ansible/template-preflight.cjs — AWX job template'i launch'tan ONCE dogrular.
//
// NEDEN VAR (2026-08-09 uretim olayi): portal `logx_ocp_app_discovery` job'ini dolu
// extra_vars ile tetikledi, AWX job'i BASLATTI ama degiskenler govdeye HIC ulasmadi —
// job "En az bir bastion ... gerekli" assert'i ile dustu ve AWX arayuzunde degiskenler
// `{}` gorundu. Sebep AWX'in davranisidir: job template'inde
// "Prompt on launch" (`ask_variables_on_launch`) KAPALI ise launch cagrisiyla gonderilen
// extra_vars SESSIZCE YOK SAYILIR. Hata mesaji yok, HTTP 201 doner.
//
// Bu sessiz yutmayi teshis etmek pahaliydi (uc katman: portal → AWX → playbook). Artik
// portal launch'tan once bakar ve isi hic baslatmadan ne yapilmasi gerektigini soyler.
//
// FAIL-OPEN: template metadata'si okunamiyorsa (AWX erisilemez, yetki yok, liste bos)
// launch BLOKLANMAZ. Bu kontrol bir ek emniyettir; mesru bir isi metadata okunamadi diye
// durdurmak, cozdugu problemden buyuk bir problem olurdu.
'use strict';

// AWX'ten tek bir template'in metadata'sini alir. Bulunamazsa/hata olursa null.
// runner.listTemplatesForServer donusundeki `ask_variables` alani
// `ask_variables_on_launch` bayragindan gelir (bkz. runner.cjs).
async function findTemplate(serverId, templateId) {
  try {
    const runner = require('./runner.cjs');
    const target = Number(serverId);
    const server = (runner.getServers?.() || []).find((s) => Number(s.id) === target);
    if (!server) return null;
    const templates = await runner.listTemplatesForServer(server);
    return templates.find((t) => Number(t.id) === Number(templateId)) || null;
  } catch {
    return null;
  }
}

// Gonderilecek extra_vars VARSA ve template onlari kabul etmiyorsa `status: 409` tasiyan
// bir Error firlatir. Bos extra_vars'ta hicbir sey yapmaz (kontrol anlamsizdir).
//
// NEDEN 409, 503 DEGIL (2026-08-10): kurumsal ters-proxy 5xx govdelerini SPA index.html'i
// ile DEGISTIRIYOR. Kontrol 503 dondugunde kullanici bu net mesaj yerine "istek uygulamaya
// ulasamadi" gibi yaniltici bir uyari goruyordu (HAR: 503 + text/html 2185B). Ayni HAR'da
// 401 JSON'u sag salim geldigine gore 4xx yutulmuyor. Anlamca da 409 dogru: sunucu ayakta,
// hedef kaynagin (AWX template) durumu istegi kabul etmeye uygun degil.
//
// `label` yalnizca mesaja girer (ör. "logx_ocp_app_discovery") — admin hangi template'i
// duzeltecegini bilsin diye.
async function assertTemplateAcceptsExtraVars(serverId, templateId, extraVars, { label = '' } = {}) {
  if (!extraVars || typeof extraVars !== 'object' || Object.keys(extraVars).length === 0) return;

  const tpl = await findTemplate(serverId, templateId);
  if (!tpl) return;                          // metadata yok → fail-open
  if (tpl.ask_variables !== false) return;   // acik ya da bilinmiyor → sorun yok

  const who = label ? `"${label}" (template ${templateId})` : `template ${templateId}`;
  throw Object.assign(
    new Error(
      `AWX ${who} üzerinde "Prompt on launch" (Variables) kapalı. ` +
      `Bu durumda AWX, portalın gönderdiği ${Object.keys(extraVars).length} değişkeni ` +
      `sessizce yok sayar ve playbook boş girdiyle çalışıp hata verir. ` +
      `AWX > Job Templates > ${tpl.name || templateId} > Variables bölümündeki ` +
      `"Prompt on launch" kutusunu işaretleyip kaydedin.`
    ),
    { status: 409, code: 'awx_prompt_on_launch_disabled' }
  );
}

module.exports = { assertTemplateAcceptsExtraVars, findTemplate };
