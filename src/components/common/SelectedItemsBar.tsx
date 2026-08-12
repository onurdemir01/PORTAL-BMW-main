// src/components/common/SelectedItemsBar.tsx — sihirbazların üstünde duran "sepet" şeridi.
//
// NEDEN ADIM DEĞİL ŞERİT (2026-08-10, kullanıcı kararı): LogX'te önceden "Listeye Ekle"
// sonrası AYRI bir "Toplanacak Uygulamalar" ekranına düşülüyordu; yeni bir namespace
// eklemek için oradan geri gelmek gerekiyordu. Şerit hem seçim hem sonuç ekranının
// ÜSTÜNDE durunca kullanıcı ekle → seç → ekle döngüsünü ekran değiştirmeden sürdürüyor
// ve ne topladığını her an görüyor.
//
// NEDEN ORTAK (2026-08-12): aynı ihtiyaç LogX, OpsX ve Telnet'te üç ayrı biçimde
// çözülmüştü (LogX'te şerit, OpsX/Telnet'te adım içi küçük listeler). Bileşen artık
// alan-bağımsız: çağıran, öğelerini `groups` olarak verir.
//
// DÜZELTME MODELİ (kullanıcı kararı): çıkar + yeniden ekle. Çipe tıklayıp "düzenleme
// moduna" girmek daha akıcı görünüyordu ama taşınacak bir "düzenleniyor" durumu ve onunla
// gelen hata yüzeyi doğuruyordu.
import React from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";

export interface SelectedItem {
  /** Kararlı kimlik — çıkarma bunun üzerinden yapılır (indis DEĞİL: liste değişince kayar). */
  id: string;
  label: string;
  /** Satırda çipin yanında gösterilecek küçük rozetler (ör. cluster adı). */
  badges?: string[];
}

export interface SelectedGroup {
  /** Grup başlığı — genelde namespace. Boşsa başlık satırı hiç render edilmez. */
  title?: string;
  items: SelectedItem[];
}

interface Props {
  groups: SelectedGroup[];
  /** Tek çalıştırmada izin verilen azami öğe — sunucu da aynı sınırı uygular. */
  max?: number;
  busy?: boolean;
  /** Ana eylem butonunun metni; sonuna "(n)" eklenir. */
  submitLabel: string;
  /** Şeridin başlığı — ör. "Toplanacak", "Çalıştırılacak". */
  title?: string;
  onRemove: (id: string) => void;
  onClear: () => void;
  onSubmit: () => void;
}

const SelectedItemsBar: React.FC<Props> = ({
  groups, max, busy, submitLabel, title = "Seçilenler", onRemove, onClear, onSubmit,
}) => {
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  // Sepet boşken hiç yer kaplamaz — kullanıcı henüz bir şey toplamadıysa gösterecek bir şey yok.
  if (total === 0) return null;

  return (
    <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--bg-elevated)] p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--text-primary)]">
          {title} · {total}
          {typeof max === "number" && <span className="ml-1 font-normal text-[var(--text-muted)]">/ {max}</span>}
        </span>
        <button
          onClick={onClear}
          disabled={busy}
          className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline underline-offset-2 disabled:opacity-50"
        >
          Tümünü temizle
        </button>
      </div>

      <div className="max-h-40 overflow-y-auto space-y-1.5">
        {groups.map((group, gi) => (
          <div key={group.title ?? `g${gi}`}>
            {group.title && (
              <p className="text-[11px] font-mono text-[var(--text-muted)] truncate">{group.title}</p>
            )}
            <div className="flex flex-wrap gap-1.5 mt-0.5">
              {group.items.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full border border-[var(--border)] bg-[var(--bg)] text-[11px] font-mono text-[var(--text-primary)]"
                >
                  {item.label}
                  {(item.badges || []).map((b) => (
                    <span
                      key={b}
                      className="px-1 rounded-full bg-[var(--bg-elevated)] border border-[var(--border)] text-[10px] text-[var(--text-secondary)]"
                    >
                      {b}
                    </span>
                  ))}
                  <button
                    onClick={() => onRemove(item.id)}
                    disabled={busy}
                    aria-label={`${item.label} öğesini listeden çıkar`}
                    title="Listeden çıkar"
                    className="p-0.5 rounded-full text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50 transition disabled:opacity-50 disabled:pointer-events-none"
                  >
                    <XMarkIcon className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button onClick={onSubmit} disabled={busy} className="btn-primary w-full">
        {busy ? "Başlatılıyor…" : `${submitLabel} (${total})`}
      </button>
    </div>
  );
};

export default SelectedItemsBar;
