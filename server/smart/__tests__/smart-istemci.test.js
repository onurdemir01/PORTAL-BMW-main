'use strict';
// SMART ISTEMCISI (server/smart/client.cjs) — RFF REST cagrilari, ag olmadan. undici'nin Agent /
// ProxyAgent kuruculari cagri aninda okunur: yerinde sahtelenir ve sahte bir dispatcher doner;
// yanit govdesi gercek bir akistir (sinirli okuma gercekten kosar).
//   SI1 createTicket: govde sekli (metadata degerleri dizgiye), Basic Auth, RFF belirteci, yol,
//       zaman asimlari; donus ticketId / stateInstanceId; dispatcher her cagrida kapanir.
//   SI2 servis anahtari (integrationKey) global belirtecin yerine gecer; belirtec yoksa baslik yok.
//   SI3 talep reddi: resultCode 1000 degilse mesajla 502; wfInstanceId yoksa 502.
//   SI4 yapilandirma ya da domain eksikse istek atilmaz (503).
//   SI5 log metadata DEGERLERINI yazmaz (yalniz dolu / bos ve uzunluk).
//   SI6 HTTP 2xx disi 502 (govdenin ilk 300 karakteri); bos ve JSON olmayan govde.
//   SI7 baglanti hatasi: tani logu, hata aynen firlatilir, dispatcher kapanir; kurulum hatasi da.
//   SI8 SMART_PROXY_URL varsa ProxyAgent, yoksa Agent; ikisinde de TLS dogrulamasi acik.
//   SI9 checkTicketStatus: 1000 tamamlandi, 2000 reddedildi, digerleri bekliyor; ret 502; 503.
//   SI10 getFlowMetadata: sonuc dizisi (yoksa bos); ret 502; 503.
//   SI11 yanit tavani: 4 MB'i asan govde reddedilir.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const undici = require('undici');

const { createTicket, checkTicketStatus, getFlowMetadata } = require('../client.cjs');

const ORTAM = {
  SMART_API_URL: 'https://smart.ornek.invalid:8443/',
  SMART_API_USERNAME: 'portal',
  SMART_API_PASSWORD: 'gizli',
  SMART_RFF_TOKEN: 'genel-belirtec',
  SMART_DOMAIN: 'ALAN',
  SMART_PROXY_URL: undefined,
  SMART_CREATE_TICKET_PATH: undefined,
  SMART_GET_METADATA_PATH: undefined,
  SMART_CHECK_TICKET_PATH: undefined,
};

function ortam(t, degerler) {
  for (const [k, v] of Object.entries(degerler)) {
    const eski = process.env[k];
    t.after(() => {
      if (eski === undefined) delete process.env[k];
      else process.env[k] = eski;
    });
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/** Yanitlar sirayla verilir: { statusCode, govde } ya da { hata }. */
function kur(t, yanitlar, env = {}) {
  ortam(t, { ...ORTAM, ...env });
  const sira = [...yanitlar];
  const d = {
    istekler: [],
    kapanan: 0,
    async request(o) {
      d.istekler.push({ ...o, govde: JSON.parse(o.body) });
      const y = sira.shift();
      if (y.hata) throw y.hata;
      const parcalar = Array.isArray(y.govde) ? y.govde : [y.govde ?? ''];
      return {
        statusCode: y.statusCode ?? 200,
        body: Readable.from(parcalar.map((p) => Buffer.from(p))),
      };
    },
    async close() {
      d.kapanan++;
    },
  };
  const agent = t.mock.method(undici, 'Agent', function SahteAgent() {
    return d;
  });
  const proxy = t.mock.method(undici, 'ProxyAgent', function SahteProxy() {
    return d;
  });
  const log = t.mock.method(console, 'log', () => {});
  const hata = t.mock.method(console, 'error', () => {});
  return { d, agent, proxy, log, hata };
}

const tamam = (result) => ({ govde: JSON.stringify({ result }) });

test('SI1 createTicket govdesi, kimlik ve donus', async (t) => {
  const s = kur(t, [tamam({ resultCode: 1000, wfInstanceId: 4711, stateInstanceId: 9 })]);
  const r = await createTicket({
    flowKey: 'AKIS-1',
    username: 'ali',
    metadata: { uygulama: 'odeme', adet: 3, bos: '' },
  });
  assert.deepEqual(
    { ticketId: r.ticketId, stateInstanceId: r.stateInstanceId },
    { ticketId: '4711', stateInstanceId: 9 },
  );
  assert.equal(r.raw.result.wfInstanceId, 4711);

  assert.equal(s.d.istekler.length, 1);
  const [istek] = s.d.istekler;
  assert.equal(istek.origin, 'https://smart.ornek.invalid:8443');
  assert.equal(istek.path, '/smart/internal/requestfulfilment/createoperationalrequest/v1');
  assert.equal(istek.method, 'POST');
  assert.equal(istek.headersTimeout, 20_000);
  assert.equal(istek.bodyTimeout, 20_000);
  assert.deepEqual(istek.headers, {
    authorization: `Basic ${Buffer.from('portal:gizli').toString('base64')}`,
    'content-type': 'application/json;charset=UTF-8',
    'rff-request-token': 'genel-belirtec',
  });
  assert.deepEqual(istek.govde, {
    logonName: 'ali',
    domain: 'ALAN',
    flowKey: 'AKIS-1',
    metaAttachmentsData: {},
    metadataData: {
      metadatas: [
        { key: 'uygulama', value: 'odeme' },
        { key: 'adet', value: '3' },
        { key: 'bos', value: '' },
      ],
    },
  });
  assert.equal(s.d.kapanan, 1, 'dispatcher kapanmadi');

  // Cagri basina domain ve ozel yol; metadata yoksa bos liste; stateInstanceId yoksa null.
  const s2 = kur(t, [tamam({ resultCode: '1000', wfInstanceId: 'X1' })], {
    SMART_CREATE_TICKET_PATH: '/ozel/ac',
  });
  const r2 = await createTicket({ flowKey: 'A', username: 'veli', domain: 'DIGER' });
  assert.equal(r2.ticketId, 'X1');
  assert.equal(r2.stateInstanceId, null);
  assert.equal(s2.d.istekler[0].path, '/ozel/ac');
  assert.equal(s2.d.istekler[0].govde.domain, 'DIGER');
  assert.deepEqual(s2.d.istekler[0].govde.metadataData.metadatas, []);
});

test('SI2 servis anahtari global belirtecin yerine gecer; belirtec yoksa baslik yok', async (t) => {
  let s = kur(t, [tamam({ resultCode: 1000, wfInstanceId: 1 })]);
  await createTicket({ flowKey: 'A', username: 'ali', integrationKey: 'servis-anahtari' });
  assert.equal(s.d.istekler[0].headers['rff-request-token'], 'servis-anahtari');

  s = kur(t, [tamam({ resultCode: 1000, wfInstanceId: 1 })], { SMART_RFF_TOKEN: undefined });
  await createTicket({ flowKey: 'A', username: 'ali' });
  assert.equal('rff-request-token' in s.d.istekler[0].headers, false);
});

test('SI3 talep reddi ve eksik wfInstanceId 502', async (t) => {
  kur(t, [
    tamam({ resultCode: 9000, resultMessage: 'Akis bulunamadi' }),
    tamam({ resultCode: 9000 }),
    { govde: '{}' },
    tamam({ resultCode: 1000 }),
  ]);
  const istek = () => createTicket({ flowKey: 'A', username: 'ali' });
  await assert.rejects(istek(), {
    status: 502,
    message: 'Smart talebi reddedildi: Akis bulunamadi',
  });
  await assert.rejects(istek(), {
    status: 502,
    message: 'Smart talebi reddedildi: resultCode=9000',
  });
  await assert.rejects(istek(), {
    status: 502,
    message: 'Smart talebi reddedildi: resultCode=yok',
  });
  await assert.rejects(istek(), (e) => {
    assert.equal(e.status, 502);
    assert.match(
      e.message,
      /^Smart yanıtında wfInstanceId bulunamadı: \{"result":\{"resultCode":1000\}\}$/,
    );
    return true;
  });
});

test('SI4 yapilandirma ya da domain eksikse istek atilmaz', async (t) => {
  for (const eksik of ['SMART_API_URL', 'SMART_API_USERNAME', 'SMART_API_PASSWORD']) {
    const s = kur(t, [], { [eksik]: undefined });
    await assert.rejects(createTicket({ flowKey: 'A', username: 'ali' }), (e) => {
      assert.equal(e.status, 503);
      assert.match(e.message, /yapılandırılmamış/);
      return true;
    });
    assert.equal(s.d.istekler.length, 0);
  }
  const s = kur(t, [], { SMART_DOMAIN: undefined, KURUM_AYAR_DOSYASI: undefined });
  await assert.rejects(createTicket({ flowKey: 'A', username: 'ali' }), (e) => {
    assert.equal(e.status, 503);
    assert.match(e.message, /login domain'i tanımlı değil/);
    return true;
  });
  assert.equal(s.d.istekler.length, 0);
});

test('SI5 log metadata degerlerini yazmaz', async (t) => {
  const s = kur(t, [tamam({ resultCode: 1000, wfInstanceId: 5 })]);
  await createTicket({
    flowKey: 'A',
    username: 'ali',
    metadata: { parola: 'Cok-Gizli-123', bos: '', sayi: 0 },
  });
  const satirlar = s.log.mock.calls.map((c) => c.arguments.join(' '));
  assert.ok(!satirlar.some((l) => l.includes('Cok-Gizli-123')), 'metadata degeri loga dustu');
  const govde = satirlar.find((l) => l.startsWith('[Smart] createTicket govdesi'));
  assert.equal(
    govde,
    '[Smart] createTicket govdesi (flowKey=A, logonName=ali): ' +
      '[{"key":"parola","value":"<dolu:13>"},{"key":"bos","value":"<bos>"},{"key":"sayi","value":"<dolu:1>"}]',
  );
  assert.ok(satirlar.some((l) => l.startsWith('[Smart] createTicket yaniti (flowKey=A):')));
});

test('SI6 HTTP 2xx disi 502; bos ve JSON olmayan govde', async (t) => {
  const uzun = `<html>${'x'.repeat(400)}</html>`;
  const s = kur(t, [
    { statusCode: 500, govde: uzun },
    { statusCode: 199, govde: '' },
    { statusCode: 200, govde: '' },
    { statusCode: 200, govde: 'duz metin' },
  ]);
  await assert.rejects(checkTicketStatus(1), (e) => {
    assert.equal(e.status, 502);
    assert.equal(e.message, `Smart API hata verdi (HTTP 500): ${uzun.slice(0, 300)}`);
    return true;
  });
  await assert.rejects(checkTicketStatus(1), {
    status: 502,
    message: 'Smart API hata verdi (HTTP 199): ',
  });
  // Bos govde {} sayilir, JSON olmayan { raw } olur: ikisinde de resultCode yok.
  await assert.rejects(checkTicketStatus(1), {
    message: 'Smart durum sorgusu başarısız: resultCode=yok',
  });
  await assert.rejects(checkTicketStatus(1), {
    message: 'Smart durum sorgusu başarısız: resultCode=yok',
  });
  assert.equal(s.d.kapanan, 4);
});

test('SI7 baglanti hatasi: tani logu, hata aynen firlatilir, dispatcher kapanir', async (t) => {
  const neden = Object.assign(new Error('baglanti reddedildi'), { code: 'ECONNREFUSED' });
  const hataNesnesi = Object.assign(new Error('fetch failed'), { code: 'UND_ERR', cause: neden });
  const s = kur(t, [{ hata: hataNesnesi }]);
  await assert.rejects(checkTicketStatus(7), (e) => e === hataNesnesi);
  assert.equal(s.d.kapanan, 1);
  const [baslik, tani] = s.hata.mock.calls[0].arguments;
  assert.equal(baslik, '[Smart] Baglanti hatasi:');
  assert.equal(
    tani.url,
    'https://smart.ornek.invalid:8443/smart/internal/requestfulfilment/loadwfinstancestatus/v1',
  );
  assert.equal(tani.nodeVersion, process.version);
  assert.equal(tani.undiciVersion, require('undici/package.json').version);
  assert.equal(tani.message, 'fetch failed');
  assert.equal(tani.code, 'UND_ERR');
  assert.equal(tani.causeMessage, 'baglanti reddedildi');
  assert.equal(tani.causeCode, 'ECONNREFUSED');
  assert.match(tani.stack, /fetch failed/);
  assert.match(tani.causeStack, /baglanti reddedildi/);

  // Nedeni olmayan hata; dispatcher kurulumu da duserse ayni tani yolu (kapatilacak dispatcher yok).
  const s2 = kur(t, [{ hata: new Error('yalin') }]);
  await assert.rejects(checkTicketStatus(7), { message: 'yalin' });
  const tani2 = s2.hata.mock.calls[0].arguments[1];
  assert.equal(tani2.code, null);
  assert.equal(tani2.causeMessage, null);
  assert.equal(tani2.causeCode, null);
  assert.equal(tani2.causeStack, null);

  const s3 = kur(t, []);
  s3.agent.mock.mockImplementation(function Bozuk() {
    throw new Error('dispatcher kurulamadi');
  });
  await assert.rejects(checkTicketStatus(7), { message: 'dispatcher kurulamadi' });
  assert.equal(s3.hata.mock.calls[0].arguments[1].message, 'dispatcher kurulamadi');
  assert.equal(s3.d.kapanan, 0);
});

test('SI8 proxy ayarliysa ProxyAgent, yoksa Agent; TLS dogrulamasi acik', async (t) => {
  let s = kur(t, [tamam({ resultCode: 1000, statusCode: 50 })]);
  await checkTicketStatus(1);
  assert.equal(s.proxy.mock.callCount(), 0);
  assert.equal(s.agent.mock.callCount(), 1);
  const { connect } = s.agent.mock.calls[0].arguments[0];
  assert.equal(connect.rejectUnauthorized, true);
  assert.equal(connect.servername, 'smart.ornek.invalid');
  assert.ok(connect.ca && connect.ca.length > 0, 'guven deposu verilmedi');

  s = kur(t, [tamam({ resultCode: 1000, statusCode: 50 })], {
    SMART_PROXY_URL: '  http://vekil.ornek.invalid:3128  ',
  });
  await checkTicketStatus(1);
  assert.equal(s.agent.mock.callCount(), 0);
  const secenek = s.proxy.mock.calls[0].arguments[0];
  assert.equal(secenek.uri, 'http://vekil.ornek.invalid:3128');
  assert.equal(secenek.requestTls.rejectUnauthorized, true);
  assert.equal(secenek.requestTls.servername, 'smart.ornek.invalid');
  assert.ok(
    s.log.mock.calls.some(
      (c) =>
        c.arguments[0] ===
        '[Smart] Proxy uzerinden baglanilacak: http://vekil.ornek.invalid:3128 -> smart.ornek.invalid',
    ),
  );
});

test('SI9 checkTicketStatus durum eslemesi', async (t) => {
  const s = kur(t, [
    tamam({ resultCode: 1000, statusCode: 1000, statusName: 'Tamamlandı' }),
    tamam({ resultCode: 1000, statusCode: '2000', statusName: 'İptal Edildi' }),
    tamam({ resultCode: 1000, statusCode: 50 }),
    tamam({ resultCode: 9000 }),
  ]);
  let r = await checkTicketStatus('4711');
  assert.deepEqual(
    { ...r, raw: undefined },
    {
      completed: true,
      rejected: false,
      stateName: 'Tamamlandı',
      statusCode: '1000',
      raw: undefined,
    },
  );
  assert.deepEqual(s.d.istekler[0].govde, { wfInstanceId: 4711 });
  r = await checkTicketStatus(1);
  assert.equal(r.rejected, true);
  assert.equal(r.completed, false);
  r = await checkTicketStatus(1);
  assert.deepEqual([r.completed, r.rejected, r.stateName, r.statusCode], [false, false, '', '50']);
  await assert.rejects(checkTicketStatus(1), {
    status: 502,
    message: 'Smart durum sorgusu başarısız: resultCode=9000',
  });

  const s2 = kur(t, [], { SMART_API_PASSWORD: undefined });
  await assert.rejects(checkTicketStatus(1), { status: 503 });
  assert.equal(s2.d.istekler.length, 0);
});

test('SI10 getFlowMetadata', async (t) => {
  const alanlar = [{ ElementName: 'uygulama', IsRequired: true }];
  const s = kur(t, [
    tamam({ resultCode: 1000, result: alanlar }),
    tamam({ resultCode: 1000 }),
    tamam({ resultCode: 9000, resultMessage: 'yetki yok' }),
    tamam({ resultCode: 9000 }),
    { govde: '{}' },
  ]);
  assert.deepEqual(await getFlowMetadata('AKIS'), alanlar);
  assert.deepEqual(s.d.istekler[0].govde, { flowName: 'AKIS' });
  assert.equal(s.d.istekler[0].path, '/smart/internal/getmetadataoperationalrequestbyflowname/v1');
  assert.deepEqual(await getFlowMetadata('AKIS'), []);
  await assert.rejects(getFlowMetadata('AKIS'), {
    status: 502,
    message: 'Smart metadata sorgusu başarısız: yetki yok',
  });
  await assert.rejects(getFlowMetadata('AKIS'), {
    message: 'Smart metadata sorgusu başarısız: resultCode=9000',
  });
  await assert.rejects(getFlowMetadata('AKIS'), {
    message: 'Smart metadata sorgusu başarısız: resultCode=yok',
  });

  kur(t, [], { SMART_API_URL: undefined });
  await assert.rejects(getFlowMetadata('AKIS'), {
    status: 503,
    message: 'Smart entegrasyonu yapılandırılmamış.',
  });
});

test('SI11 4 MB yanit tavani asilirsa govde reddedilir', async (t) => {
  const parca = 'x'.repeat(1024 * 1024);
  const s = kur(t, [{ govde: [parca, parca, parca, parca, 'y'] }]);
  await assert.rejects(checkTicketStatus(1), /Smart API/);
  assert.equal(s.d.kapanan, 1);
});
