// src/components/ReloginOverlay.tsx — YERINDE YENIDEN GIRIS (Faz B, 2026-10-02).
//
// Oturum sunucuda bittiginde uygulama SOKULMEZ; bu katman ustte acilir. Eskiden
// kullanici giris ekranina atiliyor, acik form / sihirbaz / filtre durumu kayboluyordu.
// AWS konsolu deseni: ayni kullanici yeniden girer ve kaldigi yerden devam eder.
//
// Bilerek `Modal` DEGIL: Modal'in X dugmesi ve Esc tusu `onClose` cagirir; burada
// "kapatmak" anlamli degil (oturum yok). Tek cikis yolu acik "Cikis yap" dugmesi.
import React, { useEffect, useRef, useState } from 'react';
import { LockClosedIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import type { OturumBitisSebebi } from '@/api/sessionGuard';

interface Props {
  username: string;
  sebep: OturumBitisSebebi;
  onLogin: (username: string, password: string) => Promise<void>;
  onLogout: () => void;
}

export function sebepMetni(sebep: OturumBitisSebebi): string {
  if (sebep === 'idle') return 'Bir süredir işlem yapılmadığı için oturumunuz güvenlik gereği kapandı.';
  if (sebep === 'absolute') return 'Oturumunuzun en uzun açık kalabileceği süre doldu.';
  return 'Oturumunuz sona erdi.';
}

const ReloginOverlay: React.FC<Props> = ({ username, sebep, onLogin, onLogout }) => {
  const [kullanici, setKullanici] = useState(username);
  const [sifre, setSifre] = useState('');
  const [hata, setHata] = useState('');
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const sifreRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    sifreRef.current?.focus();
  }, []);

  const gonder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (gonderiliyor) return;
    if (!kullanici.trim() || !sifre) {
      setHata('Kullanıcı adı ve şifre gereklidir.');
      return;
    }
    setHata('');
    setGonderiliyor(true);
    try {
      await onLogin(kullanici, sifre);
    } catch (err: any) {
      setHata(err?.message || 'Giriş başarısız. Lütfen tekrar deneyin.');
      setSifre('');
      sifreRef.current?.focus();
    } finally {
      setGonderiliyor(false);
    }
  };

  const baskaKullanici = kullanici.trim().toLowerCase() !== username.toLowerCase();

  return (
    <div
      className="fixed inset-0 z-[1100] overflow-y-auto p-4 flex items-center justify-center"
      style={{ background: 'rgba(3,3,3,0.62)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="relogin-baslik"
      data-testid="relogin-overlay"
    >
      <form
        onSubmit={gonder}
        className="w-full max-w-sm px-6 py-6 space-y-4"
        style={{ background: 'var(--bg-surface)', boxShadow: 'var(--shadow-lg)', borderRadius: 'var(--radius-md)' }}
      >
        <div className="flex items-start gap-3">
          <LockClosedIcon className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
          <div>
            <h2 id="relogin-baslik" style={{ fontFamily: 'var(--font-display)', fontSize: '1.125rem', fontWeight: 500, color: 'var(--text-primary)' }}>
              Devam etmek için yeniden giriş yapın
            </h2>
            <p className="mt-1 text-[0.875rem]" style={{ color: 'var(--text-secondary)' }}>
              {sebepMetni(sebep)} Açık sayfanız korunuyor; giriş yapınca kaldığınız yerden devam edersiniz.
            </p>
          </div>
        </div>

        {hata && (
          <div className="pf-alert pf-alert--danger" role="alert">
            <ExclamationCircleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--status-danger)' }} />
            <span>{hata}</span>
          </div>
        )}

        <div>
          <label htmlFor="relogin-kullanici" className="pf-label-text">Kullanıcı adı</label>
          <input
            id="relogin-kullanici"
            type="text"
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            value={kullanici}
            onChange={(e) => setKullanici(e.target.value)}
            className="pf-input"
          />
          {baskaKullanici && (
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              Farklı kullanıcıyla girerseniz sayfa yenilenir; açık ekran korunmaz.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="relogin-sifre" className="pf-label-text">Şifre</label>
          <input
            id="relogin-sifre"
            ref={sifreRef}
            type="password"
            autoComplete="current-password"
            value={sifre}
            onChange={(e) => setSifre(e.target.value)}
            className="pf-input"
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button type="submit" className="btn-primary" disabled={gonderiliyor}>
            {gonderiliyor ? 'Giriş yapılıyor…' : 'Giriş yap ve devam et'}
          </button>
          <button type="button" className="btn-secondary" onClick={onLogout} disabled={gonderiliyor}>
            Çıkış yap
          </button>
        </div>
      </form>
    </div>
  );
};

export default ReloginOverlay;
