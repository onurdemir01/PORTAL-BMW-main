import React, { useState, useEffect } from "react";
import { XCircleIcon, TrashIcon, ArrowPathIcon, PencilIcon } from "@heroicons/react/24/outline";
import { inventoryApi } from "@/api/inventoryApi";
import { toast } from "@/hooks/useToast";
import { nobetciApi } from "@/api/nobetciApi";
import { dynatraceApi } from "@/api/dynatraceApi";

// Backend whitelist'i ile hizalı (server/db/env-overrides.cjs SYSTEM_CONFIG_KEYS) —
// SESSION_SECRET/şifreler kasıtlı olarak listede yok.
// actions.md #10 (Bolum I) — her anahtar icin aciklama/zorunluluk/ornek/kullanim-yeri/
// restart-gerekliligi: kullanici-dostu meta veri, DB'ye GITMEZ (yalniz frontend'de sabit).
interface EnvVarMeta {
  key: string; label: string; group: string;
  description: string; required: boolean; example: string; usedIn: string; restartRequired: boolean;
}
const ENV_VARS: EnvVarMeta[] = [
  { key: "PORT", label: "Port", group: "Sunucu", description: "Node sunucusunun dinlediği TCP portu.", required: false, example: "3000", usedIn: "server/index.cjs", restartRequired: true },
  { key: "NODE_ENV", label: "Ortam", group: "Sunucu", description: "production/development — statik dosya servisi ve log seviyesini belirler.", required: true, example: "production", usedIn: "Genel", restartRequired: true },
  { key: "MSSQL_SERVER", label: "MSSQL Server", group: "Veritabanı", description: "Portal DB'sinin barındığı MSSQL sunucu adresi.", required: true, example: "10.151.162.147", usedIn: "server/db/index.cjs", restartRequired: true },
  { key: "MSSQL_DATABASE", label: "MSSQL Database", group: "Veritabanı", description: "Portal veritabanı adı (TBMWANS).", required: true, example: "TBMWANS", usedIn: "server/db/index.cjs", restartRequired: true },
  { key: "MSSQL_RO_USER", label: "Envanter Salt-Okunur Kullanıcı", group: "Veritabanı", description: "Custom SQL (Envanter) için ayrı, GRANT SELECT-only DB kullanıcısı — tanımlı değilse paylaşılan (yazma-yetkili) havuza düşülür.", required: false, example: "portal_ro", usedIn: "server/inventory/mssql-readonly.cjs", restartRequired: false },
  { key: "MSSQL_RO_PASSWORD", label: "Envanter Salt-Okunur Şifre", group: "Veritabanı", description: "MSSQL_RO_USER ile birlikte kullanılır — DB'de şifreli saklanır.", required: false, example: "••••••••", usedIn: "server/inventory/mssql-readonly.cjs", restartRequired: false },
  { key: "LDAP_URL", label: "LDAP URL", group: "Auth", description: "Kurumsal Active Directory/LDAP bağlantı adresi.", required: true, example: "ldaps://dc.garanti.com.tr", usedIn: "server/auth/ldap.cjs", restartRequired: true },
  { key: "LDAP_BASE_DN", label: "LDAP Base DN", group: "Auth", description: "Kullanıcı arama için LDAP taban DN'i.", required: true, example: "DC=garanti,DC=com,DC=tr", usedIn: "server/auth/ldap.cjs", restartRequired: true },
  { key: "AWX_URL", label: "AWX URL", group: "Ansible", description: "Varsayılan (legacy tek-sunucu) AWX/Tower adresi.", required: false, example: "https://awx.garanti.com.tr", usedIn: "server/ansible/runner.cjs", restartRequired: false },
  { key: "AWX_USER", label: "AWX Kullanıcı Adı", group: "Ansible", description: "AWX_TOKEN tanımlı değilse, token almak için kullanılan servis hesabı.", required: false, example: "svc-portal-awx", usedIn: "server/ansible/runner.cjs (getToken)", restartRequired: false },
  { key: "AWX_PASSWORD", label: "AWX Şifresi", group: "Ansible", description: "AWX_USER ile birlikte kullanılır — DB'de AES-256-GCM ile şifreli saklanır.", required: false, example: "••••••••", usedIn: "server/ansible/runner.cjs (getToken)", restartRequired: false },
  { key: "AWX_READ_ONLY_TEMPLATE_IDS", label: "Salt-Okunur Template ID'leri", group: "Ansible", description: "Virgülle ayrılmış AWX template ID listesi — boşsa TÜM template'ler izinli sayılır.", required: false, example: "12,47,83", usedIn: "server/ansible/runner.cjs (listTemplates)", restartRequired: false },
  { key: "AWX_LOG_FETCH_TEMPLATE_ID", label: "Log Fetch Template ID", group: "Ansible", description: "AI Analist'in uzak log dosyası çekmek için kullandığı AWX template ID'si.", required: false, example: "51", usedIn: "server/ai-analyst/portal-tools.cjs", restartRequired: false },
  { key: "NOBETCI_API_URL", label: "Nöbet API URL", group: "Nöbet", description: "Harici nöbetçi/duty sisteminin (gbnys) API adresi.", required: false, example: "https://gbnys.example.com/api", usedIn: "server/nobetci/index.cjs", restartRequired: false },
  { key: "NOBETCI_TEAM_NAME", label: "Nöbet Takım Adı", group: "Nöbet", description: "Görüntülenen takım adı (yalnızca UI etiketi).", required: false, example: "BMW Portal Operasyon", usedIn: "server/nobetci/index.cjs", restartRequired: false },
  { key: "NOBETCI_TEAM_ID", label: "Nöbet Takım ID", group: "Nöbet", description: "Harici sistemdeki takım kimliği — sorgu filtresi.", required: false, example: "42", usedIn: "server/nobetci/index.cjs", restartRequired: false },
  { key: "NOBETCI_TEAM_TYPE", label: "Nöbet Takım Tipi", group: "Nöbet", description: "Harici sistemin beklediği takım tipi parametresi.", required: false, example: "operasyon", usedIn: "server/nobetci/index.cjs", restartRequired: false },
  { key: "NOBETCI_API_HOST", label: "Nöbet API Host (alternatif)", group: "Nöbet", description: "NOBETCI_API_URL yerine yalnızca host bileşeni gerekiyorsa kullanılır.", required: false, example: "gbnys.example.com", usedIn: "server/nobetci/index.cjs", restartRequired: false },
  { key: "DT_MANAGED_MCP_URL", label: "Dynatrace MCP URL", group: "Monitoring", description: "Dynatrace Managed MCP sunucu adresi.", required: false, example: "https://dt.garanti.com.tr/mcp", usedIn: "server/dynatrace/index.cjs", restartRequired: false },
  { key: "INSTANA_MCP_URL", label: "Instana MCP URL", group: "Monitoring", description: "Instana MCP sunucu adresi.", required: false, example: "https://instana.garanti.com.tr/mcp", usedIn: "server/instana/index.cjs", restartRequired: false },
  { key: "CORP_CA_CERT_PATH", label: "Kurumsal CA Zinciri Yolu", group: "TLS / Sertifika", description: "Public köklere ek olarak yüklenecek kurumsal CA zinciri (fetch-ca.sh + build-ca-bundle.cjs çıktısı) — MCP/Splunk/AI/Smart gibi dış bağlantılarda \"self signed certificate\" hatasını çözer. Her istekte diskten YENİDEN okunur (restart gerekmez).", required: false, example: "server/certs/combined-ca-chain.pem", usedIn: "server/ai/ca.cjs (buildCombinedCa)", restartRequired: false },
  { key: "AI_PROVIDER", label: "AI Sağlayıcı", group: "AI", description: "anthropic veya openai — AI Analist'in kullanacağı sağlayıcı.", required: false, example: "anthropic", usedIn: "server/ai/provider.cjs", restartRequired: false },
  { key: "ANTHROPIC_MODEL", label: "Anthropic Model", group: "AI", description: "AI_PROVIDER=anthropic iken kullanılacak model adı.", required: false, example: "claude-sonnet-5", usedIn: "server/ai/provider.cjs", restartRequired: false },
  { key: "OPENAI_MODEL", label: "OpenAI Model", group: "AI", description: "AI_PROVIDER=openai iken kullanılacak model adı.", required: false, example: "gpt-4o", usedIn: "server/ai/provider.cjs", restartRequired: false },
  { key: "ANTHROPIC_API_KEY", label: "Anthropic API Key", group: "AI", description: "Anthropic API kimlik anahtarı — DB'de şifreli saklanır.", required: false, example: "••••••••", usedIn: "server/ai/provider.cjs", restartRequired: false },
  { key: "OPENAI_API_KEY", label: "OpenAI API Key", group: "AI", description: "OpenAI API kimlik anahtarı — DB'de şifreli saklanır.", required: false, example: "••••••••", usedIn: "server/ai/provider.cjs", restartRequired: false },
  { key: "LOGX_V2_STAGING_LEGACY_DIR", label: "LogX v2 Legacy Staging Dizini", group: "LogX v2", description: "Legacy EAR indirmelerinin geçici olarak konduğu dizin.", required: false, example: "/data/logx/staging/legacy", usedIn: "server/logx/v2/legacy.cjs", restartRequired: false },
  { key: "LOGX_V2_STAGING_OCP_DIR", label: "LogX v2 OCP Staging Dizini", group: "LogX v2", description: "OCP namespace indirmelerinin geçici olarak konduğu dizin.", required: false, example: "/data/logx/staging/ocp", usedIn: "server/logx/v2/ocp.cjs", restartRequired: false },
  { key: "LOGX_STAGING_FALLBACK_DIR", label: "LogX v2 Fallback Dizini", group: "LogX v2", description: "Ana staging dizinine erişilemediğinde kullanılan yerel yedek dizin.", required: false, example: "/tmp/logx-fallback", usedIn: "server/logx/v2/downloads.cjs", restartRequired: false },
  { key: "LOGX_APPS_TABLE", label: "Uygulama Envanteri Tablosu", group: "Veritabanı", description: "Kurumsal uygulama envanteri tablosu — app, host ve env sütunlarını içermeli. LogX Legacy uygulama arama, OpsX ve AI Analist host araçları bu tabloyu okur. Boş bırakılırsa MWAppsInventory kullanılır.", required: false, example: "MWAppsInventory", usedIn: "server/config/apps-table.cjs", restartRequired: false },
  { key: "OPSX_AWX_SERVER_ID", label: "OpsX AWX Sunucusu (yedek)", group: "OpsX", description: "Playbook Kayıtları'nda satır bazında AWX sunucusu belirtilmemişse kullanılan yedek değer (ansible_awx_servers.server_no). Öncelik her zaman Playbook Kayıtları'ndaki değerdedir.", required: false, example: "0", usedIn: "server/opsx/index.cjs", restartRequired: false },
  { key: "OPSX_LEGACY_DUMP_TEMPLATE_ID", label: "Legacy Dump Template ID (yedek)", group: "OpsX", description: "Playbook Kayıtları'nda \"OpsX — Legacy Thread/Heap Dump\" satırının Template ID'si boşsa kullanılan yedek değer.", required: false, example: "", usedIn: "server/opsx/index.cjs", restartRequired: false },
  { key: "OPSX_OPENSHIFT_DUMP_TEMPLATE_ID", label: "Openshift Dump Template ID (yedek)", group: "OpsX", description: "Playbook Kayıtları'nda \"OpsX — Openshift Thread/Heap Dump\" satırının Template ID'si boşsa kullanılan yedek değer.", required: false, example: "", usedIn: "server/opsx/index.cjs", restartRequired: false },
  { key: "OPSX_DUMP_STAGING_DIR", label: "Dump Staging Dizini (Legacy)", group: "OpsX", description: "Legacy thread/heap dump dosyalarının bırakıldığı, portalın okuyabildiği paylaşılan dizin — hedef JBoss host'larında da mount'lu olmalı. Openshift dump'ları KULLANMAZ (teslimat FTP'ye yapılır).", required: false, example: "/sw/BMW_PORTAL/opsx/dumps", usedIn: "server/opsx/downloads.cjs", restartRequired: false },
  { key: "SMART_API_URL", label: "Smart API URL", group: "Smart", description: "Kurum içi talep yönetim sistemi (Smart/RFF) taban adresi — ortama göre değişir (SOS02-KL-001-EN): Test gbcalt01.fw.garanti.com.tr:8443, QA gbcadq01.fw.garanti.com.tr:8443, Prod gbca.fw.garanti.com.tr:8443.", required: false, example: "https://gbca.fw.garanti.com.tr:8443", usedIn: "server/smart/client.cjs", restartRequired: false },
  { key: "SMART_API_USERNAME", label: "Smart Kullanıcı Adı", group: "Smart", description: "Smart API'ye Basic Auth ile bağlanan, L7_SMART_REQUEST LDAP grubuna üye servis hesabı.", required: false, example: "svc-portal-smart", usedIn: "server/smart/client.cjs", restartRequired: false },
  { key: "SMART_API_PASSWORD", label: "Smart Şifresi", group: "Smart", description: "SMART_API_USERNAME ile birlikte kullanılır — DB'de AES-256-GCM ile şifreli saklanır.", required: false, example: "••••••••", usedIn: "server/smart/client.cjs", restartRequired: false },
  { key: "SMART_RFF_TOKEN", label: "Integration Key (RFF-Request-Token)", group: "Smart", description: "Designer > \"Integration Information\" ile alınan anahtar — DB'de şifreli saklanır. Gönderilmezse Smart hata döner.", required: false, example: "••••••••", usedIn: "server/smart/client.cjs", restartRequired: false },
  { key: "SMART_DOMAIN", label: "Domain", group: "Smart", description: "Talep açan kullanıcının login domain bilgisi — SOS02-KL-001-EN örneklerinde sabit \"GARANTI\".", required: false, example: "GARANTI", usedIn: "server/smart/client.cjs", restartRequired: false },
  { key: "SMART_PROXY_URL", label: "Proxy URL (opsiyonel, sadece Smart)", group: "Smart", description: "Yalnızca Smart trafiğini bu proxy üzerinden gönderir — sistem geneli HTTPS_PROXY'den bilerek bağımsızdır (o, MCP/Splunk/AI gibi diğer tüm entegrasyonları da etkiler). Boşsa doğrudan bağlanılır.", required: false, example: "http://proxy.sirket.com.tr:8080", usedIn: "server/smart/client.cjs", restartRequired: false },
  { key: "SMART_CREATE_TICKET_PATH", label: "Talep Açma Path'i", group: "Smart", description: "DOĞRULANDI (SOS02-KL-001-EN) — değiştirmeyin, sadece dokümanla path değişirse güncelleyin.", required: false, example: "/smart/internal/requestfulfilment/createoperationalrequest/v1", usedIn: "server/smart/client.cjs", restartRequired: false },
  { key: "SMART_GET_METADATA_PATH", label: "Metadata Sorgulama Path'i", group: "Smart", description: "DOĞRULANDI (SOS02-KL-001-EN) — bir Flow Key'in beklediği metadata alanlarını sorgular (opsiyonel yardımcı araç, henüz hiçbir yerden çağrılmıyor).", required: false, example: "/smart/internal/getmetadataoperationalrequestbyflowname/v1", usedIn: "server/smart/client.cjs", restartRequired: false },
  { key: "SMART_CHECK_TICKET_PATH", label: "Durum Sorgulama Path'i (DOĞRULANMADI)", group: "Smart", description: "⚠ SOS02-KL-001-EN dokümanında talep durumu sorgulayan bir REST endpoint'i YOK — bu muhtemelen ayrı bir sistem. Boş bırakılırsa checkTicketStatus() açıkça hata verir, talepler PENDING'de bekler. Ayrı dokümantasyon gelince doldurun.", required: false, example: "(henüz bilinmiyor)", usedIn: "server/smart/client.cjs", restartRequired: false },
  { key: "SMART_POLL_INTERVAL_SECONDS", label: "Kontrol Sıklığı (sn)", group: "Smart", description: "Bekleyen Smart taleplerinin ne sıklıkla kontrol edileceği.", required: false, example: "30", usedIn: "server/smart/poller.cjs", restartRequired: true },
  { key: "SMART_TICKET_TIMEOUT_HOURS", label: "Zaman Aşımı (saat)", group: "Smart", description: "Bu süre içinde onaylanmayan talepler TIMEOUT olarak işaretlenir, iş asla başlatılmaz.", required: false, example: "24", usedIn: "server/smart/poller.cjs", restartRequired: false },
];

interface ConfigValue { key: string; value: string; defined: boolean; masked: boolean; }

const CACHE_ACTIONS = [
  { key: "nobetci",    label: "Nöbet Önbelleği",   desc: "nobetci/today 5dk cache",       serverEndpoint: "/api/admin/cache/nobetci" },
  { key: "awx-tokens", label: "AWX Token",          desc: "Tüm sunucu token'ları",         serverEndpoint: "/api/admin/cache/awx-tokens" },
  { key: "inventory",  label: "Envanter (Client)",  desc: "Client-side tablo/sütun cache", serverEndpoint: null },
  { key: "dt-health",  label: "DT Health (Client)", desc: "Dynatrace health cache",        serverEndpoint: null },
];

export default function SystemConfigTab() {
  const [cacheClearing, setCacheClearing] = useState<string | null>(null);

  // System config (env) state
  const [configValues, setConfigValues] = useState<Record<string, ConfigValue>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [configSaving, setConfigSaving] = useState(false);
  const [restartNeeded, setRestartNeeded] = useState(false);

  async function loadSystemConfig() {
    try {
      const r = await fetch("/api/admin/system-config").then((x) => x.json());
      if (r.ok) {
        const map: Record<string, ConfigValue> = {};
        for (const v of r.values as ConfigValue[]) map[v.key] = v;
        setConfigValues(map);
      }
    } catch { /* backend erişilemezse env bölümü değersiz görünür */ }
  }

  useEffect(() => { loadSystemConfig(); }, []);

  async function saveConfigValue(key: string) {
    setConfigSaving(true);
    try {
      const r = await fetch("/api/admin/system-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: editValue }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "Kaydedilemedi");
      toast.success(`${key} güncellendi.`);
      setRestartNeeded(true);
      setEditingKey(null);
      loadSystemConfig();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setConfigSaving(false);
    }
  }

  async function clearCache(key: string, endpoint: string | null) {
    setCacheClearing(key);
    try {
      if (key === "inventory") {
        inventoryApi.invalidateCache?.();
        toast.success("Envanter önbelleği temizlendi.");
      } else if (key === "dt-health") {
        dynatraceApi.invalidateCache?.();
        toast.success("DT health önbelleği temizlendi.");
      } else if (key === "nobetci") {
        nobetciApi.invalidate();
        if (endpoint) {
          await fetch(endpoint, { method: "POST" });
        }
        toast.success("Nöbet önbelleği temizlendi.");
      } else if (endpoint) {
        const r = await fetch(endpoint, { method: "POST" });
        const d = await r.json() as { ok: boolean };
        if (d.ok) toast.success(`${key} önbelleği temizlendi.`);
        else toast.error("Önbellek temizlenemedi.");
      }
    } catch {
      toast.error("Önbellek temizlenirken hata oluştu.");
    } finally {
      setCacheClearing(null);
    }
  }

  // Group env vars
  const groups = Array.from(new Set(ENV_VARS.map((v) => v.group)));

  return (
    <div className="space-y-8">

      {/* K-08: Cache Clear Buttons */}
      <section>
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Önbellek Yönetimi</h3>
        <p className="text-xs text-gray-400 mb-4">Servis önbelleklerini manuel temizle — bir sonraki istek gerçek veriden yeniden yükler.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {CACHE_ACTIONS.map((ca) => (
            <button
              key={ca.key}
              onClick={() => clearCache(ca.key, ca.serverEndpoint)}
              disabled={cacheClearing === ca.key}
              className="flex flex-col items-center gap-1.5 px-3 py-3 text-center border border-gray-200 rounded-xl hover:border-[#1A56DB] hover:bg-blue-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowPathIcon className={`w-4 h-4 text-[#1A56DB] ${cacheClearing === ca.key ? "animate-spin" : ""}`} />
              <span className="text-xs font-semibold text-gray-700">{ca.label}</span>
              <span className="text-[10px] text-gray-400">{ca.desc}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Environment Variables — mevcut değer + inline düzenleme */}
      <section>
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Ortam Değişkenleri</h3>
        <p className="text-xs text-gray-400 mb-3">
          Mevcut değerler gösterilir; kalem ikonuyla düzenlenebilir (.env.local'a yazılır).
          Hassas değerler (API key vb.) maskelenir — düzenlerken yeni değer girilir, eski değer gösterilmez.
        </p>

        {restartNeeded && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            ⚠ Değişikliklerin tam etkili olması için sunucu yeniden başlatılmalı — modüllerin çoğu env'i açılışta okur.
          </div>
        )}

        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{group}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ENV_VARS.filter((v) => v.group === group).map((v) => {
                  const cv = configValues[v.key];
                  const isEditing = editingKey === v.key;
                  return (
                    <div key={v.key} className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 rounded-xl border border-transparent hover:border-gray-200 transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-medium text-gray-700">{v.label}</p>
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cv?.defined ? "bg-green-500" : "bg-gray-300"}`} title={cv?.defined ? "Tanımlı" : "Boş"} />
                          {v.required && <span className="text-[9px] px-1 rounded bg-amber-50 text-amber-600 font-medium">zorunlu</span>}
                          <span
                            className="text-gray-300 hover:text-gray-500 cursor-help text-xs leading-none flex-shrink-0"
                            title={`${v.description}\n\nÖrnek: ${v.example}\nKullanıldığı yer: ${v.usedIn}\nDeğişiklik sonrası restart gerekir: ${v.restartRequired ? "Evet" : "Hayır (canlı uygulanır)"}`}
                          >
                            ⓘ
                          </span>
                        </div>
                        <p className="text-[10px] font-mono text-gray-400">{v.key}</p>
                        {isEditing ? (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <input
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") saveConfigValue(v.key); if (e.key === "Escape") setEditingKey(null); }}
                              placeholder={cv?.masked ? "Yeni değer girin..." : ""}
                              className="flex-1 min-w-0 px-2 py-1 text-xs font-mono border border-blue-200 rounded-lg outline-none focus:border-[#1A56DB] bg-white"
                            />
                            <button onClick={() => saveConfigValue(v.key)} disabled={configSaving}
                              className="px-2 py-1 text-[10px] font-semibold bg-[#1A56DB] text-white rounded-lg disabled:opacity-50">
                              Kaydet
                            </button>
                            <button onClick={() => setEditingKey(null)} className="px-1.5 py-1 text-[10px] text-gray-400 hover:text-gray-600">İptal</button>
                          </div>
                        ) : (
                          <p className="text-xs font-mono text-gray-600 mt-0.5 truncate" title={cv?.masked ? undefined : cv?.value}>
                            {cv ? (cv.value || <span className="italic text-gray-300">boş</span>) : <span className="italic text-gray-300">yükleniyor…</span>}
                          </p>
                        )}
                      </div>
                      {!isEditing && (
                        <button
                          onClick={() => { setEditingKey(v.key); setEditValue(cv?.masked ? "" : cv?.value || ""); }}
                          title="Düzenle"
                          className="p-1.5 text-gray-300 hover:text-[#1A56DB] rounded-lg transition-colors flex-shrink-0"
                        >
                          <PencilIcon className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
