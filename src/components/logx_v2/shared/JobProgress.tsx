// src/components/logx_v2/shared/JobProgress.tsx — Bir AWX job'ını 3sn'de bir poll eder,
// faz-bazlı animasyonlu ilerleme metni gösterir (SelfService SurveyModal'ın setInterval(3000)
// deseninden esinlenir — 5 ardışık hatada durur). Job terminal duruma ulaştığında onDone'u
// {status, artifacts, errorMessage} ile çağırır. Kullanıcı isterse canlı AWX stdout'unu da
// açıp görebilir (AnsiblePage.tsx'in JobOutputModal'ıyla aynı terminal görünümü) — bu yalnızca
// "şu an ne oluyor" görünürlüğü içindir, sonucun kaynağı HER ZAMAN artifacts.logx_result'tır.
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { progressText } from '@/utils/ansibleProgress';
import { logxV2Api } from '@/api/logxV2Api';
import AnsibleLogTerminal from '@/components/common/AnsibleLogTerminal';

interface Props {
  jobId: number;
  discoveringLabel?: string;
  onDone: (result: {
    status: string;
    artifacts: Record<string, unknown> | null;
    errorMessage: string | null;
    technicalDetail?: string;
  }) => void;
}

// KRONOMETREYE DAYALI TAHMIN KALDIRILDI.
//
// Eski `phaseText` "su an ne oluyor"u GECEN SUREDEN uretiyordu (<10sn "Sunuculara
// baglaniliyor", <30sn genel etiket, >30sn "buyuk bir sonuc kumesi olabilir").
// Ucu de playbook'un gercekte ne yaptigina bakmiyordu; sonuncusu UYDURULMUS BIR
// TESHIS koyuyordu. 2026-09'daki LogX OCP arizasinda is bos parola yuzunden
// takiliyken ekran kullaniciya veri buyuklugunu suclatiyordu.
//
// Yerine `src/utils/ansibleProgress.ts`: cikti elde varsa GERCEK adim, yoksa
// yalnizca AWX'ten gelen DURUM — sebep hakkinda iddia YOK.

const JobProgress: React.FC<Props> = ({
  jobId,
  discoveringLabel = 'Dosyalar taranıyor…',
  onDone,
}) => {
  const [status, setStatus] = useState('pending');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [showOutput, setShowOutput] = useState(false);
  const [output, setOutput] = useState('');
  // Canli cikti KALICI olarak alinamiyorsa sebebi EKRANA yazilir; bos bir
  // terminal kullaniciya hicbir sey anlatmiyordu.
  const [outputError, setOutputError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const doneRef = useRef(false);

  async function handleCancel() {
    if (cancelling || doneRef.current) return;
    setCancelling(true);
    try {
      await logxV2Api.cancelJob(jobId);
      doneRef.current = true;
      onDone({ status: 'canceled', artifacts: null, errorMessage: null });
    } catch {
      setCancelling(false); // iptal başarısızsa poll'e devam etsin
    }
  }

  useEffect(() => {
    doneRef.current = false;
    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled || doneRef.current) return;
      try {
        const r = await logxV2Api.jobStatus(jobId);
        if (cancelled) return;
        setStatus(r.status);
        setElapsedSec(r.elapsedSec || 0);
        setErrorCount(0);
        if (['successful', 'failed', 'error', 'canceled'].includes(r.status)) {
          doneRef.current = true;
          onDone({
            status: r.status,
            artifacts: r.artifacts,
            errorMessage: r.errorMessage,
            technicalDetail: r.technicalDetail,
          });
        }
      } catch {
        setErrorCount((prev) => {
          const next = prev + 1;
          if (next >= 5) {
            doneRef.current = true;
            onDone({
              status: 'error',
              artifacts: null,
              errorMessage: 'Durum sorgulanamadı (bağlantı sorunu).',
            });
          }
          return next;
        });
      }
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Canlı çıktı yalnızca kullanıcı panel açıkken poll edilir (gereksiz istek yapmamak için).
  //
  // ── ÇIKTI YOKLAMASININ KENDİ DURDURUCUSU OLMALI ─────────────────────────────
  //
  // Eski hali `.catch(() => {})` ile hatayı yutuyordu ve tek durma koşulu
  // `doneRef` idi — yani DURUM yoklamasının kararıydı. Oturum düştüğünde durum
  // yoklaması 5 hatada duruyor ve bunu da durduruyor, o yüzden "sonsuza dek
  // döner" DEĞİLDİ.
  //
  // Ama KALICI bir çıktı hatası (örn. AWX çıktısı bayt tavanını aşıyor → 502
  // `tooLarge`, `permanent`) durum yoklamasını HİÇ etkilemez: durum başarıyla
  // gelmeye devam eder, `doneRef` kurulmaz ve çıktı isteği 3 saniyede bir,
  // **iş bitene kadar**, hiçbir şey söylemeden yeniden denenir. Kullanıcı boş
  // bir terminal görür ve nedenini öğrenemez.
  //
  // Artık kendi sayacı var: beş ardışık hatadan sonra yoklama durur ve sebep
  // EKRANA yazılır. Başarılı bir çekim sayacı sıfırlar (geçici bir kesinti
  // panelin canlı takibini kalıcı olarak öldürmesin).
  useEffect(() => {
    if (!showOutput) return;
    let cancelled = false;
    let ardArdaHata = 0;
    let interval: ReturnType<typeof setInterval> | null = null;

    const durdur = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };

    const fetchOutput = () => {
      logxV2Api
        .jobOutput(jobId)
        .then((r) => {
          if (cancelled) return;
          ardArdaHata = 0;
          setOutputError(null);
          setOutput(r.output || '');
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          ardArdaHata += 1;
          if (ardArdaHata >= 5) {
            durdur();
            setOutputError(
              (e as Error)?.message ||
                'Canlı çıktı alınamıyor. İş çalışmaya devam ediyor; sonuç ekranından tam çıktıya bakabilirsiniz.',
            );
          }
        });
    };

    fetchOutput();
    interval = setInterval(() => {
      if (!doneRef.current) fetchOutput();
    }, 3000);
    return () => {
      cancelled = true;
      durdur();
    };
  }, [showOutput, jobId]);

  return (
    <div className="py-6">
      <div className="flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-center text-[var(--text-secondary)]">
          {cancelling ? 'İptal ediliyor…' : progressText(status, output)}
        </p>
        {/* ILERLEME CUBUGU KALDIRILDI — DURUST BIR YUZDE URETEMIYORUZ.
            Eskiden `1 - e^(-t/25)` ile %90'a kosan bir cubuk vardi: GECEN SUREYI
            ilerleme gibi gosteriyordu. Playbook'un kac adimi kaldigini bilmiyoruz,
            dolayisiyla yuzde IDDIA ETMEK uydurmaktir. Etkinlik gostergesi olarak
            yukaridaki donen halka zaten var; ikinci bir sahte olcut gereksiz.
            Gercek ilerleme, cikti panelindeki "Adim N: ..." satirindadir. */}
        <p className="text-xs text-[var(--text-muted)]">{elapsedSec}sn geçti</p>
        <button
          onClick={handleCancel}
          disabled={cancelling}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:border-red-300 hover:text-red-600 transition-colors active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
        >
          <XCircleIcon className="w-4 h-4" />
          {cancelling ? 'İptal ediliyor…' : 'İşlemi İptal Et'}
        </button>
      </div>

      <div className="mt-4">
        <button
          onClick={() => setShowOutput((v) => !v)}
          className="flex items-center gap-1 text-xs mx-auto text-[var(--text-muted)] transition-colors"
        >
          {showOutput ? (
            <ChevronUpIcon className="w-3.5 h-3.5" />
          ) : (
            <ChevronDownIcon className="w-3.5 h-3.5" />
          )}
          {showOutput ? 'Ansible çıktısını gizle' : 'Ansible çıktısını göster'}
        </button>
        {showOutput && outputError && (
          <div
            role="alert"
            className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900"
          >
            {outputError}
          </div>
        )}

        {showOutput && (
          <div className="mt-2 animate-fade-in">
            <AnsibleLogTerminal
              output={output}
              status={cancelling ? 'canceled' : status}
              elapsedSec={elapsedSec}
              title="ansible — canlı çıktı"
              placeholder="Henüz çıktı yok — job başladığında konsol burada akacak…"
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default JobProgress;
