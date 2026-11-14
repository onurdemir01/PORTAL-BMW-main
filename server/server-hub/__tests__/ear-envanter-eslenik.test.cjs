// server/server-hub/__tests__/ear-envanter-eslenik.test.cjs - Eslenik motoru: dogruluk tablosu ve degismezler.
//
// Kullanici kararlari (2026-11-05 anketi) birebir sinanir:
//   EE1  AYNI                          EE2  surum farki -> FARKLI_KUTUPHANE, ayrintida SURUM satiri
//   EE3  yalniz boyut -> AYNI_SURUM_FARKLI_DOSYA (eski celiski: "farkli" deyip "ayni" gostermek YOK)
//   EE4  WAR yalniz birinde            EE5  kip farki karsilastirmayi engellemez
//   EE6  eksik kopya: iki sonuc da karsilastirilamadi, asla AYNI degil
//   EE7  ortami bos kopya karsilastirilmaz (ORTAM_YOK)   EE8  ortam normalize; PROD != PREPROD
//   EE9  ortamlar arasi harfler ve farkli ortamlar       EE10 JBoss 7 <-> 8 (boyuta duyarli)
//   EE11 tarih farki karari engellemez                   EE12 kopya kimligi host + kok + ad
//   EE13 FARKLI_YAPI                   EE14 rastgele 500 grup: sira bagimsizligi, eksikte AYNI yok,
//                                           KARAR = AYRINTI (hic celismez)
//   EE15 JS yapi izi = gercek ear_tara.py izi (TAM kip, yapay agac)
//   EE16 eski setlerin surum izi set satirlarindan hesaplanir ve DB'ye yazilir; analiz onbellegi
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const F = require('./fixtures/ear-envanter.cjs');

const alim = require('../ear-envanter-alim.cjs');
const E = require('../ear-envanter-eslenik.cjs');

afterEach(() => {
  F.dbKaldir();
  E._sifirlaForTest();
});

const LIB = [['spring-core', '6.1.0', 100]];

/** Kopya: kutuphaneleri gercek alim fonksiyonlariyla set izine cevrilir (DB'deki gibi). */
function kopya(host, ek = {}) {
  const o = {
    ortam: 'PROD',
    ad: 'ODEME.ear',
    jboss: '8',
    durum: 'TAM',
    kip: 'TAM',
    yapi: 'y1',
    warlar: { 'ODEME.war': LIB },
    ear: [],
    taranma: '2026-11-01T02:00:00',
    ...ek,
  };
  const kok = o.kok || (() => { if (o.jboss === '7') return '/vhosting'; if (o.jboss === '8') return '/vhosting8'; return '/ozel'; })();
  const surum = new Map();
  const setOf = (l) => {
    const s = alim.kutuphaneSeti(l);
    if (!s) return null;
    surum.set(s.iz, s.surumIzi);
    return s.iz;
  };
  const ws = Object.entries(o.warlar).map(([yol, l]) => ({
    yol,
    ad: yol,
    kutuphane_seti: setOf(l),
  }));
  const earSet = setOf(o.ear);
  return {
    host,
    ortam: o.ortam,
    ad: o.ad,
    jboss: o.jboss,
    kok,
    durum: o.durum,
    kip: o.kip,
    yapi_izi: o.yapi,
    taranma_utc: o.taranma,
    kosu_id: 1,
    uyg_no: 0,
    bag_hedefi: null,
    ...E.imzalar(ws, earSet, surum),
    _libs: { warlar: o.warlar, ear: o.ear },
  };
}

/** farkSatirlari girdisi: DB'nin sakladigi sirali set satirlari. */
const konumlu = (k) => {
  const sat = (l) => (alim.kutuphaneSeti(l) || { satirlar: [] }).satirlar;
  const m = new Map([['', sat(k._libs.ear)]]);
  for (const [yol, l] of Object.entries(k._libs.warlar)) m.set(yol, sat(l));
  return { anahtar: E.kopyaAnahtari(k), konumlar: m };
};
const fark = (ks) => E.farkSatirlari(ks.map(konumlu));
const ortamIci = (ks) => E.analizEt(ks, { tumu: true }).ortamIci;

test('EE1 AYNI', () => {
  const g = ortamIci([kopya('H1'), kopya('H2'), kopya('H3')]);
  assert.equal(g.length, 1);
  assert.deepEqual([g[0].karar, g[0].kutuphane, g[0].yapi], ['AYNI', 'AYNI', 'AYNI']);
  assert.deepEqual(g[0].degiskenler, [{ harf: 'A', hostlar: ['H1', 'H2', 'H3'], kopya_sayisi: 3 }]);
});

test('EE2 surum farki', () => {
  const ks = [
    kopya('H1'),
    kopya('H2', { warlar: { 'ODEME.war': [['spring-core', '6.2.0', 100]] } }),
  ];
  const g = ortamIci(ks)[0];
  assert.deepEqual([g.karar, g.kutuphane], ['FARKLI_KUTUPHANE', 'FARKLI']);
  const f = fark(ks);
  assert.deepEqual(
    f.map((x) => [x.kategori, x.konum, x.kutuphane]),
    [['SURUM', 'ODEME.war', 'spring-core']],
  );
  assert.deepEqual(f[0].degerler['H1|/vhosting8|ODEME.ear'], [['6.1.0', 100]]);
  assert.deepEqual(f[0].degerler['H2|/vhosting8|ODEME.ear'], [['6.2.0', 100]]);
});

test('EE3 yalniz boyut: ayni surum, farkli dosya', () => {
  const ks = [
    kopya('H1'),
    kopya('H2', { warlar: { 'ODEME.war': [['spring-core', '6.1.0', 999]] } }),
  ];
  const g = ortamIci(ks)[0];
  assert.deepEqual([g.karar, g.kutuphane], ['AYNI_SURUM_FARKLI_DOSYA', 'AYNI_SURUM_FARKLI_DOSYA']);
  const f = fark(ks);
  assert.deepEqual(
    f.map((x) => x.kategori),
    ['BOYUT'],
    'ayrinti bos olamaz, SURUM olamaz',
  );
});

test('EE4 WAR yalniz birinde', () => {
  const ks = [kopya('H1'), kopya('H2', { warlar: { 'ODEME.war': LIB, 'EK.war': [] } })];
  assert.equal(ortamIci(ks)[0].karar, 'FARKLI_KUTUPHANE');
  const f = fark(ks);
  assert.deepEqual(
    f.map((x) => [x.kategori, x.konum]),
    [['WAR', 'EK.war']],
  );
  assert.equal(f[0].degerler['H1|/vhosting8|ODEME.ear'], null);
  assert.deepEqual(f[0].degerler['H2|/vhosting8|ODEME.ear'], []);
});

test('EE5 kip farki engel degil', () => {
  const g = ortamIci([kopya('H1'), kopya('H2', { kip: 'OZET' })])[0];
  assert.deepEqual([g.karar, g.kutuphane, g.yapi], ['AYNI', 'AYNI', 'AYNI']);
  assert.deepEqual(g.kipler, ['OZET', 'TAM']);
  const h = ortamIci([
    kopya('H1'),
    kopya('H2', { kip: 'OZET', warlar: { 'ODEME.war': [['spring-core', '5.3.0', 100]] } }),
  ])[0];
  assert.equal(h.karar, 'FARKLI_KUTUPHANE');
});

test('EE6 eksik kopya asla AYNI degil', () => {
  for (const d of [
    'KISMI_SINIR',
    'KISMI_ZAMAN',
    'KISMI_IZIN',
    'ARSIV_ACILMADI',
    'ATLANDI_ZAMAN',
    'HATA',
  ]) {
    const g = ortamIci([kopya('H1'), kopya('H2', { durum: d })])[0];
    assert.deepEqual(
      [g.karar, g.kutuphane, g.yapi],
      ['EKSIK_TARAMA', 'KARSILASTIRILAMADI', 'KARSILASTIRILAMADI'],
      d,
    );
    assert.deepEqual(g.eksik, [`H2:${d}`]);
  }
});

test('EE7 ortami bos kopya karsilastirilmaz', () => {
  const a = E.analizEt(
    [kopya('H1', { ortam: null }), kopya('H2', { ortam: '' }), kopya('H3', { ortam: '  ' })],
    { tumu: true },
  );
  assert.deepEqual(a.ortamIci, []);
  assert.deepEqual(a.ortamlarArasi, []);
  assert.equal(a.ortamYok.length, 1);
  assert.deepEqual(a.ortamYok[0].hostlar, ['H1', 'H2', 'H3']);
  assert.equal(a.ortamYok[0].karar, null);
  for (const v of a.kopyaKarari.values()) assert.equal(v.ortam_ici, null);
});

test('EE8 ortam normalize; PROD ile PREPROD ayri', () => {
  const g = ortamIci([
    kopya('H1', { ortam: 'PROD' }),
    kopya('H2', { ortam: 'prod ' }),
    kopya('H3', { ortam: 'PREPROD' }),
  ]);
  const prod = g.find((x) => x.ortam === 'PROD');
  assert.deepEqual(prod.hostlar, ['H1', 'H2']);
  assert.equal(g.find((x) => x.ortam === 'PREPROD').karar, 'TEK');
});

test('EE9 ortamlar arasi', () => {
  const eski = { warlar: { 'ODEME.war': [['spring-core', '5.3.0', 100]] } };
  const a = E.analizEt([
    kopya('T1', { ortam: 'TEST' }),
    kopya('P1', { ortam: 'PREPROD' }),
    kopya('R1', { ortam: 'PROD', ...eski }),
    kopya('R2', { ortam: 'PROD', ...eski }),
    kopya('R3', { ortam: 'PROD' }),
  ]);
  assert.equal(a.ortamlarArasi.length, 1);
  const g = a.ortamlarArasi[0];
  assert.equal(g.karar, 'FARKLI_KUTUPHANE');
  assert.equal(g.ortam_sayisi, 3);
  // A: 3 kopya (T1, P1, R3), B: 2 kopya (R1, R2)
  assert.deepEqual(
    g.ortamlar.map((o) => [o.ortam, o.harfler.join('+')]),
    [
      ['PREPROD', 'A'],
      ['PROD', 'A+B'],
      ['TEST', 'A'],
    ],
  );
  assert.deepEqual(g.farkli_ortamlar, ['PROD']);
  const ayni = E.analizEt([kopya('T1', { ortam: 'TEST' }), kopya('R1', { ortam: 'PROD' })])
    .ortamlarArasi[0];
  assert.deepEqual([ayni.karar, ayni.farkli_ortamlar], ['AYNI', []]);
  assert.equal(
    E.analizEt([kopya('T1', { ortam: 'TEST' }), kopya('T2', { ortam: 'TEST' })]).ortamlarArasi
      .length,
    0,
  );
});

test('EE10 JBoss 7 <-> 8', () => {
  const a = E.analizEt([
    kopya('H1', { jboss: '7' }),
    kopya('H1', { jboss: '8' }),
    kopya('H2', { jboss: '7' }),
    kopya('H2', { jboss: '8', warlar: { 'ODEME.war': [['spring-core', '6.1.0', 5]] } }),
    kopya('H3', { jboss: '7' }),
    kopya('H3', { jboss: '8', durum: 'KISMI_SINIR' }),
    kopya('H4', { jboss: '8' }),
    kopya('H5', { jboss: '7' }),
  ]);
  assert.ok(!a.nesil.some((x) => x.host === 'H4' || x.host === 'H5'), 'tek nesil NESIL degil');
  assert.deepEqual(
    a.nesil.map((x) => [x.host, x.karar, x.ayni_kutuphane]),
    [
      ['H2', 'AYNI_SURUM_FARKLI_DOSYA', false],
      ['H3', 'EKSIK_TARAMA', null],
      ['H1', 'AYNI', true],
    ],
  );
});

test('EE11 tarih farki karari engellemez', () => {
  const g = ortamIci([
    kopya('H1', { taranma: '2026-09-22T02:00:00' }),
    kopya('H2', { taranma: '2026-11-01T02:00:00' }),
    kopya('H3', { taranma: null }),
  ])[0];
  assert.equal(g.karar, 'AYNI');
  assert.equal(g.tarih_farki_gun, 40);
  assert.equal(g.tarih_bilinmeyen, 1);
});

test('EE12 kopya kimligi host + kok + ad', () => {
  const a = E.analizEt(
    [kopya('H1', { jboss: '?', kok: '/ozel1' }), kopya('H1', { jboss: '?', kok: '/ozel2' })],
    { tumu: true },
  );
  assert.equal(a.ortamIci[0].karar, 'TEK', 'tek sunucu: eslenik degil');
  assert.equal(a.ortamIci[0].kopya_sayisi, 2);
  assert.equal(a.kopyaKarari.size, 0, 'tek sunuculu grup karar almaz');
  const b = E.analizEt([
    kopya('H1', { jboss: '?', kok: '/ozel1' }),
    kopya('H1', { jboss: '?', kok: '/ozel2', yapi: 'y2' }),
    kopya('H2', { jboss: '?', kok: '/ozel1' }),
  ]);
  assert.deepEqual(
    [b.ortamIci[0].host_sayisi, b.ortamIci[0].kopya_sayisi, b.ortamIci[0].karar],
    [2, 3, 'FARKLI_YAPI'],
  );
  assert.deepEqual([...b.kopyaKarari.keys()].sort(), [
    'H1|/ozel1|ODEME.ear',
    'H1|/ozel2|ODEME.ear',
    'H2|/ozel1|ODEME.ear',
  ]);
});

test('EE13 FARKLI_YAPI', () => {
  const g = ortamIci([kopya('H1'), kopya('H2', { yapi: 'y2' })])[0];
  assert.deepEqual([g.karar, g.kutuphane, g.yapi], ['FARKLI_YAPI', 'AYNI', 'FARKLI']);
  assert.deepEqual(fark([kopya('H1'), kopya('H2', { yapi: 'y2' })]), [], 'kutuphane ayrintisi bos');
});

test('EE14 rastgele gruplar: sira bagimsiz, eksikte AYNI yok, karar = ayrinti', () => {
  let tohum = 20261105;
  const r = (n) => {
    tohum = (tohum * 1103515245 + 12345) % 2147483648;
    return tohum % n;
  };
  const libler = ['spring-core', 'log4j-core', 'jackson-databind', 'thymeleaf'];
  const rastgeleWar = () => {
    const l = [];
    for (const ad of libler) if (r(3)) l.push([ad, ['1.0', '1.1', '2.0'][r(3)], [10, 20][r(2)]]);
    if (!r(6)) l.push(['spring-core', '9.9', 7]);
    return l;
  };
  for (let g = 0; g < 500; g++) {
    const temel = { 'A.war': rastgeleWar(), 'B.war': rastgeleWar() };
    const ks = [];
    const n = 2 + r(4);
    for (let i = 0; i < n; i++) {
      const w = (() => { if (r(3)) return temel; return { 'A.war': rastgeleWar(), ...(r(2) ? { 'B.war': temel['B.war'] } : {}) }; })();
      // boyut-only degisken: ayni surumler, farkli boyut
      const b = r(5)
        ? w
        : Object.fromEntries(
            Object.entries(w).map(([k, l]) => [k, l.map(([a, s, z]) => [a, s, z + 1])]),
          );
      ks.push(
        kopya(`H${i}`, {
          warlar: b,
          ear: r(4) ? [] : [['commons-io', '2.' + r(2), 5]],
          yapi: r(4) ? 'y' : 'z',
          durum: r(10) ? 'TAM' : 'KISMI_SINIR',
        }),
      );
    }
    const s = ortamIci(ks)[0];
    const ters = ortamIci([...ks].reverse())[0];
    assert.deepEqual(
      [ters.karar, ters.kutuphane, ters.yapi],
      [s.karar, s.kutuphane, s.yapi],
      `sira #${g}`,
    );
    if (ks.some((k) => k.durum !== 'TAM')) {
      assert.equal(s.karar, 'EKSIK_TARAMA', `eksik #${g}`);
      continue;
    }
    const kat = new Set(fark(ks).map((x) => x.kategori));
    if (s.kutuphane === 'AYNI') assert.equal(kat.size, 0, `AYNI ama ayrinti dolu #${g}`);
    if (s.kutuphane === 'AYNI_SURUM_FARKLI_DOSYA')
      assert.deepEqual([...kat], ['BOYUT'], `boyut #${g}`);
    if (s.kutuphane === 'FARKLI')
      assert.ok(
        kat.has('WAR') || kat.has('EKSIK') || kat.has('SURUM'),
        `FARKLI ama ayrinti yok #${g}`,
      );
  }
});

const PY = (() => {
  const r = spawnSync('python3', ['-c', 'print(1)']);
  return r.status === 0 ? 'python3' : null;
})();

test('EE15 JS yapi izi = ear_tara.py izi', { skip: PY ? false : 'python3 yok' }, () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'ear-iz-'));
  const v8 = path.join(kok, 'vhosting8');
  const yaz = (rel, icerik = 'x') => {
    fs.mkdirSync(path.dirname(path.join(v8, rel)), { recursive: true });
    fs.writeFileSync(path.join(v8, rel), icerik);
  };
  yaz('ODEME.ear/META-INF/application.xml', '<application/>');
  yaz('ODEME.ear/ODEME.war/WEB-INF/lib/spring-core-6.1.0.jar', 'jar');
  yaz('ODEME.ear/ODEME.war/WEB-INF/web.xml', '<web-app/>');
  yaz('ODEME.ear/ODEME.war/index.jsp', 'jsp');
  yaz('ODEME.ear/ODEME.war/Türkçe ad.jsp', 'jsp');
  yaz('ODEME.ear/ODEME.war/WEB-INF/logs/a.log', 'log');
  yaz('ODEME.ear/tmp/b.txt', 'gecici');
  const betik = path.join(
    __dirname,
    '..',
    '..',
    'ansible',
    'bmw_portal',
    'ear_envanter',
    'files',
    'ear_tara.py',
  );
  const r = spawnSync(PY, ['-B', betik], {
    env: {
      PATH: process.env.PATH,
      EAR_KIP: 'TAM',
      EAR_KOKLER: v8,
      EAR_CIKTI: 'paket',
      LC_ALL: 'C.UTF-8',
    },
  });
  assert.equal(r.status, 0, String(r.stderr));
  const yuk = alim.paketCoz(r.stdout);
  const u = yuk.uygulamalar[0];
  assert.equal(u.durum, 'TAM');
  assert.ok(u.yapi_izi, 'tarayici izi var');
  assert.equal(E.yapiIzi(u.satirlar), u.yapi_izi, 'JS izi Python iziyle birebir');
  assert.ok(
    u.satirlar.some((s) => /logs\/a\.log$/.test(s[0])),
    'ucucu dosya agacta var',
  );
  const f = E.yapiFarki(
    u.satirlar,
    u.satirlar.filter((s) => !/index\.jsp$/.test(s[0])),
  );
  assert.deepEqual(f.yalnizA, ['ODEME.war/index.jsp']);
  assert.deepEqual([f.yalnizB, f.tipFarkli], [[], []]);
  const g = E.yapiFarki(u.satirlar, [...u.satirlar, ['ODEME.war/WEB-INF/logs/yeni.log', 'F']]);
  assert.deepEqual(g.yalnizB, [], 'ucucu yol farka girmez');
  fs.rmSync(kok, { recursive: true, force: true });
});

test('EE16 eski setin surum izi hesaplanir ve yazilir; analiz onbellegi', async () => {
  const s = alim.kutuphaneSeti([
    ['b', '2', 5],
    ['a', '1', 3],
  ]);
  let imza = '5:10';
  let okuma = 0;
  const db = F.sahteDb([
    [
      /SELECT COUNT\(\*\) AS n, MAX\(id\) AS m/,
      () => ({ rows: [{ n: Number(imza.split(':')[0]), m: Number(imza.split(':')[1]) }] }),
    ],
    [
      /SELECT u\.kosu_id, u\.host, h\.ortam, u\.uyg_no, u\.kok/,
      () => {
        okuma += 1;
        return {
          rows: ['H1', 'H2'].map((host) => ({
            kosu_id: 3,
            host,
            ortam: 'PROD',
            uyg_no: 0,
            kok: '/vhosting8',
            jboss: '8',
            ad: 'A.ear',
            durum: 'TAM',
            kip: 'TAM',
            yapi_izi: 'y',
            ear_kutuphane_seti: `${s.iz}`,
            bag_hedefi: null,
            taranma_utc: null,
          })),
        };
      },
    ],
    [/SELECT w\.kosu_id, w\.host, w\.uyg_no, w\.yol/, () => ({ rows: [] })],
    [
      /SELECT s\.iz, s\.surum_izi FROM ear_envanter_kutuphane_setleri/,
      () => ({ rows: [{ iz: s.iz, surum_izi: null }] }),
    ],
    [
      /SELECT iz, sira, ad, surum FROM ear_envanter_set_kutuphaneleri/,
      () => ({
        rows: s.satirlar.map(([ad, surum], sira) => ({ iz: s.iz, sira, ad, surum })),
      }),
    ],
  ]);
  F.dbKur(db);
  const a = await E.analiz();
  assert.equal(a.ortamIci[0].karar, 'AYNI');
  const upd = db.cagrilar.find((c) => /UPDATE s SET surum_izi/.test(c.sql));
  assert.ok(upd, 'surum izi DB ye yazilir');
  assert.deepEqual(
    JSON.parse(upd.params[0]),
    [{ iz: s.iz, surum_izi: s.surumIzi }],
    'alimdaki hesapla ayni',
  );
  assert.match(upd.sql, /WHERE s\.surum_izi IS NULL/);
  await E.analiz();
  assert.equal(okuma, 1, 'veri imzasi ayniyken yeniden hesaplanmaz');
  imza = '6:11';
  await Promise.all([E.analiz(), E.analiz(), E.analiz()]);
  assert.equal(okuma, 2, 'yeni veri: tek ucusla bir kez');
});
