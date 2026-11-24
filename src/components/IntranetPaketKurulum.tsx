// src/components/IntranetPaketKurulum.tsx — Intranet SPA > "Nginx'e gelmeyenler (PROD) · paket kurulumu".
//
// Kullanici (2026-11-23): "Intranet SPA'lerimdeki eksik paketlerin Nginx'lere gelmesinde maalesef yeterince
// hizli degiliz. o yuzden gecisleri beklemeden paketleri Artifactory'den sunucuya cekmek istiyorum."
// Kararlar: yalniz PROD intranet sunuculari, yalniz kurulum durumu 'yok' olan satirlar; surum OCP'de kosan
// imaj etiketi (Portal'in saatlik taramasi; 3 saatten eskiyse engel); application.json uygulamanin
// route'undaki /config'ten (bastionsuz, 2026-11-23 karar "A"); kapi Portal'da ACIK PROD ONAYI (onay
// kutusuna birebir "PROD" yazilir, Smart yok).
//
// AKIS: once PLAN (sunucuya hicbir sey yazilmaz; betikler, hedefin boslugu, paketin erisilebilirligi ve
// /config'in JSON nesnesi oldugu denetlenir),
// plan bitip en az bir PLAN_OK varsa UYGULA; uygulama plan {serverId, jobId} ile gider, yalniz PLAN_OK
// sunucusu olan kalemler secilir. Sunucu adaylari her istekte yeniden hesaplar (istemci verisine guvenmez),
// plani dogrular (ayni kullanici, en cok 2 saat, surum degismemis) ve yalniz PLAN_OK sunuculara kurar. Kurulum durumu gece dizin taramasindan gelir:
// kurulan paket sonraki taramada 'tamam' gorunur.
//
// YALNIZ Admin: uclar Admin'e acik, bolum de yalniz Admin'e cizilir.
import { memo, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import {
  arkSpaApi,
  type PaketAday,
  type PaketAdaylarYanit,
  type PaketIsYanit,
  type PaketKalem,
  type PaketSecim,
  type PaketSonDeneme,
  type PaketSonuc,
  type PaketSonucKalem,
  type PaketUyari,
} from '@/api/arkSpaApi';
import { AuthContext } from '@/contexts/AuthContext';
import { Pill, type Tone } from '@/components/denetim/ui';
import { Modal } from '@/components/common/Modal';
import { fmtDateTime, fmtRelative } from '@/utils/datetime';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';

/** Is basina en cok kalem (sozlesme: tavan 10). */
export const PAKET_EN_COK = 50;
/** Is durumu yoklama araligi. */
export const PAKET_YOKLAMA_MS = 5000;
/** Uygulamak icin yazilacak metin (birebir, buyuk harf). */
export const PAKET_ONAY_METNI = 'PROD';

const anahtar = (s: PaketSecim) => `${s.namespace}/${s.application}`;
const hataMetni = (r: { error?: string; message?: string }, varsayilan: string) =>
  r.error || r.message || varsayilan;

const DURUM_TON: Record<string, Tone> = {
  PLAN_OK: 'success',
  OK: 'success',
  SKIP: 'neutral',
  FAIL: 'danger',
};
const durumTonu = (s: string): Tone => DURUM_TON[s] ?? 'warning';
const MOD_METNI: Record<string, string> = { plan: 'plan', apply: 'uygulama' };

interface Takip {
  serverId: number | string;
  jobId: number | string;
  mod: 'plan' | 'apply';
  secim: PaketSecim[];
  items: PaketKalem[];
}

function Zaman({ v }: { v: string | null | undefined }) {
  if (!v) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return <span title={fmtDateTime(v)}>{fmtRelative(v)}</span>;
}

function UyariHaplari({ uyarilar }: { uyarilar: PaketUyari[] }) {
  if (uyarilar.length === 0) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {uyarilar.map((u, i) => (
        <Pill key={`${u.kod}-${i}`} tone={u.engel ? 'danger' : 'neutral'} title={u.kod}>
          {u.metin}
        </Pill>
      ))}
    </div>
  );
}

function SonDenemeHucre({ d }: { d: PaketSonDeneme | null }) {
  if (!d) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <div className="space-y-0.5">
      <div>
        <Zaman v={d.zaman} /> · {MOD_METNI[d.mod] ?? d.mod}
        <span style={{ color: 'var(--text-muted)' }}>
          {' '}
          · #{d.jobId} · {d.kullanici}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {d.sunucular.map((s) => (
          <Pill key={s.host} tone={durumTonu(s.status)} title={s.message}>
            {s.host}: {s.status}
          </Pill>
        ))}
      </div>
    </div>
  );
}

function HedefHucre({ a }: { a: PaketAday }) {
  return (
    <div>
      <div>{a.hedefler.length > 0 ? a.hedefler.join(', ') : '—'}</div>
      {a.taranmayan.length > 0 && (
        <div className="text-[10px]" style={{ color: 'var(--status-warning-text)' }}>
          taranmadı: {a.taranmayan.join(', ')}
        </div>
      )}
    </div>
  );
}

// memo: secimde yalniz durumu degisen satir yeniden cizilir. Tablo 50+ satirken her tik tum satirlari
// yeniden ciziyordu (PK3 tam suit yukunde 5 sn'yi asti). Prop'lar sabit: `a` durumdan, `degistir` useCallback.
const AdaySatiri = memo(function AdaySatiri({
  a,
  secili,
  secilebilir,
  degistir,
}: {
  a: PaketAday;
  secili: boolean;
  secilebilir: boolean;
  degistir: (a: PaketAday) => void;
}) {
  return (
    <tr className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
      <td className="px-2 py-1.5">
        <input
          type="checkbox"
          aria-label={`${a.application} (${a.namespace}) seç`}
          checked={secili}
          disabled={!secilebilir}
          onChange={() => degistir(a)}
        />
      </td>
      <td className="px-2 py-1.5">
        <div className="font-semibold">{a.application}</div>
        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {a.namespace}
        </div>
      </td>
      <td className="px-2 py-1.5 font-mono" title={a.imaj ?? undefined}>
        {a.surum ?? '—'}
      </td>
      <td className="px-2 py-1.5" title={a.clusters.join(', ')}>
        {a.cluster ?? '—'}
      </td>
      <td className="px-2 py-1.5">
        <Zaman v={a.alinma} />
      </td>
      <td className="px-2 py-1.5">
        <HedefHucre a={a} />
      </td>
      <td className="px-2 py-1.5">
        <UyariHaplari uyarilar={a.uyarilar} />
      </td>
      <td className="px-2 py-1.5">
        <SonDenemeHucre d={a.sonDeneme} />
      </td>
    </tr>
  );
});

function AdayTablosu({
  adaylar,
  secim,
  kilitli,
  degistir,
}: {
  adaylar: PaketAday[];
  secim: Set<string>;
  kilitli: boolean;
  degistir: (a: PaketAday) => void;
}) {
  const dolu = secim.size >= PAKET_EN_COK;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr style={{ color: 'var(--text-muted)' }}>
            <th className="px-2 py-1 text-left font-semibold">
              <span className="sr-only">Seçim</span>
            </th>
            <th className="px-2 py-1 text-left font-semibold">Uygulama</th>
            <th className="px-2 py-1 text-left font-semibold">PROD sürümü</th>
            <th className="px-2 py-1 text-left font-semibold">OCP cluster</th>
            <th className="px-2 py-1 text-left font-semibold">Okuma</th>
            <th className="px-2 py-1 text-left font-semibold">Hedef sunucular</th>
            <th className="px-2 py-1 text-left font-semibold">Uyarılar</th>
            <th className="px-2 py-1 text-left font-semibold">Son deneme</th>
          </tr>
        </thead>
        <tbody>
          {adaylar.map((a) => {
            const secili = secim.has(anahtar(a));
            const secilebilir = a.kurulabilir && !kilitli && (secili || !dolu);
            return (
              <AdaySatiri
                key={anahtar(a)}
                a={a}
                secili={secili}
                secilebilir={secilebilir}
                degistir={degistir}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SonucKalemi({ k }: { k: PaketSonucKalem }) {
  return (
    <>
      <tr className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
        <td className="px-2 py-1 font-semibold" colSpan={4}>
          {k.application}{' '}
          <span className="font-normal" style={{ color: 'var(--text-muted)' }}>
            {k.namespace} · {k.version}
          </span>
        </td>
      </tr>
      {k.hosts.map((h) => (
        <tr key={h.host}>
          <td className="px-2 py-0.5 pl-4">{h.host}</td>
          <td className="px-2 py-0.5">
            <Pill tone={durumTonu(h.status)}>{h.status}</Pill>
          </td>
          <td className="px-2 py-0.5 font-mono">{h.step}</td>
          <td className="px-2 py-0.5">{h.message}</td>
        </tr>
      ))}
    </>
  );
}

function SonucTablosu({ sonuc }: { sonuc: PaketSonuc }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]" aria-label="Kurulum sonucu">
        <thead>
          <tr style={{ color: 'var(--text-muted)' }}>
            <th className="px-2 py-1 text-left font-semibold">Sunucu</th>
            <th className="px-2 py-1 text-left font-semibold">Sonuç</th>
            <th className="px-2 py-1 text-left font-semibold">Adım</th>
            <th className="px-2 py-1 text-left font-semibold">Mesaj</th>
          </tr>
        </thead>
        <tbody>
          {sonuc.items.map((k) => (
            <SonucKalemi key={k.id} k={k} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function planOkSunuculari(sonuc: PaketSonuc | undefined, id: string): string[] {
  const k = sonuc?.items.find((x) => x.id === id);
  return k ? k.hosts.filter((h) => h.status === 'PLAN_OK').map((h) => h.host) : [];
}

/** Planin uygulanacak kalemleri: PLAN_OK sunucusu olanlar (sunucu da yalniz bunlari kurar). */
function uygulanacaklar(
  kalemler: PaketKalem[],
  plan: PaketSonuc | undefined,
): { kalem: PaketKalem; sunucular: string[] }[] {
  return kalemler
    .map((kalem) => ({ kalem, sunucular: planOkSunuculari(plan, kalem.id) }))
    .filter((x) => x.sunucular.length > 0);
}

function OnayPenceresi({
  acik,
  kalemler,
  plan,
  kapat,
  onayla,
}: {
  acik: boolean;
  kalemler: PaketKalem[];
  plan: PaketSonuc | undefined;
  kapat: () => void;
  onayla: () => void;
}) {
  // Pencere her acilista yeniden kurulur (cagiran yalniz acikken cizer): metin bos baslar.
  const [metin, setMetin] = useState('');
  const gecerli = metin === PAKET_ONAY_METNI;
  const kurulacak = uygulanacaklar(kalemler, plan);
  const ids = new Set(kurulacak.map((x) => x.kalem.id));
  const disarida = kalemler.filter((k) => !ids.has(k.id));
  return (
    <Modal
      open={acik}
      onClose={kapat}
      title="PROD paket kurulumu"
      size="lg"
      dismissOnBackdrop={false}
      footer={
        <>
          <button type="button" className="btn-danger" disabled={!gecerli} onClick={onayla}>
            Onayla ve kur
          </button>
          <button type="button" className="btn-secondary" onClick={kapat}>
            İptal
          </button>
        </>
      }
    >
      <div className="space-y-2 text-[12px]">
        <p>Aşağıdaki paketler PROD intranet Nginx sunucularına kurulacak:</p>
        <ul className="list-disc pl-5 space-y-0.5" aria-label="Kurulacaklar">
          {kurulacak.map(({ kalem: k, sunucular }) => (
            <li key={k.id}>
              <b>{k.application}</b> ({k.namespace}) ·{' '}
              <span className="font-mono">{k.version}</span> → {sunucular.join(', ')}
            </li>
          ))}
        </ul>
        {disarida.length > 0 && (
          <p aria-label="Kurulmayacaklar" style={{ color: 'var(--text-secondary)' }}>
            Planda PLAN_OK sunucusu olmadığı için gönderilmez:{' '}
            {disarida.map((k) => k.application).join(', ')}
          </p>
        )}
        <p style={{ color: 'var(--text-secondary)' }}>
          Yalnız planda PLAN_OK olan sunucular kurulur. Sürüm plandan sonra değiştiyse ya da plan 2
          saatten eskiyse sunucu uygulamayı reddeder; yeniden planlayın.
        </p>
        <label className="block">
          <span>
            Onaylamak için <b>{PAKET_ONAY_METNI}</b> yazın
          </span>
          <input
            type="text"
            aria-label="Onay metni"
            className="mt-1 block w-40 px-2 py-1 border rounded"
            style={{ borderColor: 'var(--border)' }}
            value={metin}
            onChange={(e) => setMetin(e.target.value)}
            autoComplete="off"
          />
        </label>
      </div>
    </Modal>
  );
}

/** Is durumunu yoklar: hemen bir kez, bitene kadar PAKET_YOKLAMA_MS'de bir. */
function useIsTakibi(takip: Takip | null, bitince: (r: PaketIsYanit, t: Takip) => void) {
  // Yanit hangi isin oldugunu tasir: yeni is baslayinca eski yanit gosterilmez (effect'te sifirlama yok).
  const [kayit, setKayit] = useState<{ takip: Takip; r: PaketIsYanit } | null>(null);
  useEffect(() => {
    if (!takip) return undefined;
    let iptal = false;
    let zaman: ReturnType<typeof setTimeout> | undefined;
    const sor = async () => {
      const r: PaketIsYanit = await arkSpaApi
        .paketIs(takip.serverId, takip.jobId)
        .catch(() => ({ ok: false, message: 'İş durumu alınamadı.' }));
      if (iptal) return;
      setKayit({ takip, r });
      if (r.ok && !r.finished) {
        zaman = setTimeout(sor, PAKET_YOKLAMA_MS);
      } else if (r.ok) {
        bitince(r, takip);
      }
    };
    void sor();
    return () => {
      iptal = true;
      clearTimeout(zaman);
    };
  }, [takip, bitince]);
  return kayit && kayit.takip === takip ? kayit.r : null;
}

function IsDurumu({ takip, durum }: { takip: Takip; durum: PaketIsYanit | null }) {
  const bitti = !!durum?.finished;
  let metin = 'durum soruluyor…';
  if (durum?.ok) metin = bitti ? `bitti (${durum.status ?? '—'})` : (durum.status ?? 'sürüyor');
  return (
    <div className="space-y-2">
      <div className="text-[12px]" role="status">
        İş #{takip.jobId} ({MOD_METNI[takip.mod]}): {metin}
      </div>
      {durum && !durum.ok && (
        <div role="alert" className="text-[12px]" style={{ color: 'var(--status-danger-text)' }}>
          {hataMetni(durum, 'İş durumu alınamadı.')}
        </div>
      )}
      {durum?.finished && durum.error && (
        <div role="alert" className="text-[12px]" style={{ color: 'var(--status-danger-text)' }}>
          {durum.error}
        </div>
      )}
      {durum?.sonuc && <SonucTablosu sonuc={durum.sonuc} />}
    </div>
  );
}

const planUygulanabilir = (takip: Takip | null, durum: PaketIsYanit | null) =>
  takip?.mod === 'plan' &&
  !!durum?.finished &&
  !!durum.sonuc?.items.some((k) => k.hosts.some((h) => h.status === 'PLAN_OK'));

function UstBilgi({
  data,
  yukleniyor,
  yenile,
}: {
  data: PaketAdaylarYanit | null;
  yukleniyor: boolean;
  yenile: () => void;
}) {
  return (
    <div className="flex items-start gap-2 flex-wrap">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold">Nginx’e gelmeyenler (PROD) · paket kurulumu</h2>
        <p className="text-[11px] max-w-3xl" style={{ color: 'var(--text-secondary)' }}>
          PROD intranet sunucularında hiç kurulu olmayan intranet SPA’lar. Sürüm, saatlik OCP
          taramasında koşan imaj etiketidir (3 saatten eski okuma kurulmaz); paket Artifactory’den
          bu sürümle, application.json uygulamanın route’undaki /config’ten çekilir. Önce plan
          (sunucuya bir şey yazılmaz), sonra onaylı uygulama. Admin.
        </p>
      </div>
      <div className="flex items-center gap-2 text-[12px]">
        {data?.ozet && (
          <span>
            Toplam <b>{data.ozet.toplam}</b> · kurulabilir <b>{data.ozet.kurulabilir}</b>
          </span>
        )}
        <button
          type="button"
          onClick={yenile}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg"
          style={{ borderColor: 'var(--border)' }}
          disabled={yukleniyor}
        >
          <ArrowPathIcon className={`w-3.5 h-3.5 ${yukleniyor ? 'animate-spin' : ''}`} /> Yenile
        </button>
      </div>
    </div>
  );
}

function PaketKurulumIcerik() {
  const [data, setData] = useState<PaketAdaylarYanit | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [secim, setSecim] = useState<Set<string>>(() => new Set());
  const [takip, setTakip] = useState<Takip | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [onayAcik, setOnayAcik] = useState(false);
  const [kuruldu, setKuruldu] = useState(false);

  const yukle = useCallback(async (fresh: boolean) => {
    setYukleniyor(true);
    try {
      setData(await arkSpaApi.paketAdaylari(fresh));
    } catch {
      setData({ ok: false, message: 'Adaylar alınamadı.' });
    } finally {
      setYukleniyor(false);
    }
  }, []);
  useAsyncEffect(async () => {
    await yukle(false);
  }, [yukle]);

  const bitince = useCallback(
    (r: PaketIsYanit, t: Takip) => {
      if (t.mod !== 'apply') return;
      if (r.sonuc?.items.some((k) => k.hosts.some((h) => h.status === 'OK'))) setKuruldu(true);
      void yukle(false);
    },
    [yukle],
  );
  const durum = useIsTakibi(takip, bitince);
  const calisiyor = !!takip && !durum?.finished && durum?.ok !== false;
  const adaylar = useMemo(() => data?.adaylar ?? [], [data]);

  const degistir = useCallback((a: PaketAday) => {
    setSecim((eski) => {
      const yeni = new Set(eski);
      const k = anahtar(a);
      if (yeni.has(k)) yeni.delete(k);
      else if (yeni.size < PAKET_EN_COK) yeni.add(k);
      return yeni;
    });
    setTakip(null);
    setKuruldu(false);
  }, []);

  const gonder = async (s: PaketSecim[], plan: Takip | null) => {
    const apply = plan !== null;
    setHata(null);
    setGonderiliyor(true);
    try {
      const r = await arkSpaApi.paketKur(
        plan
          ? {
              secim: s,
              apply,
              onayMetni: PAKET_ONAY_METNI,
              plan: { serverId: plan.serverId, jobId: plan.jobId },
            }
          : { secim: s, apply },
      );
      if (r.ok && r.serverId != null && r.jobId != null) {
        setTakip({
          serverId: r.serverId,
          jobId: r.jobId,
          mod: r.mod ?? (apply ? 'apply' : 'plan'),
          secim: s,
          items: r.items ?? [],
        });
        if (r.uyari) setHata(r.uyari);
      } else {
        setHata(hataMetni(r, 'İş başlatılamadı.'));
      }
    } catch {
      setHata('İş başlatılamadı.');
    } finally {
      setGonderiliyor(false);
    }
  };

  const planla = () => {
    const s = adaylar
      .filter((a) => secim.has(anahtar(a)))
      .map((a) => ({ namespace: a.namespace, application: a.application }));
    setKuruldu(false);
    void gonder(s, null);
  };
  // Uygula plana baglidir: sunucu plan {serverId, jobId}'yi dogrular ve yalniz PLAN_OK sunuculara kurar;
  // PLAN_OK sunucusu olmayan kalem gonderilmez (sunucu da cikarir).
  const uygula = () => {
    if (takip?.mod !== 'plan') return;
    const s = uygulanacaklar(takip.items, durum?.sonuc).map(({ kalem }) => ({
      namespace: kalem.namespace,
      application: kalem.application,
    }));
    setOnayAcik(false);
    if (s.length > 0) void gonder(s, takip);
  };

  return (
    <section
      className="rounded-lg border p-3 space-y-2"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
      aria-label="Paket kurulumu"
    >
      <UstBilgi data={data} yukleniyor={yukleniyor} yenile={() => void yukle(true)} />
      {data && !data.ok && (
        <div role="alert" className="text-[12px]" style={{ color: 'var(--status-danger-text)' }}>
          {hataMetni(data, 'Adaylar alınamadı.')}
        </div>
      )}
      {data?.ok && adaylar.length === 0 && (
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          PROD’da Nginx’e gelmeyen intranet SPA yok.
        </div>
      )}
      {adaylar.length > 0 && (
        <AdayTablosu
          adaylar={adaylar}
          secim={secim}
          kilitli={calisiyor || gonderiliyor}
          degistir={degistir}
        />
      )}
      <div className="flex items-center gap-2 flex-wrap text-[12px]">
        <button
          type="button"
          className="btn-primary"
          disabled={secim.size === 0 || calisiyor || gonderiliyor}
          onClick={planla}
        >
          Seçilenleri planla
        </button>
        {planUygulanabilir(takip, durum) && (
          <button
            type="button"
            className="btn-danger"
            disabled={gonderiliyor}
            onClick={() => setOnayAcik(true)}
          >
            Uygula
          </button>
        )}
        <span style={{ color: 'var(--text-muted)' }}>
          {secim.size} seçili · bir işte en çok {PAKET_EN_COK} uygulama seçilebilir
        </span>
      </div>
      {hata && (
        <div role="alert" className="text-[12px]" style={{ color: 'var(--status-danger-text)' }}>
          {hata}
        </div>
      )}
      {takip && <IsDurumu takip={takip} durum={durum} />}
      {kuruldu && (
        <div className="text-[12px]" role="status" style={{ color: 'var(--status-success)' }}>
          Kuruldu: kurulum durumu sonraki dizin taramasında “tamam” görünür.
        </div>
      )}
      {onayAcik && (
        <OnayPenceresi
          acik
          kalemler={takip?.items ?? []}
          plan={durum?.sonuc}
          kapat={() => setOnayAcik(false)}
          onayla={uygula}
        />
      )}
    </section>
  );
}

export default function IntranetPaketKurulum() {
  // useAuth DEGIL: saglayicisiz render'da (sayfanin kendi testleri) bolum sessizce cizilmez.
  const { user } = useContext(AuthContext);
  if (user?.role !== 'Admin') return null;
  return <PaketKurulumIcerik />;
}
