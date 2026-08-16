// src/components/admin/tabs/FlowTestsTab.tsx — Admin > Akış Testleri.
//
// Self Service'teki "Test Senaryoları" (bkz. TestScenariosTab.tsx) AWX survey alanlarından
// senaryo türetiyordu — FileX/Telnet/OpsX'te survey yok, bunun yerine GERÇEK, o an geçerli
// bir örnek (uygulama/host/namespace) bulmak için zaten var olan salt-okunur KEŞİF uçları
// (searchApps/getHosts/getClusters/getOcpNamespaces/getOcpApps) kullanılır — Self Service'teki
// "değerler boş geliyor" sorunu burada YAŞANMAZ, çünkü senaryo canlı arama sonucundan kurulur.
//
// "Doğrula" ayrı bir backend ucu GEREKTİRMEZ: her run() endpoint'i zaten kendi anti-TOCTOU
// kontrolünü yapıyor (host/namespace seçimini YENİDEN keşfedip doğruluyor) — bu yüzden
// "Doğrula" burada, ekrandaki (admin tarafından değiştirilmiş olabilecek) değerlerin hâlâ
// canlı keşif sonucunda bulunup bulunmadığını kontrol eder; "Gerçekten Çalıştır" gerçek
// run() ucunu çağırır (onay penceresi + iş takip çubuğuna eklenir).
//
// KAPSAM (bilinçli): OpsX'in JVM/Pod keşif+dump zincirleri (çok adımlı async akış) ve
// LogX (request-tabanlı state machine) burada YOK — ayrı bir turda eklenecek.
import React, { useState } from "react";
import {
  BoltIcon, MagnifyingGlassIcon, ShieldCheckIcon, PlayIcon, ArrowPathIcon,
  CheckCircleIcon, XCircleIcon, FolderIcon, ServerStackIcon, CommandLineIcon,
} from "@heroicons/react/24/outline";
import { filexApi } from "@/api/filexApi";
import { telnetApi } from "@/api/telnetApi";
import { opsxApi, type OpsxOperation, type OpsxOcpOperation } from "@/api/opsxApi";
import { toast } from "@/hooks/useToast";
import { useJobTracker } from "@/contexts/JobTrackerContext";

type RunState = { status: "idle" | "checking" | "ok" | "invalid" | "running" | "ran" | "error"; message?: string };

function StatusBadge({ st }: { st: RunState }) {
  if (st.status === "idle") return null;
  const meta: Record<string, { label: string; cls: string; Icon: React.ElementType }> = {
    checking: { label: "Kontrol ediliyor…", cls: "bg-blue-50 text-blue-700 border-blue-200", Icon: ArrowPathIcon },
    ok:       { label: "Geçerli", cls: "bg-green-50 text-green-700 border-green-200", Icon: CheckCircleIcon },
    invalid:  { label: st.message || "Geçersiz", cls: "bg-red-50 text-red-700 border-red-200", Icon: XCircleIcon },
    running:  { label: "Tetikleniyor…", cls: "bg-blue-50 text-blue-700 border-blue-200", Icon: ArrowPathIcon },
    ran:      { label: st.message || "Tetiklendi", cls: "bg-green-50 text-green-700 border-green-200", Icon: CheckCircleIcon },
    error:    { label: st.message || "Hata", cls: "bg-red-50 text-red-700 border-red-200", Icon: XCircleIcon },
  };
  const m = meta[st.status];
  if (!m) return null;
  return (
    <div className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border ${m.cls} w-fit`}>
      <m.Icon className={`w-3.5 h-3.5 ${st.status === "checking" || st.status === "running" ? "animate-spin" : ""}`} />
      {m.label}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[11px] font-mono text-gray-500 w-28 flex-shrink-0">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 min-w-0 text-xs font-mono border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#0066CC]"
      />
    </div>
  );
}

function SectionCard({
  icon: Icon, title, note, children,
}: { icon: React.ElementType; title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="p-4 border border-gray-200 rounded-xl bg-white space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-[#0066CC] flex-shrink-0" />
        <div className="font-semibold text-sm">{title}</div>
      </div>
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>{note}</div>
      {children}
    </div>
  );
}

function ActionRow({
  onDiscover, onValidate, onRun, discovering, validating, running,
}: { onDiscover: () => void; onValidate: () => void; onRun: () => void; discovering: boolean; validating: boolean; running: boolean }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button onClick={onDiscover} disabled={discovering} className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
        <MagnifyingGlassIcon className={`w-3.5 h-3.5 ${discovering ? "animate-spin" : ""}`} /> Keşfet
      </button>
      <button onClick={onValidate} disabled={validating} className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
        <ShieldCheckIcon className={`w-3.5 h-3.5 ${validating ? "animate-spin" : ""}`} /> Doğrula
      </button>
      <button onClick={onRun} disabled={running} className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">
        <PlayIcon className={`w-3.5 h-3.5 ${running ? "animate-spin" : ""}`} /> Gerçekten Çalıştır
      </button>
    </div>
  );
}

function csv(list: string[]) { return list.join(", "); }
function parseCsv(s: string) { return s.split(",").map((x) => x.trim()).filter(Boolean); }

// ── FileX ────────────────────────────────────────────────────────────────────
function FileXSection() {
  const [app, setApp] = useState("");
  const [hosts, setHosts] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [st, setSt] = useState<RunState>({ status: "idle" });
  const { addJob } = useJobTracker();

  const discover = async () => {
    setDiscovering(true);
    setSt({ status: "idle" });
    try {
      const apps = await filexApi.searchApps("");
      if (!apps.ok || !apps.apps.length) { setSt({ status: "error", message: "Hiç uygulama bulunamadı." }); return; }
      const foundApp = apps.apps[0];
      const h = await filexApi.getHosts(foundApp);
      if (!h.ok || !h.hosts.length) { setSt({ status: "error", message: `"${foundApp}" için sunucu bulunamadı.` }); return; }
      setApp(foundApp);
      setHosts(csv(h.hosts.slice(0, 1).map((x) => x.host)));
    } catch (e) {
      setSt({ status: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setDiscovering(false);
    }
  };

  const validate = async () => {
    setSt({ status: "checking" });
    try {
      const h = await filexApi.getHosts(app);
      const valid = new Set((h.hosts || []).map((x) => x.host.toUpperCase()));
      const missing = parseCsv(hosts).filter((x) => !valid.has(x.toUpperCase()));
      if (!app.trim()) setSt({ status: "invalid", message: "Uygulama adı boş." });
      else if (parseCsv(hosts).length === 0) setSt({ status: "invalid", message: "En az bir sunucu gerekli." });
      else if (missing.length) setSt({ status: "invalid", message: `Bu uygulamaya ait değil: ${missing.join(", ")}` });
      else setSt({ status: "ok" });
    } catch (e) {
      setSt({ status: "invalid", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const run = async () => {
    const hostList = parseCsv(hosts);
    const ok = window.confirm(`FileX dosya listeleme GERÇEKTEN tetiklenecek.\n\nUygulama: ${app}\nSunucular: ${csv(hostList)}\n\nDevam edilsin mi?`);
    if (!ok) return;
    setSt({ status: "running" });
    try {
      const r = await filexApi.run(app, hostList);
      if (r.ok && r.jobId) {
        setSt({ status: "ran", message: `Job #${r.jobId}` });
        addJob({ title: `FileX test: ${app}`, fetchStatus: async () => { const s = await filexApi.jobStatus(r.awxServerId, r.jobId as number); return { status: s.status, output: s.result ? JSON.stringify(s.result, null, 2) : (s.message || "") }; } });
        toast.success(`Job #${r.jobId} tetiklendi.`);
      } else {
        setSt({ status: "error", message: r.message || "Tetiklenemedi." });
      }
    } catch (e) {
      setSt({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <SectionCard icon={FolderIcon} title="FileX — Dosya Listeleme" note="Salt-okunur (ls -la + sha512sum). Tek bacak.">
      <div className="space-y-1.5">
        <Field label="application" value={app} onChange={setApp} placeholder="(Keşfet'e basın)" />
        <Field label="hosts" value={hosts} onChange={setHosts} placeholder="(Keşfet'e basın)" />
      </div>
      <ActionRow onDiscover={discover} onValidate={validate} onRun={run} discovering={discovering} validating={st.status === "checking"} running={st.status === "running"} />
      <StatusBadge st={st} />
    </SectionCard>
  );
}

// ── Telnet ───────────────────────────────────────────────────────────────────
function TelnetLegacySection() {
  const [app, setApp] = useState("");
  const [hosts, setHosts] = useState("");
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [st, setSt] = useState<RunState>({ status: "idle" });
  const { addJob } = useJobTracker();

  const discover = async () => {
    setDiscovering(true);
    setSt({ status: "idle" });
    try {
      const apps = await telnetApi.searchApps("");
      if (!apps.ok || !apps.apps.length) { setSt({ status: "error", message: "Hiç uygulama bulunamadı." }); return; }
      const foundApp = apps.apps[0];
      const h = await telnetApi.getHosts(foundApp);
      if (!h.ok || !h.hosts.length) { setSt({ status: "error", message: `"${foundApp}" için sunucu bulunamadı.` }); return; }
      setApp(foundApp);
      setHosts(csv(h.hosts.slice(0, 1).map((x) => x.host)));
    } catch (e) {
      setSt({ status: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setDiscovering(false);
    }
  };

  const validate = async () => {
    setSt({ status: "checking" });
    try {
      if (!ip.trim() || !port.trim()) { setSt({ status: "invalid", message: "ip/port zorunlu — bu alanlar keşfedilemez, gerçek bir hedef siz yazmalısınız." }); return; }
      const h = await telnetApi.getHosts(app);
      const valid = new Set((h.hosts || []).map((x) => x.host.toUpperCase()));
      const missing = parseCsv(hosts).filter((x) => !valid.has(x.toUpperCase()));
      if (missing.length) setSt({ status: "invalid", message: `Bu uygulamaya ait değil: ${missing.join(", ")}` });
      else setSt({ status: "ok" });
    } catch (e) {
      setSt({ status: "invalid", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const run = async () => {
    const hostList = parseCsv(hosts);
    const ok = window.confirm(`Telnet (Legacy) testi GERÇEKTEN tetiklenecek.\n\nUygulama: ${app}\nSunucular: ${csv(hostList)}\nHedef: ${ip}:${port}\n\nDevam edilsin mi?`);
    if (!ok) return;
    setSt({ status: "running" });
    try {
      const r = await telnetApi.run({ platform: "legacy", application: app, hosts: hostList, ip, port });
      if (r.ok && r.jobId) {
        setSt({ status: "ran", message: `Job #${r.jobId}` });
        addJob({ title: `Telnet test (Legacy): ${app}`, fetchStatus: async () => { const s = await telnetApi.jobStatus(r.awxServerId, r.jobId as number); return { status: s.status, output: s.output || "" }; } });
        toast.success(`Job #${r.jobId} tetiklendi.`);
      } else {
        setSt({ status: "error", message: r.message || "Tetiklenemedi." });
      }
    } catch (e) {
      setSt({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <SectionCard icon={ServerStackIcon} title="Telnet — Legacy" note="ip/port hedefi kasıtlı olarak keşfedilmez — gerçek bir test hedefini siz yazmalısınız.">
      <div className="space-y-1.5">
        <Field label="application" value={app} onChange={setApp} placeholder="(Keşfet'e basın)" />
        <Field label="hosts" value={hosts} onChange={setHosts} placeholder="(Keşfet'e basın)" />
        <Field label="ip" value={ip} onChange={setIp} placeholder="ör. 10.1.2.3" />
        <Field label="port" value={port} onChange={setPort} placeholder="ör. 443" />
      </div>
      <ActionRow onDiscover={discover} onValidate={validate} onRun={run} discovering={discovering} validating={st.status === "checking"} running={st.status === "running"} />
      <StatusBadge st={st} />
    </SectionCard>
  );
}

function TelnetOcpSection() {
  const [env, setEnv] = useState("");
  const [tenant, setTenant] = useState("");
  const [namespaces, setNamespaces] = useState("");
  const [cluster, setCluster] = useState("");
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [st, setSt] = useState<RunState>({ status: "idle" });
  const { addJob } = useJobTracker();

  const discover = async () => {
    setDiscovering(true);
    setSt({ status: "idle" });
    try {
      const c = await telnetApi.getClusters();
      const envs = Object.keys(c.tree || {}).sort();
      if (!envs.length) { setSt({ status: "error", message: "Hiç ortam (env) bulunamadı." }); return; }
      const foundEnv = envs[0];
      const tenants = Object.keys(c.tree[foundEnv] || {}).sort();
      if (!tenants.length) { setSt({ status: "error", message: `"${foundEnv}" için tenant bulunamadı.` }); return; }
      const foundTenant = tenants[0];
      const clusters = c.tree[foundEnv][foundTenant] || [];
      const ns = await telnetApi.getOcpNamespaces(foundEnv, foundTenant);
      if (!ns.ok || !ns.namespaces.length) { setSt({ status: "error", message: `"${foundEnv}/${foundTenant}" için namespace bulunamadı.` }); return; }
      setEnv(foundEnv);
      setTenant(foundTenant);
      setNamespaces(csv(ns.namespaces.slice(0, 1)));
      setCluster(clusters[0] || "");
    } catch (e) {
      setSt({ status: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setDiscovering(false);
    }
  };

  const validate = async () => {
    setSt({ status: "checking" });
    try {
      if (!ip.trim() || !port.trim()) { setSt({ status: "invalid", message: "ip/port zorunlu — gerçek bir hedef siz yazmalısınız." }); return; }
      const ns = await telnetApi.getOcpNamespaces(env, tenant);
      const valid = new Set((ns.namespaces || []).map((x) => x.toUpperCase()));
      const missing = parseCsv(namespaces).filter((x) => !valid.has(x.toUpperCase()));
      if (missing.length) setSt({ status: "invalid", message: `Bu env/tenant'ta bulunamadı: ${missing.join(", ")}` });
      else setSt({ status: "ok" });
    } catch (e) {
      setSt({ status: "invalid", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const run = async () => {
    const nsList = parseCsv(namespaces);
    const ok = window.confirm(`Telnet (OpenShift) testi GERÇEKTEN tetiklenecek.\n\nEnv/Tenant: ${env}/${tenant}\nNamespace(ler): ${csv(nsList)}\nCluster: ${cluster || "(tümü)"}\nHedef: ${ip}:${port}\n\nDevam edilsin mi?`);
    if (!ok) return;
    setSt({ status: "running" });
    try {
      const r = await telnetApi.run({ platform: "openshift", env, tenant, namespaces: nsList, cluster: cluster || undefined, ip, port });
      if (r.ok && r.jobId) {
        setSt({ status: "ran", message: `Job #${r.jobId}` });
        addJob({ title: `Telnet test (OCP): ${env}/${tenant}`, fetchStatus: async () => { const s = await telnetApi.jobStatus(r.awxServerId, r.jobId as number); return { status: s.status, output: s.output || "" }; } });
        toast.success(`Job #${r.jobId} tetiklendi.`);
      } else {
        setSt({ status: "error", message: r.message || "Tetiklenemedi." });
      }
    } catch (e) {
      setSt({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <SectionCard icon={ServerStackIcon} title="Telnet — OpenShift" note="ip/port hedefi kasıtlı olarak keşfedilmez — gerçek bir test hedefini siz yazmalısınız.">
      <div className="space-y-1.5">
        <Field label="env" value={env} onChange={setEnv} placeholder="(Keşfet'e basın)" />
        <Field label="tenant" value={tenant} onChange={setTenant} placeholder="(Keşfet'e basın)" />
        <Field label="namespaces" value={namespaces} onChange={setNamespaces} placeholder="(Keşfet'e basın)" />
        <Field label="cluster" value={cluster} onChange={setCluster} placeholder="(boş = tümü)" />
        <Field label="ip" value={ip} onChange={setIp} placeholder="ör. 10.1.2.3" />
        <Field label="port" value={port} onChange={setPort} placeholder="ör. 443" />
      </div>
      <ActionRow onDiscover={discover} onValidate={validate} onRun={run} discovering={discovering} validating={st.status === "checking"} running={st.status === "running"} />
      <StatusBadge st={st} />
    </SectionCard>
  );
}

// ── OpsX ─────────────────────────────────────────────────────────────────────
function OpsxLegacySection() {
  const [app, setApp] = useState("");
  const [hosts, setHosts] = useState("");
  const [operation, setOperation] = useState<OpsxOperation>("restart");
  const [operations, setOperations] = useState<OpsxOperation[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [st, setSt] = useState<RunState>({ status: "idle" });
  const { addJob } = useJobTracker();

  const discover = async () => {
    setDiscovering(true);
    setSt({ status: "idle" });
    try {
      const ops = await opsxApi.getOperations();
      if (ops.ok && ops.operations.length) setOperations(ops.operations.map((o) => o.key));
      const apps = await opsxApi.searchApps("");
      if (!apps.ok || !apps.apps.length) { setSt({ status: "error", message: "Hiç uygulama bulunamadı." }); return; }
      const foundApp = apps.apps[0];
      const h = await opsxApi.getHosts(foundApp);
      if (!h.ok || !h.hosts.length) { setSt({ status: "error", message: `"${foundApp}" için sunucu bulunamadı.` }); return; }
      setApp(foundApp);
      setHosts(csv(h.hosts.slice(0, 1).map((x) => x.host)));
    } catch (e) {
      setSt({ status: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setDiscovering(false);
    }
  };

  const validate = async () => {
    setSt({ status: "checking" });
    try {
      const h = await opsxApi.getHosts(app);
      const valid = new Set((h.hosts || []).map((x) => x.host.toUpperCase()));
      const missing = parseCsv(hosts).filter((x) => !valid.has(x.toUpperCase()));
      if (missing.length) setSt({ status: "invalid", message: `Bu uygulamaya ait değil: ${missing.join(", ")}` });
      else setSt({ status: "ok" });
    } catch (e) {
      setSt({ status: "invalid", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const run = async () => {
    const hostList = parseCsv(hosts);
    const ok = window.confirm(`OpsX (Legacy) "${operation}" işlemi GERÇEKTEN tetiklenecek.\n\nUygulama: ${app}\nSunucular: ${csv(hostList)}\n\nBu geri alınamaz olabilir. Devam edilsin mi?`);
    if (!ok) return;
    setSt({ status: "running" });
    try {
      const r = await opsxApi.run({ platform: "legacy", application: app, operation, hosts: hostList });
      if (r.ok && r.jobId) {
        setSt({ status: "ran", message: `Job #${r.jobId}` });
        addJob({ title: `OpsX test (Legacy ${operation}): ${app}`, fetchStatus: async () => { const s = await opsxApi.jobStatus(r.awxServerId, r.jobId as number); return { status: s.status, output: s.output || "" }; } });
        toast.success(`Job #${r.jobId} tetiklendi.`);
      } else {
        setSt({ status: "error", message: r.message || "Tetiklenemedi." });
      }
    } catch (e) {
      setSt({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <SectionCard icon={CommandLineIcon} title="OpsX — Legacy (restart/stop/start/dump)" note="Seçilen işlem GERÇEK bir operasyon uygular — restart/stop/start uygulamayı fiilen etkiler.">
      <div className="space-y-1.5">
        <Field label="application" value={app} onChange={setApp} placeholder="(Keşfet'e basın)" />
        <Field label="hosts" value={hosts} onChange={setHosts} placeholder="(Keşfet'e basın)" />
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-mono text-gray-500 w-28 flex-shrink-0">operation</label>
          <select value={operation} onChange={(e) => setOperation(e.target.value as OpsxOperation)} className="flex-1 min-w-0 text-xs font-mono border border-gray-200 rounded-lg px-2 py-1">
            {(operations.length ? operations : ["restart", "stop", "start", "threaddump", "heapdump"]).map((op) => (
              <option key={op} value={op}>{op}</option>
            ))}
          </select>
        </div>
      </div>
      <ActionRow onDiscover={discover} onValidate={validate} onRun={run} discovering={discovering} validating={st.status === "checking"} running={st.status === "running"} />
      <StatusBadge st={st} />
    </SectionCard>
  );
}

function OpsxOcpSection() {
  const [env, setEnv] = useState("");
  const [tenant, setTenant] = useState("");
  const [namespace, setNamespace] = useState("");
  const [application, setApplication] = useState("");
  const [cluster, setCluster] = useState("");
  const [ocOperation, setOcOperation] = useState<OpsxOcpOperation>("restart");
  const [ocOperations, setOcOperations] = useState<OpsxOcpOperation[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [st, setSt] = useState<RunState>({ status: "idle" });
  const { addJob } = useJobTracker();

  const discover = async () => {
    setDiscovering(true);
    setSt({ status: "idle" });
    try {
      const ops = await opsxApi.getOcpOperations();
      if (ops.ok) setOcOperations(ops.operations.filter((o) => o.enabled).map((o) => o.key));
      const c = await opsxApi.getClusters();
      const envs = Object.keys(c.tree || {}).sort();
      if (!envs.length) { setSt({ status: "error", message: "Hiç ortam (env) bulunamadı." }); return; }
      const foundEnv = envs[0];
      const tenants = Object.keys(c.tree[foundEnv] || {}).sort();
      if (!tenants.length) { setSt({ status: "error", message: `"${foundEnv}" için tenant bulunamadı.` }); return; }
      const foundTenant = tenants[0];
      const clusters = c.tree[foundEnv][foundTenant] || [];
      const ns = await opsxApi.getOcpNamespaces(foundEnv, foundTenant);
      if (!ns.ok || !ns.namespaces.length) { setSt({ status: "error", message: `"${foundEnv}/${foundTenant}" için namespace bulunamadı.` }); return; }
      const foundNs = ns.namespaces[0];
      const apps = await opsxApi.getOcpApps(foundEnv, foundTenant, foundNs);
      if (!apps.ok || !apps.apps.length) { setSt({ status: "error", message: `"${foundNs}" içinde uygulama bulunamadı.` }); return; }
      setEnv(foundEnv);
      setTenant(foundTenant);
      setNamespace(foundNs);
      setApplication(apps.apps[0]);
      // Blast radius'u minimumda tutmak icin TEK GERCEK cluster secilir (bos = "tumu" anlamina
      // gelip DAHA GENIS bir hedefe yol acardi, test senaryosu icin GUVENLI DEGIL).
      setCluster(clusters[0] || "");
    } catch (e) {
      setSt({ status: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setDiscovering(false);
    }
  };

  const validate = async () => {
    setSt({ status: "checking" });
    try {
      const apps = await opsxApi.getOcpApps(env, tenant, namespace);
      if (!apps.ok || !apps.apps.map((a) => a.toUpperCase()).includes(application.toUpperCase())) {
        setSt({ status: "invalid", message: `"${application}" bu namespace'te bulunamadı.` });
        return;
      }
      setSt({ status: "ok" });
    } catch (e) {
      setSt({ status: "invalid", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const run = async () => {
    const ok = window.confirm(`OpsX (OpenShift) "${ocOperation}" işlemi GERÇEKTEN tetiklenecek.\n\nEnv/Tenant: ${env}/${tenant}\nNamespace/Uygulama: ${namespace}/${application}\nCluster: ${cluster || "(tümü)"}\n\nBu geri alınamaz olabilir. Devam edilsin mi?`);
    if (!ok) return;
    setSt({ status: "running" });
    try {
      const r = await opsxApi.run({ platform: "openshift", env, tenant, pairs: [{ namespace, application }], ocOperation, cluster: cluster || undefined });
      if (r.ok && r.jobId) {
        setSt({ status: "ran", message: `Job #${r.jobId}` });
        addJob({ title: `OpsX test (OCP ${ocOperation}): ${namespace}/${application}`, fetchStatus: async () => { const s = await opsxApi.jobStatus(r.awxServerId, r.jobId as number); return { status: s.status, output: s.output || "" }; } });
        toast.success(`Job #${r.jobId} tetiklendi.`);
      } else {
        setSt({ status: "error", message: r.message || "Tetiklenemedi." });
      }
    } catch (e) {
      setSt({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <SectionCard icon={CommandLineIcon} title="OpsX — OpenShift (rollout restart/threaddump/heapdump/tcpdump)" note="Seçilen işlem GERÇEK bir operasyon uygular. Blast radius'u sınırlı tutmak için tek bir gerçek cluster seçilir (boş bırakılırsa tenant'taki TÜM cluster'lar hedeflenir).">
      <div className="space-y-1.5">
        <Field label="env" value={env} onChange={setEnv} placeholder="(Keşfet'e basın)" />
        <Field label="tenant" value={tenant} onChange={setTenant} placeholder="(Keşfet'e basın)" />
        <Field label="namespace" value={namespace} onChange={setNamespace} placeholder="(Keşfet'e basın)" />
        <Field label="application" value={application} onChange={setApplication} placeholder="(Keşfet'e basın)" />
        <Field label="cluster" value={cluster} onChange={setCluster} placeholder="(boş = tümü — DAHA GENİŞ hedef)" />
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-mono text-gray-500 w-28 flex-shrink-0">ocOperation</label>
          <select value={ocOperation} onChange={(e) => setOcOperation(e.target.value as OpsxOcpOperation)} className="flex-1 min-w-0 text-xs font-mono border border-gray-200 rounded-lg px-2 py-1">
            {(ocOperations.length ? ocOperations : ["restart", "threaddump", "heapdump", "tcpdump"]).map((op) => (
              <option key={op} value={op}>{op}</option>
            ))}
          </select>
        </div>
      </div>
      <ActionRow onDiscover={discover} onValidate={validate} onRun={run} discovering={discovering} validating={st.status === "checking"} running={st.status === "running"} />
      <StatusBadge st={st} />
    </SectionCard>
  );
}

export default function FlowTestsTab() {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50">
        <BoltIcon className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800">
          <div className="font-semibold">FileX, Telnet ve OpsX (restart/rollout) için akış testleri.</div>
          <div className="mt-0.5">
            "Keşfet" gerçek, o an geçerli bir örnek uygulama/host/namespace bulur (canlı arama uçlarından —
            uydurma değer YOK). "Doğrula" ekrandaki değerlerin hâlâ geçerli olup olmadığını kontrol eder,
            hiçbir job tetiklemez. "Gerçekten Çalıştır" GERÇEK bir AWX job'ı başlatır — özellikle OpsX'te
            bu geri alınamaz olabilir, her seferinde ayrıca onay ister.
          </div>
          <div className="mt-1.5 text-xs">
            Henüz kapsam dışı (ayrı bir turda eklenecek): OpsX'in JVM/Pod keşif+dump zincirleri ve LogX.
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold mb-2" style={{ color: "var(--text-muted)" }}>FileX</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <FileXSection />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold mb-2" style={{ color: "var(--text-muted)" }}>Telnet</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <TelnetLegacySection />
          <TelnetOcpSection />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold mb-2" style={{ color: "var(--text-muted)" }}>OpsX</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <OpsxLegacySection />
          <OpsxOcpSection />
        </div>
      </div>
    </div>
  );
}
