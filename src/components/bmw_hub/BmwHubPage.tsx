// src/components/bmw_hub/BmwHubPage.tsx — BMW Hub: ekibin açık işleri (2026-11-08).
//
// Kullanıcı: "otomasyon taskları için bir BMW Hub ve açık işler sayfası olsun; iş girebileyim,
// açık işleri, statülerini, deadline tarihlerini, işi kimin sahiplendiğini göreyim. Sadece
// adminler görsün. Talebi açanın ismi de gözüksün."
//
// Kurallar (durum, öncelik, tarih, toplu satır biçimi) shared/bmwHub.cjs'te: ekrandaki toplu
// ekleme önizlemesi sunucunun kaydedeceğiyle birebir aynı ayrıştırıcıyı kullanır.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowPathIcon,
  ClipboardDocumentCheckIcon,
  PlusIcon,
  QueueListIcon,
  ViewColumnsIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  ChatBubbleLeftEllipsisIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import { bmwHubApi, type BmwIs, type BmwIsGirdi, type BmwNot, type BmwOzet, type BmwDurum, type BmwOncelik } from '@/api/bmwHubApi';
import { DURUMLAR, ONCELIKLER, SINIR, VARSAYILAN_KATEGORI, topluAyristir, gecikmisMi } from '../../../shared/bmwHub.cjs';
import SectionHeader from '@/components/common/SectionHeader';
import Button from '@/components/common/Button';
import LoadError from '@/components/common/LoadError';
import { Modal } from '@/components/common/Modal';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { Field, TextInput, Textarea, Select } from '@/components/ui/Form';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/useToast';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtDateTime, fmtRelative } from '@/utils/datetime';
import RebootKontroluTab from '@/components/server_hub/RebootKontroluTab';
import RetirementTab from '@/components/server_hub/RetirementTab';
import { SekmeKabi } from '@/components/server_hub/sekmeGorunurlugu';

type Gorunum = 'acik' | 'benim' | 'gecikmis' | 'sahipsiz' | 'kapali' | 'hepsi';
type Duzen = 'liste' | 'pano';

const DURUM_AD: Record<string, string> = Object.fromEntries(DURUMLAR.map((d: { key: string; label: string }) => [d.key, d.label]));
const ONCELIK_AD: Record<string, string> = Object.fromEntries(ONCELIKLER.map((o: { key: string; label: string }) => [o.key, o.label]));
const ACIK_DURUMLAR = new Set(DURUMLAR.filter((d: { acikMi: boolean }) => d.acikMi).map((d: { key: string }) => d.key));

const GORUNUMLER: { key: Gorunum; label: string }[] = [
  { key: 'acik', label: 'Açık işler' },
  { key: 'benim', label: 'Benim işlerim' },
  { key: 'gecikmis', label: 'Gecikenler' },
  { key: 'sahipsiz', label: 'Sahipsiz' },
  { key: 'kapali', label: 'Kapananlar' },
  { key: 'hepsi', label: 'Tümü' },
];

// Durum ve öncelik rengi: anlamsal tokenlar (iyi / uyarı / kritik), aksan rengi değil.
const DURUM_TON: Record<string, { fg: string; bg: string }> = {
  acik: { fg: 'var(--status-info)', bg: 'var(--status-info-bg)' },
  devam: { fg: 'var(--bh-hue)', bg: 'var(--bh-hue-soft)' },
  bekliyor: { fg: 'var(--status-warning-text)', bg: 'var(--status-warning-bg)' },
  tamam: { fg: 'var(--status-success)', bg: 'var(--status-success-bg)' },
  iptal: { fg: 'var(--status-neutral)', bg: 'var(--status-neutral-bg)' },
};
const ONCELIK_TON: Record<string, string> = {
  yuksek: 'var(--status-danger)',
  orta: 'var(--status-warning)',
  dusuk: 'var(--status-neutral)',
};

function DurumHap({ durum }: { durum: string }) {
  const t = DURUM_TON[durum] || DURUM_TON.acik;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ color: t.fg, background: t.bg, border: `1px solid ${t.fg}` }}
    >
      {DURUM_AD[durum] || durum}
    </span>
  );
}

function OncelikIsaret({ oncelik }: { oncelik: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
      <span className="inline-block w-2 h-2 rounded-full" style={{ background: ONCELIK_TON[oncelik] || ONCELIK_TON.orta }} aria-hidden />
      {ONCELIK_AD[oncelik] || oncelik}
    </span>
  );
}

/** "3 gün kaldı" / "2 gün gecikti" / "bugün". `bugun` sunucunun İstanbul günüdür. */
function kalanMetni(sonTarih: string, bugun: string): string {
  if (!sonTarih) return '';
  const fark = Math.round((Date.parse(`${sonTarih}T00:00:00Z`) - Date.parse(`${bugun}T00:00:00Z`)) / 86400000);
  if (fark === 0) return 'bugün';
  if (fark > 0) return `${fark} gün kaldı`;
  return `${-fark} gün gecikti`;
}

function trGun(sonTarih: string): string {
  if (!sonTarih) return '';
  const [y, a, g] = sonTarih.split('-');
  return `${g}.${a}.${y}`;
}

function SonTarih({ is, bugun }: { is: BmwIs; bugun: string }) {
  if (!is.sonTarih) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const gec = gecikmisMi(is, bugun);
  const acik = ACIK_DURUMLAR.has(is.durum);
  return (
    <div className="leading-tight">
      <div className="tabular-nums text-[13px]" style={{ color: gec ? 'var(--status-danger)' : 'var(--text-primary)', fontWeight: gec ? 600 : 400 }}>
        {trGun(is.sonTarih)}
      </div>
      {acik && (
        <div className="text-[11px]" style={{ color: gec ? 'var(--status-danger)' : 'var(--text-muted)' }}>
          {kalanMetni(is.sonTarih, bugun)}
        </div>
      )}
    </div>
  );
}

function OzetKutu({ label, value, aktif, ton, onClick }: { label: string; value: number; aktif: boolean; ton?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={aktif}
      className="card px-4 py-3 text-left transition-shadow focus-visible:outline focus-visible:outline-2"
      style={{ borderTop: `3px solid ${aktif ? 'var(--bh-hue)' : 'transparent'}` }}
    >
      <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="mt-1 tabular-nums" style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 500, color: ton || 'var(--text-primary)' }}>
        {value}
      </div>
    </button>
  );
}

const BOS_GIRDI: BmwIsGirdi = { baslik: '', aciklama: '', durum: 'acik', oncelik: 'orta', kategori: VARSAYILAN_KATEGORI, sahip: '', beklenen: '', sonTarih: '' };

function IsFormu({
  deger,
  setDeger,
  kisiler,
  benimAdim,
}: {
  deger: BmwIsGirdi;
  setDeger: (f: (d: BmwIsGirdi) => BmwIsGirdi) => void;
  kisiler: string[];
  benimAdim: string;
}) {
  const alan = (k: keyof BmwIsGirdi) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const v = e.target.value;
    setDeger((d) => ({ ...d, [k]: v }));
  };
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="Başlık" htmlFor="bmw-baslik" required className="md:col-span-2">
        <TextInput id="bmw-baslik" value={deger.baslik || ''} onChange={alan('baslik')} maxLength={SINIR.baslik} placeholder="Örn. JBoss restart playbook'una prod onayı eklensin" autoFocus />
      </Field>
      <Field label="Durum" htmlFor="bmw-durum">
        <Select id="bmw-durum" value={deger.durum || 'acik'} onChange={alan('durum')}>
          {DURUMLAR.map((d: { key: string; label: string }) => (
            <option key={d.key} value={d.key}>{d.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="Öncelik" htmlFor="bmw-oncelik">
        <Select id="bmw-oncelik" value={deger.oncelik || 'orta'} onChange={alan('oncelik')}>
          {ONCELIKLER.map((o: { key: string; label: string }) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="Sahip" htmlFor="bmw-sahip" hint="İşi üstlenen kişi. Boş bırakılırsa iş 'sahipsiz' görünür.">
        <div className="flex gap-2">
          <TextInput id="bmw-sahip" list="bmw-kisiler" value={deger.sahip || ''} onChange={alan('sahip')} maxLength={SINIR.kisi} placeholder="Ad Soyad" />
          {benimAdim && deger.sahip !== benimAdim && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setDeger((d) => ({ ...d, sahip: benimAdim }))}>
              Ben üstleneyim
            </Button>
          )}
        </div>
        <datalist id="bmw-kisiler">
          {kisiler.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      </Field>
      <Field label="Son tarih" htmlFor="bmw-tarih">
        <TextInput id="bmw-tarih" type="date" value={deger.sonTarih || ''} onChange={alan('sonTarih')} />
      </Field>
      <Field label="Kategori" htmlFor="bmw-kategori">
        <TextInput id="bmw-kategori" list="bmw-kategoriler" value={deger.kategori || ''} onChange={alan('kategori')} maxLength={SINIR.kategori} placeholder={VARSAYILAN_KATEGORI} />
        <datalist id="bmw-kategoriler">
          {['Otomasyon', 'Portal', 'Ansible / AWX', 'OpenShift', 'JBoss', 'WebSphere', 'Nginx', 'Diğer'].map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      </Field>
      <Field label="Ne bekleniyor" htmlFor="bmw-beklenen" hint="Kimden ya da neyin gelmesi bekleniyor (örn. 'DBA'den log yedeği', 'Smart onayı').">
        <TextInput id="bmw-beklenen" value={deger.beklenen || ''} onChange={alan('beklenen')} maxLength={SINIR.beklenen} />
      </Field>
      <Field label="Açıklama" htmlFor="bmw-aciklama" className="md:col-span-2">
        <Textarea id="bmw-aciklama" rows={5} value={deger.aciklama || ''} onChange={alan('aciklama')} maxLength={SINIR.aciklama} />
      </Field>
    </div>
  );
}

function YeniIsModal({ open, onClose, onKaydedildi, kisiler, benimAdim }: { open: boolean; onClose: () => void; onKaydedildi: () => void; kisiler: string[]; benimAdim: string }) {
  const [deger, setDeger] = useState<BmwIsGirdi>(BOS_GIRDI);
  const [kaydediyor, setKaydediyor] = useState(false);
  const kaydet = async () => {
    if (kaydediyor) return;
    if (!String(deger.baslik || '').trim()) {
      toast.warning('Başlık gerekli.');
      return;
    }
    setKaydediyor(true);
    try {
      await bmwHubApi.ekle(deger);
      toast.success('İş eklendi.');
      onKaydedildi();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setKaydediyor(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Yeni iş"
      subtitle="İşi açan olarak sizin adınız kaydedilir."
      icon={PlusIcon}
      size="xl"
      dismissOnBackdrop={false}
      footer={
        <>
          <Button variant="primary" onClick={kaydet} loading={kaydediyor}>İşi ekle</Button>
          <Button variant="ghost" onClick={onClose}>İptal</Button>
        </>
      }
    >
      <IsFormu deger={deger} setDeger={setDeger} kisiler={kisiler} benimAdim={benimAdim} />
    </Modal>
  );
}

const TOPLU_ORNEK = [
  '# Her satır bir iş. Alanlar | ile ayrılır; yalnız başlık zorunlu, sondakiler atlanabilir.',
  '# Başlık | Sahip | Son tarih | Öncelik | Durum | Ne bekleniyor | Açıklama',
  'Application Hub: JVM parametre toplama playbook\'u | Onur Demir | 20.11.2026 | yüksek | devam | | JBoss ps argümanlarından okunacak',
  'TBMWANS parolası vault\'a taşınsın | | 2026-12-01 | orta | beklemede | DBA onayı',
].join('\n');

function TopluModal({ open, onClose, onKaydedildi }: { open: boolean; onClose: () => void; onKaydedildi: () => void }) {
  const [metin, setMetin] = useState('');
  const [kaydediyor, setKaydediyor] = useState(false);
  const sonuc = useMemo(() => topluAyristir(metin) as { satir: number; deger: BmwIsGirdi; hatalar: string[] }[], [metin]);
  const hatali = sonuc.filter((s) => s.hatalar.length).length;
  const fazla = sonuc.length > SINIR.toplu;
  const ekle = async () => {
    if (kaydediyor || !sonuc.length || hatali || fazla) return;
    setKaydediyor(true);
    try {
      const n = await bmwHubApi.toplu(metin);
      toast.success(`${n} iş eklendi.`);
      onKaydedildi();
      onClose();
    } catch (e) {
      toast.error((e as Error).message, 8000);
    } finally {
      setKaydediyor(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Toplu iş ekle"
      subtitle="Satırları yapıştırın; aşağıdaki önizleme kaydedilecek hali gösterir. Hatalı satır varsa hiçbir iş eklenmez."
      icon={QueueListIcon}
      size="wide"
      dismissOnBackdrop={false}
      footer={
        <>
          <Button variant="primary" onClick={ekle} loading={kaydediyor} disabled={!sonuc.length || hatali > 0 || fazla}>
            {sonuc.length ? `${sonuc.length} işi ekle` : 'İşleri ekle'}
          </Button>
          <Button variant="ghost" onClick={onClose}>İptal</Button>
          {hatali > 0 && <span className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{hatali} satırda hata var.</span>}
          {fazla && <span className="text-[13px]" style={{ color: 'var(--status-danger)' }}>Bir seferde en çok {SINIR.toplu} iş eklenebilir.</span>}
        </>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Textarea
            aria-label="Toplu iş metni"
            rows={14}
            value={metin}
            onChange={(e) => setMetin(e.target.value)}
            placeholder={TOPLU_ORNEK}
            className="font-mono text-[12px]"
            spellCheck={false}
          />
          <div className="flex flex-wrap items-center gap-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <span>Tarih: 2026-11-20 ya da 20.11.2026 · Öncelik: yüksek / orta / düşük · Durum: açık / devam / beklemede / tamam / iptal</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMetin(TOPLU_ORNEK)}>Örneği doldur</Button>
          </div>
        </div>
        <div className="overflow-x-auto rounded border" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}>
                <th className="px-2 py-1.5 text-left font-semibold">Satır</th>
                <th className="px-2 py-1.5 text-left font-semibold">Başlık</th>
                <th className="px-2 py-1.5 text-left font-semibold">Sahip</th>
                <th className="px-2 py-1.5 text-left font-semibold">Son tarih</th>
                <th className="px-2 py-1.5 text-left font-semibold">Öncelik / Durum</th>
              </tr>
            </thead>
            <tbody>
              {!sonuc.length && <TableEmptyRow colSpan={5} title="Önizleme burada görünür." />}
              {sonuc.map((s) => (
                <tr key={s.satir} className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-2 py-1.5 tabular-nums" style={{ color: 'var(--text-muted)' }}>{s.satir}</td>
                  <td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>
                    {s.deger.baslik || <em style={{ color: 'var(--text-muted)' }}>başlık yok</em>}
                    {s.hatalar.map((h) => (
                      <div key={h} className="mt-0.5 flex items-start gap-1" style={{ color: 'var(--status-danger)' }}>
                        <ExclamationTriangleIcon className="w-3.5 h-3.5 mt-px flex-shrink-0" />
                        {h}
                      </div>
                    ))}
                  </td>
                  <td className="px-2 py-1.5">{s.deger.sahip || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td className="px-2 py-1.5 tabular-nums">{s.deger.sonTarih ? trGun(s.deger.sonTarih) : '—'}</td>
                  <td className="px-2 py-1.5 space-x-2 whitespace-nowrap">
                    <OncelikIsaret oncelik={s.deger.oncelik || 'orta'} />
                    <DurumHap durum={s.deger.durum || 'acik'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

const NOT_TUR_AD: Record<string, string> = { not: 'Not', olusturma: 'Açılış', durum: 'Durum', sahip: 'Sahip', tarih: 'Son tarih', oncelik: 'Öncelik' };

function IsDetayModal({
  isId,
  onClose,
  onDegisti,
  kisiler,
  benimAdim,
  bugun,
}: {
  isId: string | null;
  onClose: () => void;
  onDegisti: () => void;
  kisiler: string[];
  benimAdim: string;
  bugun: string;
}) {
  const [is, setIs] = useState<BmwIs | null>(null);
  const [notlar, setNotlar] = useState<BmwNot[]>([]);
  const [deger, setDeger] = useState<BmwIsGirdi>(BOS_GIRDI);
  const [hata, setHata] = useState('');
  const [yukleniyor, setYukleniyor] = useState(false);
  const [kaydediyor, setKaydediyor] = useState(false);
  const [notMetni, setNotMetni] = useState('');
  const [notYaziyor, setNotYaziyor] = useState(false);
  const [silOnay, setSilOnay] = useState(false);

  const yukle = useCallback(async (id: string) => {
    setYukleniyor(true);
    setHata('');
    try {
      const r = await bmwHubApi.detay(id);
      setIs(r.is);
      setNotlar(r.notlar);
      setDeger({
        baslik: r.is.baslik,
        aciklama: r.is.aciklama,
        durum: r.is.durum,
        oncelik: r.is.oncelik,
        kategori: r.is.kategori,
        sahip: r.is.sahip,
        beklenen: r.is.beklenen,
        sonTarih: r.is.sonTarih,
      });
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setYukleniyor(false);
    }
  }, []);

  // Pencere her iş için yeniden kurulur (üst bileşende key={isId}); burada yalnız ilk yükleme var.
  useAsyncEffect(async () => {
    if (isId) await yukle(isId);
  }, [isId, yukle]);

  const degisenler = useMemo(() => {
    if (!is) return {} as BmwIsGirdi;
    const d: BmwIsGirdi = {};
    (Object.keys(deger) as (keyof BmwIsGirdi)[]).forEach((k) => {
      if ((deger[k] ?? '') !== ((is as unknown as Record<string, string>)[k] ?? '')) (d as Record<string, unknown>)[k] = deger[k];
    });
    return d;
  }, [deger, is]);
  const kirli = Object.keys(degisenler).length > 0;

  const kaydet = async () => {
    if (!is || kaydediyor || !kirli) return;
    setKaydediyor(true);
    try {
      await bmwHubApi.guncelle(is.id, degisenler, is.guncelleme);
      toast.success('Kaydedildi.');
      onDegisti();
      await yukle(is.id);
    } catch (e) {
      const err = e as Error & { code?: string };
      toast.error(err.message, err.code === 'bmw_cakisma' ? 9000 : 5000);
      if (err.code === 'bmw_cakisma') await yukle(is.id);
    } finally {
      setKaydediyor(false);
    }
  };

  const notEkle = async () => {
    if (!is || notYaziyor || !notMetni.trim()) return;
    setNotYaziyor(true);
    try {
      await bmwHubApi.notEkle(is.id, notMetni.trim());
      setNotMetni('');
      onDegisti();
      await yukle(is.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setNotYaziyor(false);
    }
  };

  const sil = async () => {
    if (!is) return;
    try {
      await bmwHubApi.sil(is.id);
      toast.success('İş silindi.');
      onDegisti();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Modal
      open={!!isId}
      onClose={onClose}
      title={is ? is.baslik : 'İş'}
      subtitle={is ? `${is.acanAd} açtı · ${fmtDateTime(is.olusturma)}${is.kapanis ? ` · kapanış ${fmtDateTime(is.kapanis)}` : ''}` : undefined}
      icon={ClipboardDocumentCheckIcon}
      size="wide"
      dismissOnBackdrop={!kirli}
      footer={
        is ? (
          <>
            <Button variant="primary" onClick={kaydet} loading={kaydediyor} disabled={!kirli}>Değişiklikleri kaydet</Button>
            <Button variant="ghost" onClick={onClose}>{kirli ? 'İptal' : 'Kapat'}</Button>
            <span className="flex-1" />
            {silOnay ? (
              <span className="inline-flex items-center gap-2 text-[13px]" style={{ color: 'var(--status-danger)' }}>
                İş ve geçmişi kalıcı olarak silinsin mi? Geri alınamaz.
                <Button variant="danger" size="sm" onClick={sil}>Evet, sil</Button>
                <Button variant="ghost" size="sm" onClick={() => setSilOnay(false)}>İptal</Button>
              </span>
            ) : (
              <Button variant="ghost" size="sm" icon={<TrashIcon className="w-4 h-4" />} onClick={() => setSilOnay(true)}>Sil</Button>
            )}
          </>
        ) : undefined
      }
    >
      {hata ? (
        <LoadError title="İş okunamadı" message={hata} onRetry={() => isId && yukle(isId)} compact />
      ) : !is || yukleniyor && !is ? (
        <div className="h-40 skeleton rounded" />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <DurumHap durum={is.durum} />
              <OncelikIsaret oncelik={is.oncelik} />
              {is.sonTarih && (
                <span className="text-[12px]" style={{ color: gecikmisMi(is, bugun) ? 'var(--status-danger)' : 'var(--text-muted)' }}>
                  Son tarih {trGun(is.sonTarih)} · {kalanMetni(is.sonTarih, bugun)}
                </span>
              )}
            </div>
            <IsFormu deger={deger} setDeger={setDeger} kisiler={kisiler} benimAdim={benimAdim} />
          </div>
          <div className="space-y-3">
            <h3 className="text-[13px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
              <ChatBubbleLeftEllipsisIcon className="w-4 h-4" /> Notlar ve geçmiş
            </h3>
            <div className="space-y-2">
              <Textarea
                aria-label="Not"
                rows={3}
                value={notMetni}
                onChange={(e) => setNotMetni(e.target.value)}
                maxLength={SINIR.not}
                placeholder="Gelişme, karar ya da engel yazın…"
              />
              <Button size="sm" variant="secondary" onClick={notEkle} loading={notYaziyor} disabled={!notMetni.trim()}>Not ekle</Button>
            </div>
            <ol className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
              {notlar.map((n) => (
                <li key={n.id} className="rounded px-3 py-2" style={{ background: n.tur === 'not' ? 'var(--bg-inset)' : 'transparent', border: '1px solid var(--border-subtle)' }}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    <span>
                      <strong style={{ color: 'var(--text-secondary)' }}>{n.yazanAd}</strong> · {NOT_TUR_AD[n.tur] || n.tur}
                    </span>
                    <span title={fmtDateTime(n.olusturma)}>{fmtRelative(n.olusturma)}</span>
                  </div>
                  <p className="mt-1 text-[13px] whitespace-pre-wrap break-words" style={{ color: n.tur === 'not' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    {n.metin}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Panoda "Açık işler" görünümü Tamamlandı sütununu boş bırakmasın: son 14 günde bitenler de gelir.
const yeniBitti = (i: BmwIs) => i.durum === 'tamam' && !!i.kapanis && Date.now() - Date.parse(i.kapanis) < 14 * 86400000;

function PanoKart({ is, bugun, onAc }: { is: BmwIs; bugun: string; onAc: () => void }) {
  const gec = gecikmisMi(is, bugun);
  return (
    <button
      type="button"
      onClick={onAc}
      className="card w-full text-left px-3 py-2.5 space-y-1.5 card-hover focus-visible:outline focus-visible:outline-2"
      style={{ borderLeft: `3px solid ${ONCELIK_TON[is.oncelik] || ONCELIK_TON.orta}` }}
    >
      <div className="text-[13px] font-medium leading-snug" style={{ color: 'var(--text-primary)' }}>{is.baslik}</div>
      {is.beklenen && (
        <div className="text-[11px] flex items-start gap-1" style={{ color: 'var(--status-warning-text)' }}>
          <ClockIcon className="w-3.5 h-3.5 flex-shrink-0 mt-px" /> {is.beklenen}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        <span className="inline-flex items-center gap-1">
          <UserIcon className="w-3.5 h-3.5" />
          {is.sahip || <em>sahipsiz</em>}
        </span>
        {is.sonTarih && (
          <span className="tabular-nums" style={{ color: gec ? 'var(--status-danger)' : undefined, fontWeight: gec ? 600 : 400 }}>
            {trGun(is.sonTarih)}
          </span>
        )}
      </div>
    </button>
  );
}

function AcikIsler() {
  const { user } = useAuth();
  const benimAdim = (user?.displayName || user?.username || '').trim();
  const [params, setParams] = useSearchParams();
  const gorunum = (GORUNUMLER.find((g) => g.key === params.get('gorunum'))?.key || 'acik') as Gorunum;
  const duzen = (params.get('duzen') === 'pano' ? 'pano' : 'liste') as Duzen;
  const seciliId = params.get('is');

  const [isler, setIsler] = useState<BmwIs[]>([]);
  const [ozet, setOzet] = useState<BmwOzet | null>(null);
  const [bugun, setBugun] = useState('');
  const [tavan, setTavan] = useState<number | null>(null);
  const [hata, setHata] = useState('');
  const [yukleniyor, setYukleniyor] = useState(true);
  const [ara, setAra] = useState('');
  const [sahipSuz, setSahipSuz] = useState('');
  const [oncelikSuz, setOncelikSuz] = useState('');
  const [yeniAcik, setYeniAcik] = useState(false);
  const [topluAcik, setTopluAcik] = useState(false);

  const paramDegis = (k: string, v: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v) n.set(k, v);
        else n.delete(k);
        return n;
      },
      { replace: k !== 'is' },
    );

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try {
      const r = await bmwHubApi.liste();
      setIsler(r.isler);
      setOzet(r.ozet);
      setBugun(r.bugun);
      setTavan(r.tavan);
      setHata('');
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useAsyncEffect(async () => {
    await yukle();
  }, [yukle]);
  // Pencereler her açılışta boş form ile kurulsun diye sayaçla yeniden bağlanır (key).
  const [yeniNo, setYeniNo] = useState(0);
  const [topluNo, setTopluNo] = useState(0);

  const kisiler = useMemo(() => {
    const s = new Set<string>();
    if (benimAdim) s.add(benimAdim);
    isler.forEach((i) => {
      if (i.sahip) s.add(i.sahip);
      if (i.acanAd) s.add(i.acanAd);
    });
    return [...s].sort((a, b) => a.localeCompare(b, 'tr'));
  }, [isler, benimAdim]);

  const sahipler = useMemo(() => [...new Set(isler.map((i) => i.sahip).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr')), [isler]);

  const benimMi = useCallback(
    (i: BmwIs) => {
      const ad = benimAdim.toLocaleLowerCase('tr');
      return !!ad && i.sahip.toLocaleLowerCase('tr') === ad;
    },
    [benimAdim],
  );

  const suzulmus = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase('tr');
    return isler
      .filter((i) => {
        const acik = ACIK_DURUMLAR.has(i.durum);
        switch (gorunum) {
          case 'acik': return acik || (duzen === 'pano' && yeniBitti(i));
          case 'benim': return acik && benimMi(i);
          case 'gecikmis': return gecikmisMi(i, bugun);
          case 'sahipsiz': return acik && !i.sahip;
          case 'kapali': return !acik;
          default: return true;
        }
      })
      .filter((i) => !sahipSuz || i.sahip === sahipSuz)
      .filter((i) => !oncelikSuz || i.oncelik === oncelikSuz)
      .filter((i) =>
        !q || [i.baslik, i.aciklama, i.sahip, i.acanAd, i.beklenen, i.kategori].some((x) => (x || '').toLocaleLowerCase('tr').includes(q)),
      )
      .sort((a, b) => {
        // Açık işler önce gecikene, sonra en yakın son tarihe; tarihsizler sonda. Kapananlar en yeni üstte.
        if (gorunum === 'kapali') return (b.kapanis || '').localeCompare(a.kapanis || '');
        const ga = gecikmisMi(a, bugun) ? 0 : 1;
        const gb = gecikmisMi(b, bugun) ? 0 : 1;
        if (ga !== gb) return ga - gb;
        if (a.sonTarih && b.sonTarih && a.sonTarih !== b.sonTarih) return a.sonTarih.localeCompare(b.sonTarih);
        if (!!a.sonTarih !== !!b.sonTarih) return a.sonTarih ? -1 : 1;
        const po = { yuksek: 0, orta: 1, dusuk: 2 } as Record<string, number>;
        if (po[a.oncelik] !== po[b.oncelik]) return po[a.oncelik] - po[b.oncelik];
        return (b.guncelleme || '').localeCompare(a.guncelleme || '');
      });
  }, [isler, gorunum, duzen, sahipSuz, oncelikSuz, ara, bugun, benimMi]);

  const hizliDurum = async (i: BmwIs, durum: BmwDurum) => {
    if (durum === i.durum) return;
    const eski = isler;
    setIsler((l) => l.map((x) => (x.id === i.id ? { ...x, durum } : x)));
    try {
      await bmwHubApi.guncelle(i.id, { durum }, i.guncelleme);
      toast.success(`Durum: ${DURUM_AD[durum]}`);
      yukle();
    } catch (e) {
      setIsler(eski);
      toast.error((e as Error).message, 8000);
      yukle();
    }
  };

  const benimSayi = useMemo(() => isler.filter((i) => ACIK_DURUMLAR.has(i.durum) && benimMi(i)).length, [isler, benimMi]);

  const panoKolonlari = DURUMLAR.filter((d: { key: string }) => d.key !== "iptal") as { key: BmwDurum; label: string }[];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" icon={<ArrowPathIcon className={`w-4 h-4 ${yukleniyor ? 'animate-spin' : ''}`} />} onClick={yukle} disabled={yukleniyor}>
              Yenile
            </Button>
            <Button variant="secondary" icon={<QueueListIcon className="w-4 h-4" />} onClick={() => { setTopluNo((n) => n + 1); setTopluAcik(true); }}>
              Toplu ekle
            </Button>
            <Button variant="primary" icon={<PlusIcon className="w-4 h-4" />} onClick={() => { setYeniNo((n) => n + 1); setYeniAcik(true); }}>
              Yeni iş
            </Button>
      </div>

      {hata && !isler.length ? (
        <LoadError title="BMW Hub yüklenemedi" message={hata} onRetry={yukle} retrying={yukleniyor} />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <OzetKutu label="Açık" value={ozet?.acik ?? 0} aktif={gorunum === 'acik'} onClick={() => paramDegis('gorunum', null)} />
            <OzetKutu label="Benim işlerim" value={benimSayi} aktif={gorunum === 'benim'} onClick={() => paramDegis('gorunum', 'benim')} />
            <OzetKutu
              label="Geciken"
              value={ozet?.gecikmis ?? 0}
              aktif={gorunum === 'gecikmis'}
              ton={ozet?.gecikmis ? 'var(--status-danger)' : undefined}
              onClick={() => paramDegis('gorunum', 'gecikmis')}
            />
            <OzetKutu label="7 gün içinde" value={ozet?.buHafta ?? 0} aktif={false} ton={ozet?.buHafta ? 'var(--status-warning-text)' : undefined} onClick={() => paramDegis('gorunum', null)} />
            <OzetKutu label="Sahipsiz" value={ozet?.sahipsiz ?? 0} aktif={gorunum === 'sahipsiz'} onClick={() => paramDegis('gorunum', 'sahipsiz')} />
            <OzetKutu label="Son 30 günde biten" value={ozet?.tamamlanan30 ?? 0} aktif={gorunum === 'kapali'} ton="var(--status-success)" onClick={() => paramDegis('gorunum', 'kapali')} />
          </div>

          {hata && (
            <p className="text-[13px]" style={{ color: 'var(--status-danger)' }} role="alert">
              Son yenileme başarısız: {hata}. Ekrandaki liste önceki yüklemeden.
            </p>
          )}
          {tavan && (
            <p className="text-[12px]" style={{ color: 'var(--status-warning-text)' }}>
              Yalnız son güncellenen {tavan} iş gösteriliyor.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Görünüm" className="inline-flex rounded border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              {GORUNUMLER.map((g) => (
                <button
                  key={g.key}
                  role="tab"
                  aria-selected={gorunum === g.key}
                  onClick={() => paramDegis('gorunum', g.key === 'acik' ? null : g.key)}
                  className="px-3 py-1.5 text-[13px] focus-visible:outline focus-visible:outline-2"
                  style={{
                    background: gorunum === g.key ? 'var(--bh-hue-soft)' : 'var(--bg-surface)',
                    color: gorunum === g.key ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: gorunum === g.key ? 600 : 400,
                  }}
                >
                  {g.label}
                </button>
              ))}
            </div>
            <div className="relative min-w-[14rem] flex-1 max-w-sm">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <TextInput sizeVariant="sm" aria-label="İşlerde ara" value={ara} onChange={(e) => setAra(e.target.value)} placeholder="Başlık, kişi, açıklamada ara" className="pl-9" />
            </div>
            <div className="w-44">
              <Select sizeVariant="sm" aria-label="Sahibe göre" value={sahipSuz} onChange={(e) => setSahipSuz(e.target.value)}>
                <option value="">Tüm sahipler</option>
                {sahipler.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </div>
            <div className="w-36">
              <Select sizeVariant="sm" aria-label="Önceliğe göre" value={oncelikSuz} onChange={(e) => setOncelikSuz(e.target.value)}>
                <option value="">Tüm öncelikler</option>
                {ONCELIKLER.map((o: { key: string; label: string }) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </Select>
            </div>
            <span className="flex-1" />
            <div role="group" aria-label="Düzen" className="inline-flex rounded border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              {(
                [
                  { k: 'liste', label: 'Liste', Ikon: QueueListIcon },
                  { k: 'pano', label: 'Pano', Ikon: ViewColumnsIcon },
                ] as const
              ).map(({ k, label, Ikon }) => (
                <button
                  key={k}
                  aria-pressed={duzen === k}
                  onClick={() => paramDegis('duzen', k === 'liste' ? null : k)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] focus-visible:outline focus-visible:outline-2"
                  style={{ background: duzen === k ? 'var(--bh-hue-soft)' : 'var(--bg-surface)', color: 'var(--text-primary)', fontWeight: duzen === k ? 600 : 400 }}
                >
                  <Ikon className="w-4 h-4" /> {label}
                </button>
              ))}
            </div>
          </div>

          {duzen === 'liste' ? (
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>
                    <th className="px-4 py-2.5 font-semibold">İş</th>
                    <th className="px-3 py-2.5 font-semibold">Durum</th>
                    <th className="px-3 py-2.5 font-semibold">Öncelik</th>
                    <th className="px-3 py-2.5 font-semibold">Sahip</th>
                    <th className="px-3 py-2.5 font-semibold">Son tarih</th>
                    <th className="px-3 py-2.5 font-semibold">Açan</th>
                    <th className="px-3 py-2.5 font-semibold">Güncelleme</th>
                  </tr>
                </thead>
                <tbody>
                  {yukleniyor && !isler.length && (
                    <tr>
                      <td colSpan={7} className="p-4"><div className="h-24 skeleton rounded" /></td>
                    </tr>
                  )}
                  {!yukleniyor && !suzulmus.length && (
                    <TableEmptyRow
                      colSpan={7}
                      title={isler.length ? 'Bu görünümde iş yok.' : 'Henüz iş girilmemiş.'}
                      description={isler.length ? 'Görünümü ya da süzgeçleri değiştirin.' : '"Yeni iş" ya da "Toplu ekle" ile başlayın.'}
                    />
                  )}
                  {suzulmus.map((i) => (
                    <tr
                      key={i.id}
                      className="align-top cursor-pointer transition-colors hover:bg-[var(--bg-inset)]"
                      style={{ borderTop: '1px solid var(--border-subtle)' }}
                      onClick={() => paramDegis('is', i.id)}
                    >
                      <td className="px-4 py-2.5 max-w-[32rem]">
                        <button
                          type="button"
                          className="text-left font-medium hover:underline focus-visible:outline focus-visible:outline-2"
                          style={{ color: 'var(--text-primary)' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            paramDegis('is', i.id);
                          }}
                        >
                          {i.baslik}
                        </button>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          <span>{i.kategori}</span>
                          {i.beklenen && (
                            <span className="inline-flex items-center gap-1" style={{ color: 'var(--status-warning-text)' }}>
                              <ClockIcon className="w-3.5 h-3.5" /> Bekleniyor: {i.beklenen}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <label className="sr-only" htmlFor={`bmw-d-${i.id}`}>Durum</label>
                        <select
                          id={`bmw-d-${i.id}`}
                          value={i.durum}
                          onChange={(e) => hizliDurum(i, e.target.value as BmwDurum)}
                          className="rounded-full px-2 py-0.5 text-[11px] font-semibold cursor-pointer focus-visible:outline focus-visible:outline-2"
                          style={{ color: (DURUM_TON[i.durum] || DURUM_TON.acik).fg, background: (DURUM_TON[i.durum] || DURUM_TON.acik).bg, border: `1px solid ${(DURUM_TON[i.durum] || DURUM_TON.acik).fg}` }}
                        >
                          {DURUMLAR.map((d: { key: string; label: string }) => (
                            <option key={d.key} value={d.key}>{d.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5"><OncelikIsaret oncelik={i.oncelik as BmwOncelik} /></td>
                      <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: i.sahip ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {i.sahip || <em>sahipsiz</em>}
                      </td>
                      <td className="px-3 py-2.5"><SonTarih is={i} bugun={bugun} /></td>
                      <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{i.acanAd}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-[12px]" style={{ color: 'var(--text-muted)' }} title={fmtDateTime(i.guncelleme)}>
                        {fmtRelative(i.guncelleme)}
                        {i.guncelleyenAd && <div>{i.guncelleyenAd}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {panoKolonlari.map((k) => {
                const kart = suzulmus.filter((i) => i.durum === k.key);
                return (
                  <section key={k.key} className="rounded p-2 space-y-2" style={{ background: 'var(--bg-inset)' }} aria-label={k.label}>
                    <header className="flex items-center justify-between px-1">
                      <DurumHap durum={k.key} />
                      <span className="text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }}>{kart.length}</span>
                    </header>
                    {kart.map((i) => (
                      <PanoKart key={i.id} is={i} bugun={bugun} onAc={() => paramDegis('is', i.id)} />
                    ))}
                    {!kart.length && (
                      <p className="px-1 py-4 text-center text-[12px]" style={{ color: 'var(--text-muted)' }}>Bu sütunda iş yok.</p>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      <YeniIsModal key={`yeni-${yeniNo}`} open={yeniAcik} onClose={() => setYeniAcik(false)} onKaydedildi={yukle} kisiler={kisiler} benimAdim={benimAdim} />
      <TopluModal key={`toplu-${topluNo}`} open={topluAcik} onClose={() => setTopluAcik(false)} onKaydedildi={yukle} />
      <IsDetayModal key={seciliId || 'yok'} isId={seciliId} onClose={() => paramDegis('is', null)} onDegisti={yukle} kisiler={kisiler} benimAdim={benimAdim} bugun={bugun} />
    </div>
  );
}

// ── SEKMELER (2026-11-11) ─────────────────────────────────────────────────────────────────────────
// Kullanici: "Server Hub'da bulunan Reboot Kontrolu ve Retirement operasyon akislarini BMW Hub'in
// altina bir sekme olarak alalim; Server Hub'i sadece envanterleme ve goruntuleme amacli kullaniyoruz."
// Sekme URL'de (?sekme=), derin link ve geri tusu calisir. Ziyaret edilen sekme sokulmez, gizlenir
// (Server Hub'daki SekmeKabi: gizli sekme yoklama yapmaz, pencere acmaz).
// IP/Sunucu Sorgu ve OCP Uygulama Sorgu 2026-11-12'de burada sekmeydi; 2026-11-13'te (kullanici: "sol menude
// BMW Hub altinda gorunmuyor") ayri sayfalar oldu (/ip-sorgu, /ocp-sorgu; ?sekme=ip|ocp App.tsx'te yonlenir).
type SekmeId = 'isler' | 'reboot' | 'retirement';
const SEKMELER: { id: SekmeId; label: string; aciklama: string }[] = [
  { id: 'isler', label: 'Açık İşler', aciklama: 'Ekibin açık işleri ve otomasyon talepleri: kim açtı, kim üstlendi, ne zamana, ne bekleniyor.' },
  {
    id: 'reboot',
    label: 'Reboot Kontrolü',
    aciklama: 'Reboot öncesi ve sonrası çalıştırın: önce çalışan ürün ve JVM sonra da çalışmalı; kapalı kalan açılır, önce olmayan JVM kapatılır. Ölçülemeyen sunucu sorunsuz sayılmaz.',
  },
  {
    id: 'retirement',
    label: 'Retirement',
    aciklama: 'Uygulama retirement: Smart silme kaydı → tüm ortam/site keşfi → STOP (auto-start kapat, durdur, paketi .old) → seçilen tarihte silme → IP/LB/DNS kayıtları.',
  },
];

export default function BmwHubPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const sekme = (SEKMELER.find((t) => t.id === params.get('sekme'))?.id || 'isler') as SekmeId;
  const [acilan, setAcilan] = useState<Set<SekmeId>>(() => new Set<SekmeId>([sekme]));
  if (!acilan.has(sekme)) setAcilan((s) => new Set(s).add(sekme));

  // Server Hub (Bulgular / Uygulama 360 / Retirement Analizi) "Retirement kaydi ac" -> buraya
  // location.state ile gelir; her yeni istek kayit formunu bir kez acar, durum hemen temizlenir
  // (yenileme / geri tusu formu tekrar acmasin).
  const [retireOneri, setRetireOneri] = useState<{ uygulama: string; not: string; no: number } | null>(null);
  const gelen = (location.state as { retireOneri?: { uygulama: string; not: string } } | null)?.retireOneri;
  // Render sirasinda ayar (effect'te setState yok): her yeni gecis (location.key) bir kez islenir.
  const [islenenKey, setIslenenKey] = useState<string | null>(null);
  if (gelen?.uygulama && location.key !== islenenKey) {
    setIslenenKey(location.key);
    setRetireOneri((o) => ({ uygulama: gelen.uygulama, not: gelen.not || '', no: (o ? o.no : 0) + 1 }));
  }
  useEffect(() => {
    if (gelen?.uygulama) navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [gelen, location.pathname, location.search, navigate]);

  const sekmeSec = (id: SekmeId) =>
    setParams(
      (p) => {
        const n = new URLSearchParams();
        if (id !== 'isler') n.set('sekme', id);
        // Acik Isler'in gorunum / duzen secimi o sekmeye donunce kalsin.
        else ['gorunum', 'duzen'].forEach((k) => p.get(k) && n.set(k, p.get(k)!));
        return n;
      },
      { replace: false },
    );

  const aktif = SEKMELER.find((t) => t.id === sekme)!;
  return (
    <div className="space-y-5">
      <SectionHeader title="BMW Hub" subtitle={aktif.aciklama} />
      <div role="tablist" aria-label="BMW Hub sekmeleri" className="flex gap-1 border-b" style={{ borderColor: 'var(--border)' }}>
        {SEKMELER.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={sekme === t.id}
            onClick={() => sekmeSec(t.id)}
            className="px-3 py-2 text-[13px] font-medium -mb-px border-b-2 focus-visible:outline focus-visible:outline-2"
            style={{
              borderColor: sekme === t.id ? 'var(--bh-hue)' : 'transparent',
              color: sekme === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {acilan.has('isler') && (
        <SekmeKabi id="isler" etkin={sekme}>
          <AcikIsler />
        </SekmeKabi>
      )}
      {acilan.has('reboot') && (
        <SekmeKabi id="reboot" etkin={sekme}>
          <RebootKontroluTab />
        </SekmeKabi>
      )}
      {acilan.has('retirement') && (
        <SekmeKabi id="retirement" etkin={sekme}>
          <RetirementTab oneri={retireOneri} />
        </SekmeKabi>
      )}
    </div>
  );
}
