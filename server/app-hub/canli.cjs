// server/app-hub/canli.cjs - Application Hub: OpenShift canli detay (2026-11-08).
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
const { varsayilanSira } = require('../util/siralama.cjs');

const REGISTRY_KEY = 'app_hub_ocp_canli';
const STATS_KEY = 'app_hub_ocp_result';
const HEDEF_TAVAN = 20;
const TEMPLATE_NAME = 'Application Hub: OpenShift canlı okuma';

const L = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toLowerCase();
// go-template eksik etiket/anotasyon icin "<no value>" basar; gitops alani iki index'i birlestirdigi icin
// "<no value><no value>" da gelebilir. Isaret hangi sayida olursa olsun silinir; geriye bir sey kalmazsa null.
const bos = (v) => {
  const s = v == null ? '' : String(v).replace(/<no value>/g, '');
  return s === '' ? null : s;
};
const tam = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** AWX artifact'inden set_stats anahtari (uc bicim; opsx extractStatsKey ile ayni tolerans). */
function statsOku(artifacts, key = STATS_KEY) {
  const a = artifacts || {};
  for (const c of [a[key], a.data?.[key], a.ansible_stats?.data?.[key]]) {
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
      const n = {
        tur: TUR_AD[L(kind)] || kind,
        kind,
        ad,
        istenen: null,
        hazir: null,
        guncel: null,
        mevcut: null,
        strateji: null,
        gitops: null,
        olusturma: null,
        containerlar: [],
      };
      nesneIx.set(k, n);
      out.nesneler.push(n);
    }
    return nesneIx.get(k);
  };
  const container = (n, ad) => {
    let c = n.containerlar.find((x) => x.ad === ad);
    if (!c) {
      c = {
        ad,
        imaj: null,
        istek: { cpu: null, bellek: null },
        limit: { cpu: null, bellek: null },
        jvmEnv: [],
      };
      n.containerlar.push(c);
    }
    return c;
  };
  for (const ham of lines || []) {
    const f = String(ham == null ? '' : ham)
      .replace(/\r$/, '')
      .split('\t');
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
        out.podlar.push({
          ad: f[1],
          faz: bos(f[2]),
          node: f[3] === '-' ? null : bos(f[3]),
          hazir: bos(f[4]),
          restart: tam(f[5]),
          baslama: f[6] === '-' ? null : bos(f[6]),
        });
        break;
      case 'HPA':
        out.hpa.push({
          ad: f[1],
          hedef: bos(f[2]),
          min: tam(f[3]),
          max: tam(f[4]),
          guncel: tam(f[5]),
        });
        break;
      case 'NOTE':
        out.notlar.push(f.slice(1).join(' '));
        break;
      case 'ERR':
        out.hatalar.push(f.slice(1).join(' '));
        break;
      case 'END':
        out.bitti = true;
        out.endPod = tam(f[2]);
        break;
      default:
        break;
    }
  }
  const nodeIx = new Map();
  for (const p of out.podlar) if (p.node) nodeIx.set(p.node, (nodeIx.get(p.node) || 0) + 1);
  out.nodelar = [...nodeIx.entries()]
    .map(([ad, pod]) => ({ ad, pod }))
    .sort((a, b) => a.ad.localeCompare(b.ad));
  return out;
}

/** Playbook sonucunu hedef basina cozumlenmis listeye cevirir. */
/**
 * Canli okumanin pod ozeti (saatlik taramayla ayni anlam): pod listesi okunamadiysa sayi YOK (0 degil);
 * betik en cok 200 pod yazar, gercek toplam END satirindadir. Bitmis pod (Succeeded / Failed) sayilmaz.
 */
function canliPodOzeti(c) {
  const okunamadi = c.hatalar.some((h) => /pod listesi okunamadi/i.test(h));
  const bitmisFaz = (p) => p.faz === 'Succeeded' || p.faz === 'Failed';
  const listede = c.podlar.filter((p) => !bitmisFaz(p));
  const bitmis = c.podlar.length - listede.length;
  const toplam =
    c.endPod != null && c.endPod > c.podlar.length ? c.endPod - bitmis : listede.length;
  const hazir = listede.filter((p) => {
    const [r, t] = String(p.hazir || '')
      .split('/')
      .map(Number);
    return p.faz === 'Running' && t > 0 && r === t;
  }).length;
  return {
    toplam: okunamadi ? null : toplam,
    hazir: okunamadi ? null : hazir,
    bitmis,
    listelenen: c.podlar.length,
    okunamadi,
  };
}

function sonucuCoz(raw) {
  const sonuc = (raw && Array.isArray(raw.results) ? raw.results : []).map((r) => {
    const c = satirlariCoz(r.lines);
    const hata =
      r.ok === false
        ? [r.error, ...c.hatalar].filter(Boolean).join(' · ')
        : c.hatalar.join(' · ') || null;
    return {
      cluster: String(r.cluster || ''),
      namespace: String(r.namespace || ''),
      ok: r.ok !== false && c.bitti,
      hata: hata || null,
      ...c,
      podOzet: canliPodOzeti(c),
    };
  });
  return { genel: raw?.overall_status || null, hedefler: sonuc };
}

function hedefAnahtarlari(hedefler) {
  if (!Array.isArray(hedefler) || !hedefler.length) return null;
  const anahtarlar = hedefler.map((h) => {
    const cluster = h && typeof h.cluster === 'string' ? h.cluster.trim() : '';
    const namespace = h && typeof h.namespace === 'string' ? h.namespace.trim() : '';
    return cluster && namespace ? `${cluster}\u0000${namespace}` : '';
  });
  if (anahtarlar.some((x) => !x) || new Set(anahtarlar).size !== anahtarlar.length) return null;
  return anahtarlar.sort(varsayilanSira);
}

async function canliIsSahipligi(serverId, jobId) {
  const db = require('../db/index.cjs');
  const { rows } = await db.query(
    `SELECT TOP 2 template_id, template_name, params
       FROM ansible_job_history
      WHERE awx_server_id = $1 AND job_id = $2
      ORDER BY id DESC`,
    [serverId, jobId],
  );
  if (rows.length !== 1) return null;
  const row = rows[0];
  let params = null;
  try {
    params = JSON.parse(row.params);
  } catch {
    return null;
  }
  if (
    !Number.isInteger(Number(row.template_id)) ||
    Number(row.template_id) <= 0 ||
    row.template_name !== TEMPLATE_NAME ||
    params?.platform !== 'app-hub-ocp'
  )
    return null;
  const hedefler = hedefAnahtarlari(params.app_hub_targets);
  if (!hedefler || typeof params.app_hub_app !== 'string' || !params.app_hub_app) return null;
  return { app: params.app_hub_app, hedefler, templateId: Number(row.template_id) };
}

function canliArtifactDogrula(raw, sahiplik, ad) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    typeof raw.app !== 'string' ||
    raw.app !== ad ||
    !sahiplik ||
    sahiplik.app !== ad
  )
    return false;
  const hedefler = hedefAnahtarlari(raw.results);
  return (
    !!hedefler &&
    hedefler.length === sahiplik.hedefler.length &&
    hedefler.every((x, i) => x === sahiplik.hedefler[i])
  );
}

/** Uygulamanin envanterdeki yerlerinden is hedeflerini ve fan-out extra_vars'ini kurar. */
async function hedefleriKur(ad, yerler, secim) {
  const istenen =
    Array.isArray(secim) && secim.length
      ? new Set(secim.map((s) => `${L(s.cluster)}|${L(s.namespace)}`))
      : null;
  const hedefler = (yerler || [])
    .filter((y) => y.katalogda && (!istenen || istenen.has(`${L(y.cluster)}|${L(y.namespace)}`)))
    .slice(0, HEDEF_TAVAN);
  if (!hedefler.length) {
    throw Object.assign(
      new Error(
        "Okunacak (cluster, namespace) yok: uygulamanın cluster'ları Portal cluster kataloğunda tanımlı değil.",
      ),
      { status: 400 },
    );
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
    const ev = ocp.buildOcpExtraVars({
      env: g.env,
      tenant: g.tenant,
      clusters: clusters.filter((c) => !missing.includes(c)),
      hosts,
      meta,
    });
    for (const c of ev.ocp_clusters) ocpClusters.push(c);
    for (const t of ev.terminal_hosts) if (t) terminal.add(t);
  }
  if (eksik.length && !ocpClusters.length) {
    throw Object.assign(
      new Error(
        `Şu cluster'lar için Jump Server (bastion) tanımlı değil: ${eksik.join(', ')}. Admin > OCP Yapılandırma ekranından cluster satırına Jump Server girin.`,
      ),
      { status: 400 },
    );
  }
  const varOlan = new Set(ocpClusters.map((c) => L(c.cluster_name)));
  const runtime = ocp.buildOcpRuntimeVars(
    await require('../logx/v2/ocp-runtime-config.cjs')
      .getConfig()
      .catch(() => ({})),
  );
  return {
    extraVars: {
      ...runtime,
      terminal_hosts: [...terminal].sort(varsayilanSira),
      ocp_clusters: ocpClusters,
      app_hub_app: ad,
      app_hub_targets: hedefler
        .filter((h) => varOlan.has(L(h.cluster)))
        .map((h) => ({ cluster: h.cluster, namespace: h.namespace })),
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
    out.push({
      cluster: r.cluster,
      namespace: r.namespace,
      ok: !!r.ok,
      hata: r.hata || null,
      alanAd: r.alan_ad || null,
      alinma: r.alinma ? new Date(r.alinma).toISOString() : null,
      isNo: r.awx_job_id,
      ...(sonuc || {}),
    });
  }
  return out;
}

async function sonucuKaydet(ad, cozum, { serverId, jobId, kullanici, adSoyad }) {
  const db = require('../db/index.cjs');
  const hedefler = cozum.hedefler.map((h) => {
    const { cluster, namespace, ok, hata, ...govde } = h;
    return {
      cluster,
      namespace,
      sonuc_json: require('./filo.cjs').govdeJson({ notlar: [], podlar: [], ...govde }),
      ok: ok ? 1 : 0,
      hata: hata ? String(hata).slice(0, 2000) : null,
    };
  });
  const beklenen = hedefAnahtarlari(hedefler);
  return db.transaction(async (tx) => {
    const { rows: mevcut } = await tx.query(
      `SELECT uygulama, cluster, namespace FROM app_hub_ocp_canli WITH (UPDLOCK, HOLDLOCK)
        WHERE awx_server_id = $1 AND awx_job_id = $2`,
      [serverId, jobId],
    );
    if (mevcut.length) {
      const eski = hedefAnahtarlari(mevcut);
      if (
        !eski ||
        mevcut.some((x) => x.uygulama !== ad) ||
        eski.length !== beklenen.length ||
        eski.some((x, i) => x !== beklenen[i])
      ) {
        throw new Error('Application Hub canli sonucu kismi veya uyumsuz.');
      }
      return false;
    }
    const { rowCount } = await tx.query(
      `INSERT INTO app_hub_ocp_canli (uygulama, cluster, namespace, sonuc_json, ok, hata, alan_kullanici, alan_ad, awx_server_id, awx_job_id)
       SELECT $4, j.cluster, j.namespace, j.sonuc_json, j.ok, j.hata, $5, $6, $1, $2
         FROM OPENJSON($3) WITH (
           cluster NVARCHAR(128) '$.cluster', namespace NVARCHAR(256) '$.namespace',
           sonuc_json NVARCHAR(MAX) '$.sonuc_json', ok BIT '$.ok', hata NVARCHAR(2000) '$.hata'
         ) j`,
      [serverId, jobId, JSON.stringify(hedefler), ad, kullanici, adSoyad],
    );
    if (rowCount !== hedefler.length)
      throw new Error('Application Hub canli sonucu eksik yazildi.');
    return true;
  });
}

module.exports = {
  REGISTRY_KEY,
  STATS_KEY,
  HEDEF_TAVAN,
  TEMPLATE_NAME,
  statsOku,
  satirlariCoz,
  sonucuCoz,
  hedefleriKur,
  canliIsSahipligi,
  canliArtifactDogrula,
  sonOkumalar,
  sonucuKaydet,
};
