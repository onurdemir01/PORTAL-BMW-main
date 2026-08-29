// src/components/scalex/steps/PreviewStep.tsx — "ne olacak" tek bakışta.
//
// `/preview` HİÇBİR ŞEY TETİKLEMEZ ve HİÇBİR ŞEY KAYDETMEZ; yalnızca hesaplar. Asıl
// karar `/run`da YENİDEN verilir (Self Service'in `ss/oco/validate` deseni) — bu ekran
// bir söz değil, bir tahmindir ve öyle davranılır.
import React, { useEffect, useState } from "react";
import {
  ExclamationTriangleIcon, CheckCircleIcon, ClockIcon, ShieldCheckIcon, ArrowUturnLeftIcon,
} from "@heroicons/react/24/outline";
import {
  scalexApi, type ScaleXAction, type ScaleXMode, type ScaleXPreview, type ScaleXScope, type ScaleXWorkload,
} from "@/api/scalexApi";

interface Props {
  scope: ScaleXScope;
  action: ScaleXAction;
  executionMode: ScaleXMode;
  targetReplicas?: string;
  verificationTimeout: string;
  workloads: ScaleXWorkload[];
  hpaPin: boolean;
  busy: boolean;
  onConfirm: (v: { writtenConfirm?: string; reason?: string; ocoNumber?: string }) => void;
}

const ACTION_LABEL: Record<ScaleXAction, string> = { stop: "DURDUR", restore: "GERİ AL", scale: "ÖLÇEKLE" };

const PreviewStep: React.FC<Props> = ({
  scope, action, executionMode, targetReplicas, verificationTimeout, workloads, hpaPin, busy, onConfirm,
}) => {
  const [preview, setPreview] = useState<ScaleXPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [written, setWritten] = useState("");
  const [reason, setReason] = useState("");
  const [ocoNumber, setOcoNumber] = useState("");

  useEffect(() => {
    let alive = true;
    scalexApi.preview({ ...scope, action, executionMode, targetReplicas, verificationTimeout })
      .then((r) => { if (!alive) return; if (r.ok) setPreview(r); else setError(r.message || "Önizleme alınamadı."); })
      .catch((e) => alive && setError((e as Error).message));
    return () => { alive = false; };
  }, [scope.clusters.join(","), scope.apps?.join(","), action, executionMode, targetReplicas]);

  if (error) {
    return (
      <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
        <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
      </div>
    );
  }
  if (!preview) return <div className="py-8 text-center text-sm text-[var(--text-muted)]">Önizleme hesaplanıyor…</div>;

  const r = preview.blastRadius;
  const g = preview.gatePolicy;
  const picked = workloads.filter((w) => (scope.apps || []).includes(w.name));
  // Prod'da eşik aşıldığında patlama yarıçapı görsel olarak da ağırlaşır — sayı tek
  // başına küçük görünebilir, etkilenen cluster'ları TEK TEK göstermek gerçeği taşır.
  const heavy = r.requiresWrittenConfirm;
  // Cluster adi YALNIZCA birden fazla cluster varken gosterilir: tek cluster'da her
  // satira ayni adi yazmak gurultu olurdu.
  const multiCluster = new Set(picked.map((w) => w.cluster)).size > 1;
  // Geri almada hedefi BILINMEYEN satir varsa listenin altinda bir kez aciklanir.
  const anyUnknownTarget = action === "restore" && picked.some((w) => w.previousReplicas == null);

  const writtenOk = !r.requiresWrittenConfirm || written.trim() === scope.namespace;
  const reasonOk = g.oco !== "warn" || reason.trim().length > 0;
  // OCO "gerekli" iken numara BOSKEN buton aktifti: kullanici basiyor, sunucu 400
  // donuyor, ekran onizlemeye geri donuyordu — garantili bos bir gidis-donus.
  const ocoOk = g.oco !== "require" || ocoNumber.trim().length > 0;
  const blocked = r.exceedsMaxTargets;
  // BUTON NEDEN PASIF? Sessizce olu bir buton, namespace'i bir harf yanlis yazan
  // kullaniciyi hicbir geri bildirim olmadan birakiyordu.
  const blockReason = blocked
    ? "Hedef sayısı sınırın üzerinde — kapsamı daraltın."
    : !writtenOk
      ? (written.trim() ? "Yazdığınız namespace adı eşleşmiyor." : "Onaylamak için namespace adını yazın.")
      : !reasonOk ? "Gerekçe zorunlu."
      : !ocoOk ? "OCO numarası zorunlu."
      : "";

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-4 ${heavy ? "border-red-200 bg-red-50" : "border-[var(--border)] bg-[var(--bg-inset)]"}`}>
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {ACTION_LABEL[action]}
            {action === "scale" && targetReplicas != null ? ` → ${targetReplicas} replica` : ""}
            {" · "}
            <span className="tabular-nums">
              {r.clusterCount} cluster × {r.appCount} uygulama = {r.targets} hedef
            </span>
          </p>
          {r.isProd && <span className="pf-label pf-label--red">PROD ortamı</span>}
          {/* HER IKI MOD DA ACIKCA ETIKETLENIR. Eskiden yalnizca `dry_run` rozet
              tasiyordu; `apply` modunda ekranda hicbir isaret yoktu. Panelden tek
              tikla gelen "Geri Al" akisi kullaniciyi dogrudan `apply`a soktugu icin,
              modu KENDISININ secmedigi durumda bunu fark etmeyebilirdi. */}
          {executionMode === "dry_run"
            ? <span className="pf-label pf-label--blue">Sadece kontrol — değişiklik yok</span>
            : <span className="pf-label pf-label--orange">Uygulanacak — değişiklik yapılır</span>}
        </div>
        {heavy && (
          <p className="mt-2 text-xs text-red-800">
            Etkilenecek cluster'lar: <span className="font-mono">{scope.clusters.join(", ")}</span>
          </p>
        )}
      </div>

      <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border-subtle)]">
        {picked.map((w) => {
          const to = action === "stop" ? 0 : action === "restore" ? w.previousReplicas : Number(targetReplicas);
          // GERI ALMADA hedef BILINMEYEBILIR: portal, durdururken uydurma bir sayi
          // yazmiyor (yanlis sayi geri almayi sessizce bozardi) — gercek deger
          // cluster'daki durum ConfigMap'inde. Bunu "?" ile gecistirmek, kullaniciyi
          // prod'da ne olacagini bilmeden onaylamaya birakirdi; ACIKCA yaziyoruz.
          const unknownTarget = action === "restore" && w.previousReplicas == null;
          return (
            // ANAHTAR CLUSTER'I DA ICERIR: ayni uygulama birden cok cluster'da
            // bulunabilir ve `key={w.name}` o satirlari cakistirirdi (React uyarisi +
            // ekranda ayni ad birden cok kez, farkli sayilarla, HANGI cluster oldugu
            // yazmadan — dogrulama ekraninda dogrudan yaniltici).
            <div key={`${w.cluster}/${w.name}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="font-mono truncate text-[var(--text-primary)]" title={w.name}>{w.name}</span>
                {multiCluster && (
                  <span className="font-mono truncate text-xs text-[var(--text-secondary)]" title={w.cluster}>{w.cluster}</span>
                )}
              </span>
              <span className="flex items-center gap-2 whitespace-nowrap text-[var(--text-muted)] tabular-nums">
                <span>
                  {w.specReplicas} → {unknownTarget ? "kayıtlı değer" : to}
                </span>
                {w.hasHpa && (
                  <span className="pf-label pf-label--gold">
                    {hpaPin ? "HPA sabitlenecek" : action === "stop" ? "HPA devre dışı kalacak" : "HPA devralabilir"}
                  </span>
                )}
                {w.gitops && <span className="pf-label pf-label--orange">GitOps</span>}
              </span>
            </div>
          );
        })}
      </div>

      {anyUnknownTarget && (
        <p className="text-xs text-[var(--text-secondary)]">
          "kayıtlı değer": geri alınacak replica sayısı, durdurma sırasında cluster'daki durum
          kaydına yazılan sayıdır ve iş çalışırken oradan okunur. Portal bu sayıyı kopyalamaz —
          kopyalasaydı, arada elle yapılmış bir değişiklik sessizce yanlış değere dönülmesine yol açardı.
        </p>
      )}

      {/* SINIR ONIZLEMEDE SOYLENIR. Sunucu bunu zaten hesaplayip yaniyla gonderiyordu ama
          ekran okumuyordu: kullanici sihirbazi sonuna kadar doldurup `Çalıştır`a basiyor ve
          ancak o zaman ham bir hata aliyordu. */}
      {r.exceedsMaxTargets && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          Bu seçim {r.targets} hedef üretiyor ve tek işlemde izin verilen sınırın üzerinde.
          Çalıştırma reddedilecek — kapsamı daraltın (daha az cluster ya da daha az uygulama).
        </p>
      )}

      {/* KAPI DURUMU. Kullanıcı ne isteneceğini ÖNCEDEN bilsin — ortada sürpriz olmasın. */}
      <div className="rounded-xl border border-[var(--border)] p-3 space-y-1.5 text-xs">
        <p className="flex items-center gap-1.5 text-[var(--text-secondary)]">
          <ShieldCheckIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0" />
          {g.oco === "require" && "OCO penceresi kontrol edilecek — numara istenecek."}
          {g.oco === "warn" && "Geri alma bir onarım işlemidir: OCO penceresi dışında da çalışır, ama gerekçe zorunlu."}
          {g.oco === "skip" && "OCO kontrolü yok — bu çalıştırma hiçbir şeyi değiştirmiyor."}
        </p>
        <p className="flex items-center gap-1.5 text-[var(--text-secondary)]">
          <CheckCircleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0" />
          {g.smart === "require" ? "SMART kaydı açılacak ve onay beklenecek." : "SMART kaydı açılmayacak."}
        </p>
        {/* METIN GERCEGI SOYLER. Eskiden "ikinci kişi onayı gerekiyor" yaziyordu ama
            sunucuda `requiresSecondPerson` HIC OKUNMUYOR — kullaniciya var olmayan bir
            guvenlik katmani vaat ediliyordu. Bu durumda gercekten devreye giren sey
            SMART onayidir (prod + apply → `policy.smart === 'require'`), ve onu zaten
            yukaridaki satir soyluyor. Burada yalnizca patlama yaricapini vurguluyoruz. */}
        {r.requiresSecondPerson && (
          <p className="flex items-center gap-1.5 text-[var(--text-secondary)]">
            <ClockIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0" />
            Prod ortamında birden fazla cluster etkileniyor — onay SMART kaydı üzerinden alınacak.
          </p>
        )}
        {picked.some((w) => w.gitops) && (
          <p className="flex items-start gap-1.5 text-amber-800">
            <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
            Seçilenlerden bazıları GitOps ile yönetiliyor — değişiklik birkaç dakika içinde
            otomatik senkronla geri alınabilir.
          </p>
        )}
        {hpaPin && (
          <p className="flex items-start gap-1.5 text-amber-800">
            <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
            HPA geçici olarak sabitlenecek; mevcut min/max saklanıp işlem bitince iade edilecek.
          </p>
        )}
        <p className="flex items-center gap-1.5 text-[var(--text-secondary)]">
          <ArrowUturnLeftIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0" />
          {action === "stop"
            ? "Geri alınabilir: EVET — her uygulamanın önceki replica sayısı cluster'da saklanacak."
            : action === "restore"
              ? "Bu zaten bir geri alma işlemi."
              : "Ölçekleme sonrası önceki değer sonuç raporunda görünür."}
        </p>
      </div>

      {g.oco === "require" && executionMode === "apply" && (
        <div>
          <label htmlFor="scalex-oco" className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">OCO numarası</label>
          <input id="scalex-oco" type="text" value={ocoNumber} disabled={busy} inputMode="numeric"
            onChange={(e) => setOcoNumber(e.target.value)} placeholder="1234567"
            className="w-56 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]
                       text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
        </div>
      )}

      {g.oco === "warn" && (
        <div>
          <label htmlFor="scalex-reason" className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
            Gerekçe (zorunlu)
          </label>
          <input id="scalex-reason" type="text" value={reason} disabled={busy}
            onChange={(e) => setReason(e.target.value)} placeholder="INC0042311 — ödeme servisi kesintisi"
            className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]
                       text-[var(--text-primary)] placeholder-[var(--text-muted)]
                       focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
          <p className="mt-1 text-xs text-[var(--text-muted)]">Gerekçe hem portal kaydına hem SMART talebine yazılır.</p>
        </div>
      )}

      {r.requiresWrittenConfirm && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <label htmlFor="scalex-written" className="block text-xs font-medium text-red-900 mb-1.5">
            Bu işlem {r.targets} hedefi etkiliyor ve ortam prod. Onaylamak için namespace adını yaz:
            {" "}<span className="font-mono">{scope.namespace}</span>
          </label>
          <input id="scalex-written" type="text" value={written} disabled={busy} autoComplete="off"
            onChange={(e) => setWritten(e.target.value)}
            /* `bg-white` DEGIL: uyum katmani onu bilerek eslemiyor (renkli zemin ustunde
               kullanilsin diye) ve koyu temada beyaz bir girdi kutusu okunamaz olurdu. */
            className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-red-300
                       bg-[var(--bg-surface)] text-[var(--text-primary)]
                       focus:outline-none focus:ring-2 focus:ring-red-400" />
        </div>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-[var(--border)] pt-4">
        {blockReason && (
          <span className="text-xs text-[var(--text-secondary)]" role="status">{blockReason}</span>
        )}
        <button type="button" className="btn-primary" disabled={busy || blocked || !writtenOk || !reasonOk || !ocoOk}
          onClick={() => onConfirm({
            ...(r.requiresWrittenConfirm ? { writtenConfirm: written.trim() } : {}),
            ...(reason.trim() ? { reason: reason.trim() } : {}),
            ...(ocoNumber.trim() ? { ocoNumber: ocoNumber.trim() } : {}),
          })}>
          {executionMode === "dry_run" ? "Kontrolü başlat" : "Çalıştır"}
        </button>
      </div>
    </div>
  );
};

export default PreviewStep;
