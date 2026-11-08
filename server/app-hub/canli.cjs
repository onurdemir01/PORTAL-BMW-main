// server/app-hub/canli.cjs - Uygulama Hub: OpenShift canli detay (2026-11-08).
//
// Envanter (Openshift_Inventory) yalniz cluster / namespace / ad tutar; tur (Deployment mi
// Argo Rollout mu), replika, imaj, kaynak, JVM env'leri ve pod -> node bilgisi yalniz canli
// okumayla gelir. Okuma tek bir dar AWX isidir (bmw_portal/app_hub/app_hub_ocp.yml): bastion
// basina oc login + birkac `oc get`, SALT OKUNUR.
//
// SONUC PAYLASILIR: is bitince sonuc app_hub_ocp_canli tablosuna yazilir; sonraki ziyaretci
// (baska admin) ayni uygulamada yeniden is acmadan son okumayi ve ZAMANINI gorur.
//
// MASKE: betik JVM env degerlerini zaten maskeler; burada ayrica maskJvmArgs uygulanir
// (iki katman). secretKeyRef / configMapKeyRef degeri hic okunmaz, yalniz referans adi.
'use strict';

const REGISTRY_KEY = 'app_hub_ocp_canli';
const STATS_KEY = 'app_hub_ocp_result';
const HEDEF_TAVAN = 20;

const L = (s) => String(s == null ? '' : s).trim().toLowerCase();
const bos = (v) => (v == null || v === '' || v === '<no value>' ? null : v);
const tam = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** AWX artifact'inden set_stats anahtari (uc bicim; opsx extractStatsKey ile ayni tolerans). */
function statsOku(artifacts, key = STATS_KEY) {
  const a = artifacts || {};
  for (const c of [a[key], a.data && a.data[key], a.ansible_stats && a.ansible_stats.data && a.ansible_stats.data[key]]) {
    if (c && typeof c === 'object') return c;
  }
  return null;
}

const TUR_AD = {
  deployment: 'Deployment',
  deploymentconfig: 'DeploymentConfig',
  statefulset: 'StatefulSet',
  rollout: 'Argo Rollout',
};

/**
 * Betik satirlarini (cluster, namespace) basina yapiya cevirir. Taninmayan satir yok sayilir.
 * @param {string[]} lines
 */
function satirlariCoz(lines) {
  const { maskJvmArgs } = require('../server-hub/mask.cjs');
  const out = { nesneler: [], podlar: [], hpa: [], notlar: [], hatalar: [], bitti: false };
  const nesneIx = new Map();
  const nesne = (kind, ad) => {
    const k = `${L(kind)}|${ad}`;
    if (!nesneIx.has(k)) {
      const n = { tur: TUR_AD[L(kind)] || kind, kind, ad, istenen: null, hazir: null, guncel: null, mevcut: null, strateji: null, gitops: null, olusturma: null, containerlar: [] };
      nesneIx.set(k, n);
      out.nesneler.push(n);
    }
    return nesneIx.get(k);
  };
  const container = (n, ad) => {
    let c = n.containerlar.find((x) => x.ad === ad);
    if (!c) {
      c = { ad, imaj: null, istek: { cpu: null, bellek: null }, limit: { cpu: null, bellek: null }, jvmEnv: [] };
      n.containerlar.push(c);
    }
    return c;
  };
  for (const ham of lines || []) {
    const f = String(ham == null ? '' : ham).replace(/\r$/, '').split('\t');
    switch (f[0]) {
      case 'OBJ': {
        const n = nesne(f[1], f[2]);
        n.istenen = tam(f[3]);
        n.hazir = tam(f[4]);
        n.guncel = tam(f[5]);
        n.mevcut = tam(f[6]);
        n.strateji = bos(f[7]);
        n.gitops = bos(f[8]);
        n.olusturma = bos(f[9]);
        break;
      }
      case 'CONT': {
        const n = nesne(f[1], f[2]);
        const c = container(n, f[3]);
        c.imaj = bos(f[4]);
        c.istek = { cpu: bos(f[5]), bellek: bos(f[6]) };
        c.limit = { cpu: bos(f[7]), bellek: bos(f[8]) };
        break;
      }
      case 'ENV': {
        const n = nesne(f[1], f[2]);
        const c = container(n, f[3]);
        const kaynak = f[5] === 'ref' ? 'referans' : 'deger';
        const deger = f.slice(6).join(' ');
        c.jvmEnv.push({ ad: f[4], kaynak, deger: kaynak === 'deger' ? maskJvmArgs(deger) : deger });
        break;
      }
      case 'POD':
        out.podlar.push({ ad: f[1], faz: bos(f[2]), node: f[3] === '-' ? null : bos(f[3]), hazir: bos(f[4]), restart: tam(f[5]), baslama: f[6] === '-' ? null : bos(f[6]) });
        break;
      case 'HPA':
        out.hpa.push({ ad: f[1], hedef: bos(f[2]), min: tam(f[3]), max: tam(f[4]), guncel: tam(f[5]) });
        break;
      case 'NOTE':
        out.notlar.push(f.slice(1).join(' '));
        break;
      case 'ERR':
        out.hatalar.push(f.slice(1).join(' '));
        break;
      case 'END':
        out.bitti = true;
        break;
      default:
        break;
    }
  }
  const nodeIx = new Map();
  for (const p of out.podlar) if (p.node) nodeIx.set(p.node, (nodeIx.get(p.node) || 0) + 1);
  out.nodelar = [...nodeIx.entries()].map(([ad, pod]) => ({ ad, pod })).sort((a, b) => a.ad.localeCompare(b.ad));
  return out;
}

/** Playbook sonucunu hedef basina cozumlenmis listeye cevirir. */
function sonucuCoz(raw) {
  const sonuc = (raw && Array.isArray(raw.results) ? raw.results : []).map((r) => {
    const c = satirlariCoz(r.lines);
    const hata = r.ok === false ? [r.error, ...c.hatalar].filter(Boolean).join(' · ') : c.hatalar.join(' · ') || null;
    return { cluster: String(r.cluster || ''), namespace: String(r.namespace || ''), ok: r.ok !== false && c.bitti, hata: hata || null, ...c };
  });
  return { genel: (raw && raw.overall_status) || null, hedefler: sonuc };
}

/** Uygulamanin envanterdeki yerlerinden is hedeflerini ve fan-out extra_vars'ini kurar. */
async function hedefleriKur(ad, yerler, secim) {
  const istenen = Array.isArray(secim) && secim.length ? new Set(secim.map((s) => `${L(s.cluster)}|${L(s.namespace)}`)) : null;
  const hedefler = (yerler || [])
    .filter((y) => y.katalogda && (!istenen || istenen.has(`${L(y.cluster)}|${L(y.namespace)}`)))
    .slice(0, HEDEF_TAVAN);
  if (!hedefler.length) {
    throw Object.assign(new Error('Okunacak (cluster, namespace) yok: uygulamanın cluster\'ları Portal cluster kataloğunda tanımlı değil.'), { status: 400 });
  }
  const admin = require('../logx/v2/admin.cjs');
  const ocp = require('../logx/v2/ocp.cjs');
  const gruplar = new Map();
  for (const h of hedefler) {
    const k = `${h.ortam}|${h.tenant}`;
    if (!gruplar.has(k)) gruplar.set(k, { env: h.ortam, tenant: h.tenant, clusters: new Set() });
    gruplar.get(k).clusters.add(h.cluster);
  }
  const ocpClusters = [];
  const terminal = new Set();
  const eksik = [];
  for (const g of gruplar.values()) {
    const clusters = [...g.clusters];
    const { hosts, missing } = await admin.resolveTerminalHosts(g.env, g.tenant, clusters);
    if (missing.length) eksik.push(...missing);
    const meta = await admin.resolveClusterMeta(g.env, g.tenant, clusters).catch(() => ({}));
    const ev = ocp.buildOcpExtraVars({ env: g.env, tenant: g.tenant, clusters: clusters.filter((c) => !missing.includes(c)), hosts, meta });
    for (const c of ev.ocp_clusters) ocpClusters.push(c);
    for (const t of ev.terminal_hosts) if (t) terminal.add(t);
  }
  if (eksik.length && !ocpClusters.length) {
    throw Object.assign(new Error(`Şu cluster'lar için Jump Server (bastion) tanımlı değil: ${eksik.join(', ')}. Admin > LogX Yapılandırma ekranından girilmeli.`), { status: 400 });
  }
  const varOlan = new Set(ocpClusters.map((c) => L(c.cluster_name)));
  const runtime = ocp.buildOcpRuntimeVars(await require('../logx/v2/ocp-runtime-config.cjs').getConfig().catch(() => ({})));
  return {
    extraVars: {
      ...runtime,
      terminal_hosts: [...terminal].sort(),
      ocp_clusters: ocpClusters,
      app_hub_app: ad,
      app_hub_targets: hedefler.filter((h) => varOlan.has(L(h.cluster))).map((h) => ({ cluster: h.cluster, namespace: h.namespace })),
    },
    atlanan: eksik,
  };
}

async function sonOkumalar(ad) {
  const db = require('../db/index.cjs');
  const { rows } = await db.query(
    `SELECT TOP 40 id, cluster, namespace, sonuc_json, ok, hata, alan_ad, alinma, awx_job_id
       FROM app_hub_ocp_canli WHERE uygulama = $1 ORDER BY alinma DESC, id DESC`,
    [ad],
  );
  const gorulen = new Set();
  const out = [];
  for (const r of rows) {
    const k = `${L(r.cluster)}|${L(r.namespace)}`;
    if (gorulen.has(k)) continue;
    gorulen.add(k);
    let sonuc = null;
    try {
      sonuc = r.sonuc_json ? JSON.parse(r.sonuc_json) : null;
    } catch {
      sonuc = null;
    }
    out.push({ cluster: r.cluster, namespace: r.namespace, ok: !!r.ok, hata: r.hata || null, alanAd: r.alan_ad || null, alinma: r.alinma ? new Date(r.alinma).toISOString() : null, isNo: r.awx_job_id, ...(sonuc || {}) });
  }
  return out;
}

async function sonucuKaydet(ad, cozum, { serverId, jobId, kullanici, adSoyad }) {
  const db = require('../db/index.cjs');
  const { rows } = await db.query(
    `SELECT TOP 1 id FROM app_hub_ocp_canli WHERE awx_server_id = $1 AND awx_job_id = $2`,
    [serverId, jobId],
  );
  if (rows.length) return false;
  for (const h of cozum.hedefler) {
    const { cluster, namespace, ok, hata, ...govde } = h;
    await db.query(
      `INSERT INTO app_hub_ocp_canli (uygulama, cluster, namespace, sonuc_json, ok, hata, alan_kullanici, alan_ad, awx_server_id, awx_job_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [ad, cluster, namespace, JSON.stringify(govde).slice(0, 900000), ok ? 1 : 0, hata ? String(hata).slice(0, 2000) : null, kullanici, adSoyad, serverId, jobId],
    );
  }
  return true;
}

module.exports = { REGISTRY_KEY, STATS_KEY, HEDEF_TAVAN, statsOku, satirlariCoz, sonucuCoz, hedefleriKur, sonOkumalar, sonucuKaydet };
