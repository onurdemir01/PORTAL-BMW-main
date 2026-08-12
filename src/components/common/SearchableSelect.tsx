// src/components/common/SearchableSelect.tsx — yaz → süzül → seç (combobox).
//
// NEDEN VAR (2026-08-12, kullanıcı isteği): OpsX/Telnet'te namespace düz bir `<select>`ti;
// bir ortamda yüzlerce namespace olunca listede aranan şeyi bulmak neredeyse imkânsızdı.
// Uygulama alanında ise AYRI bir arama kutusu + AYRI bir liste vardı — iki kontrol, tek iş.
// Burada tek kutu var: yazdıkça altındaki liste süzülür.
//
// SERBEST YAZIM (`allowFreeText`): namespace alanlarında bugün liste dışı değer yazılabiliyor
// (envanterde henüz görünmeyen yeni namespace için kaçış yolu) — o davranış KORUNUR.
// Uygulama alanında liste dışı değer kabul edilmiyor; orada bu bayrak `false` verilir ve
// bileşen yalnızca süzme yapar.
//
// Klavye: ↑/↓ gezinir, Enter seçer, Esc kapatır. Fare: dışarı tıklayınca kapanır.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlassIcon, ChevronUpDownIcon } from "@heroicons/react/24/outline";

interface Props {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  /** true ise listede olmayan bir değer de yazılıp kabul edilebilir (namespace alanları). */
  allowFreeText?: boolean;
  placeholder?: string;
  loading?: boolean;
  disabled?: boolean;
  /** Liste boşken gösterilecek metin (ör. "Bu ortamda kayıtlı namespace yok"). */
  emptyText?: string;
  id?: string;
}

const SearchableSelect: React.FC<Props> = ({
  options, value, onChange, allowFreeText = false, placeholder, loading, disabled, emptyText, id,
}) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = `${id || "sel"}-listbox`;

  // Dışarı tıklama kapatır. Kapanışta, serbest yazım YOKSA kutu seçili değere geri döner —
  // aksi halde ekranda kabul edilmemiş bir metin kalır ve kullanıcı onu seçili sanır.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => { setCursor(0); }, [query, open]);

  function commit(v: string) {
    onChange(v);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setCursor((c) => {
        const next = e.key === "ArrowDown" ? c + 1 : c - 1;
        if (next < 0) return filtered.length - 1;
        if (next >= filtered.length) return 0;
        return next;
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && filtered[cursor]) { commit(filtered[cursor]); return; }
      // Listede eşleşme yoksa: serbest yazıma izin verilen alanlarda yazılanı kabul et.
      if (allowFreeText && query.trim()) commit(query.trim());
      return;
    }
    if (e.key === "Escape") { setOpen(false); setQuery(""); }
  }

  // Kutuda ne yazıyor: açıkken kullanıcının yazdığı, kapalıyken seçili değer.
  const shown = open ? query : (value || "");

  return (
    <div ref={boxRef} className="relative">
      <MagnifyingGlassIcon aria-hidden="true" className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[cursor] ? `${listId}-${cursor}` : undefined}
        value={shown}
        disabled={disabled || loading}
        placeholder={loading ? "Yükleniyor…" : placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          // Serbest yazımlı alanda yazılan HER şey anında değer olur; kullanıcı listede
          // olmayan bir adı yazıp "Ekle" diyebilsin diye Enter'ı beklemeyiz.
          if (allowFreeText) onChange(e.target.value);
        }}
        onKeyDown={onKeyDown}
        className="w-full pl-9 pr-8 py-2.5 text-sm border border-[var(--border)] rounded-xl outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition font-mono disabled:opacity-50"
      />
      <ChevronUpDownIcon
        aria-hidden="true"
        className="w-4 h-4 text-[var(--text-muted)] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
      />

      {open && !disabled && !loading && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto border border-[var(--border)] rounded-xl bg-[var(--bg)] shadow-lg divide-y divide-[var(--border)]"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-[var(--text-muted)]">
              {options.length === 0
                ? (emptyText || "Liste boş.")
                : allowFreeText
                  ? "Eşleşme yok — yazdığınız değerle devam edebilirsiniz."
                  : "Eşleşme yok."}
            </li>
          ) : (
            filtered.map((opt, i) => (
              <li
                key={opt}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={opt === value}
                onMouseEnter={() => setCursor(i)}
                onMouseDown={(e) => { e.preventDefault(); commit(opt); }}
                className={`px-3 py-2 text-sm font-mono cursor-pointer ${
                  i === cursor ? "bg-[var(--bg-elevated)]" : ""
                } ${opt === value ? "text-[var(--accent)]" : "text-[var(--text-primary)]"}`}
              >
                {opt}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
};

export default SearchableSelect;
