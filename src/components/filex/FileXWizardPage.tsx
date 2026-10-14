// src/components/filex/FileXWizardPage.tsx — FileX sihirbazı: uygulama → JBoss sürümü →
// sunucular → dosya listesi (salt-okunur). SADECE Legacy sunucularda çalışır (kullanıcı
// kararı) — bu yüzden OpsX'teki gibi bir platform seçim adımı YOK.
//
// OpsX'ten YAPISAL FARK: FileX hiçbir işlem tetiklemez, sadece BİLGİ gösterir. Bu yüzden
// "işlem seçimi" adımı yok, sonuç ekranı da AWX job'ının sentBody'sini değil GERÇEK dosya
// listesini gösterir. Güvenlik OpsX ile AYNI ilkeye dayanır: son POST /api/filex/run
// çağrısında sunucu uygulama-host eşleşmesini envanterden YENİDEN doğrular.
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeftIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { filexApi, type FilexResult } from '@/api/filexApi';
import AppSearchStep from './steps/AppSearchStep';
import JbossVersionStep from './steps/JbossVersionStep';
import HostSelectStep from './steps/HostSelectStep';
import FileListResultStep from './steps/FileListResultStep';

type Step = 'app' | 'jboss_version' | 'hosts' | 'running' | 'result';

const STEP_TITLES: Record<Step, string> = {
  app: 'Uygulama Seçimi',
  jboss_version: 'JBoss Sürümü',
  hosts: 'Sunucu Seçimi',
  running: 'Dosyalar Taranıyor',
  result: 'Dosya Listesi',
};

const POLL_INTERVAL_MS = 2500;
// GEÇİCİ HATAYA TOLERANS (2026-10-14). Portal yeniden başlatılırken (≈30 sn) yoklama 5xx
// alır; ilk hatada durmak kullanıcıya işi YENİDEN başlattırıyordu (iş AWX'te sürüyor
// olsa da). Art arda bu kadar geçici hatadan sonra durulur.
const GECICI_HATA_TAVANI = 12;

const FileXWizardPage: React.FC = () => {
  const [step, setStep] = useState<Step>('app');
  const [app, setApp] = useState('');
  const [jbossVersions, setJbossVersions] = useState<string[]>([]);
  const [hosts, setHosts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // ÇİFT TIKLAMA KORUMASI (2026-08-28). `busy` bir React STATE'idir: değeri render
  // sırasında yakalanır, `setBusy(true)` ise ASENKRON uygulanır. Aynı tick içindeki iki
  // tık (çift tıklama, yavaş ağda sabırsız kullanıcı, tuş+fare) ikisi de `busy === false`
  // görür ve İKİ AWX JOB'I birden açılabilir. LogX'te bu bilinçli olarak ref'e
  // çevrilmişti (LogXWizardPage.tsx); desen buraya da taşındı — bu sayfalar da gerçek
  // altyapı işleri (restart/dump/dosya taraması) tetikliyor.
  const busyRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FilexResult | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // GERCEK DURUM CEKILIYORDU AMA ATILIYORDU: poll `s.status`i aliyor, sonra
  // `if (!s.finished) return;` ile hepsini yok sayiyordu. Kullanici donen bir
  // halkadan baska hicbir sey gormuyordu — is takilirsa (bkz. LogX OCP arizasi)
  // ne oldugunu anlamasinin yolu yoktu.
  const [jobInfo, setJobInfo] = useState<{ serverId: number; jobId: number } | null>(null);
  const [awxStatus, setAwxStatus] = useState<string>('pending');
  const [startedAt, setStartedAt] = useState<number>(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  // GECEN SURE: is takildiginda kullanicinin elindeki ilk isaret budur.
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setElapsedSec(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  // ÇALIŞTIRMA KUŞAĞI (2026-08-28). `clearInterval` yalnızca GELECEK tick'leri durdurur;
  // O ANDA UÇUŞTA olan `jobStatus` isteği ağdan dönmeye devam eder ve `.then` gövdesi
  // yine çalışır. İki somut sonuç:
  //   * Kullanıcı sayfadan ayrılırsa (component unmount) unmount SONRASI setState —
  //     React uyarısı ve sızıntı.
  //   * Kullanıcı "Yeni sorgu"ya basıp yeni bir akışa girerse, ESKİ isteğin geç gelen
  //     yanıtı taze ekranı EZER (kullanıcı bambaşka bir sonuç görür).
  // Her çalıştırma bir kuşak numarası alır; geri dönen yanıt kendi kuşağı hâlâ güncel
  // değilse SESSİZCE atılır.
  const runIdRef = useRef(0);

  useEffect(
    () => () => {
      runIdRef.current += 1; // uçuştaki yanıtları geçersiz kıl
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

  function restart() {
    runIdRef.current += 1; // eski akışın geç gelen yanıtı yeni ekranı ezmesin
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setStep('app');
    setApp('');
    setJbossVersions([]);
    setHosts([]);
    busyRef.current = false;
    setBusy(false);
    setError(null);
    setResult(null);
  }

  function backTargetFor(s: Step): Step | null {
    switch (s) {
      case 'jboss_version':
        return 'app';
      case 'hosts':
        return 'jboss_version';
      default:
        return null;
    }
  }

  function back() {
    const target = backTargetFor(step);
    if (target) setStep(target);
  }

  async function runQuery(selectedHosts: string[]) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await filexApi.run(app, selectedHosts);
      if (!r.ok || r.jobId == null) {
        setError('İş başlatılamadı.');
        busyRef.current = false;
        setBusy(false);
        return;
      }
      setStep('running');
      setJobInfo({ serverId: r.awxServerId, jobId: r.jobId as number });
      setAwxStatus(r.status || 'pending');
      setStartedAt(Date.now());
      setElapsedSec(0);
      const myRun = ++runIdRef.current;
      // Yoklamalar üst üste binebilir (setInterval yanıtı beklemez): akış bir kez
      // kapandıktan sonra geç dönen yanıt ekranı yeniden değiştirmesin.
      let kapandi = false;
      let geciciHata = 0;
      const kapat = (hata: string | null) => {
        kapandi = true;
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        busyRef.current = false;
        setBusy(false);
        if (hata !== null) {
          setError(hata);
          setStep('hosts');
        }
      };
      pollRef.current = setInterval(async () => {
        try {
          const s = await filexApi.jobStatus(r.awxServerId, r.jobId as number);
          // Yanıt ağdan dönene kadar kullanıcı sayfadan ayrılmış ya da yeni bir sorgu
          // başlatmış olabilir — o durumda bu yanıt ARTIK geçersizdir.
          if (myRun !== runIdRef.current) return;
          if (kapandi) return;
          // SUNUCU HATASI DA BİR YANIT (2026-10-14). safeJson 4xx/5xx JSON'unu REDDETMEZ,
          // gövdeyi döndürür. Eskiden `s.finished` boş olduğu için yoklama SONSUZA DEK
          // sessizce dönüyordu: "bu iş size ait değil" ya da "sonuç çok büyük" hiç
          // görünmüyordu. 4xx kalıcıdır (dur, mesajı göster); 5xx geçici sayılır.
          if (s.ok === false) {
            const mesaj = s.message || `Sunucu hatası (HTTP ${s._httpStatus ?? '?'}).`;
            if ((s._httpStatus ?? 0) >= 500 && ++geciciHata < GECICI_HATA_TAVANI) return;
            kapat(mesaj);
            return;
          }
          geciciHata = 0;
          // Durum ARTIK ekrana yaziliyor — cekip atmak, elimizdeki tek gercek
          // ilerleme bilgisini cope atmakti.
          if (s.status) setAwxStatus(s.status);
          if (!s.finished) return;
          if (s.failed || !s.result) {
            kapat('İşlem tamamlanamadı — sonuç okunamadı. Lütfen sistem yöneticinize başvurun.');
            return;
          }
          kapat(null);
          setResult(s.result);
          setStep('result');
        } catch (err: unknown) {
          if (myRun !== runIdRef.current) return;
          if (kapandi) return;
          // Ağ geçidi (502/503/504, gövde HTML) ya da ağ hatası: portal yeniden
          // başlatılıyor olabilir, iş AWX'te sürüyor. Birkaç tur daha denenir.
          const durum = (err as { status?: number })?.status;
          const gecici = (err as { gatewayUnavailable?: boolean })?.gatewayUnavailable === true
            || durum === undefined
            || durum >= 500;
          if (gecici && ++geciciHata < GECICI_HATA_TAVANI) return;
          kapat(err instanceof Error ? err.message : String(err));
        }
      }, POLL_INTERVAL_MS);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      busyRef.current = false;
      setBusy(false);
    }
  }

  const canGoBack = backTargetFor(step) !== null;
  // Sonuc adiminda binlerce dosya olabilir — dar sihirbaz sutunu (max-w-2xl) veriyi
  // ezerdi. Sadece bu adimda tam genislik (sol menu + ust bar disindaki tum alan)
  // kullanilir; diger adimlar (form niteligindeki secimler) dar/ortali kalir.
  const isFullWidth = step === 'result';

  return (
    <div className={isFullWidth ? 'w-full space-y-5' : 'max-w-2xl mx-auto space-y-5'}>
      <div className="flex items-start gap-3">
        {canGoBack && (
          <button
            onClick={back}
            disabled={busy}
            title="Önceki adıma dön"
            className="mt-0.5 flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
          >
            <ArrowLeftIcon className="w-3.5 h-3.5" />
            Geri
          </button>
        )}
        <div className="flex-1">
          <h1 className="page-title">FileX - Dosya Listeleme</h1>
          <p className="mt-1 text-sm font-medium text-[var(--text-muted)]">{STEP_TITLES[step]}</p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div key={step} className={`card p-5 animate-slide-up ${isFullWidth ? 'w-full' : ''}`}>
        {step === 'app' && (
          <AppSearchStep
            busy={busy}
            onSelect={(a) => {
              setApp(a);
              setJbossVersions([]);
              setHosts([]);
              setStep('jboss_version');
            }}
          />
        )}

        {step === 'jboss_version' && (
          <JbossVersionStep
            app={app}
            busy={busy}
            onSubmit={(v) => {
              setJbossVersions(v);
              setHosts([]);
              setStep('hosts');
            }}
          />
        )}

        {step === 'hosts' && (
          <HostSelectStep
            app={app}
            jbossVersions={jbossVersions}
            busy={busy}
            onSubmit={(h) => {
              setHosts(h);
              runQuery(h);
            }}
          />
        )}

        {step === 'running' && (
          <div className="py-10 text-center space-y-3">
            <div className="inline-block w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-[var(--text-muted)]">
              {hosts.length} sunucuda .ear dizini taranıyor…
            </p>
            {/* ELIMIZDEKI GERCEK VERI GOSTERILIYOR — TAHMIN DEGIL.
                AWX durumu poll'de zaten cekiliyordu ve atiliyordu; is no ve gecen
                sure de elimizde. Is takilirsa kullanicinin yoneticiye soyleyecegi
                sey bu uclusudur. Sahte bir yuzde ya da "biraz uzun suruyor" gibi
                UYDURULMUS bir teshis BILEREK yok (bkz. LogX JobProgress). */}
            <p className="text-xs text-[var(--text-muted)] tabular-nums">
              {jobInfo && (
                <>
                  AWX Job: <span className="font-mono">#{jobInfo.jobId}</span>
                  {' · '}
                </>
              )}
              {awxStatus}
              {' · '}
              {elapsedSec}sn geçti
            </p>
          </div>
        )}

        {step === 'result' && result && <FileListResultStep result={result} onRestart={restart} />}
      </div>
    </div>
  );
};

export default FileXWizardPage;
