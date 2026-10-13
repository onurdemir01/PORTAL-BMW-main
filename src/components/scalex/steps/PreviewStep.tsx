// src/components/scalex/steps/PreviewStep.tsx — "ne olacak" tek bakışta.
//
// `/preview` HİÇBİR ŞEY TETİKLEMEZ ve HİÇBİR ŞEY KAYDETMEZ; yalnızca hesaplar. Asıl
// karar `/run`da YENİDEN verilir (Self Service'in `ss/oco/validate` deseni) — bu ekran
// bir söz değil, bir tahmindir ve öyle davranılır.
import React, { useEffect, useState } from "react";
import {
  ExclamationTriangleIcon, CheckCircleIcon, ClockIcon, ShieldCheckIcon, ArrowUturnLeftIcon, NoSymbolIcon,
} from "@heroicons/react/24/outline";
import {
  scalexApi, type ScaleXAction, type ScaleXMode, type ScaleXPreview, type ScaleXScope, type ScaleXWorkload,
} from "@/api/scalexApi";
import { fmtDateTime, fmtRelative } from "@/utils/datetime";
import { humanSeconds } from "./OperationStep";

interface Props {
  scope: ScaleXScope;
  /**
   * Kullanıcının GERÇEKTEN seçtiği (cluster, uygulama) çiftleri.
   *
   * Boş bırakılırsa sunucu tam çarpımı varsayar — bugünkü davranış. Dolu ise
   * patlama yarıçapı, yazılı onay eşiği ve hedef tavanı bu sayıdan hesaplanır.
   */
  selectedTargets?: { cluster: string; name: string }[];
  action: ScaleXAction;
  executionMode: ScaleXMode;
  targetReplicas?: string;
  verificationTimeout: string;
  workloads: ScaleXWorkload[];
  hpaPin: boolean;
  /** `false` ise ön kontrol düşen hedef olduğunda HİÇBİR şey uygulanmaz. */
  allowPartial: boolean;
  mailCc: string;
  /** Keşif verisinin alındığı an; `null` ise satırlar aynadan türetilmiştir. */
  fetchedAt: number | null;
  busy: boolean;
  /** Artınca önizleme YENİDEN istenir (ör. çalıştırma reddedildi: kapı durumu değişmiş olabilir). */
  reloadKey?: number;
  onConfirm: (v: { writtenConfirm?: string; reason?: string; ocoNumber?: string }) => void;
}

const ACTION_LABEL: Record<ScaleXAction, string> = { stop: "DURDUR", restore: "GERİ AL", scale: "ÖLÇEKLE" };

type SmartDurumu = NonNullable<ScaleXPreview["gatePolicy"]["smartStatus"]>;

/**
 * SMART kapısının durumu. Eski bir sunucu `smartStatus` göndermez; o durumda `smart`
 * alanından türetilir (bugünkü iki cümle aynen çıkar).
 */
export function smartDurumu(g: ScaleXPreview["gatePolicy"]): SmartDurumu {
  if (g.smartStatus && g.smartStatus !== "unknown") return g.smartStatus;
  return g.smart === "require" ? "ready" : "not_applicable";
}

// KAPI SATIRI GERÇEĞİ SÖYLER (2026-10-13). Eskiden yalnızca iki cümle vardı: "SMART kaydı
// açılacak" / "açılmayacak". Üretimde ilki yazarken SMART hiç tanımlı değildi; kullanıcı
// OCO numarasını girdikten SONRA reddedildi.
const SMART_METNI: Record<SmartDurumu, string> = {
  ready: "SMART kaydı açılacak ve onay beklenecek.",
  not_configured: "SMART onayı gerekli ama ScaleX için tanımlı değil — değişiklik başlatılamaz.",
  disabled_by_admin: "SMART onayı bu ortamda KAPALI (yönetici ayarı) — SMART kaydı açılmayacak.",
  admin_skip: "Yönetici tercihiniz gereği SMART onayı atlanacak — SMART kaydı açılmayacak.",
  skipped_by_rule: "Bu işlem için SMART istisna kuralı tanımlı — SMART kaydı açılmayacak.",
  not_applicable: "SMART kaydı açılmayacak.",
  unknown: "SMART kaydı açılacak ve onay beklenecek.",
};
const SMART_ROZETI: Record<SmartDurumu, { metin: string; sinif: string }> = {
  ready: { metin: "SMART: onay beklenecek", sinif: "pf-label--blue" },
  not_configured: { metin: "SMART: tanımlı değil", sinif: "pf-label--red" },
  disabled_by_admin: { metin: "SMART: kapalı", sinif: "pf-label--orange" },
  admin_skip: { metin: "SMART: atlanıyor", sinif: "pf-label--orange" },
  skipped_by_rule: { metin: "SMART: istisna kuralı", sinif: "pf-label--orange" },
  not_applicable: { metin: "SMART: yok", sinif: "pf-label--grey" },
  unknown: { metin: "SMART: onay beklenecek", sinif: "pf-label--blue" },
};

const PreviewStep: React.FC<Props> = ({
  scope, selectedTargets, action, executionMode, targetReplicas, verificationTimeout, workloads, hpaPin,
  allowPartial, mailCc, fetchedAt, busy, reloadKey = 0, onConfirm,
}) => {
  // ÖNİZLEME HANGİ SEÇİME AİT? Seçim değişince yeni önizleme gelene kadar ekranda ESKİSİ
  // durur; onu "güncel" sayıp "Çalıştır"ı açık bırakmak, kullanıcıya başka bir seçimin
  // kapılarını göstererek onay aldırmak olurdu. Bu yüzden yanıt, istendiği anahtarla saklanır.
  const [yanit, setYanit] = useState<{ anahtar: string; preview: ScaleXPreview | null; hata: string | null } | null>(null);
  const [written, setWritten] = useState("");
  const [reason, setReason] = useState("");
  const [ocoNumber, setOcoNumber] = useState("");

  // HEDEF ANAHTARI: bağımlılık dizisinde nesne dizisi kullanılamaz (her render'da
  // yeni referans → sonsuz istek). Düz bir dizgeye indirgenir.
  const hedefAnahtari = (selectedTargets || []).map((t) => `${t.cluster}\u0000${t.name}`).sort().join("|");

  const istekAnahtari = [
    scope.env, scope.tenant, scope.namespace, scope.clusters.join(","), scope.apps?.join(","), hedefAnahtari,
    action, executionMode, targetReplicas ?? "", verificationTimeout, reloadKey,
  ].join("\u0001");

  useEffect(() => {
    let alive = true;
    scalexApi
      .preview({
        ...scope,
        action,
        executionMode,
        targetReplicas,
        verificationTimeout,
        // PR #123'te sunucu tarafı bağlanmış ama BU ÇAĞRI atlanmıştı: sunucu
        // `req.body.targets` okuyup gerçek sayıyı hesaplıyordu, istemci hiç
        // göndermiyordu. Sonuç: kullanıcı 12 hedeften 5'ini hariç tutsa bile
        // önizleme "12 hedef" diyor, gereksiz yazılı onay istiyor ve
        // çalıştırmayla ayrışıyordu.
        targets: selectedTargets,
      })
      .then((r) => {
        if (!alive) return;
        setYanit(r.ok
          ? { anahtar: istekAnahtari, preview: r, hata: null }
          : { anahtar: istekAnahtari, preview: null, hata: r.message || "Önizleme alınamadı." });
      })
      .catch((e) => alive && setYanit({ anahtar: istekAnahtari, preview: null, hata: (e as Error).message }));
    return () => { alive = false; };
    // `istekAnahtari` isteğin TÜM girdilerini taşır (kapsam, hedefler, işlem, kip, tazeleme).
  }, [istekAnahtari]);

  const guncel = yanit?.anahtar === istekAnahtari;
  // Hata yalnızca GÜNCEL isteğe aitse gösterilir: önceki seçimin hatası yeni seçimin
  // ekranında asılı kalmamalı (eskiden bir kez hata alınca adım kalıcı olarak hata gösteriyordu).
  if (guncel && yanit?.hata) {
    return (
      <div role="alert" className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
        <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{yanit.hata}</span>
      </div>
    );
  }
  const preview = yanit?.preview ?? null;
  if (!preview) return <div className="py-8 text-center text-sm text-[var(--text-muted)]">Önizleme hesaplanıyor…</div>;
  // Yeni seçimin önizlemesi yolda: eskisi SOLUK durur, onay düğmesi kapalıdır.
  const bayat = !guncel;

  const r = preview.blastRadius;
  const g = preview.gatePolicy;
  const smart = smartDurumu(g);
  // İŞ BAŞLATILAMAZ: sunucu aynı kararı `/run`da aynı metinle verir. Ekran bunu OCO
  // numarası İSTEMEDEN söyler — numarayı girip reddedilmek üretimde yaşanan olaydı.
  const engel = preview.configError?.message || (executionMode === "apply" ? g.blocked?.message : "") || "";
  // LISTE DE HARIC TUTULANLARI GOSTERMEMELI. Eskiden yalnizca `apps` ADINA
  // bakiliyordu, yani kullanicinin cikardigi cluster'daki satir listede kaliyordu.
  const haricKumesi = new Set((selectedTargets || []).map((t) => `${t.cluster}\u0000${t.name}`));
  const picked = workloads.filter(
    (w) =>
      (scope.apps || []).includes(w.name) &&
      (haricKumesi.size === 0 || haricKumesi.has(`${w.cluster}\u0000${w.name}`)),
  );
  // Satirlarin hepsi CANLI kesiften mi geliyor? Panelden/sonuctan gelen kisayol
  // yolunda satirlar AYNADAN turetiliyor ve replica/imaj alanlari UYDURMA olur —
  // o durumda canli ayrinti gosterilmez.
  const live = picked.length > 0 && picked.every((w) => w.source === "discovery");
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
  const blocked = r.exceedsMaxTargets || !!engel;
  // BUTON NEDEN PASIF? Sessizce olu bir buton, namespace'i bir harf yanlis yazan
  // kullaniciyi hicbir geri bildirim olmadan birakiyordu.
  const blockReason = engel
    ? "Bu işlem şu an başlatılamaz — nedeni yukarıda."
    : bayat ? "Önizleme güncelleniyor…"
    : r.exceedsMaxTargets
    ? "Hedef sayısı sınırın üzerinde — kapsamı daraltın."
    : !writtenOk
      ? (written.trim() ? "Yazdığınız namespace adı eşleşmiyor." : "Onaylamak için namespace adını yazın.")
      : !reasonOk ? "Gerekçe zorunlu."
      : !ocoOk ? "OCO numarası zorunlu."
      : "";

  return (
    <div className={`space-y-4 transition-opacity ${bayat ? "opacity-60" : ""}`} aria-busy={bayat}>
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
            <div key={`${w.cluster}/${w.name}`} className="px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="font-mono truncate text-[var(--text-primary)]" title={w.name}>{w.name}</span>
                {multiCluster && (
                  <span className="font-mono truncate text-xs text-[var(--text-secondary)]" title={w.cluster}>{w.cluster}</span>
                )}
                {/* WORKLOAD TIPI: ayni ada sahip bir Deployment ile DeploymentConfig
                    farkli seylerdir; kullanici NEYE dokundugunu onaylamadan once
                    gormeli. */}
                {w.kind && w.kind !== "-" && <span className="pf-label pf-label--grey">{w.kind}</span>}
              </span>
              <span className="flex items-center gap-2 whitespace-nowrap text-[var(--text-muted)] tabular-nums">
                <span>
                  {live ? w.specReplicas : "?"} → {unknownTarget ? "kayıtlı değer" : to}
                </span>
                {w.hasHpa && (
                  <span className="pf-label pf-label--gold">
                    {hpaPin ? "HPA sabitlenecek" : action === "stop" ? "HPA devre dışı kalacak" : "HPA devralabilir"}
                  </span>
                )}
                {w.gitops && <span className="pf-label pf-label--orange">GitOps</span>}
              </span>
              </div>

              {/* CANLI AYRINTI — YALNIZCA KESIFTEN GELEN satirlarda.
                  Panelden/sonuctan gelen sentetik satirlarda bu alanlar 0/null'dur
                  (aynadan turetildiler, kesiften degil); gostermek prod'da tek tikla
                  apply'a giden akista UYDURULMUS bir gerceklik sunmak olurdu. */}
              {live && (
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--text-muted)]">
                  <span className="tabular-nums">hazır {w.readyReplicas}/{w.statusReplicas}</span>
                  {/* "Zaten durdurulmus" YALNIZCA `stop` dalinda anlamli: bir GERI ALMA
                      onizlemesinde bu rozet kullaniciya yanlis islem yaptigini
                      dusundururdu. */}
                  {action === "stop" && w.statePhase === "scaled_down" && (
                    <span className="pf-label pf-label--blue">zaten durdurulmuş</span>
                  )}
                  {w.image && (
                    <span className="font-mono truncate max-w-[22rem]" title={w.image}>{w.image}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* CALISTIRMA AYARLARI ONIZLEMEDE. Bu uc deger `İşlem` adiminda toplaniyor ve
          dogrudan calistirmaya gidiyordu ama onizlemede HIC gorunmuyordu — kullanici
          "hepsi ya da hicbiri" kararini ve rapor adreslerini onaylamadan once
          dogrulayamiyordu. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
        <span>
          Ön kontrol düşerse:{" "}
          <strong className="text-[var(--text-secondary)]">
            {allowPartial ? "geçen hedefler uygulanır" : "hiçbir şey uygulanmaz"}
          </strong>
        </span>
        <span>Sonuç kontrolü: <strong className="text-[var(--text-secondary)]">{verificationTimeout} sn{humanSeconds(verificationTimeout) ? ` (${humanSeconds(verificationTimeout)})` : ''}</strong></span>
        {mailCc && <span className="truncate max-w-[20rem]" title={mailCc}>Rapor CC: {mailCc}</span>}
        {/* VERI TAZELIGI: kesif `Uygulamalar` adiminda donuyor ve onizleme yeniden
            kesif YAPMIYOR. Damgayi gostermemek, dakikalar once alinmis bir replica
            sayisini "su anki durum" sanmaya yol acardi. */}
        {live && fetchedAt && (
          <span title={fmtDateTime(new Date(fetchedAt).toISOString())}>
            Veriler {fmtRelative(new Date(fetchedAt).toISOString())} alındı
          </span>
        )}
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

      {/* İŞ BAŞLATILAMAZ — kapı satırlarından ÖNCE ve OCO alanı ÇİZİLMEDEN. */}
      {engel && (
        <div role="alert" data-testid="scalex-engel"
          className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <NoSymbolIcon aria-hidden="true" className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">Bu işlem şu an başlatılamaz</p>
            <p className="text-xs">{engel}</p>
            {g.smartMissing && g.smartMissing.length > 0 && !preview.configError && (
              <ul className="list-disc pl-4 text-xs">
                {g.smartMissing.map((m) => <li key={m}>{m}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* KAPI DURUMU. Kullanıcı ne isteneceğini ÖNCEDEN bilsin — ortada sürpriz olmasın. */}
      <div className="rounded-xl border border-[var(--border)] p-3 space-y-1.5 text-xs">
        {executionMode === "apply" && (
          <p className="flex flex-wrap items-center gap-1.5" data-testid="scalex-kapi-rozetleri">
            <span className={`pf-label ${g.oco === "require" ? "pf-label--blue" : g.ocoGateDisabled ? "pf-label--red" : "pf-label--grey"}`}>
              {g.oco === "require" ? "OCO: numara istenecek" : g.oco === "warn" ? "OCO: gerekçe yeterli" : g.ocoGateDisabled ? "OCO: kapalı" : "OCO: yok"}
            </span>
            <span className={`pf-label ${SMART_ROZETI[smart].sinif}`}>{SMART_ROZETI[smart].metin}</span>
          </p>
        )}
        <p className="flex items-center gap-1.5 text-[var(--text-secondary)]">
          <ShieldCheckIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0" />
          {g.oco === "require" && "OCO penceresi kontrol edilecek — numara istenecek."}
          {g.oco === "warn" && "Geri alma bir onarım işlemidir: OCO penceresi dışında da çalışır, ama gerekçe zorunlu."}
          {g.oco === "skip" && (executionMode === "apply"
            ? "OCO kontrolü yok."
            : "OCO kontrolü yok — bu çalıştırma hiçbir şeyi değiştirmiyor.")}
        </p>
        <p className={`flex items-start gap-1.5 ${smart === "not_configured" ? "text-red-800" : smart === "disabled_by_admin" || smart === "admin_skip" || smart === "skipped_by_rule" ? "text-amber-800" : "text-[var(--text-secondary)]"}`}>
          <CheckCircleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-px" />
          <span>
            {SMART_METNI[smart]}
            {smart === "skipped_by_rule" && g.smartSkipRule && (
              <> (<span className="font-mono">{g.smartSkipRule.field}: {g.smartSkipRule.value}</span>)</>
            )}
            {(smart === "disabled_by_admin" || smart === "admin_skip" || smart === "skipped_by_rule") &&
              " İşlem denetime ayrıca yazılır."}
          </span>
        </p>
        {/* METIN GERCEGI SOYLER. Eskiden "ikinci kişi onayı gerekiyor" yaziyordu ama
            sunucuda `requiresSecondPerson` HIC OKUNMUYOR — kullaniciya var olmayan bir
            guvenlik katmani vaat ediliyordu. Bu durumda gercekten devreye giren sey
            SMART onayidir (prod + apply → `policy.smart === 'require'`), ve onu zaten
            yukaridaki satir soyluyor. Burada yalnizca patlama yaricapini vurguluyoruz. */}
        {r.requiresSecondPerson && (
          <p className="flex items-center gap-1.5 text-[var(--text-secondary)]">
            <ClockIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0" />
            {smart === "ready"
              ? "Prod ortamında birden fazla cluster etkileniyor — onay SMART kaydı üzerinden alınacak."
              : "Prod ortamında birden fazla cluster etkileniyor."}
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

      {/* KAPALI KAPI GORUNUR OLUR. `oco: "skip"` tek basina yetmez: "prod degil"
          ile "prod ama kapi kapali" ekranda AYNI gorunurdu. */}
      {g.ocoGateDisabled && executionMode === "apply" && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            <strong>OCO kapısı bu ortamda KAPALI.</strong> Bu bir production işlemi ama
            değişiklik kaydı sorulmayacak. Kapıyı admin kapattı (Admin &gt; Otomasyon &gt;
            ScaleX Yönetimi &gt; SMART / OCO ayarları). Çalıştırma denetime{" "}
            <code>scalex_oco_gate_disabled</code> olarak yazılır.
          </span>
        </div>
      )}

      {g.oco === "require" && executionMode === "apply" && !engel && (
        <div>
          <label htmlFor="scalex-oco" className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">OCO numarası</label>
          <input id="scalex-oco" type="text" value={ocoNumber} disabled={busy} inputMode="numeric"
            onChange={(e) => setOcoNumber(e.target.value)} placeholder="1234567"
            className="w-56 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]
                       text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
        </div>
      )}

      {g.oco === "warn" && !engel && (
        <div>
          <label htmlFor="scalex-reason" className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
            Gerekçe (zorunlu)
          </label>
          <input id="scalex-reason" type="text" value={reason} disabled={busy}
            onChange={(e) => setReason(e.target.value)} placeholder="INC0042311 — ödeme servisi kesintisi"
            className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]
                       text-[var(--text-primary)] placeholder-[var(--text-muted)]
                       focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {smart === "ready" ? "Gerekçe hem portal kaydına hem SMART talebine yazılır." : "Gerekçe portal kaydına ve denetime yazılır."}
          </p>
        </div>
      )}

      {r.requiresWrittenConfirm && !engel && (
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
        <button type="button" className="btn-primary" disabled={busy || bayat || blocked || !writtenOk || !reasonOk || !ocoOk}
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
