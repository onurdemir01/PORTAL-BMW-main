// server/smart/__tests__/smart-domain.test.js - Smart login domain'i kod disinda (2026-11-21, K17).
//
// Domain kurum adidir; koda varsayilan olarak yazilmaz. Sira: SMART_DOMAIN (Admin > Sistem > Smart)
// > kurum ayari `smart.domain` (KURUM_AYAR_DOSYASI). Ikisi de yoksa createTicket Smart'a HIC istek
// atmadan 503 ile durur: yanlis ya da bos domain'le talep acilmaz.
//   SD1 SMART_DOMAIN verilmisse o; yoksa kurum ayarindaki deger
//   SD2 ikisi de yoksa domain bos ve createTicket istek atmadan 503
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ORNEK = path.join(__dirname, '..', '..', '..', 'deploy', 'kurum-ayari.ornek.json');

function ortamla(degerler, fn) {
  const eski = {};
  for (const [k, v] of Object.entries(degerler)) {
    eski[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const bitir = () => {
    for (const [k, v] of Object.entries(eski)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') return r.finally(bitir);
    bitir();
    return r;
  } catch (e) {
    bitir();
    throw e;
  }
}

test('SD1 SMART_DOMAIN verilmisse o; yoksa kurum ayarindaki smart.domain', () => {
  const { getConfig } = require('../config.cjs');
  ortamla({ SMART_DOMAIN: 'ACIK', KURUM_AYAR_DOSYASI: ORNEK }, () =>
    assert.equal(getConfig().domain, 'ACIK'),
  );
  ortamla({ SMART_DOMAIN: undefined, KURUM_AYAR_DOSYASI: ORNEK }, () =>
    assert.equal(getConfig().domain, 'KURUM'),
  );
});

test('SD2 ikisi de yoksa domain bos; createTicket istek atmadan 503', async () => {
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-domain-'));
  const ayar = path.join(dizin, 'kurum-ayari.json');
  fs.writeFileSync(ayar, JSON.stringify({ nginx: {} }));
  const { getConfig } = require('../config.cjs');
  const { createTicket } = require('../client.cjs');
  const eskiFetch = globalThis.fetch;
  let istek = 0;
  globalThis.fetch = async () => {
    istek += 1;
    throw new Error('istek atilmamaliydi');
  };
  try {
    await ortamla(
      {
        SMART_DOMAIN: undefined,
        KURUM_AYAR_DOSYASI: ayar,
        SMART_API_URL: 'https://smart.sirket.invalid:8443',
        SMART_API_USERNAME: 'kullanici',
        SMART_API_PASSWORD: 'deneme-degeri',
      },
      async () => {
        assert.equal(getConfig().domain, '');
        await assert.rejects(
          createTicket({ flowKey: 'akis', username: 'ayse', metadata: {} }),
          (e) => e.status === 503 && /login domain'i tanımlı değil/.test(e.message),
        );
      },
    );
  } finally {
    globalThis.fetch = eskiFetch;
  }
  assert.equal(istek, 0, "Smart'a istek atildi");
});
