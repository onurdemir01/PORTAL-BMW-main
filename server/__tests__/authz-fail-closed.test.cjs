// server/__tests__/authz-fail-closed.test.cjs — yetki karari HATA ALIRSA REDDEDER.
//
// Bu sinif bu repoda IKI KEZ gercek bulgu verdi (2026-09-07):
//   * `GET /api/logx/inventory` kimlik kapisi HIC uygulanmamisti (PR #79)
//   * FileX `/job-status` sahiplik kapisi DB hatasinda ve kayit yoksa GECIYORDU (PR #82)
//
// Ortak kok: yetki sorusu yanitlanamadiginda ERISIM VERMEK. Bilinmezlik, izin
// anlamina GELMEZ — kapinin var olma sebebi tam olarak bu durumdur.
//
// Bugun dogru desen dort yerde tutarli:
//     await restrictions.isAllowed(...).catch(() => false)
//     if (!allowed) -> reddet
// Bu bekci o deseni DONDURUR: `.catch(() => true)` gibi bir degisiklik sessizce
// gecemez.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = path.join(__dirname, '..');

function serverFiles() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '__tests__' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.cjs')) out.push(p);
    }
  })(SERVER);
  return out;
}

// Yetki KARARI veren cagrilar — "bu kullanici bunu yapabilir mi" sorusunu yanitlayanlar.
const DECISION =
  /\b(isAllowed|assertAllowed|filterAllowed|denyIfNotOwner|assertOwnership|assertNamespaceAllowed|assertAppsAllowed)\s*\(/;

test('AZ1 yetki karari hatasi IZIN olarak yorumlanmiyor', () => {
  const offenders = [];
  let chains = 0;
  for (const f of serverFiles()) {
    const src = fs.readFileSync(f, 'utf8');
    // `.catch(...)` ARGUMANI PARANTEZ ESLESTIRILEREK okunur.
    //
    // ILK HALIM KORDU: `\.catch\(([^)]*)\)` deseni kullaniyordum ve `[^)]*`
    // `() => false` ifadesinin ILK parantezinde duruyordu — yakalanan sey `(`
    // oluyordu, handler'in kendisi HIC okunmuyordu. `.catch(() => true)` yapan
    // mutasyon bu yuzden YESIL kaldi. (Isaret ilk taramanin ciktisinda zaten
    // vardi: dort satirin dordu de `.catch((` diye yazdiriliyordu.)
    const re = /(\w[\w.\s]*\([^;]{0,400}?)\.catch\(/g;
    let m;
    while ((m = re.exec(src))) {
      if (!DECISION.test(m[1])) continue;
      chains++;
      let depth = 1;
      let end = re.lastIndex;
      for (; end < src.length && depth > 0; end++) {
        if (src[end] === '(') depth++;
        else if (src[end] === ')') depth--;
      }
      const handler = src.slice(re.lastIndex, end - 1).replace(/\s+/g, ' ');
      // TEHLIKELI: hata durumunda "izin var" anlamina gelen bir deger donmek.
      if (/=>\s*(true|\[\s*\]|\{\s*\})/.test(handler)) {
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${path.relative(SERVER, f)}:${line}  .catch(${handler})`);
      }
    }
  }
  // Bekci yanlis yere bakiyorsa sessizce yesil kalmasin.
  assert.ok(
    chains >= 3,
    `yalnizca ${chains} yetki-karari zinciri bulundu — desen degismis olabilir`,
  );
  assert.deepEqual(
    offenders,
    [],
    'Yetki karari HATA ALDIGINDA IZIN VERILIYOR:\n' +
      offenders.join('\n') +
      '\n\nBilinmezlik izin anlamina gelmez. `.catch(() => false)` kullanip\n' +
      'ardindan REDDEDIN (bkz. logx/v2, opsx, telnet — dordu de boyle).',
  );
});

test('AZ2 sahiplik sorgusu DB hatasinda REDDEDIYOR (iki modulde de)', () => {
  // ScaleX ve FileX ayni soruyu yanitliyor; ikisi de DB okunamadiginda erisimi
  // KESMELI. FileX bir donem kesmiyordu (PR #82) — iki modul ayrismasin.
  for (const rel of ['scalex/index.cjs', 'filex/index.cjs']) {
    const src = fs.readFileSync(path.join(SERVER, rel), 'utf8');
    const at = src.indexOf('SELECT TOP 1 username FROM ansible_job_history');
    assert.ok(at > 0, `${rel}: sahiplik sorgusu bulunamadi`);
    // Sorgunun KENDI catch blogu — sabit pencere DEGIL.
    const catchAt = src.indexOf('catch', at);
    assert.ok(catchAt > at, `${rel}: sahiplik sorgusunun catch blogu yok`);
    const open = src.indexOf('{', catchAt);
    let depth = 0;
    let block = '';
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) {
        block = src.slice(open, i);
        break;
      }
    }
    assert.match(
      block.replace(/\s+/g, ' '),
      /return[\s\S]*50\d|status\(50\d\)/,
      `${rel}: DB hatasinda erisim REDDEDILMIYOR — bilinmezlikte kapi aciliyor`,
    );
  }
});
