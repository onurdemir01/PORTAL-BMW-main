// src/components/server_hub/EarTemizlikTab.tsx — Server Hub › EAR Temizliği (2026-11-16, Admin).
//
// Kullanıcı: "EAR içinde WAR yok uyarılarını rahatlıkla temizleyebilmek için bir sayfa; ön kontrolde gerçekten bu
// dizine ls -ltr ile bakılmalı ve benim tarafımdan silinmeden önce teyit edilmeli."
//
// Akış (sunucu: server/server-hub/ear-temizlik.cjs): satırda "Ön kontrol" → AWX'te salt okunur PLAN işi (ls -ltr +
// güvenlik kapıları + parmak izi) → kullanıcı ls -ltr çıktısını bu ekranda görür, onay kutusunu işaretler ve EAR
// adını birebir yazar → "Yedekle ve sil": AWX parmak izini yeniden hesaplar (değiştiyse HİÇBİR ŞEY silinmez),
// tar.gz yedek alır, siler, doğrular → Portal o sunucu için Uygulama Envanteri taraması başlatır; uyarı o tarama
// bitince kalkar. Gizli sekme yoklama yapmaz (useSekmeGorunur). PROD satırı işaretlenir (ek onay yok).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowPathIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import {
  serverHubApi,
  type EtAday,
  type EtKayit,
  type EtKayitYanit,
  type EtListe,
} from '@/api/serverHubApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { toast } from '@/hooks/useToast';
import { fmtDateTime, fmtNumber } from '@/utils/datetime';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { Modal } from '@/components/common/Modal';
import { useSekmeGorunur } from './sekmeGorunurlugu';

/** Süren kayıt (ön kontrol / silme) yoklama aralığı. */
export const YOKLAMA_MS = 4000;
/** Teyit bekleyen plan için seyrek yoklama: başka admin iptal edebilir ya da süre dolabilir. */
export const PLAN_YOKLAMA_MS = 30000;
/** Bu kadar ardışık yoklama hatasından sonra satırda "durum okunamıyor" uyarısı çıkar. */
export const YOKLAMA_HATA_ESIGI = 3;
const SUREN = new Set(['PLANLANIYOR', 'SILINIYOR']);
const AKTIF = new Set(['PLANLANIYOR', 'PLAN_HAZIR', 'SILINIYOR']);
const HATALI = new Set(['PLAN_HATA', 'HATA', 'BELIRSIZ']);

export const DURUM_ETIKET: Record<string, string> = {
  PLANLANIYOR: 'Ön kontrol sürüyor (salt okunur)',
  PLAN_HAZIR: 'Çıktı hazır — teyit bekliyor',
  PLAN_HATA: 'Ön kontrol başarısız',
  PLAN_ESKIDI: 'Plan eskidi — yeniden ön kontrol gerekir',
  IPTAL: 'İptal edildi',
  SILINIYOR: 'Yedekleniyor ve siliniyor',
  SILINDI: 'Silindi (yedekli)',
  HATA: 'Silme başarısız',
  BELIRSIZ: 'Sonucu belirsiz — sunucuda elle kontrol edin',
};

export const durumRengi = (d: string) =>
  HATALI.has(d)
    ? 'var(--status-danger)'
    : d === 'SILINDI'
      ? 'var(--status-success)'
      : d === 'PLAN_HAZIR'
        ? 'var(--accent)'
        : d === 'PLAN_ESKIDI' || d === 'IPTAL'
          ? 'var(--status-warning)'
          : 'var(--text-muted)';

const adayAnahtari = (x: { host: string; kok: string; ad: string }) => `${x.host}|${x.kok}|${x.ad}`;

/** KB değerini okunur boyuta çevirir ("812 KB", "3,4 MB", "1,2 GB"). */
export function kbMetin(v: string | number | null | undefined): string {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return '—';
  if (n >= 1024 * 1024) return `${fmtNumber(Math.round(n / 1024 / 102.4) / 10)} GB`;
  if (n >= 1024) return `${fmtNumber(Math.round(n / 102.4) / 10)} MB`;
  return `${fmtNumber(n)} KB`;
}

/** Saniyeyi "dd:ss" biçimine çevirir (eksi değer 00:00). */
export function sureMetni(sn: number): string {
  const s = Math.max(0, Math.floor(sn));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const BILGI_ETIKET: Record<string, string> = {
  bicim: 'Biçim',
  war: 'WAR',
  domain_xml: 'domain.xml',
  surec: 'Süreç',
  boyut_kb: 'Boyut',
  dosya_sayisi: 'Dosya sayısı',
  sahip: 'Sahip',
  degistirilme: 'Değiştirilme',
};
const BILGI_SIRA = [
  'bicim',
  'war',
  'domain_xml',
  'surec',
  'boyut_kb',
  'dosya_sayisi',
  'sahip',
  'degistirilme',
];

/** Plan info satırları ekran sırasına: bilinen anahtarlar önce, yedek yeri ve parmak izi en sonda. */
export function bilgiSatirlari(
  plan: NonNullable<EtKayit['plan']>,
): { etiket: string; deger: string }[] {
  const m = new Map(plan.info.map((x) => [x.anahtar, x.deger]));
  const satir: { etiket: string; deger: string }[] = [];
  for (const k of BILGI_SIRA) {
    if (!m.has(k)) continue;
    let d = m.get(k) ?? '';
    if (k === 'boyut_kb') d = kbMetin(d);
    else if (k === 'bicim') d = d === 'ACIK' ? 'açık dizin' : d === 'ARSIV' ? 'arşiv dosyası' : d;
    else if (k === 'war') d = d === '0' ? '0 (WAR yok)' : d;
    satir.push({ etiket: BILGI_ETIKET[k], deger: d });
  }
  for (const [k, d] of m) {
    if (BILGI_SIRA.includes(k) || k === 'yedek_dizin' || k === 'yedek_bos_kb') continue;
    satir.push({ etiket: k, deger: d });
  }
  if (m.has('yedek_dizin') || m.has('yedek_bos_kb')) {
    satir.push({
      etiket: 'Yedek yeri',
      deger: `${m.get('yedek_dizin') || '—'} (boş alan ${kbMetin(m.get('yedek_bos_kb'))})`,
    });
  }
  satir.push({ etiket: 'Parmak izi', deger: plan.fp ? `${plan.fp.slice(0, 12)}…` : '—' });
  return satir;
}

export type KayitIzi = { k: EtKayit; t: number };

/** Plan geçerliliğinin bu andaki kalan saniyesi (yanıt anındaki kalanSn'den yerel saatle düşülür). */
export function kalanSaniye(iz: KayitIzi | undefined, simdi: number): number | null {
  if (!iz || iz.k.durum !== 'PLAN_HAZIR' || iz.k.kalanSn == null) return null;
  return iz.k.kalanSn - (simdi - iz.t) / 1000;
}

const hataMetni = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Kayıt başına yoklama hatası: ardışık sayı, son mesaj; kalıcı (404: kayıt yok) ise yoklama durur. */
export type YoklamaHatasi = { sayi: number; mesaj: string; kalici: boolean };
type YoklamaSonucu = { id: number; kayit: EtKayit } | { id: number; hata: string; kalici: boolean };

/** Tek kaydı okur; hatayı yutmaz, sonuca çevirir (safeJson ok:false gövdesi döndürür ya da fırlatır). */
async function yoklaKayit(id: number): Promise<YoklamaSonucu> {
  try {
    const r = await serverHubApi.earTemizlikKayit(id);
    if (r && r.ok && r.kayit) return { id, kayit: r.kayit };
    return {
      id,
      hata: (r && r.message) || 'Kayıt okunamadı.',
      kalici: !!r && r._httpStatus === 404,
    };
  } catch (e) {
    const status = (e as { status?: unknown } | null)?.status;
    return { id, hata: hataMetni(e), kalici: status === 404 };
  }
}

/** Yoklama sonuçlarını hata haritasına işler: başarı sayacı sıfırlar, hata bir artırır. */
export function yoklamaHatalariniIsle(
  eski: Map<number, YoklamaHatasi>,
  sonuclar: YoklamaSonucu[],
): Map<number, YoklamaHatasi> {
  const m = new Map(eski);
  for (const s of sonuclar) {
    if ('kayit' in s) m.delete(s.id);
    else m.set(s.id, { sayi: (m.get(s.id)?.sayi ?? 0) + 1, mesaj: s.hata, kalici: s.kalici });
  }
  return m;
}

function YoklamaUyarisi({ h }: { h: YoklamaHatasi | undefined }) {
  if (!h || (!h.kalici && h.sayi < YOKLAMA_HATA_ESIGI)) return null;
  return (
    <div
      className="text-[11px] flex items-start gap-1"
      role="alert"
      style={{ color: 'var(--status-danger)' }}
      data-testid="et-yoklama-hata"
    >
      <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0" />
      <span>
        {h.kalici
          ? `Durum okunamıyor, yoklama durdu: ${h.mesaj}`
          : `Durum okunamıyor (${h.sayi} deneme): ${h.mesaj}`}{' '}
        Gösterilen durum güncel olmayabilir; “Yenile” ile tekrar deneyin.
      </span>
    </div>
  );
}
/** safeJson ok:false gövdesini döndürür (fırlatmaz): ikisini tek yola indirir. */
function kayitAl(r: EtKayitYanit, varsayilan: string): EtKayit {
  if (!r || !r.ok || !r.kayit) throw new Error((r && r.message) || varsayilan);
  return r.kayit;
}

function ProdRozeti() {
  return (
    <span
      className="ml-1 rounded px-1 text-[10px] font-semibold border"
      style={{ color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
      data-testid="et-prod"
    >
      PROD
    </span>
  );
}

function KayitSonucu({ k }: { k: EtKayit }) {
  if (k.durum === 'SILINDI') {
    return (
      <div className="space-y-0.5">
        <div className="font-mono text-[11px] break-all" style={{ color: 'var(--text-secondary)' }}>
          Yedek: {k.yedek || '—'}
        </div>
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {k.envanter.not ||
            (k.envanter.kosuId != null
              ? `Uygulama Envanteri taraması #${k.envanter.kosuId} başlatıldı; uyarı tarama bitince kalkar.`
              : 'Uyarı bir sonraki Uygulama Envanteri taramasında kalkar.')}
        </div>
      </div>
    );
  }
  if (k.sonuc) {
    return (
      <div
        className="text-[11px] whitespace-pre-line break-words"
        style={{ color: HATALI.has(k.durum) ? 'var(--status-danger)' : 'var(--text-muted)' }}
      >
        {k.sonuc}
      </div>
    );
  }
  return null;
}

function TeyitPenceresi({
  iz,
  simdi,
  engel,
  onKapat,
  onSilindi,
}: {
  iz: KayitIzi;
  simdi: number;
  /** Taze taramada aday engelliyse (or. domain.xml'de deployment tanımlı) silme açılmaz. */
  engel: string | null;
  onKapat: () => void;
  onSilindi: (k: EtKayit) => void;
}) {
  const k = iz.k;
  const [inceledim, setInceledim] = useState(false);
  const [yazilan, setYazilan] = useState('');
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const kalan = kalanSaniye(iz, simdi);
  const doldu = kalan != null && kalan <= 0;
  const hazir = k.durum === 'PLAN_HAZIR' && !!k.plan && k.planJobId != null;
  const adTutar = yazilan === k.ad;
  // Süre bilinmiyorsa (kalanSn null) kapalı: sunucu da plan_bitis_at NULL iken silmeyi reddeder.
  const etkin = hazir && !engel && kalan != null && !doldu && inceledim && adTutar && !gonderiliyor;
  const neden = !hazir
    ? 'Plan artık teyit beklemiyor'
    : engel
      ? engel
      : kalan == null
        ? 'Plan geçerlilik süresi bilinmiyor; yeniden ön kontrol yapın'
        : doldu
          ? 'Plan süresi doldu; yeniden ön kontrol yapın'
          : !inceledim
            ? 'Önce çıktıyı incelediğinizi işaretleyin'
            : !adTutar
              ? 'EAR adını birebir yazın'
              : undefined;

  const sil = async () => {
    if (!etkin || k.planJobId == null) return;
    setGonderiliyor(true);
    setHata(null);
    try {
      const yeni = kayitAl(
        await serverHubApi.earTemizlikSil(k.id, { onayMetni: yazilan, planJobId: k.planJobId }),
        'Silme başlatılamadı.',
      );
      toast.success(`${k.host}: ${k.kok}/${k.ad} için yedekle ve sil işi başlatıldı.`);
      onSilindi(yeni);
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setGonderiliyor(false);
    }
  };

  const ls = k.plan?.ls || [];
  return (
    <Modal
      open
      onClose={onKapat}
      title="Çıktıyı gör ve teyit et"
      subtitle={`${k.host} — ${k.kok}/${k.ad}`}
      size="wide"
      dismissOnBackdrop={false}
      footer={
        <>
          <button
            type="button"
            className="btn-danger"
            disabled={!etkin}
            title={neden}
            onClick={() => void sil()}
          >
            {gonderiliyor ? 'Başlatılıyor…' : 'Yedekle ve sil'}
          </button>
          <button type="button" className="btn-secondary" onClick={onKapat}>
            İptal
          </button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]" data-testid="et-teyit">
        <p>
          <span className="font-mono font-semibold">{k.host}</span>
          {k.prod && <ProdRozeti />}{' '}
          <span style={{ color: 'var(--text-muted)' }}>JBoss {k.jboss}</span> — yol{' '}
          <span className="font-mono">
            {k.kok}/{k.ad}
          </span>
          . Ön kontrol işi #{k.planJobId ?? '—'} bu dizini salt okunur inceledi. Onaydan sonra AWX
          parmak izini yeniden hesaplar; içerik bu çıktıdan sonra değiştiyse{' '}
          <strong>hiçbir şey silinmez</strong>. Değişmediyse önce tar.gz yedek alınır, sonra
          silinir.
        </p>
        <div>
          <div className="text-[12px] font-semibold mb-1">ls -ltr çıktısı</div>
          <div
            className="rounded-lg border max-h-80 overflow-auto"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}
          >
            <pre
              className="font-mono text-[11px] leading-snug p-2 whitespace-pre w-max min-w-full"
              data-testid="et-ls"
            >
              {ls.length ? ls.join('\n') : '(çıktı yok)'}
            </pre>
          </div>
        </div>
        {k.plan && (
          <table className="text-[12px]" data-testid="et-bilgi">
            <tbody>
              {bilgiSatirlari(k.plan).map((s) => (
                <tr key={s.etiket} className="align-top">
                  <td
                    className="pr-3 py-0.5 whitespace-nowrap"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {s.etiket}
                  </td>
                  <td className="py-0.5 font-mono break-all">{s.deger}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p
          className="text-[12px] tabular-nums"
          style={{ color: doldu ? 'var(--status-danger)' : 'var(--text-secondary)' }}
          data-testid="et-kalan"
        >
          {kalan == null
            ? 'Plan geçerlilik süresi bilinmiyor.'
            : doldu
              ? 'Plan süresi doldu; yeniden ön kontrol yapın.'
              : `Kalan süre: ${sureMetni(kalan)}`}
        </p>
        {engel && (
          <p
            className="rounded-lg border px-3 py-2 text-[12px]"
            style={{ borderColor: 'var(--status-danger)', color: 'var(--status-danger)' }}
            data-testid="et-engel"
          >
            Taze taramada engel var, silinemez: {engel}. Planı satırdaki “Planı iptal et” ile
            kapatın.
          </p>
        )}
        <label
          className="flex items-start gap-2 rounded-lg border px-3 py-2"
          style={{ borderColor: 'var(--status-danger)' }}
        >
          <input
            type="checkbox"
            className="mt-0.5"
            checked={inceledim}
            onChange={(e) => setInceledim(e.target.checked)}
          />
          <span>Bu çıktıyı inceledim; dizin yedeklenip silinebilir</span>
        </label>
        <label className="block">
          <span className="text-[12px]">
            Onaylamak için EAR adını yazın: <span className="font-mono font-semibold">{k.ad}</span>
          </span>
          <input
            type="text"
            className="input-modern mt-1 w-full font-mono"
            value={yazilan}
            onChange={(e) => setYazilan(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label="EAR adı"
          />
        </label>
        {hata && (
          <p
            className="rounded-lg border px-3 py-2 text-[12px]"
            role="alert"
            style={{ borderColor: 'var(--status-danger)', color: 'var(--status-danger)' }}
          >
            {hata}
          </p>
        )}
      </div>
    </Modal>
  );
}

export default function EarTemizlikTab() {
  const gorunur = useSekmeGorunur();
  const [veri, setVeri] = useState<EtListe | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [eylemHata, setEylemHata] = useState<string | null>(null);
  const [izler, setIzler] = useState<Map<number, KayitIzi>>(new Map());
  const [mesgul, setMesgul] = useState<string | null>(null);
  const [teyitId, setTeyitId] = useState<number | null>(null);
  const [simdi, setSimdi] = useState(() => Date.now());
  const [yoklamaHatalari, setYoklamaHatalari] = useState<Map<number, YoklamaHatasi>>(new Map());

  const kayitlariYaz = useCallback((liste: EtKayit[], sifirla: boolean) => {
    const t = Date.now();
    setSimdi(t);
    setIzler((eski) => {
      const m = sifirla ? new Map<number, KayitIzi>() : new Map(eski);
      for (const k of liste) m.set(k.id, { k, t });
      return m;
    });
  }, []);

  const listeYukle = useCallback(async () => {
    setYukleniyor(true);
    setHata(null);
    try {
      const r = await serverHubApi.earTemizlikListe();
      if (!r || !r.ok) throw new Error((r && r.message) || 'EAR temizliği listesi okunamadı.');
      setVeri(r);
      const hepsi = [...(r.kayitlar || [])];
      for (const a of r.adaylar || []) if (a.kayit) hepsi.push(a.kayit);
      kayitlariYaz(hepsi, true);
      setYoklamaHatalari(new Map());
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setYukleniyor(false);
    }
  }, [kayitlariYaz]);

  useAsyncEffect(async () => {
    if (gorunur && !veri && !yukleniyor && !hata) await listeYukle();
  }, [gorunur]);

  // Aday başına son kayıt: listedeki kayıt ya da sonradan okunan daha yeni kayıt (en büyük id).
  const sonKayit = useMemo(() => {
    const m = new Map<string, KayitIzi>();
    for (const iz of izler.values()) {
      const a = adayAnahtari(iz.k);
      const o = m.get(a);
      if (!o || o.k.id < iz.k.id) m.set(a, iz);
    }
    return m;
  }, [izler]);

  // Kalıcı hata (404: kayıt yok) alan kayıt yoklanmaz; "Yenile" listeyi ve hataları sıfırlar.
  const yoklanir = useCallback((id: number) => !yoklamaHatalari.get(id)?.kalici, [yoklamaHatalari]);
  const surenIdler = useMemo(
    () =>
      [...izler.values()]
        .filter((iz) => SUREN.has(iz.k.durum) && yoklanir(iz.k.id))
        .map((iz) => iz.k.id),
    [izler, yoklanir],
  );
  const bekleyenIdler = useMemo(
    () =>
      [...izler.values()]
        .filter((iz) => iz.k.durum === 'PLAN_HAZIR' && yoklanir(iz.k.id))
        .map((iz) => iz.k.id),
    [izler, yoklanir],
  );

  // Hata yutulmaz: her kaydın ardışık hata sayısı tutulur, eşikte satırda uyarı çıkar.
  const kayitOku = useCallback(
    async (ids: number[]) => {
      const sonuc = await Promise.all(ids.map((id) => yoklaKayit(id)));
      const okunan = sonuc.flatMap((s) => ('kayit' in s ? [s.kayit] : []));
      if (okunan.length) kayitlariYaz(okunan, false);
      setYoklamaHatalari((eski) => yoklamaHatalariniIsle(eski, sonuc));
    },
    [kayitlariYaz],
  );

  // YOKLAMA: yalnız sekme görünürken; süren kayıt varken sık, yalnız teyit bekleyen varken seyrek.
  useEffect(() => {
    const ids = surenIdler.length ? [...surenIdler, ...bekleyenIdler] : bekleyenIdler;
    if (!gorunur || !ids.length) return undefined;
    const t = setInterval(
      () => {
        void kayitOku(ids);
      },
      surenIdler.length ? YOKLAMA_MS : PLAN_YOKLAMA_MS,
    );
    return () => clearInterval(t);
  }, [gorunur, surenIdler, bekleyenIdler, kayitOku]);

  // Geri sayım: teyit bekleyen plan varken saniyede bir (gizliyken durur).
  useEffect(() => {
    if (!gorunur || !bekleyenIdler.length) return undefined;
    const t = setInterval(() => setSimdi(Date.now()), 1000);
    return () => clearInterval(t);
  }, [gorunur, bekleyenIdler]);

  const onKontrol = async (a: EtAday) => {
    const anahtar = adayAnahtari(a);
    setMesgul(anahtar);
    setEylemHata(null);
    try {
      const k = kayitAl(
        await serverHubApi.earTemizlikOnKontrol({ host: a.host, kok: a.kok, ad: a.ad }),
        'Ön kontrol başlatılamadı.',
      );
      kayitlariYaz([k], false);
      toast.info(`${a.host}: ${a.kok}/${a.ad} için ön kontrol başlatıldı (salt okunur).`);
    } catch (e) {
      const m = hataMetni(e);
      setEylemHata(`${a.host} ${a.kok}/${a.ad}: ${m}`);
      toast.error(m);
    } finally {
      setMesgul(null);
    }
  };

  const planIptal = async (k: EtKayit) => {
    setMesgul(adayAnahtari(k));
    setEylemHata(null);
    try {
      kayitlariYaz(
        [kayitAl(await serverHubApi.earTemizlikIptal(k.id), 'Plan iptal edilemedi.')],
        false,
      );
      if (teyitId === k.id) setTeyitId(null);
    } catch (e) {
      const m = hataMetni(e);
      setEylemHata(`${k.host} ${k.kok}/${k.ad}: ${m}`);
      toast.error(m);
    } finally {
      setMesgul(null);
    }
  };

  const adaylar = veri?.adaylar || [];
  const kayitListesi = useMemo(
    () =>
      [...izler.values()]
        .map((iz) => iz.k)
        .sort((x, y) => y.id - x.id)
        .slice(0, 50),
    [izler],
  );
  const teyitIzi = teyitId != null ? izler.get(teyitId) : undefined;
  const teyitEngeli = teyitIzi
    ? (adaylar.find((a) => adayAnahtari(a) === adayAnahtari(teyitIzi.k))?.engel ?? null)
    : null;

  const eylem = (a: EtAday) => {
    const iz = sonKayit.get(adayAnahtari(a));
    const k = iz?.k;
    const ad = `${a.kok}/${a.ad}`;
    if (k && k.durum === 'PLAN_HAZIR') {
      const kalan = kalanSaniye(iz, simdi);
      return (
        <div className="flex flex-col gap-1 items-start">
          <button
            type="button"
            className="btn-danger text-[11px] px-2 py-0.5"
            disabled={!!a.engel}
            title={a.engel || undefined}
            onClick={() => setTeyitId(k.id)}
            aria-label={`Çıktıyı gör ve teyit et ${ad}`}
          >
            Çıktıyı gör ve teyit et
          </button>
          {kalan != null && (
            <span
              className="text-[10px] tabular-nums"
              style={{ color: kalan <= 0 ? 'var(--status-danger)' : 'var(--text-muted)' }}
            >
              {kalan <= 0 ? 'süre doldu' : `kalan ${sureMetni(kalan)}`}
            </span>
          )}
          <button
            type="button"
            className="text-[11px] underline"
            style={{ color: 'var(--text-muted)' }}
            disabled={mesgul === adayAnahtari(a)}
            onClick={() => void planIptal(k)}
          >
            Planı iptal et
          </button>
        </div>
      );
    }
    const surer = !!k && AKTIF.has(k.durum);
    const silindi = !!k && k.durum === 'SILINDI';
    const pasif = !!a.engel || surer || silindi || mesgul === adayAnahtari(a);
    const neden = a.engel
      ? a.engel
      : surer
        ? 'Bu EAR için süren bir kayıt var'
        : silindi
          ? 'Silindi; uyarı Uygulama Envanteri taraması bitince kalkar'
          : undefined;
    const etiket =
      k && k.durum === 'PLANLANIYOR'
        ? 'Ön kontrol sürüyor…'
        : k && k.durum === 'SILINIYOR'
          ? 'Siliniyor…'
          : 'Ön kontrol';
    return (
      <button
        type="button"
        className="btn-secondary text-[11px] px-2 py-0.5"
        disabled={pasif}
        title={neden}
        aria-label={`${etiket} ${a.host} ${ad}`}
        onClick={() => void onKontrol(a)}
      >
        {etiket}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {teyitIzi && (
        <TeyitPenceresi
          key={teyitIzi.k.id}
          iz={teyitIzi}
          simdi={simdi}
          engel={teyitEngeli}
          onKapat={() => setTeyitId(null)}
          onSilindi={(k) => {
            kayitlariYaz([k], false);
            setTeyitId(null);
          }}
        />
      )}
      <section
        className="rounded-xl border p-4 space-y-3"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              İçinde WAR olmayan EAR’lar
            </h2>
            <p className="text-[12px] mt-0.5 max-w-3xl" style={{ color: 'var(--text-muted)' }}>
              “Ön kontrol” sunucuda dizine salt okunur bakar (ls -ltr, WAR yeniden sayımı,
              domain.xml referansı, onu kullanan süreç, yedek alanı) ve parmak izi alır. Çıktıyı
              görüp teyit ettikten sonra “Yedekle ve sil” önce tar.gz yedek alır, sonra siler;
              içerik ön kontrolden sonra değiştiyse hiçbir şey silinmez. Plan{' '}
              {fmtNumber(veri?.planGecerlilikDk ?? 30)} dakika geçerlidir. Uyarı, silmeden sonra
              başlatılan Uygulama Envanteri taraması bitince kalkar.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary text-[12px] flex items-center gap-1"
            disabled={yukleniyor}
            onClick={() => void listeYukle()}
          >
            <ArrowPathIcon className="w-4 h-4" /> Yenile
          </button>
        </div>
        {hata && (
          <div
            className="text-[12px] rounded-lg border px-3 py-2"
            role="alert"
            style={{ color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
          >
            {hata}
          </div>
        )}
        {eylemHata && (
          <div
            className="text-[12px] rounded-lg border px-3 py-2 flex items-start gap-2"
            role="alert"
            style={{ color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
          >
            <ExclamationTriangleIcon className="w-4 h-4 shrink-0" />
            <span>{eylemHata}</span>
          </div>
        )}
        {yukleniyor && !veri ? (
          <LoadingLogo />
        ) : veri && !adaylar.length ? (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Taze taramada “EAR içinde WAR yok” uyarısı yok.
          </div>
        ) : veri ? (
          <div
            className="overflow-x-auto rounded-lg border"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <table className="w-full text-[12px]" data-testid="et-adaylar">
              <thead>
                <tr style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
                  <th className="text-left px-3 py-1.5 font-medium">Sunucu</th>
                  <th className="text-left px-3 py-1.5 font-medium">Ortam</th>
                  <th className="text-left px-3 py-1.5 font-medium">Yol</th>
                  <th className="text-left px-3 py-1.5 font-medium">JBoss</th>
                  <th className="text-left px-3 py-1.5 font-medium">Envanter tarihi</th>
                  <th className="text-left px-3 py-1.5 font-medium">Engel</th>
                  <th className="text-left px-3 py-1.5 font-medium">Son kayıt</th>
                  <th className="text-left px-3 py-1.5 font-medium">Eylem</th>
                </tr>
              </thead>
              <tbody>
                {adaylar.map((a) => {
                  const k = sonKayit.get(adayAnahtari(a))?.k;
                  return (
                    <tr
                      key={adayAnahtari(a)}
                      className="border-t align-top"
                      style={{ borderColor: 'var(--border-subtle)' }}
                      data-testid="et-aday"
                    >
                      <td className="px-3 py-1 font-mono font-semibold whitespace-nowrap">
                        {a.host}
                      </td>
                      <td className="px-3 py-1 whitespace-nowrap">
                        {a.ortam || '—'}
                        {a.prod && <ProdRozeti />}
                      </td>
                      <td className="px-3 py-1 font-mono break-all">
                        {a.kok}/{a.ad}
                      </td>
                      <td className="px-3 py-1">{a.jboss}</td>
                      <td
                        className="px-3 py-1 whitespace-nowrap"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {a.envanterTarihi ? fmtDateTime(a.envanterTarihi) : '—'}
                      </td>
                      <td
                        className="px-3 py-1"
                        style={{ color: a.engel ? 'var(--status-danger)' : 'var(--text-muted)' }}
                      >
                        {a.engel || '—'}
                      </td>
                      <td className="px-3 py-1 max-w-xs">
                        {k ? (
                          <div className="space-y-0.5">
                            <div style={{ color: durumRengi(k.durum) }}>
                              {DURUM_ETIKET[k.durum] || k.durum}
                            </div>
                            <KayitSonucu k={k} />
                            <YoklamaUyarisi h={yoklamaHatalari.get(k.id)} />
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td className="px-3 py-1">{eylem(a)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      {kayitListesi.length > 0 && (
        <section
          className="rounded-xl border p-4 space-y-2"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
        >
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Son kayıtlar
          </h2>
          <div
            className="overflow-x-auto rounded-lg border"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <table className="w-full text-[12px]" data-testid="et-kayitlar">
              <thead>
                <tr style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
                  <th className="text-left px-3 py-1.5 font-medium">#</th>
                  <th className="text-left px-3 py-1.5 font-medium">Sunucu</th>
                  <th className="text-left px-3 py-1.5 font-medium">Yol</th>
                  <th className="text-left px-3 py-1.5 font-medium">Durum</th>
                  <th className="text-left px-3 py-1.5 font-medium">Başlatan / onaylayan</th>
                  <th className="text-left px-3 py-1.5 font-medium">Güncellendi</th>
                  <th className="text-left px-3 py-1.5 font-medium">Sonuç</th>
                </tr>
              </thead>
              <tbody>
                {kayitListesi.map((k) => (
                  <tr
                    key={k.id}
                    className="border-t align-top"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <td className="px-3 py-1 tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      {k.id}
                    </td>
                    <td className="px-3 py-1 font-mono whitespace-nowrap">
                      {k.host}
                      {k.prod && <ProdRozeti />}
                    </td>
                    <td className="px-3 py-1 font-mono break-all">
                      {k.kok}/{k.ad}
                    </td>
                    <td className="px-3 py-1" style={{ color: durumRengi(k.durum) }}>
                      {DURUM_ETIKET[k.durum] || k.durum}
                    </td>
                    <td className="px-3 py-1" style={{ color: 'var(--text-secondary)' }}>
                      {k.olusturan}
                      {k.onaylayan ? ` / ${k.onaylayan}` : ''}
                    </td>
                    <td
                      className="px-3 py-1 whitespace-nowrap"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {fmtDateTime(k.updatedAt)}
                    </td>
                    <td className="px-3 py-1 max-w-md">
                      <KayitSonucu k={k} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
