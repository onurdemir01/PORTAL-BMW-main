// server/nginx-loadtest/__tests__/kapi.test.cjs - Yuk Testi router'i GERCEK; db / AWX / envanter /
// kimlik / gorunurluk / denetim sahte (require.cache). (2026-10-27)
//
//   YKP1 kapilar (davranis): oturumsuz 401; Admin olmayan her yazan uca ve /durum'a 403, DB'ye
//        dokunmadan; sekmesi kapali 403; Admin olmayan yalniz salt okunur GET'lere gecer
//   YKP2 kapi sirasi (kaynak): requireAuth -> adminOkumaKapisi -> sayfa -> sekme -> uclar; router
//        nginxRedCevirici `haric` listesinde DEGIL; ADMIN_DISI_OKUMA ornekli ve /durum'u kapsamaz
//   YKP3 kimlikler istemciden alinmaz: sunucu / template / limit / extra_vars kayittan, govdedeki
//        fazlalik yok sayilir; /durum ve /durdur is numarasini satirdan okur
//   YKP4 on kontrol 409 / 424 kodlari: her reddedilen istek AWX'e GITMEZ, kilit kalmaz, ret denetlenir
//   YKP4c kilit alma ortasinda DB hatasi (G alindi, sonraki anahtar hata atti): istegin aldigi kilitler
//         birakilir (yabanci lock_id'li olan degil), 424 sonrasi tekrar deneyen istek gecer; birakma da hata
//         alirsa maskeli uyari yazilir, kilit sure dolana kadar kalir (tekrar deneyen kilit_dolu, sonra gecer)
//   YKP5 basarili on kontrol: satir RUNNING + adim, T+L kilidi ise bagli, gecmiste senaryo maskeli
//   YKP6 kosu: on kontrol kapisi (sahip, DONE/OK, 15 dk, onay metni, engel, uyari onayi), G+T+L,
//        govdedeki hedef/parametre YOK SAYILIR, yeniden olcum (envanter uretime dondu -> red)
//   YKP7 AWX degiskenleri yuttu: is iptal, kilit o ise bagli, satir FAILED
//   YKP8 /durum: maskeli, artimli (since), playbook baglamasi, AWX okunamadi 424, arsiv yedegi
//   YKP9 /durdur: iptal + durdur kipi, satirdan kimlik, denetim
//   YKP10 senaryolar: dogrulama, sha256, yumusak silme
//   YKP11 karsilastir: kararVer DB adimlariyla; on kontrol karsilastirilmaz
//   YKP12 hedefler: uygun / degil + neden, yuk makineleri, sinirlar
//   -- tur 2 (2026-10-27 inceleme) --
//   YKP14 /durdur: baslatma penceresinde 409 baslatiliyor; kosu icin durdur isi yoksa 424
//         durdur_baslatilamadi (iptal basarili olsa da); baslarsa kilitler durdur isine baglanir
//   YKP15 baslatma yarisi: is numarasi her zaman yazilir; satir bu arada CANCELED olduysa is iptal
//   YKP16 /yeniden-oku: yalniz Admin, yalniz sonucu okunamamis is numarali kosu; sayac sifir
//   YKP17 /kosular suzgeci + sayfalama: islem / durum / hedef / onceki / limit, dahaVar, 400
//   YKP18 kosu ayrintisi: durdurIsi, sonuclandirmaDenemesi; olculmus limit 0 hedefi /hedefler'de kapali
//   YKP19 bayat kilit: baslatma yolu AWX durumunu iletir; kural bag turune gore birakir / tutar
//   -- tur 3 (2026-10-28: elle hedef IP sunucu | serbest, wrk motoru, D7) --
//   YKP20 serbest on kontrol uctan uca: satir (hedef_turu, hedef_host '', motor, plan_uyarilari), extra_vars,
//         G + T|IP + L kilidi (on kontrolde de G)
//   YKP21 serbest kosu: onay metni = IP, serbest uyarisi onay ister, sinif degisince on_kontrol_eski
//   YKP22 elle yazilan IP'nin siniflari uctan uca (ret denetime yazilir, AWX'e gitmez)
//   YKP23 wrk on kontrol: extra_vars degerleri, tavan sunucuda hesaplanir, wrk + SNI 400
//   YKP24 /ip-sinifi: yalniz Admin, yanit sekilleri, uygun:false 200, host secici, DB / denetim yok
//   YKP25 /kosular ip / hedefTuru / motor suzgecleri + 400 + kosuApi alanlari
//   YKP26 serbest / wrk durdur: extra_vars satirdan, 424 metni motor ve ture gore (k6 + sunucu birebir)
//   YKP27 /karsilastir: kararVer'e motor / hedef turu / is parcacigi / hiz tavani (tavan_rps) secenekleri, ozet alanlari
//   YKP28 /hedefler: serbest (aglar yalniz Admin), motorlar, sinirlar ve varsayilanlar
//   YKP29 D7: listede olmayan Host basligiyla sunucu on kontrolu baslar; kosu D7 uyarisinin onayini ister
//   YKP30 plan uyarilari: satirda saklanir, ayrintida basta, kosu onayi ister, yeni uyari on_kontrol_eski
//   YKP31 host_uretim uctan uca (iki kipte 409, satir yok, ret denetimde)
//   YKP32 kilit aciklamasi (target_desc): k6 + sunucu birebir, wrk eki, serbestte IP
//   YKP33 denetim ayrintisi: serbest + wrk kosusu ve uzun mesajli ret saklandigi hal (2000'de kesim) ile
//         GECERLI JSON, <= 2000; kimlik alanlari birebir; uzun uyari dizileri kisaltilir / atilir (sayi kalir)
//   -- tur 3 inceleme (2026-10-28) --
//   YKP34 yarim tarama gunu uctan uca: dunku limit (409 sinir_asildi, wrk tavani, sifir sinir), dunku sahiplik
//         (409 hedef_uretim), dunku ad (409 host_uretim), dunku hedef satirlari; bugunku varsa bugunku
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function sahte(rel, exports) {
  const p = Module._resolveFilename(path.join(__dirname, rel), module);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
// C'nin modulleri: poller.cModulu once require.cache'e bakar (dosya olmasa da sahte calisir).
function sahteC(ad, exports) {
  const p = path.join(__dirname, '..', ad);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const BAS = Date.parse('2026-10-27T10:00:00Z');
const D = {};
function sifirla() {
  Object.assign(D, {
    simdi: BAS,
    sorgular: [],
    senaryolar: [],
    kosular: [],
    adimlar: [],
    kilitler: new Map(),
    gecmis: [],
    arsiv: [],
    denetim: [],
    launch: [],
    iptal: [],
    statusCagri: [],
    ciktiCagri: [],
    registry: { enabled: true, awxTemplateId: 44, awxServerId: 3 },
    playbookUyusmaz: false,
    launchHata: null,
    launchKanca: null,
    iptalHata: null,
    yutulan: undefined,
    sonrakiIs: 900,
    awxDurum: { status: 'running', playbook: 'bmw_portal/nginx_loadtest/nginx_loadtest.yml', artifacts: {}, eventProcessingFinished: true },
    awxHata: null,
    cikti: 'TASK [x]\npassword=gizli123 ok\n',
    invHata: null,
    nginxEnv: { GBNGXT33: 'test' },
    invEnv: { GBNGXT33: 'Test', GBNGXT34: 'Test' },
    kilitDbHata: false,
    // Tek seferlik gecici kilit hatasi: { desen, onek, sonra, mesaj, ardindan } - desene uyan ve anahtari
    // onekle baslayan ILK sorgu hata atar (sonra: true ise once yazar, yaniti kaybeder: COMMIT edilmis CAS;
    // mesaj: hata metni; ardindan: bu hata atildiktan sonra kurulan ikinci tek seferlik hata).
    kilitHata: null,
    ayarlar: null,
    tetiklenen: [],
    // Tur 3 sahte TBMWANS verisi: IP sahipligi (Inventory ip, IPInventory, tarama listen), tazelik.
    envSorgular: [],
    nginxEk: [],
    invIp: [],
    ipEnvanteri: [{ host: 'GBNGXT33', ip: '10.0.0.5' }, { host: 'GBNGXT33', ip: '10.0.0.9' }, { host: 'GBNGXT34', ip: '10.0.0.6' }],
    ipEnvYasSaat: 2,
    taramaYasGun: 0,
    taramaYok: false,
    tarama: [
      { host: 'GBNGXT33', listen: '10.0.0.9:443 ssl', server_name: 'app.test.local api.test.local' },
      { host: 'GBNGXT34', listen: '443 ssl', server_name: 'rp.test.local' },
    ],
  });
  // Serbest hedef / wrk env'leri her testte temiz (test kendisi kurar).
  for (const k of ['NGINX_LOADTEST_SERBEST_AGLAR', 'NGINX_LOADTEST_SERBEST_YASAK', 'NGINX_LOADTEST_WRK']) delete process.env[k];
}
sifirla();

// `locked_until = CASE ... DATEADD(SECOND, $n, ...)`: en az simdi + n sn (kisaltmaz).
function sureUzat(r, q, params) {
  const m = /locked_until = CASE WHEN locked_until IS NULL OR locked_until < DATEADD\(SECOND, \$(\d), GETUTCDATE\(\)\) THEN DATEADD\(SECOND, \$\1, GETUTCDATE\(\)\) ELSE locked_until END/.exec(q);
  if (!m) throw new Error(`sure uzatma ifadesi taninmadi: ${q}`);
  const hedef = D.simdi + Number(params[Number(m[1]) - 1]) * 1000;
  if (r.locked_until == null || r.locked_until < hedef) r.locked_until = hedef;
}

function kilitSorgusu(q, params) {
  const s = D.kilitler;
  if (/nginx_loadtest_kilitleri/.test(q) && D.kilitDbHata) throw new Error('kilit tablosu yok');
  const h = D.kilitHata;
  if (h && h.desen.test(q) && String(params[0]).startsWith(h.onek)) {
    D.kilitHata = null;
    if (h.sonra) kilitSorgusu(q, params);
    D.kilitHata = h.ardindan || null;
    throw Object.assign(new Error(h.mesaj || 'deadlock kurbani (sahte)'), { number: 1205 });
  }
  if (/^IF NOT EXISTS \(SELECT 1 FROM nginx_loadtest_kilitleri/.test(q)) {
    if (!s.has(params[0])) s.set(params[0], { id: s.size + 1, lock_key: params[0], held: 0 });
    return { rows: [], rowCount: 1 };
  }
  if (/^UPDATE nginx_loadtest_kilitleri SET held = 1/.test(q)) {
    const r = s.get(params[0]);
    const dolmus = r && r.locked_until != null && r.locked_until < D.simdi;
    // Suresi dolmus kilit yalniz ise bagli degilse (ya da 12 saat once dolmussa) devralinir.
    const bos = r && (!r.held || (dolmus && r.awx_job_id == null) || (r.locked_until != null && r.locked_until < D.simdi - 12 * 3600000));
    if (!bos) return { rows: [], rowCount: 0 };
    Object.assign(r, { held: 1, holder: params[1], lock_id: params[2], target_desc: params[3], locked_until: D.simdi + params[4] * 60000, awx_server_id: null, awx_job_id: null, bag_turu: null });
    return { rows: [], rowCount: 1 };
  }
  if (/^SELECT TOP 1 lock_key/.test(q)) return { rows: s.has(params[0]) ? [{ ...s.get(params[0]) }] : [] };
  if (/^UPDATE nginx_loadtest_kilitleri SET held = 0,.* WHERE lock_key = \$1 AND lock_id = \$2/.test(q)) {
    const r = s.get(params[0]);
    if (!r || r.lock_id !== params[1] || !r.held) return { rows: [], rowCount: 0 };
    r.held = 0;
    return { rows: [], rowCount: 1 };
  }
  if (/^UPDATE nginx_loadtest_kilitleri SET awx_server_id = \$3, awx_job_id = \$4, bag_turu = \$5/.test(q)) {
    const r = s.get(params[0]);
    if (r && r.lock_id === params[1] && r.held) Object.assign(r, { awx_server_id: params[2], awx_job_id: params[3], bag_turu: params[4] });
    return { rows: [], rowCount: 1 };
  }
  if (/^UPDATE nginx_loadtest_kilitleri SET awx_server_id = \$2, awx_job_id = \$3, bag_turu = 'durdur', locked_until = CASE .* WHERE lock_id = \$1 AND held = 1$/.test(q)) {
    let n = 0;
    for (const r of s.values()) {
      if (r.held && r.lock_id === params[0]) {
        sureUzat(r, q, params);
        Object.assign(r, { awx_server_id: params[1], awx_job_id: params[2], bag_turu: 'durdur' });
        n += 1;
      }
    }
    return { rows: [], rowCount: n };
  }
  if (/^UPDATE nginx_loadtest_kilitleri SET awx_server_id = NULL, awx_job_id = NULL, bag_turu = NULL/.test(q)) {
    let n = 0;
    for (const r of s.values()) {
      if (r.held && r.awx_server_id === params[0] && r.awx_job_id === params[1]) {
        if (params.length > 2) sureUzat(r, q, params);
        Object.assign(r, { awx_server_id: null, awx_job_id: null, bag_turu: null });
        n += 1;
      }
    }
    return { rows: [], rowCount: n };
  }
  return null;
}

function kosuSatiri(r) {
  const sen = D.senaryolar.find((x) => x.id === r.senaryo_id);
  return {
    ...r, senaryo_ad: sen ? sen.ad : null, yas_sn: r.finished_at == null ? null : Math.round((D.simdi - r.finished_at) / 1000),
    olusma_yas_sn: r.created_at == null ? null : Math.round((D.simdi - Number(r.created_at)) / 1000),
  };
}

// Liste ucunun WHERE'i SQL metninden uygulanir (`k.<kolon> =|< $n`): sahte, yazilan sorgunun anlamini sinar.
function listeSuz(q, params) {
  if (!/ORDER BY k\.id DESC$/.test(q)) throw new Error(`liste sirasi bozuk: ${q}`);
  const m0 = q.match(/ WHERE (.*) ORDER BY k\.id DESC$/);
  const kosullar = m0 ? m0[1].split(' AND ') : [];
  return (x) => kosullar.every((c) => {
    const m = /^k\.(\w+) (=|<) \$(\d+)$/.exec(c);
    if (!m) throw new Error(`taninmayan liste kosulu: ${c}`);
    const v = params[Number(m[3]) - 1];
    return m[2] === '=' ? x[m[1]] === v : x[m[1]] < v;
  });
}

sahte('../../db/index.cjs', {
  query: async (sql, params = []) => {
    const q = String(sql).replace(/\s+/g, ' ').trim();
    D.sorgular.push({ q, params });
    const k = kilitSorgusu(q, params);
    if (k) return k;
    if (/^SELECT id, ad, aciklama, vhost, senaryo_tur, tsv, sha256, yol_sayisi, ozet, kaynak, created_by, created_at, silindi FROM nginx_loadtest_senaryolar WHERE id = \$1$/.test(q)) {
      return { rows: D.senaryolar.filter((x) => x.id === params[0]) };
    }
    if (/^SELECT TOP 200 id, ad, aciklama/.test(q)) return { rows: D.senaryolar.filter((x) => !x.silindi).slice().reverse() };
    if (/^INSERT INTO nginx_loadtest_senaryolar/.test(q)) {
      const [ad, aciklama, vhost, senaryo_tur, tsv, sha256, yol_sayisi, ozet, kaynak, created_by] = params;
      const id = D.senaryolar.length + 1;
      D.senaryolar.push({ id, ad, aciklama, vhost, senaryo_tur, tsv, sha256, yol_sayisi, ozet, kaynak, created_by, created_at: new Date(D.simdi), silindi: 0 });
      return { rows: [{ id }], rowCount: 1 };
    }
    if (/^UPDATE nginx_loadtest_senaryolar SET silindi = 1 WHERE id = \$1 AND silindi = 0$/.test(q)) {
      const s = D.senaryolar.find((x) => x.id === params[0] && !x.silindi);
      if (s) s.silindi = 1;
      return { rows: [], rowCount: s ? 1 : 0 };
    }
    if (/FROM nginx_loadtest_kosular k LEFT JOIN nginx_loadtest_senaryolar s ON s\.id = k\.senaryo_id WHERE k\.id = \$1$/.test(q)) {
      return { rows: D.kosular.filter((x) => x.id === params[0]).map(kosuSatiri) };
    }
    if (/^SELECT TOP \(\$1\)/.test(q)) {
      return { rows: D.kosular.filter(listeSuz(q, params)).sort((a, b) => b.id - a.id).slice(0, params[0]).map(kosuSatiri) };
    }
    if (/^INSERT INTO nginx_loadtest_kosular \(senaryo_id, on_kontrol_kosu_id, islem, etiket, hedef_host, hedef_ip, vhost, yuk_host, parametreler, durum, created_by, kilit_id, hedef_turu, motor, plan_uyarilari\) VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, 'QUEUED', \$10, \$11, \$12, \$13, \$14\) RETURNING id$/.test(q)) {
      const [senaryo_id, on_kontrol_kosu_id, islem, etiket, hedef_host, hedef_ip, vhost, yuk_host, parametreler, created_by, kilit_id, hedef_turu, motor, plan_uyarilari] = params;
      const id = 100 + D.kosular.length + 1;
      D.kosular.push({
        id, senaryo_id, on_kontrol_kosu_id, islem, etiket, hedef_host, hedef_ip, vhost, yuk_host, parametreler, created_by, kilit_id, hedef_turu, motor, plan_uyarilari,
        durum: 'QUEUED', created_at: new Date(D.simdi), sonuclandirma_denemesi: 0,
      });
      return { rows: [{ id }], rowCount: 1 };
    }
    // Baslatma sonrasi: is numarasi is numarasiz satira HER ZAMAN yazilir; durum yalniz QUEUED ise RUNNING.
    if (/^UPDATE nginx_loadtest_kosular SET adim = \$2, awx_server_id = \$3, awx_job_id = \$4, sw_dizin = \$5, started_at = GETUTCDATE\(\), durum = CASE WHEN durum = 'QUEUED' THEN 'RUNNING' ELSE durum END WHERE id = \$1 AND awx_job_id IS NULL$/.test(q)) {
      const r = D.kosular.find((x) => x.id === params[0] && x.awx_job_id == null);
      if (r) Object.assign(r, { durum: r.durum === 'QUEUED' ? 'RUNNING' : r.durum, adim: params[1], awx_server_id: params[2], awx_job_id: params[3], sw_dizin: params[4], started_at: new Date(D.simdi) });
      return { rows: [], rowCount: r ? 1 : 0 };
    }
    if (/^SELECT durum FROM nginx_loadtest_kosular WHERE id = \$1$/.test(q)) return { rows: D.kosular.filter((x) => x.id === params[0]).map((x) => ({ durum: x.durum })) };
    if (/^UPDATE nginx_loadtest_kosular SET durdur_awx_server_id = \$2, durdur_awx_job_id = \$3 WHERE id = \$1$/.test(q)) {
      const r = D.kosular.find((x) => x.id === params[0]);
      if (r) Object.assign(r, { durdur_awx_server_id: params[1], durdur_awx_job_id: params[2] });
      return { rows: [], rowCount: r ? 1 : 0 };
    }
    if (/^UPDATE nginx_loadtest_kosular SET durum = 'FINALIZING', sonuclandirma_denemesi = 0 WHERE id = \$1 AND islem = 'kosu' AND awx_job_id IS NOT NULL AND \(durum = 'OKUNAMADI' OR gecerlilik = 'OKUNAMADI'\)$/.test(q)) {
      const r = D.kosular.find((x) => x.id === params[0] && x.islem === 'kosu' && x.awx_job_id != null && (x.durum === 'OKUNAMADI' || x.gecerlilik === 'OKUNAMADI'));
      if (r) Object.assign(r, { durum: 'FINALIZING', sonuclandirma_denemesi: 0 });
      return { rows: [], rowCount: r ? 1 : 0 };
    }
    if (/^UPDATE nginx_loadtest_kosular SET durum = 'FAILED', adim = \$2/.test(q)) {
      const r = D.kosular.find((x) => x.id === params[0] && x.durum === 'QUEUED');
      if (r) Object.assign(r, { durum: 'FAILED', adim: params[1], sonuc: params[2], awx_server_id: params[3], awx_job_id: params[4] });
      return { rows: [], rowCount: r ? 1 : 0 };
    }
    if (/^UPDATE nginx_loadtest_kosular SET iptal_eden = \$2 WHERE id = \$1$/.test(q)) {
      const r = D.kosular.find((x) => x.id === params[0]);
      if (r) r.iptal_eden = params[1];
      return { rows: [], rowCount: r ? 1 : 0 };
    }
    if (/^UPDATE nginx_loadtest_kosular SET durum = 'CANCELED'/.test(q)) {
      const r = D.kosular.find((x) => x.id === params[0] && x.durum === 'QUEUED' && x.awx_job_id == null);
      if (r) r.durum = 'CANCELED';
      return { rows: [], rowCount: r ? 1 : 0 };
    }
    if (/^SELECT \* FROM nginx_loadtest_adimlar WHERE kosu_id = \$1/.test(q)) return { rows: D.adimlar.filter((x) => x.kosu_id === params[0]) };
    if (/^SELECT on_kontrol_ozet, plan_uyarilari FROM nginx_loadtest_kosular WHERE id = \$1$/.test(q)) {
      return { rows: D.kosular.filter((x) => x.id === params[0]).map((x) => ({ on_kontrol_ozet: x.on_kontrol_ozet, plan_uyarilari: x.plan_uyarilari ?? null })) };
    }
    if (/^INSERT INTO ansible_job_history/.test(q)) {
      D.gecmis.push(params);
      return { rows: [], rowCount: 1 };
    }
    if (/^SELECT TOP 1 stdout FROM ansible_job_output/.test(q)) return { rows: D.arsiv.filter((a) => a.sid === params[0] && a.jid === params[1]) };
    // poller.tetikle: sonuclandirma poller testinde olculur; burada yalniz TETIKLENDIGI.
    if (/^SELECT id, islem, durum, awx_server_id, awx_job_id, parametreler, .* FROM nginx_loadtest_kosular WHERE id = \$1$/.test(q)) {
      D.tetiklenen.push(params[0]);
      return { rows: [] };
    }
    throw new Error(`beklenmeyen Portal sorgusu: ${q}`);
  },
});

// LIKE (yalniz %) -> tam eslesme: sahte envanter parametreli LIKE'i ANLAMIYLA uygular.
const like = (deger, desen) => new RegExp(`^${String(desen).split('%').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(String(deger));
// Tarama gunu: satirin `gun` alani, yoksa TARAMA_GUNU (tazelik sahtesinin `son`u). Servers penceresi son iki
// gun (kod) ya da yalniz MAX gunu (eski okuma; mutasyon olcumunde ANLAMIYLA uygulanir).
const TARAMA_GUNU = '2026-10-27';
const ONCEKI_GUN = (g) => new Date(Date.parse(`${g}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const SON_IKI = 'scan_date >= DATEADD(day, -1, (SELECT MAX(scan_date) FROM dbo.Nginx_Audit_Servers))';
const SON_TEK = 'scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Audit_Servers)';
const gunu = (r) => r.gun || TARAMA_GUNU;
const LIMIT_DIREKTIF = new Set(['limit_req_zone', 'limit_conn_zone', 'limit_req', 'limit_conn']);
function taramaPenceresi(q) {
  const enSon = D.tarama.map(gunu).sort().at(-1);
  if (q.includes(SON_IKI)) return [q.replace(SON_IKI, '<P>'), D.tarama.filter((r) => gunu(r) >= ONCEKI_GUN(enSon))];
  if (q.includes(SON_TEK)) return [q.replace(SON_TEK, '<P>'), D.tarama.filter((r) => gunu(r) === enSon)];
  return [q, null];
}

// Sahte TBMWANS: kaynaklariOku'nun sorgularini metniyle tanir; IP SQL metninde degil parametrede (= / LIKE / IN).
sahte('../../inventory/mssql.cjs', {
  sql: { NVarChar: (n) => `nvarchar(${n})` },
  query: async (sql0, params = []) => {
    const q = String(sql0).replace(/\s+/g, ' ').trim();
    D.envSorgular.push({ q, params });
    if (D.invHata) throw D.invHata;
    const hostlar = new Set(params.map((p) => p.value));
    const deger = (ad) => (params.find((p) => p.name === ad) || {}).value;
    if (/FROM dbo\.nginx_inventory/.test(q)) {
      return { recordset: [
        { hostname: 'GBNGXT33', env: D.nginxEnv.GBNGXT33, ip: '10.0.0.5' },
        { hostname: 'GBNGXT34', env: 'test', ip: '10.0.0.6' },
        { hostname: 'GBNGXP40', env: 'Production', ip: '10.9.0.1' },
        { hostname: 'GBNGXT51', env: 'test', ip: '10.0.0.51' },
        ...D.nginxEk,
      ] };
    }
    if (/^SELECT host, env, ip FROM dbo\.Inventory WHERE LTRIM\(RTRIM\(ip\)\) = @ip0$/.test(q)) return { recordset: D.invIp.filter((r) => r.ip === deger('ip0')) };
    if (/FROM dbo\.Inventory/.test(q)) return { recordset: Object.entries(D.invEnv).filter(([h]) => hostlar.has(h)).map(([host, env]) => ({ host, env })) };
    if (/^SELECT OBJECT_ID\('dbo\.IPInventory'\) AS oid$/.test(q)) return { recordset: [{ oid: D.ipEnvanteri ? 21 : null }] };
    if (/^SELECT OBJECT_ID\('dbo\.Nginx_Audit_Servers'\) AS oid$/.test(q)) return { recordset: [{ oid: D.taramaYok ? null : 7 }] };
    if (/OBJECT_ID/.test(q)) return { recordset: [{ oid: 7 }] };
    if (/^SELECT TOP 1 1 AS x FROM dbo\.IPInventory$/.test(q)) return { recordset: D.ipEnvanteri.length ? [{ x: 1 }] : [] };
    if (/^SELECT host, ip FROM dbo\.IPInventory WHERE LTRIM\(RTRIM\(ip\)\) = @ip1 OR LTRIM\(RTRIM\(ip\)\) LIKE @ip2$/.test(q)) {
      return { recordset: D.ipEnvanteri.filter((r) => r.ip === deger('ip1') || like(r.ip, deger('ip2'))) };
    }
    if (/^SELECT DATEDIFF\(HOUR, MAX\(last_seen_at\), GETDATE\(\)\) AS yas_saat/.test(q)) return { recordset: [{ yas_saat: D.ipEnvYasSaat, son: '2026-10-27 08:00:00' }] };
    if (/^SELECT DATEDIFF\(DAY, MAX\(scan_date\), CAST\(GETDATE\(\) AS DATE\)\) AS yas_gun/.test(q)) return { recordset: [{ yas_gun: D.taramaYasGun, son: TARAMA_GUNU }] };
    const [qp, pen] = taramaPenceresi(q);
    if (pen && /^SELECT DISTINCT host, listen FROM dbo\.Nginx_Audit_Servers WHERE <P> AND listen LIKE @ip3$/.test(qp)) {
      return { recordset: pen.filter((r) => like(r.listen, deger('ip3'))).map(({ host, listen }) => ({ host, listen })) };
    }
    if (pen && /^SELECT DISTINCT host, server_name, CONVERT\(varchar\(10\), scan_date, 23\) AS gun FROM dbo\.Nginx_Audit_Servers WHERE <P>$/.test(qp)) {
      return { recordset: pen.map((r) => ({ host: r.host, server_name: r.server_name ?? null, gun: gunu(r) })) };
    }
    if (pen && /^SELECT host, listen, server_name, CONVERT\(varchar\(10\), scan_date, 23\) AS gun FROM dbo\.Nginx_Audit_Servers WHERE <P> AND host IN \(@s\d+(,@s\d+)*\)$/.test(qp)) {
      return { recordset: pen.filter((r) => hostlar.has(r.host)).map((r) => ({ host: r.host, listen: r.listen, server_name: r.server_name, gun: gunu(r) })) };
    }
    if (/FROM dbo\.Nginx_Audit_Servers/.test(q)) throw new Error(`taninmayan tarama sorgusu: ${q}`);
    // Settings: gun seek'i (d = MAX, o = onceki), host basina varlik (HERHANGI bir satir), etkin gunun limitleri.
    const ayarlar = D.ayarlar || [
      { host: 'GBNGXT33', directive: 'limit_req_zone', value: '$binary_remote_addr zone=request_limit:20m rate=300r/s' },
      { host: 'GBNGXT33', directive: 'limit_req', value: 'zone=request_limit burst=200 nodelay' },
    ];
    if (/^SELECT CONVERT\(varchar\(10\), m\.d, 23\) AS d, CONVERT\(varchar\(10\), \(SELECT MAX\(scan_date\) FROM dbo\.Nginx_Audit_Settings WHERE scan_date < m\.d\), 23\) AS o FROM \(SELECT MAX\(scan_date\) AS d FROM dbo\.Nginx_Audit_Settings\) AS m$/.test(q)) {
      const g = [...new Set(ayarlar.map(gunu))].sort();
      return { recordset: [{ d: g.at(-1) ?? null, o: g.length > 1 ? g.at(-2) : null }] };
    }
    if (/^SELECT h\.host, CASE WHEN EXISTS \(SELECT 1 FROM dbo\.Nginx_Audit_Settings s WHERE s\.scan_date = CONVERT\(date, @d, 23\) AND s\.host = h\.host\) THEN 1 ELSE 0 END AS d_var, CASE WHEN EXISTS \(SELECT 1 FROM dbo\.Nginx_Audit_Settings s WHERE s\.scan_date = CONVERT\(date, @o, 23\) AND s\.host = h\.host\) THEN 1 ELSE 0 END AS o_var FROM \(VALUES \(@a\d+\)(, \(@a\d+\))*\) AS h\(host\)$/.test(q)) {
      const var1 = (h, g) => (g != null && ayarlar.some((r) => r.host === h && gunu(r) === g) ? 1 : 0);
      return { recordset: params.filter((p) => /^a\d+$/.test(p.name)).map((p) => ({ host: p.value, d_var: var1(p.value, deger('d')), o_var: var1(p.value, deger('o')) })) };
    }
    if (/^SELECT host, directive, value FROM dbo\.Nginx_Audit_Settings WHERE scan_date = CONVERT\(date, @g, 23\) AND directive IN \('limit_req_zone', 'limit_conn_zone', 'limit_req', 'limit_conn'\) AND host IN \(@a\d+(,@a\d+)*\)$/.test(q)) {
      return { recordset: ayarlar.filter((r) => hostlar.has(r.host) && gunu(r) === deger('g') && LIMIT_DIREKTIF.has(r.directive)).map(({ host, directive, value }) => ({ host, directive, value })) };
    }
    throw new Error(`beklenmeyen envanter sorgusu: ${q}`);
  },
});

sahte('../../auth/index.cjs', { requireAuth: (req, res, next) => (req.session && req.session.user ? next() : res.status(401).json({ ok: false, kimlik: true })) });
sahte('../../auth/visibility.cjs', {
  requireVisiblePrefix: (anahtar) => (req, res, next) => (req.gizli === anahtar ? res.status(403).json({ ok: false, gorunurluk: anahtar }) : next()),
  requireVisible: (anahtar) => (req, res, next) => (req.gizli === anahtar ? res.status(403).json({ ok: false, gorunurluk: anahtar }) : next()),
});
sahte('../../audit/index.cjs', { auditPortal: (req, eylem, o) => D.denetim.push({ eylem, ...o }) });
sahte('../../ansible/playbook-registry.cjs', { getByKey: async () => D.registry, getEffectiveTemplateId: (r) => r.awxTemplateId || null });
const uyusmaz = () => Object.assign(new Error('yanlis sablon'), { status: 409, code: 'awx_template_playbook_mismatch' });
sahte('../../ansible/template-preflight.cjs', {
  BEKLENEN_PLAYBOOK: { nginx_loadtest_run: 'nginx_loadtest.yml' },
  assertRegistryPlaybook: async () => { if (D.playbookUyusmaz) throw uyusmaz(); },
  assertTemplatePlaybook: async () => { if (D.playbookUyusmaz) throw uyusmaz(); },
  assertTemplateAcceptsExtraVars: async () => {},
  promptKapaliHatasi: ({ degiskenSayisi }) => Object.assign(new Error(`prompt kapali (${degiskenSayisi})`), { status: 409, code: 'awx_prompt_on_launch_disabled' }),
});
sahte('../../ansible/runner.cjs', {
  redactSecrets: (s) => s,
  getServerById: () => null,
  launchJobOnServer: async (...a) => {
    D.launch.push(a);
    if (D.launchKanca) await D.launchKanca(a);
    if (D.launchHata) throw D.launchHata;
    return { jobId: D.sonrakiIs++, status: 'pending', ...(D.yutulan ? { ignoredFields: D.yutulan } : {}) };
  },
  getJobStatusOnServer: async (sid, jid) => {
    D.statusCagri.push([sid, jid]);
    if (D.awxHata) throw D.awxHata;
    return { jobId: jid, ...D.awxDurum };
  },
  getJobOutputOnServer: async (sid, jid, o) => {
    D.ciktiCagri.push([sid, jid, o]);
    return { output: D.cikti };
  },
  cancelJobOnServer: async (sid, jid) => {
    D.iptal.push([sid, jid]);
    if (D.iptalHata) throw D.iptalHata;
    return { canceled: true };
  },
});
const kararCagri = [];
sahteC('analiz.cjs', {
  kararVer: (r, a, s) => (kararCagri.push({ r, a, s }), {
    karar: 'NOTR', nedenler: ['fark esik altinda'], tablo: [{ hiz: 100 }], kademe: { cpu: 100, p95: 100 }, kombinasyon: { senaryo: 'K', kip: 'yeni', ae: 'br' },
  }),
});

const IDX_YOL = path.join(__dirname, '..', 'index.cjs');
const yt = require('../index.cjs');
const dg = require('../dogrula.cjs');
const router = yt._yonlendiriciKurForTest();

const ADMIN = { user: { username: 'onur', role: 'Admin' } };
const KULLANICI = { user: { username: 'veli', role: 'User' } };

function istek(method, url, { session = ADMIN, body, gizli = null, query: sorgu = null } = {}) {
  const [yol, qs] = url.split('?');
  const query = sorgu || Object.fromEntries(new URLSearchParams(qs || ''));
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      body: null,
      headersSent: false,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; this.headersSent = true; resolve(this); return this; },
      setHeader() {}, getHeader() {},
    };
    const req = { method, url, headers: {}, session, body, query, gizli, get path() { return yol; } };
    router.handle(req, res, (err) => resolve({ statusCode: 'sonraki', body: { err: err && err.message } }));
  });
}

function senaryoEkle(ek = {}) {
  const s = dg.senaryoSatirlari([{ agirlik: 1, har: 1, tur: 'js', boyut: 'kucuk', yol: '/a.js' }, { agirlik: 2, har: 1, tur: 'css', boyut: 'orta', yol: '/b.css' }]);
  const id = D.senaryolar.length + 1;
  D.senaryolar.push({ id, ad: `S${id}`, aciklama: null, vhost: 'app.test.local', senaryo_tur: 'K', tsv: s.tsv, sha256: s.sha256, yol_sayisi: 2, ozet: null, kaynak: 'har', created_by: 'onur', created_at: new Date(BAS), silindi: 0, ...ek });
  return id;
}
const GOVDE = (ek = {}) => ({ senaryoId: 1, hedefHost: 'GBNGXT33', hedefIp: '10.0.0.9', vhost: 'app.test.local', yukHost: 'GBNGXT34', sni: false, parametreler: { hizlar: [100, 250] }, etiket: 'T0', ...ek });
const OK_OZET = {
  ip_yerel: true, server_name_var: true, master_sayisi: 1, web_log_df: 30, log_dizini_okunur: true, log_format_ua: true, statik_direktif: null,
  k6_var: true, k6_surum: 'k6 v0.49.0', k6_sha256: 'a'.repeat(64), yollar_toplam: 2, yollar_200: 2, ilk_hatalar: [], sikistirma: { statik: 0, dinamik: 2, sikistirmasiz: 0 },
};
// Serbest hedef (LB VIP / yonetilmeyen sunucu): hicbir envanterde yok, izin listesinde.
const SERBEST_IP = '10.20.30.40';
const SERBEST_AG = '10.20.30.0/24';
const SGOVDE = (ek = {}) => GOVDE({ hedefHost: null, hedefIp: SERBEST_IP, parametreler: {}, ...ek });
const OK_OZET_SERBEST = {
  ip_yerel: null, server_name_var: null, master_sayisi: null, web_log_df: null, log_dizini_okunur: null, log_format_ua: null, statik_direktif: null,
  ip_yuk_makinesinde: false, serbest_ag: SERBEST_AG, k6_var: true, k6_surum: 'k6 v0.49.0', k6_sha256: 'a'.repeat(64),
  wrk_var: null, wrk_calisiyor: null, wrk_surum: null, wrk_sha256: null, yollar_toplam: 2, yollar_200: 2, ilk_hatalar: [], sikistirma: { statik: 0, dinamik: 2, sikistirmasiz: 0 },
};

/** Tamamlanmis on kontrol satiri (gercek on kontrol ucundan gecmis gibi). */
async function onKontrolHazirla({ ozet = OK_OZET, yasDk = 5, sahip = 'onur', durum = 'DONE', sonucDurum = 'OK', govde = GOVDE() } = {}) {
  const r = await istek('POST', '/kosular/on-kontrol', { body: govde });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const k = D.kosular.find((x) => x.id === r.body.kosuId);
  Object.assign(k, { durum, created_by: sahip, finished_at: D.simdi - yasDk * 60000, sonuc: JSON.stringify({ durum: sonucDurum, run_id: String(k.id), islem: 'on_kontrol', on_kontrol: ozet }), on_kontrol_ozet: JSON.stringify(ozet) });
  for (const kl of D.kilitler.values()) kl.held = 0; // poller birakmis gibi
  return k;
}

test('YKP1 kapilar: oturum, Admin, sayfa/sekme gorunurlugu (davranis)', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  assert.equal((await istek('GET', '/hedefler', { session: null })).statusCode, 401);
  const yazanlar = [
    ['POST', '/senaryolar', {}], ['DELETE', '/senaryolar/1'], ['POST', '/kosular/on-kontrol', GOVDE()], ['POST', '/kosular', { onKontrolKosuId: 1 }],
    ['POST', '/kosular/1/durdur', {}], ['GET', '/kosular/1/durum'], ['PUT', '/senaryolar/1', {}], ['POST', '/kosular/1/yeniden-oku', {}],
    ['GET', '/ip-sinifi?ip=10.0.0.9'],
  ];
  for (const [m, u, b] of yazanlar) {
    D.sorgular = [];
    D.envSorgular = [];
    const r = await istek(m, u, { session: KULLANICI, body: b });
    assert.equal(r.statusCode, 403, `${m} ${u}: Admin olmayan gecti`);
    assert.equal(D.sorgular.length, 0, `${m} ${u}: uc DB'ye dokundu`);
    assert.equal(D.envSorgular.length, 0, `${m} ${u}: uc envanteri okudu`);
  }
  assert.equal(D.launch.length, 0);
  for (const u of ['/hedefler', '/senaryolar', '/senaryolar/1', '/kosular', '/kosular/101', '/karsilastir?ref=1&aday=2']) {
    const r = await istek('GET', u, { session: KULLANICI });
    assert.notEqual(r.statusCode, 403, `salt okunur ${u} Admin olmayana kapali`);
    assert.notEqual(r.statusCode, 401, u);
  }
  for (const anahtar of ['NginxConsole', 'tab:nginx:yuktesti']) {
    const r = await istek('GET', '/senaryolar', { session: KULLANICI, gizli: anahtar });
    assert.deepEqual([r.statusCode, r.body.gorunurluk], [403, anahtar], `${anahtar} kapisi uygulanmiyor`);
  }
  // Isleyici de Admin ister (kapi atlansa bile): dogrudan isleyici kontrolu kaynakta.
  const kod = fs.readFileSync(IDX_YOL, 'utf8');
  for (const uc of ["router.post('/senaryolar'", "router.delete('/senaryolar/:id'", "router.post('/kosular/on-kontrol'", "router.post('/kosular'", "router.get('/kosular/:id/durum'", "router.post('/kosular/:id/durdur'", "router.post('/kosular/:id/yeniden-oku'", "router.get('/ip-sinifi'"]) {
    const i = kod.indexOf(uc);
    assert.ok(i > 0, uc);
    assert.match(kod.slice(i, i + 400), /adminSart\(req\)/, `${uc} isleyicide Admin denetlemiyor`);
  }
});

test('YKP2 kapi sirasi, nginxRed haric listesi, ADMIN_DISI_OKUMA', () => {
  const kod = fs.readFileSync(IDX_YOL, 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const sira = ['router.use(requireAuth);', 'adminOkumaKapisi({', "router.use(requireVisiblePrefix('NginxConsole'));", "router.use(requireVisible('tab:nginx:yuktesti'));", "router.get('/hedefler'"];
  let onceki = -1;
  for (const s of sira) {
    const i = kod.indexOf(s);
    assert.ok(i > onceki, `kapi sirasi bozuk: ${s}`);
    onceki = i;
  }
  assert.match(kod, /app\.use\('\/api\/nginx-loadtest', yonlendiriciKur\(\)\)/);
  const servis = fs.readFileSync(path.join(__dirname, '..', '..', 'service.cjs'), 'utf8');
  const haric = servis.match(/haric:\s*\[([^\]]*)\]/);
  assert.ok(haric, 'nginxRedCevirici haric listesi okunamadi');
  assert.doesNotMatch(haric[1], /nginx-loadtest/, 'yuk testi router\'i haric: 403/404 govdeleri HTML\'e doner');
  const ornek = ['/hedefler', '/senaryolar', '/senaryolar/12', '/kosular', '/kosular/12', '/karsilastir'];
  for (const re of yt._ADMIN_DISI_OKUMA) assert.ok(ornek.some((o) => re.test(o)), `ornegi olmayan desen: ${re}`);
  for (const yasak of ['/kosular/12/durum', '/kosular/12/durdur', '/kosular/on-kontrol', '/senaryolar/12/sil', '/kosular/12/yeniden-oku', '/ip-sinifi']) {
    assert.ok(!yt._ADMIN_DISI_OKUMA.some((re) => re.test(yasak)), `${yasak} Admin olmayana acik`);
  }
});

test('YKP3 kimlikler istemciden alinmaz (baslatma, durum, durdurma)', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  const r = await istek('POST', '/kosular/on-kontrol', {
    body: GOVDE({ awxServerId: 9, serverId: 9, jobId: 5, templateId: 77, limit: 'GBNGXP40', extra_vars: { yuk_hedef_host: 'GBNGXP40' }, LIMIT_MUAF: '1', yuk_maxvu: '500' }),
  });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(D.launch.length, 1);
  const [sid, tid, ev, limit] = D.launch[0];
  assert.deepEqual([sid, tid, limit], [3, 44, ''], 'sunucu/template kayittan, limit bos degil');
  assert.deepEqual(Object.keys(ev).sort(), [...dg.EKSTRA_ANAHTARLAR].sort(), 'govdedeki fazlalik extra_vars\'a sizdi');
  assert.equal(Object.keys(ev).length, 30);
  assert.equal(ev.yuk_hedef_host, 'GBNGXT33');
  assert.equal(ev.yuk_islem, 'on_kontrol');
  assert.equal(ev.yuk_run_id, String(r.body.kosuId));
  assert.deepEqual([r.body.awxServerId, r.body.jobId], [3, 900]);
  // Kayitta sunucu yoksa NGINX_LOADTEST_AWX_SERVER_ID, o da yoksa 1 - ASLA 0.
  D.registry = { enabled: true, awxTemplateId: 44, awxServerId: null };
  for (const k of D.kilitler.values()) k.held = 0;
  await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  assert.equal(D.launch[1][0], 1, 'sunucusuz kayit 0\'a dustu');
  // /durum ve /durdur: sorgudaki / govdedeki kimlik yok sayilir.
  const kosu = D.kosular[0];
  await istek('GET', `/kosular/${kosu.id}/durum?serverId=9&jobId=5`);
  assert.deepEqual(D.statusCagri.at(-1), [3, 900]);
  await istek('POST', `/kosular/${kosu.id}/durdur`, { body: { awxServerId: 9, jobId: 5 } });
  assert.deepEqual(D.iptal.at(-1), [3, 900]);
});

test('YKP4 on kontrol 409/424 kodlari: AWX\'e gitmez, kilit kalmaz, ret denetlenir', { timeout: 20000 }, async () => {
  const durumlar = [
    ['uretim hedefi', () => {}, GOVDE({ hedefHost: 'GBNGXP40' }), 409, 'hedef_uretim'],
    ['EDU hedefi', () => {}, GOVDE({ hedefHost: 'GBNGXT51' }), 409, 'hedef_uretim'],
    ['envanterde yok', () => {}, GOVDE({ hedefHost: 'GBNGXT99' }), 409, 'hedef_envanterde_yok'],
    ['envanter uretim isareti', () => { D.nginxEnv.GBNGXT33 = 'Production'; }, GOVDE(), 409, 'hedef_uretim'],
    ['Inventory uretim isareti', () => { D.invEnv.GBNGXT33 = 'PROD'; }, GOVDE(), 409, 'hedef_uretim'],
    ['izinsiz yuk makinesi', () => {}, GOVDE({ yukHost: 'GBNGXT33' }), 409, 'ayni_host'],
    ['listede olmayan yuk makinesi', () => {}, GOVDE({ yukHost: 'GBNGXD01' }), 409, 'yuk_host_izinsiz'],
    // Tur 3: sahibi olmayan IP host secicide ip_hedefte_yok; yuk makinesinin IP'si siniflandirmada ayni_host.
    // vhost listede olmamak artik ENGEL degil (D7, YKP29).
    ['IP hedefte yok', () => {}, GOVDE({ hedefIp: '10.0.0.77' }), 409, 'ip_hedefte_yok'],
    ['IP yuk makinesinin', () => {}, GOVDE({ hedefIp: '10.0.0.6' }), 409, 'ayni_host'],
    ['olculen limit_req asildi', () => {}, GOVDE({ parametreler: { hizlar: [271] } }), 409, 'sinir_asildi'],
    ['butce asildi', () => {}, GOVDE({ parametreler: { hizlar: [10, 20, 30, 40, 50], tekrar: 3, sure: 300 } }), 409, 'sinir_asildi'],
    ['senaryo yok', () => {}, GOVDE({ senaryoId: 99 }), 409, 'senaryo_yok'],
    ['silinmis senaryo', () => { D.senaryolar[0].silindi = 1; }, GOVDE(), 409, 'senaryo_yok'],
    ['bozulmus senaryo', () => { D.senaryolar[0].tsv += '1\t1\tjs\tkucuk\t/x\n'; }, GOVDE(), 409, 'senaryo_yok'],
    ['sablon yok', () => { D.registry = { enabled: true, awxTemplateId: null }; }, GOVDE(), 409, 'sablon_yok'],
    ['kayit kapali', () => { D.registry = { enabled: false, awxTemplateId: 44 }; }, GOVDE(), 409, 'sablon_yok'],
    ['kilit dolu', () => { D.kilitler.set('T|GBNGXT33', { lock_key: 'T|GBNGXT33', held: 1, lock_id: 'x', holder: 'ali', locked_until: BAS + 3600000 }); }, GOVDE(), 409, 'kilit_dolu'],
    ['yanlis sablon', () => { D.playbookUyusmaz = true; }, GOVDE(), 409, 'awx_template_playbook_mismatch'],
    ['envanter okunamadi', () => { D.invHata = new Error('TBMWANS kapali'); }, GOVDE(), 424, 'envanter_okunamadi'],
    ['kilit tablosu okunamadi', () => { D.kilitDbHata = true; }, GOVDE(), 424, 'db_okunamadi'],
    ['host CRLF', () => {}, GOVDE({ vhost: 'app.test.local\r\nX-Evil: 1' }), 400, 'gecersiz_istek'],
    ['host port', () => {}, GOVDE({ vhost: 'app.test.local:443' }), 400, 'gecersiz_istek'],
    ['IP metni', () => {}, GOVDE({ hedefIp: 'evil.com' }), 400, 'gecersiz_istek'],
    ['sni metin', () => {}, GOVDE({ sni: 'true' }), 400, 'gecersiz_istek'],
  ];
  for (const [ad, hazirla, govde, http, kod] of durumlar) {
    sifirla();
    senaryoEkle();
    hazirla();
    const r = await istek('POST', '/kosular/on-kontrol', { body: govde });
    assert.deepEqual([r.statusCode, r.body.code], [http, kod], `${ad}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.ok, false, ad);
    assert.equal(D.launch.length, 0, `${ad}: AWX isi baslatildi`);
    if (kod !== 'kilit_dolu') {
      for (const [k, v] of D.kilitler) assert.ok(!v.held, `${ad}: ${k} kilidi tutulu kaldi`);
    }
    if (http === 409 || http === 424) {
      const d = D.denetim.find((x) => x.eylem === 'nginx_loadtest_on_kontrol');
      assert.ok(d && d.result === 'fail', `${ad}: ret denetime yazilmadi`);
    }
    // Kapilar satirdan ONCE: yalniz sablon dogrulamasi (AWX'e ilk temas) satir yazildiktan sonra
    // duser ve satir FAILED kalir; diger her red satir birakmaz.
    if (kod === 'awx_template_playbook_mismatch') assert.deepEqual(D.kosular.map((x) => x.durum), ['FAILED'], ad);
    else assert.equal(D.kosular.length, 0, `${ad}: kapidan once kosu satiri yazildi`);
  }
  // Kapidan ONCE red: hicbir kosu satiri olusmaz (sablon_yok dahil - sablon kilitten once cozulur).
  sifirla();
  senaryoEkle();
  D.registry = null;
  await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  assert.equal(D.kosular.length, 0);
});

test('YKP4b AWX baslatma hatasi: kesin ret kilidi birakir, belirsiz hata kilidi TTL\'e birakir', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  D.launchHata = Object.assign(new Error('400 variables_needed_to_start password=abc'), { status: 400 });
  let r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  assert.deepEqual([r.statusCode, r.body.code], [424, 'awx_okunamadi']);
  assert.doesNotMatch(r.body.message, /abc/, 'AWX hata metni maskelenmedi');
  assert.ok([...D.kilitler.values()].every((k) => !k.held), 'kesin retten sonra kilit tutuldu');
  assert.equal(D.kosular[0].durum, 'FAILED');
  sifirla();
  senaryoEkle();
  D.launchHata = new Error('socket hang up');
  r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  assert.deepEqual([r.statusCode, r.body.code], [424, 'awx_okunamadi']);
  assert.ok([...D.kilitler.values()].some((k) => k.held), 'belirsiz hatada kilit birakildi (is baslamis olabilir)');
  assert.equal(D.kosular[0].durum, 'FAILED');
  assert.match(D.kosular[0].sonuc, /"belirsiz":true/);
});

test('YKP4c kilit alma ortasinda DB hatasi: alinmis kilitler birakilir (424), tekrar deneyen istek gecer; birakma da hata alirsa uyari, kilit sure dolana kadar', { timeout: 20000 }, async () => {
  const dolu = () => [...D.kilitler.entries()].filter(([, v]) => v.held).map(([k]) => k).sort();
  // Serbest on kontrol (G + T|IP + L): G alindi, T|IP satir garantisi gecici hata (deadlock kurbani 1205).
  sifirla();
  senaryoEkle();
  process.env.NGINX_LOADTEST_SERBEST_AGLAR = SERBEST_AG;
  D.kilitHata = { desen: /^IF NOT EXISTS \(SELECT 1 FROM nginx_loadtest_kilitleri/, onek: 'T|IP:' };
  // Birakma BASARILIYKEN "kilit birakilamadi" uyarisi yazilmaz (operator var olmayan bir takili kilidi aramasin).
  const ilkUyarilar = [];
  const eskiWarn0 = console.warn;
  console.warn = (...a) => ilkUyarilar.push(a.join(' '));
  let r = await istek('POST', '/kosular/on-kontrol', { body: SGOVDE() }).finally(() => { console.warn = eskiWarn0; });
  assert.deepEqual(ilkUyarilar.filter((u) => /kilit birakilamadi/.test(u)), [], 'birakma basariliyken birakilamadi uyarisi yazildi');
  assert.deepEqual([r.statusCode, r.body.code, r.body.message], [424, 'db_okunamadi', 'İş kilidi alınamadı; iş başlatılmadı, lütfen tekrar deneyin.']);
  assert.equal(D.kilitHata, null, 'fikstur: hata atilmadi');
  assert.ok(D.kilitler.get('G|global') && D.kilitler.get('G|global').lock_id, 'fikstur: G alinmadan hata (YKP4 durumu)');
  assert.deepEqual([D.launch.length, D.kosular.length, dolu()], [0, 0, []], 'G|global TTL boyunca tutulu kaldi');
  // "Tekrar deneyin" diyen mesajdan sonra tekrar deneyen istek kilit_dolu ALMAZ.
  r = await istek('POST', '/kosular/on-kontrol', { body: SGOVDE() });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  // Sunucu kosusu (G + T + L): G ve T alindi; L'nin CAS'i YAZILDI ama yanit kayboldu -> uc anahtar da birakilir.
  sifirla();
  senaryoEkle();
  const ok = await onKontrolHazirla();
  D.kilitHata = { desen: /^UPDATE nginx_loadtest_kilitleri SET held = 1/, onek: 'L|', sonra: true };
  const kos = () => istek('POST', '/kosular', { body: { onKontrolKosuId: ok.id, confirmText: 'GBNGXT33', uyariOnay: true } });
  r = await kos();
  assert.deepEqual([r.statusCode, r.body.code], [424, 'db_okunamadi'], JSON.stringify(r.body));
  assert.equal(D.kilitler.get('L|GBNGXT34').lock_id, D.kilitler.get('G|global').lock_id, 'fikstur: L yazilmadi');
  assert.deepEqual([D.launch.length, dolu()], [1, []]);
  r = await kos();
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(dolu(), ['G|global', 'L|GBNGXT34', 'T|GBNGXT33']);
  // Yabanci kilit birakilmaz: istegin anahtar listesindeki L baska bir isin (lock_id 'yabanci'); G alindi,
  // T|IP hata atti -> yalniz bu istegin lock_id'li dolu satiri (G) birakilir.
  sifirla();
  senaryoEkle();
  process.env.NGINX_LOADTEST_SERBEST_AGLAR = SERBEST_AG;
  D.kilitler.set('L|GBNGXT34', { id: 1, lock_key: 'L|GBNGXT34', held: 1, lock_id: 'yabanci', holder: 'ali', locked_until: BAS + 3600000 });
  D.kilitHata = { desen: /^IF NOT EXISTS \(SELECT 1 FROM nginx_loadtest_kilitleri/, onek: 'T|IP:' };
  r = await istek('POST', '/kosular/on-kontrol', { body: SGOVDE() });
  assert.deepEqual([r.statusCode, r.body.code], [424, 'db_okunamadi']);
  assert.deepEqual([dolu(), D.kilitler.get('L|GBNGXT34').lock_id], [['L|GBNGXT34'], 'yabanci'], 'yabanci kilit birakildi');
  // Birakma da hata alirsa (DB hala erisilemiyor): yeniden deneme yok, sessiz de kalinmaz (maskeli uyari).
  // G bu istegin kilidi olarak ise bagsiz kalir: sure dolana kadar tekrar deneyen kilit_dolu alir, sonra gecer.
  sifirla();
  senaryoEkle();
  process.env.NGINX_LOADTEST_SERBEST_AGLAR = SERBEST_AG;
  D.kilitHata = {
    desen: /^IF NOT EXISTS \(SELECT 1 FROM nginx_loadtest_kilitleri/, onek: 'T|IP:',
    ardindan: { desen: /^UPDATE nginx_loadtest_kilitleri SET held = 0/, onek: 'G|', mesaj: 'baglanti koptu password=gizli123' },
  };
  const uyarilar = [];
  const eskiWarn = console.warn;
  console.warn = (...a) => uyarilar.push(a.join(' '));
  try {
    r = await istek('POST', '/kosular/on-kontrol', { body: SGOVDE() });
  } finally {
    console.warn = eskiWarn;
  }
  assert.deepEqual([r.statusCode, r.body.code, r.body.message], [424, 'db_okunamadi', 'İş kilidi alınamadı; iş başlatılmadı, lütfen tekrar deneyin.']);
  assert.equal(D.kilitHata, null, 'fikstur: birakma hatasi atilmadi');
  const g = D.kilitler.get('G|global');
  assert.deepEqual([dolu(), g.holder, g.awx_job_id, D.launch.length, D.kosular.length], [['G|global'], 'onur', null, 0, 0]);
  const birakma = uyarilar.filter((u) => /kilit birakilamadi/.test(u));
  assert.equal(birakma.length, 1, `birakma hatasi sessiz kaldi: ${JSON.stringify(uyarilar)}`);
  assert.match(birakma[0], /^\[NginxYukTesti\] kilit birakilamadi \(TTL ile dusecek\): baglanti koptu password=/);
  assert.doesNotMatch(birakma[0], /gizli123/, 'uyari maskelenmedi');
  r = await istek('POST', '/kosular/on-kontrol', { body: SGOVDE() });
  assert.deepEqual([r.statusCode, r.body.code, r.body.kilit], [409, 'kilit_dolu', 'G|global'], JSON.stringify(r.body));
  D.simdi = g.locked_until + 60000;
  r = await istek('POST', '/kosular/on-kontrol', { body: SGOVDE() });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
});

test('YKP5 basarili on kontrol: satir, kilitler, gecmis, denetim', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  const r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE({ sni: true }) });
  assert.equal(r.statusCode, 200);
  const k = D.kosular.find((x) => x.id === r.body.kosuId);
  assert.deepEqual([k.durum, k.adim, k.awx_server_id, k.awx_job_id, k.islem, k.sw_dizin], ['RUNNING', `R${k.id}`, 3, 900, 'on_kontrol', null]);
  assert.deepEqual(JSON.parse(k.parametreler), { motor: 'k6', hizlar: [100, 250], tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, maxvu: 150, kip: 'yeni', ae: 'br', sni: true, butceSn: 60 + 2 * 2 * (30 + 120 + 30 + 20) + 120 });
  // Tur 3 kolonlari: k6 + sunucu satiri; plan uyarisi yok (NULL).
  assert.deepEqual([k.hedef_turu, k.motor, k.hedef_host, k.plan_uyarilari], ['sunucu', 'k6', 'GBNGXT33', null]);
  assert.equal(D.launch[0][2].yuk_sni, '1');
  assert.deepEqual([D.launch[0][2].yuk_hedef_turu, D.launch[0][2].yuk_motor], ['sunucu', 'k6']);
  assert.ok(Math.abs(Number(D.launch[0][2].yuk_son_epoch) - (Math.floor(Date.now() / 1000) + 900)) <= 5, 'yuk_son_epoch simdi + 900 degil');
  assert.deepEqual([...D.kilitler.keys()].sort(), ['L|GBNGXT34', 'T|GBNGXT33'], 'on kontrol global kilit aldi ya da hedef/yuk kilidini almadi');
  for (const v of D.kilitler.values()) assert.deepEqual([v.held, v.awx_server_id, v.awx_job_id], [1, 3, 900]);
  const params = JSON.parse(D.gecmis[0][6]);
  assert.match(params.yuk_senaryo_b64, /^<\d+ b64>$/, 'is gecmisine senaryo govdesi yazildi');
  const d = D.denetim.find((x) => x.eylem === 'nginx_loadtest_on_kontrol');
  assert.deepEqual([d.targetHost, d.targetIp], ['GBNGXT33', '10.0.0.9']);
  const det = JSON.parse(d.detail);
  assert.ok(det.jobId === 900);
  assert.deepEqual([det.hedefTuru, det.motor, det.serbestAg, det.vhostListede, det.planUyarilari], ['sunucu', 'k6', null, true, []]);
});

test('YKP6 kosu: on kontrol kapisi, istemci govdesi yok sayilir, yeniden olcum', { timeout: 20000 }, async () => {
  const kosuIste = (ok, ek = {}) => istek('POST', '/kosular', { body: { onKontrolKosuId: ok.id, confirmText: 'GBNGXT33', uyariOnay: false, ...ek } });
  const reddet = async (ad, hazirla, ek, kod, http = 409) => {
    sifirla();
    senaryoEkle();
    const ok = await hazirla();
    const once = D.launch.length;
    const r = await kosuIste(ok, ek);
    assert.deepEqual([r.statusCode, r.body.code], [http, kod], `${ad}: ${JSON.stringify(r.body)}`);
    assert.equal(D.launch.length, once, `${ad}: kosu baslatildi`);
    return r;
  };
  await reddet('yok', async () => ({ id: 555 }), {}, 'on_kontrol_eski');
  await reddet('baskasinin', () => onKontrolHazirla({ sahip: 'ali' }), {}, 'on_kontrol_eski');
  await reddet('bitmemis', () => onKontrolHazirla({ durum: 'RUNNING' }), {}, 'on_kontrol_eski');
  await reddet('OK degil', () => onKontrolHazirla({ sonucDurum: 'FAIL' }), {}, 'on_kontrol_eski');
  await reddet('16 dk once', () => onKontrolHazirla({ yasDk: 16 }), {}, 'on_kontrol_eski');
  await reddet('onay metni', () => onKontrolHazirla(), { confirmText: 'gbngxt33' }, 'onay_metni');
  await reddet('onay metni yok', () => onKontrolHazirla(), { confirmText: undefined }, 'onay_metni');
  await reddet('IP yerel degil', () => onKontrolHazirla({ ozet: { ...OK_OZET, ip_yerel: false } }), { uyariOnay: true }, 'on_kontrol_eski');
  const u = await reddet('uyari onaysiz', () => onKontrolHazirla({ ozet: { ...OK_OZET, yollar_200: 1, web_log_df: 70 } }), {}, 'uyari_onayi');
  assert.equal(u.body.uyarilar.length, 2);
  assert.match(u.body.uyarilar.join(), /1\/2 yol 200 dönmedi/);
  await reddet('uyariOnay metin', () => onKontrolHazirla({ ozet: { ...OK_OZET, web_log_df: 70 } }), { uyariOnay: 'true' }, 'uyari_onayi');
  // Olculmus master != 1 uyari degil ENGEL: uyariOnay ile de gecilmez (kaydedici baslamazdi).
  await reddet('master 2', () => onKontrolHazirla({ ozet: { ...OK_OZET, master_sayisi: 2 } }), { uyariOnay: true }, 'on_kontrol_eski');
  await reddet('envanter artik uretim', async () => {
    const ok = await onKontrolHazirla();
    D.invEnv.GBNGXT33 = 'Production';
    return ok;
  }, {}, 'hedef_uretim');
  await reddet('kosu satiri on kontrol degil', async () => {
    const ok = await onKontrolHazirla();
    ok.islem = 'kosu';
    return ok;
  }, {}, 'on_kontrol_eski');

  // Basari: uyarilar acikca onaylandi; govdedeki hedef/IP/parametre YOK SAYILIR.
  sifirla();
  senaryoEkle();
  const ok = await onKontrolHazirla({ ozet: { ...OK_OZET, sikistirma: { statik: 2 } } });
  const r = await kosuIste(ok, { uyariOnay: true, hedefHost: 'GBNGXP40', hedefIp: '10.9.0.1', yukHost: 'GBNGXT51', parametreler: { hizlar: [450], maxvu: 199 }, awxServerId: 9 });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const ev = D.launch.at(-1)[2];
  assert.deepEqual([ev.yuk_islem, ev.yuk_hedef_host, ev.yuk_hedef_ip, ev.yuk_yuk_host, ev.yuk_hizlar, ev.yuk_maxvu], ['kosu', 'GBNGXT33', '10.0.0.9', 'GBNGXT34', '100 250', '150']);
  assert.equal(D.launch.at(-1)[0], 3);
  const kosu = D.kosular.find((x) => x.id === r.body.kosuId);
  assert.deepEqual([kosu.islem, kosu.on_kontrol_kosu_id, kosu.durum, kosu.sw_dizin], ['kosu', ok.id, 'RUNNING', `/sw/BMW_PORTAL/nginx_loadtest/${kosu.id}`]);
  assert.deepEqual([...D.kilitler.entries()].filter(([, v]) => v.held).map(([k]) => k).sort(), ['G|global', 'L|GBNGXT34', 'T|GBNGXT33']);
  const d = D.denetim.find((x) => x.eylem === 'nginx_loadtest_baslat');
  assert.ok(d && d.targetHost === 'GBNGXT33' && d.targetIp === '10.0.0.9');
  assert.match(JSON.parse(d.detail).onaylananUyarilar.join(), /ön-sıkıştırılmış/, 'onaylanan uyarilar denetime yazilmadi');
  // Ikinci kosu global kilitte durur.
  const r2 = await kosuIste(ok, { uyariOnay: true });
  assert.equal(r2.body.code, 'kilit_dolu');
});

test('YKP7 AWX degiskenleri yuttu: is iptal edilir, kilit o ise baglanir, satir FAILED', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  D.yutulan = ['extra_vars.yuk_islem', 'extra_vars.yuk_hedef_host'];
  const r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  assert.deepEqual([r.statusCode, r.body.code], [409, 'awx_prompt_on_launch_disabled']);
  assert.deepEqual(D.iptal, [[3, 900]], 'yutulan degiskenli is iptal edilmedi');
  for (const v of D.kilitler.values()) assert.deepEqual([v.held, v.awx_job_id], [1, 900], 'kilit iptal edilen ise baglanmadi');
  assert.deepEqual([D.kosular[0].durum, D.kosular[0].awx_job_id], ['FAILED', 900]);
});

test('YKP8 /durum: maskeli artimli cikti, playbook baglamasi, okunamadi ve arsiv', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  const b = await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  const id = b.body.kosuId;
  let r = await istek('GET', `/kosular/${id}/durum`);
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.finished, false);
  assert.doesNotMatch(r.body.output, /gizli123/, 'cikti maskelenmedi');
  assert.deepEqual(D.ciktiCagri.at(-1)[2], { artimli: true }, 'suren is artimli okunmadi');
  const tam = r.body.output;
  r = await istek('GET', `/kosular/${id}/durum?since=5`);
  assert.deepEqual([r.body.output, r.body.outputOffset, r.body.outputLength], [tam.slice(5), 5, tam.length]);
  r = await istek('GET', `/kosular/${id}/durum?since=999999`);
  assert.equal(r.body.outputOffset, 0, 'metinden uzun since tamamini dondurmedi');
  // Bitti: tam cekim + sonuclandirma tetiklenir + set_stats maskeli doner.
  D.awxDurum = { ...D.awxDurum, status: 'successful', artifacts: { nginx_loadtest_result: JSON.stringify({ durum: 'OK', hata: 'token=abc123' }) } };
  D.sorgular = [];
  r = await istek('GET', `/kosular/${id}/durum`);
  assert.deepEqual([r.body.status, r.body.finished], ['successful', true]);
  assert.deepEqual(D.ciktiCagri.at(-1)[2], { artimli: false });
  assert.equal(r.body.result.durum, 'OK');
  assert.doesNotMatch(JSON.stringify(r.body.result), /abc123/, 'set_stats maskelenmedi');
  await new Promise((s) => setImmediate(s));
  assert.deepEqual(D.tetiklenen, [id], 'biten is sonuclandirmaya tetiklenmedi');
  // Baska playbook'un ayni numarali isi gosterilmez.
  D.awxDurum = { ...D.awxDurum, playbook: 'bmw_portal/opsx_was/opsx_was_operation.yml' };
  r = await istek('GET', `/kosular/${id}/durum`);
  assert.deepEqual([r.statusCode, r.body.code], [409, 'awx_template_playbook_mismatch']);
  D.awxDurum = { ...D.awxDurum, playbook: '' };
  r = await istek('GET', `/kosular/${id}/durum`);
  assert.deepEqual([r.statusCode, r.body.code], [424, 'awx_okunamadi']);
  // AWX okunamadi 424; sunucu kapali / is silinmis -> arsiv (maskeli).
  D.awxHata = Object.assign(new Error('ETIMEDOUT'), { status: 504 });
  r = await istek('GET', `/kosular/${id}/durum`);
  assert.deepEqual([r.statusCode, r.body.code], [424, 'awx_okunamadi']);
  D.awxHata = Object.assign(new Error('sunucu yok'), { status: 404, code: 'awx_server_missing' });
  r = await istek('GET', `/kosular/${id}/durum`);
  assert.deepEqual([r.statusCode, r.body.code], [409, 'awx_okunamadi']);
  D.arsiv.push({ sid: 3, jid: 900, stdout: 'eski password=s3cret' });
  r = await istek('GET', `/kosular/${id}/durum`);
  assert.deepEqual([r.statusCode, r.body.kaynak, r.body.finished], [200, 'arsiv', true]);
  assert.doesNotMatch(r.body.output, /s3cret/);
  r = await istek('GET', '/kosular/999/durum');
  assert.deepEqual([r.statusCode, r.body.code], [409, 'kosu_yok']);
});

test('YKP9 /durdur: AWX iptal + durdur kipi playbook, satirdan kimlik, denetim', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  const ok = await onKontrolHazirla();
  const r0 = await istek('POST', '/kosular', { body: { onKontrolKosuId: ok.id, confirmText: 'GBNGXT33' } });
  const id = r0.body.kosuId;
  const r = await istek('POST', `/kosular/${id}/durdur`, { body: {} });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(D.iptal.at(-1), [3, r0.body.jobId]);
  const ev = D.launch.at(-1)[2];
  assert.deepEqual([ev.yuk_islem, ev.yuk_run_id, ev.yuk_hedef_host], ['durdur', String(id), 'GBNGXT33']);
  assert.deepEqual(dg.ekstraDegiskenleriDenetle(ev), []);
  assert.ok(r.body.durdurIsi && r.body.durdurIsi.jobId);
  assert.equal(D.kosular.find((x) => x.id === id).iptal_eden, 'onur');
  assert.ok(D.denetim.some((x) => x.eylem === 'nginx_loadtest_durdur' && x.targetHost === 'GBNGXT33'));
  // Durdurma ortam kapisindan GECMEZ (envanter uretime donmus olsa da durdurulur).
  D.invEnv.GBNGXT33 = 'Production';
  const r2 = await istek('POST', `/kosular/${id}/durdur`);
  assert.equal(r2.statusCode, 200);
  // Bitmis kosu durdurulmaz.
  D.kosular.find((x) => x.id === id).durum = 'DONE';
  const r3 = await istek('POST', `/kosular/${id}/durdur`);
  assert.deepEqual([r3.statusCode, r3.body.code], [409, 'kosu_bitti']);
});

test('YKP10 senaryolar: dogrulama, sha256, yumusak silme', { timeout: 10000 }, async () => {
  sifirla();
  const satirlar = [{ agirlik: 3, har: 1, tur: 'js', boyut: 'kucuk', yol: '/a.js' }];
  let r = await istek('POST', '/senaryolar', { body: { ad: 'GLOMO', senaryoTur: 'K', kaynak: 'har', vhost: 'app.test.local', satirlar, ozet: { K_satir: 1 } } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const s = D.senaryolar[0];
  assert.deepEqual([s.tsv, s.sha256, s.yol_sayisi, s.created_by], ['3\t1\tjs\tkucuk\t/a.js\n', dg.sha256Hex('3\t1\tjs\tkucuk\t/a.js\n'), 1, 'onur']);
  assert.ok(D.denetim.some((x) => x.eylem === 'nginx_loadtest_senaryo_ekle'));
  r = await istek('POST', '/senaryolar', { body: { ad: 'X', senaryoTur: 'K', kaynak: 'har', satirlar: [{ ...satirlar[0], yol: '/a?token=1' }, { ...satirlar[0], yol: '//evil.com/x' }] } });
  assert.deepEqual([r.statusCode, r.body.code, r.body.hatalar.length], [400, 'gecersiz_istek', 2]);
  assert.equal(D.senaryolar.length, 1);
  r = await istek('GET', '/senaryolar/1');
  assert.deepEqual([r.body.senaryo.tsv, r.body.senaryo.ozet, r.body.senaryo.senaryoTur], [s.tsv, { K_satir: 1 }, 'K']);
  r = await istek('DELETE', '/senaryolar/1');
  assert.equal(r.statusCode, 200);
  assert.equal(D.senaryolar.length, 1, 'senaryo satiri silindi (yumusak olmali)');
  assert.deepEqual((await istek('GET', '/senaryolar')).body.senaryolar, []);
  assert.equal((await istek('GET', '/senaryolar/1')).body.code, 'senaryo_yok');
  assert.equal((await istek('DELETE', '/senaryolar/1')).body.code, 'senaryo_yok');
});

test('YKP11 karsilastir: DB adimlariyla kararVer; on kontrol karsilastirilmaz', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  D.kosular.push(
    { id: 1, islem: 'kosu', durum: 'DONE', etiket: 'T0', created_at: new Date(BAS), senaryo_id: 1 },
    { id: 2, islem: 'kosu', durum: 'DONE', etiket: 'T1', created_at: new Date(BAS), senaryo_id: 1 },
    { id: 3, islem: 'on_kontrol', durum: 'DONE', created_at: new Date(BAS), senaryo_id: 1 },
  );
  D.adimlar.push({ id: 1, kosu_id: 1, tur: 'R1_K_yeni_br_100_r1', hiz: 100, cpu_ms_istek: 0.5, nedenler: '["x"]', ham: null }, { id: 2, kosu_id: 2, tur: 'R2_K_yeni_br_100_r1', hiz: 100, cpu_ms_istek: 0.4, nedenler: null, ham: '{"a":1}' });
  const r = await istek('GET', '/karsilastir?ref=1&aday=2&esikCpu=5');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.karar, r.body.ref.etiket, r.body.aday.etiket], ['NOTR', 'T0', 'T1']);
  // kararVer'in kademe / kombinasyon'u ekrana gecer (UI CPU ve p95 kademesini bundan gosterir).
  assert.deepEqual([r.body.kademe, r.body.kombinasyon], [{ cpu: 100, p95: 100 }, { senaryo: 'K', kip: 'yeni', ae: 'br' }]);
  const c = kararCagri.at(-1);
  // Tur 3: esiklerin yaninda motor / hedef turu / is parcacigi / hiz tavani secenekleri (eski satir: k6 / sunucu / null / null).
  assert.deepEqual([c.r[0].tur, c.r[0].nedenler, c.a[0].ham, c.a[0].nedenler, c.s], ['R1_K_yeni_br_100_r1', ['x'], { a: 1 }, [], {
    esikCpu: 5, refMotor: 'k6', adayMotor: 'k6', refHedefTuru: 'sunucu', adayHedefTuru: 'sunucu', refIsParcacigi: null, adayIsParcacigi: null,
    refTavanRps: null, adayTavanRps: null,
  }]);
  assert.equal((await istek('GET', '/karsilastir?ref=1&aday=3')).body.code, 'kosu_yok');
  assert.equal((await istek('GET', '/karsilastir?ref=1')).statusCode, 400);
  assert.equal((await istek('GET', '/karsilastir?ref=1&aday=2&esikP95=500')).statusCode, 400);
});

test('YKP12 hedefler: uygunluk ve neden, yuk makineleri, sinirlar', { timeout: 10000 }, async () => {
  sifirla();
  const r = await istek('GET', '/hedefler');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const h = Object.fromEntries(r.body.hedefler.map((x) => [x.host, x]));
  assert.deepEqual([h.GBNGXT33.uygun, h.GBNGXT33.ipler, h.GBNGXT33.vhostlar, h.GBNGXT33.hizSiniri], [true, ['10.0.0.5', '10.0.0.9'], ['api.test.local', 'app.test.local'], 270]);
  assert.deepEqual([h.GBNGXP40.uygun, h.GBNGXP40.ipler], [false, []]);
  assert.match(h.GBNGXP40.neden, /üretim/);
  assert.equal(h.GBNGXT51.uygun, false, 'EDU hedef uygun gorundu');
  assert.deepEqual(r.body.yukHostlari, [{ host: 'GBNGXT34', env: 'TEST', uygun: true, neden: null }]);
  assert.equal(r.body.sinirlar.maxHiz, 450);
  assert.equal(r.body.sinirlar.maxButceSn, 2700);
  assert.deepEqual(r.body.varsayilan.hizlar, [100, 250, 400]);
  D.invHata = new Error('kapali');
  const r2 = await istek('GET', '/hedefler');
  assert.deepEqual([r2.statusCode, r2.body.code], [424, 'envanter_okunamadi']);
});

test('YKP13 kurulum: modul kaydi, tablolar + indeksler, sekme ve kayit seed\'leri, test dizini', () => {
  const kok = path.join(__dirname, '..', '..', '..');
  const oku = (p) => fs.readFileSync(path.join(kok, p), 'utf8');
  assert.match(oku('server/index.cjs'), /require\('\.\/nginx-loadtest\/index\.cjs'\)\.initNginxLoadtest\(app\)/, 'modul kayitli degil');
  const kur = oku('server/db/mssql-setup.cjs');
  for (const t of ['nginx_loadtest_senaryolar', 'nginx_loadtest_kosular', 'nginx_loadtest_adimlar', 'nginx_loadtest_kilitleri']) {
    assert.match(kur, new RegExp(`name: '${t}',\\s+sql: .\\s+CREATE TABLE ${t} \\(`), `${t} tablosu yok`);
  }
  assert.match(kur, /CREATE TABLE nginx_loadtest_kilitleri \([\s\S]*?UNIQUE\(lock_key\)/, 'kilit anahtari tekil degil');
  // Tur 2 ve tur 3 kolonlari CREATE TABLE icinde; ozellik bir ortamda yaratilmis olabilir: ALTER de var.
  const tablo = (t) => {
    const i = kur.indexOf(`CREATE TABLE ${t} (`);
    return kur.slice(i, kur.indexOf('`', i));
  };
  for (const [t, kolon] of [
    ['nginx_loadtest_kosular', /\bkilit_id\s+NVARCHAR\(64\) NULL/],
    ['nginx_loadtest_kosular', /\bdurdur_awx_server_id\s+INT NULL/],
    ['nginx_loadtest_kosular', /\bdurdur_awx_job_id\s+INT NULL/],
    ['nginx_loadtest_kosular', /\bsonuclandirma_denemesi\s+INT NOT NULL DEFAULT 0/],
    ['nginx_loadtest_kosular', /\bhedef_turu\s+NVARCHAR\(10\) NOT NULL DEFAULT 'sunucu'/],
    ['nginx_loadtest_kosular', /\bmotor\s+NVARCHAR\(8\) NOT NULL DEFAULT 'k6'/],
    ['nginx_loadtest_kosular', /\bplan_uyarilari\s+NVARCHAR\(2000\) NULL/],
    ['nginx_loadtest_kilitleri', /\bbag_turu\s+NVARCHAR\(12\) NULL/],
  ]) assert.match(tablo(t), kolon, `${t}: ${kolon} kolonu yok`);
  assert.doesNotMatch(kur, /Tablo hic dagitilmadi: ALTER yok/, 'eski "ALTER yok" yorumu kaldi (ozellik itildi)');
  const alterSql = (kolon) => {
    const m = new RegExp(`table: 'nginx_loadtest_kosular',\\s+col: '${kolon}',\\s+sql: \`([^\`]*)\``).exec(kur);
    return m && m[1];
  };
  assert.equal(alterSql('hedef_turu'), "ALTER TABLE nginx_loadtest_kosular ADD hedef_turu NVARCHAR(10) NOT NULL CONSTRAINT DF_nlk_hedef_turu DEFAULT 'sunucu'");
  assert.equal(alterSql('motor'), "ALTER TABLE nginx_loadtest_kosular ADD motor NVARCHAR(8) NOT NULL CONSTRAINT DF_nlk_motor DEFAULT 'k6'");
  assert.equal(alterSql('plan_uyarilari'), 'ALTER TABLE nginx_loadtest_kosular ADD plan_uyarilari NVARCHAR(2000) NULL');
  // ALTER'lar tur 2 girdilerinin ARDINDA.
  assert.ok(kur.indexOf("col: 'sonuclandirma_denemesi'") < kur.indexOf("col: 'hedef_turu'"), 'tur 3 ALTER tur 2 girdilerinden once');
  for (const [ad, tablo, kolon] of [['IX_nlk_job', 'nginx_loadtest_kosular', 'awx_server_id, awx_job_id'], ['IX_nlk_hedef', 'nginx_loadtest_kosular', 'hedef_host, created_at'], ['IX_nla_kosu', 'nginx_loadtest_adimlar', 'kosu_id']]) {
    assert.ok(kur.includes(`{ name: '${ad}', table: '${tablo}', cols: '${kolon}' }`), `${ad} indeksi yok`);
  }
  const reg = kur.slice(kur.indexOf("key_name: 'nginx_loadtest_run',"), kur.indexOf("key_name: 'nginx_loadtest_run',") + 1200);
  assert.match(reg, /category: 'nginx',/);
  assert.match(reg, /env_var_name: 'NGINX_LOADTEST_RUN_TEMPLATE_ID',/);
  assert.match(reg, /display_name: 'Nginx Hub — Yük Testi \(k6 \/ wrk\)',/);
  assert.match(reg, /serbest hedef/i, 'seed aciklamasi serbest hedefi anlatmiyor');
  const tabSeed = kur.match(/const NGINX_TAB_KEYS_SEED = \[([\s\S]*?)\];/);
  assert.ok(tabSeed && /'yuktesti'/.test(tabSeed[1]), 'NGINX_TAB_KEYS_SEED yuktesti tasimiyor');
  assert.match(oku('scripts/run-tests.cjs'), /'server\/nginx-loadtest\/__tests__',/);
  // Kod sabitleri ile seed birbirini tutar.
  const baslat = require('../baslat.cjs');
  assert.equal(baslat.KAYIT_ANAHTARI, 'nginx_loadtest_run');
  assert.equal(baslat.BEKLENEN_PLAYBOOK_ADI, 'nginx_loadtest.yml');
});

/** Tamamlanmis on kontrolden baslatilmis kosu (RUNNING, kilitler kosu isine bagli). */
async function kosuBaslat() {
  const ok = await onKontrolHazirla();
  const r = await istek('POST', '/kosular', { body: { onKontrolKosuId: ok.id, confirmText: 'GBNGXT33' } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  return { ...r.body, kosu: D.kosular.find((x) => x.id === r.body.kosuId) };
}

test('YKP14 /durdur: baslatma penceresi, kosu icin durdur isi zorunlu, kilitler durdur isine baglanir', { timeout: 20000 }, async () => {
  // (a) Baslatma suren satir (QUEUED, is numarasiz, 120 sn'den yeni): 409, hicbir sey yapilmaz.
  sifirla();
  senaryoEkle();
  const p = dg.parametreler({ hizlar: [100, 250] }, { sni: false }).deger;
  D.kosular.push({ id: 500, islem: 'kosu', durum: 'QUEUED', senaryo_id: 1, hedef_host: 'GBNGXT33', hedef_ip: '10.0.0.9', vhost: 'app.test.local', yuk_host: 'GBNGXT34', parametreler: JSON.stringify(p), created_at: new Date(D.simdi - 60 * 1000), kilit_id: 'yarim' });
  let r = await istek('POST', '/kosular/500/durdur');
  assert.deepEqual([r.statusCode, r.body.code, r.body.message], [409, 'baslatiliyor', 'Koşu başlatılıyor; birkaç saniye sonra yeniden deneyin.']);
  assert.deepEqual([D.launch.length, D.iptal.length, D.kosular[0].durum, D.kosular[0].iptal_eden], [0, 0, 'QUEUED', undefined]);
  // 120 sn'den eski yarim satir eskisi gibi CANCELED olur; kosu oldugu icin durdur isi yine baslar.
  D.kosular[0].created_at = new Date(D.simdi - 121 * 1000);
  r = await istek('POST', '/kosular/500/durdur');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual([D.kosular[0].durum, D.launch.at(-1)[2].yuk_islem, D.iptal.length], ['CANCELED', 'durdur', 0]);

  // (b) Kosu: iptal basarili ama durdur isi baslatilamadi -> 424 durdur_baslatilamadi (BASARI DEGIL).
  sifirla();
  senaryoEkle();
  const k0 = await kosuBaslat();
  D.launchHata = Object.assign(new Error('AWX 503 Service Unavailable'), { status: 503 });
  r = await istek('POST', `/kosular/${k0.kosuId}/durdur`);
  assert.deepEqual([r.statusCode, r.body.code, r.body.ok], [424, 'durdur_baslatilamadi', false]);
  assert.deepEqual([r.body.iptal, r.body.iptalHatasi], [{ canceled: true }, null]);
  assert.equal(r.body.durdurHatasi, 'AWX işi başlatılamadı: AWX 503 Service Unavailable');
  assert.equal(r.body.message, "AWX işi iptal edildi, ancak durdurma işi başlatılamadı: AWX işi başlatılamadı: AWX 503 Service Unavailable. Uzaktaki k6 / kaydedici sürüyor olabilir; Durdur'u yeniden deneyin. Kilitler koşunun süre sınırına kadar tutulur.");
  D.launchHata = Object.assign(new Error('AWX 503 password=gizli'), { status: 503 });
  r = await istek('POST', `/kosular/${k0.kosuId}/durdur`);
  assert.equal(r.body.code, 'durdur_baslatilamadi');
  assert.doesNotMatch(JSON.stringify(r.body), /gizli/, 'AWX hata metni maskelenmedi');
  for (const [kk, v] of D.kilitler) assert.deepEqual([v.held, v.awx_job_id, v.bag_turu], [1, k0.jobId, 'kosu'], `${kk}: kilit kosu isinden ayrildi`);
  assert.equal(k0.kosu.durdur_awx_job_id, undefined);
  assert.ok(D.denetim.some((x) => x.eylem === 'nginx_loadtest_durdur' && x.result === 'fail'), 'basarisiz durdur denetime yazilmadi');
  // Iptal de basarisiz: metin "iptal edilemedi".
  D.iptalHata = new Error('AWX 403');
  r = await istek('POST', `/kosular/${k0.kosuId}/durdur`);
  assert.deepEqual([r.statusCode, r.body.code, r.body.iptal], [424, 'durdur_baslatilamadi', null]);
  assert.match(r.body.message, /^AWX işi iptal edilemedi, ancak durdurma işi başlatılamadı: /);
  assert.match(r.body.iptalHatasi, /AWX 403/);

  // (c) Durdur isi basladi: satira yazilir, kilitler durdur isine baglanir, sure en az butce + 180.
  D.launchHata = null;
  D.iptalHata = null;
  D.simdi += 70 * 60000; // kosu kilidinin 5 dk'si kaldi
  const butce = JSON.parse(k0.kosu.parametreler).butceSn;
  r = await istek('POST', `/kosular/${k0.kosuId}/durdur`);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body).sort(), ['durdurHatasi', 'durdurIsi', 'iptal', 'iptalHatasi', 'ok']);
  assert.equal(r.body.durdurHatasi, null);
  const dj = r.body.durdurIsi.jobId;
  assert.deepEqual([k0.kosu.durdur_awx_server_id, k0.kosu.durdur_awx_job_id], [3, dj]);
  for (const [kk, v] of D.kilitler) {
    assert.deepEqual([v.held, v.awx_server_id, v.awx_job_id, v.bag_turu], [1, 3, dj, 'durdur'], kk);
    assert.equal(v.locked_until, D.simdi + (butce + 180) * 1000, `${kk}: sure butce + 180'e uzamadi`);
  }
  const g = await istek('GET', `/kosular/${k0.kosuId}`);
  assert.deepEqual(g.body.kosu.durdurIsi, { awxServerId: 3, awxJobId: dj });
  // CANCELED kosuya yeniden Durdur serbest (kalan surec temizligi); DONE 409 (YKP9).
  k0.kosu.durum = 'CANCELED';
  r = await istek('POST', `/kosular/${k0.kosuId}/durdur`);
  assert.equal(r.statusCode, 200);
  assert.equal(k0.kosu.durdur_awx_job_id, r.body.durdurIsi.jobId);

  // (d) Iptal BASARISIZ ama durdur isi basladi: kosu isi hala calisiyor olabilir; kilit kosu isinde kalir.
  sifirla();
  senaryoEkle();
  const k2 = await kosuBaslat();
  D.iptalHata = new Error('AWX 403');
  r = await istek('POST', `/kosular/${k2.kosuId}/durdur`);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.ok(r.body.durdurIsi && /AWX 403/.test(r.body.iptalHatasi));
  for (const [kk, v] of D.kilitler) assert.deepEqual([v.awx_job_id, v.bag_turu], [k2.jobId, 'kosu'], `${kk}: iptal edilemeyen kosunun kilidi durdur isine tasindi`);
  assert.equal(k2.kosu.durdur_awx_job_id, r.body.durdurIsi.jobId);

  // (e) On kontrol: durdur isi yok; 200, durdurIsi null; iptal edilemezse 424 (eskisi gibi).
  sifirla();
  senaryoEkle();
  const ok3 = await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  r = await istek('POST', `/kosular/${ok3.body.kosuId}/durdur`);
  assert.deepEqual([r.statusCode, r.body.durdurIsi, D.launch.length], [200, null, 1]);
  D.iptalHata = new Error('AWX kapali');
  r = await istek('POST', `/kosular/${ok3.body.kosuId}/durdur`);
  assert.deepEqual([r.statusCode, r.body.code], [424, 'awx_okunamadi']);
});

test('YKP15 baslatma yarisi: is numarasi yazilir; satir bu arada CANCELED olduysa is iptal edilir', { timeout: 20000 }, async () => {
  sifirla();
  senaryoEkle();
  const ok = await onKontrolHazirla();
  // Kosu AWX'e gonderilirken satir CANCELED oluyor (eski yarim satiri durduran baska bir istek gibi).
  D.launchKanca = async () => {
    const x = D.kosular.find((y) => y.islem === 'kosu' && y.durum === 'QUEUED');
    if (x) x.durum = 'CANCELED';
  };
  const r = await istek('POST', '/kosular', { body: { onKontrolKosuId: ok.id, confirmText: 'GBNGXT33' } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const kosu = D.kosular.find((x) => x.id === r.body.kosuId);
  assert.deepEqual([kosu.durum, kosu.awx_job_id], ['CANCELED', r.body.jobId], 'is numarasi yazilmadi ya da CANCELED ezildi');
  assert.deepEqual(D.iptal, [[3, r.body.jobId]], 'takipsiz kalan is iptal edilmedi');
  for (const [kk, v] of D.kilitler) assert.deepEqual([v.held, v.awx_job_id, v.bag_turu], [1, r.body.jobId, 'kosu'], kk);
  // Bayat kuyruk (FAILED) da ayni: is takipsiz kalmasin.
  sifirla();
  senaryoEkle();
  const ok2 = await onKontrolHazirla();
  D.launchKanca = async () => {
    const x = D.kosular.find((y) => y.islem === 'kosu' && y.durum === 'QUEUED');
    if (x) x.durum = 'FAILED';
  };
  const r2 = await istek('POST', '/kosular', { body: { onKontrolKosuId: ok2.id, confirmText: 'GBNGXT33' } });
  assert.deepEqual(D.iptal, [[3, r2.body.jobId]]);
  // Normal yol: RUNNING, iptal YOK; kilit_id satira yazildi ve kilitlerin lock_id'si.
  sifirla();
  senaryoEkle();
  const k = await kosuBaslat();
  assert.deepEqual([k.kosu.durum, D.iptal.length], ['RUNNING', 0]);
  assert.ok(k.kosu.kilit_id, 'kilit_id yazilmadi');
  for (const [kk, v] of D.kilitler) assert.deepEqual([v.lock_id, v.bag_turu], [k.kosu.kilit_id, 'kosu'], kk);
  // On kontrolun kilidi 'on_kontrol' turuyle baglanir.
  sifirla();
  senaryoEkle();
  await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  for (const v of D.kilitler.values()) assert.equal(v.bag_turu, 'on_kontrol');
});

test('YKP16 /yeniden-oku: yalniz sonucu okunamamis is numarali kosu; sayac sifirlanir', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  const satir = (id, ek) => ({ id, islem: 'kosu', awx_server_id: 3, awx_job_id: 70 + id, hedef_host: 'GBNGXT33', hedef_ip: '10.0.0.9', created_at: new Date(BAS), senaryo_id: 1, sonuclandirma_denemesi: 4, ...ek });
  D.kosular.push(
    satir(1, { durum: 'OKUNAMADI', gecerlilik: 'OKUNAMADI' }),
    satir(2, { durum: 'FAILED', gecerlilik: 'OKUNAMADI' }),
    satir(3, { durum: 'DONE', gecerlilik: 'GECERLI' }),
    satir(4, { islem: 'on_kontrol', durum: 'OKUNAMADI', gecerlilik: null }),
    satir(5, { durum: 'OKUNAMADI', gecerlilik: 'OKUNAMADI', awx_job_id: null }),
    satir(6, { durum: 'FAILED', gecerlilik: 'KISMI' }),
  );
  let r = await istek('POST', '/kosular/1/yeniden-oku');
  assert.deepEqual([r.statusCode, r.body], [200, { ok: true }]);
  assert.deepEqual([D.kosular[0].durum, D.kosular[0].sonuclandirma_denemesi], ['FINALIZING', 0]);
  await new Promise((s) => setImmediate(s));
  assert.deepEqual(D.tetiklenen, [1], 'poller tetiklenmedi');
  const d = D.denetim.find((x) => x.eylem === 'nginx_loadtest_yeniden_oku');
  assert.ok(d && d.targetHost === 'GBNGXT33' && d.targetIp === '10.0.0.9' && d.result !== 'fail', 'yeniden okuma denetime yazilmadi');
  r = await istek('POST', '/kosular/2/yeniden-oku');
  assert.equal(r.statusCode, 200, 'FAILED + gecerlilik OKUNAMADI yeniden okunamadi');
  for (const id of [3, 4, 5, 6, 99]) {
    r = await istek('POST', `/kosular/${id}/yeniden-oku`);
    assert.deepEqual([r.statusCode, r.body.code, r.body.message], [409, 'yeniden_okunamaz', 'Yalnız sonucu okunamamış koşular yeniden okunabilir.'], String(id));
  }
  assert.deepEqual(D.kosular.slice(2).map((x) => x.durum), ['DONE', 'OKUNAMADI', 'OKUNAMADI', 'FAILED'], 'reddedilen satir degisti');
  assert.ok(D.denetim.some((x) => x.eylem === 'nginx_loadtest_yeniden_oku' && x.result === 'fail'), 'ret denetime yazilmadi');
  assert.equal((await istek('POST', '/kosular/abc/yeniden-oku')).statusCode, 400);
});

test('YKP17 /kosular: islem / durum / hedef suzgeci, onceki sayfalama, dahaVar, gecersiz deger 400', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  for (let i = 1; i <= 7; i += 1) {
    D.kosular.push({ id: i, islem: i % 2 ? 'kosu' : 'on_kontrol', durum: i <= 4 ? 'DONE' : 'FAILED', hedef_host: i === 7 ? 'GBNGXT40' : 'GBNGXT33', created_at: new Date(BAS), senaryo_id: 1 });
  }
  const ids = (b) => b.kosular.map((x) => x.id);
  let r = await istek('GET', '/kosular');
  assert.deepEqual([ids(r.body), r.body.dahaVar], [[7, 6, 5, 4, 3, 2, 1], false]);
  r = await istek('GET', '/kosular?islem=kosu&durum=DONE&limit=200');
  assert.deepEqual([ids(r.body), r.body.dahaVar], [[3, 1], false]);
  r = await istek('GET', '/kosular?limit=2');
  assert.deepEqual([ids(r.body), r.body.dahaVar], [[7, 6], true]);
  r = await istek('GET', '/kosular?limit=2&onceki=6');
  assert.deepEqual([ids(r.body), r.body.dahaVar], [[5, 4], true]);
  r = await istek('GET', '/kosular?limit=2&onceki=3');
  assert.deepEqual([ids(r.body), r.body.dahaVar], [[2, 1], false]);
  r = await istek('GET', '/kosular?hedef=gbngxt40&islem=kosu');
  assert.deepEqual(ids(r.body), [7]);
  r = await istek('GET', '/kosular?durum=FAILED&onceki=7');
  assert.deepEqual(ids(r.body), [6, 5]);
  // Degerler SQL metnine gomulmez; TOP limit + 1 (fazlasi dahaVar).
  const son = D.sorgular.filter((s) => /^SELECT TOP \(\$1\)/.test(s.q)).at(-1);
  assert.doesNotMatch(son.q, /FAILED|'7'|\b7\b/, 'suzgec degeri SQL metnine gomuldu');
  assert.deepEqual(son.params, [51, 'FAILED', 7]);
  for (const bozuk of ['islem=x', 'islem=KOSU', 'durum=done', 'durum=BITTI', 'limit=0', 'limit=201', 'limit=abc', 'limit=-1', 'onceki=0', 'onceki=abc', 'onceki=-3', 'hedef=GB%20NG']) {
    r = await istek('GET', `/kosular?${bozuk}`);
    assert.deepEqual([r.statusCode, r.body.code], [400, 'gecersiz_istek'], bozuk);
  }
  // Tekrarlanan parametre (dizi) de gecersiz: sessizce ilkini almaz. Tek elemanli dizi metne
  // cevrilince gecerli bir ada donusurdu (String(['X']) === 'X'): tur denetimi bunu da reddeder.
  for (const query of [{ islem: ['kosu', 'on_kontrol'] }, { hedef: ['GBNGXT33'] }, { onceki: ['3'] }]) {
    r = await istek('GET', '/kosular', { query });
    assert.deepEqual([r.statusCode, r.body.code], [400, 'gecersiz_istek'], JSON.stringify(query));
  }
  // Admin olmayan da suzer (salt okunur uc).
  r = await istek('GET', '/kosular?islem=kosu', { session: KULLANICI });
  assert.deepEqual(ids(r.body), [7, 5, 3, 1]);
});

test('YKP18 kosu ayrintisi yeni alanlar; olculmus limit 0 hedefi kapatir', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  const r0 = await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  let g = await istek('GET', `/kosular/${r0.body.kosuId}`);
  assert.deepEqual([g.body.kosu.durdurIsi, g.body.kosu.sonuclandirmaDenemesi], [null, 0]);
  D.kosular[0].sonuclandirma_denemesi = 2;
  g = await istek('GET', `/kosular/${r0.body.kosuId}`);
  assert.equal(g.body.kosu.sonuclandirmaDenemesi, 2);
  assert.ok(!JSON.stringify(g.body).includes(D.kosular[0].kilit_id), 'kilit kimligi ekrana sizdi');
  // 1 r/s zone: tavan 0 -> hedef /hedefler'de kapali (ayni metin), baslatma 409.
  sifirla();
  senaryoEkle();
  D.ayarlar = [
    { host: 'GBNGXT33', directive: 'limit_req_zone', value: '$binary_remote_addr zone=login:10m rate=1r/s' },
    { host: 'GBNGXT33', directive: 'limit_req', value: 'zone=login burst=5' },
  ];
  const h = await istek('GET', '/hedefler');
  const t33 = h.body.hedefler.find((x) => x.host === 'GBNGXT33');
  assert.deepEqual([t33.uygun, t33.kod, t33.neden, t33.hizSiniri], [false, 'sinir_asildi', dg.SIFIR_SINIR_MESAJI, 0]);
  assert.ok(t33.ipler.length > 0, 'IP yoklugu limit nedenini maskeledi');
  const r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE({ parametreler: { hizlar: [1], maxvu: 10 } }) });
  assert.deepEqual([r.statusCode, r.body.code, r.body.message], [409, 'sinir_asildi', dg.SIFIR_SINIR_MESAJI]);
  assert.equal(D.launch.length, 0);
});

test('YKP19 bayat kilit: baslatma yolu AWX durumunu iletir; kural bag turune gore birakir / tutar', { timeout: 10000 }, async () => {
  // Biten (successful) on kontrolun kilidi supurme gelmeden dolu: yeni on kontrol devralir.
  sifirla();
  senaryoEkle();
  const r1 = await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  assert.equal(r1.statusCode, 200);
  D.awxDurum = { ...D.awxDurum, status: 'successful' };
  const r2 = await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  assert.equal(r2.statusCode, 200, JSON.stringify(r2.body));
  assert.ok(D.statusCagri.some(([sid, jid]) => sid === 3 && jid === r1.body.jobId), 'bayat kilidin isi AWX\'e sorulmadi');
  // Iptal edilen KOSU isinin kilidi: uzak k6 surebilir -> 409 kilit_dolu; TUM kilitler isten cozulur.
  sifirla();
  senaryoEkle();
  const k = await kosuBaslat();
  D.awxDurum = { ...D.awxDurum, status: 'canceled' };
  const r3 = await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  assert.deepEqual([r3.statusCode, r3.body.code], [409, 'kilit_dolu'], JSON.stringify(r3.body));
  for (const [kk, v] of D.kilitler) assert.deepEqual([v.held, v.lock_id, v.awx_job_id, v.bag_turu], [1, k.kosu.kilit_id, null, null], kk);
});

// ── TUR 3 (2026-10-28) ─────────────────────────────────────────────────────────────────────

const RP_UYARISI = () => dg.YUK_MAKINESI_RP_UYARISI('GBNGXT34');
const tutulan = () => [...D.kilitler.entries()].filter(([, v]) => v.held).map(([k]) => k).sort();

test('YKP20 serbest on kontrol uctan uca: siniflandirma, satir, extra_vars, G + T|IP + L', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  process.env.NGINX_LOADTEST_SERBEST_AGLAR = SERBEST_AG;
  const r = await istek('POST', '/kosular/on-kontrol', { body: SGOVDE() });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const k = D.kosular.find((x) => x.id === r.body.kosuId);
  assert.deepEqual([k.hedef_turu, k.hedef_host, k.hedef_ip, k.motor, k.islem, k.vhost], ['serbest', '', SERBEST_IP, 'k6', 'on_kontrol', 'app.test.local']);
  // GBNGXT34 internet RP: serbest plan uyarisi satirda (onay isteyecek).
  assert.deepEqual(JSON.parse(k.plan_uyarilari), [RP_UYARISI()]);
  assert.deepEqual(JSON.parse(k.parametreler), { motor: 'k6', hizlar: [50, 100, 200], tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, maxvu: 50, kip: 'yeni', ae: 'br', sni: false, butceSn: 1380 });
  const ev = D.launch[0][2];
  assert.deepEqual([ev.yuk_hedef_turu, ev.yuk_hedef_host, ev.yuk_hedef_ip, ev.yuk_motor, ev.yuk_hizlar, ev.yuk_maxvu, ev.yuk_islem], ['serbest', '', SERBEST_IP, 'k6', '50 100 200', '50', 'on_kontrol']);
  assert.deepEqual(dg.ekstraDegiskenleriDenetle(ev), []);
  // Serbest on kontrol G de alir (VIP arkasindaki hostun olcum penceresine girmesin); T anahtari IP.
  assert.deepEqual(tutulan(), ['G|global', 'L|GBNGXT34', `T|IP:${SERBEST_IP}`]);
  for (const v of D.kilitler.values()) assert.deepEqual([v.held, v.awx_job_id, v.bag_turu], [1, 900, 'on_kontrol']);
  const d = D.denetim.find((x) => x.eylem === 'nginx_loadtest_on_kontrol');
  assert.deepEqual([d.targetHost, d.targetIp], [null, SERBEST_IP]);
  const det = JSON.parse(d.detail);
  assert.deepEqual([det.hedefTuru, det.motor, det.serbestAg, det.vhostListede, det.planUyarilari], ['serbest', 'k6', SERBEST_AG, null, [RP_UYARISI()]]);
  assert.equal(D.gecmis[0][3], `Nginx Yük Testi: ön kontrol R${k.id} ${SERBEST_IP}`);
  // Ikinci serbest on kontrol global kilitte durur; mesaj isi soyler.
  const r2 = await istek('POST', '/kosular/on-kontrol', { body: SGOVDE() });
  assert.deepEqual([r2.statusCode, r2.body.code], [409, 'kilit_dolu']);
  assert.match(r2.body.message, /^Başka bir yük testi koşuyor \(onur: ön kontrol 10\.20\.30\.40 \(serbest\) <- GBNGXT34, AWX iş #900\)/);
  // Ayrinti: tur, motor, hedefHost null, izinli ag (env'den su an).
  const g = await istek('GET', `/kosular/${k.id}`);
  assert.deepEqual([g.body.kosu.hedefTuru, g.body.kosu.motor, g.body.kosu.hedefHost, g.body.kosu.serbestAg, g.body.kosu.planUyarilari], ['serbest', 'k6', null, SERBEST_AG, [RP_UYARISI()]]);
});

test('YKP21 serbest kosu: onay metni hedef IP, serbest uyarisi onay ister, sinif degisince on_kontrol_eski', { timeout: 20000 }, async () => {
  const hazirla = async () => {
    sifirla();
    senaryoEkle();
    process.env.NGINX_LOADTEST_SERBEST_AGLAR = SERBEST_AG;
    return onKontrolHazirla({ govde: SGOVDE(), ozet: OK_OZET_SERBEST });
  };
  const kos = (ok, ek) => istek('POST', '/kosular', { body: { onKontrolKosuId: ok.id, ...ek } });
  let ok = await hazirla();
  let r = await kos(ok, { confirmText: 'GBNGXT33', uyariOnay: true });
  assert.deepEqual([r.statusCode, r.body.code, r.body.message], [409, 'onay_metni', "Onay için hedef IP'yi (10.20.30.40) birebir yazın."]);
  r = await kos(ok, { confirmText: '', uyariOnay: true });
  assert.equal(r.body.code, 'onay_metni', 'bos onay metni serbestte kabul edildi');
  // Plan uyarisi + sabit SERBEST uyarisi: ikisi de acik onay ister (ekranla ayni liste).
  r = await kos(ok, { confirmText: SERBEST_IP });
  assert.deepEqual([r.statusCode, r.body.code, r.body.uyarilar], [409, 'uyari_onayi', [RP_UYARISI(), dg.SERBEST_UYARISI]]);
  assert.equal(D.launch.length, 1, 'onaysiz kosu baslatildi');
  r = await kos(ok, { confirmText: ` ${SERBEST_IP} `, uyariOnay: true });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const kosu = D.kosular.find((x) => x.id === r.body.kosuId);
  assert.deepEqual([kosu.hedef_turu, kosu.hedef_host, kosu.motor, kosu.islem, kosu.on_kontrol_kosu_id], ['serbest', '', 'k6', 'kosu', ok.id]);
  const ev = D.launch.at(-1)[2];
  assert.deepEqual([ev.yuk_islem, ev.yuk_hedef_turu, ev.yuk_hedef_host, ev.yuk_hedef_ip], ['kosu', 'serbest', '', SERBEST_IP]);
  assert.deepEqual(tutulan(), ['G|global', 'L|GBNGXT34', `T|IP:${SERBEST_IP}`]);
  const d = D.denetim.find((x) => x.eylem === 'nginx_loadtest_baslat' && x.result !== 'fail');
  assert.deepEqual([d.targetHost, d.targetIp], [null, SERBEST_IP]);
  assert.deepEqual(JSON.parse(d.detail).onaylananUyarilar, [RP_UYARISI(), dg.SERBEST_UYARISI]);
  assert.ok(D.denetim.some((x) => x.eylem === 'nginx_loadtest_baslat' && x.result === 'fail' && JSON.parse(x.detail).code === 'onay_metni'), 'onay metni reddi denetime yazilmadi');
  // Sinif degisti: IP artik bir nginx sunucusunun (son tarama) -> on_kontrol_eski, kosu yok.
  ok = await hazirla();
  D.tarama.push({ host: 'GBNGXT33', listen: `${SERBEST_IP}:443 ssl`, server_name: 'app.test.local' });
  r = await kos(ok, { confirmText: SERBEST_IP, uyariOnay: true });
  assert.deepEqual([r.statusCode, r.body.code, r.body.message], [409, 'on_kontrol_eski', "Hedef IP'nin sınıfı ön kontrolden bu yana değişti; ön kontrolü yeniden çalıştırın."]);
  assert.equal(D.launch.length, 1, 'sinifi degisen kosu baslatildi');
  // Serbest izin listesi kapandi: kosu kapisi yeniden siniflandirir -> serbest_kapali.
  ok = await hazirla();
  delete process.env.NGINX_LOADTEST_SERBEST_AGLAR;
  r = await kos(ok, { confirmText: SERBEST_IP, uyariOnay: true });
  assert.deepEqual([r.statusCode, r.body.code], [409, 'serbest_kapali']);
  // Serbestte engel: IP yuk makinesinde yerel ya da olculemedi (hedef kurallari yok).
  ok = await hazirla();
  Object.assign(ok, { on_kontrol_ozet: JSON.stringify({ ...OK_OZET_SERBEST, ip_yuk_makinesinde: null }) });
  r = await kos(ok, { confirmText: SERBEST_IP, uyariOnay: true });
  assert.deepEqual([r.statusCode, r.body.code, r.body.engeller], [409, 'on_kontrol_eski', ['hedef IP yük makinesinde yerel ya da ölçülemedi']]);
});

test('YKP22 elle yazilan IP: siniflar uctan uca, ret denetime yazilir, AWX\'e gitmez', { timeout: 30000 }, async () => {
  const AGLAR = () => { process.env.NGINX_LOADTEST_SERBEST_AGLAR = SERBEST_AG; };
  const durumlar = [
    ['tek nginx sahibi -> sunucu', () => {}, '10.0.0.9', null, 200, null],
    ['iki nginx sahibi', () => { D.tarama.push({ host: 'GBNGXT35', listen: '10.0.0.9:443', server_name: 'x.test.local' }); }, '10.0.0.9', null, 409, 'ip_belirsiz'],
    ['adi cozulemeyen sahip', () => { D.ipEnvanteri.push({ host: '', ip: '10.0.0.9' }); }, '10.0.0.9', null, 409, 'ip_sahibi_cozulemedi'],
    ['adi cozulemeyen sahip (host secici)', () => { D.ipEnvanteri.push({ host: '', ip: '10.0.0.9' }); }, '10.0.0.9', 'GBNGXT33', 409, 'ip_sahibi_cozulemedi'],
    ['PROD nginx sahibi', () => {}, '10.9.0.1', null, 409, 'hedef_uretim'],
    ['nginx olmayan PROD sahip (izinli agda)', () => { AGLAR(); D.invIp.push({ host: 'GBDBP01', env: 'Production', ip: '10.20.30.50' }); }, '10.20.30.50', null, 409, 'hedef_uretim'],
    ['yuk makinesinin IP\'si', () => {}, '10.0.0.6', null, 409, 'ayni_host'],
    ['sahipsiz, serbest kapali', () => {}, SERBEST_IP, null, 409, 'serbest_kapali'],
    ['izinli agda degil', () => { process.env.NGINX_LOADTEST_SERBEST_AGLAR = '10.20.31.0/24'; }, SERBEST_IP, null, 409, 'ip_izinli_agda_degil'],
    ['yasakli agda', () => { AGLAR(); process.env.NGINX_LOADTEST_SERBEST_YASAK = '10.20.30.32/27'; }, SERBEST_IP, null, 409, 'ip_yasakli_agda'],
    ['yasak listesi gecersiz (sunucu IP\'si de kapanir)', () => { process.env.NGINX_LOADTEST_SERBEST_YASAK = 'YKP22-bozuk'; }, '10.0.0.9', null, 409, 'ip_yasak_listesi_gecersiz'],
    ['envanter bayat', () => { AGLAR(); D.ipEnvYasSaat = 72; }, SERBEST_IP, null, 424, 'envanter_bayat'],
    ['IPInventory yok', () => { AGLAR(); D.ipEnvanteri = null; }, SERBEST_IP, null, 424, 'envanter_okunamadi'],
    ['IP yalniz IPInventory\'de (aday listesinde degil)', () => { D.ipEnvanteri.push({ host: 'GBNGXT33', ip: '10.0.0.88' }); }, '10.0.0.88', null, 409, 'ip_hedefte_yok'],
  ];
  for (const [ad, hazirla, ip, hedefHost, http, kod] of durumlar) {
    sifirla();
    senaryoEkle();
    hazirla();
    const r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE({ hedefHost, hedefIp: ip }) });
    assert.deepEqual([r.statusCode, r.body.code], [http, kod || undefined], `${ad}: ${JSON.stringify(r.body)}`);
    if (http === 200) {
      const k = D.kosular.find((x) => x.id === r.body.kosuId);
      assert.deepEqual([k.hedef_turu, k.hedef_host, D.launch[0][2].yuk_hedef_host, D.launch[0][2].yuk_hedef_turu], ['sunucu', 'GBNGXT33', 'GBNGXT33', 'sunucu'], ad);
      assert.deepEqual(tutulan(), ['L|GBNGXT34', 'T|GBNGXT33'], ad);
      continue;
    }
    assert.equal(D.launch.length, 0, `${ad}: AWX isi baslatildi`);
    assert.equal(D.kosular.length, 0, `${ad}: kosu satiri yazildi`);
    assert.deepEqual(tutulan(), [], `${ad}: kilit tutulu kaldi`);
    const d = D.denetim.find((x) => x.eylem === 'nginx_loadtest_on_kontrol');
    assert.ok(d && d.result === 'fail' && JSON.parse(d.detail).code === kod, `${ad}: ret denetime yazilmadi`);
    assert.deepEqual([d.targetHost, d.targetIp], [hedefHost, ip], ad);
    // Sahipler (sozlesme 8.2 adim 5'ten sonra bilinir) govdeye kopyalanir; sahiplik oncesi retlerde
    // ve aday IP savunmasinda (siniflandirma gecti) yok.
    if (!['ip_sahibi_cozulemedi', 'ip_yasakli_agda', 'ip_yasak_listesi_gecersiz', 'ip_hedefte_yok'].includes(kod)) assert.ok(Array.isArray(r.body.sahipler), `${ad}: sahipler govdede yok`);
  }
  // Savunma metni (tur 2 ile ayni aday listeli metin).
  sifirla();
  senaryoEkle();
  D.ipEnvanteri.push({ host: 'GBNGXT33', ip: '10.0.0.88' });
  const r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE({ hedefHost: null, hedefIp: '10.0.0.88' }) });
  assert.equal(r.body.message, "10.0.0.88, GBNGXT33 için bilinen IP'lerden değil (10.0.0.5, 10.0.0.9).");
  // hedefHost istege bagli: undefined / null / '' -> elle IP; verilmis ama gecersiz -> 400.
  for (const hedefHost of [undefined, '']) {
    sifirla();
    senaryoEkle();
    const x = await istek('POST', '/kosular/on-kontrol', { body: GOVDE({ hedefHost }) });
    assert.equal(x.statusCode, 200, `${JSON.stringify(hedefHost)}: ${JSON.stringify(x.body)}`);
  }
  for (const hedefHost of ['GB NG', '  ', 5, 'GBNGXT33;rm']) {
    sifirla();
    senaryoEkle();
    const x = await istek('POST', '/kosular/on-kontrol', { body: GOVDE({ hedefHost }) });
    assert.deepEqual([x.statusCode, x.body.code, x.body.message], [400, 'gecersiz_istek', 'Geçersiz hedef sunucu adı.'], JSON.stringify(hedefHost));
  }
});

test('YKP23 wrk on kontrol: extra_vars bolum 3, tavan sunucuda hesaplanir, wrk + SNI 400', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  // Gonderilen tavan_rps / hizlar yok sayilir: tavan hedefin olculmus limit_req'inin %90'i (300 r/s -> 270).
  let r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE({ parametreler: { motor: 'wrk', tavan_rps: 450, hizlar: [999] } }) });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const k = D.kosular.find((x) => x.id === r.body.kosuId);
  assert.deepEqual([k.motor, k.hedef_turu], ['wrk', 'sunucu']);
  assert.deepEqual(JSON.parse(k.parametreler), { motor: 'wrk', baglantilar: [2, 4, 8], is_parcacigi: 2, tavan_rps: 270, tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, kip: 'yeni', ae: 'br', sni: false, butceSn: 1380 });
  const ev = D.launch[0][2];
  assert.deepEqual(
    [ev.yuk_motor, ev.yuk_hizlar, ev.yuk_maxvu, ev.yuk_baglantilar, ev.yuk_is_parcacigi, ev.yuk_tavan_rps, ev.yuk_sni, ev.yuk_wrk_yolu, ev.yuk_k6_yolu, ev.yuk_hedef_turu, ev.yuk_butce_sn],
    ['wrk', '', '', '2 4 8', '2', '270', '0', '/home/www/bin/wrk', '/home/www/bin/k6', 'sunucu', '1380'],
  );
  assert.deepEqual(dg.ekstraDegiskenleriDenetle(ev), []);
  // wrk yolu env'den.
  sifirla();
  senaryoEkle();
  process.env.NGINX_LOADTEST_WRK = '/opt/wrk/bin/wrk';
  r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE({ parametreler: { motor: 'wrk', baglantilar: [4, 8], is_parcacigi: 4 } }) });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual([D.launch[0][2].yuk_wrk_yolu, D.launch[0][2].yuk_baglantilar, D.launch[0][2].yuk_is_parcacigi], ['/opt/wrk/bin/wrk', '4 8', '4']);
  // wrk + SNI -> 400 (gizli donusum yok); N % T != 0 -> 409; ikisi de AWX'e gitmez.
  for (const [govde, http, kod, mesaj] of [
    [GOVDE({ sni: true, parametreler: { motor: 'wrk' } }), 400, 'gecersiz_istek', "wrk SNI'yi Host başlığına göre seçemez (IP adresi SNI olarak gider); SNI kutusunu kapatın."],
    [GOVDE({ parametreler: { motor: 'wrk', baglantilar: [3, 6], is_parcacigi: 2 } }), 409, 'sinir_asildi', 'Sınır aşıldı: bağlantı 3, iş parçacığı sayısına (2) tam bölünmüyor.'],
  ]) {
    sifirla();
    senaryoEkle();
    const x = await istek('POST', '/kosular/on-kontrol', { body: govde });
    assert.deepEqual([x.statusCode, x.body.code, x.body.message], [http, kod, mesaj]);
    assert.deepEqual([D.launch.length, D.kosular.length], [0, 0]);
  }
});

test('YKP24 /ip-sinifi: yalniz Admin, yanit sekilleri, uygun:false 200, host secici, DB / denetim yok', { timeout: 20000 }, async () => {
  sifirla();
  process.env.NGINX_LOADTEST_SERBEST_AGLAR = SERBEST_AG;
  // Admin olmayan: router 403 (uygulama duzeyinde nginxRedCevirici 409'a cevirir); envanter okunmaz.
  let r = await istek('GET', '/ip-sinifi?ip=10.0.0.9', { session: KULLANICI });
  assert.equal(r.statusCode, 403);
  assert.equal(D.envSorgular.length, 0, 'Admin olmayan icin envanter okundu');
  assert.ok(!yt._ADMIN_DISI_OKUMA.some((re) => re.test('/ip-sinifi')), '/ip-sinifi Admin olmayana acik');
  const kod = fs.readFileSync(IDX_YOL, 'utf8');
  const uc = kod.indexOf("router.get('/ip-sinifi'");
  assert.ok(uc > 0 && /adminSart\(req\)/.test(kod.slice(uc, uc + 200)), '/ip-sinifi isleyicide Admin denetlemiyor');
  // Sunucu: /hedefler satiriyla ayni alanlar + kaynaklar.
  r = await istek('GET', '/ip-sinifi?ip=10.0.0.9&yukHost=GBNGXT34');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, {
    ok: true, tur: 'sunucu', ip: '10.0.0.9', host: 'GBNGXT33', env: 'TEST', vhostlar: ['api.test.local', 'app.test.local'], vhostVerisi: true,
    hizSiniri: 270, vuSiniri: null, uygun: true, neden: null, kod: null, kaynaklar: ['dbo.IPInventory', 'tarama'],
  });
  // Serbest.
  r = await istek('GET', `/ip-sinifi?ip=${SERBEST_IP}&yukHost=GBNGXT34`);
  assert.deepEqual([r.statusCode, r.body], [200, { ok: true, tur: 'serbest', ip: SERBEST_IP, host: null, ag: SERBEST_AG, digerSahipler: [] }]);
  // uygun:false da 200: olculmus limit 0 ve aday listesinde olmayan IP.
  D.ayarlar = [
    { host: 'GBNGXT33', directive: 'limit_req_zone', value: '$binary_remote_addr zone=login:10m rate=1r/s' },
    { host: 'GBNGXT33', directive: 'limit_req', value: 'zone=login burst=5' },
  ];
  r = await istek('GET', '/ip-sinifi?ip=10.0.0.9');
  assert.deepEqual([r.statusCode, r.body.tur, r.body.uygun, r.body.kod, r.body.neden], [200, 'sunucu', false, 'sinir_asildi', dg.SIFIR_SINIR_MESAJI]);
  D.ayarlar = null;
  D.ipEnvanteri.push({ host: 'GBNGXT33', ip: '10.0.0.88' });
  r = await istek('GET', '/ip-sinifi?ip=10.0.0.88');
  assert.deepEqual([r.statusCode, r.body.uygun, r.body.kod, r.body.neden], [200, false, 'ip_hedefte_yok', "10.0.0.88, GBNGXT33 için bilinen IP'lerden değil (10.0.0.5, 10.0.0.9)."]);
  // Paylasilan VIP: hedefHost ile 200 sunucu; ayni IP hedefHost'suz 409 ip_belirsiz.
  D.nginxEk.push({ hostname: 'GBNGXT35', env: 'test', ip: '10.0.0.7' });
  D.tarama.push({ host: 'GBNGXT33', listen: '10.0.0.100:443 ssl', server_name: 'vip.test.local' }, { host: 'GBNGXT35', listen: '10.0.0.100:443 ssl', server_name: 'vip.test.local' });
  r = await istek('GET', '/ip-sinifi?ip=10.0.0.100&hedefHost=GBNGXT33&yukHost=GBNGXT34');
  assert.deepEqual([r.statusCode, r.body.tur, r.body.host, r.body.uygun, r.body.kaynaklar], [200, 'sunucu', 'GBNGXT33', true, ['tarama']], JSON.stringify(r.body));
  r = await istek('GET', '/ip-sinifi?ip=10.0.0.100&yukHost=GBNGXT34');
  assert.deepEqual([r.statusCode, r.body.code, r.body.message], [409, 'ip_belirsiz', '10.0.0.100 birden çok nginx sunucusunda tanımlı (GBNGXT33, GBNGXT35); hedef sunucuyu listeden seçin.']);
  assert.deepEqual(r.body.sahipler.map((s) => s.host), ['GBNGXT33', 'GBNGXT35']);
  // hedefHost + adi cozulemeyen sahip -> 409 ip_sahibi_cozulemedi (host secici de fail-closed).
  D.ipEnvanteri.push({ host: '', ip: '10.0.0.100' });
  r = await istek('GET', '/ip-sinifi?ip=10.0.0.100&hedefHost=GBNGXT33');
  assert.deepEqual([r.statusCode, r.body.code], [409, 'ip_sahibi_cozulemedi']);
  // hedefHost IP'nin sahibi degil -> tur 2 aday listeli metin; hedefHost uretim -> hedef kapisi.
  r = await istek('GET', '/ip-sinifi?ip=10.0.0.9&hedefHost=GBNGXT34');
  assert.deepEqual([r.statusCode, r.body.code, r.body.message], [409, 'ip_hedefte_yok', "10.0.0.9, GBNGXT34 için bilinen IP'lerden değil (10.0.0.6)."]);
  r = await istek('GET', '/ip-sinifi?ip=10.9.0.1&hedefHost=GBNGXP40');
  assert.deepEqual([r.statusCode, r.body.code], [409, 'hedef_uretim']);
  // yukHost verilmezse ayni_host denetimi atlanir; verilirse uygulanir.
  assert.equal((await istek('GET', '/ip-sinifi?ip=10.0.0.6')).body.host, 'GBNGXT34');
  assert.equal((await istek('GET', '/ip-sinifi?ip=10.0.0.6&yukHost=GBNGXT34')).body.code, 'ayni_host');
  // Gecersiz girdi 400.
  for (const u of ['/ip-sinifi', '/ip-sinifi?ip=10.0.0', '/ip-sinifi?ip=evil.com', '/ip-sinifi?ip=10.0.0.9&hedefHost=GB%20NG', '/ip-sinifi?ip=10.0.0.9&yukHost=..']) {
    r = await istek('GET', u);
    assert.deepEqual([r.statusCode, r.body.code], [400, 'gecersiz_istek'], u);
  }
  r = await istek('GET', '/ip-sinifi', { query: { ip: ['10.0.0.9'] } });
  assert.equal(r.statusCode, 400);
  // Portal DB'ye, denetime, AWX'e hic dokunulmadi.
  assert.equal(D.sorgular.length, 0, '/ip-sinifi Portal DB\'ye dokundu');
  assert.equal(D.denetim.length, 0, '/ip-sinifi denetime yazdi');
  assert.equal(D.launch.length, 0);
});

test('YKP25 /kosular: ip / hedefTuru / motor suzgecleri, 400, kosuApi alanlari', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  D.kosular.push(
    { id: 1, islem: 'kosu', durum: 'DONE', hedef_host: 'GBNGXT33', hedef_ip: '10.0.0.9', created_at: new Date(BAS), senaryo_id: 1 },
    { id: 2, islem: 'kosu', durum: 'DONE', hedef_host: '', hedef_ip: SERBEST_IP, hedef_turu: 'serbest', motor: 'wrk', created_at: new Date(BAS), senaryo_id: 1 },
    { id: 3, islem: 'on_kontrol', durum: 'DONE', hedef_host: 'GBNGXT33', hedef_ip: '10.0.0.9', hedef_turu: 'sunucu', motor: 'wrk', created_at: new Date(BAS), senaryo_id: 1 },
    { id: 4, islem: 'kosu', durum: 'FAILED', hedef_host: '', hedef_ip: '10.20.30.41', hedef_turu: 'serbest', motor: 'k6', created_at: new Date(BAS), senaryo_id: 1 },
  );
  const ids = (b) => b.kosular.map((x) => x.id);
  let r = await istek('GET', '/kosular');
  const k = Object.fromEntries(r.body.kosular.map((x) => [x.id, x]));
  // Eski satir (kolonsuz) sunucu / k6; serbest satirin hedefHost'u null (DB'de '').
  assert.deepEqual([k[1].hedefTuru, k[1].motor, k[1].hedefHost], ['sunucu', 'k6', 'GBNGXT33']);
  assert.deepEqual([k[2].hedefTuru, k[2].motor, k[2].hedefHost, k[2].hedefIp], ['serbest', 'wrk', null, SERBEST_IP]);
  assert.deepEqual(ids((await istek('GET', `/kosular?ip=${SERBEST_IP}`)).body), [2]);
  assert.deepEqual(ids((await istek('GET', '/kosular?hedefTuru=serbest')).body), [4, 2]);
  assert.deepEqual(ids((await istek('GET', '/kosular?motor=wrk')).body), [3, 2]);
  assert.deepEqual(ids((await istek('GET', '/kosular?hedefTuru=serbest&motor=k6&islem=kosu')).body), [4]);
  assert.deepEqual(ids((await istek('GET', '/kosular?ip=10.0.0.9&hedefTuru=sunucu', { session: KULLANICI })).body), [3]);
  const son = D.sorgular.filter((s) => /^SELECT TOP \(\$1\)/.test(s.q)).at(-1);
  assert.doesNotMatch(son.q, /10\.0\.0\.9|sunucu'/, 'suzgec degeri SQL metnine gomuldu');
  assert.match(son.q, /k\.hedef_turu, k\.motor, s\.ad AS senaryo_ad/, 'liste kolonlarinda tur / motor yok');
  for (const bozuk of ['ip=10.0.0', 'ip=evil.com', 'ip=10.0.0.9%20', 'hedefTuru=lb', 'hedefTuru=SUNUCU', 'motor=K6', 'motor=wrk2']) {
    r = await istek('GET', `/kosular?${bozuk}`);
    assert.deepEqual([r.statusCode, r.body.code], [400, 'gecersiz_istek'], bozuk);
  }
  for (const query of [{ ip: ['10.0.0.9'] }, { hedefTuru: ['serbest'] }, { motor: ['wrk', 'k6'] }]) {
    r = await istek('GET', '/kosular', { query });
    assert.deepEqual([r.statusCode, r.body.code], [400, 'gecersiz_istek'], JSON.stringify(query));
  }
});

test('YKP26 serbest / wrk durdur: extra_vars satirdan, 424 metni motor ve ture gore', { timeout: 20000 }, async () => {
  const satir = (id, ek) => ({
    id, islem: 'kosu', durum: 'RUNNING', senaryo_id: 1, hedef_host: 'GBNGXT33', hedef_ip: '10.0.0.9', vhost: 'app.test.local', yuk_host: 'GBNGXT34',
    awx_server_id: 3, awx_job_id: 800 + id, created_at: new Date(D.simdi - 600000), kilit_id: `kilit-${id}`, ...ek,
  });
  const pws = JSON.stringify(dg.parametreler({ motor: 'wrk' }, { sni: false, hedefTuru: 'serbest' }).deger);
  sifirla();
  senaryoEkle();
  D.kosular.push(satir(1, { hedef_host: '', hedef_ip: SERBEST_IP, hedef_turu: 'serbest', motor: 'wrk', parametreler: pws }));
  let r = await istek('POST', '/kosular/1/durdur');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const ev = D.launch.at(-1)[2];
  assert.deepEqual([ev.yuk_islem, ev.yuk_hedef_turu, ev.yuk_hedef_host, ev.yuk_hedef_ip, ev.yuk_motor, ev.yuk_baglantilar, ev.yuk_tavan_rps], ['durdur', 'serbest', '', SERBEST_IP, 'wrk', '2 4 8', '200']);
  assert.deepEqual(dg.ekstraDegiskenleriDenetle(ev), []);
  assert.equal(D.gecmis.at(-1)[3], `Nginx Yük Testi: durdur R1 ${SERBEST_IP}`);
  assert.ok(D.denetim.some((x) => x.eylem === 'nginx_loadtest_durdur' && x.targetHost === null && x.targetIp === SERBEST_IP), 'serbest durdur denetimi');
  const metin = async (ek) => {
    sifirla();
    senaryoEkle();
    D.kosular.push(satir(2, ek));
    D.launchHata = Object.assign(new Error('AWX 503'), { status: 503 });
    const x = await istek('POST', '/kosular/2/durdur');
    assert.deepEqual([x.statusCode, x.body.code], [424, 'durdur_baslatilamadi'], JSON.stringify(x.body));
    return x.body.message;
  };
  const bas = 'AWX işi iptal edildi, ancak durdurma işi başlatılamadı: AWX işi başlatılamadı: AWX 503. ';
  const son = " sürüyor olabilir; Durdur'u yeniden deneyin. Kilitler koşunun süre sınırına kadar tutulur.";
  assert.equal(await metin({ hedef_turu: 'serbest', motor: 'wrk', hedef_host: '', hedef_ip: SERBEST_IP, parametreler: pws }), `${bas}Uzaktaki wrk${son}`);
  assert.equal(await metin({ hedef_turu: 'sunucu', motor: 'wrk', parametreler: JSON.stringify(dg.parametreler({ motor: 'wrk' }, { sni: false }).deger) }), `${bas}Uzaktaki wrk / kaydedici${son}`);
  assert.equal(await metin({ hedef_turu: 'serbest', motor: 'k6', hedef_host: '', hedef_ip: SERBEST_IP, parametreler: JSON.stringify(dg.parametreler({}, { sni: false, hedefTuru: 'serbest' }).deger) }), `${bas}Uzaktaki k6${son}`);
  // Eski satir (tur / motor kolonu ve parametreler.motor yok) -> k6 + sunucu: tur 2 metni BIREBIR.
  const eskiP = JSON.stringify({ hizlar: [100], tekrar: 1, isinma: 30, sure: 120, bosluk: 30, bosta: 60, maxvu: 150, kip: 'yeni', ae: 'br', sni: false, butceSn: 380 });
  assert.equal(await metin({ parametreler: eskiP }), "AWX işi iptal edildi, ancak durdurma işi başlatılamadı: AWX işi başlatılamadı: AWX 503. Uzaktaki k6 / kaydedici sürüyor olabilir; Durdur'u yeniden deneyin. Kilitler koşunun süre sınırına kadar tutulur.");
  // Eski satirin durdurma degiskenleri: sunucu / k6, son kapidan gecer (tur 2 sureMin oncesi satir da).
  sifirla();
  senaryoEkle();
  D.kosular.push(satir(3, { parametreler: JSON.stringify({ ...JSON.parse(eskiP), sure: 30 }) }));
  r = await istek('POST', '/kosular/3/durdur');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const ev3 = D.launch.at(-1)[2];
  assert.deepEqual([ev3.yuk_hedef_turu, ev3.yuk_motor, ev3.yuk_hedef_host, ev3.yuk_sure_sn], ['sunucu', 'k6', 'GBNGXT33', '30']);
});

test('YKP27 /karsilastir: kararVer\'e motor / hedef turu / is parcacigi, ozet alanlari', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  const pw = dg.parametreler({ motor: 'wrk', baglantilar: [2, 4] }, { sni: false, hedefTuru: 'serbest' }).deger;
  D.kosular.push(
    { id: 1, islem: 'kosu', durum: 'DONE', etiket: 'A', created_at: new Date(BAS), senaryo_id: 1, hedef_turu: 'serbest', motor: 'wrk', parametreler: JSON.stringify(pw) },
    { id: 2, islem: 'kosu', durum: 'DONE', etiket: 'B', created_at: new Date(BAS), senaryo_id: 1, parametreler: JSON.stringify({ hizlar: [100] }) },
  );
  const r = await istek('GET', '/karsilastir?ref=1&aday=2&esikP95=7');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(kararCagri.at(-1).s, {
    esikP95: 7, refMotor: 'wrk', adayMotor: 'k6', refHedefTuru: 'serbest', adayHedefTuru: 'sunucu', refIsParcacigi: 2, adayIsParcacigi: null,
    refTavanRps: 200, adayTavanRps: null,
  });
  assert.deepEqual([r.body.ref.motor, r.body.ref.hedefTuru, r.body.aday.motor, r.body.aday.hedefTuru], ['wrk', 'serbest', 'k6', 'sunucu']);
  // Motor kolonu yoksa parametreler.motor (liste kopyasi eksik eski satir icin).
  D.kosular[0].motor = undefined;
  await istek('GET', '/karsilastir?ref=1&aday=2');
  assert.equal(kararCagri.at(-1).s.refMotor, 'wrk');
  // Hiz tavani (wrk tavan_rps) iki satirin parametrelerinden: sunucu 450 (limit olculmedi) ile limit_req
  // 100 r/s olculmus hedefin 90'i. Farkli tavan analizde VERI_YOK (analiz AN16).
  const p450 = dg.parametreler({ motor: 'wrk' }, { sni: false }).deger;
  const p90 = dg.parametreler({ motor: 'wrk' }, { sni: false, hizSiniri: 90 }).deger;
  assert.deepEqual([p450.tavan_rps, p90.tavan_rps], [450, 90], 'fikstur: tavanlar');
  D.kosular.push(
    { id: 3, islem: 'kosu', durum: 'DONE', etiket: 'C', created_at: new Date(BAS), senaryo_id: 1, hedef_turu: 'sunucu', motor: 'wrk', parametreler: JSON.stringify(p450) },
    { id: 4, islem: 'kosu', durum: 'DONE', etiket: 'D', created_at: new Date(BAS), senaryo_id: 1, hedef_turu: 'sunucu', motor: 'wrk', parametreler: JSON.stringify(p90) },
  );
  assert.equal((await istek('GET', '/karsilastir?ref=3&aday=4')).statusCode, 200);
  assert.deepEqual([kararCagri.at(-1).s.refTavanRps, kararCagri.at(-1).s.adayTavanRps, kararCagri.at(-1).s.refIsParcacigi], [450, 90, 2]);
});

test('YKP28 /hedefler: serbest (aglar yalniz Admin), motorlar, sinirlar ve varsayilanlar', { timeout: 10000 }, async () => {
  sifirla();
  process.env.NGINX_LOADTEST_SERBEST_AGLAR = '10.20.30.0/24, 10.20.31.15';
  let r = await istek('GET', '/hedefler');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.serbest, { acik: true, aglar: ['10.20.30.0/24', '10.20.31.15/32'] });
  assert.deepEqual(r.body.motorlar, ['k6', 'wrk']);
  for (const [a, v] of Object.entries({ baglantiMin: 1, maxBaglanti: 199, maxBaglantiSayisi: 5, isParcacigiMin: 1, maxIsParcacigi: 16, serbestTavanRps: 200, serbestMaxBaglanti: 50, maxHiz: 450 })) {
    assert.equal(r.body.sinirlar[a], v, a);
  }
  assert.deepEqual([r.body.varsayilan.motor, r.body.varsayilan.baglantilar, r.body.varsayilan.is_parcacigi, r.body.varsayilan.serbest, r.body.varsayilan.hizlar], ['k6', [2, 4, 8], 2, { hizlar: [50, 100, 200], maxvu: 50 }, [100, 250, 400]]);
  // Admin olmayan acik / kapali bilgisini gorur, aglari gormez.
  r = await istek('GET', '/hedefler', { session: KULLANICI });
  assert.deepEqual(r.body.serbest, { acik: true, aglar: [] });
  delete process.env.NGINX_LOADTEST_SERBEST_AGLAR;
  r = await istek('GET', '/hedefler');
  assert.deepEqual(r.body.serbest, { acik: false, aglar: [] });
  // Hedef listesi degismedi.
  assert.deepEqual(r.body.hedefler.find((x) => x.host === 'GBNGXT33').ipler, ['10.0.0.5', '10.0.0.9']);
});

test('YKP29 D7: listede olmayan Host basligiyla sunucu on kontrolu baslar; kosu D7 uyarisinin onayini ister', { timeout: 20000 }, async () => {
  sifirla();
  senaryoEkle();
  const r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE({ vhost: 'baska.test.local' }) });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const k = D.kosular.find((x) => x.id === r.body.kosuId);
  assert.deepEqual([k.vhost, D.launch[0][2].yuk_host_basligi, k.plan_uyarilari], ['baska.test.local', 'baska.test.local', null]);
  assert.equal(JSON.parse(D.denetim.find((x) => x.eylem === 'nginx_loadtest_on_kontrol').detail).vhostListede, false);
  // Listedeki ad -> true; tarama tablosu yoksa -> null (bilinmiyor).
  sifirla();
  senaryoEkle();
  await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  assert.equal(JSON.parse(D.denetim.find((x) => x.eylem === 'nginx_loadtest_on_kontrol').detail).vhostListede, true);
  sifirla();
  senaryoEkle();
  D.taramaYok = true;
  const r0 = await istek('POST', '/kosular/on-kontrol', { body: GOVDE({ hedefIp: '10.0.0.5' }) });
  assert.equal(r0.statusCode, 200, JSON.stringify(r0.body));
  assert.equal(JSON.parse(D.denetim.find((x) => x.eylem === 'nginx_loadtest_on_kontrol').detail).vhostListede, null);
  // Kosu: playbook server_name'i nginx -T'de bulamadi -> engel DEGIL, onay isteyen uyari.
  sifirla();
  senaryoEkle();
  const ok = await onKontrolHazirla({ ozet: { ...OK_OZET, server_name_var: false }, govde: GOVDE({ vhost: 'baska.test.local' }) });
  let r2 = await istek('POST', '/kosular', { body: { onKontrolKosuId: ok.id, confirmText: 'GBNGXT33' } });
  assert.deepEqual([r2.statusCode, r2.body.code, r2.body.uyarilar], [409, 'uyari_onayi', [dg.HOST_LISTEDE_YOK_UYARISI]]);
  const g = await istek('GET', `/kosular/${ok.id}`);
  assert.deepEqual([g.body.kosu.onKontrolEngelleri, g.body.kosu.onKontrolUyarilari], [[], [dg.HOST_LISTEDE_YOK_UYARISI]]);
  r2 = await istek('POST', '/kosular', { body: { onKontrolKosuId: ok.id, confirmText: 'GBNGXT33', uyariOnay: true } });
  assert.equal(r2.statusCode, 200, JSON.stringify(r2.body));
  assert.equal(D.launch.at(-1)[2].yuk_host_basligi, 'baska.test.local');
});

test('YKP30 plan uyarilari: satirda, ayrintida basta, kosu onayi ister, yeni uyari on_kontrol_eski', { timeout: 20000 }, async () => {
  const hazirla = async () => {
    sifirla();
    senaryoEkle();
    process.env.NGINX_LOADTEST_SERBEST_AGLAR = SERBEST_AG;
    return onKontrolHazirla({ govde: SGOVDE({ vhost: 'yok.test.local' }), ozet: OK_OZET_SERBEST });
  };
  const plan = [dg.HOST_TARAMADA_YOK_UYARISI('yok.test.local'), RP_UYARISI()];
  let ok = await hazirla();
  assert.deepEqual(JSON.parse(ok.plan_uyarilari), plan);
  let g = await istek('GET', `/kosular/${ok.id}`);
  assert.deepEqual([g.body.kosu.planUyarilari, g.body.kosu.onKontrolUyarilari, g.body.kosu.onKontrolEngelleri], [plan, [...plan, dg.SERBEST_UYARISI], []]);
  let r = await istek('POST', '/kosular', { body: { onKontrolKosuId: ok.id, confirmText: SERBEST_IP } });
  assert.deepEqual([r.statusCode, r.body.code, r.body.uyarilar], [409, 'uyari_onayi', [...plan, dg.SERBEST_UYARISI]]);
  r = await istek('POST', '/kosular', { body: { onKontrolKosuId: ok.id, confirmText: SERBEST_IP, uyariOnay: true } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const kosu = D.kosular.find((x) => x.id === r.body.kosuId);
  assert.deepEqual(JSON.parse(kosu.plan_uyarilari), plan);
  // Kosu satirinin ayrintisi on kontrol satirinin plan uyarilarini gosterir.
  g = await istek('GET', `/kosular/${kosu.id}`);
  assert.deepEqual([g.body.kosu.planUyarilari, g.body.kosu.onKontrolUyarilari.length], [plan, 3]);
  assert.deepEqual(JSON.parse(D.denetim.find((x) => x.eylem === 'nginx_loadtest_baslat' && x.result !== 'fail').detail).onaylananUyarilar, [...plan, dg.SERBEST_UYARISI]);
  // Kosu aninda yeni plan uyarisi (Host basligi artik yuk makinesinin server_name'i) -> on_kontrol_eski.
  ok = await hazirla();
  D.tarama.push({ host: 'GBNGXT34', listen: '443 ssl', server_name: 'yok.test.local' });
  r = await istek('POST', '/kosular', { body: { onKontrolKosuId: ok.id, confirmText: SERBEST_IP, uyariOnay: true } });
  assert.deepEqual([r.statusCode, r.body.code, r.body.message], [409, 'on_kontrol_eski', `Ön kontrolden bu yana yeni uyarı çıktı (${dg.YUK_MAKINESI_HAVUZDA_UYARISI('yok.test.local', 'GBNGXT34')}); ön kontrolü yeniden çalıştırın.`]);
  assert.equal(D.launch.length, 1, 'onaylanmamis uyariyla kosu baslatildi');
  // Kaybolan uyari engel degil (yeniden kurulan liste saklananin alt kumesi).
  ok = await hazirla();
  D.tarama.push({ host: 'GBNGXT33', listen: '443 ssl', server_name: 'yok.test.local' });
  r = await istek('POST', '/kosular', { body: { onKontrolKosuId: ok.id, confirmText: SERBEST_IP, uyariOnay: true } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
});

test('YKP31 host_uretim: yalniz uretimde tanimli Host basligi iki kipte 409, satir yok, ret denetimde', { timeout: 20000 }, async () => {
  for (const [ad, govde] of [['sunucu', GOVDE({ vhost: 'prod.only.local' })], ['serbest', SGOVDE({ vhost: 'prod.only.local' })]]) {
    sifirla();
    senaryoEkle();
    process.env.NGINX_LOADTEST_SERBEST_AGLAR = SERBEST_AG;
    D.tarama.push({ host: 'GBNGXP40', listen: '10.9.0.1:443 ssl', server_name: 'prod.only.local' });
    const r = await istek('POST', '/kosular/on-kontrol', { body: govde });
    assert.deepEqual([r.statusCode, r.body.code, r.body.message], [409, 'host_uretim', 'Host başlığı (prod.only.local) son taramada yalnız üretim / EDU / ortamı bilinmeyen nginx sunucularında tanımlı (GBNGXP40); bu adla yük testi yapılmaz.'], ad);
    assert.deepEqual(r.body.sahipler.map((s) => s.host), ['GBNGXP40'], ad);
    assert.deepEqual([D.launch.length, D.kosular.length, tutulan()], [0, 0, []], ad);
    const d = D.denetim.find((x) => x.eylem === 'nginx_loadtest_on_kontrol');
    assert.ok(d && d.result === 'fail' && JSON.parse(d.detail).code === 'host_uretim', ad);
  }
  // Kosu aninda: ad on kontrolden sonra yalniz uretimde kaldi -> 409 host_uretim.
  sifirla();
  senaryoEkle();
  D.tarama.push({ host: 'GBNGXT35', listen: '443', server_name: 'tasinan.test.local' }, { host: 'GBNGXP40', listen: '443', server_name: 'tasinan.test.local' });
  const ok = await onKontrolHazirla({ govde: GOVDE({ vhost: 'tasinan.test.local' }) });
  D.tarama = D.tarama.filter((x) => x.host !== 'GBNGXT35');
  const r = await istek('POST', '/kosular', { body: { onKontrolKosuId: ok.id, confirmText: 'GBNGXT33', uyariOnay: true } });
  assert.deepEqual([r.statusCode, r.body.code], [409, 'host_uretim']);
  assert.equal(D.launch.length, 1);
});

test('YKP32 kilit aciklamasi: k6 + sunucu tur 2 ile birebir, wrk eki, serbestte IP', { timeout: 20000 }, async () => {
  const desc = () => [...new Set([...D.kilitler.values()].map((v) => v.target_desc))];
  sifirla();
  senaryoEkle();
  await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  assert.deepEqual(desc(), ['ön kontrol GBNGXT33 <- GBNGXT34']);
  sifirla();
  senaryoEkle();
  await kosuBaslat();
  assert.deepEqual(desc(), ['yük testi GBNGXT33 <- GBNGXT34']);
  sifirla();
  senaryoEkle();
  await istek('POST', '/kosular/on-kontrol', { body: GOVDE({ parametreler: { motor: 'wrk' } }) });
  assert.deepEqual(desc(), ['ön kontrol GBNGXT33 <- GBNGXT34 (wrk)']);
  sifirla();
  senaryoEkle();
  process.env.NGINX_LOADTEST_SERBEST_AGLAR = SERBEST_AG;
  await istek('POST', '/kosular/on-kontrol', { body: SGOVDE({ parametreler: { motor: 'wrk' } }) });
  assert.deepEqual(desc(), ['ön kontrol 10.20.30.40 (serbest) <- GBNGXT34 (wrk)']);
  // Ayni IP'ye ikinci is: T|IP kilidi (G yeni bir serbest on kontrolde de dolu oldugu icin once G).
  D.kilitler.get('G|global').held = 0;
  const r = await istek('POST', '/kosular/on-kontrol', { body: SGOVDE({ yukHost: 'GBNGXT34' }) });
  assert.deepEqual([r.statusCode, r.body.code, r.body.kilit], [409, 'kilit_dolu', 'T|IP:10.20.30.40']);
  assert.match(r.body.message, /^10\.20\.30\.40 IP'sine yönelik başka bir iş var \(onur: ön kontrol 10\.20\.30\.40 \(serbest\) <- GBNGXT34 \(wrk\), AWX iş #900\)\. İş bitince kilit kendiliğinden bırakılır\.$/);
});

test('YKP33 denetim ayrintisi: serbest + wrk kosusu ve uzun mesajli ret GECERLI JSON, <= 2000, kimlik alanlari kalir', { timeout: 20000 }, async () => {
  const baslat = require('../baslat.cjs');
  // Gercek server/audit/index.cjs detail'i String(detail).slice(0, 2000) ile saklar: saklanan deger budur.
  const sakli = (d) => String(d).slice(0, 2000);
  sifirla();
  senaryoEkle();
  process.env.NGINX_LOADTEST_SERBEST_AGLAR = SERBEST_AG;
  const OZET_WRK = { ...OK_OZET_SERBEST, k6_var: null, k6_surum: null, k6_sha256: null, wrk_var: true, wrk_calisiyor: true, wrk_surum: 'wrk 4.2.0 [epoll] Copyright (C) 2012 Will Glozer', wrk_sha256: 'b'.repeat(64) };
  const ok = await onKontrolHazirla({ govde: SGOVDE({ vhost: 'yok.test.local', parametreler: { motor: 'wrk' } }), ozet: OZET_WRK });
  const r = await istek('POST', '/kosular', { body: { onKontrolKosuId: ok.id, confirmText: SERBEST_IP, uyariOnay: true } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const kosu = D.kosular.find((x) => x.id === r.body.kosuId);
  const plan = [dg.HOST_TARAMADA_YOK_UYARISI('yok.test.local'), RP_UYARISI()];
  const onaylanan = [...plan, dg.SERBEST_UYARISI, dg.WRK_UYARISI];
  const d = D.denetim.find((x) => x.eylem === 'nginx_loadtest_baslat' && x.result !== 'fail');
  assert.ok(d.detail.length <= 2000, `ayrinti ${d.detail.length} karakter`);
  const det = JSON.parse(sakli(d.detail));
  // Kimlik alanlari BIREBIR.
  assert.deepEqual(
    [det.kosuId, det.adim, det.islem, det.hedefTuru, det.motor, det.hedefHost, det.hedefIp, det.yukHost, det.vhost, det.senaryoId, det.onKontrolKosuId, det.jobId, det.awxServerId, det.templateId],
    [kosu.id, `R${kosu.id}`, 'kosu', 'serbest', 'wrk', null, SERBEST_IP, 'GBNGXT34', 'yok.test.local', 1, ok.id, kosu.awx_job_id, 3, 44],
  );
  assert.equal(det.senaryoSha256, D.senaryolar[0].sha256);
  // Olculen durum: tam ayrinti siniri asar (eski .slice(0, 2000) gecersiz JSON yaziyordu); diziler kisaltildi, sayilari ayni.
  assert.equal(det.kirpildi, true);
  assert.ok(JSON.stringify({ ...det, kirpildi: undefined, planUyarilari: plan, onaylananUyarilar: onaylanan }).length > 2000, 'durum kisaltma istemiyor (test kor)');
  assert.equal(det.onaylananUyarilar.length, onaylanan.length);
  assert.equal(det.planUyarilari.length, plan.length);
  det.onaylananUyarilar.forEach((u, i) => assert.ok(u === onaylanan[i] || (u.endsWith('…') && onaylanan[i].startsWith(u.slice(0, -1))), `oge ${i} onek degil: ${u}`));
  assert.deepEqual(det.parametreler, JSON.parse(kosu.parametreler));

  // Uzun mesajli ret (424 envanter_okunamadi): kod ve mesajin basi kalir, JSON gecerli.
  sifirla();
  senaryoEkle();
  D.invHata = new Error(`TBMWANS ${'x'.repeat(3000)}`);
  const ret = await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  assert.deepEqual([ret.statusCode, ret.body.code], [424, 'envanter_okunamadi']);
  const dr = D.denetim.find((x) => x.eylem === 'nginx_loadtest_on_kontrol' && x.result === 'fail');
  assert.ok(dr.detail.length <= 2000, `ret ayrintisi ${dr.detail.length} karakter`);
  const detR = JSON.parse(sakli(dr.detail));
  assert.equal(detR.code, 'envanter_okunamadi');
  assert.ok(detR.message.startsWith('dbo.nginx_inventory okunamadı: TBMWANS x') && detR.message.endsWith('…'), detR.message.slice(0, 80));

  // Saf yardimci: sigan nesne JSON.stringify ile BIREBIR; sigmayan her durumda gecerli JSON <= sinir, anahtarlar kalir.
  const kucuk = { kosuId: 7, islem: 'on_kontrol', hedefTuru: 'sunucu', motor: 'k6', planUyarilari: ['a'], jobId: 900 };
  assert.equal(baslat.denetimAyrintisi(kucuk), JSON.stringify(kucuk));
  const anahtarlar = { kosuId: 5, adim: 'R5', islem: 'kosu', hedefTuru: 'serbest', motor: 'wrk', hedefHost: null, hedefIp: '10.20.30.40', yukHost: 'GBNGXT34', vhost: 'a.test.local', jobId: 901, awxServerId: 3, templateId: 44 };
  const dev = {
    ...anahtarlar, notlar: Array(100).fill('n'.repeat(100)), uzun: 'z'.repeat(5000), ic: { m: 'q'.repeat(3000), sayi: 4 },
    ...Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`f${i}`, 'v'.repeat(10)])),
  };
  const sd = baslat.denetimAyrintisi(dev);
  assert.ok(sd.length <= 2000, `dev ayrinti ${sd.length}`);
  const od = JSON.parse(sd);
  assert.deepEqual(Object.fromEntries(Object.keys(anahtarlar).map((k) => [k, od[k]])), anahtarlar);
  assert.deepEqual([od.kirpildi, od.kirpilan, Number.isInteger(od.atilan) && od.atilan > 0], [true, { notlar: 100 }, true]);
  for (const sinir of [120, 400, 900]) {
    const s = baslat.denetimAyrintisi(dev, { sinir });
    assert.ok(s.length <= sinir, `sinir ${sinir}: ${s.length}`);
    assert.equal(JSON.parse(s).kirpildi, true);
  }
  // Anahtar alani bile sigmiyorsa yalniz kisaltilmis anahtarlar kalir (yine gecerli JSON).
  const tasan = JSON.parse(baslat.denetimAyrintisi({ kosuId: 9, vhost: 'v'.repeat(3000), ek: 'e'.repeat(3000) }));
  assert.deepEqual([tasan.kosuId, tasan.vhost.length, tasan.ek, tasan.kirpildi], [9, 61, undefined, true]);
});

test('YKP34 yarim tarama gunu uctan uca: dunku limit / sahiplik / ad / hedef satirlari uygulanir, bugunku varsa bugunku', { timeout: 30000 }, async () => {
  // Bugun (MAX) yarim yuklendi: GBNGXT33 / GBNGXP40 satirlari henuz yok, dunku tam gun elde.
  const DUN = ONCEKI_GUN(TARAMA_GUNU);
  const limit = (host, rate, gun) => [
    { host, directive: 'limit_req_zone', value: `$binary_remote_addr zone=request_limit:20m rate=${rate}`, gun },
    { host, directive: 'limit_req', value: 'zone=request_limit burst=200 nodelay', gun },
  ];
  const baskaHostBugun = { host: 'GBNGXT34', directive: 'worker_processes', value: 'auto', gun: TARAMA_GUNU };
  const kur = (ayarlar) => {
    sifirla();
    senaryoEkle();
    D.ayarlar = ayarlar;
  };
  // (1) Limit yalniz dunku Settings'te (100 r/s): k6 400 -> 409 sinir_asildi; wrk tavani dunden (90).
  kur([baskaHostBugun, ...limit('GBNGXT33', '100r/s', DUN)]);
  let r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE({ parametreler: { hizlar: [400] } }) });
  assert.deepEqual([r.statusCode, r.body.code, r.body.message], [409, 'sinir_asildi', "Sınır aşıldı: hız 400 izinli aralıkta değil (1..90, hedefin ölçülmüş limit_req değerinin %90'ı)."]);
  assert.equal(D.launch.length, 0);
  r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE({ parametreler: { motor: 'wrk' } }) });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(D.launch[0][2].yuk_tavan_rps, '90', 'wrk tavani dunku limitten hesaplanmadi');
  const h = (await istek('GET', '/hedefler')).body.hedefler.find((x) => x.host === 'GBNGXT33');
  assert.deepEqual([h.hizSiniri, h.uygun], [90, true]);
  // Dunku 1 r/s: "bu hedefe yuk testi yapilamaz" reddi atlanmaz.
  kur([baskaHostBugun, ...limit('GBNGXT33', '1r/s', DUN)]);
  r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE({ parametreler: { hizlar: [1], maxvu: 10 } }) });
  assert.deepEqual([r.statusCode, r.body.code, r.body.message], [409, 'sinir_asildi', dg.SIFIR_SINIR_MESAJI]);
  // Bugunku Settings satiri varsa bugunku (300 r/s -> 270), dunku 100 r/s KULLANILMAZ.
  kur([...limit('GBNGXT33', '300r/s', TARAMA_GUNU), ...limit('GBNGXT33', '100r/s', DUN)]);
  r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE({ parametreler: { motor: 'wrk' } }) });
  assert.deepEqual([r.statusCode, D.launch[0][2].yuk_tavan_rps], [200, '270'], JSON.stringify(r.body));
  // (2) Sahiplik: PROD nginx'in IP'si yalniz dunku Servers'ta -> 409 hedef_uretim (serbest DEGIL), AWX'e gitmez.
  kur(null);
  process.env.NGINX_LOADTEST_SERBEST_AGLAR = SERBEST_AG;
  D.tarama.push({ host: 'GBNGXP40', listen: `${SERBEST_IP}:443 ssl`, server_name: 'www.prodapp.local', gun: DUN });
  r = await istek('POST', '/kosular/on-kontrol', { body: SGOVDE() });
  assert.deepEqual([r.statusCode, r.body.code, r.body.message], [409, 'hedef_uretim', `${SERBEST_IP}, GBNGXP40 sunucusuna ait (ortamı PROD); yük testi yapılmaz.`]);
  assert.deepEqual([D.launch.length, D.kosular.length], [0, 0]);
  assert.deepEqual((await istek('GET', `/ip-sinifi?ip=${SERBEST_IP}&yukHost=GBNGXT34`)).body.code, 'hedef_uretim');
  // (3) Host basligi yalniz dunku PROD satirinda -> 409 host_uretim.
  kur(null);
  D.tarama.push({ host: 'GBNGXP40', listen: '10.9.0.1:443 ssl', server_name: 'prod.only.local', gun: DUN });
  r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE({ vhost: 'prod.only.local' }) });
  assert.deepEqual([r.statusCode, r.body.code], [409, 'host_uretim']);
  // (4) Hedef satirlari: GBNGXT33 bugun henuz yazilmadi; dunku listen'i aday (ip_hedefte_yok DEGIL), vhost listede.
  kur(null);
  D.tarama = [
    { host: 'GBNGXT33', listen: '10.0.0.9:443 ssl', server_name: 'app.test.local api.test.local', gun: DUN },
    { host: 'GBNGXT34', listen: '443 ssl', server_name: 'rp.test.local', gun: DUN },
    { host: 'GBNGXT34', listen: '443 ssl', server_name: 'rp.test.local', gun: TARAMA_GUNU },
  ];
  r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(JSON.parse(D.denetim.find((x) => x.eylem === 'nginx_loadtest_on_kontrol').detail).vhostListede, true);
});
