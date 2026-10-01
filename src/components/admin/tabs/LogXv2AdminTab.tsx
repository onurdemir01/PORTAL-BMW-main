// src/components/admin/tabs/LogXv2AdminTab.tsx — Admin > OCP YAPILANDIRMA.
//
// LogX, OpsX, Telnet ve ScaleX'in ORTAK OpenShift ayarları: cluster hiyerarşisi, vault
// anahtarları, terminal/bastion eşlemesi ve OCP çalıştırma ayarları. Dosya adı ve sekme
// kimliği (`logxv2`) tarihsel — kayıtlı görünürlük kuralları bozulmasın diye korunur.
//
// 2026-10-02: LogX'e özgü bölümler (Erişim, Maskeleme, İstek İzleme, Legacy son-ek,
// AWX hazırlık) Admin > LogX Yönetimi'ne taşındı (LogXAdminTab).
import React, { useEffect, useState } from 'react';
import {
  ServerStackIcon,
  CommandLineIcon,
  WrenchScrewdriverIcon,
  KeyIcon,
  SignalIcon,
  CubeIcon,
} from '@heroicons/react/24/outline';
import {
  logxV2Api,
  type OcpClusterIndexRow,
  type OcpTerminalHostRow,
  type OcpVaultKeyRow,
} from '@/api/logxV2Api';
import SimpleCrudTable, { type ColumnDef } from './logxv2/SimpleCrudTable';
import { useCrudSection } from './logxv2/useCrudSection';
import { SourceNote } from '@/components/common/SourceNote';
import { OCP_CLUSTER_INDEX } from '@/config/dataSources';
import { useToast } from '@/hooks/useToast';
import OcpRuntimeSettings from './logxv2/OcpRuntimeSettings';
import { LoadingLogo } from '@/components/common/LoadingLogo';

const SUB_TABS = [
  { id: 'clusters', label: 'OCP Cluster Hiyerarşisi', icon: ServerStackIcon },
  { id: 'vaultkeys', label: 'Vault Anahtarları', icon: KeyIcon },
  { id: 'terminals', label: 'Terminal/Bastion Host', icon: CommandLineIcon },
  { id: 'ocpruntime', label: 'OCP Çalıştırma Ayarları', icon: WrenchScrewdriverIcon },
] as const;
type SubTabId = (typeof SUB_TABS)[number]['id'];

// Cluster satirinin Jump Server hucresi BOSSA, devreye girecek yedek (tenant/env) degeri
// okuma modunda soluk gosterilir — admin hangi cluster'in FIILEN hangi bastion'a gidecegini
// sekme degistirmeden gorur. Yedek de yoksa kirmizi uyari (o cluster secilirse akis 400 verir).
function clusterColumns(
  terminalRows: OcpTerminalHostRow[],
  clusterRows: OcpClusterIndexRow[],
  vaultRows: OcpVaultKeyRow[],
): ColumnDef<OcpClusterIndexRow>[] {
  // Öneriler artık "Vault Anahtarları" sekmesindeki KATALOGDAN gelir. Eskiden mevcut
  // cluster satırlarından türetiliyordu; bu yüzden henüz hiçbir cluster'da kullanılmamış
  // bir anahtar (ör. uxmid_gohas) hiçbir zaman önerilmiyordu. Katalog okunamazsa
  // kullanımdaki değerlere düşülür — öneri listesi boş kalmasın.
  const fromCatalog = vaultRows.filter((r) => r.is_active !== false).map((r) => r.key_name);
  // Sunucudaki `assertVaultKeysKnownOrThrow` ile AYNI küme: yalnızca AKTİF anahtarlar.
  const catalogNames = new Set(fromCatalog.map((k) => String(k || '').trim()).filter(Boolean));
  const inUse = clusterRows.map((r) => r.vault_credential_key).filter(Boolean) as string[];
  const vaultKeys = [...new Set([...fromCatalog, ...inUse])].sort();
  return [
    { key: 'env', label: 'Ortam (env)', placeholder: 'dev' },
    { key: 'tenant', label: 'Tenant', placeholder: 'ark' },
    { key: 'cluster_name', label: 'Cluster Adı', placeholder: 'gbocptest1' },
    {
      key: 'terminal_host',
      label: 'Jump Server (bastion)',
      placeholder: 'boş = tenant/env yedek eşlemesi',
      emptyHint: (row) => {
        const fb = terminalRows.find(
          (t) => t.is_active && t.tenant === row.tenant && t.env === row.env,
        );
        return fb ? `yedek: ${fb.terminal_host}` : '⚠ eşleme yok';
      },
    },
    {
      key: 'api_url',
      label: 'API Adresi',
      placeholder: 'https://api.gbocptest1...:6443',
      truncate: true,
      // Boşsa playbook eski AWX envanter dosyasına düşer — çalışır ama portalın
      // "her şey DB'de" ilkesinin dışında kalır, bunu görünür kılıyoruz.
      emptyHint: () => 'envanter dosyasından',
    },
    {
      key: 'vault_credential_key',
      label: 'Vault Anahtarı (parola değil)',
      placeholder: 'uxmid_gar',
      suggestions: vaultKeys,
      // PAROLA DEĞİL: credentials.yaml içindeki değişkenin ADI. Parola hiçbir zaman
      // portal veritabanına yazılmaz.
      emptyHint: () => 'envanter dosyasından',
      // 2026-08-28 üretim arızası: bu alanda katalogda kayıtlı olmayan bir ad vardı;
      // portal işi başlattı, AWX 12 saniye sonra "vault parolası çözülemedi" ile düştü.
      // Artık çalıştırma sunucu tarafında 400 ile kesiliyor — bu rozet de sorunun
      // KAYNAĞINI, yani hangi satırın düzeltilmesi gerektiğini gösterir.
      // Katalog boşsa (istek düştü / henüz hiç anahtar tanımlanmadı) UYARI VERİLMEZ:
      // yoksa yüklenememiş bir liste yüzünden her satır yanlışlıkla kırmızıya boyanırdı.
      valueWarning: (row) =>
        catalogNames.size > 0 && !catalogNames.has(String(row.vault_credential_key || '').trim())
          ? 'katalogda yok'
          : null,
    },
    {
      key: 'ocp_username',
      label: 'OCP Kullanıcı Adı',
      placeholder: 'uxmid',
      suggestions: [
        ...new Set(vaultRows.map((r) => r.default_username).filter(Boolean) as string[]),
      ].sort(),
      // `oc login --username`. Bu alan YOKKEN playbook değeri yalnızca AWX'teki
      // openshift_inventory_vars.yaml'dan okuyabiliyordu; o dosya AWX'te olmadığı için
      // 2026-08-09'da tüm cluster'lar "'username' is undefined" ile düştü.
      emptyHint: () => 'genel varsayılandan',
    },
    { key: 'is_active', label: 'Aktif', type: 'checkbox' },
  ];
}
const CLUSTER_EMPTY: Partial<OcpClusterIndexRow> = {
  env: '',
  tenant: '',
  cluster_name: '',
  terminal_host: '',
  api_url: '',
  vault_credential_key: '',
  ocp_username: '',
  is_active: true,
};

const VAULT_KEY_COLUMNS: ColumnDef<OcpVaultKeyRow>[] = [
  { key: 'key_name', label: 'Vault Anahtarı (parola değil)', placeholder: 'uxmid_gar' },
  { key: 'default_username', label: 'Varsayılan Kullanıcı', placeholder: 'uxmid' },
  {
    key: 'description',
    label: 'Açıklama',
    placeholder: "Garanti BBVA cluster'ları",
    truncate: true,
  },
  { key: 'is_active', label: 'Aktif', type: 'checkbox' },
];
const VAULT_KEY_EMPTY: Partial<OcpVaultKeyRow> = {
  key_name: '',
  default_username: '',
  description: '',
  is_active: true,
};

// Cluster satırlarındaki vault anahtarı katalogda yoksa, o cluster'ı seçen HER çalıştırma
// (LogX OCP ve Telnet) sunucuda 400 ile reddedilir. Rozet tek satırı işaretler; bu bant
// toplamı ve ne yapılacağını söyler — rozeti fark etmeyen admin de görsün.
const UnknownVaultKeyBanner: React.FC<{
  clusterRows: OcpClusterIndexRow[];
  vaultRows: OcpVaultKeyRow[];
}> = ({ clusterRows, vaultRows }) => {
  const known = new Set(
    vaultRows
      .filter((r) => r.is_active !== false)
      .map((r) => String(r.key_name || '').trim())
      .filter(Boolean),
  );
  // Katalog yüklenemediyse sessiz kal (bkz. valueWarning'deki aynı gerekçe).
  if (known.size === 0) return null;
  const bad = clusterRows.filter((r) => {
    const key = String(r.vault_credential_key || '').trim();
    return key !== '' && !known.has(key);
  });
  if (bad.length === 0) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900">
      <strong>{bad.length} cluster satırında katalogda olmayan vault anahtarı var:</strong>{' '}
      {bad.map((r) => `${r.cluster_name} → "${r.vault_credential_key}"`).join(', ')}. Bu cluster'lar
      seçildiğinde işlem <strong>başlatılmadan</strong> reddedilir. Anahtarı
      <strong> Vault Anahtarları</strong> sekmesinden ekleyin — ve AWX'teki
      <code className="mx-1 px-1 rounded bg-amber-100">credentials.yaml</code>
      içinde de tanımlı olduğundan emin olun (portal AWX vault'unun gerçeğini göremez).
    </div>
  );
};

// Hem cluster hem de vault sekmesinde gösterilir: "Vault Anahtarı" başlığını gören bir
// admin oraya gerçek parolayı yapıştırırsa portal veritabanına düz metin yazılırdı.
const VaultKeyWarning: React.FC = () => (
  <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
    <strong>Vault Anahtarı bir parola DEĞİLDİR.</strong> Buraya AWX'teki
    <code className="mx-1 px-1 rounded bg-amber-100">credentials.yaml</code>
    dosyasında tanımlı <strong>değişkenin adını</strong> yazın (ör.
    <code className="mx-1 px-1 rounded bg-amber-100">uxmid_gar</code>). Parolalar portal
    veritabanında tutulmaz; playbook değeri doğrudan vault'tan okur.
    <strong className="ml-1">Buraya asla gerçek parola yazmayın.</strong>
  </div>
);

const TERMINAL_COLUMNS: ColumnDef<OcpTerminalHostRow>[] = [
  { key: 'tenant', label: 'Tenant', placeholder: 'ark' },
  { key: 'env', label: 'Ortam (env)', placeholder: 'dev' },
  { key: 'terminal_host', label: 'Jump Server (bastion)', placeholder: 'gbaocp01' },
  { key: 'is_active', label: 'Aktif', type: 'checkbox' },
];
const TERMINAL_EMPTY: Partial<OcpTerminalHostRow> = {
  tenant: '',
  env: '',
  terminal_host: '',
  is_active: true,
};


// Envanter tohumlaması (bootstrap seed) durumu. Portal ilk açılışta ~60 cluster'ı DB'ye
// PASİF olarak ekler; bu panel onun çalışıp çalışmadığını gösterir ve gerekirse yeniden
// çalıştırır. Yeniden çalıştırma var olan satırlara DOKUNMAZ — admin'in sildiği bir cluster
// geri gelmez, yalnızca hiç olmayanlar eklenir.
const BootstrapSeedPanel: React.FC<{ onSeeded: () => void }> = ({ onSeeded }) => {
  const [seeded, setSeeded] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    logxV2Api.admin
      .getBootstrapSeed()
      .then((r) => setSeeded(r.seeded))
      .catch(() => setSeeded(null));
  }, []);

  async function rerun() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await logxV2Api.admin.rerunBootstrapSeed();
      const { inserted = 0, skipped = 0, failed = 0 } = r.result || {};
      setNote(
        `${inserted} yeni cluster eklendi (pasif), ${skipped} zaten vardı${failed ? `, ${failed} eklenemedi` : ''}.`,
      );
      setSeeded(true);
      onSeeded();
    } catch (err: unknown) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Durum okunamasa bile paneli GİZLEME: eskiden 500 alınca panel yok oluyordu ve admin
  // böyle bir düğmenin varlığından haberdar olmuyordu.
  const durum = seeded === null ? 'okunamadı' : seeded ? 'yapıldı' : 'henüz yapılmadı';

  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/60 px-3 py-2.5 text-xs text-[var(--text-secondary)]">
      <div className="min-w-0">
        <span className="font-medium text-[var(--text-secondary)]">Envanter tohumlaması:</span> {durum}. Yeniden
        çalıştırmak mevcut satırlara dokunmaz, yalnızca eksik cluster'ları <strong>pasif</strong>{' '}
        olarak ekler.
        {note && <div className="mt-1 text-[var(--text-muted)]">{note}</div>}
      </div>
      <button
        onClick={rerun}
        disabled={busy}
        className="flex-shrink-0 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] font-medium hover:border-[var(--accent)] transition-colors active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
      >
        {busy ? 'Çalışıyor…' : 'Yeniden çalıştır'}
      </button>
    </div>
  );
};

// Cluster satırının canlı kontrolleri. Bu iki aksiyon eskiden Admin > Ansible
// Yapılandırma altındaki AYRI OCP kataloğundaydı; o katalog bu kataloğdan bağımsızdı ve
// üretimde boştu, dolayısıyla aksiyonlar hiç kullanılamıyordu. Tek katalog, tek yer.
const ClusterRowActions: React.FC<{ row: OcpClusterIndexRow }> = ({ row }) => {
  const { toast } = useToast();
  const [busy, setBusy] = useState<'conn' | 'pods' | null>(null);
  const [podOutput, setPodOutput] = useState<string | null>(null);

  async function run(kind: 'conn' | 'pods') {
    setBusy(kind);
    try {
      if (kind === 'conn') {
        const r = await logxV2Api.admin.testClusterConnection(row.id);
        if (r.ok)
          toast.success(
            `${row.cluster_name}: erişilebilir${r.responseTimeMs != null ? ` (${r.responseTimeMs} ms)` : ''}${r.message ? ` — ${r.message}` : ''}`,
          );
        else toast.error(`${row.cluster_name}: ${r.message || 'erişilemedi'}`);
      } else {
        const r = await logxV2Api.admin.clusterPodStatus(row.id);
        setPodOutput(r.output || '(çıktı boş)');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button
        onClick={() => run('conn')}
        disabled={busy !== null}
        aria-label={`${row.cluster_name} bağlantısını test et`}
        title="Bağlantı Testi (API /version)"
        className="p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] rounded-lg transition disabled:opacity-40"
      >
        <SignalIcon className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => run('pods')}
        disabled={busy !== null}
        aria-label={`${row.cluster_name} pod durumunu getir`}
        title="Pod Durumu (jump server üzerinden)"
        className="p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] rounded-lg transition disabled:opacity-40"
      >
        <CubeIcon className="w-3.5 h-3.5" />
      </button>
      {podOutput !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`${row.cluster_name} pod durumu`}
          onClick={() => setPodOutput(null)}
        >
          <div
            className="bg-white rounded-xl max-w-4xl w-full max-h-[80vh] overflow-auto p-4 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-[var(--text-secondary)]">
                {row.cluster_name} — pod durumu
              </h4>
              <button
                onClick={() => setPodOutput(null)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                Kapat
              </button>
            </div>
            <pre className="text-[11px] font-mono whitespace-pre-wrap text-[var(--text-secondary)]">
              {podOutput}
            </pre>
          </div>
        </div>
      )}
    </>
  );
};

const LogXv2AdminTab: React.FC = () => {
  const [subTab, setSubTab] = useState<SubTabId>('clusters');

  const clusters = useCrudSection(
    logxV2Api.admin.listClusterIndex,
    logxV2Api.admin.createClusterIndex,
    logxV2Api.admin.updateClusterIndex,
    logxV2Api.admin.deleteClusterIndex,
  );
  const terminals = useCrudSection(
    logxV2Api.admin.listTerminalHostMap,
    logxV2Api.admin.createTerminalHost,
    logxV2Api.admin.updateTerminalHost,
    logxV2Api.admin.deleteTerminalHost,
  );
  const vaultKeys = useCrudSection(
    logxV2Api.admin.listVaultKeys,
    logxV2Api.admin.createVaultKey,
    logxV2Api.admin.updateVaultKey,
    logxV2Api.admin.deleteVaultKey,
  );
  // Cluster tablosundaki "boş Jump Server" hücrelerinde yedek eşlemeyi gösterebilmek için
  // terminal-host satırlarına ihtiyaç var (iki sekme de aynı sayfada yüklüdür).
  const clusterCols = React.useMemo(
    () => clusterColumns(terminals.rows, clusters.rows, vaultKeys.rows),
    [terminals.rows, clusters.rows, vaultKeys.rows],
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg p-1 bg-[var(--bg-elevated)] flex-wrap">
        {SUB_TABS.map((t) => {
          const Icon = t.icon;
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                active ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {subTab === 'clusters' &&
        (clusters.loading ? (
          <LoadingLogo compact />
        ) : clusters.error ? (
          <div className="bg-red-50 rounded-xl p-4 text-sm text-red-700">{clusters.error}</div>
        ) : (
          <div className="space-y-3">
            <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-800">
              Her cluster kendi <strong>Jump Server</strong>'ını kullanabilir; aynı işlemde farklı
              cluster'lar farklı jump server'lara gidebilir. Alan boş bırakılırsa{' '}
              <strong>Terminal/Bastion Host</strong>
              sekmesindeki tenant/env yedek eşlemesi kullanılır. Her ikisi de yoksa o cluster
              seçildiğinde işlem başlatılamaz.
            </div>
            <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-800">
              <strong>OCP Kullanıcı Adı</strong>, playbook'un{' '}
              <code className="px-1 rounded bg-blue-100">oc login --username</code>
              değeridir. Boş bırakılırsa <strong>OCP Çalıştırma Ayarları</strong> sekmesindeki genel
              varsayılan kullanılır. İkisi de boşsa o cluster keşifte anlaşılır bir hatayla elenir —
              diğer cluster'lar çalışmaya devam eder.
            </div>
            <VaultKeyWarning />
            <UnknownVaultKeyBanner clusterRows={clusters.rows} vaultRows={vaultKeys.rows} />
            <SourceNote source={OCP_CLUSTER_INDEX} />
            <BootstrapSeedPanel onSeeded={clusters.reload} />
            <SimpleCrudTable
              columns={clusterCols}
              rows={clusters.rows}
              emptyRow={CLUSTER_EMPTY}
              onCreate={clusters.onCreate}
              onUpdate={clusters.onUpdate}
              onDelete={clusters.onDelete}
              rowActions={(row) => <ClusterRowActions row={row} />}
            />
          </div>
        ))}
      {subTab === 'vaultkeys' &&
        (vaultKeys.loading ? (
          <LoadingLogo compact />
        ) : vaultKeys.error ? (
          <div className="bg-red-50 rounded-xl p-4 text-sm text-red-700">{vaultKeys.error}</div>
        ) : (
          <div className="space-y-3">
            <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-800">
              AWX'teki <code className="px-1 rounded bg-blue-100">credentials.yaml</code> dosyasında
              tanımlı vault değişkenlerinin <strong>adları</strong>.{' '}
              <strong>OCP Cluster Hiyerarşisi</strong> sekmesindeki "Vault Anahtarı" alanı
              önerilerini buradan alır. Kullanımda olan bir anahtar silinemez — önce onu kullanan
              cluster satırlarını güncelleyin.
            </div>
            <VaultKeyWarning />
            <SimpleCrudTable
              columns={VAULT_KEY_COLUMNS}
              rows={vaultKeys.rows}
              emptyRow={VAULT_KEY_EMPTY}
              onCreate={vaultKeys.onCreate}
              onUpdate={vaultKeys.onUpdate}
              onDelete={vaultKeys.onDelete}
            />
          </div>
        ))}
      {subTab === 'terminals' &&
        (terminals.loading ? (
          <LoadingLogo compact />
        ) : terminals.error ? (
          <div className="bg-red-50 rounded-xl p-4 text-sm text-red-700">{terminals.error}</div>
        ) : (
          <div className="space-y-3">
            <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-800">
              Bu tablo <strong>yedek (fallback)</strong> eşlemedir: bir cluster'ın kendi satırında
              (OCP Cluster Hiyerarşisi sekmesi) Jump Server doluysa <strong>o kazanır</strong>;
              boşsa buradaki tenant/env eşlemesi kullanılır. Tek bir tenant/env için birden fazla
              satır tanımlanamaz — cluster'lara ayrı jump server vermek için diğer sekmeyi kullanın.
            </div>
            <SimpleCrudTable
              columns={TERMINAL_COLUMNS}
              rows={terminals.rows}
              emptyRow={TERMINAL_EMPTY}
              onCreate={terminals.onCreate}
              onUpdate={terminals.onUpdate}
              onDelete={terminals.onDelete}
            />
          </div>
        ))}
      {subTab === 'ocpruntime' && <OcpRuntimeSettings />}
    </div>
  );
};

export default LogXv2AdminTab;
