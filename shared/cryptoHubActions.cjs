// shared/cryptoHubActions.cjs — Crypto Hub işlem planları (2026-09-26).
//
// Kullanıcı: "installation/upgrade veya herhangi bir değişiklikte kullanıcıya uygulanacak
// komutları gösteren bir ön onay penceresi hazırlayalım — Metaco upgrade seçti, çalıştırılacak
// komutlar bu şekildedir vs."
//
// ÜÇ İLKE:
//
// 1) KOMUTLAR UYDURULMAZ. Her adım kullanıcının runbook'larından geliyor; kaynağı `source`
//    alanında yazıyor. Runbook'ta olmayan bir şey plana KONMAZ — bilinmeyen varsa adım
//    `unknown: true` ile işaretlenir ve ekran "doğrulanmalı" der.
//
// 2) SCALE KOMUTLARI ÖLÇÜLEN BİLEŞENDEN ÜRETİLİR, listeden değil. Runbook'lardaki uzun
//    `oc scale deployment … hmz-harmonize-*` listeleri bugün doğru, yarın chart değişince
//    bayat. Plan, son taramada GÖRÜLEN Deployment/StatefulSet'lerden üretilir; sıralama ipucu
//    (Metaco'da önce gateway, Wyden'de aeron en sonda) runbook'tan gelir.
//
// 3) PAROLA PLANDA GÖRÜNMEZ. Runbook'larda düz metin parola var (Metaco chart deposu);
//    plan `--password-stdin` gösterir ve parolanın AWX credential'ından geldiğini yazar.
//    Bir adımın metnine parola konması bekçiyle engelleniyor.
//
// ŞU AN HİÇBİR İŞLEM PORTAL'DAN ÇALIŞTIRILMIYOR (`runnable: false`): bu ekran, yazan
// playbook'lar gelene kadar "ne koşacak" penceresi. Onay akışı hazır, tetikleyicisi yok.
'use strict';

const PROXY = 'http://tekprxv2.fw.garanti.com.tr:80';
const NO_PROXY = 'localhost,.fw.garanti.com.tr,.fw.dijitalvarlik.com.tr,.fw.gohas.com.tr,'
  + '.fw.teknoloji.com.tr,.fw.gteknoloji.com.tr,.fw.takasnet.com.tr,.fw.eurekosigorta.com.tr,'
  + '.gtdmz.com.tr,.gteknolojidmz.com.tr,10.0.0.0/8,172.16.0.0/16,192.168.0.0/16';

/** Ekranda seçilebilen işlemler. `writes` = ortamda gerçek değişiklik yapar. */
const ACTIONS = Object.freeze([
  {
    key: 'upgrade',
    label: 'Upgrade (sürüm yükseltme)',
    hint: 'Yeni chart sürümüne geçiş',
    writes: true,
    params: [{ key: 'version', label: 'Hedef sürüm', required: true, placeholder: 'örn. 1.34.4' }],
  },
  {
    key: 'stop',
    label: 'Kapat',
    hint: 'Tüm bileşenleri sıfıra indir (scale down)',
    writes: true,
    params: [],
  },
  {
    key: 'start',
    label: 'Aç',
    hint: 'Bileşenleri son bilinen replika sayısına çıkar',
    writes: true,
    params: [],
  },
]);

const actionOf = (key) => ACTIONS.find((a) => a.key === String(key || '').trim()) || null;

// Sıralama ipuçları (runbook'lardan). Listede olmayan bileşenler, listedekilerden SONRA ve
// kendi aralarında alfabetik gelir — chart yeni bir bileşen eklerse plan yine de eksiksiz olur.
const ORDER = {
  // Metaco: "once gateway kapatilir", sonra notary/vault kontrolu, en son geri kalan podlar.
  metaco: { stopFirst: ['gateway'], stopLast: ['keycloak', 'amqp'] },
  // Wyden: aeron cluster konsensusu en hassas parca; en son kapatilir, en once acilir.
  wyden: { stopFirst: ['rest-api', 'rest-management'], stopLast: ['aeron-cluster', 'storage'] },
};

function orderComponents(app, comps, reverse = false) {
  const rules = ORDER[app] || { stopFirst: [], stopLast: [] };
  const rank = (c) => {
    const n = String(c.name || '');
    if (rules.stopFirst.some((k) => n.endsWith('-' + k) || n === k)) return 0;
    if (rules.stopLast.some((k) => n.endsWith('-' + k) || n === k)) return 2;
    return 1;
  };
  const sorted = [...comps].sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));
  return reverse ? sorted.reverse() : sorted;
}

const ocKind = (kind) => (String(kind || '').toLowerCase().startsWith('stateful') ? 'statefulset' : 'deployment');

/** Her plan aynı üç adımla başlar: proxy, cluster oturumu, namespace. */
function girisAdimlari(tenant) {
  return [
    {
      kind: 'command', writes: false, title: 'Proxy değişkenleri',
      command: `export http_proxy="${PROXY}"\nexport https_proxy="${PROXY}"\nexport no_proxy=${NO_PROXY}`,
      note: `Bastion: ${tenant.bastion} (dzdo su - was)`,
      source: 'runbook adım 1-3',
    },
    {
      kind: 'command', writes: false, title: 'Cluster oturumu',
      command: `oc login ${tenant.apiUrl} --username=<servis-hesabı>`,
      note: 'Parola AWX credential\'ından gelir; planda ve logda GÖRÜNMEZ.',
      source: 'runbook adım 4',
    },
    {
      kind: 'command', writes: false, title: 'Namespace',
      command: `oc project ${tenant.namespace}`,
      source: 'runbook adım 5',
    },
  ];
}

function scaleAdimlari(tenant, comps, replicasOf, baslik) {
  return comps.map((c) => ({
    kind: 'command', writes: true,
    title: `${baslik}: ${c.name}`,
    command: `oc scale ${ocKind(c.kind)} ${c.name} --replicas=${replicasOf(c)} -n ${tenant.namespace}`,
    note: c.note,
    unknown: !!c.unknown,
    source: 'ölçülen bileşen (son tarama)',
  }));
}

/**
 * Plan üretir.
 * @param {object} tenant     kiracı (shared/cryptoHubTenants.cjs)
 * @param {string} actionKey  upgrade | stop | start
 * @param {object} params     { version }
 * @param {object} veri       { components: [...], lastNonZero: [...], scannedAt }
 */
function buildPlan(tenant, actionKey, params = {}, veri = {}) {
  const action = actionOf(actionKey);
  if (!action) return null;

  const components = veri.components || [];
  const lastNonZero = veri.lastNonZero || [];
  const warnings = [];
  const steps = [...girisAdimlari(tenant)];

  if (!components.length) {
    warnings.push('Bu ortam için tarama kaydı yok — scale adımları üretilemedi. Önce "Taramayı tazele".');
  }

  // EKSIK BILESEN LISTESI SESSIZ KALMAMALI (2026-09-26, uretimde gorulen durum):
  // `oc get statefulset` RBAC yuzunden Forbidden dondugunde tarama ERR yazar ama bilesen
  // listesi EKSIK kalir. Plan bu listeden uretildigi icin "Kapat" planinda statefulset'ler
  // HIC gorunmez - yani eksik bir plan, eksik oldugunu soylemeden onaya cikardi.
  const eksik = (veri.notes || []).filter((n) => n.level === 'ERR' && /^get-/.test(String(n.stage || '')));
  for (const n of eksik) {
    const tur = String(n.stage).replace(/^get-/, '');
    warnings.push(
      `Son taramada ${tur} listesi alınamadı (${(n.message || '').slice(0, 120)}) — bu türdeki bileşenler `
      + 'planda YOK. Plan eksiktir; yetki verilip tarama tazelenmeden uygulanmamalı.',
    );
  }

  // ── KAPAT ───────────────────────────────────────────────────────────────────────────
  const kapatAdimlari = () => {
    const out = [];
    const ayakta = components.filter((c) => Number(c.want) > 0);
    if (tenant.app === 'metaco') {
      out.push({
        kind: 'check', writes: false, title: 'Notary ve vault istek almıyor mu?',
        command: 'tail -f /var/log/hpcr.log | grep metacovault\ntail -f /var/log/hpcr.log | grep metaconotary',
        note: 'Gateway kapandıktan sonra istek görülmemeli.',
        source: 'Metaco runbook adım 3',
      });
      out.push({
        kind: 'manual', writes: false, title: 'harmonize-keycloak-kc secret yedeği',
        note: 'Runbook adım 4 — kapatmadan önce secret yedeklenir.',
        source: 'Metaco runbook adım 4',
      });
    }
    if (tenant.app === 'wyden') {
      out.push({
        kind: 'check', writes: false, title: 'Aeron cluster lideri ve konsensüs',
        command: 'oc exec -it wydenapp-aeron-cluster-0 -- bash -c "… ClusterTool … cluster list-members"',
        note: 'Runbook 12: her üç node için lider/konsensüs kontrolü yapılır.',
        source: 'Wyden runbook 12',
      });
      if (tenant.production) {
        out.push({
          kind: 'manual', writes: false, title: 'İş birimi: "Trading" kapatılır',
          note: 'Garanti BBVA Kripto Mobil tarafında Trading kapatılmadan podlara dokunulmaz.',
          source: 'Wyden runbook adım 6',
        });
      }
    }
    out.push(...scaleAdimlari(tenant, orderComponents(tenant.app, ayakta), () => 0, 'Kapat'));
    if (tenant.app === 'metaco') {
      out.push({
        kind: 'manual', writes: false, title: 'LinuxOne: önce vault sonra notary kapatılır',
        note: 'Hub LinuxOne\'a DOKUNMAZ (kullanıcı kararı) — kontrol listesi: virsh shutdown metacovault / metaconotary / grep11vault.',
        source: 'Metaco runbook adım 5',
      });
    }
    return out;
  };

  // ── AÇ ──────────────────────────────────────────────────────────────────────────────
  const acAdimlari = () => {
    const out = [];
    if (tenant.app === 'metaco') {
      out.push({
        kind: 'manual', writes: false, title: 'LinuxOne: grep11 → grep11vault → notary → vault açılır',
        note: 'Hub LinuxOne\'a dokunmaz; podlardan ÖNCE açılması gerekir.',
        source: 'Metaco runbook adım 10',
      });
    }
    // Istenen replika sayisi: son SIFIRDAN FARKLI olcum. Her seyi 1 yapmak yanlis olurdu -
    // runbook'ta ornegin api-management 4 replika ile aciliyor.
    const hedef = new Map(lastNonZero.map((c) => [`${c.kind}/${c.name}`, Number(c.want)]));
    const liste = (components.length ? components : lastNonZero).map((c) => {
      const k = `${c.kind}/${c.name}`;
      const w = hedef.get(k);
      return w ? { ...c, hedefReplika: w } : { ...c, hedefReplika: 1, unknown: true, note: 'Son taramalarda hep 0 görüldü — istenen replika sayısı BİLİNMİYOR, 1 varsayıldı.' };
    });
    if (liste.some((c) => c.unknown)) {
      warnings.push('Bazı bileşenlerin istenen replika sayısı bilinmiyor (hiç sıfırdan farklı ölçülmediler); o adımlar işaretli.');
    }
    out.push(...scaleAdimlari(tenant, orderComponents(tenant.app, liste, true), (c) => c.hedefReplika, 'Aç'));
    return out;
  };

  if (action.key === 'stop') steps.push(...kapatAdimlari());
  if (action.key === 'start') steps.push(...acAdimlari());

  // ── UPGRADE ─────────────────────────────────────────────────────────────────────────
  if (action.key === 'upgrade') {
    const v = String(params.version || '').trim();
    if (!v) warnings.push('Hedef sürüm girilmedi — komutlarda <sürüm> yer tutucusu duruyor.');
    const ver = v || '<sürüm>';

    if (tenant.app === 'metaco') {
      steps.push(
        {
          kind: 'command', writes: false, title: 'Chart deposuna giriş',
          command: 'helm registry login metaco.azurecr.io -u <kullanıcı> --password-stdin',
          note: 'Parola AWX credential\'ından okunur. Runbook\'taki düz metin parola KULLANILMAZ (rotasyon bekliyor).',
          source: 'Metaco runbook (chart indirme) adım 2',
        },
        {
          kind: 'command', writes: false, title: 'Chart indir',
          command: `helm pull oci://${tenant.chartRef || 'metaco.azurecr.io/helm-flat/harmonize'} --version ${ver}`,
          source: 'Metaco runbook adım 3',
        },
        {
          kind: 'command', writes: false, title: 'Chart aç ve imaj listesini çıkar',
          command: `tar xvf harmonize-${ver}.tgz\ncd harmonize/\ncat values.yaml | grep -i image -A5 | grep -E "(repository|tag)" | grep -v "#"`,
          source: 'Metaco runbook adım 4',
        },
        {
          kind: 'manual', writes: false, title: 'İmajlar gtrepo\'ya push edilir',
          note: 'Jenkins: metaco-artifactory-push. "kms-ibm", "approval-notary" ve "vault-releases" HARİÇ.',
          source: 'Metaco runbook adım 5',
        },
        {
          kind: 'command', writes: true, title: 'Helm upgrade',
          command: `helm upgrade --install --namespace=${tenant.namespace} ${tenant.helmRelease} ./harmonize/ -f ./garanti_values.yaml`,
          source: 'Metaco runbook (upgrade) ',
        },
        {
          kind: 'check', writes: false, title: 'Route kontrolü',
          command: `oc get route -n ${tenant.namespace}`,
          note: 'Runbook notu: helm upgrade bazen route\'ları siliyor ve geri oluşturmuyor; gerekirse upgrade İKİ KEZ koşulur.',
          source: 'Metaco runbook (upgrade) uyarı 3',
        },
      );
    } else if (tenant.app === 'wyden') {
      steps.push(...kapatAdimlari());
      steps.push(
        {
          kind: 'command', writes: true, title: 'Helm upgrade',
          command: `helm upgrade --install ${tenant.helmRelease} ${tenant.chartName || 'wyden/wyden'} --version ${ver} -f <garanti_values.yaml yolu>`,
          note: 'Values dosyası setup-wyden ağacından seçilir (ortam + sürüm + cluster klasörü); yol doğrulanmalı.',
          unknown: true,
          source: 'Wyden runbook (upgrade) adım 10',
        },
        {
          kind: 'check', writes: false, title: 'Route ve pod kontrolü',
          command: `oc get route -n ${tenant.namespace}\noc get pods -n ${tenant.namespace}`,
          source: 'Wyden runbook (route oluşturma adımları)',
        },
      );
      steps.push(...acAdimlari());
    }
  }

  steps.push({
    kind: 'check', writes: false, title: 'Son durum',
    command: `oc get deploy,sts -n ${tenant.namespace}`,
    note: 'Hub\'da "Taramayı tazele" ile aynı bilgiyi ekrandan da görebilirsiniz.',
    source: 'Crypto Hub',
  });

  if (tenant.production) {
    warnings.push('PRODUCTION ortam: yazan adımlar OCO penceresi ve Smart onayına bağlanmadan çalıştırılmaz.');
  }

  return {
    action: action.key,
    label: action.label,
    tenantKey: tenant.key,
    params: { ...params },
    scannedAt: veri.scannedAt || null,
    steps: steps.map((s, i) => ({ n: i + 1, ...s })),
    writeCount: steps.filter((s) => s.writes).length,
    unknownCount: steps.filter((s) => s.unknown).length,
    warnings,
    // Yazan playbook'lar yazilana kadar bu ekran YALNIZCA gosterir.
    runnable: false,
    runnableNote: 'Bu işlem Portal\'dan henüz çalıştırılmıyor — komutlar şimdilik elle koşulur. '
      + 'Yazan playbook bağlandığında onay bu ekrandan verilecek.',
  };
}

module.exports = { ACTIONS, actionOf, buildPlan, orderComponents, PROXY, NO_PROXY };
