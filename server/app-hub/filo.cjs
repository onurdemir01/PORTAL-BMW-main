// server/app-hub/filo.cjs - Application Hub: saatlik OpenShift filo taramasinin ayristirilmasi ve onbellegi (2026-11-18).
//
// Kullanici: "Canli Oku demeden her saat basi 1 kere tarasak ve tum uygulamalar icin veri beslense, canli
// veri istenirse Canli Oku butonuna basilsa" + "cluster basina uygulamanin kac pod'u var bunu da gorebilsinler".
//
// Playbook bmw_portal/app_hub/app_hub_fleet.yml cluster basina TEK dosya yazar (<dizin>/run-<kosu>/raw/<CLUSTER>.out):
//   APPHUB_FLEET_SUMMARY <TAB> nesne <TAB> pod <TAB> hata <TAB> sn
//   @@APPHUB_FLEET_BEGIN@@ base64(gzip(kayitlar)) @@APPHUB_FLEET_END@@
// Kayit bicimi files/app_hub_fleet.sh basinda yazar. Bu modul:
//   1. dosyayi SINIRLI okur (stat ile boyut; gunzip maxOutputLength ile sinirli),
//   2. kayitlari (namespace, uygulama) basina gruplar ve TEK uygulama satir bicimine cevirir; boylece ayristirma
//      ve ikinci maske katmani canli okumayla AYNI kod yoludur (canli.cjs satirlariCoz + maskJvmArgs),
//   3. pod'u sahibine (ReplicaSet -> Deployment/Rollout, RC -> DeploymentConfig, StatefulSet) baglar,
//   4. app_hub_ocp_filo tablosuna cluster basina FARK yazar (yeni / degisen / silinen; degismeyenin yalniz zamani).
//
// OKUNAMADI != YOK: okunamayan namespace (NSFAIL) ya da tur (KINDFAIL) varsa o kapsamda SATIR SILINMEZ (eski satir
// eski zamaniyla kalir, ekran "bayat" der); pod listesi okunamayan kapsamda pod sayisi "olculemedi" isaretlenir,
// 0 yazilmaz. END gelmeyen dosya hic yazilmaz.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const STATS_KEY = 'app_hub_fleet_result';
const BASLA = Buffer.from('@@APPHUB_FLEET_BEGIN@@');
const BITTI = Buffer.from('@@APPHUB_FLEET_END@@');
const HAM_SINIR = 64 * 1024 * 1024;
const ACIK_SINIR = 256 * 1024 * 1024;
const POD_LISTE_TAVANI = 200;
const JSON_TAVANI = 900000;
const EKLE_PARTI = 100;
const ID_PARTI = 500;
const NS_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const AD_RE = /^[A-Za-z0-9]([-A-Za-z0-9._]*[A-Za-z0-9])?$/;
const CLUSTER_RE = /^[A-Za-z0-9._-]+$/;

const L = (s) => String(s == null ? '' : s).toLowerCase();
const anahtar = (ns, ad) => `${ns}|${ad}`;

/** Cluster adindan dosya adi (playbook ile ayni kural: [^A-Za-z0-9._-] -> _). */
const dosyaAdi = (cluster) => `${String(cluster).replace(/[^A-Za-z0-9._-]/g, '_')}.out`;

/**
 * Ham dosya icerigi -> { ozet, satirlar } ya da { hata }. Isaretler yoksa / bozuksa hata (veri YOK degil).
 * @param {Buffer} buf
 */
function dosyaCoz(buf) {
  const metin = buf.subarray(0, Math.min(buf.length, 4096)).toString('utf8');
  const ozetSatir = metin.split('\n').find((l) => l.startsWith('APPHUB_FLEET_SUMMARY\t'));
  const f = ozetSatir ? ozetSatir.split('\t') : [];
  const ozet = ozetSatir
    ? {
        nesne: Number(f[1]) || 0,
        pod: Number(f[2]) || 0,
        hata: Number(f[3]) || 0,
        sn: Number(f[4]) || 0,
      }
    : null;
  const a = buf.indexOf(BASLA);
  const b = a < 0 ? -1 : buf.indexOf(BITTI, a + BASLA.length);
  if (a < 0 || b < 0) return { ozet, hata: 'tarama dosyasi eksik (bitis isareti yok)' };
  let acik;
  try {
    const z = Buffer.from(
      buf
        .subarray(a + BASLA.length, b)
        .toString('latin1')
        .replace(/\s+/g, ''),
      'base64',
    );
    acik = zlib.gunzipSync(z, { maxOutputLength: ACIK_SINIR });
  } catch (e) {
    return { ozet, hata: `tarama dosyasi cozulemedi: ${e?.message || e}` };
  }
  return { ozet, satirlar: acik.toString('utf8').split('\n') };
}

/**
 * Pod'un ait oldugu nesne adi (sahiplik zinciri; ek oc cagrisi yok):
 *   ReplicaSet  <ad>-<rollouts-pod-template-hash | pod-template-hash> -> Rollout / Deployment
 *   ReplicationController -> deploymentconfig etiketi (yoksa deployer / hook pod'u: null)
 *   StatefulSet -> dogrudan
 */
function podSahibi(tur, sahip, hash, rhash, dc) {
  const bosMu = (v) => !v || v === '-';
  if (tur === 'StatefulSet') return sahip;
  if (tur === 'ReplicaSet') {
    for (const h of [rhash, hash]) {
      if (!bosMu(h) && sahip.endsWith(`-${h}`)) return sahip.slice(0, -(h.length + 1));
    }
    return sahip;
  }
  // deploymentconfig etiketi olmayan RC pod'u deployer / hook pod'udur (app-3-deploy): uygulama degil.
  if (tur === 'ReplicationController') return bosMu(dc) ? null : dc;
  return null;
}

function bosGrup(ns, ad) {
  return { ns, ad, satirlar: [], podlar: [], hpa: [] };
}

/** OBJ / CONT / ENV kaydini tek uygulama bicimine cevirir: ilk alan (tip) + namespace atilir. */
function nesneSatiri(f) {
  return [f[0], ...f.slice(2)].join('\t');
}

/**
 * Kayit satirlari -> { gruplar: Map(ns|ad -> grup), nsHata: Map(ns -> Set(tur)), turHata: Set, notlar, hatalar, bitti }.
 * Pod'lar yalniz OBJ'si olan gruba baglanir (Job / CronJob / sahipsiz pod'lar uygulama degildir).
 */
function kumele(satirlar) {
  const out = {
    gruplar: new Map(),
    nsHata: new Map(),
    turHata: new Set(),
    notlar: [],
    hatalar: [],
    bitti: false,
  };
  const bekleyen = { podlar: [], hpalar: [] };
  for (const ham of satirlar || [])
    satirIsle(out, bekleyen, String(ham).replace(/\r$/, '').split('\t'));
  // CONT/ENV hep OBJ'den sonra gelir; OBJ'siz grup (bozuk cikti) uygulama sayilmaz.
  for (const [k, g] of out.gruplar)
    if (!g.satirlar.some((s) => s.startsWith('OBJ\t'))) out.gruplar.delete(k);
  podVeHpaBagla(out, bekleyen);
  return out;
}

function grupAl(out, ns, ad) {
  const k = anahtar(ns, ad);
  if (!out.gruplar.has(k)) out.gruplar.set(k, bosGrup(ns, ad));
  return out.gruplar.get(k);
}

function nsHataEkle(out, tur, ns) {
  if (!out.nsHata.has(ns)) out.nsHata.set(ns, new Set());
  out.nsHata.get(ns).add(tur);
}

function satirIsle(out, bekleyen, f) {
  switch (f[0]) {
    case 'OBJ':
    case 'CONT':
    case 'ENV':
      if (NS_RE.test(f[1] || '') && AD_RE.test(f[3] || ''))
        grupAl(out, f[1], f[3]).satirlar.push(nesneSatiri(f));
      return;
    case 'POD':
      bekleyen.podlar.push(f);
      return;
    case 'HPA':
      bekleyen.hpalar.push(f);
      return;
    case 'NSFAIL':
      nsHataEkle(out, f[1], f[2]);
      return;
    case 'KINDFAIL':
      out.turHata.add(f[1]);
      return;
    case 'NOTE':
      out.notlar.push(f.slice(1).join(' '));
      return;
    case 'ERR':
      out.hatalar.push(f.slice(1).join(' '));
      return;
    case 'END':
      out.bitti = true;
      return;
    default:
      return;
  }
}

function podVeHpaBagla(out, bekleyen) {
  for (const f of bekleyen.podlar) {
    const ad = podSahibi(f[2], f[3] || '', f[4], f[5], f[6]);
    const g = ad ? out.gruplar.get(anahtar(f[1], ad)) : null;
    if (g) g.podlar.push(f);
  }
  for (const f of bekleyen.hpalar) {
    const g = out.gruplar.get(anahtar(f[1], f[4]));
    if (g) g.hpa.push(f);
  }
}

// Bitmis pod (Evicted / tamamlanmis hook) uygulamanin calisan pod'u degildir; sayiya girmez, ayrica sayilir.
const BITMIS_FAZ = new Set(['Succeeded', 'Failed']);

const hazirMi = (hazir, faz) => {
  const [r, t] = String(hazir || '')
    .split('/')
    .map(Number);
  return faz === 'Running' && t > 0 && r === t;
};

/** Pod okunamayan kapsam: tur tamamen okunamadi ya da bu namespace'te okunamadi. */
function podOkunamadi(kume, ns) {
  return kume.turHata.has('pods') || !!kume.nsHata.get(ns)?.has('pods');
}

/** Tek grubun saklanacak govdesi (canli okumayla ayni sekil + podOzet). */
function grupGovdesi(g, kume) {
  const C = require('./canli.cjs');
  const podSatir = g.podlar
    .slice(0, POD_LISTE_TAVANI)
    .map((f) => ['POD', f[7], f[8], f[9], f[10], f[11], f[12]].join('\t'));
  const hpaSatir = g.hpa.map((f) => ['HPA', f[2], f[3], f[5], f[6], f[7]].join('\t'));
  const c = C.satirlariCoz([...g.satirlar, ...podSatir, ...hpaSatir, `END\t1\t${g.podlar.length}`]);
  const nodeIx = new Map();
  for (const f of g.podlar) if (f[9] && f[9] !== '-') nodeIx.set(f[9], (nodeIx.get(f[9]) || 0) + 1);
  const okunamadi = podOkunamadi(kume, g.ns);
  const canli = g.podlar.filter((f) => !BITMIS_FAZ.has(f[8]));
  return {
    nesneler: c.nesneler,
    podlar: c.podlar,
    hpa: c.hpa,
    nodelar: [...nodeIx.entries()]
      .map(([ad, pod]) => ({ ad, pod }))
      .sort((a, b) => a.ad.localeCompare(b.ad)),
    notlar: okunamadi ? ['Pod listesi bu namespace için okunamadı; pod sayısı ölçülemedi.'] : [],
    hatalar: [],
    podOzet: {
      toplam: okunamadi ? null : canli.length,
      hazir: okunamadi ? null : canli.filter((f) => hazirMi(f[10], f[8])).length,
      bitmis: g.podlar.length - canli.length,
      listelenen: c.podlar.length,
      okunamadi,
    },
  };
}

/** Govdeyi JSON'a cevirir; tavani asarsa once pod listesini kisar (bozuk JSON YAZILMAZ). */
function govdeJson(govde) {
  let j = JSON.stringify(govde);
  if (j.length <= JSON_TAVANI) return j;
  const podlar = (govde.podlar || []).slice(0, 20);
  const kisa = {
    ...govde,
    podlar,
    podOzet: govde.podOzet ? { ...govde.podOzet, listelenen: podlar.length } : govde.podOzet,
    notlar: [...(govde.notlar || []), 'Pod listesi boyut sınırı yüzünden kısaltıldı.'],
  };
  j = JSON.stringify(kisa);
  if (j.length <= JSON_TAVANI) return j;
  // Son care: JVM env ayrintisi atilir; tur, replika, pod sayisi, kaynak kalir (satir silinmesin).
  j = JSON.stringify({
    ...kisa,
    nesneler: (kisa.nesneler || []).map((n) => ({
      ...n,
      containerlar: (n.containerlar || []).map((c) => ({ ...c, jvmEnv: [] })),
    })),
    notlar: [...kisa.notlar, 'JVM ayrıntısı boyut sınırı yüzünden gösterilmiyor.'],
  });
  return j.length <= JSON_TAVANI ? j : null;
}

/** Ozet icin asil nesne: ayni adda Deployment (workloadRef, 0'a olcekli) + Rollout varsa replikasi olan. */
function anaNesne(nesneler) {
  return (nesneler || []).reduce(
    (a, n) => (!a || (n.istenen || 0) > (a.istenen || 0) ? n : a),
    null,
  );
}

function ozetAlanlari(govde) {
  const n = anaNesne(govde.nesneler) || {};
  return {
    tur: n.tur ? String(n.tur).slice(0, 32) : null,
    istenen: n.istenen == null ? null : n.istenen,
    hazir: n.hazir == null ? null : n.hazir,
  };
}

/** Bu cluster taramasinda SILINEMEZ satir mi? (tur ya da namespace okunamadi) */
function korunur(kume, ns) {
  const nesneTurleri = ['deployment', 'deploymentconfig', 'statefulset', 'rollouts.argoproj.io'];
  if (nesneTurleri.some((t) => kume.turHata.has(t))) return true;
  const h = kume.nsHata.get(ns);
  return !!(h && nesneTurleri.some((t) => h.has(t)));
}

function parcala(liste, n) {
  const out = [];
  for (let i = 0; i < liste.length; i += n) out.push(liste.slice(i, i + n));
  return out;
}

async function topluEkle(db, cluster, kosuId, yeniler, zaman) {
  for (const parti of parcala(yeniler, EKLE_PARTI)) {
    const p = [];
    const degerler = parti.map((y) => {
      const b = p.length;
      p.push(
        cluster,
        y.ns,
        y.ad,
        y.json,
        y.sha,
        y.ozet.tur,
        y.ozet.istenen,
        y.ozet.hazir,
        y.pod.toplam,
        y.pod.hazir,
        kosuId,
        zaman,
      );
      const ph = Array.from({ length: 12 }, (_, i) => `$${b + i + 1}`).join(', ');
      return `(${ph}, SYSUTCDATETIME())`;
    });
    await db.query(
      `INSERT INTO app_hub_ocp_filo (cluster, namespace, uygulama, sonuc_json, ozet_sha, tur, istenen, hazir, pod_toplam, pod_hazir, kosu_id, alinma, degisti)
       VALUES ${degerler.join(', ')}`,
      p,
      { tekrar: false },
    );
  }
}

async function idleIle(db, sql, ids, onParam = []) {
  for (const parti of parcala(ids, ID_PARTI)) {
    const ph = parti.map((_, i) => `$${onParam.length + i + 1}`).join(', ');
    await db.query(sql.replace('@IDS', ph), [...onParam, ...parti]);
  }
}

/**
 * Bir cluster'in kumesini tabloya FARK olarak yazar. Donus: { eklenen, guncellenen, silinen, ayni, korunan }.
 * @param {string} cluster
 * @param {ReturnType<typeof kumele>} kume
 * @param {number} kosuId
 */
async function clusterYaz(cluster, kume, kosuId, zaman = new Date()) {
  const db = require('../db/index.cjs');
  const { rows } = await db.query(
    'SELECT id, namespace, uygulama, ozet_sha FROM app_hub_ocp_filo WHERE cluster = $1',
    [cluster],
  );
  const mevcut = new Map(rows.map((r) => [anahtar(L(r.namespace), L(r.uygulama)), r]));
  const yeniler = [];
  const ayniId = [];
  const sonuc = { eklenen: 0, guncellenen: 0, silinen: 0, ayni: 0, korunan: 0, buyuk: 0 };
  const gorulen = new Set();
  for (const g of kume.gruplar.values()) {
    const govde = grupGovdesi(g, kume);
    const json = govdeJson(govde);
    const k = anahtar(L(g.ns), L(g.ad));
    gorulen.add(k);
    if (!json) {
      // Saklanamayacak kadar buyuk: eski satir eski zamaniyla kalir (silinmez, bayat gorunur).
      sonuc.buyuk++;
      continue;
    }
    // Degisiklik izi: sha256'nin ilk 40 hanesi. Sutun CHAR(40) (dis DB'de DDL yok); sha1 Sonar
    // kapisinda zafiyet (S4790) sayilir. Bicim degisince ilk kosu satirlari bir kez gunceller.
    const sha = crypto.createHash('sha256').update(json).digest('hex').slice(0, 40);
    const eski = mevcut.get(k);
    const y = { ns: g.ns, ad: g.ad, json, sha, ozet: ozetAlanlari(govde), pod: govde.podOzet };
    if (!eski) yeniler.push(y);
    else if (eski.ozet_sha === sha) ayniId.push(eski.id);
    else {
      await db.query(
        `UPDATE app_hub_ocp_filo SET sonuc_json = $1, ozet_sha = $2, tur = $3, istenen = $4, hazir = $5, pod_toplam = $6, pod_hazir = $7,
                kosu_id = $8, alinma = $10, degisti = SYSUTCDATETIME() WHERE id = $9`,
        [
          json,
          sha,
          y.ozet.tur,
          y.ozet.istenen,
          y.ozet.hazir,
          y.pod.toplam,
          y.pod.hazir,
          kosuId,
          eski.id,
          zaman,
        ],
      );
      sonuc.guncellenen++;
    }
  }
  await topluEkle(db, cluster, kosuId, yeniler, zaman);
  sonuc.eklenen = yeniler.length;
  sonuc.ayni = ayniId.length;
  await idleIle(
    db,
    'UPDATE app_hub_ocp_filo SET alinma = $2, kosu_id = $1 WHERE id IN (@IDS)',
    ayniId,
    [kosuId, zaman],
  );
  const silinecek = [];
  for (const [k, r] of mevcut) {
    if (gorulen.has(k)) continue;
    if (korunur(kume, L(r.namespace))) sonuc.korunan++;
    else silinecek.push(r.id);
  }
  await idleIle(db, 'DELETE FROM app_hub_ocp_filo WHERE id IN (@IDS)', silinecek);
  sonuc.silinen = silinecek.length;
  return sonuc;
}

/** Kosu dizini (env APP_HUB_FILO_DIR; mutlak, '..' yok, en az 3 seviye). */
function filoDizini() {
  let d = String(process.env.APP_HUB_FILO_DIR || '/sw/BMW_PORTAL/app_hub_ocp').trim();
  // Sondaki egik cizgiler dongu ile: `/\/+$/` geri izlemede karesel (Sonar S8786).
  while (d.endsWith('/')) d = d.slice(0, -1);
  if (!path.isAbsolute(d) || d.includes('..') || d.split(/[\\/]/).filter(Boolean).length < 3) {
    throw Object.assign(new Error(`APP_HUB_FILO_DIR gecersiz: ${d}`), { status: 422 });
  }
  return d;
}

/** Bir cluster dosyasini sinirli okur. Donus: Buffer ya da { hata }. */
function hamOku(yol) {
  let st;
  try {
    st = fs.statSync(yol);
  } catch {
    return { hata: 'tarama dosyasi yok (yazilmadi ya da silindi)' };
  }
  if (st.size > HAM_SINIR) return { hata: `tarama dosyasi cok buyuk (${st.size} bayt)` };
  try {
    return fs.readFileSync(yol);
  } catch (e) {
    return { hata: `tarama dosyasi okunamadi: ${e?.message || e}` };
  }
}

/**
 * Kosunun cluster sonuclarini alir. raw = set_stats app_hub_fleet_result. Cluster cluster islenir; hepsi
 * ayni anda bellekte durmaz. zaman = TARAMA zamani (AWX isinin basladigi an), alim zamani DEGIL: alim isten
 * dakikalar sonra olur; arada yapilan "Canli oku" daha yeni sayilmali. Donus: { clusterlar: [...] }.
 */
async function kosuyuAl(kosuId, raw, zaman = new Date()) {
  const dizin = `${filoDizini()}/run-${kosuId}/raw`;
  const sonuclar = Array.isArray(raw?.results) ? raw.results : [];
  const clusterlar = [];
  for (const r of sonuclar) {
    const cluster = String(r?.cluster || '');
    if (!CLUSTER_RE.test(cluster)) continue;
    clusterlar.push(await clusterAl(dizin, cluster, r, kosuId, zaman));
  }
  return { clusterlar };
}

async function clusterAl(dizin, cluster, r, kosuId, zaman) {
  const temel = { cluster, ok: false, hata: null, ozet: null, yazim: null };
  if (!r.written)
    return { ...temel, hata: String(r.error || 'tarama sonucu yazilmadi').slice(0, 500) };
  const buf = hamOku(`${dizin}/${dosyaAdi(cluster)}`);
  if (!Buffer.isBuffer(buf)) return { ...temel, hata: buf.hata };
  const c = dosyaCoz(buf);
  if (c.hata) return { ...temel, ozet: c.ozet, hata: c.hata };
  const kume = kumele(c.satirlar);
  if (!kume.bitti) {
    return {
      ...temel,
      ozet: c.ozet,
      hata: (kume.hatalar.join(' · ') || String(r.error || 'tarama tamamlanmadi')).slice(0, 500),
    };
  }
  const yazim = await clusterYaz(cluster, kume, kosuId, zaman);
  const uyari = [...kume.hatalar, ...[...kume.turHata].map((t) => `${t} okunamadi`)];
  if (kume.nsHata.size) uyari.push(`${kume.nsHata.size} namespace kismen okunamadi`);
  return {
    ...temel,
    ok: true,
    ozet: c.ozet,
    yazim,
    hata: uyari.length ? uyari.join(' · ').slice(0, 500) : null,
    notlar: kume.notlar.slice(0, 10),
  };
}

/** Uygulamanin filo satirlari: canli okumayla ayni sekil + kaynak 'saatlik' + podOzet. */
async function filoOkumalari(ad) {
  const db = require('../db/index.cjs');
  const { rows } = await db.query(
    `SELECT TOP 200 cluster, namespace, sonuc_json, alinma, degisti, kosu_id FROM app_hub_ocp_filo WHERE uygulama = $1`,
    [ad],
  );
  const durum = await sonKosuDurumu().catch(() => null);
  return rows.map((r) => {
    let govde = null;
    try {
      govde = r.sonuc_json ? JSON.parse(r.sonuc_json) : null;
    } catch {
      govde = null;
    }
    const cHata = durum?.clusterHata ? durum.clusterHata[L(r.cluster)] : null;
    return {
      cluster: r.cluster,
      namespace: r.namespace,
      ok: !!govde,
      hata: govde ? null : 'Saatlik tarama kaydı çözülemedi.',
      kaynak: 'saatlik',
      alinma: r.alinma ? new Date(r.alinma).toISOString() : null,
      degisti: r.degisti ? new Date(r.degisti).toISOString() : null,
      isNo: null,
      alanAd: null,
      sonTaramaHatasi: cHata || null,
      ...(govde || {}),
    };
  });
}

/** Son biten kosu: zaman, cluster sayilari ve cluster basina son hata (ekran "bu cluster son taramada okunamadi" der). */
async function sonKosuDurumu() {
  const db = require('../db/index.cjs');
  const { rows } = await db.query(
    `SELECT TOP 1 id, durum, baslangic, bitis, ozet_json, hata FROM app_hub_ocp_filo_kosu WHERE durum IN ('BITTI', 'HATA') ORDER BY id DESC`,
  );
  if (!rows.length) return null;
  const r = rows[0];
  let ozet = null;
  try {
    ozet = r.ozet_json ? JSON.parse(r.ozet_json) : null;
  } catch {
    ozet = null;
  }
  const clusterHata = {};
  for (const c of ozet?.clusterlar || [])
    if (!c.ok) clusterHata[L(c.cluster)] = c.hata || 'okunamadı';
  return {
    kosuId: r.id,
    durum: r.durum,
    baslangic: r.baslangic ? new Date(r.baslangic).toISOString() : null,
    bitis: r.bitis ? new Date(r.bitis).toISOString() : null,
    clusterSayisi: ozet?.clusterlar ? ozet.clusterlar.length : 0,
    okSayisi: ozet?.clusterlar ? ozet.clusterlar.filter((c) => c.ok).length : 0,
    hata: r.hata || null,
    clusterHata,
  };
}

/** Basarili okuma basarisizi yener; ikisi de ayniysa daha yeni olan. */
function dahaIyiOkuma(r, v) {
  if (!!r.ok !== !!v.ok) return !!r.ok;
  return String(r.alinma || '') > String(v.alinma || '');
}

/**
 * Canli okuma + filo satirlarini (cluster, namespace) basina birlestirir: DAHA YENI olan kazanir; kaynak alani
 * hangisinin gosterildigini soyler. Canli okuma 'canli' etiketi alir.
 */
function birlestir(canli, filo) {
  const ix = new Map();
  const koy = (r) => {
    const k = `${L(r.cluster)}|${L(r.namespace)}`;
    const v = ix.get(k);
    if (!v) {
      ix.set(k, r);
      return;
    }
    const [kazanan, kaybeden] = dahaIyiOkuma(r, v) ? [r, v] : [v, r];
    // Daha yeni ama basarisiz okuma gecerli veriyi gizlemez; kartta uyari olarak kalir.
    const yeniHata = !kaybeden.ok && String(kaybeden.alinma || '') > String(kazanan.alinma || '');
    ix.set(k, yeniHata ? { ...kazanan, sonOkumaHatasi: kaybeden.hata || 'okunamadı' } : kazanan);
  };
  for (const r of Array.isArray(canli) ? canli : []) koy({ ...r, kaynak: r.kaynak || 'canli' });
  for (const r of Array.isArray(filo) ? filo : []) koy(r);
  return [...ix.values()];
}

module.exports = {
  STATS_KEY,
  dosyaAdi,
  dosyaCoz,
  podSahibi,
  kumele,
  grupGovdesi,
  govdeJson,
  korunur,
  clusterYaz,
  filoDizini,
  kosuyuAl,
  filoOkumalari,
  sonKosuDurumu,
  birlestir,
  anaNesne,
};
