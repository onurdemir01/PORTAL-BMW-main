// server/oco/__tests__/regex-dogrusal.test.js — Sonar S8786: OCO istemci / ayar desenleri dogrusal.
//
//   OC1 etiketleriBosluga (upstreamHint): eski `raw.replace(/<[^>]+>/g, ' ')` kapanmayan '<' kuyrugunda
//       her '<'den sona tarardi. Yeni islev indexOf ile ayni eslesmeleri bulur: '<' + en az bir karakter
//       + ilk '>'; `<>` etiket degil ('<' kalir, arama bir sonraki konumdan surer); kapanis yoksa biter.
//       Islev ve upstreamHint ciktisi eskisiyle ayni.
//   OC2 baseUrl sondaki '/' kirpma: `\/+$` -> `(?<!\/)\/+$`.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../../__tests__/fixtures/regex-esdeger.cjs');
const { etiketleriBosluga, upstreamHint } = require('../client.cjs');

const CONFIG = H.kaynak('server/oco/config.cjs');

const ETIKET = ['<', '<', '>', '>', 'a', ' ', '<>', '<b>', '</p>', '<<', '>>', '\n', 'ş', 'İ'];

test('OC1 etiketleriBosluga: eski replace ile ayni cikti, kotu girdide hizli', () => {
  H.esdeger({
    eski: (s) => s.replace(/<[^>]+>/g, ' '),
    yeni: etiketleriBosluga,
    kip: 'fn',
    tokenlar: ETIKET,
    el: ['<<a>', '<>a<b>', 'a<', '<a', 'x<>y', '<a><b>c</b>', '<<>>'],
    adet: 6000,
    enAzEslesen: 3000,
  });
  H.hizli(etiketleriBosluga, '<'.repeat(50000), { kip: 'fn' });
  H.hizli(etiketleriBosluga, '<a>'.repeat(20000) + '<'.repeat(20000), { kip: 'fn' });
});

test('OC1b upstreamHint: etiketli duz metin govdesinde eski yolla ayni ipucu', () => {
  const eskiIpucu = (text) => {
    const raw = String(text || '').trim();
    if (!raw) return '';
    try {
      const j = JSON.parse(raw);
      const m = j?.ResultMessage || j?.Message || j?.message || j?.error || '';
      return String(m || '')
        .trim()
        .slice(0, 160);
    } catch {
      /* JSON degil */
    }
    if (/<\s*(\?xml|!doctype|html|head|body|style)\b/i.test(raw)) {
      const t = /<title[^>]*>([^<]{1,120})<\/title>/i.exec(raw);
      return t ? t[1].trim() : '';
    }
    return raw
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  };
  const girdiler = H.girdiler({
    tokenlar: [...ETIKET, 'Hata', '{"Message":"x"}', '<html>'],
    adet: 3000,
  });
  for (const s of girdiler) assert.equal(upstreamHint(s), eskiIpucu(s), JSON.stringify(s));
});

test('OC2 OCO baseUrl sondaki egik cizgi kirpma: cikti ayni, kotu girdide hizli', () => {
  const yeni = H.literalAl(
    CONFIG,
    "String(process.env.OCO_API_URL || '')\n      .trim()\n      .replace(",
  );
  H.esdeger({
    eski: /\/+$/,
    yeni,
    kip: 'replace',
    tokenlar: ['/', '/', '/', 'https:', 'oco.local', 'a', ' ', '\n', 'ş'],
    enAzEslesen: 500,
  });
  H.hizli(yeni, `${'/'.repeat(50000)}a`, { kip: 'replace' });
});
