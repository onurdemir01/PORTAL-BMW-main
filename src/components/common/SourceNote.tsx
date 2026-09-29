// src/components/common/SourceNote.tsx — "Bu ekrandaki veri nereden geliyor?"
//
// NEDEN VAR
// ─────────
// Desen Nginx Hub'da doğdu (2026-09-22). Kullanıcının sorusu şuydu: *"nginx
// job'ları iyice karışmaya başladı; Nginx Hub'daki verilerin console_fetch'le
// bağlantısı var mı? Ben Nginx Audit job'ından çekiyorsun sanıyordum."*
//
// Aynı soru portalın her yerinde var ve cevabı hiçbir ekranda yazmıyor:
//   * LogX  — namespace listesi envanterden mi, canlı taramadan mı?
//   * ScaleX — cluster yetenekleri hangi taramayla doldu, ne zaman?
//   * Envanter — bu tabloyu hangi Ansible yükleyicisi yazıyor?
//   * Telnet — cluster kataloğu nereden geliyor?
//
// ── KATALOG BİLEŞENDE DEĞİL, MODÜLDE ────────────────────────────────────────
// Orijinal uygulama kaynak kataloğunu bileşenin İÇİNE gömmüştü (`SourceKey`
// birliği). Bu, bileşeni `nginx_console` klasörüne hapsediyordu: başka bir
// modül kullanmak istediğinde ya o birliği büyütmesi ya da kopyalaması
// gerekirdi. Burada kaynak **prop olarak** geliyor; her modül kendi gerçeğinin
// sahibi kalır.
//
// `nginx_console/SourceNote.tsx` BİLEREK DOKUNULMADAN bırakıldı (kapsam dışı,
// bkz. PR gövdesi). Geçici bir ikizlik; o ağaç kapsama girdiğinde tek çağrı
// değişikliğiyle buraya bağlanır.
import React from 'react';
import { InformationCircleIcon } from '@heroicons/react/24/outline';

export interface DataSource {
  /** Veriyi üreten iş/AWX template adı ya da "portal ayarı" gibi bir kaynak. */
  job: string;
  /** Somut olarak NE okunuyor (tablo/dizin adı dahil). */
  what: string;
  /** Kullanıcı tazelemek isterse NE yapmalı. */
  refresh: string;
}

interface Props {
  source: DataSource;
  /**
   * - `string`    → "son tarama <tarih>"
   * - `null`      → "tarama kaydı yok" (uyarı rengi) — VERİ YOK demek DEĞİL,
   *                 tarama DAMGASI yok demek; ikisini karıştırmak kullanıcıyı
   *                 olmayan bir sorunu kovalamaya yollar
   * - `undefined` → tarih hiç yazılmaz (ekranın kendi özetinde zaten var)
   */
  scanDate?: string | null;
  extra?: React.ReactNode;
}

export function SourceNote({ source, scanDate, extra }: Props) {
  return (
    <div
      className="flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px]"
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'var(--bg-elevated)',
        color: 'var(--text-muted)',
      }}
    >
      <InformationCircleIcon aria-hidden="true" className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
      <div>
        <b style={{ color: 'var(--text-secondary)' }}>Kaynak:</b>{' '}
        <span className="font-mono">{source.job}</span> — {source.what}
        {scanDate ? (
          <>
            {' '}· <b style={{ color: 'var(--text-secondary)' }}>son tarama {scanDate}</b>
          </>
        ) : scanDate === null ? (
          <>
            {' '}· <span style={{ color: 'var(--status-warning)' }}>tarama kaydı yok</span>
          </>
        ) : null}
        <span> · Tazelemek için: {source.refresh}</span>
        {extra ? <> · {extra}</> : null}
      </div>
    </div>
  );
}

export default SourceNote;
