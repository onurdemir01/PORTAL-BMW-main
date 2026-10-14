// src/__tests__/guncelleme-rozeti.test.cjs — Nginx Hub sekmelerinde verinin tarihi hafif vurgulu rozetle.
//
// Kullanici (2026-10-14): "sayfalarin son guncelleme tarihini biraz daha belirgin highlight edebilirsen
// sevinirim. Cok vurucu renklere gerek yok, cok hafif." Tarih her sekmede soluk metnin icindeydi.
//   GR1 rozet renkleri TOKEN'dan (iki temada ayni hafiflik; sabit renk koyu temada okunmaz)
//   GR2 Nginx Hub'in tarih gosteren yerleri rozeti GERCEKTEN kullaniyor (import + render)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const oku = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('GR1 rozet renkleri token, sabit renk yok', () => {
  const s = oku('src/components/common/GuncellemeRozeti.tsx');
  const kod = s.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(kod, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'sabit renk var');
  assert.match(kod, /background: 'var\(--accent-bg\)'/, 'hafif aksan zemini yok');
});

test('GR2 Nginx Hub tarih yerleri rozeti kullaniyor', () => {
  const yerler = [
    'src/components/nginx_console/SourceNote.tsx',
    'src/components/denetim/NginxEnvanteri.tsx',
    'src/components/denetim/NginxApiEnvanteri.tsx',
    'src/components/denetim/NginxApiLocations.tsx',
    'src/components/denetim/NginxAudit.tsx',
    'src/components/nginx_console/CisTab.tsx',
    'src/components/nginx_console/RateLimitTab.tsx',
    'src/components/nginx_console/NginxSpaDiscovery.tsx',
  ];
  for (const f of yerler) {
    const s = oku(f);
    assert.ok(
      s.includes("import { GuncellemeRozeti } from '@/components/common/GuncellemeRozeti';"),
      `${f}: rozet import edilmemis`,
    );
    assert.match(s, /<GuncellemeRozeti\b[^>]*tarih=/, `${f}: rozet render edilmiyor`);
  }
  // Eski soluk bicim geri gelmesin
  assert.doesNotMatch(oku('src/components/nginx_console/SourceNote.tsx'), /<b[^>]*>son tarama \{scanDate\}<\/b>/);
  assert.doesNotMatch(oku('src/components/denetim/NginxEnvanteri.tsx'), /son güncelleme\{' '\}/);
});
