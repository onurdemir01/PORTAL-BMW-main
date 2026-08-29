// src/components/scalex/steps/OperationStep.tsx — işlem seçimi ve ona bağlı alanlar.
//
// İKİ KURAL BU DOSYADA:
//
// 1. KULLANICI PLAYBOOK DEĞİŞKENİ GÖRMEZ. `execution_mode`, `allow_partial_execution`,
//    `change_confirmation`, `bulk_change_confirmation` kelimeleri ekranda YOKTUR;
//    sunucu üretir (server/scalex/launch.cjs).
//
// 2. YÖNLENDİRME YOK. "Önce kontrol et" ile "Uygula" EŞİT ağırlıkta iki seçenektir:
//    "Önerilen" rozeti yok, biri önceden seçili gelmiyor, renk/boyut farkı yok. Ekran
//    ne olacağını ANLATIR, kullanıcı adına karar VERMEZ.
import React, { useMemo, useState } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import type { ScaleXAction, ScaleXMode, ScaleXWorkload } from "@/api/scalexApi";

interface Props {
  apps: string[];
  workloads: ScaleXWorkload[];
  clusterCount: number;
  busy: boolean;
  onSubmit: (v: {
    action: ScaleXAction; executionMode: ScaleXMode;
    targetReplicas?: string; verificationTimeout: string;
    allowPartial: boolean; mailCc: string; hpaPin: boolean;
  }) => void;
}

// Her işlem TEK CÜMLEYLE ne yaptığını söyler — kullanıcı adını okuyup tahmin etmesin.
const ACTION_INFO: Record<ScaleXAction, { label: string; text: string }> = {
  stop: {
    label: "Durdur",
    text: "Replica sayısını 0 yapar. Önceki değer cluster'da saklanır, istediğinde geri alabilirsin. HPA'ya dokunulmaz.",
  },
  restore: {
    label: "Geri Al",
    text: "Daha önce durdurulan uygulamayı saklanan replica sayısına döndürür. Yalnızca kayıtlı durumu olan uygulamalar için seçilebilir.",
  },
  scale: {
    label: "Ölçekle",
    text: "Replica sayısını verdiğin değere çeker. Artırma da azaltma da olabilir. HPA'ya dokunulmaz.",
  },
};

const TIMEOUTS: { value: string; label: string }[] = [
  { value: "30", label: "30 saniye" },
  { value: "60", label: "1 dakika" },
  { value: "120", label: "2 dakika" },
];

const OperationStep: React.FC<Props> = ({ apps, workloads, clusterCount, busy, onSubmit }) => {
  const [action, setAction] = useState<ScaleXAction | null>(null);
  // Önceden seçili DEĞİL — kullanıcı bilinçli olarak seçsin (bkz. dosya başı, kural 2).
  const [mode, setMode] = useState<ScaleXMode | null>(null);
  const [replicas, setReplicas] = useState("");
  const [timeout, setTimeoutValue] = useState("60");
  const [allowPartial, setAllowPartial] = useState(true);
  const [mailCc, setMailCc] = useState("");
  // HPA sabitleme ONCEDEN SECILI DEGIL: HPA'ya dokunmak politikanin tersi, kullanici
  // bilinçli olarak istemeli.
  const [hpaPin, setHpaPin] = useState(false);

  const picked = useMemo(
    () => workloads.filter((w) => apps.includes(w.name)),
    [workloads, apps]
  );
  // `Geri Al` YALNIZCA kayıtlı durumu olan uygulamalarda seçilebilir. Bugün bu, iş
  // çalıştıktan SONRA `STATE;FAIL` ("Run stop first") olarak öğreniliyor.
  const notRestorable = picked.filter((w) => !w.restorable).map((w) => w.name);
  const restoreBlocked = notRestorable.length > 0;
  const alreadyStopped = picked.filter((w) => w.specReplicas === 0).map((w) => w.name);
  const withHpa = picked.filter((w) => w.hasHpa).map((w) => w.name);

  // HPA SABITLEME yalnizca `Ölçekle`/`Geri Al` ve hedef >= 1 icin anlamli:
  //   * `Durdur`da gereksiz — replica 0'da HPA kendiliğinden devre dışı kalır
  //     (`ScalingActive=False`), üstelik `minReplicas` 0 olamaz.
  const pinRelevant = (action === "scale" && /^[1-9][0-9]*$/.test(replicas)) || action === "restore";
  const pinOffered = pinRelevant && withHpa.length > 0 && mode === "apply";
  // `Ölçekle` ile 0, geri alınacak kayıt BIRAKMAZ (playbook durumu yalnızca `Durdur`
  // dalında saklar). İki yol da 0'a götürürken birinin hafızası olması, diğerinin
  // olmaması bir tuzaktı — sunucu da ayrıca reddediyor.
  const scaleToZero = action === "scale" && replicas.trim() === "0";
  const replicasValid = action !== "scale" || (/^[0-9]+$/.test(replicas) && !scaleToZero);
  const canSubmit = !!action && !!mode && replicasValid && !(action === "restore" && restoreBlocked);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium text-[var(--text-muted)] mb-2">İşlem</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(ACTION_INFO) as ScaleXAction[]).map((a) => {
            const disabled = busy || (a === "restore" && restoreBlocked);
            const active = action === a;
            return (
              <button
                key={a} type="button" disabled={disabled} onClick={() => setAction(a)}
                className={`text-left rounded-xl border p-3 transition-colors ${
                  active ? "border-[var(--accent)] bg-[var(--accent-bg)]" : "border-[var(--border)] hover:border-[var(--border-strong)]"
                } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <span className="block text-sm font-semibold text-[var(--text-primary)]">{ACTION_INFO[a].label}</span>
                <span className="block mt-1 text-xs text-[var(--text-muted)]">{ACTION_INFO[a].text}</span>
              </button>
            );
          })}
        </div>
        {restoreBlocked && (
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            <strong>Geri Al</strong> seçilemiyor: {notRestorable.join(", ")} portaldan durdurulmamış —
            geri alınacak kayıtlı durum yok.
          </p>
        )}
      </div>

      {action === "scale" && (
        <div>
          <label htmlFor="scalex-replicas" className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
            Hedef replica sayısı
          </label>
          <input
            id="scalex-replicas" type="number" min={0} value={replicas} disabled={busy}
            onChange={(e) => setReplicas(e.target.value)}
            className="w-40 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]
                       text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          {scaleToZero && (
            <p className="mt-1.5 text-xs text-red-600">
              0 için <strong>Durdur</strong> işlemini kullanın — önceki değer saklanır ve geri
              alabilirsiniz. "Ölçekle" ile 0 verildiğinde geri alınacak bir kayıt oluşmaz.
            </p>
          )}
          {!replicasValid && !scaleToZero && replicas !== "" && (
            <p className="mt-1 text-xs text-red-600">1 veya daha büyük bir tam sayı girin.</p>
          )}
        </div>
      )}

      {action === "stop" && alreadyStopped.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{alreadyStopped.join(", ")} zaten 0 replica ile çalışıyor.</span>
        </div>
      )}

      {withHpa.length > 0 && action === "stop" && (
        <p className="text-xs text-[var(--text-muted)]">
          {withHpa.join(", ")} için HPA tanımlı. <strong>Sorun değil:</strong> replica 0 olduğunda
          Kubernetes HPA'yı devre dışı bırakır, uygulama 0'da kalır. HPA'ya dokunulmaz ve iş
          bunu çalıştıktan sonra doğrular.
        </p>
      )}

      {withHpa.length > 0 && action !== "stop" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2 text-xs text-amber-900">
          <p>
            <strong>{withHpa.join(", ")} için HPA tanımlı.</strong> Replica 1'in üstüne çıktığı anda
            HPA devreye girer ve 15–60 saniye içinde kendi hesabına döner —{" "}
            <strong>verdiğin değer kalıcı olmayabilir.</strong>
          </p>
          {pinOffered && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={hpaPin} disabled={busy}
                onChange={(e) => setHpaPin(e.target.checked)} />
              <span>
                HPA'yı bu işlem süresince <strong>geçici olarak sabitle</strong>
                <span className="block mt-0.5 text-amber-800">
                  Mevcut min/max saklanır, işlem bitince iade edilir — iş yarıda kesilse bile.
                  HPA'ya dokunulduğu için denetim kaydına yazılır.
                </span>
              </span>
            </label>
          )}
        </div>
      )}

      {/* NÖTR SUNUM. İki seçenek aynı boyut, aynı çerçeve, aynı renk; hiçbiri
          önceden seçili değil ve hiçbirinde "Önerilen" etiketi yok. */}
      <div>
        <p className="text-xs font-medium text-[var(--text-muted)] mb-2">Nasıl çalıştırılsın?</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" disabled={busy} onClick={() => setMode("dry_run")}
            className={`text-left rounded-xl border p-3 transition-colors ${
              mode === "dry_run" ? "border-[var(--accent)] bg-[var(--accent-bg)]" : "border-[var(--border)] hover:border-[var(--border-strong)]"
            }`}>
            <span className="block text-sm font-semibold text-[var(--text-primary)]">Önce kontrol et</span>
            <span className="block mt-1 text-xs text-[var(--text-muted)]">
              Bağlantı, yetki ve hedefler denetlenir. Hiçbir şey değiştirilmez.
            </span>
          </button>
          <button type="button" disabled={busy} onClick={() => setMode("apply")}
            className={`text-left rounded-xl border p-3 transition-colors ${
              mode === "apply" ? "border-[var(--accent)] bg-[var(--accent-bg)]" : "border-[var(--border)] hover:border-[var(--border-strong)]"
            }`}>
            <span className="block text-sm font-semibold text-[var(--text-primary)]">Uygula</span>
            <span className="block mt-1 text-xs text-[var(--text-muted)]">
              Değişiklik gerçekten yapılır. Prod ortamında onay adımları devreye girer.
            </span>
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="scalex-timeout" className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
            Sonucu ne kadar bekleyelim?
          </label>
          <select id="scalex-timeout" value={timeout} disabled={busy} onChange={(e) => setTimeoutValue(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]
                       text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]">
            {TIMEOUTS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="scalex-cc" className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
            Rapor CC (isteğe bağlı)
          </label>
          <input id="scalex-cc" type="text" value={mailCc} disabled={busy} placeholder="ekip@garantibbva.com.tr"
            onChange={(e) => setMailCc(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]
                       text-[var(--text-primary)] placeholder-[var(--text-muted)]
                       focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
          <p className="mt-1 text-xs text-[var(--text-muted)]">Rapor her durumda sana gönderilir.</p>
        </div>
      </div>

      {clusterCount > 1 && (
        <label className="flex items-start gap-2.5 text-sm cursor-pointer">
          <input type="checkbox" className="mt-1" checked={allowPartial} disabled={busy}
            onChange={(e) => setAllowPartial(e.target.checked)} />
          <span>
            <span className="text-[var(--text-primary)]">Bir hedef başarısız olursa diğerlerine devam et</span>
            <span className="block text-xs text-[var(--text-muted)] mt-0.5">
              Kapatırsan “hepsi ya da hiçbiri” çalışır: tek bir ön kontrol hatası tüm işlemi iptal eder
              ve cluster'da hiçbir değişiklik olmaz.
            </span>
          </span>
        </label>
      )}

      <div className="flex justify-end border-t border-[var(--border)] pt-4">
        <button type="button" className="btn-primary" disabled={busy || !canSubmit}
          onClick={() => onSubmit({
            action: action!, executionMode: mode!,
            ...(action === "scale" ? { targetReplicas: replicas } : {}),
            verificationTimeout: timeout, allowPartial, mailCc: mailCc.trim(),
            hpaPin: pinOffered && hpaPin,
          })}>
          Önizle
        </button>
      </div>
    </div>
  );
};

export default OperationStep;
