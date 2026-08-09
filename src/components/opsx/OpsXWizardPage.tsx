// src/components/opsx/OpsXWizardPage.tsx — OpsX sihirbazı: platform → (Legacy:
// uygulama → sunucular | OpenShift: ortam/cluster) → işlem seçimi → tetikleme.
//
// LogX'ten YAPISAL FARK: LogX her adımı sunucudaki logx_v2_requests.state'e yazar
// (uzun süren discovery/transfer job'ları ve sayfa yenilemesinden sonra devam
// gerektirdiği için). OpsX'te adımlar arası kalıcı bir sunucu durumu YOK — akış
// kısa ve tek bir tetiklemeyle bitiyor, dolayısıyla adım durumu client'ta tutulur.
// Güvenlik buna dayanmaz: son POST /api/opsx/run çağrısında sunucu uygulama-host
// eşleşmesini ve cluster'ı envanterden YENİDEN doğrular.
import React, { useState } from "react";
import { ArrowLeftIcon, CheckCircleIcon, ExclamationTriangleIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { opsxApi, type OpsxPlatform, type OpsxOperation, type OpsxRunResult } from "@/api/opsxApi";
import { useJobTracker } from "@/contexts/JobTrackerContext";
import AnsibleLogTerminal from "@/components/common/AnsibleLogTerminal";
import PlatformStep from "./steps/PlatformStep";
import AppSearchStep from "./steps/AppSearchStep";
import JbossVersionStep from "./steps/JbossVersionStep";
import HostSelectStep from "./steps/HostSelectStep";
import OcpTargetStep from "./steps/OcpTargetStep";
import OperationStep from "./steps/OperationStep";
// LogX ile ORTAK bileşenler: önbellek rozeti, kısıtlama davranışı ve "hepsi başarısız"
// hata kartı iki sihirbazda da aynı olsun diye kopyalanmadı.
import NamespacePickerStep from "@/components/ocp/NamespacePickerStep";
import AppNameStep from "@/components/ocp/AppNameStep";

type Step =
  | "platform"
  | "legacy_app"
  | "legacy_jboss_version"
  | "legacy_hosts"
  | "ocp_target"
  | "ocp_namespace"
  | "ocp_app"
  | "operation"
  | "ocp_operation"
  | "done";

const STEP_TITLES: Record<Step, string> = {
  platform: "",
  legacy_app: "Uygulama Seçimi",
  legacy_jboss_version: "JBoss Sürümü",
  legacy_hosts: "Sunucu Seçimi",
  ocp_target: "Openshift Hedefi",
  ocp_namespace: "Namespace Seçimi",
  ocp_app: "Uygulama Seçimi",
  operation: "İşlem Seçimi",
  ocp_operation: "İşlem Seçimi",
  done: "İşlem Başlatıldı",
};

const OpsXWizardPage: React.FC = () => {
  const [step, setStep] = useState<Step>("platform");
  const [platform, setPlatform] = useState<OpsxPlatform | null>(null);
  const [app, setApp] = useState("");
  const [jbossVersions, setJbossVersions] = useState<string[]>([]);
  const [hosts, setHosts] = useState<string[]>([]);
  const [env, setEnv] = useState("");
  const [tenant, setTenant] = useState("");
  const [clusters, setClusters] = useState<string[]>([]);
  const [namespace, setNamespace] = useState("");
  const [appName, setAppName] = useState("");
  // Uygulama listeden seçildiyse kind/replica bilgisi de taşınır: playbook
  // `oc rollout restart deployment/<ad>` ve `scale --replicas=<n>` için kullanır.
  // Kullanıcı adı ELLE yazdıysa boş kalır; playbook kind'i kendisi çözer.
  const [objectKind, setObjectKind] = useState("");
  const [appReplicas, setAppReplicas] = useState<number | null>(null);
  // Namespace listesi: paylaşımlı önbellekten okunur. Boşsa kullanıcı adı elle yazar
  // (OpsX kendi keşif job'ını AÇMAZ — keşif LogX'in işidir, burada yalnızca okunur).
  const [nsItems, setNsItems] = useState<string[] | null>(null);
  const [nsFailed, setNsFailed] = useState<string[]>([]);
  const [nsCache, setNsCache] = useState<{ fetchedAt: string | null; stale: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OpsxRunResult | null>(null);
  const [trackedJobId, setTrackedJobId] = useState<string | null>(null);
  const { addJob, jobs } = useJobTracker();
  // Bu sayfa açıkken CANLI çıktıyı kendi içinde (inline) gösterir — takipçiden aynı
  // job'ın güncel verisini okur, kendi polling'ini yapmaz. Sayfadan ayrılınca (ya da
  // "Yeni İşlem" ile sıfırlanınca) bu inline görünüm kaybolur ama job arka planda
  // takip edilmeye devam eder (alt çubuktaki sekme) — AYNI iş için iki ayrı pencere
  // birden açılmaz (bkz. JobTrackerContext.tsx).
  const trackedJob = trackedJobId ? jobs.find((j) => j.id === trackedJobId) : undefined;

  function restart() {
    setStep("platform");
    setPlatform(null);
    setApp("");
    setJbossVersions([]);
    setHosts([]);
    setEnv("");
    setTenant("");
    setClusters([]);
    setNamespace("");
    setAppName("");
    setError(null);
    setResult(null);
    setTrackedJobId(null);
  }

  function trackJob(r: OpsxRunResult) {
    if (r.jobId == null) return;
    const id = addJob({
      title: `OpsX #${r.jobId}`,
      fetchStatus: () => opsxApi.jobStatus(r.awxServerId, r.jobId as number),
    });
    setTrackedJobId(id);
  }

  // Adıma göre "← Geri" hedefi. Hedefi olmayan adımlarda buton hiç render edilmez.
  function backTargetFor(s: Step): Step | null {
    switch (s) {
      case "legacy_app":
      case "ocp_target":
        return "platform";
      case "legacy_jboss_version":
        return "legacy_app";
      case "legacy_hosts":
        return "legacy_jboss_version";
      case "operation":
        return "legacy_hosts";
      case "ocp_namespace":
        return "ocp_target";
      case "ocp_app":
        return "ocp_namespace";
      case "ocp_operation":
        return "ocp_app";
      default:
        return null;
    }
  }

  function back() {
    const target = backTargetFor(step);
    if (!target) return;
    setError(null);
    if (target === "platform") { restart(); return; }
    setStep(target);
  }

  // Legacy: uygulama + sunucular + islem. Openshift: env/tenant/cluster + namespace +
  // app_name (islem SEÇİMİ YOK — sartnamedeki Openshift gövdesinde `operation` alanı
  // bulunmuyor; gerekirse Admin > OpsX Yapılandırma'dan sabit değişken olarak eklenir).
  async function runLegacy(operation: OpsxOperation) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await opsxApi.run({ platform: "legacy", application: app, operation, hosts });
      setResult(r);
      setStep("done");
      trackJob(r);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runOpenshift(operation: OpsxOperation) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await opsxApi.run({
        platform: "openshift", env, tenant, clusters, namespace, appName, operation,
        objectKind: objectKind || undefined,
        // `start`/`scale` icin hedef replica: kesiften gelen deger, yoksa 1.
        replicas: ["start", "scale"].includes(operation) ? (appReplicas || 1) : undefined,
      });
      setResult(r);
      setStep("done");
      trackJob(r);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Namespace listesi paylaşımlı önbellekten okunur. Cluster başına ayrı istek: biri
  // erişilemezse listenin EKSİK olduğu kullanıcıya söylenir (sessiz eksiklik yok).
  async function loadNamespaces(e: string, t: string, cs: string[]) {
    const results = await Promise.all(
      cs.map((c) =>
        opsxApi.cachedNamespaces(e, t, c)
          .then((r) => ({ cluster: c, r }))
          .catch(() => ({ cluster: c, r: null }))
      )
    );
    const items: string[] = [];
    const failed: string[] = [];
    let newest: string | null = null;
    let stale = false;
    let anyCached = false;
    for (const { cluster, r } of results) {
      if (!r) { failed.push(cluster); continue; }
      if (!r.cached) continue;
      anyCached = true;
      items.push(...(r.items || []));
      if (r.stale) stale = true;
      if (r.fetchedAt && (!newest || new Date(r.fetchedAt) > new Date(newest))) newest = r.fetchedAt;
    }
    setNsItems([...new Set(items)]);
    setNsFailed(failed);
    setNsCache(anyCached ? { fetchedAt: newest, stale } : null);
  }

  const canGoBack = backTargetFor(step) !== null;

  const ocpSummary = (
    <>
      Cluster: <span className="font-mono text-[var(--text-primary)]">{clusters.join(", ")}</span>
      {" · "}
      Namespace: <span className="font-mono text-[var(--text-primary)]">{namespace}</span>
      {" · "}
      Uygulama: <span className="font-mono text-[var(--text-primary)]">{appName || "(namespace geneli)"}</span>
      {objectKind && <> {" · "}Tip: <span className="font-mono">{objectKind}</span></>}
    </>
  );

  const operationSummary = (
    <>
      Uygulama: <span className="font-mono text-[var(--text-primary)]">{app}</span>
      {" · "}
      JBoss: <span className="font-mono text-[var(--text-primary)]">{jbossVersions.map((v) => v || "Bilinmiyor").join(", ")}</span>
      {" · "}
      {hosts.length} sunucu: <span className="font-mono">{hosts.join(", ")}</span>
    </>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-start gap-3">
        {canGoBack && (
          <button
            onClick={back}
            disabled={busy}
            title="Önceki adıma dön"
            className="mt-0.5 flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
          >
            <ArrowLeftIcon className="w-3.5 h-3.5" />
            Geri
          </button>
        )}
        <div className="flex-1">
          <h1 className="page-title">OpsX - Güvenli Uygulama Operasyonları</h1>
          {STEP_TITLES[step] && <p className="mt-1 text-sm font-medium text-[var(--text-muted)]">{STEP_TITLES[step]}</p>}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div key={step} className="card p-5 animate-slide-up">
        {step === "platform" && (
          <PlatformStep
            busy={busy}
            onSelect={(p) => {
              setPlatform(p);
              setStep(p === "legacy" ? "legacy_app" : "ocp_target");
            }}
          />
        )}

        {step === "legacy_app" && (
          <AppSearchStep
            busy={busy}
            onSelect={(a) => { setApp(a); setJbossVersions([]); setHosts([]); setStep("legacy_jboss_version"); }}
          />
        )}

        {step === "legacy_jboss_version" && (
          <JbossVersionStep
            app={app}
            busy={busy}
            onSubmit={(v) => { setJbossVersions(v); setHosts([]); setStep("legacy_hosts"); }}
          />
        )}

        {step === "legacy_hosts" && (
          <HostSelectStep
            app={app}
            jbossVersions={jbossVersions}
            busy={busy}
            onSubmit={(h) => { setHosts(h); setStep("operation"); }}
          />
        )}

        {step === "ocp_target" && (
          <OcpTargetStep
            busy={busy}
            onSubmit={async (v) => {
              setEnv(v.env); setTenant(v.tenant); setClusters(v.clusters);
              setNamespace(""); setAppName(""); setObjectKind(""); setAppReplicas(null);
              setNsItems(null); setNsFailed([]); setNsCache(null);
              setStep("ocp_namespace");
              // Liste arka planda gelir; gelene kadar picker "kayıt yok" durumunu gösterir
              // ve kullanıcı adı elle yazabilir.
              await loadNamespaces(v.env, v.tenant, v.clusters).catch(() => {});
            }}
          />
        )}

        {step === "ocp_namespace" && (
          nsItems && (nsItems.length > 0 || nsFailed.length > 0) ? (
            <NamespacePickerStep
              namespaces={nsItems}
              failedClusters={nsFailed}
              cache={nsCache}
              busy={busy}
              onSelect={(ns) => { setNamespace(ns); setStep("ocp_app"); }}
            />
          ) : (
            // Önbellek boş: OpsX kendi keşif job'ını AÇMAZ (keşif LogX'in işi).
            // Kullanıcı adı elle yazar — akış durmaz.
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
                Bu cluster'lar için kayıtlı namespace listesi yok. Adını biliyorsanız yazın;
                listeyi doldurmak için LogX sihirbazından bir keşif çalıştırabilirsiniz.
              </div>
              <input
                autoFocus
                value={namespace}
                onChange={(e) => setNamespace(e.target.value)}
                placeholder="das-trading-management-qa"
                className="w-full px-3 py-2 text-sm font-mono border border-[var(--border)] rounded-xl outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition"
              />
              <button
                onClick={() => setStep("ocp_app")}
                disabled={!namespace.trim() || busy}
                className="btn-primary w-full"
              >
                Devam
              </button>
            </div>
          )
        )}

        {step === "ocp_app" && (
          <AppNameStep
            env={env}
            tenant={tenant}
            clusters={clusters}
            namespace={namespace}
            busy={busy}
            fetchApps={opsxApi.cachedApps}
            submitLabel="Devam"
            description={
              <>
                <span className="font-mono text-[var(--text-primary)]">{namespace}</span> içindeki
                uygulamayı seçin — işlem bu iş yüküne uygulanacaktır.
              </>
            }
            onSubmitDetailed={(a) => {
              // Kind listesi birden fazla olabilir (Deployment + Service + Route). İşlem
              // yalnız IS YUKUNE uygulanir; ilk is yuku tipini secip digerlerini atariz.
              const workload = a.kinds.find((k) =>
                ["Deployment", "DeploymentConfig", "StatefulSet", "Rollout"].includes(k));
              setObjectKind(workload || "");
              setAppReplicas(a.replicas);
            }}
            onSubmit={(name) => { setAppName(name); setStep("ocp_operation"); }}
          />
        )}
        {step === "ocp_app" && (
          // `podlist` ve `events` NAMESPACE kapsamlidir, uygulama adi gerektirmez.
          // Bu cikis olmasaydi kullanici yalnizca pod listesi gormek icin de bir
          // uygulama secmek zorunda kalirdi.
          <button
            onClick={() => { setAppName(""); setObjectKind(""); setAppReplicas(null); setStep("ocp_operation"); }}
            disabled={busy}
            className="mt-2 w-full text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
          >
            Uygulama seçmeden devam et — yalnızca namespace geneli işlemler (pod listesi, olaylar)
          </button>
        )}

        {step === "ocp_operation" && (
          <OperationStep
            platform="openshift"
            summary={ocpSummary}
            application={appName}
            hosts={[]}
            busy={busy}
            onSelect={runOpenshift}
          />
        )}

        {step === "operation" && (
          <OperationStep summary={operationSummary} application={app} hosts={hosts} busy={busy} onSelect={runLegacy} />
        )}

        {step === "done" && result && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <CheckCircleIcon className="w-10 h-10 text-green-600" />
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">İşlem başlatıldı.</p>
              {result.jobId != null && (
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  AWX Job: <span className="font-mono">#{result.jobId}</span>
                </p>
              )}
            </div>

            {trackedJob && (
              <div className="w-full text-left">
                <AnsibleLogTerminal
                  output={trackedJob.output}
                  status={trackedJob.status || result.status || "pending"}
                  title={trackedJob.title}
                />
                {trackedJob.pollErr && <p className="mt-1.5 text-xs text-amber-600">{trackedJob.pollErr}</p>}
              </div>
            )}

            {/* Job'a gerçekten NE gönderildiğini göster — kullanıcı beklediği parametrelerin
                gittiğini doğrulayabilsin (özellikle virgülle ayrılmış sunucu listesi). */}
            <div className="w-full text-left bg-[var(--bg-elevated)] rounded-xl p-3">
              <div className="text-xs mb-1 text-[var(--text-muted)]">AWX'e gönderilen gövde:</div>
              <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                {JSON.stringify(result.sentBody, null, 2)}
              </pre>
            </div>
            <button onClick={restart} className="btn-primary">
              <ArrowPathIcon className="w-4 h-4" />
              Yeni İşlem
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default OpsXWizardPage;
