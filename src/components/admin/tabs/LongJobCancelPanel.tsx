// src/components/admin/tabs/LongJobCancelPanel.tsx — "Uzun süren işleri iptal" (Admin > Ansible Info).
//
// Kullanıcı kararları (2026-09-14): eşik 60 dk; YALNIZCA burada seçilen template'ler
// iptal edilir; mod: doğrudan iptal + Teams. Sunucu tarafı: server/ansible/long-job-cancel.cjs
// (watcher 5 dk'da bir bakar). Liste boşsa hiçbir şey iptal edilmez.
import React, { useEffect, useMemo, useState } from "react";
import { ansibleApi, type AwxTemplate } from "@/api/ansibleApi";
import { safeJson } from "@/api/http";

interface Cfg {
  enabled: boolean;
  thresholdMinutes: number;
  templates: { serverId: number; templateId: number; name: string }[];
}
type Summary = { serverId: number; serverName: string; ok: boolean; templates: AwxTemplate[]; error?: string }[];

export default function LongJobCancelPanel({ summary }: { summary: Summary }) {
  const [cfg, setCfg] = useState<Cfg>({ enabled: false, thresholdMinutes: 60, templates: [] });
  const [teamsConfigured, setTeamsConfigured] = useState(true);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/ansible/longjob-cancel").then(safeJson).then((r) => {
      if (!alive || !r.ok) return;
      setCfg(r.config);
      setTeamsConfigured(r.teamsConfigured !== false);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const key = (s: number, t: number) => `${s}:${t}`;
  const selected = useMemo(() => new Set(cfg.templates.map((t) => key(t.serverId, t.templateId))), [cfg.templates]);

  const toggle = (serverId: number, tpl: AwxTemplate) => {
    const k = key(serverId, tpl.id);
    setCfg((c) => ({
      ...c,
      templates: selected.has(k)
        ? c.templates.filter((t) => key(t.serverId, t.templateId) !== k)
        : [...c.templates, { serverId, templateId: tpl.id, name: tpl.name }],
    }));
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/ansible/longjob-cancel", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      }).then(safeJson);
      if (r.ok) {
        setCfg(r.config);
        setMsg({ tone: "ok", text: r.config.enabled && r.config.templates.length ? `Kaydedildi. ${r.config.templates.length} template için ${r.config.thresholdMinutes} dk eşiği aktif (en geç 5 dk içinde devreye girer).` : "Kaydedildi. Otomatik iptal KAPALI (açık değil ya da liste boş)." });
      } else setMsg({ tone: "bad", text: r.message || "Kaydedilemedi." });
    } catch (e: unknown) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const needle = q.trim().toLowerCase();
  const inputCls = "px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white";

  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-700 mb-1">Uzun süren işleri otomatik iptal</h3>
      <p className="text-xs text-gray-500 mb-3">
        Portal 5 dakikada bir tüm AWX (maestro) sunucularındaki <b>çalışan</b> job'lara bakar; eşiği aşan ve
        <b> aşağıda seçili</b> template'lerden gelen job'ı <code>cancel</code> eder, Teams'e bildirir ve Denetim Kaydı'na yazar.
        Seçili olmayan template'ler <b>hiçbir zaman</b> iptal edilmez (yalnızca 30 dk bildirimi gider). Uzun sürmesi normal
        işleri (envanter, kurulum, upgrade) seçmeyin.
        {!teamsConfigured && <span className="block mt-1 text-amber-700">Teams webhook (TEAMS_LONGJOB_WEBHOOK_URL) tanımlı değil: iptal yine yapılır ama bildirim gitmez.</span>}
      </p>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg((c) => ({ ...c, enabled: e.target.checked }))} />
          <span className={cfg.enabled ? "font-semibold text-red-700" : ""}>Otomatik iptal {cfg.enabled ? "AÇIK" : "kapalı"}</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-gray-400">Eşik (dakika)</span>
          <input
            type="number"
            min={5}
            max={1440}
            value={cfg.thresholdMinutes}
            onChange={(e) => setCfg((c) => ({ ...c, thresholdMinutes: Number(e.target.value) || 60 }))}
            className={`${inputCls} w-24`}
          />
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="template ara" className={`${inputCls} w-56`} />
        <span className="text-xs text-gray-500">{cfg.templates.length} template seçili</span>
        <button onClick={save} disabled={busy} className="px-3 py-1.5 text-xs font-semibold rounded-lg text-white bg-[#1C69D4] disabled:opacity-50">
          {busy ? "Kaydediliyor…" : "Kaydet"}
        </button>
        {msg && <span className={`text-xs ${msg.tone === "ok" ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</span>}
      </div>

      {cfg.templates.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {cfg.templates.map((t) => (
            <span key={key(t.serverId, t.templateId)} className="text-[11px] px-2 py-0.5 rounded-full border border-red-200 bg-red-50 text-red-700">
              {t.name || `#${t.templateId}`} <span className="opacity-70">({summary.find((s) => s.serverId === t.serverId)?.serverName || `sunucu ${t.serverId}`})</span>
              <button className="ml-1 opacity-70 hover:opacity-100" title="listeden çıkar" onClick={() => setCfg((c) => ({ ...c, templates: c.templates.filter((x) => key(x.serverId, x.templateId) !== key(t.serverId, t.templateId)) }))}>×</button>
            </span>
          ))}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {summary.map((s) => (
          <div key={s.serverId} className="rounded-xl border border-gray-200 p-3">
            <div className="text-xs font-semibold text-gray-700 mb-2">{s.serverName} {!s.ok && <span className="text-red-600 font-normal">— {s.error || "template listesi alınamadı"}</span>}</div>
            <div className="max-h-64 overflow-auto space-y-0.5">
              {s.templates
                .filter((t) => !needle || t.name.toLowerCase().includes(needle) || String(t.id).includes(needle))
                .map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                    <input type="checkbox" checked={selected.has(key(s.serverId, t.id))} onChange={() => toggle(s.serverId, t)} />
                    <span className="font-mono text-gray-400 w-12">#{t.id}</span>
                    <span>{t.name}</span>
                  </label>
                ))}
              {s.templates.length === 0 && <div className="text-xs text-gray-400">template yok</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
