// src/components/crypto_hub/ValuesHistory.tsx — values dosyasının geçmişi.
//
// Kullanıcı (2026-09-28): "values yaml değişince bu yeni values filesystem'de oluşuyor
// değil mi? Eskilerini de gösterip isterse dönebilmelerine yönelik geliştirme yapmanı
// istiyorum. Eskisiyle mevcut values arasındaki farkı da göstert."
//
// Evet: `values_put` dosyanın ÜZERİNE yazar ve her yazmadan önce `<dosya>.<tarih>.bak`
// bırakır. Yani geçmiş zaten diskte duruyordu, yalnızca görünmüyordu. Bu ekran onu görünür
// kılar, farkı gösterir ve geri dönmeyi sağlar.
//
// FARK, AYRI BİR MANTIK DEĞİL: yedek de bir values dosyası olduğu için karşılaştırma
// `values_files` ile yapılır ve aynı tabloda (CompareTable) çizilir — "hangi ayar farklı"
// sorusunun cevabı her yerde aynı motordan gelir. Maske tuzağı da bu sayede tek yerde
// çözülü kalır: karşılaştırma sunucuda, HAM içerik üzerinde yapılır.
//
// GERİ YÜKLEME İÇERİĞİ TARAYICIDAN GEÇİRMEZ: kopyalama bastion'da olur. Yedeği okuyup geri
// göndermek, maskeli bir metnin yazılma ihtimalini ve gereksiz bir sır dolaşımını
// beraberinde getirirdi. Geri yüklemeden önce MEVCUT HALİN yedeği de alınır — yanlış
// sürüme dönen kullanıcı geri dönemeyeceği bir yere düşmesin.
import React, { useState } from 'react';
import {
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  ScaleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { useOps, OpsConfirm, type OpsRequest } from './OpsPanel';
import { vbtn, type ValuesFileOption } from './ValuesEditor';
import { CompareTable } from './ValuesCompare';
import type { CryptoOpsResult } from '@/api/cryptoHubApi';
import { toast } from '@/hooks/useToast';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';

const SM =
  'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';

/** `<yol>.20260915093000.bak` -> "2026-09-15 09:30:00". Çözemezse ham damgayı döndürür —
 *  uydurulmuş bir tarih, okunamayan bir damgadan daha kötüdür. */
export function yedekTarihi(path: string): string {
  const m = String(path || '').match(/\.(\d{14})\.bak$/);
  if (!m)
    return (
      String(path || '')
        .split('/')
        .pop() || ''
    );
  const d = m[1];
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)} ${d.slice(8, 10)}:${d.slice(10, 12)}:${d.slice(12, 14)}`;
}

export function ValuesHistory({
  tenantKey,
  tenantLabel,
  namespace,
  files,
}: {
  tenantKey: string;
  tenantLabel: string;
  namespace: string;
  files: ValuesFileOption[];
}) {
  const { run, busy } = useOps(tenantKey);
  const [hedef, setHedef] = useState(files[0]?.path || '');
  const [liste, setListe] = useState<CryptoOpsResult | null>(null);
  const [fark, setFark] = useState<{ yedek: string; sonuc: CryptoOpsResult } | null>(null);
  const [onay, setOnay] = useState<OpsRequest | null>(null);

  const getir = async (yol = hedef) => {
    if (!yol) return;
    setFark(null);
    const r = await run({ action: 'values_backups', targets: [], valuesPath: yol });
    if (r) setListe(r);
  };

  // Deponun kendi hook'u: yuklemeyi effect flush'indan SONRAKI mikro-goreve erteler,
  // boylece ilk setState effect govdesinde SENKRON olmaz (React 19 set-state-in-effect).
  useAsyncEffect(
    async (alive) => {
      if (alive()) await getir(hedef);
    },
    [tenantKey, hedef],
  );

  const karsilastir = async (yedek: string) => {
    // Yedek de bir values dosyasi: karsilastirma AYNI motorla yapilir.
    const r = await run({ action: 'values_files', targets: [], valuesPaths: [yedek, hedef] });
    if (r) setFark({ yedek, sonuc: r });
  };

  const geriYukle = async () => {
    if (!onay) return;
    const r = await run(onay);
    setOnay(null);
    if (!r) return;
    if (r.results.some((x) => x.ok)) {
      toast.success('Eski sürüm geri yüklendi — mevcut hal de yedeklendi.');
      void getir(hedef);
    } else {
      toast.error(r.results.map((x) => x.message).join(' · ') || 'Geri yüklenemedi.');
    }
  };

  const yedekler = liste?.backups || [];
  const hata = (liste?.errors || []).map((e) => `${e.stage}: ${e.message}`).join(' · ');

  if (files.length === 0) {
    return (
      <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
        Bastion arşivinde values dosyası görünmüyor.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span style={{ color: 'var(--text-muted)' }}>Dosya:</span>
        <select
          className="h-7 px-2 text-[11px] rounded-lg border"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
          }}
          value={hedef}
          onChange={(e) => {
            setHedef(e.target.value);
            setListe(null);
          }}
        >
          {files.map((f) => (
            <option key={f.path} value={f.path}>
              {f.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={SM}
          style={vbtn()}
          disabled={!!busy}
          onClick={() => void getir()}
        >
          <ArrowPathIcon className="h-3.5 w-3.5" /> Yenile
        </button>
        {busy && <LoadingLogo compact />}
      </div>

      {hata && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border flex items-start gap-2"
          style={{
            color: 'var(--status-danger)',
            background: 'var(--status-danger-bg)',
            borderColor: 'var(--status-danger)',
          }}
        >
          <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
          <span>{hata}</span>
        </div>
      )}

      {!busy && liste && yedekler.length === 0 && !hata && (
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          Bu dosyanın yedeği yok — Portal üzerinden hiç yazılmamış olabilir. (Yedekler yalnızca
          Portal yazdığında oluşur; bastion&apos;da elle yapılan değişikliklerin geçmişi burada
          görünmez.)
        </div>
      )}

      {yedekler.length > 0 && (
        <div
          className="overflow-x-auto rounded-lg border"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <table className="w-full text-[11px]">
            <thead>
              <tr style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                <th className="text-left font-medium px-2 py-1">Sürüm (yedek tarihi)</th>
                <th className="text-left font-medium px-2 py-1">Boyut</th>
                <th className="text-left font-medium px-2 py-1"> </th>
              </tr>
            </thead>
            <tbody>
              {yedekler.map((b) => (
                <tr
                  key={b.path}
                  className="border-t"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <td
                    className="px-2 py-1 tabular-nums"
                    style={{ color: 'var(--text-primary)' }}
                    title={b.path}
                  >
                    {yedekTarihi(b.path)}
                  </td>
                  <td className="px-2 py-1 tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {Math.round(b.size / 102.4) / 10} KB
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className={SM}
                        style={vbtn()}
                        disabled={!!busy}
                        onClick={() => void karsilastir(b.path)}
                      >
                        <ScaleIcon className="h-3.5 w-3.5" /> Farkı göster
                      </button>
                      <button
                        type="button"
                        className={SM}
                        style={vbtn('danger')}
                        disabled={!!busy}
                        onClick={() =>
                          setOnay({
                            action: 'values_restore',
                            targets: [],
                            valuesPath: hedef,
                            backupPath: b.path,
                          })
                        }
                      >
                        <ArrowUturnLeftIcon className="h-3.5 w-3.5" /> Bu sürüme dön
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fark && (
        <section className="space-y-1">
          <div
            className="text-[11px] uppercase tracking-wide"
            style={{ color: 'var(--text-muted)' }}
          >
            {yedekTarihi(fark.yedek)} → şu anki dosya
          </div>
          {fark.sonuc.compare && (
            <CompareTable
              compare={fark.sonuc.compare}
              masked={fark.sonuc.masked !== false}
              solEtiket="eski sürüm"
              sagEtiket="şu an"
            />
          )}
        </section>
      )}

      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Geri yükleme yalnızca <b>dosyayı</b> değiştirir; kümeye uygulamak için <b>Rollout</b>{' '}
        gerekir. Geri yüklemeden önce mevcut halin yedeği de alınır.
      </div>

      {onay && (
        <OpsConfirm
          req={onay}
          namespace={namespace}
          tenantLabel={tenantLabel}
          onCancel={() => setOnay(null)}
          onConfirm={() => void geriYukle()}
        />
      )}
    </div>
  );
}

export default ValuesHistory;
