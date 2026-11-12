// src/components/denetim/NginxEtiketPenceresi.tsx — Nginx Hub > Envanter: sunucuya elle etiket (2026-11-12).
//
// Kullanıcı: "sunucuları istediğim gibi label'layabilir miyim? ... conf.d/ altındaki dosyaların ismine
// bakıyorduk ama benim overwrite edebileceğim şekilde bir feature mı yapsak?"
// Otomatik liste (conf.d adları) pencerede HER ZAMAN görünür: elle değer onu sessizce silmez.
// Kip: "Yerine geç" (otomatik listeyi tamamen değiştirir) | "Üstüne ekle" (otomatik liste + elle).
import React, { useState } from 'react';
import { TagIcon } from '@heroicons/react/24/outline';
import { Modal } from '@/components/common/Modal';
import Button from '@/components/common/Button';
import { denetimApi, type NginxInvHost } from '@/api/denetimApi';
import { toast } from '@/hooks/useToast';

const ETIKET_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function etiketleriAyir(metin: string): string[] {
  return [
    ...new Set(
      metin
        .split(/[\s,;]+/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ];
}

export function NginxEtiketPenceresi({
  host,
  onClose,
  onKaydedildi,
}: {
  host: NginxInvHost;
  onClose: () => void;
  onKaydedildi: () => void;
}) {
  const e = host.etiket || null;
  const oto = e ? e.oto : (host.services || '').split(/[\s,;]+/).filter(Boolean);
  const [mod, setMod] = useState<'degistir' | 'ekle'>(e?.mod || 'degistir');
  const [metin, setMetin] = useState((e?.etiketler || oto.filter((x) => x !== 'too_many')).join(', '));
  const [not, setNot] = useState(e?.not || '');
  const [mesgul, setMesgul] = useState(false);

  const etiketler = etiketleriAyir(metin);
  const gecersiz = etiketler.filter((x) => !ETIKET_RE.test(x) || x.toLowerCase() === 'too_many');
  const sonuc =
    mod === 'ekle' ? [...new Set([...oto, ...etiketler])] : etiketler;
  const hata = !etiketler.length
    ? 'En az bir etiket yazın.'
    : etiketler.length > 20
      ? 'En çok 20 etiket.'
      : gecersiz.length
        ? `Geçersiz: ${gecersiz.join(', ')} (harf, rakam, . _ - kullanılabilir)`
        : '';

  async function kaydet() {
    if (hata) return;
    setMesgul(true);
    try {
      const r = await denetimApi.nginxInventoryLabelSet(host.hostname, { mod, etiketler, not: not.trim() || undefined });
      if (!r.ok) throw new Error(r.message || 'Kaydedilemedi.');
      toast.success(`${host.hostname} etiketi kaydedildi`);
      onKaydedildi();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setMesgul(false);
    }
  }

  async function kaldir() {
    setMesgul(true);
    try {
      const r = await denetimApi.nginxInventoryLabelClear(host.hostname);
      if (!r.ok) throw new Error(r.message || 'Kaldırılamadı.');
      toast.success(`${host.hostname} otomatik keşfe döndü`);
      onKaydedildi();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setMesgul(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${host.hostname} etiketleri`}
      subtitle="Otomatik keşif conf.d/ altındaki dosya adlarından gelir; burada yazdığınız etiket onun yerine geçer ya da üstüne eklenir."
      icon={TagIcon}
      size="lg"
      dismissOnBackdrop={false}
      footer={
        <>
          <Button variant="primary" onClick={kaydet} disabled={!!hata} loading={mesgul}>
            Kaydet
          </Button>
          <Button onClick={onClose} disabled={mesgul}>
            İptal
          </Button>
          {e && (
            <Button variant="ghost" onClick={kaldir} disabled={mesgul} className="ml-auto">
              Etiketi kaldır, otomatik keşfe dön
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4 text-[13px]" data-testid="etiket-penceresi">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>
            Otomatik keşif (conf.d)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {oto.length ? (
              oto.map((s) => (
                <span
                  key={s}
                  className="px-2 py-0.5 rounded-md text-[12px]"
                  style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                >
                  {s === 'too_many' ? '5+ service (liste toplanmadı)' : s}
                </span>
              ))
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>conf.d altında service dosyası bulunmadı</span>
            )}
          </div>
        </div>

        <fieldset>
          <legend className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>
            Kip
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                { id: 'degistir', ad: 'Yerine geç', acik: 'Otomatik liste yok sayılır; yalnız sizin etiketleriniz görünür.' },
                { id: 'ekle', ad: 'Üstüne ekle', acik: 'Otomatik keşif sürer; etiketleriniz listeye eklenir.' },
              ] as const
            ).map((k) => (
              <label
                key={k.id}
                className="flex gap-2 items-start rounded-lg border px-3 py-2 cursor-pointer"
                style={{
                  borderColor: mod === k.id ? 'var(--accent)' : 'var(--border-subtle)',
                  background: mod === k.id ? 'var(--accent-bg)' : 'var(--bg-surface)',
                }}
              >
                <input type="radio" name="etiket-kip" className="mt-0.5" checked={mod === k.id} onChange={() => setMod(k.id)} />
                <span>
                  <span className="block font-semibold" style={{ color: 'var(--text-primary)' }}>{k.ad}</span>
                  <span className="block text-[12px]" style={{ color: 'var(--text-muted)' }}>{k.acik}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="block text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>
            Etiketler
          </span>
          <input
            value={metin}
            onChange={(ev) => setMetin(ev.target.value)}
            placeholder="glomo, mobile-api"
            className="pf-input w-full text-sm"
            style={{ fontFamily: 'var(--font-mono)' }}
            aria-describedby="etiket-ipucu"
            autoFocus
          />
          <span id="etiket-ipucu" className="block mt-1 text-[12px]" style={{ color: hata ? 'var(--status-danger)' : 'var(--text-muted)' }}>
            {hata || 'Virgül ya da boşlukla ayırın.'}
          </span>
        </label>

        <label className="block">
          <span className="block text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>
            Not (isteğe bağlı)
          </span>
          <input
            value={not}
            onChange={(ev) => setNot(ev.target.value)}
            maxLength={500}
            placeholder="ör. conf.d'de eski dosya adı kaldı, gerçek uygulama glomo"
            className="pf-input w-full text-sm"
          />
        </label>

        <div className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-elevated)' }}>
          <div className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>
            Envanterde görünecek
          </div>
          <div className="flex flex-wrap gap-1.5" data-testid="etiket-sonuc">
            {sonuc.length ? (
              sonuc.map((s) => (
                <span
                  key={s}
                  className="px-2 py-0.5 rounded-md text-[12px] border"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    borderColor: oto.includes(s) ? 'var(--border-subtle)' : 'var(--accent-light)',
                    background: oto.includes(s) ? 'var(--bg-surface)' : 'var(--accent-bg)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {s === 'too_many' ? '5+ service' : s}
                </span>
              ))
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>—</span>
            )}
          </div>
        </div>
        {e?.by && (
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Son değiştiren: {e.by}
            {e.at ? ` · ${e.at.slice(0, 16).replace('T', ' ')}` : ''}
          </p>
        )}
      </div>
    </Modal>
  );
}
