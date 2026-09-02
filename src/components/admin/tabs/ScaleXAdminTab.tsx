// src/components/admin/tabs/ScaleXAdminTab.tsx — ScaleX yönetimi.
//
// NEDEN AYRI BİR SAYFA: ScaleX'in SMART/OCO ayarı `ansible_ss_customizations` tablosunda,
// ScaleX'in kendi `(awx_server_id, template_id)` satırında duruyor — Self Service'teki
// nginx işleriyle AYNI yerde ve bu doğru. Ama o satırı düzenleyen tek ekran
// `FieldOverridesModal` idi ve yalnızca Self Service kataloğundan ya da Ansible
// sayfasından açılabiliyordu. Sonuç: admin, ScaleX'in SMART ayarını yapabilmek için
// ScaleX'in AWX template'ini **Self Service kataloğuna item olarak eklemek** zorundaydı.
// Sunucudaki hata mesajı da bunu itiraf ediyordu ("Admin > Ansible > Self Servis
// Özelleştirmeleri ekranından ScaleX şablonu için SMART onayını tanımlayın").
//
// YENİ TABLO YOK, YENİ UÇ YOK: aynı satır, aynı uçlar, aynı modal — yalnızca template
// kimliği `scalex_run` kaydından çözülüp doğru yerden açılıyor.
import React, { useEffect, useMemo, useState } from "react";
import {
  ShieldCheckIcon, ExclamationTriangleIcon, ArrowPathIcon, InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { playbookRegistryApi, type PlaybookRegistryEntry } from "@/api/playbookRegistryApi";
import FieldOverridesModal from "@/components/self_service/FieldOverridesModal";

const RUN_KEY = "scalex_run";
const DISCOVERY_KEY = "scalex_discovery";

const ScaleXAdminTab: React.FC = () => {
  const [rows, setRows] = useState<PlaybookRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGates, setShowGates] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await playbookRegistryApi.list();
      if (!r.ok) { setError(r.message || "Playbook kayıtları okunamadı."); return; }
      setRows((r.playbooks || []).filter((p) => p.keyName === RUN_KEY || p.keyName === DISCOVERY_KEY));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const run = useMemo(() => rows.find((r) => r.keyName === RUN_KEY) || null, [rows]);
  const discovery = useMemo(() => rows.find((r) => r.keyName === DISCOVERY_KEY) || null, [rows]);

  // SMART ayarı `(awx_server_id, template_id)` çiftine bağlı. Template ID yoksa
  // düzenlenecek bir satır da yok — modalı açmak, boşluğa yazmak olurdu.
  const runTemplateId = run?.effectiveTemplateId ?? run?.awxTemplateId ?? null;
  const runServerId = run?.awxServerId ?? 1;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2.5">
        <ShieldCheckIcon aria-hidden="true" className="w-5 h-5 flex-shrink-0 mt-0.5 text-[var(--text-secondary)]" />
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">ScaleX yönetimi</p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Onay kapıları ve AWX bağlantısı. Cluster / vault anahtarı / jump server bilgisi
            <strong> burada değil</strong>: onlar OCP Yapılandırma sekmesinde, tek yerde tutulur
            ve LogX, OpsX, Telnet ile <strong>paylaşılır</strong>.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--text-muted)]">Yükleniyor…</p>
      ) : (
        <>
          {/* ── AWX bağlantısı ── */}
          <section className="rounded-xl border border-[var(--border)] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--text-primary)]">AWX bağlantısı</p>
              <button type="button" onClick={load}
                className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline">
                <ArrowPathIcon aria-hidden="true" className="w-3.5 h-3.5" /> Yenile
              </button>
            </div>
            <div className="space-y-2">
              {[{ e: run, label: "Replica işlemi", key: RUN_KEY },
                { e: discovery, label: "Keşif (salt okunur)", key: DISCOVERY_KEY }].map(({ e, label, key }) => (
                <div key={key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="text-[var(--text-primary)]">{label}</span>
                    <span className="ml-2 font-mono text-xs text-[var(--text-muted)]">{key}</span>
                  </span>
                  <span className="flex items-center gap-2 whitespace-nowrap text-xs">
                    {/* KAYNAK GÖRÜNÜR: değer DB'den mi geldi, `.env` yedeğinden mi?
                        Bu ayrım bir üretim arızasında doğrudan işe yarar. */}
                    {e?.awxTemplateId
                      ? <span className="pf-label pf-label--green">DB: #{e.awxTemplateId}</span>
                      : e?.effectiveTemplateId
                        ? <span className="pf-label pf-label--blue">.env: {e.envVarName}</span>
                        : <span className="pf-label pf-label--red">Tanımsız</span>}
                    <span className="text-[var(--text-muted)]">AWX sunucusu: {e?.awxServerId ?? "varsayılan (1)"}</span>
                    {e && !e.enabled && <span className="pf-label pf-label--gold">pasif</span>}
                  </span>
                </div>
              ))}
            </div>
            <p className="flex items-start gap-1.5 text-xs text-[var(--text-muted)]">
              <InformationCircleIcon aria-hidden="true" className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              Template ID ve AWX sunucusu <strong>Playbook Kayıtları</strong> sekmesinden girilir;
              burası yalnızca durumu gösterir. Tanımsızken ScaleX ekranı çalışmaz
              (<span className="font-mono">501</span>).
            </p>
          </section>

          {/* ── Onay kapıları ── */}
          <section className="rounded-xl border border-[var(--border)] p-4 space-y-3">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Onay kapıları (SMART / OCO)</p>
            <div className="rounded-lg bg-[var(--bg-inset)] p-3 text-xs text-[var(--text-secondary)] space-y-1">
              <p><strong>Yalnızca production.</strong> Prod dışı <span className="font-mono">apply</span> işlemleri
                OCO numarası istemez ve SMART kaydı açmaz. Değişiklik izi her ortamda tutulur.</p>
              <p><strong>Ortam bilinmiyorsa prod sayılır</strong> — bilgi yokluğu kapıyı açar.</p>
              <p><span className="font-mono">dry_run</span> hiçbir kapıdan geçmez; <strong>Geri Al</strong> prod'da
                OCO'yu uyarı olarak geçer (gerekçe zorunlu) ama SMART kaydı açar.</p>
              <p className="text-amber-800">
                SMART yapılandırılmadan prod'da <span className="font-mono">apply</span> çalışmaz —
                sunucu <span className="font-mono">503 smart_not_configured</span> ile reddeder.
              </p>
            </div>
            {runTemplateId ? (
              <button type="button" className="btn-secondary" onClick={() => setShowGates(true)}>
                SMART / OCO ayarlarını düzenle
              </button>
            ) : (
              <p className="text-xs text-amber-800">
                Önce <strong>Playbook Kayıtları</strong>'nda <span className="font-mono">{RUN_KEY}</span> satırına
                AWX Template ID girin — SMART ayarı o template'e bağlı tutulur.
              </p>
            )}
          </section>
        </>
      )}

      {/* AYNI MODAL, AYNI TABLO, AYNI UÇLAR — yalnızca doğru yerden açılıyor. */}
      {showGates && runTemplateId != null && (
        <FieldOverridesModal
          item={{ awxServerId: runServerId, awxTemplateId: runTemplateId, title: "ScaleX — Replica İşlemi" }}
          onClose={() => setShowGates(false)}
        />
      )}
    </div>
  );
};

export default ScaleXAdminTab;
