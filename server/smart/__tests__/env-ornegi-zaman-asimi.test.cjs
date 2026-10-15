// server/smart/__tests__/env-ornegi-zaman-asimi.test.cjs — .env.example'daki Smart zaman asimi
// satiri kodla celismesin (2026-10-15 denetim).
//
// HATA: kod 2026-09-24'ten beri varsayilan olarak SINIRSIZ (config.cjs), ama .env.example hala
// `SMART_TICKET_TIMEOUT_MINUTES=15` ve "Bos/gecersiz ise 15 dakika kullanilir" diyordu.
// deploy/setup-rhel.sh yeni ortami `cp .env.example .env.prod` ile kurdugu icin bu sablondan
// dogan her kurulum sessizce 15 dakikalik sinirla calisir - kullanicinin kaldirdigi sinir geri
// gelir ve ekrandaki sayac her OCO'suz talepte 15 dk geri sayar.
//   EE1 sablondaki deger BOS (sinirsiz); yorum "15 dakika kullanilir" DEMEZ, sinirsizi soyler
//   EE2 sablondaki deger config.cjs'ten gecince gercekten SINIRSIZ (null) olur
// Mutasyon: satira "15" geri konursa EE1 ve EE2 kirmizi olur.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ORNEK = fs.readFileSync(path.join(__dirname, '..', '..', '..', '.env.example'), 'utf8');
const ANAHTAR = 'SMART_TICKET_TIMEOUT_MINUTES';

function satir() {
  const m = ORNEK.match(new RegExp(`^${ANAHTAR}=(.*)$`, 'm'));
  assert.ok(m, `.env.example ${ANAHTAR} satirini tasimiyor (belgesiz degisken)`);
  return { deger: m[1].replace(/\r$/, '').trim(), index: m.index };
}

// Satirin hemen ustundeki yorum blogu.
function yorum(index) {
  const onceki = ORNEK.slice(0, index).split(/\r?\n/);
  onceki.pop(); // satirin kendi basi (bos)
  const blok = [];
  while (onceki.length && /^\s*#/.test(onceki[onceki.length - 1])) blok.unshift(onceki.pop());
  return blok.join('\n');
}

test('EE1 .env.example: Smart zaman asimi bos (sinirsiz), yorum kodla uyumlu', () => {
  const { deger, index } = satir();
  assert.equal(deger, '', `sablon ${ANAHTAR}=${deger} - turetilen her kurulum ${deger} dk sinirla calisir`);
  const y = yorum(index);
  assert.doesNotMatch(y, /15 dakika kullanilir/i, 'yorum kodun eski varsayilanini anlatiyor');
  assert.match(y, /SINIRI YOK|sinirsiz/i, 'yorum bos degerin SINIRSIZ demek oldugunu soylemiyor');
});

test('EE2 sablon degeri config.cjs ten gecince sinirsiz olur', () => {
  const { deger } = satir();
  const configPath = require.resolve('../config.cjs');
  const eski = process.env[ANAHTAR];
  try {
    process.env[ANAHTAR] = deger;
    delete require.cache[configPath];
    assert.equal(require('../config.cjs').getConfig().ticketTimeoutMinutes, null);
  } finally {
    if (eski === undefined) delete process.env[ANAHTAR];
    else process.env[ANAHTAR] = eski;
    delete require.cache[configPath];
  }
});
