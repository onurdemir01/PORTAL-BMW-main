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
//
// LİSTE NEDEN PORTAL + `fixed` (2026-08-12 kullanıcı şikâyeti): liste önce `absolute z-20`
// ile açılıyordu ve alttaki bölümlerin üstüne binip okunamaz hâle geliyordu. Mutlak
// konumlanan bir liste, herhangi bir üst kutunun `overflow` kısıtına ya da yeni bir
// stacking context'ine (transform/animasyon/opacity) takıldığı anda kesiliyor veya altta
// kalıyor — ve bu, sihirbaz ekranlarına her yeni sarmalayıcı eklendiğinde yeniden olur.
// `createPortal` ile `document.body`'ye taşıyıp input'un ekran koordinatına göre `fixed`
// yerleştirmek bu sınıfın tamamını ortadan kaldırır: hiçbir ata düğüm listeyi kesemez.
// Konum scroll/resize'da yeniden hesaplanır; aşağıda yer yoksa liste YUKARI açılır.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const listRef = useRef<HTMLUListElement>(null);
  // Listenin ekran koordinatlari (position: fixed). `null` iken liste render edilmez —
  // ilk karede yanlis yerde bir kutu parlamasin.
  const [rect, setRect] = useState<{ left: number; top: number; width: number; maxHeight: number; drop: "down" | "up" } | null>(null);
  const listId = `${id || "sel"}-listbox`;

  // Konumu input'un GERCEK ekran dikdortgeninden hesaplar. Asagida 160px'den az yer varsa
  // liste yukari acilir (kisa ekranlarda liste ekran disina tasmasin).
  const place = React.useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const dropUp = below < 160 && above > below;
    setRect({
      left: r.left,
      top: dropUp ? r.top : r.bottom + 4,
      width: r.width,
      maxHeight: Math.max(120, Math.min(224, dropUp ? above : below)),
      drop: dropUp ? "up" : "down",
    });
  }, []);

  // Dışarı tıklama kapatır. Liste artık `document.body` altında (portal) olduğu için
  // "dışarısı" kontrolü HEM input kutusunu HEM listeyi hesaba katmalı — yoksa listeye
  // tıklamak menüyü kapatırdı.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
      setQuery("");
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Açıkken konumu canlı tut: sayfa kaydırıldığında ya da pencere yeniden boyutlandığında
  // liste input'a yapışık kalmalı. `capture: true` — kaydırma, iç içe bir kutuda da olabilir.
  useEffect(() => {
    if (!open) { setRect(null); return; }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

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

      {open && !disabled && !loading && rect && createPortal(
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          style={{
            position: "fixed",
            left: rect.left,
            width: rect.width,
            maxHeight: rect.maxHeight,
            // Yukari acilirken listeyi input'un USTUNE hizala (alt kenari input'a degsin).
            ...(rect.drop === "down" ? { top: rect.top } : { bottom: window.innerHeight - rect.top + 4 }),
            // Portal `body` altinda; uygulamadaki en yuksek katmanin (modal/masthead)
            // uzerinde kalmasi icin yuksek z-index.
            zIndex: 1000,
          }}
          className="overflow-y-auto border border-[var(--border)] rounded-xl bg-[var(--bg)] shadow-lg divide-y divide-[var(--border)]"
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
        </ul>,
        document.body,
      )}
    </div>
  );
};

export default SearchableSelect;
