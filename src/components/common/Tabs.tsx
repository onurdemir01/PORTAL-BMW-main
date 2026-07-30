import React, { useState, useEffect } from 'react';

interface Tab {
  label: string;
  content?: React.ReactNode;
  count?: number;
  id?: string;
}

interface TabsProps {
  tabs: Tab[];
  nested?: boolean;
  /** "pills" varyanti geriye donuk uyumluluk icin korunur; PF'de tum sekmeler
   *  ayni alt-cizgili gorunumu kullanir (yalniz olcu kucultulur). */
  variant?: "underline" | "pills";
  activeTab?: number;
  onChange?: (index: number) => void;
  size?: "md" | "sm";
}

// PatternFly Tabs: gri metin, aktif sekme mavi + 3px alt cizgi, kapsayici alt kenarlik.
const Tabs: React.FC<TabsProps> = ({ tabs, nested = false, variant = "underline", activeTab: controlledActive, onChange, size = "md" }) => {
  const [uncontrolledActive, setUncontrolledActive] = useState(0);
  const activeTab = controlledActive ?? uncontrolledActive;
  const setActiveTab = onChange ?? setUncontrolledActive;

  useEffect(() => {
    if (controlledActive === undefined && uncontrolledActive >= tabs.length) {
      setUncontrolledActive(0);
    }
  }, [tabs, controlledActive, uncontrolledActive]);

  const tabButtons = (small: boolean) => tabs.map((tab, index) => (
    <button
      key={tab.id ?? index}
      onClick={() => setActiveTab(index)}
      className={`pf-tab ${activeTab === index ? "is-active" : ""} ${small ? "px-3 py-2 text-[0.8125rem]" : ""}`}
      aria-selected={activeTab === index}
      role="tab"
    >
      {tab.label}
      {tab.count !== undefined && (
        <span
          className="ml-2 inline-flex items-center justify-center rounded-full px-2 text-[0.75rem]"
          style={{
            background: activeTab === index ? "var(--accent)" : "var(--border)",
            color: activeTab === index ? "#fff" : "var(--text-secondary)",
          }}
        >
          {tab.count}
        </span>
      )}
    </button>
  ));

  if (variant === "pills") {
    return <div className="pf-tabs" role="tablist">{tabButtons(size === "sm")}</div>;
  }

  if (nested) {
    return (
      <div>
        <div className="pf-tabs" role="tablist">{tabButtons(true)}</div>
        <div className="pt-4">{tabs[activeTab]?.content}</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="pf-tabs px-2" role="tablist">{tabButtons(false)}</div>
      <div className="p-6">{tabs[activeTab]?.content}</div>
    </div>
  );
};

export default Tabs;
