// src/components/crypto_hub/ValuesCompare.tsx — cluster values.yaml karşılaştırması.
//
// Kullanıcı (2026-09-27): "Wyden aktif-pasif yapıda çalışıyor, bu sebeple non-production'da
// her ortam için 2, production'da 3 OpenShift cluster'ına özgü values.yaml var. Bu dosyaları
// da Portal üzerinden karşılaştırabilmek istiyoruz."
//
// KARŞILAŞTIRMA BURADA YAPILMAZ — sunucuda yapılır (server/crypto-hub/values-compare.cjs).
// Sebep: maskeleme her sırrı `****` yapıyor, dolayısıyla maskeli veri üzerinde karşılaştırma
// iki FARKLI parolayı "aynı" gösterirdi. Sunucu ham satırlarda karşılaştırıp yalnızca
// gösterilen değeri maskeliyor; ekran onun sonucunu gösteriyor. İkinci bir karşılaştırma
// kopyası burada tutulsaydı, bir gün maskeli veriyi karşılaştırır ve farkı sessizce yerdi.
import React, { useEffect, useState } from 'react';
import { EyeIcon, EyeSlashIcon, ArrowPathIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { useOps } from './OpsPanel';
import { vbtn } from './ValuesEditor';
import type { CryptoOpsResult } from '@/api/cryptoHubApi';

const SM = 'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';

export function ValuesCompare({ tenantKey, paths }: {
  tenantKey: string;
  /** karşılaştırılacak dosyaların TAM yolları (/vhosting altı), cluster başına bir tane */
  paths: string[];
}) {
  const { run, busy } = useOps(tenantKey);
  const [sonuc, setSonuc] = useState<CryptoOpsResult | null>(null);
  const [hata, setHata] = useState('');
  const [maskeli, setMaskeli] = useState(true);

  const getir = async (reveal: boolean) => {
    setHata('');
    const r = await run({ action: 'values_files', targets: [], valuesPaths: paths, reveal });
    if (!r) return;
    setSonuc(r);
    setMaskeli(r.masked !== false);
    // Betik asamasi dustuyse bunu SOYLE: bos bir tablo "fark yok" gibi okunurdu.
    if (r.errors?.length) setHata(r.errors.map((e) => `${e.stage}: ${e.message}`).join(' · '));
  };

  useEffect(() => { void getir(false); }, [tenantKey, paths.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const k = sonuc?.compare;
  const bas = 'text-left font-medium px-2 py-1 whitespace-nowrap';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={SM} style={vbtn()} disabled={!!busy}
          onClick={() => void getir(false)}>
          <ArrowPathIcon className="h-3.5 w-3.5" /> Yenile
        </button>
        <button type="button" className={SM} style={vbtn()} disabled={!!busy}
          onClick={() => void getir(maskeli)}>
          {maskeli ? <EyeIcon className="h-3.5 w-3.5" /> : <EyeSlashIcon className="h-3.5 w-3.5" />}
          {maskeli ? 'Gerçek değerleri göster' : 'Maskele'}
        </button>
        {busy && <LoadingLogo compact />}
        {busy && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          bastion&apos;dan {paths.length} dosya okunuyor…
        </span>}
      </div>

      {hata && (
        <div className="text-[12px] rounded-lg px-3 py-2 border flex items-start gap-2"
          style={{ color: 'var(--status-danger)', background: 'var(--status-danger-bg)', borderColor: 'var(--status-danger)' }}>
          <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
          <span>{hata}</span>
        </div>
      )}

      {!busy && k && (
        <>
          {/* IKIDEN AZ dosya okunduysa "uyumlu" DEMEK YANLIS: tablo yerine bunu goster. */}
          {!k.karsilastirilabilir ? (
            <div className="text-[12px] rounded-lg px-3 py-2 border"
              style={{ color: 'var(--status-warning)', background: 'var(--status-warning-bg)', borderColor: 'var(--status-warning)' }}>
              Karşılaştırma için en az iki dosya okunabilmeli — okunan: {k.okunan.length}.
              Bu <b>&quot;fark yok&quot;</b> anlamına gelmez.
              {k.okunamayan.length > 0 && (
                <ul className="mt-1 ml-4 list-disc">
                  {k.okunamayan.map((f) => <li key={f.path}><code>{f.path}</code> — {f.error}</li>)}
                </ul>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 text-[12px]">
                <span style={{ color: 'var(--text-secondary)' }}>
                  <b style={{ color: k.farkliSayi ? 'var(--status-warning)' : 'var(--status-success)' }}>
                    {k.farkliSayi}
                  </b> farklı ayar / {k.anahtarSayi} anahtar · {k.okunan.length} cluster
                </span>
                {k.farkliSayi === 0 && (
                  <span style={{ color: 'var(--status-success)' }}>
                    ● okunan cluster dosyaları birbiriyle uyumlu
                  </span>
                )}
                {maskeli && (
                  <span style={{ color: 'var(--text-muted)' }}>
                    sır değerleri <code>****</code> — fark tespiti ham içerikte yapılır, maske
                    yalnızca gösterimi gizler
                  </span>
                )}
              </div>

              {/* OKUNAMAYAN DOSYA "FARK YOK" DEMEK DEGIL: ayrica ve gorunur sekilde soyleniyor. */}
              {k.okunamayan.length > 0 && (
                <div className="text-[12px] rounded-lg px-3 py-2 border"
                  style={{ color: 'var(--status-danger)', background: 'var(--status-danger-bg)', borderColor: 'var(--status-danger)' }}>
                  {k.okunamayan.length} dosya okunamadı ve karşılaştırmaya <b>girmedi</b> — bu
                  &quot;fark yok&quot; anlamına gelmez:
                  <ul className="mt-1 ml-4 list-disc">
                    {k.okunamayan.map((f) => <li key={f.path}><code>{f.path}</code> — {f.error}</li>)}
                  </ul>
                </div>
              )}

              <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
                <table className="w-full text-[11px]">
                  <thead>
                    <tr style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                      <th className={bas}>Ayar</th>
                      {k.okunan.map((f) => (
                        <th key={f.path} className={bas} title={f.path}>{f.cluster}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {k.satirlar.map((s) => (
                      <tr key={s.anahtar} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                        <td className="px-2 py-1 font-mono" style={{ color: 'var(--text-primary)' }}>
                          {s.anahtar}
                          {s.sirli && maskeli && (
                            <span className="ml-1" style={{ color: 'var(--text-muted)' }} title="sır: fark var, değer gösterilmiyor">sır</span>
                          )}
                        </td>
                        {s.degerler.map((v, i) => (
                          <td key={k.okunan[i].path} className="px-2 py-1 font-mono"
                            style={{ color: v === null ? 'var(--status-danger)' : 'var(--status-warning)' }}>
                            {v === null ? '(yok)' : v}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {k.satirlar.length === 0 && (
                      <tr><td className="px-2 py-3 text-center" colSpan={k.okunan.length + 1}
                        style={{ color: 'var(--text-muted)' }}>
                        Okunan {k.okunan.length} dosyanın tüm ayarları aynı.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default ValuesCompare;
