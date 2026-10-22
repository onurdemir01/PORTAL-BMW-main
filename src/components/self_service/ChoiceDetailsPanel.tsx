// src/components/self_service/ChoiceDetailsPanel.tsx — seçilen değerin AYRINTISI (seçimin sağında).
//
// NEDEN VAR (2026-10-22, kullanıcı): "seçilen kök API'yle beraber etkilenecek diğer children API'ler
// sağda liste halinde gözüksün kullanıcı bunun bilincinde olsun hepsinin rate limiti çünkü kök API'nin
// ismiyle aynı zone'a tanımlı". Rate limit limit-zones.conf'taki ZONE'a yazılır; zone'u kullanan her uç
// birlikte değişir. Ayrıntı alınamazsa bu "etkilenen yok" DEĞİLDİR — panel ölçülemedi der.
import React, { useState } from 'react';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { ansibleApi, type ChoiceDetails, type ChoiceDetailUc } from '@/api/ansibleApi';

interface Props {
  source: string;
  params: Record<string, string>;
  value: string;
  className?: string;
}

function limitMetni(u: ChoiceDetailUc) {
  if (!u.etkiler.ip && !u.etkiler.location) return 'limit yok — etkilenmez';
  const parca = (ad: string, v: string, farkli: boolean, etkiler: boolean) =>
    etkiler ? `${ad} ${v || 'tanımsız'}${farkli ? ' (sunucular arasında farklı)' : ''}` : '';
  return [parca('IP', u.ip, u.ipFarkli, u.etkiler.ip), parca('location', u.loc, u.locFarkli, u.etkiler.location)]
    .filter(Boolean)
    .join(' · ');
}

export default function ChoiceDetailsPanel({ source, params, value, className = '' }: Props) {
  const paramsKey = JSON.stringify(params);
  const [detay, setDetay] = useState<ChoiceDetails | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  useAsyncEffect(async (alive) => {
    setLoading(true);
    setErr('');
    setDetay(null);
    try {
      const r = await ansibleApi.choiceDetails(source, params, value);
      if (!alive()) return;
      if (!r.ok || !r.detay) setErr(r.message || 'Ayrıntı alınamadı.');
      else setDetay(r.detay);
    } catch (e: unknown) {
      if (alive()) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive()) setLoading(false);
    }
  }, [source, paramsKey, value]);

  const zoneSatiri = detay
    ? [
        ...detay.zonelar.ip.map((z) => ({ z, tur: 'IP' })),
        ...detay.zonelar.location.map((z) => ({ z, tur: 'location' })),
      ]
    : [];

  return (
    <aside
      className={`rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-2.5 space-y-2 text-[12px] ${className}`}
      data-testid="secim-ayrinti"
      aria-live="polite"
    >
      {loading && <p className="text-[var(--text-muted)]">Etkilenecek uçlar yükleniyor…</p>}
      {err && (
        <p className="text-red-600" role="alert">
          Birlikte etkilenecek uçlar ölçülemedi: {err}
        </p>
      )}
      {detay && (
        <>
          <div>
            <div className="font-semibold text-[var(--text-primary)]">
              {detay.mod === 'bilgi'
                ? `Bu konfigürasyonun zone'larını paylaşan API uçları (${detay.etkilenen})`
                : `Birlikte etkilenecek API uçları (${detay.etkilenen})`}
            </div>
            <p className="text-[11px] text-[var(--text-secondary)]">
              {detay.mod === 'bilgi'
                ? 'Okuma hiçbir şeyi değiştirmez. Rate limit değiştirilirse bu uçların hepsi birlikte etkilenir (aynı zone).'
                : "Rate limit zone'a yazılır; aşağıdaki uçlar aynı zone'u kullandığı için limit değişikliği hepsine birlikte yansır."}
            </p>
          </div>
          {detay.kokYol && (
            <div className="text-[11px] min-w-0 truncate" title={detay.kokYol} data-testid="secim-ayrinti-kok">
              <span className="text-[var(--text-secondary)]">Kök API: </span>
              <code className="font-mono text-[var(--accent)]">{detay.kokYol}</code>
            </div>
          )}
          {zoneSatiri.length > 0 && (
            <div className="text-[11px] text-[var(--text-secondary)] space-y-0.5" data-testid="secim-ayrinti-zone">
              {zoneSatiri.map(({ z, tur }) => (
                <div key={`${tur}-${z}`} className="min-w-0 truncate" title={z}>
                  {tur} zone: <code className="font-mono">{z}</code>
                </div>
              ))}
            </div>
          )}
          {detay.uclar.length === 0 ? (
            <p className="text-[var(--text-muted)]">Bu konfigürasyon için envanterde uç bulunamadı.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto divide-y divide-[var(--border-subtle)]">
              {detay.uclar.map((u) => (
                <li key={`${u.conf}|${u.yol}`} className="py-1 min-w-0" data-testid="secim-ayrinti-uc">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <code className="font-mono truncate" title={u.yol}>
                      {u.yol}
                    </code>
                    {u.kok && (
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                        kök
                      </span>
                    )}
                  </div>
                  {u.baskaConf && (
                    <div
                      className="mt-0.5 max-w-full truncate rounded px-1.5 py-0.5 text-[10px] bg-[var(--status-warning-bg)] text-[var(--status-warning-text)]"
                      title={`Bu uç başka bir konfigürasyonda (${u.conf}) ama aynı zone'u kullanıyor`}
                    >
                      başka konfigürasyon: {u.conf}
                    </div>
                  )}
                  <div className="text-[11px] text-[var(--text-muted)]">
                    {limitMetni(u)} · {u.sunucu}/{detay.toplamSunucu} sunucu
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[10px] text-[var(--text-muted)]">
            Envanter taraması {detay.taramaTarihi || '—'}
            {detay.kume ? ` · ${detay.kume} kümesi` : ''}
            {!detay.zoneBilgisi &&
              ' · Envanter zone adını henüz tutmuyor: liste bu konfigürasyondaki uçlardır; aynı zone başka bir konfigürasyonda da kullanılıyorsa o uçlar burada görünmez.'}
            {detay.zoneKirpildi && ' · Zone sayısı çok fazla: diğer konfigürasyonlardaki ortak kullanıcılar aranmadı.'}
          </p>
        </>
      )}
    </aside>
  );
}
