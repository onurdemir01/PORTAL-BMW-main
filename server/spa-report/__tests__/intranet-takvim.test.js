// server/spa-report/__tests__/intranet-takvim.test.js - Intranet SPA gecis takvimi + set plani (2026-11-27).
//
// Kullanici: sayfa yalniz gecis listesinin 11 sutunu; gecis tarihi sayfadan Admin tarafindan duzeltilir.
// Ikinci istek: her uygulama DC basina bir satir (Pilot..Set 6 bir DC, Set 7..13 diger DC); set plani
// (tarih, DC, eski / yeni IP) Admin tarafindan duzenlenir ya da CSV ile yuklenir.
//   TK1 CSV ayristirma: BOM, ';' ve ',' ayrac, tirnak / "" kacisi / alan icinde satir sonu; set ve tarih
//       bicimleri (gg.aa.yyyy Gun, yyyy-aa-gg); gun adi tarihe uymali; Set 10 > Set 2; fazla sutun yok sayilir
//   TK1b anahtar (set, namespace, uygulama): ayni uygulama iki sette gecer, ayni sette iki kez gecmez
//   TK2 satir hatalari: eksik zorunlu sutun, gecersiz set / tarih / sira, bos ns / app, tekrar eden
//       (set, ns, app) harf duyarsiz, sutun sayisi, uzunluk, satir ve boyut siniri; hata listesi kirpilir;
//       UTF-8 olmayan dosya, yalniz baslik, tekrar eden baslik, Kubernetes disi ns / app adi
//   TK3 birlestirme: canli eslesirse route / not canli (bossa liste), ekip / e-posta LISTE (bossa canli);
//       Dynatrace yalniz olculduyse canli; takvimde olmayan canli PROD satirlari ayri; PROD satiri tercih
//       edilir; aciklama kutusu yalniz canli notu ve canli ns / app yazimini tasir; uygulamanin iki DC
//       satiri ayni canli satira eslesir
//   TK4 GET: takvim + plan + canli; canli rapor duserse liste ile devam (durum okunamadi); tablo yoksa 502
//   TK5 yetki: onizle / yukle / tarih / set / plan uclari Admin ister (401 / 403), GET herkes
//   TK6 yukleme: onizleme farki (yeni anahtarla); hatali dosya 400 ve takvim DEGISMEZ; mevcut takvimin
//       yerine gecer, plani SILMEZ; beklenenKilit tutmazsa 409; audit yazilir; 64kb'tan buyuk govde gecer
//   TK6b kilit: onizlemeden sonraki tarih duzeltmesi yuklemeyi 409 yapar (sessizce silinmez); elle
//       duzeltilmis tarih kaybi onizlemede sayilir; yeniden yuklemeden sonra eski surum tutmaz (ABA)
//   TK7 tek satir tarih: anahtar (set, ns, app), surum kilidi (409), 404, gecersiz istek 400, audit
//   TK8 takvim onizleme uyarilari: ayni DC'de iki set UYARI (hata degil), plan tarihinden farkli satir,
//       planda olmayan set; plan yoksa DC denetlenmez
//   TK9 kayit: tablolar mssql-setup'ta + Veri Katalogu'nda; govde siniri; intranet.cjs baglantisi
//   TK10 plan ayristirma: gun adi, IPv4, yinelenen set, bos / yalniz baslik, eksik sutun, DC formul
//   TK11 PUT /set: plan olusturma / duzeltme; tarih degisince setin satirlari tasinir (elle farkli
//       olanlar dahil), yalniz DC / IP degisince satir tasinmaz; plan surumu ve satir surumu 409
//       (yarim yazim yok); topla; audit; 400'ler
//   TK12 plan yukleme: onizleme farki ve "Set N: X uygulamanin tarihi degisecek" (elle kaybi dahil);
//       yukleme plani degistirir, takvimi silmez, tarihi degisen setlerin satirlarini tasir; kilit 409;
//       audit; hatali dosya 400
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const sahte = (yol, exports) => {
  require.cache[yol] = { id: yol, filename: yol, loaded: true, exports };
};
const denetim = [];
sahte(require.resolve('../../audit/index.cjs'), {
  auditPortal: (_req, eylem, o) => denetim.push({ eylem, detay: JSON.parse(o.detail) }),
});

const {
  mountTakvim,
  takvimAyristir,
  takvimUyarilari,
  tarihCoz,
  setCoz,
  birlestir,
  SINIR,
} = require('../intranet-takvim.cjs');
const { planAyristir, planFarki, ipGecerli, PLAN_SINIR } = require('../intranet-set-plani.cjs');

const BOM = String.fromCharCode(0xfeff);
const BOZUK = String.fromCharCode(0xfffd);

// ---- sahte Portal DB: yalniz intranet-takvim.cjs ve intranet-set-plani.cjs'in sorgulari ----
function sahteDb() {
  const d = { rows: [], plan: [], sorgular: [], dus: false, sayac: 0 };
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const disari = (r) => ({
    set_adi: r.set_adi,
    set_sira: r.set_sira,
    gecis_tarihi: r.gecis_tarihi,
    sira: r.sira,
    namespace: r.namespace,
    uygulama: r.uygulama,
    ekip: r.ekip,
    ekip_eposta: r.ekip_eposta,
    route_adresleri: r.route_adresleri,
    dynatrace_durumu: r.dynatrace_durumu,
    dynatrace_istek: r.dynatrace_istek,
    aciklama: r.aciklama,
    surum: r.surum,
    guncelleyen: r.guncelleyen,
    elle_tarih: r.elle_tarih,
    guncelleme: r.guncelleme,
  });
  const sirala = (a) =>
    [...a].sort(
      (x, y) =>
        x.set_sira - y.set_sira ||
        x.sira - y.sira ||
        x.namespace.localeCompare(y.namespace) ||
        x.uygulama.localeCompare(y.uygulama),
    );
  const ayni = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const satirMi = (x, p) => x.set_adi === p[0] && ayni(x.namespace, p[1]) && ayni(x.uygulama, p[2]);
  const ekle = (t, p, hedef, anahtar) => {
    const kolon = /\(([^)]*)\) VALUES/.exec(t)[1].split(', ');
    assert.equal(p.length % kolon.length, 0);
    for (let i = 0; i < p.length; i += kolon.length) {
      const r = Object.fromEntries(kolon.map((k, j) => [k, p[i + j]]));
      if (hedef().some((x) => anahtar(x, r))) throw new Error('UNIQUE ihlali');
      hedef().push({ ...r, surum: Number(r.surum), guncelleme: `g${++d.sayac}` });
    }
    return { rows: [], rowCount: p.length / kolon.length };
  };
  function planSorgusu(t, p) {
    if (t.startsWith('SELECT set_adi, set_sira') && t.includes('FROM intranet_spa_set_plani')) {
      let r = [...d.plan].sort((a, b) => a.set_sira - b.set_sira);
      if (t.includes('WHERE set_adi = $1')) r = r.filter((x) => x.set_adi === p[0]);
      return { rows: r.map((x) => ({ ...x })) };
    }
    if (t === 'SELECT MAX(surum) AS m FROM intranet_spa_set_plani WITH (UPDLOCK, HOLDLOCK)')
      return { rows: [{ m: d.plan.length ? Math.max(...d.plan.map((x) => x.surum)) : null }] };
    if (t.startsWith('INSERT INTO intranet_spa_set_plani'))
      return ekle(
        t,
        p,
        () => d.plan,
        (x, r) => x.set_adi === r.set_adi,
      );
    if (t.startsWith('UPDATE intranet_spa_set_plani')) {
      const x = d.plan.find((y) => y.set_adi === p[0]);
      Object.assign(x, {
        gecis_tarihi: p[1],
        dc: p[2],
        eski_ip: p[3],
        yeni_ip: p[4],
        surum: x.surum + 1,
        guncelleyen: p[5],
        guncelleme: `g${++d.sayac}`,
      });
      return { rows: [], rowCount: 1 };
    }
    if (t === 'DELETE FROM intranet_spa_set_plani') {
      d.plan = [];
      return { rows: [] };
    }
    return null;
  }
  function takvimSorgusu(t, p) {
    if (t.startsWith('SELECT set_adi, set_sira')) {
      let r = d.rows;
      if (t.includes('WHERE set_adi = $1 AND namespace = $2 AND uygulama = $3'))
        r = r.filter((x) => satirMi(x, p));
      else if (t.includes('WHERE set_adi = $1')) r = r.filter((x) => x.set_adi === p[0]);
      return { rows: sirala(r).map(disari) };
    }
    if (t.startsWith('SELECT TOP 1 yukleme_id, yukleyen'))
      return {
        rows: d.rows.length
          ? [
              {
                yukleme_id: d.rows[0].yukleme_id,
                yukleyen: d.rows[0].yukleyen,
                yukleme_zamani: 'z',
              },
            ]
          : [],
      };
    if (t === 'SELECT yukleme_id, surum FROM intranet_spa_takvim WITH (UPDLOCK, HOLDLOCK)')
      return { rows: d.rows.map((x) => ({ yukleme_id: x.yukleme_id, surum: x.surum })) };
    if (t.startsWith('SELECT set_adi, namespace, uygulama, surum, elle_tarih'))
      return {
        rows: d.rows.map((x) => ({
          set_adi: x.set_adi,
          namespace: x.namespace,
          uygulama: x.uygulama,
          surum: x.surum,
          elle_tarih: x.elle_tarih,
          gecis_tarihi: x.gecis_tarihi,
        })),
      };
    if (t.startsWith('SELECT namespace, uygulama, surum, CONVERT'))
      return {
        rows: d.rows
          .filter((x) => x.set_adi === p[0])
          .map((x) => ({
            namespace: x.namespace,
            uygulama: x.uygulama,
            surum: x.surum,
            gecis_tarihi: x.gecis_tarihi,
          })),
      };
    if (t === 'DELETE FROM intranet_spa_takvim') {
      d.rows = [];
      return { rows: [] };
    }
    if (t.startsWith('INSERT INTO intranet_spa_takvim'))
      return ekle(
        t,
        p,
        () => d.rows,
        (x, r) =>
          x.set_adi === r.set_adi && ayni(x.namespace, r.namespace) && ayni(x.uygulama, r.uygulama),
      );
    if (t.startsWith('UPDATE intranet_spa_takvim')) {
      const setToplu = t.includes('WHERE set_adi = $3 AND gecis_tarihi <> CONVERT(date, $1, 23)');
      const [tarih, by] = setToplu ? p : [p[3], p[4]];
      const hedef = setToplu
        ? d.rows.filter((x) => x.set_adi === p[2] && x.gecis_tarihi !== tarih)
        : d.rows.filter((x) => satirMi(x, p) && x.surum === p[5]);
      for (const x of hedef) {
        x.gecis_tarihi = tarih;
        x.surum += 1;
        x.guncelleyen = by;
        // elle_tarih SQL'in yazdigi deger (yazmiyorsa degismez): bekci SQL'i sinar, sahteyi degil
        const elle = /elle_tarih = ([01])/.exec(t);
        if (elle) x.elle_tarih = Number(elle[1]);
        x.guncelleme = `g${++d.sayac}`;
      }
      return { rows: [], rowCount: hedef.length };
    }
    return null;
  }
  async function query(sql, p = []) {
    const t = norm(sql);
    d.sorgular.push(t);
    if (d.dus) throw new Error('Invalid object name intranet_spa_takvim');
    if (d.yazimDus && /^(UPDATE|INSERT|DELETE)/.test(t) && t.includes(d.yazimDus))
      throw new Error('yazim hatasi');
    const r = planSorgusu(t, p) || takvimSorgusu(t, p);
    if (r) return r;
    throw new Error(`sahte DB bilinmeyen SQL: ${t.slice(0, 120)}`);
  }
  d.db = {
    query,
    transaction: async (work) => {
      const yedek = JSON.parse(JSON.stringify({ rows: d.rows, plan: d.plan }));
      try {
        return await work({ query });
      } catch (e) {
        d.rows = yedek.rows;
        d.plan = yedek.plan;
        throw e;
      }
    },
  };
  return d;
}

const BASLIK =
  '"set";"gecis_tarihi";"sira";"ekip";"ekip_uygulama_sayisi";"ekip_eposta";"namespace";"uygulama";"route_adresleri";"ag";"ekip_beyani";"dynatrace_durumu";"dynatrace_istek";"aciklama";"dikkat"';
const satir = (o = {}) => {
  const v = {
    set: 'Set 1',
    tarih: '03.12.2026 Perşembe',
    sira: '1',
    ekip: 'ornek-ekip',
    eposta: 'ekip@ornek.example',
    ns: 'ns-a-prod',
    app: 'app-1',
    route: 'app-1.ornek.example',
    dt: 'istek alıyor',
    istek: '120',
    not: '',
    ...o,
  };
  return [
    v.set,
    v.tarih,
    v.sira,
    v.ekip,
    '1',
    v.eposta,
    v.ns,
    v.app,
    v.route,
    'intranet',
    '',
    v.dt,
    v.istek,
    v.not,
    '',
  ]
    .map((x) => `"${String(x).replace(/"/g, '""')}"`)
    .join(';');
};
const csv = (...satirlar) => BOM + [BASLIK, ...satirlar].join('\r\n') + '\r\n';
const PLAN_BASLIK = 'set;gecis_tarihi;dc;eski_ip;yeni_ip';
const planCsv = (...satirlar) => BOM + [PLAN_BASLIK, ...satirlar].join('\r\n') + '\r\n';

test('TK1 CSV ayristirma: BOM, ayrac, tirnak kacisi, set / tarih bicimleri, fazla sutun', () => {
  const a = takvimAyristir(
    csv(
      satir({ set: 'Pilot', tarih: '01.12.2026 Salı', not: 'iki "tirnak"; ve\nyeni satir' }),
      satir({ app: 'app-2', sira: '2', tarih: '2026-12-03' }),
      '',
    ),
  );
  assert.equal(a.hataSayisi, undefined);
  assert.deepEqual(a.yoksayilanSutun, ['ekip_uygulama_sayisi', 'ag', 'ekip_beyani', 'dikkat']);
  assert.equal(a.satirlar.length, 2);
  assert.deepEqual(
    {
      set: a.satirlar[0].set,
      setSira: a.satirlar[0].setSira,
      t: a.satirlar[0].gecisTarihi,
      not: a.satirlar[0].aciklama,
    },
    { set: 'Pilot', setSira: 0, t: '2026-12-01', not: 'iki "tirnak"; ve\nyeni satir' },
  );
  assert.equal(a.satirlar[1].gecisTarihi, '2026-12-03');
  assert.equal(a.satirlar[1].sira, 2);
  // virgul ayracli, tirnaksiz, BOM'suz
  const v = takvimAyristir(
    'set,gecis_tarihi,sira,namespace,uygulama\nset 3,8.12.2026,4,ns-b,app-9\n',
  );
  assert.deepEqual(
    v.satirlar.map((s) => [s.set, s.setSira, s.gecisTarihi, s.sira, s.namespace, s.uygulama]),
    [['Set 3', 3, '2026-12-08', 4, 'ns-b', 'app-9']],
  );
  assert.equal(tarihCoz('31.02.2026'), null);
  assert.equal(tarihCoz('2026-13-01'), null);
  assert.equal(tarihCoz('01.12.1999'), null);
  assert.equal(tarihCoz('01.12.2026Salı'), null);
  assert.equal(tarihCoz('2026-12-01'), '2026-12-01');
  // gun adi tarihe uymali; harf / aksan duyarsiz
  assert.equal(tarihCoz('01.12.2026 Salı'), '2026-12-01');
  assert.equal(tarihCoz('01.12.2026 SALI'), '2026-12-01');
  assert.equal(tarihCoz('01.12.2026 sali'), '2026-12-01');
  assert.equal(tarihCoz('03.12.2026 Persembe'), '2026-12-03');
  assert.equal(tarihCoz('01.12.2026 Pazartesi'), null);
  assert.equal(tarihCoz('01.12.2026 Salı fazla'), null);
  const gun = takvimAyristir(csv(satir({ tarih: '01.12.2026 Pazartesi' })));
  assert.match(gun.hatalar[0].mesaj, /gün adı tarihe uymuyor/);
  // Set 10, Set 2'den SONRA (sayisal sira)
  assert.deepEqual(setCoz('Set 10'), { ad: 'Set 10', sira: 10 });
  assert.ok(setCoz('Set 10').sira > setCoz('Set 2').sira);
  assert.deepEqual(setCoz('SET 12'), { ad: 'Set 12', sira: 12 });
  assert.equal(setCoz('Set 0'), null);
  assert.equal(setCoz('Faz 1'), null);
});

test('TK1b anahtar (set, namespace, uygulama): iki sette gecer, ayni sette iki kez gecmez', () => {
  const a = takvimAyristir(
    csv(
      satir({ set: 'Set 1', app: 'app-1' }),
      satir({ set: 'Set 7', tarih: '17.12.2026 Perşembe', app: 'app-1' }),
      satir({ set: 'set 7', tarih: '17.12.2026 Perşembe', app: 'APP-1', sira: '2' }),
    ),
  );
  assert.deepEqual(
    a.satirlar.map((s) => [s.set, s.uygulama]),
    [
      ['Set 1', 'app-1'],
      ['Set 7', 'app-1'],
    ],
  );
  assert.equal(a.hataSayisi, 1);
  assert.equal(a.hatalar[0].satir, 4);
  assert.match(a.hatalar[0].mesaj, /Set 7 içinde ns-a-prod\/APP-1 3\. satırda da var/);
});

test('TK2 satir hatalari, sinirlar, eksik sutun, kirpilmis hata listesi', () => {
  const a = takvimAyristir(
    csv(
      satir(),
      satir({ set: 'Faz 1', app: 'app-2' }),
      satir({ tarih: '32.12.2026', app: 'app-3' }),
      satir({ sira: 'x', app: 'app-4' }),
      satir({ ns: '', app: 'app-5' }),
      satir({ app: 'APP-1' }),
      satir({ app: 'app-6', istek: '12a' }),
      satir({ app: 'app-7', not: 'x'.repeat(SINIR.aciklama + 1) }),
      '"Set 1";"03.12.2026"',
    ),
  );
  assert.equal(a.satirlar.length, 1);
  assert.equal(a.hataSayisi, 8);
  const m = Object.fromEntries(a.hatalar.map((h) => [h.satir, h.mesaj]));
  assert.match(m[3], /set geçersiz/);
  assert.match(m[4], /gecis_tarihi geçersiz/);
  assert.match(m[5], /sira geçersiz/);
  assert.match(m[6], /namespace boş/);
  assert.match(m[7], /2\. satırda da var/);
  assert.match(m[8], /dynatrace_istek sayı değil/);
  assert.match(m[9], /aciklama çok uzun/);
  assert.match(m[10], /Sütun sayısı 2/);

  const eksik = takvimAyristir('set;sira;namespace\n"Pilot";"1";"ns"\n');
  assert.deepEqual(eksik.eksikSutun, ['gecis_tarihi', 'uygulama']);
  assert.equal(eksik.hataSayisi, 1);
  assert.equal(takvimAyristir('').hatalar[0].mesaj, 'Dosya boş.');
  assert.match(takvimAyristir('x'.repeat(SINIR.metin + 1)).hatalar[0].mesaj, /çok büyük/);
  assert.match(takvimAyristir('"set;gecis\n').hatalar[0].mesaj, /Kapanmamış tırnak/);
  const cok = csv(...Array.from({ length: SINIR.satir + 1 }, (_, i) => satir({ app: `a${i}` })));
  assert.match(takvimAyristir(cok).hatalar[0].mesaj, /Çok fazla satır/);
  const hatali = csv(...Array.from({ length: 80 }, (_, i) => satir({ app: `a${i}`, sira: '0' })));
  const h = takvimAyristir(hatali);
  assert.equal(h.hataSayisi, 80);
  assert.equal(h.hatalar.length, SINIR.hata);

  // UTF-8 olmayan dosya (Excel cp1254 kaydi UTF-8 okununca U+FFFD): reddedilir.
  const bozuk = takvimAyristir(csv(satir({ ekip: `ornek-ek${BOZUK}p` })));
  assert.equal(bozuk.satirlar.length, 0);
  assert.match(bozuk.hatalar[0].mesaj, /UTF-8 değil/);
  // Yalniz baslik: gecerli SAYILMAZ (yukleme takvimi silerdi).
  for (const yalniz of [
    'set;gecis_tarihi;sira;namespace;uygulama\r\n',
    csv(),
    'set;gecis_tarihi;sira;namespace;uygulama\r\n;;;;\r\n',
  ]) {
    const y = takvimAyristir(yalniz);
    assert.equal(y.hataSayisi, 1, JSON.stringify(yalniz));
    assert.match(y.hatalar[0].mesaj, /Veri satırı yok/);
  }
  // Tekrar eden baslik sessizce sonuncuyu almaz.
  const tekrar = takvimAyristir(
    'set;gecis_tarihi;sira;namespace;uygulama;SET\nPilot;01.12.2026;1;ns-a;app-1;Set 2\n',
  );
  assert.match(tekrar.hatalar[0].mesaj, /tekrar eden sütun: set/);
  assert.equal(tekrar.satirlar.length, 0);
  // Kubernetes disi ad: '/' anahtar cakismasi ve formul baslangici giremez.
  const ad = takvimAyristir(
    csv(
      satir({ ns: '=cmd', app: 'app-1' }),
      satir({ ns: 'a', app: 'b/c' }),
      satir({ ns: 'a/b', app: 'c' }),
      satir({ ns: 'ns-b', app: '@app' }),
      satir({ ns: 'Ns-B', app: 'app-1' }),
      satir({ ns: 'ns-b', app: 'app.v2-1' }),
    ),
  );
  assert.equal(ad.hataSayisi, 5);
  assert.deepEqual(
    ad.hatalar.map((x) => /(namespace|uygulama) geçersiz ad/.exec(x.mesaj)?.[1]),
    ['namespace', 'uygulama', 'namespace', 'uygulama', 'namespace'],
  );
  assert.deepEqual(
    ad.satirlar.map((x) => x.uygulama),
    ['app.v2-1'],
  );
});

const T = (uygulama, o = {}) => ({
  set: 'Set 1',
  setSira: 1,
  gecisTarihi: '2026-12-03',
  sira: 1,
  namespace: 'ns-a-prod',
  uygulama,
  ekip: 'liste-ekip',
  ekip_eposta: 'liste@ornek.example',
  route_adresleri: 'liste.ornek.example',
  dynatrace_durumu: 'istek alıyor',
  dynatrace_istek: '5',
  aciklama: 'liste notu',
  surum: 1,
  guncelleyen: null,
  guncelleme: null,
  ...o,
});
const C = (application, o = {}) => ({
  env: 'PROD',
  namespace: 'ns-a-prod',
  application,
  ekip: ['canli-ekip'],
  ekipEposta: ['canli@ornek.example'],
  adresler: ['a.ornek.example', 'b.ornek.example'],
  istek: 'var',
  req: 900,
  inUse: 'yes',
  note: 'canli not',
  ...o,
});

test('TK3 birlestirme: alan onceligi, olcum kurali, takvimde yok, iki DC satiri', () => {
  const { rows, takvimdeYok } = birlestir(
    [
      T('app-1'),
      T('APP-2'),
      T('app-3'),
      T('app-4', { namespace: 'ns-z-prod' }),
      T('app-5'),
      T('app-6', { ekip: '', ekip_eposta: '' }),
      T('app-1', { set: 'Set 8', setSira: 8, gecisTarihi: '2026-12-19' }),
    ],
    {
      rows: [
        C('app-1'),
        C('app-2', { ekip: [], ekipEposta: [], adresler: [], note: '', istek: 'olculemedi' }),
        C('app-3', { istek: 'servis-yok', req: null }),
        C('app-5', { env: 'TEST', note: 'test notu' }),
        C('app-5', { note: 'prod notu' }),
        C('app-x', { namespace: 'ns-b-prod', ekip: ['e1', 'e2'] }),
        C('app-y', { env: 'TEST' }),
        C('app-6'),
      ],
    },
  );
  const [r1, r2, r3, r4, r5, r6, r7] = rows;
  // EKIP LISTEDEN: sira set icindeki ekip sirasidir; canli ekip listeyi ezmez.
  assert.deepEqual(
    [r1.ekip, r1.ekipEposta, r1.routeAdresleri, r1.dynatraceDurumu, r1.dynatraceIstek, r1.aciklama],
    [
      'liste-ekip',
      'liste@ornek.example',
      'a.ornek.example b.ornek.example',
      'istek alıyor',
      '900',
      'canli not',
    ],
  );
  assert.equal(r1.canli, true);
  assert.equal(r1.inUse, 'yes');
  assert.deepEqual(r1.kaynak, {
    ekip: 'liste',
    ekipEposta: 'liste',
    routeAdresleri: 'canli',
    dynatrace: 'canli',
    aciklama: 'canli',
  });
  assert.deepEqual([r1.canliNot, r1.listeAciklama], ['canli not', 'liste notu']);
  // ikinci DC satiri ayni canli satira eslesir, kendi set / tarihini korur
  assert.deepEqual(
    [r7.set, r7.gecisTarihi, r7.canli, r7.routeAdresleri, r7.aciklama],
    ['Set 8', '2026-12-19', true, 'a.ornek.example b.ornek.example', 'canli not'],
  );
  // listede ekip bossa canli
  assert.deepEqual(
    [r6.ekip, r6.ekipEposta, r6.kaynak.ekip, r6.kaynak.ekipEposta],
    ['canli-ekip', 'canli@ornek.example', 'canli', 'canli'],
  );
  // harf duyarsiz eslesir; canli bos / olculemedi listeyi EZMEZ
  assert.equal(r2.canli, true);
  assert.deepEqual(
    [r2.ekip, r2.routeAdresleri, r2.dynatraceDurumu, r2.dynatraceIstek, r2.aciklama],
    ['liste-ekip', 'liste.ornek.example', 'istek alıyor', '5', 'liste notu'],
  );
  assert.equal(r2.kaynak.dynatrace, 'liste');
  // aciklama kutusu canli notu tasir (bos), liste metni ayri; yazim canli yazimla gider
  assert.deepEqual(
    [r2.canliNot, r2.listeAciklama, r2.canliNamespace, r2.canliUygulama, r2.uygulama],
    ['', 'liste notu', 'ns-a-prod', 'app-2', 'APP-2'],
  );
  assert.deepEqual([r3.dynatraceDurumu, r3.dynatraceIstek], ['Dynatrace servisi yok', '']);
  assert.equal(r4.canli, false);
  assert.equal(r4.inUse, null);
  assert.deepEqual([r4.canliNot, r4.canliNamespace, r4.canliUygulama], [null, null, null]);
  assert.equal(r4.ekip, 'liste-ekip');
  assert.equal(r5.aciklama, 'prod notu');
  assert.deepEqual(takvimdeYok, [{ namespace: 'ns-b-prod', uygulama: 'app-x', ekip: 'e1 e2' }]);
  // canli yok: hepsi listeden
  const bos = birlestir([T('app-1')], null);
  assert.equal(bos.rows[0].ekip, 'liste-ekip');
  assert.deepEqual(bos.takvimdeYok, []);
});

async function sunucu(d, { rol = 'Admin', rapor } = {}) {
  const app = express();
  // Uretimle ayni sira: global 2mb (service.cjs), ardindan intranet router'inin 64kb'i (index.cjs).
  app.use(express.json({ limit: '2mb' }));
  app.use(express.json({ limit: '64kb' }));
  app.use((req, _res, next) => {
    if (rol) req.session = { user: { username: 'onur', role: rol } };
    next();
  });
  const router = express.Router();
  mountTakvim(router, {
    db: d.db,
    loadIntranet: async () => {
      if (rapor instanceof Error) throw rapor;
      return rapor || { ok: true, rows: [], kesifTarihi: '2026-11-27' };
    },
  });
  app.use('/api/spa-report', router);
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}/api/spa-report/intranet/takvim`;
  const istek = async (yol, yontem = 'GET', govde) => {
    const r = await fetch(`${base}${yol}`, {
      method: yontem,
      headers: { 'Content-Type': 'application/json' },
      body: govde === undefined ? undefined : JSON.stringify(govde),
    });
    return { status: r.status, body: await r.json() };
  };
  return { s, istek };
}

const yukluDb = async () => {
  const d = sahteDb();
  const { s, istek } = await sunucu(d);
  const r = await istek('/yukle', 'POST', {
    metin: csv(
      satir({ set: 'Pilot', tarih: '01.12.2026 Salı' }),
      satir({ app: 'app-2', sira: '1' }),
      satir({ app: 'app-3', sira: '2' }),
    ),
    beklenenKilit: null,
  });
  s.close();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return d;
};

const PLAN = (set, sira, tarih, dc, surum = 1, o = {}) => ({
  set_adi: set,
  set_sira: sira,
  gecis_tarihi: tarih,
  dc,
  eski_ip: '192.0.2.10',
  yeni_ip: '192.0.2.20',
  surum,
  guncelleyen: null,
  guncelleme: 'g0',
  ...o,
});

test('TK4 GET: takvim + plan + canli; canli duserse liste; tablo yoksa 502', async (t) => {
  const d = await yukluDb();
  d.plan.push(PLAN('Set 1', 1, '2026-12-03', 'DC-A'), PLAN('Pilot', 0, '2026-12-01', 'DC-A'));
  const { s, istek } = await sunucu(d, {
    rol: 'User',
    rapor: { ok: true, kesifTarihi: '2026-11-27', rows: [C('app-2'), C('app-n')] },
  });
  t.after(() => s.close());
  let r = await istek('');
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.rows.map((x) => [x.set, x.gecisTarihi, x.sira, x.uygulama, x.ekip]),
    [
      ['Pilot', '2026-12-01', 1, 'app-1', 'ornek-ekip'],
      ['Set 1', '2026-12-03', 1, 'app-2', 'ornek-ekip'],
      ['Set 1', '2026-12-03', 2, 'app-3', 'ornek-ekip'],
    ],
  );
  // plan ayni yanitta, set sirasiyla
  assert.deepEqual(
    r.body.plan.map((p) => [p.set, p.setSira, p.gecisTarihi, p.dc, p.eskiIp, p.yeniIp, p.surum]),
    [
      ['Pilot', 0, '2026-12-01', 'DC-A', '192.0.2.10', '192.0.2.20', 1],
      ['Set 1', 1, '2026-12-03', 'DC-A', '192.0.2.10', '192.0.2.20', 1],
    ],
  );
  assert.equal(r.body.canli.durum, 'var');
  // canli eslesen satirda route canlidan
  assert.equal(r.body.rows[1].routeAdresleri, 'a.ornek.example b.ornek.example');
  assert.equal(r.body.yukleme.yukleyen, 'onur');
  assert.deepEqual(
    r.body.takvimdeYok.map((x) => x.uygulama),
    ['app-n'],
  );

  const d2 = await yukluDb();
  const k = await sunucu(d2, { rol: 'User', rapor: new Error('kesif zaman asimi') });
  r = await k.istek('');
  k.s.close();
  assert.equal(r.status, 200);
  assert.equal(r.body.canli.durum, 'okunamadi');
  assert.equal(r.body.canli.message, 'kesif zaman asimi');
  assert.equal(r.body.rows[1].ekip, 'ornek-ekip');
  assert.deepEqual(r.body.plan, []);

  d2.dus = true;
  const k2 = await sunucu(d2, { rol: 'User' });
  r = await k2.istek('');
  k2.s.close();
  assert.equal(r.status, 502);
  assert.equal(r.body.ok, false);
});

test('TK5 yetki: yazma uclari Admin ister, GET herkes', async (t) => {
  const d = await yukluDb();
  d.plan.push(PLAN('Set 1', 1, '2026-12-03', 'DC-A'));
  const u = await sunucu(d, { rol: 'User' });
  const yok = await sunucu(d, { rol: null });
  t.after(() => {
    u.s.close();
    yok.s.close();
  });
  const govde = {
    metin: planCsv('Set 1;10.12.2026 Perşembe;DC-B;;'),
    set: 'Set 1',
    gecisTarihi: '2026-12-10',
    beklenenSurum: 1,
    beklenen: { 'ns-a-prod/app-2': 1, 'ns-a-prod/app-3': 1 },
  };
  for (const [yol, yontem] of [
    ['/onizle', 'POST'],
    ['/yukle', 'POST'],
    ['/tarih', 'PUT'],
    ['/set', 'PUT'],
    ['/plan/onizle', 'POST'],
    ['/plan/yukle', 'POST'],
  ]) {
    assert.equal((await u.istek(yol, yontem, govde)).status, 403, yol);
    assert.equal((await yok.istek(yol, yontem, govde)).status, 401, yol);
  }
  assert.equal((await u.istek('')).status, 200);
  assert.equal((await yok.istek('')).status, 401, 'oturumsuz GET gecti');
  assert.equal(d.rows.length, 3, 'yetkisiz istek takvime dokundu');
  assert.ok(
    d.rows.every((x) => x.surum === 1),
    'yetkisiz istek satir yazdi',
  );
  assert.deepEqual(
    d.plan.map((p) => [p.set_adi, p.gecis_tarihi, p.dc, p.surum]),
    [['Set 1', '2026-12-03', 'DC-A', 1]],
    'yetkisiz istek plana dokundu',
  );
});

test('TK6 yukleme: onizleme farki, hatali dosya reddi, yer degistirme, 409, audit, buyuk govde', async (t) => {
  const d = await yukluDb();
  d.plan.push(PLAN('Set 1', 1, '2026-12-03', 'DC-A'));
  const { s, istek } = await sunucu(d);
  t.after(() => s.close());
  const ilkYukleme = d.rows[0].yukleme_id;
  const yeni = csv(
    satir({ app: 'app-2', tarih: '10.12.2026 Perşembe' }),
    satir({ app: 'app-4', sira: '3', route: 'r'.repeat(3000) }),
    ...Array.from({ length: 60 }, (_, i) =>
      satir({
        ns: 'ns-c-prod',
        app: `c${i}`,
        set: 'Set 2',
        sira: String(i + 1),
        tarih: '08.12.2026',
        not: 'n'.repeat(600),
        route: 'r'.repeat(2000),
      }),
    ),
    // app-3 Set 1'den Set 2'ye: yeni anahtarla bir yeni + bir cikacak
    satir({ app: 'app-3', set: 'Set 2', sira: '61', tarih: '08.12.2026' }),
  );
  assert.ok(Buffer.byteLength(JSON.stringify({ metin: yeni })) > 64 * 1024, 'govde 64kb altinda');
  let r = await istek('/onizle', 'POST', { metin: yeni });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.gecerli, true);
  assert.equal(r.body.satir, 63);
  assert.deepEqual(r.body.fark, {
    mevcut: 3,
    yeni: 62,
    kalkan: 2,
    tarihDegisen: 1,
    elleKaybolan: 0,
  });
  assert.deepEqual(r.body.setler, [
    { set: 'Set 1', satir: 2, tarihler: ['2026-12-03', '2026-12-10'] },
    { set: 'Set 2', satir: 61, tarihler: ['2026-12-08'] },
  ]);
  assert.equal(r.body.yukleme.id, ilkYukleme);
  const kilit = r.body.yukleme.kilit;
  assert.equal(kilit, `${ilkYukleme}:3:3`);

  denetim.length = 0;
  r = await istek('/yukle', 'POST', {
    metin: csv(satir({ sira: 'x' })),
    beklenenKilit: kilit,
  });
  assert.equal(r.status, 400);
  assert.match(r.body.hatalar[0].mesaj, /sira geçersiz/);
  assert.equal(d.rows.length, 3, 'hatali dosya takvimi degistirdi');

  r = await istek('/yukle', 'POST', { metin: yeni, beklenenKilit: 'baska-yukleme:3:3' });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'takvim_cakisma');
  assert.equal(d.rows.length, 3);
  assert.equal(denetim.length, 0);

  r = await istek('/yukle', 'POST', { metin: yeni, beklenenKilit: null });
  assert.equal(r.status, 409, 'dolu takvim kilitsiz yuklemeyle ezildi');
  r = await istek('/yukle', 'POST', { metin: yeni, beklenenKilit: kilit });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.satir, 63);
  assert.equal(d.rows.length, 63);
  assert.ok(!d.rows.some((x) => x.uygulama === 'app-1'), 'eski takvim kalmis');
  assert.ok(d.rows.every((x) => x.yukleme_id === r.body.yukleme && x.yukleme_id !== ilkYukleme));
  assert.equal(d.rows.find((x) => x.uygulama === 'app-2').gecis_tarihi, '2026-12-10');
  // takvim yuklemesi set planini SILMEZ
  assert.deepEqual(
    d.plan.map((p) => p.set_adi),
    ['Set 1'],
  );
  // INSERT parca parca (50 satir) gider
  assert.equal(
    d.sorgular.filter((q) => q.startsWith('INSERT INTO intranet_spa_takvim')).length,
    2 + 1,
  );
  assert.equal(denetim.length, 1);
  assert.equal(denetim[0].eylem, 'intranet_spa_takvim_yukle');
  assert.deepEqual(denetim[0].detay.setler, ['Set 1:2', 'Set 2:61']);
  assert.equal(denetim[0].detay.onceki, ilkYukleme);
  // yeni takvim eski takvimin en buyuk surumunun ustunden baslar; yukleme guncelleyen yazmaz
  assert.ok(d.rows.every((x) => x.surum === 2 && !x.guncelleyen));
});

test('TK6b kilit: onizleme sonrasi duzeltme 409, elle duzeltme kaybi sayilir, ABA yok', async (t) => {
  const d = await yukluDb();
  const { s, istek } = await sunucu(d);
  t.after(() => s.close());
  const ayniPlan = csv(
    satir({ set: 'Pilot', tarih: '01.12.2026 Salı' }),
    satir({ app: 'app-2', sira: '1' }),
    satir({ app: 'app-3', sira: '2' }),
  );
  let r = await istek('/onizle', 'POST', { metin: ayniPlan });
  const kilit = r.body.yukleme.kilit;
  assert.equal(r.body.fark.elleKaybolan, 0);
  // Onizlemeden SONRA baska bir Admin tarih duzeltir.
  r = await istek('/tarih', 'PUT', {
    set: 'Set 1',
    namespace: 'ns-a-prod',
    uygulama: 'app-2',
    tarih: '2026-12-04',
    beklenenSurum: 1,
  });
  assert.equal(r.status, 200);
  r = await istek('/yukle', 'POST', { metin: ayniPlan, beklenenKilit: kilit });
  assert.equal(r.status, 409, 'yukleme onizleme sonrasi duzeltmeyi sessizce sildi');
  assert.equal(d.rows.find((x) => x.uygulama === 'app-2').gecis_tarihi, '2026-12-04');
  // Tazelenen onizleme kaybi soyler; duzeltilmis tarihle ayni liste kayip saymaz.
  r = await istek('/onizle', 'POST', { metin: ayniPlan });
  assert.equal(r.body.fark.elleKaybolan, 1);
  assert.notEqual(r.body.yukleme.kilit, kilit);
  const duzeltilmis = csv(
    satir({ set: 'Pilot', tarih: '01.12.2026 Salı' }),
    satir({ app: 'app-2', sira: '1', tarih: '04.12.2026 Cuma' }),
    satir({ app: 'app-3', sira: '2' }),
  );
  assert.equal((await istek('/onizle', 'POST', { metin: duzeltilmis })).body.fark.elleKaybolan, 0);
  // Uygulama baska sete giderse elle duzeltmesi de kaybolur (anahtar set dahil).
  const tasinmis = csv(
    satir({ set: 'Pilot', tarih: '01.12.2026 Salı' }),
    satir({ set: 'Set 2', app: 'app-2', sira: '1', tarih: '04.12.2026 Cuma' }),
    satir({ app: 'app-3', sira: '2' }),
  );
  assert.equal((await istek('/onizle', 'POST', { metin: tasinmis })).body.fark.elleKaybolan, 1);
  const yeniKilit = r.body.yukleme.kilit;
  // Eski ekran app-3'u surum 1 ile goruyor; arada takvim yeniden yukleniyor.
  r = await istek('/yukle', 'POST', { metin: ayniPlan, beklenenKilit: yeniKilit });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(
    d.rows.every((x) => x.surum === 3),
    JSON.stringify(d.rows.map((x) => x.surum)),
  );
  r = await istek('/tarih', 'PUT', {
    set: 'Set 1',
    namespace: 'ns-a-prod',
    uygulama: 'app-3',
    tarih: '2026-12-11',
    beklenenSurum: 1,
  });
  assert.equal(r.status, 409, 'eski ekran yeniden yuklenen takvimin ustune yazdi (ABA)');
  r = await istek('/set', 'PUT', {
    set: 'Set 1',
    gecisTarihi: '2026-12-11',
    beklenenSurum: 0,
    beklenen: { 'ns-a-prod/app-2': 1, 'ns-a-prod/app-3': 1 },
  });
  assert.equal(r.status, 409, 'eski ekran set toplu yazimi yeni takvimin ustune yazdi (ABA)');
  assert.ok(d.rows.every((x) => x.gecis_tarihi !== '2026-12-11'));
  assert.deepEqual(d.plan, [], 'reddedilen set yazimi plani olusturdu');
});

test('TK7 tek satir tarih: anahtar set dahil, surum kilidi, 404, 400, audit', async (t) => {
  const d = await yukluDb();
  // ayni uygulama ikinci DC'nin setinde de var
  d.rows.push({
    ...d.rows.find((x) => x.uygulama === 'app-2'),
    set_adi: 'Set 8',
    set_sira: 8,
    gecis_tarihi: '2026-12-19',
  });
  const { s, istek } = await sunucu(d);
  t.after(() => s.close());
  denetim.length = 0;
  let r = await istek('/tarih', 'PUT', {
    set: 'set 1',
    namespace: 'ns-a-prod',
    uygulama: 'app-2',
    tarih: '2026-12-04',
    beklenenSurum: 1,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(
    r.body.rows.map((x) => [x.set, x.uygulama, x.gecisTarihi, x.surum, x.guncelleyen]),
    [['Set 1', 'app-2', '2026-12-04', 2, 'onur']],
  );
  assert.equal(d.rows.find((x) => x.uygulama === 'app-3').gecis_tarihi, '2026-12-03');
  // diger DC'nin satiri DEGISMEDI
  const diger = d.rows.find((x) => x.set_adi === 'Set 8');
  assert.deepEqual([diger.gecis_tarihi, diger.surum], ['2026-12-19', 1]);
  assert.deepEqual(denetim, [
    {
      eylem: 'intranet_spa_takvim_tarih',
      detay: {
        set: 'Set 1',
        namespace: 'ns-a-prod',
        uygulama: 'app-2',
        eski: '2026-12-03',
        yeni: '2026-12-04',
      },
    },
  ]);
  // ayni eski surumle ikinci yazim: 409 ve guncel satir doner
  r = await istek('/tarih', 'PUT', {
    set: 'Set 1',
    namespace: 'ns-a-prod',
    uygulama: 'app-2',
    tarih: '2026-12-05',
    beklenenSurum: 1,
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.satir.surum, 2);
  assert.equal(d.rows.find((x) => x.uygulama === 'app-2').gecis_tarihi, '2026-12-04');
  for (const govde of [
    {
      set: 'Set 1',
      namespace: 'ns-a-prod',
      uygulama: 'yok',
      tarih: '2026-12-05',
      beklenenSurum: 1,
    },
    {
      set: 'Set 3',
      namespace: 'ns-a-prod',
      uygulama: 'app-2',
      tarih: '2026-12-05',
      beklenenSurum: 1,
    },
  ])
    assert.equal((await istek('/tarih', 'PUT', govde)).status, 404, JSON.stringify(govde));
  for (const govde of [
    {
      set: 'Set 1',
      namespace: 'ns-a-prod',
      uygulama: 'app-2',
      tarih: '05.13.2026',
      beklenenSurum: 2,
    },
    { set: 'Set 1', namespace: 'ns-a-prod', uygulama: 'app-2', tarih: '2026-12-05' },
    { set: 'Set 1', tarih: '2026-12-05', beklenen: {} },
    { namespace: 'ns-a-prod', uygulama: 'app-2', tarih: '2026-12-05', beklenenSurum: 2 },
    {
      set: 'Faz',
      namespace: 'ns-a-prod',
      uygulama: 'app-2',
      tarih: '2026-12-05',
      beklenenSurum: 2,
    },
  ])
    assert.equal((await istek('/tarih', 'PUT', govde)).status, 400, JSON.stringify(govde));
  assert.equal(denetim.length, 1);
});

test('TK8 takvim onizleme uyarilari: ayni DC iki set UYARI, plan tarihi farki, planda olmayan set', async (t) => {
  const S = (set, setSira, uygulama, gecisTarihi, o = {}) => ({
    set,
    setSira,
    namespace: 'ns-a-prod',
    uygulama,
    gecisTarihi,
    ...o,
  });
  const P = (set, dc, gecisTarihi) => ({ set, dc, gecisTarihi });
  const plan = [
    P('Set 1', 'DC-A', '2026-12-08'),
    P('Set 2', 'DC-A', '2026-12-09'),
    P('Set 7', 'DC-B', '2026-12-17'),
    P('Set 9', '', '2026-12-22'),
    P('Set 10', '', '2026-12-23'),
  ];
  const u = takvimUyarilari(
    [
      S('Set 1', 1, 'app-1', '2026-12-08'),
      S('Set 7', 7, 'app-1', '2026-12-17'), // farkli DC: uyari YOK
      S('Set 2', 2, 'app-1', '2026-12-09'), // ayni DC'de ikinci set: UYARI
      S('Set 1', 1, 'app-2', '2026-12-10'), // plan tarihinden farkli
      S('Set 9', 9, 'app-3', '2026-12-22'), // DC bos: denetlenmez
      S('Set 10', 10, 'app-3', '2026-12-23'),
      S('Set 12', 12, 'app-4', '2026-12-26'), // planda yok
    ],
    plan,
  );
  assert.deepEqual(u, [
    'ns-a-prod/app-1 aynı DC’de (DC-A) 2 sette: Set 1, Set 2.',
    'Set 1: 1 uygulamanın tarihi set planındaki tarihten (2026-12-08) farklı.',
    'Set planında olmayan set: Set 12.',
  ]);
  // DC harf duyarsiz ayni sayilir
  assert.equal(
    takvimUyarilari(
      [S('Set 1', 1, 'app-1', '2026-12-08'), S('Set 2', 2, 'APP-1', '2026-12-09')],
      [P('Set 1', 'DC-A', '2026-12-08'), P('Set 2', 'dc-a', '2026-12-09')],
    ).length,
    1,
  );
  // plan yoksa DC denetlenmez ve bu soylenir
  assert.deepEqual(takvimUyarilari([S('Set 1', 1, 'app-1', '2026-12-08')], []), [
    'Set planı yok: aynı uygulamanın aynı DC’de iki sette olması denetlenmedi.',
  ]);

  // Uc: uyari onizlemeyi GECERSIZ yapmaz
  const d = sahteDb();
  d.plan.push(PLAN('Set 1', 1, '2026-12-03', 'DC-A'), PLAN('Set 2', 2, '2026-12-08', 'DC-A'));
  const { s, istek } = await sunucu(d);
  t.after(() => s.close());
  const r = await istek('/onizle', 'POST', {
    metin: csv(satir(), satir({ set: 'Set 2', tarih: '08.12.2026 Salı' })),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.gecerli, true);
  assert.equal(r.body.hataSayisi, 0);
  assert.equal(r.body.uyariSayisi, 1);
  assert.match(r.body.uyarilar[0], /aynı DC’de \(DC-A\) 2 sette: Set 1, Set 2/);
});

test('TK9 kayit: tablolar + katalog + govde siniri + intranet.cjs baglantisi', () => {
  const KOK = path.join(__dirname, '..', '..', '..');
  const oku = (p) => fs.readFileSync(path.join(KOK, p), 'utf8');
  const kurulum = oku('server/db/mssql-setup.cjs');
  assert.match(kurulum, /CREATE TABLE intranet_spa_takvim \(/);
  assert.match(
    kurulum,
    /CONSTRAINT UQ_intranet_spa_takvim UNIQUE \(set_adi, namespace, uygulama\)/,
  );
  assert.match(kurulum, /CREATE TABLE intranet_spa_set_plani \(/);
  assert.match(kurulum, /CONSTRAINT UQ_intranet_spa_set_plani UNIQUE \(set_adi\)/);
  const katalog = JSON.parse(oku('server/katalog/tablolar.json'));
  for (const tablo of ['intranet_spa_takvim', 'intranet_spa_set_plani'])
    assert.ok(
      katalog.some((k) => k.db === 'Portal' && k.tablo === tablo),
      tablo,
    );
  // GOVDE: global 2mb ayristirici (service.cjs) router'lardan once okur; metin siniri en kotu
  // durumda (karakter basina 3 bayt) 2mb'a sigmali, yoksa kullanici acik mesaj yerine 413 gorur.
  assert.match(oku('server/service.cjs'), /app\.use\(express\.json\(\{ limit: '2mb' \}\)\)/);
  assert.ok(SINIR.metin * 3 + 1024 < 2 * 1024 * 1024, 'metin siniri 2mb govdeye sigmiyor');
  assert.match(
    oku('server/spa-report/intranet.cjs'),
    /require\('\.\/intranet-takvim\.cjs'\)\.mountTakvim\(router/,
  );
});

test('TK10 plan ayristirma: gun adi, IPv4, yinelenen set, bos, eksik sutun, DC', () => {
  const a = planAyristir(
    planCsv(
      'Set 10;23.12.2026 Çarşamba;DC-B;198.51.100.41;198.51.100.42',
      'Pilot;03.12.2026 Perşembe;DC-A;192.0.2.41;192.0.2.42',
      'Set 2;09.12.2026 Çarşamba;DC-A;;',
    ),
  );
  assert.equal(a.hataSayisi, undefined);
  // Pilot, Set 2, Set 10 (sayisal)
  assert.deepEqual(a.satirlar, [
    {
      set: 'Pilot',
      setSira: 0,
      gecisTarihi: '2026-12-03',
      dc: 'DC-A',
      eskiIp: '192.0.2.41',
      yeniIp: '192.0.2.42',
    },
    { set: 'Set 2', setSira: 2, gecisTarihi: '2026-12-09', dc: 'DC-A', eskiIp: '', yeniIp: '' },
    {
      set: 'Set 10',
      setSira: 10,
      gecisTarihi: '2026-12-23',
      dc: 'DC-B',
      eskiIp: '198.51.100.41',
      yeniIp: '198.51.100.42',
    },
  ]);
  const h = planAyristir(
    planCsv(
      'Pilot;03.12.2026 Perşembe;DC-A;192.0.2.41;192.0.2.42',
      'Pilot;04.12.2026 Cuma;DC-A;;',
      'Set 1;08.12.2026 Pazartesi;DC-A;;',
      'Set 2;09.12.2026;DC-A;192.0.2.256;',
      'Set 3;10.12.2026;DC-A;;01.2.3.4',
      'Set 4;12.12.2026;=HYPERLINK();;',
      `Set 5;15.12.2026;${'d'.repeat(PLAN_SINIR.dc + 1)};;`,
      'Faz 1;15.12.2026;DC-A;;',
      'Set 6;16.12.2026;DC-A',
    ),
  );
  const m = Object.fromEntries(h.hatalar.map((x) => [x.satir, x.mesaj]));
  assert.equal(h.hataSayisi, 8);
  assert.match(m[3], /Pilot 2\. satırda da var/);
  assert.match(m[4], /gün adı tarihe uymuyor/);
  assert.match(m[5], /eski_ip IPv4 değil/);
  assert.match(m[6], /yeni_ip IPv4 değil/);
  assert.match(m[7], /dc geçersiz/);
  assert.match(m[8], /dc çok uzun/);
  assert.match(m[9], /set geçersiz/);
  assert.match(m[10], /Sütun sayısı 3/);
  assert.equal(h.satirlar.length, 1);
  // eksik zorunlu / bos / yalniz baslik / secmeli sutun yok
  assert.deepEqual(planAyristir('set;dc\nPilot;DC-A\n').eksikSutun, ['gecis_tarihi']);
  assert.match(planAyristir('').hatalar[0].mesaj, /Dosya boş/);
  assert.match(planAyristir(planCsv()).hatalar[0].mesaj, /Veri satırı yok/);
  const yalniz = planAyristir('set,gecis_tarihi\nSet 1,2026-12-08\n');
  assert.deepEqual(
    yalniz.satirlar.map((x) => [x.set, x.gecisTarihi, x.dc, x.eskiIp]),
    [['Set 1', '2026-12-08', '', '']],
  );
  for (const [ip, ok] of [
    ['192.0.2.1', true],
    ['198.51.100.255', true],
    ['', true],
    ['256.0.0.1', false],
    ['1.2.3', false],
    ['01.2.3.4', false],
    ['1.2.3.4 ', false],
    ['a.b.c.d', false],
  ])
    assert.equal(ipGecerli(ip), ok, ip);
});

/** Set planli takvim: Set 1 (DC-A) app-2 / app-3, Pilot (DC-A) app-1. */
const planliDb = async () => {
  const d = await yukluDb();
  d.plan.push(PLAN('Pilot', 0, '2026-12-01', 'DC-A', 3), PLAN('Set 1', 1, '2026-12-03', 'DC-A', 4));
  return d;
};
const beklenenOf = (d, set) =>
  Object.fromEntries(
    d.rows.filter((x) => x.set_adi === set).map((x) => [`${x.namespace}/${x.uygulama}`, x.surum]),
  );

test('TK11 PUT /set: tarih yayilimi, yalniz DC / IP, 409 (yarim yazim yok), topla, audit, 400', async (t) => {
  const d = await planliDb();
  const { s, istek } = await sunucu(d);
  t.after(() => s.close());
  // app-3 elle farkli tarihte
  d.rows.find((x) => x.uygulama === 'app-3').gecis_tarihi = '2026-12-05';
  denetim.length = 0;

  // yalniz DC / IP: satir tasinmaz, beklenen gerekmez
  let r = await istek('/set', 'PUT', {
    set: 'Set 1',
    gecisTarihi: '2026-12-03',
    dc: 'DC-B',
    eskiIp: '198.51.100.1',
    yeniIp: '',
    beklenenSurum: 4,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(
    [r.body.plan.dc, r.body.plan.eskiIp, r.body.plan.yeniIp, r.body.plan.surum, r.body.tasinan],
    ['DC-B', '198.51.100.1', '', 5, 0],
  );
  assert.deepEqual(r.body.rows, []);
  assert.equal(d.rows.find((x) => x.uygulama === 'app-3').gecis_tarihi, '2026-12-05');
  assert.ok(d.rows.every((x) => x.surum === 1));

  // eski plan surumu: 409, hicbir sey yazilmaz
  r = await istek('/set', 'PUT', {
    set: 'Set 1',
    gecisTarihi: '2026-12-10',
    beklenenSurum: 4,
    beklenen: beklenenOf(d, 'Set 1'),
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'takvim_cakisma');
  assert.equal(r.body.plan.surum, 5);
  // tarih degisiyor ama satir surumu eksik / eski: 409 ve plan da YAZILMAZ
  r = await istek('/set', 'PUT', {
    set: 'Set 1',
    gecisTarihi: '2026-12-10',
    beklenenSurum: 5,
    beklenen: { 'ns-a-prod/app-2': 1 },
  });
  assert.equal(r.status, 409);
  r = await istek('/set', 'PUT', {
    set: 'Set 1',
    gecisTarihi: '2026-12-10',
    beklenenSurum: 5,
    beklenen: { 'ns-a-prod/app-2': 1, 'ns-a-prod/app-3': 9 },
  });
  assert.equal(r.status, 409);
  // fazla anahtar (eski ekranda olup sette artik olmayan satir): setin satir kumesi tutmuyor, 409
  r = await istek('/set', 'PUT', {
    set: 'Set 1',
    gecisTarihi: '2026-12-10',
    beklenenSurum: 5,
    beklenen: { ...beklenenOf(d, 'Set 1'), 'ns-a-prod/app-yok': 1 },
  });
  assert.equal(r.status, 409, 'fazla anahtarli beklenen kabul edildi');
  assert.equal(d.plan.find((p) => p.set_adi === 'Set 1').gecis_tarihi, '2026-12-03');
  // beklenen hic yok: 400
  r = await istek('/set', 'PUT', { set: 'Set 1', gecisTarihi: '2026-12-10', beklenenSurum: 5 });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /beklenen/);

  // tarih degisir: setin tarihi farkli HER satiri (elle farkli olan dahil) yeni tarihe gecer
  denetim.length = 0;
  r = await istek('/set', 'PUT', {
    set: 'set 1',
    gecisTarihi: '2026-12-10',
    dc: 'DC-B',
    eskiIp: '198.51.100.1',
    beklenenSurum: 5,
    beklenen: beklenenOf(d, 'Set 1'),
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.tasinan, 2);
  assert.deepEqual(
    r.body.rows.map((x) => [x.uygulama, x.gecisTarihi, x.surum, x.guncelleyen]),
    [
      ['app-2', '2026-12-10', 2, 'onur'],
      ['app-3', '2026-12-10', 2, 'onur'],
    ],
  );
  assert.equal(d.rows.find((x) => x.set_adi === 'Pilot').gecis_tarihi, '2026-12-01');
  assert.deepEqual(denetim, [
    {
      eylem: 'intranet_spa_set_plani_duzelt',
      detay: {
        set: 'Set 1',
        eski: { gecisTarihi: '2026-12-03', dc: 'DC-B', eskiIp: '198.51.100.1', yeniIp: '' },
        yeni: { gecisTarihi: '2026-12-10', dc: 'DC-B', eskiIp: '198.51.100.1', yeniIp: '' },
        tasinan: 2,
        eskiTarihler: ['2026-12-03', '2026-12-05'],
      },
    },
  ]);

  // ayni tarih + topla: yalniz farkli olanlar tasinir
  d.rows.find((x) => x.uygulama === 'app-2').gecis_tarihi = '2026-12-11';
  r = await istek('/set', 'PUT', {
    set: 'Set 1',
    gecisTarihi: '2026-12-10',
    dc: 'DC-B',
    beklenenSurum: 6,
    beklenen: beklenenOf(d, 'Set 1'),
    topla: true,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.tasinan, 1);
  assert.deepEqual(
    d.rows.filter((x) => x.set_adi === 'Set 1').map((x) => [x.gecis_tarihi, x.surum]),
    [
      ['2026-12-10', 3],
      ['2026-12-10', 2],
    ],
  );

  // plani olmayan set: beklenenSurum 0 ile olusur; uygulamasi olmayan set de olusur
  r = await istek('/set', 'PUT', {
    set: 'Set 13',
    gecisTarihi: '2026-12-29',
    dc: 'DC-B',
    beklenenSurum: 0,
    beklenen: {},
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // yeni satir tablonun en buyuk surumunun ustunden (silinip yeniden olusan set ABA vermez)
  assert.deepEqual([r.body.plan.set, r.body.plan.setSira, r.body.plan.surum], ['Set 13', 13, 8]);
  r = await istek('/set', 'PUT', {
    set: 'Set 13',
    gecisTarihi: '2026-12-29',
    beklenenSurum: 0,
    beklenen: {},
  });
  assert.equal(r.status, 409, 'var olan plan beklenenSurum 0 ile ezildi');

  // yazim hatasi: transaction geri alinir (satirlar tasinmis plan yazilmamis kalmaz)
  d.yazimDus = 'intranet_spa_set_plani';
  r = await istek('/set', 'PUT', {
    set: 'Pilot',
    gecisTarihi: '2026-12-02',
    beklenenSurum: 3,
    beklenen: beklenenOf(d, 'Pilot'),
  });
  assert.equal(r.status, 500);
  assert.equal(d.rows.find((x) => x.set_adi === 'Pilot').gecis_tarihi, '2026-12-01');
  d.yazimDus = null;

  for (const govde of [
    { set: 'Faz', gecisTarihi: '2026-12-10', beklenenSurum: 0 },
    { set: 'Set 1', gecisTarihi: '10.13.2026', beklenenSurum: 0 },
    { set: 'Set 1', gecisTarihi: '2026-12-10', eskiIp: '300.1.1.1', beklenenSurum: 7 },
    { set: 'Set 1', gecisTarihi: '2026-12-10', dc: '+x', beklenenSurum: 7 },
    { set: 'Set 1', gecisTarihi: '2026-12-10' },
    { set: 'Set 1', gecisTarihi: '2026-12-10', beklenenSurum: -1 },
    { set: 'Set 1', gecisTarihi: '2026-12-10', beklenenSurum: 7, beklenen: [1] },
  ])
    assert.equal((await istek('/set', 'PUT', govde)).status, 400, JSON.stringify(govde));
});

test('TK12 plan yukleme: fark, tasima sayisi (elle dahil), takvimi silmez, kilit 409, audit', async (t) => {
  const d = await planliDb();
  const { s, istek } = await sunucu(d);
  t.after(() => s.close());
  // app-3 elle duzeltilmis (tek satir duzeltmesi: elle_tarih 1), app-2 plan tarihinde
  const app3 = d.rows.find((x) => x.uygulama === 'app-3');
  Object.assign(app3, { gecis_tarihi: '2026-12-05', guncelleyen: 'ayse', elle_tarih: 1, surum: 2 });
  const yeni = planCsv(
    'Pilot;01.12.2026 Salı;DC-A;192.0.2.41;192.0.2.42',
    'Set 1;10.12.2026 Perşembe;DC-A;192.0.2.41;192.0.2.42',
    'Set 7;17.12.2026 Perşembe;DC-B;198.51.100.41;198.51.100.42',
  );
  let r = await istek('/plan/onizle', 'POST', { metin: yeni });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.gecerli, true);
  assert.equal(r.body.satir, 3);
  // Pilot: IP degisti (tarih ayni, tasima yok); Set 1: tarih degisti; Set 7 yeni
  assert.deepEqual(r.body.fark, { mevcut: 2, yeni: 1, kalkan: 0, degisen: 2 });
  assert.deepEqual(r.body.tasima, [
    { set: 'Set 1', eskiTarih: '2026-12-03', yeniTarih: '2026-12-10', uygulama: 2, elle: 1 },
  ]);
  assert.deepEqual(r.body.uyarilar, ['Takvimde uygulaması olmayan set: Set 7.']);
  const kilit = r.body.kilit;

  // hatali dosya 400, hicbir sey degismez
  denetim.length = 0;
  r = await istek('/plan/yukle', 'POST', {
    metin: planCsv('Set 1;10.12.2026;DC-A;1.2.3;'),
    beklenenKilit: kilit,
  });
  assert.equal(r.status, 400);
  assert.match(r.body.hatalar[0].mesaj, /eski_ip IPv4/);
  assert.equal(d.plan.length, 2);

  // onizlemeden sonra takvimde tek satir duzeltme: kilit tutmaz
  r = await istek('/tarih', 'PUT', {
    set: 'Pilot',
    namespace: 'ns-a-prod',
    uygulama: 'app-1',
    tarih: '2026-12-02',
    beklenenSurum: 1,
  });
  assert.equal(r.status, 200);
  r = await istek('/plan/yukle', 'POST', { metin: yeni, beklenenKilit: kilit });
  assert.equal(r.status, 409, 'plan yuklemesi onizleme sonrasi takvim duzeltmesini gormedi');
  assert.equal(d.plan.length, 2);
  assert.equal(denetim.filter((x) => x.eylem === 'intranet_spa_set_plani_yukle').length, 0);

  // tazelenen onizleme: Pilot'un tarihi de ayni kaldigi icin tasima yok (elle duzeltme korunur)
  r = await istek('/plan/onizle', 'POST', { metin: yeni });
  assert.deepEqual(
    r.body.tasima.map((x) => x.set),
    ['Set 1'],
  );
  r = await istek('/plan/yukle', 'POST', { metin: yeni, beklenenKilit: r.body.kilit });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.satir, r.body.tasinan], [3, 2]);
  assert.deepEqual(
    d.plan.map((p) => [p.set_adi, p.gecis_tarihi, p.dc, p.surum]),
    [
      ['Pilot', '2026-12-01', 'DC-A', 5],
      ['Set 1', '2026-12-10', 'DC-A', 5],
      ['Set 7', '2026-12-17', 'DC-B', 5],
    ],
  );
  // takvim SILINMEDI; Set 1 satirlari tasindi, Pilot'un elle duzeltmesi duruyor
  assert.deepEqual(
    d.rows.map((x) => [x.set_adi, x.uygulama, x.gecis_tarihi]),
    [
      ['Pilot', 'app-1', '2026-12-02'],
      ['Set 1', 'app-2', '2026-12-10'],
      ['Set 1', 'app-3', '2026-12-10'],
    ],
  );
  // audit eski ve yeni plan degerlerini tasir (degisen, yeni ve kalkan setler)
  const PILOT_ESKI = {
    gecisTarihi: '2026-12-01',
    dc: 'DC-A',
    eskiIp: '192.0.2.10',
    yeniIp: '192.0.2.20',
  };
  assert.deepEqual(denetim.at(-1), {
    eylem: 'intranet_spa_set_plani_yukle',
    detay: {
      onceki: 2,
      set: 3,
      tasinan: ['Set 1:2'],
      degisen: [
        {
          set: 'Pilot',
          eski: PILOT_ESKI,
          yeni: { ...PILOT_ESKI, eskiIp: '192.0.2.41', yeniIp: '192.0.2.42' },
        },
        {
          set: 'Set 1',
          eski: { ...PILOT_ESKI, gecisTarihi: '2026-12-03' },
          yeni: {
            gecisTarihi: '2026-12-10',
            dc: 'DC-A',
            eskiIp: '192.0.2.41',
            yeniIp: '192.0.2.42',
          },
        },
        {
          set: 'Set 7',
          eski: null,
          yeni: {
            gecisTarihi: '2026-12-17',
            dc: 'DC-B',
            eskiIp: '198.51.100.41',
            yeniIp: '198.51.100.42',
          },
        },
      ],
    },
  });

  // plandan cikan set: takvim satirlari kalir, onizleme soyler
  r = await istek('/plan/onizle', 'POST', {
    metin: planCsv('Set 7;17.12.2026 Perşembe;DC-B;;'),
  });
  assert.deepEqual(r.body.fark, { mevcut: 3, yeni: 0, kalkan: 2, degisen: 1 });
  assert.match(
    r.body.uyarilar.join(' '),
    /bu planda olmayan set \(plan yok görünür\): Pilot, Set 1/,
  );
  assert.deepEqual(r.body.tasima, []);

  // planFarki saf: ilk plan (eski yok) setin farkli tarihli satirlarini tasir
  const f = planFarki(
    [],
    [{ set: 'Set 1', gecisTarihi: '2026-12-08', dc: '', eskiIp: '', yeniIp: '' }],
    [
      {
        set_adi: 'Set 1',
        namespace: 'n',
        uygulama: 'a',
        gecis_tarihi: '2026-12-08',
        elle_tarih: 0,
      },
      {
        set_adi: 'Set 1',
        namespace: 'n',
        uygulama: 'b',
        gecis_tarihi: '2026-12-09',
        elle_tarih: 0,
      },
    ],
  );
  assert.deepEqual(f.tasima, [
    { set: 'Set 1', eskiTarih: null, yeniTarih: '2026-12-08', uygulama: 1, elle: 0 },
  ]);
});

// B1 (inceleme 2026-11-27): set tarihi yayilimi satiri "elle duzeltilmis" YAPMAZ. Eskiden yayilim
// guncelleyen yaziyor, onizlemeler guncelleyen dolu satiri elle sayiyordu: setin her satiri kayip
// gorunuyordu. Elle isareti yalniz tek satir duzeltmesinde (/tarih), sonraki yayilim kaldirir.
test('TK13 elle isareti: yalniz tek satir duzeltmesi; set yayilimi ve plan / takvim onizlemesi', async (t) => {
  const d = await planliDb();
  const { s, istek } = await sunucu(d);
  t.after(() => s.close());
  let r = await istek('/set', 'PUT', {
    set: 'Set 1',
    gecisTarihi: '2026-12-08',
    dc: 'DC-A',
    beklenenSurum: 4,
    beklenen: beklenenOf(d, 'Set 1'),
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.tasinan, 2);
  const set1 = () => d.rows.filter((x) => x.set_adi === 'Set 1');
  assert.deepEqual(
    set1().map((x) => [x.guncelleyen, x.elle_tarih]),
    [
      ['onur', 0],
      ['onur', 0],
    ],
    'yayilim satirlari elle isaretledi',
  );
  const planDosyasi = (tarih) => planCsv('Pilot;01.12.2026 Salı;DC-A;;', `Set 1;${tarih};DC-A;;`);
  r = await istek('/plan/onizle', 'POST', { metin: planDosyasi('09.12.2026 Çarşamba') });
  assert.deepEqual(r.body.tasima, [
    { set: 'Set 1', eskiTarih: '2026-12-08', yeniTarih: '2026-12-09', uygulama: 2, elle: 0 },
  ]);
  const takvimDosyasi = csv(
    satir({ set: 'Pilot', tarih: '01.12.2026 Salı' }),
    satir({ app: 'app-2', sira: '1', tarih: '09.12.2026 Çarşamba' }),
    satir({ app: 'app-3', sira: '2', tarih: '09.12.2026 Çarşamba' }),
  );
  r = await istek('/onizle', 'POST', { metin: takvimDosyasi });
  assert.deepEqual([r.body.fark.tarihDegisen, r.body.fark.elleKaybolan], [2, 0]);

  // tek satir duzeltmesi elle isaretler: iki onizleme de 1 kayip sayar
  r = await istek('/tarih', 'PUT', {
    set: 'Set 1',
    namespace: 'ns-a-prod',
    uygulama: 'app-3',
    tarih: '2026-12-11',
    beklenenSurum: 2,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(d.rows.find((x) => x.uygulama === 'app-3').elle_tarih, 1);
  r = await istek('/plan/onizle', 'POST', { metin: planDosyasi('09.12.2026 Çarşamba') });
  assert.deepEqual(r.body.tasima[0], {
    set: 'Set 1',
    eskiTarih: '2026-12-08',
    yeniTarih: '2026-12-09',
    uygulama: 2,
    elle: 1,
  });
  r = await istek('/onizle', 'POST', { metin: takvimDosyasi });
  assert.equal(r.body.fark.elleKaybolan, 1);

  // sonraki set yayilimi elle duzeltilmis satiri da sete alir ve isareti kaldirir
  r = await istek('/set', 'PUT', {
    set: 'Set 1',
    gecisTarihi: '2026-12-08',
    dc: 'DC-A',
    beklenenSurum: 5,
    beklenen: beklenenOf(d, 'Set 1'),
    topla: true,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(
    set1().map((x) => [x.gecis_tarihi, x.elle_tarih]),
    [
      ['2026-12-08', 0],
      ['2026-12-08', 0],
    ],
  );
  // yukleme elle isaretsiz yazar (DB varsayilani 0)
  assert.ok(
    (await yukluDb()).rows.every((x) => Number(x.elle_tarih ?? 0) === 0),
    'yukleme elle isaretledi',
  );
});

// B2 (inceleme 2026-11-27): ayni uygulama ayni DC'de iki sette olmasi plan onizlemesinde ve set
// duzeltmesinde de UYARI (engellemez); DC harf / bosluk duyarsiz (ekrandaki DC grubuyla ayni).
test('TK14 ayni DC uyarisi: plan onizlemesi ve PUT /set (ozet, harf duyarsiz, engellemez)', async (t) => {
  const d = sahteDb();
  const { s, istek } = await sunucu(d);
  t.after(() => s.close());
  // her uygulama iki sette: Pilot (DC-A) ve Set 7 (DC-B)
  let r = await istek('/yukle', 'POST', {
    metin: csv(
      satir({ set: 'Pilot', tarih: '01.12.2026 Salı', app: 'app-1' }),
      satir({ set: 'Pilot', tarih: '01.12.2026 Salı', app: 'app-2', sira: '2' }),
      satir({ set: 'Set 7', tarih: '17.12.2026 Perşembe', app: 'app-1' }),
      satir({ set: 'Set 7', tarih: '17.12.2026 Perşembe', app: 'app-2', sira: '2' }),
      satir({ set: 'Set 8', tarih: '19.12.2026 Cumartesi', app: 'app-9' }),
    ),
    beklenenKilit: null,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  d.plan.push(
    PLAN('Pilot', 0, '2026-12-01', 'DC-A', 1),
    PLAN('Set 7', 7, '2026-12-17', 'DC-B', 1),
    PLAN('Set 8', 8, '2026-12-19', 'DC-B', 1),
  );
  const dosya = (dc7) =>
    planCsv(
      'Pilot;01.12.2026 Salı;DC-A;;',
      `Set 7;17.12.2026 Perşembe;${dc7};;`,
      'Set 8;19.12.2026 Cumartesi;DC-B;;',
    );
  r = await istek('/plan/onizle', 'POST', { metin: dosya('DC-B') });
  assert.deepEqual(r.body.uyarilar, []);
  r = await istek('/plan/onizle', 'POST', { metin: dosya('dc-a ') });
  assert.equal(r.body.gecerli, true, 'ayni DC satir hatasi oldu');
  assert.deepEqual(r.body.uyarilar, [
    'Aynı DC’de (DC-A) 2 uygulama birden fazla sette: Pilot, Set 7.',
  ]);

  // PUT /set: yazim gider, yanit uyarir; yalniz bu seti iceren ciftler
  r = await istek('/set', 'PUT', {
    set: 'Set 7',
    gecisTarihi: '2026-12-17',
    dc: 'DC-A',
    beklenenSurum: 1,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(d.plan.find((p) => p.set_adi === 'Set 7').dc, 'DC-A');
  assert.deepEqual(r.body.uyarilar, [
    'Aynı DC’de (DC-A) 2 uygulama birden fazla sette: Pilot, Set 7.',
  ]);
  r = await istek('/set', 'PUT', {
    set: 'Set 8',
    gecisTarihi: '2026-12-19',
    dc: 'DC-A',
    beklenenSurum: 1,
  });
  assert.deepEqual(r.body.uyarilar, [], 'baska setin cifti bu sete yazildi');
  r = await istek('/set', 'PUT', {
    set: 'Set 7',
    gecisTarihi: '2026-12-17',
    dc: 'DC-B',
    beklenenSurum: 2,
  });
  assert.deepEqual(r.body.uyarilar, []);
});
