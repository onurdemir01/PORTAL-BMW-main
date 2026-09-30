#!/usr/bin/env node
// server/ansible/__tests__/fixtures/scalex-sahte-oc.cjs
//
// MODELDEN BESLENEN SAHTE `oc` — precheck/execute yolunu GERCEK betikle
// kosturmak icin. Bash stub'lari tek tek dal yazmayi gerektiriyordu ve
// precheck'in kullandigi bicimlerin (tek nesne, liste, `--no-headers` tablo,
// cok tipli jsonpath, ConfigMap alanlari, `auth can-i`) hepsini TUTARLI
// taklit etmek elle yazilmis dallarla guvenilir degildi: tek nesne ve liste
// ayni modelden uretilmezse "toplu okuma tekil okumayla ayni sonucu verir mi"
// sorusu HIC sinanamaz.
//
// GERCEK kubectl DAVRANISLARI (bilerek taklit edilen):
//   * Kaynak cozumlemesi SUNUCUYA GITMEDEN: tip yoksa
//     `error: the server doesn't have a resource type "<kaynak>"` ve cok tipli
//     cagrida HICBIR satir basilmaz.
//   * Yetki reddi tip BAZINDA: diger tiplerin satirlari yine basilir, rc=1.
//   * Tek tipli liste `{.kind}` yazmaz (TypeMeta yok); cok tipli yazar.
//
// Girdi: SAHTE_OC_MODEL (JSON dosyasi), SAHTE_OC_LOG (her cagri bir satir).
// Durum degisikligi (patch/create/apply/delete) modele GERI yazilir.
'use strict';

const fs = require('fs');

const args = process.argv.slice(2);
const MODEL_YOLU = process.env.SAHTE_OC_MODEL;
if (process.env.SAHTE_OC_LOG) fs.appendFileSync(process.env.SAHTE_OC_LOG, args.join(' ') + '\n');
const model = JSON.parse(fs.readFileSync(MODEL_YOLU, 'utf8'));
const kaydet = () => fs.writeFileSync(MODEL_YOLU, JSON.stringify(model));

const out = (s) => process.stdout.write(s);
const err = (s) => process.stderr.write(s);

// ── Tip cozumlemesi ─────────────────────────────────────────────────────────
const TIPLER = {
  dc: {
    adlar: ['dc', 'deploymentconfig', 'deploymentconfigs', 'deploymentconfigs.apps.openshift.io'],
    tam: 'deploymentconfigs.apps.openshift.io',
    kind: 'DeploymentConfig',
    tablo: 'deploymentconfig.apps.openshift.io',
  },
  deploy: {
    adlar: ['deploy', 'deployment', 'deployments', 'deployments.apps'],
    tam: 'deployments.apps',
    kind: 'Deployment',
    tablo: 'deployment.apps',
  },
  sts: {
    adlar: ['sts', 'statefulset', 'statefulsets', 'statefulsets.apps'],
    tam: 'statefulsets.apps',
    kind: 'StatefulSet',
    tablo: 'statefulset.apps',
  },
  rollout: {
    adlar: ['rollout', 'rollouts', 'rollouts.argoproj.io'],
    tam: 'rollouts.argoproj.io',
    kind: 'Rollout',
    tablo: 'rollout.argoproj.io',
  },
  ds: {
    adlar: ['ds', 'daemonset', 'daemonsets', 'daemonsets.apps'],
    tam: 'daemonsets.apps',
    kind: 'DaemonSet',
    tablo: 'daemonset.apps',
  },
  cronjob: {
    adlar: ['cronjob', 'cronjobs', 'cronjobs.batch'],
    tam: 'cronjobs.batch',
    kind: 'CronJob',
    tablo: 'cronjob.batch',
  },
};
function tipBul(ad) {
  for (const [k, t] of Object.entries(TIPLER)) if (t.adlar.includes(ad)) return k;
  // KESFEDILEN CRD (`model.crdler`): kodu tam kaynak adinin kendisi.
  if (model.crdler && model.crdler[ad]) return ad;
  return null;
}
function tipBilgi(k) {
  return TIPLER[k] || { tam: k, kind: model.crdler[k].kind, tablo: k };
}
function yokMu(k) {
  return (model.yokTipler || []).includes(k);
}
function yasakMi(k) {
  return (model.yasakTipler || []).includes(k);
}
// Gercek RBAC'ta `list` ve `get` AYRI fiillerdir: listelenemeyen bir tipte
// adiyla okuma serbest olabilir.
function listeYasakMi(k) {
  return (model.listeYasakTipler || []).includes(k);
}
function nesneler(k) {
  if (model.crdler && model.crdler[k]) return model.crdler[k].nesneler || [];
  return (model.nesneler && model.nesneler[k]) || [];
}

// ── Mini jsonpath: betigin kullandigi alt kume ──────────────────────────────
function yol(obj, p) {
  // `.metadata.labels['a\.b']` bicimi de dahil.
  const parcalar = [];
  const re = /\.([A-Za-z0-9_]+)|\['((?:[^'\\]|\\.)*)'\]|\[(\d+)\]/g;
  let m;
  while ((m = re.exec(p)))
    parcalar.push(m[1] ?? (m[2] !== undefined ? m[2].replace(/\\\./g, '.') : Number(m[3])));
  let v = obj;
  for (const x of parcalar) {
    if (v === undefined || v === null) return '';
    v = v[x];
  }
  return v === undefined || v === null ? '' : String(v);
}
function jsonpath(sablon, kok) {
  // Suslu parantez DISINDAKI metin de duz yazidir (`{.a}|{.b}`): JSON dizesi
  // olarak token listesine eklenir.
  const tokenler = [];
  const re = /\{([^{}]*)\}/g;
  let m;
  let son = 0;
  while ((m = re.exec(sablon))) {
    if (m.index > son) tokenler.push(JSON.stringify(sablon.slice(son, m.index)));
    tokenler.push(m[1]);
    son = re.lastIndex;
  }
  if (son < sablon.length) tokenler.push(JSON.stringify(sablon.slice(son)));
  // Agac: { range, govde } ya da duz token.
  let i = 0;
  function ayristir() {
    const dugumler = [];
    while (i < tokenler.length) {
      const t = tokenler[i++];
      if (t === 'end') return dugumler;
      if (t.startsWith('range ')) dugumler.push({ range: t.slice(6).trim(), govde: ayristir() });
      else dugumler.push(t);
    }
    return dugumler;
  }
  function degerlendir(dugumler, o) {
    let s = '';
    for (const d of dugumler) {
      if (typeof d === 'object') {
        let liste = [];
        if (d.range === '.items[*]') liste = o.items || [];
        else {
          const f = /^\.items\[\?\(@(\.[^=]+)=="([^"]*)"\)\]$/.exec(d.range);
          if (f) liste = (o.items || []).filter((x) => yol(x, f[1]) === f[2]);
        }
        for (const x of liste) s += degerlendir(d.govde, x);
      } else if (d.startsWith('"')) s += JSON.parse(d);
      else s += yol(o, d);
    }
    return s;
  }
  return degerlendir(ayristir(), kok);
}

// ── Tablo satirlari (`--no-headers`) — tek nesne ve liste AYNI satiri uretir ─
function tabloSatiri(k, o) {
  const d = durumOku(o);
  if (k === 'dc') return `${o.name}   ${o.rev || 1}   ${o.spec}   ${d.status}   config`;
  return `${o.name}   ${d.ready}/${o.spec}   ${d.status}   ${d.ready}   5d`;
}
// ── YAKINSAMA: patch sonrasi pod'lar hedefe GECIKMEYLE ulasir ──────────────
// `gecikme: N` -> patch'ten sonraki N okumada eski durum gorunur, sonra hedef.
// `takili: true` -> hic yakinsamaz (WARN/FAIL esikleri). Her okuma modeli
// gunceller; toplu ve tekil okuma AYNI sayaci tuketir (ayni cluster gibi).
let modelDegisti = false;
function durumOku(o) {
  if (o._eski && (o.takili || o._kalan > 0)) {
    if (!o.takili) o._kalan -= 1;
    modelDegisti = true;
    return o._eski;
  }
  if (o._eski) {
    // `hazirTakili`: pod'lar OLUSUR (status hedefte) ama HAZIR olmaz — acma
    // olcutunun "ready de hedefte" sartini sinar.
    o.ready = o.hazirTakili ? o._eski.ready : o.spec;
    delete o._eski;
    o.status = o.spec;
    modelDegisti = true;
  }
  return { status: o.status ?? o.spec, ready: o.ready ?? o.status ?? o.spec };
}
process.on('exit', () => {
  if (modelDegisti) kaydet();
});

function kubeNesne(k, o, kindYaz) {
  const d = durumOku(o);
  return {
    ...(kindYaz ? { kind: tipBilgi(k).kind } : {}),
    metadata: { name: o.name, labels: o.labels || {} },
    // `hamSpec`/`hamStatus`: tipe ozgu alanlar (DaemonSet sayaclari, CronJob
    // `suspend`/`schedule`/`jobTemplate`).
    spec: {
      replicas: o.spec,
      template: { spec: { containers: [{ image: o.image || 'img:1' }] } },
      ...(o.hamSpec || {}),
    },
    status: { replicas: d.status, readyReplicas: d.ready, ...(o.hamStatus || {}) },
  };
}
function hpaSatiri(h) {
  return `${h.name}   ${h.kind || 'Deployment'}/${h.target}   <unknown>/80%   1   3   1   5d`;
}
function hpaNesne(h) {
  return {
    metadata: { name: h.name },
    spec: { scaleTargetRef: { name: h.target }, minReplicas: 1, maxReplicas: 3 },
  };
}

function secenek(ad) {
  const i = args.indexOf(ad);
  if (i >= 0) return args[i + 1];
  const e = args.find((a) => a.startsWith(ad + '='));
  return e ? e.slice(ad.length + 1) : undefined;
}
function jp() {
  const o = secenek('-o');
  if (o && o.startsWith('jsonpath=')) return o.slice('jsonpath='.length);
  const j = args.find((a) => a.startsWith('jsonpath='));
  return j ? j.slice('jsonpath='.length) : null;
}
const noHeaders = args.includes('--no-headers');

// ── Komutlar ────────────────────────────────────────────────────────────────
const [k1, k2] = args;
if (k1 === 'version') {
  out('Client Version: 4.14.0\n');
  process.exit(0);
}
if (k1 === 'login' || k1 === 'project') process.exit(0);
if (k1 === 'auth' && k2 === 'can-i') {
  const fiil = args[2];
  const kaynak = args[3];
  const tk = tipBul(kaynak) || kaynak;
  const red = (model.canIRed || []).includes(`${fiil} ${tk}`);
  out(red ? 'no\n' : 'yes\n');
  process.exit(red ? 1 : 0);
}

function workloadGet() {
  const hedef = args[1];
  const adli = args[2] && !args[2].startsWith('-') ? args[2] : null;
  const tipler = hedef.split(',');
  const kodlar = tipler.map(tipBul);
  // Kaynak cozumlemesi: bilinmeyen/yok tip -> hicbir sey basilmaz.
  for (let i = 0; i < tipler.length; i++) {
    if (!kodlar[i] || yokMu(kodlar[i])) {
      err(`error: the server doesn't have a resource type "${tipler[i].split('.')[0]}"\n`);
      process.exit(1);
    }
  }
  const coklu = tipler.length > 1;
  // `yavas: { <tip kodu>: ms }` — TEK tipli okuma bekletilir ve SAHTE_OC_IZ'e
  // BASLA/BITTI yazilir: tekil cekimlerin AYNI ANDA kostugunu kanitlamak icin
  // (duvar saati degil, iz ic ice mi).
  const yavasMs = !coklu && model.yavas ? model.yavas[kodlar[0]] : 0;
  if (yavasMs) {
    const iz = process.env.SAHTE_OC_IZ;
    if (iz) fs.appendFileSync(iz, `BASLA ${kodlar[0]}\n`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, yavasMs);
    if (iz) fs.appendFileSync(iz, `BITTI ${kodlar[0]}\n`);
  }
  let rc = 0;
  const sablon = jp();
  let buf = '';
  for (let i = 0; i < kodlar.length; i++) {
    const k = kodlar[i];
    if (yasakMi(k) || (!adli && listeYasakMi(k))) {
      // Gercek kubectl metni: kaynak TAM adiyla (`deployments.apps`) basta.
      const tam = tipBilgi(k).tam;
      const nokta = tam.indexOf('.');
      err(
        `Error from server (Forbidden): ${tam} is forbidden: User "u" cannot list resource ` +
          `"${nokta < 0 ? tam : tam.slice(0, nokta)}" in API group "${nokta < 0 ? '' : tam.slice(nokta + 1)}" ` +
          `in the namespace "${secenek('-n') || ''}"\n`,
      );
      rc = 1;
      continue;
    }
    if (adli) {
      const o = nesneler(k).find((x) => x.name === adli);
      if (!o) {
        err(`Error from server (NotFound): ${tipBilgi(k).tam} "${adli}" not found\n`);
        rc = 1;
        continue;
      }
      if (sablon !== null) buf += jsonpath(sablon, kubeNesne(k, o, false));
      else if (noHeaders) buf += tabloSatiri(k, o) + '\n';
      else buf += `${tipBilgi(k).tablo}/${o.name}\n`;
    } else {
      const liste = nesneler(k);
      // `kindYok`: TypeMeta yazmayan bir `oc` surumu (atif dogrulamasini sinar).
      if (sablon !== null)
        buf += jsonpath(sablon, {
          items: liste.map((o) => kubeNesne(k, o, coklu && !model.kindYok)),
        });
      else
        for (const o of liste)
          buf +=
            (noHeaders && !coklu ? tabloSatiri(k, o) : `${tipBilgi(k).tablo}/${o.name}   x`) + '\n';
    }
  }
  out(buf);
  process.exit(rc);
}

function cmGet() {
  const cmler = model.cm || {};
  const ad = args[2] && !args[2].startsWith('-') ? args[2] : null;
  const sablon = jp();
  if (ad) {
    if (!cmler[ad]) {
      err(`Error from server (NotFound): configmaps "${ad}" not found\n`);
      process.exit(1);
    }
    if (sablon !== null) out(jsonpath(sablon, { metadata: { name: ad }, data: cmler[ad] }));
    else out(`${ad}   ${Object.keys(cmler[ad]).length}   1d\n`);
    process.exit(0);
  }
  if (model.cmListeYasak) {
    err('Error from server (Forbidden): configmaps is forbidden: User cannot list resource\n');
    process.exit(1);
  }
  const items = Object.entries(cmler).map(([n, d]) => ({ metadata: { name: n }, data: d }));
  if (sablon !== null) out(jsonpath(sablon, { items }));
  else for (const i of items) out(`${i.metadata.name}   1   1d\n`);
  process.exit(0);
}

function hpaGet() {
  const hpalar = model.hpa || [];
  const ad = args[2] && !args[2].startsWith('-') ? args[2] : null;
  const sablon = jp();
  if (ad) {
    const h = hpalar.find((x) => x.name === ad);
    if (!h) {
      err(`Error from server (NotFound): horizontalpodautoscalers.autoscaling "${ad}" not found\n`);
      process.exit(1);
    }
    if (sablon !== null) out(jsonpath(sablon, hpaNesne(h)));
    else out(hpaSatiri(h) + '\n');
    process.exit(0);
  }
  if (model.hpaListeYasak) {
    err('Error from server (Forbidden): horizontalpodautoscalers.autoscaling is forbidden\n');
    process.exit(1);
  }
  if (sablon !== null) out(jsonpath(sablon, { items: hpalar.map(hpaNesne) }));
  else for (const h of hpalar) out(hpaSatiri(h) + '\n');
  process.exit(0);
}

function podGet() {
  for (const p of model.pods || []) out(`${p}   1/1   Running   0   1d\n`);
  process.exit(0);
}

if (k1 === 'get') {
  if (k2 === 'cm' || k2 === 'configmap' || k2 === 'configmaps') cmGet();
  if (k2 === 'hpa') hpaGet();
  if (k2 === 'pods') podGet();
  if (k2 === 'pdb') {
    for (const p of model.pdb || []) out(`${p}   1   N/A   0   5d\n`);
    process.exit(0);
  }
  workloadGet();
}

// ── Mutasyonlar (execute icin) ──────────────────────────────────────────────
if (k1 === 'patch') {
  const k = tipBul(args[1]);
  const o = k && nesneler(k).find((x) => x.name === args[2]);
  const p = JSON.parse(secenek('-p'));
  if (args[1] === 'cm') {
    const cm = (model.cm || {})[args[2]];
    if (!cm) process.exit(1);
    Object.assign(cm, p.data || {});
    kaydet();
    process.exit(0);
  }
  if (args[1] === 'hpa') {
    model.hpaPin = [...(model.hpaPin || []), `${args[2]}=${JSON.stringify(p.spec)}`];
    kaydet();
    process.exit(0);
  }
  if (!o || (model.patchRed || []).includes(k)) process.exit(1);
  const d = durumOku(o);
  o._eski = { status: d.status, ready: d.ready };
  o._kalan = o.gecikme ?? 0;
  o.spec = p.spec.replicas;
  kaydet();
  process.exit(0);
}
if (k1 === 'delete' && k2 === 'cm') {
  delete (model.cm || {})[args[2]];
  kaydet();
  process.exit(0);
}
if (k1 === 'create' || k1 === 'apply') {
  // `oc create cm ... --dry-run=client -o yaml | oc apply -f -` hattinin iki ucu.
  if (k1 === 'create') {
    const ad = args[2];
    const data = {};
    for (const a of args) {
      const m = /^--from-literal=([^=]+)=(.*)$/.exec(a);
      if (m) data[m[1]] = m[2];
    }
    out(JSON.stringify({ ad, data }));
    process.exit(0);
  }
  const girdi = fs.readFileSync(0, 'utf8');
  if (model.cmYazmaRed) process.exit(1);
  try {
    const { ad, data } = JSON.parse(girdi);
    model.cm = model.cm || {};
    model.cm[ad] = { ...(model.cm[ad] || {}), ...data };
    kaydet();
    process.exit(0);
  } catch {
    process.exit(1);
  }
}
process.exit(1);
