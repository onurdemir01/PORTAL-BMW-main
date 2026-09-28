// src/components/crypto_hub/RolloutApply.tsx — rollout: values'ı Portal'dan uygula.
//
// Kullanıcı (2026-09-28): "bazen kullanıcılar sadece values.yaml'ı değiştirip mevcut sürümü
// güncellemek istiyorlar — aslında helm upgrade ile mevcut sürümün sadece value'sunu
// değiştiriyorlar." + "yapılan değişiklik uygulanmadan önce diff gösterimi rica ediyorum"
// + "kullanıcı isterse helm template çalıştıralım, oluşacak objeleri görsün."
//
// ÜÇ ADIM, HEPSİ İSTEĞE BAĞLI AMA SIRALI OKUNUYOR:
//   1. FARK      — canlıda ne var, uygulanınca ne olacak (values_diff, SALT OKUNUR)
//   2. ÖNİZLEME  — hangi nesneler üretilecek (helm_template, SALT OKUNUR)
//   3. UYGULA    — helm upgrade (YAZAR, onay penceresinden geçer)
//
// SÜRÜM DEĞİŞMEZ. Bu bir vaat değil, iki yerde ölçülen bir kısıt: chart ve koşan sürüm
// SUNUCUDA çözülür (istemcinin gönderdiği dikkate alınmaz), bastion'daki betik de koşan
// sürümü kendisi okuyup Portal'ın bildiğiyle karşılaştırır; tutmuyorsa hiçbir şey yapmaz.
//
// ROUTE TUZAĞI: runbook "helm upgrade bazen route'ları siliyor" diyor. Bu uyarı planda
// yazılıydı ama okunmayabilir; artık route listesi upgrade ÖNCESİ ve SONRASI ölçülüyor ve
// kaybolan varsa ekranda kırmızı olarak gösteriliyor.
import React, { useState } from 'react';
import {
  ArrowPathIcon,
  PlayIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  DocumentMagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { useOps, OpsConfirm, type OpsRequest } from './OpsPanel';
import { vbtn, type ValuesFileOption } from './ValuesEditor';
import { CompareTable } from './ValuesCompare';
import { ValuesHistory } from './ValuesHistory';
import type { CryptoOpsResult } from '@/api/cryptoHubApi';
import { toast } from '@/hooks/useToast';

const SM =
  'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';

export function RolloutApply({
  tenantKey,
  tenantLabel,
  namespace,
  release,
  running,
  files,
  onApplied,
}: {
  tenantKey: string;
  tenantLabel: string;
  namespace: string;
  release: string;
  /** koşan sürüm — yalnız gösterim; karar sunucudaki değerle verilir */
  running: string;
  files: ValuesFileOption[];
  onApplied?: () => void;
}) {
  const { run, busy } = useOps(tenantKey);
  const [hedef, setHedef] = useState(files[0]?.path || '');
  const [fark, setFark] = useState<CryptoOpsResult | null>(null);
  const [onizleme, setOnizleme] = useState<CryptoOpsResult | null>(null);
  const [sonuc, setSonuc] = useState<CryptoOpsResult | null>(null);
  const [manifest, setManifest] = useState(false);
  const [gecmis, setGecmis] = useState(false);
  const [onay, setOnay] = useState<OpsRequest | null>(null);

  const hata = (r: CryptoOpsResult | null) =>
    (r?.errors || []).map((e) => `${e.stage}: ${e.message}`).join(' · ');

  const farkGetir = async () => {
    setSonuc(null);
    const r = await run({ action: 'values_diff', targets: [], release, valuesPath: hedef });
    if (r) setFark(r);
  };

  const onizle = async () => {
    const r = await run({ action: 'helm_template', targets: [], release, valuesPath: hedef });
    if (r) {
      setOnizleme(r);
      setManifest(false);
    }
  };

  const uygula = async () => {
    if (!onay) return;
    const r = await run(onay);
    setOnay(null);
    if (!r) return;
    setSonuc(r);
    if (r.results.some((x) => x.ok)) {
      toast.success('helm upgrade geçti — sürüm değişmedi.');
      onApplied?.();
    } else {
      toast.error(r.results.map((x) => x.message).join(' · ') || 'Uygulanamadı.');
    }
  };

  // Kaybolan route: ONCE'de olup SONRA'da olmayan. Bos liste "kayip yok" DEMEK DEGIL -
  // olcum yapilamamis da olabilir; asagida ikisi ayri yaziliyor.
  const olculdu =
    !!sonuc?.routes && (sonuc.routes.once.length > 0 || sonuc.routes.sonra.length > 0);
  const kaybolan = olculdu
    ? sonuc!.routes!.once.filter((r) => !sonuc!.routes!.sonra.includes(r))
    : [];

  if (files.length === 0) {
    return (
      <div
        className="text-[12px] rounded-lg px-3 py-2 border"
        style={{
          color: 'var(--status-warning)',
          background: 'var(--status-warning-bg)',
          borderColor: 'var(--status-warning)',
        }}
      >
        Bastion arşivinde uygulanabilecek bir values dosyası görünmüyor — Portal&apos;dan uygulama
        açılmadı. Plan penceresindeki komutu kullanabilirsiniz.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span style={{ color: 'var(--text-muted)' }}>Uygulanacak dosya:</span>
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
            setFark(null);
            setOnizleme(null);
            setSonuc(null);
          }}
        >
          {files.map((f) => (
            <option key={f.path} value={f.path}>
              {f.label}
            </option>
          ))}
        </select>
        <span style={{ color: 'var(--text-muted)' }}>
          · sürüm <b style={{ color: 'var(--text-primary)' }}>{running || '—'}</b> değişmeyecek
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={SM}
          style={vbtn()}
          disabled={!!busy || !hedef}
          onClick={() => void farkGetir()}
        >
          <ArrowPathIcon className="h-3.5 w-3.5" /> 1. Farkı göster
        </button>
        <button
          type="button"
          className={SM}
          style={vbtn()}
          disabled={!!busy || !hedef}
          onClick={() => void onizle()}
        >
          <DocumentMagnifyingGlassIcon className="h-3.5 w-3.5" /> 2. helm template ile önizle
        </button>
        <button
          type="button"
          className={SM}
          style={vbtn('primary')}
          disabled={!!busy || !hedef}
          onClick={() =>
            setOnay({ action: 'helm_upgrade', targets: [], release, valuesPath: hedef })
          }
        >
          <PlayIcon className="h-3.5 w-3.5" /> 3. Uygula (helm upgrade)
        </button>
        {busy && <LoadingLogo compact />}
        <button type="button" className={SM} style={vbtn()} onClick={() => setGecmis((x) => !x)}>
          <ClockIcon className="h-3.5 w-3.5" /> {gecmis ? 'Geçmişi gizle' : 'Eski sürümler'}
        </button>
        {busy === 'helm_upgrade' && (
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            helm upgrade sürüyor (10 dakikaya kadar bekleyebilir)…
          </span>
        )}
      </div>

      {/* ESKI SURUMLER: gecmis zaten diskte (.bak); burada gorunur oluyor. */}
      {gecmis && (
        <section className="rounded-lg border p-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <ValuesHistory
            tenantKey={tenantKey}
            tenantLabel={tenantLabel}
            namespace={namespace}
            files={files}
          />
        </section>
      )}

      {/* 1. FARK */}
      {fark && (
        <section className="space-y-1">
          <div
            className="text-[11px] uppercase tracking-wide"
            style={{ color: 'var(--text-muted)' }}
          >
            Canlıdaki değerler → uygulanacak dosya
          </div>
          {hata(fark) && (
            <div
              className="text-[12px] rounded-lg px-3 py-2 border flex items-start gap-2"
              style={{
                color: 'var(--status-danger)',
                background: 'var(--status-danger-bg)',
                borderColor: 'var(--status-danger)',
              }}
            >
              <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
              <span>{hata(fark)}</span>
            </div>
          )}
          {fark.compare && (
            <CompareTable
              compare={fark.compare}
              masked={fark.masked !== false}
              solEtiket="canlı (helm)"
              sagEtiket="uygulanacak dosya"
            />
          )}
        </section>
      )}

      {/* 2. ONIZLEME */}
      {onizleme && (
        <section className="space-y-1">
          <div
            className="text-[11px] uppercase tracking-wide"
            style={{ color: 'var(--text-muted)' }}
          >
            Oluşacak nesneler ({onizleme.template?.objects.length || 0})
          </div>
          {hata(onizleme) ? (
            <div
              className="text-[12px] rounded-lg px-3 py-2 border flex items-start gap-2"
              style={{
                color: 'var(--status-danger)',
                background: 'var(--status-danger-bg)',
                borderColor: 'var(--status-danger)',
              }}
            >
              <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
              <span>{hata(onizleme)}</span>
            </div>
          ) : (
            <>
              <div
                className="rounded-lg border overflow-x-auto"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <table className="w-full text-[11px]">
                  <thead>
                    <tr style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                      <th className="text-left font-medium px-2 py-1">Tür</th>
                      <th className="text-left font-medium px-2 py-1">Ad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(onizleme.template?.objects || []).map((o, i) => (
                      <tr
                        key={`${o.kind}/${o.name}/${i}`}
                        className="border-t"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        <td
                          className="px-2 py-1 font-mono"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {o.kind}
                        </td>
                        <td
                          className="px-2 py-1 font-mono"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {o.name}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Bu liste <b>ne üretileceğini</b> gösterir; kümenin kabul edeceğinin garantisi
                değildir (önizleme kümeye bağlanmaz).{' '}
                <button type="button" className="underline" onClick={() => setManifest((x) => !x)}>
                  {manifest
                    ? 'ham manifesti gizle'
                    : `ham manifesti göster (${onizleme.template?.lines.length || 0} satır)`}
                </button>
              </div>
              {manifest && (
                <pre
                  className="text-[10px] leading-relaxed rounded-lg border p-2 overflow-auto max-h-80"
                  style={{
                    borderColor: 'var(--border-subtle)',
                    background: 'var(--bg-elevated)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {(onizleme.template?.lines || []).join('\n')}
                </pre>
              )}
            </>
          )}
        </section>
      )}

      {/* 3. SONUC */}
      {sonuc && (
        <section className="space-y-1">
          {sonuc.results.map((r, i) => (
            <div
              key={i}
              className="text-[12px] rounded-lg px-3 py-2 border flex items-start gap-2"
              style={
                r.ok
                  ? {
                      color: 'var(--status-success)',
                      background: 'var(--status-success-bg)',
                      borderColor: 'var(--status-success)',
                    }
                  : {
                      color: 'var(--status-danger)',
                      background: 'var(--status-danger-bg)',
                      borderColor: 'var(--status-danger)',
                    }
              }
            >
              {r.ok ? (
                <CheckCircleIcon className="h-4 w-4 shrink-0" />
              ) : (
                <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
              )}
              <span>{r.message}</span>
            </div>
          ))}
          {/* ROUTE OLCUMU: "kayip yok" ile "olculemedi" AYRI SEY. */}
          {kaybolan.length > 0 ? (
            <div
              className="text-[12px] rounded-lg px-3 py-2 border"
              style={{
                color: 'var(--status-danger)',
                background: 'var(--status-danger-bg)',
                borderColor: 'var(--status-danger)',
              }}
            >
              <b>{kaybolan.length} route KAYBOLDU</b> (runbook bunu uyarıyordu — gerekirse upgrade
              ikinci kez koşulur):
              <ul className="mt-1 ml-4 list-disc">
                {kaybolan.map((r) => (
                  <li key={r}>
                    <code>{r}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : olculdu ? (
            <div className="text-[11px]" style={{ color: 'var(--status-success)' }}>
              ● route kaybı yok — önce {sonuc.routes!.once.length}, sonra{' '}
              {sonuc.routes!.sonra.length} route.
            </div>
          ) : (
            <div className="text-[11px]" style={{ color: 'var(--status-warning)' }}>
              ? route sayımı ölçülemedi — &quot;kayıp yok&quot; anlamına gelmez,{' '}
              <code>oc get route</code> ile bakın.
            </div>
          )}
        </section>
      )}

      {onay && (
        <OpsConfirm
          req={onay}
          namespace={namespace}
          tenantLabel={tenantLabel}
          onCancel={() => setOnay(null)}
          onConfirm={() => void uygula()}
        />
      )}
    </div>
  );
}

export default RolloutApply;
