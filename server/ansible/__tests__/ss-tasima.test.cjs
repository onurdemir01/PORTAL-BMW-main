// server/ansible/__tests__/ss-tasima.test.cjs - Self Servis Tasima saf cekirdegi (2026-11-10).
//
// Kullanici: "maestro2 emekli oluyor ... self servis otomasyonundaki sayfalarin gecisini
// kolaylastir." Bu dosya DB / AWX gerektirmeyen kurallari bekler:
//   ST1  eslestir: tam ad (trim, harf duyarli), 0 / 2+ aday, elle secim, ayni hedefe iki kart
//   ST2  surveyNormalize / surveyFarki: secenek bicimi, kritik / bilgi, parola varsayilani
//   ST3  surveyModu + surveyKarari: undefined OLCULEMEDI'dir ("kapali" degil)
//   ST4  surveyYaz: POST spec -> PATCH -> GET detay -> GET spec; geri okuma farki ok:false;
//        $encrypted$ hedefe gitmez
//   ST5  ortak dogrulayici: /ss/custom'un eski mesajlariyla birebir; ozellestirmeUyumu bulgulari
//   ST6  engel sorgulari template kapsamli + parametreli; okunamayan = engel
//   ST11 gomulu kimlik taramasi
//   ST12 oncekiBaglariEkle
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const T = require('../ss-tasima.cjs');
const { dogrula } = require('../ss-ozellestirme-dogrulama.cjs');

test('ST1 eslestir: tam ad, trim, harf duyarli; 0/2+ aday; elle secim; cakisma', () => {
  const hedef = [
    { id: 10, name: 'Nginx - RVP Operations' },
    { id: 11, name: 'jboss restart' },
    { id: 12, name: 'Ikiz' },
    { id: 13, name: 'Ikiz' },
    { id: 14, name: 'Ortak' },
  ];
  const m = T.eslestir(
    [
      { id: 'a', kaynakAd: '  Nginx - RVP Operations ' },
      { id: 'b', kaynakAd: 'JBoss Restart' },
      { id: 'c', kaynakAd: 'Ikiz' },
      { id: 'd', kaynakAd: 'Yok' },
      { id: 'e', kaynakAd: 'Bambaska' },
      { id: 'f', kaynakAd: 'Ortak' },
      { id: 'g', kaynakAd: 'x' },
    ],
    hedef,
    { e: 11, g: 14 },
  );
  assert.equal(m.get('a').toT, 10);
  assert.equal(m.get('a').eslesme, 'ad');
  assert.equal(m.get('b').toT, null, 'harf farki eslesmemeli (kullanici: ayni ad)');
  assert.equal(m.get('b').neden, 'ad_yok');
  assert.equal(m.get('c').neden, 'birden_fazla_aday');
  assert.deepEqual(m.get('c').adaylar.map((x) => x.id), [12, 13]);
  assert.equal(m.get('d').neden, 'ad_yok');
  assert.equal(m.get('e').toT, 11);
  assert.equal(m.get('e').eslesme, 'elle');
  // f (adla) ve g (elle) ayni hedefe -> ikisi de cakisma
  assert.equal(m.get('f').cakisma, true);
  assert.equal(m.get('g').cakisma, true);
  assert.equal(m.get('a').cakisma, false);
  const yok = T.eslestir([{ id: 'z', kaynakAd: 'A' }], hedef, { z: 999 });
  assert.equal(yok.get('z').neden, 'elle_secim_yok');
});

test('ST2 surveyFarki: secenek bicimi esit, kritik/bilgi ayrimi, parola varsayilani karsilastirilmaz', () => {
  const k = [
    { variable: 'env', type: 'multiplechoice', choices: ['dev', 'prod'], required: true, default: 'dev', question_name: 'Ortam' },
    { variable: 'pwd', type: 'password', required: true, default: '$encrypted$', question_name: 'Parola' },
    { variable: 'app', type: 'text', required: false, default: '', question_name: 'Uygulama' },
  ];
  const h = [
    { variable: 'env', type: 'multiplechoice', choices: 'dev\nprod\ntest', required: true, default: 'dev', question_name: 'Ortam secimi' },
    { variable: 'pwd', type: 'password', required: true, default: '', question_name: 'Parola' },
    { variable: 'app', type: 'text', required: false, default: '', question_name: 'Uygulama' },
  ];
  const f = T.surveyFarki(k, h);
  assert.equal(f.kritikVar, false, JSON.stringify(f.satirlar.filter((s) => s.kritik)));
  const env = f.satirlar.find((s) => s.variable === 'env');
  assert.equal(env.etiket, 'farkli');
  assert.deepEqual(env.farklar.sort(), ['choices', 'question_name']);
  assert.equal(f.satirlar.find((s) => s.variable === 'pwd').etiket, 'ayni', 'parola varsayilani karsilastirmaya girdi');
  assert.equal(f.parolaSoru, 1);

  const h2 = [
    { variable: 'env', type: 'multiplechoice', choices: ['prod'], required: true, default: 'prod' },
    { variable: 'yeni', type: 'text' },
  ];
  const f2 = T.surveyFarki(k, h2);
  assert.equal(f2.kritikVar, true);
  const e2 = f2.satirlar.find((s) => s.variable === 'env');
  assert.ok(e2.farklar.includes('choices') && e2.farklar.includes('default'));
  assert.equal(f2.satirlar.find((s) => s.variable === 'app').etiket, 'yalniz_kaynakta');
  assert.equal(f2.satirlar.find((s) => s.variable === 'yeni').etiket, 'yalniz_hedefte');
  // required false -> true ve varsayilan yok: kritik
  const f3 = T.surveyFarki([{ variable: 'x', type: 'text', required: false }], [{ variable: 'x', type: 'text', required: true }]);
  assert.equal(f3.kritikVar, true);
  // hash parola varsayilanindan bagimsiz
  assert.equal(T.surveyHash(true, k), T.surveyHash(true, k.map((x) => (x.type === 'password' ? { ...x, default: '' } : x))));
  assert.notEqual(T.surveyHash(true, k), T.surveyHash(false, k));
});

test('ST3 surveyModu ve karar tablosu; undefined = OLCULEMEDI', () => {
  assert.equal(T.surveyModu({ survey_enabled: true }, [{ variable: 'a' }]), 'AWX');
  assert.equal(T.surveyModu({ survey_enabled: false }, null), 'TASARIMCI');
  assert.equal(T.surveyModu({ survey_enabled: true }, []), 'EXTRA_VARS');
  assert.equal(T.surveyModu({}, []), 'OLCULEMEDI', 'alan yoksa kapali sayildi');
  assert.equal(T.surveyModu({ survey_enabled: true }, null), 'OLCULEMEDI');
  assert.equal(T.surveyModu(null, []), 'OLCULEMEDI');
  const bos = T.surveyKarari('AWX', 'EXTRA_VARS', { survey_enabled: true }, [], null);
  assert.deepEqual([bos.cip, bos.eylem], ['SURVEY_BOS', 'yaz']);
  const kapat = T.surveyKarari('TASARIMCI', 'AWX', { survey_enabled: true }, [{ variable: 'a' }], null);
  assert.deepEqual([kapat.cip, kapat.eylem], ['SURVEY_FARKLI', 'kapat']);
  const kapali = T.surveyKarari('AWX', 'TASARIMCI', { survey_enabled: false }, [{ variable: 'a' }], { kritikVar: false });
  assert.deepEqual([kapali.cip, kapali.eylem], ['SURVEY_FARKLI', 'yaz'], 'hedefte survey kapaliysa yaz/ac');
  const temiz = T.surveyKarari('AWX', 'AWX', { survey_enabled: true }, [{ variable: 'a' }], { kritikVar: false });
  assert.equal(temiz.cip, null);
  assert.equal(T.surveyKarari('OLCULEMEDI', 'AWX', {}, [], null).olculemedi, true);
  // Oncelik
  assert.deepEqual(T.durumBelirle({ eslesmeYok: true, engelVar: true }).cipler, ['ESLESME_YOK', 'ENGEL']);
  assert.equal(T.durumBelirle({ surveyCip: 'SURVEY_BOS', uyumsuz: true }).durum, 'SURVEY_BOS');
  assert.equal(T.durumBelirle({}).durum, 'HAZIR');
});

function sahteAwx(geriOkuma) {
  const cagrilar = [];
  const istek = async (method, p, body) => {
    cagrilar.push({ method, p, body });
    if (method === 'GET' && /survey_spec/.test(p)) return { spec: geriOkuma.spec };
    if (method === 'GET') return { id: 5, survey_enabled: geriOkuma.enabled };
    return null;
  };
  return { istek, cagrilar };
}

test('ST4 surveyYaz: sira, geri okuma, parola temizligi', async () => {
  const spec = [
    { variable: 'env', type: 'text', default: 'dev', required: true, question_name: 'E' },
    { variable: 'pwd', type: 'password', default: '$encrypted$', required: true, question_name: 'P' },
  ];
  const temiz = T.parolaTemizle(spec);
  const a = sahteAwx({ spec: temiz, enabled: true });
  const r = await T.surveyYaz(a.istek, 5, spec, { enable: true, name: 'X' });
  assert.deepEqual(
    a.cagrilar.map((c) => `${c.method} ${c.p}`),
    [
      'GET /api/v2/job_templates/5/survey_spec/',
      'POST /api/v2/job_templates/5/survey_spec/',
      'PATCH /api/v2/job_templates/5/',
      'GET /api/v2/job_templates/5/',
      'GET /api/v2/job_templates/5/survey_spec/',
    ],
    'sira: hedefi oku (parola korumasi), once spec, sonra ac, sonra geri oku',
  );
  assert.equal(r.ok, true);
  // Hedefte parola varsayilani yok (geri okuma temiz spec'i dondurur) -> '' gider.
  assert.ok(!JSON.stringify(a.cagrilar[1].body).includes('$encrypted$'), '$encrypted$ hedefe yazildi');
  assert.equal(a.cagrilar[2].body.survey_enabled, true);
  // Geri okunan farkli -> ok:false
  const b = sahteAwx({ spec: [temiz[0]], enabled: true });
  const r2 = await T.surveyYaz(b.istek, 5, spec, { enable: true });
  assert.equal(r2.ok, false);
  assert.ok(r2.fark.some((x) => x.variable === 'pwd'));
  // survey acilmadiysa ok:false (bos survey tuzagi)
  const c = sahteAwx({ spec: temiz, enabled: false });
  assert.equal((await T.surveyYaz(c.istek, 5, spec, { enable: true })).ok, false);
  // Kapat: yalniz PATCH + GET
  const d = sahteAwx({ spec: [], enabled: false });
  const r4 = await T.surveyKapat(d.istek, 5);
  assert.equal(r4.ok, true);
  assert.deepEqual(d.cagrilar.filter((x) => x.method !== 'GET').map((x) => x.method), ['PATCH']);
});

test('ST4b runner yazicisi yalniz verilen sunucuya, ss-tasima.surveyYaz uzerinden yazar', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'runner.cjs'), 'utf8');
  const i = src.indexOf('async function writeSurveySpecOnServer(');
  assert.ok(i > 0, 'yazici yok');
  const govde = src.slice(i, i + 700);
  assert.match(govde, /const server = getServerById\(serverId\);/);
  assert.match(govde, /require\('\.\/ss-tasima\.cjs'\)\.surveyYaz\(istek, templateId, spec, opts\)/);
  // Tasima modulu awxRequestToServer'a dogrudan erismez.
  const rot = fs.readFileSync(path.join(__dirname, '..', 'ss-tasima-rotalari.cjs'), 'utf8');
  assert.doesNotMatch(rot, /awxRequestToServer/);
});

// Eski satir-ici dogrulamanin (main e7d19856, runner.cjs POST /ss/custom) mesajlari BIREBIR.
test('ST5 ortak dogrulayici eski /ss/custom mesajlarini aynen verir', () => {
  const spec = [
    { variable: 'env', type: 'multiplechoice', question_name: 'Ortam', choices: ['a'] },
    { variable: 'host', type: 'text', question_name: 'Host', default: '' },
  ];
  const ilk = (data) => dogrula(spec, data)[0];
  assert.equal(
    ilk({ fieldOverrides: [{ fieldName: 'env', choicesSource: { source: 'nginx-hosts' } }] }),
    '"Ortam" metin/çoklu seçim alanı değil (multiplechoice); seçenek kaynağı yalnızca bunlara bağlanabilir.',
  );
  assert.equal(
    ilk({ fieldOverrides: [{ fieldName: 'host', hidden: true }] }),
    '"Host" alanının varsayılan değeri yok — gizlemeden önce bir varsayılan değer belirleyin.',
  );
  assert.equal(
    ilk({ launchOptionOverrides: { limit: { hidden: true, default: ' ' } } }),
    '"Limit" gizli ama varsayılan değeri yok — gizlemeden önce bir varsayılan değer belirleyin.',
  );
  assert.equal(
    ilk({ outputFilter: { enabled: true, contains: '' } }),
    'Çıktı filtresi etkin ama aranacak metin boş — bir metin girin veya filtreyi kapatın.',
  );
  assert.equal(ilk({ customSurveyFields: [{ name: '' }] }), 'Her özel alanın bir değişken adı olmalı.');
  assert.equal(
    ilk({ customSurveyFields: [{ name: '1a', label: 'x' }] }),
    'Geçersiz değişken adı: "1a" — yalnızca harf, rakam, alt çizgi içerebilir ve rakamla başlayamaz.',
  );
  assert.equal(
    ilk({ customSurveyFields: [{ name: 'a', label: 'A' }, { name: 'a', label: 'B' }] }),
    'Değişken adı tekrar ediyor: "a"',
  );
  assert.equal(ilk({ customSurveyFields: [{ name: 'a', label: ' ' }] }), '"a" alanının bir görünen adı (label) olmalı.');
  assert.equal(
    ilk({ customSurveyFields: [{ name: 'a', label: 'A', type: 'multiplechoice', choices: [] }] }),
    '"A" bir seçim alanı ama hiç seçeneği yok.',
  );
  assert.equal(
    ilk({ customSurveyFields: [{ name: 'a', label: 'A', dependsOn: { conditions: [{ field: 'yok', equals: 'x' }] } }] }),
    '"A" tanımsız bir alana bağlı: "yok"',
  );
  assert.equal(
    ilk({ customSurveyFields: [{ name: 'a', label: 'A', dependsOn: { conditions: [{ field: 'a', equals: 'x' }] } }] }),
    '"A" kendi kendine bağlı olamaz.',
  );
  assert.equal(
    ilk({ customSurveyFields: [{ name: 'a', label: 'A', dependsOn: { conditions: [] } }] }),
    '"A" koşullu işaretli ama hiç koşulu yok.',
  );
  // Gecerli govde: hata yok; bos source silinir (eski davranis).
  const d = { fieldOverrides: [{ fieldName: 'host', choicesSource: { source: '' } }] };
  assert.deepEqual(dogrula(spec, d), []);
  assert.equal(d.fieldOverrides[0].choicesSource, undefined);
  // Route artik ortak dogrulayiciyi cagiriyor; satir-ici kopya geri gelmedi.
  const src = fs.readFileSync(path.join(__dirname, '..', 'runner.cjs'), 'utf8');
  assert.match(src, /require\('\.\/ss-ozellestirme-dogrulama\.cjs'\)\.dogrula\(specFields, data\)/);
  assert.doesNotMatch(src, /const seenNames = new Set\(\);/, 'satir-ici dogrulama kopyasi geri geldi');
});

test('ST5b ozellestirmeUyumu: yetim alan, Smart degiskeni, launch secenegi, ask_variables, playbook', () => {
  const hedefSpec = [{ variable: 'env', type: 'text', default: 'dev' }];
  const k = { playbook: 'nginx_ops/nginx_ops.yml', ask_limit_on_launch: true, ask_variables_on_launch: true };
  const h = { playbook: 'baska.yml', ask_limit_on_launch: false, ask_variables_on_launch: false, extra_vars: '' };
  const u = T.ozellestirmeUyumu(
    {
      fieldOverrides: [{ fieldName: 'app', hidden: false }],
      smartApproval: { enabled: true, flowKey: 'F', metadataFields: 'application: {{extraVars.app_code}}\nenv: {{ extraVars.env }}', skipWhen: 'op: read' },
      launchOptionOverrides: { limit: { hidden: false, default: 'x' } },
      rawExtraVars: 'a: 1',
    },
    { hedefSpec, hedefDetail: h, kaynakDetail: k, kaynakModu: 'AWX' },
  );
  const metin = u.hatalar.join('\n');
  assert.match(metin, /"app": hedef survey'de yok/);
  assert.match(metin, /extraVars\.app_code/);
  assert.doesNotMatch(metin, /extraVars\.env\b/, 'var olan degisken hata sayildi');
  assert.match(metin, /ask_limit_on_launch kapalı/);
  assert.match(metin, /Prompt on launch > Variables/);
  assert.match(metin, /nginx_ops/);
  assert.match(u.uyarilar.join('\n'), /istisna kuralı "op"/);
  const temiz = T.ozellestirmeUyumu({ fieldOverrides: [{ fieldName: 'env' }] }, {
    hedefSpec,
    hedefDetail: { playbook: 'a.yml' },
    kaynakDetail: { playbook: 'a.yml' },
    kaynakModu: 'AWX',
  });
  assert.deepEqual(temiz.hatalar, []);
});

test('ST6 engel sorgulari template kapsamli ve parametreli; okunamayan = engel', async () => {
  for (const e of T.ENGELLER) {
    assert.match(e.sql, /awx_server_id = \$1 AND awx_template_id = \$2/, `${e.anahtar} template ile daraltilmamis`);
    assert.doesNotMatch(e.sql.replace(/\$\d/g, ''), /=\s*\d/, `${e.anahtar} SQL metninde sayi var`);
  }
  assert.match(T.ENGELLER.find((e) => e.anahtar === 'oco').sql, /'AWX_SCHEDULED'/);
  const sorgular = [];
  const db = {
    query: async (sql, params) => {
      sorgular.push(params);
      if (/smart_tickets/.test(sql)) return { rows: [{ n: 2 }] };
      throw new Error('tablo yok');
    },
  };
  const r = await T.engelleriSay(db, 2, 77);
  assert.deepEqual(r.engeller.map((e) => [e.anahtar, e.adet]), [['smart', 2]]);
  assert.deepEqual(r.okunamayan.map((e) => e.anahtar), ['oco'], 'okunamayan sorgu sifir sayildi');
  assert.deepEqual(sorgular[0], [2, 77]);
  for (const sql of [T.TASIMA_SQL, T.GERI_AL_SQL]) {
    assert.match(sql, /BEGIN TRAN;/);
    assert.match(sql, /WITH \(UPDLOCK, HOLDLOCK\)/);
    assert.match(sql, /IF @@TRANCOUNT > 0 ROLLBACK TRAN;/);
  }
});

test('ST11 gomulu kimlik taramasi', () => {
  assert.deepEqual(T.gomuluKimlikTara({ fieldOverrides: [{ fieldName: 'a', templateId: 5 }] }), ['fieldOverrides[0].templateId']);
  assert.deepEqual(T.gomuluKimlikTara({ x: { awx_server_id: 2 } }), ['x.awx_server_id']);
  assert.deepEqual(
    T.gomuluKimlikTara({
      smartApproval: { enabled: true, flowKey: 'F', metadataFields: 'a: b', skipWhen: 'x: y', integrationKey: 'k' },
      ocoCheck: { enabled: true, environments: ['prod'] },
      fieldOverrides: [{ fieldName: 'h', choicesSource: { source: 'nginx-hosts', params: { env: 'env' } } }],
    }),
    [],
  );
});

test('ST12 oncekiBaglariEkle: TASINDI kaynagi, GERI_ALINDI iki ucu; guncel bag haric', () => {
  const items = [
    { id: 'a', awxServerId: 3, awxTemplateId: 30 },
    { id: 'b', awxServerId: 2, awxTemplateId: 20 },
    { id: 'c', awxServerId: 2, awxTemplateId: 21 },
  ];
  const out = T.oncekiBaglariEkle(items, [
    { item_id: 'a', status: 'TASINDI', from_server: 2, from_template: 10, to_server: 3, to_template: 30 },
    { item_id: 'b', status: 'GERI_ALINDI', from_server: 2, from_template: 20, to_server: 3, to_template: 31 },
  ]);
  assert.deepEqual(out[0].oncekiBaglar, [{ awxServerId: 2, awxTemplateId: 10 }]);
  assert.deepEqual(out[1].oncekiBaglar, [{ awxServerId: 3, awxTemplateId: 31 }]);
  assert.equal(out[2].oncekiBaglar, undefined);
  const src = fs.readFileSync(path.join(__dirname, '..', 'runner.cjs'), 'utf8');
  const i = src.indexOf('async function reloadSsItemsCache()');
  const govde = src.slice(i, i + 1400);
  assert.match(govde, /catch \(e\) \{\s*console\.warn\(/, 'tasima kaydi okunamazsa kart listesi de dusuyor');
  assert.match(govde, /oncekiBaglariEkle\(items, gocler\)/);
});

test('ST13 tablo + filtreli tekil indeks + sekme seed', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  assert.match(s, /CREATE TABLE ansible_ss_migrations \(/);
  assert.match(s, /CREATE UNIQUE INDEX UX_ss_migrations_acik ON ansible_ss_migrations \(item_id\) WHERE status IN \('HAZIRLIK','TASINDI'\)/);
  assert.match(s, /element_key: 'admintab:sstasima'/);
});

// ---------------------------------------------------------------------------
// Dogrulayici turu 1 (2026-11-10) duzeltmelerinin bekcileri
// ---------------------------------------------------------------------------

test('ST14 surveyFarki kritiklik: tur, eksik secenek, fazla soru, siki min/max, gevsek required; normalizasyon', () => {
  const kritik = (k, h) => T.surveyFarki([k], [h]).kritikVar;
  const t = { variable: 'x', type: 'text', required: false, min: 0, max: 1024 };
  assert.equal(kritik(t, { ...t, type: 'textarea' }), true, 'tur degisimi kritik degil');
  const mc = { variable: 'x', type: 'multiplechoice', choices: ['a', 'b'] };
  assert.equal(kritik(mc, { ...mc, choices: ['a'] }), true, 'eksik secenek kritik degil');
  assert.equal(T.surveyFarki([t], [t, { variable: 'y', type: 'text' }]).kritikVar, true, 'hedefte fazla soru kritik degil');
  // Siki sinir kritik, gevsek sinir bilgi
  const i = { variable: 'n', type: 'integer', min: 0, max: 100 };
  assert.equal(kritik(i, { ...i, max: 10 }), true, 'max daralmasi kritik degil');
  assert.equal(kritik(i, { ...i, min: 5 }), true, 'min yukselmesi kritik degil');
  assert.equal(kritik({ ...i, max: null }, i), true, 'sinirsizdan sinirliya kritik degil');
  assert.equal(kritik(i, { ...i, max: 1000 }), false, 'max genislemesi kritik sayildi');
  assert.equal(kritik(t, { ...t, max: 5 }), true, 'text max daralmasi kritik degil');
  // required: kaynak zorunlu -> hedef degil kritik
  assert.equal(kritik({ ...t, required: true }, { ...t, required: false }), true, 'gevsek required kritik degil');
  // Normalizasyon: float "1.0" == 1, multiselect sirasiz, secenek kirpilmaz
  const f = { variable: 'f', type: 'float', default: '1.0' };
  assert.equal(T.surveyFarki([f], [{ ...f, default: 1 }]).satirlar[0].etiket, 'ayni', 'sayisal varsayilan yanlis alarm');
  const ms = { variable: 'm', type: 'multiselect', choices: ['a', 'b'], default: 'a\nb' };
  assert.equal(T.surveyFarki([ms], [{ ...ms, default: ['b', 'a'] }]).satirlar[0].etiket, 'ayni', 'multiselect sira farki alarm verdi');
  assert.equal(kritik({ ...mc, choices: [' a', 'b'] }, mc), true, "' a' ile 'a' ayni sayildi");
});

test('ST15 parola varsayilani: hedefte doluysa $encrypted$ ile korunur, yoksa bos; hedef okunamazsa yazim yok', async () => {
  const spec = [
    { variable: 'pwd', type: 'password', default: '$encrypted$', question_name: 'P' },
    { variable: 'yeni_pwd', type: 'password', default: '$encrypted$', question_name: 'Y' },
    { variable: 'env', type: 'text', default: 'dev' },
  ];
  const hedefOnceki = [
    { variable: 'pwd', type: 'password', default: '$encrypted$' },
    { variable: 'yeni_pwd', type: 'password', default: '' },
  ];
  const h = T.parolaHazirla(spec, hedefOnceki);
  assert.equal(h.spec.find((x) => x.variable === 'pwd').default, '$encrypted$', 'hedef parola varsayilani silinecekti');
  assert.equal(h.spec.find((x) => x.variable === 'yeni_pwd').default, '');
  assert.deepEqual([h.korunan, h.elle], [['pwd'], ['yeni_pwd']]);
  // surveyYaz: POST govdesinde koruma
  const cagrilar = [];
  const istek = async (method, p, body) => {
    cagrilar.push({ method, p, body });
    if (method === 'GET' && /survey_spec/.test(p)) return { spec: cagrilar.length === 1 ? hedefOnceki : h.spec };
    if (method === 'GET') return { survey_enabled: true };
    return null;
  };
  const r = await T.surveyYaz(istek, 7, spec, { enable: true });
  const post = cagrilar.find((c) => c.method === 'POST');
  assert.equal(post.body.spec.find((x) => x.variable === 'pwd').default, '$encrypted$');
  assert.deepEqual(r.parolaElle, ['yeni_pwd']);
  // Hedef spec'i okunamazsa (404 disi) hicbir yazim yapilmaz
  const yazim = [];
  const bozuk = async (method) => {
    yazim.push(method);
    if (method === 'GET') throw Object.assign(new Error('zaman asimi'), { status: 504 });
    return null;
  };
  await assert.rejects(() => T.surveyYaz(bozuk, 7, spec, { enable: true }));
  assert.deepEqual(yazim, ['GET'], 'hedef okunamadan yazildi');
  // 404 = survey yok: yazim devam eder, parola bos
  const yok = [];
  const bos = async (method, p, body) => {
    yok.push({ method, body });
    if (method === 'GET' && yok.length === 1) throw Object.assign(new Error('yok'), { status: 404 });
    if (method === 'GET' && /survey_spec/.test(p)) return { spec: T.parolaTemizle(spec) };
    if (method === 'GET') return { survey_enabled: true };
    return null;
  };
  assert.equal((await T.surveyYaz(bos, 7, spec, { enable: true })).ok, true);
});

test('ST16 transaction SQL yapisal bekcileri (THROW kodlari, durum filtreleri, arsiv, hedef silme)', () => {
  const t = T.TASIMA_SQL;
  for (const k of ['51001', '51002', '51003', '51004']) assert.match(t, new RegExp(`THROW ${k},`), `TASIMA_SQL ${k} yok`);
  assert.match(t, /IF @@ROWCOUNT <> 1 THROW 51001/);
  assert.match(t, /WHERE item_id = \$5 AND status = 'HAZIRLIK';/, "kayit UPDATE'i HAZIRLIK ile sinirli degil");
  // Kaynak satir kilitli karsilastirma
  assert.match(t, /WITH \(UPDLOCK, HOLDLOCK\)\s+WHERE awx_server_id = \$1 AND template_id = \$2 AND data = \$7\)/);
  // Iki dalda da hedef satir once arsivlenir
  const arsiv = t.match(/INSERT INTO ansible_ss_customizations_history[^;]*FROM ansible_ss_customizations WHERE awx_server_id = \$3 AND template_id = \$4;/g) || [];
  assert.equal(arsiv.length, 2, 'hedef ayar arsivi eksik');
  // Kaynakta ayar yoksa hedef satir silinir (bayat ayar yapismaz)
  assert.match(t, /ELSE\s+BEGIN[\s\S]*DELETE FROM ansible_ss_customizations WHERE awx_server_id = \$3 AND template_id = \$4;\s+END;/);
  const g = T.GERI_AL_SQL;
  for (const k of ['51011', '51012', '51013', '51014']) assert.match(g, new RegExp(`THROW ${k},`), `GERI_AL_SQL ${k} yok`);
  assert.match(g, /IF @@ROWCOUNT <> 1 THROW 51014/);
  assert.match(g, /WHERE id = \$6 AND item_id = \$5 AND status = 'TASINDI';/);
  assert.match(g, /oco_scheduled_launches WITH \(UPDLOCK, HOLDLOCK\)[\s\S]*THROW 51013/);
  assert.doesNotMatch(g, /DELETE/i);
  assert.equal(T.tasimaHatasi({ number: 51004, message: 'ss_tasima_kaynak_degisti' }).status, 409);
});

test('ST17 kartBagIhlalleri, ayniSunucu, istemciKaydi', () => {
  const tas = [{ item_id: 'a', to_server: 3, to_template: 30 }];
  assert.deepEqual(T.kartBagIhlalleri([{ id: 'a', awxServerId: 3, awxTemplateId: 30 }], tas), []);
  assert.equal(T.kartBagIhlalleri([{ id: 'a', title: 'A', awxServerId: 2, awxTemplateId: 20 }], tas).length, 1, 'bayat liste tasimayi geri aldi');
  assert.deepEqual(T.kartBagIhlalleri([{ id: 'b', awxServerId: 2, awxTemplateId: 20 }], tas), [], 'silinen / baska kart engellendi');
  assert.equal(T.ayniSunucu({ id: 2, url: 'https://m2.local' }, { id: 4, url: 'https://M2.local/' }), true, 'ayni host farkli id ayri sayildi');
  assert.equal(T.ayniSunucu({ id: 2, url: 'https://m2.local' }, { id: 3, url: 'https://m3.local' }), false);
  assert.equal(T.ayniSunucu({ id: 2 }, { id: 3 }), false);
  const k = T.istemciKaydi({
    id: 1,
    status: 'TASINDI',
    onceki: { hedefCustom: { gizli: 's3cr3t' } },
    uygulanan: { kaynakCustom: { fieldOverrides: [{ fieldName: 'p', defaultValue: 's3cr3t' }] }, kaynakCustomHash: 'h' },
    hedefSurveyOnceki: { spec: [] },
  });
  assert.ok(!JSON.stringify(k).includes('s3cr3t'), 'gizli ayar istemciye gidiyor');
  assert.deepEqual(k.ozet.uygulananAyarAlanlari, ['fieldOverrides']);
  assert.equal(k.onceki, undefined);
});

test('ST18 runner: liste yazim korumasi, onbellek silme, deneme denetimi redakte', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'runner.cjs'), 'utf8');
  const i = src.indexOf('async function writeSsItems(');
  const govde = src.slice(i, i + 3600);
  assert.match(govde, /if \(!ilkGoc && _ssItems === null\)/, 'dosya yedeginden yazim engellenmiyor');
  assert.match(govde, /if \(_ssItemsKirli\)/, 'kirli onbellek yazimi engellenmiyor');
  assert.match(govde, /const ihlal = require\('\.\/ss-tasima\.cjs'\)\.kartBagIhlalleri\(items, tasinanlar\);\s+if \(ihlal\.length\) \{\s+throw yazimHatasi\(/, 'tasinmis kart bag korumasi yok');
  // Koruma DELETE'ten once calisir
  assert.ok(govde.indexOf('kartBagIhlalleri') < govde.indexOf('DELETE FROM ansible_ss_items'), 'koruma yazimdan sonra');
  assert.match(govde, /WHERE status = 'TASINDI'/);
  assert.match(src, /await writeSsItems\(legacy, \{ ilkGoc: true \}\)/);
  assert.match(src, /_ssItems = require\('\.\/ss-tasima\.cjs'\)\.oncekiBaglariEkle\(items, gocler\);\s+_ssItemsKirli = false;/);
  assert.match(src, /else _ssCustom\.delete\(customKey\(serverId, templateId\)\);\s+\},\s+ssItemsKirliIsaretle,/);
  const b = src.indexOf("auditPortal(req, 'selfservice_test_scenario_run'");
  const d = src.slice(b, b + 500);
  assert.match(d, /extraVars: redactExtraVarsForHistory\(extraVars, specFields, overrides\)/, 'deneme denetimi gizli alanlari duz yaziyor');
});
