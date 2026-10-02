// src/components/SessionTimeoutModal.tsx — oturum bitmeden once uyari.
//
// 2026-10-02 (Faz B): sure SUNUCUNUN bitis zamanidir (sessionClock). "Surdur" sunucuda
// uzatir. Pencereyi kapatmak (X / Esc / arka plan) artik sureyi UZATMAZ — eskiden
// `onClose={onExtend}` idi ve yalnizca istemci sayacini sifirliyordu, sunucu habersizdi.
// Sinir MUTLAK sure ise uzatmak ise yaramaz: "Surdur" gosterilmez, bu acikca soylenir.
import React from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { Modal } from '@/components/common/Modal';

interface SessionTimeoutModalProps {
  isOpen: boolean;
  countdown: number;
  extendable: boolean;
  onExtend: () => void;
  onDismiss: () => void;
  onLogout: () => void;
}

const SessionTimeoutModal: React.FC<SessionTimeoutModalProps> = ({
  isOpen,
  countdown,
  extendable,
  onExtend,
  onDismiss,
  onLogout,
}) => {
  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;
  const formattedTime = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

  return (
    <Modal
      open={isOpen}
      onClose={onDismiss}
      title={extendable ? 'Oturumunuz kapanmak üzere' : 'Oturum süresi doluyor'}
      subtitle={extendable ? 'Bir süredir işlem yapmadınız.' : 'Bu oturum en uzun açık kalma süresine ulaştı.'}
      icon={ExclamationTriangleIcon}
      size="md"
      footer={
        <>
          <button type="button" onClick={onLogout} className="btn-secondary">
            Çıkış Yap
          </button>
          {extendable ? (
            <button type="button" onClick={onExtend} className="btn-primary">
              Oturumu Sürdür
            </button>
          ) : (
            <button type="button" onClick={onDismiss} className="btn-primary">
              Anladım
            </button>
          )}
        </>
      }
    >
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        {extendable
          ? 'Güvenliğiniz için oturumunuz otomatik olarak sonlandırılacak. Devam etmek için "Oturumu Sürdür"e basın.'
          : 'Bu süre uzatılamaz. Süre dolunca yeniden giriş yapmanız istenecek; açık sayfanız korunur.'}
      </p>
      <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
        Kalan süre:{' '}
        <span className="font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
          {formattedTime}
        </span>
      </p>
    </Modal>
  );
};

export default SessionTimeoutModal;
