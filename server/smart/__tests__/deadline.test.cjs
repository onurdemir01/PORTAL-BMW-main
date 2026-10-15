// server/smart/__tests__/deadline.test.cjs — Smart talep SON TARIHI (2026-10-15).
//
// NEDEN: ekrandaki "Zaman asimina kalan" sayaci sunucunun dondugu `deadline`a dayanir.
// O tarih poller'in GERCEKTEN TIMEOUT yazdigi andan farkli hesaplanirsa kullanici
// "5 dk kaldi" gorurken talep iptal olur (ya da tersi). Bu dosya uc seyi olcer:
//   DL1-DL8  saf kural (talepSonTarihi / talepSonTarihiAlanlari)
//   DL9      TEK KAYNAK: poller'in TIMEOUT karari son tarihle BIREBIR ayni ani kullaniyor
//   DL13-14  islem kurali (pendingLaunch.onayZamanAsimiDk, OpsX production 15 dk): kural + poller
//   DL10-12  HTTP uclari (runner.cjs'teki GERCEK govde, sahte store ile kosturulur)
// DB / gercek Smart API gerektirmez.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const { talepSonTarihi, talepSonTarihiAlanlari } = require('../deadline.cjs');

const DK = 60000;
const T0 = Date.parse('2026-10-15T08:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

function talep(over = {}) {
  return { id: 1, status: 'PENDING', createdAt: iso(T0), pendingLaunch: {}, ...over };
}

// ── Saf kural ───────────────────────────────────────────────────────────────

test('DL1 sinirsiz: genel sinir yok + OCO penceresi yok -> deadline null', () => {
  const r = talepSonTarihi(talep(), { ticketTimeoutMinutes: null });
  assert.deepEqual(r, { deadline: null, deadlineKaynak: null, timeoutMinutes: null });
  // cfg hic verilmezse de sinirsiz (getConfig alani yoksa poller da sinirsiz davranir)
  assert.equal(talepSonTarihi(talep(), {}).deadline, null);
});

test('DL2 yalniz genel sinir: createdAt + N dk, kaynak genel', () => {
  const r = talepSonTarihi(talep(), { ticketTimeoutMinutes: 15 });
  assert.equal(r.deadlineKaynak, 'genel');
  assert.equal(r.timeoutMinutes, 15);
  assert.equal(r.deadline.toISOString(), iso(T0 + 15 * DK));
});

test('DL3 yalniz OCO: son tarih pencere SONU, kaynak oco', () => {
  const W = T0 + 3 * 60 * DK;
  const r = talepSonTarihi(talep({ pendingLaunch: { ocoWindowEndIso: iso(W) } }), { ticketTimeoutMinutes: null });
  assert.equal(r.deadlineKaynak, 'oco');
  assert.equal(r.deadline.toISOString(), iso(W));
  assert.equal(r.timeoutMinutes, 180);
});

test('DL4 ikisi birden: gecerli pencere varsa son tarih HER ZAMAN pencere sonu (oco)', () => {
  // pencere (180 dk) > genel (60 dk) -> oco: kisa genel sinir pencereyi KISALTMAZ
  let r = talepSonTarihi(
    talep({ pendingLaunch: { ocoWindowEndIso: iso(T0 + 180 * DK) } }),
    { ticketTimeoutMinutes: 60 },
  );
  assert.equal(r.deadlineKaynak, 'oco');
  assert.equal(r.deadline.toISOString(), iso(T0 + 180 * DK));
  assert.equal(r.timeoutMinutes, 180);

  // genel (600 dk) > pencere (30 dk) -> YINE oco (2026-10-15 denetim): pencere kapandiktan
  // sonra gelen onay isi zaten calistirmaz (runner nextRunAt 'none' -> ERROR). Eski kural
  // (BUYUGU) talebi 600 dk acik tutuyor, ekran olu bir talep icin "kalan sure" gosteriyordu.
  r = talepSonTarihi(
    talep({ pendingLaunch: { ocoWindowEndIso: iso(T0 + 30 * DK) } }),
    { ticketTimeoutMinutes: 600 },
  );
  assert.equal(r.deadlineKaynak, 'oco');
  assert.equal(r.deadline.toISOString(), iso(T0 + 30 * DK));
  assert.equal(r.timeoutMinutes, 30);

  // esit -> oco
  r = talepSonTarihi(
    talep({ pendingLaunch: { ocoWindowEndIso: iso(T0 + 90 * DK) } }),
    { ticketTimeoutMinutes: 90 },
  );
  assert.equal(r.deadlineKaynak, 'oco');
  assert.equal(r.deadline.toISOString(), iso(T0 + 90 * DK));
});

test('DL4b gosterilen son tarih onayin ISE YARAYACAGI son ani asmaz (genel > pencere dahil)', () => {
  // Bekci (2026-10-15 denetim): sayacin "kalan" dedigi her anda gelen onay, runner'in onay
  // anindaki kapisindan (oco/window.nextRunAt) GECEBILMELI. Son tarihten sonra 'none' donmesi
  // serbest (poller zaten TIMEOUT yazar); ONCE donmesi ekranin olu talep icin sure saymasidir.
  const { nextRunAt } = require('../../oco/window.cjs');
  const bas = T0 + 10 * DK;
  for (const [genel, pencereDk] of [[null, 120], [60, 120], [600, 30], [240, 60], [90, 90]]) {
    const son = T0 + pencereDk * DK;
    const t = talep({ pendingLaunch: { ocoWindowStartIso: iso(bas), ocoWindowEndIso: iso(son) } });
    const { deadline } = talepSonTarihi(t, { ticketTimeoutMinutes: genel });
    const etiket = `genel=${genel} pencere=${pencereDk}dk`;
    assert.ok(deadline.getTime() <= son, `${etiket}: son tarih pencere sonundan SONRA`);
    for (const an of [deadline.getTime() - 1000, deadline.getTime()]) {
      const plan = nextRunAt({ windowStart: new Date(bas), windowEnd: new Date(son), now: new Date(an) });
      assert.notEqual(plan.mode, 'none', `${etiket}: sayac sure gosterirken onay isi calistiramiyor`);
    }
  }
  // KORLUK NOTU: nextRunAt pencere sonundan sonra 60 sn tolerans (graceMs) tanir; poller ise
  // pencere sonunda kesin '>' ile keser. Son tarih tolerans DAHIL edilmeden pencere sonudur -
  // sayac hicbir zaman toleransa guvenip "kaldi" demez.
});

test('DL5 gecersiz pencere tarihi YOK SAYILIR (genel ya da sinirsiz kalir)', () => {
  for (const bozuk of ['abc', 'not-a-date', '2026-13-45T99:99']) {
    const g = talepSonTarihi(talep({ pendingLaunch: { ocoWindowEndIso: bozuk } }), { ticketTimeoutMinutes: 20 });
    assert.equal(g.deadlineKaynak, 'genel', `"${bozuk}" genel siniri bozdu`);
    assert.equal(g.deadline.toISOString(), iso(T0 + 20 * DK));
    const s = talepSonTarihi(talep({ pendingLaunch: { ocoWindowEndIso: bozuk } }), { ticketTimeoutMinutes: null });
    assert.deepEqual(s, { deadline: null, deadlineKaynak: null, timeoutMinutes: null }, `"${bozuk}" sinir uydurdu`);
  }
  // null / bos dizgi de "pencere yok"
  assert.equal(talepSonTarihi(talep({ pendingLaunch: { ocoWindowEndIso: null } }), { ticketTimeoutMinutes: null }).deadline, null);
  assert.equal(talepSonTarihi(talep({ pendingLaunch: null }), { ticketTimeoutMinutes: null }).deadline, null);
});

test('DL6 okunamayan createdAt: tarih UYDURULMAZ (poller da bu talebi zaman asimina dusurmez)', () => {
  const r = talepSonTarihi(talep({ createdAt: 'bozuk' }), { ticketTimeoutMinutes: 15 });
  assert.equal(r.deadline, null);
  assert.equal(r.deadlineKaynak, null);
});

test('DL7 createdAt Date nesnesi de kabul edilir (mssql surucusu Date dondurur)', () => {
  const r = talepSonTarihi(talep({ createdAt: new Date(T0) }), { ticketTimeoutMinutes: 45 });
  assert.equal(r.deadline.toISOString(), iso(T0 + 45 * DK));
});

test('DL8 yanit alanlari: yalniz PENDING/LAUNCHING te hesaplanir, ISO dizgi doner', () => {
  const cfg = { ticketTimeoutMinutes: 15 };
  for (const st of ['PENDING', 'LAUNCHING']) {
    assert.deepEqual(talepSonTarihiAlanlari(talep({ status: st }), cfg), {
      deadline: iso(T0 + 15 * DK),
      deadlineKaynak: 'genel',
    }, st);
  }
  for (const st of ['LAUNCHED', 'SCHEDULED', 'REJECTED', 'TIMEOUT', 'CANCELLED', 'ERROR', undefined]) {
    assert.deepEqual(talepSonTarihiAlanlari(talep({ status: st }), cfg), { deadline: null, deadlineKaynak: null }, String(st));
  }
  assert.deepEqual(talepSonTarihiAlanlari(null, cfg), { deadline: null, deadlineKaynak: null });
});

// ── TEK KAYNAK: poller ile son tarih ayni ani mi kullaniyor ─────────────────

const SMART_ENV = { SMART_API_URL: 'https://smart.example', SMART_API_USERNAME: 'u', SMART_API_PASSWORD: 'p' };

async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

// poller-timeout.test.cjs ile ayni desen: store/client require onbellegine sahte modul.
async function pollerKararlari(tickets) {
  const marks = await pollerYazimlari(tickets);
  return new Set(marks.filter((m) => m.status === 'TIMEOUT').map((m) => m.id));
}

async function pollerYazimlari(tickets) {
  const storePath = require.resolve('../store.cjs');
  const clientPath = require.resolve('../client.cjs');
  const configPath = require.resolve('../config.cjs');
  const pollerPath = require.resolve('../poller.cjs');
  const saved = { s: require.cache[storePath], c: require.cache[clientPath], p: require.cache[pollerPath] };
  const marks = [];
  const sahte = (p, exports) => {
    const m = new Module(p, null);
    m.exports = exports;
    m.loaded = true;
    require.cache[p] = m;
  };
  sahte(storePath, {
    listPending: async () => tickets,
    claimForLaunch: async (id) => ({ id }),
    markState: async (id, patch) => { marks.push({ id, ...patch }); return true; },
  });
  // Smart hep "Onay Bekliyor" der: TIMEOUT disinda hicbir yazim olmamali.
  sahte(clientPath, { checkTicketStatus: async () => ({ completed: false, rejected: false, stateName: 'Onay Bekliyor' }) });
  delete require.cache[pollerPath];
  delete require.cache[configPath];
  const poller = require('../poller.cjs');
  try {
    poller.startPoller(async () => ({ jobId: 1 }));
    await poller.tick();
  } finally {
    poller.stopPoller();
    for (const [p, k] of [[storePath, 's'], [clientPath, 'c'], [pollerPath, 'p']]) {
      if (saved[k]) require.cache[p] = saved[k]; else delete require.cache[p];
    }
    delete require.cache[configPath];
  }
  return marks;
}

test('DL9 TEK KAYNAK: son tarihi GECMIS talep TIMEOUT olur, GECMEMIS olmaz (her kaynak icin)', async (t) => {
  t.mock.method(console, 'log', () => {});
  // Her senaryoda talep, son tarihi `simdi +/- 20 sn` olacak sekilde KURULUR; dogru
  // olan, poller'in tam olarak bu tarihe gore karar vermesi.
  const senaryolar = [
    { ad: 'genel', env: '30', pencereDk: null, beklenenKaynak: 'genel' },
    { ad: 'oco', env: undefined, pencereDk: 120, beklenenKaynak: 'oco' },
    { ad: 'ikisi-oco-buyuk', env: '30', pencereDk: 120, beklenenKaynak: 'oco' },
    // 2026-10-15: genel sinir pencereden uzun olsa da gecerli pencere varsa kaynak 'oco'.
    { ad: 'ikisi-genel-buyuk', env: '300', pencereDk: 60, beklenenKaynak: 'oco' },
  ];
  for (const s of senaryolar) {
    await withEnv({ ...SMART_ENV, SMART_TICKET_TIMEOUT_MINUTES: s.env }, async () => {
      delete require.cache[require.resolve('../config.cjs')];
      const cfg = require('../config.cjs').getConfig();
      const simdi = Date.now();
      // Sure (dk): genel sinir ya da pencere - hangisi son tarihi belirliyorsa.
      const sureDk = s.beklenenKaynak === 'genel' ? Number(s.env) : s.pencereDk;
      const kur = (id, kaymaMs) => {
        const sonTarih = simdi + kaymaMs;
        const createdMs = sonTarih - sureDk * DK;
        const t = talep({ id, createdAt: iso(createdMs), externalTicketId: String(id) });
        if (s.pencereDk != null) t.pendingLaunch = { ocoWindowEndIso: iso(createdMs + s.pencereDk * DK) };
        return t;
      };
      const gecmis = kur(1, -20000);
      const gelecek = kur(2, +20000);
      for (const t of [gecmis, gelecek]) {
        const r = talepSonTarihi(t, cfg);
        assert.equal(r.deadlineKaynak, s.beklenenKaynak, `${s.ad}: kaynak`);
      }
      assert.ok(talepSonTarihi(gecmis, cfg).deadline.getTime() < simdi, `${s.ad}: kurgu bozuk`);
      assert.ok(talepSonTarihi(gelecek, cfg).deadline.getTime() > simdi, `${s.ad}: kurgu bozuk`);

      const timeout = await pollerKararlari([gecmis, gelecek]);
      assert.ok(timeout.has(1), `${s.ad}: son tarihi gecmis talep TIMEOUT yazilmadi - ekran "bitti" derken talep acik kaliyor`);
      assert.ok(!timeout.has(2), `${s.ad}: son tarihi GELMEMIS talep TIMEOUT oldu - ekran "kaldi" derken talep iptal ediliyor`);
    });
  }
});

test('DL9c TIMEOUT mesaji son tarihin KAYNAGINI soyler; okunamayan pencere tick i dusurmez', async (t) => {
  // 2026-10-15 denetim: mesaj eskiden `winEndIso` doluysa "Kesinti penceresi kapandi" diyordu -
  // sinir genel sinirdan gelse bile (deadlineKaynak 'genel' ile celiski). Daha kotusu: pencere
  // tarihi OKUNAMAYAN + genel siniri dolmus talepte `new Date('bozuk').toISOString()` RangeError
  // firlatiyor, tick o talepte kopuyor ve SONRAKI talepler (onaylananlar dahil) her turda
  // hic islenmiyordu.
  t.mock.method(console, 'log', () => {});
  await withEnv({ ...SMART_ENV, SMART_TICKET_TIMEOUT_MINUTES: '30' }, async () => {
    const eski = iso(Date.now() - 45 * DK); // genel sinir (30 dk) dolmus
    const bozukPencere = talep({ id: 1, createdAt: eski, externalTicketId: '1', pendingLaunch: { ocoWindowEndIso: 'bozuk' } });
    const genelSinir = talep({ id: 2, createdAt: eski, externalTicketId: '2' });
    const pencereSonu = iso(Date.now() - DK);
    const ocoSinir = talep({ id: 3, createdAt: eski, externalTicketId: '3', pendingLaunch: { ocoWindowEndIso: pencereSonu } });
    const marks = await pollerYazimlari([bozukPencere, genelSinir, ocoSinir]);
    const mesaj = (id) => (marks.find((m) => m.id === id && m.status === 'TIMEOUT') || {}).errorMessage;
    assert.match(String(mesaj(1)), /30 dakika icinde Smart onayi alinmadi/, 'bozuk pencereli talep TIMEOUT olmadi / tick koptu');
    assert.match(String(mesaj(2)), /30 dakika icinde Smart onayi alinmadi/, 'bozuk pencereden SONRAKI talep islenmedi');
    assert.match(String(mesaj(3)), /Kesinti penceresi/);
    assert.ok(String(mesaj(3)).includes(pencereSonu), 'mesaj pencere sonunu soylemiyor');
  });
});

test('DL13 ISLEM KURALI (OpsX production 15 dk): genel sinirin yerine gecer; OCO ile ERKEN olan', () => {
  const islem = (pl, cfg = {}) => talepSonTarihi(talep({ pendingLaunch: pl }), cfg);
  // Sinirsiz sistemde de, genel sinir daha uzunken de 15 dk.
  for (const cfg of [{ ticketTimeoutMinutes: null }, { ticketTimeoutMinutes: 240 }, { ticketTimeoutMinutes: 5 }]) {
    const r = islem({ onayZamanAsimiDk: 15 }, cfg);
    assert.equal(r.deadlineKaynak, 'islem', `genel=${cfg.ticketTimeoutMinutes}`);
    assert.equal(r.timeoutMinutes, 15);
    assert.equal(r.deadline.toISOString(), iso(T0 + 15 * DK));
  }
  // OCO penceresi daha erken kapaniyorsa pencere; daha gec kapaniyorsa islem kurali.
  const erken = islem({ onayZamanAsimiDk: 15, ocoWindowEndIso: iso(T0 + 5 * DK) });
  assert.equal(erken.deadlineKaynak, 'oco');
  assert.equal(erken.deadline.toISOString(), iso(T0 + 5 * DK));
  const gec = islem({ onayZamanAsimiDk: 15, ocoWindowEndIso: iso(T0 + 120 * DK) });
  assert.equal(gec.deadlineKaynak, 'islem');
  assert.equal(gec.deadline.toISOString(), iso(T0 + 15 * DK));
  // Gecersiz deger YOK SAYILIR (eski davranis: genel ya da sinirsiz).
  for (const v of [0, -3, 'x', null, undefined, Infinity]) {
    assert.equal(islem({ onayZamanAsimiDk: v }, { ticketTimeoutMinutes: 30 }).deadlineKaynak, 'genel', `deger=${String(v)}`);
    assert.equal(islem({ onayZamanAsimiDk: v }, {}).deadline, null, `deger=${String(v)}`);
  }
  // Okunamayan createdAt: tarih uydurulmaz.
  assert.equal(talepSonTarihi(talep({ createdAt: 'bozuk', pendingLaunch: { onayZamanAsimiDk: 15 } }), {}).deadline, null);
  // Yanit alanlari ayni kaynagi soyler.
  assert.deepEqual(talepSonTarihiAlanlari(talep({ pendingLaunch: { onayZamanAsimiDk: 15 } }), {}), {
    deadline: iso(T0 + 15 * DK),
    deadlineKaynak: 'islem',
  });
});

test('DL14 ISLEM KURALI poller da: 15 dk dolan talep TIMEOUT (yeni talep acin mesaji), dolmayan acik kalir', async (t) => {
  t.mock.method(console, 'log', () => {});
  // Genel sinir sinirsiz (varsayilan): kural tek basina calismali.
  await withEnv({ ...SMART_ENV, SMART_TICKET_TIMEOUT_MINUTES: undefined }, async () => {
    const simdi = Date.now();
    const pl = { onayZamanAsimiDk: 15 };
    const dolmus = talep({ id: 1, createdAt: iso(simdi - 15 * DK - 20000), externalTicketId: '1', pendingLaunch: pl });
    const dolmamis = talep({ id: 2, createdAt: iso(simdi - 15 * DK + 20000), externalTicketId: '2', pendingLaunch: pl });
    const marks = await pollerYazimlari([dolmus, dolmamis]);
    const zaman = marks.filter((m) => m.status === 'TIMEOUT');
    assert.deepEqual(zaman.map((m) => m.id), [1], '15 dk kurali poller da uygulanmiyor');
    const mesaj = String(zaman[0].errorMessage);
    assert.match(mesaj, /onay suresi 15 dakikadir/);
    // Smart'taki kayit API ile kapatilamiyor: kullaniciya sonradan onayin isi BASLATMAYACAGI soylenir.
    assert.match(mesaj, /sonradan onaylansa da is BASLAMAZ/);
    assert.ok(!/Kesinti penceresi/.test(mesaj));
  });
});

test('DL9b poller kurali KENDISI hesaplamaz, deadline.cjs i cagirir (ikinci kopya yok)', () => {
  const kod = fs.readFileSync(path.join(__dirname, '..', 'poller.cjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.match(kod, /require\('\.\/deadline\.cjs'\)/, 'poller deadline.cjs i yuklemiyor');
  assert.match(kod, /talepSonTarihi\(ticket, cfg\)/, 'poller son tarih yardimcisini cagirmiyor');
  assert.doesNotMatch(kod, /Math\.max\(/, 'poller kuralin bir KOPYASINI tasiyor - iki hesap ayrisabilir');
});

// ── HTTP uclari: runner.cjs'teki GERCEK govde ───────────────────────────────

const RUNNER_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'ansible', 'runner.cjs'), 'utf8');

/**
 * Ucun GERCEK kaydini runner.cjs kaynagindan cikarir (kopyasi degil) ve sahte
 * bagimliliklarla kosturulabilir isleyiciyi dondurur. Fail-closed: desen
 * degisirse test duser, sessizce bos dilim uretmez.
 */
function gercekUc(yol, { store, cfg }) {
  const bas = RUNNER_SRC.indexOf(`app.get('${yol}'`);
  assert.ok(bas > 0, `uc bulunamadi: ${yol}`);
  const son = RUNNER_SRC.indexOf('\n  });\n', bas);
  assert.ok(son > bas, `uc sonu bulunamadi: ${yol}`);
  const kod = RUNNER_SRC.slice(bas, son + '\n  });'.length);
  const kayit = {};
  const app = { get: (p, ...h) => { kayit[p] = h; } };
  const sahteRequire = (m) => {
    if (m === '../smart/store.cjs') return store;
    if (m === '../smart/config.cjs') return { getConfig: () => cfg };
    if (m === '../smart/deadline.cjs') return require('../deadline.cjs');
    throw new Error(`beklenmeyen require: ${m}`);
  };
  new Function('app', 'requireAuth', 'requireAdmin', 'require', 'redactExtraVarsForHistory', 'resolveModuleTagger', kod)(
    app,
    (_q, _s, n) => n(),
    (_q, _s, n) => n(),
    sahteRequire,
    (ev) => ev,
    async () => () => 'Self Service',
  );
  assert.ok(kayit[yol], `uc kaydedilmedi: ${yol}`);
  const isleyici = kayit[yol][kayit[yol].length - 1];
  return async (req) => {
    const out = { kod: 200, govde: null };
    const res = {
      status(k) { out.kod = k; return this; },
      json(g) { out.govde = JSON.parse(JSON.stringify(g)); return this; },
    };
    await isleyici(req, res);
    return out;
  };
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function serverNowTaze(g) {
  assert.match(String(g.serverNow), ISO_RE, 'serverNow ISO degil');
  assert.ok(Math.abs(Date.parse(g.serverNow) - Date.now()) < 5000, 'serverNow yanit anini gostermiyor');
}

test('DL10 status ucu: createdAt + deadline + deadlineKaynak + serverNow; mevcut alanlar korunur', async () => {
  const bekleyen = talep({
    id: 7, username: 'ali', smartStateName: 'Onay Bekliyor', awxJobId: null, awxServerId: 2,
    errorMessage: null, externalTicketId: 'X-7',
    createdAt: new Date(T0), // mssql Date dondurur
    pendingLaunch: { ocoWindowEndIso: iso(T0 + 120 * DK) },
  });
  const kapali = { ...bekleyen, id: 8, status: 'LAUNCHED', awxJobId: 99 };
  const store = { getTicket: async (id) => ({ 7: bekleyen, 8: kapali }[id] || null) };
  const uc = gercekUc('/api/ansible/ss/smart-ticket/:id/status', { store, cfg: { ticketTimeoutMinutes: 30 } });
  const req = (id, user = { username: 'ali', role: 'User' }) => ({ params: { id: String(id) }, session: { user } });

  let r = await uc(req(7));
  assert.equal(r.kod, 200);
  assert.deepEqual(
    { ...r.govde, serverNow: undefined },
    {
      ok: true, status: 'PENDING', smartStateName: 'Onay Bekliyor', jobId: null, awxServerId: 2,
      errorMessage: null, externalTicketId: 'X-7',
      createdAt: iso(T0), deadline: iso(T0 + 120 * DK), deadlineKaynak: 'oco', serverNow: undefined,
    },
  );
  serverNowTaze(r.govde);

  r = await uc(req(8));
  assert.equal(r.govde.status, 'LAUNCHED');
  assert.equal(r.govde.jobId, 99);
  assert.equal(r.govde.deadline, null, 'kapanmis talepte son tarih donmemeli');
  assert.equal(r.govde.deadlineKaynak, null);
  assert.equal(r.govde.createdAt, iso(T0));
  serverNowTaze(r.govde);

  // Yetki davranisi aynen: baskasinin talebi 403, son tarih SIZMAZ.
  r = await uc(req(7, { username: 'veli', role: 'User' }));
  assert.equal(r.kod, 403);
  assert.equal(r.govde.deadline, undefined);
});

test('DL11 mine ucu: her talepte deadline/deadlineKaynak, yanit kokunde serverNow', async () => {
  const liste = [
    talep({ id: 1, status: 'PENDING', createdAt: iso(T0), pendingLaunch: { templateName: 'A' } }),
    talep({ id: 2, status: 'TIMEOUT', createdAt: iso(T0) }),
    talep({ id: 3, status: 'LAUNCHING', createdAt: iso(T0), pendingLaunch: { ocoWindowEndIso: iso(T0 + 600 * DK) } }),
  ];
  let sorulan = null;
  const store = { listByUsername: async (u) => { sorulan = u; return liste; } };
  const uc = gercekUc('/api/ansible/ss/smart-tickets/mine', { store, cfg: { ticketTimeoutMinutes: 15 } });
  const r = await uc({ session: { user: { username: 'ali' } } });
  assert.equal(r.kod, 200);
  assert.equal(sorulan, 'ali');
  serverNowTaze(r.govde);
  const [a, b, c] = r.govde.tickets;
  assert.equal(a.templateName, 'A', 'mevcut alan bozuldu');
  assert.equal(a.createdAt, iso(T0));
  assert.deepEqual([a.deadline, a.deadlineKaynak], [iso(T0 + 15 * DK), 'genel']);
  assert.deepEqual([b.deadline, b.deadlineKaynak], [null, null]);
  assert.deepEqual([c.deadline, c.deadlineKaynak], [iso(T0 + 600 * DK), 'oco']);
});

test('DL12 all (admin) ucu: her talepte deadline/deadlineKaynak, kokte serverNow; sayfalama alanlari korunur', async () => {
  const liste = [
    talep({ id: 5, status: 'PENDING', username: 'x', createdAt: iso(T0) }),
    talep({ id: 6, status: 'CANCELLED', username: 'y', createdAt: iso(T0) }),
  ];
  const store = {
    listAll: async () => ({ total: 2, tickets: liste }),
    statusSummary: async () => ({ PENDING: 1, CANCELLED: 1 }),
  };
  const uc = gercekUc('/api/ansible/ss/smart-tickets/all', { store, cfg: { ticketTimeoutMinutes: null } });
  const r = await uc({ query: {}, session: { user: { username: 'adm', role: 'Admin' } } });
  assert.equal(r.kod, 200);
  assert.equal(r.govde.total, 2);
  assert.deepEqual(r.govde.summary, { PENDING: 1, CANCELLED: 1 });
  serverNowTaze(r.govde);
  // Sinirsiz yapilandirmada PENDING talebin son tarihi YOK (null = sure siniri yok).
  assert.ok('deadline' in r.govde.tickets[0], 'alan hic eklenmemis');
  assert.deepEqual([r.govde.tickets[0].deadline, r.govde.tickets[0].deadlineKaynak], [null, null]);
  assert.equal(r.govde.tickets[0].module, 'Self Service', 'mevcut alan bozuldu');

  // Genel sinir verilince ayni uc son tarihi doldurur.
  const uc2 = gercekUc('/api/ansible/ss/smart-tickets/all', { store, cfg: { ticketTimeoutMinutes: 60 } });
  const r2 = await uc2({ query: {}, session: { user: { username: 'adm', role: 'Admin' } } });
  assert.deepEqual([r2.govde.tickets[0].deadline, r2.govde.tickets[0].deadlineKaynak], [iso(T0 + 60 * DK), 'genel']);
  assert.deepEqual([r2.govde.tickets[1].deadline, r2.govde.tickets[1].deadlineKaynak], [null, null]);
});
