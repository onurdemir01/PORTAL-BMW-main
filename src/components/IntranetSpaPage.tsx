// src/components/IntranetSpaPage.tsx — Nginx ARK SPA > Intranet SPA (/ark-spa/intranet-spa).
//
// Kullanıcı (2026-10-19): "Şimdi Intranet SPA'lere başlıyorum, bunlar yük alıyor mu almıyor mu
// kullanılıyor mu vb rapor görebilmek istiyorum. Ve yine insanlardan kullanım durumu hakkında bilgi
// girişi almak istiyorum."
//
// SATIR = (ortam, namespace, uygulama); intranet nginx sunucularının dizin taramasından. İKİ SÜTUN,
// İKİ AYRI ŞEY (SPA Raporu ile aynı): "Yük durumu" access log'dan ÖLÇÜLÜR, "Ekip beyanı" ekibin
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
import { kismiAciklama } from '@/components/denetim/yukPencere';
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
  durumEtiketi,
  intranetCsvSatirlari,
  suzIntranet,
  sunucuYukMetni,
  yukMetni,
  type BeyanSuzgec,
  type DegSuzgec,
  type YukSuzgec,
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

/** Yük hücresi. ÜÇ DURUM: ölçülemedi ile "yük yok" AYNI ŞEY DEĞİL. */
function YukHucre({ r }: { r: IntranetSatir }) {
  const t = r.yuk;
  if (!t)
    return (
      <span
        style={{ color: 'var(--text-muted)' }}
        title="Bu uygulama için ölçüm yok (uygulama bazlı log ölçümü üretilmemiş ya da hiçbir sunucuda conf yok) — “yük almıyor” DEMEK DEĞİL."
      >
        ölçüm yok
      </span>
    );
  if (t.state === 'active')
    return (
      <span
        style={{ color: 'var(--status-success)', fontWeight: 600 }}
        title={`7 günde ${t.req7} istek, 24 saatte ${t.req24 ?? 0} (sağlık kontrolü hariç; ${t.hosts} sunucu toplamı)${t.lastSeen ? ` · son istek ${t.lastSeen}` : ''}`}
      >
        yük alıyor · {t.req7}
      </span>
    );
  if (t.state === 'idle')
    return (
      <span
        style={{ color: 'var(--text-secondary)' }}
        title="Access log okundu; 7 günün tamamına ve uygulamayı sunan her sunucuya bakıldı, sağlık kontrolü dışında istek yok."
      >
        yük almıyor
      </span>
    );
  return (
    <span
      style={{ color: 'var(--status-warning-text)' }}
      title={
        t.hosts === 0
          ? 'Hiçbir sunucuda ölçülemedi (ayrıntı için satırı açın) — “yük almıyor” demek değil.'
          : kismiAciklama(t)
      }
    >
      {yukMetni(r)}
    </span>
  );
}

function SunucuAyrinti({ r }: { r: IntranetSatir }) {
  return (
    <div className="overflow-x-auto">
      <table className="text-[11px] w-full">
        <thead>
          <tr style={{ color: 'var(--text-muted)' }}>
            <th className="text-left px-2 py-1 font-semibold">Sunucu</th>
            <th className="text-left px-2 py-1 font-semibold">Lokasyon</th>
            <th className="text-left px-2 py-1 font-semibold">Kurulum</th>
            <th className="text-left px-2 py-1 font-semibold">Paket / Dosyalar / Conf</th>
            <th className="text-left px-2 py-1 font-semibold">Yük (bu sunucu)</th>
            <th className="text-left px-2 py-1 font-semibold">Son istek</th>
          </tr>
        </thead>
        <tbody>
          {r.sunucular.map((s) => (
            <tr key={s.host} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <td className="px-2 py-1 font-mono">{s.host}</td>
              <td className="px-2 py-1">{s.site || '—'}</td>
              <td
                className="px-2 py-1"
                style={{ color: s.status === 'OK' ? 'var(--status-success)' : 'var(--status-warning-text)' }}
              >
                {durumEtiketi(s.status)}
              </td>
              <td className="px-2 py-1 font-mono" title="/hysdeploy · /usr/nginx/applications · application-confs">
                {[s.hys, s.app, s.conf].map((v) => (v ? '✓' : '✗')).join(' ')}
              </td>
              <td className="px-2 py-1">{sunucuYukMetni(s)}</td>
              <td className="px-2 py-1 font-mono">{s.trafik?.son || '—'}</td>
            </tr>
          ))}
          {r.eksikSunucular.map((h) => (
            <tr key={h} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <td className="px-2 py-1 font-mono">{h}</td>
              <td className="px-2 py-1" colSpan={5} style={{ color: 'var(--status-warning-text)' }}>
                bu sunucuda uygulama yok (ortamın diğer sunucularında var)
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function IntranetSpaPage() {
  const [data, setData] = useState<IntranetRapor | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [env, setEnv] = useState<string | null>(null);
  const [yuk, setYuk] = useState<YukSuzgec>('all');
  const [beyan, setBeyan] = useState<BeyanSuzgec>('all');
  const [deg, setDeg] = useState<DegSuzgec>('all');
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
    () => suzIntranet(rows, { env: secilenEnv, yuk, beyan, deg, ekip, q }),
    [rows, secilenEnv, yuk, beyan, deg, ekip, q],
  );
  const ozet = useMemo(() => {
    const rs = rows.filter((r) => secilenEnv === 'all' || r.env === secilenEnv);
    const say = (f: (r: IntranetSatir) => boolean) => rs.filter(f).length;
    return {
      uygulama: rs.length,
      active: say((r) => r.yuk?.state === 'active'),
      idle: say((r) => r.yuk?.state === 'idle'),
      unknown: say((r) => r.yuk?.state === 'unknown'),
      none: say((r) => !r.yuk),
      bekleyen: say((r) => !r.inUse),
      aday: say((r) => r.degerlendirme.includes('kapatma-adayi')),
      celiski: say((r) => r.degerlendirme.includes('celiski')),
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
      // AYNI UYGULAMA BAŞKA ORTAM SATIRINDA DA DURUYORSA (aynı ns/app iki ortamın sunucusunda) o da
      // aynı beyanı gösterir: beyan uygulama seviyesindedir.
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

  const kutu = (
    etiket: string,
    sayi: number,
    aktif: boolean,
    tikla: () => void,
    renk?: string,
    ipucu?: string,
  ) => (
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
  const yukKutu = (v: YukSuzgec) => () => setYuk((x) => (x === v ? 'all' : v));
  const degKutu = (v: DegSuzgec) => () => setDeg((x) => (x === v ? 'all' : v));

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-start gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Intranet SPA</h1>
          <p className="text-[12px] max-w-3xl" style={{ color: 'var(--text-secondary)' }}>
            Intranet nginx sunucularına kurulu SPA uygulamaları. <b>Yük durumu</b> sunucuların access
            log’undan ölçülür; <b>Ekip beyanı</b> sizin ifadenizdir. İkisi çelişebilir — ayda bir
            kullanılan bir ekran ölçümde “yük almıyor” görünür ama siz kullanıyor olabilirsiniz. Beyan,
            SPA Raporu ile aynı uygulama kaydına yazılır.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {data?.dizinTarihi && (
            <GuncellemeRozeti etiket="dizin taraması" tarih={data.dizinTarihi} />
          )}
          {data?.trafikTarihi && <GuncellemeRozeti etiket="yük ölçümü" tarih={data.trafikTarihi} />}
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
          Intranet sunucularının dizin taraması henüz yok (nginx_config_audit job’ı koşmalı). Bu “SPA
          yok” demek değildir.
        </div>
      )}
      {data?.ok && !data.notScanned && (data.trafikTablo !== 'var' || data.hostKipi === false) && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border"
          style={{ color: 'var(--status-warning-text)', borderColor: 'var(--status-warning)' }}
        >
          {data.trafikTablo === 'yok'
            ? 'Yük ölçümü tablosu (Nginx_Spa_Traffic) yok: yük sütunu “ölçüm yok” gösterir.'
            : data.trafikTablo === 'okunamadi'
              ? 'Yük ölçümü okunamadı: yük sütunu “ölçüm yok” gösterir — bu “yük almıyor” demek değildir.'
              : 'Son yük ölçümünde uygulama bazlı (host kipi) satır yok: SPA yük ölçümü işi intranet sunucularında koşmalı.'}
        </div>
      )}
      {!!data?.taranmayan?.length && !data.notScanned && (
        <div className="text-[11px]" style={{ color: 'var(--status-warning-text)' }}>
          Son dizin taramasında satırı olmayan intranet sunucuları: {data.taranmayan.join(', ')} — bu
          sunuculardaki uygulamalar listede yok.
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
            setYuk('all');
            setDeg('all');
            setBeyan('all');
          }, undefined, 'Süzgeçleri temizler')}
          {kutu('yük alıyor', ozet.active, yuk === 'active', yukKutu('active'), 'var(--status-success)')}
          {kutu('yük almıyor', ozet.idle, yuk === 'idle', yukKutu('idle'), undefined, '7 günün tamamı ve her sunucu ölçüldü, istek yok')}
          {kutu('ölçülemedi', ozet.unknown, yuk === 'unknown', yukKutu('unknown'), 'var(--status-warning-text)')}
          {kutu('ölçüm yok', ozet.none, yuk === 'none', yukKutu('none'))}
          {kutu('beyan bekleyen', ozet.bekleyen, beyan === 'bekleyen', () => setBeyan((x) => (x === 'bekleyen' ? 'all' : 'bekleyen')))}
          {kutu('kapatma adayı', ozet.aday, deg === 'kapatma-adayi', degKutu('kapatma-adayi'), 'var(--status-danger-text)', DEGERLENDIRME['kapatma-adayi'].hint)}
          {kutu('çelişki', ozet.celiski, deg === 'celiski', degKutu('celiski'), 'var(--status-warning-text)', DEGERLENDIRME.celiski.hint)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Yük durumuna göre süz"
          value={yuk}
          onChange={(e) => setYuk(e.target.value as YukSuzgec)}
          className={SELECT}
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
        >
          <option value="all">yük: hepsi</option>
          <option value="active">yük alıyor</option>
          <option value="idle">yük almıyor</option>
          <option value="unknown">ölçülemedi (7 gün ölçülemeyen “istek yok” dahil)</option>
          <option value="none">ölçüm yok</option>
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
          placeholder="uygulama, namespace, ekip ya da sunucu ara"
          className="px-2.5 py-1.5 text-xs border rounded-lg w-64 max-w-full"
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
              <th className="text-left px-2 py-1.5">Yük Durumu</th>
              <th className="text-left px-2 py-1.5">Sunucular</th>
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
                      <YukHucre r={r} />
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
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
                        className="inline-flex items-center gap-1 text-[11px] underline-offset-2 hover:underline"
                        title="Sunucu başına kurulum ve yük"
                      >
                        {ac ? <ChevronDownIcon className="w-3 h-3" /> : <ChevronRightIcon className="w-3 h-3" />}
                        <span className="tabular-nums">
                          {r.tamSunucu}/{r.beklenen}
                        </span>{' '}
                        tam kurulu
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
                      <td colSpan={8} className="px-3 py-2">
                        <SunucuAyrinti r={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!satirlar.length && !yukleniyor && (
              <tr>
                <td colSpan={8} className="px-2 py-3" style={{ color: 'var(--text-muted)' }}>
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
            Kaynak: intranet nginx sunucularının dizin taraması (/hysdeploy, /usr/nginx/applications,
            application-confs). Satır, ortam + namespace + uygulama başınadır; aynı uygulamanın mirror
            sunucuları tek satırda toplanır, “Sunucular” sütunundan açılır.
          </p>
          <p>
            Yük, uygulamayı sunan (conf’u olan) her sunucunun ortak access log’unda Host başlığına göre
            sayılır ve sunucular toplanır. “Yük almıyor” yalnızca 7 günün tamamı ve her sunucu
            ölçülmüşken yazılır; “son 3 günde istek yok (7 gün ölçülemedi)” ya da “sunucuda sahipsiz
            istek var” satırları <b>yük almıyor değildir</b>.
          </p>
          <p>
            Değerlendirme ölçümle beyanı yan yana okur: “kapatma adayı” = yük yok ve ekip “kullanmıyor”
            dedi; “çelişki” = yük var ama ekip “kullanmıyor” dedi.
          </p>
        </div>
      </details>
    </div>
  );
}
