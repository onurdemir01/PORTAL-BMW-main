// server/ansible/__tests__/degisken-gizle.test.cjs — AWX sablon degiskenleri tarayiciya gitmeden
// once sirlardan arindirilir (2026-11-14; uretim kaydinda baglanti dizgisi parolasi ve AWX
// belirteci sablon listesinde duz metin gidiyordu).
//   DG1 adi sir olan degisken cikar; digerleri AYNEN kalir
//   DG2 adi masum, degeri sir (baglanti dizgisi, kullanici:parola@, Bearer, imzali adres, ozel anahtar)
//   DG3 MASKE YOK: cikti "***" tasimaz (baslatmada geri gidip gercek degeri ezerdi)
//   DG4 ic ice sir -> ust seviye degiskenin TAMAMI cikar (yarim nesne gitmez)
//   DG5 JSON bicimi; sir yoksa metin bayt bayt ayni
//   DG6 cok satirli blok, yorum, `---`, akis bicimi, bos / tanimsiz girdi
//   DG7 runner: sablon listesi arindirilmis metni dondurur (sahte AWX, gercek HTTP)
//   DG8 runner'da ham `extra_vars` yanita giden hicbir yerde arindirmasiz okunmaz (kaynak bekcisi)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  awxDegiskenleriniAyikla,
  sablonDegiskenAlanlari,
  nesnedenAyikla,
} = require('../degisken-gizle.cjs');

// Sentetik degerler: gercek hicbir sirla iliskisi yoktur.
const PAROLA = 'Ornek-Parola-0001';
const BELIRTEC = 'ornekbelirtec0123456789abcdefgh';

test('DG1 adi sir olan degisken cikar; digerleri aynen kalir', () => {
  const ham = [
    'hedef_ortam: test',
    `db_password: ${PAROLA}`,
    `nginx_ops_awx_token: ${BELIRTEC}`,
    'api_key: abc',
    'vault_secret: x',
    'kullanici_parola: y',
    'ssh_private_key: z',
    'tekrar_sayisi: 3',
  ].join('\n');
  const { metin, gizlenen } = awxDegiskenleriniAyikla(ham);
  assert.equal(metin, 'hedef_ortam: test\ntekrar_sayisi: 3');
  assert.deepEqual(gizlenen, [
    'db_password',
    'nginx_ops_awx_token',
    'api_key',
    'vault_secret',
    'kullanici_parola',
    'ssh_private_key',
  ]);
  // Adi "key" ile BITMEYEN / sir cagristirmayan degiskenler kalir.
  const masum = awxDegiskenleriniAyikla(
    'keyboard: tr\nmonkey_count: 2\nanahtar_kelime: a',
  ).gizlenen;
  assert.deepEqual(masum, []);
});

test('DG2 adi masum ama degeri sir tasiyan degisken cikar', () => {
  const ornekler = {
    baglanti: `Server=db.example;Database=ORNEK;UID=ornek_usr;PWD=${PAROLA};`,
    baglanti2: `Data Source=db.example;Password=${PAROLA}`,
    adres: `https://kullanici:${PAROLA}@depo.example/yol`,
    baslik: `Bearer ${BELIRTEC}`,
    kanca: `https://akis.example/tetikle?api-version=1&sig=${BELIRTEC}`,
    anahtar_metni: '-----BEGIN RSA PRIVATE KEY-----',
  };
  for (const [ad, deger] of Object.entries(ornekler)) {
    const { metin, gizlenen } = awxDegiskenleriniAyikla(`ortam: qa\n${ad}: "${deger}"`);
    assert.deepEqual(gizlenen, [ad], ad);
    assert.equal(metin, 'ortam: qa', ad);
  }
  // Sir isareti olmayan adres / dizgi kalir.
  const temiz =
    'adres: https://depo.example/yol?sayfa=2\nbaglanti: Server=db.example;Database=ORNEK';
  assert.deepEqual(awxDegiskenleriniAyikla(temiz), { metin: temiz, gizlenen: [] });
});

test('DG3 cikti maske tasimaz ve sir degerinin hicbir parcasi kalmaz', () => {
  const ham = `a: 1\ndb_conn: "Server=x;PWD=${PAROLA}"\nawx_token: ${BELIRTEC}\nb: 2`;
  const { metin } = awxDegiskenleriniAyikla(ham);
  assert.doesNotMatch(metin, /\*{2,}|•/);
  assert.ok(!metin.includes(PAROLA) && !metin.includes(BELIRTEC));
  assert.ok(!metin.includes('db_conn') && !metin.includes('awx_token'));
  assert.equal(metin, 'a: 1\nb: 2');
});

test('DG4 ic ice sir: ust seviye degiskenin tamami cikar', () => {
  const yaml = [
    'veritabani:',
    '  sunucu: db.example',
    `  parola: ${PAROLA}`,
    '  port: 1433',
    'ortam: qa',
  ].join('\n');
  assert.deepEqual(awxDegiskenleriniAyikla(yaml), { metin: 'ortam: qa', gizlenen: ['veritabani'] });
  // Liste ogesi icindeki anahtar ve ic ice degerdeki baglanti dizgisi.
  const liste = [
    'hedefler:',
    '  - ad: a',
    `    token: ${BELIRTEC}`,
    'kaynaklar:',
    `  - "Server=x;PWD=${PAROLA}"`,
    'z: 1',
  ].join('\n');
  assert.deepEqual(awxDegiskenleriniAyikla(liste), {
    metin: 'z: 1',
    gizlenen: ['hedefler', 'kaynaklar'],
  });
  const { nesne, gizlenen } = nesnedenAyikla({
    a: { b: { sifre: 'x' } },
    c: [{ d: `Bearer ${BELIRTEC}` }],
    e: { f: 1 },
  });
  assert.deepEqual(nesne, { e: { f: 1 } });
  assert.deepEqual(gizlenen, ['a', 'c']);
});

test('DG5 JSON bicimi; sir yoksa metin bayt bayt ayni', () => {
  const json = JSON.stringify({ ortam: 'qa', db_password: PAROLA, ic: { api_key: 'k' }, sayi: 5 });
  const { metin, gizlenen } = awxDegiskenleriniAyikla(json);
  assert.deepEqual(JSON.parse(metin), { ortam: 'qa', sayi: 5 });
  assert.deepEqual(gizlenen, ['db_password', 'ic']);
  for (const temiz of ['{"a":1,"b":{"c":[1,2]}}', 'a: 1\n\n# yorum\nb:   iki  \n', '---\na: 1\n']) {
    assert.deepEqual(awxDegiskenleriniAyikla(temiz), { metin: temiz, gizlenen: [] });
  }
  // AWX extra_vars'i nesne olarak da dondurebilir.
  assert.deepEqual(sablonDegiskenAlanlari({ a: 1, token: 't' }), {
    variables: '{\n  "a": 1\n}',
    hiddenVariables: ['token'],
  });
});

test('DG6 cok satirli blok, yorum, akis bicimi, bos girdi', () => {
  const blok = [
    'betik: |',
    '  sqlcmd -S db.example \\',
    `    -P ${PAROLA}`,
    '  echo bitti',
    'kalan: 1',
  ].join('\n');
  // `-P <parola>` desenlerde yok: blok kalir (bilinen sinir; adi sir olmayan serbest metin).
  assert.equal(awxDegiskenleriniAyikla(blok).gizlenen.length, 0);
  const blok2 = [
    'betik: |',
    `  curl -H "Authorization: Bearer ${BELIRTEC}" https://x.example`,
    'kalan: 1',
  ].join('\n');
  assert.deepEqual(awxDegiskenleriniAyikla(blok2), { metin: 'kalan: 1', gizlenen: ['betik'] });
  const bayrak = ['betik: |', `  arac --password ${PAROLA} --hedef x`, 'kalan: 1'].join('\n');
  assert.deepEqual(awxDegiskenleriniAyikla(bayrak), { metin: 'kalan: 1', gizlenen: ['betik'] });
  // Yorum satirindaki sir da gitmez; ust anahtara baglanamayan akis bicimi satiri atilir.
  const yorum = `# eski: PWD=${PAROLA}\na: 1`;
  assert.equal(awxDegiskenleriniAyikla(yorum).metin, 'a: 1');
  const akis = `{a: 1, db_password: ${PAROLA}}`;
  const r = awxDegiskenleriniAyikla(akis);
  assert.ok(!r.metin.includes(PAROLA));
  assert.equal(r.gizlenen.length, 1);
  for (const bos of ['', '   ', null, undefined, 0, false]) {
    assert.deepEqual(awxDegiskenleriniAyikla(bos), { metin: '', gizlenen: [] });
  }
  // Tirnakli anahtar.
  assert.deepEqual(awxDegiskenleriniAyikla(`"db_password": x\n'ad': y`), {
    metin: "'ad': y",
    gizlenen: ['db_password'],
  });
});

// ── DG7: runner'in GERCEK yolu (sahte AWX sunucusu, gercek HTTP) ───────────────────────────────
function sahteAwx(sablonlar) {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    res.setHeader('Content-Type', 'application/json');
    const m = /\/job_templates\/(\d+)\/(survey_spec\/)?$/.exec(u.pathname);
    if (m && m[2]) return res.end(JSON.stringify({ spec: [] }));
    if (m) return res.end(JSON.stringify(sablonlar.find((t) => t.id === Number(m[1])) || {}));
    if (/\/job_templates\/$/.test(u.pathname))
      return res.end(JSON.stringify({ count: sablonlar.length, next: null, results: sablonlar }));
    res.end(JSON.stringify({ results: [], count: 0, next: null }));
  });
  return new Promise((coz) => srv.listen(0, '127.0.0.1', () => coz(srv)));
}

test('DG7 runner sablon listesi arindirilmis degisken dondurur', async () => {
  const sablonlar = [
    {
      id: 11,
      name: 'Sirli',
      playbook: 'a.yml',
      extra_vars: `ortam: qa\ndb_conn: "Server=db.example;PWD=${PAROLA}"\nops_token: ${BELIRTEC}`,
    },
    { id: 12, name: 'Temiz', playbook: 'b.yml', extra_vars: 'ortam: test' },
    { id: 13, name: 'Bos', playbook: 'c.yml', extra_vars: '' },
  ];
  const srv = await sahteAwx(sablonlar);
  const onceki = { ...process.env };
  process.env.AWX_9_URL = `http://127.0.0.1:${srv.address().port}`;
  process.env.AWX_9_TOKEN = 'sahte-belirtec';
  process.env.AWX_9_NAME = 'sahte';
  try {
    const runner = require('../runner.cjs');
    const sunucu = runner.getServerById ? runner.getServerById(9) : null;
    assert.ok(sunucu, 'AWX_9 sunucusu okunamadi');
    const liste = await runner.listTemplatesForServer(sunucu);
    const govde = JSON.stringify(liste);
    assert.ok(!govde.includes(PAROLA) && !govde.includes(BELIRTEC), 'sir sablon listesinde');
    const sirli = liste.find((t) => t.id === 11);
    assert.equal(sirli.variables, 'ortam: qa');
    assert.deepEqual(sirli.hiddenVariables, ['db_conn', 'ops_token']);
    assert.deepEqual(liste.find((t) => t.id === 12).hiddenVariables, []);
    assert.equal(liste.find((t) => t.id === 12).variables, 'ortam: test');
    assert.equal(liste.find((t) => t.id === 13).variables, '');
  } finally {
    for (const k of ['AWX_9_URL', 'AWX_9_TOKEN', 'AWX_9_NAME']) {
      if (onceki[k] === undefined) delete process.env[k];
      else process.env[k] = onceki[k];
    }
    await new Promise((coz) => srv.close(coz));
  }
});

// Rota govdeleri (sablon ayrintisi, survey'siz sozde-alanlar) burada HTTP ile kosturulmuyor; yeni bir
// `extra_vars` okumasi arindirmasiz eklenirse bu bekci yakalar.
test('DG8 runner ham extra_vars`i arindirmadan yanita koymaz', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const satirlar = fs.readFileSync(path.join(__dirname, '..', 'runner.cjs'), 'utf8').split('\n');
  // SABLON nesnesinden okuma (AWX'e giden `payload.extra_vars` ve AWX hata govdesi `body.extra_vars`
  // sablon degiskeni degildir).
  const okuyan = satirlar
    .map((s, i) => [i + 1, s])
    .filter(
      ([, s]) =>
        !/^\s*(\/\/|\*)/.test(s) && /\b(t|detail|tpl|template|sablon)\??\.extra_vars\b/.test(s),
    );
  // Sunucu ICI tek okuma: Smart metadata sablon baglami (tarayiciya donmez).
  const IC = /const ham = String\(\(t && t\.extra_vars\) \|\| ''\)\.trim\(\);/;
  const arindirmasiz = okuyan
    .filter(
      ([, s]) =>
        !/(awxDegiskenleriniAyikla|sablonDegiskenAlanlari)\((\w+)\.extra_vars\)/.test(s) &&
        !IC.test(s),
    )
    .map(([n, s]) => `${n}: ${s.trim()}`);
  assert.deepEqual(arindirmasiz, []);
  assert.ok(
    okuyan.length >= 5,
    `extra_vars okumasi az bulundu (${okuyan.length}) - desen bayatlamis olabilir`,
  );
});
