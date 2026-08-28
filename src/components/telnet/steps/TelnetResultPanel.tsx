// src/components/telnet/steps/TelnetResultPanel.tsx — testin GERÇEK sonucu.
//
// ÖNCE BURADA HİÇBİR ŞEY YOKTU. Playbook AÇIK/KAPALI satırlarını yalnızca `debug` mesajı
// olarak üretiyor, portal bunları HİÇ okumuyordu (backend `artifacts`i eline alıp
// atıyordu). Ekranda görünen tek şey ham AWX log'u ve bir YEŞİL TİK'ti — üstelik bu tik
// "test başarıyla ÇALIŞTI" demek olduğu halde "bağlantı AÇIK" gibi okunuyordu. Tüm portlar
// KAPALI olsa bile job `successful` döndüğü için tik yeşildi: "sonuç yok"tan kötü, çünkü
// aktif olarak YANLIŞ bilgi veriyordu.
//
// Sonuç artık `set_stats` sözleşmesinden okunur (bkz. ocp_telnet_control.yml son play'i)
// ve hedef başına satır olarak gösterilir. KISMİ başarı görünür: "3 hedeften 1'i açık".
import React from "react";
import {
  CheckCircleIcon, XCircleIcon, ExclamationTriangleIcon, QuestionMarkCircleIcon,
} from "@heroicons/react/24/outline";
import type { TelnetResult, TelnetTargetResult } from "@/api/telnetApi";

const STATE_META: Record<TelnetTargetResult["state"], { label: string; cls: string; Icon: typeof CheckCircleIcon }> = {
  open:   { label: "AÇIK",         cls: "text-[var(--status-success)]", Icon: CheckCircleIcon },
  closed: { label: "KAPALI",       cls: "text-[var(--status-danger)]",  Icon: XCircleIcon },
  // "error" ile "closed" AYNI ŞEY DEĞİL: biri "port kapalı", diğeri "test yapılamadı".
  // Aynı renge boyamak kullanıcıyı yanlış yönlendirir — bir ağ kuralı sanıp saatlerce
  // yanlış yerde arayabilir.
  error:  { label: "TEST YAPILAMADI", cls: "text-[var(--status-warning)]", Icon: ExclamationTriangleIcon },
};

const OVERALL_META: Record<TelnetResult["overallStatus"], { title: string; cls: string; Icon: typeof CheckCircleIcon }> = {
  open:    { title: "Tüm hedeflerde bağlantı AÇIK", cls: "text-[var(--status-success)]", Icon: CheckCircleIcon },
  partial: { title: "Kısmi — bazı hedeflerde açık", cls: "text-[var(--status-warning)]", Icon: ExclamationTriangleIcon },
  closed:  { title: "Hiçbir hedeften bağlantı kurulamadı", cls: "text-[var(--status-danger)]", Icon: XCircleIcon },
  error:   { title: "Test tamamlanamadı", cls: "text-[var(--status-warning)]", Icon: ExclamationTriangleIcon },
};

const TelnetResultPanel: React.FC<{ result: TelnetResult }> = ({ result }) => {
  const meta = OVERALL_META[result.overallStatus];
  const { counts } = result;

  return (
    <div className="w-full text-left space-y-3">
      <div className="flex items-start gap-2.5">
        <meta.Icon aria-hidden="true" className={`w-6 h-6 flex-shrink-0 ${meta.cls}`} />
        <div className="min-w-0">
          <p className={`text-sm font-semibold ${meta.cls}`}>{meta.title}</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Hedef:{" "}
            <span className="font-mono text-[var(--text-secondary)]">
              {result.target.host}:{result.target.port}
            </span>
            {" · "}
            {/* KISMİ BAŞARI GÖRÜNÜR: eskiden "3 hedeften 1'i açık" bilgisi hiçbir yerde yoktu. */}
            <strong className="text-[var(--text-primary)]">{counts.open}</strong> / {counts.total} hedefte açık
            {counts.error > 0 && <> · {counts.error} hedefte test yapılamadı</>}
          </p>
        </div>
      </div>

      {result.targets.length === 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--status-warning)] bg-[var(--status-warning-bg)] p-3 text-xs text-amber-800">
          <QuestionMarkCircleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            İş tamamlandı ama hiçbir hedef sonucu yayınlanmadı. Genellikle bu, hiçbir
            cluster'a giriş yapılamadığı anlamına gelir — aşağıdaki AWX log'unda
            "login outcome" satırları sebebi söyler.
          </span>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
          {result.targets.map((t, i) => {
            const s = STATE_META[t.state];
            return (
              <div key={`${t.cluster}/${t.namespace}/${i}`} className="px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <s.Icon aria-hidden="true" className={`w-4 h-4 flex-shrink-0 ${s.cls}`} />
                  <span className="text-xs font-mono text-[var(--text-primary)] truncate">
                    {t.cluster}
                    <span className="text-[var(--text-muted)]"> / </span>
                    {t.namespace}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono truncate hidden sm:inline">
                    ({t.bastion})
                  </span>
                  <span className="text-xs text-[var(--text-muted)] font-mono ml-auto flex-shrink-0">
                    {t.ip}:{t.port}
                  </span>
                  <span className={`text-xs font-semibold flex-shrink-0 ${s.cls}`}>{s.label}</span>
                </div>
                {/* Ayrıntı yalnızca sorunlu satırlarda: açık bağlantıda telnet çıktısı
                    gürültüden ibaret, kapalı/hatalı olanda ise TEK ipucu odur. */}
                {t.state !== "open" && t.detail && (
                  <p className="mt-1 pl-6 text-[10px] font-mono text-[var(--text-muted)] break-all line-clamp-2">
                    rc={t.rc} · {t.detail}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TelnetResultPanel;
