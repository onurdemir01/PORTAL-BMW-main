// src/components/common/CodeChip.tsx — uzun teknik degerler icin (yol, namespace,
// host, hash, sablon adi).
//
// NEDEN VAR — URETIMDE GORULEN TASMA: Ansible sayfasinda playbook yolu kartin DISINA
// tasiyordu (`bmw_cache_jobs/cache_cleaner_digital_channels/cache_cleaner.y` diye
// kesiliyordu). Sebep, `flex flex-wrap` icindeki bir `<span>`in TEK PARCA bir token
// olmasi: bosluk yok, tarayici satiri kiramiyor ve `flex-wrap` de kelimenin ICINDEN
// kiramaz. Kap `overflow-hidden` degilse metin disari tasar.
//
// KOK NEDEN `min-w-0`: flex/grid cocuklarinin varsayilan `min-width` degeri `auto`dur,
// yani "icerigimden kucuk olamam". Uzun bir token cocugu sisirir ve kap tasar.
// `min-w-0` bu kilidi acar; `overflow-hidden` ise SEMPTOMU gizler, sebebi degil.
//
// UC DAVRANIS SUNAR:
//   * wrap="break"   — deger sarar (kartlarda varsayilan; tam deger gorunur)
//   * wrap="truncate"— tek satir, sonu "…" (tablo hucrelerinde; satir yuksekligi sabit
//                      kalmali)
//   * copyable       — tiklayinca panoya kopyalar (kirpilmis hash'ler okunabilir ama
//                      kopyalanabilir DEGILDI)
//
// `title` HER ZAMAN doludur: kirpilan ya da saran deger fare ustunde tam okunur.
import React, { useState } from "react";
import { ClipboardDocumentIcon, CheckIcon } from "@heroicons/react/24/outline";

type Wrap = "break" | "truncate";

interface Props {
  value: string;
  /** Ekranda gosterilecek metin `value`dan farkliysa (or. kirpilmis hash). `title` ve
   *  kopyalama yine TAM `value` uzerinden calisir. */
  label?: string;
  wrap?: Wrap;
  copyable?: boolean;
  /** Ton: `default` notr, `accent` mavi (envanter/etiket), `muted` daha soluk. */
  tone?: "default" | "accent" | "muted";
  className?: string;
}

const TONE: Record<NonNullable<Props["tone"]>, string> = {
  default: "bg-[var(--bg-inset)] text-[var(--text-secondary)]",
  accent:  "bg-[var(--accent-bg)] text-[var(--accent)]",
  muted:   "bg-[var(--bg-elevated)] text-[var(--text-muted)]",
};

export function CodeChip({
  value, label, wrap = "break", copyable = false, tone = "default", className = "",
}: Props) {
  const [copied, setCopied] = useState(false);
  const text = label ?? value;

  // `min-w-0` KAP uzerinde de gerekli: chip bir flex cocuguysa kendisi de sisebilir.
  const base = `inline-flex items-center gap-1 min-w-0 max-w-full rounded px-2 py-0.5
                text-[10px] font-mono align-middle ${TONE[tone]} ${className}`;
  const textCls = wrap === "truncate" ? "truncate" : "break-all";

  if (!copyable) {
    return (
      <span className={base} title={value}>
        <span className={`min-w-0 ${textCls}`}>{text}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      title={`${value}\n(kopyalamak için tıklayın)`}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
          () => { /* pano izni yoksa sessizce gec — deger `title`da zaten var */ },
        );
      }}
      className={`${base} hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer`}
    >
      <span className={`min-w-0 ${textCls}`}>{text}</span>
      {copied
        ? <CheckIcon aria-hidden="true" className="w-3 h-3 flex-shrink-0 text-[var(--status-success)]" />
        : <ClipboardDocumentIcon aria-hidden="true" className="w-3 h-3 flex-shrink-0 opacity-50" />}
      <span className="sr-only">{copied ? "kopyalandı" : "panoya kopyala"}</span>
    </button>
  );
}

export default CodeChip;
