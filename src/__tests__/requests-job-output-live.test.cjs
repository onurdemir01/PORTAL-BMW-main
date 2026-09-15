// src/__tests__/requests-job-output-live.test.cjs
//
// "Taleplerim" job ciktisi CANLI akmali (kullanici bildirimi, 2026-09-15):
// Self Servis'ten is baslatilip Smart onayi beklenirken ekran kapatildi; sonra Taleplerim
// uzerinden "Job Ciktisini Gor" acildi -> konsol acildi ama HICBIR SEY AKMADI, job o sirada
// devam edip bitti. Sebep: loadJobOutput ciktiyi TEK SEFER cekiyor, job surerken yeniden
// sormuyordu. Bekci: pencere acikken ve durum terminal degilken periyodik yeniden cekme var.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'components/self_service/RequestsSidePanel.tsx'),
  'utf8',
);
const code = SRC.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

test('JO1 job ciktisi pencere acikken periyodik yeniden cekiliyor', () => {
  // Bir useEffect icinde setInterval + ssJobStatus olmali.
  const effects = [...code.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[([^\]]*)\]\);/g)];
  const live = effects.find((m) => /setInterval/.test(m[1]) && /ssJobStatus/.test(m[1]));
  assert.ok(live, 'setInterval ile ssJobStatus cagiran bir useEffect yok — cikti tek sefer cekilir, akmaz');
  // Pencere kimligine bagli olmali ki acilinca baslayip kapaninca dursun.
  assert.match(live[2], /jobOutputOpenId/, 'efekt jobOutputOpenId degisimine bagli degil');
  assert.match(live[1], /clearInterval/, 'temizleme yok — kapaninca sorgu devam eder');
  // Terminal durumda (successful/failed/error/canceled) durmali.
  assert.match(live[1], /successful/, 'terminal durum kontrolu yok — biten job sonsuza dek sorgulanir');
  assert.match(live[1], /canceled/, 'canceled terminal sayilmiyor');
  // Cikti onbellege yazilmali (terminal bunu okur).
  assert.match(live[1], /setJobOutputCache/, 'yeni cikti onbellege yazilmiyor — terminal guncellenmez');
});
