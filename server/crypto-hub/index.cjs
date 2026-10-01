// server/crypto-hub/index.cjs — Crypto Hub (2026-09-25).
//
// Kullanici: "ekibimizin yonettigi ucuncu parti uygulamalardan ikisi (Metaco, Wyden) icin
// gelistirici ve rezilyans ekiplerine Portal'dan bir arayuz sunmak istiyorum. Kullanici once
// hangi domainde ve hangi ortamda islem yapacagini secsin."
//
// FAZ 1 = DURUM + SURUMLER, salt okunur. Veri kaynagi bmw_automation_folder/crypto_hub
// taramasi -> dbo.Crypto_Hub_* tablolari. Bu modul yalniz OKUR ve bir de taramayi tetikler.
//
// "OLCULEMEDI" ILE "YOK" AYRI (taramadan devralinan sozlesme): registry kimligi verilmediyse
// ya da bir asama dustuyse Crypto_Hub_Notes'ta NOTE/ERR satiri olur; ekran bunu "olculemedi"
// diye gosterir, "yeni surum yok" DEMEZ.
'use strict';

const express = require('express');
const {
  CRYPTO_TENANTS,
  tenantOf,
  selectionTree,
  isOpen,
} = require('../../shared/cryptoHubTenants.cjs');

// Production simdilik kapali (kullanici, 2026-09-26). Ekran zaten sectirmiyor; bu kontrol
// DOGRUDAN API cagrisini de keser - aksi halde "kapali" yalnizca gorsel bir suslemeden ibaret
// olurdu.
const CLOSED_MSG = "Production ortamları Crypto Hub'da şimdilik kapalı.";

const { ACTIONS, actionOf, buildPlan } = require('../../shared/cryptoHubActions.cjs');

const OPS_KEY = 'crypto_hub_ops';

// Hangi islem OKUR, hangisi YAZAR. Bu ayrim tek yerde durur: ekran da, sunucu kapisi da
// buradan okur (ikinci bir liste tutmak, bir gun yazan bir islemi "okur" sanmaya yol acardi).
const OPS = {
  pods: { writes: false },
  logs: { writes: false },
  values_get: { writes: false },
  // WYDEN AKTIF-PASIF (2026-09-27, kullanici): her ortam icin AYRI cluster'lara ozgu
  // values dosyalari var (non-prod 2, prod 3). values_get CALISAN release'i okur - tek
  // cluster. Bu ise bastion diskindeki cluster dosyalarini okur ki BIRBIRIYLE
  // karsilastirilabilsinler: ayni surumun dosyalari sessizce ayrisirsa, aktif-pasif
  // devrinde uygulama baska bir konfigurasyonla acilir.
  values_files: { writes: false },
  // helm_template SALT OKUNUR: manifest URETIR, kumeye dokunmaz. Onizlemenin yazan
  // sayilmasi, "once bakayim" diyen kullaniciya gereksiz bir onay penceresi acardi.
  helm_template: { writes: false },
  // values_diff SALT OKUNUR: canli degerler ile uygulanacak dosyayi AYNI iste yan yana
  // okur. Iki ayri iste okunsa, arada degisen bir dosya "fark yok" gibi gorunebilirdi.
  values_diff: { writes: false },
  // Gecmis ZATEN diskte duruyordu (values_put her yazmadan once .bak birakir); bu islem
  // onu gorunur kilar. Salt okunur.
  values_backups: { writes: false },
  // Geri yukleme YAZAR: dosyanin uzerine yazar (once mevcut halin yedegini alarak).
  values_restore: { writes: true },
  configmaps: { writes: false },
  configmap_get: { writes: false },
  // configmap_put YAZAR ama POD'LARI YENIDEN BASLATMAZ: "kaydedildi" ile "yururluge girdi"
  // ayri seylerdir; ekran rollout gerektigini ayrica soyler (shared/cryptoHubConfigMaps.cjs).
  configmap_put: { writes: true },
  // helm_upgrade YAZAR: kosan release'i yeniden uygular. Surum DEGISMEZ - bunu betik de
  // ayrica dogrular (Portal'in bildigi surum ile gercek kosan surum tutmuyorsa durur).
  helm_upgrade: { writes: true },
  pod_delete: { writes: true },
  rollout: { writes: true },
  scale: { writes: true },
  // values_put dosyayi degistirir (yedegini alarak); tek basina kumeye dokunmaz ama
  // ardindan gelen upgrade onu kullanir - bu yuzden YAZAN sayilir ve onay ister.
  values_put: { writes: true },
};

// SIR MASKELEME. values.yaml icinde veritabani parolasi, token, keystore sifresi bulunur.
// Varsayilan gorunum MASKELIDIR; ham icerik yalnizca kullanici acikca "Duzenle" dedigi
// zaman gonderilir ve bu istek denetim kaydina yazilir. Duzenlenemeyecek bir metni
// duzenletmek anlamsiz oldugu icin maskeyi tamamen zorunlu kilmiyoruz; ama varsayilan
// GORME degil, KORUMA tarafinda duruyor.
const SIR_ANAHTARI =
  /(pass|passwd|password|pwd|secret|token|apikey|api_key|accesskey|access_key|credential|keystore|truststore|private[_-]?key)/i;

/** `anahtar: deger` satirlarinda sir gorunen degerleri yildizlar. Yorumlara dokunmaz. */
function maskValues(lines) {
  return (lines || []).map((raw) => {
    const l = String(raw == null ? '' : raw);
    const m = l.match(/^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.+?)\s*$/);
    if (!m) return l;
    const [, girinti, anahtar, deger] = m;
    if (!SIR_ANAHTARI.test(anahtar)) return l;
    if (deger === '|' || deger === '>' || deger === '{}' || deger === '[]' || deger === 'null')
      return l;
    return `${girinti}${anahtar}: ****`;
  });
}

// k8s ad deseni (istege bagli tur oneki). Betikte AYNI denetim var - burasi ilk kapi.
const TARGET_RE = /^((deployment|statefulset|pod)\/)?[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;
const MAX_TARGETS = 50;

/**
 * helm_upgrade / helm_template icin chart referansi. Katalogdan cozulur, ISTEMCIDEN DEGIL.
 *
 * Wyden: klasik helm deposu alias'i (`wyden/wyden`) + `--version <kosan>` ile sabitlenir.
 * Metaco: runbook chart'i BASTION DISKINDEKI bir DIZINDEN kuruyor (`./harmonize/`) ve dogru
 * dizin kosan surumun arsiv dizinine bagli. Bunu tahmin etmek, yanlis surumu "ayni surum"
 * diye uygulamak demek olurdu - o yuzden Metaco icin chart cozulmez ve ozellik ACILMAZ;
 * ekran komutu gostermeye devam eder. ("olculemedi" ile "yok" ayrimi burada da gecerli.)
 */
function chartRefOf(tenant) {
  const ad = String(tenant?.chartName || '').trim();
  return ad || '';
}

function normalizeOps(body) {
  const action = String(body?.action || '').trim();
  if (!OPS[action]) throw new Error(`Bilinmeyen işlem: ${action}`);
  const writes = OPS[action].writes;

  const targets = [];
  for (const raw of Array.isArray(body?.targets) ? body.targets : []) {
    const t = String(raw || '').trim();
    if (!t) continue;
    if (!TARGET_RE.test(t)) throw new Error(`Geçersiz hedef adı: ${t}`);
    if (!targets.includes(t)) targets.push(t);
  }
  if (targets.length > MAX_TARGETS)
    throw new Error(`En fazla ${MAX_TARGETS} hedef seçilebilir (seçilen: ${targets.length}).`);
  // BOS HEDEFLE YAZAN ISLEM KOSMAZ: "hepsi" anlamina gelen bir bosluk, bu ekranda en
  // tehlikeli hatadir (tum namespace'i sondurmek).
  // values_put ve helm_upgrade'de "hedef" bir k8s nesnesi DEGIL: biri DOSYA YOLU, oteki
  // HELM RELEASE'idir; ikisi de asagida ayrica dogrulanir.
  const hedefsiz = ['values_put', 'helm_upgrade', 'values_restore', 'configmap_put'];
  if (writes && !hedefsiz.includes(action) && targets.length === 0)
    throw new Error('Hedef seçilmedi.');
  if (action === 'logs' && targets.length === 0)
    throw new Error('Log için en az bir pod seçilmeli.');
  if (action === 'pod_delete' && targets.some((t) => t.includes('/') && !t.startsWith('pod/'))) {
    throw new Error(
      'Pod silme yalnız pod hedefi alır; deployment/statefulset için rollout kullanın.',
    );
  }
  if (
    (action === 'rollout' || action === 'scale') &&
    targets.some((t) => !/^(deployment|statefulset)\//.test(t))
  ) {
    throw new Error(`${action} için hedef deployment/<ad> veya statefulset/<ad> olmalı.`);
  }

  const out = { action, writes, targets };
  if (action === 'logs') {
    const tail = Number(body?.tail);
    out.tail = Number.isFinite(tail) ? Math.min(Math.max(Math.trunc(tail), 1), 5000) : 200;
    out.container =
      String(body?.container || '')
        .trim()
        .slice(0, 64) || '';
    out.previous = body?.previous === true;
  }
  if (action === 'values_get') {
    out.release = String(body?.release || '')
      .trim()
      .slice(0, 128);
    if (!out.release) throw new Error('Helm release adı gerekli.');
    out.valuesAll = body?.valuesAll === true;
    // Ham (maskesiz) icerik yalnizca ACIKCA istenirse doner ve denetime yazilir.
    out.reveal = body?.reveal === true;
  }
  if (action === 'values_files') {
    const ham = Array.isArray(body?.valuesPaths) ? body.valuesPaths : [];
    if (!ham.length) throw new Error('Karşılaştırılacak dosya seçilmedi.');
    if (ham.length > 8) throw new Error('Tek seferde en fazla 8 dosya karşılaştırılabilir.');
    const yollar = [];
    for (const x of ham) {
      const y = String(x || '').trim();
      // Satir sonu listeyi IKIYE bolerdi: betige satir basina bir yol gidiyor.
      if (!y || /[\r\n\0]/.test(y)) throw new Error('Geçersiz karakter içeren yol.');
      if (!/^\/vhosting\/[^\0]*$/.test(y) || y.includes('..')) {
        throw new Error(`values dosyası /vhosting altında olmalı ve yolunda .. bulunmamalı: ${y}`);
      }
      yollar.push(y);
    }
    out.valuesPaths = [...new Set(yollar)];
    // Ham (maskesiz) icerik yalnizca ACIKCA istenirse doner ve denetime yazilir.
    out.reveal = body?.reveal === true;
  }
  if (action === 'configmap_get' || action === 'configmap_put') {
    out.cmName = String(body?.cmName || '').trim();
    // k8s nesne adi deseni: betikte de AYNI denetim var - burasi ilk kapi.
    if (!/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/.test(out.cmName)) {
      throw new Error(`Geçersiz config map adı: ${out.cmName}`);
    }
    if (action === 'configmap_put') {
      const veri = body && body.data;
      if (!veri || typeof veri !== 'object' || Array.isArray(veri)) {
        throw new Error('Config map verisi gerekli.');
      }
      const anahtarlar = Object.keys(veri);
      if (!anahtarlar.length) throw new Error('Değiştirilecek anahtar seçilmedi.');
      if (anahtarlar.length > 100) throw new Error('Tek seferde en fazla 100 anahtar yazılabilir.');
      for (const k of anahtarlar) {
        // k8s config map anahtar deseni. Gecersiz anahtar patch'i tumden reddettirir;
        // once burada durdurmak, yarim uygulanmis bir degisiklikten iyidir.
        if (!/^[-._a-zA-Z0-9]+$/.test(k)) throw new Error(`Geçersiz anahtar adı: ${k}`);
        const d = veri[k];
        // null = anahtari SIL (merge patch kurali). Baska tur kabul edilmez.
        if (d !== null && typeof d !== 'string')
          throw new Error(`Anahtar değeri metin olmalı: ${k}`);
        if (typeof d === 'string' && d.length > 512 * 1024) {
          throw new Error(`Anahtar 512 KB sınırını aşıyor: ${k}`);
        }
      }
      // MASKELI ICERIK GERI YAZILMAZ: '****' yazmak gercek degeri silmek olurdu.
      for (const k of anahtarlar) {
        if (typeof veri[k] === 'string' && /^\*{4}$/.test(veri[k].trim())) {
          throw new Error(`Maskelenmiş değer kaydedilemez: ${k} — önce gerçek değerleri gösterin.`);
        }
      }
      out.cmData = veri;
    }
  }

  if (action === 'values_backups') {
    out.valuesPath = String(body?.valuesPath || '').trim();
    if (!/^\/vhosting\/[^\0]*$/.test(out.valuesPath) || out.valuesPath.includes('..')) {
      throw new Error('values dosyası /vhosting altında olmalı ve yolunda .. bulunmamalı.');
    }
  }

  if (action === 'values_restore') {
    out.valuesPath = String(body?.valuesPath || '').trim();
    out.backupPath = String(body?.backupPath || '').trim();
    for (const y of [out.valuesPath, out.backupPath]) {
      if (!/^\/vhosting\/[^\0]*$/.test(y) || y.includes('..')) {
        throw new Error('Dosya yolları /vhosting altında olmalı ve yolunda .. bulunmamalı.');
      }
    }
    // YEDEK, HEDEF DOSYANIN KENDI YEDEGI OLMALI. Betikte de ayni kapi var; burada da
    // duruyor cunku bu kontrol olmasa islem "herhangi bir dosyayi herhangi bir yerin
    // uzerine kopyala"ya donusurdu ve tek bir kapinin dusmesi yeterdi.
    if (!out.backupPath.startsWith(`${out.valuesPath}.`) || !out.backupPath.endsWith('.bak')) {
      throw new Error('Seçilen yedek bu dosyaya ait değil.');
    }
  }

  if (action === 'helm_upgrade' || action === 'helm_template' || action === 'values_diff') {
    out.release = String(body?.release || '').trim();
    if (!out.release) throw new Error('Helm release adı gerekli.');
    out.valuesPath = String(body?.valuesPath || '').trim();
    if (!/^\/vhosting\/[^\0]*$/.test(out.valuesPath) || out.valuesPath.includes('..')) {
      throw new Error('values dosyası /vhosting altında olmalı ve yolunda .. bulunmamalı.');
    }
    // CHART ve SURUM ISTEMCIDEN ALINMAZ. Ikisi de sunucuda cozulur (katalog + tarama):
    // aksi halde "yalniz values degisecek" diyen bir istek, govdesine baska bir chart ya
    // da baska bir surum yazarak SESSIZCE bambaska bir sey uygulayabilirdi.
    out.chartRef = '';
    out.expectVersion = '';
  }

  if (action === 'values_put') {
    out.valuesPath = String(body?.valuesPath || '').trim();
    if (!/^\/vhosting\/[^\0]*$/.test(out.valuesPath) || out.valuesPath.includes('..')) {
      throw new Error('values dosyası /vhosting altında olmalı ve yolunda .. bulunmamalı.');
    }
    const icerik = String(body?.content || '');
    if (!icerik.trim()) throw new Error('values içeriği boş olamaz.');
    if (icerik.length > 512 * 1024) throw new Error('values içeriği 512 KB sınırını aşıyor.');
    // MASKELENMIS METIN KAYDEDILEMEZ: "****" yazan bir dosya, gercek parolayi silerdi.
    if (/:\s*\*{4}\s*$/m.test(icerik)) {
      throw new Error(
        'İçerikte maskelenmiş (****) değer var — maskeli metin kaydedilemez. Önce "Gerçek değerleri göster" ile açın.',
      );
    }
    out.content = icerik;
  }
  if (action === 'scale') {
    const r = Number(body?.replicas);
    if (!Number.isFinite(r) || r < 0 || r > 50 || Math.trunc(r) !== r) {
      throw new Error('Replika sayısı 0-50 arasında bir tam sayı olmalı.');
    }
    out.replicas = r;
  }
  return out;
}

/** Betigin TAB ayrilmis satirlarini ekranin anlayacagi bicime cevirir. */
function parseOpsLines(lines) {
  if (!Array.isArray(lines)) return null;
  const pods = [];
  const logs = [];
  const results = [];
  const errors = [];
  const values = [];
  // Dosya basina satirlar: VFBEG boyut, VF icerik, VFEND bitis, VFERR okunamadi.
  const files = new Map();
  // helm_upgrade: route listesi ONCE ve SONRA. Runbook "upgrade bazen route siliyor" diyor;
  // bu bir UYARI olarak kalmasin diye OLCULUYOR - ekran kaybolani gosterir.
  const routes = { once: [], sonra: [] };
  // helm_template: uretilecek nesneler (ozet) + ham manifest.
  const template = { objects: [], lines: [] };
  // values_backups: bir values dosyasinin .bak surumleri (en yenisi basta).
  const backups = [];
  // configmaps: namespace'teki config map ozetleri. configmap_get: anahtar -> deger
  // (deger BASE64 tasinir; config map degerleri cok satirli olabiliyor).
  const configMaps = [];
  const configMapData = new Map();
  // Kiraci anahtari cikti satirlarinin 2. alanindadir; rollout eslesmesi uygulamaya
  // (metaco/wyden) bagli oldugu icin sonuca tasinir.
  let tenantKey = '';
  for (const raw of lines) {
    const f = String(raw == null ? '' : raw).split('\t');
    if (!tenantKey && f.length > 1 && f[1]) tenantKey = String(f[1]).trim();
    switch (f[0]) {
      case 'VFBEG':
        if (f.length >= 3) {
          files.set(f[2], { path: f[2], size: Number(f[3] || 0), lines: [], error: null });
        }
        break;
      case 'VF':
        if (f.length >= 3) {
          if (!files.has(f[2])) files.set(f[2], { path: f[2], size: 0, lines: [], error: null });
          // f[3] bos olabilir (bos satir); slice(3).join korur cunku icerikte sekme olabilir.
          files.get(f[2]).lines.push(f.slice(3).join('\t'));
        }
        break;
      case 'VFEND':
        break;
      case 'ROUTE': {
        const faz = (f[2] || '').trim();
        const ad = (f[3] || '').trim();
        if (ad && (faz === 'once' || faz === 'sonra')) routes[faz].push(ad);
        break;
      }
      case 'CM':
        if (f.length >= 3) {
          configMaps.push({
            name: f[2],
            keys: Number(f[3] || 0),
            createdAt: (f[4] || '').trim(),
            managedBy: (f[5] || '').trim(),
          });
        }
        break;
      case 'CMK':
        if (f.length >= 5) {
          let deger = '';
          try {
            deger = Buffer.from(f[4] || '', 'base64').toString('utf8');
          } catch {
            deger = '';
          }
          configMapData.set(f[3], deger);
        }
        break;
      case 'BAK':
        if (f.length >= 3) {
          backups.push({ path: f[2], size: Number(f[3] || 0), mtime: (f[4] || '').trim() });
        }
        break;
      case 'TPLO':
        template.objects.push({ kind: (f[2] || '?').trim(), name: (f[3] || '?').trim() });
        break;
      case 'TPL':
        template.lines.push(f.slice(2).join('\t'));
        break;
      case 'VFERR':
        if (f.length >= 3) {
          files.set(f[2], { path: f[2], size: 0, lines: [], error: f[3] || 'okunamadı' });
        }
        break;
      case 'POD':
        if (f.length >= 8) {
          pods.push({
            name: f[2],
            phase: f[3],
            // "true,false," -> hazir olmayan kap var mi
            ready: String(f[4] || '')
              .split(',')
              .filter(Boolean)
              .every((v) => v === 'true'),
            containers: String(f[4] || '')
              .split(',')
              .filter(Boolean).length,
            restarts: String(f[5] || '')
              .split(',')
              .filter(Boolean)
              .reduce((a, v) => a + (Number(v) || 0), 0),
            startedAt: f[6] || '',
            node: f[7] || '',
          });
        }
        break;
      case 'LOG':
        if (f.length >= 4) logs.push({ target: f[2], line: f.slice(3).join('\t') });
        break;
      case 'VAL':
        // Satirda TAB olabilir (YAML girintisi degil ama olabilir): bastaki 3 alandan
        // sonrasi OLDUGU GIBI korunur.
        if (f.length >= 4) values.push(f.slice(3).join('\t'));
        break;
      case 'RES':
        if (f.length >= 5) results.push({ target: f[2], ok: f[3] === 'ok', message: f[4] });
        break;
      case 'ERR':
        if (f.length >= 4) errors.push({ stage: f[2], message: f[3] });
        break;
      default:
        break;
    }
  }
  return {
    pods,
    logs,
    results,
    errors,
    values,
    files: [...files.values()],
    routes,
    template,
    backups: backups.sort((a, b) => String(b.mtime).localeCompare(String(a.mtime))),
    tenantKey,
    configMaps,
    configMapData: [...configMapData.entries()].map(([key, value]) => ({ key, value })),
  };
}

const REGISTRY_KEY = 'crypto_hub_inventory';

// Son tarama okumasi 1-2 sn surer; ekran her sekme degisiminde DB'yi yormasin.
let _cache = { at: 0, key: '', value: null };
const CACHE_MS = 60 * 1000;

/** Surum karsilastirmasi: kosan chart surumu vs registry etiketleri.
 *  Semantik siralama (1.9 < 1.10) - metin siralamasi yanlis "en yeni" verirdi. */
function cmpVersion(a, b) {
  const pa = String(a).split(/[.-]/);
  const pb = String(b).split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = Number(pa[i]);
    const y = Number(pb[i]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      if (x !== y) return x - y;
    } else {
      const sx = pa[i] || '';
      const sy = pb[i] || '';
      if (sx !== sy) return sx < sy ? -1 : 1;
    }
  }
  return 0;
}

async function loadTenant(tenant) {
  const { query, sql } = require('../inventory/mssql.cjs');
  const p = [{ name: 't', type: sql.NVarChar(64), value: tenant.key }];
  const son = (table) => `(SELECT MAX(scan_date) FROM ${table} WHERE tenant_key = @t)`;

  const [comp, rel, tag, note, arch] = await Promise.all([
    query(
      `SELECT kind, name, want, ready, image, version, scanned_at
             FROM dbo.Crypto_Hub_Components
            WHERE tenant_key = @t AND scan_date = ${son('dbo.Crypto_Hub_Components')}
            ORDER BY kind, name`,
      p,
    )
      .then((r) => r.recordset || [])
      .catch(() => null),
    query(
      `SELECT release_name, chart, chart_version, app_version, status, updated_at, scanned_at
             FROM dbo.Crypto_Hub_Releases
            WHERE tenant_key = @t AND scan_date = ${son('dbo.Crypto_Hub_Releases')}`,
      p,
    )
      .then((r) => r.recordset || [])
      .catch(() => []),
    query(
      `SELECT chart_ref, tag
             FROM dbo.Crypto_Hub_ChartTags
            WHERE tenant_key = @t AND scan_date = ${son('dbo.Crypto_Hub_ChartTags')}`,
      p,
    )
      .then((r) => r.recordset || [])
      .catch(() => []),
    query(
      `SELECT level, stage, message, scanned_at
             FROM dbo.Crypto_Hub_Notes
            WHERE tenant_key = @t AND scan_date = ${son('dbo.Crypto_Hub_Notes')}`,
      p,
    )
      .then((r) => r.recordset || [])
      .catch(() => []),
    // Yerel chart arsivi (kullanici, 2026-09-26): bastion'da duran eski surumler + values
    // dosyalari. Metaco'da chart deposu sorgulanamadigi icin SOMUT surum gecmisi burasi.
    query(
      `SELECT version, dir, kind, file_name, size_bytes, mtime
             FROM dbo.Crypto_Hub_Archives
            WHERE tenant_key = @t AND scan_date = ${son('dbo.Crypto_Hub_Archives')}
            ORDER BY version, kind DESC, file_name`,
      p,
    )
      .then((r) => r.recordset || [])
      .catch(() => []),
  ]);

  // comp null = tablo yok (DDL calistirilmamis). "Bilesen yok" ile ayni sey DEGIL.
  if (comp === null) {
    return {
      tableMissing: true,
      components: [],
      releases: [],
      tags: [],
      notes: [],
      archives: [],
      scannedAt: null,
      versions: null,
    };
  }

  const scannedAt =
    [...comp, ...rel, ...tag, ...note]
      .map((r) => r.scanned_at)
      .filter(Boolean)
      .sort()
      .pop() || null;

  const components = comp.map((r) => ({
    kind: r.kind,
    name: r.name,
    want: r.want == null ? null : Number(r.want),
    ready: r.ready == null ? null : Number(r.ready),
    image: r.image || '',
    version: r.version || '',
    state: r.want === 0 ? 'stopped' : Number(r.ready) >= Number(r.want) ? 'running' : 'degraded',
  }));

  const releases = rel.map((r) => ({
    name: r.release_name,
    chart: r.chart || '',
    chartVersion: r.chart_version || '',
    appVersion: r.app_version || '',
    status: r.status || '',
    updatedAt: r.updated_at || '',
  }));

  const tagList = [...new Set(tag.map((r) => String(r.tag)))].sort(cmpVersion);
  // KOSAN SURUM ANA RELEASE'TEN OKUNUR. Wyden namespace'inde `wydenapp` yaninda `keycloak`
  // ve `wyden-vault-*` da var; helm list siralamasina guvenip releases[0] almak, ekranda
  // Wyden surumu yerine Keycloak surumunu gosterirdi.
  const main = releases.find((r) => r.name === tenant.helmRelease) || releases[0];
  const running = main?.chartVersion || '';
  const tagsMeasured = tagList.length > 0;
  const newer = tagsMeasured && running ? tagList.filter((v) => cmpVersion(v, running) > 0) : [];

  return {
    tableMissing: false,
    scannedAt,
    components,
    releases,
    notes: note.map((r) => ({ level: r.level, stage: r.stage || '', message: r.message || '' })),
    // Yerel arsiv, surum basina gruplanir: bir surumun chart .tgz'i ve values dosyalari
    // ayni satirda gorunsun. DOSYA ICERIGI YOK - values'ta parola olabiliyor.
    archives: Object.values(
      arch.reduce((acc, r) => {
        const k = String(r.version);
        acc[k] = acc[k] || { version: k, dir: r.dir, chart: '', values: [] };
        if (r.kind === 'chart') acc[k].chart = r.file_name || '';
        else
          acc[k].values.push({
            file: r.file_name || '',
            size: Number(r.size_bytes || 0),
            mtime: r.mtime || '',
          });
        return acc;
      }, {}),
    ).sort((a, b) => cmpVersion(b.version, a.version)),
    versions: {
      running,
      release: main ? main.name : tenant.helmRelease,
      // OLCULEMEDI: etiket listesi bos + NOTE varsa "yeni surum yok" DEMEYIZ.
      measured: tagsMeasured,
      // SORGULANMIYOR ile OLCULEMEDI AYRI SEY (kullanici, 2026-09-28): Metaco'nun chart
      // deposu listeleme desteklemiyor, yeni surum ELLE bildiriliyor. Ikisini ayni
      // gostermek, duzeltilecek bir ariza varmis gibi okunur ve gercek arizalari da
      // gorunmez yapar. Ekran buna gore iki ayri metin gosterir.
      listing: tenant.chartListing !== false,
      available: tagList,
      newer,
      latest: tagList.length ? tagList[tagList.length - 1] : '',
    },
    summary: {
      total: components.length,
      running: components.filter((c) => c.state === 'running').length,
      stopped: components.filter((c) => c.state === 'stopped').length,
      degraded: components.filter((c) => c.state === 'degraded').length,
    },
  };
}

function initCryptoHub(app) {
  const { requireAuth } = require('../auth/index.cjs');
  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));
  router.use(requireAuth);

  try {
    const { requireVisible } = require('../auth/visibility.cjs');
    router.use(requireVisible('CryptoHub'));
  } catch {
    /* motor yoksa yoksay */
  }

  // ── UYGULAMA BAZLI YETKI (kullanici, 2026-10-01) ──────────────────────────────────
  // "Metaco ve Wyden tarafini farkli ekiplere gosterecegiz."
  //
  // MENUDEN GIZLEMEK YETMEZ: kullanici tenant anahtarini elle gonderip otekinin verisini
  // cekebilirdi. Yetki HER tenant'li ucta, SUNUCUDA sorulur.
  //
  // Ogeler SIKI: acik kural yoksa kapali ve admin muafiyeti de yok. Gorunurluk motoru
  // okunamazsa `canSee` fail-closed davranir - yani olcum yapilamadiginda erisim VERILMEZ.
  async function gorunenUygulamalar(req) {
    try {
      const { canSee } = require('../auth/visibility.cjs');
      const { getRequestUser } = require('../auth/utils.cjs');
      const user = getRequestUser(req) || {};
      const out = new Set();
      for (const app of ['metaco', 'wyden']) {
        if (await canSee(user, 'cryptohub:app:' + app)) out.add(app);
      }
      return out;
    } catch {
      return new Set();
    }
  }

  /** Tenant'in uygulamasi bu kullaniciya acik mi? Degilse 403 yazar ve false doner. */
  async function uygulamaKapisi(req, res, tenant) {
    const acik = await gorunenUygulamalar(req);
    if (acik.has(tenant.app)) return true;
    res.status(403).json({
      ok: false,
      message:
        `Bu alana erişiminiz yok (${tenant.appLabel || tenant.app}). ` +
        'Erişim için yöneticinize başvurun (Admin > Crypto Hub Erişimi).',
    });
    return false;
  }

  // Secim agaci: uygulama -> domain -> ortam. Tarama HIC kosmamis olsa da doner ki
  // kullanici ekrani bos gormesin, neyin eksik oldugunu okusun.
  //
  // AGAC DA SUZULUR: gormeyecegi bir uygulamayi listelemek, kullaniciyi 403 alacagi bir
  // secime davet etmek olurdu.
  router.get('/tenants', async (req, res) => {
    const acik = await gorunenUygulamalar(req);
    res.json({ ok: true, apps: selectionTree().filter((a) => acik.has(a.app)) });
  });

  router.get('/overview', async (req, res) => {
    const tenant = tenantOf(req.query.tenant);
    if (tenant && !(await uygulamaKapisi(req, res, tenant))) return;
    if (!tenant) {
      return res.status(400).json({
        ok: false,
        message:
          'Bilinmeyen kiracı. Geçerli anahtarlar: ' + CRYPTO_TENANTS.map((t) => t.key).join(', '),
      });
    }
    if (!isOpen(tenant))
      return res.status(403).json({ ok: false, closed: true, message: CLOSED_MSG });
    if (!tenant.namespace) {
      return res.json({
        ok: true,
        tenant,
        notConfigured: true,
        message: `${tenant.appLabel} ${tenant.envLabel} için namespace/helm tanımı henüz girilmedi — tarama bu ortamı atlıyor.`,
      });
    }
    const fresh = String(req.query.fresh || '') === '1';
    if (!fresh && _cache.value && _cache.key === tenant.key && Date.now() - _cache.at < CACHE_MS) {
      return res.json({ ok: true, tenant, cached: true, ..._cache.value });
    }
    try {
      const value = await loadTenant(tenant);
      _cache = { at: Date.now(), key: tenant.key, value };
      res.json({ ok: true, tenant, ...value });
    } catch (err) {
      res.status(503).json({ ok: false, message: err.message });
    }
  });

  // ── ON ONAY PLANI ───────────────────────────────────────────────────────────────────
  // Kullanici: "upgrade/kapat/degisiklikte kullaniciya UYGULANACAK KOMUTLARI gosteren bir on
  // onay penceresi olsun". Plan SALT OKUNUR uretilir; hicbir sey calistirilmaz.
  router.get('/actions', (_req, res) => {
    res.json({
      ok: true,
      actions: ACTIONS.map(({ key, label, hint, writes, params }) => ({
        key,
        label,
        hint,
        writes,
        params,
      })),
    });
  });

  router.get('/plan', async (req, res) => {
    const tenant = tenantOf(req.query.tenant);
    if (tenant && !(await uygulamaKapisi(req, res, tenant))) return;
    if (!tenant) return res.status(400).json({ ok: false, message: 'Bilinmeyen kiracı.' });
    if (!isOpen(tenant))
      return res.status(403).json({ ok: false, closed: true, message: CLOSED_MSG });
    if (!actionOf(req.query.action))
      return res.status(400).json({ ok: false, message: 'Bilinmeyen işlem.' });
    try {
      const veri = await loadTenant(tenant);
      // ACMA ADIMI ICIN: "hepsini 1 yap" YANLIS olurdu - runbook'ta ornegin api-management 4
      // replika ile aciliyor. Her bilesenin SON SIFIRDAN FARKLI istenen replikasi okunur;
      // hic gorulmediyse plan o adimi "bilinmiyor" diye isaretler.
      let lastNonZero = [];
      if (!veri.tableMissing) {
        const { query, sql } = require('../inventory/mssql.cjs');
        lastNonZero = await query(
          `SELECT kind, name, want FROM (
             SELECT kind, name, want,
                    ROW_NUMBER() OVER (PARTITION BY kind, name ORDER BY scan_date DESC) AS rn
               FROM dbo.Crypto_Hub_Components
              WHERE tenant_key = @t AND want > 0
           ) x WHERE rn = 1`,
          [{ name: 't', type: sql.NVarChar(64), value: tenant.key }],
        )
          .then((r) => r.recordset || [])
          .catch(() => []);
      }
      const plan = buildPlan(
        tenant,
        req.query.action,
        { version: req.query.version || '' },
        {
          components: veri.components || [],
          lastNonZero,
          // Kosan surum: "ayni surume upgrade" uyarisi ve rollout komutu bundan uretilir.
          running: (veri.versions && veri.versions.running) || '',
          // Tarama asamasi dustuyse (ornegin statefulset listesi Forbidden) bilesen listesi
          // EKSIKTIR; plan bunu uyari olarak yazsin diye notlar da gecirilir.
          notes: veri.notes || [],
          scannedAt: veri.scannedAt,
        },
      );
      res.json({ ok: true, tenant, plan });
    } catch (err) {
      res.status(503).json({ ok: false, message: err.message });
    }
  });

  // ── ISLEMLER (log / pod silme / rollout / replika) ──────────────────────────────────
  // Kullanici (2026-09-26): "secilen pod'un loglarini hizlica gosterelim - LogX'e girmesinler;
  // pod silme ve rollout icin OpsX'e gerek kalmasin; replika sayisini da ayarlayabilsinler."
  //
  // OKUYAN ISLEM (pods, logs) dogrudan kosar. YAZAN ISLEM (pod_delete, rollout, scale) once
  // ON ONAY penceresinden gecer: istemci `confirmed: true` gondermeden calistirilmaz. Bu
  // sunucu tarafi bir kapidir - ekranin onay penceresini atlamasi yetmez.
  router.post('/ops', async (req, res) => {
    const tenant = tenantOf(req.body?.tenant);
    if (tenant && !(await uygulamaKapisi(req, res, tenant))) return;
    if (!tenant) return res.status(400).json({ ok: false, message: 'Bilinmeyen kiracı.' });
    if (!isOpen(tenant))
      return res.status(403).json({ ok: false, closed: true, message: CLOSED_MSG });
    if (!tenant.namespace)
      return res.status(409).json({ ok: false, message: 'Bu ortam henüz yapılandırılmadı.' });

    let params;
    try {
      params = normalizeOps(req.body);
    } catch (err) {
      return res.status(400).json({ ok: false, message: err.message });
    }
    if (params.writes && req.body?.confirmed !== true) {
      return res.status(428).json({
        ok: false,
        needsConfirm: true,
        message: 'Bu işlem önce onay penceresinden geçmeli.',
      });
    }

    try {
      const reg = require('../ansible/playbook-registry.cjs');
      const row = await reg.getByKey(OPS_KEY).catch(() => null);
      const templateId = row && row.enabled !== false ? reg.getEffectiveTemplateId(row) : null;
      const serverId = row && row.awxServerId != null ? Number(row.awxServerId) : 0;
      if (!templateId) {
        return res.status(501).json({
          ok: false,
          message: `AWX job template'i tanımlı değil: Admin › Playbook Kayıtları › "${OPS_KEY}" satırına Template ID girilmeli.`,
        });
      }
      const extraVars = {
        crypto_hub_tenant: tenant.key,
        crypto_hub_action: params.action,
        crypto_hub_targets: params.targets.join(','),
      };
      if (params.action === 'logs') {
        extraVars.crypto_hub_tail = params.tail;
        if (params.container) extraVars.crypto_hub_container = params.container;
        if (params.previous) extraVars.crypto_hub_previous = true;
      }
      if (params.action === 'scale') extraVars.crypto_hub_replicas = params.replicas;
      if (params.action === 'values_get') {
        extraVars.crypto_hub_release = params.release;
        if (params.valuesAll) extraVars.crypto_hub_values_all = true;
      }
      if (params.action === 'values_files') {
        // Satir basina bir yol; base64 cunku yollarda bosluk/ozel karakter olabilir.
        extraVars.crypto_hub_values_paths_b64 = Buffer.from(
          params.valuesPaths.join(String.fromCharCode(10)) + String.fromCharCode(10),
          'utf8',
        ).toString('base64');
      }
      if (params.action === 'configmap_get') {
        extraVars.crypto_hub_cm_name = params.cmName;
      }
      if (params.action === 'configmap_put') {
        extraVars.crypto_hub_cm_name = params.cmName;
        // MERGE PATCH: yalnizca `data` gonderilir; metadata/ownerReferences ve helm
        // etiketlerine DOKUNULMAZ. Silinen anahtar null olarak gider (merge patch kurali).
        extraVars.crypto_hub_cm_patch_b64 = Buffer.from(
          JSON.stringify({ data: params.cmData }),
          'utf8',
        ).toString('base64');
      }
      if (params.action === 'values_backups') {
        extraVars.crypto_hub_values_path = params.valuesPath;
      }
      if (params.action === 'values_restore') {
        extraVars.crypto_hub_values_path = params.valuesPath;
        extraVars.crypto_hub_backup_path = params.backupPath;
      }
      if (params.action === 'values_diff') {
        extraVars.crypto_hub_release = params.release;
        extraVars.crypto_hub_values_path = params.valuesPath;
      }
      if (params.action === 'helm_upgrade' || params.action === 'helm_template') {
        // KOSAN SURUM taramadan okunur; istemci ne gonderirse gondersin dikkate alinmaz.
        // Betik bu degeri bastion'da GERCEKTEN kosan surumle ayrica karsilastirir: iki
        // kaynak da ayni demiyorsa hicbir sey uygulanmaz.
        const veri = await loadTenant(tenant).catch(() => null);
        const kosan = String((veri && veri.versions && veri.versions.running) || '').trim();
        const chart = chartRefOf(tenant);
        if (!chart) {
          return res.status(501).json({
            ok: false,
            message:
              'Bu uygulamada chart bastion diskindeki bir dizinden kuruluyor; doğru dizin koşan sürüme bağlı olduğu için Portal bunu kendisi çalıştırmıyor. Plan penceresindeki komutu kullanın.',
          });
        }
        if (!kosan) {
          return res.status(409).json({
            ok: false,
            message:
              'Koşan sürüm ÖLÇÜLEMEDİ (tarama sürümü okuyamamış). "Aynı sürüm" güvencesi verilemeyeceği için işlem başlatılmadı.',
          });
        }
        extraVars.crypto_hub_release = params.release;
        extraVars.crypto_hub_values_path = params.valuesPath;
        extraVars.crypto_hub_chart_ref = chart;
        extraVars.crypto_hub_expect_version = kosan;
        if (params.action === 'helm_upgrade') {
          // AWX isi helm'den ONCE olmemeli: async penceresi helm zaman asimindan genis.
          extraVars.crypto_hub_helm_timeout = '10m';
          extraVars.crypto_hub_timeout = 900;
        }
      }
      if (params.action === 'values_put') {
        extraVars.crypto_hub_values_path = params.valuesPath;
        extraVars.crypto_hub_values_b64 = Buffer.from(params.content, 'utf8').toString('base64');
      }

      await require('../ansible/template-preflight.cjs').assertTemplateAcceptsExtraVars(
        serverId,
        templateId,
        extraVars,
        { label: OPS_KEY },
      );
      const user = req.session?.user || {};
      const result = await require('../ansible/runner.cjs').launchJobOnServer(
        serverId,
        templateId,
        extraVars,
        '',
        user,
      );
      // DENETIM KAYDI: "kim yapti" servis hesabinin ardinda kaybolmasin (isler uxmid ile kosar).
      try {
        await require('../db/index.cjs').query(
          `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            user.username || 'unknown',
            serverId,
            templateId,
            `Crypto Hub: ${params.action} @ ${tenant.key}`,
            result?.jobId,
            result?.status || 'pending',
            JSON.stringify(extraVars),
          ],
        );
      } catch (e) {
        console.warn('[CryptoHub] islem gecmisi yazilamadi:', e.message);
      }
      if (params.writes) _cache = { at: 0, key: '', value: null };
      res.json({
        ok: true,
        jobId: result?.jobId ?? null,
        status: result?.status ?? null,
        awxServerId: serverId,
        action: params.action,
      });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // Isin SONUCU: set_stats ile donen satirlar (POD/LOG/RES/ERR) ayristirilir.
  router.get('/ops-result/:serverId/:jobId', async (req, res) => {
    const serverId = Number(req.params.serverId);
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(serverId) || !Number.isInteger(jobId) || jobId <= 0) {
      return res.status(400).json({ ok: false, message: 'Geçersiz iş numarası.' });
    }
    try {
      const runner = require('../ansible/runner.cjs');
      const statusInfo = await runner.getJobStatusOnServer(serverId, jobId);
      const terminal = ['successful', 'failed', 'error', 'canceled'].includes(statusInfo.status);
      let parsed = null;
      if (terminal) {
        const { extractStatsKey } = require('../opsx/index.cjs');
        const stats = extractStatsKey(statusInfo.artifacts, 'crypto_hub_ops_result');
        parsed = parseOpsLines(stats && stats.lines);
        if (parsed) {
          // KAPALI KIRACININ SONUCU DA DONMEZ. Bu uc kiraci parametresi almiyor ama isin
          // ciktisi kiraci anahtarini tasiyor; is baslatilirken kapi vardi, sonucu okurken
          // de olmali - aksi halde "production kapali" yalnizca baslatma tarafinda gecerli
          // bir kural olurdu. (CH7 bekcisi bu eksigi yakaladi.)
          const tenant = tenantOf(parsed.tenantKey);
          if (tenant && !isOpen(tenant))
            return res.status(403).json({ ok: false, closed: true, message: CLOSED_MSG });
          parsed.action = (stats && stats.action) || null;
          // VARSAYILAN MASKELI. Ham icerik icin ayri ve denetlenen bir uc var (?reveal=1).
          if (parsed.values && parsed.values.length) {
            parsed.masked = String(req.query.reveal || '') !== '1';
            if (parsed.masked) parsed.values = maskValues(parsed.values);
            else {
              try {
                require('../audit/index.cjs').auditPortal(req, 'crypto_hub_values_reveal', {
                  jobId,
                  detail: 'values ham icerik goruntulendi',
                });
              } catch {
                /* denetim yoksa yoksay */
              }
            }
          }
          // CLUSTER DOSYALARI da AYNI kurala tabi: varsayilan maskeli, ham icerik ayri ve
          // denetlenen bir istekle gelir.
          //
          // SIRA ONEMLI: karsilastirma HAM satirlar uzerinde, MASKELEMEDEN ONCE yapilir.
          // Maskeleme her sirri '****' yaptigi icin, maskeli veride iki FARKLI parola AYNI
          // gorunur ve gercek bir fark sessizce kaybolurdu. Karsilastirma hamda yapilinca
          // fark tespit edilir, deger yine gosterilmez (values-compare.cjs maske notu).
          // CONFIG MAP -> ROLLOUT ESLESMESI SUNUCUDA cozulur: istemci `shared/` altindan
          // import edemiyor (takma ad yok) ve iki kopya tutmak, bir gun birinin eskimesi
          // demekti. Uc durum korunur: kayitli / tahmin / yok.
          if (parsed.configMaps && parsed.configMaps.length) {
            const { rolloutHedefleri } = require('../../shared/cryptoHubConfigMaps.cjs');
            parsed.configMaps = parsed.configMaps.map((c) => ({
              ...c,
              rollout: rolloutHedefleri(tenant && tenant.app, c.name),
            }));
          }
          if (parsed.files && parsed.files.length) {
            parsed.masked = String(req.query.reveal || '') !== '1';
            parsed.compare = require('./values-compare.cjs').karsilastir(
              parsed.files,
              parsed.masked ? SIR_ANAHTARI : null,
            );
            if (parsed.masked) {
              parsed.files = parsed.files.map((f) => ({ ...f, lines: maskValues(f.lines) }));
            } else {
              try {
                require('../audit/index.cjs').auditPortal(req, 'crypto_hub_values_reveal', {
                  jobId,
                  detail: 'cluster values dosyalari ham icerik goruntulendi',
                });
              } catch {
                /* denetim yoksa yoksay */
              }
            }
          }
        }
      }
      res.json({ ok: true, status: statusInfo.status, result: parsed });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // ── VALUES ESITLEME ONIZLEMESI ─────────────────────────────────────────────────────
  //
  // Kullanici (2026-09-28): karsilastirmada gorulen farki oteki cluster'a da yazabilmek.
  //
  // BU UC HICBIR SEY YAZMAZ: yalnizca "secilen anahtarlar uygulanirsa hedef dosya NE OLUR"
  // sorusunu cevaplar. Gercek yazma, mevcut values_put isiyle olur (yedek alir, denetime
  // yazilir). Boylece tek bir yazma yolu kalir - ikinci bir yol acmak, yedek kuralini bir
  // gun birinde unutmak demekti.
  //
  // YAML mantigi values-compare.cjs'te TEK KOPYA: karsilastirma da guncelleme de ayni
  // ayristiriciyi kullanir, yoksa "farkli" diyen ile "yazan" bir gun ayrisirdi.
  router.post('/values-apply', async (req, res) => {
    const tenant = tenantOf(req.body?.tenant);
    if (tenant && !(await uygulamaKapisi(req, res, tenant))) return;
    if (!tenant) return res.status(400).json({ ok: false, message: 'Bilinmeyen kiracı.' });
    if (!isOpen(tenant))
      return res.status(403).json({ ok: false, closed: true, message: CLOSED_MSG });

    const lines = Array.isArray(req.body?.lines)
      ? req.body.lines.map((x) => String(x == null ? '' : x))
      : [];
    const secimler = Array.isArray(req.body?.secimler) ? req.body.secimler : [];
    if (!lines.length)
      return res.status(400).json({ ok: false, message: 'Hedef dosya içeriği boş.' });
    if (lines.length > 20000)
      return res.status(413).json({ ok: false, message: 'Hedef dosya çok büyük.' });
    if (!secimler.length)
      return res.status(400).json({ ok: false, message: 'Yazılacak ayar seçilmedi.' });
    if (secimler.length > 50)
      return res
        .status(400)
        .json({ ok: false, message: 'Tek seferde en fazla 50 ayar yazılabilir.' });

    const r = require('./values-compare.cjs').uygula(lines, secimler);
    if (r.maskeli) {
      // MASKELI ICERIGI GERI YAZMAK gercek parolayi '****' ile degistirmek olurdu.
      return res.status(409).json({
        ok: false,
        message:
          'Hedef dosya maskeli okunmuş — bu içerikle yazmak gerçek değerleri yok ederdi. Önce "Gerçek değerleri göster" deyin.',
      });
    }
    res.json({
      ok: true,
      content: r.lines.join(String.fromCharCode(10)) + String.fromCharCode(10),
      degisen: r.degisen,
      atlanan: r.atlanan,
    });
  });

  // Taramayi SIMDI kostur (yalniz secili kiraci). Yazan bir is DEGIL - tarama salt okunur.
  router.post('/rescan', async (req, res) => {
    const tenant = tenantOf(req.body?.tenant);
    if (tenant && !(await uygulamaKapisi(req, res, tenant))) return;
    if (!tenant) return res.status(400).json({ ok: false, message: 'Bilinmeyen kiracı.' });
    if (!isOpen(tenant))
      return res.status(403).json({ ok: false, closed: true, message: CLOSED_MSG });
    if (!tenant.namespace)
      return res.status(409).json({ ok: false, message: 'Bu ortam henüz yapılandırılmadı.' });
    try {
      const reg = require('../ansible/playbook-registry.cjs');
      const row = await reg.getByKey(REGISTRY_KEY).catch(() => null);
      const templateId = row && row.enabled !== false ? reg.getEffectiveTemplateId(row) : null;
      const serverId = row && row.awxServerId != null ? Number(row.awxServerId) : 0;
      if (!templateId) {
        return res.status(501).json({
          ok: false,
          message: `AWX job template'i tanımlı değil: Admin › Playbook Kayıtları › "${REGISTRY_KEY}" satırına Template ID girilmeli.`,
        });
      }
      const extraVars = { crypto_hub_keys: tenant.key };
      await require('../ansible/template-preflight.cjs').assertTemplateAcceptsExtraVars(
        serverId,
        templateId,
        extraVars,
        { label: REGISTRY_KEY },
      );
      const user = req.session?.user || {};
      const result = await require('../ansible/runner.cjs').launchJobOnServer(
        serverId,
        templateId,
        extraVars,
        '',
        user,
      );
      try {
        await require('../db/index.cjs').query(
          `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            user.username || 'unknown',
            serverId,
            templateId,
            `Crypto Hub: ${tenant.key}`,
            result?.jobId,
            result?.status || 'pending',
            JSON.stringify(extraVars),
          ],
        );
      } catch (e) {
        console.warn('[CryptoHub] job gecmisi yazilamadi:', e.message);
      }
      _cache = { at: 0, key: '', value: null };
      res.json({
        ok: true,
        jobId: result?.jobId ?? null,
        status: result?.status ?? null,
        awxServerId: serverId,
      });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // Ekran "Taramayi tazele" isini is-takipcisinde izler; bitince onbellek dusurulur ki
  // kullanici F5'siz taze veriyi gorsun.
  router.get('/job-status/:serverId/:jobId', async (req, res) => {
    const serverId = Number(req.params.serverId);
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(serverId) || !Number.isInteger(jobId) || jobId <= 0) {
      return res.status(400).json({ ok: false, message: 'Geçersiz iş numarası.' });
    }
    try {
      const runner = require('../ansible/runner.cjs');
      const [statusInfo, outputInfo] = await Promise.all([
        runner.getJobStatusOnServer(serverId, jobId),
        runner.getJobOutputOnServer(serverId, jobId),
      ]);
      if (['successful', 'failed', 'error', 'canceled'].includes(statusInfo.status)) {
        _cache = { at: 0, key: '', value: null };
      }
      res.json({ ok: true, status: statusInfo.status, output: outputInfo.output || '' });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  app.use('/api/crypto-hub', router);
  console.log('[CryptoHub] module mounted at /api/crypto-hub');
}

module.exports = {
  initCryptoHub,
  cmpVersion,
  loadTenant,
  normalizeOps,
  parseOpsLines,
  maskValues,
  OPS,
};
