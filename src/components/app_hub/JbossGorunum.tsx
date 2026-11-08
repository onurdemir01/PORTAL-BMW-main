// src/components/app_hub/JbossGorunum.tsx — Uygulama Hub: JBoss uygulamasının sunucuları,
// JVM'leri (maskeli parametreleriyle), web katmanı, yükü ve sunucu kapasitesi.
import React, { useMemo, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import type { JbossDetay, JbossSunucu } from '@/api/appHubApi';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtDate, fmtNumber } from '@/utils/datetime';
import { Bolum, CalismaHap, Hap, JvmArglari, KapasiteHucresi, KaynakUyarisi, OzetKutusu, Sayi, TD, TH } from './ortak';

const KAYNAK_AD: Record<string, string> = {
  envanter: 'JBoss uygulama envanteri (MWAppsInventory)',
  kesif: 'Web ve trafik keşfi',
  serverHub: 'Server Hub taraması',
  kapasite: 'Sunucu envanteri (Inventory)',
};

function heapMetni(s: JbossSunucu) {
  if (!s.minHeap && !s.maxHeap) return null;
  return `${s.minHeap || '?'} / ${s.maxHeap || '?'}`;
}

function SunucuSatiri({ s, acik, onToggle }: { s: JbossSunucu; acik: boolean; onToggle: () => void }) {
  const calisan = s.jvmler.filter((j) => j.calisiyor === true).length;
  const olculemeyen = s.jvmler.filter((j) => j.calisiyor == null).length;
  const portlar = [...new Set(s.jvmler.flatMap((j) => j.portlar || []))];
  return (
    <>
      <tr className="cursor-pointer hover:bg-[var(--bg-inset)]" style={{ borderTop: '1px solid var(--border-subtle)' }} onClick={onToggle}>
        <td className={TD}>
          <button
            type="button"
            aria-expanded={acik}
            className="inline-flex items-center gap-1 font-medium focus-visible:outline focus-visible:outline-2"
            style={{ color: 'var(--text-primary)' }}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            {acik ? <ChevronDownIcon className="w-4 h-4" /> : <ChevronRightIcon className="w-4 h-4" />}
            <span style={{ fontFamily: 'var(--font-mono)' }}>{s.host}</span>
          </button>
          <div className="pl-5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {s.uygulama}
            {s.site ? ` · ${s.site}` : ''}
            {s.tier ? ` · ${s.tier}` : ''}
          </div>
        </td>
        <td className={TD}>{s.ortam || '—'}</td>
        <td className={TD}>
          <div>{s.jbossSurum || '—'}</div>
          {s.nesil && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>JBoss {s.nesil}</div>}
        </td>
        <td className={TD}>
          <div>{s.jre || '—'}</div>
          {s.jdk && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{s.jdk}</div>}
        </td>
        <td className={`${TD} tabular-nums whitespace-nowrap`}>{heapMetni(s) || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
        <td className={TD}>
          {s.jvmler.length ? (
            <div className="space-y-0.5">
              <div className="flex flex-wrap gap-1">
                {calisan > 0 && <Hap ton="iyi">{calisan} çalışıyor</Hap>}
                {s.jvmler.length - calisan - olculemeyen > 0 && <Hap ton="kritik">{s.jvmler.length - calisan - olculemeyen} kapalı</Hap>}
                {olculemeyen > 0 && <Hap ton="notr">{olculemeyen} ölçülemedi</Hap>}
              </div>
              {portlar.length > 0 && (
                <div className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>port {portlar.slice(0, 6).join(', ')}{portlar.length > 6 ? '…' : ''}</div>
              )}
            </div>
          ) : (
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }} title="Bu sunucu Server Hub taramasında yok ya da taramadan düştü">
              Server Hub'da yok
            </span>
          )}
        </td>
        <td className={TD}>
          {s.web.length ? (
            <div className="text-[12px] leading-tight" style={{ fontFamily: 'var(--font-mono)' }}>
              {[...new Set(s.web.map((w) => w.host))].slice(0, 3).join(', ')}
              {new Set(s.web.map((w) => w.host)).size > 3 ? '…' : ''}
            </div>
          ) : (
            <span className="text-[12px]" style={{ color: 'var(--status-warning-text)' }} title={s.webUyari || undefined}>
              bulunamadı
            </span>
          )}
        </td>
        <td className={TD}><KapasiteHucresi k={s.kapasite} /></td>
      </tr>
      {acik && (
        <tr>
          <td colSpan={8} className="px-4 pb-4 pt-1" style={{ background: 'var(--bg-inset)' }}>
            <div className="space-y-4">
              {s.jvmler.length === 0 && (
                <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  Bu sunucu için Server Hub JVM kaydı yok; JVM parametreleri ve çalışma durumu gösterilemiyor.
                  {heapMetni(s) && ` Envanterdeki heap: ${heapMetni(s)}.`}
                </p>
              )}
              {s.jvmler.map((j) => (
                <div key={`${j.ad}-${j.nesil}`} className="rounded p-3 space-y-2" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[13px]" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{j.ad}</span>
                    {j.nesil && <Hap ton="bilgi">JBoss {j.nesil}</Hap>}
                    <CalismaHap calisiyor={j.calisiyor} />
                    <Hap ton={j.autoStart === 'true' || j.autoStart === 'yes' ? 'iyi' : j.autoStart === 'unknown' ? 'notr' : 'uyari'}>
                      auto-start: {j.autoStart}
                    </Hap>
                    {j.grup && <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>grup {j.grup}</span>}
                    {j.portlar.length > 0 && <span className="text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }}>port {j.portlar.join(', ')}</span>}
                    {j.istek7g != null && <span className="text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }}>7 gün {fmtNumber(j.istek7g)} istek</span>}
                    {!j.taze && <Hap ton="uyari" title="Server Hub taraması 2 günden eski">bayat tarama</Hap>}
                    {j.taramaTarihi && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>tarama {fmtDate(j.taramaTarihi)}</span>}
                  </div>
                  <JvmArglari
                    baslik="Çalışma anı JVM parametreleri"
                    args={j.jvmArgs}
                    bosMetin={
                      j.jvmArgDurumu
                        ? `JVM parametreleri ölçülemedi (${j.jvmArgDurumu}).`
                        : `JVM parametreleri henüz toplanmıyor: Server Hub taraması bu alanı güncellendiğinde dolduracak.${heapMetni(s) ? ` Envanterdeki heap (min / max): ${heapMetni(s)}.` : ''}`
                    }
                  />
                  {j.yapilandirilanJvmArgs && j.yapilandirilanJvmArgs !== j.jvmArgs && (
                    <JvmArglari baslik="Yapılandırmadaki parametreler" args={j.yapilandirilanJvmArgs} bosMetin="—" />
                  )}
                  {j.jvmArgFarki && (
                    <p className="text-[12px]" style={{ color: 'var(--status-warning-text)' }}>
                      Çalışan ile yapılandırılan arasında fark: <code style={{ fontFamily: 'var(--font-mono)' }}>{j.jvmArgFarki}</code>
                    </p>
                  )}
                </div>
              ))}
              {s.web.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr style={{ color: 'var(--text-secondary)' }}>
                        <th className={TH}>Web sunucusu</th>
                        <th className={TH}>Ürün</th>
                        <th className={TH}>Vhost</th>
                        <th className={TH}>Bağ</th>
                        <th className={TH}>Trafik (7 gün)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.web.map((w, i) => (
                        <tr key={`${w.host}-${w.serverName}-${i}`} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                          <td className="px-3 py-1.5" style={{ fontFamily: 'var(--font-mono)' }}>{w.host}</td>
                          <td className="px-3 py-1.5">{w.product || '—'}</td>
                          <td className="px-3 py-1.5 break-all">{w.serverName || '—'}{w.port ? `:${w.port}` : ''}</td>
                          <td className="px-3 py-1.5" style={{ color: 'var(--text-muted)' }}>{w.kaynak || '—'}</td>
                          <td className="px-3 py-1.5 tabular-nums">
                            {w.trafik?.durum === 'var' ? `${fmtNumber(w.trafik.req7 ?? 0)}${w.trafik.sampled ? ' (en az)' : ''}` : w.trafik?.durum === 'yok' ? 'trafik yok' : 'ölçülemedi'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {s.uygulamaYolu && (
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Uygulama yolu: <code style={{ fontFamily: 'var(--font-mono)' }}>{s.uygulamaYolu}</code>
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function JbossGorunum({ d }: { d: JbossDetay }) {
  const [acik, setAcik] = useState<Set<string>>(() => new Set(d.sunucular.length <= 2 ? d.sunucular.map((s) => `${s.host}|${s.uygulama}`) : []));
  const [ortam, setOrtam] = useState('');
  const liste = useMemo(() => d.sunucular.filter((s) => !ortam || s.ortam === ortam), [d.sunucular, ortam]);
  const yuk = d.ozet.yuk;
  const toggle = (k: string) =>
    setAcik((a) => {
      const n = new Set(a);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return (
    <div className="space-y-4">
      <KaynakUyarisi kaynaklar={d.kaynaklar} adlar={KAYNAK_AD} />
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <OzetKutusu etiket="Sunucu" deger={d.ozet.sunucuSayisi} alt={d.ozet.ortamlar.join(' · ') || undefined} />
        <OzetKutusu etiket="JBoss sürümü" deger={d.ozet.surumler.length ? d.ozet.surumler.join(', ') : '—'} />
        <OzetKutusu etiket="JVM" deger={`${d.ozet.calisanJvm} / ${d.ozet.jvmSayisi}`} alt="çalışan / toplam (Server Hub)" />
        <OzetKutusu etiket="Web sunucusu" deger={d.ozet.webSunucuSayisi} />
        <OzetKutusu
          etiket="Yük (7 gün)"
          deger={yuk && yuk.var + yuk.yok > 0 ? <Sayi v={yuk.req7Toplam} /> : '—'}
          alt={yuk ? `${yuk.var} vhost trafikli · ${yuk.olculemedi} ölçülemedi${yuk.altSinir ? ' · örneklem (en az)' : ''}` : 'ölçülemedi'}
        />
        <OzetKutusu
          etiket="Toplam kapasite"
          deger={d.ozet.toplamCpu ? `${d.ozet.toplamCpu} vCPU` : '—'}
          alt={d.ozet.toplamBellekGb ? `${fmtNumber(d.ozet.toplamBellekGb)} GB bellek (toplam, kullanım değil)` : undefined}
        />
      </div>

      <Bolum
        baslik="Sunucular ve JVM'ler"
        aciklama="Satıra tıklayın: JVM parametreleri, auto-start, portlar ve web bağları açılır. Kapasite sunucunun toplam CPU / belleğidir, anlık kullanım değildir."
        sag={
          d.ozet.ortamlar.length > 1 ? (
            <div role="group" aria-label="Ortam" className="inline-flex rounded border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              {['', ...d.ozet.ortamlar].map((o) => (
                <button
                  key={o || 'hepsi'}
                  aria-pressed={ortam === o}
                  onClick={() => setOrtam(o)}
                  className="px-2.5 py-1 text-[12px] focus-visible:outline focus-visible:outline-2"
                  style={{ background: ortam === o ? 'var(--ah-hue-soft)' : 'var(--bg-surface)', color: 'var(--text-primary)', fontWeight: ortam === o ? 600 : 400 }}
                >
                  {o || 'Tümü'}
                </button>
              ))}
            </div>
          ) : undefined
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ color: 'var(--text-secondary)' }}>
                <th className={TH}>Sunucu</th>
                <th className={TH}>Ortam</th>
                <th className={TH}>JBoss</th>
                <th className={TH}>Java</th>
                <th className={TH}>Heap (min / max)</th>
                <th className={TH}>JVM durumu</th>
                <th className={TH}>Web</th>
                <th className={TH}>Kapasite</th>
              </tr>
            </thead>
            <tbody>
              {!liste.length && <TableEmptyRow colSpan={8} title="Bu ortamda sunucu yok." />}
              {liste.map((s) => {
                const k = `${s.host}|${s.uygulama}`;
                return <SunucuSatiri key={k} s={s} acik={acik.has(k)} onToggle={() => toggle(k)} />;
              })}
            </tbody>
          </table>
        </div>
      </Bolum>

      <Bolum baslik="Web sunucuları (Apache / IHS)" aciklama="Uygulamaya trafik ileten vhost'lar: Server Hub proxy hedefleri, AJP / mod_cluster ve sertifika envanterinden.">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ color: 'var(--text-secondary)' }}>
                <th className={TH}>Web sunucusu</th>
                <th className={TH}>Ürün</th>
                <th className={TH}>Vhost'lar</th>
                <th className={TH}>Arkasındaki uygulama sunucuları</th>
                <th className={TH}>İstek (7 gün)</th>
              </tr>
            </thead>
            <tbody>
              {!d.webSunuculari.length && <TableEmptyRow colSpan={5} title="Web sunucusu eşlenemedi." description="2-tier uygulamalarda web katmanı uygulama sunucusunun kendisidir; 3-tier'da eşleme bulunamadıysa Server Hub taramasını kontrol edin." />}
              {d.webSunuculari.map((w) => (
                <tr key={w.host} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td className={TD} style={{ fontFamily: 'var(--font-mono)' }}>{w.host}</td>
                  <td className={TD}>{w.urun || '—'}</td>
                  <td className={`${TD} text-[12px] break-all`}>{w.vhostlar.join(', ') || '—'}</td>
                  <td className={`${TD} text-[12px]`} style={{ fontFamily: 'var(--font-mono)' }}>{w.uygulamaSunuculari.join(', ')}</td>
                  <td className={`${TD} tabular-nums`}>{w.istek7g == null ? <span style={{ color: 'var(--text-muted)' }}>ölçülemedi</span> : fmtNumber(w.istek7g)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Bolum>
    </div>
  );
}
