// src/components/self_service/OpsCatalogSection.tsx — "Operasyon Kataloğu".
//
// Soru: hangi iş, hangi ortamda, hangi onaylardan geçer?
//
// Tablo CANLI yapılandırmadan üretilir (server/ansible/ops-catalog.cjs); elle tutulan
// bir Excel değildir. Gerekçe: bir admin Smart/OCO anahtarını çevirdiği anda elle
// tutulan tablo yanlış olur — ve bu tabloda yanlış olmaması gereken tam da o bilgi.
// Paylaşmak gerektiğinde "Excel'e aktar" ile CSV indirilir.
//
// "Onay mercii" kolonu Portal'ın ÜRETEMEDİĞİ tek bilgi: Smart'ta hangi flow'u kimin
// onayladığı flow tanımının içinde ve elimizdeki Smart uçları onaylayan kişi/grup
// döndürmüyor. Bu yüzden Admin, satır üzerinde doğrudan doldurur (flowKey × ortam).
import React, { useEffect, useMemo, useState } from "react";
import { ansibleApi, type OpsCatalogRow } from "@/api/ansibleApi";
import {
  ArrowDownTrayIcon,
  ShieldCheckIcon,
  ClipboardDocumentCheckIcon,
  PencilSquareIcon,
  CheckIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

const ENV_ORDER = ["dev", "test", "qa", "prod"];

function Pill({ tone, children }: { tone: "on" | "off" | "muted"; children: React.ReactNode }) {
  const cls =
    tone === "on"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : tone === "off"
        ? "bg-gray-50 text-gray-500 border-gray-200"
        : "bg-amber-50 text-amber-700 border-amber-200";
  return (
    <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      {children}
    </span>
  );
}

export default function OpsCatalogSection({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<OpsCatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [envFilter, setEnvFilter] = useState<string>("");
  const [moduleFilter, setModuleFilter] = useState<string>("");
  const [onlyGated, setOnlyGated] = useState(false);
  // Düzenlenen satırın anahtarı: flowKey|env (onay mercii bu ikiliye bağlı, servise değil —
  // aynı flow birden fazla serviste kullanılabilir ve onayı aynıdır).
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const r = await ansibleApi.opsCatalog();
      if (!r.ok) { setErr(r.message || "Katalog yüklenemedi."); return; }
      setRows(r.rows || []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const modules = useMemo(() => Array.from(new Set(rows.map((r) => r.module))), [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("tr");
    return rows.filter((r) => {
      if (envFilter && r.env !== envFilter) return false;
      if (moduleFilter && r.module !== moduleFilter) return false;
      if (onlyGated && !r.smartRequired && !r.ocoRequired) return false;
      if (!needle) return true;
      return [r.module, r.service, r.flowKey, r.approver, r.awxServerName]
        .join(" ").toLocaleLowerCase("tr").includes(needle);
    });
  }, [rows, q, envFilter, moduleFilter, onlyGated]);

  const stats = useMemo(() => ({
    total: filtered.length,
    smart: filtered.filter((r) => r.smartRequired).length,
    oco: filtered.filter((r) => r.ocoRequired).length,
    // Onay gerektiren ama merci GIRILMEMIS satirlar — raporun asil eksik listesi.
    missing: filtered.filter((r) => r.smartRequired && !r.approver).length,
  }), [filtered]);

  async function saveApprover(row: OpsCatalogRow) {
    setSaving(true);
    try {
      const r = await ansibleApi.opsCatalogSetApprover(row.flowKey, row.env, draft);
      if (!r.ok) { setErr(r.message || "Kaydedilemedi."); return; }
      // Aynı flowKey+env başka servislerde de görünüyor olabilir; tümünü güncelle.
      setRows((prev) => prev.map((x) =>
        x.flowKey === row.flowKey && x.env === row.env ? { ...x, approver: draft } : x));
      setEditing(null);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-5 h-5 border-2 border-[#0066CC] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{err}</div>}

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3">
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          Tablo <b>canlı yapılandırmadan</b> üretilir — servis ayarlarında bir anahtar
          değiştiğinde burası kendiliğinden güncellenir. Kapı kararları çalışma zamanının
          kullandığı <b>aynı fonksiyonlardan</b> gelir, yani rapor ile gerçek davranış ayrışmaz.
        </p>
        <p className="text-xs text-[var(--text-muted)] mt-1.5 leading-relaxed">
          <b>OCO</b> yalnızca production taleplerinde aranır (<code>env</code>/<code>ortam</code> ={" "}
          <code>prod</code>/<code>production</code>). <b>LogX, OpsX, FileX ve Telnet</b> akışlarında
          bugün hiçbir onay kapısı yoktur; tabloda bu açıkça yazılıdır.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Servis, flow key, onay mercii ara…"
          className="px-3 py-2 text-sm rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] flex-1 min-w-[220px]"
        />
        <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded-xl border border-[var(--border)] bg-[var(--bg-surface)]">
          <option value="">Tüm modüller</option>
          {modules.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={envFilter} onChange={(e) => setEnvFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded-xl border border-[var(--border)] bg-[var(--bg-surface)]">
          <option value="">Tüm ortamlar</option>
          {ENV_ORDER.map((e) => <option key={e} value={e}>{e.toUpperCase()}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] px-2">
          <input type="checkbox" checked={onlyGated} onChange={(e) => setOnlyGated(e.target.checked)} />
          Sadece onay gerekenler
        </label>
        <a
          href="/api/ansible/ss/ops-catalog.csv"
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-xl border border-[var(--border)] hover:bg-[var(--bg-elevated)] transition-colors"
        >
          <ArrowDownTrayIcon className="w-4 h-4" />
          Excel'e aktar
        </a>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="px-2.5 py-1 rounded-lg bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
          {stats.total} satır
        </span>
        <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 flex items-center gap-1">
          <ShieldCheckIcon className="w-3.5 h-3.5" /> Smart: {stats.smart}
        </span>
        <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 flex items-center gap-1">
          <ClipboardDocumentCheckIcon className="w-3.5 h-3.5" /> OCO: {stats.oco}
        </span>
        {stats.missing > 0 && (
          <span className="px-2.5 py-1 rounded-lg bg-red-50 text-red-700">
            Onay mercii girilmemiş: {stats.missing}
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--bg-elevated)] text-left">
              <th className="px-3 py-2 font-semibold">Modül</th>
              <th className="px-3 py-2 font-semibold">Servis</th>
              <th className="px-3 py-2 font-semibold">Ortam</th>
              <th className="px-3 py-2 font-semibold">Smart</th>
              <th className="px-3 py-2 font-semibold">Flow Key</th>
              <th className="px-3 py-2 font-semibold">Onay mercii</th>
              <th className="px-3 py-2 font-semibold">OCO</th>
              <th className="px-3 py-2 font-semibold">Not</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const key = `${r.flowKey}|${r.env}`;
              const isEditing = editing === `${key}#${i}`;
              return (
                <tr key={`${r.module}-${r.serviceId}-${r.env}-${i}`}
                    className="border-t border-[var(--border)] hover:bg-[var(--bg-elevated)]">
                  <td className="px-3 py-2 whitespace-nowrap">{r.module}</td>
                  <td className="px-3 py-2">
                    {r.service}
                    {!r.enabled && <span className="ml-2 text-[11px] text-[var(--text-muted)]">(kullanıcılara kapalı)</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.envLabel}</td>
                  <td className="px-3 py-2">
                    {r.smartRequired ? <Pill tone="on">Gerekli</Pill> : <Pill tone="off">—</Pill>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs break-all">{r.flowKey || "—"}</td>
                  <td className="px-3 py-2">
                    {!r.smartRequired ? (
                      <span className="text-[var(--text-muted)]">—</span>
                    ) : isEditing ? (
                      <span className="flex items-center gap-1">
                        <input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          placeholder="ör. GT-Bulut Middleware Teknolojileri"
                          className="px-2 py-1 text-xs rounded-lg border border-[var(--border)] flex-1 min-w-[160px]"
                        />
                        <button type="button" disabled={saving} onClick={() => saveApprover(r)}
                          className="p-1 rounded-lg text-emerald-700 hover:bg-emerald-50" title="Kaydet">
                          <CheckIcon className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => setEditing(null)}
                          className="p-1 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]" title="Vazgeç">
                          <XMarkIcon className="w-4 h-4" />
                        </button>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <span className={r.approver ? "" : "text-red-600"}>
                          {r.approver || "girilmemiş"}
                        </span>
                        {isAdmin && (
                          <button type="button"
                            onClick={() => { setEditing(`${key}#${i}`); setDraft(r.approver); }}
                            className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                            title="Onay merciini düzenle">
                            <PencilSquareIcon className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.ocoRequired
                      ? <Pill tone="on">Gerekli</Pill>
                      : r.ocoConfigured
                        ? <Pill tone="muted">yalnız PROD</Pill>
                        : <Pill tone="off">—</Pill>}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{r.note}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-[var(--text-muted)]">Filtreye uyan satır yok.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {!isAdmin && (
        <p className="text-xs text-[var(--text-muted)]">
          Onay mercii bilgisini yalnızca Admin rolü düzenleyebilir.
        </p>
      )}
    </div>
  );
}
