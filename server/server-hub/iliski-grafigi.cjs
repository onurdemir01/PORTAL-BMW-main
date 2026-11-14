// server/server-hub/iliski-grafigi.cjs - Varlik indeksi ve iliski grafigi (2026-11-07; saf, birim testli).
//
// Kullanici: "Client -> LB -> WEB -> APP; web ve app ayri sunucuda ya da ayni sunucuda olabilir, web'in
// configlerinden anlasilir ... app katmani ile web katmani iliskisini beraber inceleyerek retirement yorumu".
// Bu modul butun kaynaklari KANONIK ANAHTARLI dugumlere ve KANITLI kenarlara cevirir; senaryo motoru
// (PR-4), kalici notlar (PR-5) ve Retirement Analizi ekrani (PR-6) ayni grafigi kullanir.
//
// DUGUMLER: sunucu:<HOST> | jvm:<HOST>|<nesil>|<AD> | was:<HOST>|<AD> | web:<HOST>|<URUN> |
//           vhost:<HOST>|<URUN>|<server_name>|<port> | ip:<IP> | dns:<ad> | app:<TABAN>
// KENARLAR (kaynak -> hedef, tur): barindirir (sunucu -> jvm / was / web), sunar (web -> vhost),
//   dinler (vhost -> ip), ip_sahibi (sunucu -> ip), ad (dns -> vhost), kopya (app -> jvm / was),
//   yonlendirir (vhost -> jvm / was / vhost), cagirir (sunucu -> jvm / was; baglanti goruntusu).
// Her kenar YONTEMLERINI tasir: { ad, aile, guven, kanit }. Guven:
//   KESIN  hedef host + port birebir (Server Hub proxy hedefi = JVM portu, Faz W ProxyPass / BalancerMember /
//          JkMount + workers.properties / WAS eklenti transport'u = Faz A yapilandirilmis port)
//   GUCLU  mod_cluster: balancer adi + JBoss proxy listesi bu web sunucusu (ikisi birden)
//   ZAYIF  yalniz ad (Web-App iliskisi, alias, mod_cluster'in tek kosulu)
// Durum: farkli AILEDEN (server_hub / config / ad) en az iki yontem -> DOGRULANDI; tek aile -> TEK_KAYNAK;
//   ayni vhost icin Server Hub ve config FARKLI JVM kumelerine gidiyorsa -> CELISKI (karari kilitler).
// OLCULEMEDI != YOK: bir kaynak okunamadiysa o kaynaga dayanan kenar KURULMAZ; "kenar yok" "iliski yok"
// demek degildir, dugumun veri.kaynaklar alani hangi kaynaklarin bu varligi gordugunu soyler.
'use strict';

const { hedefSunucusu, ipSahipleri } = require('../retirement/discover.cjs');
const { tabanAd } = require('./capraz.cjs');

const U = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toUpperCase();
const L = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toLowerCase();
// IPv4 adi kisaltilmaz ('10.1.1.5' -> '10' olur, farkli sunucular tek dugume coker); assess shortHost ile ayni.
const kisa = (h) => {
  const s = String(h == null ? '' : h).trim();
  return /^\d+\.\d+\.\d+\.\d+$/.test(s) ? s : U(s.split('.')[0]);
};

const GUVEN = { KESIN: 3, GUCLU: 2, ZAYIF: 1 };
const AILE = {
  server_hub_proxy: 'server_hub',
  web_app: 'ad',
  alias: 'ad',
  ad_kurali: 'ad',
  config_port: 'config',
  mod_jk: 'config',
  mod_cluster: 'config',
  was_plugin: 'config',
  baglanti: 'baglanti',
};
const SOKET_ADLARI = ['ajp', 'http', 'https'];

const A = {
  sunucu: (h) => `sunucu:${kisa(h)}`,
  jvm: (h, nesil, ad) =>
    `jvm:${kisa(h)}|${nesil == null || nesil === '' ? '?' : String(nesil)}|${U(ad)}`,
  was: (h, ad) => `was:${kisa(h)}|${U(ad)}`,
  web: (h, urun) => `web:${kisa(h)}|${U(urun)}`,
  vhost: (h, urun, sn, port) => `vhost:${kisa(h)}|${U(urun)}|${L(sn)}|${port == null ? '' : port}`,
  ip: (ip) => `ip:${String(ip || '').trim()}`,
  dns: (ad) => `dns:${L(ad)}`,
  app: (ad) => `app:${U(ad)}`,
};

/** '10.0.0.5:443' / '*:80' / '443' / '[::1]:8443' -> { ip, port } (ip '*' ya da bos: belirli IP yok). */
function adresCoz(s) {
  const t = String(s || '')
    .trim()
    .split(/[\s,]+/)[0];
  const m = /^\[([^\]]+)\]:(\d+)$/.exec(t) || /^([^:]+):(\d+)$/.exec(t);
  if (m) return { ip: m[1], port: Number(m[2]) };
  if (/^\d+$/.test(t)) return { ip: '*', port: Number(t) };
  return { ip: t || '*', port: null };
}
const belirliIp = (ip) =>
  !!ip &&
  ip !== '*' &&
  ip !== '_default_' &&
  ip !== '0.0.0.0' &&
  ip !== '::' &&
  /^[0-9a-f.:]+$/i.test(ip);

class Grafik {
  constructor() {
    this.dugumler = new Map();
    this.kenarlar = [];
    this._kenarNo = new Map();
    this._komsu = new Map();
  }

  dugum(anahtar, tur, ad, veri = {}, kaynak = null) {
    let d = this.dugumler.get(anahtar);
    if (!d) {
      d = { anahtar, tur, ad, veri: {}, kaynaklar: [] };
      this.dugumler.set(anahtar, d);
    }
    Object.assign(d.veri, veri);
    if (kaynak && !d.kaynaklar.includes(kaynak)) d.kaynaklar.push(kaynak);
    return d;
  }

  kenar(kaynak, hedef, tur, yontem) {
    const k = `${kaynak}>${hedef}>${tur}`;
    let no = this._kenarNo.get(k);
    if (no == null) {
      no = this.kenarlar.length;
      this.kenarlar.push({
        kaynak,
        hedef,
        tur,
        yontemler: [],
        guven: null,
        durum: null,
        celiski: null,
      });
      this._kenarNo.set(k, no);
      for (const u of [kaynak, hedef]) {
        if (!this._komsu.has(u)) this._komsu.set(u, []);
        this._komsu.get(u).push(no);
      }
    }
    const e = this.kenarlar[no];
    if (yontem && !e.yontemler.some((y) => y.ad === yontem.ad && y.kanit === yontem.kanit))
      e.yontemler.push(yontem);
    return e;
  }

  komsuKenarlar(anahtar) {
    return (this._komsu.get(anahtar) || []).map((i) => this.kenarlar[i]);
  }

  /** Kenar guveni / durumu: yontemlerden; CELISKI isareti korunur. */
  sonlandir() {
    for (const e of this.kenarlar) {
      e.guven = e.yontemler.reduce(
        (g, y) => (GUVEN[y.guven] > (GUVEN[g] || 0) ? y.guven : g),
        null,
      );
      const aileler = new Set(e.yontemler.map((y) => y.aile));
      e.durum = (() => { if (e.celiski) return 'CELISKI'; if (aileler.size >= 2) return 'DOGRULANDI'; if (e.yontemler.length) return 'TEK_KAYNAK'; return null; })();
    }
    return this;
  }
}

const y = (ad, guven, kanit) => ({
  ad,
  aile: AILE[ad] || ad,
  guven,
  kanit: String(kanit || '').slice(0, 300),
});

/**
 * Faz A: JBoss kurulumundaki her sunucunun yapilandirilmis portlari. Sunucunun kendi port grubu yoksa
 * grubun; ofset sunucunun port-offset'i yoksa grubun (yoksa 0). Port grubu ya da soket bulunamazsa port YOK.
 */
function fazAPortlari(kurulum) {
  const gruplar = new Map(kurulum.gruplar.map((g) => [g.ad, g]));
  const soketler = new Map(kurulum.soket_gruplari.map((s) => [s.ad, s]));
  const out = [];
  for (const s of kurulum.sunucular) {
    const g = gruplar.get(s.grup) || {};
    const sg = soketler.get(s.soket_grubu || g.soket_grubu || '');
    if (!sg) continue;
    const ofset = s.port_ofseti != null ? s.port_ofseti : g.port_ofseti || 0;
    for (const ad of SOKET_ADLARI) {
      const taban = Number(sg.soketler[ad]);
      if (Number.isFinite(taban) && taban > 0)
        out.push({ sunucu: s.ad, grup: s.grup, tur: ad, port: taban + ofset, taban, ofset });
    }
  }
  return out;
}

/** mod_cluster: JBoss sunucusunun profili hangi web hostlarina kaydoluyor (outbound hedefleri / proxy-list). */
function mcHedefHostlari(kurulum, sunucuAd, ipMap) {
  const s = kurulum.sunucular.find((x) => x.ad === sunucuAd);
  if (!s) return null;
  const g = kurulum.gruplar.find((x) => x.ad === s.grup) || {};
  const p = kurulum.profiller.find((x) => x.ad === g.profil);
  if (!p || !p.modcluster) return null;
  const sg = kurulum.soket_gruplari.find((x) => x.ad === (s.soket_grubu || g.soket_grubu));
  const hostlar = new Set();
  for (const ad of p.modcluster.proxies || []) {
    const o = sg && sg.outbound.find((x) => x.ad === ad);
    if (o) {
      const h = hedefSunucusu(o.host, '', ipMap);
      if (h) hostlar.add(h);
    }
  }
  for (const hp of p.modcluster.proxy_list || []) {
    const h = hedefSunucusu(String(hp).split(':')[0], '', ipMap);
    if (h) hostlar.add(h);
  }
  return {
    hostlar,
    balancer: L(p.modcluster.balancer),
    advertise: p.modcluster.advertise !== false,
  };
}

/**
 * @param {{ hosts: object[], veri?: { hostlar: Map<string, object>, ipEnvanteri?: object } }} girdi
 *   hosts: assess sunuculari; veri: iliski-verisi.cjs (Faz A / W / baglanti / WAS projeksiyonlari)
 */
function grafikKur({ hosts = [], veri = null } = {}) {
  const g = new Grafik();
  const vh = veri && veri.hostlar instanceof Map ? veri.hostlar : new Map();

  // ── IP sahipligi: Server Hub IP'leri + Faz W `ip addr` (IPInventory LB listesidir, sahiplik DEGIL) ──
  const ipSatir = [];
  // Sahip adi kisa ad: ayni sunucu iki kaynakta (FQDN / kisa) iki sahip sayilip IP "kayan" gorunmesin.
  for (const h of hosts)
    for (const ip of h.ips || []) ipSatir.push({ host: kisa(h.host), ip: ip.ip });
  for (const [host, v] of vh)
    for (const ip of (v.web && v.web.ipler) || []) ipSatir.push({ host: kisa(host), ip });
  const ipMap = ipSahipleri(ipSatir);
  for (const [ip, sahipler] of ipMap) {
    g.dugum(A.ip(ip), 'ip', ip, { sahipSayisi: sahipler.size, kayan: sahipler.size > 1 });
    for (const s of sahipler)
      g.kenar(A.sunucu(s), A.ip(ip), 'ip_sahibi', y('ip', 'KESIN', 'sunucunun arayuzunde'));
  }

  // ── Port indeksi: host -> port -> [{ hedef dugum, kaynak, aciklama }] ────────────────────────────
  const portIdx = new Map();
  const portEkle = (host, port, hedef, kaynak, aciklama) => {
    if (!Number.isFinite(Number(port)) || Number(port) <= 0) return;
    const h = kisa(host);
    if (!portIdx.has(h)) portIdx.set(h, new Map());
    const m = portIdx.get(h);
    if (!m.has(Number(port))) m.set(Number(port), []);
    const l = m.get(Number(port));
    if (!l.some((x) => x.hedef === hedef && x.kaynak === kaynak))
      l.push({ hedef, kaynak, aciklama });
  };
  const portHedefleri = (host, port) =>
    (portIdx.get(kisa(host)) || new Map()).get(Number(port)) || [];

  // ── Server Hub: sunucular, JVM'ler, web urunleri, vhost'lar ──────────────────────────────────────
  const jvmAnahtari = new Map(); // host|AD -> [anahtar] (nesil bilinmeyen eslesmeler icin)
  const jvmEkle = (host, nesil, ad, veri, kaynak) => {
    const k = A.jvm(host, nesil, ad);
    g.dugum(
      k,
      'jvm',
      ad,
      { host: kisa(host), nesil: nesil == null ? null : String(nesil), ...veri },
      kaynak,
    );
    g.kenar(
      A.sunucu(host),
      k,
      'barindirir',
      y(kaynak === 'server_hub' ? 'server_hub_proxy' : 'config_port', 'KESIN', kaynak),
    );
    const ka = `${kisa(host)}|${U(ad)}`;
    if (!jvmAnahtari.has(ka)) jvmAnahtari.set(ka, new Set());
    jvmAnahtari.get(ka).add(k);
    const taban = tabanAd(ad);
    if (taban) {
      g.dugum(A.app(taban), 'app', taban);
      g.kenar(A.app(taban), k, 'kopya', y('ad_kurali', 'GUCLU', `JVM adi ${ad} -> taban ${taban}`));
    }
    return k;
  };
  for (const h of hosts) {
    g.dugum(
      A.sunucu(h.host),
      'sunucu',
      kisa(h.host),
      { env: h.env || null, tarama: h.scanDate || null, taze: h.fresh !== false },
      'server_hub',
    );
    for (const j of h.jvms || []) {
      const k = jvmEkle(
        h.host,
        Number.isFinite(j.gen) ? j.gen : null,
        j.name,
        {
          calisiyor: j.runningKnown === false ? null : j.running === true,
          autoStart: j.autoStart || 'unknown',
          trafik: j.trafficState || null,
          shPortlari: [
            ...new Set([...(j.ports || []), ...(j.cfgPortsAuth ? j.cfgPorts || [] : [])]),
          ],
        },
        'server_hub',
      );
      for (const p of j.ports || [])
        portEkle(h.host, p, k, 'server_hub', `Server Hub: JVM ${j.name} dinliyor`);
      if (j.cfgPortsAuth)
        for (const p of j.cfgPorts || [])
          portEkle(h.host, p, k, 'server_hub', `Server Hub: JVM ${j.name} yapilandirilmis portu`);
    }
    for (const w of h.web || []) {
      g.dugum(
        A.web(h.host, w.product),
        'web',
        `${kisa(h.host)} ${w.product}`,
        { calisiyor: w.runningKnown === false ? null : w.running === true },
        'server_hub',
      );
      g.kenar(
        A.sunucu(h.host),
        A.web(h.host, w.product),
        'barindirir',
        y('server_hub_proxy', 'KESIN', 'Server Hub web urunu'),
      );
    }
    for (const v of h.vhosts || [])
      vhostEkle(
        h.host,
        v.product,
        v.serverName,
        v.listen,
        String(v.aliases || '')
          .split(/[\s,]+/)
          .filter(Boolean),
        {
          shTrafik: v.trafficState || null,
          shReq7g: v.req7d == null ? null : v.req7d,
          shHc24s: v.hc24h == null ? null : v.hc24h,
          conf: v.confFile || '',
        },
        'server_hub',
      );
  }

  function vhostEkle(host, urun, sn, adres, aliases, veri, kaynak) {
    const a = adresCoz(adres);
    const k = A.vhost(host, urun, sn, a.port);
    g.dugum(
      k,
      'vhost',
      `${sn || '(adsiz)'}${a.port ? ':' + a.port : ''}`,
      { host: kisa(host), urun: U(urun), serverName: L(sn), port: a.port, ip: a.ip, ...veri },
      kaynak,
    );
    g.dugum(A.web(host, urun), 'web', `${kisa(host)} ${U(urun)}`, {}, kaynak);
    g.kenar(
      A.web(host, urun),
      k,
      'sunar',
      y(kaynak === 'server_hub' ? 'server_hub_proxy' : 'config_port', 'KESIN', kaynak),
    );
    for (const ad of [sn, ...(aliases || [])]
      .map(L)
      .filter((x) => x && x !== '_' && !x.includes('*'))) {
      g.dugum(A.dns(ad), 'dns', ad);
      g.kenar(A.dns(ad), k, 'ad', y('ad_kurali', 'KESIN', 'ServerName / ServerAlias'));
    }
    if (belirliIp(a.ip)) {
      g.dugum(A.ip(a.ip), 'ip', a.ip);
      g.kenar(
        k,
        A.ip(a.ip),
        'dinler',
        y('config_port', 'KESIN', `Listen / VirtualHost ${a.ip}:${a.port || ''}`),
      );
    }
    return k;
  }

  // ── Uygulama Envanteri sunuculari: tarama ani (senaryo motoru Faz A / W / baglanti kanitinin tazeligini
  // buradan okur). Server Hub'da olmayan sunucu da dugum olur; yoksa kenarlari sahipsiz kalirdi.
  for (const [host, v] of vh)
    g.dugum(
      A.sunucu(host),
      'sunucu',
      kisa(host),
      { ueTaranma: v.taranma || null },
      'uygulama_envanteri',
    );

  // ── Faz A: JBoss yapilandirilmis portlari, WAS uc noktalari ──────────────────────────────────────
  const fazA = new Map(); // host -> kurulumlar
  for (const [host, v] of vh) {
    if (v.jboss) {
      fazA.set(host, v.jboss);
      for (const k of v.jboss.filter((x) => x.faz)) {
        for (const p of fazAPortlari(k)) {
          const jk = jvmEkle(host, k.nesil === '?' ? null : Number(k.nesil), p.sunucu, {}, 'faz_a');
          const jd = g.dugumler.get(jk);
          jd.veri.fazAPortlari = [...new Set([...(jd.veri.fazAPortlari || []), p.port])];
          portEkle(
            host,
            p.port,
            jk,
            'faz_a',
            `domain/host.xml: ${p.sunucu} ${p.tur} ${p.taban}${p.ofset ? ' + ' + p.ofset : ''} = ${p.port}`,
          );
        }
      }
    }
    for (const s of (v.was && v.was.sunucular) || []) {
      if (s.tur && s.tur !== 'APPLICATION_SERVER') continue;
      const wk = A.was(host, s.ad);
      g.dugum(wk, 'was', s.ad, { host: kisa(host), uygulamalar: s.uygulamalar }, 'was');
      g.kenar(A.sunucu(host), wk, 'barindirir', y('config_port', 'KESIN', 'serverindex.xml'));
      for (const u of s.uclar)
        portEkle(host, u.port, wk, 'was', `serverindex.xml: ${s.ad} ${u.ad} ${u.port}`);
      for (const app of s.uygulamalar || []) {
        const taban = tabanAd(app);
        g.dugum(A.app(taban), 'app', taban);
        g.kenar(A.app(taban), wk, 'kopya', y('ad_kurali', 'GUCLU', `WAS uygulamasi ${app}`));
      }
    }
  }

  // ── Server Hub eslemesi: vhost -> JVM (assess j.vhosts) ──────────────────────────────────────────
  const KIND = {
    EXACT_JVM: ['server_hub_proxy', 'KESIN'],
    PROXY_HOST_ONLY: ['server_hub_proxy', 'ZAYIF'],
    WEB_APP: ['web_app', 'ZAYIF'],
    ALIAS: ['alias', 'ZAYIF'],
  };
  const shHedef = new Map(); // vhost anahtari -> Set(jvm)
  for (const h of hosts) {
    for (const j of h.jvms || []) {
      const jk = A.jvm(h.host, Number.isFinite(j.gen) ? j.gen : null, j.name);
      for (const m of j.vhosts || []) {
        const vk = A.vhost(m.host, m.v.product, m.v.serverName, adresCoz(m.v.listen).port);
        const [ad, guven] = KIND[m.kind] || ['server_hub_proxy', 'ZAYIF'];
        g.kenar(vk, jk, 'yonlendirir', y(ad, guven, `Server Hub esleme (${m.kind})`));
        if (guven === 'KESIN') {
          if (!shHedef.has(vk)) shHedef.set(vk, new Set());
          shHedef.get(vk).add(jk);
        }
      }
    }
  }

  // ── Faz W: vhost'lar ve hedefleri (ProxyPass / Balancer / JkMount / mod_cluster / WAS eklentisi) ──
  const configHedef = new Map(); // vhost anahtari -> Set(jvm / was)
  const hedefBagla = (vk, webHost, th, port, ad, kanitOn) => {
    const sunucu = hedefSunucusu(th, webHost, ipMap);
    if (!sunucu) return false;
    const hs = portHedefleri(sunucu, port);
    if (hs.length) {
      for (const x of hs) {
        g.kenar(
          vk,
          x.hedef,
          'yonlendirir',
          y(ad, 'KESIN', `${kanitOn} -> ${sunucu}:${port} (${x.aciklama})`),
        );
        if (!configHedef.has(vk)) configHedef.set(vk, new Set());
        configHedef.get(vk).add(x.hedef);
      }
      return true;
    }
    // Cok adim (RP -> WEB): hedef portu dinleyen vhost (indeks: ilk geciste butun vhost'lar kuruldu)
    const vs = (vhostPortIdx.get(`${sunucu}|${Number(port)}`) || []).filter((x) => x !== vk);
    for (const x of vs)
      g.kenar(vk, x, 'yonlendirir', y(ad, 'KESIN', `${kanitOn} -> ${sunucu}:${port} (vhost)`));
    return vs.length > 0;
  };
  // Ilk gecis: butun Faz W vhost dugumleri (cok adimli hedef sonradan eklenecek vhost'u kacirmasin).
  const fazWVhost = [];
  for (const [host, v] of vh) {
    if (!v.web) continue;
    for (const k of v.web.kurulumlar) {
      g.dugum(
        A.web(host, k.urun),
        'web',
        `${kisa(host)} ${k.urun}`,
        { fazWCalisiyor: k.calisiyor, configHatasi: k.hata_sayisi },
        'faz_w',
      );
      g.kenar(
        A.sunucu(host),
        A.web(host, k.urun),
        'barindirir',
        y('config_port', 'KESIN', 'Faz W kurulum'),
      );
      for (const vv of k.vhostlar)
        fazWVhost.push({
          host,
          k,
          vv,
          vk: vhostEkle(
            host,
            k.urun,
            vv.server_name,
            vv.adres[0] || '',
            vv.aliases,
            { fazWLog: vv.log, belirsiz: vv.belirsiz },
            'faz_w',
          ),
        });
    }
  }
  const vhostPortIdx = new Map();
  for (const d of g.dugumler.values())
    if (d.tur === 'vhost' && d.veri.port != null) {
      const k = `${d.veri.host}|${d.veri.port}`;
      if (!vhostPortIdx.has(k)) vhostPortIdx.set(k, []);
      vhostPortIdx.get(k).push(d.anahtar);
    }
  // Ikinci gecis: hedefler.
  const sonraMc = [];
  for (const { host, k, vv, vk } of fazWVhost) {
    {
      const workers = new Map(k.workers.map((w) => [w.ad, w]));
      const balancerlar = new Map(k.balancerlar.map((b) => [L(b.ad), b]));
      {
        for (const t of vv.hedefler) {
          if (t.sema === 'balancer' || t.tur === 'mc') {
            const b = balancerlar.get(L(t.host));
            if (b && t.tur !== 'mc')
              for (const u of b.uyeler)
                hedefBagla(
                  vk,
                  host,
                  u.host,
                  u.port,
                  'config_port',
                  `BalancerMember ${u.host}:${u.port}`,
                );
            else sonraMc.push({ vk, host, balancer: L(t.host) });
          } else if (t.host && t.port)
            hedefBagla(
              vk,
              host,
              t.host,
              t.port,
              'config_port',
              `${t.tur} ${t.sema}://${t.host}:${t.port}`,
            );
        }
        const jkWorkerlar = new Set(vv.jk.length ? vv.jk : []);
        for (const ad of jkWorkerlar) {
          const w = workers.get(ad);
          if (!w) continue;
          const uyeler = w.uyeler.length
            ? w.uyeler.map((u) => workers.get(u)).filter(Boolean)
            : [w];
          for (const u of uyeler)
            if (u.host && u.port)
              hedefBagla(
                vk,
                host,
                u.host,
                u.port,
                'mod_jk',
                `JkMount ${ad} -> worker ${u.ad} ${u.host}:${u.port}`,
              );
        }
        if (k.was) {
          const port = adresCoz(vv.adres[0] || '').port;
          for (const r of k.was.rotalar) {
            const grup = (k.was.vhostgruplari[r.vhostgroup] || []).map(String);
            const tutar = grup.some((hp) => {
              const a = adresCoz(hp);
              return (
                a.port === port &&
                (a.ip === '*' ||
                  L(a.ip) === L(vv.server_name) ||
                  vv.aliases.map(L).includes(L(a.ip)))
              );
            });
            if (!tutar) continue;
            const c = k.was.clusterlar.find((x) => x.ad === r.cluster);
            for (const s of (c && c.sunucular) || [])
              hedefBagla(
                vk,
                host,
                s.host,
                s.port,
                'was_plugin',
                `WAS eklentisi ${r.cluster}/${s.ad} ${s.host}:${s.port}`,
              );
          }
        }
      }
    }
  }

  // ── mod_cluster (dinamik balancer): JBoss profili bu web sunucusuna kaydoluyor mu + balancer adi ──
  for (const m of sonraMc) {
    for (const [jh, kurulumlar] of fazA) {
      for (const k of kurulumlar.filter((x) => x.faz)) {
        for (const s of k.sunucular) {
          const mc = mcHedefHostlari(k, s.ad, ipMap);
          if (!mc || !mc.hostlar.has(kisa(m.host))) continue;
          const adTutar = mc.balancer
            ? mc.balancer === m.balancer
            : L(tabanAd(s.ad)) === m.balancer;
          if (mc.balancer && !adTutar) continue;
          const jk = A.jvm(jh, k.nesil === '?' ? null : Number(k.nesil), s.ad);
          g.kenar(
            m.vk,
            jk,
            'yonlendirir',
            y(
              'mod_cluster',
              adTutar ? 'GUCLU' : 'ZAYIF',
              `mod_cluster: ${s.ad} profili ${m.host}'a kaydoluyor${adTutar ? (", balancer " + m.balancer) : ''}`,
            ),
          );
        }
      }
    }
  }

  // ── Celiski: ayni vhost icin Server Hub (KESIN) ve config FARKLI hedef kumeleri ──────────────────
  for (const [vk, sh] of shHedef) {
    const cf = configHedef.get(vk);
    if (!cf || !cf.size) continue;
    const ortak = [...sh].some((x) => cf.has(x));
    if (ortak) continue;
    for (const e of g.komsuKenarlar(vk))
      if (e.kaynak === vk && e.tur === 'yonlendirir' && (sh.has(e.hedef) || cf.has(e.hedef)))
        e.celiski = `Server Hub ${[...sh].join(', ')} diyor, config ${[...cf].join(', ')} diyor`;
  }

  // ── Baglanti goruntusu: uzak IP -> cagiran sunucu ───────────────────────────────────────────────
  for (const [host, v] of vh) {
    if (!v.baglanti || v.baglanti.durum !== 'OLCULDU') continue;
    for (const p of v.baglanti.portlar) {
      const hedefler = portHedefleri(host, p.port).map((x) => x.hedef);
      // Yapilandirilmis portlardan BIRI dinleniyorsa dugum "dinleniyor"; hicbiri dinlenmiyorsa false.
      for (const x of portHedefleri(host, p.port).filter(
        (z) => z.kaynak === 'faz_a' || z.kaynak === 'was',
      )) {
        const dd = g.dugumler.get(x.hedef);
        dd.veri.dinleniyor = dd.veri.dinleniyor === true || p.dinleniyor === true;
      }
      for (const u of p.uzaklar) {
        const sahip = (() => { if (/^127\.|^::1$/.test(u.ip)) return host; if (ipMap.get(u.ip) && ipMap.get(u.ip).size === 1) return [...ipMap.get(u.ip)][0]; return null; })();
        const kaynak = sahip ? A.sunucu(sahip) : A.ip(u.ip);
        if (!sahip) g.dugum(A.ip(u.ip), 'ip', u.ip, {});
        for (const hd of hedefler)
          g.kenar(
            kaynak,
            hd,
            'cagirir',
            y('baglanti', 'KESIN', `ESTABLISHED ${u.ip} -> ${host}:${p.port} (${u.gozlem} gozlem)`),
          );
      }
    }
  }

  return g.sonlandir();
}

// ── Arama ve varlik ayrintisi ─────────────────────────────────────────────────────────────────────
const TUR_ONCELIK = { app: 0, sunucu: 1, vhost: 2, dns: 3, jvm: 4, was: 5, web: 6, ip: 7 };

/** Uygulama / sunucu / vhost / DNS / IP adinda gecen dugumler (en cok `sinir`). */
function ara(g, metinHam, sinir = 50) {
  const q = L(metinHam);
  if (!q) return [];
  const out = [];
  for (const d of g.dugumler.values()) {
    const ad = L(d.ad);
    if (!ad.includes(q) && !d.anahtar.toLowerCase().includes(q)) continue;
    out.push({ d, tam: (() => { if (ad === q) return 0; if (ad.startsWith(q)) return 1; return 2; })() });
  }
  out.sort(
    (a, b) =>
      a.tam - b.tam ||
      (TUR_ONCELIK[a.d.tur] ?? 9) - (TUR_ONCELIK[b.d.tur] ?? 9) ||
      a.d.ad.localeCompare(b.d.ad),
  );
  return out
    .slice(0, sinir)
    .map(({ d }) => ({ anahtar: d.anahtar, tur: d.tur, ad: d.ad, host: d.veri.host || null }));
}

/** Bir dugumun ayrintisi: kendisi, kenarlari (karsi dugumun ozeti ile) ve bagli bilesenin boyutu. */
function varlik(g, anahtar, { bilesenSiniri = 500 } = {}) {
  const d = g.dugumler.get(anahtar);
  if (!d) return null;
  const kenarlar = g.komsuKenarlar(anahtar).map((e) => {
    const karsi = g.dugumler.get(e.kaynak === anahtar ? e.hedef : e.kaynak);
    return {
      yon: e.kaynak === anahtar ? 'cikis' : 'giris',
      tur: e.tur,
      guven: e.guven,
      durum: e.durum,
      celiski: e.celiski,
      yontemler: e.yontemler,
      karsi: karsi ? { anahtar: karsi.anahtar, tur: karsi.tur, ad: karsi.ad } : null,
    };
  });
  // Bagli bilesen (BFS, sinirli): "zincir" yayilimi ve ekran icin
  const gorulen = new Set([anahtar]);
  const kuyruk = [anahtar];
  while (kuyruk.length && gorulen.size < bilesenSiniri) {
    const u = kuyruk.shift();
    for (const e of g.komsuKenarlar(u)) {
      const w = e.kaynak === u ? e.hedef : e.kaynak;
      if (!gorulen.has(w)) {
        gorulen.add(w);
        kuyruk.push(w);
      }
    }
  }
  return { dugum: d, kenarlar, bilesen: { boyut: gorulen.size, kesildi: kuyruk.length > 0 } };
}

module.exports = {
  grafikKur,
  ara,
  varlik,
  adresCoz,
  fazAPortlari,
  mcHedefHostlari,
  A,
  GUVEN,
  Grafik,
};
