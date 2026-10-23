// src/components/self_service/NginxTanimOkuma.tsx — Nginx - RVP Operations "read" (2026-10-20).
//
// Kullanıcı: "Read job'ını silme işlemini yaparken okuduğun işe çevirelim, Ansible job'ını
// tetiklememize gerek yok. Read isteyen kişiye mevcut tanımlar / tanımlardan hangi location'a
// hangi uygulama cevap veriyor bunu gösterelim."
//
// Formda action=read seçilince "İş Başlat" yerine bu tablo görünür; AWX job'ı BAŞLATILMAZ
// (sunucu da launch-ss'te reddeder). Kaynak silme akışının okuduğu günlük tanım taraması:
// tarama tarihi yazılır, bugün yapılan değişiklik yarınki taramada görünür.
import { useMemo, useState } from 'react';
import { MagnifyingGlassIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { selfServiceApi, type NginxTanimlar, type NginxTanimCevap } from '@/api/selfServiceApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';

const FILO: Record<string, { etiket: string; renk: string; zemin: string }> = {
  yeni: { etiket: 'yeni filo', renk: 'var(--status-info)', zemin: 'var(--status-info-bg)' },
  eski: { etiket: 'eski filo', renk: 'var(--status-warning-text)', zemin: 'var(--status-warning-bg)' },
  bilinmiyor: { etiket: 'filo bilinmiyor', renk: 'var(--text-muted)', zemin: 'var(--bg-elevated)' },
};

function Uygulama({ c }: { c: NginxTanimCevap }) {
  if (!c.application)
    return <span className="text-[var(--text-muted)]" title="Taramada bu location için uygulama çözülemedi">—</span>;
  return (
    <span className="font-mono">
      {c.application}
      {c.tahmin && (
        <span className="ml-1 font-sans text-[11px] text-[var(--text-muted)]" title={c.hedef ? `proxy hedefi: ${c.hedef}` : undefined}>
          (tahmin: proxy hedefinden)
        </span>
      )}
    </span>
  );
}

export default function NginxTanimOkuma({
  env,
  service,
  namespace,
  application,
}: {
  env: string;
  service: string;
  namespace?: string;
  application?: string;
}) {
  const [veri, setVeri] = useState<NginxTanimlar | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [q, setQ] = useState('');
  const hazir = !!env.trim() && !!service.trim();

  useAsyncEffect(
    async (alive) => {
      if (!hazir) {
        setVeri(null);
        return;
      }
      setYukleniyor(true);
      try {
        const r = await selfServiceApi.nginxTanimlari({ env, service, namespace, application });
        if (alive()) setVeri(r);
      } catch (e) {
        if (alive()) setVeri({ ok: false, message: e instanceof Error ? e.message : String(e), satirlar: [] });
      } finally {
        if (alive()) setYukleniyor(false);
      }
    },
    [env, service, namespace, application, hazir],
  );

  const satirlar = useMemo(() => {
    const aranan = q.trim().toLocaleLowerCase('tr').replace(/ı/g, 'i');
    if (!veri?.satirlar) return [];
    if (!aranan) return veri.satirlar;
    const norm = (t: string | null) => String(t || '').toLocaleLowerCase('tr').replace(/ı/g, 'i');
    return veri.satirlar.filter(
      (s) => norm(s.location).includes(aranan) || s.cevaplar.some((c) => norm(c.application).includes(aranan) || norm(c.namespace).includes(aranan)),
    );
  }, [veri, q]);

  return (
    <section className="rounded-xl border border-[var(--border)] p-4 space-y-3" aria-label="Mevcut Nginx tanımları">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Mevcut tanımlar{veri?.service ? ` · ${veri.service}` : ''}
            {veri?.env ? ` · ${veri.env}` : ''}
          </h3>
          <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
            Read için iş başlatılmaz: hangi location’a hangi uygulamanın cevap verdiği, günlük tanım taramasından gösterilir
            {veri?.taramaTarihi ? ` (son tarama ${veri.taramaTarihi}; bugün yapılan değişiklik yarınki taramada görünür)` : ''}.
          </p>
        </div>
        {veri?.durum === 'var' && (
          <div className="relative">
            <MagnifyingGlassIcon className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Location, uygulama ya da namespace ara"
              aria-label="Location, uygulama ya da namespace ara"
              className="h-8 pl-7 pr-2 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] w-64 max-w-full"
            />
          </div>
        )}
      </div>

      {!hazir && <p className="text-sm text-[var(--text-muted)]">Tanımları görmek için ortam ve servis seçin.</p>}
      {hazir && yukleniyor && !veri && <p className="text-sm text-[var(--text-muted)]">Tanımlar okunuyor…</p>}
      {veri && !veri.ok && (
        <p className="text-sm rounded-lg border px-3 py-2" style={{ color: 'var(--status-danger-text)', borderColor: 'var(--status-danger)' }}>
          {veri.message || 'Tanımlar okunamadı.'}
        </p>
      )}
      {veri?.ok && veri.durum === 'olculemedi' && (
        <p className="text-sm rounded-lg border px-3 py-2 flex items-start gap-2" style={{ color: 'var(--status-warning-text)', borderColor: 'var(--status-warning)' }}>
          <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{veri.sebep || 'Tanım taraması okunamadı.'} Bu “tanım yok” demek değildir.</span>
        </p>
      )}
      {veri?.ok && veri.durum === 'yok' && (
        <p className="text-sm text-[var(--text-secondary)]">
          Son taramada bu ortam / servis için tanım yok
          {veri.glomoProd ? ' (yeni filoda)' : ''}.
        </p>
      )}
      {veri?.ok && veri.glomoProd && (
        <p className="text-[12px] text-[var(--text-muted)]">
          GLOMO production: yalnız <b>yeni filo</b> tanımları gösterilir; eski filoya hiçbir işte gidilmez
          {veri.eskiFiloGizli ? ` (${veri.eskiFiloGizli} eski filo satırı listelenmedi)` : ''}.
        </p>
      )}

      {veri?.ok && veri.durum === 'var' && (
        <>
          <p className="text-[12px] text-[var(--text-secondary)]">
            <b>{satirlar.length}</b> location{satirlar.length !== veri.satirlar.length ? ` (toplam ${veri.satirlar.length})` : ''}
            {veri.satirlar.some((s) => s.tutarsiz) ? ` · ${veri.satirlar.filter((s) => s.tutarsiz).length} location’da sunucular arasında farklı uygulama var` : ''}
          </p>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-xs">
              <thead className="bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Location</th>
                  <th className="px-3 py-2 text-left font-medium">Cevap veren uygulama</th>
                  <th className="px-3 py-2 text-left font-medium">Namespace</th>
                  <th className="px-3 py-2 text-left font-medium">Sunucular</th>
                </tr>
              </thead>
              <tbody>
                {satirlar.map((s) =>
                  s.cevaplar.map((c, i) => (
                    <tr key={`${s.location}-${i}`} className="border-t border-[var(--border)] align-top">
                      {i === 0 && (
                        <td className="px-3 py-1.5 font-mono text-[var(--text-primary)]" rowSpan={s.cevaplar.length}>
                          {s.location}
                          {s.tutarsiz && (
                            <span
                              className="block font-sans text-[10px] font-semibold mt-0.5"
                              style={{ color: 'var(--status-warning-text)' }}
                              title="Bu location sunucular arasında farklı uygulamalara gidiyor"
                            >
                              sunucular arasında farklı
                            </span>
                          )}
                        </td>
                      )}
                      <td className="px-3 py-1.5 text-[var(--text-primary)]">
                        <Uygulama c={c} />
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[var(--text-secondary)]">{c.namespace || '—'}</td>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {c.sunucular.map((h) => (
                            <span
                              key={h.host}
                              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px]"
                              style={h.filo ? { background: FILO[h.filo]?.zemin, color: FILO[h.filo]?.renk } : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                              title={h.filo ? FILO[h.filo]?.etiket : undefined}
                            >
                              {h.host}
                              {h.filo && <span className="font-sans">· {FILO[h.filo]?.etiket || h.filo}</span>}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )),
                )}
                {satirlar.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-3 text-center text-[var(--text-muted)]">
                      Aramaya uyan location yok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
