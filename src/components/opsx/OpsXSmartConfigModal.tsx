// src/components/opsx/OpsXSmartConfigModal.tsx — OpsX'in KENDI Smart onay yapilandirmasi.
//
// KULLANICI TALEBI (2026-10-06): "Nasil su an self service otomasyonundaki her bir job
// icin ayri ayri iclerine girdigim zaman Smart entegrasyonunu ve OCO kontrolunu
// ayarlayabiliyorum; OpsX icin de OpsX'in icine girdigimde sadece adminlere gozuken sag
// ustte, bu ayarlamayi yapabilecegim bir yer olsun. Yani admin panelinde olmasin."
//
// Onceki hal: OpsX'te TEK bir ortam degiskeni vardi (OPSX_SMART_METADATA_FIELDS), uc
// platform icin ortak; "Alanlari Getir" yoktu, onizleme yoktu. Metadata hic verilmezse
// `buildSmartMetadata` sabit {application, requestedBy} gonderiyor ve Smart bunu "400
// Invalid Request" ile reddediyor - yani OpsX production talebi ACILMIYORDU.
//
// ── NEDEN PLATFORM BASINA ───────────────────────────────────────────────────────────
// Flow key'ler zaten platform basina ayrilmisti (kullanici karari: onaylayanlar platform
// ekiplerine gore farklilasiyor). Metadata eslemesi de ayni sekilde ayrilir: uc farkli
// Smart flow'unun ElementName setinin AYNI oldugunu varsaymak yanlisti.
//
// ── OCO NEDEN YOK ───────────────────────────────────────────────────────────────────
// OpsX hicbir akista OCO numarasi TOPLAMIYOR, dolayisiyla kesinti penceresi
// dogrulanamaz. `opsxProductionKapisi` bu yuzden ortak `runChangeGates` yerine dogrudan
// `openSmartTicket` cagirir. Bu ekranda AYNEN yazilir - sessiz bir bosluk kalmaz.
//
// ── TEKRAR YOK ──────────────────────────────────────────────────────────────────────
// "Alanlari Getir" tablosu ve "Otomatik Doldur" taslagi Self Service ile AYNI koddan
// gelir (src/components/self_service/smartMetadata.tsx). Ikinci bir kopya, bu depoda
// tekrar tekrar yasanan sinifa girerdi: biri duzelince oteki sessizce eski kalir.
import React, { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { TextInput, Textarea } from '@/components/ui/Form';
import { toast } from '@/hooks/useToast';
import { ansibleApi } from '@/api/ansibleApi';
import {
  opsxApi,
  type OpsxSmartPlatform,
  type OpsxSmartPlatformConfig,
  type OpsxSmartConfigResponse,
} from '@/api/opsxApi';
import {
  buildMetadataTemplate,
  SmartFieldsTable,
  type SmartField,
} from '@/components/self_service/smartMetadata';

const PLATFORMLAR: { key: OpsxSmartPlatform; label: string; aciklama: string }[] = [
  { key: 'legacy', label: 'Legacy (JBoss)', aciklama: 'JBoss restart / stop / start' },
  { key: 'was', label: 'WAS (WebSphere)', aciklama: 'WAS JVM restart / stop / start' },
  { key: 'openshift', label: 'OpenShift', aciklama: 'Uygulama restart / pod silme' },
];

// ONIZLEME ICIN ORNEK {{opsx.*}} DEGERLERI (2026-10-08). Gercek talepte bunlari sunucu
// (server/opsx/prod-approval.cjs) isin cozulmus haliyle doldurur; anahtarlar AYNI olmali.
const OPSX_ORNEK: Record<OpsxSmartPlatform, Record<string, string>> = {
  legacy: { islem: 'restart', platform: 'legacy', uretimSebebi: 'ortam: Production', talepEden: 'ornek.kullanici', uygulama: 'GBCCSECURETRACKER', sunucular: 'GBJBOP18, GBJBOAP18' },
  was: { islem: 'WAS restart', platform: 'was', uretimSebebi: 'ortam: Production', talepEden: 'ornek.kullanici' },
  openshift: { islem: 'Openshift rollout (restart)', platform: 'openshift', uretimSebebi: 'ortam: prod', talepEden: 'ornek.kullanici', ortam: 'prod', cluster: 'ark', hedefler: 'ns-a,app-1' },
};

const BOS: OpsxSmartPlatformConfig = { enabled: true, flowKey: '', metadataFields: '', integrationKeySet: false };

type Taslak = Record<OpsxSmartPlatform, OpsxSmartPlatformConfig & { integrationKey: string }>;

function bosTaslak(): Taslak {
  return {
    legacy: { ...BOS, integrationKey: '' },
    was: { ...BOS, integrationKey: '' },
    openshift: { ...BOS, integrationKey: '' },
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const OpsXSmartConfigModal: React.FC<Props> = ({ open, onClose }) => {
  const [yukleniyor, setYukleniyor] = useState(false);
  const [kaydediyor, setKaydediyor] = useState(false);
  const [hata, setHata] = useState('');
  const [aktif, setAktif] = useState<OpsxSmartPlatform>('legacy');
  const [taslak, setTaslak] = useState<Taslak>(bosTaslak);
  const [meta, setMeta] = useState<OpsxSmartConfigResponse | null>(null);

  // "Alanlari Getir" sonucu PLATFORM BASINA tutulur: Legacy'nin alanlarini gorup
  // OpenShift sekmesine gecen admin, orada Legacy'nin tablosunu gormemeli.
  const [alanlar, setAlanlar] = useState<Partial<Record<OpsxSmartPlatform, SmartField[]>>>({});
  const [alanHata, setAlanHata] = useState<Partial<Record<OpsxSmartPlatform, string>>>({});
  const [alanYukleniyor, setAlanYukleniyor] = useState(false);

  const [onizlemeVars, setOnizlemeVars] = useState('env: prod\noperation: restart');
  const [onizleme, setOnizleme] = useState<Record<string, string> | null>(null);
  const [onizlemeHata, setOnizlemeHata] = useState('');
  const [onizlemeBusy, setOnizlemeBusy] = useState(false);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    setHata('');
    try {
      const r = await opsxApi.getSmartConfig();
      if (!r.ok || !r.smart) throw new Error(r.message || 'Yapılandırma okunamadı.');
      setMeta(r);
      setTaslak({
        legacy: { ...r.smart.legacy, integrationKey: '' },
        was: { ...r.smart.was, integrationKey: '' },
        openshift: { ...r.smart.openshift, integrationKey: '' },
      });
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    yukle();
    // Pencere her acilista TEMIZ baslar: onceki oturumun alan tablosu/onizlemesi,
    // baska bir flow'a aitmis gibi yaniltici sekilde asili kalmasin.
    setAlanlar({});
    setAlanHata({});
    setOnizleme(null);
    setOnizlemeHata('');
  }, [open, yukle]);

  const guncel = taslak[aktif];
  const env = meta?.envFallback?.[aktif];

  function yaz(patch: Partial<Taslak[OpsxSmartPlatform]>) {
    setTaslak((t) => ({ ...t, [aktif]: { ...t[aktif], ...patch } }));
  }

  async function alanlariGetir() {
    const flowKey = guncel.flowKey.trim();
    if (!flowKey) return;
    setAlanYukleniyor(true);
    setAlanHata((h) => ({ ...h, [aktif]: '' }));
    setAlanlar((a) => ({ ...a, [aktif]: undefined }));
    try {
      const r = await ansibleApi.smartFlowMetadata(flowKey);
      if (!r.ok) throw new Error(r.message || 'Smart alanları okunamadı.');
      setAlanlar((a) => ({ ...a, [aktif]: r.fields || [] }));
    } catch (e) {
      setAlanHata((h) => ({ ...h, [aktif]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setAlanYukleniyor(false);
    }
  }

  function otomatikDoldur() {
    const f = alanlar[aktif];
    if (!f || f.length === 0) return;
    yaz({ metadataFields: buildMetadataTemplate(f) });
  }

  async function onizle() {
    if (!guncel.metadataFields.trim()) return;
    setOnizlemeBusy(true);
    setOnizlemeHata('');
    setOnizleme(null);
    try {
      const extraVars: Record<string, unknown> = {};
      for (const satir of onizlemeVars.split('\n')) {
        const t = satir.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf(':');
        if (i <= 0) continue;
        extraVars[t.slice(0, i).trim()] = t.slice(i + 1).trim();
      }
      const r = await ansibleApi.smartMetadataPreview({
        metadataFields: guncel.metadataFields,
        extraVars,
        templateName: `OpsX: ${PLATFORMLAR.find((p) => p.key === aktif)?.label}`,
        opsx: OPSX_ORNEK[aktif],
      });
      if (!r.ok) throw new Error(r.message || 'Önizleme yapılamadı.');
      setOnizleme(r.metadata || {});
    } catch (e) {
      setOnizlemeHata(e instanceof Error ? e.message : String(e));
    } finally {
      setOnizlemeBusy(false);
    }
  }

  async function kaydet() {
    setKaydediyor(true);
    try {
      const govde: Parameters<typeof opsxApi.saveSmartConfig>[0] = {};
      for (const { key } of PLATFORMLAR) {
        govde[key] = {
          enabled: taslak[key].enabled,
          flowKey: taslak[key].flowKey.trim(),
          metadataFields: taslak[key].metadataFields,
          // Bos = "degistirmedim". Sunucu mevcut degeri korur.
          integrationKey: taslak[key].integrationKey.trim(),
        };
      }
      const r = await opsxApi.saveSmartConfig(govde);
      if (!r.ok) throw new Error(r.message || 'Kaydedilemedi.');
      if (r.reddedilen && r.reddedilen.length) {
        // SESSIZ ATLAMA YOK: gecersiz desenli bir anahtar kaydedilmedi ve admin bunu
        // BILMELI, yoksa "kaydettim" sanip production'in reddedilmeye devam ettigini
        // gorur - en bastaki sorunun aynisi.
        toast.error(`Kaydedilmeyen alan(lar): ${r.reddedilen.join(', ')} — izin verilen karakterler: harf, rakam, . _ : -`);
      } else {
        toast.success('Smart onay yapılandırması kaydedildi.');
      }
      await yukle();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setKaydediyor(false);
    }
  }

  const envUyarisi = env?.flowKeySet && !guncel.flowKey.trim();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="OpsX · Smart Onayı Yapılandırması"
      subtitle="Yalnızca yöneticiler. Production işlemleri bu ayarlarla Smart'a düşer."
      size="wide"
      dismissOnBackdrop={false}
      footer={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={kaydet}
            disabled={kaydediyor || yukleniyor}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-[var(--accent)] text-white disabled:opacity-50"
          >
            {kaydediyor ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border)] text-[var(--text-secondary)]"
          >
            Kapat
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-[var(--border)] p-3 text-xs text-[var(--text-secondary)] space-y-1.5">
          <p>
            OpsX'te <strong>production</strong> olarak tespit edilen bir işlem doğrudan
            çalışmaz: önce burada tanımlı Flow Key ile Smart talebi açılır, onay akışı
            tamamlanınca Ansible işi <strong>otomatik</strong> tetiklenir. Reddedilirse iş
            hiç başlamaz.
          </p>
          <p>
            <strong>Flow Key boşsa production işlem reddedilir.</strong> "Yapılandırma yok"
            durumu, işlemi onaysız çalıştırmak için gerekçe değildir.
          </p>
          <p className="text-[var(--text-muted)]">
            <strong>OCO kontrolü OpsX'te yok</strong> — OpsX hiçbir akışta OCO numarası
            toplamıyor, dolayısıyla kesinti penceresi doğrulanamaz. Kesinti penceresine
            bağlı akışlar Self Service ▸ Otomasyon ve Server Hub ▸ Retirement tarafındadır.
          </p>
        </div>

        {/* Platform sekmeleri — flow key'ler ZATEN platform basina ayri (onaylayan ekipler
            farkli). Metadata eslemesi de ayni sekilde ayrilir. */}
        <div className="flex items-center gap-1.5 border-b border-[var(--border)]">
          {PLATFORMLAR.map((p) => {
            const t = taslak[p.key];
            const anahtarVar =
              Boolean(t.flowKey.trim()) || Boolean(meta?.envFallback?.[p.key]?.flowKeySet);
            // UC DURUM, UC RENK. "yesil/sari" ikiliyi, kapi KAPALI durumunu "tanimsiz" ile
            // ayni gostermek olurdu - oysa biri production'i reddeder, oteki ONAYSIZ gecirir.
            const durum = !t.enabled ? 'kapali' : anahtarVar ? 'acik' : 'eksik';
            const renk =
              durum === 'acik' ? 'bg-green-500' : durum === 'kapali' ? 'bg-zinc-400' : 'bg-red-500';
            const baslik =
              durum === 'acik'
                ? 'Smart onayı etkin, Flow Key tanımlı'
                : durum === 'kapali'
                  ? 'Smart onayı KAPALI — production işlem onaysız çalışır'
                  : 'Smart onayı etkin ama Flow Key YOK — production işlem REDDEDİLİR';
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setAktif(p.key)}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  aktif === p.key
                    ? 'border-[var(--accent)] text-[var(--text-primary)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {p.label}
                <span
                  className={`ml-2 inline-block w-1.5 h-1.5 rounded-full align-middle ${renk}`}
                  title={baslik}
                />
              </button>
            );
          })}
        </div>

        {hata && (
          <p className="text-xs text-red-600 border border-red-200 bg-red-50 rounded-lg p-2">
            {hata}
          </p>
        )}

        {yukleniyor ? (
          <p className="text-xs text-[var(--text-muted)]">Yükleniyor…</p>
        ) : (
          <div className="space-y-4">
            <p className="text-[11px] text-[var(--text-muted)]">
              {PLATFORMLAR.find((p) => p.key === aktif)?.aciklama}
            </p>

            {/* ── ETKIN ANAHTARI (kullanici, 2026-10-07) ────────────────────────────
                "Production islemlerindeki Smart onayini kendimiz acip kapatabilmemiz
                lazim, self servis otomasyonlarda oyle ya burada da aynisini yapalim."
                Alanlar kapaliyken de GORUNUR kalir: admin once Flow Key'i hazirlayip
                sonra acabilsin, acar acmaz reddedilmeye baslamasin. */}
            <div className="rounded-xl border border-[var(--border)] p-3">
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">
                  Bu platformda Smart onayı istensin
                </span>
                <input
                  type="checkbox"
                  checked={guncel.enabled}
                  onChange={(e) => yaz({ enabled: e.target.checked })}
                />
              </label>
              {guncel.enabled ? (
                <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
                  Production olarak tespit edilen işlem doğrudan çalışmaz; Smart talebi açılır
                  ve onaydan sonra Ansible tetiklenir.
                </p>
              ) : (
                <p className="text-[11px] text-red-600 mt-1.5 leading-relaxed">
                  <strong>KAPALI.</strong> Bu platformda production işlemler{' '}
                  <strong>onaysız ve Smart'ta kayıtsız</strong> çalışır. Her çalıştırma denetime{' '}
                  <code className="font-mono">opsx_prod_onaysiz_calisti</code> olarak yazılır —
                  kapının kapalı olduğu dönem geriye dönük görünür kalsın diye.
                </p>
              )}
            </div>

            {/* ── Flow Key ────────────────────────────────────────────────────────── */}
            <div>
              <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
                Smart Flow Key
              </label>
              <div className="flex items-center gap-2">
                <TextInput
                  className="font-mono text-xs flex-1"
                  value={guncel.flowKey}
                  placeholder="ör. OPSX_JBOSS_RESTART_FLOW"
                  onChange={(e) => yaz({ flowKey: e.target.value })}
                />
                <button
                  type="button"
                  disabled={!guncel.flowKey.trim() || alanYukleniyor}
                  onClick={alanlariGetir}
                  className="text-xs px-2 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 flex-shrink-0"
                  title="Smart'ın bu flow için beklediği metadata alanlarını sorgula"
                >
                  {alanYukleniyor ? 'Sorgulanıyor…' : 'Alanları Getir'}
                </button>
              </div>
              {/* ENV GERI DUSUSU GORUNUR: panel bos ama is yuruyorsa, admin "bos" gorup
                  doldurmaya calisirken calisan degeri ezebilir. */}
              {envUyarisi && (
                <p className="text-[11px] text-amber-600 mt-1">
                  Bu platformun Flow Key'i şu an <code className="font-mono">{env?.envName}</code>{' '}
                  ortam değişkeninden geliyor ve akış <strong>çalışıyor</strong>. Buraya bir
                  değer yazarsanız o değer geçerli olur; boş bırakırsanız ortam değişkeni
                  kullanılmaya devam eder.
                </p>
              )}
              {/* Kapi KAPALIYSA bu uyari yanlis olurdu: anahtar olmasa da islem kosar. */}
              {!envUyarisi && !guncel.flowKey.trim() && guncel.enabled && (
                <p className="text-[11px] text-red-600 mt-1">
                  Tanımsız — bu platformda <strong>production işlem REDDEDİLİR</strong>. Ya Flow
                  Key girin ya da yukarıdaki anahtarı kapatın.
                </p>
              )}
            </div>

            {/* ── Integration Key ─────────────────────────────────────────────────── */}
            <div>
              <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
                Integration Key (opsiyonel)
              </label>
              <TextInput
                className="font-mono text-xs"
                type="password"
                value={guncel.integrationKey}
                placeholder={
                  guncel.integrationKeySet
                    ? 'Tanımlı — değiştirmek için yeni değeri yazın'
                    : meta?.integrationEnvSet
                      ? 'Boşsa OPSX_SMART_INTEGRATION_KEY kullanılır'
                      : 'Boşsa sistem geneli varsayılan (Admin ▸ Sistem ▸ Smart)'
                }
                onChange={(e) => yaz({ integrationKey: e.target.value })}
              />
              <p className="text-[11px] text-[var(--text-muted)] mt-1">
                Smart Designer'da her flow ayrı bir "Integration Information" anahtarıyla
                (rff-request-token) yayınlanmış olabilir. Bu platformun flow'u sistem geneli
                anahtardan FARKLIYSA doldurun.{' '}
                <strong>Mevcut değer güvenlik gereği ekrana getirilmez</strong> — boş
                bırakırsanız değişmez, silinmez.
              </p>
            </div>

            {/* ── Smart'in bekledigi alanlar ──────────────────────────────────────── */}
            {alanHata[aktif] && <p className="text-[11px] text-red-500">{alanHata[aktif]}</p>}
            {alanlar[aktif] && (
              <div className="border border-[var(--border)] rounded-lg overflow-x-auto">
                <SmartFieldsTable fields={alanlar[aktif] as SmartField[]} />
              </div>
            )}

            {/* ── Metadata eslemesi ───────────────────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="block text-[11px] font-semibold text-[var(--text-secondary)]">
                  Metadata Eşlemesi
                </label>
                <button
                  type="button"
                  disabled={!alanlar[aktif] || (alanlar[aktif] as SmartField[]).length === 0}
                  onClick={otomatikDoldur}
                  className="text-[11px] px-2 py-1 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
                  title="Yukarıdaki alan listesinden taslak oluştur (Smart-tanımlı seçenek gerektiren alanlar yorum satırı bırakılır)"
                >
                  Otomatik Doldur
                </button>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] mb-1">
                Her satıra bir tane, <code className="font-mono">ElementName: değer</code>{' '}
                (yukarıdaki tablonun İLK sütunu). Değer <strong>nunjucks</strong> ile render
                edilir: <code className="font-mono">{'{{username}}'}</code>,{' '}
                <code className="font-mono">{'{{email}}'}</code>,{' '}
                <code className="font-mono">{'{{templateName}}'}</code>,{' '}
                <code className="font-mono">{'{{extraVars.ALAN_ADI}}'}</code> ve işin çözülmüş özeti{' '}
                <code className="font-mono">{'{{opsx.ALAN}}'}</code>: <code className="font-mono">islem</code>,{' '}
                <code className="font-mono">platform</code>, <code className="font-mono">talepEden</code>,{' '}
                <code className="font-mono">uretimSebebi</code>; Legacy'de ayrıca{' '}
                <code className="font-mono">uygulama</code>, <code className="font-mono">sunucular</code>;{' '}
                OpenShift'te <code className="font-mono">ortam</code>, <code className="font-mono">cluster</code>,{' '}
                <code className="font-mono">hedefler</code>.
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mb-1">
                OpsX'in gönderdiği <code className="font-mono">extraVars</code> anahtarları
                platforma göre değişir — Legacy:{' '}
                <code className="font-mono">application</code>,{' '}
                <code className="font-mono">operation</code>; OpenShift:{' '}
                <code className="font-mono">oc_environment</code>,{' '}
                <code className="font-mono">oc_cluster</code>,{' '}
                <code className="font-mono">oc_input</code>. Aşağıdaki önizleme ile gerçek
                değerlerle deneyin.
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mb-1">
                <strong>Boş bırakılırsa</strong> sabit{' '}
                <code className="font-mono">application</code>/
                <code className="font-mono">requestedBy</code> gövdesi gönderilir ve Smart bunu
                genellikle <strong>"400 Invalid Request"</strong> ile reddeder — yani talep
                hiç açılmaz. <code className="font-mono">#</code> ile başlayan satırlar yok
                sayılır.
              </p>
              <Textarea
                rows={8}
                className="text-xs font-mono"
                value={guncel.metadataFields}
                placeholder={
                  'KONU: {{templateName}} - Portal talebi\nACIKLAMA: {{username}} tarafından {{extraVars.operation}} talebi'
                }
                onChange={(e) => yaz({ metadataFields: e.target.value })}
              />
              {meta?.metadataEnvSet && !guncel.metadataFields.trim() && (
                <p className="text-[11px] text-amber-600 mt-1">
                  Boş — şu an <code className="font-mono">OPSX_SMART_METADATA_FIELDS</code> ortam
                  değişkeni (üç platform için ORTAK) kullanılıyor. Buraya yazdığınız eşleme yalnız
                  bu platform için geçerli olur.
                </p>
              )}
            </div>

            {/* ── Onizleme ────────────────────────────────────────────────────────── */}
            <div className="rounded-lg border border-[var(--border)] p-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-[var(--text-secondary)]">
                  Önizleme — örnek değerler (satır başına{' '}
                  <code className="font-mono">alan: değer</code>)
                </span>
                <button
                  type="button"
                  onClick={onizle}
                  disabled={onizlemeBusy || !guncel.metadataFields.trim()}
                  className="text-[11px] px-2 py-1 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
                >
                  {onizlemeBusy ? 'Render ediliyor…' : 'Önizle'}
                </button>
              </div>
              <Textarea
                rows={3}
                className="text-xs font-mono"
                value={onizlemeVars}
                onChange={(e) => setOnizlemeVars(e.target.value)}
              />
              {onizlemeHata && <p className="text-[11px] text-red-500">{onizlemeHata}</p>}
              {onizleme && (
                <div className="text-[11px] font-mono rounded bg-[var(--bg-elevated)] p-2 space-y-1">
                  {Object.entries(onizleme).map(([k, v]) => (
                    <div key={k}>
                      <span className="font-semibold">{k}</span>:{' '}
                      <span className="whitespace-pre-wrap">
                        {v === '' ? <i className="text-[var(--text-muted)]">(boş)</i> : v}
                      </span>
                    </div>
                  ))}
                  {Object.keys(onizleme).length === 0 && (
                    <i className="text-[var(--text-muted)]">hiç alan yok (hepsi # ile yorumda?)</i>
                  )}
                </div>
              )}
              <p className="text-[10px] text-[var(--text-muted)]">
                Gösterilen anahtar/değerler Smart'a birebir bu şekilde gider.
              </p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default OpsXSmartConfigModal;
