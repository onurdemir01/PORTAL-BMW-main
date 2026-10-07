// src/components/oturum/OturumListesi.tsx — aktif oturumlar listesi (Faz D, 2026-10-02).
//
// Iki yerde kullanilir: kullanicinin kendi oturumlari (ust menu > "Aktif oturumlarım")
// ve Admin > Kullanıcılar (bir kullanicinin oturumlari). Kendi listesinde "bu oturum"
// kapatilamaz (Cikis bunun icin var); admin kullanicinin tum oturumlarini kapatabilir.
import React, { useCallback, useEffect, useState } from 'react';
import { ComputerDesktopIcon, DevicePhoneMobileIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { sessionsApi, type OturumSatiri } from '@/api/sessionsApi';
import { fmtDateTime, fmtRelative } from '@/utils/datetime';
import { TableEmptyRow } from '@/components/common/EmptyState';

interface Props {
  /** Verilirse admin modu: bu kullanicinin oturumlari. */
  adminKullanici?: string;
}

const mobilMi = (device: string) => /Android|iOS/.test(device);

const OturumListesi: React.FC<Props> = ({ adminKullanici }) => {
  const [satirlar, setSatirlar] = useState<OturumSatiri[] | null>(null);
  const [hata, setHata] = useState('');
  const [bilgi, setBilgi] = useState('');
  const [mesgul, setMesgul] = useState<string | null>(null);

  const getir = useCallback(
    () => (adminKullanici ? sessionsApi.admin.list(adminKullanici) : sessionsApi.list()),
    [adminKullanici],
  );

  const yukle = useCallback(async () => {
    setHata('');
    try {
      setSatirlar(await getir());
    } catch (e) {
      setSatirlar([]);
      setHata((e as Error).message);
    }
  }, [getir]);

  useEffect(() => {
    let iptal = false;
    getir()
      .then((l) => {
        if (!iptal) setSatirlar(l);
      })
      .catch((e: Error) => {
        if (iptal) return;
        setSatirlar([]);
        setHata(e.message);
      });
    return () => {
      iptal = true;
    };
  }, [getir]);

  const kapat = async (id: string | null, hepsi = false) => {
    setMesgul(hepsi ? '*' : id);
    setHata('');
    setBilgi('');
    try {
      let n: number;
      if (adminKullanici) n = await sessionsApi.admin.revoke(adminKullanici, hepsi ? undefined : id || undefined);
      else n = hepsi ? await sessionsApi.revokeOthers() : await sessionsApi.revoke(id!);
      setBilgi(n ? `${n} oturum kapatıldı. O cihazlarda bir sonraki işlemde yeniden giriş istenecek.` : 'Kapatılacak oturum yoktu.');
      await yukle();
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setMesgul(null);
    }
  };

  const digerSayisi = (satirlar || []).filter((s) => !s.current).length;

  return (
    <div className="space-y-3" data-testid="oturum-listesi">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {adminKullanici
            ? `${adminKullanici} kullanıcısının açık oturumları.`
            : 'Hesabınızla açık olan oturumlar. Tanımadığınız bir cihaz görürseniz kapatın ve şifrenizi değiştirin.'}
        </p>
        <button type="button" className="btn-secondary inline-flex items-center gap-1" onClick={() => void yukle()}>
          <ArrowPathIcon className="w-4 h-4" aria-hidden="true" /> Yenile
        </button>
      </div>

      {hata && (
        <div className="pf-alert pf-alert--danger" role="alert">
          {hata}
        </div>
      )}
      {bilgi && (
        <div className="pf-alert pf-alert--success" role="status">
          {bilgi}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs" style={{ color: 'var(--text-muted)' }}>
              <th className="px-3 py-2">Cihaz</th>
              <th className="px-3 py-2">IP</th>
              <th className="px-3 py-2">Giriş</th>
              <th className="px-3 py-2">Son etkinlik</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {satirlar === null ? (
              <TableEmptyRow colSpan={5} title="Yükleniyor…" />
            ) : satirlar.length === 0 ? (
              <TableEmptyRow colSpan={5} title="Açık oturum yok." />
            ) : (
              satirlar.map((s, i) => (
                <tr key={s.id || i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-3 py-2" title={s.ua}>
                    <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                      {mobilMi(s.device) ? (
                        <DevicePhoneMobileIcon className="w-4 h-4" aria-hidden="true" />
                      ) : (
                        <ComputerDesktopIcon className="w-4 h-4" aria-hidden="true" />
                      )}
                      {s.device}
                    </span>
                    {s.current && (
                      <span className="ml-2 rounded px-1.5 py-0.5 text-[0.6875rem] font-semibold" style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>
                        Bu oturum
                      </span>
                    )}
                    {s.remember && (
                      <span className="ml-2 text-[0.6875rem]" style={{ color: 'var(--text-muted)' }}>
                        hatırlanıyor
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {s.ip || '—'}
                  </td>
                  <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>
                    {fmtDateTime(s.createdAt)}
                  </td>
                  <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }} title={fmtDateTime(s.lastSeenAt)}>
                    {fmtRelative(s.lastSeenAt)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!s.current && s.id && (
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={mesgul !== null}
                        onClick={() => void kapat(s.id)}
                      >
                        {mesgul === s.id ? 'Kapatılıyor…' : 'Kapat'}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {digerSayisi > 0 && (
        <button type="button" className="btn-primary" disabled={mesgul !== null} onClick={() => void kapat(null, true)}>
          {mesgul === '*'
            ? 'Kapatılıyor…'
            : adminKullanici
              ? `Tüm oturumlarını sonlandır (${digerSayisi})`
              : `Diğer tüm oturumlardan çık (${digerSayisi})`}
        </button>
      )}
    </div>
  );
};

export default OturumListesi;
