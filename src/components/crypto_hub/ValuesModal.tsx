// src/components/crypto_hub/ValuesModal.tsx — koşan sürümün values.yaml penceresi.
//
// Görüntüleme/düzenleme mantığı ValuesEditor'dedir; aynı çekirdek upgrade ve rollout
// akışlarının values adımında da kullanılır (kullanıcı, 2026-09-26: "upgrade denerken
// values'a dokunamıyorum"). İki ayrı kopya tutulsaydı maskeleme/yedek kuralları bir gün
// birinde kalır ötekinde unutulurdu.
import React from 'react';
import { Modal } from '@/components/common/Modal';
import { ValuesEditor, vbtn, type ValuesFileOption } from './ValuesEditor';
import { ValuesHistory } from './ValuesHistory';

export function ValuesModal({
  tenantKey,
  tenantLabel,
  namespace = '',
  release,
  files = [],
  onClose,
}: {
  tenantKey: string;
  tenantLabel: string;
  /** onay penceresindeki komutlar icin */
  namespace?: string;
  release: string;
  files?: ValuesFileOption[];
  onClose: () => void;
}) {
  // GECMIS BURADA DA DURUYOR: kullanici eski surumu, values'i DUZENLEDIGI yerde arar.
  // Yalnizca rollout akisinda olsaydi, "dun ne yazmistim" sorusu icin baska bir ekrana
  // gitmek gerekirdi.
  const [gecmis, setGecmis] = React.useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      dismissOnBackdrop={false}
      title="values.yaml"
      subtitle={`${tenantLabel} · release ${release}`}
      footer={
        <div className="flex items-center gap-2 w-full">
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Değişiklikler dosyaya yazılır; ortama <b>upgrade</b> ya da <b>rollout</b> ile uygulanır.
          </span>
          <span className="flex-1" />
          <button
            type="button"
            className="h-8 px-3 text-xs rounded-lg border"
            style={vbtn()}
            onClick={onClose}
          >
            Kapat
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <ValuesEditor
          tenantKey={tenantKey}
          tenantLabel={tenantLabel}
          release={release}
          files={files}
        />
        {files.length > 0 && (
          <div className="rounded-lg border p-2" style={{ borderColor: 'var(--border-subtle)' }}>
            <button
              type="button"
              className="text-[11px] underline"
              onClick={() => setGecmis((x) => !x)}
            >
              {gecmis ? 'Eski sürümleri gizle' : 'Eski sürümler ve fark'}
            </button>
            {gecmis && (
              <div className="mt-2">
                <ValuesHistory
                  tenantKey={tenantKey}
                  tenantLabel={tenantLabel}
                  namespace={namespace}
                  files={files}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default ValuesModal;
