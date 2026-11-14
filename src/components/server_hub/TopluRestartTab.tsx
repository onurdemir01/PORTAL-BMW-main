// src/components/server_hub/TopluRestartTab.tsx — Server Hub › Toplu Restart (2026-11-14).
//
// Kullanıcı: "JBoss8 DOCCOREFILESERVICE calisiyor ama yapilandirilan JVM parametreleri calisan surectekinden FARKLI
// uyarilari ... bunlar icin de toplu restart et sayfasi getirir misin?" (bulgu JVM_PARAM_FARKI).
//
// Güvenlik modeli (server/server-hub/toplu-restart.cjs başlığı): liste yalnız TAZE taramada farkı olan çalışan
// JVM'ler (farklı parametreler maskeli gösterilir, varsayılan hepsi seçili). TEK düğme önce salt okunur ÖNİZLEME
// taraması açar (hâlâ çalışıyor + fark hâlâ var mı); sonra onay; JVM'ler TEK TEK restart edilir (bir sonraki ancak
// önceki STARTED olup sunucu yeniden tarandıktan sonra), her restart'tan sonra fark kapandı mı yazılır. Prod ve ortamı
// bilinmeyen sunucular listeye alınmaz ("OpsX'ten tek tek"). Yürütme sunucu tarafında; gizli sekme yoklama yapmaz.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import {
  serverHubApi,
  type ShRestartAday,
  type ShRestartAdaylar,
  type ShRestartIs,
  type ShRestartOge,
  type ShRestartOgeDurum,
} from '@/api/serverHubApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { toast } from '@/hooks/useToast';
import { fmtNumber, fmtDateTime } from '@/utils/datetime';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { useOnay } from '@/components/common/OnayPenceresi';
import { useSekmeGorunur } from './sekmeGorunurlugu';

/** Yoklama aralığı (sunucu yürütücüsü 10 sn'de bir ilerler). */
export const YOKLAMA_MS = 5000;
/** Onay bekleyen işte (PLAN_HAZIR) seyrek yoklama: başka admin onaylar / iptal eder ya da süre dolar. */
export const PLAN_YOKLAMA_MS = 30000;
/** Önizleme geçerliliği (sunucu PLAN_YAS_MS ile aynı). */
export const PLAN_GECERLILIK_MS = 15 * 60 * 1000;
const YURUYEN = new Set(['PLANLANIYOR', 'CALISIYOR', 'IPTAL_ISTENDI']);
const anahtar = (x: { host: string; gen: number; jvm: string }) => `${x.host}|${x.gen}|${x.jvm}`;

const IS_ETIKET: Record<string, string> = {
  PLANLANIYOR: 'Önizleme taraması (salt okunur)',
  PLAN_HAZIR: 'Önizleme hazır — onay bekliyor',
  CALISIYOR: 'Restart ediliyor (tek tek)',
  IPTAL_ISTENDI: 'İptal istendi — süren JVM bitince durur',
  BITTI: 'Bitti',
  BITTI_HATALI: 'Bitti — başarısız öğe var',
  IPTAL: 'İptal edildi',
  YARIM_KALDI: 'Yarım kaldı (Portal yeniden başladı)',
  PLAN_HATA: 'Önizleme okunamadı',
  PLAN_ESKIDI: 'Önizleme eskidi (15 dk)',
};
export const OGE_ETIKET: Record<ShRestartOgeDurum, string> = {
  ADAY: 'sırada (önizleme)',
  PLANLANIYOR: 'önizleme taranıyor',
  PLAN_GECTI: 'restart edilecek',
  DUSTU: 'düştü',
  BEKLIYOR: 'sırada',
  BASLATILIYOR: 'başlatılıyor',
  CALISIYOR: 'restart ediliyor',
  TARANIYOR: 'doğrulama taraması',
  KAPANDI: 'fark kapandı',
  KAPANMADI: 'fark kapanmadı',
  FAIL: 'BAŞARISIZ',
  ATLANDI: 'atlandı',
  IPTAL: 'iptal',
  YARIM_KALDI: 'yarım kaldı',
};
const kirmiziMi = (d: string) => d === 'BITTI_HATALI' || d === 'PLAN_HATA' || d === 'YARIM_KALDI';
const ogeRengi = (d: ShRestartOgeDurum) =>
  d === 'KAPANDI' || d === 'PLAN_GECTI'
    ? 'var(--status-success)'
    : d === 'FAIL' || d === 'YARIM_KALDI'
      ? 'var(--status-danger)'
      : d === 'KAPANMADI' || d === 'DUSTU' || d === 'ATLANDI' || d === 'IPTAL'
        ? 'var(--status-warning)'
        : 'var(--text-muted)';

/** Onay metni: kapsam, sıra, yan etkiler (Teams kartı) ve prod dışlaması açıkça yazılır. */
export function onayMetni(ogeler: ShRestartOge[]): string {
  const gecen = ogeler.filter((o) => o.durum === 'PLAN_GECTI');
  const hostlar = [...new Set(gecen.map((o) => o.host))];
  return (
    `${gecen.length} JVM, ${hostlar.length} sunucu RESTART edilecek.\n\n` +
    'JVM’ler TEK TEK restart edilir: bir sonraki ancak önceki STARTED olup sunucusu yeniden tarandıktan sonra başlar; ' +
    'aynı uygulamanın kopyaları asla aynı anda restart edilmez. Bir JVM ayağa kalkmazsa toplu iş durmaz ama aynı ' +
    'uygulamanın bekleyen kopyaları atlanır ve özet kırmızı olur.\n\n' +
    `Her restart bir OpsX işidir (iş geçmişi + denetim) ve her biri Teams’e bir bildirim kartı gönderir (${gecen.length} kart). ` +
    'Prod sunucular bu listede yoktur (OpsX’ten tek tek, Smart onayı).\n\nDevam edilsin mi?'
  );
}

function Rozet({ durum }: { durum: string }) {
  const renk = kirmiziMi(durum)
    ? 'var(--status-danger)'
    : durum === 'BITTI'
      ? 'var(--status-success)'
      : YURUYEN.has(durum) || durum === 'PLAN_HAZIR'
        ? 'var(--accent)'
        : 'var(--status-warning)';
  return (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border" style={{ color: renk, borderColor: renk }}>
      {IS_ETIKET[durum] || durum}
    </span>
  );
}

function Fark({ metin }: { metin: string | null | undefined }) {
  if (!metin) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <ul className="space-y-0.5 font-mono text-[11px] break-all">
      {metin.split('; ').map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

function AdayTablosu({
  satirlar,
  secili,
  setSecili,
  kilitli,
}: {
  satirlar: ShRestartAday[];
  secili: Set<string>;
  setSecili: (f: (s: Set<string>) => Set<string>) => void;
  kilitli: boolean;
}) {
  if (!satirlar.length) return null;
  const hepsi = satirlar.every((x) => secili.has(anahtar(x)));
  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="px-3 py-2 text-xs font-semibold flex items-center gap-2" style={{ background: 'var(--bg-elevated)' }}>
        <input
          type="checkbox"
          aria-label="Tümünü seç"
          checked={hepsi}
          disabled={kilitli}
          onChange={() =>
            setSecili((s) => {
              const n = new Set(s);
              for (const x of satirlar) {
                if (hepsi) n.delete(anahtar(x));
                else n.add(anahtar(x));
              }
              return n;
            })
          }
        />
        Parametre farkı olan çalışan JVM’ler <span style={{ color: 'var(--text-muted)' }}>({fmtNumber(satirlar.length)})</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th className="px-3 py-1 w-6" />
              <th className="px-3 py-1 text-left font-medium">Sunucu</th>
              <th className="px-3 py-1 text-left font-medium">Ortam</th>
              <th className="px-3 py-1 text-left font-medium">JVM</th>
              <th className="px-3 py-1 text-left font-medium">Farklı parametreler (çalışan → yapılandırılan, maskeli)</th>
              <th className="px-3 py-1 text-left font-medium">Tarama</th>
            </tr>
          </thead>
          <tbody>
            {satirlar.map((x) => (
              <tr key={anahtar(x)} className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
                <td className="px-3 py-1">
                  <input
                    type="checkbox"
                    aria-label={`${x.host} ${x.jvm} seç`}
                    checked={secili.has(anahtar(x))}
                    disabled={kilitli}
                    onChange={() =>
                      setSecili((s) => {
                        const n = new Set(s);
                        if (n.has(anahtar(x))) n.delete(anahtar(x));
                        else n.add(anahtar(x));
                        return n;
                      })
                    }
                  />
                </td>
                <td className="px-3 py-1 font-mono">{x.host}</td>
                <td className="px-3 py-1">{x.env || '—'}</td>
                <td className="px-3 py-1 font-mono">
                  {x.jvm} <span style={{ color: 'var(--text-muted)' }}>JBoss {x.gen}{x.grp ? ` · ${x.grp}` : ''}</span>
                </td>
                <td className="px-3 py-1 max-w-xl">
                  <Fark metin={x.fark} />
                </td>
                <td className="px-3 py-1" style={{ color: 'var(--text-muted)' }}>{x.scanDate || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OgeTablosu({ ogeler }: { ogeler: ShRestartOge[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
      <table className="w-full text-[12px]">
        <thead>
          <tr style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
            <th className="px-3 py-1 text-left font-medium">#</th>
            <th className="px-3 py-1 text-left font-medium">Sunucu</th>
            <th className="px-3 py-1 text-left font-medium">JVM</th>
            <th className="px-3 py-1 text-left font-medium">Durum</th>
            <th className="px-3 py-1 text-left font-medium">Neden / sonuç</th>
            <th className="px-3 py-1 text-left font-medium">Fark (önce)</th>
            <th className="px-3 py-1 text-left font-medium">İşler</th>
          </tr>
        </thead>
        <tbody>
          {ogeler.map((o) => (
            <tr key={o.id} className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
              <td className="px-3 py-1 tabular-nums" style={{ color: 'var(--text-muted)' }}>{o.sira}</td>
              <td className="px-3 py-1 font-mono">{o.host}</td>
              <td className="px-3 py-1 font-mono">
                {o.jvm} <span style={{ color: 'var(--text-muted)' }}>JBoss {o.gen}</span>
              </td>
              <td className="px-3 py-1 font-semibold" style={{ color: ogeRengi(o.durum) }}>
                {OGE_ETIKET[o.durum] || o.durum}
                {o.startState ? <span className="font-normal" style={{ color: 'var(--text-muted)' }}> · {o.startState}</span> : null}
              </td>
              <td className="px-3 py-1" style={{ color: 'var(--text-secondary)' }}>{o.neden || '—'}</td>
              <td className="px-3 py-1 max-w-md">
                <Fark metin={o.fark} />
              </td>
              <td className="px-3 py-1 tabular-nums whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                {[
                  o.planJobId ? `önizleme #${o.planJobId}` : null,
                  o.restartJobId ? `restart #${o.restartJobId}` : null,
                  o.taramaJobId ? `tarama #${o.taramaJobId}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TopluRestartTab() {
  const gorunur = useSekmeGorunur();
  const { onayla, onayPenceresi } = useOnay();
  const [veri, setVeri] = useState<ShRestartAdaylar | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [izlenen, setIzlenen] = useState<number | null>(null);
  const [okunanIs, setIs] = useState<ShRestartIs | null>(null);
  const [ogeler, setOgeler] = useState<ShRestartOge[]>([]);
  const [gonderiliyor, setGonderiliyor] = useState(false);

  const adaylariYukle = useCallback(async (fresh: boolean) => {
    setYukleniyor(true);
    setHata(null);
    try {
      const [a, l] = await Promise.all([serverHubApi.topluRestartAdaylar(fresh), serverHubApi.topluRestartListe()]);
      if (!a.ok) throw new Error(a.message || 'Aday listesi okunamadı.');
      setVeri(a);
      setSecili(new Set(a.adaylar.map(anahtar)));
      const hedef = a.aktif || (l.ok ? l.aktif || l.son[0] || null : null);
      setIzlenen(hedef ? hedef.id : null);
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useAsyncEffect(async () => {
    if (gorunur && !veri && !yukleniyor && !hata) await adaylariYukle(false);
  }, [gorunur]);

  const [simdi, setSimdi] = useState(() => Date.now());
  const durumOku = useCallback(async (id: number) => {
    const r = await serverHubApi.topluRestartDurum(id);
    setSimdi(Date.now());
    if (!r.ok || !r.is) return;
    setIs(r.is);
    setOgeler(r.ogeler || []);
  }, []);

  useAsyncEffect(async () => {
    if (izlenen != null) await durumOku(izlenen).catch(() => {});
  }, [izlenen, durumOku]);

  const is = okunanIs && okunanIs.id === izlenen ? okunanIs : null;
  const yuruyor = !!is && YURUYEN.has(is.durum);
  const onayBekliyor = !!is && is.durum === 'PLAN_HAZIR';
  useEffect(() => {
    if (!gorunur || izlenen == null || (!yuruyor && !onayBekliyor)) return undefined;
    const t = setInterval(
      () => {
        void durumOku(izlenen).catch(() => {});
      },
      yuruyor ? YOKLAMA_MS : PLAN_YOKLAMA_MS,
    );
    return () => clearInterval(t);
  }, [gorunur, izlenen, yuruyor, onayBekliyor, durumOku]);
  const planKalanMs = onayBekliyor && is?.planBitisAt ? new Date(is.planBitisAt).getTime() + PLAN_GECERLILIK_MS - simdi : null;
  const planDoldu = planKalanMs != null && planKalanMs <= 0;

  const adaylar = useMemo(() => veri?.adaylar || [], [veri]);
  const secim = useMemo(() => adaylar.filter((x) => secili.has(anahtar(x))), [adaylar, secili]);
  const limit = veri?.limit ?? null;
  const limitAsti = limit != null && secim.length > limit;
  const aktifVar = !!is && (YURUYEN.has(is.durum) || is.durum === 'PLAN_HAZIR');
  const prodDislanan = (veri?.dislananlar || []).filter((x) => /OpsX'ten tek tek/.test(x.neden || ''));

  const onizle = async () => {
    if (!secim.length || limitAsti || aktifVar) return;
    setGonderiliyor(true);
    try {
      const r = await serverHubApi.topluRestartOlustur(secim.map((x) => ({ host: x.host, gen: x.gen, jvm: x.jvm })));
      if (!r.ok || r.id == null) {
        toast.error(r.message || 'Toplu restart işi açılamadı.');
        return;
      }
      toast.success(`Toplu restart #${r.id}: ${r.adet} JVM, ${r.hostSayisi} sunucu için önizleme taraması açıldı (salt okunur).`);
      setIzlenen(r.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setGonderiliyor(false);
    }
  };

  const onayVer = async () => {
    if (!is || is.durum !== 'PLAN_HAZIR') return;
    if (!(await onayla({ baslik: 'Toplu restart', metin: onayMetni(ogeler), onayMetni: 'Onayla ve restart et', tehlikeli: true }))) return;
    setGonderiliyor(true);
    try {
      const r = await serverHubApi.topluRestartOnayla(is.id);
      if (!r.ok) toast.error(r.message || 'Onay verilemedi.');
      else toast.success(`Toplu restart #${is.id}: ${r.adet} JVM tek tek restart edilecek.`);
      await durumOku(is.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setGonderiliyor(false);
    }
  };

  const iptalEt = async () => {
    if (!is) return;
    if (
      !(await onayla({
        baslik: 'Toplu restart’ı iptal et',
        metin:
          is.durum === 'CALISIYOR'
            ? 'Yeni JVM başlatılmaz; şu an süren restart (ve doğrulama taraması) iptal EDİLMEZ, bitmesi beklenir ve sonucu yazılır. Bekleyen JVM’ler restart edilmez.'
            : is.durum === 'PLANLANIYOR'
              ? 'Süren salt okunur önizleme taraması bitince iş durur; hiçbir JVM’e dokunulmaz.'
              : 'Önizleme iptal edilir; hiçbir JVM’e dokunulmaz.',
        onayMetni: 'İptal et',
        iptalMetni: 'Devam etsin',
        tehlikeli: true,
      }))
    )
      return;
    try {
      const r = await serverHubApi.topluRestartIptal(is.id);
      if (!r.ok) toast.error(r.message || 'İptal edilemedi.');
      await durumOku(is.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const say = (d: ShRestartOgeDurum) => ogeler.filter((o) => o.durum === d).length;
  const bitti = !!is && !YURUYEN.has(is.durum) && is.durum !== 'PLAN_HAZIR';
  const suren = ogeler.find((o) => o.durum === 'CALISIYOR' || o.durum === 'TARANIYOR' || o.durum === 'BASLATILIYOR');
  // Hiç restart denenmediyse (hepsi düştü / atlandı / iptal) özet yeşil "Tamamlandı" değil, nötr.
  const uygulanan = say('KAPANDI') + say('KAPANMADI') + say('FAIL') + say('YARIM_KALDI');
  const hicUygulanmadi = bitti && !!is && uygulanan === 0 && !kirmiziMi(is.durum);

  return (
    <div className="space-y-4">
      {onayPenceresi}
      <section className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>JVM parametre farkı — toplu restart</h2>
            <p className="text-[12px] mt-0.5 max-w-3xl" style={{ color: 'var(--text-muted)' }}>
              Yalnız taze taramada yapılandırılan JVM parametreleri çalışan süreçtekinden farklı olan, çalışan JVM’ler. Düğme önce
              seçilen sunucuları salt okunur olarak yeniden tarar; JVM durmuşsa ya da fark kalmadıysa düşer. Sonra onay istenir ve
              JVM’ler tek tek restart edilir. Prod ve ortamı bilinmeyen sunucular bu listeye alınmaz (OpsX’ten tek tek).
              {veri?.latestScan ? ` Son tarama: ${veri.latestScan}.` : ''}
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-1 text-xs"
            disabled={yukleniyor}
            onClick={() => void adaylariYukle(true)}
            title="Taze değerlendirme (tüm filo yeniden okunur)"
          >
            <ArrowPathIcon className="w-4 h-4" /> Yenile
          </button>
        </div>
        {hata && (
          <div className="text-[12px] rounded-lg border px-3 py-2" style={{ color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}>
            {hata}
          </div>
        )}
        {yukleniyor && !veri && <LoadingLogo compact label="Adaylar okunuyor…" />}
        {veri && (
          <>
            {veri.schemaUnknown && (
              <div className="text-[12px]" style={{ color: 'var(--status-danger)' }}>
                Server Hub şeması okunamadı — aday yok. Sayfayı yenileyin.
              </div>
            )}
            {!adaylar.length && !veri.schemaUnknown && (
              <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Taze taramada parametre farkı olan, toplu restart’a uygun JVM yok.</div>
            )}
            <AdayTablosu satirlar={adaylar} secili={secili} setSecili={setSecili} kilitli={aktifVar} />
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={gonderiliyor || !secim.length || limitAsti || aktifVar}
                onClick={() => void onizle()}
              >
                Önizle ve restart et ({fmtNumber(secim.length)} JVM)
              </button>
              {limit != null && (
                <span className="text-[11px] tabular-nums" style={{ color: limitAsti ? 'var(--status-danger)' : 'var(--text-muted)' }}>
                  {fmtNumber(secim.length)} / {fmtNumber(limit)} JVM
                  {limitAsti ? ' — sınır aşıldı; seçimi azaltın ya da Admin › Kurallar & Limitler’den artırın' : ''}
                </span>
              )}
              {aktifVar && (
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Toplu restart #{is?.id} aktif — bitene ya da iptal edilene kadar yenisi açılmaz.
                </span>
              )}
            </div>
            {prodDislanan.length > 0 && (
              <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                {fmtNumber(prodDislanan.length)} JVM prod / ortamı bilinmeyen ya da standalone sunucuda — toplu restart’a alınmadı;
                OpsX’ten tek tek restart edin (prod’da Smart onayı).
              </div>
            )}
            {veri.dislananlar.length > 0 && (
              <details className="text-[12px]">
                <summary className="cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                  Farkı olan ama listeye alınmayan {fmtNumber(veri.dislananlar.length)} JVM (nedeniyle)
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {veri.dislananlar.map((x) => (
                    <li key={anahtar(x)}>
                      <span className="font-mono">{x.host}/{x.jvm}</span> — {x.neden}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>

      {is && (
        <section
          className="rounded-xl border p-4 space-y-3"
          style={{ borderColor: kirmiziMi(is.durum) ? 'var(--status-danger)' : 'var(--border-subtle)', background: 'var(--bg-surface)' }}
          aria-label={`Toplu restart #${is.id}`}
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Toplu restart #{is.id}</h2>
              <Rozet durum={is.durum} />
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                açan {is.olusturan}
                {is.onaylayan ? ` · onaylayan ${is.onaylayan}` : ''}
                {is.iptalEden ? ` · iptal eden ${is.iptalEden}` : ''}
                {is.createdAt ? ` · ${fmtDateTime(is.createdAt)}` : ''}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {is.durum === 'PLAN_HAZIR' && (
                <button type="button" className="btn-primary text-xs" disabled={gonderiliyor || !say('PLAN_GECTI') || planDoldu} onClick={() => void onayVer()}>
                  Onayla ve restart et ({fmtNumber(say('PLAN_GECTI'))} JVM)
                </button>
              )}
              {(is.durum === 'PLAN_HAZIR' || is.durum === 'PLANLANIYOR' || is.durum === 'CALISIYOR') && (
                <button type="button" className="btn-secondary text-xs" onClick={() => void iptalEt()}>
                  İptal
                </button>
              )}
            </div>
          </div>
          <div className="text-[12px] tabular-nums flex gap-3 flex-wrap" style={{ color: 'var(--text-secondary)' }}>
            <span>{fmtNumber(ogeler.length)} JVM</span>
            <span>düşen {fmtNumber(say('DUSTU'))}</span>
            <span style={{ color: 'var(--status-success)' }}>fark kapandı {fmtNumber(say('KAPANDI'))}</span>
            <span style={{ color: say('KAPANMADI') ? 'var(--status-warning)' : undefined }}>fark kapanmadı {fmtNumber(say('KAPANMADI'))}</span>
            <span style={{ color: say('FAIL') ? 'var(--status-danger)' : undefined }}>başarısız {fmtNumber(say('FAIL'))}</span>
            <span>atlandı {fmtNumber(say('ATLANDI'))}</span>
            {say('YARIM_KALDI') > 0 && <span style={{ color: 'var(--status-danger)' }}>yarım kaldı {fmtNumber(say('YARIM_KALDI'))}</span>}
          </div>
          {suren && (
            <div className="text-[12px]" style={{ color: 'var(--accent)' }}>
              Şu an: {suren.host}/{suren.jvm} — {OGE_ETIKET[suren.durum]}
              {suren.restartJobId ? ` (restart #${suren.restartJobId}${suren.taramaJobId ? `, tarama #${suren.taramaJobId}` : ''})` : ''}
            </div>
          )}
          {is.hata && <div className="text-[12px]" style={{ color: kirmiziMi(is.durum) ? 'var(--status-danger)' : 'var(--text-muted)' }}>{is.hata}</div>}
          {is.durum === 'PLAN_HAZIR' && (
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Önizleme {is.planBitisAt ? fmtDateTime(is.planBitisAt) : ''} itibarıyla sunucuları yeniden taradı; 15 dakika içinde onaylanmazsa
              yeniden önizlenmeli. Onayda AWX şablonunun Limit’i kabul ettiği yeniden kontrol edilir.
              {planKalanMs != null && (
                <span style={{ color: planDoldu ? 'var(--status-danger)' : undefined }}>
                  {planDoldu
                    ? ' Süre doldu — onaylanamaz; yeniden önizleyin.'
                    : ` Kalan süre: ~${fmtNumber(Math.max(1, Math.ceil(planKalanMs / 60000)))} dk.`}
                </span>
              )}
            </p>
          )}
          {bitti && (
            <div
              className="text-[12px] font-semibold"
              style={{
                color: hicUygulanmadi
                  ? 'var(--text-secondary)'
                  : kirmiziMi(is.durum) || say('FAIL') || say('YARIM_KALDI')
                    ? 'var(--status-danger)'
                    : say('KAPANMADI')
                      ? 'var(--status-warning)'
                      : 'var(--status-success)',
              }}
            >
              {hicUygulanmadi
                ? `Restart edilen JVM yok: ${fmtNumber(say('DUSTU'))} düştü, ${fmtNumber(say('ATLANDI'))} atlandı, ${fmtNumber(say('IPTAL'))} iptal — nedeni tabloda.`
                : is.durum === 'BITTI' && !say('FAIL') && !say('YARIM_KALDI')
                ? `Tamamlandı: ${fmtNumber(say('KAPANDI'))} JVM’de fark kapandı, ${fmtNumber(say('KAPANMADI'))} JVM’de kapanmadı (tarama yanlış uyarı veriyor olabilir — nedeni tabloda).`
                : `Özet: ${fmtNumber(say('KAPANDI'))} kapandı, ${fmtNumber(say('KAPANMADI'))} kapanmadı, ${fmtNumber(say('FAIL'))} başarısız, ${fmtNumber(say('ATLANDI'))} atlandı, ${fmtNumber(say('YARIM_KALDI'))} yarım kaldı — başarısız JVM’ler için AWX işine bakın.`}
            </div>
          )}
          <OgeTablosu ogeler={ogeler} />
          {bitti && (
            <button type="button" className="btn-secondary text-xs" onClick={() => void adaylariYukle(true)}>
              Listeyi yenile
            </button>
          )}
        </section>
      )}
    </div>
  );
}
