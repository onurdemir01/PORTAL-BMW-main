import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { selfServiceApi, type SelfServiceGroup } from '@/api/selfServiceApi';
import { ansibleApi, type OcoWindowInfo } from '@/api/ansibleApi';
import { nobetciApi, type NobetciResult } from '@/api/nobetciApi';
import type { AnsibleSsItem, SurveyField, JobHistoryRecord, LaunchOptions, SurveyGates } from '@/api/ansibleApi';
import FieldOverridesModal from '@/components/self_service/FieldOverridesModal';
import DynamicChoiceSelect, { MULTI_SEP, splitMulti } from '@/components/self_service/DynamicChoiceSelect';
import AnsibleLogTerminal from '@/components/common/AnsibleLogTerminal';
import { useJobTracker } from '@/contexts/JobTrackerContext';
import { useFloatingWindow, ResizeHandle } from '@/hooks/useFloatingWindow';
import { Field, TextInput, Textarea, Select } from '@/components/ui/Form';
import {
  PlusIcon,
  TrashIcon,
  CommandLineIcon,
  XMarkIcon,
  PlayIcon,
  ClockIcon,
  ArrowLeftIcon,
  QuestionMarkCircleIcon,
  ShieldCheckIcon,
  AdjustmentsHorizontalIcon,
  MagnifyingGlassIcon,
  CalendarDaysIcon,
  UserIcon,
  ChevronRightIcon,
  GlobeAltIcon,
  CubeIcon,
  CheckCircleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import HelpModal, { type HelpSection } from '@/components/common/HelpModal';
import { useBackdropDismiss } from '@/components/common/backdropDismiss';
import IpCheckSection from '@/components/self_service/IpCheckSection';
import OpenshiftCheckSection from '@/components/self_service/OpenshiftCheckSection';
import { SkeletonList } from '@/components/common/Skeleton';
import { fmtDateTime } from '@/utils/datetime';
import { isFieldActive as isFieldActiveShared } from '../../shared/surveyConditions.cjs';

// LAUNCHING ARA DURUMU (2026-08-28): Smart onayı geldi, AWX çağrısı uçuşta. Bu da bir
// BEKLEME durumudur — sonlanmış gibi davranıp yoklamayı kesersek ekran "başlatılıyor"da
// donar ve iş gerçekte çalışırken kullanıcı bunu hiç görmez.
const WAITING_TICKET_STATES = ['PENDING', 'LAUNCHING'];

// AWX isinin BITTIGI durumlar (JobTrackerContext ile ayni kume). Bazi servislerde
// Ansible ciktisi AYNI EKRANDA akiyor; is akarken formu sifirlamak canli terminali
// ekrandan silerdi (2026-09-22 kullanici hatirlatmasi), o yuzden sifirlama ancak is
// bittikten sonra acilir.
const JOB_FINISHED = ['successful', 'failed', 'error', 'canceled'];

// Ekranda KARSILIGI OLAN bilet durumlari. Listede olmayan bir durum gelirse (or.
// poller'in yeni ekledigi SCHEDULED) panel bos bir kutu olarak ciziliyordu —
// kullanici bunu "bembeyaz bos alan" olarak bildirdi (2026-09-22). Artik bilinmeyen
// durumlar da yazili bir satirla gosterilir.
const RENDERED_TICKET_STATES = ['PENDING', 'LAUNCHING', 'SCHEDULED', 'REJECTED', 'TIMEOUT', 'ERROR'];

const SELF_SERVICE_HELP_SECTIONS: HelpSection[] = [
  {
    icon: CommandLineIcon,
    title: 'Ansible ve Check Sekmeleri',
    body: '"Ansible" AWX üzerinden başlatılabilen otomasyon servislerini gösterir. "Check" içinde iki alt-sekme var: "IP" yapıştırılan bir IP listesinin envanterde (IPInventory) bulunup bulunmadığını, "OpenShift" ise yapıştırılan bir namespace/uygulama listesinin OpenShift envanterinde hangi sahip grup/e-posta ile kayıtlı olduğunu gösterir.',
  },
  {
    icon: PlayIcon,
    title: 'Bir Servisi Başlatmak',
    body: 'Ansible sekmesinde bir servise tıklayıp gerekli alanları (varsa) doldurduktan sonra başlat butonuna basmak, AWX üzerinde bir iş (job) tetikler; sonucu ve geçmiş çalıştırmaları aynı ekrandan takip edebilirsiniz.',
  },
  {
    icon: ShieldCheckIcon,
    title: 'Katalog Yönetimi (Ekle/Düzenle/Sil)',
    body: 'Ansible servislerini AWX şablonlarından kayıt olarak eklemek/düzenlemek/silmek yalnızca Admin rolüne açıktır — normal kullanıcılar yalnızca görüntüleyip başlatabilir.',
    adminOnly: true,
  },
];

type TopTab = 'ansible' | 'ip' | 'openshift' | 'svc:new' | `svc:${string}`;

// ── Survey Form Modal ─────────────────────────────────────────────────────────

interface SurveyModalProps {
  item: AnsibleSsItem;
  onClose: () => void;
  /** 2026-09-21: Otomasyon sayfasinda secilen servisin formu MODAL DEGIL, icerik kartinin
   *  icinde acilir (kullanici: "ise tikliyorum, bir daha isi gosterip Baslat cikariyor").
   *  inline=true: portal/arka plan/surukleme basligi yok, yalniz govde + alt satir. */
  inline?: boolean;
}

function SurveyModal({ item, onClose, inline = false }: SurveyModalProps) {
  const backdrop = useBackdropDismiss(onClose, false);
  const [fields, setFields] = useState<SurveyField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [launchOptions, setLaunchOptions] = useState<LaunchOptions | null>(null);
  // Bu servisin kapilari (OCO / Smart) — survey yanitiyla gelir, formun EN USTUNDE
  // onceden duyurulur (2026-09-21, kullanici: "OCO form doldurulduktan sonra sorulunca
  // insanlar en basta is tetiklemeye korkuyor"). Karar yine sunucuda (launch-ss).
  const [gates, setGates] = useState<SurveyGates | null>(null);
  const [limit, setLimit] = useState('');
  const [forks, setForks] = useState('');
  const [jobTags, setJobTags] = useState('');
  const [skipTags, setSkipTags] = useState('');
  const [verbosity, setVerbosity] = useState('0');
  const [jobType, setJobType] = useState('run');
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  // ÇİFT TIKLAMA KORUMASI (2026-08-28). `launching` bir React STATE'idir: değeri render
  // sırasında yakalanır, `setLaunching(true)` ise ASENKRON uygulanır. Aynı tick içindeki
  // iki tık ikisi de `launching === false` görür ve İKİ AWX JOB'I birden açılabilir —
  // Self Service'te bu, prod'da AYNI işlemin iki kez koşması demektir (ve Smart onayı
  // açıksa iki ayrı bilet). LogX'teki ref deseni (LogXWizardPage.tsx) buraya da taşındı.
  const launchingRef = useRef(false);
  const [jobId, setJobId] = useState<number | null>(null);
  const [trackedJobId, setTrackedJobId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  // Bu servis Smart onayı gerektiriyorsa (bkz. FieldOverridesModal.tsx "Smart Onayı
  // Gerekli") launch() jobId yerine bir ticketId döner — AWX job'ı onay gelene kadar
  // TETİKLENMEMİŞTİR. ticketStatus: PENDING (bekliyor) | REJECTED | TIMEOUT | ERROR |
  // LAUNCHED (poller onayladı, jobId artık dolu — normal iş takibine geçilir).
  const [pendingTicket, setPendingTicket] = useState<{
    id: number;
    status: string;
    errorMessage?: string | null;
    externalTicketId?: string | null;
  } | null>(null);
  // Kapama Onayı'ndan (Smart'ta talep tamamlandıktan) sonra otomasyon tetiklenir ama Teams
  // bildirimi gecikebilir/gitmeyebilir — kullanıcı "kimseye ulaşamıyorum" durumunda kalmasın
  // diye günün nöbetçisi (bkz. server/nobetci/index.cjs, halihazırda Dashboard'da da
  // kullanılan public uç) burada da gösterilir (2026-08-20, kullanıcı talebi).
  const [onCall, setOnCall] = useState<NobetciResult | null>(null);
  useEffect(() => {
    if (!pendingTicket) return;
    nobetciApi
      .today()
      .then(setOnCall)
      .catch(() => {});
  }, [pendingTicket?.id]);
  const { addJob, jobs } = useJobTracker();
  // Modal açıkken CANLI çıktı burada (inline) gösterilir — bkz. OpsXWizardPage.tsx'teki
  // aynı desen. Modal kapatılırsa is arka planda takip edilmeye devam eder (alt çubuk).
  const trackedJob = trackedJobId ? jobs.find((j) => j.id === trackedJobId) : undefined;
  // Modal GERÇEK bir kayan pencere gibi davranır — başlıktan tutup taşınabilir,
  // sağ-alt köşesinden boyutlandırılabilir (bkz. JobTrackerBar.tsx'teki AYNI hook).
  // autoHeight:true — kısa bir formda (ör. tek "sunucu" alanı) altta gereksiz boşluk
  // kalmasın diye yükseklik İÇERİĞE göre kendiliğinden ayarlanır; kullanıcı köşeden
  // ELLE büyütürse o andan itibaren sabitlenir ve terminal o boşluğu doldurur (asağıdaki
  // size={floatSize.h === "auto" ? "compact" : "fill"}).
  const {
    ref: floatRef,
    size: floatSize,
    style: floatStyle,
    startMove,
    startResize,
  } = // 2026-08-26: genislik 640 -> 760. OCO kontrolu paneli uzun Turkce cumleler
    // iceriyor ve 640'ta secenek metinleri kirpiliyordu; ayni genislik normal
    // survey formlarina da yariyor (uzun etiketler alt satira dusmuyor).
    // 2026-09-16: 760 -> 1040 (ekrana sigacak sekilde). Envanterden gelen secenek etiketleri
    // (location yolu + uygulama/namespace) uzun; dar pencerede alt satira kayiyordu.
    useFloatingWindow(
      { w: Math.min(1040, (typeof window !== 'undefined' ? window.innerWidth : 1040) - 40), h: 640 },
      { w: 420, h: 380 },
      { autoHeight: true },
    );
  // Satır-içi doğrulama (Faz 5): alan dokunulunca veya submit denenince hata gösterilir.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitAttempted, setSubmitAttempted] = useState(false);

  function normalizeChoices(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map((v) => String(v).trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
      return value
        .split(/\r?\n|,/)
        .map((v) => v.trim())
        .filter(Boolean);
    }
    return [];
  }

  useEffect(() => {
    ansibleApi
      .surveySpec(item.awxServerId, item.awxTemplateId)
      .then((r) => {
        const normalizedFields = (r.fields || []).map((f) => ({
          ...f,
          choices: normalizeChoices((f as { choices?: unknown }).choices),
        }));
        setFields(normalizedFields);
        const defaults: Record<string, string> = {};
        for (const f of normalizedFields) {
          if (f.defaultValue) defaults[f.name] = f.defaultValue;
        }
        setValues(defaults);
        setGates(r.gates || null);
        if (r.launchOptions) {
          setLaunchOptions(r.launchOptions);
          setLimit(String(r.launchOptions.limit?.current ?? ''));
          setForks(r.launchOptions.forks?.current ? String(r.launchOptions.forks.current) : '');
          setJobTags(String(r.launchOptions.jobTags?.current ?? ''));
          setSkipTags(String(r.launchOptions.skipTags?.current ?? ''));
          setVerbosity(String(r.launchOptions.verbosity?.current ?? '0'));
          setJobType(String(r.launchOptions.jobType?.current || 'run'));
        }
        if (!r.ok && r.message) setErr(r.message);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [item]);

  // Koşullu alanlar (Survey Tasarımcısı "dependsOn"). Mantık ARTIK KOPYALANMIYOR:
  // sunucu (resolveCustomSurveyExtraVars) ile BİREBİR aynı fonksiyon çağrılır. İki
  // kopya ayrışırsa alan burada gizli görünürken sunucu onu yine de gönderir — sessiz
  // ve teşhisi zor bir hata. Karar sunucuda bağlayıcıdır; burası yalnızca UX.
  function isFieldActive(f: SurveyField): boolean {
    return isFieldActiveShared(f.dependsOn, values);
  }
  const visibleFields = fields.filter(isFieldActive);

  // OCO on uyarisi: kullanicinin SU ANKI secimi OCO isteyecek mi? Sunucudaki kuralin
  // (server/oco/prod-detect.cjs + change-gates isOcoGateApplicable) UX kopyasi:
  // `env|ortam` alani, deger `prod|production` — ya da admin ortam listesi verdiyse o liste.
  // Bagla degil, yalnizca uyarinin tonunu belirler.
  const ocoHint = (() => {
    if (!gates?.oco) return null;
    let envLabel = '';
    for (const f of visibleFields) {
      if (!['env', 'ortam'].includes(f.name.trim().toLowerCase())) continue;
      const v = String(values[f.name] || '').trim().toLowerCase();
      if (v) { envLabel = v; break; }
    }
    const envs = gates.ocoEnvironments && gates.ocoEnvironments.length ? gates.ocoEnvironments : null;
    const willAsk = envs ? envs.includes(envLabel) : ['prod', 'production'].includes(envLabel);
    const scope = envs ? envs.map((e) => e.toUpperCase()).join(', ') : 'PRODUCTION';
    return { willAsk, scope, envLabel };
  })();

  // Görünür ve dolu olması gereken zorunlu alanlar — submit'i istemci tarafında da
  // engeller (önceden yalnızca kozmetik bir `*` işareti vardı, hiçbir şeyi engellemiyordu).
  const missingRequiredLabels = visibleFields
    .filter((f) => f.required && !(values[f.name] ?? '').trim())
    .map((f) => f.label);

  // Alan-bazlı canlı doğrulama (Faz 5): zorunlu boş / sayısal tip / choices whitelist.
  function fieldError(f: SurveyField): string | null {
    const v = String(values[f.name] ?? '').trim();
    if (f.required && !v) return `${f.label} zorunlu.`;
    if (!v) return null;
    if (f.type === 'integer' && !/^-?\d+$/.test(v)) return 'Tam sayı girin.';
    if (f.type === 'float' && !/^-?\d*\.?\d+$/.test(v)) return 'Geçerli bir sayı girin.';
    // Kaynaktan beslenen alanlarda liste istemcide anlık yüklenir; whitelist kararı
    // sunucuda (assertChoiceSources) verilir — burada statik listeye bakılmaz.
    if (
      f.type === 'multiplechoice' &&
      !f.choicesSource &&
      Array.isArray(f.choices) &&
      f.choices.length > 0 &&
      !f.choices.includes(v)
    ) {
      return 'Listeden geçerli bir seçenek seçin.';
    }
    if (f.type === 'multiselect' && !f.choicesSource && Array.isArray(f.choices) && f.choices.length > 0) {
      if (splitMulti(v).some((x) => !f.choices.includes(x))) return 'Listeden geçerli seçenekler seçin.';
    }
    return null;
  }
  const hasAnyFieldError = visibleFields.some((f) => fieldError(f) !== null);

  function trackJob(id: number) {
    const trackerId = addJob({
      title: item.title,
      fetchStatus: async () => {
        const r = await ansibleApi.ssJobStatus(item.awxServerId, id);
        // Parse/erken hatada AWX stdout'u BOŞ döner; hata result_traceback/job_explanation'dadır.
        // Log önceliği: stdout > traceback > explanation.
        const log = r.output || r.resultTraceback || r.jobExplanation || '';
        return { status: r.status, output: log };
      },
    });
    setTrackedJobId(trackerId);
  }

  // Smart onayı bekleyen bir talebi periyodik kontrol eder. LAUNCHED olunca normal
  // job takibine (trackJob) geçilir — kullanıcı hiçbir ek tıklama yapmadan aynı
  // ekranda "onay bekleniyor" -> "iş çalışıyor" akışını görür.
  useEffect(() => {
    if (!pendingTicket || !WAITING_TICKET_STATES.includes(pendingTicket.status)) return;
    const timer = setInterval(async () => {
      try {
        const r = await ansibleApi.smartTicketStatus(pendingTicket.id);
        if (!r.ok) return;
        if (r.status === 'LAUNCHED' && r.jobId) {
          clearInterval(timer);
          setPendingTicket(null);
          setJobId(r.jobId);
          trackJob(r.jobId);
          return;
        }
        if (!WAITING_TICKET_STATES.includes(r.status)) {
          clearInterval(timer);
          setPendingTicket({
            id: pendingTicket.id,
            status: r.status,
            errorMessage: r.errorMessage,
            externalTicketId: r.externalTicketId,
          });
        }
      } catch {
        /* gecici hata — bir sonraki tick'te tekrar denenir */
      }
    }, 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTicket?.id, pendingTicket?.status]);

  // ── OCO Kontrolu akisi ────────────────────────────────────────────────────────
  // Sunucu bu servis icin OCO Kontrolu acikken ve talep PRODUCTION iken (extra_vars'ta
  // env|ortam = prod|production) sirasiyla ocoRequired ve ocoDecisionRequired doner;
  // burada o iki adim ekrana cikarilir. KARARI SUNUCU VERIR - buradaki alanlar yalnizca
  // ayni cagriyi tamamlamak icin; launch-ss her seferinde OCO'yu yeniden sorgular.
  //   'ask'    -> OCO numarasi isteniyor
  //   'decide' -> pencere bilgisi geldi, kullanici secim yapacak
  //   'done'   -> zamanlandi ya da "sonra gelecegim" denildi; is baslatilmadi
  const [ocoState, setOcoState] = useState<{
    phase: 'ask' | 'decide' | 'done';
    info?: OcoWindowInfo;
    message?: string;
    // 'done' SONUCU ARTIK YAPISAL (2026-09-22): eskiden tek uzun cumleydi ve ayni
    // cumle hem ustteki uyari kutusunda hem alttaki sonuc kutusunda ciziliyordu.
    // Simdi ust kutu 'done' asamasinda hic cizilmiyor; asagidaki kart Smart kayit
    // numarasini, OCO penceresini ve sirada ne oldugunu ayri ayri gosteriyor.
    done?: {
      kind: 'smart-first' | 'awx' | 'portal' | 'deferred';
      externalTicketId?: string | null;
      awxScheduleId?: number | null;
      runAtText?: string | null;
    };
  } | null>(null);
  const [ocoNumber, setOcoNumber] = useState('');
  const [ocoBusy, setOcoBusy] = useState(false);

  async function ocoLookup() {
    const n = ocoNumber.trim();
    if (!n) {
      setErr('OCO numarası girin.');
      return;
    }
    setOcoBusy(true);
    setErr('');
    try {
      const r = await ansibleApi.ocoValidate(n);
      if (!r.ok || !r.oco) {
        setErr(r.message || 'OCO sorgulanamadı.');
        return;
      }
      setOcoState({ phase: 'decide', info: r.oco, message: r.message });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setOcoBusy(false);
    }
  }

  async function launch(ocoAction?: 'schedule' | 'later') {
    setSubmitAttempted(true); // tüm alan hatalarını göster
    if (hasAnyFieldError) {
      setErr(
        missingRequiredLabels.length > 0
          ? `Zorunlu alan(lar) eksik: ${missingRequiredLabels.join(', ')}`
          : 'Bazı alanlar geçersiz — lütfen kırmızı uyarıları düzeltin.',
      );
      return;
    }
    if (launchingRef.current) return;
    launchingRef.current = true;
    setLaunching(true);
    setErr('');
    try {
      const extraVars: Record<string, string> = {};
      for (const f of visibleFields) {
        const val = (values[f.name] ?? '').trim();
        if (!val) continue;
        extraVars[f.name] = val;
      }

      const r = await ansibleApi.launchSs(
        item.awxServerId,
        item.awxTemplateId,
        extraVars,
        item.title,
        {
          limit: launchOptions?.limit.enabled ? limit : undefined,
          forks: launchOptions?.forks.enabled && forks ? Number(forks) : undefined,
          jobTags: launchOptions?.jobTags.enabled ? jobTags : undefined,
          skipTags: launchOptions?.skipTags.enabled ? skipTags : undefined,
          verbosity: launchOptions?.verbosity.enabled ? Number(verbosity) : undefined,
          jobType: launchOptions?.jobType.enabled ? jobType : undefined,
        },
        { ocoNumber: ocoNumber.trim() || undefined, ocoAction },
      );

      // OCO dallari EN BASTA: bunlarin hicbirinde is baslatilmis DEGILDIR.
      if (r.ocoRequired) {
        setOcoState({ phase: 'ask', message: r.message });
        return;
      }
      if (r.ocoDecisionRequired) {
        setOcoState({ phase: 'decide', info: r.oco, message: r.message });
        return;
      }
      if (r.ocoExpired) {
        setOcoState(null);
        setErr(r.message || 'OCO kaydınızı kaçırdınız.');
        return;
      }
      if (r.ok && r.ocoScheduled) {
        // İki tetikleyici olabilir; kullanıcıya HANGİSİ olduğunu söylüyoruz çünkü
        // "Portal kapalıysa ne olur" sorusunun cevabı değişiyor.
        // ONAY ONCE, ZAMANLAMA SONRA (2026-09-22): Smart gerekiyorsa bilet ARTIK ŞİMDİ
        // açılıyor; kullanıcı gece tekrar gelmesin diye akış net anlatılır.
        setOcoState({
          phase: 'done',
          info: r.oco,
          done: {
            kind: r.smartFirst ? 'smart-first' : r.awxScheduleId ? 'awx' : 'portal',
            externalTicketId: r.externalTicketId ?? null,
            awxScheduleId: r.awxScheduleId ?? null,
            runAtText: r.oco?.windowStartText ?? null,
          },
        });
        if (r.smartFirst && r.smartTicketId != null) {
          setPendingTicket({ id: r.smartTicketId, status: 'PENDING', externalTicketId: r.externalTicketId });
          window.dispatchEvent(new CustomEvent('portal:smart-ticket-created'));
        }
        return;
      }
      if (r.ok && r.ocoDeferred) {
        setOcoState({
          phase: 'done',
          info: r.oco,
          done: { kind: 'deferred', runAtText: r.oco?.windowStartText ?? null },
          message: `İş başlatılmadı. ${r.oco?.windowStartText} — ${r.oco?.windowEndText} aralığında tekrar gelip çalıştırabilirsiniz.`,
        });
        return;
      }

      if (r.ok && r.pendingApproval && r.ticketId != null) {
        setPendingTicket({
          id: r.ticketId,
          status: 'PENDING',
          externalTicketId: r.externalTicketId,
        });
        // "Taleplerim" paneline HABER VER. Panel AppLayout'ta, Outlet'in DISINDA
        // mount edilir; sayfa gezinmesinde yeniden mount OLMAZ ve kendiliginden
        // yeni talebi ogrenemez. Bu olay olmadan panel — ozellikle bos oldugu icin
        // serite dusmusken — talep acilsa bile kapali kalirdi.
        window.dispatchEvent(new CustomEvent('portal:smart-ticket-created'));
      } else if (r.ok && r.jobId != null) {
        setJobId(r.jobId);
        trackJob(r.jobId);
      } else {
        setErr(r.field ? `${r.field}: ${r.message}` : r.message || 'İş başlatılamadı.');
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      launchingRef.current = false;
      setLaunching(false);
    }
  }

  // Alt satirdaki sol dugmenin ne yapacagini belirleyen durumlar (2026-09-22).
  const resultView = !!jobId || !!pendingTicket || ocoState?.phase === 'done';
  // Canli cikti akiyor mu? (is basladi, henuz sonuclanmadi)
  const jobStreaming = !!jobId && !JOB_FINISHED.includes(trackedJob?.status || '');
  const formDirty =
    !!ocoState ||
    !!err ||
    Object.values(values).some((v) => (v || '').trim() !== '') ||
    !!limit.trim() ||
    !!forks.trim() ||
    !!jobTags.trim() ||
    !!skipTags.trim() ||
    verbosity !== '0' ||
    jobType !== 'run';

  if (typeof document === 'undefined') return null;

  // Arka plan tiklamasi KAPALI (useBackdropDismiss(onClose, false)): kullanici burada
  // form dolduruyor. Yanlislikla saga-sola surukleme / arka plana tek tiklama pencereyi
  // kapatip her seyi sildiriyordu (kullanici bildirimi). Kapatma yalnizca X ve Iptal ile.
  const body = (
    <>
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 flex flex-col">
          {err && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              {err}
            </div>
          )}

          {loading && <SkeletonList rows={4} />}

          {/* OCO ON UYARISI — formun EN USTUNDE, alanlar doldurulmadan once. Secim henuz prod
              degilse bilgi tonunda (mor), prod/listedeki ortam secildiyse uyari tonuna (sari)
              doner: "OCO numaranizi hazir edin". Boylece kullanici Baslat'a basinca ne olacagini
              en bastan bilir; OCO paneli (asagida) yine ayni akis, surpriz degil. */}
          {!loading && !jobId && !pendingTicket && !ocoState && ocoHint && (
            <div
              role="status"
              data-testid="oco-prewarn"
              data-tone={ocoHint.willAsk ? 'warning' : 'info'}
              className="rounded-xl border px-3.5 py-2.5 flex items-start gap-2.5"
              style={{
                borderColor: ocoHint.willAsk ? 'var(--status-warning)' : 'var(--status-info)',
                background: ocoHint.willAsk ? 'var(--status-warning-bg)' : 'var(--status-info-bg)',
                boxShadow: `inset 4px 0 0 ${ocoHint.willAsk ? 'var(--status-warning)' : 'var(--status-info)'}`,
              }}
            >
              <ShieldCheckIcon className="w-5 h-5 shrink-0 mt-0.5" style={{ color: ocoHint.willAsk ? 'var(--status-warning)' : 'var(--status-info)' }} />
              <div className="text-[13px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                {ocoHint.willAsk ? (
                  <>
                    <b>Bu seçim için OCO gerekecek — OCO numaranızı hazır edin.</b>{' '}
                    "Başlat"a bastığınızda iş <b>hemen tetiklenmez</b>: bir sonraki adımda OCO numarası sorulur, kesinti penceresi doğrulanır ve iş ona göre başlatılır.
                  </>
                ) : (
                  <>
                    <b>Bu serviste {ocoHint.scope} seçilirse OCO sorulur.</b>{' '}
                    Form gönderilince iş hemen başlamaz; bir sonraki adımda OCO numarası istenir ve kesinti penceresine göre planlanır. Diğer ortamlar için OCO gerekmez, iş doğrudan başlar.
                  </>
                )}
                {gates?.smart && (
                  <> Ayrıca bu servis <b>Smart onayı</b> gerektirir: iş, onay geldikten sonra tetiklenir.</>
                )}
              </div>
            </div>
          )}

          {/* OCO Kontrolu paneli — acikken form alanlari GIZLENIR: kullanicinin bu
              noktada verecegi tek karar OCO ile ilgili, alanlari tekrar duzenlemesi
              kafa karistirici olurdu (degerler state'te duruyor, geri donunce kaybolmaz). */}
          {!loading && !jobId && ocoState && (!pendingTicket || ocoState.phase === 'done') && (
            <div className="space-y-3">
              {/* 'done' asamasinda bu baslik CIZILMEZ: sonuc metni asagidaki yesil kartta
                  zaten var, ikisi birden basilinca ayni cumle ekranda iki kez gorunuyordu
                  (2026-09-22 kullanici bildirimi). */}
              {ocoState.phase !== 'done' && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-[15px] font-bold text-amber-900">
                    Production talebi — OCO kontrolü
                  </p>
                  <p className="text-[13px] text-amber-800 mt-1 leading-relaxed">
                    {ocoState.message ||
                      'Bu iş PRODUCTION ortamına yöneliktir; devam etmek için OCO kaydı gerekir.'}
                  </p>
                </div>
              )}

              {ocoState.phase === 'ask' && (
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-[var(--text-secondary)]">
                    OCO Numarası
                  </label>
                  <div className="flex items-center gap-2">
                    <TextInput
                      className="font-mono flex-1"
                      value={ocoNumber}
                      placeholder="ör. 22502813"
                      onChange={(e) => setOcoNumber(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={ocoLookup}
                      disabled={ocoBusy || !ocoNumber.trim()}
                      className="btn-primary px-4 py-2 text-sm whitespace-nowrap"
                    >
                      {ocoBusy ? 'Sorgulanıyor…' : 'Sorgula'}
                    </button>
                  </div>
                </div>
              )}

              {ocoState.phase === 'decide' && ocoState.info && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-[var(--border)] p-3.5 space-y-1.5 text-[13px]">
                    <div className="flex justify-between gap-3">
                      <span className="text-[var(--text-muted)]">OCO</span>
                      <span className="font-mono tabular-nums font-semibold text-[var(--text-primary)]">
                        {ocoState.info.ocoNumber}
                      </span>
                    </div>
                    {ocoState.info.subject && (
                      <div className="flex justify-between gap-3">
                        <span className="text-[var(--text-muted)]">Konu</span>
                        <span className="text-right">{ocoState.info.subject}</span>
                      </div>
                    )}
                    <div className="flex justify-between gap-3">
                      <span className="text-[var(--text-muted)]">Kesinti başlangıcı</span>
                      <span className="font-mono tabular-nums">{ocoState.info.startText}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-[var(--text-muted)]">Kesinti bitişi</span>
                      <span className="font-mono tabular-nums">{ocoState.info.endText}</span>
                    </div>
                    <div className="flex justify-between gap-3 pt-1 border-t border-[var(--border)]">
                      <span className="text-[var(--text-muted)]">Tetiklenebilir aralık</span>
                      <span className="font-mono tabular-nums font-semibold text-[var(--text-primary)]">
                        {ocoState.info.windowStartText} — {ocoState.info.windowEndText}
                      </span>
                    </div>
                    {ocoState.info.equal && (
                      <p className="text-[11px] text-[var(--text-muted)] pt-1">
                        OCO'da tek bir an verilmiş; bu nedenle pencere 2 saat olarak uygulandı.
                      </p>
                    )}
                  </div>

                  {ocoState.info.phase === 'expired' && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      OCO kaydınızı kaçırdınız. Lütfen yeni bir OCO veya Problem kaydı açarak tekrar
                      işlem deneyiniz.
                    </div>
                  )}

                  {ocoState.info.phase === 'inside' && (
                    <button
                      type="button"
                      onClick={() => launch()}
                      disabled={launching}
                      className="btn-primary w-full px-4 py-2.5 text-sm"
                    >
                      Kesinti penceresi açık — işi şimdi başlat
                    </button>
                  )}

                  {ocoState.info.phase === 'before' && (
                    <div className="space-y-2.5">
                      {/* Bu iki kutu SECENEK; eskiden biri dolu mavi bir dugme, digeri
                          cizgili bir dugmeydi ve "hangisi secili" izlenimi veriyordu.
                          Ikisi de AYNI agirlikta kart oldu: solda renkli bir serit,
                          kalin baslik + acik gri aciklama, sagda ok. Fark rengin
                          ANLAMINDA: mavi = Portal yapar, gri = siz yaparsiniz. */}
                      <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
                        Nasıl ilerlemek istersiniz?
                      </p>
                      <button
                        type="button"
                        onClick={() => launch('schedule')}
                        disabled={launching}
                        className={ocoOptionCard}
                        style={{ borderLeft: '4px solid var(--accent)' }}
                      >
                        <CalendarDaysIcon className="w-5 h-5 flex-shrink-0 mt-0.5 text-[var(--accent)]" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-semibold text-[var(--text-primary)]">
                            Otomatik tetikle
                          </span>
                          <span className="block text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
                            Portal işi{' '}
                            <b className="font-semibold text-[var(--text-secondary)] tabular-nums">
                              {ocoState.info.windowStartText}
                            </b>{' '}
                            saatinde kendisi başlatır. Bu ekranı kapatabilirsiniz.
                          </span>
                        </span>
                        <ChevronRightIcon className="w-4 h-4 flex-shrink-0 mt-1 text-[var(--text-muted)]" />
                      </button>
                      <button
                        type="button"
                        onClick={() => launch('later')}
                        disabled={launching}
                        className={ocoOptionCard}
                        style={{ borderLeft: '4px solid var(--text-muted)' }}
                      >
                        <UserIcon className="w-5 h-5 flex-shrink-0 mt-0.5 text-[var(--text-muted)]" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-semibold text-[var(--text-primary)]">
                            Kendim çalıştıracağım
                          </span>
                          <span className="block text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
                            Şimdi hiçbir şey başlatılmaz. Pencere açıkken (
                            <b className="font-semibold text-[var(--text-secondary)] tabular-nums">
                              {ocoState.info.windowStartText} — {ocoState.info.windowEndText}
                            </b>
                            ) tekrar gelip başlatırsınız.
                          </span>
                        </span>
                        <ChevronRightIcon className="w-4 h-4 flex-shrink-0 mt-1 text-[var(--text-muted)]" />
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setOcoState({ phase: 'ask' });
                    }}
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"
                  >
                    ← Başka bir OCO numarası gir
                  </button>
                </div>
              )}

              {ocoState.phase === 'done' && (
                <div
                  data-testid="oco-done"
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 space-y-2.5"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircleIcon className="w-5 h-5 shrink-0 text-emerald-600" />
                    <p className="text-[15px] font-bold text-emerald-900">
                      {ocoState.done?.kind === 'deferred'
                        ? 'İş başlatılmadı'
                        : ocoState.done?.kind === 'smart-first'
                          ? 'Smart onay talebi açıldı'
                          : 'İş kesinti penceresine zamanlandı'}
                    </p>
                  </div>

                  {ocoState.done?.externalTicketId && (
                    <div
                      data-testid="oco-smart-no"
                      className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-white px-3 py-2"
                    >
                      <span className="text-[12px] font-semibold text-emerald-900">Smart Kayıt No</span>
                      <span
                        className="font-mono text-[13px] font-bold text-emerald-900 truncate"
                        title={ocoState.done.externalTicketId}
                      >
                        {ocoState.done.externalTicketId}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const no = ocoState.done?.externalTicketId;
                          if (no) navigator.clipboard?.writeText(no);
                        }}
                        className="ml-auto text-[11px] font-medium text-emerald-700 hover:text-emerald-900 transition"
                        title="Smart kayıt numarasını kopyala"
                      >
                        Kopyala
                      </button>
                    </div>
                  )}

                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px] text-emerald-900">
                    {ocoState.info?.ocoNumber && (
                      <>
                        <dt className="font-semibold">OCO kaydı</dt>
                        <dd className="font-mono">{ocoState.info.ocoNumber}</dd>
                      </>
                    )}
                    {ocoState.info && (
                      <>
                        <dt className="font-semibold">Kesinti penceresi</dt>
                        <dd className="font-mono tabular-nums">
                          {ocoState.info.windowStartText} — {ocoState.info.windowEndText}
                        </dd>
                      </>
                    )}
                    {ocoState.done?.awxScheduleId != null && (
                      <>
                        <dt className="font-semibold">AWX zamanlaması</dt>
                        <dd className="font-mono">#{ocoState.done.awxScheduleId}</dd>
                      </>
                    )}
                  </dl>

                  <p className="text-[12px] leading-relaxed text-emerald-900">
                    {ocoState.done?.kind === 'smart-first' ? (
                      <>
                        Onayı <b>bugün, mesai içinde</b> verebilirsiniz;
                        kesinti saatini beklemenize gerek yok. Onay verildiği anda iş{' '}
                        {ocoState.done.runAtText} kesinti penceresine zamanlanır
                        ve o saatte kendiliğinden çalışır. Onay pencere açıldıktan sonra gelirse ve pencere
                        hâlâ açıksa iş hemen başlar. Durumu aşağıdaki kutudan ve "Taleplerim" panelinden
                        izleyebilirsiniz.
                      </>
                    ) : ocoState.done?.kind === 'awx' ? (
                      <>
                        İş AWX'te zamanlandı; {ocoState.done.runAtText} saatinde AWX tarafından tetiklenecek.
                        Portal kapalı olsa bile çalışır. Bu ekranı kapatabilirsiniz.
                      </>
                    ) : ocoState.done?.kind === 'portal' ? (
                      <>
                        İş {ocoState.done.runAtText} saatine zamanlandı. Bu serviste Smart onayı da gerektiği
                        için tetikleme Portal üzerinden yapılacak; Smart talebi o saatte açılacağından onayın
                        da o sırada verilmesi gerekir.
                      </>
                    ) : (
                      ocoState.message
                    )}
                  </p>
                </div>
              )}
            </div>
          )}

          {!loading && !jobId && !pendingTicket && !ocoState && (
            <>
              {visibleFields.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] text-center py-4">
                  Bu template için ek parametre gerekmez.
                </p>
              ) : (
                <div className="space-y-4">
                  {visibleFields.map((f) => {
                    const id = `f-${f.name}`;
                    const err = submitAttempted || touched.has(f.name) ? fieldError(f) : null;
                    const val = values[f.name] || '';
                    const set = (v: string) => setValues((s) => ({ ...s, [f.name]: v }));
                    const onBlur = () => setTouched((t) => new Set(t).add(f.name));
                    return (
                      <Field
                        key={f.name}
                        label={f.label}
                        htmlFor={id}
                        required={f.required}
                        hint={f.description}
                        error={err}
                      >
                        {f.choicesSource ? (
                          <DynamicChoiceSelect
                            id={id}
                            source={f.choicesSource}
                            values={values}
                            value={val}
                            onChange={set}
                            onBlur={onBlur}
                            error={!!err}
                            multiple={f.type === 'multiselect'}
                          />
                        ) : f.type === 'multiselect' ? (
                          // COKLU SECIM = onay kutulari (2026-09-16: "overwrite edilecek dosyalari
                          // tikle secebileyim"). Deger satir sonu ile birlesik; sunucu listeye cevirir.
                          <div className={`rounded-lg border p-2 space-y-0.5 ${err ? 'border-red-400' : 'border-[var(--border)]'}`} id={id} onBlur={onBlur}>
                            {f.choices.map((c) => {
                              const picked = new Set(splitMulti(val));
                              return (
                                <label key={c} className="flex items-center gap-2 text-[12px] cursor-pointer py-0.5">
                                  <input
                                    type="checkbox"
                                    checked={picked.has(c)}
                                    onChange={() => {
                                      if (picked.has(c)) picked.delete(c);
                                      else picked.add(c);
                                      set(f.choices.filter((x) => picked.has(x)).join(MULTI_SEP));
                                    }}
                                  />
                                  <span>{f.choiceLabels?.[c] ?? c}</span>
                                </label>
                              );
                            })}
                            <div className="text-[11px] text-[var(--text-muted)] pt-1">{splitMulti(val).length} / {f.choices.length} seçili</div>
                          </div>
                        ) : f.type === 'multiplechoice' ? (
                          <Select
                            id={id}
                            error={!!err}
                            value={val}
                            onChange={(e) => set(e.target.value)}
                            onBlur={onBlur}
                          >
                            <option value="">Seçin…</option>
                            {f.choices.map((c) => (
                              <option key={c} value={c}>
                                {f.choiceLabels?.[c] ?? c}
                              </option>
                            ))}
                          </Select>
                        ) : f.type === 'textarea' ? (
                          <Textarea
                            id={id}
                            rows={3}
                            error={!!err}
                            className="font-mono"
                            value={val}
                            onChange={(e) => set(e.target.value)}
                            onBlur={onBlur}
                          />
                        ) : (
                          <TextInput
                            id={id}
                            error={!!err}
                            type={
                              f.type === 'integer' || f.type === 'float'
                                ? 'number'
                                : f.type === 'password'
                                  ? 'password'
                                  : 'text'
                            }
                            value={val}
                            onChange={(e) => set(e.target.value)}
                            onBlur={onBlur}
                            min={f.min}
                            max={f.max}
                          />
                        )}
                      </Field>
                    );
                  })}
                </div>
              )}

              {/* Built-in AWX "prompt on launch" seçenekleri — yalnızca AWX'in ilgili
                  ask_*_on_launch bayrağını gerçekten açtığı alanlar gösterilir. */}
              {launchOptions &&
                (launchOptions.limit.enabled ||
                  launchOptions.forks.enabled ||
                  launchOptions.jobTags.enabled ||
                  launchOptions.skipTags.enabled ||
                  launchOptions.verbosity.enabled ||
                  launchOptions.jobType.enabled) && (
                  <div className="space-y-4 pt-3 border-t border-[var(--border)]">
                    <p className="section-label">Çalışma Zamanı Seçenekleri</p>
                    {launchOptions.limit.enabled && (
                      <Field label="Limit" htmlFor="lo-limit" hint="host_pattern veya boş bırak">
                        <TextInput
                          id="lo-limit"
                          type="text"
                          placeholder="host_pattern"
                          value={limit}
                          onChange={(e) => setLimit(e.target.value)}
                        />
                      </Field>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      {launchOptions.forks.enabled && (
                        <Field label="Forks" htmlFor="lo-forks">
                          <TextInput
                            id="lo-forks"
                            type="number"
                            min={0}
                            placeholder="varsayılan"
                            value={forks}
                            onChange={(e) => setForks(e.target.value)}
                          />
                        </Field>
                      )}
                      {launchOptions.verbosity.enabled && (
                        <Field label="Verbosity" htmlFor="lo-verb">
                          <Select
                            id="lo-verb"
                            value={verbosity}
                            onChange={(e) => setVerbosity(e.target.value)}
                          >
                            {[0, 1, 2, 3, 4].map((v) => (
                              <option key={v} value={v}>
                                {v}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      )}
                    </div>
                    {launchOptions.jobTags.enabled && (
                      <Field
                        label="Job Tags"
                        htmlFor="lo-jt"
                        hint="virgülle ayır — ör: deploy,restart"
                      >
                        <TextInput
                          id="lo-jt"
                          type="text"
                          placeholder="deploy,restart"
                          value={jobTags}
                          onChange={(e) => setJobTags(e.target.value)}
                        />
                      </Field>
                    )}
                    {launchOptions.skipTags.enabled && (
                      <Field label="Skip Tags" htmlFor="lo-st" hint="virgülle ayır — ör: slow">
                        <TextInput
                          id="lo-st"
                          type="text"
                          placeholder="slow"
                          value={skipTags}
                          onChange={(e) => setSkipTags(e.target.value)}
                        />
                      </Field>
                    )}
                    {launchOptions.jobType.enabled && (
                      <Field label="Job Type" htmlFor="lo-type" required>
                        <Select
                          id="lo-type"
                          value={jobType}
                          onChange={(e) => setJobType(e.target.value)}
                        >
                          <option value="run">Run</option>
                          <option value="check">Check</option>
                        </Select>
                      </Field>
                    )}
                  </div>
                )}
            </>
          )}

          {pendingTicket && (
            <div className="space-y-3 animate-fade-in text-center py-6">
              {pendingTicket.status === 'PENDING' && (
                <>
                  <div className="mx-auto w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    Smart üzerinde onay bekleniyor…
                  </p>
                  {pendingTicket.externalTicketId && (
                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                      Smart Kayıt No:{' '}
                      <span className="font-mono">{pendingTicket.externalTicketId}</span>
                    </p>
                  )}
                  <p className="text-xs text-[var(--text-muted)]">
                    Lütfen ilgili Smart kaydını takip edin — <strong>Kapama Onayı</strong> adımında{' '}
                    <strong>Tamamla</strong>'ya basmadan otomasyon tetiklenmeyecektir.{' '}
                    {ocoState?.done?.kind === 'smart-first' ? (
                      <>
                        Onay verildiğinde iş <strong>hemen değil</strong>, {ocoState.done.runAtText}{' '}
                        kesinti penceresinde çalışacak.
                      </>
                    ) : (
                      <>Onaylanınca iş otomatik başlar, bu pencereyi kapatabilirsiniz.</>
                    )}
                  </p>
                  <div className="text-left text-xs bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mx-auto max-w-sm text-amber-800">
                    Kapama Onayı tamamlandıktan ortalama 5 dakika sonra Teams bildirimi gelmezse{' '}
                    {onCall?.ok && onCall.name ? (
                      <>
                        günün nöbetçisi <strong>{onCall.name}</strong>
                        {onCall.intercom
                          ? ` (dahili: ${onCall.intercom})`
                          : onCall.phone
                            ? ` (${onCall.phone})`
                            : ''}{' '}
                        ile iletişime geçin.
                      </>
                    ) : (
                      <>günün nöbetçisiyle iletişime geçin.</>
                    )}
                  </div>
                </>
              )}
              {pendingTicket.status === 'REJECTED' && (
                <>
                  <p className="text-sm font-medium text-red-600">Smart talebi reddedildi.</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    İş başlatılmadı. Detay için Smart talep{' '}
                    {pendingTicket.externalTicketId
                      ? `#${pendingTicket.externalTicketId}`
                      : `#${pendingTicket.id}`}
                    'e bakın.
                  </p>
                </>
              )}
              {pendingTicket.status === 'TIMEOUT' && (
                <>
                  <p className="text-sm font-medium text-amber-700">
                    Smart onayı zaman aşımına uğradı.
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {pendingTicket.errorMessage || 'İş başlatılmadı.'}
                  </p>
                </>
              )}
              {pendingTicket.status === 'ERROR' && (
                <>
                  <p className="text-sm font-medium text-red-600">
                    Talep onaylandı ama iş başlatılamadı.
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {pendingTicket.errorMessage || 'Lütfen sistem yöneticinize başvurun.'}
                  </p>
                </>
              )}
              {pendingTicket.status === 'SCHEDULED' && (
                <>
                  <p className="text-sm font-medium text-emerald-700">
                    Onay alındı — iş kesinti penceresine zamanlandı.
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {pendingTicket.errorMessage ||
                      'İş, OCO kaydındaki kesinti penceresinde kendiliğinden çalışacak; tekrar bir işlem yapmanız gerekmiyor.'}
                  </p>
                </>
              )}
              {!RENDERED_TICKET_STATES.includes(pendingTicket.status) && (
                <p className="text-sm text-[var(--text-secondary)]">
                  Smart talebi durumu: <b>{pendingTicket.status}</b>
                  {pendingTicket.externalTicketId ? (
                    <>
                      {' '}
                      — kayıt no <span className="font-mono">{pendingTicket.externalTicketId}</span>
                    </>
                  ) : null}
                </p>
              )}
            </div>
          )}

          {jobId && (
            <div className="space-y-3 animate-fade-in flex-1 min-h-0 flex flex-col">
              <p className="text-sm font-medium text-[var(--text-primary)] text-center flex-shrink-0">
                İş başlatıldı — AWX Job #{jobId}
              </p>
              {trackedJob && (
                <div className="flex-1 min-h-0 flex flex-col">
                  <AnsibleLogTerminal
                    output={trackedJob.output}
                    status={trackedJob.status}
                    title={`${item.title} — AWX job`}
                    placeholder="AWX job başlatıldı — konsol çıktısı akmaya başlayacak…"
                    size={floatSize.h === 'auto' ? 'compact' : 'fill'}
                  />
                  {trackedJob.pollErr && (
                    <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 flex-shrink-0">
                      {trackedJob.pollErr}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[var(--border)] flex items-center justify-between gap-3 flex-shrink-0">
          {/* INLINE FORMDA "Iptal"IN KAPATACAGI BIR PENCERE YOK (2026-09-22, kullanici:
              "Iptal'e basmanin bir anlami yok, sayfa surekli ayni kaliyor"): servis
              kartin icinde acik duruyor, onClose yalnizca formu sifirliyordu ve bos
              formda hicbir sey degismis gibi gorunmuyordu. Artik dugme yaptigi isi
              soyluyor: sonuc ekranindayken "Yeni Talep", formdayken "Formu Temizle" —
              temizlenecek bir sey yoksa pasif. Modal modunda davranis aynen korunur. */}
          {inline ? (
            <button
              type="button"
              onClick={onClose}
              disabled={jobStreaming || (!resultView && !formDirty)}
              title={
                jobStreaming
                  ? 'İş çalışıyor — Ansible çıktısı bu ekranda akıyor. İş bitince yeni talep açabilirsiniz (iş alt çubuktan da izlenir).'
                  : resultView
                    ? 'Formu sıfırlayıp yeni bir talep oluşturun'
                    : formDirty
                      ? 'Girdiğiniz değerleri temizler'
                      : 'Temizlenecek bir şey yok — form zaten boş.'
              }
              className="text-sm font-medium inline-flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[var(--text-secondary)]"
            >
              <ArrowPathIcon className="w-4 h-4" />
              {jobStreaming ? 'İş çalışıyor…' : resultView ? 'Yeni Talep' : 'Formu Temizle'}
            </button>
          ) : (
            <button
              onClick={onClose}
              className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
            >
              {resultView ? 'Kapat' : 'İptal'}
            </button>
          )}
          {!jobId && !pendingTicket && !ocoState && (
            <button
              onClick={() => launch()}
              disabled={launching || loading || hasAnyFieldError}
              title={
                missingRequiredLabels.length > 0
                  ? `Zorunlu alan(lar) eksik: ${missingRequiredLabels.join(', ')}`
                  : hasAnyFieldError
                    ? 'Bazı alanlar geçersiz — kırmızı uyarıları düzeltin.'
                    : undefined
              }
              className="btn-primary px-5 py-2 text-sm flex items-center gap-2"
            >
              {launching ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <PlayIcon className="w-4 h-4" />
              )}
              İş Başlat
            </button>
          )}
        </div>
    </>
  );
  if (inline) return <div className="flex flex-col -m-5">{body}</div>;
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
      {...backdrop}
    >
      <div
        ref={floatRef}
        className="bg-[var(--bg-surface)] rounded-2xl shadow-2xl flex flex-col animate-modal-pop relative"
        style={floatStyle}
      >
        {/* Temiz başlık — ikon + başlık + alt-metin + kapat; aynı zamanda sürükle-taşı tutamacı. */}
        <div
          onPointerDown={startMove}
          className="flex items-start gap-3 px-5 py-4 border-b border-[var(--border)] flex-shrink-0 cursor-move select-none"
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--accent-glow)' }}
          >
            <PlayIcon className="w-5 h-5 text-[var(--accent)]" />
          </div>
          <div className="flex-1 min-w-0">
            <h2
              className="text-[15px] font-bold text-[var(--text-primary)] truncate"
              title={item.title}
            >
              {item.title}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Parametreleri doldurup işi başlatın.
            </p>
          </div>
          <button
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
            className="p-1.5 -mr-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors flex-shrink-0"
            aria-label="Kapat"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {body}
        <ResizeHandle onPointerDown={startResize} />
      </div>
    </div>,
    document.body,
  );
}

// ── History Modal ─────────────────────────────────────────────────────────────

// item verilirse yalniz o servisin (AWX sunucu + template) gecmisi (2026-09-21).
function HistoryModal({ onClose, item }: { onClose: () => void; item?: AnsibleSsItem | null }) {
  // Salt okunur pencere: gercek arka plan tiklamasi kapatir, surukleme kapatmaz.
  const backdrop = useBackdropDismiss(onClose);
  const [history, setHistory] = useState<JobHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  // Geçmişteki bir job'a tıklayınca logu aynı modalda gösterilir (master-detail).
  const [selected, setSelected] = useState<JobHistoryRecord | null>(null);
  const [logOutput, setLogOutput] = useState('');
  const [logStatus, setLogStatus] = useState('');
  const [logLoading, setLogLoading] = useState(false);
  const [logErr, setLogErr] = useState('');

  useEffect(() => {
    ansibleApi
      .history(30)
      .then((r) => setHistory((r.history || []).filter((h) => !item || (Number(h.template_id) === Number(item.awxTemplateId) && Number(h.awx_server_id) === Number(item.awxServerId)))))
      .finally(() => setLoading(false));
  }, [item]);

  useEffect(() => {
    if (!selected || !selected.job_id) return;
    let alive = true;
    setLogLoading(true);
    setLogErr('');
    setLogOutput('');
    ansibleApi
      .ssJobStatus(selected.awx_server_id, selected.job_id)
      .then((r) => {
        if (!alive) return;
        setLogStatus(r.status || selected.status);
        setLogOutput(r.output || r.resultTraceback || r.jobExplanation || '');
      })
      .catch((e) => {
        if (alive) setLogErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLogLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selected]);

  const statusBadge: Record<string, string> = {
    successful: 'bg-emerald-100 text-emerald-700',
    failed: 'bg-red-100 text-red-700',
    error: 'bg-red-100 text-red-700',
    canceled: 'bg-amber-100 text-amber-700',
    running: 'bg-blue-100 text-blue-700',
    pending: 'bg-gray-100 text-gray-600',
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm overflow-y-auto p-4">
      <div
        className="min-h-full flex items-center justify-center"
        {...backdrop}
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[calc(100dvh-2rem)] my-4">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
              {selected ? (
                <button
                  onClick={() => setSelected(null)}
                  className="flex items-center gap-1.5 text-[var(--accent)] hover:text-[var(--accent-dark)]"
                >
                  <ArrowLeftIcon className="w-4 h-4" /> Geçmiş
                </button>
              ) : (
                <>
                  <ClockIcon className="w-5 h-5 text-[var(--accent)]" /> {item ? `${item.title} — geçmiş (son 30 gün)` : 'İş Geçmişi (Son 30 Gün)'}
                </>
              )}
            </h2>
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {selected ? (
              // ── Detay: seçilen geçmiş job'ın logu (canlı terminal) ──
              <div className="p-5 space-y-3 animate-fade-in">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{selected.template_name}</p>
                    <p className="text-xs text-gray-500">
                      {selected.username} · {fmtDateTime(selected.started_at)} · job #
                      {selected.job_id}
                    </p>
                  </div>
                  {/* CANLI durum (kayıttaki stale 'pending' değil) — AWX'ten çekilen gerçek durum. */}
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge[logStatus || selected.status] || 'bg-gray-100 text-gray-600'}`}
                  >
                    {logStatus || selected.status}
                  </span>
                </div>
                {logErr && (
                  <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                    {logErr}
                  </div>
                )}
                {logLoading ? (
                  <div className="flex items-center justify-center h-20">
                    <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <AnsibleLogTerminal
                    output={logOutput}
                    status={logStatus || selected.status}
                    title={`${selected.template_name} — job #${selected.job_id}`}
                    placeholder={
                      ['pending', 'waiting', 'running', ''].includes(logStatus)
                        ? 'Job hâlâ çalışıyor — konsol çıktısı henüz oluşmadı.'
                        : "Bu job için AWX'te log/traceback bulunamadı (job eskimiş/temizlenmiş olabilir)."
                    }
                  />
                )}
              </div>
            ) : loading ? (
              <SkeletonList rows={4} />
            ) : history.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">Son 30 günde iş yok.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[11px] uppercase text-gray-500 tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Template</th>
                    <th className="px-4 py-3 text-left font-semibold">Kullanıcı</th>
                    <th className="px-4 py-3 text-left font-semibold">Durum</th>
                    <th className="px-4 py-3 text-left font-semibold">Tarih</th>
                    <th className="px-4 py-3 text-left font-semibold"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {history.map((h) => (
                    <tr
                      key={h.id}
                      onClick={() => h.job_id && setSelected(h)}
                      className={`hover:bg-blue-50/40 transition-colors ${h.job_id ? 'cursor-pointer' : 'opacity-70'}`}
                      title={h.job_id ? 'Logu görüntüle' : 'Bu kayıt için job ID yok'}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">{h.template_name}</td>
                      <td className="px-4 py-3 text-gray-500">{h.username}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge[h.status] || 'bg-gray-100 text-gray-600'}`}
                        >
                          {h.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{fmtDateTime(h.started_at)}</td>
                      <td className="px-4 py-3 text-right">
                        {h.job_id ? (
                          <span className="text-xs text-[var(--accent)] font-medium">Log →</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Ansible Tab ───────────────────────────────────────────────────────────────

// 2026-09-21: servisler sol menude tek tek listelenir (kullanici istegi). `selected`:
//   null      -> genel bakis (kart izgarasi, eski gorunum)
//   'new'     -> yeni servis formu (admin)
//   <item id> -> o servisin ayrinti karti (Baslat, Gecmis, Alanlari Yonet, Sil)
// Liste degisince `onItems` ile ust bilesene bildirilir (menu oradan kurulur).
function AnsibleSection({ isAdmin, selected = null, onItems, onSelect }: {
  isAdmin: boolean;
  selected?: string | null;
  onItems?: (items: AnsibleSsItem[]) => void;
  onSelect?: (id: string | null) => void;
}) {
  const [items, setItems] = useState<AnsibleSsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [launchItem, setLaunchItem] = useState<AnsibleSsItem | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [addForm, setAddForm] = useState(false);
  const [draft, setDraft] = useState({
    title: '',
    description: '',
    awxServerId: 1,
    awxTemplateId: 0,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [fieldsItem, setFieldsItem] = useState<AnsibleSsItem | null>(null);
  const [formEpoch, setFormEpoch] = useState(0); // inline formu sifirlamak icin
  // Sifirlama GORUNUR olmali (2026-09-22): bos bir formda "Formu Temizle"ye basinca
  // ekranda hicbir sey degismiyordu ve dugme calismiyor sanildi. Kisa bir bildirim
  // basiyoruz; kendiliginden kayboluyor.
  const [resetNote, setResetNote] = useState(false);
  useEffect(() => {
    if (!resetNote) return;
    const timer = setTimeout(() => setResetNote(false), 2500);
    return () => clearTimeout(timer);
  }, [resetNote]);

  const reload = useCallback(() => {
    setLoading(true);
    ansibleApi
      .ssItems()
      .then((r) => setItems(r.items || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);
  // Yalnizca YUKLENMIS liste bildirilir: mount anindaki bos [] ust bilesenin (sayfa
  // acilisinda URL slug'ini cozmek icin zaten yukledigi) listesini silip slug'i
  // "bilinmiyor"a dusuruyordu (2026-09-21).
  useEffect(() => {
    if (loading) return;
    onItems?.(isAdmin ? items : items.filter((i) => i.enabled));
  }, [items, isAdmin, onItems, loading]);
  // Menuden "Servis Ekle" secilince form acik gelsin
  useEffect(() => {
    if (selected === 'new') { setAddForm(true); setSaveError(''); }
  }, [selected]);

  async function deleteItem(id: string) {
    if (!confirm('Bu servisi kaldır?')) return;
    await ansibleApi.deleteSsItem(id);
    onSelect?.(null);
    reload();
  }

  async function saveItem() {
    if (!draft.title.trim() || !draft.awxTemplateId) return;
    setSaving(true);
    setSaveError('');
    try {
      // Backend artık AWX'e karşı GERÇEKTEN doğruluyor (var mı, allowlist'te mi,
      // aynı sunucu+template zaten kayıtlı mı) — bu yüzden hata burada mutlaka
      // gösterilmeli, aksi halde admin sessizce geçersiz bir kayıt oluşturduğunu sanır.
      const r = await ansibleApi.saveSsItem({ ...draft, enabled: true, order: items.length + 1 });
      if (!r.ok) {
        setSaveError(r.message || 'Kaydedilemedi.');
        return;
      }
      setDraft({ title: '', description: '', awxServerId: 1, awxTemplateId: 0 });
      setAddForm(false);
      reload();
      if (r.item) onSelect?.(r.item.id);
      // Template otomatik çekilip kaydedildiği için, kullanıcı launch ekranında
      // göreceği TÜM alanlarla eksiksiz karşılaşsın diye alan incelemesi/gizleme
      // kararı SONRADAN erişilen ayrı bir aksiyon değil, kayıt anının doğal bir
      // devamı olarak HEMEN açılır.
      if (r.item) setFieldsItem(r.item);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );

  // enabled=false yalnizca NORMAL kullanicilardan gizlenir (Admin > Self Service'teki
  // gorunurluk anahtari) — admin her zaman TUM kayitlari gorur ve calistirabilir,
  // aksi halde bir servisi kapatan admin onu bir daha o ekrandan yonetemezdi.
  const visibleItems = isAdmin ? items : items.filter((i) => i.enabled);
  const selectedItem = selected && selected !== 'new' ? visibleItems.find((i) => i.id === selected) || null : null;

  // Tek servis (menuden secildi): form DOGRUDAN kartin icinde — baslik zaten kart
  // basliginda, o yuzden ikinci bir kart + "Baslat" dugmesi YOK. Ust satir: kucuk eylemler.
  if (selectedItem) {
    const item = selectedItem;
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {isAdmin && !item.enabled && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">kullanıcılara kapalı</span>
          )}
          <span style={{ color: 'var(--text-muted)' }}>AWX template #{item.awxTemplateId} · sunucu {item.awxServerId}</span>
          {resetNote && (
            <span
              role="status"
              data-testid="ss-form-reset-note"
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border animate-fade-in"
              style={{ borderColor: 'var(--status-success)', color: 'var(--status-success)', background: 'var(--status-success-bg)' }}
            >
              <CheckCircleIcon className="w-3.5 h-3.5" /> Form sıfırlandı
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            <button onClick={() => setShowHistory(true)} className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] rounded-lg border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }} title="Bu servisin geçmişi">
              <ClockIcon className="w-3.5 h-3.5" /> Geçmiş
            </button>
            {isAdmin && (
              <>
                <button onClick={() => setFieldsItem(item)} className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] rounded-lg border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                  <AdjustmentsHorizontalIcon className="w-3.5 h-3.5" /> Alanları Yönet
                </button>
                <button onClick={() => deleteItem(item.id)} className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] rounded-lg border" style={{ borderColor: 'var(--status-danger)', color: 'var(--status-danger)' }}>
                  <TrashIcon className="w-3.5 h-3.5" /> Sil
                </button>
              </>
            )}
          </span>
        </div>
        <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          {/* key: servis degisince form sifirdan kurulsun; onClose (Iptal/Kapat) = ayni servisi yeniden ac */}
          <SurveyModal
            key={item.id + ':' + formEpoch}
            item={item}
            inline
            onClose={() => {
              setFormEpoch((n) => n + 1);
              setResetNote(true);
            }}
          />
        </div>
        {showHistory && <HistoryModal item={item} onClose={() => setShowHistory(false)} />}
        {fieldsItem && <FieldOverridesModal item={fieldsItem} onClose={() => setFieldsItem(null)} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{isAdmin ? 'Soldaki menüden bir servis seçin ya da "Servis Ekle" ile yeni servis tanımlayın.' : 'Soldaki menüden bir servis seçip "Başlat" ile AWX işini açın.'}</p>
        <div className="flex gap-2">
          <button
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl border transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <ClockIcon className="w-4 h-4" />
            Geçmiş
          </button>
          {isAdmin && (
            <button
              onClick={() => {
                setAddForm(!addForm);
                setSaveError('');
              }}
              className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl"
            >
              <PlusIcon className="w-4 h-4" />
              Servis Ekle
            </button>
          )}
        </div>
      </div>

      {isAdmin && addForm && (
        <div className="rounded-2xl border p-5 space-y-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <h3 className="text-sm font-bold">Yeni Ansible Servisi</h3>
          {saveError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              {saveError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-semibold text-gray-500 block mb-1">Servis Adı</label>
              <input
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="Ör: Sunucu Yeniden Başlatma"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-semibold text-gray-500 block mb-1">Açıklama</label>
              <input
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Kısa açıklama"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">
                AWX Sunucu ID
              </label>
              <input
                type="number"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                value={draft.awxServerId}
                onChange={(e) => setDraft((d) => ({ ...d, awxServerId: Number(e.target.value) }))}
                min={1}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">Template ID</label>
              <input
                type="number"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                value={draft.awxTemplateId || ''}
                onChange={(e) => setDraft((d) => ({ ...d, awxTemplateId: Number(e.target.value) }))}
                placeholder="AWX template ID"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                setAddForm(false);
                setSaveError('');
              }}
              className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5"
            >
              İptal
            </button>
            <button
              onClick={saveItem}
              disabled={saving || !draft.title.trim() || !draft.awxTemplateId}
              className="btn-primary px-4 py-1.5 text-sm"
            >
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </div>
      )}

      {visibleItems.length === 0 ? (
        <div className="rounded-2xl border flex items-center justify-center h-40" style={{ borderColor: 'var(--border-subtle)' }}>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {isAdmin
              ? 'Henüz Ansible servisi yok. Servis Ekle butonunu kullanın.'
              : 'Henüz Ansible servisi tanımlanmamış.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleItems
            .sort((a, b) => a.order - b.order)
            .map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border p-5 card-hover group relative"
                style={{ background: 'var(--bg-surface)', borderColor: item.enabled ? 'var(--border-subtle)' : 'var(--status-warning)', boxShadow: 'var(--shadow-sm)' }}
              >
                <div className="mb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-base">{item.title}</h3>
                      {/* enabled=false SADECE normal kullanicilardan gizler — admin her zaman
                        gorur ve calistirabilir; bu rozet admin'e bunu hatirlatir. */}
                      {isAdmin && !item.enabled && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                          kullanıcılara kapalı
                        </span>
                      )}
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
                        <button
                          onClick={() => setFieldsItem(item)}
                          title="Alanları Yönet"
                          className="p-1 text-gray-300 hover:text-[var(--accent)] rounded"
                        >
                          <AdjustmentsHorizontalIcon className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => deleteItem(item.id)}
                          title="Sil"
                          className="p-1 text-gray-300 hover:text-red-500 rounded"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                  {item.description && (
                    <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{item.description}</p>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Template #{item.awxTemplateId} · Server {item.awxServerId}
                  </span>
                  <button
                    onClick={() => setLaunchItem(item)}
                    className="btn-primary px-4 py-1.5 text-sm flex items-center gap-1.5"
                  >
                    <PlayIcon className="w-4 h-4" />
                    Başlat
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}

      {launchItem && <SurveyModal item={launchItem} onClose={() => setLaunchItem(null)} />}
      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} />}
      {fieldsItem && <FieldOverridesModal item={fieldsItem} onClose={() => setFieldsItem(null)} />}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

// OCO "nasil ilerleyelim" seceneklerinin ortak kart stili. Bilesen disinda duruyor
// ki her render'da yeni bir string kurulmasin ve iki secenek BIREBIR ayni gorunsun.
const ocoOptionCard =
  'w-full flex items-start gap-3 pl-3 pr-3 py-3 rounded-xl border border-[var(--border)] ' +
  'bg-[var(--bg-surface)] text-left transition-colors hover:bg-[var(--bg-elevated)] ' +
  'hover:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

/** Menu girisinden URL parcasi: "Nginx - RVP Operations" -> "nginx-rvp-operations".
 *  Turkce harfler sadelesir; ayni slug iki serviste cikarsa ikincisi "-<id>" alir. */
export function ssSlug(title: string): string {
  const tr: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
  return title
    .replace(/İ/g, 'i').replace(/I/g, 'i')
    .toLowerCase()
    .replace(/[çğıöşüâîû]/g, (c) => tr[c] || c)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'servis';
}

const FIXED_SLUG: Record<string, string> = { ip: 'ip-sorgu', openshift: 'openshift-sorgu', 'svc:new': 'servis-ekle' };

export default function SelfServicePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';
  // 2026-09-21: secili bolum URL'de yasar (/self-service/nginx-rvp-operations) — link
  // paylasilabilir, tarayici geri tusu calisir, yenileyince ayni servis acik kalir.
  const navigate = useNavigate();
  const { slug } = useParams<{ slug?: string }>();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [groups, setGroups] = useState<SelfServiceGroup[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  // Sol menudeki servis listesi (AnsibleSection yukler, buraya bildirir)
  const [ssItems, setSsItems] = useState<AnsibleSsItem[]>([]);
  const onSsItems = useCallback((list: AnsibleSsItem[]) => setSsItems(list), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        // Menu icin servis listesi de ILK yuklemede beklenir: URL'deki slug ancak liste
        // gelince cozulur; yoksa sayfa bir an "tumu"ne dusup sonra servise atlardi.
        const [r, x] = await Promise.all([selfServiceApi.get(), ansibleApi.ssItems().catch(() => ({ items: [] as AnsibleSsItem[] }))]);
        if (alive) setGroups(r.groups || []);
        if (alive) setSsItems(isAdmin ? x.items || [] : (x.items || []).filter((i) => i.enabled));
      } catch (e: unknown) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 2026-09-21: Admin Merkezi ile AYNI kabuk (kullanici istegi) — solda bolumlu menu, sagda
  // baslik + tek cumle aciklamali icerik karti. "Ansible" etiketi hala DB'den (/api/selfservice
  // -> groups); IP / OpenShift kontrolleri eskiden "Check" sekmesinin ic sekmesiydi, simdi
  // menude kendi basina iki giris.
  const ansibleGroup = groups.find((g) => g.groupKey === 'ansible');
  const ENTRIES: Record<string, { label: string; icon: React.ElementType; hint: string; muted?: boolean }> = {
    ansible: { label: `${ansibleGroup?.label || 'Ansible'} — tümü`, icon: CommandLineIcon, hint: 'Tanımlı Ansible servislerine genel bakış; her servis soldaki menüde ayrı bir giriştir.' },
    ip: { label: 'IP Sorgu', icon: GlobeAltIcon, hint: 'Bir IP ya da sunucu adının envanterde neye karşılık geldiğini bulun.' },
    openshift: { label: 'OpenShift Sorgu', icon: CubeIcon, hint: 'Namespace / uygulama envanterinde arama.' },
    'svc:new': { label: 'Servis Ekle', icon: PlusIcon, hint: 'AWX job template\'ini Portal\'a servis olarak tanımlayın; alanlar kayıttan sonra hemen düzenlenir.' },
  };
  // Her self servis ogesi menude ayri giris (2026-09-21, kullanici istegi)
  const SLUG: Record<string, string> = { ...FIXED_SLUG };
  const usedSlugs = new Set<string>(Object.values(FIXED_SLUG));
  const svcIds = [...ssItems].sort((a, b) => a.order - b.order).map((i) => {
    ENTRIES[`svc:${i.id}`] = { label: i.title, icon: PlayIcon, hint: i.description || `AWX template #${i.awxTemplateId}`, muted: !i.enabled };
    let sl = ssSlug(i.title);
    if (usedSlugs.has(sl)) sl = `${sl}-${i.id}`;
    usedSlugs.add(sl);
    SLUG[`svc:${i.id}`] = sl;
    return `svc:${i.id}` as TopTab;
  });
  const activeTop: TopTab = (slug && (Object.keys(SLUG).find((k) => SLUG[k] === slug) as TopTab | undefined)) || 'ansible';
  const setActiveTop = (id: TopTab) => navigate(id === 'ansible' ? '/self-service' : `/self-service/${SLUG[id]}`);
  // Bilinmeyen/silinmis slug: sessizce "tumu"ne don (liste yuklendikten sonra)
  useEffect(() => {
    if (!loading && slug && !Object.values(SLUG).includes(slug)) navigate('/self-service', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, slug, ssItems.length]);
  const SECTIONS: { title: string; icon: React.ElementType; ids: TopTab[] }[] = [
    { title: ansibleGroup?.label || 'Ansible', icon: CommandLineIcon, ids: ['ansible', ...svcIds, ...(isAdmin ? (['svc:new'] as TopTab[]) : [])] },
    { title: 'Kontrol', icon: MagnifyingGlassIcon, ids: ['ip', 'openshift'] },
  ];
  const current = ENTRIES[activeTop] || ENTRIES.ansible;
  const isAnsibleView = activeTop === 'ansible' || activeTop.startsWith('svc:');
  const ansibleSelected = activeTop === 'svc:new' ? 'new' : activeTop.startsWith('svc:') ? activeTop.slice(4) : null;
  const CurrentIcon = current.icon;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-spring-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Otomasyon</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            Ansible servisleri, IP ve OpenShift envanter kontrolü tek yerde.
          </p>
        </div>
        <button
          onClick={() => setShowHelp(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl border transition-colors flex-shrink-0"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
        >
          <QuestionMarkCircleIcon className="w-4 h-4" />
          Yardım
        </button>
      </div>

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          {err}
        </div>
      )}

      <div className="grid gap-4 ss-grid" style={{ gridTemplateColumns: 'minmax(11rem, 12.5rem) 1fr' }}>
        {/* Sol: bolumlu menu */}
        <nav aria-label="Otomasyon bölümleri" className="space-y-4 self-start lg:sticky lg:top-4">
          {SECTIONS.map((sec) => {
            const SIcon = sec.icon;
            return (
              <div key={sec.title}>
                <div className="flex items-center gap-1.5 px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  <SIcon className="w-3.5 h-3.5" /> {sec.title}
                </div>
                <ul className="space-y-0.5">
                  {sec.ids.map((id) => {
                    const e = ENTRIES[id];
                    const Icon = e.icon;
                    const active = activeTop === id;
                    return (
                      <li key={id}>
                        <button
                          onClick={() => setActiveTop(id)}
                          aria-current={active ? 'page' : undefined}
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-[13px] rounded-lg text-left transition-colors"
                          style={{
                            background: active ? 'var(--bg-elevated)' : 'transparent',
                            color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                            fontWeight: active ? 600 : 500,
                            boxShadow: active ? 'inset 3px 0 0 var(--accent)' : 'none',
                          }}
                        >
                          <Icon className="w-4 h-4 flex-shrink-0" style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }} />
                          <span className="truncate" title={e.label + (e.muted ? ' (kullanıcılara kapalı)' : '')} style={e.muted ? { opacity: 0.6 } : undefined}>{e.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        {/* Sag: icerik */}
        <section className="card overflow-hidden min-w-0">
          <header className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--bg-surface)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }}>
              <CurrentIcon className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold leading-tight">{current.label}</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{current.hint}</p>
            </div>
          </header>
          <div className="p-5">
            <div key={activeTop} style={{ animation: 'fadeIn 0.18s ease' }}>
              {isAnsibleView && (
                <AnsibleSection
                  isAdmin={isAdmin}
                  selected={ansibleSelected}
                  onItems={onSsItems}
                  onSelect={(id) => setActiveTop(id ? (`svc:${id}` as TopTab) : 'ansible')}
                />
              )}
              {activeTop === 'ip' && <IpCheckSection />}
              {activeTop === 'openshift' && <OpenshiftCheckSection />}
            </div>
          </div>
        </section>
      </div>

      <HelpModal
        open={showHelp}
        onClose={() => setShowHelp(false)}
        title="Otomasyon — Nasıl Kullanılır?"
        sections={SELF_SERVICE_HELP_SECTIONS}
      />
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @media (max-width: 900px) { .ss-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
