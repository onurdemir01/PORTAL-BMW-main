// src/components/DenetimPage.tsx — "Denetim" sayfasi (2026-08-21, kullanici talebi).
// Iki ayri denetim konusu, ust seviyede iki sekme:
//   1) Nginx SPA Audit  -> Teams bildirimindeki ozetin AYRINTILI hali; servis bazinda
//      alt sekmeler, ortam (DEV/TEST/QA/PROD) karsilastirmali uygulama matrisi,
//      uygulamanin OpenShift envanterinde olup olmadigi.
//   2) OpenShift Kapsam -> bir uygulamanin bir platformun HANGI ortamlarinda EKSIK
//      oldugu (ornek: prod'da var, non-prod'da yok).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldCheckIcon, ArrowPathIcon, MagnifyingGlassIcon, ServerStackIcon,
  Squares2X2Icon, QuestionMarkCircleIcon, ArrowDownTrayIcon,
  DocumentDuplicateIcon, ChevronRightIcon, ChartBarSquareIcon, RectangleGroupIcon,
} from "@heroicons/react/24/outline";
import {
  denetimApi, type NginxSpaResult, type OcpCoverageResult, type NginxSpaEnvCell,
  type InitScriptsResult, type InitScriptStat, type SpaCoverageResult, type SpaCoverageRow,
} from "@/api/denetimApi";
import { Select } from "@/components/ui/Form";
import HelpModal, { type HelpSection } from "@/components/common/HelpModal";
import EnvanterMetrics from "@/components/denetim/EnvanterMetrics";
import AppEnvs from "@/components/denetim/AppEnvs";
import { toast } from "@/hooks/useToast";

const HELP: HelpSection[] = [
  {
    icon: ServerStackIcon,
    title: "Nginx SPA Audit",
    body: "nginx_config_audit job'ının günlük taramasını gösterir. Her satır bir uygulama; sütunlar ortamlar. Hücre rengi o ortamdaki durumu anlatır. 'Kırık include' = vhost'un çağırdığı conf dosyası yok, nginx -t düşer. 'Paket Nginx'te yok' = konfigürasyon yerinde ama uygulamanın dosyaları /usr/nginx/applications altında bulunamadı, yani o adres 404 döner — ya hiç dağıtılmamış ya da conf adının işaret ettiğinden başka bir namespace dizinine dağıtılmış. 'Envanterde yok' = OpenShift envanterinde karşılığı bulunamadı, uygulama kapatılmış olabilir. Hücre birden çok sunucunun en kötü durumunu gösterir; üzerine gelince hangi sunucular olduğunu görebilirsiniz.",
  },
  {
    icon: ChartBarSquareIcon,
    title: "Envanter Metrikleri",
    body: "Inventory, MWAppsInventory ve WASAppsInventory tablolarının dağılımları. Üstte özet sayaçlar; Sunucular kaynağında ayrıca ürün kapsamı (hangi üründen kaç sunucuda var, kaç ayrı sürümle). Dağılımlar bölümünde boyut seçerek (domain, subnet, OS, sürüm…) oransal kırılımı görürsünüz. En altta çapraz dağılım: satır ve sütunu kendiniz seçip örneğin JBoss sürümlerinin domain'lere göre yayılımını çıkarırsınız; hücre koyulaştıkça sayı büyür. Uygulama tablolarında sayımı 'uygulama' yerine 'sunucu' yapabilirsiniz — aynı sunucuda birden çok uygulama olabildiği için ikisi farklı sorulara cevap verir.",
  },
  {
    icon: RectangleGroupIcon,
    title: "Uygulama Ortamları",
    body: "MWAppsInventory / WASAppsInventory üzerinden, bir uygulamanın hangi ortamlara dağıtıldığını gösterir. Ortam uygulama adının son ekinden türer: -D geliştirme, -T test, -Q QA, eksiz ad production; satırlar son ek atılmış taban ada göre gruplanır. 'Ad kuralı dışı' sekmesinde bu kalıba uymayan adlar (küçük harfli son ek, tanınmayan tek harf, -DEV/-PROD gibi ortam sözcüğü) sebebiyle birlikte listelenir. 'Çelişki' sekmesinde ise adın söylediği ortam ile envanterdeki env sütunu uyuşmayanlar çıkar — env sütunu sunucu adından türetildiği için bu, uygulamanın başka bir ortamın sunucusunda çalıştığına işaret eder. Sunucu adı geliştirme ile testi ayırt edemediğinden -D uygulamaları bu listeye alınmaz.",
  },
  {
    icon: DocumentDuplicateIcon,
    title: "Init Script Sapması",
    body: "check_initialize job'ının topladığı sha512 değerlerini karşılaştırır: bir script sunucular arasında kaç ayrı sürümle duruyor, hangi sunucular çoğunluktan ayrılmış, hangilerinde dosya hiç yok. Referans olarak en kalabalık hash alınır — tabloda kanonik sürümü işaretleyen bir alan yok, initialize.yaml da şablonu tüm sunuculara aynı dağıttığı için en kalabalık sürüm pratikte şablonun kendisidir. startCustom.sh bunun bilinen istisnasıdır: sunucuya özel olması tasarım gereğidir (initialize.yaml yeniden kurulumda onu yedekten geri kopyalar), o yüzden sapma sayılmaz, ayrıca listelenir.",
  },
  {
    icon: Squares2X2Icon,
    title: "OpenShift Kapsam",
    body: "Bir uygulamanın bir platformun hangi ortamlarında var, hangilerinde eksik olduğunu gösterir. Ortam bilgisi cluster'dan DEĞİL, namespace son ekinden (-dev/-test/-qa/-prod) gelir — çünkü ark_dev ile ark_test aynı cluster'ları paylaşır, cluster tek başına ortam bilgisi taşımaz.",
  },
];

const STATUS_META: Record<string, { label: string; cls: string }> = {
  OK:               { label: "Sorunsuz",              cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  DUP_SUFFIX:       { label: "Yinelenen ek",          cls: "bg-sky-50 text-sky-700 border-sky-200" },
  NOT_IN_INVENTORY: { label: "Envanterde yok",        cls: "bg-amber-50 text-amber-700 border-amber-200" },
  NAME_MISMATCH:    { label: "Ad/içerik uyuşmuyor",   cls: "bg-orange-50 text-orange-700 border-orange-200" },
  // "Dagitilmamis" NEREDE olmadigini soylemiyordu. Ayni durum Teams kartinda
  // "Deploy Yok" olarak geciyordu - iki ad tek ada indirildi.
  NOT_DEPLOYED:     { label: "Paket Nginx'te yok",     cls: "bg-red-50 text-red-700 border-red-200" },
  BROKEN_INCLUDE:   { label: "Kırık include",         cls: "bg-red-100 text-red-800 border-red-300" },
};

function csvDownload(name: string, header: string[], rows: (string | number)[][]) {
  const body = [header, ...rows]
    .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DenetimPage() {
  const [tab, setTab] = useState<"nginx" | "ocp" | "init" | "envanter" | "appenvs">("nginx");
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="w-6 h-6 text-[var(--accent)]" />
            <h1 className="text-xl font-bold">Denetim</h1>
          </div>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            Nginx SPA tanımlarının, OpenShift ortam kapsamının, init script'lerinin ve
            envanter dağılımlarının denetimi.
          </p>
        </div>
        <button
          onClick={() => setShowHelp(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          <QuestionMarkCircleIcon className="w-4 h-4" /> Nasıl kullanılır?
        </button>
      </div>

      <div className="flex gap-1 rounded-xl p-1 bg-gray-100 w-fit">
        {([
          { id: "nginx", label: "Nginx SPA Audit", icon: ServerStackIcon },
          { id: "ocp", label: "OpenShift Kapsam", icon: Squares2X2Icon },
          { id: "init", label: "Init Script Sapması", icon: DocumentDuplicateIcon },
          { id: "envanter", label: "Envanter Metrikleri", icon: ChartBarSquareIcon },
          { id: "appenvs", label: "Uygulama Ortamları", icon: RectangleGroupIcon },
        ] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              tab === t.id ? "bg-white shadow-sm text-black" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "nginx" && <NginxSpaAudit />}
      {tab === "ocp" && <OcpCoverage />}
      {tab === "init" && <InitScriptsAudit />}
      {tab === "envanter" && <EnvanterMetrics />}
      {tab === "appenvs" && <AppEnvs />}

      <HelpModal open={showHelp} onClose={() => setShowHelp(false)} title="Denetim — Nasıl Kullanılır?" sections={HELP} />
    </div>
  );
}

// ── SPA KAPSAMI ───────────────────────────────────────────────────────────────────────
// Iki soru ayri ayri cevaplanir:
//   1) nginx'e CIKMASI GEREKEN (route tipi passthrough = internet) SPA'larin kaci cikmis?
//   2) nginx'e CIKMAMASI GEREKEN (route tipi reencrypt = intranet) SPA'lardan kaci
//      yanlislikla cikmis? -> bu bir GUVENLIK/KONFIGURASYON BULGUSUDUR.
// Kapsam yuzdesi YALNIZCA internet kumesi uzerinden hesaplanir; intranet uygulamalarini
// paydaya katmak, cikmasi zaten yasak olanlari "eksik" saymak olurdu.
// Grafik CSS ile cizilir - projede grafik kutuphanesi yok.
function SpaCoverage() {
  const [platform, setPlatform] = useState("ark");
  const [data, setData] = useState<SpaCoverageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    denetimApi.spaCoverage(platform)
      .then((r) => {
        if (!alive) return;
        if (r.ok) { setData(r); setErr(""); } else setErr(r.message || "Kapsam verisi alınamadı.");
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [platform]);

  if (err) return <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>;
  if (!data && loading) return <div className="py-6 text-center text-sm text-gray-400">Kapsam yükleniyor…</div>;
  if (!data) return null;

  const maxTotal = Math.max(1, ...data.rows.map((r) => r.internetTotal));
  const sum = (f: (r: SpaCoverageRow) => number) =>
    data.rows.reduce((a, r) => a + (f(r) || 0), 0);
  const unmeasured = data.rows.filter((r) => !r.measured);
  const anomaly = sum((r) => (r.measured ? r.intranetInNginx : 0));

  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-3.5 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">
            OpenShift SPA’ları ↔ nginx tanımları
          </h3>
          <p className="text-[11px] text-gray-400 mt-0.5 max-w-3xl">
            SPA ayrımı ad kalıbından yapılır (adında{" "}
            <code className="px-1 rounded bg-gray-100">-app-v</code> ya da{" "}
            <code className="px-1 rounded bg-gray-100">-app-emb-v</code> geçenler). Ağ ayrımı{" "}
            <b>route tipinden</b> gelir: <code className="px-1 rounded bg-gray-100">passthrough</code>{" "}
            → internet, nginx’e çıkabilir; <code className="px-1 rounded bg-gray-100">reencrypt</code>{" "}
            → intranet, nginx’e çıkamaz. Kapsam yüzdesi <b>yalnızca internet</b> uygulamaları
            üzerinden hesaplanır. Ortam bilgisi namespace son ekinden (-dev/-test/-qa/-prod) gelir.
          </p>
        </div>
        <Select sizeVariant="sm" value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {data.platforms.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
      </div>

      {data.routeTableMissing && (
        <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          Route envanteri okunamadı — internet/intranet ayrımı yapılamıyor, tüm uygulamalar
          “route bilgisi yok” sayıldı. <code className="px-1 rounded bg-white/70 border border-red-200">route_inventory</code>{" "}
          job’ı çalıştıktan sonra burası dolar.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat n={sum((r) => r.internetTotal)} l="internet SPA (çıkmalı)" />
        <Stat n={sum((r) => (r.measured ? r.internetInNginx : 0))} l="nginx'e tanımlı" tone="ok" />
        <Stat n={sum((r) => (r.measured ? r.internetMissingCount : 0))} l="eksik tanım" tone="warn" />
        <Stat n={anomaly} l="intranet olduğu hâlde nginx'te" tone={anomaly ? "warn" : undefined} />
      </div>

      {anomaly > 0 && (
        <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <b>{anomaly} intranet uygulaması nginx’e tanımlı.</b> Route tipi{" "}
          <code className="px-1 rounded bg-white/70 border border-red-200">reencrypt</code>{" "}
          olan uygulamalar nginx’e çıkmamalıydı. Ortam satırını açıp listeyi görebilirsiniz.
        </p>
      )}

      <div className="space-y-2">
        {data.rows.map((r) => (
          <div key={r.env} className="rounded-lg border border-gray-100">
            <button
              onClick={() => setOpen(open === r.env ? null : r.env)}
              className="w-full px-3 py-2 hover:bg-gray-50/70 text-left"
            >
              <div className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-xs font-semibold text-gray-700">{r.env}</span>
                <span className="flex-1 h-5 rounded bg-gray-100 overflow-hidden flex">
                  {r.measured ? (
                    <>
                      <span
                        className="h-full bg-emerald-500/70"
                        style={{ width: `${(r.internetInNginx / maxTotal) * 100}%` }}
                        title={`internet, nginx'e tanımlı: ${r.internetInNginx}`}
                      />
                      <span
                        className="h-full bg-amber-400/70"
                        style={{ width: `${(r.internetMissingCount / maxTotal) * 100}%` }}
                        title={`internet, tanım eksik: ${r.internetMissingCount}`}
                      />
                    </>
                  ) : (
                    // Olculemeyen ortam DOLU bar ile gosterilmez: taranmis da hicbiri
                    // tanimli degilmis gibi okunurdu. Tarali gri = "veri yok".
                    <span
                      className="h-full w-full"
                      title="nginx tarafında bu ortama ait kayıt yok — ölçülemedi"
                      style={{
                        backgroundImage:
                          "repeating-linear-gradient(45deg, rgb(0 0 0 / 0.07) 0 6px, transparent 6px 12px)",
                      }}
                    />
                  )}
                </span>
                <span className="w-28 shrink-0 text-right text-xs tabular-nums text-gray-600">
                  {r.measured
                    ? `${r.internetInNginx.toLocaleString("tr-TR")} / ${r.internetTotal.toLocaleString("tr-TR")}`
                    : `? / ${r.internetTotal.toLocaleString("tr-TR")}`}
                </span>
                <span className={`w-24 shrink-0 text-right text-xs tabular-nums font-semibold ${
                  !r.measured ? "text-gray-400 font-normal"
                    : r.coverage === null ? "text-gray-400"
                    : r.coverage >= 90 ? "text-emerald-600"
                    : r.coverage >= 60 ? "text-amber-600" : "text-red-600"
                }`}>
                  {!r.measured ? "ölçülemedi" : r.coverage === null ? "—" : `%${r.coverage.toFixed(1)}`}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1.5 pl-14">
                <Chip tone="info" label={`intranet: ${r.intranetTotal}`} />
                {r.intranetInNginx > 0 && <Chip tone="bad" label={`intranet ama nginx'te: ${r.intranetInNginx}`} />}
                {r.otherTotal > 0 && <Chip tone="muted" label={`diğer route tipi: ${r.otherTotal}`} />}
                {r.unknownTotal > 0 && <Chip tone="muted" label={`route bilgisi yok: ${r.unknownTotal}`} />}
                {r.onlyNginxCount > 0 && <Chip tone="muted" label={`yalnızca nginx'te: ${r.onlyNginxCount}`} />}
              </div>
            </button>

            {open === r.env && !r.measured && (
              <div className="px-3 pb-3 pt-1 border-t border-gray-50 text-[11px] text-gray-600 leading-relaxed">
                Bu ortam için nginx tarafında hiç kayıt yok, dolayısıyla neyin tanımlı olduğu{" "}
                <b>bilinmiyor</b> — “hiçbiri tanımlı değil” demek değildir. Denetim yalnızca{" "}
                <code className="px-1 rounded bg-gray-100">location …&#123; include application-confs/…&#125;</code>{" "}
                kalıbını kaydeder; <code className="px-1 rounded bg-gray-100">proxy_pass</code> ile
                kurulmuş sunucularda böyle bir satır bulunmaz.
              </div>
            )}
            {open === r.env && r.measured && (
              <div className="px-3 pb-3 pt-1 border-t border-gray-50 grid gap-3 md:grid-cols-3">
                <AppList
                  title={`internet, tanım eksik (${r.internetMissingCount})`}
                  tone="warn"
                  apps={r.internetMissing}
                  empty="Hepsi tanımlı."
                />
                <AppList
                  title={`intranet olduğu hâlde nginx'te (${r.intranetInNginx})`}
                  tone="bad"
                  apps={r.intranetInNginxList}
                  empty="Böyle bir kayıt yok."
                />
                <AppList
                  title={`yalnızca nginx'te (${r.onlyNginxCount})`}
                  tone="info"
                  apps={r.onlyNginx}
                  empty="Fazlalık tanım yok."
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
        <span className="flex items-center gap-1"><i className="w-3 h-3 rounded-sm bg-emerald-500/70 inline-block" /> internet, tanımlı</span>
        <span className="flex items-center gap-1"><i className="w-3 h-3 rounded-sm bg-amber-400/70 inline-block" /> internet, eksik</span>
        <button
          onClick={() => csvDownload("spa_kapsam_" + platform,
            ["ortam", "internet_spa", "nginx_tanimli", "eksik", "intranet_spa",
             "intranet_ama_nginxte", "diger_route", "route_bilgisi_yok", "yalnizca_nginx", "kapsam_yuzde"],
            data.rows.map((r) => [r.env, r.internetTotal, r.internetInNginx, r.internetMissingCount,
              r.intranetTotal, r.intranetInNginx, r.otherTotal, r.unknownTotal, r.onlyNginxCount,
              r.coverage === null ? "" : r.coverage]))}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1 border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
        </button>
      </div>

      {/* Route eslesme kalitesi: route_name ile application adinin ayni oldugu GARANTI
          degil, bu yuzden nasil eslestigi gizlenmez. */}
      <p className="text-[11px] text-gray-400">
        Route eşleşmesi — adresten: {data.routeMatch.address.toLocaleString("tr-TR")}, route
        adından: {data.routeMatch.name.toLocaleString("tr-TR")}, namespace üzerinden:{" "}
        {data.routeMatch.ns.toLocaleString("tr-TR")}, çelişkili:{" "}
        {data.routeMatch.conflict.toLocaleString("tr-TR")}, bulunamadı:{" "}
        {data.routeMatch.none.toLocaleString("tr-TR")}. Uygulama adı öncelikle route
        adresinden çıkarılır{" "}
        (<code className="px-1 rounded bg-gray-100">&lt;Uygulama&gt;-&lt;Namespace&gt;.apps[-t].fw.garanti.com.tr</code>);
        namespace zaten bilindiği için son ek tam olarak kesilir, belirsizlik doğmaz. Adres bu
        kalıba uymazsa route adı denenir; o da tutmazsa namespace’teki route’lar hepsi aynı
        tipteyse o tip kullanılır. Hiçbiri olmazsa sınıflandırılmaz.
      </p>

      {unmeasured.length > 0 && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <b>{unmeasured.map((r) => r.env).join(", ")}</b> ortamı için nginx tarafında hiç kayıt
          yok — kapsam hesaplanmadı ve yukarıdaki toplamlara dâhil edilmedi. Denetim yalnızca{" "}
          <code className="px-1 rounded bg-white/70 border border-amber-200">location …&#123; include application-confs/…&#125;</code>{" "}
          kalıbını kaydeder; <code className="px-1 rounded bg-white/70 border border-amber-200">proxy_pass</code>{" "}
          ile kurulmuş sunucular bu kalıba uymaz.
        </p>
      )}

      {data.nginxOutsidePattern.length > 0 && (
        <p className="text-[11px] text-gray-400">
          nginx’e tanımlı {data.nginxOutsidePattern.length} uygulama SPA kalıbına uymuyor, bu
          yüzden karşılaştırmaya girmedi:{" "}
          <span className="font-mono">{data.nginxOutsidePattern.slice(0, 6).join(", ")}</span>
          {data.nginxOutsidePattern.length > 6 && " …"}
        </p>
      )}

      {data.ocpNonSpaExcluded > 0 && (
        <p className="text-[11px] text-gray-400">
          {data.ocpNonSpaExcluded.toLocaleString("tr-TR")} OpenShift uygulaması SPA kalıbına
          uymadığı için sayılmadı. {data.ocpSkippedNoEnv > 0 && (
            <>Ayrıca {data.ocpSkippedNoEnv.toLocaleString("tr-TR")} kayıt namespace son eki
            kalıba uymadığı için hiçbir ortama atanamadı.</>
          )}
        </p>
      )}
    </div>
  );
}

function Chip({ label, tone }: { label: string; tone: "info" | "bad" | "muted" }) {
  const cls = tone === "bad" ? "bg-red-50 text-red-700 border-red-200"
    : tone === "info" ? "bg-sky-50 text-sky-700 border-sky-200"
    : "bg-gray-50 text-gray-500 border-gray-200";
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border tabular-nums ${cls}`}>{label}</span>;
}

function AppList({ title, apps, tone, empty }: {
  title: string; apps: string[]; tone: "warn" | "info" | "bad"; empty: string;
}) {
  const cls = tone === "warn" ? "bg-amber-50 text-amber-800 border-amber-200"
    : tone === "bad" ? "bg-red-50 text-red-800 border-red-200"
    : "bg-sky-50 text-sky-800 border-sky-200";
  return (
    <div>
      <div className="text-[11px] font-semibold text-gray-600 mb-1">{title}</div>
      {apps.length === 0 ? (
        <div className="text-[11px] text-gray-400">{empty}</div>
      ) : (
        <div className="flex flex-wrap gap-1 max-h-44 overflow-y-auto">
          {apps.map((a) => (
            <span key={a} className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${cls}`}>{a}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 1) NGINX SPA AUDIT ────────────────────────────────────────────────────────────────
function NginxSpaAudit() {
  const [data, setData] = useState<NginxSpaResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [service, setService] = useState<string>("");
  const [scanDate, setScanDate] = useState<string>("");
  const [q, setQ] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(false);

  const load = useCallback(async (d?: string) => {
    setLoading(true);
    try {
      const r = await denetimApi.nginxSpa(d);
      if (r.ok) {
        setData(r);
        setErr("");
        setScanDate(r.scanDate || "");
        setService((prev) => (prev && r.services.includes(prev) ? prev : r.services[0] || ""));
      } else setErr(r.message || "Veri alınamadı.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const envs = data?.envs || ["DEV", "TEST", "QA", "PROD"];
  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (service && r.service !== service) return false;
      if (needle && !r.application.toLowerCase().includes(needle)) return false;
      if (onlyProblems) {
        const bad = Object.values(r.envs).some((c) => c.status && c.status !== "OK");
        if (!bad) return false;
      }
      return true;
    });
  }, [data, service, q, onlyProblems]);

  if (loading && !data) return <div className="py-10 text-center text-sm text-gray-400">Yükleniyor…</div>;
  if (err) return <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>;
  if (!data?.scanDate) {
    // Kapsam paneli nginx taramasi HIC yokken de anlamli: OpenShift tarafi zaten dolu ve
    // "hicbiri nginx'e tanimli degil" gercek bir bulgudur, bos ekran degil.
    return (
      <div className="space-y-3">
        <SpaCoverage />
        <div className="text-sm text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-4 py-6 text-center">
          Henüz bir nginx tarama kaydı yok. <code className="font-mono">nginx_config_audit</code> job'ı çalıştıktan sonra burası dolacak.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <SpaCoverage />

      {/* ENV TESHISI: bir ortam bos gorunuyorsa NEDENI burada gorulur. env degeri vhost
          DOSYA ADINDAN turer (<SERVIS>-<ORTAM>.conf), taranan SUNUCUDAN degil - bu ayrim
          "PROD nicin bos" sorusunun cevabi. */}
      {data.envStats && data.envStats.some((e) => e.rows === 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <div className="font-semibold mb-1">
            Bazı ortamlarda hiç kayıt yok:{" "}
            {data.envStats.filter((e) => e.rows === 0).map((e) => e.env).join(", ")}
          </div>
          <p className="text-[11px] leading-relaxed">
            Bu denetim <b>SPA/include mimarisi</b> için yazılmıştır: yalnızca{" "}
            <code className="px-1 rounded bg-white/70 border border-amber-200">location …&#123; include application-confs/…&#125;</code>{" "}
            kalıbındaki satırlar kaydedilir. Ortam bilgisi de taranan sunucudan değil, vhost{" "}
            <b>dosya adından</b> türer:{" "}
            <code className="px-1 rounded bg-white/70 border border-amber-200">&lt;SERVİS&gt;-&lt;ORTAM&gt;.conf</code>{" "}
            (örnek <code className="px-1 rounded bg-white/70 border border-amber-200">GLOMO-TEST.conf</code> → TEST).
            Bir ortamın boş görünmesi dört şeyden biri anlamına gelir: sunucular hâlâ{" "}
            <code className="px-1 rounded bg-white/70 border border-amber-200">proxy_pass</code>{" "}
            mimarisinde (bu kalıp hiç bulunmaz), sunuculara ulaşılamadı, vhost dosya adları
            kalıba uymuyor, ya da adlarındaki ortam eki farklı. Aşağıda hangi etiket altında
            kaç kayıt olduğu görünüyor — beklenmedik bir etiket varsa sebep odur; tüm
            etiketler sıfırsa o ortam bu denetimin kapsamı dışındadır.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {data.envStats.map((e) => (
              <span
                key={e.env}
                title={e.rows ? `vhost: ${e.vhosts.join(", ")}` : "kayıt yok"}
                className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                  e.rows ? "bg-white text-gray-700 border-gray-200" : "bg-amber-100 text-amber-800 border-amber-300"
                }`}
              >
                {e.env}: {e.rows.toLocaleString("tr-TR")}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select sizeVariant="sm" value={scanDate} onChange={(e) => { setScanDate(e.target.value); load(e.target.value); }}>
          {data.availableDates.map((d) => <option key={d} value={d}>{d}</option>)}
        </Select>
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="uygulama ara"
            className="pl-8 pr-2.5 py-1.5 text-xs border border-gray-200 rounded-lg w-56"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
          Sadece sorunlular
        </label>
        <span className="text-xs text-gray-400 tabular-nums">{rows.length} uygulama</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => csvDownload(
              `nginx_spa_audit_${service || "tum"}`,
              ["service", "application", ...envs],
              rows.map((r) => [r.service, r.application, ...envs.map((e) => r.envs[e]?.status || "-")])
            )}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
          </button>
          <button onClick={() => load(scanDate)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Yenile
          </button>
        </div>
      </div>

      {/* Servis sekmeleri — kullanici talebi: "yan yana sekme sekme <Servis>" */}
      <div className="flex gap-1 flex-wrap border-b border-gray-200">
        {data.services.map((s) => (
          <button
            key={s}
            onClick={() => setService(s)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg border-b-2 -mb-px transition-colors ${
              service === s ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-left">
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Uygulama</th>
              {envs.map((e) => <th key={e} className="px-3 py-2 text-xs font-semibold text-gray-500">{e}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.length === 0 && (
              <tr><td colSpan={envs.length + 1} className="px-3 py-8 text-center text-sm text-gray-400">Kayıt bulunamadı.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.service + r.application} className="hover:bg-gray-50/60">
                <td className="px-3 py-2 font-mono text-xs text-gray-800">{r.application}</td>
                {envs.map((e) => <EnvCell key={e} cell={r.envs[e]} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EnvCell({ cell }: { cell?: NginxSpaEnvCell }) {
  if (!cell) return <td className="px-3 py-2"><span className="text-xs text-gray-300">—</span></td>;
  const meta = STATUS_META[cell.status] || { label: cell.status, cls: "bg-gray-100 text-gray-600 border-gray-200" };
  return (
    <td className="px-3 py-2">
      <div
        className={`inline-flex flex-col gap-0.5 text-[11px] px-2 py-1 rounded-lg border ${meta.cls}`}
        title={[
          `Durum: ${meta.label}`,
          cell.status === "NOT_DEPLOYED"
            ? "Konfigürasyon yerinde ama uygulamanın dosyaları /usr/nginx/applications "
              + "altında bulunamadı — bu adres 404 döner.\nYa hiç dağıtılmamış ya da conf "
              + "adının işaret ettiğinden BAŞKA bir namespace dizinine dağıtılmış.\n"
              + "Kontrol birden çok sunucuda ayrı ayrı yapılır; aşağıdaki sunucu listesi "
              + "eksiğin görüldüğü yerlerdir."
            : null,
          cell.namespace ? `Namespace: ${cell.namespace}` : null,
          cell.deployMode ? `Dağıtım: ${cell.deployMode}` : null,
          `Context path: ${cell.locationPath}`,
          `Sunucular: ${cell.hosts.join(", ")}`,
        ].filter(Boolean).join("\n")}
      >
        <span className="font-semibold">{meta.label}</span>
        {!cell.inOcpInventory && <span className="opacity-80">OCP'de yok</span>}
      </div>
    </td>
  );
}

// ── 2) OPENSHIFT KAPSAM ───────────────────────────────────────────────────────────────
function OcpCoverage() {
  const [platform, setPlatform] = useState("ark");
  const [data, setData] = useState<OcpCoverageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(true);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    try {
      const r = await denetimApi.ocpCoverage(p);
      if (r.ok) { setData(r); setErr(""); }
      else setErr(r.message || "Veri alınamadı.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(platform); }, [platform, load]);

  const envs = data?.envs || ["dev", "test", "qa", "prod"];
  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (onlyMissing && r.missingCount === 0) return false;
      if (needle && !r.application.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data, q, onlyMissing]);

  if (loading && !data) return <div className="py-10 text-center text-sm text-gray-400">Yükleniyor…</div>;
  if (err) return <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select sizeVariant="sm" value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {(data?.platforms || ["ark"]).map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="uygulama ara"
            className="pl-8 pr-2.5 py-1.5 text-xs border border-gray-200 rounded-lg w-56"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
          Sadece eksiği olanlar
        </label>
        <span className="text-xs text-gray-400 tabular-nums">{rows.length} uygulama</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => csvDownload(
              `ocp_kapsam_${platform}`,
              ["application", ...envs, "eksik"],
              rows.map((r) => [r.application, ...envs.map((e) => (r.envs[e]?.length ? "VAR" : "YOK")), r.missing.join(" ")])
            )}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
          </button>
          <button onClick={() => load(platform)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Yenile
          </button>
        </div>
      </div>

      {data && (
        <div className="grid gap-3 md:grid-cols-4">
          <Stat n={data.totalApplications} l="toplam uygulama" />
          <Stat n={data.completeCount} l="tüm ortamlarda var" tone="ok" />
          <Stat n={data.totalApplications - data.completeCount} l="en az bir ortamda eksik" tone="warn" />
          <Stat n={data.clusters.length} l="cluster" />
        </div>
      )}

      {data && data.patterns.length > 0 && (
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3">
          <div className="text-xs font-semibold text-gray-700 mb-1.5">En sık eksik ortam desenleri</div>
          <div className="flex flex-wrap gap-2">
            {data.patterns.map((p) => (
              <span key={p.missing.join(",")} className="text-[11px] px-2 py-1 rounded-lg bg-white border border-gray-200">
                eksik: <b className="font-mono">{p.missing.join(", ")}</b> · {p.count} uygulama
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-left">
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Uygulama</th>
              {envs.map((e) => <th key={e} className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">{e}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.length === 0 && (
              <tr><td colSpan={envs.length + 1} className="px-3 py-8 text-center text-sm text-gray-400">Kayıt bulunamadı.</td></tr>
            )}
            {rows.slice(0, 500).map((r) => (
              <tr key={r.application} className="hover:bg-gray-50/60">
                <td className="px-3 py-2 font-mono text-xs text-gray-800">{r.application}</td>
                {envs.map((e) => {
                  const hit = r.envs[e];
                  return (
                    <td key={e} className="px-3 py-2">
                      {hit?.length ? (
                        <span
                          className="text-[11px] px-2 py-0.5 rounded-lg border bg-emerald-50 text-emerald-700 border-emerald-200"
                          title={hit.map((h) => `${h.cluster} / ${h.namespace}`).join("\n")}
                        >
                          VAR
                        </span>
                      ) : (
                        <span className="text-[11px] px-2 py-0.5 rounded-lg border bg-red-50 text-red-600 border-red-200">YOK</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 500 && (
        <p className="text-xs text-gray-400">İlk 500 satır gösteriliyor — daraltmak için arama kutusunu kullanın ya da CSV indirin.</p>
      )}
    </div>
  );
}

// ── 3) INIT SCRIPT SAPMASI ────────────────────────────────────────────────────────────
// Iki bakis acisi: SCRIPT bazli (bir dosya kac ayri surumle duruyor) ve SUNUCU bazli
// (bir host cogunluktan kac dosyada ayriliyor). Ikisi de ayni veriden turer.
function InitScriptsAudit() {
  const [root, setRoot] = useState("vhosting");
  const [data, setData] = useState<InitScriptsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [view, setView] = useState<"script" | "host">("script");
  const [q, setQ] = useState("");
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (r: string) => {
    setLoading(true);
    try {
      const res = await denetimApi.initScripts(r);
      if (res.ok) { setData(res); setErr(""); }
      else setErr(res.message || "Veri alınamadı.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(root); }, [root, load]);

  const scripts = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.scripts.filter((sc) => {
      if (onlyDiff && !sc.perServer && sc.variantCount <= 1 && sc.missing === 0) return false;
      if (needle && !sc.label.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data, q, onlyDiff]);

  const hostRows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.hostRows
      .filter((h) => {
        if (onlyDiff && h.deviationCount === 0 && h.missingCount === 0) return false;
        if (needle && !h.host.toLowerCase().includes(needle)) return false;
        return true;
      })
      .sort((a, b) => b.deviationCount - a.deviationCount || a.host.localeCompare(b.host));
  }, [data, q, onlyDiff]);

  if (loading && !data) return <div className="py-10 text-center text-sm text-gray-400">Yükleniyor…</div>;
  if (err) return <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select sizeVariant="sm" value={root} onChange={(e) => setRoot(e.target.value)}>
          {(data?.roots || ["vhosting"]).map((r) => <option key={r} value={r}>/{r}</option>)}
        </Select>

        <div className="flex gap-1 rounded-lg p-0.5 bg-gray-100">
          {([{ id: "script", label: "Script bazlı" }, { id: "host", label: "Sunucu bazlı" }] as const).map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                view === v.id ? "bg-white shadow-sm text-black" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={view === "script" ? "script ara" : "sunucu ara"}
            className="pl-8 pr-2.5 py-1.5 text-xs border border-gray-200 rounded-lg w-56"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
          Sadece farkı olanlar
        </label>
        <span className="text-xs text-gray-400 tabular-nums">
          {view === "script" ? `${scripts.length} script` : `${hostRows.length} sunucu`}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => (view === "script"
              ? csvDownload(`init_script_sapma_${root}`,
                  ["script", "sunucuya_ozel", "surum_sayisi", "cogunluk_hash", "cogunluk_adet", "sapan_adet", "eksik_adet"],
                  scripts.map((sc) => [sc.label, sc.perServer ? "EVET" : "HAYIR", sc.variantCount,
                    sc.majorityHash ? sc.majorityHash.slice(0, 16) : "", sc.majorityCount, sc.deviatingCount, sc.missing]))
              : csvDownload(`init_sunucu_sapma_${root}`,
                  ["host", "sapma_adedi", "sapan_scriptler", "eksik_adedi", "eksik_scriptler", "startCustom_var"],
                  hostRows.map((h) => [h.host, h.deviationCount, h.deviations.join(" "), h.missingCount,
                    h.missing.join(" "), h.hasCustom ? "EVET" : "HAYIR"])))}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
          </button>
          <button onClick={() => load(root)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Yenile
          </button>
        </div>
      </div>

      {data && (
        <div className="grid gap-3 md:grid-cols-4">
          <Stat n={data.hosts} l="sunucu" />
          <Stat n={data.identicalHosts} l="çoğunlukla birebir aynı" tone="ok" />
          <Stat n={data.hosts - data.identicalHosts} l="en az bir script'te farklı" tone="warn" />
          <Stat n={data.totalVariants} l="toplam farklı sürüm" />
        </div>
      )}

      {data && data.missingColumns.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          Şu dosyalar için veritabanında henüz sütun yok: <b>{data.missingColumns.join(", ")}</b>.
          check_initialize job'ı yeni haliyle bir kez çalıştığında sütun otomatik açılır ve buraya düşer.
        </div>
      )}

      {view === "script" ? (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-left">
                <th className="px-3 py-2 text-xs font-semibold text-gray-500">Script</th>
                <th className="px-3 py-2 text-xs font-semibold text-gray-500">Farklı sürüm</th>
                <th className="px-3 py-2 text-xs font-semibold text-gray-500">Çoğunluk</th>
                <th className="px-3 py-2 text-xs font-semibold text-gray-500">Sapan</th>
                <th className="px-3 py-2 text-xs font-semibold text-gray-500">Yok</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {scripts.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-gray-400">Kayıt bulunamadı.</td></tr>
              )}
              {scripts.map((sc) => (
                <React.Fragment key={sc.key}>
                  <tr
                    className="hover:bg-gray-50/60 cursor-pointer"
                    onClick={() => setOpen(open === sc.key ? null : sc.key)}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <ChevronRightIcon className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open === sc.key ? "rotate-90" : ""}`} />
                        <span className="font-mono text-xs text-gray-800">{sc.label}</span>
                        {sc.perServer && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border bg-violet-50 text-violet-700 border-violet-200">
                            sunucuya özel
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <VariantBadge sc={sc} />
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600 tabular-nums">
                      {sc.majorityHash
                        ? <span title={sc.majorityHash}><span className="font-mono">{sc.majorityHash.slice(0, 10)}…</span> · {sc.majorityCount}</span>
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums">
                      {sc.perServer
                        ? <span className="text-gray-400">—</span>
                        : sc.deviatingCount > 0
                          ? <span className="text-amber-700 font-semibold">{sc.deviatingCount}</span>
                          : <span className="text-gray-400">0</span>}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums">
                      {sc.missing > 0 ? <span className="text-gray-700">{sc.missing}</span> : <span className="text-gray-400">0</span>}
                    </td>
                  </tr>
                  {open === sc.key && (
                    <tr className="bg-gray-50/60">
                      <td colSpan={5} className="px-3 py-3">
                        <div className="space-y-2">
                          {sc.variants.map((v, i) => (
                            <div key={v.hash} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                                  sc.perServer
                                    ? "bg-violet-50 text-violet-700 border-violet-200"
                                    : i === 0
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                      : "bg-amber-50 text-amber-700 border-amber-200"
                                }`}>
                                  {sc.perServer ? `sürüm ${i + 1}` : i === 0 ? "çoğunluk" : `farklı sürüm ${i}`}
                                </span>
                                <span className="font-mono text-[11px] text-gray-500 break-all">{v.hash.slice(0, 32)}…</span>
                                <span className="text-xs text-gray-500 tabular-nums ml-auto">{v.count} sunucu</span>
                              </div>
                              <div className="mt-1.5 text-[11px] text-gray-600 font-mono break-words">
                                {v.hosts.slice(0, 40).join(", ")}
                                {v.hosts.length > 40 && ` … (+${v.hosts.length - 40})`}
                              </div>
                            </div>
                          ))}
                          {sc.missing > 0 && (
                            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-100 text-gray-600 border-gray-200">dosya yok</span>
                                <span className="text-xs text-gray-500 tabular-nums ml-auto">{sc.missing} sunucu</span>
                              </div>
                              <div className="mt-1.5 text-[11px] text-gray-600 font-mono break-words">
                                {sc.missingHosts.slice(0, 40).join(", ")}
                                {sc.missingHosts.length > 40 && ` … (+${sc.missingHosts.length - 40})`}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-left">
                <th className="px-3 py-2 text-xs font-semibold text-gray-500">Sunucu</th>
                <th className="px-3 py-2 text-xs font-semibold text-gray-500">Çoğunluktan sapan</th>
                <th className="px-3 py-2 text-xs font-semibold text-gray-500">Eksik</th>
                <th className="px-3 py-2 text-xs font-semibold text-gray-500">startCustom.sh</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {hostRows.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-sm text-gray-400">Kayıt bulunamadı.</td></tr>
              )}
              {hostRows.slice(0, 500).map((h) => (
                <tr key={h.host} className="hover:bg-gray-50/60 align-top">
                  <td className="px-3 py-2 font-mono text-xs text-gray-800 whitespace-nowrap">{h.host}</td>
                  <td className="px-3 py-2">
                    {h.deviationCount === 0 ? (
                      <span className="text-[11px] px-2 py-0.5 rounded-lg border bg-emerald-50 text-emerald-700 border-emerald-200">aynı</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {h.deviations.map((d) => (
                          <span key={d} className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">{d}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {h.missingCount === 0 ? <span className="text-xs text-gray-400">—</span> : (
                      <div className="flex flex-wrap gap-1">
                        {h.missing.map((d) => (
                          <span key={d} className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-gray-100 text-gray-600 border-gray-200">{d}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {h.hasCustom
                      ? <span className="text-[11px] font-mono text-violet-700" title={h.customHash || ""}>{(h.customHash || "").slice(0, 10)}…</span>
                      : <span className="text-xs text-gray-400">yok</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view === "host" && hostRows.length > 500 && (
        <p className="text-xs text-gray-400">İlk 500 satır gösteriliyor — daraltmak için arama kutusunu kullanın ya da CSV indirin.</p>
      )}
    </div>
  );
}

function VariantBadge({ sc }: { sc: InitScriptStat }) {
  const n = sc.variantCount;
  const cls = sc.perServer
    ? "bg-violet-50 text-violet-700 border-violet-200"
    : n <= 1
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : n <= 3
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-red-50 text-red-700 border-red-200";
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-lg border tabular-nums ${cls}`}>
      {n === 0 ? "hiç yok" : `${n} sürüm`}
    </span>
  );
}

function Stat({ n, l, tone }: { n: number; l: string; tone?: "ok" | "warn" }) {
  const color = tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-gray-900";
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-3">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{n.toLocaleString("tr-TR")}</div>
      <div className="text-xs text-gray-500 mt-0.5">{l}</div>
    </div>
  );
}
