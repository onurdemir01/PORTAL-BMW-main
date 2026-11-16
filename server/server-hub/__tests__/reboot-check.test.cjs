// server/server-hub/__tests__/reboot-check.test.cjs — RC1..RC5 (2026-10-08).
//
// Reboot Kontrolu: "once" goruntusu Portal'da saklanir ve "sonra" job'ina Portal verir; sunucu
// SORUNSUZ ancak son goruntu OLCULDU ve once ile farki yoksa. Duzeltme JVM/web baslatir ve durdurur;
// onaysiz baslamaz.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');
const http = require('node:http');

const { sonraDegerlendir, onceGirdisi, kayitDurumu, SONRA_ACIK } = require('../reboot-check.cjs');

test('RC1 sorunsuz yalniz: son goruntu olculdu VE fark yok', () => {
  const d = sonraDegerlendir(
    {
      A: {
        once_var: true,
        son_olculdu: true,
        son_fark: [],
        betik_surum: 4,
        islemler: ['SONUC|baslat|JBOSS8_JVM|x|OK|ok'],
      },
      B: {
        once_var: true,
        son_olculdu: true,
        son_fark: ['FARK|DOWN|JBOSS8_JVM|y|d'],
        islemler: ['SONUC|baslat|JBOSS8_JVM|y|FAIL|hata'],
      },
      C: { once_var: true, son_olculdu: false, son_fark: [] },
      D: { sonuc_yok: true },
      E: { once_var: false, son_olculdu: true, son_fark: [] },
    },
    ['A', 'B', 'C', 'D', 'E', 'F'],
  );
  assert.equal(d.A.durum, 'sorunsuz');
  assert.deepEqual([d.B.durum, d.B.kalan, d.B.hatali], ['sorunlu', 1, 1]);
  for (const h of ['C', 'D', 'E', 'F'])
    assert.equal(d[h].durum, 'olculemedi', `${h} olculemedigi halde sorunsuz/sorunlu sayildi`);
});

test('RC2 "sonra" girdisi yalniz goruntusu ALINAN ve yeni bicimde (BOOT satirli) sunuculari tasir', () => {
  const g = onceGirdisi({
    A: { goruntu_ok: true, goruntu: ['BOOT|b||', 'URUN|JBOSS8||'] },
    B: { goruntu_ok: false, goruntu: ['BOOT|b||'] },
    C: { goruntu_ok: true, goruntu: [] },
    D: { sonuc_yok: true },
    E: { goruntu_ok: true, goruntu: ['JBOSS8_JVM|x|1|1|was|d'] },
  });
  assert.deepEqual(Object.keys(g), ['A']);
});

// --- uc testi: sahte db + sahte launch
function sahteDb(satir) {
  const yaz = [];
  const p = require.resolve('../../db/index.cjs');
  const eski = require.cache[p];
  const m = new Module(p, null);
  m.loaded = true;
  m.exports = {
    query: async (sql, params) => {
      const t = String(sql).replace(/\s+/g, ' ');
      if (/^SELECT \* FROM reboot_checks WHERE id/.test(t.trim()))
        return { rows: satir ? [satir] : [] };
      yaz.push({ sql: t, params });
      return { rows: [{ id: 7 }] };
    },
  };
  require.cache[p] = m;
  return {
    yaz,
    geri: () => {
      if (eski) require.cache[p] = eski;
      else delete require.cache[p];
    },
  };
}
async function istek(router, yol, govde) {
  const app = express();
  app.use(express.json());
  app.use((req, _r, n) => {
    req.session = { user: { username: 'onur', role: 'Admin' } };
    n();
  });
  app.use('/x', router);
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/x${yol}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(govde),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    srv.close();
  }
}
function routerKur(launchlar) {
  const r = express.Router();
  delete require.cache[require.resolve('../reboot-check.cjs')];
  require('../reboot-check.cjs').mount(r, {
    HOST_RE: /^[A-Za-z0-9][A-Za-z0-9-]{1,62}$/,
    launch: async (_req, key, _ad, ev) => {
      launchlar.push({ key, ev });
      return { jobId: 55, awxServerId: 1 };
    },
  });
  return r;
}

test('RC3 reboot oncesi: target_hosts + rc_faz=once; kayit acilir', async () => {
  const d = sahteDb(null);
  try {
    const l = [];
    const r = await istek(routerKur(l), '/reboot-check', {
      hosts: ['gbjbop18', 'GBJBOP18', 'gbjboap18'],
    });
    assert.equal(r.status, 200);
    assert.deepEqual(l[0], {
      key: 'reboot_check',
      ev: { rc_faz: 'once', target_hosts: 'GBJBOP18,GBJBOAP18' },
    });
    assert.ok(d.yaz.some((y) => /INSERT INTO reboot_checks/.test(y.sql)));
    const bos = await istek(routerKur(l), '/reboot-check', { hosts: [] });
    assert.equal(bos.status, 400);
  } finally {
    d.geri();
  }
});

test('RC4 reboot sonrasi ONAYSIZ baslamaz', async () => {
  const d = sahteDb({
    id: 7,
    status: 'once_hazir',
    hosts_json: '["A"]',
    once_json: JSON.stringify({ sunucular: { A: { goruntu_ok: true, goruntu: ['BOOT|b||'] } } }),
  });
  try {
    const l = [];
    const r = await istek(routerKur(l), '/reboot-check/7/sonra', {});
    assert.equal(r.status, 400);
    assert.equal(l.length, 0, 'onaysiz is baslatildi');
  } finally {
    d.geri();
  }
});

test('RC5 reboot sonrasi: "once" goruntusu Portal\'dan rc_once ile gider; goruntusu olmayan sunucu hedeflenmez', async () => {
  const once = {
    sunucular: {
      A: { goruntu_ok: true, goruntu: ['BOOT|b||', 'JVM|JBOSS8|app|x'] },
      B: { goruntu_ok: false, goruntu: [] },
    },
  };
  const d = sahteDb({
    id: 7,
    status: 'once_hazir',
    hosts_json: '["A","B"]',
    once_json: JSON.stringify(once),
  });
  try {
    const l = [];
    const r = await istek(routerKur(l), '/reboot-check/7/sonra', { onay: true });
    assert.equal(r.status, 200);
    assert.deepEqual(l[0].ev, {
      rc_faz: 'sonra',
      target_hosts: 'A',
      rc_once: { A: ['BOOT|b||', 'JVM|JBOSS8|app|x'] },
    });
    assert.deepEqual(r.body.disarida, ['B']);
    const durum = await istek(routerKur(l), '/reboot-check/7/sonra', { onay: true });
    assert.equal(durum.status, 200);
  } finally {
    d.geri();
  }
});

function sahteModulEnjekte(yol, exp) {
  const p = require.resolve(yol);
  const eski = require.cache[p];
  const m = new Module(p, null);
  m.loaded = true;
  m.exports = exp;
  require.cache[p] = m;
  return () => {
    if (eski) require.cache[p] = eski;
    else delete require.cache[p];
  };
}

test('RC6 once job bitince sonuc kayda yazilir: goruntu alinan varsa once_hazir, hic yoksa once_hata', async () => {
  const sahte = sahteModulEnjekte;
  for (const [sunucular, beklenen] of [
    [{ A: { goruntu_ok: true, goruntu: ['BOOT|b||'] } }, 'once_hazir'],
    [{ A: { goruntu_ok: false, goruntu: [] } }, 'once_hata'],
    [{ A: { goruntu_ok: true, goruntu: ['JBOSS8_JVM|x|1|1|was|d'] } }, 'once_hata'],
  ]) {
    const d = sahteDb({
      id: 7,
      status: 'once_kosuyor',
      hosts_json: '["A"]',
      once_job_id: 55,
      once_server_id: 1,
    });
    const g1 = sahte('../../ansible/runner.cjs', {
      getJobStatusOnServer: async () => ({ status: 'successful', artifacts: {} }),
    });
    const g2 = sahte('../../opsx/index.cjs', {
      extractStatsKey: () => ({ faz: 'once', sunucular }),
    });
    try {
      const r = express.Router();
      delete require.cache[require.resolve('../reboot-check.cjs')];
      require('../reboot-check.cjs').mount(r, { HOST_RE: /.*/, launch: async () => ({}) });
      const app = express();
      app.use('/x', r);
      const srv = http.createServer(app);
      await new Promise((ok) => srv.listen(0, ok));
      try {
        await fetch(`http://127.0.0.1:${srv.address().port}/x/reboot-check/7`);
      } finally {
        srv.close();
      }
      const upd = d.yaz.find((y) => /^UPDATE reboot_checks SET status/.test(y.sql.trim()));
      assert.ok(upd, 'kayit guncellenmedi');
      assert.equal(upd.params[0], beklenen);
    } finally {
      g2();
      g1();
      d.geri();
    }
  }
});

test('RC7 is SURERKEN AWX anlik durumu ve faz baslangici doner; okunamazsa "okunamadi" (bitti SAYILMAZ)', async () => {
  // Kullanici (2026-10-09): "'Suruyor' kelimesi isin gercekten calisip calismadigini anlamaya yetmiyor"
  const sahte = sahteModulEnjekte;
  for (const [runner, beklenen] of [
    [{ getJobStatusOnServer: async () => ({ status: 'running' }) }, 'running'],
    [
      {
        getJobStatusOnServer: async () => {
          throw new Error('AWX yok');
        },
      },
      'okunamadi',
    ],
  ]) {
    const d = sahteDb({
      id: 7,
      status: 'sonra_kosuyor',
      hosts_json: '["A"]',
      sonra_job_id: 55,
      sonra_server_id: 1,
      updated_at: '2026-10-09T08:00:00Z',
    });
    const g1 = sahte('../../ansible/runner.cjs', runner);
    try {
      const r = express.Router();
      delete require.cache[require.resolve('../reboot-check.cjs')];
      require('../reboot-check.cjs').mount(r, { HOST_RE: /.*/, launch: async () => ({}) });
      const app = express();
      app.use('/x', r);
      const srv = http.createServer(app);
      await new Promise((ok) => srv.listen(0, ok));
      let body;
      try {
        body = await (
          await fetch(`http://127.0.0.1:${srv.address().port}/x/reboot-check/7`)
        ).json();
      } finally {
        srv.close();
      }
      assert.equal(body.kayit.durum, 'sonra_kosuyor');
      assert.equal(body.kayit.awxDurum, beklenen);
      assert.equal(body.kayit.fazBasladi, '2026-10-09T08:00:00Z');
      assert.ok(
        !d.yaz.some((y) => /^UPDATE reboot_checks SET status/.test(y.sql.trim())),
        'surerken kayit sonuclandirildi',
      );
    } finally {
      g1();
      d.geri();
    }
  }
});

test('RC8 KONTROL GEREKLI: once bos ya da "dokunulmadi" denen oge simdi calisiyorsa fark yok diye SORUNSUZ denmez', () => {
  // Uretim 2026-11-14: once goruntusunde urun yoktu, her sey "dokunulmadi" yazildi ve sunucu "Sorunsuz" cikti.
  const son = ['BOOT|b2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appA|x'];
  const d = sonraDegerlendir(
    {
      BOS: {
        once_var: true,
        son_olculdu: true,
        son_fark: [],
        son_goruntu: son,
        plan: ['BILGI|BOS|||bos'],
      },
      BOS2: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: son, plan: [] },
      // v4: bos once'de calisan urun KAPATILIR; kapatildiysa fark yok ama SORUNSUZ degil (kontrol edilecek)
      BOS3: {
        once_var: true,
        son_olculdu: true,
        son_fark: [],
        betik_surum: 4,
        goruntu: son,
        son_goruntu: ['BOOT|b2||'],
        plan: [],
        islemler: ['SONUC|durdur|JBOSS8||OK|x'],
      },
      NEW: {
        once_var: true,
        son_olculdu: true,
        son_fark: [],
        son_goruntu: son,
        plan: [
          'BILGI|NEW|JBOSS8||reboot oncesi calismiyordu, simdi calisiyor - dokunulmadi',
          'BILGI|NEW|JBOSS8|appA|reboot oncesi JBOSS8 hic calismiyordu - JVMlerine dokunulmadi',
        ],
      },
      KAPALI: {
        once_var: true,
        son_olculdu: true,
        son_fark: [],
        betik_surum: 4,
        son_goruntu: ['BOOT|b2||'],
        plan: ['BILGI|NEW|IHS||reboot oncesi calismiyordu, simdi calisiyor - dokunulmadi'],
      },
      TAMAM: {
        once_var: true,
        son_olculdu: true,
        son_fark: [],
        betik_surum: 4,
        son_goruntu: son,
        plan: ['ISLEM|was|baslat|JBOSS8|appA|x'],
      },
      SORUN: {
        once_var: true,
        son_olculdu: true,
        son_fark: ['FARK|DOWN|JVM|JBOSS8|appB|x'],
        son_goruntu: son,
        plan: ['BILGI|BOS|||bos'],
      },
    },
    ['BOS', 'BOS2', 'BOS3', 'NEW', 'KAPALI', 'TAMAM', 'SORUN'],
    { BOS2: ['BOOT|b1||'], BOS3: ['BOOT|b1||'], TAMAM: ['BOOT|b1||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appA|x'] },
  );
  assert.equal(d.BOS.durum, 'kontrol');
  // v4: bos once korumaz -> hala calisan JBoss 8 KALAN (sorunlu); sorunsuz da kontrol de denmez
  assert.equal(d.BOS2.durum, 'sorunlu', 'once bos iken hala calisan urun sorunsuz/kontrol denildi');
  assert.ok(d.BOS2.kalan > 0);
  assert.match(d.BOS2.bilgi.join(' '), /izlenen ürün\/JVM yoktu/);
  assert.equal(d.BOS3.durum, 'kontrol', 'once satirlarinda izlenen satir yokken kapatilan urun sorunsuz denildi');
  assert.match(d.BOS3.sebep, /JBoss 8 reboot öncesi çalışmıyordu, reboot sonrası çalışıyordu — otomasyon KAPATTI/);
  assert.match(d.BOS3.sebep, /izlenen ürün\/JVM yoktu/);
  assert.equal(d.NEW.durum, 'kontrol');
  // Once verilmeyen (eski cagiran) yol + ESKI betigin "dokunulmadi" notlari: yeni kurala gore kapatilmasi gerekirdi
  // (inceleme R2 #5; kapinin korudugu not 'kapatilmadi' icerir - RC16).
  // v3: betik_surum yok -> AWX'teki betik eski nedeni de yazilir (kesin dil); kapanmali nedeni yine var.
  assert.match(d.NEW.neden.join(' '), /2 öğe hâlâ çalışıyor; otomatik kapatılması gerekiyordu: JBOSS8, JBOSS8\/appA — AWX'teki betik eski/);
  assert.match(d.NEW.neden.join(' '), /reboot_check betiği eski \(sürüm yok, gerekli 4\)/);
  assert.equal(d.KAPALI.durum, 'sorunsuz', 'dokunulmayan ama simdi KAPALI oge kontrol sayildi');
  assert.equal(d.TAMAM.durum, 'sorunsuz');
  assert.equal(d.SORUN.durum, 'sorunlu', "fark kalan sunucu kontrol'e dusuruldu");
  assert.equal(kayitDurumu([d.TAMAM, d.BOS], true), 'kontrol');
  assert.equal(kayitDurumu([d.TAMAM, d.BOS, d.SORUN], true), 'sorunlu');
  assert.equal(kayitDurumu([d.TAMAM], true), 'tamam');
  assert.equal(
    kayitDurumu([d.TAMAM, { durum: 'olculemedi' }, d.BOS], true),
    'sorunlu',
    'olculemeyen varken kontrol denildi',
  );
  assert.equal(kayitDurumu([], false), 'sonra_hata');
  assert.ok(SONRA_ACIK.includes('kontrol'), "'kontrol' kaydinda sonra yeniden kosturulamiyor");
  // onceGirdisi bos once goruntusunu yine tasir (kontrol 'sonra'da yapilir; hedeften DUSURULMEZ)
  assert.deepEqual(onceGirdisi({ A: { goruntu_ok: true, goruntu: ['BOOT|b||'] } }), {
    A: ['BOOT|b||'],
  });
});

const sahteModul = (yol, exp) => {
  const p = require.resolve(yol);
  const eski = require.cache[p];
  const m = new Module(p, null);
  m.loaded = true;
  m.exports = exp;
  require.cache[p] = m;
  return () => {
    if (eski) require.cache[p] = eski;
    else delete require.cache[p];
  };
};
async function ilerletKos(satir, sonuc) {
  const d = sahteDb(satir);
  const g1 = sahteModul('../../ansible/runner.cjs', {
    getJobStatusOnServer: async () => ({ status: 'successful', artifacts: {} }),
  });
  const g2 = sahteModul('../../opsx/index.cjs', { extractStatsKey: () => sonuc });
  try {
    const r = express.Router();
    delete require.cache[require.resolve('../reboot-check.cjs')];
    require('../reboot-check.cjs').mount(r, { HOST_RE: /.*/, launch: async () => ({}) });
    const app = express();
    app.use('/x', r);
    const srv = http.createServer(app);
    await new Promise((ok) => srv.listen(0, ok));
    try {
      await fetch(`http://127.0.0.1:${srv.address().port}/x/reboot-check/7`);
    } finally {
      srv.close();
    }
    return d.yaz.find((y) => /^UPDATE reboot_checks SET status/.test(y.sql.trim()));
  } finally {
    g2();
    g1();
    d.geri();
  }
}

test('RC9 once bitince bos once goruntulu sunucular ozet.once.once_bos listesinde; kayit yine once_hazir', async () => {
  const sunucular = {
    A: { goruntu_ok: true, goruntu: ['BOOT|b||'] },
    B: { goruntu_ok: true, goruntu: ['BOOT|b||', 'URUN|NGINX||'] },
  };
  const upd = await ilerletKos(
    { id: 7, status: 'once_kosuyor', hosts_json: '["A","B"]', once_job_id: 55, once_server_id: 1 },
    { faz: 'once', sunucular },
  );
  assert.equal(upd.params[0], 'once_hazir');
  assert.deepEqual(JSON.parse(upd.params[2]).once.once_bos, ['A']);
});

test("RC10 sonra bitince: kontrol nedeni olan + sorunsuz -> kayit 'kontrol'; once satirlari once_json'dan gelir", async () => {
  const once = {
    sunucular: {
      A: { goruntu_ok: true, goruntu: ['BOOT|b||'] },
      B: { goruntu_ok: true, goruntu: ['BOOT|b||', 'URUN|NGINX||'] },
    },
  };
  const son = ['BOOT|c||', 'URUN|NGINX||'];
  const sunucular = {
    // v4: bos once'de her urun (CTG dahil) kapatilir; kapatilan CTG ile "kontrol" (hala calissaydi kalan olurdu).
    A: { once_var: true, son_olculdu: true, son_fark: [], goruntu: ['BOOT|c||', 'URUN|CTG||'], son_goruntu: ['BOOT|c||'], plan: [], islemler: ['SONUC|durdur|CTG||OK|x'], betik_surum: 4 },
    B: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: son, plan: [], betik_surum: 4 },
  };
  const upd = await ilerletKos(
    {
      id: 7,
      status: 'sonra_kosuyor',
      hosts_json: '["A","B"]',
      sonra_job_id: 55,
      sonra_server_id: 1,
      once_json: JSON.stringify(once),
      sonra_hedef_json: '["A","B"]',
    },
    { faz: 'sonra', sunucular },
  );
  assert.equal(upd.params[0], 'kontrol');
  const oz = JSON.parse(upd.params[2]).sonra;
  assert.deepEqual(
    [oz.sorunsuz, oz.kontrol, oz.toplam, oz.sunucu.A.durum, oz.sunucu.B.durum],
    [1, 1, 2, 'kontrol', 'sorunsuz'],
  );
});

test("RC11 'kontrol' kaydinda reboot sonrasi kontrol yeniden kosturulabilir", async () => {
  const once = { sunucular: { A: { goruntu_ok: true, goruntu: ['BOOT|b||', 'URUN|NGINX||'] } } };
  const d = sahteDb({
    id: 7,
    status: 'kontrol',
    hosts_json: '["A"]',
    once_json: JSON.stringify(once),
  });
  try {
    const l = [];
    const r = await istek(routerKur(l), '/reboot-check/7/sonra', { onay: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(l.length, 1);
  } finally {
    d.geri();
  }
});

test('RC12 kontrol nedeni once <-> son goruntuden: plandan SONRA kalkan yeni urun de "kontrol" yapar; once urunun yeni JVM\'i Portal kalaninda', () => {
  // Inceleme 2026-11-14 (B1): NGINX urun planindan sonra kalkti, plan BILGI satiri yok -> Portal "sorunsuz", rapor "Uyari" diyordu.
  const once = ['BOOT|b1||', 'SURUM|2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|app1|x'];
  const son = [
    ...once.filter((l) => !l.startsWith('BOOT')),
    'BOOT|b2||',
    'URUN|NGINX||',
    'URUN|WAS||',
    'JVM|WAS|s1|profil=p',
  ];
  const d = sonraDegerlendir(
    { A: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: son, plan: [] } },
    ['A'],
    { A: once },
  );
  // 2026-11-15 ("nasil bulduysan oyle birak"): once calismayan urun KAPATILIR; hala calisiyorsa KALAN (sorunlu).
  assert.deepEqual([d.A.durum, d.A.kalan], ['sorunlu', 2], JSON.stringify(d.A));
  assert.match(d.A.neden.join(' '), /3 öğe hâlâ çalışıyor; otomatik kapatılması gerekiyordu: NGINX, WAS, WAS\/s1/);
  assert.doesNotMatch(d.A.neden.join(' '), /dokunulmadı/, 'kapatilmasi gereken oge "dokunulmadi" diye anlatildi');
  const yeniJvm = sonraDegerlendir(
    {
      A: {
        once_var: true,
        son_olculdu: true,
        son_fark: [],
        son_goruntu: [...once, 'JVM|JBOSS8|app9|x'],
        plan: [],
      },
    },
    ['A'],
    { A: once },
  );
  assert.deepEqual(
    [yeniJvm.A.durum, yeniJvm.A.kalan],
    ['sorunlu', 1],
    "once calisan urunun fazladan JVM'i betik kalaninda yoksa gozden kacti",
  );
});

test("RC13 eski surum once (SURUM yok) + yeni son: JBoss satirlari cevrilir, sahte fark yok; JVM'siz JBoss 7 urunu belirsiz -> kontrol", () => {
  const once = [
    'BOOT|b1||',
    'URUN|JBOSS7||',
    'JVM|JBOSS7|app1|jboss_home=/vhosting8/jboss/AppServer',
  ];
  const son = [
    'BOOT|b2||',
    'SURUM|2||',
    'URUN|JBOSS8||',
    'JVM|JBOSS8|app1|jboss_home=/vhosting8/jboss/AppServer',
  ];
  for (const plan of [['BILGI|ESKI|||eski'], []]) {
    const d = sonraDegerlendir(
      { A: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: son, plan } },
      ['A'],
      { A: once },
    );
    assert.deepEqual([d.A.durum, d.A.kalan], ['kontrol', 0], JSON.stringify(d.A));
    assert.match(d.A.sebep, /eski betik sürümüyle/);
  }
});

test('RC13b eski surum once: cevrilen JBoss JVM farki Portal kalaninda; cevrilebilen once kontrol nedeni URETMEZ', () => {
  const { onceNesilCevir } = require('../reboot-check.cjs');
  const once = ['BOOT|b1||', 'URUN|JBOSS7||', 'JVM|JBOSS7|app1|jboss_home=/usr/jboss/AppServer', 'JVM|JBOSS7|app2|jboss_home=/usr/jboss/AppServer', 'JVM|JBOSS7|v8|jboss_home=/vhosting8/jboss/AppServer'];
  const son = ['BOOT|b2||', 'SURUM|2||', 'URUN|JBOSS7||', 'URUN|JBOSS8||', 'JVM|JBOSS7|app1|jboss_home=/usr/jboss/AppServer', 'JVM|JBOSS8|v8|jboss_home=/vhosting8/jboss/AppServer'];
  const c = onceNesilCevir(once, son);
  assert.equal(c.cevrildi, true);
  assert.deepEqual(c.belirsiz, []);
  assert.ok(c.satirlar.includes('JVM|JBOSS8|v8|jboss_home=/vhosting8/jboss/AppServer'));
  assert.deepEqual(onceNesilCevir(['SURUM|2||', ...once], son).satirlar, ['SURUM|2||', ...once], 'yeni surum once degistirildi');
  const d = sonraDegerlendir({ A: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: son, plan: ['BILGI|NESIL|||x'], betik_surum: 4 } }, ['A'], { A: once });
  assert.deepEqual([d.A.durum, d.A.kalan], ['sorunlu', 1], JSON.stringify(d.A));
  assert.equal(d.A.neden, undefined, 'cevrilebilen eski once kontrol nedeni uretti');
  // AWX'te ESKI betik (JBoss'a dokunmadi): fark Portal kalaninda gorunur ve yeniden calistirma soylenir.
  const e = sonraDegerlendir({ A: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: son, plan: ['BILGI|ESKI|||x'] } }, ['A'], { A: once });
  assert.equal(e.A.durum, 'sorunlu');
  assert.match(e.A.neden.join(' '), /yeniden çalıştırın/);
});

test('RC14 sonuclanmis eski kayit ayrintisi acilinca yeni kuralla yeniden degerlendirilir ve kayda yazilir', async () => {
  // Inceleme 2026-11-14 (B4): eski once'ta yalniz JVM satiri vardi, eski betik "dokunulmadi" dedi; rozet "Sorunsuz", tablo kirmizi.
  const once = {
    sunucular: { A: { goruntu_ok: true, goruntu: ['BOOT|b1||', 'JVM|JBOSS8|app1|x'] } },
  };
  const sonra = {
    sunucular: {
      A: {
        once_var: true,
        son_olculdu: true,
        son_fark: [],
        son_goruntu: ['BOOT|b2||'],
        plan: [
          'BILGI|DOWN|JBOSS8|app1|reboot oncesi JBOSS8 hic calismiyordu - JVMlerine dokunulmadi',
        ],
      },
    },
  };
  const eskiOzet = {
    sonra: {
      sorunsuz: 1,
      kontrol: 0,
      toplam: 1,
      job: 'successful',
      sunucu: { A: { durum: 'sorunsuz', kalan: 0, islem: 0, hatali: 0 } },
    },
  };
  const kos = async (satir) => {
    const d = sahteDb(satir);
    try {
      const r = express.Router();
      delete require.cache[require.resolve('../reboot-check.cjs')];
      require('../reboot-check.cjs').mount(r, { HOST_RE: /.*/, launch: async () => ({}) });
      const app = express();
      app.use('/x', r);
      const srv = http.createServer(app);
      await new Promise((ok) => srv.listen(0, ok));
      let body;
      try {
        body = await (
          await fetch(`http://127.0.0.1:${srv.address().port}/x/reboot-check/7`)
        ).json();
      } finally {
        srv.close();
      }
      return {
        body,
        upd: d.yaz.find((y) => /^UPDATE reboot_checks SET status/.test(y.sql.trim())),
      };
    } finally {
      d.geri();
    }
  };
  const satir = {
    id: 7,
    status: 'tamam',
    hosts_json: '["A"]',
    once_json: JSON.stringify(once),
    sonra_json: JSON.stringify(sonra),
    sonra_hedef_json: '["A"]',
    ozet_json: JSON.stringify(eskiOzet),
  };
  const { body, upd } = await kos(satir);
  assert.equal(body.kayit.durum, 'sorunlu');
  assert.equal(body.kayit.ozet.sonra.sunucu.A.kalan, 2);
  // v3: eski kayit yeniden hesaplanirken otomasyon ozeti de eklenir (eski API cevabinda yoktu).
  assert.deepEqual(body.kayit.ozet.sonra.sunucu.A.otomasyon.sinif, 'dokunmadi');
  assert.ok(upd, 'yeniden hesaplanan durum kayda yazilmadi');
  assert.deepEqual([upd.params[0], upd.params[3]], ['sorunlu', 'tamam']);
  // tutarli kayit: yazim yok
  const ikinci = await kos({
    ...satir,
    status: 'sorunlu',
    ozet_json: JSON.stringify({ sonra: body.kayit.ozet.sonra }),
  });
  assert.equal(ikinci.upd, undefined, 'degismeyen kayit yeniden yazildi');
});

test('RC15 2026-11-15 "nasil bulduysan oyle birak": hala calisan yeni URUN portalKalan\'da; kapatilan kontrol (v3); kapi (BOS / BELIRSIZ) korur', () => {
  const { portalKalan, kontrolNedenleri, kapatmaKapisi } = require('../reboot-check.cjs');
  const once = ['BOOT|b1||', 'SURUM|2||', 'URUN|RHA||'];
  const calisan = ['BOOT|b2||', 'SURUM|2||', 'URUN|RHA||', 'URUN|IHS||'];
  assert.deepEqual(portalKalan(once, calisan), ['FARK|NEW|URUN|IHS||']);
  const d = sonraDegerlendir(
    {
      KALDI: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: calisan, plan: ['ISLEM|www|durdur|IHS||'], islemler: ['SONUC|durdur|IHS||FAIL|x'], betik_surum: 4 },
      KAPANDI: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: once, plan: ['ISLEM|www|durdur|IHS||'], islemler: ['SONUC|durdur|IHS||OK|x'], betik_surum: 4 },
    },
    ['KALDI', 'KAPANDI'],
    { KALDI: once, KAPANDI: once },
  );
  assert.deepEqual([d.KALDI.durum, d.KALDI.kalan], ['sorunlu', 1]);
  assert.match(d.KALDI.neden.join(' '), /hâlâ çalışıyor; otomatik kapatılması gerekiyordu: IHS/);
  assert.doesNotMatch(d.KALDI.neden.join(' '), /dokunulmadı/);
  assert.doesNotMatch(d.KALDI.neden.join(' '), /otomasyon KAPATTI/, 'kapatilamayan urun "KAPATTI" diye yazildi');
  // v3 B2 ("kapatip, kontrol edilecek yaz"): kapatilan urun fark kalmasa da SORUNSUZ sayilmaz -> kontrol
  assert.equal(d.KAPANDI.durum, 'kontrol');
  assert.match(d.KAPANDI.sebep, /IBM HTTP Server \(IHS\) reboot öncesi çalışmıyordu, reboot sonrası çalışıyordu — otomasyon KAPATTI; beklenen durum mu kontrol edin\./);
  // KAPI 1 (v4, "Her yerde kapat"): bos once -> HER urun (web + CTG/JBoss/WAS) KAPATILIR; hala calisan kalan'da (sorunlu),
  // kapatilan "kontrol edilecek" (kontrol); bos kapida "dokunulmadi" nedeni URETILMEZ
  assert.equal(kapatmaKapisi(['BOOT|b1||']), 'bos');
  assert.deepEqual(portalKalan(['BOOT|b1||'], calisan), ['FARK|NEW|URUN|IHS||', 'FARK|NEW|URUN|RHA||']);
  const bos = sonraDegerlendir({ A: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: calisan, plan: [], betik_surum: 4 } }, ['A'], { A: ['BOOT|b1||'] });
  assert.deepEqual([bos.A.durum, bos.A.kalan], ['sorunlu', 2]);
  const bosCtg = ['BOOT|b2||', 'SURUM|2||', 'URUN|CTG||', 'URUN|WAS||'];
  assert.deepEqual(portalKalan(['BOOT|b1||'], bosCtg), ['FARK|NEW|URUN|CTG||', 'FARK|NEW|URUN|WAS||']);
  const bos2 = sonraDegerlendir({ A: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: bosCtg, plan: [], betik_surum: 4 } }, ['A'], { A: ['BOOT|b1||'] });
  assert.deepEqual([bos2.A.durum, bos2.A.kalan], ['sorunlu', 2]);
  assert.match(bos2.A.neden.join(' '), /2 öğe hâlâ çalışıyor; otomatik kapatılması gerekiyordu: CTG, WAS/);
  assert.doesNotMatch(bos2.A.neden.join(' '), /dokunulmadı/);
  const bos3 = sonraDegerlendir(
    { A: { once_var: true, son_olculdu: true, son_fark: [], goruntu: bosCtg, son_goruntu: ['BOOT|b2||', 'SURUM|2||'], plan: [], islemler: ['SONUC|durdur|CTG||OK|x', 'SONUC|durdur|WAS||OK|x'], betik_surum: 4 } },
    ['A'],
    { A: ['BOOT|b1||'] },
  );
  assert.deepEqual([bos3.A.durum, bos3.A.kalan], ['kontrol', 0]);
  assert.match(bos3.A.sebep, /CTG, WebSphere reboot öncesi çalışmıyordu, reboot sonrası çalışıyordu — otomasyon KAPATTI/);
  // KAPI 3: eski surum once, JVM'siz URUN|JBOSS7 belirsiz -> bugunku JBOSS8 kalan sayilmaz; JBoss disi yeni urun sayilir
  const eski = ['BOOT|b1||', 'URUN|JBOSS7||', 'URUN|NGINX||'];
  const s2 = ['BOOT|b2||', 'SURUM|2||', 'URUN|JBOSS8||', 'URUN|NGINX||', 'URUN|CTG||'];
  assert.deepEqual(portalKalan(eski, s2), ['FARK|NEW|URUN|CTG||']);
  const n = kontrolNedenleri(eski, { son_goruntu: s2, plan: [] }).join(' ');
  assert.match(n, /1 öğe şimdi çalışıyor ve dokunulmadı .*JBOSS8/);
  assert.match(n, /1 öğe hâlâ çalışıyor; otomatik kapatılması gerekiyordu: CTG/);
});

test('RC16 inceleme 2026-11-15: kapi yalniz ham once (eski surum -> JBoss korunur; BOOT yok -> bos); JVM\'den urun cikarimi; eski cagiran notlari', () => {
  const { portalKalan, kontrolNedenleri, kapatmaKapisi, sonKume } = require('../reboot-check.cjs');
  // R1 B1: eski surum once + son goruntude yalniz HC (JVM yok) -> JVM JBOSS7 kalir, belirsiz URETILMEZ; yine de JBOSS8 korunur
  const eski = ['BOOT|b1||', 'URUN|JBOSS7||', 'JVM|JBOSS7|srv1|jboss_home=/usr/jboss/AppServer'];
  const yalnizHc = ['BOOT|b2||', 'SURUM|2||', 'URUN|JBOSS8||', 'URUN|IHS||'];
  assert.equal(kapatmaKapisi(eski), 'eski');
  assert.ok(!portalKalan(eski, yalnizHc).includes('FARK|NEW|URUN|JBOSS8||'), 'eski surum once\'de JBOSS8 kalan sayildi');
  assert.ok(portalKalan(eski, yalnizHc).includes('FARK|NEW|URUN|IHS||'), 'JBoss disi yeni urun eski surumde de kapatilir');
  assert.match(kontrolNedenleri(eski, { son_goruntu: yalnizHc, plan: [] }).join(' '), /şimdi çalışıyor ve dokunulmadı .*JBOSS8/);
  assert.equal(kapatmaKapisi(['BOOT|b1||', 'SURUM|2||', 'URUN|JBOSS7||']), '');
  // R1 B5: BOOT'suz once -> 'bootsuz' (v3: 'bos'tan ayrildi; betik plan HATA, hicbir sey yapmaz, kalan saymaz)
  assert.equal(kapatmaKapisi(['URUN|RHA||']), 'bootsuz');
  assert.deepEqual(portalKalan(['URUN|RHA||'], ['BOOT|b2||', 'URUN|RHA||', 'URUN|NGINX||']), []);
  // R2 #2: urun satiri olmayip JVM'i calisan yeni urun calisiyor sayilir -> kalan; once calisan urunun DOWN'u degismez
  const once = ['BOOT|b1||', 'SURUM|2||', 'URUN|RHA||'];
  const jvmli = ['BOOT|b2||', 'SURUM|2||', 'URUN|RHA||', 'JVM|JBOSS8|app1|jboss_home=/usr/jboss8/AppServer'];
  assert.deepEqual(portalKalan(once, jvmli), ['FARK|NEW|URUN|JBOSS8||']);
  assert.ok(sonKume(jvmli, new Set(['RHA'])).urun.has('JBOSS8'));
  assert.ok(!sonKume(jvmli, new Set(['JBOSS8'])).urun.has('JBOSS8'));
  assert.deepEqual(portalKalan(['BOOT|b1||', 'SURUM|2||', 'URUN|RHA||', 'URUN|JBOSS8||', 'JVM|JBOSS8|app1|x'], ['BOOT|b2||', 'URUN|RHA||', 'JVM|JBOSS8|app1|x']), ['FARK|DOWN|URUN|JBOSS8||']);
  const dj = sonraDegerlendir({ A: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: jvmli, plan: [] } }, ['A'], { A: once });
  assert.equal(dj.A.durum, 'sorunlu', 'HC\'siz calisan yeni JBoss urunu sorunsuz/kontrol sayildi');
  // R2 #5: once verilmeyen yol - yeni betigin kapi notu ('kapatilmadi') korunan; ESKI betigin 'dokunulmadi' notu kapanmali
  const son = ['BOOT|b2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appA|x', 'URUN|IHS||'];
  const n = kontrolNedenleri(null, {
    son_goruntu: son,
    plan: [
      'BILGI|NEW|JBOSS8||reboot oncesi goruntu eski surum (JBoss nesli belirsiz olabilir) - kapatilmadi, dokunulmadi',
      'BILGI|NEW|JBOSS8|appA|reboot oncesi JBOSS8 hic calismiyordu - JVMlerine tek tek dokunulmadi (urun kapatilmadi: once goruntusu bos / eski surum)',
      'BILGI|NEW|IHS||reboot oncesi calismiyordu, simdi calisiyor - dokunulmadi',
    ],
  }).join(' ');
  assert.match(n, /2 öğe şimdi çalışıyor ve dokunulmadı \(plan notuna göre\): JBOSS8, JBOSS8\/appA/);
  assert.match(n, /1 öğe hâlâ çalışıyor; otomatik kapatılması gerekiyordu: IHS/);
});

// ---- v3 (2026-11-15 aksam, kullanici: "Nginx, apache, ihs urunlerini halen kapatmamissin kontrol edilecek yazmissin.
// Kapatip, kontrol edilecek yaz ... Otomasyon basarili ve basarisizi net ayirmiyor, dokunmayi da ayirmiyor") ----

test('RC17 v4 kapi: bos once HICBIR urunu KORUMAZ (web + CTG/JBoss/WAS kapatilir, prod dahil); BOOT\'suz once hepsini korur', () => {
  const { kapatmaKapisi, kapiKorur, portalKalan, kontrolNedenleri } = require('../reboot-check.cjs');
  const bos = ['BOOT|b1||'];
  assert.equal(kapatmaKapisi(bos), 'bos');
  for (const u of ['NGINX', 'RHA', 'IHS']) assert.equal(kapiKorur('bos', u), false, `${u} bos kapida korundu`);
  for (const u of ['CTG', 'JBOSS7', 'JBOSS8', 'WAS']) assert.equal(kapiKorur('bos', u), false, `${u} bos kapida korundu (v4: her yerde kapat)`);
  for (const u of ['NGINX', 'RHA', 'IHS', 'CTG', 'JBOSS7', 'JBOSS8', 'WAS']) assert.equal(kapiKorur('bootsuz', u), true);
  // 'eski' kapi degismedi: yalniz JBoss
  assert.deepEqual(['NGINX', 'CTG', 'JBOSS7', 'JBOSS8', 'WAS'].map((u) => kapiKorur('eski', u)), [false, false, true, true, false]);
  assert.equal(kapiKorur('', 'NGINX'), false);
  const son = ['BOOT|b2||', 'SURUM|2||', 'URUN|NGINX||', 'URUN|JBOSS8||', 'JVM|JBOSS8|a|x'];
  assert.deepEqual(portalKalan(bos, son), ['FARK|NEW|URUN|JBOSS8||', 'FARK|NEW|URUN|NGINX||']);
  // bos once metni (v4): calisan her urun kapatilir ve kontrol edilecek; "yalniz web" / "hicbir sey acilip kapatilmadi" DENMEZ
  const n = kontrolNedenleri(bos, { son_goruntu: ['BOOT|b2||'], plan: [], betik_surum: 4 }).join(' ');
  assert.match(n, /reboot sonrası çalışan her ürün \(Nginx\/Apache\/IHS\/CTG\/JBoss\/WAS\) reboot öncesi haline \(kapalı\) döndürülür ve kontrol edilecek/);
  assert.doesNotMatch(n, /yalnız web|dokunulmadı/);
  assert.doesNotMatch(n, /hiçbir şey açılıp kapatılmadı/);
  const p = kontrolNedenleri(null, { son_goruntu: ['BOOT|b2||'], plan: ['BILGI|BOS|||x'], betik_surum: 4 }).join(' ');
  assert.doesNotMatch(p, /hiçbir şey açılıp kapatılmadı/);
});

test('RC18 v3 B2: otomasyonun KAPATTIGI URUN sunucuyu kontrol yapar (fark kalmasa da); JVM durdurma ve kapanmayan urun bu nedeni uretmez', () => {
  const once = ['BOOT|b1||', 'SURUM|2||', 'URUN|RHA||', 'URUN|JBOSS8||', 'JVM|JBOSS8|a1|x'];
  const d = sonraDegerlendir(
    {
      WEB: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: once, betik_surum: 4, islemler: ['SONUC|durdur|NGINX||OK|x', 'SONUC|durdur|IHS||OK|x'] },
      JVM: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: once, betik_surum: 4, islemler: ['SONUC|durdur|JBOSS8|a2|OK|x'] },
      KALDI: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: [...once, 'URUN|CTG||'], betik_surum: 4, islemler: ['SONUC|durdur|CTG||OK|x'] },
      SKIP: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: once, betik_surum: 4, islemler: ['SONUC|durdur|NGINX||SKIP|zaten kapali'] },
    },
    ['WEB', 'JVM', 'KALDI', 'SKIP'],
    { WEB: once, JVM: once, KALDI: once, SKIP: once },
  );
  assert.equal(d.WEB.durum, 'kontrol');
  assert.deepEqual(d.WEB.neden, ['Nginx, IBM HTTP Server (IHS) reboot öncesi çalışmıyordu, reboot sonrası çalışıyordu — otomasyon KAPATTI; beklenen durum mu kontrol edin.']);
  assert.equal(d.JVM.durum, 'sorunsuz', 'fazla JVM kapatilmasi urun kapatma gibi kontrol sayildi');
  assert.equal(d.KALDI.durum, 'sorunlu');
  assert.doesNotMatch(d.KALDI.neden.join(' '), /KAPATTI/, 'hala calisan urun "KAPATTI" diye yazildi');
  assert.equal(d.SKIP.durum, 'sorunsuz', 'SKIP (komut gerekmedi) kapatma sayildi');
});

test('RC19 v4 B3 surum isareti: betik_surum yok / < 4 -> kontrol (kesin dil); >= 4 (sayi ya da metin) guncel', () => {
  const { betikSurumu, BETIK_SURUM_GEREKLI } = require('../reboot-check.cjs');
  assert.equal(BETIK_SURUM_GEREKLI, 4);
  assert.deepEqual(betikSurumu({}), { guncel: false, etiket: 'sürüm yok' });
  assert.deepEqual(betikSurumu({ betik_surum: 2 }), { guncel: false, etiket: 'sürüm 2' });
  // v4: surum 3 betik bos once'de CTG/JBoss/WAS'i korurdu -> artik eski
  assert.deepEqual(betikSurumu({ betik_surum: '3' }), { guncel: false, etiket: 'sürüm 3' });
  assert.deepEqual(betikSurumu({ betik_surum: 3 }), { guncel: false, etiket: 'sürüm 3' });
  assert.deepEqual(betikSurumu({ betik_surum: '4' }), { guncel: true, etiket: 'sürüm 4' });
  assert.deepEqual(betikSurumu({ betik_surum: 4 }), { guncel: true, etiket: 'sürüm 4' });
  assert.equal(betikSurumu({ betik_surum: 'x' }).guncel, false);
  assert.equal(betikSurumu({ betik_surum: '' }).guncel, false);
  const once = ['BOOT|b1||', 'SURUM|2||', 'URUN|RHA||'];
  const temiz = { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: once };
  const d = sonraDegerlendir(
    { YOK: { ...temiz }, IKI: { ...temiz, betik_surum: 2 }, UC: { ...temiz, betik_surum: 3 }, DORT: { ...temiz, betik_surum: 4 } },
    ['YOK', 'IKI', 'UC', 'DORT'],
    { YOK: once, IKI: once, UC: once, DORT: once },
  );
  assert.equal(d.YOK.durum, 'kontrol');
  assert.match(d.YOK.sebep, /^AWX'teki reboot_check betiği eski \(sürüm yok, gerekli 4\): bu koşuda ürün kapatma ve yeniden deneme YOKTU\. ZIP'i AWX'e yükleyip projeyi Sync edin/);
  assert.match(d.IKI.sebep, /\(sürüm 2, gerekli 4\)/);
  assert.equal(d.UC.durum, 'kontrol');
  assert.match(d.UC.sebep, /\(sürüm 3, gerekli 4\): bu koşudaki betik \(sürüm 3\) ürün kapatıp yeniden deniyordu, ancak reboot öncesi görüntüsü boş sunucuda yalnız web ürünlerini/);
  // inceleme B1: surum 3'e "kapatma ve yeniden deneme YOKTU" denmez (v3'te ikisi de vardi)
  assert.doesNotMatch(d.UC.sebep, /YOKTU/);
  assert.equal(d.DORT.durum, 'sorunsuz');
  // surum biliniyorken "eski betik olabilir" / "eski betikle degerlendirildiyse" gibi belirsiz cumle yok
  const kalan = sonraDegerlendir({ A: { ...temiz, betik_surum: 4, son_goruntu: [...once, 'URUN|IHS||'] } }, ['A'], { A: once });
  assert.equal(kalan.A.durum, 'sorunlu');
  assert.doesNotMatch(kalan.A.neden.join(' '), /eski|olabilir/);
  assert.match(kalan.A.neden.join(' '), /kapatma sonucunu kontrol edin\.$/);
});

test('RC20 v3 B4 otomasyonOzeti: basarili / basarisiz / dokunmadi karsilikli dislayici; teknoloji satirlari calistirildi / calistirilmadi nedeniyle', () => {
  const { otomasyonOzeti } = require('../reboot-check.cjs');
  const once = ['BOOT|b1||', 'SURUM|2||', 'URUN|NGINX||', 'URUN|JBOSS8||', 'JVM|JBOSS8|a1|x', 'JVM|JBOSS8|a2|x', 'JVM|JBOSS8|a3|x', 'JVM|JBOSS8|a4|x', 'URUN|RHA||'];
  const ilk = ['BOOT|b2||', 'SURUM|2||', 'URUN|JBOSS8||', 'URUN|RHA||', 'URUN|IHS||'];
  const son = ['BOOT|b2||', 'SURUM|2||', 'URUN|NGINX||', 'URUN|JBOSS8||', 'JVM|JBOSS8|a1|x', 'JVM|JBOSS8|a2|x', 'JVM|JBOSS8|a3|x', 'URUN|RHA||'];
  const r = {
    son_olculdu: true, goruntu: ilk, son_goruntu: son, betik_surum: 4,
    islemler: [
      'SONUC|baslat|NGINX||OK|startNginx ile baslatildi (2. denemede, 150 sn)',
      'SONUC|baslat|JBOSS8|a1|OK|x', 'SONUC|baslat|JBOSS8|a2|OK|x', 'SONUC|baslat|JBOSS8|a3|OK|x', 'SONUC|baslat|JBOSS8|a4|FAIL|x',
      'SONUC|durdur|IHS||OK|x',
    ],
  };
  const oz = otomasyonOzeti(once, r);
  assert.equal(oz.sinif, 'basarisiz');
  const by = Object.fromEntries(oz.teknoloji.map((t) => [t.urun, t]));
  assert.deepEqual(oz.teknoloji.map((t) => t.urun), ['NGINX', 'RHA', 'IHS', 'JBOSS8']);
  assert.deepEqual(by.NGINX, { urun: 'NGINX', ad: 'Nginx', calistirildi: true, ozet: 'açıldı ✓ (2. denemede)', sonuc: 'ok' });
  assert.deepEqual([by.JBOSS8.ozet, by.JBOSS8.sonuc], ['3 JVM açıldı ✓, 1 JVM açılamadı ✗', 'hata']);
  assert.deepEqual([by.IHS.ozet, by.IHS.sonuc, by.IHS.calistirildi], ['kapatıldı ✓', 'ok', true]);
  assert.deepEqual([by.RHA.calistirildi, by.RHA.ozet, by.RHA.sonuc], [false, 'değişiklik yok', 'yok']);
  // basarili: hepsi OK ve hedefte; 1. denemede acilan urunde "denemede" yazilmaz
  const ok = otomasyonOzeti(once, { ...r, islemler: ['SONUC|baslat|NGINX||OK|ile baslatildi (1. denemede, 20 sn)', 'SONUC|durdur|IHS||OK|x', 'SONUC|baslat|RHA||SKIP|zaten'] });
  assert.equal(ok.sinif, 'basarili');
  assert.equal(ok.teknoloji.find((t) => t.urun === 'NGINX').ozet, 'açıldı ✓');
  assert.equal(ok.teknoloji.find((t) => t.urun === 'RHA').ozet, 'zaten doğru durumdaydı (komut gerekmedi)');
  // OK ama son goruntude hedefte degil -> basarisiz ("kapatilamadi")
  const yalanci = otomasyonOzeti(once, { ...r, son_goruntu: [...son, 'URUN|IHS||'], islemler: ['SONUC|durdur|IHS||OK|x'] });
  assert.equal(yalanci.sinif, 'basarisiz');
  assert.deepEqual([yalanci.teknoloji.find((t) => t.urun === 'IHS').ozet, yalanci.teknoloji.find((t) => t.urun === 'IHS').sonuc], ['kapatılamadı ✗', 'hata']);
  // urun durdur: JVM'i hala calisiyorsa hedefte degil
  const jvmKaldi = otomasyonOzeti(['BOOT|b1||', 'SURUM|2||', 'URUN|RHA||'], { son_olculdu: true, goruntu: [], son_goruntu: ['BOOT|b2||', 'URUN|RHA||', 'JVM|JBOSS8|z|x'], betik_surum: 4, islemler: ['SONUC|durdur|JBOSS8||OK|x'] });
  assert.equal(jvmKaldi.sinif, 'basarisiz');
  // son olculemedi -> komut kostuysa basarisiz; tum teknolojiler "son durum olculemedi" ya da komut sonucu
  const olcmedi = otomasyonOzeti(once, { ...r, son_olculdu: false, islemler: ['SONUC|baslat|NGINX||OK|x'] });
  assert.equal(olcmedi.sinif, 'basarisiz');
  assert.equal(olcmedi.teknoloji.find((t) => t.urun === 'RHA').ozet, 'son durum ölçülemedi');
  // inceleme F2: komut OK ama son goruntu yok -> "acilamadi" denmez, dogrulanamadi (hata sinifinda kalir)
  assert.deepEqual(olcmedi.teknoloji.find((t) => t.urun === 'NGINX'), { urun: 'NGINX', ad: 'Nginx', calistirildi: true, ozet: 'açma komutu OK — son durum ölçülemedi ✗', sonuc: 'hata' });
  // dokunmadi: yalniz SKIP / hic komut
  assert.equal(otomasyonOzeti(once, { ...r, islemler: ['SONUC|baslat|NGINX||SKIP|x'] }).sinif, 'dokunmadi');
  assert.equal(otomasyonOzeti(once, { ...r, islemler: [] }).sinif, 'dokunmadi');
  // calistirilmama nedenleri: bos once (v4: KORUNMAZ - komutsuz kalan CTG "fark kaldi"), eski surum once (JBoss), eski betik,
  // kendiliginden duzeldi
  const bos = otomasyonOzeti(['BOOT|b1||'], { son_olculdu: true, goruntu: [], son_goruntu: ['BOOT|b2||', 'URUN|CTG||'], betik_surum: 4, islemler: [] });
  assert.deepEqual(bos.teknoloji, [{ urun: 'CTG', ad: 'CTG', calistirildi: false, ozet: 'komut çalışmadı — fark kaldı', sonuc: 'yok' }]);
  const bosK = otomasyonOzeti(['BOOT|b1||'], { son_olculdu: true, goruntu: ['BOOT|b2||', 'URUN|CTG||'], son_goruntu: ['BOOT|b2||'], betik_surum: 4, islemler: ['SONUC|durdur|CTG||OK|x'] });
  assert.equal(bosK.sinif, 'basarili');
  assert.deepEqual(bosK.teknoloji, [{ urun: 'CTG', ad: 'CTG', calistirildi: true, ozet: 'kapatıldı ✓', sonuc: 'ok' }]);
  const eski = otomasyonOzeti(['BOOT|b1||', 'URUN|JBOSS7||', 'JVM|JBOSS7|s1|jboss_home=/usr/jboss/AppServer'], { son_olculdu: true, goruntu: [], son_goruntu: ['BOOT|b2||', 'SURUM|2||', 'URUN|JBOSS8||'], betik_surum: 4, islemler: [] });
  assert.equal(eski.teknoloji.find((t) => t.urun === 'JBOSS8').ozet, 'eski sürüm önce — JBoss dokunulmadı');
  const eb = otomasyonOzeti(['BOOT|b1||', 'SURUM|2||', 'URUN|RHA||'], { son_olculdu: true, goruntu: [], son_goruntu: ['BOOT|b2||', 'URUN|RHA||', 'URUN|IHS||'], islemler: [] });
  assert.equal(eb.teknoloji.find((t) => t.urun === 'IHS').ozet, "AWX'teki betik eski — işlem yapılmadı");
  const gc = otomasyonOzeti(['BOOT|b1||', 'SURUM|2||', 'URUN|RHA||'], { son_olculdu: true, goruntu: [], son_goruntu: ['BOOT|b2||', 'URUN|RHA||', 'URUN|IHS||'], betik_surum: 4, islemler: [] });
  assert.equal(gc.teknoloji.find((t) => t.urun === 'IHS').ozet, 'komut çalışmadı — fark kaldı');
  const kd = otomasyonOzeti(['BOOT|b1||', 'SURUM|2||', 'URUN|RHA||'], { son_olculdu: true, goruntu: ['BOOT|b2||'], son_goruntu: ['BOOT|b2||', 'URUN|RHA||'], betik_surum: 4, islemler: [] });
  assert.equal(kd.teknoloji[0].ozet, 'kendiliğinden düzeldi (komut gerekmedi)');
});

test('RC21 v3 B4 sonraDegerlendir her sunucuya otomasyon koyar (olculemeyen dahil); siniflarin toplami sunucu sayisi', () => {
  const once = ['BOOT|b1||', 'SURUM|2||', 'URUN|NGINX||'];
  const son = ['BOOT|b2||', 'SURUM|2||', 'URUN|NGINX||'];
  const d = sonraDegerlendir(
    {
      OK: { once_var: true, son_olculdu: true, son_fark: [], goruntu: ['BOOT|b2||'], son_goruntu: son, betik_surum: 4, islemler: ['SONUC|baslat|NGINX||OK|x'] },
      HATA: { once_var: true, son_olculdu: true, son_fark: [], goruntu: ['BOOT|b2||'], son_goruntu: ['BOOT|b2||'], betik_surum: 4, islemler: ['SONUC|baslat|NGINX||FAIL|x'] },
      YOK: { once_var: true, son_olculdu: true, son_fark: [], goruntu: son, son_goruntu: son, betik_surum: 4, islemler: [] },
      OLCMEDI: { once_var: true, son_olculdu: false, goruntu: ['BOOT|b2||'], betik_surum: 4, islemler: ['SONUC|baslat|NGINX||OK|x'] },
      ONCESIZ: { once_var: false, son_olculdu: true, betik_surum: 4, islemler: [] },
      GELMEDI: { sonuc_yok: true },
    },
    ['OK', 'HATA', 'YOK', 'OLCMEDI', 'ONCESIZ', 'GELMEDI', 'HIC'],
    { OK: once, HATA: once, YOK: once, OLCMEDI: once },
  );
  const sinif = Object.fromEntries(Object.entries(d).map(([h, x]) => [h, x.otomasyon?.sinif]));
  assert.deepEqual(sinif, { OK: 'basarili', HATA: 'basarisiz', YOK: 'dokunmadi', OLCMEDI: 'basarisiz', ONCESIZ: 'dokunmadi', GELMEDI: 'basarisiz', HIC: 'basarisiz' });
  // inceleme F3: sonuc gelmeyen sunucu "dokunmadi" sayilmaz (komut kosmus olabilir); nedeni yazilir
  assert.deepEqual(d.GELMEDI.otomasyon, { sinif: 'basarisiz', teknoloji: [], not: 'sunucudan sonuç gelmedi — otomasyonun ne yaptığı bilinmiyor (doğrulanamadı)' });
  assert.deepEqual([d.OK.durum, d.HATA.durum, d.YOK.durum, d.OLCMEDI.durum], ['sorunsuz', 'sorunlu', 'sorunsuz', 'olculemedi']);
  assert.deepEqual(d.YOK.otomasyon.teknoloji, [{ urun: 'NGINX', ad: 'Nginx', calistirildi: false, ozet: 'değişiklik yok', sonuc: 'yok' }]);
});

test('RC22 inceleme F2/F4/F5: JVM komutu OK ama olculemedi; BOOT\'suz once / plan HATA nedeni; SKIP mesaji gorunur', () => {
  const { otomasyonOzeti } = require('../reboot-check.cjs');
  const once = ['BOOT|b1||', 'SURUM|2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|a1|x', 'JVM|JBOSS8|a2|x'];
  const jv = otomasyonOzeti(once, {
    son_olculdu: false, goruntu: ['BOOT|b2||', 'URUN|JBOSS8||'], betik_surum: 4,
    islemler: ['SONUC|baslat|JBOSS8|a1|OK|x', 'SONUC|baslat|JBOSS8|a2|FAIL|x', 'SONUC|durdur|JBOSS8|z|OK|x'],
  });
  assert.equal(jv.sinif, 'basarisiz');
  assert.deepEqual([jv.teknoloji[0].ozet, jv.teknoloji[0].sonuc], ['1 JVM açma komutu OK — son durum ölçülemedi ✗, 1 JVM açılamadı ✗, 1 JVM kapatma komutu OK — son durum ölçülemedi ✗', 'hata']);
  const son = { son_olculdu: true, goruntu: [], son_goruntu: ['BOOT|b2||', 'URUN|RHA||'], betik_surum: 4, islemler: [] };
  // F4: BOOT'suz once -> plan HATA, islem yapilmadi ("komut calismadi" denmez)
  assert.equal(otomasyonOzeti(['URUN|RHA||'], son).teknoloji[0].ozet, 'önce görüntüsü eski biçimde / BOOT yok — işlem yapılmadı');
  assert.equal(otomasyonOzeti(['BOOT|b1||', 'SURUM|2||', 'URUN|NGINX||'], { ...son, plan: ['BILGI|HATA|||gecici dosya acilamadi - islem yapilmadi'] }).teknoloji.find((t) => t.urun === 'RHA').ozet, 'plan hata verdi — işlem yapılmadı');
  // F5: SKIP sonrasi fark kaldi -> betigin SKIP nedeni gorunur
  const sk = otomasyonOzeti(['BOOT|b1||', 'SURUM|2||', 'URUN|NGINX||'], { son_olculdu: true, goruntu: [], son_goruntu: ['BOOT|b2||', 'SURUM|2||'], betik_surum: 4, islemler: ['SONUC|baslat|NGINX||SKIP|zaten baslatiliyordu'] });
  assert.equal(sk.sinif, 'dokunmadi');
  assert.equal(sk.teknoloji[0].ozet, 'komut koşulmadı (betik: zaten baslatiliyordu) — fark kaldı');
});

// ---- v4 (2026-11-16, rapor yoneticiye gidiyor: "once goruntusu bos satirlari uyari degil farkli yansitilsin; Otomasyon Basarili
// ile Otomatik Duzeltme sayilari eslesmiyor; %'sel executive summary") ----

const BOS_ONCE = ['BOOT|b1||'];
const bosR = (ek = {}) => ({ once_var: true, son_olculdu: true, son_fark: [], goruntu: ['BOOT|b2||'], son_goruntu: ['BOOT|b2||'], betik_surum: 4, islemler: [], plan: [], ...ek });

test('RC23 v4 kapsam_disi YALNIZ tek neden once-bos iken; baska neden (web kapatildi / reboot dogrulanamadi / eski betik) kazanir; fark kalirsa sorunlu', () => {
  const { KAPSAM_DISI_ACIKLAMA, kontrolNedenAyrimi, rebootDogrulanamadi } = require('../reboot-check.cjs');
  const d = sonraDegerlendir(
    {
      TEMIZ: bosR(),
      WEB: bosR({ goruntu: ['BOOT|b2||', 'URUN|NGINX||'], islemler: ['SONUC|durdur|NGINX||OK|x'] }),
      AYNI: bosR({ goruntu: ['BOOT|b1||'] }),
      ESKI: bosR({ betik_surum: undefined }),
      KALDI: bosR({ son_goruntu: ['BOOT|b2||', 'URUN|NGINX||'] }),
      // v4: bos once CTG'yi korumaz -> komutsuz kalan CTG sorunlu; kapatilan CTG kontrol
      CTG: bosR({ son_goruntu: ['BOOT|b2||', 'URUN|CTG||'] }),
      CTGK: bosR({ goruntu: ['BOOT|b2||', 'URUN|CTG||'], islemler: ['SONUC|durdur|CTG||OK|x'] }),
      DOLU: bosR({ goruntu: ['BOOT|b2||', 'URUN|RHA||'], son_goruntu: ['BOOT|b2||', 'URUN|RHA||'] }),
    },
    ['TEMIZ', 'WEB', 'AYNI', 'ESKI', 'KALDI', 'CTG', 'CTGK', 'DOLU'],
    { TEMIZ: BOS_ONCE, WEB: BOS_ONCE, AYNI: BOS_ONCE, ESKI: BOS_ONCE, KALDI: BOS_ONCE, CTG: BOS_ONCE, CTGK: BOS_ONCE, DOLU: ['BOOT|b1||', 'URUN|RHA||'] },
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(d).map(([h, x]) => [h, x.durum])),
    { TEMIZ: 'kapsam_disi', WEB: 'kontrol', AYNI: 'kontrol', ESKI: 'kontrol', KALDI: 'sorunlu', CTG: 'sorunlu', CTGK: 'kontrol', DOLU: 'sorunsuz' },
  );
  assert.match(d.CTGK.sebep, /CTG reboot öncesi çalışmıyordu, reboot sonrası çalışıyordu — otomasyon KAPATTI/);
  // kapsam disi: uyari nedeni YOK, aciklama notr; once-bos metni bilgi notu
  assert.equal(d.TEMIZ.neden, undefined, 'kapsam disi sunucuda uyari nedeni yazildi');
  assert.equal(d.TEMIZ.sebep, KAPSAM_DISI_ACIKLAMA);
  assert.match(KAPSAM_DISI_ACIKLAMA, /izlenen uygulama \(Nginx\/Apache\/IHS\/CTG\/JBoss\/WAS\) çalışmıyordu; karşılaştırılacak bir şey yoktu/);
  assert.equal(d.TEMIZ.bilgi.length, 1);
  // web kapatildi: KAPATTI nedeni kazanir; once-bos bilgi olarak eslik eder (neden'de degil), sebep ikisini de soyler
  assert.deepEqual(d.WEB.neden, ['Nginx reboot öncesi çalışmıyordu, reboot sonrası çalışıyordu — otomasyon KAPATTI; beklenen durum mu kontrol edin.']);
  assert.match(d.WEB.bilgi[0], /izlenen ürün\/JVM yoktu/);
  assert.match(d.WEB.sebep, /otomasyon KAPATTI.*izlenen ürün\/JVM yoktu/);
  // reboot dogrulanamadi (boot ayni) -> hicbir sey dogrulanmadi, kontrol
  assert.match(d.AYNI.neden.join(' '), /reboot doğrulanamadı/);
  assert.equal(rebootDogrulanamadi(BOS_ONCE, { goruntu: ['BOOT|b1||'] }), true);
  assert.equal(rebootDogrulanamadi(BOS_ONCE, { goruntu: ['BOOT|b2||'] }), false);
  assert.equal(rebootDogrulanamadi(['BOOT|bilinmiyor||'], { goruntu: ['BOOT|bilinmiyor||'] }), false);
  assert.equal(rebootDogrulanamadi(BOS_ONCE, { goruntu: [] }), false);
  // dolu once'de boot ayni olmasi (v3 gibi) kontrol nedeni DEGIL; yalniz kapsam disi karari icin bakilir
  const doluAyni = sonraDegerlendir({ A: bosR({ goruntu: ['BOOT|b1||', 'URUN|RHA||'], son_goruntu: ['BOOT|b1||', 'URUN|RHA||'] }) }, ['A'], { A: ['BOOT|b1||', 'URUN|RHA||'] });
  assert.equal(doluAyni.A.durum, 'sorunsuz');
  // ayrim: once-bos ayri doner; kontrolNedenleri eski bicimde (once-bos ilk sirada)
  assert.deepEqual(kontrolNedenAyrimi(BOS_ONCE, bosR()), { onceBos: true, neden: [] });
  assert.equal(kontrolNedenAyrimi(['BOOT|b1||', 'URUN|RHA||'], bosR({ son_goruntu: ['BOOT|b2||', 'URUN|RHA||'] })).onceBos, false);
  assert.equal(kontrolNedenAyrimi(null, bosR({ plan: ['BILGI|BOS|||x'] })).onceBos, true);
});

test('RC24 v4 kayitDurumu: tumu kapsam_disi -> kontrol (hicbir sey dogrulanmadi); sorunsuz + kapsam_disi -> tamam; + kontrol -> kontrol', () => {
  const S = { durum: 'sorunsuz' };
  const K = { durum: 'kapsam_disi' };
  const C = { durum: 'kontrol' };
  assert.equal(kayitDurumu([K], true), 'kontrol');
  assert.equal(kayitDurumu([K, K], true), 'kontrol');
  assert.equal(kayitDurumu([S, K], true), 'tamam');
  assert.equal(kayitDurumu([S, K, C], true), 'kontrol');
  assert.equal(kayitDurumu([K, C], true), 'kontrol');
  assert.equal(kayitDurumu([S, K, { durum: 'olculemedi' }], true), 'sorunlu');
  assert.equal(kayitDurumu([K, { durum: 'sorunlu' }], true), 'sorunlu');
  assert.equal(kayitDurumu([K], false), 'kontrol');
  assert.equal(kayitDurumu([], true), 'sorunlu');
});

test('RC25 v4 komut koprusu: Otomatik Duzeltme KOMUT, Otomasyon Ozeti SUNUCU sayar; "OK ama hedefte degil" ayni hedef kuraliyla', () => {
  const { komutSayaci, komutKoprusu, otomasyonOzeti } = require('../reboot-check.cjs');
  const once = ['BOOT|b1||', 'SURUM|2||', 'URUN|NGINX||', 'URUN|RHA||'];
  const A = {
    once_var: true, son_olculdu: true, son_fark: [], betik_surum: 4,
    goruntu: ['BOOT|b2||', 'SURUM|2||', 'URUN|RHA||', 'URUN|IHS||'],
    son_goruntu: ['BOOT|b2||', 'SURUM|2||', 'URUN|NGINX||', 'URUN|RHA||', 'URUN|IHS||'],
    islemler: ['SONUC|baslat|NGINX||OK|x', 'SONUC|durdur|IHS||OK|x', 'SONUC|baslat|RHA||SKIP|zaten', 'SONUC|durdur|CTG||FAIL|x'],
  };
  const B = { ...A, goruntu: ['BOOT|b2||', 'SURUM|2||', 'URUN|RHA||'], son_goruntu: ['BOOT|b2||', 'SURUM|2||', 'URUN|NGINX||', 'URUN|RHA||'], islemler: ['SONUC|baslat|NGINX||OK|x'] };
  assert.deepEqual(komutSayaci(once, A), { ok: 2, fail: 1, skip: 1, okHedefteDegil: 1, okOlculemedi: 0 });
  assert.deepEqual(komutSayaci(once, B), { ok: 1, fail: 0, skip: 0, okHedefteDegil: 0, okOlculemedi: 0 });
  // son olculemedi: OK komut basarili sayilmaz (otomasyonOzeti 'olcmedi' -> basarisiz ile ayni) AMA "hedefte degil" de denmez;
  // inceleme Y3 (tanim degisikligi): ayri okOlculemedi sayaci (dogrulanamadi).
  assert.deepEqual(komutSayaci(once, { ...B, son_olculdu: false }), { ok: 1, fail: 0, skip: 0, okHedefteDegil: 0, okOlculemedi: 1 });
  assert.equal(otomasyonOzeti(once, { ...B, son_olculdu: false }).sinif, 'basarisiz');
  const ko = komutKoprusu({ B, U: { ...B, son_olculdu: false } }, ['B', 'U'], { B: once, U: once });
  assert.deepEqual([ko.ok, ko.okHedefteDegil, ko.okOlculemedi, ko.basarili], [2, 0, 1, 1]);
  assert.equal(otomasyonOzeti(once, A).sinif, 'basarisiz');
  assert.equal(otomasyonOzeti(once, B).sinif, 'basarili');
  const k = komutKoprusu({ A, B, C: { sonuc_yok: true } }, ['A', 'B', 'C', 'YOK'], { A: once, B: once });
  assert.deepEqual(k, { ok: 3, fail: 1, skip: 1, okHedefteDegil: 1, okOlculemedi: 0, sunucu: 2, komut: 5, basarili: 2 });
});

test('RC26 v4 yoneticiOzeti: yuzdeler ve paydalar (sunucu / oge / otomasyon / ilk sapma); Turkce yuzde; payda 0 -> "—"', () => {
  const { yoneticiOzeti, yuzdeMetni, sonraOzeti } = require('../reboot-check.cjs');
  assert.deepEqual(
    [yuzdeMetni(25, 27), yuzdeMetni(13, 14), yuzdeMetni(1, 1), yuzdeMetni(0, 0), yuzdeMetni(1, 3), yuzdeMetni(0, 5), yuzdeMetni(7, 8), yuzdeMetni(1999, 2000), yuzdeMetni(1, 5000), yuzdeMetni(2000, 2000)],
    ['%92,6', '%92,9', '%100', '—', '%33,3', '%0', '%87,5', '%99,9', '%0,1', '%100'],
  );
  const v = ['BOOT|b2||', 'SURUM|2||'];
  const onceA = ['BOOT|b1||', 'SURUM|2||', 'URUN|NGINX||', 'URUN|JBOSS8||', 'JVM|JBOSS8|a1|x', 'JVM|JBOSS8|a2|x'];
  const onceR = ['BOOT|b1||', 'SURUM|2||', 'URUN|RHA||'];
  const r = (goruntu, sonGoruntu, islemler) => ({ once_var: true, son_olculdu: true, son_fark: [], betik_surum: 4, goruntu, son_goruntu: sonGoruntu, islemler, plan: [] });
  const sunucular = {
    // A: NGINX ve a2 ilkte kapali; NGINX otomasyonla, a2 kendiliginden (SKIP) duzeldi -> sorunsuz
    A: r([...v, 'URUN|JBOSS8||', 'JVM|JBOSS8|a1|x'], [...v, 'URUN|NGINX||', 'URUN|JBOSS8||', 'JVM|JBOSS8|a1|x', 'JVM|JBOSS8|a2|x'], ['SONUC|baslat|NGINX||OK|x', 'SONUC|baslat|JBOSS8|a2|SKIP|x']),
    // B: IHS fazladan; kapatma FAIL, hala calisiyor -> sorunlu
    B: r([...v, 'URUN|RHA||', 'URUN|IHS||'], [...v, 'URUN|RHA||', 'URUN|IHS||'], ['SONUC|durdur|IHS||FAIL|x']),
    // C: once bos, temiz -> kapsam disi
    C: r(['BOOT|b2||'], ['BOOT|b2||'], []),
    D: { sonuc_yok: true },
    // E: NGINX fazladan; otomasyon kapatti -> kontrol notlu ama reboot oncesi haline dondu -> BIRAKILAN (inceleme Y7)
    E: r([...v, 'URUN|RHA||', 'URUN|NGINX||'], [...v, 'URUN|RHA||'], ['SONUC|durdur|NGINX||OK|x']),
  };
  const onceSat = { A: onceA, B: onceR, C: ['BOOT|b1||'], D: onceR, E: onceR };
  const hedef = ['A', 'B', 'C', 'D', 'E'];
  const y = yoneticiOzeti(sunucular, hedef, onceSat);
  assert.deepEqual(y.sunucu, { toplam: 5, olculen: 4, olculemeyen: 1, onceYok: 0, onceBos: 1, onceBosDiger: 0, onceBosKontrol: 0, onceBosSorunlu: 0, karsilastirilabilir: 3, sorunsuz: 1, kontrol: 1, sorunlu: 1, birakilan: 2, birakilanKontrolNotlu: 1, kontrolBekleyen: 0 });
  assert.deepEqual(y.oge, { once: 6, hedef: 8, dogru: 7, ilkSapan: 4, ilkDown: 2, ilkNew: 2, otomatik: 2, kendiliginden: 1, halaSapan: 1, korunan: 0 });
  assert.deepEqual(y.komut, { ok: 2, fail: 1, skip: 1, okHedefteDegil: 0, okOlculemedi: 0, sunucu: 3, komut: 4, basarili: 2 });
  assert.deepEqual(y.komutOlculen, y.komut, 'olculemeyen sunucuda komut yokken iki kume ayni olmali');
  // Y7: birakildi = kalan 0 ve korunan oge yok (A sorunsuz + E kontrol notlu); B sorunlu -> 2 / 3
  assert.deepEqual(y.oran.birakildi, { pay: 2, payda: 3, metin: '%66,7' });
  assert.deepEqual(y.oran.donus, { pay: 7, payda: 8, metin: '%87,5' });
  assert.deepEqual(y.oran.otomasyon, { pay: 2, payda: 3, metin: '%66,7' });
  assert.deepEqual(y.oran.komut, { pay: 2, payda: 3, metin: '%66,7' });
  assert.deepEqual(y.oran.kapanan, { pay: 3, payda: 4, metin: '%75' });
  assert.match(y.metin, /^Kayıttaki 5 sunucunun 4 tanesinde reboot sonrası son durum ölçüldü, 1 sunucu ölçülemedi\. 1 sunucu reboot öncesi izlenen uygulama çalıştırmadığı için karşılaştırma dışı kaldı\. /);
  assert.match(y.metin, /Karşılaştırılabilen 3 sunucudan 2 tanesi reboot öncesi haliyle bırakıldı \(%66,7\) \(bunlardan 1 tanesinde otomasyon fazladan çalışan ürünü kapattı; kontrol notu var\); 1 sunucuda sorun kaldı\./);
  assert.doesNotMatch(y.metin, /sunucu kontrol bekliyor/, 'birakilan kontrol notlu sunucu "kontrol bekliyor" diye de sayildi');
  assert.match(y.metin, /Karşılaştırılabilen sunucularda öğe bazında \(ürün \+ JVM\) reboot öncesi hale dönüş %87,5 \(7 \/ 8\); reboot öncesi çalışan öğe sayısı 6\./);
  assert.match(y.metin, /Bu sunucularda reboot sonrası ilk kontrolde 4 öğe reboot öncesinden farklıydı \(2 kapalı, 2 fazladan çalışan\); 2 tanesini otomasyon düzeltti, 1 tanesi kendiliğinden düzeldi \(%75 kapatıldı\), 1 öğe hâlâ farklı\./);
  assert.match(y.metin, /Otomasyon son durumu ölçülen sunucularda 3 açma\/kapatma komutu çalıştırdı; 2 tanesinin hedefi son kontrolde doğrulandı \(%66,7\)\. Komut başarı oranı \(dönüş kodu\) %66,7 \(2 \/ 3\); 1 öğede komuta gerek kalmadı\.$/);
  // once bos ama baska neden (web kapatildi) -> karsilastirma disi sayilir; kontrol bekledigi ACIKCA yazilir
  const web = yoneticiOzeti({ C: r(['BOOT|b2||', 'URUN|NGINX||'], ['BOOT|b2||'], ['SONUC|durdur|NGINX||OK|x']) }, ['C'], { C: ['BOOT|b1||'] });
  assert.deepEqual([web.sunucu.onceBos, web.sunucu.onceBosDiger, web.sunucu.onceBosKontrol, web.sunucu.onceBosSorunlu, web.sunucu.karsilastirilabilir], [1, 1, 1, 0, 0]);
  assert.match(web.metin, /karşılaştırma dışı kaldı \(bunlardan 1 tanesi kontrol bekliyor\)\./);
  assert.match(web.metin, /Karşılaştırılabilen \(önce görüntüsü dolu ve son durumu ölçülen\) sunucu yok\./);
  // payda 0: hepsi '—'
  const bos = yoneticiOzeti({}, [], {});
  assert.deepEqual(Object.values(bos.oran).map((o) => o.metin), ['—', '—', '—', '—', '—']);
  assert.match(bos.metin, /Otomasyonun müdahalesine gerek olmadı\.$/);
  // sonraOzeti ayni sonucu ozet.sonra.yonetici olarak tasir; kapsamDisi sayisi
  const kayit = { hosts_json: JSON.stringify(hedef), once_json: JSON.stringify({ sunucular: Object.fromEntries(Object.entries(onceSat).map(([h, g]) => [h, { goruntu_ok: true, goruntu: g }])) }) };
  const { durum, ozet } = sonraOzeti(kayit, { sunucular }, 'successful');
  assert.equal(durum, 'sorunlu');
  assert.equal(ozet.sonra.kapsamDisi, 1);
  assert.deepEqual(ozet.sonra.yonetici, y);
});

test('RC27 v4 inceleme Y1/Y2/Y3/Y4/Y9: once-bos sorun paragrafta; urunle kalkan JVM otomasyon; olculemeyen komut oranda degil; onceYok; korunan oge', () => {
  const { yoneticiOzeti, ogeSayaci, sonraOzeti, raporHtml } = { ...require('../reboot-check.cjs'), ...require('../reboot-rapor.cjs') };
  const v = ['BOOT|b2||', 'SURUM|2||'];
  const r = (goruntu, sonGoruntu, islemler, ek = {}) => ({ once_var: true, son_olculdu: true, son_fark: [], betik_surum: 4, goruntu, son_goruntu: sonGoruntu, islemler, plan: [], ...ek });
  const onceN = ['BOOT|b1||', 'SURUM|2||', 'URUN|NGINX||'];
  // Y1: once-bos sunucuda kapatma FAIL, NGINX hala calisiyor -> sorunlu; paragraf "sorun kaldi" der, otomasyon %0 ile celismez
  const y1 = yoneticiOzeti(
    { A: r([...v, 'URUN|NGINX||'], [...v, 'URUN|NGINX||'], []), B: r(['BOOT|b2||', 'URUN|NGINX||'], ['BOOT|b2||', 'URUN|NGINX||'], ['SONUC|durdur|NGINX||FAIL|x']) },
    ['A', 'B'], { A: onceN, B: ['BOOT|b1||'] },
  );
  assert.deepEqual([y1.sunucu.onceBos, y1.sunucu.onceBosSorunlu, y1.sunucu.onceBosKontrol], [1, 1, 0]);
  assert.match(y1.metin, /1 sunucu reboot öncesi izlenen uygulama çalıştırmadığı için karşılaştırma dışı kaldı \(bunlardan 1 tanesinde sorun kaldı\)\./);
  assert.match(y1.metin, /Bu sunucularda reboot sonrası ilk kontrolde reboot öncesinden farklı öğe yoktu\./);
  assert.deepEqual(y1.oran.otomasyon, { pay: 0, payda: 1, metin: '%0' });
  // Y2: JBoss 8 domain + 3 JVM kapali; yalniz URUN baslat OK (auto-start JVM'ler onunla kalkti; JVM SKIP olabilir) -> 4 otomatik
  const onceJ = ['BOOT|b1||', 'SURUM|2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|j1|x', 'JVM|JBOSS8|j2|x', 'JVM|JBOSS8|j3|x'];
  const sonJ = [...v, 'URUN|JBOSS8||', 'JVM|JBOSS8|j1|x', 'JVM|JBOSS8|j2|x', 'JVM|JBOSS8|j3|x'];
  const j = ogeSayaci(onceJ, r([...v], sonJ, ['SONUC|baslat|JBOSS8||OK|x', 'SONUC|baslat|JBOSS8|j2|SKIP|auto-start']));
  assert.deepEqual([j.ilkSapan, j.otomatik, j.kendiliginden], [4, 4, 0]);
  // JVM'in KENDI komutu FAIL ise urunle birlikte sayilmaz (FAIL donup kalkan = kendiliginden, rapor KOMUT_HATALI_ACILDI ile ayni)
  const jf = ogeSayaci(onceJ, r([...v], sonJ, ['SONUC|baslat|JBOSS8||OK|x', 'SONUC|baslat|JBOSS8|j2|FAIL|x']));
  assert.deepEqual([jf.otomatik, jf.kendiliginden], [3, 1]);
  // urun komutsuz (urun ilkte calisiyordu) JVM kalktiysa kendiliginden kalir
  const jk = ogeSayaci(onceJ, r([...v, 'URUN|JBOSS8||'], sonJ, []));
  assert.deepEqual([jk.otomatik, jk.kendiliginden], [0, 3]);
  // Y3: olculemeyen sunucudaki OK komut otomasyon oranina girmez, "dogrulanamadi" diye ayrica yazilir
  const y3 = yoneticiOzeti(
    { A: r([...v], [...v, 'URUN|NGINX||'], ['SONUC|baslat|NGINX||OK|x']), U: r([...v], [], ['SONUC|baslat|NGINX||OK|x'], { son_olculdu: false }) },
    ['A', 'U'], { A: onceN, U: onceN },
  );
  assert.deepEqual(y3.oran.otomasyon, { pay: 1, payda: 1, metin: '%100' });
  assert.deepEqual([y3.komut.okOlculemedi, y3.komut.okHedefteDegil, y3.komutOlculen.ok], [1, 0, 1]);
  assert.match(y3.metin, /1 tanesinin hedefi son kontrolde doğrulandı \(%100\); ölçülemeyen sunucularda çalışan 1 komutun sonucu doğrulanamadı\. Komut başarı oranı \(dönüş kodu\) %100 \(2 \/ 2\)\./);
  const y3b = yoneticiOzeti({ U: r([...v], [], ['SONUC|baslat|NGINX||OK|x'], { son_olculdu: false }) }, ['U'], { U: onceN });
  assert.match(y3b.metin, /Otomasyon yalnız ölçülemeyen sunucularda 1 komut çalıştırdı; sonucu doğrulanamadı\./);
  assert.equal(y3b.oran.otomasyon.metin, '—');
  // Y4: once goruntusu alinamayan sunucu (sonra hedefi degil) ekran (sonraOzeti) ve raporda AYNI kapsam kalemi
  const onceJson = { sunucular: { A: { goruntu_ok: true, goruntu: onceN }, X: { goruntu_ok: false, goruntu: [] } } };
  const sonraS = { A: r([...v], [...v, 'URUN|NGINX||'], ['SONUC|baslat|NGINX||OK|x']) };
  const so = sonraOzeti({ hosts_json: JSON.stringify(['A', 'X']), once_json: JSON.stringify(onceJson), sonra_hedef_json: JSON.stringify(['A']) }, { sunucular: sonraS }, 'successful');
  const yon = so.ozet.sonra.yonetici;
  assert.deepEqual([yon.sunucu.toplam, yon.sunucu.olculen, yon.sunucu.olculemeyen, yon.sunucu.onceYok], [2, 1, 0, 1]);
  assert.match(yon.metin, /^Kayıttaki 2 sunucunun 1 tanesinde reboot sonrası son durum ölçüldü, 1 sunucunun reboot öncesi görüntüsü alınamadığı için karşılaştırma yapılmadı\./);
  const html = raporHtml({ id: 1, hosts: ['A', 'X'], once: { sonuc: onceJson }, sonra: { sonuc: { sunucular: sonraS } } });
  assert.ok(html.includes(yon.metin), 'rapor paragrafi ekrandaki (sonraOzeti) yonetici metniyle ayni degil');
  assert.match(html, /· ölçülemeyen <b>0<\/b> · önce görüntüsü alınamayan <b>1<\/b>/);
  // Y9: eski surum once'nin korudugu yeni JBoss 7 urunu hedef kumesine girmez, 'korunan' sayilir
  const onceE = ['BOOT|b1||', 'URUN|NGINX||', 'JVM|JBOSS8|z|jboss_home=/opt/jb'];
  const sonE = ['BOOT|b2||', 'SURUM|2||', 'URUN|NGINX||', 'URUN|JBOSS8||', 'URUN|JBOSS7||', 'JVM|JBOSS8|z|jboss_home=/opt/jb'];
  const y9 = yoneticiOzeti({ E: r(sonE, sonE, []) }, ['E'], { E: onceE });
  assert.deepEqual([y9.oge.hedef, y9.oge.dogru, y9.oge.halaSapan, y9.oge.korunan, y9.sunucu.kontrol], [3, 3, 0, 1, 1]);
  assert.match(y9.metin, /reboot öncesi çalışmayan 1 öğe kapatma güvenli olmadığı için dokunulmadı \(kontrol bekliyor\)\./);
});

test('RC28 inceleme Y7: "Bulundugu gibi birakildi" = kalan 0 + korunan calisan oge yok (kontrol notlu dahil); kontrol bekleyen yalniz birakilmayan', () => {
  const { yoneticiOzeti } = require('../reboot-check.cjs');
  const v = ['BOOT|b2||', 'SURUM|2||'];
  const r = (goruntu, sonGoruntu, islemler, ek = {}) => ({ once_var: true, son_olculdu: true, son_fark: [], betik_surum: 4, goruntu, son_goruntu: sonGoruntu, islemler, plan: [], ...ek });
  const onceR = ['BOOT|b1||', 'SURUM|2||', 'URUN|RHA||'];
  // KAPATTI: otomasyon fazladan IHS'i kapatti, fark yok -> kontrol notlu BIRAKILAN
  const KAPATTI = r([...v, 'URUN|RHA||', 'URUN|IHS||'], [...v, 'URUN|RHA||'], ['SONUC|durdur|IHS||OK|x']);
  // KORUNAN: eski surum once'nin korudugu JBoss 7 calisiyor (kalan 0 ama korunan 1) -> birakilan DEGIL, kontrol bekliyor
  const onceE = ['BOOT|b1||', 'URUN|NGINX||', 'JVM|JBOSS8|z|jboss_home=/opt/jb'];
  const sonE = [...v, 'URUN|NGINX||', 'URUN|JBOSS8||', 'URUN|JBOSS7||', 'JVM|JBOSS8|z|jboss_home=/opt/jb'];
  const KORUNAN = r(sonE, sonE, []);
  // KALDI: fazladan IHS hala calisiyor (kalan 1) -> birakilan DEGIL
  const KALDI = r([...v, 'URUN|RHA||', 'URUN|IHS||'], [...v, 'URUN|RHA||', 'URUN|IHS||'], ['SONUC|durdur|IHS||FAIL|x']);
  // TEMIZ: sorunsuz -> birakilan, kontrol notu yok
  const TEMIZ = r([...v, 'URUN|RHA||'], [...v, 'URUN|RHA||'], []);
  const y = yoneticiOzeti({ KAPATTI, KORUNAN, KALDI, TEMIZ }, ['KAPATTI', 'KORUNAN', 'KALDI', 'TEMIZ'], { KAPATTI: onceR, KORUNAN: onceE, KALDI: onceR, TEMIZ: onceR });
  const sn = y.sunucu;
  assert.deepEqual(
    [sn.karsilastirilabilir, sn.sorunsuz, sn.kontrol, sn.sorunlu, sn.birakilan, sn.birakilanKontrolNotlu, sn.kontrolBekleyen],
    [4, 1, 2, 1, 2, 1, 1],
  );
  assert.deepEqual(y.oran.birakildi, { pay: 2, payda: 4, metin: '%50' });
  assert.match(y.metin, /Karşılaştırılabilen 4 sunucudan 2 tanesi reboot öncesi haliyle bırakıldı \(%50\) \(bunlardan 1 tanesinde otomasyon fazladan çalışan ürünü kapattı; kontrol notu var\); 1 sunucu kontrol bekliyor, 1 sunucuda sorun kaldı\./);
  // tek tek: korunan oge calisan sunucu birakilan SAYILMAZ; kalan > 0 birakilan sayilmaz; kontrol notlu birakilan
  const tek = (h, s, o) => yoneticiOzeti({ [h]: s }, [h], { [h]: o }).sunucu;
  assert.deepEqual([tek('K', KORUNAN, onceE).birakilan, tek('K', KORUNAN, onceE).kontrolBekleyen], [0, 1]);
  assert.deepEqual([tek('L', KALDI, onceR).birakilan, tek('L', KALDI, onceR).sorunlu], [0, 1]);
  assert.deepEqual([tek('P', KAPATTI, onceR).birakilan, tek('P', KAPATTI, onceR).birakilanKontrolNotlu, tek('P', KAPATTI, onceR).kontrolBekleyen], [1, 1, 0]);
  const yalnizNotlu = yoneticiOzeti({ P: KAPATTI }, ['P'], { P: onceR });
  assert.match(yalnizNotlu.metin, /Karşılaştırılabilen 1 sunucudan 1 tanesi reboot öncesi haliyle bırakıldı \(%100\) \(bunlardan 1 tanesinde otomasyon fazladan çalışan ürünü kapattı; kontrol notu var\)\./);
  // kontrol notu olmayan birakilanda ek yazilmaz
  assert.doesNotMatch(yoneticiOzeti({ T: TEMIZ }, ['T'], { T: onceR }).metin, /kontrol notu var/);
});

test('RC29 inceleme B1/B2/B4: kontrol notlu birakilan yalniz "otomasyon KAPATTI" notlu; surum 3 metni; BOOT\'suz once karsilastirilamaz; sayac esitligi', () => {
  const { yoneticiOzeti, kontrolNedenleri } = require('../reboot-check.cjs');
  const v = ['BOOT|b2||', 'SURUM|2||'];
  const r = (goruntu, sonGoruntu, islemler, ek = {}) => ({ once_var: true, son_olculdu: true, son_fark: [], betik_surum: 4, goruntu, son_goruntu: sonGoruntu, islemler, plan: [], ...ek });
  const onceR = ['BOOT|b1||', 'SURUM|2||', 'URUN|RHA||'];
  // V3: dolu once, surum 3, aynen -> kalan 0 ama tek neden "betik eski" -> birakilan DEGIL, kontrol bekliyor (B2)
  const V3 = r([...v, 'URUN|RHA||'], [...v, 'URUN|RHA||'], [], { betik_surum: 3 });
  // K3: surum 3 + otomasyon fazladan IHS'i kapatti -> iki neden (betik eski + KAPATTI) -> birakilan DEGIL
  const K3 = r([...v, 'URUN|RHA||', 'URUN|IHS||'], [...v, 'URUN|RHA||'], ['SONUC|durdur|IHS||OK|x'], { betik_surum: 3 });
  // K4: guncel betik + yalniz KAPATTI notu -> kontrol notlu birakilan
  const K4 = r([...v, 'URUN|RHA||', 'URUN|IHS||'], [...v, 'URUN|RHA||'], ['SONUC|durdur|IHS||OK|x']);
  const T = r([...v, 'URUN|RHA||'], [...v, 'URUN|RHA||'], []);
  // BOOTSUZ: once BOOT'suz (onceSat'ta kullanilabilir once yok) -> karsilastirilamaz, 'onceYok' (B4)
  const BOOTSUZ = r([...v, 'URUN|RHA||'], [...v, 'URUN|RHA||'], []);
  const hedef = ['V3', 'K3', 'K4', 'T', 'BOOTSUZ'];
  const y = yoneticiOzeti({ V3, K3, K4, T, BOOTSUZ }, hedef, { V3: onceR, K3: onceR, K4: onceR, T: onceR, BOOTSUZ: ['URUN|RHA||'] });
  const sn = y.sunucu;
  assert.deepEqual(
    [sn.toplam, sn.olculen, sn.onceYok, sn.karsilastirilabilir, sn.sorunsuz, sn.kontrol, sn.sorunlu, sn.birakilan, sn.birakilanKontrolNotlu, sn.kontrolBekleyen],
    [5, 4, 1, 4, 1, 3, 0, 2, 1, 2],
  );
  // B4: esitlik her zaman tutar; bolumleme toplam = olculen + olculemeyen + onceYok
  assert.equal(sn.birakilan + sn.kontrolBekleyen + sn.sorunlu, sn.karsilastirilabilir);
  assert.equal(sn.olculen + sn.olculemeyen + sn.onceYok, sn.toplam);
  assert.deepEqual(y.oran.birakildi, { pay: 2, payda: 4, metin: '%50' });
  assert.match(y.metin, /Karşılaştırılabilen 4 sunucudan 2 tanesi reboot öncesi haliyle bırakıldı \(%50\) \(bunlardan 1 tanesinde otomasyon fazladan çalışan ürünü kapattı; kontrol notu var\); 2 sunucu kontrol bekliyor\./);
  assert.match(y.metin, /1 sunucunun reboot öncesi görüntüsü alınamadığı için karşılaştırma yapılmadı/);
  // tek basina V3: cumle "otomasyon kapatti" DEMEZ, kontrol bekler
  const v3 = yoneticiOzeti({ V3 }, ['V3'], { V3: onceR });
  assert.deepEqual([v3.sunucu.birakilan, v3.sunucu.birakilanKontrolNotlu, v3.sunucu.kontrolBekleyen], [0, 0, 1]);
  assert.doesNotMatch(v3.metin, /otomasyon fazladan çalışan ürünü kapattı/);
  // B1: bos once + surum 3 + CTG hala calisiyor -> kapanmasi gereken; neden v3'un gercek eksigini soyler ("kapatma yoktu" demez)
  const bos3 = r(['BOOT|b2||', 'URUN|CTG||'], ['BOOT|b2||', 'URUN|CTG||'], [], { betik_surum: 3 });
  const n = kontrolNedenleri(['BOOT|b1||'], bos3).join(' ');
  assert.match(n, /otomatik kapatılması gerekiyordu: CTG — AWX'teki betik eski \(sürüm 3\): bu koşudaki betik \(sürüm 3\) ürün kapatıp yeniden deniyordu, ancak reboot öncesi görüntüsü boş sunucuda yalnız web ürünlerini/);
  assert.doesNotMatch(n, /kapatma yoktu|YOKTU/);
});
