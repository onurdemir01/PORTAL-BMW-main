// server/ansible/__tests__/choice-sources.test.cjs — VERITABANINDAN BESLENEN SECENEKLER.
//
// Kullanici bildirimi (2026-09-15): rate_limit_change'de `chosen_api` serbest metindi;
// "/x/y/v0/" yazildi, zone "/x/y/v0" idi, is durdu. Cozum: alan bir secenek kaynagina
// baglanir, kullanici listeden secer, sunucu launch'ta degeri kaynaga karsi YENIDEN
// dogrular. Bu bekci: (1) saf yardimcilar, (2) fail-closed dogrulama, (3) runner'da
// her iki cozumleyici yolundan sonra dogrulamanin cagrildigi, (4) mapSurveySpec'in
// kaynaga bagli alani secim kutusu olarak sundugu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cs = require('../choice-sources.cjs');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const codeOnly = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

test('CS1 kaynak parametreleri form degerlerinden kurulur; ortam adi normalize', () => {
  const p = cs.paramsFromValues({ source: 'x', params: { env: 'ortam' } }, { ortam: 'test', a: 1 });
  assert.deepEqual(p, { env: 'test' });
  assert.equal(cs.normEnv('prod'), 'PROD');
  assert.equal(cs.normEnv('Production'), 'PROD');
  assert.equal(cs.normEnv(''), '');
});

test('CS2 kayit dogrulamasi: bilinmeyen kaynak, bagli olmayan zorunlu parametre, tanimsiz alan', () => {
  assert.match(cs.validateChoicesSource({ source: 'yok' }, ['env']) || '', /Bilinmeyen/);
  assert.match(
    cs.validateChoicesSource({ source: 'nginx-api-locations', params: {} }, ['env']) || '',
    /form alanı seçilmemiş/,
  );
  assert.match(
    cs.validateChoicesSource({ source: 'nginx-api-locations', params: { env: 'ortam' } }, ['env']) || '',
    /tanımsız bir alana/,
  );
  assert.equal(
    cs.validateChoicesSource({ source: 'nginx-api-locations', params: { env: 'env' } }, ['env']),
    null,
  );
});

test('CS3 launch dogrulamasi: listede yoksa 400, kaynak patlarsa 503 (fail-closed), varsa gecer', async () => {
  // Sahte kaynak: gercek SQL'e dokunmadan davranisi kilitle.
  cs.SOURCES['__test'] = {
    label: 't',
    params: [{ name: 'env', required: true }],
    async load({ env }) {
      if (env === 'BOOM') throw new Error('db yok');
      return [{ value: '/a/v0', label: '/a/v0' }];
    },
  };
  try {
    const src = { source: '__test', params: { env: 'env' } };
    await cs.assertValueInSource(src, '/a/v0', { env: 'test' }, 'API');
    await assert.rejects(
      () => cs.assertValueInSource(src, '/a/v0/', { env: 'test' }, 'API'),
      (e) => e.status === 400 && /envanter listesinde yok/.test(e.message),
    );
    await assert.rejects(
      () => cs.assertValueInSource(src, '/a/v0', { env: 'BOOM' }, 'API'),
      (e) => e.status === 503 && /İş başlatılmadı/.test(e.message),
    );
    // Bilinmeyen kaynak = yapilandirma hatasi -> 500, kullaniciya "tekrar dene" DEGIL.
    await assert.rejects(
      () => cs.assertValueInSource({ source: 'yok' }, 'x', {}, 'API'),
      (e) => e.status === 500,
    );
  } finally {
    delete cs.SOURCES['__test'];
    cs.clearCache();
  }
});

test('CS4 runner: her iki cozumleyici yolundan sonra assertChoiceSources cagrilir', () => {
  const src = codeOnly(read('runner.cjs'));
  assert.match(src, /async function assertChoiceSources\(/, 'dogrulama adimi yok');
  const custom = /resolveCustomSurveyExtraVars\(overrides\.customSurveyFields, submittedExtraVars\);\s*await assertChoiceSources\(overrides\.customSurveyFields, extraVars\)/;
  assert.match(src, custom, 'Survey Tasarimcisi yolunda kaynak dogrulamasi yok');
  const native = /resolveLaunchExtraVars\(specFields, overrides, submittedExtraVars\);\s*await assertChoiceSources\(/;
  assert.match(src, native, 'AWX survey yolunda kaynak dogrulamasi yok');
});

test('CS5 mapSurveySpec: kaynaga bagli alan secim kutusu olarak sunulur, choicesSource tasir', () => {
  const src = codeOnly(read('runner.cjs'));
  const i = src.indexOf('function mapSurveySpec(');
  const body = src.slice(i, i + 1800);
  assert.match(body, /ov\.choicesSource/, 'override choicesSource okunmuyor');
  assert.match(body, /type: choicesSource \? 'multiplechoice' : field\.type/, 'tip secim kutusuna cevrilmiyor');
  assert.match(body, /\.\.\.\(choicesSource \? \{ choicesSource \} : \{\}\)/, 'choicesSource istemciye gitmiyor');
});

test('CS6 istemci: kaynaga bagli alan DynamicChoiceSelect ile cizilir, statik whitelist atlanir', () => {
  const page = codeOnly(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'SelfServicePage.tsx'), 'utf8'));
  assert.match(page, /f\.choicesSource \? \(\s*<DynamicChoiceSelect/, 'kaynakli alan icin ozel secim kutusu yok');
  assert.match(page, /!f\.choicesSource &&\s*Array\.isArray\(f\.choices\)/, 'statik whitelist kaynakli alanda da calisir - liste bos, her deger hatali olur');
  const sel = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'self_service', 'DynamicChoiceSelect.tsx'), 'utf8');
  assert.match(sel, /ansibleApi\s*\.choices\(/, 'secenekler sunucudan cekilmiyor');
  assert.doesNotMatch(sel, /<datalist/, 'datalist serbest metne izin verir; select olmali');
});

// nginx_ops (Nginx - RVP Operations) icin kaynaklar (kullanici istegi, 2026-09-15):
// namespace envanterden, ardindan o namespace'in YALNIZCA SPA uygulamalari; servis ve
// mevcut location'lar Nginx SPA denetiminden. Serbest metin yalnizca create'teki input_path.
test('CS7 nginx_ops kaynaklari kayitli ve zincir parametreleri dogru', () => {
  const names = cs.listSources().map((s) => s.name);
  for (const n of ['ocp-namespaces', 'ocp-spa-applications', 'nginx-services', 'nginx-locations']) {
    assert.ok(names.includes(n), `${n} kaynagi yok`);
  }
  const apps = cs.getSource('ocp-spa-applications');
  assert.deepEqual(apps.params.map((p) => p.name), ['env', 'namespace'], 'uygulama listesi namespace secimine bagli olmali');
  const locs = cs.getSource('nginx-locations');
  assert.deepEqual(locs.params.filter((p) => p.required).map((p) => p.name), ['env', 'service']);
  assert.ok(locs.params.some((p) => p.name === 'namespace' && !p.required), 'namespace daraltmasi opsiyonel olmali');
  // SPA kurali Denetim ile AYNI (nginx-migration.cjs)
  assert.equal(String(cs.SPA_RE), String(require('../../audit/nginx-migration.cjs').SPA_RE));
});

test('CS8 istemci opsiyonel parametreyi "eksik" saymaz (liste yine cekilir)', () => {
  const sel = codeOnly(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'self_service', 'DynamicChoiceSelect.tsx'), 'utf8'));
  assert.match(sel, /source\.optional/, 'optional listesi okunmuyor');
  assert.match(sel, /!v && !optional\.has\(k\)/, 'eksik parametre hesabi opsiyonelleri disarida birakmiyor');
});

// RVP tanimlari YALNIZCA ARK cluster'i icin (kullanici, 2026-09-15): namespace listesi
// ortamin ARK cluster'larindan gelmeli (test secilirse ARK test). tenant sabit secenek.
test('CS9 tenant filtresi: yalniz o tenant cluster\'lari; sabit secenek parametreye eklenir', async () => {
  const adminPath = require.resolve('../../logx/v2/admin.cjs');
  const saved = require.cache[adminPath];
  require.cache[adminPath] = {
    id: adminPath, filename: adminPath, loaded: true,
    exports: { getClusterTree: async () => ({ test: { ark: ['ark-test-1', 'ark-test-2'], gls: ['gls-test'] }, prod: { ark: ['ark-prod'] } }) },
  };
  try {
    assert.deepEqual(await cs.clustersForEnv('test', 'ark'), ['ark-test-1', 'ark-test-2']);
    assert.deepEqual(await cs.clustersForEnv('TEST', 'ARK'), ['ark-test-1', 'ark-test-2'], 'buyuk/kucuk harf');
    assert.deepEqual(await cs.clustersForEnv('test'), ['ark-test-1', 'ark-test-2', 'gls-test'], 'tenant yoksa ortamin tumu');
    assert.deepEqual(await cs.clustersForEnv('qa', 'ark'), [], 'katalogda olmayan ortam bos');
  } finally {
    if (saved) require.cache[adminPath] = saved; else delete require.cache[adminPath];
  }
  const p = cs.paramsFromValues({ source: 'ocp-namespaces', params: { env: 'env' }, options: { tenant: 'ark' } }, { env: 'test' });
  assert.deepEqual(p, { env: 'test', tenant: 'ark' });
  const info = cs.listSources().find((s) => s.name === 'ocp-namespaces');
  assert.ok(info.options.some((o) => o.name === 'tenant' && o.default === 'ark'), 'ocp-namespaces tenant sabiti (varsayilan ark) yok');
  const apps = cs.listSources().find((s) => s.name === 'ocp-spa-applications');
  assert.ok(apps.options.some((o) => o.name === 'tenant'), 'ocp-spa-applications tenant sabiti yok');
});

test('CS10 admin ekrani: kaynak editoru METIN alanlarinda cikar (Survey Tasarimcisi + AWX)', () => {
  const modal = codeOnly(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'self_service', 'FieldOverridesModal.tsx'), 'utf8'));
  assert.match(modal, /SOURCE_BINDABLE_AWX = new Set\(\['text', 'textarea'\]\)/);
  assert.match(modal, /SOURCE_BINDABLE_CUSTOM = new Set\(\['text', 'textarea', 'multiplechoice', 'multiselect'\]\)/);
  assert.match(modal, /SOURCE_BINDABLE_CUSTOM\.has\(f\.type\) && choiceSources\.length > 0 && \(\s*<ChoicesSourceEditor/, 'ozel alanda editor tip kumesine bagli degil');
  assert.doesNotMatch(modal, /isChoiceType && choiceSources\.length > 0 && \(\s*<ChoicesSourceEditor/, 'editor hala yalnizca secim tiplerinde (Metin alanlarda cikmaz)');
});
