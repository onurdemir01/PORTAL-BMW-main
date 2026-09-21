// server/mcp/__tests__/mcp-backoff.test.cjs
//
// MCP GERI CEKILME.
//
// OLCUM (uretim, 13,5 gun): `[MCP:dynatrace] Baglanti hatasi` 845 kez — gunde
// ~62, 13,5 gunun HER gununde, hep ayni hata:
//   `Unauthorized: no valid Dynatrace token supplied [401]`
// Yani entegrasyon HIC calismadi ve portal bunu 845 kez yeniden denedi.
// ERROR hacminin %35'i bu tek entegrasyondu; gercek hatalar altina gomuluyordu.
//
// GERI CEKILME SORUNU GIZLEMEZ: hata YINE firlatilir, yalnizca ag turu ve log
// satiri harcanmaz. `getStatus()` "N saattir basarisiz" der — ki bu, "su an bir
// hata aldim"dan cok daha kullanisli.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { createMcpClient } = require('../client.cjs');

/** Kesin BAGLANILAMAYAN adres: ayrilmis TEST-NET-1 (RFC 5737), kapali port. */
const ULASILMAZ = 'http://192.0.2.1:9/mcp';

async function sessiz(fn) {
  const l = console.log, e = console.error, w = console.warn;
  const satirlar = [];
  console.log = (...a) => satirlar.push(a.join(' '));
  console.error = (...a) => satirlar.push(a.join(' '));
  console.warn = (...a) => satirlar.push(a.join(' '));
  try {
    return await fn(satirlar);
  } finally {
    console.log = l; console.error = e; console.warn = w;
  }
}

test('MB1 ardisik hatalardan sonra AG TURU HARCANMIYOR (geri cekilme)', async () => {
  await sessiz(async () => {
    const c = createMcpClient({ name: 'test', url: ULASILMAZ });
    await assert.rejects(() => c.callTool('x'), (e) => !e.mcpBackoff);
    const d1 = c.getStatus();
    assert.ok(d1.consecutiveFailures >= 1, 'ardisik hata sayaci artmiyor');
    assert.ok(d1.retryAfter, 'geri cekilme penceresi kurulmuyor');

    const t0 = Date.now();
    await assert.rejects(
      () => c.callTool('x'),
      (e) => {
        assert.equal(e.mcpBackoff, true, 'pencere icinde yine ag turu yapiliyor');
        assert.ok(e.retryInSeconds > 0, 'kalan sure bildirilmiyor');
        return true;
      },
    );
    // Ag turu yapilmadiginin OLCUMU: neredeyse aninda donmeli.
    const gecen = Date.now() - t0;
    assert.ok(gecen < 200, `pencere icinde ${gecen} ms surdu — ag turu yapiliyor`);
  });
});

test('MB2 hata YINE firlatiliyor — sorun GIZLENMIYOR', async () => {
  await sessiz(async () => {
    const c = createMcpClient({ name: 'test', url: ULASILMAZ });
    await assert.rejects(() => c.callTool('x'));
    await assert.rejects(() => c.callTool('x'), (e) => {
      assert.match(e.message, /geri çekilmede/i, 'sebep soylenmiyor');
      assert.match(e.message, /Son hata:/, 'asil hata kayboluyor');
      return true;
    });
    assert.ok(c.getStatus().lastError, 'son hata durumda tutulmuyor');
  });
});

test('MB3 LOG KADEMELI — ayni satir tekrar tekrar yazilmiyor', async () => {
  await sessiz(async (satirlar) => {
    const c = createMcpClient({ name: 'test', url: ULASILMAZ });
    for (let i = 0; i < 5; i++) await c.callTool('x').catch(() => {});
    const hata = satirlar.filter((l) => l.includes('Baglanti hatasi'));
    assert.ok(
      hata.length <= 4,
      `bes cagride ${hata.length} "Baglanti hatasi" satiri — kademeli log calismiyor`,
    );
  });
});

test('MB4 `getStatus` NE ZAMANDIR basarisiz oldugunu soyluyor', async () => {
  await sessiz(async () => {
    const c = createMcpClient({ name: 'test', url: ULASILMAZ });
    await c.callTool('x').catch(() => {});
    const d = c.getStatus();
    assert.ok(d.failingSince, '`failingSince` yok — "N saattir basarisiz" denemez');
    assert.ok(Number.isFinite(Date.parse(d.failingSince)), '`failingSince` gecerli tarih degil');
    assert.equal(d.connected, false);
  });
});

test('MB5 geri cekilme TAVANI var (duzeltme sonsuza dek gorunmez kalmasin)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'client.cjs'), 'utf8');
  const kod = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const m = /const BACKOFF_MAX_MS = ([^;]+);/.exec(kod);
  assert.ok(m, 'tavan tanimli degil');
  const tavan = Function(`return (${m[1]})`)();
  assert.ok(tavan > 0 && tavan <= 10 * 60_000, `tavan cok buyuk (${tavan} ms) — duzeltme gec fark edilir`);
  assert.match(
    kod,
    /Math\.min\(BACKOFF_BASE_MS \* 2 \*\* \(_ardArda - 1\), BACKOFF_MAX_MS\)/,
    'ustel buyume + tavan KARAR NOKTASINDA degil',
  );
});

test('MB6 BASARIDA geri cekilme SIFIRLANIYOR', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'client.cjs'), 'utf8');
  const kod = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const i = kod.indexOf('_lastError = null;');
  assert.ok(i > 0, 'basari dali bulunamadi');
  const govde = kod.slice(i, i + 900);
  for (const alan of ['_ardArda = 0', '_sonrakiDeneme = 0', '_ilkHataAt = null']) {
    assert.ok(govde.includes(alan), `basarida sifirlanmiyor: ${alan}`);
  }
});
