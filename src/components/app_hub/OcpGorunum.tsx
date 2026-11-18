// src/components/app_hub/OcpGorunum.tsx — Application Hub: OpenShift uygulaması.
//
// Envanter yalnız cluster / namespace / ad tutar. Tür (Deployment mı Argo Rollout mu), replika,
// pod sayısı, imaj, kaynak, JVM env'leri ve pod'ların node'ları iki yoldan gelir:
//   * saatlik tarama (2026-11-18): Portal saatte bir tüm cluster'ları salt okunur tarar (filo-poller);
//   * "Canlı oku": o anki durum için tek uygulamalık salt okunur AWX işi.
// (cluster, namespace) başına hangisi daha yeniyse o gösterilir; kartta kaynağı ve zamanı yazar.
import React, { useEffect, useRef, useState } from 'react';
import { ArrowPathIcon, ArrowTopRightOnSquareIcon, BoltIcon } from '@heroicons/react/24/outline';
import { appHubApi, type OcpCanliOkuma, type OcpDetay, type OcpYer } from '@/api/appHubApi';
import Button from '@/components/common/Button';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { toast } from '@/hooks/useToast';
import { fmtDateTime, fmtNumber, fmtRelative } from '@/utils/datetime';
import { Bolum, Hap, JvmArglari, KaynakUyarisi, OzetKutusu, TD, TH } from './ortak';

const KAYNAK_AD: Record<string, string> = {
  envanter: 'OpenShift envanteri (Openshift_Inventory)',
  clusterKatalogu: 'Portal cluster kataloğu',
  route: 'Route envanteri',
  kullanim: 'Dynatrace kullanım verisi',
};

const anahtar = (c: string, n: string) => `${c.toLowerCase()}|${n.toLowerCase()}`;

const kaynakAdi = (o: OcpCanliOkuma) => (o.kaynak === 'saatlik' ? 'saatlik tarama' : 'canlı okuma');

/** Pod sayısı: hazır / toplam; okunamadıysa null (0 DEĞİL). Eski canlı okumada podOzet yoksa listeden sayılır. */
export function podSayisi(o?: OcpCanliOkuma): { hazir: number; toplam: number } | null {
  if (!o || !o.ok) return null;
  if (o.podOzet) {
    if (o.podOzet.okunamadi || o.podOzet.toplam == null) return null;
    return { hazir: o.podOzet.hazir ?? 0, toplam: o.podOzet.toplam };
  }
  // Eski kayıt (podOzet yok): pod listesi okunamadıysa sayı yok; liste en çok 200 olduğu için tam sayı da değil.
  if (!o.podlar || (o.hatalar || []).some((h) => /pod listesi okunamadi/i.test(h))) return null;
  const hazir = o.podlar.filter((p) => {
    const [r, t] = String(p.hazir || '').split('/').map(Number);
    return p.faz === 'Running' && t > 0 && r === t;
  }).length;
  return { hazir, toplam: o.podlar.length };
}

/** Okumaları birleştirir: (cluster, namespace) başına daha yeni olan kalır. */
export function okumaBirlestir(eski: OcpCanliOkuma[], yeni: OcpCanliOkuma[]): OcpCanliOkuma[] {
  const ix = new Map<string, OcpCanliOkuma>();
  const dahaIyi = (a: OcpCanliOkuma, b: OcpCanliOkuma) => (a.ok !== b.ok ? a.ok : (a.alinma || '') > (b.alinma || ''));
  for (const o of [...eski, ...yeni.map((x) => ({ ...x, kaynak: x.kaynak || ('canli' as const) }))]) {
    const k = anahtar(o.cluster, o.namespace);
    const v = ix.get(k);
    if (!v) {
      ix.set(k, o);
      continue;
    }
    const [kazanan, kaybeden] = dahaIyi(o, v) ? [o, v] : [v, o];
    // Daha yeni ama başarısız okuma geçerli veriyi gizlemez; kartta uyarı olarak kalır.
    const yeniHata = !kaybeden.ok && (kaybeden.alinma || '') > (kazanan.alinma || '');
    ix.set(k, yeniHata ? { ...kazanan, sonOkumaHatasi: kaybeden.hata || 'okunamadı' } : kazanan);
  }
  return [...ix.values()];
}

/** Cluster başına pod dağılımı (aynı cluster'daki namespace'ler toplanır). */
export function clusterPodlari(okumalar: OcpCanliOkuma[]) {
  const m = new Map<string, { cluster: string; hazir: number; toplam: number; olculemeyen: number }>();
  for (const o of okumalar) {
    const k = o.cluster.toLowerCase();
    const g = m.get(k) || { cluster: o.cluster, hazir: 0, toplam: 0, olculemeyen: 0 };
    const p = podSayisi(o);
    if (p) {
      g.hazir += p.hazir;
      g.toplam += p.toplam;
    } else g.olculemeyen++;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => a.cluster.localeCompare(b.cluster));
}

/** Aynı adda Deployment (workloadRef, 0'a ölçekli) + Rollout varsa replikası olan nesne gösterilir. */
function anaNesne(o?: OcpCanliOkuma) {
  return (o?.nesneler || []).reduce<NonNullable<OcpCanliOkuma['nesneler']>[number] | null>(
    (a, n) => (!a || (n.istenen || 0) > (a.istenen || 0) ? n : a),
    null,
  );
}

function turOzeti(y: OcpYer, canli?: OcpCanliOkuma) {
  const n = anaNesne(canli);
  if (n && canli) return { tur: n.tur, replika: `${n.hazir ?? 0} / ${n.istenen ?? 0}`, kaynak: kaynakAdi(canli) };
  const c = y.onbellek?.kayitlar?.[0];
  if (c && c.kind && c.kind !== 'Unknown') return { tur: c.kind, replika: c.replicas == null ? '?' : String(c.replicas), kaynak: 'önbellek' as const };
  return null;
}

function CanliKart({ o }: { o: OcpCanliOkuma }) {
  const pod = podSayisi(o);
  const kisaltildi = !!o.podOzet && o.podOzet.toplam != null && o.podOzet.listelenen < o.podOzet.toplam;
  return (
    <div className="rounded p-3 space-y-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{o.cluster} / {o.namespace}</strong>
        {o.ok ? <Hap ton="iyi">okundu</Hap> : <Hap ton="kritik">okunamadı</Hap>}
        <Hap ton="notr" title={o.kaynak === 'saatlik' ? "Portal saatte bir tüm cluster'ları salt okunur tarar." : 'Elle başlatılan "Canlı oku" işi.'}>
          {kaynakAdi(o)}
        </Hap>
        {o.alinma && (
          <span style={{ color: 'var(--text-muted)' }} title={fmtDateTime(o.alinma)}>
            {fmtRelative(o.alinma)}{o.alanAd ? ` · ${o.alanAd}` : ''}{o.isNo ? ` · AWX #${o.isNo}` : ''}
          </span>
        )}
        {pod && (
          <span className="tabular-nums" style={{ color: 'var(--text-secondary)' }} data-testid="kart-pod">
            <strong>{pod.toplam}</strong> pod · {pod.hazir} hazır
          </span>
        )}
        {!pod && o.ok && <span style={{ color: 'var(--text-muted)' }}>pod sayısı ölçülemedi</span>}
      </div>
      {o.sonOkumaHatasi && (
        <p className="text-[12px]" style={{ color: 'var(--status-warning-text)' }}>
          Daha yeni bir okuma başarısız oldu ({o.sonOkumaHatasi}); gösterilen veri {o.alinma ? fmtRelative(o.alinma) : 'daha önce'} alındı.
        </p>
      )}
      {o.sonTaramaHatasi && (
        <p className="text-[12px]" style={{ color: 'var(--status-warning-text)' }}>
          Bu cluster son saatlik taramada okunamadı ({o.sonTaramaHatasi}); gösterilen veri {o.alinma ? fmtRelative(o.alinma) : 'daha eski bir taramadan'} alındı.
        </p>
      )}
      {o.hata && <p className="text-[12px]" style={{ color: 'var(--status-danger)' }}>{o.hata}</p>}
      {(o.notlar || []).map((n) => (
        <p key={n} className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{n}</p>
      ))}
      {(o.nesneler || []).map((n) => (
        <div key={`${n.kind}-${n.ad}`} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Hap ton={n.kind === 'Rollout' ? 'uyari' : 'bilgi'}>{n.tur}</Hap>
            <span className="text-[13px] tabular-nums" style={{ color: 'var(--text-primary)' }}>
              replika <strong>{n.hazir ?? 0} / {n.istenen ?? 0}</strong> hazır
              {n.mevcut != null && ` · ${n.mevcut} kullanılabilir`}
            </span>
            {n.strateji && <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>strateji {n.strateji}</span>}
            {n.gitops && <Hap ton="notr" title="Argo CD tarafından yönetiliyor: elle yapılan değişiklik geri alınabilir">GitOps {n.gitops}</Hap>}
          </div>
          {n.containerlar.map((c) => (
            <div key={c.ad} className="rounded p-2 space-y-2" style={{ background: 'var(--bg-inset)' }}>
              <div className="text-[12px] flex flex-wrap gap-x-4 gap-y-1" style={{ color: 'var(--text-secondary)' }}>
                <span>container <strong style={{ fontFamily: 'var(--font-mono)' }}>{c.ad}</strong></span>
                <span className="break-all" style={{ fontFamily: 'var(--font-mono)' }}>{c.imaj || '—'}</span>
                <span className="tabular-nums">istek {c.istek.cpu || '—'} CPU · {c.istek.bellek || '—'}</span>
                <span className="tabular-nums">limit {c.limit.cpu || '—'} CPU · {c.limit.bellek || '—'}</span>
              </div>
              {c.jvmEnv.length ? (
                c.jvmEnv.map((e) =>
                  e.kaynak === 'referans' ? (
                    <p key={e.ad} className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                      <code style={{ fontFamily: 'var(--font-mono)' }}>{e.ad}</code> değeri {e.deger} üzerinden geliyor (değer okunmaz).
                    </p>
                  ) : (
                    <JvmArglari key={e.ad} baslik={e.ad} args={e.deger} bosMetin={`${e.ad} boş.`} />
                  ),
                )
              ) : (
                <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  JVM ortam değişkeni (JAVA_OPTS, JAVA_TOOL_OPTIONS, JDK_JAVA_OPTIONS…) tanımlı değil; JVM imajın varsayılanlarıyla çalışıyor olabilir.
                </p>
              )}
            </div>
          ))}
        </div>
      ))}
      {(o.hpa || []).map((h) => (
        <p key={h.ad} className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
          HPA <strong>{h.ad}</strong>: {h.min ?? '?'} – {h.max ?? '?'} replika, şu an {h.guncel ?? '?'}
        </p>
      ))}
      {(o.podlar || []).length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ color: 'var(--text-secondary)' }}>
                <th className={TH}>Pod</th>
                <th className={TH}>Durum</th>
                <th className={TH}>Hazır</th>
                <th className={TH}>Restart</th>
                <th className={TH}>Node</th>
                <th className={TH}>Başlama</th>
              </tr>
            </thead>
            <tbody>
              {(o.podlar || []).map((p) => (
                <tr key={p.ad} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td className="px-3 py-1.5 break-all" style={{ fontFamily: 'var(--font-mono)' }}>{p.ad}</td>
                  <td className="px-3 py-1.5">
                    <Hap ton={p.faz === 'Running' ? 'iyi' : p.faz === 'Pending' ? 'uyari' : 'kritik'}>{p.faz || '?'}</Hap>
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">{p.hazir || '—'}</td>
                  <td className="px-3 py-1.5 tabular-nums" style={{ color: (p.restart || 0) > 5 ? 'var(--status-danger)' : undefined }}>{p.restart ?? '—'}</td>
                  <td className="px-3 py-1.5" style={{ fontFamily: 'var(--font-mono)' }}>{p.node || '—'}</td>
                  <td className="px-3 py-1.5" title={p.baslama ? fmtDateTime(p.baslama) : undefined}>{p.baslama ? fmtRelative(p.baslama) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {kisaltildi && (
        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          Listede ilk {o.podOzet?.listelenen} pod var; sayı ve node dağılımı tüm {o.podOzet?.toplam} pod'dan.
        </p>
      )}
      {(o.nodelar || []).length > 0 && (
        <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
          Node'lar: {(o.nodelar || []).map((n) => `${n.ad} (${n.pod})`).join(', ')}
        </p>
      )}
    </div>
  );
}

export default function OcpGorunum({ d, onYenile }: { d: OcpDetay; onYenile: () => void }) {
  const ilk = Array.isArray(d.canli) ? d.canli : [];
  const [okumalar, setOkumalar] = useState<OcpCanliOkuma[]>(ilk);
  const [is, setIs] = useState<{ serverId: number; jobId: number; durum: string } | null>(null);
  const yasiyor = useRef(true);
  useEffect(
    () => () => {
      yasiyor.current = false;
    },
    [],
  );
  const canliHata = !Array.isArray(d.canli) ? d.canli.hata : null;
  const canliIx = new Map(okumalar.map((o) => [anahtar(o.cluster, o.namespace), o]));

  const izle = async (serverId: number, jobId: number) => {
    for (let i = 0; i < 120 && yasiyor.current; i++) {
      await new Promise((r) => setTimeout(r, i < 5 ? 3000 : 5000));
      if (!yasiyor.current) return;
      try {
        const r = await appHubApi.ocpCanliDurum(serverId, jobId, d.ad);
        if (!yasiyor.current) return;
        if (!r.finished) {
          setIs({ serverId, jobId, durum: r.status });
          continue;
        }
        setIs(null);
        if (r.okumalar) {
          const yeni = r.okumalar;
          setOkumalar((eski) => okumaBirlestir(eski, yeni));
        }
        if (r.error) toast.error(r.error, 8000);
        else if (r.genel === 'ok') toast.success('Canlı okuma tamamlandı.');
        else toast.warning('Canlı okuma kısmen tamamlandı; okunamayan hedefler kartlarda yazıyor.', 8000);
        return;
      } catch (e) {
        if (!yasiyor.current) return;
        setIs(null);
        toast.error((e as Error).message, 8000);
        return;
      }
    }
    if (yasiyor.current) {
      setIs(null);
      toast.warning('Canlı okuma 10 dakikada bitmedi; AWX işini kontrol edin.', 8000);
    }
  };

  const baslat = async () => {
    if (is) return;
    try {
      const r = await appHubApi.ocpCanliBaslat(d.ad);
      setIs({ serverId: r.serverId, jobId: r.jobId, durum: 'pending' });
      toast.info(`Canlı okuma başladı (AWX #${r.jobId}, ${r.hedefler.length} hedef)${r.atlanan.length ? `; bastion'ı tanımsız: ${r.atlanan.join(', ')}` : ''}.`, 6000);
      void izle(r.serverId, r.jobId);
    } catch (e) {
      toast.error((e as Error).message, 9000);
    }
  };

  const sonOkuma = okumalar.reduce<string | null>((a, o) => (!a || (o.alinma && o.alinma > a) ? o.alinma : a), null);
  const dagilim = clusterPodlari(okumalar);
  const podToplam = dagilim.reduce(
    (a, g) => ({ hazir: a.hazir + g.hazir, toplam: a.toplam + g.toplam, olculemeyen: a.olculemeyen + g.olculemeyen }),
    { hazir: 0, toplam: 0, olculemeyen: 0 },
  );
  const sk = d.filo?.sonKosu || null;
  const filoSorunlu = !!sk && (sk.durum === 'HATA' || sk.okSayisi < sk.clusterSayisi || !sk.clusterSayisi);
  let filoMetni = `Saatlik tarama henüz koşmadı (her ${d.filo?.aralikDk ?? 60} dakikada bir; AWX şablonu tanımlı olmalı).`;
  if (sk && (sk.durum === 'HATA' || !sk.clusterSayisi)) {
    filoMetni = `Son saatlik tarama başarısız (${sk.bitis ? fmtRelative(sk.bitis) : '—'})${sk.hata ? `: ${sk.hata}` : ''}. Gösterilen veri daha eski taramalardan.`;
  } else if (sk) {
    filoMetni = `Saatlik tarama: son koşu ${sk.bitis ? fmtRelative(sk.bitis) : '—'} · ${sk.okSayisi}/${sk.clusterSayisi} cluster okundu${sk.hata ? ` · ${sk.hata}` : ''}`;
  }

  return (
    <div className="space-y-4">
      <KaynakUyarisi kaynaklar={d.kaynaklar} adlar={KAYNAK_AD} />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <OzetKutusu etiket="Cluster" deger={d.ozet.clusterSayisi} alt={d.ozet.ortamlar.join(' · ') || undefined} />
        <OzetKutusu etiket="Namespace" deger={d.ozet.namespaceSayisi} />
        <OzetKutusu etiket="Route" deger={d.ozet.routeSayisi} />
        <OzetKutusu
          etiket="Pod (hazır / toplam)"
          deger={podToplam.toplam || podToplam.hazir ? `${podToplam.hazir} / ${podToplam.toplam}` : dagilim.length && !podToplam.olculemeyen ? '0 / 0' : '—'}
          alt={podToplam.olculemeyen ? `${podToplam.olculemeyen} yerde ölçülemedi` : `${dagilim.length} cluster`}
        />
        <OzetKutusu etiket="Son veri" deger={sonOkuma ? fmtRelative(sonOkuma) : 'yok'} alt={sonOkuma ? fmtDateTime(sonOkuma) : 'saatlik tarama ya da "Canlı oku"'} />
      </div>
      <p className="text-[12px]" style={{ color: filoSorunlu ? 'var(--status-warning-text)' : 'var(--text-muted)' }} data-testid="filo-durumu">
        {filoMetni}
      </p>
      {dagilim.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]" data-testid="cluster-pod-dagilimi">
          <span style={{ color: 'var(--text-secondary)' }}>Cluster başına pod:</span>
          {dagilim.map((g) => {
            const tamam = !g.olculemeyen && g.toplam > 0 && g.hazir === g.toplam;
            return (
              <Hap key={g.cluster} ton={tamam ? 'iyi' : g.toplam || g.olculemeyen ? 'uyari' : 'notr'}>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{g.cluster}</span>{' '}
                <span className="tabular-nums">
                  {g.toplam} pod{g.toplam ? ` · ${g.hazir} hazır` : ''}
                  {g.olculemeyen ? ` · ${g.olculemeyen} namespace ölçülemedi` : ''}
                </span>
              </Hap>
            );
          })}
        </div>
      )}

      <Bolum
        baslik="Çalıştığı yerler"
        aciklama="Envanterdeki cluster / namespace kayıtları. Tür, replika ve pod sayısı saatlik taramadan ya da daha yeniyse canlı okumadan (ikisi de yoksa LogX keşif önbelleğinden) gelir."
        sag={
          <>
            <Button size="sm" variant="ghost" icon={<ArrowPathIcon className="w-4 h-4" />} onClick={onYenile}>Yenile</Button>
            <Button size="sm" variant="primary" icon={<BoltIcon className="w-4 h-4" />} onClick={baslat} loading={!!is} disabled={!!is}>
              {is ? `Okunuyor (${is.durum})` : 'Canlı oku'}
            </Button>
          </>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ color: 'var(--text-secondary)' }}>
                <th className={TH}>Ortam</th>
                <th className={TH}>Cluster</th>
                <th className={TH}>Namespace</th>
                <th className={TH}>Tür</th>
                <th className={TH}>Replika (hazır / istenen)</th>
                <th className={TH}>Pod (hazır / toplam)</th>
                <th className={TH}>Root adres (route)</th>
                <th className={TH}>İstek</th>
              </tr>
            </thead>
            <tbody>
              {!d.yerler.length && <TableEmptyRow colSpan={8} />}
              {d.yerler.map((y) => {
                const o = canliIx.get(anahtar(y.cluster, y.namespace));
                const t = turOzeti(y, o);
                const p = podSayisi(o);
                return (
                  <tr key={`${y.cluster}|${y.namespace}`} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td className={TD}>
                      {y.ortam || <span style={{ color: 'var(--status-warning-text)' }} title="Cluster Portal kataloğunda yok; canlı okuma yapılamaz">katalogda yok</span>}
                      {y.tenant && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{y.tenant}</div>}
                    </td>
                    <td className={TD} style={{ fontFamily: 'var(--font-mono)' }}>
                      {y.konsol ? (
                        <a href={y.konsol} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                          {y.cluster} <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
                        </a>
                      ) : (
                        y.cluster
                      )}
                    </td>
                    <td className={TD} style={{ fontFamily: 'var(--font-mono)' }}>{y.namespace}</td>
                    <td className={TD}>
                      {t ? (
                        <span className="inline-flex items-center gap-1.5">
                          {t.tur}
                          {t.kaynak !== 'önbellek' && (
                            <Hap ton="notr" title={o && o.alinma ? fmtDateTime(o.alinma) : undefined}>
                              {t.kaynak}
                            </Hap>
                          )}
                          {t.kaynak === 'önbellek' && <Hap ton="notr" title={y.onbellek?.alinma ? `LogX keşfi ${fmtDateTime(y.onbellek.alinma)}` : undefined}>önbellek{y.onbellek?.bayat ? ' · bayat' : ''}</Hap>}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>bilinmiyor</span>
                      )}
                    </td>
                    <td className={`${TD} tabular-nums`}>{t ? t.replika : '—'}</td>
                    <td className={`${TD} tabular-nums`} data-testid="yer-pod">
                      {p ? (
                        <span style={{ color: p.toplam && p.hazir < p.toplam ? 'var(--status-warning-text)' : undefined }}>
                          {p.hazir} / {p.toplam}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }} title={o ? 'Pod listesi okunamadı' : 'Bu yer için tarama verisi yok'}>
                          {o ? 'ölçülemedi' : '—'}
                        </span>
                      )}
                    </td>
                    <td className={`${TD} text-[12px]`}>
                      {y.routelar.length ? (
                        <ul className="space-y-0.5">
                          {y.routelar.map((r) => (
                            <li key={r.adres} className="break-all">
                              <a href={`https://${r.adres}`} target="_blank" rel="noreferrer" className="hover:underline" style={{ fontFamily: 'var(--font-mono)' }}>
                                {r.adres}
                              </a>
                              <span style={{ color: 'var(--text-muted)' }}> · {r.tls || 'tls yok'} · {r.kanit}</span>
                            </li>
                          ))}
                          {y.atfedilmeyenRoute > 0 && <li style={{ color: 'var(--text-muted)' }}>+{y.atfedilmeyenRoute} route bu uygulamaya atfedilemedi</li>}
                        </ul>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>route bulunamadı</span>
                      )}
                    </td>
                    <td className={`${TD} tabular-nums text-[12px]`}>
                      {y.istek && y.istek.olculdu ? (
                        <>
                          {fmtNumber(y.istek.toplam ?? 0)}
                          <div style={{ color: 'var(--text-muted)' }}>{y.istek.gun ?? 7} gün</div>
                          {y.istek.tumCluster && (
                            <div
                              style={{ color: 'var(--text-muted)' }}
                              title="Dynatrace ölçümü cluster ayrımı vermiyor; namespace + uygulama toplamıdır."
                            >
                              namespace toplamı
                            </div>
                          )}
                        </>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>ölçülemedi</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Bolum>

      <Bolum
        baslik="Ayrıntı (cluster / namespace başına)"
        aciklama="Tür (Deployment / Argo Rollout / DC / StatefulSet), replika, pod sayısı, imaj, CPU / bellek istek ve limitleri, JVM parametreleri (parola değerleri gizli) ve pod'ların çalıştığı node'lar. Saatlik taramadan gelir; o anki durum için Canlı oku."
      >
        <div className="p-4 space-y-3">
          {canliHata && <p className="text-[12px]" style={{ color: 'var(--status-danger)' }}>Son okumalar okunamadı: {canliHata}</p>}
          {!okumalar.length && !canliHata && (
            <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              Bu uygulama için henüz tarama verisi yok. Saatlik tarama tüm cluster'ları kendiliğinden okur; beklemeden görmek için "Canlı oku" bir AWX işi başlatır (salt okunur, genelde 1-3 dk) ve sonuç bu sayfayı açan herkese görünür.
            </p>
          )}
          {okumalar.map((o) => (
            <CanliKart key={anahtar(o.cluster, o.namespace)} o={o} />
          ))}
        </div>
      </Bolum>
    </div>
  );
}
