// src/components/scalex/steps/IslemOnayStep.tsx — "İşlem ve onay": seç, gör, çalıştır.
//
// NEDEN TEK ADIM (2026-10-13). İşlem seçimi ile önizleme iki ayrı adımdı: kullanıcı önce
// altı alanı doldurup "Önizle"ye basıyor, ne olacağını ancak ondan SONRA görüyordu.
// Seçimini değiştirmek için geri dönmesi, önizlemeyi görmek için yine ilerlemesi gerekiyordu.
// Üretimde yaşanan olayda (SMART tanımlı değilken prod'da çalıştırma) kullanıcı engeli
// ancak üçüncü ekranda, OCO numarasını girdikten sonra öğrendi.
//
// Artık seçim tamamlandığı anda önizleme AYNI ekranda, kendiliğinden gelir: kapılar,
// etkilenecek hedefler ve "başlatılamaz" engeli seçimle birlikte görünür.
//
// İKİ BİLEŞEN AYRI DOSYADA KALDI (`OperationStep`, `PreviewStep`): kuralları ve bekçileri
// oralarda; bu dosya yalnızca ikisini bağlar.
import React, { useEffect, useState } from 'react';
import type { ScaleXScope, ScaleXWorkload } from '@/api/scalexApi';
import type { ScaleXLimits } from '@/hooks/useScaleXLimits';
import OperationStep, { type ScaleXIslemSecimi } from './OperationStep';
import PreviewStep from './PreviewStep';

export type ScaleXOnayEki = { writtenConfirm?: string; reason?: string; ocoNumber?: string };

interface Props {
  scope: ScaleXScope;
  selectedTargets?: { cluster: string; name: string }[];
  workloads: ScaleXWorkload[];
  clusterCount: number;
  busy: boolean;
  limits?: ScaleXLimits;
  /** Kullanıcının bu adımda DAHA ÖNCE verdiği kararlar (ilk gelişte `undefined`: nötr sunum). */
  previous?: ScaleXIslemSecimi;
  fetchedAt: number | null;
  /** Artınca önizleme yeniden istenir. */
  previewReloadKey?: number;
  /** Geçerli her seçim: sayfa onu saklar ki geri/ileri gezinmede kaybolmasın. */
  onSecim?: (v: ScaleXIslemSecimi) => void;
  /**
   * Onay. `secim` EKRANDA GÖSTERİLEN önizlemenin seçimidir — çağıran onu sayfa durumundan
   * DEĞİL buradan almalı: son tuş vuruşuyla değişmiş ama önizlemesi henüz gelmemiş bir
   * seçimi çalıştırmak, kullanıcının görmediği bir işlemi onaylatmak olurdu.
   */
  onConfirm: (secim: ScaleXIslemSecimi, ek: ScaleXOnayEki) => void;
}

// Yazarken (replica, saniye) her tuşta önizleme istememek için kısa bekleme.
const ONIZLEME_GECIKMESI_MS = 250;

const IslemOnayStep: React.FC<Props> = ({
  scope,
  selectedTargets,
  workloads,
  clusterCount,
  busy,
  limits,
  previous,
  fetchedAt,
  previewReloadKey = 0,
  onSecim,
  onConfirm,
}) => {
  // `secim`: formun ŞU ANKİ hâli (eksikse null). `gosterilen`: önizlemesi istenen seçim.
  const [secim, setSecim] = useState<ScaleXIslemSecimi | null>(previous ?? null);
  const [gosterilen, setGosterilen] = useState<ScaleXIslemSecimi | null>(previous ?? null);

  const secimMetni = JSON.stringify(secim);
  useEffect(() => {
    if (secimMetni === 'null') return;
    const t = setTimeout(
      () => setGosterilen(JSON.parse(secimMetni) as ScaleXIslemSecimi),
      ONIZLEME_GECIKMESI_MS,
    );
    return () => clearTimeout(t);
  }, [secimMetni]);

  // Form değişti ama önizleme henüz o seçime ait değil (ya da seçim eksik): onay kapalı.
  const eslesiyor = secim !== null && JSON.stringify(gosterilen) === secimMetni;

  return (
    <div className="space-y-6">
      <OperationStep
        apps={scope.apps || []}
        workloads={workloads}
        clusterCount={clusterCount}
        busy={busy}
        limits={limits}
        previous={previous}
        onChange={(v) => {
          setSecim(v);
          if (v) onSecim?.(v);
        }}
      />

      <div className="border-t border-[var(--border)] pt-5">
        {gosterilen ? (
          <>
            {!secim && (
              <p role="status" className="mb-3 text-xs text-[var(--text-secondary)]">
                Seçim eksik ya da geçersiz — yukarıdaki alanları tamamlayın. Aşağıdaki önizleme
                önceki seçime aittir.
              </p>
            )}
            <PreviewStep
              scope={scope}
              /* HEDEFLER ONIZLEMEYE DE GITMELI: yoksa onizleme carpimi,
                 calistirma gercek sayiyi kullanir ve ikisi AYRISIR. */
              selectedTargets={selectedTargets}
              action={gosterilen.action}
              executionMode={gosterilen.executionMode}
              targetReplicas={gosterilen.targetReplicas}
              verificationTimeout={gosterilen.verificationTimeout}
              workloads={workloads}
              hpaPin={gosterilen.hpaPin}
              allowPartial={gosterilen.allowPartial}
              mailCc={gosterilen.mailCc}
              fetchedAt={fetchedAt}
              busy={busy || !eslesiyor}
              reloadKey={previewReloadKey}
              onConfirm={(ek) => onConfirm(gosterilen, ek)}
            />
          </>
        ) : (
          <p
            className="py-6 text-center text-sm text-[var(--text-muted)]"
            data-testid="scalex-onizleme-bekliyor"
          >
            İşlemi ve nasıl çalışacağını seçin — ne olacağı, hangi onayların isteneceği burada
            görünecek.
          </p>
        )}
      </div>
    </div>
  );
};

export default IslemOnayStep;
