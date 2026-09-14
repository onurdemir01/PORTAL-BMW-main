// src/components/denetim/HacCell.tsx — H/A/C dizin gosterimi + sozlugu (ORTAK).
//
// Once yalnizca Production Tasimalari'ndaydi; kullanici begenip non-prod (Nginx SPA
// matrisi) icin de istedi (2026-09-14). Her harf bir dizin/dosya, buyuk = var, kucuk = YOK:
//   H  /hysdeploy/<ns>/<app>/                       dagitim paketi
//   A  /usr/nginx/applications/<ns>/<app>/          servis edilen dosyalar (tanim icin sart)
//   C  application-confs/<app>-<ns>.conf            per-uygulama nginx konfigurasyonu
// Veri: dbo.Nginx_Intranet_Audit (adi tarihsel; dizin taramasi HER sunucuda kosar).
import React from 'react';
import { Code } from './ui';

export interface DirFlags {
  hys: boolean;
  app: boolean;
  conf: boolean;
}

export function DirCell({ f }: { f: { hys: boolean; app: boolean; conf: boolean } | null | undefined }) {
  if (f === null) return <span className="text-[10px] text-[var(--text-muted)]" title="bu sunucu henüz taranmadı">taranmadı</span>;
  if (!f) return <span className="text-[var(--text-muted)]">—</span>;
  const ok = f.hys && f.app;
  const flag = (v: boolean, ch: string, what: string) => (
    <span className={v ? 'text-emerald-700 font-semibold' : 'text-red-600'} title={`${what}: ${v ? 'var' : 'YOK'}`}>
      {v ? ch : ch.toLowerCase()}
    </span>
  );
  return (
    <span className={`inline-flex gap-0.5 font-mono text-[11px] px-1 rounded ${ok ? 'bg-emerald-50' : 'bg-red-50'}`} title={ok ? 'hazır' : 'eksik'}>
      {flag(f.hys, 'H', '/hysdeploy/<ns>/<app>')}
      {flag(f.app, 'A', '/usr/nginx/applications/<ns>/<app>')}
      {flag(f.conf, 'C', 'application-confs/<app>-<ns>.conf')}
    </span>
  );
}


export function HacLegend({ defaultOpen = true }: { defaultOpen?: boolean }) {
  const Ex = ({ f, label }: { f: { hys: boolean; app: boolean; conf: boolean }; label: string }) => (
    <div className="flex items-center gap-2">
      <DirCell f={f} />
      <span>{label}</span>
    </div>
  );
  return (
    <details className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }} open={defaultOpen}>
      <summary className="text-xs font-semibold cursor-pointer select-none" style={{ color: 'var(--text-primary)' }}>
        Hücre gösterimi — H A C ne demek?
      </summary>
      <div className="mt-2 grid gap-3 md:grid-cols-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        <div className="space-y-1">
          <div>Her yeni sunucu sütununda üç harf; <b>büyük harf = var</b>, <b>küçük harf = YOK</b>. Yeşil zemin = taşımaya hazır (H ve A var), kırmızı zemin = eksik.</div>
          <table className="mt-1">
            <tbody>
              <tr><td className="pr-2 font-mono font-semibold">H</td><td><Code>/hysdeploy/&lt;ns&gt;/&lt;app&gt;/</Code> — dağıtım paketinin açıldığı dizin (deploy job&apos;ı bırakır)</td></tr>
              <tr><td className="pr-2 font-mono font-semibold">A</td><td><Code>/usr/nginx/applications/&lt;ns&gt;/&lt;app&gt;/</Code> — nginx&apos;in servis ettiği dosyalar; <b>tanım için şart</b></td></tr>
              <tr><td className="pr-2 font-mono font-semibold">C</td><td><Code>application-confs/&lt;app&gt;-&lt;ns&gt;.conf</Code> — per-uygulama nginx konfigürasyonu; &quot;Tanım oluştur&quot; bunu yazar</td></tr>
            </tbody>
          </table>
        </div>
        <div className="space-y-1.5">
          <Ex f={{ hys: true, app: true, conf: true }} label="üçü de var — tanım yapılmış, hazır" />
          <Ex f={{ hys: true, app: true, conf: false }} label={'paket ve dosyalar var, konfigürasyon YOK — "Tanım oluştur" ile tamamlanır'} />
          <Ex f={{ hys: true, app: false, conf: false }} label="yalnız paket dizini var, uygulama dosyaları YOK — deploy yarım kalmış; tanım yazılamaz" />
          <Ex f={{ hys: false, app: true, conf: true }} label="paket dizini yok ama dosyalar ve conf var — elle konulmuş olabilir; çalışır" />
          <div className="flex items-center gap-2"><span className="text-[var(--text-muted)]">—</span><span>uygulama bu sunucuda hiç yok</span></div>
          <div className="flex items-center gap-2"><span className="text-[10px] text-[var(--text-muted)]">taranmadı</span><span>sunucu henüz taranmadı, bilinmiyor</span></div>
        </div>
      </div>
    </details>
  );
}

