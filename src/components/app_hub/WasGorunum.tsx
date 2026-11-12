// src/components/app_hub/WasGorunum.tsx — Application Hub: WebSphere (WAS) application server'ı.
import React, { useState } from 'react';
import type { WasDetay } from '@/api/appHubApi';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtDate, fmtNumber } from '@/utils/datetime';
import { Bolum, JvmArglari, KapasiteHucresi, KaynakUyarisi, TD, TH } from './ortak';
import { OrtamOzeti, satirAnahtarlari } from './OrtamOzeti';

const KAYNAK_AD: Record<string, string> = {
  envanter: 'WAS envanteri (WASAppsInventory)',
  kapasite: 'Sunucu envanteri (Inventory)',
  uygulamaEnvanteri: 'Uygulama Envanteri (server.xml)',
  web: 'Web eşlemesi (sertifika envanteri)',
};

export default function WasGorunum({ d }: { d: WasDetay }) {
  // Ortam ozeti satirina tiklamak sunucu tablosunu o ortama suzer (JBoss gorunumuyle ayni).
  const [ortam, setOrtam] = useState('');
  const liste = d.sunucular.filter((s) => !ortam || (s.ortam || '') === ortam);
  const anahtarlar = satirAnahtarlari(liste.map((s) => s.host));
  return (
    <div className="space-y-4">
      <KaynakUyarisi kaynaklar={d.kaynaklar} adlar={KAYNAK_AD} />
      <OrtamOzeti
        satirlar={d.sunucular.map((s) => ({ host: s.host, ortam: s.ortam, surum: s.wasSurum, java: s.jre, jvmler: [], kapasite: s.kapasite }))}
        surumBasligi="WAS sürümü"
        secili={ortam}
        onSec={setOrtam}
        jvmGoster={false}
        altBilgi={`${fmtNumber(d.ozet.webSunucuSayisi)} web sunucusu`}
      />
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
              {!liste.length && <TableEmptyRow colSpan={7} />}
              {liste.map((s, i) => (
                <React.Fragment key={anahtarlar[i]}>
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
                          aciklama="WAS parametreleri Portal’dan değiştirilemez: değişiklik DMGR üzerinden (wsadmin + node senkronu) yapılmalı; güvenli bir otomasyonu henüz yok."
                          bosMetin={
                            !s.jvm || !s.jvm.jvmDurumu
                              ? 'WAS JVM ayarları henüz toplanmadı: Uygulama Envanteri taraması bu sunucuyu yeni tarayıcıyla taradığında (server.xml) burada görünür.'
                              : s.jvm.jvmDurumu === 'OKUNDU'
                                ? 'server.xml okundu, genericJvmArguments boş.'
                                : `server.xml okunamadı (${s.jvm.jvmDurumu}); JVM ayarları ölçülemedi.`
                          }
                        />
                        {s.jvm && s.jvm.sistemOzellikleri.length > 0 && (
                          <details className="text-[12px]">
                            <summary className="cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                              Sistem özellikleri ({s.jvm.sistemOzellikleri.length}{s.jvm.ozellikKesildi ? '+, kesildi' : ''})
                            </summary>
                            <ul className="mt-1 space-y-0.5" style={{ fontFamily: 'var(--font-mono)' }}>
                              {s.jvm.sistemOzellikleri.map((o) => (
                                <li key={o.ad} className="break-all">
                                  {o.ad}
                                  {o.deger != null && <span style={{ color: o.deger === '***' ? 'var(--text-muted)' : 'var(--text-primary)' }}>={o.deger}</span>}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
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
