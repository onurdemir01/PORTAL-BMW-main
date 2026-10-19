// src/components/IntranetSpaPage.tsx — Nginx ARK SPA > Intranet SPA (/ark-spa/intranet-spa).
//
// Kullanıcı (2026-10-19): "Şimdi Intranet SPA'lere başlıyorum, bunlar yük alıyor mu almıyor mu
// kullanılıyor mu vb rapor görebilmek istiyorum. Ve yine insanlardan kullanım durumu hakkında bilgi
// girişi almak istiyorum." Aynı gün: "Dynatrace metriklerinden çıkarmamız gerekiyordu." Kararlar
// (kullanıcı): liste OpenShift'teki intranet SPA'lar (Gerçek SPA Keşfi), yük mevcut Dynatrace
// kullanım verisi (BMW_Application_Usage).
//
// INTRANET SUNUCU KURULUMU (aynı gün: "Intranet SPA sunucularına deployment tamamlanmış tamamlanmamış mı
// bu bilgiyi de görmek istiyorum"): uygulamanın kendi ortamının intranet nginx sunucularındaki dizin
// taraması (paket / dosyalar / conf), sunucu başına ayrıntı satır açılınca.
//
// İKİ SÜTUN, İKİ AYRI ŞEY (SPA Raporu ile aynı): "Dynatrace" ÖLÇÜLÜR, "Ekip beyanı" ekibin
// dediğidir. Çelişki BİLGİDİR, biri diğerini ezmez. Beyan SPA Raporu / SPA Taşımaları ile AYNI
// uygulama alanına yazılır: hangi ekrandan girilirse girilsin tek cevap.
import { Fragment, useCallback, useMemo, useState } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { arkSpaApi, type IntranetRapor, type IntranetSatir } from '@/api/arkSpaApi';
import { Pill } from '@/components/denetim/ui';
import { GuncellemeRozeti } from '@/components/common/GuncellemeRozeti';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { toast } from '@/hooks/useToast';
import { downloadCsv } from '@/utils/csv';
import { fmtDate, EMPTY_MARK } from '@/utils/datetime';
import {
  BEYAN_ETIKET,
  DEGERLENDIRME,
  INTRANET_CSV_BASLIK,
  ISTEK,
  KURULUM,
  kurulumMetni,
  sunucuDurumu,
  intranetCsvSatirlari,
  istekIpucu,
  istekMetni,
  suzIntranet,
  type BeyanSuzgec,
  type DegSuzgec,
  type IstekSuzgec,
  type KurulumSuzgec,
} from '@/components/intranetSpa';

const tarihMetni = (v: string) => {
  const s = fmtDate(v);
  return s === EMPTY_MARK ? '' : s;
};
const anahtar = (r: IntranetSatir) => `${r.env}|${r.namespace}/${r.application}`;
const SELECT = 'px-2 py-1.5 text-xs border rounded-lg max-w-full';
const BEYAN_RENK: Record<string, string> = {
  yes: 'var(--status-success)',
  no: 'var(--status-danger-text)',
  unknown: 'var(--status-warning-text)',
};
const ISTEK_RENK: Record<string, string> = {
  var: 'var(--status-success)',
  yok: 'var(--text-secondary)',
  'servis-yok': 'var(--status-warning-text)',
  olculemedi: 'var(--status-warning-text)',
  'olcum-yok': 'var(--text-muted)',
};

/** Dynatrace hücresi. Beş durum ayrı: "servis yok", "ölçülemedi", "ölçüm yok" hiçbiri "istek almıyor" DEĞİL. */
function IstekHucre({ r }: { r: IntranetSatir }) {
  return (
    <span
      style={{ color: ISTEK_RENK[r.istek], fontWeight: r.istek === 'var' ? 600 : undefined }}
      title={istekIpucu(r)}
    >
      {istekMetni(r)}
      {r.istek === 'var' && r.dynatrace?.windowDays ? (
        <span className="font-normal text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {' '}
          / {r.dynatrace.windowDays} gün
        </span>
      ) : null}
    </span>
  );
}

function KurulumAyrinti({ r }: { r: IntranetSatir }) {
  const k = r.kurulum;
  return (
    <div className="space-y-1 sm:col-span-2">
      <div className="font-semibold" style={{ color: 'var(--text-muted)' }}>
        Intranet sunucu kurulumu ({r.env})
        {k.eslesme === 'ek-prod' && (
          <span className="font-normal"> · dizinde namespace “-prod” eksiz yazılmış</span>
        )}
      </div>
      {k.sunucular.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="text-[11px]">
            <thead>
              <tr style={{ color: 'var(--text-muted)' }}>
                <th className="text-left pr-3 py-0.5 font-semibold">Sunucu</th>
                <th className="text-left pr-3 py-0.5 font-semibold">Lokasyon</th>
                <th className="text-left pr-3 py-0.5 font-semibold" title="/hysdeploy/<ns>/<app>/">Paket</th>
                <th className="text-left pr-3 py-0.5 font-semibold" title="/usr/nginx/applications/<ns>/<app>/">Dosyalar</th>
                <th className="text-left pr-3 py-0.5 font-semibold" title="application-confs/<app>-<ns>.conf">Conf</th>
                <th className="text-left py-0.5 font-semibold">Durum</th>
              </tr>
            </thead>
            <tbody>
              {k.sunucular.map((s) => (
                <tr key={s.host} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="pr-3 py-0.5 font-mono">{s.host}</td>
                  <td className="pr-3 py-0.5">{s.site || '—'}</td>
                  {[s.hys, s.app, s.conf].map((v, i) => (
                    <td key={i} className="pr-3 py-0.5" style={{ color: v ? 'var(--status-success)' : 'var(--status-danger-text)' }}>
                      {v ? '✓' : '✗'}
                    </td>
                  ))}
                  <td
                    className="py-0.5"
                    style={{ color: s.status === 'OK' ? 'var(--status-success)' : 'var(--status-warning-text)' }}
                  >
                    {sunucuDurumu(s.status)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div>{KURULUM[k.durum]?.hint}</div>
      )}
      {k.taranmayan.length > 0 && (
        <div style={{ color: 'var(--status-warning-text)' }}>
          son dizin taramasında yok (ölçülemedi): {k.taranmayan.join(', ')}
        </div>
      )}
    </div>
  );
}

function Ayrinti({ r }: { r: IntranetSatir }) {
  const d = r.dynatrace;
  return (
    <div className="grid gap-2 sm:grid-cols-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
      <KurulumAyrinti r={r} />
      <div className="space-y-0.5">
        <div className="font-semibold" style={{ color: 'var(--text-muted)' }}>
          Route adresleri
        </div>
        {r.adresler.length ? (
          r.adresler.map((a) => (
            <div key={a} className="font-mono break-all">
              {a}
            </div>
          ))
        ) : (
          <div>—</div>
        )}
        <div className="font-semibold pt-1" style={{ color: 'var(--text-muted)' }}>
          Cluster’lar
        </div>
        <div className="font-mono">
          {r.clusters.join(', ') || '—'}
          {r.kapsam.toplam > 0 && (
            <span className="font-sans" style={{ color: 'var(--text-muted)' }}>
              {' '}
              · ortamın {r.kapsam.toplam} cluster’ının {r.kapsam.var}’inde
            </span>
          )}
        </div>
        {r.eskiCluster.length > 0 && (
          <div style={{ color: 'var(--status-warning-text)' }}>
            eski veri (son keşif koşusu başarısız): {r.eskiCluster.join(', ')}
          </div>
        )}
      </div>
      <div className="space-y-0.5">
        <div className="font-semibold" style={{ color: 'var(--text-muted)' }}>
          Dynatrace
        </div>
        <div>{ISTEK[r.istek]?.hint}</div>
        {d && (
          <>
            {r.req != null && d.windowDays != null && (
              <div>
                Son {d.windowDays} günde <b className="tabular-nums">{r.req}</b> istek
              </div>
            )}
            {d.services != null && <div>{d.services} servis</div>}
            {d.olcum && <div>ölçülen cluster: {d.olcum}</div>}
            {d.scanDate && <div>ölçüm günü {d.scanDate}</div>}
            {d.note && <div className="break-all">not: {d.note}</div>}
          </>
        )}
      </div>
    </div>
  );
}

export default function IntranetSpaPage() {
  const [data, setData] = useState<IntranetRapor | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [env, setEnv] = useState<string | null>(null);
  const [istek, setIstek] = useState<IstekSuzgec>('all');
  const [beyan, setBeyan] = useState<BeyanSuzgec>('all');
  const [deg, setDeg] = useState<DegSuzgec>('all');
  const [kurulum, setKurulum] = useState<KurulumSuzgec>('all');
  const [ekip, setEkip] = useState('all');
  const [q, setQ] = useState('');
  const [acik, setAcik] = useState<Set<string>>(() => new Set());
  const [kayit, setKayit] = useState<string | null>(null);

  const yukle = useCallback(async (fresh = false) => {
    setYukleniyor(true);
    try {
      setData(await arkSpaApi.intranet(fresh));
    } catch {
      setData({ ok: false, message: 'Rapor alınamadı (ağ hatası).' });
    } finally {
      setYukleniyor(false);
    }
  }, []);
  useAsyncEffect(async () => {
    await yukle(false);
  }, [yukle]);

  const envs = useMemo(() => data?.envs || [], [data]);
  // VARSAYILAN ORTAM PROD: "kullanılıyor mu" kararı üretimde verilir; diğer ortamlar bir tık uzakta.
  const secilenEnv = env ?? (envs.some((e) => e.env === 'PROD') ? 'PROD' : envs[0]?.env || 'all');
  const rows = useMemo(() => data?.rows || [], [data]);
  const satirlar = useMemo(
    () => suzIntranet(rows, { env: secilenEnv, istek, beyan, deg, ekip, q, kurulum }),
    [rows, secilenEnv, istek, beyan, deg, ekip, q, kurulum],
  );
  const ozet = useMemo(() => {
    const rs = rows.filter((r) => secilenEnv === 'all' || r.env === secilenEnv);
    const say = (f: (r: IntranetSatir) => boolean) => rs.filter(f).length;
    return {
      uygulama: rs.length,
      var: say((r) => r.istek === 'var'),
      yok: say((r) => r.istek === 'yok'),
      servisYok: say((r) => r.istek === 'servis-yok'),
      olculemedi: say((r) => r.istek === 'olculemedi'),
      olcumYok: say((r) => r.istek === 'olcum-yok'),
      bekleyen: say((r) => !r.inUse),
      aday: say((r) => r.degerlendirme.includes('kapatma-adayi')),
      celiski: say((r) => r.degerlendirme.includes('celiski')),
      kurulumTamam: say((r) => r.kurulum.durum === 'tamam'),
      kurulumKismi: say((r) => r.kurulum.durum === 'kismi'),
      kurulumYok: say((r) => r.kurulum.durum === 'yok'),
    };
  }, [rows, secilenEnv]);
  const ekipler = useMemo(() => {
    const t = new Set<string>();
    for (const r of rows) for (const e of r.ekip) t.add(e);
    return [...t].sort();
  }, [rows]);

  const beyanYaz = useCallback(async (r: IntranetSatir, inUse: string | null, note: string) => {
    const k = anahtar(r);
    setKayit(k);
    try {
      const c = await arkSpaApi.intranetBeyan({ namespace: r.namespace, application: r.application, inUse, note });
      if (!c.ok) {
        toast.error(c.message || 'Beyan kaydedilemedi.');
        return;
      }
      // Beyan UYGULAMA seviyesindedir: aynı namespace/uygulama başka bir satırda da duruyorsa o da güncellenir.
      setData((d) =>
        d
          ? {
              ...d,
              rows: (d.rows || []).map((x) =>
                x.namespace === r.namespace && x.application === r.application
                  ? {
                      ...x,
                      inUse: (inUse as IntranetSatir['inUse']) || null,
                      note,
                      inUseBy: c.inUseBy ?? x.inUseBy,
                      inUseAt: c.inUseAt ?? x.inUseAt,
                    }
                  : x,
              ),
            }
          : d,
      );
    } catch {
      toast.error('Beyan kaydedilemedi (ağ hatası).');
    } finally {
      setKayit(null);
    }
  }, []);

  const csvIndir = useCallback(() => {
    downloadCsv('nginx_ark_intranet_spa', INTRANET_CSV_BASLIK, intranetCsvSatirlari(satirlar, tarihMetni));
  }, [satirlar]);

  const kutu = (etiket: string, sayi: number, aktif: boolean, tikla: () => void, renk?: string, ipucu?: string) => (
    <button
      type="button"
      onClick={tikla}
      aria-pressed={aktif}
      title={ipucu}
      className="text-left rounded-xl border px-3 py-2 min-w-[7.5rem] focus-visible:outline focus-visible:outline-2"
      style={{
        borderColor: aktif ? 'var(--accent)' : 'var(--border-subtle)',
        background: aktif ? 'var(--accent-bg)' : 'var(--bg-elevated)',
      }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {etiket}
      </div>
      <div className="text-lg font-semibold tabular-nums" style={{ color: renk || 'var(--text-primary)' }}>
        {sayi}
      </div>
    </button>
  );
  const istekKutu = (v: IstekSuzgec) => () => setIstek((x) => (x === v ? 'all' : v));
  const degKutu = (v: DegSuzgec) => () => setDeg((x) => (x === v ? 'all' : v));
  const kurulumKutu = (v: KurulumSuzgec) => () => setKurulum((x) => (x === v ? 'all' : v));

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-start gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Intranet SPA</h1>
          <p className="text-[12px] max-w-3xl" style={{ color: 'var(--text-secondary)' }}>
            OpenShift’teki intranet SPA uygulamaları (Gerçek SPA Keşfi: pod’unda nginx olan ve route’u
            intranet olanlar). <b>Dynatrace</b> sütunu uygulamanın Dynatrace servislerinin istek
            sayısıdır; <b>Ekip beyanı</b> sizin ifadenizdir. İkisi çelişebilir. Beyan, SPA Raporu ile
            aynı uygulama kaydına yazılır.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {data?.kesifTarihi && <GuncellemeRozeti etiket="SPA keşfi" tarih={data.kesifTarihi} />}
          {data?.dynatraceTarihi && <GuncellemeRozeti etiket="Dynatrace" tarih={data.dynatraceTarihi} />}
          {data?.dizinTarihi && <GuncellemeRozeti etiket="intranet dizin taraması" tarih={data.dizinTarihi} />}
          <button
            type="button"
            onClick={() => yukle(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg"
            style={{ borderColor: 'var(--border)' }}
            disabled={yukleniyor}
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${yukleniyor ? 'animate-spin' : ''}`} /> Yenile
          </button>
        </div>
      </div>

      {data && !data.ok && (
        <div
          role="alert"
          className="text-[12px] rounded-lg px-3 py-2 border"
          style={{ color: 'var(--status-danger-text)', borderColor: 'var(--status-danger)' }}
        >
          {data.message || 'Rapor alınamadı.'}
        </div>
      )}
      {data?.notScanned && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border"
          style={{ color: 'var(--status-warning-text)', borderColor: 'var(--status-warning)' }}
        >
          {data.message || 'Gerçek SPA Keşfi henüz yok'} — bu “intranet SPA yok” demek değildir.
        </div>
      )}
      {data?.ok && data.dynatraceOkunamadi && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border"
          style={{ color: 'var(--status-warning-text)', borderColor: 'var(--status-warning)' }}
        >
          Dynatrace kullanım verisi (BMW_Application_Usage) okunamadı: bütün satırlar “ölçülemedi”
          gösterir — bu “istek almıyor” demek değildir.
        </div>
      )}
      {data?.ok && !data.notScanned && data.dizinDurum === 'okunamadi' && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border"
          style={{ color: 'var(--status-warning-text)', borderColor: 'var(--status-warning)' }}
        >
          Intranet dizin taraması (Nginx_Intranet_Audit) okunamadı: kurulum sütunu “ölçülemedi”
          gösterir — bu “kurulu değil” demek değildir.
        </div>
      )}
      {data?.ok && data.dizinDurum === 'var' && !!data.taranmayanSunucu?.length && (
        <div className="text-[11px]" style={{ color: 'var(--status-warning-text)' }}>
          Son intranet dizin taramasında satırı olmayan sunucular: {data.taranmayanSunucu.join(', ')} —
          bu sunuculardaki kurulum ölçülemedi, “eksik” sayılmadı.
        </div>
      )}
      {/* PLATFORM (2026-10-19): satirlar ARK cluster'larindan (Nginx Hub > Kapsam & Tasima ile ayni kume);
          disarida kalan sessizce dusmez. */}
      {!!data?.platformDisi?.length && (
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          ARK dışı cluster’lardaki intranet SPA’lar bu listeye girmez:{' '}
          {data.platformDisi.map((d) => `${d.platform} ${d.uygulama} (${d.clusters.join(', ') || 'cluster yok'})`).join(' · ')}
        </div>
      )}
      {!!data?.sorunluCluster?.length && (
        <div className="text-[11px]" style={{ color: 'var(--status-warning-text)' }}>
          Keşfi eksik ya da eski olan cluster’lar:{' '}
          {data.sorunluCluster.map((c) => `${c.cluster} (${c.durum}${c.sebep ? `: ${c.sebep}` : ''})`).join(', ')} —
          bu cluster’lardaki intranet SPA’lar listede eksik ya da eski olabilir.
        </div>
      )}

      {envs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Ortam">
          {[...envs.map((e) => ({ id: e.env, n: e.uygulama })), { id: 'all', n: rows.length }].map((e) => (
            <button
              key={e.id}
              type="button"
              aria-pressed={secilenEnv === e.id}
              onClick={() => setEnv(e.id)}
              className="px-2.5 py-1 text-xs border rounded-full"
              style={{
                borderColor: secilenEnv === e.id ? 'var(--accent)' : 'var(--border)',
                background: secilenEnv === e.id ? 'var(--accent-bg)' : 'var(--bg-surface)',
                fontWeight: secilenEnv === e.id ? 600 : 400,
              }}
            >
              {e.id === 'all' ? 'tüm ortamlar' : e.id}{' '}
              <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {e.n}
              </span>
            </button>
          ))}
        </div>
      )}

      {data?.ok && !data.notScanned && (
        <div className="flex flex-wrap gap-2" data-testid="intranet-ozet">
          {kutu('uygulama', ozet.uygulama, false, () => {
            setIstek('all');
            setDeg('all');
            setBeyan('all');
            setKurulum('all');
          }, undefined, 'Süzgeçleri temizler')}
          {kutu('istek alıyor', ozet.var, istek === 'var', istekKutu('var'), 'var(--status-success)', ISTEK.var.hint)}
          {kutu('istek almıyor', ozet.yok, istek === 'yok', istekKutu('yok'), undefined, ISTEK.yok.hint)}
          {kutu('servis yok', ozet.servisYok, istek === 'servis-yok', istekKutu('servis-yok'), 'var(--status-warning-text)', ISTEK['servis-yok'].hint)}
          {kutu('ölçülemedi', ozet.olculemedi, istek === 'olculemedi', istekKutu('olculemedi'), 'var(--status-warning-text)', ISTEK.olculemedi.hint)}
          {kutu('ölçüm yok', ozet.olcumYok, istek === 'olcum-yok', istekKutu('olcum-yok'), undefined, ISTEK['olcum-yok'].hint)}
          {kutu('beyan bekleyen', ozet.bekleyen, beyan === 'bekleyen', () => setBeyan((x) => (x === 'bekleyen' ? 'all' : 'bekleyen')))}
          {kutu('kurulum tamam', ozet.kurulumTamam, kurulum === 'tamam', kurulumKutu('tamam'), 'var(--status-success)', KURULUM.tamam.hint)}
          {kutu('kurulum kısmi', ozet.kurulumKismi, kurulum === 'kismi', kurulumKutu('kismi'), 'var(--status-warning-text)', KURULUM.kismi.hint)}
          {kutu('kurulu değil', ozet.kurulumYok, kurulum === 'yok', kurulumKutu('yok'), 'var(--status-danger-text)', KURULUM.yok.hint)}
          {kutu('kapatma adayı', ozet.aday, deg === 'kapatma-adayi', degKutu('kapatma-adayi'), 'var(--status-danger-text)', DEGERLENDIRME['kapatma-adayi'].hint)}
          {kutu('çelişki', ozet.celiski, deg === 'celiski', degKutu('celiski'), 'var(--status-warning-text)', DEGERLENDIRME.celiski.hint)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Dynatrace durumuna göre süz"
          value={istek}
          onChange={(e) => setIstek(e.target.value as IstekSuzgec)}
          className={SELECT}
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
        >
          <option value="all">Dynatrace: hepsi</option>
          {(Object.keys(ISTEK) as (keyof typeof ISTEK)[]).map((k) => (
            <option key={k} value={k}>
              {ISTEK[k].label}
            </option>
          ))}
        </select>
        <select
          aria-label="Intranet sunucu kurulumuna göre süz"
          value={kurulum}
          onChange={(e) => setKurulum(e.target.value as KurulumSuzgec)}
          className={SELECT}
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
        >
          <option value="all">kurulum: hepsi</option>
          {(Object.keys(KURULUM) as (keyof typeof KURULUM)[]).map((k) => (
            <option key={k} value={k}>
              kurulum: {KURULUM[k].label}
            </option>
          ))}
        </select>
        <select
          aria-label="Beyana göre süz"
          value={beyan}
          onChange={(e) => setBeyan(e.target.value as BeyanSuzgec)}
          className={SELECT}
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
        >
          <option value="all">beyan: hepsi</option>
          <option value="bekleyen">beyan: BEKLEYEN</option>
          <option value="verilmis">beyan: verilmiş</option>
          <option value="yes">beyan: kullanıyor</option>
          <option value="no">beyan: kullanmıyor</option>
          <option value="unknown">beyan: bilmiyor</option>
        </select>
        <select
          aria-label="Değerlendirmeye göre süz"
          value={deg}
          onChange={(e) => setDeg(e.target.value as DegSuzgec)}
          className={SELECT}
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
        >
          <option value="all">değerlendirme: hepsi</option>
          {(Object.keys(DEGERLENDIRME) as (keyof typeof DEGERLENDIRME)[]).map((k) => (
            <option key={k} value={k}>
              {DEGERLENDIRME[k].label}
            </option>
          ))}
        </select>
        <select
          aria-label="Ekibe göre süz"
          value={ekip}
          onChange={(e) => setEkip(e.target.value)}
          className={SELECT}
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
        >
          <option value="all">ekip: hepsi ({ekipler.length})</option>
          {ekipler.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
          <option value="-">ekip: bilinmiyor</option>
        </select>
        <input
          type="search"
          aria-label="Uygulama ara"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="uygulama, namespace, route, cluster ya da ekip ara"
          className="px-2.5 py-1.5 text-xs border rounded-lg w-72 max-w-full"
          style={{ borderColor: 'var(--border)' }}
        />
        <button
          type="button"
          onClick={csvIndir}
          disabled={!satirlar.length}
          title="Ekranda görünen satırları CSV olarak indirir."
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg disabled:opacity-50"
          style={{ borderColor: 'var(--border)' }}
        >
          <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV ({satirlar.length})
        </button>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {satirlar.length} uygulama
        </span>
      </div>

      <div className="overflow-auto rounded-xl border" style={{ borderColor: 'var(--border-subtle)' }}>
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th className="text-left px-2 py-1.5">Ekip Beyanı</th>
              <th className="text-left px-2 py-1.5">Uygulama</th>
              <th className="text-left px-2 py-1.5">Ekip</th>
              <th className="text-left px-2 py-1.5">Dynatrace</th>
              <th className="text-left px-2 py-1.5">Intranet sunucu kurulumu</th>
              <th className="text-left px-2 py-1.5">Route / cluster</th>
              <th className="text-left px-2 py-1.5">Değerlendirme</th>
              <th className="text-left px-2 py-1.5">Açıklama</th>
              <th className="text-left px-2 py-1.5">Beyan Eden</th>
            </tr>
          </thead>
          <tbody>
            {satirlar.map((r) => {
              const k = anahtar(r);
              const ac = acik.has(k);
              return (
                <Fragment key={k}>
                  <tr className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-2 py-1">
                      <select
                        aria-label={`${r.application} ekip beyanı`}
                        value={r.inUse || ''}
                        disabled={kayit === k}
                        onChange={(e) => beyanYaz(r, e.target.value || null, r.note)}
                        className="px-1.5 py-1 text-[11px] border rounded-lg"
                        style={{
                          borderColor: 'var(--border)',
                          color: r.inUse ? BEYAN_RENK[r.inUse] : undefined,
                          background: 'var(--bg-surface)',
                        }}
                        title={r.inUse ? `Beyan: ${BEYAN_ETIKET[r.inUse]} — bu bir ÖLÇÜM DEĞİL.` : 'Ekip beyan girmemiş.'}
                      >
                        <option value="">— beyan yok —</option>
                        <option value="yes">kullanıyor</option>
                        <option value="no">kullanmıyor</option>
                        <option value="unknown">bilmiyor</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <div className="font-mono" style={{ color: 'var(--text-primary)' }}>
                        {r.application}
                      </div>
                      <div className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {r.namespace} · {r.env}
                      </div>
                    </td>
                    <td className="px-2 py-1" style={{ color: r.ekip.length ? undefined : 'var(--text-muted)' }}>
                      {r.ekip.length ? r.ekip.join(', ') : 'bilinmiyor'}
                      {r.ekipEposta.length > 0 && (
                        <div className="text-[11px]">
                          {r.ekipEposta.map((m) => (
                            <a key={m} href={`mailto:${m}`} className="mr-1 break-all">
                              {m}
                            </a>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <IstekHucre r={r} />
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      <Pill tone={KURULUM[r.kurulum.durum]?.tone || 'neutral'} title={KURULUM[r.kurulum.durum]?.hint}>
                        {kurulumMetni(r.kurulum)}
                      </Pill>
                      {r.kurulum.eksik.length > 0 && r.kurulum.durum === 'kismi' && (
                        <div className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--status-danger-text)' }}>
                          eksik: {r.kurulum.eksik.join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        aria-expanded={ac}
                        onClick={() =>
                          setAcik((s) => {
                            const n = new Set(s);
                            if (n.has(k)) n.delete(k);
                            else n.add(k);
                            return n;
                          })
                        }
                        className="inline-flex items-start gap-1 text-[11px] text-left underline-offset-2 hover:underline"
                        title="Route adresleri, cluster’lar ve Dynatrace ayrıntısı"
                      >
                        {ac ? <ChevronDownIcon className="w-3 h-3 mt-0.5" /> : <ChevronRightIcon className="w-3 h-3 mt-0.5" />}
                        <span>
                          <span className="font-mono break-all">{r.adresler[0] || r.application}</span>
                          {r.adresler.length > 1 && <span> +{r.adresler.length - 1}</span>}
                          <span className="block" style={{ color: 'var(--text-muted)' }}>
                            {r.clusters.length} cluster
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex flex-wrap gap-1">
                        {r.degerlendirme.map((d) => (
                          <Pill key={d} tone={DEGERLENDIRME[d]?.tone || 'neutral'} title={DEGERLENDIRME[d]?.hint}>
                            {DEGERLENDIRME[d]?.label || d}
                          </Pill>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-1 min-w-[10rem]">
                      <input
                        aria-label={`${r.application} açıklama`}
                        defaultValue={r.note}
                        key={`${k}|${r.note}`}
                        disabled={kayit === k}
                        onBlur={(e) => {
                          if (e.target.value !== r.note) beyanYaz(r, r.inUse, e.target.value);
                        }}
                        placeholder="ör. kim kullanıyor, ne zaman kapatılabilir"
                        className="px-1.5 py-1 text-[11px] border rounded-lg w-full"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      />
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {r.inUseBy ? (
                        <span title={r.inUseAt ? `Tarih: ${tarihMetni(r.inUseAt)}` : 'Tarih kaydı yok.'}>
                          {r.inUseBy}
                          {r.inUseAt && (
                            <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                              {tarihMetni(r.inUseAt)}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                  </tr>
                  {ac && (
                    <tr style={{ background: 'var(--bg-elevated)' }}>
                      <td colSpan={9} className="px-3 py-2">
                        <Ayrinti r={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!satirlar.length && !yukleniyor && (
              <tr>
                <td colSpan={9} className="px-2 py-3" style={{ color: 'var(--text-muted)' }}>
                  {rows.length ? 'Bu süzgeçlerle uygulama yok.' : 'Listelenecek intranet SPA yok.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <details className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        <summary className="cursor-pointer select-none">Bu rapor neyi gösteriyor?</summary>
        <div className="mt-1 space-y-1 max-w-3xl">
          <p>
            Liste Nginx Hub › Gerçek SPA Keşfi ile aynı hesaptan gelir: route’unun ardındaki pod’da
            nginx bulunan (SPA) ve route’u intranet (reencrypt) olan uygulamalar. Hem intranet hem
            internet route’u olanlar “internet route’u da var” etiketiyle listededir.
          </p>
          <p>
            Dynatrace sütunu her gece koşan kullanım işinin (application_usage) uygulamanın Dynatrace
            servislerinde saydığı istektir; cluster’lar toplanır. “İstek almıyor” yalnızca her cluster
            ölçülmüşken yazılır. “Dynatrace servisi yok”, “ölçülemedi” ve “ölçüm yok” <b>istek almıyor
            değildir</b>: Dynatrace bu uygulamayı sayamamıştır.
          </p>
          <p>
            Intranet sunucu kurulumu, nginx_config_audit işinin intranet sunucularındaki dizin
            taramasından gelir: uygulamanın kendi ortamının her intranet sunucusunda paket
            (/hysdeploy), uygulama dosyaları (/usr/nginx/applications) ve conf (application-confs)
            var mı. Son taramada olmayan sunucu “eksik” sayılmaz, ayrıca yazılır.
          </p>
          <p>
            Değerlendirme ölçümle beyanı yan yana okur: “kapatma adayı” = istek yok ve ekip
            “kullanmıyor” dedi; “çelişki” = istek var ama ekip “kullanmıyor” dedi.
          </p>
        </div>
      </details>
    </div>
  );
}
