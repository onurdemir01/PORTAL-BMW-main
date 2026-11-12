// src/components/admin/tabs/SelfServisTasima.tsx — Admin > Otomasyon > Self Servis Taşıma (2026-11-10).
//
// Kullanıcı: "maestro2 emekli oluyor ... maestro2'deki job'ları tetiklemesi için kullanılan çok
// fazla self servis otomasyonu var ... survey + smart onayı vb. tüm sayfaları ilmek ilmek
// hazırlanmıştı." Her servis (Self Servis kartı) bağımsız bir birimdir:
//   1. Rapor (kuru): aynı adlı hedef template otomatik eşlenir, eşleşmeyen elle seçilir.
//   2. Survey farkı varsa "Survey'i hedefe yaz" (onaylı; yalnız hedefe yazar, geri okuyup doğrular).
//   3. "Deneme koşusu": ayarlar hedefe kopyalanır, kart bağlanmadan hedefte doğrulama / gerçek iş.
//   4. "Taşı": tek transaction, kart kimliği / başlık / bağlantı / erişim değişmez.
//   5. "Geri al": kart tek tıkla kaynak bağına döner.
// Geçmiş (iş geçmişi, Smart talepleri, OCO kayıtları) kaynak sunucuda salt-okunur kalır.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowPathIcon, InformationCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { ansibleApi, type AwxServer } from '@/api/ansibleApi';
import { ssTasimaApi, type SsTasimaPlani, type SsTasimaSatiri, type SsTasimaDurumu } from '@/api/ssTasimaApi';
import { Modal } from '@/components/common/Modal';
import { toast } from '@/hooks/useToast';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import SelfServisTasimaDetay from './SelfServisTasimaDetay';
import { DenemePenceresi, GeriAlPenceresi, SurveyYazPenceresi, TasiPenceresi } from './SelfServisTasimaPencereleri';

const PLAN_SURE_MS = 120_000;
const LISTE_SINIRI = 300;
// AWX sunucu numaraları AWX_1..AWX_9 (server/ansible/runner.cjs getServers). Devre dışı bırakılmış
// (emekli) bir kaynak /servers listesinde görünmez; taşınmış servisleri görmek / geri almak için
// numarasıyla seçilebilir (rapor salt-okunur gelir).
const SUNUCU_NOLARI = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export const CIP_RENK: Record<SsTasimaDurumu, string> = {
  TASINDI: 'bg-blue-50 text-blue-700 border-blue-100',
  GERI_ALINDI: 'bg-gray-100 text-gray-600 border-gray-200',
  ESLESME_YOK: 'bg-gray-100 text-gray-600 border-gray-200',
  ENGEL: 'bg-red-50 text-red-700 border-red-100',
  SURVEY_BOS: 'bg-orange-50 text-orange-700 border-orange-100',
  SURVEY_FARKLI: 'bg-orange-50 text-orange-700 border-orange-100',
  OZELLESTIRME_UYUMSUZ: 'bg-orange-50 text-orange-700 border-orange-100',
  HAZIR: 'bg-green-50 text-green-700 border-green-100',
};

/** Varsayılan sunucu çifti: adı maestro2 ile başlayan kaynak, maestro3 ile başlayan hedef. */
export function varsayilanCift(sunucular: AwxServer[]): { from: number | null; to: number | null } {
  const bul = (on: string) => sunucular.find((s) => s.name.trim().toLowerCase().startsWith(on));
  return { from: bul('maestro2')?.id ?? null, to: bul('maestro3')?.id ?? null };
}

type TopluTur = 'survey' | 'dogrula' | 'tasi' | 'gerial';
const TOPLU_ETIKET: Record<TopluTur, string> = {
  survey: 'Seçilenlere survey yaz',
  dogrula: 'Seçilenlerin durumunu yenile',
  tasi: 'Seçilenleri taşı',
  gerial: 'Seçilenleri geri al',
};

/**
 * Hedef template başka bir yere bağlıysa (başka servis, Playbook Kayıtları, izin listesi dışı,
 * eşleşme çakışması) survey yazımı canlı bir template'i ezer: düğme gizlenir, toplu işlem atlar.
 * Sunucu aynı kontrolü yeniden yapar (409).
 */
export const HEDEF_BAG_ENGELLERI = ['hedef_baska_serviste', 'hedef_playbook_kaydinda', 'hedef_cakisiyor', 'izin_listesi'];

export function hedefBagEngeli(s: SsTasimaSatiri): string | null {
  const e = [...(s.engeller || []), ...(s.okunamayan || [])].find((x) => HEDEF_BAG_ENGELLERI.includes(x.anahtar));
  return e ? e.baslik : null;
}

/** Toplu işlemde servis uygun değilse neden; uygunsa null. */
export function topluUygunluk(tur: TopluTur, s: SsTasimaSatiri, gerekce: string): string | null {
  if (tur === 'gerial') return s.durum === 'TASINDI' ? null : 'taşınmış değil';
  if (s.durum === 'TASINDI') return 'zaten taşınmış';
  if (!s.hedefTemplate) return 'hedef seçilmemiş';
  if (tur === 'survey') {
    if (!s.surveyEylemi) return 'survey farkı yok';
    const bag = hedefBagEngeli(s);
    if (bag) return `hedef bağlı: ${bag}`;
    if (!s.hedefSurveyHash) return 'hedef survey okunamadı';
    return null;
  }
  if (tur === 'tasi') {
    if (s.durum !== 'HAZIR') return `durum ${s.durum}`;
    if (!s.deneme?.gecerli && gerekce.trim().length < 10) return 'geçerli deneme yok (gerekçe yazın)';
  }
  return null;
}

export interface TopluSonuc {
  itemId: string;
  title: string;
  sonuc: string;
  tur: 'ok' | 'atlandi' | 'hata';
}

/** Tek servis uçlarını SIRAYLA çağırır; bir servisin hatası diğerlerini durdurmaz. */
export async function topluCalistir(
  tur: TopluTur,
  satirlar: SsTasimaSatiri[],
  to: number,
  gerekce: string,
  onIlerleme?: (s: TopluSonuc[]) => void,
  durduruldu?: () => boolean,
): Promise<TopluSonuc[]> {
  const sonuclar: TopluSonuc[] = [];
  for (const s of satirlar) {
    // Durdurma: sıradaki servis başlamadan; yürüyen istek yarıda kesilmez.
    if (durduruldu?.()) {
      sonuclar.push({ itemId: s.itemId, title: s.title, sonuc: 'atlandı: durduruldu', tur: 'atlandi' });
      onIlerleme?.([...sonuclar]);
      continue;
    }
    const neden = topluUygunluk(tur, s, gerekce);
    if (neden) {
      sonuclar.push({ itemId: s.itemId, title: s.title, sonuc: `atlandı: ${neden}`, tur: 'atlandi' });
      onIlerleme?.([...sonuclar]);
      continue;
    }
    try {
      let r: { ok: boolean; message?: string; [k: string]: unknown };
      const toT = s.hedefTemplate?.id ?? 0;
      if (tur === 'survey') r = await ssTasimaApi.surveyYaz(s.itemId, to, toT, s.hedefSurveyHash || '');
      else if (tur === 'tasi')
        r = await ssTasimaApi.tasi(s.itemId, {
          to,
          toT,
          planHash: s.planHash || '',
          ...(s.deneme?.gecerli ? {} : { denemesizGerekce: gerekce.trim() }),
        });
      else if (tur === 'gerial') r = await ssTasimaApi.geriAl(s.itemId, s.kayit?.id ?? 0, false);
      else {
        const d = await ssTasimaApi.detay(s.itemId, to, toT);
        r = { ok: true, message: d.satir ? `durum ${d.satir.durum}` : 'taşınmış' };
      }
      if (r.ok) sonuclar.push({ itemId: s.itemId, title: s.title, sonuc: r.message ? `başarılı (${r.message})` : 'başarılı', tur: 'ok' });
      else if (r.onayGerekli)
        sonuclar.push({ itemId: s.itemId, title: s.title, sonuc: 'atlandı: değişiklik onayı gerekli (tek tek geri alın)', tur: 'atlandi' });
      else sonuclar.push({ itemId: s.itemId, title: s.title, sonuc: `hata: ${r.message || 'bilinmeyen'}`, tur: 'hata' });
    } catch (e: unknown) {
      sonuclar.push({ itemId: s.itemId, title: s.title, sonuc: `hata: ${e instanceof Error ? e.message : String(e)}`, tur: 'hata' });
    }
    onIlerleme?.([...sonuclar]);
  }
  return sonuclar;
}

function Cip({ c }: { c: SsTasimaDurumu }) {
  return <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-semibold ${CIP_RENK[c]}`}>{c}</span>;
}

function HedefSecici({
  satir,
  secenekler,
  onSec,
}: {
  satir: SsTasimaSatiri;
  secenekler: { id: number; name: string }[];
  onSec: (toT: number) => void;
}) {
  const [ara, setAra] = useState('');
  const liste = useMemo(() => {
    const q = ara.trim().toLowerCase();
    const adayIdleri = new Set(satir.adaylar.map((a) => a.id));
    const adaylar = satir.adaylar;
    const diger = secenekler.filter((t) => !adayIdleri.has(t.id) && (!q || t.name.toLowerCase().includes(q) || String(t.id) === q));
    const tum = [...adaylar, ...diger];
    return { gorunen: tum.slice(0, LISTE_SINIRI), kesildi: tum.length > LISTE_SINIRI, toplam: tum.length };
  }, [ara, satir.adaylar, secenekler]);
  return (
    <div className="flex flex-col gap-1 min-w-[12rem]">
      <input
        value={ara}
        onChange={(e) => setAra(e.target.value)}
        placeholder="Hedef template ara…"
        aria-label={`${satir.title} hedef template arama`}
        className="px-2 py-1 text-xs border border-gray-200 rounded"
      />
      <select
        aria-label={`${satir.title} hedef template`}
        defaultValue=""
        onChange={(e) => e.target.value && onSec(Number(e.target.value))}
        className="px-2 py-1 text-xs border border-gray-200 rounded"
      >
        <option value="">Seçin…</option>
        {liste.gorunen.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} (#{t.id})
          </option>
        ))}
      </select>
      {liste.kesildi && (
        <span className="text-[10px] text-amber-700">
          İlk {LISTE_SINIRI} / {liste.toplam} gösteriliyor; daraltmak için arayın.
        </span>
      )}
    </div>
  );
}

type Pencere = { tur: 'survey' | 'deneme' | 'tasi' | 'gerial'; satir: SsTasimaSatiri } | null;

export default function SelfServisTasima() {
  const [sunucular, setSunucular] = useState<AwxServer[]>([]);
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [plan, setPlan] = useState<SsTasimaPlani | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState('');
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [detay, setDetay] = useState<SsTasimaSatiri | null>(null);
  const [pencere, setPencere] = useState<Pencere>(null);
  const [toplu, setToplu] = useState<TopluTur | null>(null);
  const [topluGerekce, setTopluGerekce] = useState('');
  const [topluSonuc, setTopluSonuc] = useState<TopluSonuc[] | null>(null);
  const [topluCalisiyor, setTopluCalisiyor] = useState(false);
  const [topluSurveyOnay, setTopluSurveyOnay] = useState(false);
  const topluDur = useRef(false);
  const iptal = useRef<AbortController | null>(null);

  useEffect(() => {
    ansibleApi
      .servers()
      .then((r) => {
        const l = (r.servers || []).filter((s) => s.configured);
        setSunucular(l);
        const v = varsayilanCift(l);
        setFrom(v.from);
        setTo(v.to);
      })
      .catch((e: unknown) => setHata(e instanceof Error ? e.message : String(e)));
  }, []);

  const ayni = from !== null && to !== null && from === to;

  const yukle = useCallback(async () => {
    if (from === null || to === null || from === to) return;
    iptal.current?.abort();
    const ac = new AbortController();
    iptal.current = ac;
    const zaman = setTimeout(() => ac.abort(), PLAN_SURE_MS);
    setYukleniyor(true);
    setHata('');
    try {
      const p = await ssTasimaApi.plan(from, to, ac.signal);
      setPlan(p);
      setSecili(new Set());
    } catch (e: unknown) {
      if (ac.signal.aborted && iptal.current !== ac) return;
      setPlan(null);
      setHata(ac.signal.aborted ? 'Rapor süre sınırını aştı; tekrar deneyin.' : e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(zaman);
      if (iptal.current === ac) setYukleniyor(false);
    }
  }, [from, to]);

  useAsyncEffect(async () => {
    await yukle();
  }, [yukle]);
  useEffect(() => () => iptal.current?.abort(), []);

  const ad = (id: number | null) => sunucular.find((s) => s.id === id)?.name || (id === null ? '?' : `#${id}`);
  const satirlar = plan?.satirlar || [];
  const seciliSatirlar = satirlar.filter((s) => secili.has(s.itemId));

  async function hedefSec(s: SsTasimaSatiri, toT: number) {
    if (to === null) return;
    try {
      const r = await ssTasimaApi.hedefSec(s.itemId, to, toT);
      if (!r.ok) toast.error(r.message || 'Hedef kaydedilemedi.');
      await yukle();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function hazirlikIptal(s: SsTasimaSatiri) {
    if (!window.confirm(`${s.title}: hazırlık kaydı kapatılsın mı? Hedefe kopyalanan ayar satırı bırakılır.`)) return;
    try {
      const r = await ssTasimaApi.hazirlikIptal(s.itemId);
      if (!r.ok) toast.error(r.message || 'Kapatılamadı.');
      await yukle();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function topluBaslat() {
    if (!toplu || to === null) return;
    setTopluCalisiyor(true);
    setTopluSonuc([]);
    topluDur.current = false;
    try {
      await topluCalistir(toplu, seciliSatirlar, to, topluGerekce, setTopluSonuc, () => topluDur.current);
    } finally {
      setTopluCalisiyor(false);
      void yukle();
    }
  }

  const bitti = () => {
    setPencere(null);
    void yukle();
  };

  return (
    <section data-testid="ss-tasima" className="space-y-4 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <h3 className="text-base font-semibold mr-auto">
          Self Servis Taşıma ({ad(from)} → {ad(to)})
        </h3>
        <label className="text-xs">
          <span className="block text-gray-500">Kaynak sunucu</span>
          <select aria-label="Kaynak sunucu" value={from ?? ''} onChange={(e) => setFrom(e.target.value ? Number(e.target.value) : null)} className="px-2 py-1 border border-gray-200 rounded">
            <option value="">Seçin…</option>
            {sunucular.map((s) => (
              <option key={s.id} value={s.id}>
                #{s.id} {s.name}
              </option>
            ))}
            {SUNUCU_NOLARI.filter((n) => !sunucular.some((s) => s.id === n)).map((n) => (
              <option key={`kapali-${n}`} value={n}>
                #{n} (devre dışı / kayıtlı değil)
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-gray-500">Hedef sunucu</span>
          <select aria-label="Hedef sunucu" value={to ?? ''} onChange={(e) => setTo(e.target.value ? Number(e.target.value) : null)} className="px-2 py-1 border border-gray-200 rounded">
            <option value="">Seçin…</option>
            {sunucular.map((s) => (
              <option key={s.id} value={s.id}>
                #{s.id} {s.name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => void yukle()} disabled={yukleniyor || ayni || from === null || to === null} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">
          <ArrowPathIcon className="w-3.5 h-3.5" /> {yukleniyor ? 'Hazırlanıyor…' : 'Raporu yenile'}
        </button>
      </div>

      {ayni && <p role="alert" className="text-red-600 text-xs">Kaynak ve hedef aynı sunucu olamaz.</p>}

      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 space-y-1">
        <p className="font-semibold flex items-center gap-1 text-gray-700">
          <InformationCircleIcon className="w-4 h-4" /> Taşınmayanlar
        </p>
        <p>İş geçmişi, Smart talepleri ve OCO kayıtları kaynak sunucuda salt-okunur kalır. Servisin Geçmiş sekmesi eski işleri göstermeye devam eder.</p>
        <p>
          OpsX, ScaleX, LogX gibi modüllerin playbook bağları bu ekranda değil,{' '}
          <a href="/admin?tab=playbooks" className="text-blue-700 underline">
            Admin → Playbook Kayıtları
          </a>{' '}
          ekranında taşınır. ScaleX ayarları (Smart/OCO) orada sunucu değiştirilince taşınmaz; ayrı iş olarak ele alınmalı.
        </p>
        <p>
          Envanter yenileme sabit template #612'ye ve "maestro2" adına bağlı; uzun iş iptal izin listesi ve iptal token'ı sunucuya özgü;
          AWX'te Portal dışında kurulmuş zamanlamalar taşınmaz.
        </p>
      </div>

      {plan?.saltOkunur && (
        <p role="status" className="text-amber-800 text-xs flex items-center gap-1">
          <ExclamationTriangleIcon className="w-4 h-4" /> Kaynak sunucu Portal'da devre dışı: yalnız taşınmış servisler gösteriliyor.
          Geri alma, kaynak sunucu kapalıyken reddedilir.
        </p>
      )}
      {plan?.izinListesiDolu && (
        <p className="text-amber-800 text-xs flex items-center gap-1">
          <ExclamationTriangleIcon className="w-4 h-4" /> Template izin listesi tanımlı. Hedef template numaraları listede yoksa eşleşme
          "bulunamadı" görünür ve taşıma reddedilir.
        </p>
      )}
      {(plan?.sunucuHatalari || []).map((h) => (
        <p key={h.sunucu} role="alert" className="text-red-600 text-xs">
          {h.sunucu} okunamadı ({h.hata}). O sunucuya bağlı satırlar ENGEL olarak gösterilir.
        </p>
      ))}
      {plan?.kayitHatasi && <p role="alert" className="text-red-600 text-xs">Taşıma kayıtları okunamadı: {plan.kayitHatasi}</p>}
      {hata && <p role="alert" className="text-red-600 text-xs">{hata}</p>}

      {secili.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="toplu-cubuk">
          <span className="text-gray-500">{secili.size} servis seçili:</span>
          {(Object.keys(TOPLU_ETIKET) as TopluTur[]).map((t) => (
            <button
              key={t}
              onClick={() => {
                setToplu(t);
                setTopluSonuc(null);
                setTopluGerekce('');
                setTopluSurveyOnay(false);
              }}
              className="px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50"
            >
              {TOPLU_ETIKET[t]}
            </button>
          ))}
        </div>
      )}

      {yukleniyor && !plan ? (
        <div className="space-y-2">
          <div className="h-8 bg-gray-100 rounded animate-pulse" />
          <div className="h-8 bg-gray-100 rounded animate-pulse" />
          <div className="h-8 bg-gray-100 rounded animate-pulse" />
        </div>
      ) : plan && satirlar.length === 0 ? (
        <p className="text-xs text-gray-400">Kaynak sunucuya bağlı Self Servis servisi yok.</p>
      ) : plan ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="py-1.5 pr-2">
                  <input
                    type="checkbox"
                    aria-label="Tümünü seç"
                    checked={secili.size > 0 && secili.size === satirlar.length}
                    onChange={(e) => setSecili(e.target.checked ? new Set(satirlar.map((s) => s.itemId)) : new Set())}
                  />
                </th>
                <th className="py-1.5 pr-2">Servis</th>
                <th className="py-1.5 pr-2">Kaynak template</th>
                <th className="py-1.5 pr-2">Hedef template</th>
                <th className="py-1.5 pr-2">Durum</th>
                <th className="py-1.5">İşlemler</th>
              </tr>
            </thead>
            <tbody>
              {satirlar.map((s) => (
                <tr key={s.itemId} className="border-b border-gray-50 align-top" data-testid={`ss-satir-${s.itemId}`}>
                  <td className="py-1.5 pr-2">
                    <input
                      type="checkbox"
                      aria-label={`${s.title} seç`}
                      checked={secili.has(s.itemId)}
                      onChange={(e) =>
                        setSecili((p) => {
                          const n = new Set(p);
                          if (e.target.checked) n.add(s.itemId);
                          else n.delete(s.itemId);
                          return n;
                        })
                      }
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <span className="font-medium text-gray-800">{s.title}</span>
                    <span className="block text-[10px] text-gray-400">
                      {s.enabled ? 'açık' : 'kapalı'} · erişim: {s.accessMode || 'herkes'}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2">
                    {s.kaynakTemplate.name || '—'} (#{s.kaynakTemplate.id})
                    {s.kaynakSurveyModu && (
                      <span className="block text-[10px] text-gray-500">
                        {s.kaynakSurveyModu === 'AWX' ? 'AWX survey' : s.kaynakSurveyModu === 'TASARIMCI' ? 'Portal tasarımcısı' : s.kaynakSurveyModu === 'EXTRA_VARS' ? 'extra_vars' : 'ölçülemedi'}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2">
                    {s.hedefTemplate ? (
                      <>
                        {s.hedefTemplate.name} (#{s.hedefTemplate.id})
                        <span className="block text-[10px] text-gray-500">{s.eslesme === 'ad' ? 'ad eşleşti' : 'elle seçildi'}</span>
                        {s.durum !== 'TASINDI' && (
                          <details className="text-[10px]">
                            <summary className="cursor-pointer text-blue-700">Değiştir</summary>
                            <HedefSecici satir={s} secenekler={plan.hedefTemplateleri} onSec={(t) => void hedefSec(s, t)} />
                          </details>
                        )}
                      </>
                    ) : (
                      <>
                        {s.eslesmeNedeni && <span className="block text-[10px] text-gray-500 mb-1">{s.eslesmeNedeni}</span>}
                        <HedefSecici satir={s} secenekler={plan.hedefTemplateleri} onSec={(t) => void hedefSec(s, t)} />
                      </>
                    )}
                  </td>
                  <td className="py-1.5 pr-2">
                    <div className="flex flex-wrap gap-1" data-testid={`cipler-${s.itemId}`}>
                      {s.cipler.map((c) => (
                        <Cip key={c} c={c} />
                      ))}
                    </div>
                    {s.tahminSurveyYazilirsa && <span className="block text-[10px] text-gray-500">Survey yazılırsa: {s.tahminSurveyYazilirsa}</span>}
                    {s.deneme && (
                      <span className={'block text-[10px] ' + (s.deneme.gecerli ? 'text-green-700' : 'text-amber-700')}>
                        Deneme #{s.deneme.jobId}: {s.deneme.gecerli ? 'geçerli' : s.deneme.neden || s.deneme.status}
                      </span>
                    )}
                    {s.nedenler.slice(0, 2).map((n) => (
                      <span key={n} className="block text-[10px] text-gray-500">
                        {n}
                      </span>
                    ))}
                  </td>
                  <td className="py-1.5">
                    <div className="flex flex-wrap gap-1">
                      <button onClick={() => setDetay(s)} className="px-2 py-0.5 rounded border border-gray-200 hover:bg-gray-50">
                        Detay
                      </button>
                      {s.surveyEylemi && s.durum !== 'TASINDI' && !hedefBagEngeli(s) && (
                        <button onClick={() => setPencere({ tur: 'survey', satir: s })} className="px-2 py-0.5 rounded border border-orange-200 text-orange-700 hover:bg-orange-50">
                          Survey'i hedefe yaz
                        </button>
                      )}
                      {s.hedefTemplate && s.durum !== 'TASINDI' && (
                        <button onClick={() => setPencere({ tur: 'deneme', satir: s })} className="px-2 py-0.5 rounded border border-gray-200 hover:bg-gray-50">
                          Deneme koşusu
                        </button>
                      )}
                      {s.durum !== 'TASINDI' && (
                        <button
                          onClick={() => setPencere({ tur: 'tasi', satir: s })}
                          disabled={s.durum !== 'HAZIR'}
                          title={s.durum !== 'HAZIR' ? 'Servis taşımaya hazır değil' : undefined}
                          data-testid={`tasi-${s.itemId}`}
                          className="px-2 py-0.5 rounded border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                        >
                          Taşı
                        </button>
                      )}
                      {(s.durum === 'TASINDI' || s.engeller.some((e) => e.anahtar === 'tutarsiz_kayit')) && (
                        <button onClick={() => setPencere({ tur: 'gerial', satir: s })} className="px-2 py-0.5 rounded border border-red-200 text-red-700 hover:bg-red-50">
                          {s.durum === 'TASINDI' ? 'Geri al' : 'Kaydı kapat'}
                        </button>
                      )}
                      {s.kayit?.status === 'HAZIRLIK' && (
                        <button onClick={() => void hazirlikIptal(s)} className="px-2 py-0.5 rounded text-gray-500 hover:text-gray-700">
                          Hazırlığı iptal et
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {detay && to !== null && (
        <SelfServisTasimaDetay key={`${detay.itemId}:${detay.hedefTemplate?.id ?? ''}`} itemId={detay.itemId} to={to} toT={detay.hedefTemplate?.id ?? null} onKapat={() => setDetay(null)} />
      )}
      {pencere?.tur === 'survey' && to !== null && <SurveyYazPenceresi satir={pencere.satir} to={to} onKapat={() => setPencere(null)} onBitti={bitti} />}
      {pencere?.tur === 'deneme' && to !== null && <DenemePenceresi satir={pencere.satir} to={to} onKapat={() => setPencere(null)} onBitti={() => void yukle()} />}
      {pencere?.tur === 'tasi' && to !== null && <TasiPenceresi satir={pencere.satir} to={to} onKapat={() => setPencere(null)} onBitti={bitti} />}
      {pencere?.tur === 'gerial' && <GeriAlPenceresi satir={pencere.satir} onKapat={() => setPencere(null)} onBitti={bitti} />}

      {toplu && to !== null && (
        <Modal
          open
          onClose={() => !topluCalisiyor && setToplu(null)}
          dismissOnBackdrop={false}
          size="lg"
          title={TOPLU_ETIKET[toplu]}
          subtitle="Her servis bağımsız işlenir; bir servisin hatası diğerlerini durdurmaz."
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <button onClick={() => setToplu(null)} disabled={topluCalisiyor} className="px-3 py-1.5 text-sm rounded-lg text-gray-600 hover:text-gray-800 disabled:opacity-40">
                {topluSonuc && !topluCalisiyor ? 'Kapat' : 'İptal'}
              </button>
              {topluCalisiyor && (
                <button onClick={() => (topluDur.current = true)} data-testid="toplu-durdur" className="px-3 py-1.5 text-sm rounded-lg border border-red-200 text-red-700 hover:bg-red-50">
                  Durdur
                </button>
              )}
              {!topluSonuc && (
                <button
                  onClick={() => void topluBaslat()}
                  disabled={toplu === 'survey' && !topluSurveyOnay}
                  data-testid="toplu-baslat"
                  className="px-3 py-1.5 text-sm rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                >
                  Başlat
                </button>
              )}
            </div>
          }
        >
          <div className="space-y-2 text-xs">
            {toplu === 'tasi' && (
              <textarea
                value={topluGerekce}
                onChange={(e) => setTopluGerekce(e.target.value)}
                rows={2}
                disabled={!!topluSonuc}
                aria-label="Toplu denemesiz taşıma gerekçesi"
                placeholder="Geçerli denemesi olmayan servisler için gerekçe (en az 10 karakter; boşsa atlanırlar)"
                className="w-full border border-gray-200 rounded-lg p-2"
              />
            )}
            {toplu === 'survey' && (
              <label className="flex items-start gap-2 text-red-700">
                <input type="checkbox" checked={topluSurveyOnay} disabled={!!topluSonuc} onChange={(e) => setTopluSurveyOnay(e.target.checked)} />
                <span>
                  İşlenecek servislerin hedef template survey'lerinin üzerine yazılacağını anladım. Rapordan sonra hedef survey'i değişen
                  servis atlanır (yeniden rapor alın).
                </span>
              </label>
            )}
            <table className="w-full border-collapse" data-testid="toplu-tablo">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-1 pr-2">Servis</th>
                  <th className="py-1 pr-2">Şu anki durum</th>
                  {toplu === 'survey' && <th className="py-1 pr-2">Hedefte silinecek soru</th>}
                  <th className="py-1">Sonuç</th>
                </tr>
              </thead>
              <tbody>
                {seciliSatirlar.map((s) => {
                  const neden = topluUygunluk(toplu, s, topluGerekce);
                  const sonuc = topluSonuc?.find((x) => x.itemId === s.itemId);
                  return (
                    <tr key={s.itemId}>
                      <td className="py-0.5 pr-2">{s.title}</td>
                      <td className="py-0.5 pr-2">{s.durum}</td>
                      {toplu === 'survey' && <td className={'py-0.5 pr-2 ' + ((s.hedefteSilinecekSoru ?? 0) > 0 ? 'text-red-700' : '')}>{s.hedefteSilinecekSoru ?? 0}</td>}
                      <td className={'py-0.5 ' + (sonuc?.tur === 'hata' ? 'text-red-700' : sonuc?.tur === 'ok' ? 'text-green-700' : 'text-gray-500')}>
                        {sonuc ? sonuc.sonuc : neden ? `atlanacak: ${neden}` : topluCalisiyor ? 'sırada…' : 'işlenecek'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </section>
  );
}
