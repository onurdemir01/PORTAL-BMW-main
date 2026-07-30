import React from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { Modal } from '@/components/common/Modal';

interface SessionTimeoutModalProps {
  isOpen: boolean;
  countdown: number;
  onExtend: () => void;
  onLogout: () => void;
}

const SessionTimeoutModal: React.FC<SessionTimeoutModalProps> = ({ isOpen, countdown, onExtend, onLogout }) => {
  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;
  const formattedTime = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

  return (
    <Modal
      open={isOpen}
      onClose={onExtend}
      title="Oturum Zaman Aşımı Uyarısı"
      subtitle="Güvenliğiniz için otomatik çıkış yapılacak."
      icon={ExclamationTriangleIcon}
      size="md"
      footer={
        <>
          <button type="button" onClick={onLogout} className="btn-secondary">Çıkış Yap</button>
          <button type="button" onClick={onExtend} className="btn-primary">Oturumu Sürdür</button>
        </>
      }
    >
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        Bir süredir işlem yapmadınız. Güvenliğiniz için oturumunuz otomatik olarak sonlandırılacak.
      </p>
      <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
        Kalan süre: <span className="font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{formattedTime}</span>
      </p>
    </Modal>
  );
};

export default SessionTimeoutModal;
