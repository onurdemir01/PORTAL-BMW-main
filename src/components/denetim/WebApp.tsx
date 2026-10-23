// src/components/denetim/WebApp.tsx — "Denetim > Web-App İlişkisi" (2026-08-23).
//
// Her uygulama satirinin onunde onu SERVIS EDEN web sunucusu: host, ip, port, server_name.
// Eslesmenin NASIL kuruldugu her satirda yaziyor - kural tahmine dayali oldugu icin
// guvenilirlik gizlenmemeli (route eslesmesinde oldugu gibi).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { LoadingLogo } from '@/components/common/LoadingLogo';
import {
  ArrowPathIcon, ArrowDownTrayIcon, MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { denetimApi, type WebAppResult, type WebAppRow, type WebAppVhost, type WebAppDnsCevap } from "@/api/denetimApi";
import { Select } from "@/components/ui/Form";
import { fmtNumber } from "@/utils/datetime";
import { TableEmptyRow } from "@/components/common/EmptyState";
import { downloadCsv as csvDownload } from '@/utils/csv';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { grupla } from './webAppGrup';

const nf = (n: number) => fmtNumber(n);

// DNS -> LB VIP (2026-10-13). Sunucu satirin bolgesinin (gtdmz / fw.garanti) ve uyenin sitesinin
// (Pendik / Ankara) DNS sunucusuyla cozer; uye KENDI sitesinin cevabiyla gosterilir (Ankara VIP'i
// Pendik'ten farklidir). Bolge bilinmiyorsa Portal cozucusu ('varsayilan') kullanilir.
type DnsDurum = { sonuc: Record<string, Record<string, WebAppDnsCevap>> };
// BOLGE VHOST BASINA (2026-10-16): sunucu server_name'in kendi alanindan bolge verir (x.gtdmz.com.tr ->
// gtdmz); domain'i bos uygulamada Ankara uyesi artik Ankara DNS'ine sorulur. Eski sunucu vermezse satirin
// (uygulama domain'i) bolgesi.
const bolgeOf = (r: WebAppRow, w: WebAppVhost) => (w.dnsBolge !== undefined ? w.dnsBolge : r.dnsBolge) || null;
const dnsAnahtar = (r: WebAppRow, w: WebAppVhost) => `${bolgeOf(r, w) || "-"}|${(w.serverName || "").trim().toLowerCase()}`;
function dnsOf(dns: DnsDurum | null, r: WebAppRow, w: WebAppVhost): { cevap?: WebAppDnsCevap; kaynak: string; siteBelirsiz: boolean } {
  if (!dns) return { kaynak: "", siteBelirsiz: false };
  const kayit = dns.sonuc[dnsAnahtar(r, w)] || {};
  const bolge = bolgeOf(r, w);
  if (bolge) {
    const site = w.site === "Ankara" || w.site === "Pendik" ? w.site : "";
    return site ? { cevap: kayit[site], kaynak: `${site} DNS (${kayit[site]?.dnsSunucusu || bolge})`, siteBelirsiz: false } : { kaynak: "", siteBelirsiz: true };
  }
  return { cevap: kayit.varsayilan, kaynak: "Portal çözücüsü", siteBelirsiz: w.site === "Ankara" };
}


export default function WebApp() {
  const [source, setSource] = useState("mw");
  const [q, setQ] = useState("");
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);
  const [data, setData] = useState<WebAppResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [dns, setDns] = useState<DnsDurum | null>(null);
  const [dnsYukleniyor, setDnsYukleniyor] = useState(false);

  // Tablo geldikten SONRA DNS adlari 400'luk parcalar halinde cozulur (tabloyu bekletmez).
  // useAsyncEffect: ilk setState effect govdesinde senkron olmaz; `alive()` veri degisince
  // ya da bilesen sokulunce false doner (eski tablonun DNS sonucu yenisine yazilmaz).
  useAsyncEffect(async (alive) => {
    if (!data?.rows?.length) { setDns(null); return; }
    const tekil = new Map<string, { ad: string; bolge: string | null }>();
    for (const r of data.rows) for (const w of r.web) {
      const ad = (w.serverName || "").trim().toLowerCase();
      if (ad) tekil.set(dnsAnahtar(r, w), { ad, bolge: bolgeOf(r, w) });
    }
    const adlar = [...tekil.values()];
    if (!adlar.length) { setDns(null); return; }
    setDnsYukleniyor(true);
    const birlesik: DnsDurum = { sonuc: {} };
    for (let i = 0; i < adlar.length && alive(); i += 400) {
      const c = await denetimApi.webAppDns(adlar.slice(i, i + 400)).catch(() => null);
      if (!c || !c.ok) continue;
      Object.assign(birlesik.sonuc, c.sonuc || {});
      if (alive()) setDns({ sonuc: { ...birlesik.sonuc } });
    }
    if (alive()) setDnsYukleniyor(false);
  }, [data]);

  // POOL: ayni VIP'e (uyenin KENDI sitesinin cevabiyla) cozulen tum web sunuculari.
  const havuz = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of data?.rows || []) for (const w of r.web) {
      const { cevap } = dnsOf(dns, r, w);
      for (const ip of cevap?.ips || []) {
        if (ip === w.ip) continue;
        if (!m.has(ip)) m.set(ip, new Set());
        m.get(ip)!.add(`${w.host}${w.ip ? ` (${w.ip})` : ""}`);
      }
    }
    return m;
  }, [data, dns]);

  // Uygulama (+ ortam) basina TEK satir; web sunuculari tekil (bkz. webAppGrup.ts).
  const gruplar = useMemo(() => grupla(data?.rows || []), [data]);

  const load = useCallback(async (s: string, needle: string, unmatched: boolean) => {
    setLoading(true);
    try {
      const r = await denetimApi.webApp(s, needle, unmatched);
      if (r.ok) { setData(r); setErr(""); } else setErr(r.message || "Veri alınamadı.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);

  // Arama sunucu tarafinda uygulaniyor (tablo buyuk); yazarken her tusa istek atmamak
  // icin kisa bir gecikme.
  useEffect(() => {
    const t = setTimeout(() => load(source, q, onlyUnmatched), 300);
    return () => clearTimeout(t);
  }, [source, q, onlyUnmatched, load]);

  if (loading && !data) return <LoadingLogo />;
  if (err) return <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>;
  if (!data) return null;

  // Sunucu tum kaynaklari (sertifika + Server Hub + AJP) sayar; eski sunucuda ozetten turet.
  const matchedCount = data.matchedTotal ?? data.matchSummary
    .filter((m) => m.how !== "eşleşmedi" && m.how !== "web sunucusu var, server_name tutmadı")
    .reduce((a, m) => a + m.count, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select sizeVariant="sm" value={source} onChange={(e) => setSource(e.target.value)}>
          {data.sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </Select>
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="uygulama ya da sunucu ara"
            className="pl-8 pr-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg w-64"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
          <input type="checkbox" checked={onlyUnmatched} onChange={(e) => setOnlyUnmatched(e.target.checked)} />
          Sadece eşleşmeyenler
        </label>
        <span className="text-xs text-[var(--text-muted)] tabular-nums">
          {nf(gruplar.length)} uygulama · {nf(data.shown)} / {nf(data.total)} uygulama sunucusu
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => csvDownload("web_app_" + source,
              ["uygulama", "uygulama_sunucusu", "ortam", "domain", "tier", "tier_kaynak", "web_sunucusu", "site", "ip", "port", "server_name", "dns_vip", "dns_kaynak", "conf_file", "urun", "eslesme", "nasil"],
              data.rows.flatMap((r) => (r.web.length
                ? r.web.map((w) => {
                    const d = dnsOf(dns, r, w);
                    return [r.app, r.appHost, r.env, r.domain, r.tier, r.tierKaynak || "", w.host, w.site || "", w.ip, w.port, w.serverName, d.cevap?.ips?.join(" ") || d.cevap?.hata || "", d.kaynak, w.confFile, w.product, r.how, (r.nasil || []).join(" | ")];
                  })
                : [[r.app, r.appHost, r.env, r.domain, r.tier, r.tierKaynak || "", r.webHostCandidate, "", "", "", "", "", "", "", "", r.how, (r.nasil || []).join(" | ")]])))}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
          </button>
          <button onClick={() => load(source, q, onlyUnmatched)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]">
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Yenile
          </button>
        </div>
      </div>

      {data.certMissing && (
        <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          Sertifika envanteri okunamadı — web sunucusu bilgisi çıkarılamıyor.{" "}
          <code className="px-1 rounded bg-white/70 border border-red-200">certificates_inventory</code>{" "}
          job’ı çalıştıktan sonra burası dolar.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat n={data.total} l="uygulama sunucusu" />
        <Stat n={matchedCount} l="web sunucusu bulundu" tone="ok" />
        <Stat n={data.total - matchedCount} l="eşleşmedi" tone={data.total - matchedCount ? "warn" : undefined} />
        <Stat n={data.tierSummary.find((t) => t.tier === "3-tier")?.count ?? 0} l="3-tier uygulama" />
      </div>

      {/* "Eslesme yollari" ozet kutusu KALDIRILDI (2026-10-23, kullanici: "asiri kalabalik gozu
          yoruyor ... sadece satirlarin en sonunda nasil eslestirildigine dair bilgi kalsa"). Yol her
          satirin "Eslesme nasil kuruldu" kolonunda; Server Hub hatasi tek basina uyari olarak kalir. */}
      {data.hubHata && (
        <p role="alert" className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Server Hub okunamadı ({data.hubHata}) — yalnız sertifika envanteri eşleşmesi gösteriliyor.
        </p>
      )}

      {dns && (
        <p className="text-[11px] text-[var(--text-muted)]">
          <b>DNS → LB VIP:</b> her web sunucusu kendi sitesinin DNS sunucusuyla çözülür —{" "}
          gtdmz: Pendik <code>10.230.238.22</code> / Ankara <code>10.236.238.22</code>, fw.garanti: Pendik <code>10.230.238.1</code> / Ankara <code>10.236.238.1</code>.
          Aynı VIP’e düşen sunucular o VIP’in havuz (pool) üyeleridir. Domain’i bu ikisi dışında olan satırlar Portal sunucusunun çözücüsüyle çözülür.
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)] text-left">
              <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Uygulama</th>
              <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Uyg. sunucuları</th>
              <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Web sunucusu</th>
              <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">IP : Port</th>
              <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">server_name</th>
              <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]" title="DNS adının çözüldüğü IP: load balancer virtual IP'si. Her web sunucusu KENDİ sitesinin DNS cevabıyla gösterilir.">
                DNS → LB VIP {dnsYukleniyor && <ArrowPathIcon className="inline w-3 h-3 animate-spin motion-reduce:animate-none" aria-label="çözülüyor" />}
              </th>
              <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Eşleşme nasıl kuruldu</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {gruplar.length === 0 && (
              <TableEmptyRow colSpan={7} />
            )}
            {gruplar.map((g) => (
              <tr key={g.anahtar} className="hover:bg-[var(--bg-elevated)]/60 align-top" data-testid="webapp-satir">
                <td className="px-3 py-2 font-mono text-xs text-[var(--text-primary)] whitespace-nowrap">
                  {g.app}
                  {g.tiers.map((t) => {
                    const kaynak = g.satirlar.find((r) => r.tier === t)?.tierKaynak;
                    return (
                      <span key={t} className="ml-1.5 text-[10px] px-1 py-0.5 rounded border bg-[var(--bg-elevated)] text-[var(--text-muted)] border-[var(--border)]"
                        title={kaynak === "domain" ? "Envanterdeki domain'den" : kaynak ? `Envanterde domain yok — ${kaynak} kanıtından` : "Envanterde domain yok ve web sunucusu bulunamadı"}>
                        {t}
                      </span>
                    );
                  })}
                  {g.env && <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{g.env}</div>}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--text-secondary)] whitespace-nowrap">
                  <div className="flex flex-col gap-0.5">
                    {g.satirlar.map((r) => (
                      <span key={r.appHost} className="inline-flex items-center gap-1">
                        {r.appHost}
                        {!r.matched && <span className="text-[9px] px-1 rounded border border-red-200 bg-red-50 text-red-700" title={r.how}>web yok</span>}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                  {g.web.length ? (
                    <div className="flex flex-col gap-0.5">
                      {g.web.map((w, i) => (
                        <span key={i} className="text-[var(--text-primary)]" title={g.satirlar.length > 1 ? `Bulan uygulama sunucuları: ${w.uygulamaSunuculari.join(", ")}` : undefined}>
                          {w.host}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {[...new Set(g.satirlar.map((r) => r.webHostCandidate).filter(Boolean))].map((h) => (
                        <span key={h} className="text-[var(--text-muted)]" title="Kurala göre beklenen sunucu; doğrulanamadı">
                          {h} <span className="opacity-70">(aday)</span>
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--text-secondary)] whitespace-nowrap tabular-nums">
                  {g.web.length ? (
                    <div className="flex flex-col gap-0.5">
                      {g.web.map((w, i) => <span key={i}>{w.ip}{w.port ? `:${w.port}` : ""}</span>)}
                    </div>
                  ) : <span className="text-[var(--text-muted)]">—</span>}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-[var(--text-secondary)]">
                  {g.web.length ? (
                    <div className="flex flex-col gap-0.5">
                      {g.web.map((w, i) => (
                        <span key={i} title={[w.confFile ? `conf: ${w.confFile}` : "", w.ajpHedef ? `AJP/proxy hedefi: ${w.ajpHedef}` : ""].filter(Boolean).join(" · ") || undefined}>
                          {w.serverName}
                          {w.product && <span className="ml-1 text-[10px] text-[var(--text-muted)]">{w.product}</span>}
                          {String(w.kaynak || "").includes("mc") && (
                            <span className="ml-1 text-[9px] px-1 rounded border border-sky-200 bg-sky-50 text-sky-700" title={`Red Hat Apache mod_cluster: balancer://${w.mcBalancer || ""} = uygulama adı (JBoss 8). Aynı site + ortamdaki web sunucusu; o anki üye JVM doğrulanmadı.`}>
                              mod_cluster
                            </span>
                          )}
                          {(w.kaynak === "ajp" || w.kaynak === "ad+ajp") && (
                            <span className="ml-1 text-[9px] px-1 rounded border border-sky-200 bg-sky-50 text-sky-700" title={w.kaynak === "ajp" ? "Yalnız AJP/proxy hedefiyle bulundu: vhost bu uygulamanın JVM portuna gidiyor (ad tutmasa da)" : "Ad eşleşmesi AJP/proxy hedefiyle de doğrulandı"}>
                              {w.kaynak === "ajp" ? "AJP" : "ad+AJP"}
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  ) : <span className="text-[var(--text-muted)]">—</span>}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] whitespace-nowrap">
                  {g.web.length ? (
                    <div className="flex flex-col gap-0.5">
                      {g.web.map((w, i) => {
                        const d = dnsOf(dns, w.satir, w);
                        if (d.siteBelirsiz && !d.cevap)
                          return <span key={i} className="text-[var(--text-muted)]" title="Web sunucusunun sitesi adından çıkarılamadı (Pendik/Ankara)">site belirsiz</span>;
                        if (!d.cevap) return <span key={i} className="text-[var(--text-muted)]">{dnsYukleniyor ? "çözülüyor…" : "—"}</span>;
                        if (d.cevap.hata) return <span key={i} className="text-[var(--text-muted)]" title={`${d.kaynak}: ${d.cevap.hata}`}>{d.cevap.hata}</span>;
                        return (
                          <span key={i} className="flex flex-wrap items-center gap-1" title={`${w.serverName} → ${(d.cevap.ips || []).join(", ")} (${d.kaynak})`}>
                            {(d.cevap.ips || []).map((ip) => {
                              const kendi = ip === w.ip;
                              const uyeler = havuz.get(ip);
                              return (
                                <span key={ip} className="inline-flex items-center gap-1">
                                  <b className="text-[var(--text-primary)]">{ip}</b>
                                  {kendi ? (
                                    <span className="text-[9px] px-1 rounded border border-amber-200 bg-amber-50 text-amber-700" title="DNS doğrudan bu web sunucusunun IP'sine çözülüyor: önünde load balancer yok">sunucu IP'si · LB yok</span>
                                  ) : (
                                    <span className="text-[9px] px-1 rounded border border-sky-200 bg-sky-50 text-sky-700" title={uyeler ? `Bu VIP'in bu listedeki üyeleri:\n${[...uyeler].join("\n")}` : "VIP"}>
                                      VIP{uyeler ? ` · ${uyeler.size} üye` : ""}
                                    </span>
                                  )}
                                </span>
                              );
                            })}
                            {d.siteBelirsiz && <span className="text-[9px] text-amber-700" title="server_name'in alanı gtdmz / fw.garanti değil: gösterilen cevap Portal sunucusunun çözücüsünden. Ankara VIP'i farklı olabilir.">⚠ Ankara VIP'i farklı olabilir</span>}
                          </span>
                        );
                      })}
                    </div>
                  ) : <span className="text-[var(--text-muted)]">—</span>}
                </td>
                <td className="px-3 py-2 text-[11px] min-w-[22rem] max-w-[40rem]">
                  <div className="flex flex-col gap-1.5">
                    {g.satirlar.map((r) => (
                      <div key={r.appHost} data-testid="webapp-nasil">
                        <div className="flex items-center gap-1.5">
                          <b className="font-mono text-[var(--text-primary)]">{r.appHost}</b>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${
                            r.matched ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : r.how === "eşleşmedi" ? "bg-red-50 text-red-700 border-red-200"
                              : "bg-amber-50 text-amber-700 border-amber-200"
                          }`}>
                            {r.matched ? "eşleşti" : r.how}
                          </span>
                        </div>
                        <ul className="mt-0.5 space-y-0.5 text-[var(--text-secondary)] whitespace-normal">
                          {(r.nasil && r.nasil.length ? r.nasil : [r.how]).map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.capped && (
        <p className="text-xs text-[var(--text-muted)]">
          İlk {nf(data.shown)} satır gösteriliyor — daraltmak için arama kutusunu kullanın ya
          da CSV indirin. Özet sayılar <b>tüm</b> satırlar üzerinden hesaplanır.
        </p>
      )}
    </div>
  );
}

function Stat({ n, l, tone }: { n: number; l: string; tone?: "ok" | "warn" }) {
  const color = tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-[var(--text-primary)]";
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{nf(n)}</div>
      <div className="text-xs text-[var(--text-muted)] mt-0.5">{l}</div>
    </div>
  );
}
