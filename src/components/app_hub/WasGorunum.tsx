// src/components/app_hub/WasGorunum.tsx — Uygulama Hub: WebSphere (WAS) application server'ı.
import React from 'react';
import type { WasDetay } from '@/api/appHubApi';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtDate, fmtNumber } from '@/utils/datetime';
import { Bolum, JvmArglari, KapasiteHucresi, KaynakUyarisi, OzetKutusu, TD, TH } from './ortak';

const KAYNAK_AD: Record<string, string> = {
  envanter: 'WAS envanteri (WASAppsInventory)',
  kapasite: 'Sunucu envanteri (Inventory)',
  uygulamaEnvanteri: 'Uygulama Envanteri (server.xml)',
  web: 'Web eşlemesi (sertifika envanteri)',
};

export default function WasGorunum({ d }: { d: WasDetay }) {
  return (
    <div className="space-y-4">
      <KaynakUyarisi kaynaklar={d.kaynaklar} adlar={KAYNAK_AD} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <OzetKutusu etiket="Sunucu" deger={d.ozet.sunucuSayisi} alt={d.ozet.ortamlar.join(' · ') || undefined} />
        <OzetKutusu etiket="WAS sürümü" deger={d.ozet.surumler.join(', ') || '—'} />
        <OzetKutusu etiket="Web sunucusu" deger={d.ozet.webSunucuSayisi} />
        <OzetKutusu
          etiket="Toplam kapasite"
          deger={d.ozet.toplamCpu ? `${d.ozet.toplamCpu} vCPU` : '—'}
          alt={d.ozet.toplamBellekGb ? `${fmtNumber(d.ozet.toplamBellekGb)} GB bellek (toplam)` : undefined}
        />
      </div>
      <Bolum baslik="Sunucular" aciklama="JVM ayarları Uygulama Envanteri taramasının okuduğu server.xml'den gelir; tarama kapalıysa ya da bu alan henüz toplanmıyorsa boş görünür.">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ color: 'var(--text-secondary)' }}>
                <th className={TH}>Sunucu</th>
                <th className={TH}>Ortam</th>
                <th className={TH}>WAS</th>
                <th className={TH}>Java</th>
                <th className={TH}>Envanter durumu</th>
                <th className={TH}>Web</th>
                <th className={TH}>Kapasite</th>
              </tr>
            </thead>
            <tbody>
              {!d.sunucular.length && <TableEmptyRow colSpan={7} />}
              {d.sunucular.map((s) => (
                <React.Fragment key={s.host}>
                  <tr style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td className={TD} style={{ fontFamily: 'var(--font-mono)' }}>{s.host}</td>
                    <td className={TD}>{s.ortam || '—'}</td>
                    <td className={TD}>{s.wasSurum || '—'}</td>
                    <td className={TD}>
                      <div>{s.jre || '—'}</div>
                      {s.jdk && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{s.jdk}</div>}
                    </td>
                    <td className={TD}>{s.envanterDurumu || '—'}</td>
                    <td className={`${TD} text-[12px]`} style={{ fontFamily: 'var(--font-mono)' }}>
                      {s.web.length ? [...new Set(s.web.map((w) => w.host))].join(', ') : <span style={{ color: 'var(--text-muted)' }}>bulunamadı</span>}
                    </td>
                    <td className={TD}><KapasiteHucresi k={s.kapasite} /></td>
                  </tr>
                  <tr>
                    <td colSpan={7} className="px-4 pb-3 pt-0">
                      <div className="rounded p-3 space-y-2" style={{ background: 'var(--bg-inset)' }}>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                          <span>Heap (min / max): <strong className="tabular-nums">{s.jvm?.minHeap || '?'} / {s.jvm?.maxHeap || '?'}</strong>{s.jvm?.minHeap || s.jvm?.maxHeap ? ' MB' : ''}</span>
                          {s.jvm?.profil && <span>Profil {s.jvm.profil}</span>}
                          {s.jvm?.dugum && <span>Düğüm {s.jvm.dugum}</span>}
                          {s.jvm?.taranma && <span style={{ color: 'var(--text-muted)' }}>tarama {fmtDate(s.jvm.taranma)}</span>}
                        </div>
                        <JvmArglari
                          baslik="genericJvmArguments"
                          args={s.jvm?.jvmArgs}
                          bosMetin={s.jvm ? 'server.xml okundu ama genericJvmArguments boş.' : 'WAS JVM ayarları henüz toplanmadı: Uygulama Envanteri taraması bu sunucuyu tarayınca (server.xml) burada görünür.'}
                        />
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Bolum>
      <Bolum baslik="Web sunucuları (IHS)" aciklama="Sertifika envanterindeki vhost'lardan uygulama adı ve sunucu adlandırma kuralıyla eşlenir.">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ color: 'var(--text-secondary)' }}>
                <th className={TH}>Web sunucusu</th>
                <th className={TH}>Ürün</th>
                <th className={TH}>Vhost'lar</th>
                <th className={TH}>Uygulama sunucuları</th>
              </tr>
            </thead>
            <tbody>
              {!d.webSunuculari.length && <TableEmptyRow colSpan={4} title="Web sunucusu eşlenemedi." />}
              {d.webSunuculari.map((w) => (
                <tr key={w.host} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td className={TD} style={{ fontFamily: 'var(--font-mono)' }}>{w.host}</td>
                  <td className={TD}>{w.urun || '—'}</td>
                  <td className={`${TD} text-[12px] break-all`}>{w.vhostlar.join(', ') || '—'}</td>
                  <td className={`${TD} text-[12px]`} style={{ fontFamily: 'var(--font-mono)' }}>{w.uygulamaSunuculari.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Bolum>
    </div>
  );
}
