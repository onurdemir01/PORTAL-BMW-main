// src/components/oco/OcoOrtak.tsx — OCO Takvimi'nin LİSTE ve TAKVİM görünümlerinin ORTAK parçaları.
//
// NEDEN AYRI (2026-11-13, takvim yaprağı görünümü): takvimde bir OCO'ya tıklayınca listede
// açılan AYRINTININ aynısı görünmeli. Ayrıntı ve rozetler iki yerde kopyalansaydı biri
// güncellenip diğeri unutulurdu ("listede PCAB var, takvimde yok"). Liste DOM'u değişmedi:
// bu bileşenler sayfadaki eski işaretlemeyi birebir üretir.
import React from 'react';
import { fmtDate, fmtDateTime } from '@/utils/datetime';

export interface OcoRow {
  oco: number;
  subject: string;
  explanation: string;
  statusText: string;
  statusCode: number;
  impactText: string;
  processText: string;
  pcabRequired: boolean;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  openedAt: string | null;
  /** Hangi sorgudan geldi (2026-11-12): 'acan' = ekibin açtığı, 'sorumlu' = ekibe açılan. */
  iliski?: ('acan' | 'sorumlu')[];
}

export const DURUM_TON: Record<string, string> = {
  'Sorumlu Grup Açma Onayı': 'var(--status-info)',
  'Yönetici Onayı': 'var(--status-info)',
  'Değişiklik Yönetimi Kontrol Onayı': 'var(--status-warning)',
  'SRM Test ve Kapama Onayı': 'var(--status-success)',
};

export function Chip({
  children,
  tone,
  title,
}: {
  children: React.ReactNode;
  tone?: string;
  title?: string;
}) {
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap"
      style={{ color: tone || 'var(--text-muted)', borderColor: tone || 'var(--border-subtle)' }}
      title={title}
    >
      {children}
    </span>
  );
}

export function saat(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** OCO numarası DIŞINDAKİ rozetler (numara, kopyalama davranışıyla birlikte çağıran yerde). */
export function OcoRozetleri({ r, kapandi }: { r: OcoRow; kapandi: boolean }) {
  return (
    <>
      {r.iliski?.includes('acan') && (
        <Chip tone="var(--accent)" title="Ekibimizin açtığı OCO">açtığımız</Chip>
      )}
      {r.iliski?.includes('sorumlu') && (
        <Chip tone="var(--status-success)" title="Değişikliği yapacak sorumlu ekip biziz">
          bize açılan
        </Chip>
      )}
      {r.statusText && <Chip tone={DURUM_TON[r.statusText]}>{r.statusText}</Chip>}
      {r.impactText && <Chip>{r.impactText}</Chip>}
      {r.pcabRequired && <Chip tone="var(--status-warning)">PCAB</Chip>}
      {r.processText && r.processText !== 'Normal' && <Chip>{r.processText}</Chip>}
      {kapandi && (
        <Chip tone="var(--status-danger)" title="Planlanan bitiş saati geçti — pencere kapandı">
          penceresi kapandı
        </Chip>
      )}
    </>
  );
}

/** Satır açıldığında görünen ayrıntı (planlanan pencere, açılış, gerçekleşen, açıklama). */
export function OcoDetay({ r, className }: { r: OcoRow; className: string }) {
  return (
    <div className={className}>
      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Planlanan: {r.plannedStart ? fmtDateTime(r.plannedStart) : '—'}
        {' → '}
        {r.plannedEnd ? fmtDateTime(r.plannedEnd) : '—'}
        {r.openedAt && <> · açılış {fmtDate(r.openedAt)}</>}
        {/* GERCEKLESEN TARIH BOSSA "yapilmadi" DEMEK DEGIL: OCO kapanmadan bu
            alanlar dolmuyor. Bu yuzden yalnizca DOLU oldugunda yaziyoruz. */}
        {r.actualStart && <> · gerçekleşen {fmtDateTime(r.actualStart)}</>}
      </div>
      {r.explanation && (
        <pre
          className="text-[11px] whitespace-pre-wrap rounded-lg border p-2 max-h-60 overflow-auto"
          style={{
            borderColor: 'var(--border-subtle)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
          }}
        >
          {r.explanation}
        </pre>
      )}
    </div>
  );
}
