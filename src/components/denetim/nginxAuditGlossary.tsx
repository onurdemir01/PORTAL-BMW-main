// src/components/denetim/nginxAuditGlossary.tsx — Nginx Audit terim sözlüğü.
//
// Kullanici bildirimi (2026-09-14): "Atlayan", "Tanımsız", "Ayar sapması" ne demek
// açık değil. Terimler TEK yerde tanımlanır; liste sayfası ve sunucu sayfası aynı
// sözlüğü gösterir, sütun başlıkları da buradaki kısa açıklamayı ipucu olarak taşır.
import React from 'react';
import { Code } from './ui';

export interface AuditTerm {
  /** tablo sütununda / kartta görünen kısa ad */
  term: string;
  /** tek cümlelik ipucu (title=) */
  short: string;
  /** sözlükteki tam açıklama */
  body: React.ReactNode;
  /** ne yapmalı */
  action?: string;
  tone: 'danger' | 'warning' | 'info';
}

export const AUDIT_TERMS: AuditTerm[] = [
  {
    term: 'Konfigürasyon geçersiz',
    short: 'nginx -T hata verdi; bu sunucu reload edilemez',
    tone: 'danger',
    body: (
      <>
        <Code>nginx -T</Code> diskteki konfigürasyonu ayrıştıramadı. nginx şu an çalışıyor
        olabilir (bellekteki eski konfigürasyonla) ama bir sonraki <b>reload/restart başarısız
        olur</b>. Sayılar kısmi olabilir.
      </>
    ),
    action: 'Hata mesajındaki dosya/satırı düzeltin, nginx -t ile doğrulayın.',
  },
  {
    term: 'Tanımsız',
    short: 'proxy_pass hedefi ne upstream ne DNS adı — nginx başlamaz',
    tone: 'danger',
    body: (
      <>
        Bir location <Code>proxy_pass https://app-yok/</Code> diyor ama <Code>app-yok</Code>{' '}
        adında bir <Code>upstream {'{}'}</Code> bloğu yok ve bu ad DNS&apos;te çözülebilecek bir
        alan adı da değil (nokta içermiyor). nginx bu adı başlangıçta çözmeye çalışır,
        çözemez ve <b>hiç başlamaz</b> — sunucudaki <i>bütün</i> siteler etkilenir.
      </>
    ),
    action: 'Eksik upstream bloğunu ekleyin ya da proxy_pass hedefini düzeltin.',
  },
  {
    term: 'Atlayan',
    short: "proxy_pass upstream'e değil doğrudan DNS adına gidiyor",
    tone: 'warning',
    body: (
      <>
        Location, tanımlı bir upstream yerine doğrudan bir alan adına gidiyor:{' '}
        <Code>proxy_pass https://app.apps.fw.garanti.com.tr/</Code>. <b>Çalışır</b>, ama
        upstream katmanı <b>atlanmış</b> olur: <Code>resolve</Code> (adres canlı çözülmez —
        arka uç IP değişirse eskisine gider), <Code>keepalive</Code> (her istekte yeni TCP/TLS
        bağlantısı) ve <Code>zone</Code> devre dışıdır.
      </>
    ),
    action: 'Bir upstream bloğu tanımlayıp proxy_pass’i ona yönlendirin.',
  },
  {
    term: 'resolve yok',
    short: 'upstream adresi yalnızca başlangıçta çözülür',
    tone: 'warning',
    body: (
      <>
        Upstream&apos;in <Code>server</Code> satırında <Code>resolve</Code> yok. nginx alan adını
        <b>yalnızca başlangıçta</b> çözer; OpenShift route IP&apos;si değişirse nginx eski
        adrese gitmeye devam eder, reload gerekir. <Code>resolve</Code> için ayrıca{' '}
        <Code>zone</Code> ve global <Code>resolver</Code> şarttır.
      </>
    ),
    action: 'server … resolve; + zone … ; ekleyin (bmw_defaults.conf resolver tanımlıyor).',
  },
  {
    term: 'Kullanılmayan upstream',
    short: 'tanımlı ama hiçbir location proxy_pass ile kullanmıyor',
    tone: 'info',
    body: (
      <>
        Bir <Code>upstream {'{}'}</Code> bloğu var ama sunucudaki hiçbir location ona{' '}
        <Code>proxy_pass</Code> yapmıyor. Zarar vermez; çoğunlukla kaldırılmış bir servisin
        kalıntısıdır ve <Code>resolve</Code> taşıyorsa boşuna DNS sorgusu üretir.
      </>
    ),
    action: 'Temizlik adayı — kaldırılabilir.',
  },
  {
    term: 'Ayar sapması',
    short: 'global bir direktif kurulum referansından farklı',
    tone: 'danger',
    body: (
      <>
        <b>Referans</b> = <Code>nginx_installation</Code> job&apos;ının sunucuya koyduğu
        dosyalar (<Code>bmw_defaults.conf</Code>, <Code>proxy_settings.conf</Code>,{' '}
        <Code>rate_limits.conf</Code>, <Code>nginx.conf</Code>). Bu dosyalar
        <b>sunucu geneli</b> varsayılanları belirler: <Code>server_tokens off</Code>,{' '}
        <Code>ssl_protocols TLSv1.2 TLSv1.3</Code>, <Code>proxy_read_timeout 20s</Code>…
        Sunucuda bu direktiflerden biri <b>global bağlamda</b> (http/main) referanstan{' '}
        <b>farklı</b> bir değerdeyse ya da <b>hiç yoksa</b>, bu bir <b>sapmadır</b>: sunucu
        standarttan ayrılmış demektir.
        <div className="mt-1">
          Bir location&apos;ın <i>kendi içinde</i> farklı değer vermesi (örn.{' '}
          <Code>proxy_read_timeout 60s</Code>) sapma <b>değil</b>, <b>yerel override</b>&apos;dır
          — bilinçli olabilir; sunucu sayfasında ayrı ve bilgi amaçlı listelenir.
        </div>
      </>
    ),
    action: 'Değeri referansa çekin ya da farkın gerekçesini kayıt altına alın.',
  },
  {
    term: 'Dosya uyumu',
    short: 'kurulum dosyaları sunucuda referansla birebir mi',
    tone: 'warning',
    body: (
      <>
        <Code>nginx_installation</Code> yedi dosyayı sunucuya <b>olduğu gibi</b> kopyalar:{' '}
        <Code>nginx.conf</Code>, <Code>bmw_defaults.conf</Code>, <Code>proxy_settings.conf</Code>,{' '}
        <Code>rate_limits.conf</Code>, <Code>log_format.conf</Code>, <Code>mime.types</Code>,{' '}
        <Code>html/gt-error-page.html</Code>. Sunucudaki kopya referansla{' '}
        <b>birebir aynı olmalı</b>. Değilse fark <b>direktif bazında</b> gösterilir:{' '}
        <b>eksik</b> (referansta var, sunucuda yok), <b>değişmiş</b> (değer farklı),{' '}
        <b>fazla</b> (sunucuda var, referansta yok). Karşılaştırma boşluk ve yorum duyarsızdır.
        &quot;Ayar sapması&quot; ile farkı: o, <i>nginx&apos;in gördüğü</i> etkin değere bakar;
        bu, <i>diskteki dosyanın</i> referansla aynı olup olmadığına.
      </>
    ),
    action: 'Farklı dosyayı referansla değiştirin (nginx_installation yeniden koşulabilir).',
  },
];

// Renkler tema token'larindan (index.css uyumluluk katmani opacity ekli siniflari
// eslemez; bg-red-50/60 gibi siniflar sessizce bos kalirdi).
const TONE_STYLE: Record<AuditTerm['tone'], { border: string; bg: string; dot: string }> = {
  danger: { border: 'var(--status-danger)', bg: 'var(--status-danger-bg)', dot: 'var(--status-danger)' },
  warning: { border: 'var(--status-warning)', bg: 'var(--status-warning-bg)', dot: 'var(--status-warning)' },
  info: { border: 'var(--border-subtle)', bg: 'var(--bg-elevated)', dot: 'var(--text-muted)' },
};

/** Terim ipucu: sütun başlıklarında title= olarak kullanılır. */
export function termHint(term: string): string {
  return AUDIT_TERMS.find((t) => t.term === term)?.short || '';
}

/** Açılır sözlük; varsayılan kapalı — ekranı ilk bakışta doldurmasın. */
export function AuditGlossary({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <details
      className="rounded-xl border px-4 py-3"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
      open={defaultOpen}
    >
      <summary className="text-xs font-semibold cursor-pointer select-none" style={{ color: 'var(--text-primary)' }}>
        Sözlük — bu ekrandaki terimler ne demek?
      </summary>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {AUDIT_TERMS.map((t) => (
          <div
            key={t.term}
            className="rounded-lg border px-3 py-2 text-[11px] leading-relaxed"
            style={{ borderColor: TONE_STYLE[t.tone].border, background: TONE_STYLE[t.tone].bg }}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: TONE_STYLE[t.tone].dot }} />
              <span className="font-semibold text-[12px]" style={{ color: 'var(--text-primary)' }}>{t.term}</span>
              <span className="text-[var(--text-muted)]">— {t.short}</span>
            </div>
            <div style={{ color: 'var(--text-secondary)' }}>{t.body}</div>
            {t.action && (
              <div className="mt-1 text-[var(--text-muted)]">
                <b>Ne yapmalı:</b> {t.action}
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

/**
 * STANDART DEGERLER (kullanici istegi, 2026-09-16): kurulum referansindaki tum direktifler
 * alt alta, net. Liste sunucudan gelir (Nginx_Audit_Settings.reference_value) — koda gomulu
 * deger yok; kurulum dosyasi degisince denetimle birlikte burasi da degisir.
 */
export function ReferenceValuesPanel({
  items,
  defaultOpen = false,
}: {
  items: { directive: string; context: string; value: string }[];
  defaultOpen?: boolean;
}) {
  if (!items || items.length === 0) return null;
  const byCtx = new Map<string, typeof items>();
  for (const it of items) {
    const k = it.context || 'http';
    if (!byCtx.has(k)) byCtx.set(k, []);
    byCtx.get(k)!.push(it);
  }
  const order = ['main', 'events', 'http', 'global'];
  const ctxs = [...byCtx.keys()].sort((a, b) => (order.indexOf(a) + 100) % 100 - (order.indexOf(b) + 100) % 100 || a.localeCompare(b));
  return (
    <details open={defaultOpen} className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)]">
      <summary className="cursor-pointer select-none px-3 py-2 text-[12px] font-semibold text-[var(--text-primary)]">
        Standart değerler — kurulum referansı ({items.length} direktif)
        <span className="ml-2 font-normal text-[11px] text-[var(--text-muted)]">
          nginx_installation: bmw_defaults.conf · proxy_settings.conf · rate_limits.conf · nginx.conf — sunucudaki global değer bunlardan farklıysa &quot;ayar sapması&quot;
        </span>
      </summary>
      <div className="px-3 pb-3 grid gap-3 md:grid-cols-2">
        {ctxs.map((ctx) => (
          <div key={ctx}>
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">{ctx} bağlamı</div>
            <table className="text-[11px] w-full">
              <tbody>
                {byCtx.get(ctx)!.map((it, i) => (
                  <tr key={i} className="border-t border-[var(--border-subtle)]">
                    <td className="py-0.5 pr-3 font-mono whitespace-nowrap">{it.directive}</td>
                    <td className="py-0.5 font-mono text-emerald-700 break-all">{it.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </details>
  );
}
