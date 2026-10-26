// src/components/admin/tabs/AwxSunucuYonetimi.tsx — Admin > Ansible: AWX sunucularını
// etkinleştir / devre dışı bırak (2026-10-26).
//
// Kullanıcı: "portalın eski maestro.fwgaranti.com.tr yani maestro 1'e olan bağlantısını
// kapatmak istiyorum ... Ansible info'da bunu kaldıramıyorum ... 2-3 yılda bir." Seyrek
// yapılan bir iş: tuzaklar (yarım kalan OCO zamanlaması, kilit, LogX kaydı, eski AWX_URL)
// unutulur. Bu yüzden kapatmadan ÖNCE bağımlılık özeti gösterilir; sunucu, bitmesi
// gereken iş varken kapatmayı reddeder. Satır silinmez, adres / kimlik burada düzenlenmez.
import React, { useCallback, useState } from 'react';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { ArrowPathIcon, ExclamationTriangleIcon, NoSymbolIcon, PowerIcon } from '@heroicons/react/24/outline';
import { ansibleApi, type AwxSunucuKaydi, type AwxBagimlilikOzeti } from '@/api/ansibleApi';
import { toast } from '@/hooks/useToast';

export default function AwxSunucuYonetimi({ onDegisti }: { onDegisti?: () => void }) {
  const [sunucular, setSunucular] = useState<AwxSunucuKaydi[] | null>(null);
  const [hata, setHata] = useState('');
  const [inceleme, setInceleme] = useState<{ no: number; ozet: AwxBagimlilikOzeti | null; hata: string } | null>(null);
  const [mesgul, setMesgul] = useState<number | null>(null);

  const yukle = useCallback(async () => {
    setHata('');
    try {
      const r = await ansibleApi.awxSunucuYonetim();
      if (!r.ok) throw new Error(r.message || 'AWX sunucu kayıtları okunamadı.');
      setSunucular(r.servers || []);
    } catch (e: unknown) {
      setSunucular(null);
      setHata(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useAsyncEffect(async () => {
    await yukle();
  }, [yukle]);

  async function incele(no: number) {
    setInceleme({ no, ozet: null, hata: '' });
    try {
      const r = await ansibleApi.awxSunucuBagimlilik(no);
      if (!r.ok || !r.ozet) throw new Error(r.message || 'Bağımlılık özeti alınamadı.');
      setInceleme({ no, ozet: r.ozet, hata: '' });
    } catch (e: unknown) {
      setInceleme({ no, ozet: null, hata: e instanceof Error ? e.message : String(e) });
    }
  }

  async function durumYaz(s: AwxSunucuKaydi, enabled: boolean) {
    setMesgul(s.no);
    try {
      const r = await ansibleApi.awxSunucuDurum(s.no, enabled);
      if (!r.ok) {
        // Sunucu engel gördüyse güncel özeti de döner: panel onu gösterir.
        if (r.ozet) setInceleme({ no: s.no, ozet: r.ozet, hata: '' });
        toast.error(r.message || 'Kaydedilemedi.');
        return;
      }
      if (r.yuklendi === false) toast.error(r.message || 'Kaydedildi ama bellekte yenilenemedi.');
      else toast.success(r.message || 'Kaydedildi.');
      setInceleme(null);
      await yukle();
      onDegisti?.();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setMesgul(null);
    }
  }

  return (
    <section data-testid="awx-sunucu-yonetimi">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-700">AWX Sunucuları</h3>
        <button
          onClick={() => void yukle()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          <ArrowPathIcon className="w-3.5 h-3.5" /> Yenile
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-3">
        Devre dışı bırakılan sunucuya Portal istek göndermez; kayıt silinmez, geri açılabilir. Değişiklik yeniden başlatma
        gerektirmez.
      </p>

      {hata ? (
        <p role="alert" className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {hata}
        </p>
      ) : sunucular === null ? (
        <div className="h-12 bg-gray-100 rounded-xl animate-pulse" />
      ) : sunucular.length === 0 ? (
        <p className="text-xs text-gray-400">Kayıtlı AWX sunucusu yok (Portal .env'deki AWX_1..9 tanımlarını kullanıyor).</p>
      ) : (
        <ul className="space-y-1.5">
          {sunucular.map((s) => {
            const acikInceleme = inceleme && inceleme.no === s.no ? inceleme : null;
            return (
              <li key={s.no} className="rounded-lg border border-gray-100 text-xs" data-testid={`awx-sunucu-${s.no}`}>
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span
                    className={
                      'px-1.5 py-0.5 rounded-full border text-[10px] font-semibold ' +
                      (s.enabled
                        ? 'bg-green-50 text-green-700 border-green-100'
                        : 'bg-gray-100 text-gray-600 border-gray-200')
                    }
                  >
                    {s.enabled ? 'Etkin' : 'Devre dışı'}
                  </span>
                  <span className="font-medium text-gray-700">
                    #{s.no} {s.name}
                  </span>
                  <span className="text-gray-400 font-mono break-all">{s.url}</span>
                  {s.enabled !== s.bellekte && (
                    <span className="text-amber-700" title="DB kaydı ile çalışan Portal'ın listesi farklı">
                      çalışan Portal {s.bellekte ? 'hâlâ kullanıyor' : 'kullanmıyor'} — Yenile ya da yeniden başlatma gerekir
                    </span>
                  )}
                  <span className="ml-auto flex gap-1.5">
                    {s.enabled ? (
                      <button
                        onClick={() => (acikInceleme ? setInceleme(null) : void incele(s.no))}
                        disabled={mesgul !== null}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
                        aria-expanded={!!acikInceleme}
                      >
                        <NoSymbolIcon className="w-3.5 h-3.5" /> Devre dışı bırak…
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          if (window.confirm(`#${s.no} ${s.name} yeniden etkinleştirilsin mi? Portal bu sunucuya tekrar istek göndermeye başlar.`))
                            void durumYaz(s, true);
                        }}
                        disabled={mesgul !== null}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
                      >
                        <PowerIcon className="w-3.5 h-3.5" /> {mesgul === s.no ? 'Kaydediliyor…' : 'Etkinleştir'}
                      </button>
                    )}
                  </span>
                </div>

                {acikInceleme && (
                  <div className="border-t border-gray-100 px-3 py-2 space-y-2" data-testid="awx-bagimlilik">
                    {acikInceleme.hata ? (
                      <p role="alert" className="text-red-600">{acikInceleme.hata}</p>
                    ) : !acikInceleme.ozet ? (
                      <p className="text-gray-400">Bağımlılıklar kontrol ediliyor…</p>
                    ) : (
                      <BagimlilikPaneli
                        ozet={acikInceleme.ozet}
                        mesgul={mesgul === s.no}
                        onKapat={() => void durumYaz(s, false)}
                        onIptal={() => setInceleme(null)}
                        ad={`#${s.no} ${s.name}`}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[11px] text-gray-400 mt-2">
        Kapattıktan sonra .env'deki <span className="font-mono">AWX_&lt;no&gt;_*</span> satırlarını da kaldırın: veritabanı
        açılışta okunamazsa Portal .env'deki sunuculara döner.
      </p>
    </section>
  );
}

function BagimlilikPaneli({
  ozet,
  mesgul,
  onKapat,
  onIptal,
  ad,
}: {
  ozet: AwxBagimlilikOzeti;
  mesgul: boolean;
  onKapat: () => void;
  onIptal: () => void;
  ad: string;
}) {
  const temiz = !ozet.engeller.length && !ozet.uyarilar.length && !ozet.okunamayan.length;
  return (
    <>
      {ozet.engeller.length > 0 && (
        <div>
          <p className="font-semibold text-red-700">Önce bitmesi gerekenler</p>
          <ul className="mt-1 space-y-1">
            {ozet.engeller.map((k) => (
              <li key={k.anahtar} className="text-red-700">
                <b>{k.adet}</b> × {k.baslik} <span className="text-gray-500">— {k.ipucu}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {ozet.okunamayan.length > 0 && (
        <div>
          <p className="font-semibold text-red-700">Kontrol edilemeyenler</p>
          <ul className="mt-1 space-y-1">
            {ozet.okunamayan.map((k) => (
              <li key={k.anahtar} className="text-red-700">
                {k.baslik} <span className="text-gray-500 break-all">— {k.hata}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {ozet.uyarilar.length > 0 && (
        <div>
          <p className="font-semibold text-amber-800 flex items-center gap-1">
            <ExclamationTriangleIcon className="w-3.5 h-3.5" /> Kapatınca çalışmayacaklar
          </p>
          <ul className="mt-1 space-y-1">
            {ozet.uyarilar.map((k) => (
              <li key={k.anahtar} className="text-amber-800">
                <b>{k.adet}</b> × {k.baslik}
                {k.ornekler && k.ornekler.length > 0 && (
                  <span className="font-mono text-[11px] text-gray-600 break-all"> ({k.ornekler.join(', ')})</span>
                )}
                <span className="block text-gray-500">{k.ipucu}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {temiz && <p className="text-green-700">Bu sunucuya bağlı iş ya da ayar bulunmadı.</p>}
      <div className="flex items-center justify-end gap-2 pt-1">
        {!ozet.kapatilabilir && (
          <span className="text-red-700 mr-auto">Yukarıdakiler bitmeden devre dışı bırakılamaz.</span>
        )}
        <button onClick={onIptal} className="px-2.5 py-1 rounded-lg text-gray-500 hover:text-gray-700">
          İptal
        </button>
        <button
          onClick={onKapat}
          disabled={!ozet.kapatilabilir || mesgul}
          className="px-2.5 py-1 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-40"
          data-testid="awx-kapat-onay"
        >
          {mesgul ? 'Kaydediliyor…' : `${ad} devre dışı bırak`}
        </button>
      </div>
    </>
  );
}
