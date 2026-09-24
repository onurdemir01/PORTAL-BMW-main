// server/audit/__tests__/spa-traffic.test.cjs — SPA "yuk aliyor mu" (2026-09-24).
//
// Kullanici: "bu uygulamalar yuk aliyor mu gormek istiyorum; en iyi access log'dan goruruz."
// Kaynak dbo.Nginx_Spa_Traffic (bmw_nginx/nginx_config_audit/files/nginx_spa_traffic.sh).
//
// Kilitlenen iddialar:
//   T1 hc.jsp / hc.html YUK SAYILMAZ - ayri tutulur.
//   T2 UC durum var: yuk var / yuk yok / BILINMIYOR. Log okunamadiysa ya da kuyruk 7 gunu
//      kapsamiyorsa "yuk yok" DENMEZ (atil sanip tanim silmeye goturebilirdi).
//   T3 Ayni tanim birden fazla mirror sunucuda: sayilar TOPLANIR, son istek en yenisi.
//   T4 Tablo yoksa ekran calismaya devam eder (trafik hic gosterilmez).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'denetim.cjs'), 'utf8');
const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'DenetimPage.tsx'), 'utf8');
// Betik tarafinin iddialari (hc ayrimi, en uzun onek eslesmesi, regex location atlama)
// Ansible deposunun KENDI bekcisindedir: bmw_nginx/tests/check_spa_traffic.py. Portal testi
// baska bir deponun diskteki yerine bagimli olmamali.
test('T1 saglik kontrolu yuke SAYILMAZ (ekran bunu soyluyor)', () => {
  assert.ok(PAGE.includes('hc.jsp / hc.html sayılmaz'), 'ekranda hc haric oldugu yazmali');
  assert.ok(PAGE.includes('Sağlık kontrolü (hariç tutuldu)'), 'ipucunda hc sayisi ayri gosterilmeli');
});

test('T2 uc durum: aktif / atil / BILINMIYOR - olculemeyen "yuk yok" sayilmaz', () => {
  assert.match(SRC, /state: c\.req7 > 0 \? 'active' : \(c\.sampled \? 'unknown' : 'idle'\)/,
    'kuyruk 7 gunu kapsamiyorsa (sampled) "atil" DENMEMELI');
  assert.match(SRC, /if \(x\.error\) \{ c\.unknown \+= 1; continue; \}/, 'log okunamayan sunucu sayiya katilmamali');
  assert.ok(PAGE.includes('“Yük yok” demek DEĞİLDİR'), 'ekranda bilinmiyor/yok ayrimi aciklanmali');
});

test('T3 mirror sunucular: sayilar toplanir, son istek en yenisi', () => {
  assert.match(SRC, /c\.req24 \+= Number\(x\.req_24h\) \|\| 0/);
  assert.match(SRC, /if \(ls && \(!c\.lastSeen \|\| ls > c\.lastSeen\)\) c\.lastSeen = ls/);
});

test('T4 tablo yoksa ekran calisir: trafik sessizce gosterilmez', () => {
  const blok = SRC.slice(SRC.indexOf('const traffic = new Map()'), SRC.indexOf('const trafficOf'));
  assert.match(blok, /catch \{/, 'tablo yoksa hata yutulmali');
  assert.match(PAGE, /data\.trafficStats\?\.ready &&/, 'veri yoksa ozet seridi hic cizilmemeli');
});
