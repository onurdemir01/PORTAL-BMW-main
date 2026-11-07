// server/server-hub/dogrulama.cjs - Kaynaklar arasi otomatik capraz dogrulama (2026-11-07; saf, birim testli).
//
// Kullanici: "yaniltici false veri uretmememiz cok kiymetli; her ciktimiz bir noktada verify edilmeli,
// otomatik baska verilerle tutarli olmaliyiz". Her karar girdisinin BAGIMSIZ ikinci kaynagi burada
// karsilastirilir. Sonuc dugum basina: { kod, durum: UYUM | CELISKI | OLCULMEDI, kaynaklar, metin }.
// CELISKI senaryo motorunda (PR-4) karari KILITLER ("su iki kaynak celisiyor" yazilir); OLCULMEDI ikinci
// kaynak yoksa yazilir ve "dogrulandi" sayilmaz.
//
//   PORT_UYUMU     jvm    Server Hub (CLI / XML) portlari <-> Faz A domain/host.xml hesabi
//   TRAFIK_UYUMU   vhost  Server Hub req_7d (gunluk) <-> Faz W access log gercek_7g (ikisi olculmusse)
//   VHOST_KAPSAMI  web    Server Hub vhost listesi <-> Faz W config agaci (ayni urun)
//   LISTEN_IP      vhost  vhost'un dinledigi IP sunucunun arayuzunde mi (Server Hub + Faz W ip addr)
//   CALISMA_DINLEME jvm   Server Hub calisiyor <-> baglanti goruntusunde yapilandirilmis port dinleniyor mu
//   WEB_CALISMA    web    Server Hub web calisiyor <-> Faz W surec goruntusu
//   TAZELIK        sunucu Server Hub tarama tarihi <-> Uygulama Envanteri taramasi (en cok TAZELIK_GUN fark)
//   IP_ENVANTERI   ip     IPInventory (LB listesi) bu IP'yi bu sunucuya yaziyor ama arayuzde yok
'use strict';

const TAZELIK_GUN = 7;
const GUN_MS = 86400000;

function ekle(out, anahtar, kod, durum, kaynaklar, metin) {
  if (!out.has(anahtar)) out.set(anahtar, []);
  out.get(anahtar).push({ kod, durum, kaynaklar, metin: String(metin || '').slice(0, 300) });
}

/**
 * @param {import('./iliski-grafigi.cjs').Grafik} g
 * @param {{ veri?: { hostlar: Map<string, object>, ipEnvanteri?: { okunamadi?: boolean, satirlar: object[] } } }} [ek]
 * @returns {Map<string, Array<{ kod: string, durum: string, kaynaklar: string[], metin: string }>>}
 */
function dogrula(g, { veri = null } = {}) {
  const out = new Map();
  const vh = veri && veri.hostlar instanceof Map ? veri.hostlar : new Map();

  for (const d of g.dugumler.values()) {
    if (d.tur === 'jvm') {
      // PORT_UYUMU: Server Hub'in gordugu portlar ile Faz A hesabi. Iki taraf da yoksa yazilmaz.
      const sh = new Set(d.veri.shPortlari || []);
      const fa = new Set(d.veri.fazAPortlari || []);
      const shVar = d.kaynaklar.includes('server_hub') && sh.size > 0;
      const faVar = d.kaynaklar.includes('faz_a') && fa.size > 0;
      if (shVar && faVar) {
        const ortak = [...sh].filter((p) => fa.has(p));
        if (ortak.length)
          ekle(
            out,
            d.anahtar,
            'PORT_UYUMU',
            'UYUM',
            ['server_hub', 'faz_a'],
            `ortak port ${ortak.join(', ')}`,
          );
        else
          ekle(
            out,
            d.anahtar,
            'PORT_UYUMU',
            'CELISKI',
            ['server_hub', 'faz_a'],
            `Server Hub ${[...sh].join(', ')}, domain/host.xml ${[...fa].join(', ')}`,
          );
      } else if (shVar || faVar)
        ekle(
          out,
          d.anahtar,
          'PORT_UYUMU',
          'OLCULMEDI',
          [shVar ? 'server_hub' : 'faz_a'],
          'ikinci kaynak yok (Faz A taramasi ya da Server Hub portu)',
        );
      // CALISMA_DINLEME: baglanti goruntusu yapilandirilmis portu dinliyor mu
      if (d.veri.dinleniyor != null && d.veri.calisiyor != null) {
        const uyum = d.veri.dinleniyor === d.veri.calisiyor;
        ekle(
          out,
          d.anahtar,
          'CALISMA_DINLEME',
          uyum ? 'UYUM' : 'CELISKI',
          ['server_hub', 'baglanti'],
          uyum
            ? d.veri.calisiyor
              ? 'calisiyor ve portu dinleniyor'
              : 'kapali ve portu dinlenmiyor'
            : d.veri.calisiyor
              ? 'Server Hub calisiyor diyor ama yapilandirilmis portlari dinlenmiyor'
              : 'Server Hub kapali diyor ama yapilandirilmis portu dinleniyor',
        );
      }
    } else if (d.tur === 'vhost') {
      const l = d.veri.fazWLog;
      const sh = d.veri.shReq7g;
      const shOlcul =
        d.kaynaklar.includes('server_hub') &&
        Number.isFinite(sh) &&
        sh >= 0 &&
        (d.veri.shTrafik == null || ['ACTIVE', 'NO_RECENT_TRAFFIC'].includes(d.veri.shTrafik));
      const wOlcul = l && l.durum === 'OLCULDU' && Number.isFinite(l.gercek_7g);
      if (shOlcul && wOlcul) {
        const uyum = sh > 0 === l.gercek_7g > 0;
        ekle(
          out,
          d.anahtar,
          'TRAFIK_UYUMU',
          uyum ? 'UYUM' : 'CELISKI',
          ['server_hub', 'faz_w'],
          `Server Hub 7 gun ${sh} istek, access log ${l.gercek_7g} gercek istek${uyum ? '' : ' (pencereler / tarama anlari farkli olabilir; elle bakin)'}`,
        );
      } else if (shOlcul || wOlcul)
        ekle(
          out,
          d.anahtar,
          'TRAFIK_UYUMU',
          'OLCULMEDI',
          [shOlcul ? 'server_hub' : 'faz_w'],
          l && l.durum !== 'OLCULDU' ? `access log ${l.durum || 'yok'}` : 'ikinci kaynak yok',
        );
      // LISTEN_IP: belirli bir IP dinleniyorsa o IP sunucunun arayuzunde olmali
      if (d.veri.ip && /^[0-9a-f.:]+$/i.test(d.veri.ip) && !['0.0.0.0', '::'].includes(d.veri.ip)) {
        const ipD = g.dugumler.get(`ip:${d.veri.ip}`);
        const sahip =
          ipD &&
          g
            .komsuKenarlar(ipD.anahtar)
            .some((e) => e.tur === 'ip_sahibi' && e.kaynak === `sunucu:${d.veri.host}`);
        const olculdu =
          [...vh.values()].some((v) => v.host === d.veri.host && v.web && v.web.ipler) ||
          g.komsuKenarlar(`sunucu:${d.veri.host}`).some((e) => e.tur === 'ip_sahibi');
        if (sahip)
          ekle(out, d.anahtar, 'LISTEN_IP', 'UYUM', ['config', 'ip'], `${d.veri.ip} sunucuda`);
        else if (olculdu)
          ekle(
            out,
            d.anahtar,
            'LISTEN_IP',
            'CELISKI',
            ['config', 'ip'],
            `vhost ${d.veri.ip} dinliyor ama bu IP sunucunun arayuzunde yok`,
          );
        else
          ekle(
            out,
            d.anahtar,
            'LISTEN_IP',
            'OLCULMEDI',
            ['config'],
            'sunucunun IP listesi olculmedi',
          );
      }
    } else if (d.tur === 'web') {
      if (d.veri.calisiyor != null && d.veri.fazWCalisiyor != null) {
        const uyum = d.veri.calisiyor === d.veri.fazWCalisiyor;
        ekle(
          out,
          d.anahtar,
          'WEB_CALISMA',
          uyum ? 'UYUM' : 'CELISKI',
          ['server_hub', 'faz_w'],
          uyum
            ? d.veri.calisiyor
              ? 'calisiyor'
              : 'calismiyor'
            : `Server Hub ${d.veri.calisiyor ? 'calisiyor' : 'calismiyor'}, Faz W ${d.veri.fazWCalisiyor ? 'calisiyor' : 'calismiyor'}`,
        );
      }
      // VHOST_KAPSAMI: ayni web uzerindeki vhost'larin kaynaklari
      const vhostlar = g
        .komsuKenarlar(d.anahtar)
        .filter((e) => e.tur === 'sunar')
        .map((e) => g.dugumler.get(e.hedef))
        .filter(Boolean);
      const ikiKaynak = d.kaynaklar.includes('server_hub') && d.kaynaklar.includes('faz_w');
      if (ikiKaynak && vhostlar.length) {
        const yalnizSh = vhostlar
          .filter((x) => x.kaynaklar.includes('server_hub') && !x.kaynaklar.includes('faz_w'))
          .map((x) => x.ad);
        const yalnizW = vhostlar
          .filter((x) => x.kaynaklar.includes('faz_w') && !x.kaynaklar.includes('server_hub'))
          .map((x) => x.ad);
        if (!yalnizSh.length && !yalnizW.length)
          ekle(
            out,
            d.anahtar,
            'VHOST_KAPSAMI',
            'UYUM',
            ['server_hub', 'faz_w'],
            `${vhostlar.length} vhost iki kaynakta`,
          );
        else
          ekle(
            out,
            d.anahtar,
            'VHOST_KAPSAMI',
            'CELISKI',
            ['server_hub', 'faz_w'],
            `${yalnizSh.length ? `yalniz Server Hub: ${yalnizSh.slice(0, 5).join(', ')}` : ''}${yalnizSh.length && yalnizW.length ? '; ' : ''}${yalnizW.length ? `yalniz config: ${yalnizW.slice(0, 5).join(', ')}` : ''}`,
          );
      }
    } else if (d.tur === 'sunucu') {
      const v = vh.get(d.ad);
      const sh = d.veri.tarama ? Date.parse(d.veri.tarama) : NaN;
      const ear = v && v.taranma ? Date.parse(v.taranma) : NaN;
      if (Number.isFinite(sh) && Number.isFinite(ear)) {
        const fark = Math.round(Math.abs(sh - ear) / GUN_MS);
        ekle(
          out,
          d.anahtar,
          'TAZELIK',
          fark <= TAZELIK_GUN ? 'UYUM' : 'CELISKI',
          ['server_hub', 'uygulama_envanteri'],
          fark <= TAZELIK_GUN
            ? `taramalar arasi ${fark} gun`
            : `Server Hub ile Uygulama Envanteri taramalari arasinda ${fark} gun var: kanitlar farkli zamanlardan`,
        );
      }
    }
  }

  // IP_ENVANTERI: LB listesi bu sunucuya bir IP yaziyor; Faz W arayuz listesi olculmusse orada olmali.
  const ipe = veri && veri.ipEnvanteri;
  if (ipe && !ipe.okunamadi)
    for (const r of ipe.satirlar || []) {
      const v = vh.get(r.host);
      if (!v || !v.web || !v.web.ipler) continue;
      const var_ = v.web.ipler.includes(r.ip);
      ekle(
        out,
        `ip:${r.ip}`,
        'IP_ENVANTERI',
        var_ ? 'UYUM' : 'CELISKI',
        ['ip_envanteri', 'faz_w'],
        var_
          ? `${r.host} arayuzunde`
          : `IP envanteri ${r.ip}'yi ${r.host}'a yaziyor ama sunucunun arayuzunde yok`,
      );
    }
  return out;
}

module.exports = { dogrula, TAZELIK_GUN };
