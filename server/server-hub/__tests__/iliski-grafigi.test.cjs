// server/server-hub/__tests__/iliski-grafigi.test.cjs — iliski grafigi ve capraz dogrulama (2026-11-07).
//
//   IG1  2-tier: ProxyPass ajp://localhost:<ofsetli port> -> Faz A JVM KESIN config_port; Server Hub EXACT_JVM ile
//        DOGRULANDI; app -> jvm ad kurali
//   IG2  3-tier mod_jk: JkMount -> lb -> worker host (IP ile) -> sunucu -> JVM KESIN; kayan IP (iki sahip) COZULMEZ
//   IG3  mod_cluster: proxies outbound = bu web + balancer ayni -> GUCLU; balancer farkli -> kenar YOK; balancer
//        bos + taban ad = balancer -> GUCLU; yalniz proxy -> ZAYIF
//   IG4  WAS eklentisi: vhost grubu *:80 -> cluster transport -> serverindex WC portu KESIN was_plugin
//   IG5  cok adim RP -> WEB: hedef portu dinleyen vhost'a kenar
//   IG6  CELISKI: ayni vhost icin Server Hub ve config farkli JVM -> iki kenar da CELISKI
//   IG7  baglanti: uzak IP sahibi sunucu -> cagirir; bilinmeyen IP ip dugumunden; loopback ayni sunucu
//   IG8  ara (tam ad once, uygulama once) ve varlik (kenarlar, bilesen)
//   IG9  capraz dogrulama: PORT_UYUMU, TRAFIK_UYUMU, LISTEN_IP, CALISMA_DINLEME, WEB_CALISMA, VHOST_KAPSAMI,
//        TAZELIK, IP_ENVANTERI; UYUM / CELISKI / OLCULMEDI
//   IG10 HIZ: 3000 sunucu + Faz A / W verisi <= 1,5 sn (grafik + dogrulama)
//   IG11 onbellek: ayni degerlendirmede yeniden kurulmaz; tek ucus; veri bayatlayinca yeniden okunur
//   IG15 iliski verisi partili: (host, kosu, bayt) listesi + bayt butceli agir partiler (tepe bellek parti kadar)
//   IG14 sunucu adi: UE FQDN / kisa ad ayni sunucu (en yeni tarama), IPv4 adi kisaltilmaz, IP tek sahip;
//        UE sunucusu dugum + tarama ani (senaryo motorunun tazelik girdisi)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { grafikKur, ara, varlik, A } = require('../iliski-grafigi.cjs');
const { dogrula } = require('../dogrulama.cjs');
const { iliskiHesabiKur } = require('../iliski-uclar.cjs');

// ── fiksturler ──────────────────────────────────────────────────────────────────────────────────
const jvm = (ad, ek = {}) => ({
  gen: 8,
  name: ad,
  running: true,
  runningKnown: true,
  autoStart: 'true',
  ports: [],
  cfgPorts: [],
  cfgPortsAuth: false,
  vhosts: [],
  trafficState: null,
  ...ek,
});
const sunucu = (host, ek = {}) => ({
  host,
  env: 'PROD',
  scanDate: '2026-11-07',
  fresh: true,
  jvms: [],
  web: [],
  vhosts: [],
  ips: [],
  ...ek,
});
const kurulum = ({ nesil = '8', sunucular, gruplar, soket_gruplari, profiller = [] }) => ({
  kurulum: `/usr/jboss${nesil === '8' ? '8' : ''}/AppServer`,
  nesil,
  olculdu: true,
  faz: true,
  sunucular,
  gruplar,
  soket_gruplari,
  profiller,
});
const sokGrup = (ad = 's', ek = {}) => ({
  ad,
  soketler: { ajp: 8009, http: 8080 },
  outbound: [],
  ...ek,
});
const vhostW = (sn, adres, ek = {}) => ({
  server_name: sn,
  aliases: [],
  adres: [adres],
  belirsiz: false,
  hedefler: [],
  jk: [],
  log: null,
  ...ek,
});
const webK = (ek = {}) => ({
  urun: 'IHS',
  calisiyor: true,
  hata_sayisi: 0,
  mod_cluster: false,
  vhostlar: [],
  ana_hedefler: [],
  jk_global: [],
  workers: [],
  balancerlar: [],
  was: null,
  ...ek,
});
const veri = (hostlar) => ({
  hostlar: new Map(
    Object.entries(hostlar).map(([h, v]) => [
      h,
      {
        host: h,
        taranma: '2026-11-07T00:00:00.000Z',
        jboss: null,
        web: null,
        baglanti: null,
        was: null,
        ...v,
      },
    ]),
  ),
  ipEnvanteri: { okunamadi: false, satirlar: [] },
});
const kenarlar = (g, kaynak, tur = 'yonlendirir') =>
  g.kenarlar.filter((e) => e.kaynak === kaynak && e.tur === tur);

test('IG1 2-tier: localhost ProxyPass -> ofsetli Faz A portu KESIN; Server Hub ile DOGRULANDI', () => {
  const vk = A.vhost('APPSRV01', 'IHS', 'app1.ornek.local', 443);
  const shV = {
    product: 'IHS',
    listen: '10.0.0.5:443',
    serverName: 'app1.ornek.local',
    aliases: '',
    req7d: 12,
    trafficState: 'ACTIVE',
  };
  const j = jvm('APP1-JVM1', {
    ports: [8109],
    vhosts: [{ host: 'APPSRV01', v: shV, kind: 'EXACT_JVM' }],
  });
  const hosts = [
    sunucu('APPSRV01', {
      jvms: [j],
      web: [{ product: 'IHS', running: true, runningKnown: true }],
      vhosts: [shV],
      ips: [{ ip: '10.0.0.5' }],
    }),
  ];
  const v = veri({
    APPSRV01: {
      jboss: [
        kurulum({
          sunucular: [{ ad: 'APP1-JVM1', grup: 'g', soket_grubu: '', port_ofseti: 100 }],
          gruplar: [{ ad: 'g', profil: 'p', soket_grubu: 's', port_ofseti: 0 }],
          soket_gruplari: [sokGrup()],
        }),
      ],
      web: {
        durum: 'TAM',
        ipler: ['10.0.0.5'],
        kurulumlar: [
          webK({
            vhostlar: [
              vhostW('app1.ornek.local', '10.0.0.5:443', {
                hedefler: [{ tur: 'proxy', sema: 'ajp', host: 'localhost', port: 8109 }],
              }),
            ],
          }),
        ],
      },
    },
  });
  const g = grafikKur({ hosts, veri: v });
  const e = kenarlar(g, vk);
  assert.equal(e.length, 1, JSON.stringify(e));
  assert.equal(e[0].hedef, A.jvm('APPSRV01', 8, 'APP1-JVM1'));
  assert.equal(e[0].guven, 'KESIN');
  assert.equal(e[0].durum, 'DOGRULANDI', 'Server Hub + config iki ayri aile');
  assert.ok(
    e[0].yontemler.some((y) => /8009 \+ 100 = 8109/.test(y.kanit)),
    'kanit hesabi gosterir',
  );
  assert.deepEqual(g.dugumler.get(vk).kaynaklar.sort(), ['faz_w', 'server_hub']);
  // Portalin ad kurali: JVM adi uygulama adidir; yalniz -D / -T / -Q ortam eki atilir.
  assert.ok(kenarlar(g, A.app('APP1-JVM1'), 'kopya').length === 1, 'APP1-JVM1 uygulamasi');
});

test('IG2 3-tier mod_jk: worker IP ile cozulur; kayan IP cozulmez', () => {
  const hosts = [
    sunucu('WEBSRV01', { ips: [{ ip: '10.0.0.10' }] }),
    sunucu('APPSRV01', {
      ips: [{ ip: '10.0.1.7' }, { ip: '10.0.9.9' }],
      jvms: [jvm('APP2', { gen: 7 })],
    }),
    sunucu('APPSRV02', { ips: [{ ip: '10.0.9.9' }] }),
  ];
  const k7 = kurulum({
    nesil: '7',
    sunucular: [{ ad: 'APP2', grup: 'g', soket_grubu: '', port_ofseti: null }],
    gruplar: [{ ad: 'g', profil: 'p', soket_grubu: 's', port_ofseti: 0 }],
    soket_gruplari: [sokGrup()],
  });
  const workers = [
    { ad: 'app2lb', tur: 'lb', host: '', port: null, uyeler: ['w1', 'w2'] },
    { ad: 'w1', tur: 'ajp13', host: '10.0.1.7', port: 8009, uyeler: [] },
    { ad: 'w2', tur: 'ajp13', host: '10.0.9.9', port: 8009, uyeler: [] },
  ];
  const v = veri({
    APPSRV01: { jboss: [k7] },
    WEBSRV01: {
      web: {
        durum: 'TAM',
        ipler: ['10.0.0.10'],
        kurulumlar: [
          webK({ workers, vhostlar: [vhostW('app2.ornek.local', '*:80', { jk: ['app2lb'] })] }),
        ],
      },
    },
  });
  const g = grafikKur({ hosts, veri: v });
  const e = kenarlar(g, A.vhost('WEBSRV01', 'IHS', 'app2.ornek.local', 80));
  assert.deepEqual(
    e.map((x) => [x.hedef, x.guven, x.yontemler[0].ad]),
    [[A.jvm('APPSRV01', 7, 'APP2'), 'KESIN', 'mod_jk']],
  );
  // Tek aile (config) kaniti DOGRULANDI sayilmaz.
  assert.equal(e[0].durum, 'TEK_KAYNAK');
  // Kayan IP'li worker (w2) ilk sahibine BAGLANMAZ: kanitta yalniz w1 var.
  assert.ok(
    !e[0].yontemler.some((x) => x.kanit.includes('10.0.9.9')),
    JSON.stringify(e[0].yontemler),
  );
  assert.equal(
    g.dugumler.get('ip:10.0.9.9').veri.kayan,
    true,
    'iki sahipli IP kayan; hedef cozulmez (tahmin yok)',
  );
});

function mcVeri({
  balancer = 'mybal',
  proxies = ['web1'],
  vhostBal = 'mybal',
  jvmAd = 'APP3-T',
} = {}) {
  const k8 = kurulum({
    sunucular: [{ ad: jvmAd, grup: 'g', soket_grubu: '', port_ofseti: null }],
    gruplar: [{ ad: 'g', profil: 'p', soket_grubu: 's', port_ofseti: 0 }],
    soket_gruplari: [
      sokGrup('s', { outbound: [{ ad: 'web1', host: 'websrv03.ornek.local', port: 6666 }] }),
    ],
    profiller: [
      {
        ad: 'p',
        modcluster: { tur: 'proxy', proxies, proxy_list: [], balancer, advertise: false },
      },
    ],
  });
  return veri({
    APPSRV03: { jboss: [k8] },
    WEBSRV03: {
      web: {
        durum: 'TAM',
        ipler: [],
        kurulumlar: [
          webK({
            urun: 'RHA',
            mod_cluster: true,
            vhostlar: [
              vhostW('app3.ornek.local', '*:80', {
                hedefler: [{ tur: 'mc', sema: 'balancer', host: vhostBal, port: null }],
              }),
            ],
          }),
        ],
      },
    },
  });
}

test('IG3 mod_cluster: balancer + proxy GUCLU; balancer farkli YOK; taban ad GUCLU; yalniz proxy ZAYIF', () => {
  const hosts = [sunucu('WEBSRV03'), sunucu('APPSRV03')];
  const vk = A.vhost('WEBSRV03', 'RHA', 'app3.ornek.local', 80);
  const jk = A.jvm('APPSRV03', 8, 'APP3-T');
  const e1 = kenarlar(grafikKur({ hosts, veri: mcVeri() }), vk);
  assert.deepEqual(
    e1.map((x) => [x.hedef, x.guven, x.yontemler[0].ad]),
    [[jk, 'GUCLU', 'mod_cluster']],
  );
  assert.equal(
    kenarlar(grafikKur({ hosts, veri: mcVeri({ balancer: 'baska' }) }), vk).length,
    0,
    'JBoss baska balancer',
  );
  const e3 = kenarlar(grafikKur({ hosts, veri: mcVeri({ balancer: '', vhostBal: 'app3' }) }), vk);
  assert.equal(e3[0].guven, 'GUCLU', 'balancer bos: taban ad (APP3-T -> APP3) = balancer');
  const e4 = kenarlar(
    grafikKur({ hosts, veri: mcVeri({ balancer: '', vhostBal: 'ilgisiz' }) }),
    vk,
  );
  assert.equal(e4[0].guven, 'ZAYIF', 'yalniz proxy listesi');
  assert.equal(
    kenarlar(grafikKur({ hosts, veri: mcVeri({ proxies: [] }) }), vk).length,
    0,
    'bu web sunucusuna kaydolmuyor',
  );
});

test('IG4 WAS eklentisi: vhost grubu -> cluster transport -> serverindex WC portu', () => {
  const hosts = [sunucu('WEBSRV04'), sunucu('WASSRV01')];
  const v = veri({
    WASSRV01: {
      was: {
        sunucular: [
          {
            ad: 'srv1',
            tur: 'APPLICATION_SERVER',
            uclar: [{ ad: 'WC_defaulthost', port: 9080 }],
            uygulamalar: ['APP4'],
          },
        ],
      },
    },
    WEBSRV04: {
      web: {
        durum: 'TAM',
        ipler: [],
        kurulumlar: [
          webK({
            vhostlar: [vhostW('app4.ornek.local', '*:80'), vhostW('baska.ornek.local', '*:8443')],
            was: {
              clusterlar: [{ ad: 'C1', sunucular: [{ ad: 'srv1', host: 'wassrv01', port: 9080 }] }],
              vhostgruplari: { default_host: ['*:80'] },
              rotalar: [{ cluster: 'C1', urigroup: 'U', vhostgroup: 'default_host' }],
            },
          }),
        ],
      },
    },
  });
  const g = grafikKur({ hosts, veri: v });
  const e = kenarlar(g, A.vhost('WEBSRV04', 'IHS', 'app4.ornek.local', 80));
  assert.deepEqual(
    e.map((x) => [x.hedef, x.guven, x.yontemler[0].ad]),
    [[A.was('WASSRV01', 'srv1'), 'KESIN', 'was_plugin']],
  );
  assert.equal(
    kenarlar(g, A.vhost('WEBSRV04', 'IHS', 'baska.ornek.local', 8443)).length,
    0,
    'port vhost grubunda yok',
  );
  assert.ok(kenarlar(g, A.app('APP4'), 'kopya').some((x) => x.hedef === A.was('WASSRV01', 'srv1')));
});

test('IG5 cok adim RP -> WEB: hedef portu dinleyen vhost', () => {
  const hosts = [sunucu('RPSRV01'), sunucu('WEBSRV05')];
  const v = veri({
    RPSRV01: {
      web: {
        durum: 'TAM',
        ipler: [],
        kurulumlar: [
          webK({
            urun: 'RHA',
            vhostlar: [
              vhostW('dis.ornek.local', '*:443', {
                hedefler: [{ tur: 'proxy', sema: 'http', host: 'websrv05', port: 80 }],
              }),
            ],
          }),
        ],
      },
    },
    WEBSRV05: {
      web: {
        durum: 'TAM',
        ipler: [],
        kurulumlar: [webK({ vhostlar: [vhostW('ic.ornek.local', '*:80')] })],
      },
    },
  });
  const g = grafikKur({ hosts, veri: v });
  const e = kenarlar(g, A.vhost('RPSRV01', 'RHA', 'dis.ornek.local', 443));
  assert.deepEqual(
    e.map((x) => x.hedef),
    [A.vhost('WEBSRV05', 'IHS', 'ic.ornek.local', 80)],
  );
});

test('IG6 CELISKI: Server Hub ve config ayni vhost icin farkli JVM', () => {
  const shV = { product: 'IHS', listen: '*:80', serverName: 'app6.ornek.local', aliases: '' };
  const hosts = [
    sunucu('APPSRV06', {
      jvms: [
        jvm('A6', { ports: [8009], vhosts: [{ host: 'APPSRV06', v: shV, kind: 'EXACT_JVM' }] }),
        jvm('B6', { ports: [8109] }),
      ],
      vhosts: [shV],
    }),
  ];
  const v = veri({
    APPSRV06: {
      web: {
        durum: 'TAM',
        ipler: [],
        kurulumlar: [
          webK({
            vhostlar: [
              vhostW('app6.ornek.local', '*:80', {
                hedefler: [{ tur: 'proxy', sema: 'ajp', host: 'localhost', port: 8109 }],
              }),
            ],
          }),
        ],
      },
    },
  });
  const g = grafikKur({ hosts, veri: v });
  const e = kenarlar(g, A.vhost('APPSRV06', 'IHS', 'app6.ornek.local', 80));
  assert.equal(e.length, 2);
  assert.ok(
    e.every((x) => x.durum === 'CELISKI'),
    JSON.stringify(e.map((x) => x.durum)),
  );
  assert.match(e[0].celiski, /Server Hub .*A6.* config .*B6/);
});

test('IG7 baglanti: sahibi bilinen IP -> sunucu cagirir; bilinmeyen IP; loopback', () => {
  const hosts = [
    sunucu('APPSRV07', { ips: [{ ip: '10.0.7.1' }] }),
    sunucu('CLISRV01', { ips: [{ ip: '10.0.0.21' }] }),
  ];
  const k8 = kurulum({
    sunucular: [{ ad: 'APP7', grup: 'g', soket_grubu: '', port_ofseti: null }],
    gruplar: [{ ad: 'g', profil: 'p', soket_grubu: 's', port_ofseti: 0 }],
    soket_gruplari: [sokGrup()],
  });
  const v = veri({
    APPSRV07: {
      jboss: [k8],
      baglanti: {
        durum: 'OLCULDU',
        portlar: [
          {
            port: 8080,
            sahipler: [{ jvm: 'APP7' }],
            dinleniyor: true,
            uzaklar: [
              { ip: '10.0.0.21', gozlem: 3 },
              { ip: '10.99.0.1', gozlem: 1 },
              { ip: '127.0.0.1', gozlem: 2 },
            ],
          },
          { port: 8009, sahipler: [{ jvm: 'APP7' }], dinleniyor: false, uzaklar: [] },
        ],
      },
    },
  });
  const g = grafikKur({ hosts, veri: v });
  const jk = A.jvm('APPSRV07', 8, 'APP7');
  const cag = g.kenarlar
    .filter((e) => e.tur === 'cagirir' && e.hedef === jk)
    .map((e) => e.kaynak)
    .sort();
  assert.deepEqual(cag, ['ip:10.99.0.1', 'sunucu:APPSRV07', 'sunucu:CLISRV01']);
  assert.equal(g.dugumler.get(jk).veri.dinleniyor, true, 'bir yapilandirilmis portu dinleniyor');
});

test('IG8 ara ve varlik', () => {
  const hosts = [sunucu('APP1SRV', { jvms: [jvm('APP1'), jvm('APP10-T')] })];
  const g = grafikKur({ hosts, veri: veri({}) });
  const s = ara(g, 'app1');
  assert.deepEqual(
    s.slice(0, 2).map((x) => x.anahtar),
    ['app:APP1', 'jvm:APP1SRV|8|APP1'],
    'tam ad once, uygulama once',
  );
  assert.ok(s.some((x) => x.anahtar === 'app:APP10'));
  assert.deepEqual(ara(g, ''), []);
  const v = varlik(g, 'app:APP1');
  assert.deepEqual(
    v.kenarlar.map((e) => [e.yon, e.tur, e.karsi.anahtar]),
    [['cikis', 'kopya', 'jvm:APP1SRV|8|APP1']],
  );
  assert.ok(v.bilesen.boyut >= 3, 'app -> jvm -> sunucu');
  assert.equal(varlik(g, 'app:YOK'), null);
});

test('IG9 capraz dogrulama: UYUM / CELISKI / OLCULMEDI', () => {
  const shA = {
    product: 'IHS',
    listen: '10.0.0.5:443',
    serverName: 'a.ornek.local',
    aliases: '',
    req7d: 0,
    trafficState: 'NO_RECENT_TRAFFIC',
  };
  const shB = {
    product: 'IHS',
    listen: '10.9.9.9:80',
    serverName: 'b.ornek.local',
    aliases: '',
    req7d: 40,
    trafficState: 'ACTIVE',
  };
  const hosts = [
    sunucu('APPSRV09', {
      scanDate: '2026-11-07',
      jvms: [
        jvm('J1', { ports: [8109], cfgPorts: [8109], cfgPortsAuth: true }),
        jvm('J2', { ports: [9999] }),
        jvm('J3', { ports: [8209], running: false }),
      ],
      web: [{ product: 'IHS', running: true, runningKnown: true }],
      vhosts: [
        shA,
        shB,
        { product: 'IHS', listen: '*:81', serverName: 'yalnizsh.ornek.local', aliases: '' },
      ],
      ips: [{ ip: '10.0.0.5' }],
    }),
    sunucu('ESKISRV', { scanDate: '2026-10-01' }),
  ];
  const k8 = kurulum({
    sunucular: [
      { ad: 'J1', grup: 'g', soket_grubu: '', port_ofseti: 100 },
      { ad: 'J2', grup: 'g', soket_grubu: '', port_ofseti: 200 },
      { ad: 'J3', grup: 'g', soket_grubu: '', port_ofseti: 300 },
    ],
    gruplar: [{ ad: 'g', profil: 'p', soket_grubu: 's', port_ofseti: 0 }],
    soket_gruplari: [sokGrup('s', { soketler: { ajp: 8009 } })],
  });
  const v = veri({
    APPSRV09: {
      taranma: '2026-11-05T00:00:00.000Z',
      jboss: [k8],
      web: {
        durum: 'TAM',
        ipler: ['10.0.0.5'],
        kurulumlar: [
          webK({
            calisiyor: false,
            vhostlar: [
              vhostW('a.ornek.local', '10.0.0.5:443', { log: { durum: 'OLCULDU', gercek_7g: 5 } }),
              vhostW('b.ornek.local', '10.9.9.9:80', { log: { durum: 'KISMI', gercek_7g: 0 } }),
            ],
          }),
        ],
      },
      baglanti: {
        durum: 'OLCULDU',
        portlar: [
          { port: 8109, dinleniyor: true, uzaklar: [] },
          { port: 8309, dinleniyor: true, uzaklar: [] },
        ],
      },
    },
    ESKISRV: { taranma: '2026-11-07T00:00:00.000Z' },
  });
  v.ipEnvanteri = {
    okunamadi: false,
    satirlar: [
      { host: 'APPSRV09', ip: '10.0.0.5' },
      { host: 'APPSRV09', ip: '10.0.0.77' },
    ],
  };
  const g = grafikKur({ hosts, veri: v });
  const d = dogrula(g, { veri: v });
  const kod = (anahtar, k) => (d.get(anahtar) || []).find((x) => x.kod === k) || null;
  assert.equal(kod(A.jvm('APPSRV09', 8, 'J1'), 'PORT_UYUMU').durum, 'UYUM');
  assert.equal(
    kod(A.jvm('APPSRV09', 8, 'J2'), 'PORT_UYUMU').durum,
    'CELISKI',
    'Server Hub 9999, xml 8209',
  );
  assert.equal(
    kod(A.jvm('APPSRV09', 8, 'J3'), 'CALISMA_DINLEME').durum,
    'CELISKI',
    'kapali ama dinleniyor',
  );
  assert.equal(kod(A.jvm('APPSRV09', 8, 'J1'), 'CALISMA_DINLEME').durum, 'UYUM');
  const va = A.vhost('APPSRV09', 'IHS', 'a.ornek.local', 443);
  const vb = A.vhost('APPSRV09', 'IHS', 'b.ornek.local', 80);
  assert.equal(kod(va, 'TRAFIK_UYUMU').durum, 'CELISKI', 'Server Hub 0, log 5');
  assert.equal(kod(vb, 'TRAFIK_UYUMU').durum, 'OLCULMEDI', 'log KISMI: karsilastirilmaz');
  assert.equal(kod(va, 'LISTEN_IP').durum, 'UYUM');
  assert.equal(kod(vb, 'LISTEN_IP').durum, 'CELISKI', '10.9.9.9 sunucuda yok');
  const wk = A.web('APPSRV09', 'IHS');
  assert.equal(kod(wk, 'WEB_CALISMA').durum, 'CELISKI', 'Server Hub calisiyor, Faz W calismiyor');
  assert.equal(kod(wk, 'VHOST_KAPSAMI').durum, 'CELISKI');
  assert.match(kod(wk, 'VHOST_KAPSAMI').metin, /yalniz Server Hub: yalnizsh/);
  assert.equal(kod('sunucu:APPSRV09', 'TAZELIK').durum, 'UYUM');
  assert.equal(kod('sunucu:ESKISRV', 'TAZELIK').durum, 'CELISKI');
  assert.equal(kod('ip:10.0.0.5', 'IP_ENVANTERI').durum, 'UYUM');
  assert.equal(kod('ip:10.0.0.77', 'IP_ENVANTERI').durum, 'CELISKI');
  // Faz A yoksa PORT_UYUMU OLCULMEDI (dogrulandi SAYILMAZ)
  const g2 = grafikKur({
    hosts: [sunucu('X', { jvms: [jvm('J', { ports: [1] })] })],
    veri: veri({}),
  });
  assert.equal(dogrula(g2, { veri: veri({}) }).get(A.jvm('X', 8, 'J'))[0].durum, 'OLCULMEDI');
});

test('IG10 HIZ: 3000 sunucu <= 1,5 sn', () => {
  const hosts = [];
  const hv = {};
  for (let i = 0; i < 3000; i++) {
    const h = `SRV${i}`;
    const shV = {
      product: 'IHS',
      listen: `10.1.${i >> 8}.${i & 255}:80`,
      serverName: `app${i}.ornek.local`,
      aliases: '',
      req7d: i % 3,
      trafficState: 'ACTIVE',
    };
    hosts.push(
      sunucu(h, {
        jvms: [jvm(`APP${i}`, { ports: [8109], vhosts: [{ host: h, v: shV, kind: 'EXACT_JVM' }] })],
        vhosts: [shV],
        web: [{ product: 'IHS', running: true, runningKnown: true }],
        ips: [{ ip: `10.1.${i >> 8}.${i & 255}` }],
      }),
    );
    hv[h] = {
      jboss: [
        kurulum({
          sunucular: [{ ad: `APP${i}`, grup: 'g', soket_grubu: '', port_ofseti: 100 }],
          gruplar: [{ ad: 'g', profil: 'p', soket_grubu: 's', port_ofseti: 0 }],
          soket_gruplari: [sokGrup()],
        }),
      ],
      web: {
        durum: 'TAM',
        ipler: [`10.1.${i >> 8}.${i & 255}`],
        kurulumlar: [
          webK({
            vhostlar: [
              vhostW(`app${i}.ornek.local`, `10.1.${i >> 8}.${i & 255}:80`, {
                hedefler: [{ tur: 'proxy', sema: 'ajp', host: 'localhost', port: 8109 }],
                log: { durum: 'OLCULDU', gercek_7g: i % 3 },
              }),
            ],
          }),
        ],
      },
    };
  }
  const v = veri(hv);
  const t0 = process.hrtime.bigint();
  const g = grafikKur({ hosts, veri: v });
  dogrula(g, { veri: v });
  ara(g, 'app2999');
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms <= 1500, `grafik + dogrulama ${ms.toFixed(0)} ms`);
  assert.equal(
    g.kenarlar.filter((e) => e.tur === 'yonlendirir' && e.durum === 'DOGRULANDI').length,
    3000,
  );
});

test('IG11 onbellek: ayni degerlendirmede yeniden kurulmaz; tek ucus; veri bayatlayinca yeniden okunur', async () => {
  let simdi = 1000;
  let okuma = 0;
  const a = { tableMissing: false, hosts: [sunucu('S1', { jvms: [jvm('A')] })] };
  const hesap = iliskiHesabiKur({
    getAssessment: async () => a,
    iliskiVerisi: async () => { okuma++; return veri({}); },
    simdi: () => simdi,
  });
  const [r1, r2] = await Promise.all([hesap(false), hesap(false)]);
  assert.equal(okuma, 1, 'tek ucus');
  assert.equal(r1.grafik, r2.grafik);
  await hesap(false);
  assert.equal(okuma, 1, 'ayni degerlendirme + taze veri: yeniden kurulmaz');
  simdi += 61000;
  await hesap(false);
  assert.equal(okuma, 2, 'veri bayatladi');
  const yok = await iliskiHesabiKur({
    getAssessment: async () => ({ tableMissing: true }),
    iliskiVerisi: async () => veri({}),
  })(false);
  assert.equal(yok.grafik, null);
});

test('IG12 iliski verisi: kucuk projeksiyon; NULL kolon olculmedi; IP envanteri okunamazsa grafik yine kurulur', async () => {
  const path = require('node:path');
  const DB = path.join(__dirname, '..', '..', 'db', 'index.cjs');
  const INV = path.join(__dirname, '..', '..', 'inventory', 'mssql.cjs');
  const web = {
    durum: 'TAM',
    ps_gorunur: true,
    ipler: { durum: 'OLCULDU', liste: [{ ip: '10.0.0.5' }] },
    kurulumlar: [
      {
        urun: 'IHS',
        calisiyor: true,
        hatalar: [{}],
        vhostlar: [
          {
            server_name: 'a',
            adres: ['*:80'],
            hedefler: [
              { tur: 'proxy', sema: 'ajp', host: 'x', port: 8009, dosya: '/cok/uzun/yol' },
            ],
            loglar: [{ durum: 'OLCULDU', gercek_7g: 3, ilk_yollar: [{ yol: '/a', n: 3 }] }],
            buyuk: 'x'.repeat(10000),
          },
        ],
      },
    ],
  };
  require.cache[DB] = {
    id: DB,
    filename: DB,
    loaded: true,
    exports: {
      query: async () => ({
        rows: [
          {
            host: 'srv1',
            taranma_utc: '2026-11-07 01:02:03',
            xml_ozeti: null,
            web_ozeti: JSON.stringify(web),
            baglanti_ozeti: null,
            was_ozeti: null,
          },
        ],
      }),
    },
  };
  require.cache[INV] = {
    id: INV,
    filename: INV,
    loaded: true,
    exports: {
      query: async () => {
        throw new Error('yok');
      },
    },
  };
  delete require.cache[require.resolve('../iliski-verisi.cjs')];
  try {
    const { iliskiVerisi } = require('../iliski-verisi.cjs');
    const v = await iliskiVerisi();
    const h = v.hostlar.get('SRV1');
    assert.equal(h.jboss, null, 'xml_ozeti NULL: olculmedi');
    assert.deepEqual(h.web.ipler, ['10.0.0.5']);
    const vv = h.web.kurulumlar[0].vhostlar[0];
    assert.ok(
      !('buyuk' in vv) && !('dosya' in vv.hedefler[0]) && !('ilk_yollar' in vv.log),
      'projeksiyon yalniz gerekenleri tasir',
    );
    assert.equal(h.web.kurulumlar[0].hata_sayisi, 1);
    assert.equal(v.ipEnvanteri.okunamadi, true);
    assert.ok(grafikKur({ hosts: [], veri: v }).dugumler.has(A.vhost('SRV1', 'IHS', 'a', 80)));
  } finally {
    delete require.cache[DB];
    delete require.cache[INV];
  }
});

test('IG13 IP sahipligi yalniz Faz W ip addr listesinden de kurulur', () => {
  const hosts = [sunucu('WEBX'), sunucu('APPX', { jvms: [jvm('APPX1', { gen: 7 })] })];
  const k7 = kurulum({
    nesil: '7',
    sunucular: [{ ad: 'APPX1', grup: 'g', soket_grubu: '', port_ofseti: null }],
    gruplar: [{ ad: 'g', profil: 'p', soket_grubu: 's', port_ofseti: 0 }],
    soket_gruplari: [sokGrup()],
  });
  const v = veri({
    APPX: { jboss: [k7], web: { durum: 'WEB_YOK', ipler: ['10.5.5.5'], kurulumlar: [] } },
    WEBX: {
      web: {
        durum: 'TAM',
        ipler: [],
        kurulumlar: [
          webK({
            workers: [{ ad: 'w', tur: 'ajp13', host: '10.5.5.5', port: 8009, uyeler: [] }],
            vhostlar: [vhostW('x.ornek.local', '*:80', { jk: ['w'] })],
          }),
        ],
      },
    },
  });
  const g = grafikKur({ hosts, veri: v });
  assert.deepEqual(
    kenarlar(g, A.vhost('WEBX', 'IHS', 'x.ornek.local', 80)).map((e) => e.hedef),
    [A.jvm('APPX', 7, 'APPX1')],
  );
});

test('IG14 sunucu adi: UE FQDN / kisa ayni sunucu; IPv4 adi kisaltilmaz; UE sunucusu dugum ve tarama ani', async () => {
  // IPv4 adli sunucular tek "sunucu:10" dugumune cokmez (assess shortHost ile ayni kural).
  assert.equal(A.sunucu('10.1.1.5'), 'sunucu:10.1.1.5');
  assert.notEqual(A.sunucu('10.1.1.5'), A.sunucu('10.1.1.6'));
  assert.equal(A.sunucu('appsrv01.ornek.local'), 'sunucu:APPSRV01');

  // Uygulama Envanteri satirlari: ayni sunucu FQDN ve kisa adla (en yeni kalir, sira fark etmez), IP adli iki sunucu.
  const path = require('node:path');
  const DB = path.join(__dirname, '..', '..', 'db', 'index.cjs');
  const INV = path.join(__dirname, '..', '..', 'inventory', 'mssql.cjs');
  const satir = (host, taranma_utc, ip = '10.0.1.1') => ({
    host,
    taranma_utc,
    xml_ozeti: null,
    web_ozeti: JSON.stringify({
      durum: 'WEB_YOK',
      ipler: { durum: 'OLCULDU', liste: [{ ip }] },
      kurulumlar: [],
    }),
    baglanti_ozeti: null,
    was_ozeti: null,
  });
  const oku = async (rows) => {
    require.cache[DB] = {
      id: DB,
      filename: DB,
      loaded: true,
      exports: { query: async () => ({ rows }) },
    };
    require.cache[INV] = {
      id: INV,
      filename: INV,
      loaded: true,
      exports: {
        query: async () => ({ recordset: [{ host: 'appsrv01.ornek.local', ip: '10.0.1.1' }] }),
      },
    };
    delete require.cache[require.resolve('../iliski-verisi.cjs')];
    try {
      return await require('../iliski-verisi.cjs').iliskiVerisi();
    } finally {
      delete require.cache[DB];
      delete require.cache[INV];
    }
  };
  const eskiOnce = [
    satir('appsrv01.ornek.local', '2026-11-05 01:00:00'),
    satir('APPSRV01', '2026-11-07 01:00:00'),
    satir('10.1.1.5', '2026-11-07 01:00:00', '10.1.1.5'),
    satir('10.1.1.6', '2026-11-07 01:00:00', '10.1.1.6'),
  ];
  for (const rows of [eskiOnce, [...eskiOnce].reverse()]) {
    const v = await oku(rows);
    assert.deepEqual([...v.hostlar.keys()].sort(), ['10.1.1.5', '10.1.1.6', 'APPSRV01']);
    assert.equal(v.hostlar.get('APPSRV01').taranma, '2026-11-07T01:00:00.000Z', 'en yeni tarama');
    assert.deepEqual(v.ipEnvanteri.satirlar, [{ host: 'APPSRV01', ip: '10.0.1.1' }]);
  }

  // Server Hub FQDN, UE kisa ad, ayni IP: tek sahip (kayan degil); TAZELIK ve IP_ENVANTERI yazilir.
  const v = await oku(eskiOnce);
  const hosts = [sunucu('appsrv01.ornek.local', { ips: [{ ip: '10.0.1.1' }] })];
  const g = grafikKur({ hosts, veri: v });
  const ip = g.dugumler.get('ip:10.0.1.1');
  assert.deepEqual([ip.veri.sahipSayisi, ip.veri.kayan], [1, false]);
  const d = dogrula(g, { veri: v });
  assert.equal((d.get('sunucu:APPSRV01') || []).find((x) => x.kod === 'TAZELIK').durum, 'UYUM');
  assert.equal((d.get('ip:10.0.1.1') || []).find((x) => x.kod === 'IP_ENVANTERI').durum, 'UYUM');
  // Server Hub'da olmayan UE sunucusu da dugum; tarama ani senaryo motorunun tazelik girdisi.
  const ipAdli = g.dugumler.get('sunucu:10.1.1.5');
  assert.ok(ipAdli && ipAdli.kaynaklar.includes('uygulama_envanteri'));
  assert.equal(ipAdli.veri.ueTaranma, '2026-11-07T01:00:00.000Z');
  assert.equal(g.dugumler.get('sunucu:APPSRV01').veri.ueTaranma, '2026-11-07T01:00:00.000Z');
});

test('IG15 iliski verisi partili okunur: once (host, kosu, bayt) listesi, agir kolonlar bayt butcesiyle', async () => {
  const path = require('node:path');
  const DB = path.join(__dirname, '..', '..', 'db', 'index.cjs');
  const INV = path.join(__dirname, '..', '..', 'inventory', 'mssql.cjs');
  const MB = 1024 * 1024;
  const oku = async (liste, { agirHata = null } = {}) => {
    const sorgular = [];
    require.cache[DB] = {
      id: DB,
      filename: DB,
      loaded: true,
      exports: {
        query: async (sql, params = []) => {
          if (/DATALENGTH/.test(sql)) {
            sorgular.push({ tur: 'liste', sql });
            return { rows: liste };
          }
          if (agirHata) throw new Error(agirHata);
          const istenen = JSON.parse(params[0]);
          sorgular.push({ tur: 'agir', sql, istenen });
          return {
            rows: istenen.map((x) => ({
              host: x.h,
              taranma_utc: '2026-11-07 01:00:00',
              xml_ozeti: null,
              web_ozeti: null,
              baglanti_ozeti: null,
              was_ozeti: null,
            })),
          };
        },
      },
    };
    require.cache[INV] = {
      id: INV,
      filename: INV,
      loaded: true,
      exports: { query: async () => ({ recordset: [] }) },
    };
    delete require.cache[require.resolve('../iliski-verisi.cjs')];
    try {
      return { v: await require('../iliski-verisi.cjs').iliskiVerisi(), sorgular };
    } finally {
      delete require.cache[DB];
      delete require.cache[INV];
    }
  };
  const h = (i, bayt) => ({ host: `SRV${String(i).padStart(4, '0')}`, kosu_id: 7, bayt });

  // Bes agir sunucu (20 MB): butce 32 MB -> her parti tek sunucu; liste sorgusu agir kolon okumaz.
  const a = await oku([1, 2, 3, 4, 5].map((i) => h(i, 20 * MB)));
  assert.equal(a.v.hostlar.size, 5);
  const liste = a.sorgular.filter((s) => s.tur === 'liste');
  const agir = a.sorgular.filter((s) => s.tur === 'agir');
  assert.equal(liste.length, 1);
  const listeKolonlari = liste[0].sql.replace(/DATALENGTH\(h\.\w+\)/g, '');
  assert.ok(!/_ozeti/.test(listeKolonlari), 'liste sorgusu agir kolon cekmez (yalniz boyutu)');
  assert.deepEqual(
    agir.map((s) => s.istenen.length),
    [1, 1, 1, 1, 1],
  );
  assert.match(agir[0].sql, /OPENJSON\(\$1\)/);
  assert.deepEqual(agir[0].istenen[0], { h: 'SRV0001', k: 7 });

  // Kucukler bir arada; butceyi tek basina asan sunucu kendi partisinde; parti en cok 500 satir.
  const b = await oku([h(1, MB), h(2, MB), h(3, 40 * MB), h(4, MB)]);
  assert.deepEqual(
    b.sorgular.filter((s) => s.tur === 'agir').map((s) => s.istenen.map((x) => x.h)),
    [['SRV0001', 'SRV0002'], ['SRV0003'], ['SRV0004']],
  );
  const c = await oku(Array.from({ length: 1200 }, (_, i) => h(i, 100)));
  assert.deepEqual(
    c.sorgular.filter((s) => s.tur === 'agir').map((s) => s.istenen.length),
    [500, 500, 200],
  );
  assert.equal(c.v.hostlar.size, 1200);

  // Agir parti okunamazsa okunamadi (bos liste "veri yok" sanilmasin).
  const d = await oku([h(1, MB)], { agirHata: 'zaman asimi' });
  assert.deepEqual([d.v.okunamadi, d.v.hata], [true, 'zaman asimi']);

  // partile saf: bos liste, sayi olmayan bayt 0 sayilir.
  const { partile } = require('../iliski-verisi.cjs');
  assert.deepEqual(partile([]), []);
  assert.deepEqual(partile([{ bayt: 'x' }, { bayt: null }], 10).length, 1);
});
