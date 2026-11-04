// server/server-hub/__tests__/ear-envanter-rapor.test.cjs - Uygulama Envanteri CSV / agac / ZIP.
//
//   ER1  CSV hucresi: = + - @ sekme CR ile baslayan metin "'" onekli (formul calismaz); ; " satir sonu
//        tirnaklanir; sayi ve null dogrudan
//   ER2  CSV: UTF-8 BOM, ';' ayrac, CRLF; Turkce karakter bozulmaz
//   ER3  tree.txt: dizin basliklari sirali, dizin icinde mtime artan (ls -lrt), bag hedefi, arsiv
//        girisi ARSIV!/yol; OZET'te "agac yok" notu
//   ER4  arsiv adi parcasi: yol kacisi yok ('..', '/', bos); ayni adli iki uygulama ayri dizinde
//   ER5  filo ve sunucu ZIP'i gercek zip araciyla (python zipfile) acilir; icerik CSV + tree + inventory
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rapor = require('../ear-envanter-rapor.cjs');
const { zipOlustur } = require('../../util/zip-yazici.cjs');
const F = require('./fixtures/ear-envanter.cjs');

const PY = spawnSync('python3', ['-c', 'pass']).status === 0 ? 'python3' : null;

test('ER1 CSV hucresi formul enjeksiyonuna kapali', () => {
  for (const kotu of ['=HYPERLINK("x")', '+1', '-2+3', '@SUM(A1)', '\tx', '\rx'])
    assert.ok(rapor.csvHucre(kotu).replace(/^"/, '').startsWith("'"), JSON.stringify(kotu));
  assert.equal(rapor.csvHucre('a;b'), '"a;b"');
  assert.equal(rapor.csvHucre('a"b'), '"a""b"');
  assert.equal(rapor.csvHucre('a\nb'), '"a\nb"');
  assert.equal(rapor.csvHucre(-1), '-1', 'sayi onek almaz');
  assert.equal(rapor.csvHucre(null), '');
  assert.equal(rapor.csvHucre(true), '1');
  assert.equal(rapor.csvHucre('normal'), 'normal');
});

test('ER2 CSV bicimi', () => {
  const c = rapor.csv(
    [
      ['ad', (r) => r.ad],
      ['sayi', (r) => r.n],
    ],
    [
      { ad: 'ÖDEME.ear', n: 3 },
      { ad: '=x', n: null },
    ],
  );
  assert.ok(c.startsWith('\uFEFFad;sayi\r\n'));
  assert.ok(c.includes('ÖDEME.ear;3\r\n'));
  assert.ok(c.includes("'=x;\r\n"));
  for (const [g, kolonlar] of Object.entries(rapor.KOLONLAR)) assert.ok(kolonlar.length >= 5, g);
});

test('ER3 tree.txt', () => {
  const u = F.ornekUygulama({
    satirlar: [
      ['A.war/WEB-INF/lib', 'D', 'drwxr-xr-x', 1, 1, 4096, 1761000300, 20, ''],
      ['A.war/WEB-INF/lib/b.jar', 'F', '-rw-r--r--', 1, 1, 10, 1761000200, 22, ''],
      ['A.war/WEB-INF/lib/a.jar', 'F', '-rw-r--r--', 1, 1, 10, 1761000100, 21, ''],
      ['A.war/current', 'L', 'lrwxrwxrwx', 1, 1, 3, 1761000000, 23, 'v12'],
      ['P.war!/WEB-INF/web.xml', 'Z', '', '', '', 77, 1761000000, '', ''],
    ],
  });
  const t = rapor.agacMetni({
    host: 'APPSRV01',
    kosu: 5,
    uygulama: u,
    taranmaUtc: '2026-11-04T10:00:00Z',
  });
  const satirlar = t.split('\n');
  assert.ok(satirlar[0].includes('APPSRV01 /vhosting8/ORNEKPANEL.ear'));
  const libBas = satirlar.indexOf('A.war/WEB-INF/lib:');
  assert.ok(libBas > 0);
  assert.ok(
    satirlar[libBas + 1].endsWith(' a.jar') && satirlar[libBas + 2].endsWith(' b.jar'),
    'mtime artan degil',
  );
  assert.ok(t.includes(' current -> v12'));
  assert.ok(t.includes('P.war!/WEB-INF:'), 'arsiv girisi');
  assert.ok(satirlar.indexOf('A.war:') < libBas, 'dizinler sirali');
  const ozet = rapor.agacMetni({ host: 'H', kosu: 1, uygulama: F.ornekUygulama({ satirlar: [] }) });
  assert.match(ozet, /agac satiri yok/);
});

test('ER4 arsiv adi parcasi', () => {
  assert.equal(rapor.guvenliParca('..'), '_');
  assert.equal(rapor.guvenliParca('a/b'), 'a_b');
  assert.equal(rapor.guvenliParca(''), '_');
  assert.equal(rapor.guvenliParca('ÖDEME.ear'), '_DEME.ear');
  const g = rapor.hostZipGirisleri({
    host: 'APPSRV01',
    kosu: 5,
    yuk: F.ornekYuk({
      uygulamalar: [
        F.ornekUygulama({ ad: 'ÖDEME.ear' }),
        F.ornekUygulama({ ad: 'ÜDEME.ear' }),
        F.ornekUygulama({ ad: '..' }),
      ],
    }),
    uygulamaSatirlari: [],
    warSatirlari: [],
    sunucuSatiri: null,
  });
  const adlar = g.map((x) => x.ad);
  assert.equal(new Set(adlar).size, adlar.length, 'ayni ad iki kez');
  assert.ok(adlar.includes('uygulamalar/vhosting8/_DEME.ear/tree.txt'));
  assert.ok(adlar.includes('uygulamalar/vhosting8/_DEME.ear_2/tree.txt'));
  assert.ok(adlar.every((a) => !a.split('/').includes('..')));
  assert.doesNotThrow(() => zipOlustur(g));
});

test('ER5 ZIP gercek araclarla acilir', { skip: PY ? false : 'python3 yok' }, () => {
  const filo = zipOlustur(
    rapor.filoZipGirisleri({
      uygulamalar: [{ host: 'APPSRV01', ad: 'ORNEKPANEL.ear', durum: 'TAM' }],
      warlar: [],
      kutuphaneler: [{ ad: 'spring-core', surum: '7.0.9', host_sayisi: 2 }],
      sunucular: [],
      eslenikler: [
        {
          uygulama: 'A.ear',
          ortam: 'PROD',
          jboss: '8',
          karar: 'AYNI',
          host_sayisi: 2,
          hostlar: ['H1', 'H2'],
          gruplar: [],
          eksik: [],
        },
      ],
    }),
  );
  const host = zipOlustur(
    rapor.hostZipGirisleri({
      host: 'APPSRV01',
      ortam: 'PROD',
      kosu: 5,
      yuk: F.ornekYuk(),
      uygulamaSatirlari: [],
      warSatirlari: [],
      sunucuSatiri: { host: 'APPSRV01' },
    }),
  );
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ear-zip-'));
  for (const [ad, b] of [
    ['filo.zip', filo],
    ['host.zip', host],
  ]) {
    fs.writeFileSync(path.join(d, ad), b);
    const r = spawnSync(PY, [
      '-c',
      'import sys, zipfile, json\nz = zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(json.dumps({n: len(z.read(n)) for n in z.namelist()}))',
      path.join(d, ad),
    ]);
    assert.equal(r.status, 0, String(r.stderr));
    const icerik = JSON.parse(String(r.stdout));
    if (ad === 'filo.zip')
      assert.deepEqual(Object.keys(icerik).sort(), [
        'BENIOKU.txt',
        'eslenikler.csv',
        'kutuphaneler.csv',
        'sunucular.csv',
        'uygulamalar.csv',
        'warlar.csv',
      ]);
    else {
      assert.ok(icerik['uygulamalar/vhosting8/ORNEKPANEL.ear/tree.txt'] > 0);
      assert.ok(icerik['uygulamalar/vhosting8/ORNEKPANEL.ear/inventory.json'] > 0);
    }
  }
  const inv = JSON.parse(
    rapor.inventoryJson({ host: 'APPSRV01', kosu: 5, uygulama: F.ornekUygulama() }),
  );
  assert.equal(inv.agac_satiri, 2);
  assert.ok(!('satirlar' in inv.uygulama), 'inventory.json agaci tasimaz (tree.txt tasir)');
});
