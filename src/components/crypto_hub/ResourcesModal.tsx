// src/components/crypto_hub/ResourcesModal.tsx — CPU / bellek: göster → önizle → onayla → uygula
// (2026-10-02).
//
// Kullanıcı: "CPU ve belleği Portal'dan değiştirip Helm'e KALICI işleyelim."
//
// ÜÇ KURAL:
//  1) Values İÇERİĞİ bu ekrana hiç gelmez ve buradan gitmez: yalnız {bileşen yolu, kap, alan,
//     eski, yeni}. Dosya yolu ve release KATALOGDAN çözülür (sunucu + playbook).
//  2) "Ölçülemedi" ile "yok/geçti" KARIŞMAZ: canlı değer, dosya değeri, LimitRange okunamadıysa
//     ekran "ölçülemedi" der — "chart varsayılanı" ya da "geçti" DEMEZ.
//  3) Uygulama yalnız TEMİZ bir önizlemenin jetonuyla olur (15 dk, kullanıcıya bağlı, tek
//     kullanımlık); riskli bileşende ayrı onay kutusu sunucuda da zorunlu. "Geri al" ayrı bir
//     yol DEĞİL: eski değerlerle aynı önizle → onayla → uygula yolundan geçer.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  QuestionMarkCircleIcon,
  ArrowUturnLeftIcon,
} from '@heroicons/react/24/outline';
import { Modal } from '@/components/common/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtTime } from '@/utils/datetime';
import {
  cryptoOpsApi,
  type CryptoOpsResult,
  type CryptoResAlan,
  type CryptoResChange,
  type CryptoResDogrulama,
  type CryptoResources,
  type CryptoTenant,
} from '@/api/cryptoHubApi';
import {
  ALANLAR,
  SINIRLAR,
  kaynakYazmaKapisi,
  isYukuKayitlari,
  yazilabilirKayit,
  riskliYol,
  standartMi,
  standartla,
  bicimle,
  heapTahminiMi,
  dogrula,
  ayniMiktar,
} from '../../../shared/cryptoHubResources.cjs';

const SM_BTN =
  'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';
const KUTU = 'rounded-lg border px-3 py-2 text-[12px]';
const ton = (t: 'ok' | 'warn' | 'danger' | 'muted' | 'info'): React.CSSProperties => {
  if (t === 'ok')
    return { color: 'var(--status-success)', borderColor: 'var(--status-success)', background: 'var(--status-success-bg, transparent)' };
  if (t === 'warn')
    return { color: 'var(--status-warning)', borderColor: 'var(--status-warning)', background: 'var(--status-warning-bg, transparent)' };
  if (t === 'danger')
    return { color: 'var(--status-danger)', borderColor: 'var(--status-danger)', background: 'var(--status-danger-bg)' };
  if (t === 'info')
    return { color: 'var(--text-primary)', borderColor: 'var(--border)', background: 'var(--bg-elevated)' };
  return { color: 'var(--text-muted)', borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' };
};
const btn = (t?: 'primary' | 'danger'): React.CSSProperties =>
  t === 'primary'
    ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-fg, #fff)' }
    : t === 'danger'
      ? { background: 'var(--status-danger)', borderColor: 'var(--status-danger)', color: '#fff' }
      : { borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' };

const ETIKET: Record<CryptoResAlan, string> = {
  'requests.cpu': 'requests · cpu',
  'requests.memory': 'requests · bellek',
  'limits.cpu': 'limits · cpu',
  'limits.memory': 'limits · bellek',
};
const turOf = (a: CryptoResAlan) => (a.endsWith('.cpu') ? 'cpu' : 'memory');

/** Kontrol durumunun rengi: "olculemedi" SARI — "gecti" (yeşil) ile asla aynı değil. */
const DURUM_TON: Record<string, 'ok' | 'warn' | 'danger' | 'muted' | 'info'> = {
  gecti: 'ok',
  dur: 'danger',
  uyari: 'warn',
  olculemedi: 'warn',
  bilgi: 'muted',
};
const DURUM_ETIKET: Record<string, string> = {
  gecti: 'geçti',
  dur: 'DUR',
  uyari: 'uyarı',
  olculemedi: 'ölçülemedi',
  bilgi: 'bilgi',
};

const SONUC_METNI: Record<string, { metin: string; t: 'ok' | 'warn' | 'danger' }> = {
  uygulandi: { metin: 'Uygulandı: dosya yazıldı, helm upgrade geçti, gözlem temiz, eş dosyalar yazıldı.', t: 'ok' },
  uygulandi_sorunlu: {
    metin:
      'Uygulandı AMA sorun var (otomatik geri alma YOK) — ayrıntı aşağıda. Gerekirse "Geri al" ile eski değerleri aynı yoldan uygulayın.',
    t: 'warn',
  },
  dur: { metin: 'Durdu: hiçbir şey değişmedi.', t: 'danger' },
  geri_alindi: {
    metin:
      'helm upgrade düştü; kümenin önceki revizyona döndüğü (helm history: deployed) ve dosyanın yedekten geri alındığı ÖLÇÜLDÜ.',
    t: 'danger',
  },
  geri_alinamadi: { metin: 'GERİ ALINAMADI — elle müdahale gerekli.', t: 'danger' },
};

/** Sonuç kodlarının ayrı açıklaması (RESEND kod alanı virgülle birden çok olabilir). */
const KOD_METNI: Record<string, string> = {
  GOZLEM: 'Gözlemde sorun görüldü (OOMKilled, CrashLoop, yeniden başlama, Pending ya da eski değerle koşan pod).',
  ES_YAZILAMADI:
    'Eş cluster dosyasına aynı düzenleme YAZILAMADI — aktif ve pasif dosya ayrıştı; devirde pasif taraf eski değerle açılır. Eş dosyayı ayrıca düzeltin.',
  KUME_GERI_ALINAMADI:
    'Kümenin geri döndüğü doğrulanamadı (helm geri alması düştü ya da son revizyon "deployed" değil / ölçülemedi). Dosya ile küme ayrışmış olabilir.',
};

/** Adım durumunun ekrandaki karşılığı: ölçülemedi SARI, atlanan bilgi, gerisi DUR. */
const adimTon = (d: string) => (d === 'ok' ? 'gecti' : d === 'atlandi' ? 'bilgi' : d === 'olculemedi' ? 'olculemedi' : 'dur');

/** Değerin KAYNAĞI: dosya · chart varsayılanı · ölçülemedi (ve tanımsız). */
type DosyaHucre = { deger: string; kaynak: 'dosya' | 'chart' | 'olculemedi' | 'tanimsiz' };

function dosyaHucreleri(
  res: CryptoResources | null,
  yol: string | null,
): Record<CryptoResAlan, DosyaHucre> {
  const out = {} as Record<CryptoResAlan, DosyaHucre>;
  const src = res?.src;
  const satirlar = (res?.files || []).filter((f) => f.bilesen === yol);
  // Dosya OKUNAMADIYSA (UTF-8 değil, girintide TAB = YAML geçersiz, yardımcı düştü) bu bileşen
  // için satır gelmemesi "dosyada yok" DEĞİLDİR: güvenli taraf "ölçülemedi". TAB hatası da
  // dahil (helm de o dosyayı okuyamaz); bileşene bağlanamayan hata bütün alanları kapsar.
  const dosyaHatasi =
    (res?.errors || []).some((e) => /dosya/.test(e.asama)) ||
    (res?.checks || []).some((c) => /^dosya/.test(c.kontrol) && c.durum === 'dur');
  for (const a of ALANLAR as CryptoResAlan[]) {
    if (!res || !yol) out[a] = { deger: '', kaynak: 'olculemedi' };
    else if (!src || src.durum === 'olculemedi') out[a] = { deger: '', kaynak: 'olculemedi' };
    else if (src.durum === 'tanimsiz') out[a] = { deger: '', kaynak: 'tanimsiz' };
    else {
      const s = satirlar.find((f) => f.alan === a);
      if (s && (s.deger === 'OKUNAMADI' || s.deger === 'GECERSIZ'))
        out[a] = { deger: '', kaynak: 'olculemedi' };
      else if (s && s.deger !== 'YOK') out[a] = { deger: s.deger, kaynak: 'dosya' };
      else if (!s && dosyaHatasi) out[a] = { deger: '', kaynak: 'olculemedi' };
      // Dosyada alan ya da blok yok: değer chart varsayılanından gelir ("sınırsız" DEĞİL).
      else out[a] = { deger: '', kaynak: 'chart' };
    }
  }
  return out;
}

function KaynakEtiketi({ k }: { k: DosyaHucre['kaynak'] | 'canli' }) {
  const m = {
    dosya: { t: 'info' as const, m: 'dosya' },
    chart: { t: 'muted' as const, m: 'chart varsayılanı' },
    olculemedi: { t: 'warn' as const, m: 'ölçülemedi' },
    tanimsiz: { t: 'muted' as const, m: 'dosya tanımlı değil' },
    canli: { t: 'info' as const, m: 'canlı' },
  }[k];
  return (
    <span className="px-1.5 py-0.5 rounded border text-[10px] whitespace-nowrap" style={ton(m.t)}>
      {m.m}
    </span>
  );
}

function Durum({ d }: { d: string }) {
  const t = DURUM_TON[d] || 'muted';
  const Icon = t === 'ok' ? CheckCircleIcon : t === 'danger' ? XCircleIcon : t === 'warn' ? ExclamationTriangleIcon : QuestionMarkCircleIcon;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: ton(t).color }}>
      <Icon className="h-3.5 w-3.5" /> {DURUM_ETIKET[d] || d}
    </span>
  );
}

function Baslik({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>
      {children}
    </div>
  );
}

/** AWX işini bekler. Yazan iş (apply) 2400 sn async + pay: 45 dk; önizleme 16 dk; okuma 6 dk. */
async function isiBekle(
  serverId: number,
  jobId: number,
  dakika: number,
  iptal: React.MutableRefObject<boolean>,
): Promise<{ result: CryptoOpsResult | null; hata: string | null }> {
  const bitis = Date.now() + dakika * 60 * 1000;
  for (;;) {
    if (iptal.current) return { result: null, hata: 'iptal' };
    const r = await cryptoOpsApi.result(serverId, jobId);
    if (!r.ok) return { result: null, hata: r.message || 'Sonuç okunamadı.' };
    if (r.result) return { result: r.result, hata: null };
    if (['failed', 'error', 'canceled'].includes(r.status))
      return { result: null, hata: `İş ${r.status} durumunda bitti (#${jobId}); sonuç satırı gelmedi.` };
    if (Date.now() > bitis)
      return { result: null, hata: `İş hâlâ sürüyor (#${jobId}); Ansible ekranından izleyebilirsiniz.` };
    await new Promise((res) => setTimeout(res, 3000));
  }
}

type Asama = 'bos' | 'calisiyor' | 'bitti' | 'hata';

export function ResourcesModal({
  tenant,
  tenantLabel,
  kind,
  name,
  onClose,
}: {
  tenant: CryptoTenant;
  tenantLabel: string;
  kind: string;
  name: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const admin = user?.role === 'Admin';
  const iptal = useRef(false);
  useEffect(
    () => () => {
      iptal.current = true;
    },
    [],
  );

  const wlKind = String(kind).toLowerCase().startsWith('stateful') ? 'StatefulSet' : 'Deployment';
  const kapi = kaynakYazmaKapisi(tenant);
  const kayitlar = useMemo(
    () => isYukuKayitlari(tenant.app, tenant.helmRelease, wlKind, name),
    [tenant.app, tenant.helmRelease, wlKind, name],
  );

  const [get, setGet] = useState<{ asama: Asama; res: CryptoResources | null; hata: string }>({
    asama: 'bos',
    res: null,
    hata: '',
  });
  const [kapSecim, setKap] = useState('');
  const [yeni, setYeni] = useState<Record<CryptoResAlan, string>>({
    'requests.cpu': '',
    'requests.memory': '',
    'limits.cpu': '',
    'limits.memory': '',
  });
  const [asim, setAsim] = useState(false);
  const [gerekce, setGerekce] = useState('');
  const [plan, setPlan] = useState<{
    asama: Asama;
    res: CryptoResources | null;
    hata: string;
    dogrulama: CryptoResDogrulama | null;
    degisiklik: CryptoResChange[];
  }>({ asama: 'bos', res: null, hata: '', dogrulama: null, degisiklik: [] });
  const [onay, setOnay] = useState(false);
  const [riskliOnay, setRiskliOnay] = useState(false);
  const [bekleyenOnay, setBekleyenOnay] = useState(false);
  const [uygula, setUygula] = useState<{
    asama: Asama;
    res: CryptoResources | null;
    sonuc: CryptoOpsResult | null;
    hata: string;
  }>({ asama: 'bos', res: null, sonuc: null, hata: '' });
  const [geriAlNotu, setGeriAlNotu] = useState('');

  const oku = useCallback(async () => {
    setGet((g) => ({ ...g, asama: 'calisiyor', hata: '' }));
    const s = await cryptoOpsApi.run({ tenant: tenant.key, action: 'resources_get', targets: [] });
    if (!s.ok || s.jobId == null || s.awxServerId == null) {
      setGet({ asama: 'hata', res: null, hata: s.message || 'İş başlatılamadı.' });
      return;
    }
    const b = await isiBekle(s.awxServerId, s.jobId, 6, iptal);
    if (iptal.current) return;
    if (!b.result?.resources) {
      setGet({ asama: 'hata', res: null, hata: b.hata || 'Kaynak satırı gelmedi (ölçülemedi).' });
      return;
    }
    setGet({ asama: 'bitti', res: b.result.resources, hata: '' });
  }, [tenant.key]);

  // Ilk okuma effect flush'indan SONRA (useAsyncEffect): set-state-in-effect yok.
  useAsyncEffect(
    async (alive) => {
      if (alive()) await oku();
    },
    [oku],
  );

  const res = get.res;
  const canliKaplar = useMemo(
    () => (res?.live || []).filter((l) => l.kind === wlKind && l.ad === name),
    [res, wlKind, name],
  );
  const kapSecenekleri = useMemo(() => {
    const s = new Set<string>();
    for (const l of canliKaplar) s.add(l.kap);
    for (const k of kayitlar) if (k.kap) s.add(k.kap);
    return [...s];
  }, [canliKaplar, kayitlar]);
  // Secilmemisse VARSAYILAN kap: kayitli (yaziya acik) kap, yoksa ilk kap. Turetilir, effect yok.
  const varsayilanKap = useMemo(() => {
    const tercih = kayitlar.find((k) => yazilabilirKayit(k) && kapSecenekleri.includes(k.kap));
    return tercih ? tercih.kap : kapSecenekleri[0] || '';
  }, [kapSecenekleri, kayitlar]);
  const kap = kapSecim && kapSecenekleri.includes(kapSecim) ? kapSecim : varsayilanKap;

  const kayit = kayitlar.find((k) => k.kap === kap) || null;
  const canliKap = canliKaplar.find((l) => l.kap === kap) || null;
  // 'canli' (oc okunamadı) ve 'canli-oku' (yardımcı JSON'u ayrıştıramadı) ikisi de ÖLÇÜLEMEDİ:
  // kap listesi boş gelir ama bu "canlıda bu kap yok" demek DEĞİL.
  const canliOlculdu = !!res && !(res.errors || []).some((e) => /^canli/.test(e.asama));
  const dosya = dosyaHucreleri(res, kayit ? kayit.yol : null);
  const riskli = !!kayit && riskliYol(kayit.yol);

  // Değişiklik listesi: yalnız dolu ve DOSYADAKİNDEN farklı alanlar. eski = dosyadaki değer.
  const degisiklik: CryptoResChange[] = useMemo(() => {
    const out: CryptoResChange[] = [];
    for (const a of ALANLAR as CryptoResAlan[]) {
      const y = yeni[a].trim();
      if (!y) continue;
      const eski = dosya[a].kaynak === 'dosya' ? dosya[a].deger : '';
      if (eski && ayniMiktar(eski, y, turOf(a))) continue;
      out.push({ alan: a, eski, yeni: y });
    }
    return out;
    // dosya her render yeniden hesaplanir; icerigi res + kayit'a bagli
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yeni, res, kayit?.yol]);

  const birimHatalari = (ALANLAR as CryptoResAlan[])
    .filter((a) => yeni[a].trim() && !standartMi(yeni[a].trim(), turOf(a)))
    .map((a) => {
      const oneri = standartla(yeni[a].trim(), turOf(a));
      return `${ETIKET[a]}: "${yeni[a].trim()}" standart biçimde değil${oneri ? ` — "${oneri}" mi?` : ''} (cpu: 1500m ya da 2; bellek: 512Mi ya da 4Gi; 512M onluk birimdir, 512Mi ile aynı DEĞİL).`;
    });
  const olcEksik = (ALANLAR as CryptoResAlan[]).filter(
    (a) => yeni[a].trim() && dosya[a].kaynak === 'olculemedi',
  );

  const canliDeger = (a: CryptoResAlan) => (canliKap ? canliKap[a] : null);
  const canliHarita = canliKap
    ? (Object.fromEntries((ALANLAR as CryptoResAlan[]).map((a) => [a, canliKap[a]])) as Record<CryptoResAlan, string | null>)
    : null;
  const yerel =
    degisiklik.length && !birimHatalari.length
      ? dogrula({
          degisiklikler: degisiklik,
          canli: canliOlculdu ? canliHarita : null,
          limitRange: res ? res.limitRange : { durum: 'olculemedi' },
          asim: admin && asim,
          admin,
          gerekce,
        })
      : null;

  const yazmaAcik = kapi.acik && yazilabilirKayit(kayit) && !!canliKap;
  const onizlenebilir =
    yazmaAcik &&
    degisiklik.length > 0 &&
    !birimHatalari.length &&
    !olcEksik.length &&
    plan.asama !== 'calisiyor' &&
    uygula.asama !== 'calisiyor' &&
    !!yerel &&
    yerel.ok;

  const onizle = async () => {
    setOnay(false);
    setUygula({ asama: 'bos', res: null, sonuc: null, hata: '' });
    setPlan({ asama: 'calisiyor', res: null, hata: '', dogrulama: null, degisiklik });
    const s = await cryptoOpsApi.run({
      tenant: tenant.key,
      action: 'resources_plan',
      targets: [],
      component: kayit!.yol,
      container: kap,
      kind: wlKind,
      name,
      changes: degisiklik,
      policyOverride: admin && asim ? true : undefined,
      reason: admin && asim ? gerekce : undefined,
      live: canliHarita || undefined,
    });
    if (!s.ok || s.jobId == null || s.awxServerId == null) {
      setPlan({
        asama: 'hata',
        res: null,
        hata: s.message || 'Önizleme başlatılamadı.',
        dogrulama: s.dogrulama || null,
        degisiklik,
      });
      return;
    }
    const b = await isiBekle(s.awxServerId, s.jobId, 16, iptal);
    if (iptal.current) return;
    if (!b.result?.resources) {
      setPlan({ asama: 'hata', res: null, hata: b.hata || 'Plan satırı gelmedi.', dogrulama: s.dogrulama || null, degisiklik });
      return;
    }
    setRiskliOnay(false);
    setBekleyenOnay(false);
    setPlan({ asama: 'bitti', res: b.result.resources, hata: '', dogrulama: s.dogrulama || null, degisiklik });
  };

  const p = plan.res;
  const planOk = !!p?.plan && p.plan.durum === 'ok' && !!p.planJetonu;
  const planRiskli = !!p?.plan?.riskli || riskli;
  const planBekleyen = !!p?.plan?.bekleyen;

  const uygulaCalistir = async () => {
    if (!p?.planJetonu) return;
    setUygula({ asama: 'calisiyor', res: null, sonuc: null, hata: '' });
    const s = await cryptoOpsApi.run({
      tenant: tenant.key,
      action: 'resources_apply',
      targets: [],
      confirmed: true,
      planToken: p.planJetonu,
      riskyAck: planRiskli ? riskliOnay : undefined,
      acceptPending: planBekleyen ? bekleyenOnay : undefined,
    });
    setOnay(false);
    if (!s.ok || s.jobId == null || s.awxServerId == null) {
      setUygula({ asama: 'hata', res: null, sonuc: null, hata: s.message || 'Uygulama başlatılamadı.' });
      return;
    }
    // Jeton TEK KULLANIMLIK: önizleme sonucu artık uygulanamaz.
    setPlan((x) => ({ ...x, res: x.res ? { ...x.res, planJetonu: null, planJetonDurumu: 'kullanildi' } : x.res }));
    const b = await isiBekle(s.awxServerId, s.jobId, 45, iptal);
    if (iptal.current) return;
    if (!b.result?.resources) {
      setUygula({ asama: 'hata', res: null, sonuc: b.result, hata: b.hata || 'Sonuç satırı gelmedi.' });
      return;
    }
    setUygula({ asama: 'bitti', res: b.result.resources, sonuc: b.result, hata: '' });
  };

  // GERİ AL: ayrı bir yol değil. Eski dosya değerleri formun "yeni" alanına yazılır, dosya
  // YENİDEN okunur (eski = artık yazılmış değer) ve kullanıcı yine önizle → onayla → uygula.
  const geriAl = () => {
    const birincil = (uygula.res?.edits || []).filter((e) => e.rol === 'birincil');
    const y: Record<CryptoResAlan, string> = {
      'requests.cpu': '',
      'requests.memory': '',
      'limits.cpu': '',
      'limits.memory': '',
    };
    const notlar: string[] = [];
    for (const e of birincil) {
      const a = e.alan as CryptoResAlan;
      if (!(ALANLAR as string[]).includes(a)) continue;
      if (e.eski && e.eski !== 'YOK') {
        y[a] = standartMi(e.eski, turOf(a)) ? e.eski : standartla(e.eski, turOf(a)) || e.eski;
      } else {
        const onceki = canliDeger(a);
        if (onceki) {
          y[a] = standartla(onceki, turOf(a)) || onceki;
          notlar.push(`${ETIKET[a]} dosyada yoktu (chart varsayılanı); önceki çalışan değer (${onceki}) AÇIKÇA yazılacak.`);
        } else {
          notlar.push(`${ETIKET[a]} dosyada yoktu ve önceki çalışan değer bilinmiyor — elle girin.`);
        }
      }
    }
    setYeni(y);
    setGeriAlNotu(notlar.join(' '));
    setPlan({ asama: 'bos', res: null, hata: '', dogrulama: null, degisiklik: [] });
    setUygula({ asama: 'bos', res: null, sonuc: null, hata: '' });
    void oku();
  };

  const lr = res?.limitRange;
  const lrSatir = (lr?.kurallar || []).filter((k) => k.tur === 'Container' && (k.kaynak === 'cpu' || k.kaynak === 'memory'));
  const heapCanli = heapTahminiMi(canliDeger('limits.memory'));
  const heapYeni = yeni['limits.memory'].trim() ? heapTahminiMi(yeni['limits.memory'].trim()) : null;
  const sonucBilgi = uygula.res?.end ? SONUC_METNI[uygula.res.end.sonuc] : null;

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="wide"
        dismissOnBackdrop={false}
        title={`CPU / bellek — ${name}`}
        subtitle={`${tenantLabel} · ${wlKind}`}
        footer={
          <div className="flex items-center gap-2 w-full flex-wrap">
            <button type="button" className={SM_BTN} style={btn()} disabled={get.asama === 'calisiyor'} onClick={() => void oku()}>
              <ArrowPathIcon className={`h-3.5 w-3.5 ${get.asama === 'calisiyor' ? 'animate-spin' : ''}`} /> Yeniden oku
            </button>
            <button
              type="button"
              className={SM_BTN}
              style={btn('primary')}
              disabled={!onizlenebilir}
              onClick={() => void onizle()}
              title="Bastion'da geçici kopyada manifest üretir; dosyaya ve kümeye yazmaz"
            >
              {plan.asama === 'calisiyor' ? 'Önizleniyor…' : 'Önizle'}
            </button>
            <button
              type="button"
              className={SM_BTN}
              style={btn('danger')}
              disabled={!planOk || uygula.asama === 'calisiyor'}
              onClick={() => setOnay(true)}
            >
              {uygula.asama === 'calisiyor' ? 'Uygulanıyor…' : 'Uygula…'}
            </button>
            <span className="flex-1" />
            <button type="button" className="h-8 px-3 text-xs rounded-lg border" style={btn()} onClick={onClose}>
              Kapat
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          {!kapi.acik && (
            <div className={KUTU} style={ton('warn')} data-testid="kaynak-kapali">
              {kapi.mesaj}
            </div>
          )}
          {kapi.acik && tenant.resValuesPath && (
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              values dosyası (katalog): <code>{tenant.resValuesPath}</code> ·{' '}
              {tenant.resValuesVerified ? 'doğrulandı' : 'doğrulanmadı — her önizleme canlıyla karşılaştırır'}
            </div>
          )}
          {get.asama === 'calisiyor' && !res && (
            <div className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>
              Canlı değerler, dosyadaki resources satırları ve LimitRange okunuyor… (AWX işi)
            </div>
          )}
          {get.asama === 'hata' && (
            <div className={KUTU} style={ton('danger')}>
              {get.hata} — değerler <b>ölçülemedi</b>.
            </div>
          )}
          {res && res.end?.sonuc === 'kismi' && (
            <div className={KUTU} style={ton('warn')}>
              Ölçüm KISMİ: bazı parçalar okunamadı (aşağıda “ölçülemedi” yazanlar). Okunamayan parça “yok” sayılmaz.
            </div>
          )}
          {(res?.errors || []).map((e, i) => (
            <div key={i} className={KUTU} style={ton('warn')}>
              <b>{e.asama}</b> — {e.mesaj}
            </div>
          ))}

          {res && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[12px] inline-flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                kap
                <select
                  aria-label="kap"
                  value={kap}
                  onChange={(e) => {
                    setKap(e.target.value);
                    setPlan({ asama: 'bos', res: null, hata: '', dogrulama: null, degisiklik: [] });
                  }}
                  className="h-7 text-[12px] rounded-lg border px-1"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                >
                  {kapSecenekleri.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
              {kayit ? (
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  values yolu <code>{kayit.yol}</code> ·{' '}
                  {kayit.durum === 'kayitli' ? 'kayıtlı' : kayit.durum === 'olu' ? 'ÖLÜ ANAHTAR' : kayit.durum === 'kapsam_disi' ? 'kapsam dışı' : 'tahmin — yazılmaz'}
                </span>
              ) : (
                <span className="text-[11px]" style={{ color: 'var(--status-warning)' }}>
                  Bu kap için values yolu KAYITLI değil — değerler yalnız gösterilir.
                </span>
              )}
              {riskli && (
                <span className="px-1.5 py-0.5 rounded border text-[10px] font-medium" style={ton('danger')}>
                  riskli bileşen
                </span>
              )}
              {!canliKap && res && (
                <span className="text-[11px]" style={{ color: 'var(--status-warning)' }}>
                  canlıda bu kap {canliOlculdu ? 'yok' : 'ölçülemedi'}
                </span>
              )}
            </div>
          )}
          {kayit && kayit.durum !== 'kayitli' && kayit.not && (
            <div className={KUTU} style={ton('warn')}>
              {kayit.not}
            </div>
          )}
          {kayit?.not && kayit.durum === 'kayitli' && riskli && (
            <div className={KUTU} style={ton('warn')}>
              {kayit.not}
            </div>
          )}

          {res && (
            <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--border-subtle)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
                    <th className="text-left font-medium px-3 py-2">Alan</th>
                    <th className="text-left font-medium px-3 py-2">Canlı (spec)</th>
                    <th className="text-left font-medium px-3 py-2">Dosya</th>
                    <th className="text-left font-medium px-3 py-2">Yeni</th>
                  </tr>
                </thead>
                <tbody>
                  {(ALANLAR as CryptoResAlan[]).map((a) => {
                    const c = canliDeger(a);
                    const d = dosya[a];
                    return (
                      <tr key={a} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                        <td className="px-3 py-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                          {ETIKET[a]}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-[12px]" data-testid={`canli-${a}`}>
                          {!canliOlculdu ? (
                            <KaynakEtiketi k="olculemedi" />
                          ) : !canliKap ? (
                            '—'
                          ) : c == null ? (
                            <span style={{ color: 'var(--text-muted)' }}>yok (LimitRange varsayılanı)</span>
                          ) : (
                            <>
                              {c} <span style={{ color: 'var(--text-muted)' }}>({bicimle(c, turOf(a))})</span>
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-[12px]" data-testid={`dosya-${a}`}>
                          <span className="inline-flex items-center gap-1.5">
                            {d.kaynak === 'dosya' && d.deger} <KaynakEtiketi k={d.kaynak} />
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            aria-label={`yeni ${a}`}
                            value={yeni[a]}
                            disabled={!yazmaAcik || uygula.asama === 'calisiyor'}
                            onChange={(e) => {
                              const v = e.target.value.replace(/\s/g, '');
                              setYeni((s) => ({ ...s, [a]: v }));
                              setPlan({ asama: 'bos', res: null, hata: '', dogrulama: null, degisiklik: [] });
                            }}
                            placeholder={turOf(a) === 'cpu' ? 'örn. 1500m' : 'örn. 4Gi'}
                            className="h-7 px-2 text-[12px] rounded-lg border w-28 tabular-nums"
                            style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {res && (
            <div className="grid gap-2 md:grid-cols-2">
              <div className={KUTU} style={ton('info')}>
                <Baslik>Yaklaşık JVM heap (bellek limiti × {Math.round(0.75 * 100)}%)</Baslik>
                şu an: {heapCanli != null ? `~${heapCanli}Mi` : canliOlculdu ? 'limit yok' : 'ölçülemedi'}
                {heapYeni != null && <> · yeni: ~{heapYeni}Mi</>}
              </div>
              <div className={KUTU} style={ton(lr?.durum === 'olculemedi' ? 'warn' : 'info')} data-testid="limitrange">
                <Baslik>LimitRange (Container)</Baslik>
                {lr?.durum === 'olculemedi' && 'ölçülemedi — sınırlar burada denetlenemez (“yok” DEĞİL)'}
                {lr?.durum === 'yok' && 'yok (ölçüldü)'}
                {lr?.durum === 'olculdu' &&
                  (lrSatir.length
                    ? lrSatir.map((k, i) => (
                        <div key={i}>
                          {k.kaynak} {k.ozellik}: {k.deger}
                        </div>
                      ))
                    : 'Container kuralı yok')}
              </div>
              <div className={KUTU} style={ton(res.quota.durum === 'olculemedi' ? 'warn' : 'info')}>
                <Baslik>Kota (ResourceQuota)</Baslik>
                {res.quota.durum === 'olculemedi' && 'ölçülemedi'}
                {res.quota.durum === 'yok' && 'yok (ölçüldü)'}
                {res.quota.durum === 'olculdu' &&
                  res.quota.satirlar.map((q, i) => (
                    <div key={i}>
                      {q.kaynak}: {q.used || '?'} / {q.hard}
                    </div>
                  ))}
              </div>
              <div className={KUTU} style={ton('info')}>
                <Baslik>Eş cluster dosyaları (yalnız yazılır, upgrade yok)</Baslik>
                {(res.peers || []).length === 0 && 'eş kiracı yok'}
                {(res.peers || []).map((e) => (
                  <div key={e.kiraci}>
                    {e.kiraci}: {e.durum === 'tanimsiz' ? 'eş dosya tanımlı değil' : e.durum === 'olculemedi' ? `ölçülemedi (${e.mesaj})` : e.durum}
                  </div>
                ))}
              </div>
            </div>
          )}

          {yazmaAcik && (
            <div className="space-y-1">
              {birimHatalari.map((m, i) => (
                <div key={i} className={KUTU} style={ton('danger')}>
                  {m}
                </div>
              ))}
              {olcEksik.length > 0 && (
                <div className={KUTU} style={ton('warn')}>
                  Dosyadaki değer ölçülemedi ({olcEksik.join(', ')}): “eski” bilinmeden önizleme yapılmaz. Yeniden okuyun.
                </div>
              )}
              {geriAlNotu && (
                <div className={KUTU} style={ton('info')}>
                  Geri al: eski değerler forma yazıldı. {geriAlNotu} Önizle → onayla → uygula.
                </div>
              )}
              {yerel?.hatalar.map((h, i) => (
                <div key={`h${i}`} className={KUTU} style={ton('danger')}>
                  <b>{h.kod}</b> — {h.mesaj}
                  {h.asilabilir && admin && ' (Admin gerekçe yazarak aşabilir)'}
                </div>
              ))}
              {yerel?.uyarilar.map((h, i) => (
                <div key={`u${i}`} className={KUTU} style={ton('warn')}>
                  <b>{h.kod}</b> {h.durum === 'olculemedi' ? '(ölçülemedi)' : ''} — {h.mesaj}
                </div>
              ))}
              {admin && (yerel?.politikaIhlali || asim) && (
                <div className={KUTU} style={ton('info')}>
                  <label className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={asim} onChange={(e) => setAsim(e.target.checked)} />
                    Sınırı Admin olarak aş (oran / {Number(SINIRLAR.cpuLimitTavanM) / 1000} çekirdek / 32Gi / 512Mi) — Kubernetes kuralı ve LimitRange aşılamaz
                  </label>
                  {asim && (
                    <textarea
                      aria-label="gerekçe"
                      value={gerekce}
                      onChange={(e) => setGerekce(e.target.value)}
                      placeholder={`Gerekçe (${SINIRLAR.gerekceEnAz}-${SINIRLAR.gerekceEnCok} karakter) — denetim kaydına girer`}
                      className="mt-1 w-full h-16 px-2 py-1 text-[12px] rounded-lg border"
                      style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {plan.asama === 'hata' && (
            <div className={KUTU} style={ton('danger')}>
              {plan.hata}
              {(plan.dogrulama?.hatalar || []).map((h, i) => (
                <div key={i}>
                  <b>{h.kod}</b> — {h.mesaj}
                </div>
              ))}
            </div>
          )}
          {plan.asama === 'calisiyor' && (
            <div className="text-sm py-3 text-center" style={{ color: 'var(--text-muted)' }}>
              Önizleme: bastion’da geçici kopya düzenleniyor, manifestler üretilip karşılaştırılıyor… (birkaç dakika sürebilir)
            </div>
          )}
          {p && <PlanGorunumu p={p} />}

          {uygula.asama === 'calisiyor' && (
            <div className={KUTU} style={ton('info')}>
              Uygulanıyor: kilit → yedek → atomik yazım → helm upgrade --atomic → ~3 dk gözlem. Bu pencere açık kalabilir; iş AWX’te sürer.
            </div>
          )}
          {uygula.asama === 'hata' && (
            <div className={KUTU} style={ton('danger')}>
              {uygula.hata}
            </div>
          )}
          {uygula.res && (
            <div className="space-y-2" data-testid="uygula-sonuc">
              {sonucBilgi && (
                <div className={KUTU} style={ton(sonucBilgi.t)}>
                  <b>{uygula.res.end?.sonuc}</b> — {sonucBilgi.metin}
                  {uygula.res.end?.kod ? ` (${uygula.res.end.kod})` : ''}
                </div>
              )}
              {(uygula.res.end?.kod || '')
                .split(',')
                .filter((k) => KOD_METNI[k])
                .map((k) => (
                  <div key={k} className={KUTU} style={ton('danger')} data-testid={`sonuc-kod-${k}`}>
                    <b>{k}</b> — {KOD_METNI[k]}
                  </div>
                ))}
              {!sonucBilgi && (
                <div className={KUTU} style={ton('warn')}>
                  Sonuç satırı (RESEND) yok — iş yarıda kalmış olabilir; durum ÖLÇÜLEMEDİ.
                </div>
              )}
              <Liste
                baslik="Adımlar"
                satirlar={uygula.res.steps.map((s) => ({ d: adimTon(s.durum), m: `${s.adim}: ${s.mesaj}` }))}
              />
              <Liste
                baslik="Gözlem (~3 dk)"
                satirlar={uygula.res.obs.map((o) => ({ d: o.durum === 'sorun' ? 'dur' : o.durum, m: `${o.kontrol}: ${o.mesaj}` }))}
              />
              {uygula.sonuc?.routes &&
                uygula.sonuc.routes.once.filter((r) => !uygula.sonuc!.routes!.sonra.includes(r)).length > 0 && (
                  <div className={KUTU} style={ton('danger')}>
                    Upgrade sonrası KAYBOLAN route:{' '}
                    {uygula.sonuc.routes.once.filter((r) => !uygula.sonuc!.routes!.sonra.includes(r)).join(', ')}
                  </div>
                )}
              {uygula.res.end && ['uygulandi', 'uygulandi_sorunlu'].includes(uygula.res.end.sonuc) && (
                <button type="button" className={SM_BTN} style={btn()} onClick={geriAl}>
                  <ArrowUturnLeftIcon className="h-3.5 w-3.5" /> Geri al (eski değerlerle önizle → onayla → uygula)
                </button>
              )}
            </div>
          )}
        </div>
      </Modal>

      {onay && p && (
        <Modal
          open
          onClose={() => setOnay(false)}
          size="xl"
          dismissOnBackdrop={false}
          title="CPU / bellek uygulama — onay"
          subtitle={`${tenantLabel} · ${name} / ${kap}`}
          footer={
            <div className="flex items-center gap-2 w-full">
              <button
                type="button"
                className="h-9 px-4 text-sm font-medium rounded-lg border"
                style={btn('danger')}
                disabled={(planRiskli && !riskliOnay) || (planBekleyen && !bekleyenOnay)}
                onClick={() => void uygulaCalistir()}
              >
                Onayla ve uygula
              </button>
              <span className="flex-1" />
              <button type="button" className="h-9 px-3 text-xs font-medium rounded-lg border" style={btn()} onClick={() => setOnay(false)}>
                İptal
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            <div className={KUTU} style={ton('danger')}>
              Bu işlem values dosyasını <b>yazar</b> ve aynı işte <b>helm upgrade</b> koşar: aşağıdaki iş yükleri yeniden başlar.
            </div>
            <div>
              <Baslik>Değişiklik</Baslik>
              {plan.degisiklik.map((d) => (
                <div key={d.alan} className="text-[12px] tabular-nums">
                  {ETIKET[d.alan]}: {d.eski || 'dosyada yok'} → <b>{d.yeni}</b>
                  {d.alan === 'limits.memory' && heapTahminiMi(d.yeni) != null && (
                    <span style={{ color: 'var(--text-muted)' }}> (heap ~{heapTahminiMi(d.yeni)}Mi)</span>
                  )}
                </div>
              ))}
            </div>
            <div>
              <Baslik>Yeniden başlayacak iş yükleri</Baslik>
              {p.affect.map((a, i) => (
                <div key={i} className="text-[12px]">
                  {a.kind}/{a.ad} · {a.strateji} · replika {a.replika}
                  {a.bekleyen && <b style={{ color: 'var(--status-warning)' }}> · bekleyen fark nedeniyle</b>}
                  {a.riskli && <b style={{ color: 'var(--status-danger)' }}> · riskli</b>}
                </div>
              ))}
            </div>
            {p.peers.length > 0 && (
              <div>
                <Baslik>Eş cluster dosyaları</Baslik>
                {p.peers.map((e) => (
                  <div key={e.kiraci} className="text-[12px]">
                    {e.kiraci}: {e.durum === 'tanimsiz' ? 'eş dosya tanımlı değil' : e.durum} {e.mesaj && `— ${e.mesaj}`}
                  </div>
                ))}
              </div>
            )}
            {planRiskli && (
              <label className={`${KUTU} flex items-start gap-2`} style={ton('danger')}>
                <input type="checkbox" aria-label="riskli bileşen onayı" checked={riskliOnay} onChange={(e) => setRiskliOnay(e.target.checked)} />
                <span>
                  <b>Riskli bileşen</b> (durumlu: aeron-cluster / storage / archive / indexer ya da StatefulSet / Recreate). Sıralı
                  yeniden başlatma ya da kesinti olacağını, lider kontrolünü yaptığımı onaylıyorum.
                </span>
              </label>
            )}
            {planBekleyen && (
              <label className={`${KUTU} flex items-start gap-2`} style={ton('warn')}>
                <input type="checkbox" aria-label="bekleyen fark onayı" checked={bekleyenOnay} onChange={(e) => setBekleyenOnay(e.target.checked)} />
                <span>
                  Dosyada canlıya henüz uygulanmamış <b>başka kaynak farkları</b> var; onlar da bu upgrade ile uygulanacak.
                  Onaylıyorum.
                </span>
              </label>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function Liste({ baslik, satirlar }: { baslik: string; satirlar: { d: string; m: string }[] }) {
  if (!satirlar.length) return null;
  return (
    <div>
      <Baslik>{baslik}</Baslik>
      <ul className="space-y-0.5">
        {satirlar.map((s, i) => (
          <li key={i} className="text-[12px] flex items-start gap-2">
            <Durum d={s.d} /> <span style={{ color: 'var(--text-secondary)' }}>{s.m}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Önizleme sonucu: kontroller, değişecek iş yükleri ve strateji, bekleyen farklar, eş dosyalar. */
function PlanGorunumu({ p }: { p: CryptoResources }) {
  const ok = p.plan?.durum === 'ok';
  return (
    <div className="space-y-2" data-testid="plan-sonuc">
      <div className={KUTU} style={ton(ok ? 'ok' : 'danger')}>
        {p.plan ? (
          ok ? (
            <>
              Önizleme TEMİZ.{' '}
              {p.planJetonu
                ? `Uygulama jetonu ${p.planBitis ? fmtTime(p.planBitis) : ''}’e kadar geçerli (tek kullanımlık).`
                : p.planJetonDurumu === 'kullanildi'
                  ? 'Jeton kullanıldı.'
                  : p.planJetonDurumu === 'suresi_doldu'
                    ? 'Planın 15 dakikalık süresi doldu (plan üretildiği andan sayılır) — yeniden önizleyin.'
                    : 'Jeton verilmedi (planı başka kullanıcı başlattı ya da sunucu yeniden başladı) — yeniden önizleyin.'}
            </>
          ) : (
            <>
              Önizleme DURDU: <b>{p.plan.kod || 'neden bildirilmedi'}</b> — hiçbir şey yazılmadı.
            </>
          )
        ) : (
          'Plan satırı (RESPLAN) gelmedi — sonuç ÖLÇÜLEMEDİ.'
        )}
      </div>
      <Liste baslik="Kontroller" satirlar={p.checks.map((c) => ({ d: c.durum, m: `${c.kontrol}: ${c.mesaj}` }))} />
      {p.diffs.length > 0 && (
        <div>
          <Baslik>Üretilen manifest farkı (yalnız hedef kap)</Baslik>
          {p.diffs.map((d, i) => (
            <div key={i} className="text-[12px] tabular-nums">
              {d.kind}/{d.ad} · {d.kap} · {d.alan}: {d.eski} → <b>{d.yeni}</b>
            </div>
          ))}
        </div>
      )}
      {p.affect.length > 0 && (
        <div>
          <Baslik>Değişecek iş yükleri ve güncelleme stratejisi</Baslik>
          {p.affect.map((a, i) => (
            <div key={i} className="text-[12px]">
              {a.kind}/{a.ad} · {a.strateji} · canlı replika {a.replika}
              {a.bekleyen && <b style={{ color: 'var(--status-warning)' }}> · bekleyen fark nedeniyle</b>}
              {a.riskli && <b style={{ color: 'var(--status-danger)' }}> · riskli</b>}
            </div>
          ))}
        </div>
      )}
      {p.pending.length > 0 && (
        <div className={KUTU} style={ton('warn')}>
          <Baslik>Bekleyen farklar (dosyada var, canlıda yok — upgrade bunları da uygular)</Baslik>
          {p.pending.map((x, i) => (
            <div key={i}>
              {x.tur === 'kaynak'
                ? `${x.kind}/${x.ad} ${x.yer}: canlı ${x.canli} → dosya ${x.dosya}`
                : `${x.kind}/${x.ad} ${x.yer}: kaynak DIŞI fark (değer gösterilmez)`}
            </div>
          ))}
        </div>
      )}
      {p.drift.length > 0 && (
        <div className={KUTU} style={ton('warn')}>
          <Baslik>Elle yapılmış değişiklikler — upgrade bunları GERİ ALACAK</Baslik>
          {p.drift.map((x, i) => (
            <div key={i}>
              {x.kind}/{x.ad} · {x.kap} · {x.alan}: canlı {x.canli} ≠ manifest {x.manifest}
            </div>
          ))}
        </div>
      )}
      {p.repl.length > 0 && (
        <div className={KUTU} style={ton('danger')}>
          <Baslik>Replika farkı (pasif cluster / elle ölçekleme)</Baslik>
          {p.repl.map((x, i) => (
            <div key={i}>
              {x.kind}/{x.ad}: canlı {x.canli} ≠ manifest {x.manifest}
            </div>
          ))}
        </div>
      )}
      {p.peers.length > 0 && (
        <div>
          <Baslik>Eş cluster dosyaları</Baslik>
          {p.peers.map((e) => (
            <div key={e.kiraci} className="text-[12px]">
              {e.kiraci}: {e.durum === 'tanimsiz' ? 'eş dosya tanımlı değil' : e.durum === 'ayni' ? 'zaten hedef değerde' : e.durum}
              {e.mesaj && ` — ${e.mesaj}`}
            </div>
          ))}
        </div>
      )}
      {p.errors.map((e, i) => (
        <div key={i} className={KUTU} style={ton('warn')}>
          <b>{e.asama}</b> (ölçülemedi) — {e.mesaj}
        </div>
      ))}
    </div>
  );
}
