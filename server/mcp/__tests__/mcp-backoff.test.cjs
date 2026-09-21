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
  // GERCEK BIRDEN FAZLA DENEME SART. Geri cekilme denemeleri kestigi icin
  // arka arkaya cagri yapmak yalnizca BIR deneme uretir ve kademeli log
  // davranisi olculemez — mutasyon turunda "her hatayi tam yaz" mutasyonu tam
  // bu yuzden ates almamisti. Bekleme suresi test dikisiyle 1 ms'ye cekiliyor.
  await sessiz(async (satirlar) => {
    const c = createMcpClient({
      name: 'test',
      url: ULASILMAZ,
      _backoffBaseMs: 1,
      _backoffMaxMs: 1,
    });
    for (let i = 0; i < 8; i++) {
      await c.callTool('x').catch(() => {});
      await new Promise((r) => setTimeout(r, 3)); // pencere gercekten acilsin
    }
    assert.ok(c.getStatus().consecutiveFailures >= 6, 'yeterince GERCEK deneme yapilmadi');
    const hata = satirlar.filter((l) => l.includes('Baglanti hatasi'));
    assert.ok(
      hata.length <= 4,
      `sekiz GERCEK denemede ${hata.length} tam "Baglanti hatasi" satiri — kademeli log calismiyor`,
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
  // VARSAYILANI olc, test dikisini degil. Ifade artik
  // `Number.isFinite(_backoffMaxMs) ? _backoffMaxMs : 5 * 60_000` bicimindedir;
  // kilitlenmesi gereken sey URETIMDE gecerli olan varsayilan.
  const m = /const BACKOFF_MAX_MS = [^;]*?:\s*([0-9_ *]+);/.exec(kod);
  assert.ok(m, 'tavan varsayilani tanimli degil');
  const tavan = Function(`return (${m[1].replace(/_/g, '')})`)();
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
  // DILIM BASARI DALINDAN BASLAMALI, BILDIRIMLERDEN DEGIL.
  //
  // Ilk yazdigimda `indexOf('_lastError = null;')` kullanmistim — o ifade
  // `let _lastError = null;` BILDIRIMINDE de geciyor ve dilim dosyanin
  // basindaki degisken bildirimlerine dusuyordu. Orada `let _ardArda = 0;`
  // gibi satirlar var, yani bekci SIFIRLAMAYI degil BILDIRIMI esliyordu:
  // gercek sifirlama silindiginde hicbir sey ates almiyordu.
  const i = kod.indexOf('_connectedUrl = variant;');
  assert.ok(i > 0, 'basari dali bulunamadi');
  const govde = kod.slice(i, i + 900);
  assert.ok(!govde.includes('let _ardArda'), 'dilim hala bildirimlere dusuyor');
  for (const alan of ['_ardArda = 0', '_sonrakiDeneme = 0', '_ilkHataAt = null']) {
    assert.ok(govde.includes(alan), `basarida sifirlanmiyor: ${alan}`);
  }
});
