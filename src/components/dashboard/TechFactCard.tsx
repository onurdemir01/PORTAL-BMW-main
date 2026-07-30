import React, { useState, useEffect, useCallback } from "react";
import {
  LightBulbIcon,
  SparklesIcon,
  WrenchScrewdriverIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { techFacts, getRandomTechFact, CATEGORY_LABELS, type TechFactCategory } from "@/data/techFacts";
import Badge from "@/components/common/Badge";

const CATEGORY_ICON: Record<TechFactCategory, React.ComponentType<{ className?: string }>> = {
  "efsane-gercek": ExclamationTriangleIcon,
  "az-bilinen": LightBulbIcon,
  "pratik-trick": WrenchScrewdriverIcon,
  "sik-sorun": SparklesIcon,
};

const CATEGORY_CLASSES: Record<TechFactCategory, string> = {
  "efsane-gercek": "bg-amber-50 text-amber-700",
  "az-bilinen": "bg-indigo-50 text-indigo-700",
  "pratik-trick": "bg-emerald-50 text-emerald-700",
  "sik-sorun": "bg-rose-50 text-rose-700",
};

// CSS'teki .animate-fact-progress (animations.css) ile AYNI süre — ikisi birlikte
// "bir sonraki otomatik yenilemeye kalan süre" hissini verir.
const AUTO_ROTATE_MS = 14_000;

// Dashboard her mount olduğunda (her açılışta) VE birkaç saniyede bir otomatik
// olarak farklı bir teknik bilgi göster — sabit/statik değil, sürekli yenilenen
// bir yapı hissi vermesi için. bkz. src/data/techFacts.ts (~125 girdi,
// JVM/K8s/Ansible/APM/network/log/AI).
export default function TechFactCard() {
  const [fact, setFact] = useState(() => getRandomTechFact());
  const [tick, setTick] = useState(0); // progress bar'ı her yenilemede yeniden başlatmak için
  const Icon = CATEGORY_ICON[fact.category];

  const reroll = useCallback(() => {
    setFact((prev) => (techFacts.length > 1 ? getRandomTechFact(prev.id) : prev));
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    const iv = setInterval(reroll, AUTO_ROTATE_MS);
    return () => clearInterval(iv);
  }, [reroll]);

  return (
    <div className="card p-5 animate-spring-in">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="h-8 w-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "var(--bg-elevated)", color: "var(--accent)" }}
          >
            <Icon className="w-4 h-4" />
          </span>
          <div>
            <Badge className={CATEGORY_CLASSES[fact.category]}>{CATEGORY_LABELS[fact.category]}</Badge>
          </div>
        </div>
        <button
          onClick={reroll}
          title="Başka bir bilgi göster"
          className="p-1.5 rounded-lg transition-colors flex-shrink-0"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
        >
          <ArrowPathIcon className="w-4 h-4" />
        </button>
      </div>
      <div key={fact.id} className="animate-fact-swap">
        <p className="text-sm font-bold mt-3" style={{ color: "var(--text-primary)" }}>
          {fact.title}
        </p>
        <p className="text-xs leading-relaxed mt-1.5" style={{ color: "var(--text-muted)" }}>
          {fact.body}
        </p>
      </div>
      <div className="h-0.5 rounded-full mt-4 overflow-hidden" style={{ background: "var(--bg-elevated)" }}>
        <div
          key={tick}
          className="h-full w-full rounded-full animate-fact-progress"
          style={{ background: "var(--accent)" }}
        />
      </div>
    </div>
  );
}
