import React from "react";
import {
  ServerStackIcon,
  DocumentMagnifyingGlassIcon,
  ChartBarIcon,
  WrenchScrewdriverIcon,
  SparklesIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";

const ORBIT_ITEMS = [
  // NOT: buradaki degerler HEX kalmali — asagida `${item.color}1a` ile
  // hex-alfa birlestirmesi yapiliyor, `var(--accent)1a` gecersiz CSS olurdu.
  { icon: ServerStackIcon, color: "#0066CC", label: "Envanter" },
  { icon: DocumentMagnifyingGlassIcon, color: "#a78bfa", label: "LogX" },
  { icon: ChartBarIcon, color: "#fb923c", label: "Performance" },
  { icon: WrenchScrewdriverIcon, color: "#34d399", label: "Self Service" },
  { icon: SparklesIcon, color: "#818cf8", label: "AI Analist" },
];

const RADIUS = 46; // merkeze göre yüzde (container'ın yarısına oranla)

// Saf CSS "orbit" görseli — halka döner (.animate-orbit-spin), her ikon
// TERS yönde döner (.animate-orbit-counter-spin) ki glyph dik kalsın.
// İkonun konumu (left/top) statiktir; yalnızca halkanın rotate'i onu daire
// üzerinde gezdirir — konum ve döndürme farklı DOM katmanlarında tutulur ki
// CSS transform'ları birbirini ezmesin.
export default function MissionOrbit() {
  return (
    <div className="card p-5 flex items-center gap-5 flex-wrap sm:flex-nowrap">
      <div className="relative flex-shrink-0" style={{ width: 132, height: 132 }}>
        <div className="absolute inset-0 animate-orbit-spin">
          {ORBIT_ITEMS.map((item, i) => {
            const angle = (360 / ORBIT_ITEMS.length) * i;
            const rad = (angle * Math.PI) / 180;
            const left = 50 + RADIUS * Math.sin(rad);
            const top = 50 - RADIUS * Math.cos(rad);
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className="absolute"
                style={{ left: `${left}%`, top: `${top}%`, transform: "translate(-50%, -50%)" }}
                title={item.label}
              >
                <div className="animate-orbit-counter-spin">
                  <span
                    className="flex items-center justify-center rounded-full"
                    style={{ width: 30, height: 30, background: `${item.color}1a`, border: `1px solid ${item.color}44` }}
                  >
                    <Icon className="w-4 h-4" style={{ color: item.color }} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        {/* Merkez — sabit, dönmez */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="h-14 w-14 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-dark))", boxShadow: "var(--shadow-md)" }}
          >
            <ShieldCheckIcon className="w-7 h-7 text-white" />
          </div>
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--accent)" }}>
          Bu Portal Ne İşe Yarar?
        </p>
        <p className="text-sm font-semibold mt-1 leading-snug" style={{ color: "var(--text-primary)" }}>
          Sunucu envanterini, log erişimini, performans/APM verisini ve otomasyonu (Ansible/AWX)
          tek merkezde birleştirir.
        </p>
        <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "var(--text-muted)" }}>
          AI Analist bu verileri birbirine bağlar, sorularınızı yanıtlar ve kayıtlı tanılama
          araçlarını sizin adınıza çalıştırır.
        </p>
      </div>
    </div>
  );
}
