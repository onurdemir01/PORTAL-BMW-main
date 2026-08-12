// src/components/common/FilterableList.tsx — arama kutusu + süzülmüş, kaydırılabilir liste.
//
// NEDEN VAR (2026-08-12, kullanıcı isteği): namespace düz bir `<select>`ti; bir ortamda
// yüzlerce namespace olunca aranan şeyi bulmak neredeyse imkânsızdı. Uygulama alanında
// arama vardı ama liste `<select size>` olduğu için eşleşen metin görsel olarak
// ayırt edilemiyordu ve liste 3-6 satırla sınırlıydı.
//
// ÜÇ ŞEY EKLER: arama, eşleşen metnin VURGULANMASI, ve daha uzun bir liste.
//
// AKIŞ İÇİNDE AÇILIR — BİLEREK: liste mutlak konumlu bir açılır menü DEĞİL, normal
// akışta duran bir kutudur. Önceki denemede mutlak konumlu liste alttaki bölümlerin
// üstüne binip okunamaz hâle gelmişti; burada hiçbir şeyin üstüne binmez, kendi yerini
// kaplar ve altındaki içerik aşağı iner.
import React, { useMemo, useState } from "react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";

interface Props {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Liste yüksekliği (Tailwind sınıfı). Varsayılan ~10 satır. */
  maxHeightClass?: string;
  emptyText?: string;
}

// Eşleşen parçayı vurgular. Arama boşsa metin olduğu gibi döner.
function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <span className="bg-[var(--accent)]/20 text-[var(--text-primary)] font-semibold rounded-sm">
        {text.slice(i, i + q.length)}
      </span>
      {text.slice(i + q.length)}
    </>
  );
}

const FilterableList: React.FC<Props> = ({
  options, value, onChange, placeholder = "Ara…", maxHeightClass = "max-h-64", emptyText,
}) => {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, search]);

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <MagnifyingGlassIcon aria-hidden="true" className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-8 pr-3 py-1.5 text-xs border border-[var(--border)] rounded-lg outline-none focus:border-[var(--accent)] transition"
        />
      </div>

      <div className={`${maxHeightClass} overflow-y-auto border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]`}>
        {filtered.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] text-center py-4">
            {options.length === 0 ? (emptyText || "Liste boş.") : "Eşleşme yok."}
          </p>
        ) : (
          filtered.map((opt) => (
            <button
              key={opt}
              onClick={() => onChange(opt)}
              className={`w-full text-left px-3 py-2 text-sm font-mono transition-colors hover:bg-[var(--bg-elevated)] ${
                opt === value ? "bg-[var(--bg-elevated)] text-[var(--accent)]" : "text-[var(--text-primary)]"
              }`}
            >
              {highlight(opt, search)}
            </button>
          ))
        )}
      </div>

      {search.trim() && (
        <p className="text-[10px] text-[var(--text-muted)]">
          {filtered.length} / {options.length} sonuç
        </p>
      )}
    </div>
  );
};

export default FilterableList;
