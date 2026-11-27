// src/components/IntranetSpaPage.tsx — Nginx ARK SPA > Intranet SPA (/ark-spa/intranet-spa).
//
// GEÇİŞ TAKVİMİ (2026-11-27). Kullanıcı: "Intranet SPA sayfasını direkt bu listeye göre düzenler
// misin? geçişler tamamlandı tek görmek istediğim şey şu: set, gecis_tarihi, sira, ekip,
// ekip_eposta, namespace, uygulama, route_adresleri, dynatrace_durumu, dynatrace_istek, aciklama.
// Ayrıca geçiş tarihini bu sayfadan admin olarak düzeltebilmek istiyorum."
//
// Uygulama listesi yalnız bu 11 sütunu, bu sırayla gösterir (Pilot, Set 1..N; set içinde sıra). Her
// uygulama DC başına bir satırdır (önce bir DC'nin setlerinde, sonra diğerininkinde); anahtar
// (set, namespace, uygulama). Takvim Portal DB'de; Admin CSV yükler (önizle → onayla; yükleme mevcut
// takvimin yerine geçer, set planına dokunmaz) ve tek satırın geçiş tarihini düzeltir.
//
// SET İLERLEMESİ (listenin üstünde, tek set görünümü): set planı (tarih, DC, eski / yeni IP; Admin
// satırdan düzenler ya da CSV yükler) + takvimden hesaplanan uygulama sayısı, setin payı, toplam
// geçmiş olacak ve yüzde (DC başına; sabit sayı yok) ve bugüne göre durum. Satıra tıklamak set
// süzgecini açar / kapatır. Setin tarihi yalnız buradan değişir: o setteki uygulamaların tarihi de
// değişir (server/spa-report/intranet-set-plani.cjs).
//
// Route / Dynatrace / açıklama canlı Intranet SPA raporunda eşleşirse canlıdan, ekip / e-posta
// listeden gelir (server/spa-report/intranet-takvim.cjs). Takvimde olmayan canlı PROD uygulamaları
// ayrı sayılır: sessizce kaybolmaz. Admin olmayan salt okur: takvim ve set planı yazımı sunucuda
// Admin'e kapalı. Açıklama kutusu yalnız Admin'e, yalnız canlıda eşleşen satırda görünür; bu bir ekran
// tercihidir, yetki sınırı değil: not mevcut beyan ucundan (PUT /intranet/declare) gider ve o uç SPA
// Raporu'yla aynı kuralla sayfayı gören herkese açıktır.
//
// PAKET KURULUMU (2026-11-23, IntranetPaketKurulum.tsx): PROD'da Nginx'e gelmeyen paketler; takvim
// tablosunun altında, yalnız Admin'e çizilir (kullanıcı 2026-11-27: "paket kurulumu zincirini geri koy").
import {
  Fragment,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowUpTrayIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';
import {
  arkSpaApi,
  type PlanOnizleme,
  type TakvimHamSatir,
  type TakvimHata,
  type TakvimOnizleme,
  type TakvimPlanSatir,
  type TakvimSatir,
  type TakvimYanit,
} from '@/api/arkSpaApi';
import { AuthContext } from '@/contexts/AuthContext';
import { GuncellemeRozeti } from '@/components/common/GuncellemeRozeti';
import IntranetPaketKurulum from '@/components/IntranetPaketKurulum';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { toast } from '@/hooks/useToast';
import { downloadCsv } from '@/utils/csv';
import { fmtOran, fmtYuzde, portalGunu } from '@/utils/datetime';
import {
  DC_BELIRTILMEMIS,
  ILERLEME_CSV_BASLIK,
  TAKVIM_CSV_BASLIK,
  durumMetni,
  ilerlemeCsvSatirlari,
  satirAnahtari,
  setIciAnahtar,
  setIlerlemesi,
  suzTakvim,
  takvimCsvSatirlari,
  takvimSirala,
  tarihGoster,
  type DcGrubu,
  type SetIlerleme,
} from '@/components/intranetSpa';

const SELECT = 'px-2 py-1.5 text-xs border rounded-lg max-w-full';
const DUGME = 'flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg';
const KUCUK_DUGME = 'px-1.5 py-0.5 text-[11px] border rounded';
const KUCUK_GIRDI = 'px-1 py-0.5 text-[11px] border rounded';
/** Sunucu sınırı (intranet-takvim.cjs SINIR.metin) ile aynı: gövde 2 MB'a sığar. */
const METIN_SINIR = 600000;
/** Okumadan önce kaba eleme: UTF-8'de bir karakter en çok 3 bayt (BOM dahil). */
const DOSYA_SINIR = METIN_SINIR * 3 + 3;

const KAYNAK_METIN = { canli: 'canlı rapordan', liste: 'yüklenen listeden' } as const;

/** Tarih düzeltme yanıtındaki ham satırları ekrandaki satırlara işler (alan önceliği değişmez). */
function hamIsle(rows: readonly TakvimSatir[], ham: readonly TakvimHamSatir[]): TakvimSatir[] {
  const m = new Map(ham.map((h) => [satirAnahtari(h), h]));
  return rows.map((r) => {
    const h = m.get(satirAnahtari(r));
    return h
      ? {
          ...r,
          gecisTarihi: h.gecisTarihi,
          surum: h.surum,
          guncelleyen: h.guncelleyen,
          guncelleme: h.guncelleme,
        }
      : r;
  });
}

/** Planı tek set satırıyla günceller (yoksa ekler), set sırasıyla. */
function planIsle(plan: readonly TakvimPlanSatir[], p: TakvimPlanSatir): TakvimPlanSatir[] {
  return [...plan.filter((x) => x.set !== p.set), p].sort((a, b) => a.setSira - b.setSira);
}

function TarihDuzenle({
  ilk,
  etiket,
  kaydet,
  iptal,
}: {
  ilk: string;
  etiket: string;
  kaydet: (tarih: string) => void;
  iptal?: () => void;
}) {
  const [v, setV] = useState(ilk);
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="date"
        aria-label={etiket}
        value={v}
        onChange={(e) => setV(e.target.value)}
        className={KUCUK_GIRDI}
        style={{ borderColor: 'var(--border)' }}
      />
      <button
        type="button"
        className={KUCUK_DUGME}
        style={{ borderColor: 'var(--border)' }}
        disabled={!v || v === ilk}
        onClick={() => kaydet(v)}
      >
        Kaydet
      </button>
      {iptal && (
        <button type="button" className="px-1.5 py-0.5 text-[11px]" onClick={iptal}>
          İptal
        </button>
      )}
    </span>
  );
}

interface SetForm {
  gecisTarihi: string;
  dc: string;
  eskiIp: string;
  yeniIp: string;
  topla: boolean;
}

/**
 * Admin: set planı satırını düzenler (tarih, DC, eski / yeni IP). Tarih değişince (ya da farklı
 * tarihli uygulamalar "bu tarihe al" ile) setin uygulamalarının tarihi de değişir: kaç uygulamanın
 * hangi tarihe gideceği ayrıca onaylanır.
 */
function SetDuzenle({
  s,
  dc,
  satirlar,
  kaydet,
  iptal,
}: {
  s: SetIlerleme;
  dc: string;
  satirlar: readonly TakvimSatir[];
  kaydet: (f: SetForm) => void;
  iptal: () => void;
}) {
  const [f, setF] = useState<SetForm>({
    gecisTarihi: s.tarih || '',
    dc: s.plan ? s.plan.dc : dc,
    eskiIp: s.plan?.eskiIp || '',
    yeniIp: s.plan?.yeniIp || '',
    topla: false,
  });
  const [onay, setOnay] = useState(false);
  const alan = (k: 'dc' | 'eskiIp' | 'yeniIp', etiket: string, yer: string) => (
    <label className="inline-flex items-center gap-1">
      <span>{etiket}</span>
      <input
        aria-label={`${s.set} ${etiket}`}
        value={f[k]}
        placeholder={yer}
        maxLength={k === 'dc' ? 64 : 15}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
        className={`${KUCUK_GIRDI} w-28`}
        style={{ borderColor: 'var(--border)' }}
      />
    </label>
  );
  // Sunucuyla aynı kural: plan yoksa ya da tarih değiştiyse (ya da topla) tarihi farklı satırlar taşınır.
  const tasinir = !s.plan || s.plan.gecisTarihi !== f.gecisTarihi || f.topla;
  const tasinacak = tasinir ? satirlar.filter((r) => r.gecisTarihi !== f.gecisTarihi).length : 0;
  const kaydetTikla = () => {
    if (tasinacak && !onay) setOnay(true);
    else kaydet(f);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      <input
        type="date"
        aria-label={`${s.set} geçiş tarihi`}
        value={f.gecisTarihi}
        onChange={(e) => {
          setOnay(false);
          setF({ ...f, gecisTarihi: e.target.value });
        }}
        className={KUCUK_GIRDI}
        style={{ borderColor: 'var(--border)' }}
      />
      {alan('dc', 'DC', 'DC adı')}
      {alan('eskiIp', 'Eski IP', 'IPv4')}
      {alan('yeniIp', 'Yeni IP', 'IPv4')}
      {s.farkliTarih > 0 && (
        <label className="inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={f.topla}
            onChange={(e) => {
              setOnay(false);
              setF({ ...f, topla: e.target.checked });
            }}
          />
          Farklı tarihteki {s.farkliTarih} uygulamayı da bu tarihe al
        </label>
      )}
      {onay && (
        <span role="alert" style={{ color: 'var(--status-warning-text)' }}>
          {s.set}: {tasinacak} uygulamanın geçiş tarihi {tarihGoster(f.gecisTarihi)} olacak.
        </span>
      )}
      <button
        type="button"
        className={KUCUK_DUGME}
        style={{ borderColor: 'var(--accent)' }}
        disabled={!f.gecisTarihi}
        onClick={kaydetTikla}
      >
        {onay ? 'Onayla' : 'Kaydet'}
      </button>
      <button type="button" className="px-1.5 py-0.5" onClick={iptal}>
        İptal
      </button>
    </div>
  );
}

const ILERLEME_SUTUN = ILERLEME_CSV_BASLIK.length;

function SetIlerlemesi({
  gruplar,
  secili,
  sec,
  admin,
  duzenlenen,
  duzenle,
  rows,
  kaydet,
}: {
  gruplar: DcGrubu[];
  secili: string;
  sec: (set: string) => void;
  admin: boolean;
  duzenlenen: string | null;
  duzenle: (set: string | null) => void;
  rows: readonly TakvimSatir[];
  kaydet: (s: SetIlerleme, f: SetForm) => void;
}) {
  const csvIndir = () =>
    downloadCsv('intranet_spa_set_ilerlemesi', ILERLEME_CSV_BASLIK, ilerlemeCsvSatirlari(gruplar));
  return (
    <section aria-label="Set ilerlemesi" className="space-y-1">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold">Set ilerlemesi</h2>
        <button
          type="button"
          onClick={csvIndir}
          className={DUGME}
          style={{ borderColor: 'var(--border)' }}
        >
          <ArrowDownTrayIcon className="w-3.5 h-3.5" /> Set ilerlemesi CSV
        </button>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          Satıra tıklayınca uygulama listesi o sete süzülür.
        </span>
      </div>
      <div
        className="overflow-auto rounded-xl border"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <table className="w-full text-[12px]" aria-label="Set ilerlemesi tablosu">
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              {ILERLEME_CSV_BASLIK.map((b) => (
                <th key={b} className="text-left px-2 py-1.5 whitespace-nowrap">
                  {b}
                </th>
              ))}
            </tr>
          </thead>
          {gruplar.map((g) => (
            <tbody key={g.dc || '-'}>
              <tr style={{ background: 'var(--bg-elevated)' }}>
                <th colSpan={ILERLEME_SUTUN} className="text-left px-2 py-1 text-[11px]">
                  {g.dc || DC_BELIRTILMEMIS} · {g.toplam} uygulama
                </th>
              </tr>
              {g.setler.map((s) => {
                const sec1 = secili === s.set;
                return (
                  <Fragment key={s.set}>
                    <tr
                      aria-selected={sec1}
                      className="border-t cursor-pointer"
                      style={{
                        borderColor: 'var(--border-subtle)',
                        background: sec1 ? 'var(--accent-bg)' : undefined,
                      }}
                      onClick={() => sec(s.set)}
                    >
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <button type="button" aria-pressed={sec1} className="font-medium">
                            {s.set}
                          </button>
                          {admin && (
                            <button
                              type="button"
                              aria-label={`${s.set} planını düzenle`}
                              title={
                                s.plan?.guncelleyen
                                  ? `Son değiştiren: ${s.plan.guncelleyen}`
                                  : 'Set planını düzenle'
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                duzenle(duzenlenen === s.set ? null : s.set);
                              }}
                            >
                              <PencilSquareIcon className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {s.tarih ? tarihGoster(s.tarih) : ''}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{g.dc || '—'}</td>
                      <td className="px-2 py-1.5 tabular-nums">{s.plan?.eskiIp || ''}</td>
                      <td className="px-2 py-1.5 tabular-nums">{s.plan?.yeniIp || ''}</td>
                      <td className="px-2 py-1.5 tabular-nums">{s.uygulama}</td>
                      <td className="px-2 py-1.5 tabular-nums">{fmtOran(s.pay)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{s.kumulatif}</td>
                      <td className="px-2 py-1.5 tabular-nums">{fmtYuzde(s.yuzde)}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{durumMetni(s)}</td>
                    </tr>
                    {admin && duzenlenen === s.set && (
                      <tr>
                        <td
                          colSpan={ILERLEME_SUTUN}
                          className="px-2 py-1.5"
                          style={{ background: 'var(--bg-elevated)' }}
                        >
                          <SetDuzenle
                            s={s}
                            dc={g.dc}
                            satirlar={rows.filter((r) => r.set === s.set)}
                            kaydet={(f) => kaydet(s, f)}
                            iptal={() => duzenle(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}

interface OnizlemeTemel {
  ok: boolean;
  message?: string;
  gecerli?: boolean;
  hatalar?: TakvimHata[];
  hataSayisi?: number;
  yoksayilanSutun?: string[];
  uyarilar?: string[];
}

function Hatalar({ o }: { o: OnizlemeTemel }) {
  return (
    <>
      {!!o.yoksayilanSutun?.length && (
        <div style={{ color: 'var(--text-muted)' }}>
          Kullanılmayan sütunlar: {o.yoksayilanSutun.join(', ')}
        </div>
      )}
      {!!o.uyarilar?.length && (
        <div style={{ color: 'var(--status-warning-text)' }}>
          Uyarı (yüklemeyi engellemez):
          <ul className="list-disc pl-5">
            {o.uyarilar.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}
      {!!o.hataSayisi && (
        <div role="alert" style={{ color: 'var(--status-danger-text)' }}>
          {o.hataSayisi} satırda hata var; dosya yüklenemez.
          <ul className="list-disc pl-5">
            {(o.hatalar || []).map((h) => (
              <li key={`${h.satir}-${h.mesaj}`}>
                {h.satir ? `Satır ${h.satir}: ` : ''}
                {h.mesaj}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** Admin: CSV seç → sunucuda önizle → onayla (takvim ve set planı aynı desen). */
function CsvYukle<O extends OnizlemeTemel>({
  etiket,
  girdiEtiketi,
  bolgeEtiketi,
  onizle,
  kilitOf,
  yukle,
  basari,
  ozet,
  yuklendi,
}: {
  etiket: string;
  girdiEtiketi: string;
  bolgeEtiketi: string;
  onizle: (metin: string) => Promise<O>;
  kilitOf: (o: O) => string | null;
  yukle: (
    metin: string,
    kilit: string | null,
  ) => Promise<{ ok: boolean; message?: string; code?: string; satir?: number }>;
  basari: (satir: number) => string;
  ozet: (o: O, dosya: string) => ReactNode;
  yuklendi: () => void;
}) {
  const girdi = useRef<HTMLInputElement>(null);
  const [metin, setMetin] = useState<string | null>(null);
  const [dosya, setDosya] = useState('');
  const [oniz, setOniz] = useState<O | null>(null);
  const [mesgul, setMesgul] = useState(false);

  const onizleCalistir = async (m: string) => {
    setMesgul(true);
    try {
      const o = await onizle(m);
      if (!o.ok) toast.error(o.message || 'Önizleme yapılamadı.');
      setOniz(o.ok ? o : null);
    } catch {
      toast.error('Önizleme yapılamadı (ağ hatası).');
    } finally {
      setMesgul(false);
    }
  };
  const sec = async (f: File | undefined) => {
    if (!f) return;
    const buyuk = 'Dosya çok büyük (en çok 600.000 karakter).';
    if (f.size > DOSYA_SINIR) {
      toast.error(buyuk);
      return;
    }
    const m = await f.text();
    if (m.length > METIN_SINIR) {
      toast.error(buyuk);
      return;
    }
    setMetin(m);
    setDosya(f.name);
    await onizleCalistir(m);
  };
  const vazgec = () => {
    setMetin(null);
    setOniz(null);
    setDosya('');
    if (girdi.current) girdi.current.value = '';
  };
  const onayla = async () => {
    if (metin == null || !oniz?.gecerli) return;
    setMesgul(true);
    try {
      const r = await yukle(metin, kilitOf(oniz));
      if (r.ok) {
        toast.success(basari(r.satir ?? 0));
        vazgec();
        yuklendi();
        return;
      }
      toast.error(r.message || 'Yüklenemedi.');
      // ÇAKIŞMA: başka biri değiştirdi; önizleme tazelenir, kullanıcı yeniden onaylar.
      if (r.code === 'takvim_cakisma') await onizleCalistir(metin);
    } catch {
      toast.error('Yüklenemedi (ağ hatası).');
    } finally {
      setMesgul(false);
    }
  };

  return (
    <>
      <input
        ref={girdi}
        type="file"
        accept=".csv"
        className="hidden"
        aria-label={girdiEtiketi}
        onChange={(e) => void sec(e.target.files?.[0])}
      />
      <button
        type="button"
        className={DUGME}
        style={{ borderColor: 'var(--border)' }}
        disabled={mesgul}
        onClick={() => girdi.current?.click()}
      >
        <ArrowUpTrayIcon className="w-3.5 h-3.5" /> {etiket}
      </button>
      {oniz && (
        <section
          aria-label={bolgeEtiketi}
          className="w-full rounded-xl border px-3 py-2 text-[12px] space-y-1"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}
        >
          {ozet(oniz, dosya)}
          <Hatalar o={oniz} />
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              className={DUGME}
              style={{ borderColor: 'var(--accent)' }}
              disabled={mesgul || !oniz.gecerli}
              onClick={() => void onayla()}
            >
              Onayla ve yükle
            </button>
            <button type="button" className={DUGME} onClick={vazgec} disabled={mesgul}>
              İptal
            </button>
          </div>
        </section>
      )}
    </>
  );
}

function TakvimOzeti({ o, dosya }: { o: TakvimOnizleme; dosya: string }) {
  return (
    <>
      <div className="font-semibold">
        Önizleme: {dosya} · {o.satir} uygulama satırı
      </div>
      <div style={{ color: 'var(--text-secondary)' }}>
        {(o.setler || [])
          .map((s) => `${s.set}: ${s.satir} (${s.tarihler.map(tarihGoster).join(', ')})`)
          .join(' · ')}
      </div>
      {o.fark && (
        <div style={{ color: 'var(--text-secondary)' }}>
          Mevcut takvim {o.fark.mevcut} satır: {o.fark.yeni} yeni, {o.fark.kalkan} çıkacak,{' '}
          {o.fark.tarihDegisen} satırın tarihi değişecek. Yükleme mevcut takvimin yerine geçer; set
          planı değişmez.
        </div>
      )}
      {!!o.fark?.elleKaybolan && (
        <div role="alert" style={{ color: 'var(--status-warning-text)' }}>
          Elle düzeltilmiş {o.fark.elleKaybolan} geçiş tarihi bu listeyle değişecek ya da kalkacak.
        </div>
      )}
      {!!o.uyariSayisi && o.uyariSayisi > (o.uyarilar?.length || 0) && (
        <div style={{ color: 'var(--status-warning-text)' }}>
          Toplam {o.uyariSayisi} uyarı; ilk {o.uyarilar?.length || 0} gösteriliyor.
        </div>
      )}
    </>
  );
}

function PlanOzeti({ o, dosya }: { o: PlanOnizleme; dosya: string }) {
  return (
    <>
      <div className="font-semibold">
        Set planı önizlemesi: {dosya} · {o.satir} set
      </div>
      <ul className="pl-5 list-disc" style={{ color: 'var(--text-secondary)' }}>
        {(o.setler || []).map((s) => (
          <li key={s.set}>
            {s.set}: {tarihGoster(s.gecisTarihi)} · {s.dc || DC_BELIRTILMEMIS}
            {s.eskiIp || s.yeniIp ? ` · ${s.eskiIp || '—'} → ${s.yeniIp || '—'}` : ''}
          </li>
        ))}
      </ul>
      {o.fark && (
        <div style={{ color: 'var(--text-secondary)' }}>
          Mevcut plan {o.fark.mevcut} set: {o.fark.yeni} yeni, {o.fark.kalkan} çıkacak,{' '}
          {o.fark.degisen} değişen. Yükleme mevcut planın yerine geçer; takvim satırları silinmez.
        </div>
      )}
      {(o.tasima || []).map((t) => (
        <div
          key={t.set}
          role={t.elle ? 'alert' : undefined}
          style={{ color: 'var(--status-warning-text)' }}
        >
          {t.set}: {t.uygulama} uygulamanın tarihi değişecek ({tarihGoster(t.yeniTarih)})
          {t.elle ? `; elle düzeltilmiş ${t.elle} tarih kaybolacak` : ''}.
        </div>
      ))}
    </>
  );
}

export default function IntranetSpaPage() {
  // useAuth DEĞİL: sağlayıcısız render'da (testler) sayfa salt okunur çizilir.
  const { user } = useContext(AuthContext);
  const admin = user?.role === 'Admin';
  const [data, setData] = useState<TakvimYanit | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [set, setSet] = useState('all');
  const [ekip, setEkip] = useState('all');
  const [q, setQ] = useState('');
  const [duzenlenen, setDuzenlenen] = useState<string | null>(null);
  const [duzenlenenSet, setDuzenlenenSet] = useState<string | null>(null);

  const yukle = useCallback(async (fresh = false) => {
    setYukleniyor(true);
    try {
      setData(await arkSpaApi.takvim(fresh));
    } catch {
      setData({ ok: false, message: 'Geçiş takvimi alınamadı (ağ hatası).' });
    } finally {
      setYukleniyor(false);
    }
  }, []);
  useAsyncEffect(async () => {
    await yukle(false);
  }, [yukle]);

  const rows = useMemo(() => takvimSirala(data?.rows || []), [data]);
  const plan = useMemo(() => data?.plan || [], [data]);
  const bugun = portalGunu();
  const gruplar = useMemo(() => setIlerlemesi(rows, plan, bugun), [rows, plan, bugun]);
  const setAdlari = useMemo(
    () => gruplar.flatMap((g) => g.setler).sort((a, b) => a.setSira - b.setSira),
    [gruplar],
  );
  const ekipler = useMemo(
    () => [...new Set(rows.map((r) => r.ekip).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const satirlar = useMemo(() => suzTakvim(rows, { set, ekip, q }), [rows, set, ekip, q]);

  const satirlariIsle = (ham: TakvimHamSatir[]) =>
    setData((d) => (d ? { ...d, rows: hamIsle(d.rows || [], ham) } : d));

  const satirTarihi = async (r: TakvimSatir, tarih: string) => {
    setDuzenlenen(null);
    try {
      const c = await arkSpaApi.takvimTarih({
        set: r.set,
        namespace: r.namespace,
        uygulama: r.uygulama,
        tarih,
        beklenenSurum: r.surum,
      });
      if (c.ok) {
        satirlariIsle(c.rows || []);
        toast.success(`Geçiş tarihi güncellendi (${c.rows?.length || 0} uygulama).`);
        return;
      }
      toast.error(c.message || 'Geçiş tarihi güncellenemedi.');
      // ÇAKIŞMA: ekrandaki sürüm eskidi; liste tazelenir ki yeniden denenen değer güncel olsun.
      if (c.code === 'takvim_cakisma') await yukle(false);
    } catch {
      toast.error('Geçiş tarihi güncellenemedi (ağ hatası).');
    }
  };

  const setKaydet = async (s: SetIlerleme, f: SetForm) => {
    const beklenen: Record<string, number> = {};
    for (const r of rows) if (r.set === s.set) beklenen[setIciAnahtar(r)] = r.surum;
    try {
      const c = await arkSpaApi.takvimSet({
        set: s.set,
        gecisTarihi: f.gecisTarihi,
        dc: f.dc.trim(),
        eskiIp: f.eskiIp.trim(),
        yeniIp: f.yeniIp.trim(),
        beklenenSurum: s.plan?.surum ?? 0,
        beklenen,
        topla: f.topla,
      });
      if (c.ok) {
        const p = c.plan;
        setData((d) =>
          d
            ? {
                ...d,
                plan: p ? planIsle(d.plan || [], p) : d.plan,
                rows: hamIsle(d.rows || [], c.rows || []),
              }
            : d,
        );
        setDuzenlenenSet(null);
        toast.success(
          `${s.set} planı güncellendi${c.tasinan ? ` (${c.tasinan} uygulamanın tarihi değişti)` : ''}.`,
        );
        // Aynı uygulama aynı DC'de başka sette de: yazım gitti, uyarı söylenir (engellemez).
        for (const u of c.uyarilar || []) toast.warning(u);
        return;
      }
      toast.error(c.message || 'Set planı güncellenemedi.');
      if (c.code === 'takvim_cakisma') {
        setDuzenlenenSet(null);
        await yukle(false);
      }
    } catch {
      toast.error('Set planı güncellenemedi (ağ hatası).');
    }
  };

  const aciklamaYaz = async (r: TakvimSatir, note: string) => {
    if (note === (r.canliNot ?? '')) return;
    try {
      // Uygulama beyanı (inUse) DEĞİŞMEDEN, canlı raporun ns / app yazımıyla gider: açıklama SPA
      // Raporu ile aynı uygulama notudur (uygulamanın her DC satırında aynı not).
      const c = await arkSpaApi.intranetBeyan({
        namespace: r.canliNamespace ?? r.namespace,
        application: r.canliUygulama ?? r.uygulama,
        inUse: r.inUse,
        note,
      });
      if (!c.ok) {
        toast.error(c.message || 'Açıklama kaydedilemedi.');
        return;
      }
      const ayniUygulama = (x: TakvimSatir) => setIciAnahtar(x) === setIciAnahtar(r) && x.canli;
      setData((d) =>
        d
          ? {
              ...d,
              rows: (d.rows || []).map((x) =>
                ayniUygulama(x)
                  ? {
                      ...x,
                      canliNot: note,
                      // Not boşsa sunucu da listedeki açıklamayı gösterir.
                      aciklama: note || x.listeAciklama,
                      kaynak: { ...x.kaynak, aciklama: note ? 'canli' : 'liste' },
                    }
                  : x,
              ),
            }
          : d,
      );
    } catch {
      toast.error('Açıklama kaydedilemedi (ağ hatası).');
    }
  };

  const csvIndir = () =>
    downloadCsv('intranet_spa_gecis_takvimi', TAKVIM_CSV_BASLIK, takvimCsvSatirlari(satirlar));

  const takvimdeYok = data?.takvimdeYok || [];
  const canli = data?.canli;
  const kaynakIpucu = (k: 'canli' | 'liste') => KAYNAK_METIN[k];

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-start gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Intranet SPA</h1>
          <p className="text-[12px] max-w-3xl" style={{ color: 'var(--text-secondary)' }}>
            Intranet SPA geçiş takvimi: set ilerlemesi (DC başına) ve uygulama listesi. Route,
            Dynatrace ve açıklama uygulama canlı raporda varsa canlıdan, ekip ve e-posta yüklenen
            listeden gelir.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {data?.yukleme?.zaman && (
            <GuncellemeRozeti etiket="takvim yüklemesi" tarih={data.yukleme.zaman} />
          )}
          {canli?.kesifTarihi && <GuncellemeRozeti etiket="SPA keşfi" tarih={canli.kesifTarihi} />}
          <button
            type="button"
            onClick={() => yukle(true)}
            className={DUGME}
            style={{ borderColor: 'var(--border)' }}
            disabled={yukleniyor}
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${yukleniyor ? 'animate-spin' : ''}`} /> Yenile
          </button>
          {admin && (
            <CsvYukle<TakvimOnizleme>
              etiket="Takvim yükle"
              girdiEtiketi="Geçiş takvimi CSV dosyası"
              bolgeEtiketi="Takvim önizlemesi"
              onizle={arkSpaApi.takvimOnizle}
              kilitOf={(o) => o.yukleme?.kilit ?? null}
              yukle={arkSpaApi.takvimYukle}
              basari={(n) => `Geçiş takvimi yüklendi: ${n} uygulama satırı.`}
              ozet={(o, dosya) => <TakvimOzeti o={o} dosya={dosya} />}
              yuklendi={() => void yukle(true)}
            />
          )}
          {admin && (
            <CsvYukle<PlanOnizleme>
              etiket="Set planı yükle"
              girdiEtiketi="Set planı CSV dosyası"
              bolgeEtiketi="Set planı önizlemesi"
              onizle={arkSpaApi.planOnizle}
              kilitOf={(o) => o.kilit ?? null}
              yukle={arkSpaApi.planYukle}
              basari={(n) => `Set planı yüklendi: ${n} set.`}
              ozet={(o, dosya) => <PlanOzeti o={o} dosya={dosya} />}
              yuklendi={() => void yukle(false)}
            />
          )}
        </div>
      </div>

      {data && !data.ok && (
        <div
          role="alert"
          className="text-[12px] rounded-lg px-3 py-2 border"
          style={{ color: 'var(--status-danger-text)', borderColor: 'var(--status-danger)' }}
        >
          {data.message || 'Geçiş takvimi alınamadı.'}
        </div>
      )}
      {data?.ok && canli && canli.durum !== 'var' && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border"
          style={{ color: 'var(--status-warning-text)', borderColor: 'var(--status-warning)' }}
        >
          {canli.durum === 'taranmadi'
            ? 'SPA Uygulamaları taraması henüz yok'
            : `Canlı Intranet SPA raporu alınamadı${canli.message ? ` (${canli.message})` : ''}`}
          : bütün değerler yüklenen listeden gösteriliyor.
        </div>
      )}
      {data?.ok && canli?.dynatraceOkunamadi && (
        <div className="text-[11px]" style={{ color: 'var(--status-warning-text)' }}>
          Dynatrace kullanım verisi okunamadı: Dynatrace sütunları yüklenen listeden.
        </div>
      )}
      {!data && yukleniyor && (
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          Geçiş takvimi yükleniyor…
        </div>
      )}
      {data?.ok && !rows.length && !yukleniyor && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border"
          style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)' }}
        >
          Geçiş takvimi henüz yüklenmedi.
          {admin
            ? ' “Takvim yükle” ile CSV dosyasını yükleyin.'
            : ' Yöneticinin yüklemesi bekleniyor.'}
        </div>
      )}

      {gruplar.length > 0 && (
        <SetIlerlemesi
          gruplar={gruplar}
          secili={set}
          sec={(s) => setSet((x) => (x === s ? 'all' : s))}
          admin={admin}
          duzenlenen={duzenlenenSet}
          duzenle={setDuzenlenenSet}
          rows={rows}
          kaydet={(s, f) => void setKaydet(s, f)}
        />
      )}

      {data?.ok && takvimdeYok.length > 0 && (
        <details className="text-[11px]" style={{ color: 'var(--status-warning-text)' }}>
          <summary className="cursor-pointer select-none">
            Takvimde yok: {takvimdeYok.length} canlı PROD intranet SPA
          </summary>
          <ul className="mt-1 pl-5 list-disc" style={{ color: 'var(--text-secondary)' }}>
            {takvimdeYok.map((t) => (
              <li key={`${t.namespace}/${t.uygulama}`}>
                {t.namespace} / {t.uygulama}
                {t.ekip ? ` · ${t.ekip}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Set"
          className={SELECT}
          style={{ borderColor: 'var(--border)' }}
          value={set}
          onChange={(e) => setSet(e.target.value)}
        >
          <option value="all">Tüm setler</option>
          {setAdlari.map((s) => (
            <option key={s.set} value={s.set}>
              {s.set}
            </option>
          ))}
        </select>
        <select
          aria-label="Ekip"
          className={SELECT}
          style={{ borderColor: 'var(--border)' }}
          value={ekip}
          onChange={(e) => setEkip(e.target.value)}
        >
          <option value="all">Tüm ekipler</option>
          {ekipler.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <input
          type="search"
          aria-label="Ara"
          placeholder="Uygulama, namespace, ekip, route ara…"
          className={`${SELECT} w-64`}
          style={{ borderColor: 'var(--border)' }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="button"
          onClick={csvIndir}
          className={DUGME}
          style={{ borderColor: 'var(--border)' }}
          disabled={!satirlar.length}
        >
          <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV ({satirlar.length})
        </button>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {satirlar.length} / {rows.length} uygulama satırı
        </span>
      </div>

      <div
        className="overflow-auto rounded-xl border"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <table className="w-full text-[12px]" aria-label="Uygulama listesi">
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              {TAKVIM_CSV_BASLIK.map((b) => (
                <th key={b} className="text-left px-2 py-1.5 whitespace-nowrap">
                  {b}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {satirlar.map((r) => {
              const k = satirAnahtari(r);
              return (
                <tr
                  key={k}
                  className="border-t align-top"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.set}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {admin && duzenlenen === k ? (
                      <TarihDuzenle
                        ilk={r.gecisTarihi}
                        etiket={`${r.set} ${r.uygulama} geçiş tarihi`}
                        kaydet={(t) => void satirTarihi(r, t)}
                        iptal={() => setDuzenlenen(null)}
                      />
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        {tarihGoster(r.gecisTarihi)}
                        {admin && (
                          <button
                            type="button"
                            aria-label={`${r.set} ${r.uygulama} geçiş tarihini düzenle`}
                            title={
                              r.guncelleyen
                                ? `Son değiştiren: ${r.guncelleyen}`
                                : 'Geçiş tarihini düzenle'
                            }
                            onClick={() => setDuzenlenen(k)}
                          >
                            <PencilSquareIcon className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">{r.sira}</td>
                  <td className="px-2 py-1.5" title={kaynakIpucu(r.kaynak.ekip)}>
                    {r.ekip}
                  </td>
                  <td className="px-2 py-1.5 break-all" title={kaynakIpucu(r.kaynak.ekipEposta)}>
                    {r.ekipEposta}
                  </td>
                  <td className="px-2 py-1.5">{r.namespace}</td>
                  <td className="px-2 py-1.5 font-medium">{r.uygulama}</td>
                  <td
                    className="px-2 py-1.5 break-all"
                    title={kaynakIpucu(r.kaynak.routeAdresleri)}
                  >
                    {r.routeAdresleri}
                  </td>
                  <td
                    className="px-2 py-1.5 whitespace-nowrap"
                    title={kaynakIpucu(r.kaynak.dynatrace)}
                  >
                    {r.dynatraceDurumu}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums" title={kaynakIpucu(r.kaynak.dynatrace)}>
                    {r.dynatraceIstek}
                  </td>
                  <td className="px-2 py-1.5 min-w-[12rem]" title={kaynakIpucu(r.kaynak.aciklama)}>
                    {admin && r.canli ? (
                      <input
                        key={`${k}|${r.canliNot ?? ''}`}
                        aria-label={`${r.set} ${r.uygulama} açıklama`}
                        defaultValue={r.canliNot ?? ''}
                        placeholder={r.listeAciklama}
                        maxLength={500}
                        className="w-full px-1.5 py-0.5 text-[12px] border rounded"
                        style={{ borderColor: 'var(--border-subtle)' }}
                        onBlur={(e) => void aciklamaYaz(r, e.target.value)}
                      />
                    ) : (
                      r.aciklama
                    )}
                  </td>
                </tr>
              );
            })}
            {!satirlar.length && !yukleniyor && rows.length > 0 && (
              <tr>
                <td
                  colSpan={TAKVIM_CSV_BASLIK.length}
                  className="px-2 py-3"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Bu süzgeçlerle uygulama yok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <IntranetPaketKurulum />

      <details className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        <summary className="cursor-pointer select-none">Bu sayfa neyi gösteriyor?</summary>
        <div className="mt-1 space-y-1 max-w-3xl">
          <p>
            Her uygulama DC başına bir satırdır: önce bir DC’nin setinde, sonra diğer DC’nin setinde
            geçer. Set, geçiş tarihi ve sıra yalnız yüklenen geçiş takviminden gelir. Yönetici
            takvimi CSV olarak yükler (önce önizleme, sonra onay; yükleme mevcut takvimin yerine
            geçer, set planına dokunmaz) ve tek uygulamanın geçiş tarihini düzeltebilir.
          </p>
          <p>
            Set ilerlemesi: setin tarihi, DC’si ve eski / yeni IP’si set planından gelir; yönetici
            satırdan düzenler ya da set planı CSV’si yükler (set;gecis_tarihi;dc;eski_ip;yeni_ip).
            Setin tarihi değişince o setteki uygulamaların tarihi de değişir (önce kaç uygulamanın
            etkileneceği sorulur). Uygulama sayısı, setin payı ve yüzdeler sabit değildir: DC başına
            takvim satırlarından hesaplanır (pay oran olarak, ör. 0,156; toplamın yüzdesi bir
            ondalıkla). DC adı büyük / küçük harf ve baştaki / sondaki boşluk farkı gözetmeden
            gruplanır. Aynı uygulama aynı DC’de iki sette görünürse önizleme ve kayıt bunu uyarı
            olarak söyler (engellemez). Durum bugüne göredir (Geçti / Bugün / Planlı); setin
            uygulamaları farklı tarihlerdeyse kaçının farklı olduğu yazılır. Planda olmayan set
            “plan yok” ve “DC belirtilmemiş” altında görünür.
          </p>
          <p>
            Route uygulama canlı Intranet SPA raporunda (SPA Uygulamaları keşfi) varsa oradan gelir;
            Dynatrace sütunları yalnız ölçüm varsa canlıdır. Açıklama, SPA Raporu ile aynı uygulama
            notudur (uygulamanın iki DC satırında aynı); not boşsa listedeki açıklama gösterilir.
            Ekip ve e-posta listeden gelir (sıra set içindeki ekip sırasıdır); listede boşsa
            canlıdan. Hücrenin üzerine gelince değerin nereden geldiği görünür.
          </p>
          <p>
            “Takvimde yok” canlı raporda PROD’da görünen ama takvimde olmayan intranet SPA’ları
            sayar.
          </p>
        </div>
      </details>
    </div>
  );
}
