// src/components/common/AnsibleLogTerminal.tsx — Canlı, animasyonlu Ansible/AWX log konsolu.
// Hem Self-Service çalıştırma modalı hem LogX v2 JobProgress tarafından paylaşılır.
//
// Animasyonlar: çalışırken üstte süzülen tarama parıltısı (term-scan), satır sonunda yanıp
// sönen imleç (caret), yeni çıktı geldiğinde kenar "flash"ı (term-flash), durum noktası nabzı
// (status-pulse), otomatik en-alta kaydırma ve durum-renkli çerçeve. Büyük loglar için satır
// başına ayrı DOM düğümü ÜRETMEZ (tek <pre>) — performanslı; canlılık container animasyonlarıyla.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ClipboardIcon, CheckIcon, MinusIcon, XMarkIcon } from "@heroicons/react/24/outline";

type Props = {
  output: string;
  status: string;                 // pending | waiting | running | successful | failed | error | canceled
  title?: string;
  elapsedSec?: number;
  /** Boşken (henüz çıktı yok) gösterilecek metin. */
  placeholder?: string;
  className?: string;
  /** "large" — sabit daha uzun gövde. "fill" — dış kapsayıcının (ör. elle
   * boyutlandırılan JobTrackerBar paneli) yüksekliğini birebir doldurur, kendi
   * max-h sınırı koymaz. Varsayılan "compact". */
  size?: "compact" | "large" | "fill";
  /** Verilirse başlık çubuğuna bir "küçült" butonu eklenir (bkz. JobTrackerBar.tsx). */
  onMinimize?: () => void;
  /** Verilirse başlık çubuğuna bir "kapat" butonu eklenir (bkz. JobTrackerBar.tsx). */
  onClose?: () => void;
  /** Verilirse başlık çubuğu bir sürükle-taşı tutamacı olur (bkz. JobTrackerBar.tsx —
   * kayan pencereyi başlıktan tutup taşımak için). Buton tıklamaları bundan etkilenmez. */
  onHeaderPointerDown?: (e: React.PointerEvent) => void;
};

const RUNNING = new Set(["pending", "waiting", "running", ""]);

function statusMeta(status: string): { label: string; color: string; dot: string } {
  switch (status) {
    case "successful": return { label: "başarılı", color: "#3fb950", dot: "#3fb950" };
    case "failed":
    case "error":      return { label: status === "error" ? "hata" : "başarısız", color: "#f85149", dot: "#f85149" };
    case "canceled":   return { label: "iptal edildi", color: "#d29922", dot: "#d29922" };
    case "running":    return { label: "çalışıyor", color: "#58a6ff", dot: "#58a6ff" };
    case "pending":
    case "waiting":    return { label: "kuyrukta", color: "#8b949e", dot: "#8b949e" };
    default:           return { label: "başlatılıyor", color: "#8b949e", dot: "#8b949e" };
  }
}

const AnsibleLogTerminal: React.FC<Props> = ({ output, status, title = "ansible-output", elapsedSec, placeholder = "Konsol çıktısı bekleniyor…", className = "", size = "compact", onMinimize, onClose, onHeaderPointerDown }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(0);
  const [flash, setFlash] = useState(false);
  const [copied, setCopied] = useState(false);

  const running = RUNNING.has(status);
  const meta = statusMeta(status);
  const lineCount = useMemo(() => (output ? output.split("\n").length : 0), [output]);

  // Yeni çıktı geldiğinde: KOŞULSUZ en alta kaydır (kullanıcı yukarı kaydırmış olsa
  // bile) — canlı log takibinde her zaman son satır görünsün istendi, "yakınsa takip
  // et" sezgisi burada istenmiyor.
  useLayoutEffect(() => {
    if (output.length > prevLenRef.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      if (prevLenRef.current > 0) { setFlash(true); }
    }
    prevLenRef.current = output.length;
  }, [output]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(false), 600);
    return () => window.clearTimeout(t);
  }, [flash]);

  async function copy() {
    try { await navigator.clipboard.writeText(output); setCopied(true); window.setTimeout(() => setCopied(false), 1400); } catch { /* yoksay */ }
  }

  return (
    <div
      className={`rounded-xl overflow-hidden border transition-shadow ${flash ? "animate-term-flash" : ""} ${size === "fill" ? "h-full flex flex-col" : ""} ${className}`}
      style={{ background: "#0d1117", borderColor: running ? `${meta.color}55` : "rgba(255,255,255,0.08)", boxShadow: running ? `0 0 0 1px ${meta.color}22, 0 8px 30px -12px ${meta.color}55` : undefined }}
    >
      {/* Başlık çubuğu — başlık + durum pili + satır sayısı + kopyala (+ varsa sürükle-taşı) */}
      <div
        onPointerDown={onHeaderPointerDown}
        className={`relative flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] ${onHeaderPointerDown ? "cursor-move select-none" : ""}`}
        style={{ background: "#060c17" }}
      >
        <span className="text-[11px] font-mono text-white/40 truncate">{title}</span>

        <div className="ml-auto flex items-center gap-3">
          {lineCount > 0 && <span className="text-[10px] font-mono text-white/30">{lineCount} satır</span>}
          {typeof elapsedSec === "number" && running && <span className="text-[10px] font-mono text-white/30">{elapsedSec}sn</span>}
          <span className="flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: meta.color }}>
            <span
              className={`w-1.5 h-1.5 rounded-full ${running ? "animate-status-pulse" : ""}`}
              style={{ background: meta.dot, color: meta.dot }}
            />
            {meta.label}
          </span>
          <button onClick={copy} onPointerDown={(e) => e.stopPropagation()} className="text-white/30 hover:text-white/70 transition-colors" title="Kopyala">
            {copied ? <CheckIcon className="w-3.5 h-3.5 text-emerald-400" /> : <ClipboardIcon className="w-3.5 h-3.5" />}
          </button>
          {onMinimize && (
            <button onClick={onMinimize} onPointerDown={(e) => e.stopPropagation()} className="text-white/30 hover:text-white/70 transition-colors" title="Küçült">
              <MinusIcon className="w-3.5 h-3.5" />
            </button>
          )}
          {onClose && (
            <button onClick={onClose} onPointerDown={(e) => e.stopPropagation()} className="text-white/30 hover:text-white/70 transition-colors" title="Kapat">
              <XMarkIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Çalışırken soldan sağa süzülen tarama parıltısı */}
        {running && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="animate-term-scan absolute top-0 bottom-0 w-1/3" style={{ background: `linear-gradient(90deg, transparent, ${meta.color}22, transparent)` }} />
          </div>
        )}
      </div>

      {/* Gövde — kaydırılabilir konsol */}
      <div
        ref={scrollRef}
        className={`relative overflow-auto min-h-[3.5rem] px-4 py-3 ${
          size === "fill" ? "flex-1 min-h-0" : size === "large" ? "max-h-[32rem]" : "max-h-72"
        }`}
      >
        {output ? (
          <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-words text-[#c9d1d9] m-0">
            {output}
            {running && <span className="animate-caret" style={{ color: meta.color }}>▋</span>}
          </pre>
        ) : (
          <div className="flex items-center gap-2 text-xs font-mono text-white/40 py-2">
            {running && (
              <span className="inline-flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: "300ms" }} />
              </span>
            )}
            {placeholder}
          </div>
        )}
      </div>
    </div>
  );
};

export default AnsibleLogTerminal;
