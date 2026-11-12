// src/components/app_hub/OcpGorunum.tsx — Application Hub: OpenShift uygulaması.
//
// Envanter yalnız cluster / namespace / ad tutar. Tür (Deployment mı Argo Rollout mu), replika,
// imaj, kaynak, JVM env'leri ve pod'ların node'ları "Canlı oku" ile gelir: tek bir salt okunur
// AWX işi (bastion'da oc get). Son okuma kaydedilir; başka bir admin açınca yeniden iş açmadan
// görür ve okuma zamanını bilir.
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

function turOzeti(y: OcpYer, canli?: OcpCanliOkuma) {
  const n = canli?.nesneler?.[0];
  if (n) return { tur: n.tur, replika: `${n.hazir ?? 0} / ${n.istenen ?? 0}`, kaynak: 'canlı' as const };
  const c = y.onbellek?.kayitlar?.[0];
  if (c && c.kind && c.kind !== 'Unknown') return { tur: c.kind, replika: c.replicas == null ? '?' : String(c.replicas), kaynak: 'önbellek' as const };
  return null;
}

function CanliKart({ o }: { o: OcpCanliOkuma }) {
  return (
    <div className="rounded p-3 space-y-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{o.cluster} / {o.namespace}</strong>
        {o.ok ? <Hap ton="iyi">okundu</Hap> : <Hap ton="kritik">okunamadı</Hap>}
        {o.alinma && (
          <span style={{ color: 'var(--text-muted)' }} title={fmtDateTime(o.alinma)}>
            {fmtRelative(o.alinma)}{o.alanAd ? ` · ${o.alanAd}` : ''}{o.isNo ? ` · AWX #${o.isNo}` : ''}
          </span>
        )}
      </div>
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
        if (r.okumalar) setOkumalar(r.okumalar);
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

  return (
    <div className="space-y-4">
      <KaynakUyarisi kaynaklar={d.kaynaklar} adlar={KAYNAK_AD} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <OzetKutusu etiket="Cluster" deger={d.ozet.clusterSayisi} alt={d.ozet.ortamlar.join(' · ') || undefined} />
        <OzetKutusu etiket="Namespace" deger={d.ozet.namespaceSayisi} />
        <OzetKutusu etiket="Route" deger={d.ozet.routeSayisi} />
        <OzetKutusu etiket="Son canlı okuma" deger={sonOkuma ? fmtRelative(sonOkuma) : 'yok'} alt={sonOkuma ? fmtDateTime(sonOkuma) : 'tür, replika, node ve JVM için "Canlı oku"'} />
      </div>

      <Bolum
        baslik="Çalıştığı yerler"
        aciklama="Envanterdeki cluster / namespace kayıtları. Tür ve replika canlı okumadan (yoksa LogX keşif önbelleğinden) gelir."
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
                <th className={TH}>Root adres (route)</th>
                <th className={TH}>İstek</th>
              </tr>
            </thead>
            <tbody>
              {!d.yerler.length && <TableEmptyRow colSpan={7} />}
              {d.yerler.map((y) => {
                const o = canliIx.get(anahtar(y.cluster, y.namespace));
                const t = turOzeti(y, o);
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
                          {t.kaynak === 'önbellek' && <Hap ton="notr" title={y.onbellek?.alinma ? `LogX keşfi ${fmtDateTime(y.onbellek.alinma)}` : undefined}>önbellek{y.onbellek?.bayat ? ' · bayat' : ''}</Hap>}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>bilinmiyor</span>
                      )}
                    </td>
                    <td className={`${TD} tabular-nums`}>{t ? t.replika : '—'}</td>
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
        baslik="Canlı durum"
        aciklama="Tür (Deployment / Argo Rollout / DC / StatefulSet), replika, imaj, kaynak, JVM parametreleri (parola değerleri gizli) ve pod'ların çalıştığı node'lar."
      >
        <div className="p-4 space-y-3">
          {canliHata && <p className="text-[12px]" style={{ color: 'var(--status-danger)' }}>Son okumalar okunamadı: {canliHata}</p>}
          {!okumalar.length && !canliHata && (
            <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              Bu uygulama için henüz canlı okuma yok. "Canlı oku" bir AWX işi başlatır (salt okunur, genelde 1-3 dk); sonuç kaydedilir ve bu sayfayı açan herkes görür.
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
