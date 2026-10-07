// src/components/common/LoadError.tsx — "okunamadı" durumu: ne okunamadı, neden, tekrar dene.
//
// NEDEN VAR (2026-10-07): gerçek tarayıcı taramasında, API düştüğü halde boş-durum gösteren
// ekranlar çıktı — Dashboard "Kuyrukta iş yok", Ansible "AWX sunucusu bulunamadı, .env'e
// ekleyin", Admin "Henüz manuel rol ataması yok", "Henüz playbook kaydı yok". Hata ya hiç
// gösterilmiyor ya da üç saniyelik bir bildirimle kayboluyor, ekranda "yok" kalıyordu.
// "Okunamadı" ile "yok" AYRI şeylerdir: biri "tekrar dene / yöneticiye söyle", diğeri "ekle"
// demektir. Bu bileşen `EmptyState` ile aynı görsel ailedendir ama onun YERİNE gösterilir:
// boş-durum metni yalnızca yükleme BAŞARILIYSA çizilmelidir.
import React from 'react';
import { ExclamationTriangleIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

interface Props {
  /** NE okunamadı (ör. "Kullanıcı rolleri okunamadı"). */
  title: string;
  /** Sunucunun mesajı / hata metni. */
  message?: string | null;
  onRetry?: () => void;
  /** Yeniden deneme sürüyor: düğme kapanır. */
  retrying?: boolean;
  /** Satır içi kullanım (kart içi, tablo üstü) için dar biçim. */
  compact?: boolean;
  testId?: string;
}

export default function LoadError({ title, message, onRetry, retrying, compact, testId }: Props) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className={
        compact
          ? 'flex items-start gap-2 rounded-lg border px-3 py-2 text-left'
          : 'flex flex-col items-center text-center py-10 px-6'
      }
      style={
        compact
          ? { borderColor: 'var(--status-danger)', background: 'var(--status-danger-bg)' }
          : undefined
      }
    >
      <ExclamationTriangleIcon
        aria-hidden="true"
        className={compact ? 'w-4 h-4 flex-shrink-0 mt-0.5' : 'w-8 h-8 mb-3'}
        style={{ color: 'var(--status-danger)' }}
      />
      <div className={compact ? 'min-w-0 flex-1' : ''}>
        <p
          className={compact ? 'text-[0.8125rem] font-medium' : 'text-[1rem] font-medium'}
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </p>
        {message && (
          <p
            className={
              compact ? 'text-xs mt-0.5 break-words' : 'mt-1 max-w-md text-[0.875rem] break-words'
            }
            style={{ color: 'var(--status-danger-text)' }}
          >
            {message}
          </p>
        )}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className={
            compact ? 'btn-secondary flex-shrink-0 !py-1 !px-2.5 text-xs' : 'btn-secondary mt-4'
          }
        >
          <ArrowPathIcon
            aria-hidden="true"
            className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`}
          />
          Tekrar dene
        </button>
      )}
    </div>
  );
}
