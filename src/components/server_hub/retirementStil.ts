// src/components/server_hub/retirementStil.ts — Retirement ekranlarinin ortak gorsel dili (2026-10-26).
//
// Ton = anlam; her tonun dort alani var: renk (yalniz nokta / ikon / kenar), zemin, METIN, kenar.
// Metin HER ZAMAN `metin` alanindan: --status-warning / --status-danger beyaz zeminde AA altinda
// (tema-kontrast TK2), metin icin -text tokenlari. Tanimsiz tokenlar (--accent-fg, --status-ok)
// ve sabit hex yok: koyu temada "Retirement'i baslat" 1.45:1'e dusuyordu.
import type React from 'react';

export type Ton = 'notr' | 'bilgi' | 'aksan' | 'uyari' | 'basari' | 'hata';
const kenar = (v: string) => `color-mix(in srgb, ${v} 32%, transparent)`;
export const TON: Record<Ton, { renk: string; zemin: string; metin: string; kenar: string }> = {
  notr: { renk: 'var(--status-neutral)', zemin: 'var(--status-neutral-bg)', metin: 'var(--text-secondary)', kenar: 'var(--border)' },
  bilgi: { renk: 'var(--status-info)', zemin: 'var(--status-info-bg)', metin: 'var(--status-info)', kenar: kenar('var(--status-info)') },
  aksan: { renk: 'var(--accent)', zemin: 'var(--accent-bg)', metin: 'var(--accent)', kenar: kenar('var(--accent)') },
  uyari: { renk: 'var(--status-warning)', zemin: 'var(--status-warning-bg)', metin: 'var(--status-warning-text)', kenar: kenar('var(--status-warning)') },
  basari: { renk: 'var(--status-success)', zemin: 'var(--status-success-bg)', metin: 'var(--status-success)', kenar: kenar('var(--status-success)') },
  hata: { renk: 'var(--status-danger)', zemin: 'var(--status-danger-bg)', metin: 'var(--status-danger-text)', kenar: kenar('var(--status-danger)') },
};

/** Web (vhost) adiminin durumu; `oncelik` en kotu girdiyi secer. Bilinmeyen: { etiket: status, ton: 'notr', oncelik: 3 }. */
export const WEB_DURUM: Record<string, { etiket: string; ton: Ton; oncelik: number; canli?: boolean }> = {
  failed: { etiket: 'BAŞARISIZ', ton: 'hata', oncelik: 9 },
  restore_failed: { etiket: 'geri açma BAŞARISIZ', ton: 'hata', oncelik: 9 },
  manual: { etiket: 'elle yapılmalı', ton: 'uyari', oncelik: 7 },
  restore_manual: { etiket: 'elle geri açılmalı', ton: 'uyari', oncelik: 7 },
  running: { etiket: 'kaldırılıyor', ton: 'aksan', oncelik: 5, canli: true },
  restoring: { etiket: 'geri açılıyor', ton: 'aksan', oncelik: 5, canli: true },
  pending: { etiket: 'sırada', ton: 'notr', oncelik: 4 },
  skip: { etiket: 'yapılacak şey yoktu', ton: 'notr', oncelik: 2 },
  ok: { etiket: 'kaldırıldı', ton: 'basari', oncelik: 1 },
  restored: { etiket: 'geri açıldı', ton: 'basari', oncelik: 1 },
};
/** AWX isinin ekran durumu (is ciktisi listesi). */
export const IS_DURUM: Record<string, { etiket: string; ton: Ton; canli?: boolean }> = {
  suruyor: { etiket: 'sürüyor', ton: 'aksan', canli: true },
  basarili: { etiket: 'başarılı', ton: 'basari' },
  basarisiz: { etiket: 'başarısız', ton: 'hata' },
  iptal: { etiket: 'iptal edildi', ton: 'uyari' },
  bilinmiyor: { etiket: 'durum bilinmiyor', ton: 'notr' },
};

// outline-offset-2 ONEMLI (!): index.css'teki katmansiz `:focus-visible { outline-offset: 1px }` katmanli
// Tailwind sinifini ezer; halka aksan dolgulu dugmeye yapisik gorunuyordu (denetim B6).
export const SM_BTN = 'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';
/** Tablo ici dugme (24px). */
export const TBL_BTN = 'inline-flex items-center gap-1 h-6 px-2 text-[11px] font-medium leading-none rounded-md border whitespace-nowrap transition-[filter] duration-150 hover:brightness-95 active:brightness-90 focus-visible:outline-offset-2! disabled:opacity-40 disabled:hover:brightness-100';
/** Bag gorunumlu ikincil eylem. */
export const LINK = 'inline-flex items-center gap-1 rounded-sm text-[11px] font-medium leading-4 underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-offset-2! disabled:opacity-40 disabled:no-underline';
// Birincil dalin metni --text-on-accent (acikta #fff, koyuda koyu); eskiden tanimsiz --accent-fg -> #fff idi.
export const smBtn = (primary = false): React.CSSProperties => (primary
  ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--text-on-accent)' }
  : { borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' });
export const BTN_TEHLIKE: React.CSSProperties = { background: 'var(--status-danger)', borderColor: 'var(--status-danger)', color: 'var(--text-on-accent)' };
export const BTN_BASARI: React.CSSProperties = { background: 'var(--status-success)', borderColor: 'var(--status-success)', color: 'var(--text-on-accent)' };
export const BTN_BASARI_IKINCIL: React.CSSProperties = { background: 'var(--bg-surface)', borderColor: 'var(--status-success)', color: 'var(--status-success)' };
// Sari dolgulu dugme yok: sari zemin uzerinde hicbir metin tokeni AA vermiyor.
export const BTN_UYARI: React.CSSProperties = { background: 'var(--bg-surface)', borderColor: 'var(--status-warning)', color: 'var(--status-warning-text)' };
export const SECILI_ZEMIN = 'color-mix(in srgb, var(--accent) 5%, var(--bg-surface))';
export const ACIK_ZEMIN = 'color-mix(in srgb, var(--accent) 4%, var(--bg-surface))';
// `thead th` kurali katmansiz (index.css): renk, agirlik ve yazi tipi yalniz satir ici stille gecer.
export const TH_STIL: React.CSSProperties = { fontFamily: 'var(--font-sans)', fontWeight: 600, color: 'var(--text-secondary)', background: 'var(--bg-elevated)', boxShadow: 'inset 0 -1px 0 var(--border)' };
