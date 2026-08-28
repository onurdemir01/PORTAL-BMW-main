import React, { useEffect } from "react";
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/solid";
import { XMarkIcon as XMarkOutline } from "@heroicons/react/24/outline";
import { useToast, setGlobalToast, type ToastItem } from "@/hooks/useToast";

// PatternFly Alert (toast varyanti): beyaz kutu, ust kenarda 2px durum rengi,
// solda dolu durum ikonu. OpenShift Console'da toast'lar sag USTTE birikir.
const ICONS = {
  success: CheckCircleIcon,
  error:   ExclamationCircleIcon,
  info:    InformationCircleIcon,
  warning: ExclamationTriangleIcon,
};

const VARIANT_CLASS = {
  success: "pf-alert--success",
  error:   "pf-alert--danger",
  info:    "pf-alert--info",
  warning: "pf-alert--warning",
};

const ICON_COLOR = {
  success: "var(--status-success)",
  error:   "var(--status-danger)",
  info:    "var(--accent)",
  warning: "var(--status-warning)",
};

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const Icon = ICONS[item.type];
  return (
    <div
      className={`pf-alert ${VARIANT_CLASS[item.type]} w-80 max-w-full ${item.exiting ? "animate-toast-out" : "animate-toast-in"}`}
      /* Hatalar KESER (assertive), digerleri sirasini bekler (status/polite).
         Her bildirimi kesici yapmak, ekran okuyucu kullanicisinin okudugu cumleyi
         "kaydedildi" gibi onemsiz bir mesaj icin yarida birakmasi demektir. */
      role={item.type === "error" ? "alert" : "status"}
    >
      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: ICON_COLOR[item.type] }} />
      <p className="flex-1 leading-snug">{item.message}</p>
      <button
        onClick={() => onDismiss(item.id)}
        aria-label="Bildirimi kapat"
        className="flex-shrink-0 -mt-1 -mr-1 p-1"
        style={{ color: "var(--text-muted)" }}
      >
        <XMarkOutline className="w-4 h-4" />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, toast, dismiss } = useToast();

  useEffect(() => {
    setGlobalToast(toast);
  }, [toast]);

  // KAP HER ZAMAN DOM'DA (2026-08-28). Eskiden `toasts.length === 0` iken `null`
  // donuluyordu; yani canli bolge, ICINE mesaj eklenecegi ANDA olusuyordu. Ekran
  // okuyucular bir bolgeyi "canli" olarak izlemeye BASLAMAK icin onun DOM'da
  // ONCEDEN bulunmasini bekler — bu yuzden bildirimlerin cogu hic duyurulmuyordu.
  // Bos kap gorunmez (pointer-events yok, icerik yok) ama izlenebilir durumda.
  return (
    <div
      className="fixed right-4 z-[9999] flex flex-col gap-2 items-end pointer-events-none"
      style={{ top: "calc(var(--masthead-h) + 1rem)" }}
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((item) => (
        <div key={item.id} className="pointer-events-auto">
          <ToastCard item={item} onDismiss={dismiss} />
        </div>
      ))}
    </div>
  );
}
