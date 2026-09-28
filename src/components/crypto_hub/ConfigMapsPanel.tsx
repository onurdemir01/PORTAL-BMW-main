// src/components/crypto_hub/ConfigMapsPanel.tsx — config map görüntüleme ve düzenleme.
//
// Kullanıcı (2026-09-28): "Crypto Hub'a config map'leri editleyebilmeleri için bir özellik
// ekle. Mesela Ledger Accounting Config Map'i değiştirilince Ledger Accounting'in rollout
// edilmesi gerektiğinde oraya yazalım."
//
// EKRANIN EN ÖNEMLİ İŞİ "KAYDEDİLDİ" İLE "YÜRÜRLÜĞE GİRDİ" ARASINDAKİ FARKI SÖYLEMEK:
// config map güncellenince çalışan pod'lar ESKİ değerlerle koşmaya devam eder. Env olarak
// verilmiş değerler hiç değişmez; dosya olarak mount edilmişse kubelet birkaç dakikada
// tazeler ama uygulama çoğu zaman değeri başlangıçta okur. Bu yüzden yazmadan sonra ekran
// rollout gerektiğini söyler ve hangi bileşenin yeniden başlatılacağını gösterir.
//
// HANGİ BİLEŞEN: shared/cryptoHubConfigMaps.cjs üç durumu AYIRIR — kayıtlı eşleşme,
// addan çıkarılmış TAHMİN, ve hiç bilinmiyor. Tahmini kesinmiş gibi göstermek, yanlış
// bileşeni rollout ettirebilirdi.
//
// HELM'İN YÖNETTİĞİ config map'ler işaretlenir: elle yapılan değişiklik bir sonraki
// `helm upgrade`de sessizce geri alınır — kullanıcı bunu bilerek karar vermeli.
import React, { useState } from 'react';
import {
  ArrowPathIcon,
  PencilSquareIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ArrowUturnLeftIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { useOps, OpsConfirm, type OpsRequest } from './OpsPanel';
import { vbtn, diffLines } from './ValuesEditor';
import type { CryptoOpsResult } from '@/api/cryptoHubApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { toast } from '@/hooks/useToast';

const SM =
  'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';

// ESLESME SUNUCUDAN GELIR (shared/cryptoHubConfigMaps.cjs): istemci `shared/` altindan
// import edemiyor ve iki kopya tutmak, bir gun birinin eskimesi demekti.
type Hedef = { kaynak: 'kayitli' | 'tahmin' | 'yok'; targets: string[]; note: string };
const HEDEFSIZ: Hedef = {
  kaynak: 'yok',
  targets: [],
  note:
    'Bu config map için rollout hedefi kayıtlı değil — hangi bileşenin yeniden ' +
    'başlatılacağını Podlar sekmesinden seçin.',
};

export function ConfigMapsPanel({
  tenantKey,
  tenantLabel,
  namespace,
}: {
  tenantKey: string;
  tenantLabel: string;
  namespace: string;
}) {
  const { run, busy } = useOps(tenantKey);
  const [liste, setListe] = useState<CryptoOpsResult | null>(null);
  const [secili, setSecili] = useState<string>('');
  const [veri, setVeri] = useState<{ key: string; value: string }[] | null>(null);
  const [taslak, setTaslak] = useState<Record<string, string>>({});
  const [onay, setOnay] = useState<OpsRequest | null>(null);
  const [yazildi, setYazildi] = useState<{ cm: string; hedef: Hedef } | null>(null);

  const listeyiGetir = async () => {
    const r = await run({ action: 'configmaps', targets: [] });
    if (r) setListe(r);
  };

  useAsyncEffect(
    async (alive) => {
      if (alive()) await listeyiGetir();
    },
    [tenantKey],
  );

  const ac = async (ad: string) => {
    setSecili(ad);
    setVeri(null);
    setYazildi(null);
    const r = await run({ action: 'configmap_get', targets: [], cmName: ad });
    if (!r) return;
    const d = r.configMapData || [];
    setVeri(d);
    setTaslak(Object.fromEntries(d.map((x) => [x.key, x.value])));
  };

  const degisenler = (veri || [])
    .filter((x) => taslak[x.key] !== undefined && taslak[x.key] !== x.value)
    .map((x) => ({ key: x.key, eski: x.value, yeni: taslak[x.key] }));

  const kaydet = () => {
    if (!degisenler.length) return;
    setOnay({
      action: 'configmap_put',
      targets: [],
      cmName: secili,
      // YALNIZ DEGISENLER gonderilir: dokunulmamis anahtarlari da yazmak, arada baskasinin
      // yaptigi bir degisikligi sessizce geri almak olurdu.
      data: Object.fromEntries(degisenler.map((d) => [d.key, d.yeni])),
    });
  };

  const yaz = async () => {
    if (!onay) return;
    const r = await run(onay);
    setOnay(null);
    if (!r) return;
    if (r.results.some((x) => x.ok && /guncellendi/i.test(x.message))) {
      toast.success('Config map güncellendi — pod’lara yansıması için rollout gerekiyor.');
      // Eslesme LISTEDEN gelir (sunucu cozer); liste tazelenmemisse HEDEFSIZ'e duseriz -
      // uydurulmus bir hedef, yanlis bileseni rollout ettirebilirdi.
      const ozet = (liste?.configMaps || []).find((c) => c.name === secili);
      setYazildi({ cm: secili, hedef: (ozet && ozet.rollout) || HEDEFSIZ });
      void ac(secili);
    } else {
      toast.error(r.results.map((x) => x.message).join(' · ') || 'Yazılamadı.');
    }
  };

  const rollout = async (hedefler: string[]) => {
    const r = await run({ action: 'rollout', targets: hedefler });
    if (r && r.results.some((x) => x.ok)) {
      toast.success('Rollout başlatıldı — değişiklik yeni pod’larla yürürlüğe girecek.');
      setYazildi(null);
    } else if (r) {
      toast.error(r.results.map((x) => x.message).join(' · ') || 'Rollout başlatılamadı.');
    }
  };

  const cmler = liste?.configMaps || [];
  const hata = (liste?.errors || []).map((e) => `${e.stage}: ${e.message}`).join(' · ');
  const secilenOzet = cmler.find((c) => c.name === secili);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={SM}
          style={vbtn()}
          disabled={!!busy}
          onClick={() => void listeyiGetir()}
        >
          <ArrowPathIcon className="h-3.5 w-3.5" /> Yenile
        </button>
        {busy && <LoadingLogo compact />}
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {namespace} · {cmler.length} config map
        </span>
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

      {/* YAZMA SONRASI: "kaydedildi" ile "yururluge girdi" farki. */}
      {yazildi && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border space-y-1"
          style={{
            color: 'var(--status-warning)',
            background: 'var(--status-warning-bg)',
            borderColor: 'var(--status-warning)',
          }}
        >
          <div>
            <b>{yazildi.cm}</b> güncellendi ama <b>pod’lara yansımadı</b> — çalışan pod’lar eski
            değerlerle koşuyor.
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>{yazildi.hedef.note}</div>
          {yazildi.hedef.targets.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span style={{ color: 'var(--text-secondary)' }}>
                {yazildi.hedef.kaynak === 'kayitli' ? 'Rollout edilecek:' : 'Önerilen (tahmin):'}
              </span>
              {yazildi.hedef.targets.map((t) => (
                <code key={t} className="text-[11px]">
                  {t}
                </code>
              ))}
              <button
                type="button"
                className={SM}
                style={vbtn('primary')}
                disabled={!!busy}
                onClick={() => void rollout(yazildi.hedef.targets)}
              >
                <BoltIcon className="h-3.5 w-3.5" /> Rollout et
              </button>
            </div>
          ) : (
            <div style={{ color: 'var(--text-secondary)' }}>
              Rollout hedefi bilinmiyor — Podlar sekmesinden ilgili bileşeni elle rollout edin.
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-[18rem_1fr]">
        {/* LISTE */}
        <div
          className="rounded-lg border overflow-auto max-h-96"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          {cmler.length === 0 && !busy ? (
            <div className="px-3 py-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Config map bulunamadı.
            </div>
          ) : (
            cmler.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => void ac(c.name)}
                className="w-full text-left px-3 py-1.5 border-b hover:bg-[var(--bg-elevated)]"
                style={{
                  borderColor: 'var(--border-subtle)',
                  background: c.name === secili ? 'var(--bg-elevated)' : undefined,
                }}
              >
                <div className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>
                  {c.name}
                </div>
                <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {c.keys} anahtar
                  {c.managedBy && <> · {c.managedBy} yönetiyor</>}
                </div>
              </button>
            ))
          )}
        </div>

        {/* DUZENLEME */}
        <div className="space-y-2">
          {!secili ? (
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Soldan bir config map seçin.
            </div>
          ) : (
            <>
              {/* HELM UYARISI: elle degisiklik bir sonraki upgrade'de geri alinir. */}
              {secilenOzet?.managedBy && (
                <div
                  className="text-[11px] rounded-lg px-3 py-2 border"
                  style={{
                    color: 'var(--status-warning)',
                    background: 'var(--status-warning-bg)',
                    borderColor: 'var(--status-warning)',
                  }}
                >
                  Bu config map’i <b>{secilenOzet.managedBy}</b> yönetiyor: elle yaptığınız
                  değişiklik bir sonraki <b>helm upgrade</b>’de geri alınır. Kalıcı olması için
                  değeri values.yaml tarafında değiştirin.
                </div>
              )}

              {veri === null ? (
                busy ? (
                  <LoadingLogo compact />
                ) : null
              ) : veri.length === 0 ? (
                <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  Bu config map’in <code>data</code> alanı boş.
                </div>
              ) : (
                <div className="space-y-2">
                  {veri.map((x) => {
                    const degisti = taslak[x.key] !== x.value;
                    const cokSatir = x.value.includes('\n') || x.value.length > 80;
                    return (
                      <label key={x.key} className="block space-y-1">
                        <span
                          className="text-[10px] uppercase tracking-wide font-mono"
                          style={{ color: degisti ? 'var(--status-warning)' : 'var(--text-muted)' }}
                        >
                          {x.key}
                          {degisti && ' · değişti'}
                        </span>
                        {cokSatir ? (
                          <textarea
                            value={taslak[x.key] ?? ''}
                            onChange={(e) => setTaslak({ ...taslak, [x.key]: e.target.value })}
                            rows={Math.min(12, x.value.split('\n').length + 1)}
                            className="w-full text-[11px] font-mono rounded-lg border px-2 py-1.5"
                            style={{
                              borderColor: degisti ? 'var(--status-warning)' : 'var(--border)',
                              background: 'var(--bg-surface)',
                              color: 'var(--text-primary)',
                            }}
                          />
                        ) : (
                          <input
                            value={taslak[x.key] ?? ''}
                            onChange={(e) => setTaslak({ ...taslak, [x.key]: e.target.value })}
                            className="w-full text-[11px] font-mono rounded-lg border px-2 py-1.5"
                            style={{
                              borderColor: degisti ? 'var(--status-warning)' : 'var(--border)',
                              background: 'var(--bg-surface)',
                              color: 'var(--text-primary)',
                            }}
                          />
                        )}
                      </label>
                    );
                  })}

                  {/* FARK: onaydan once ne degisecegi satir satir gorunur. */}
                  {degisenler.length > 0 && (
                    <div
                      className="rounded-lg border p-2 space-y-1"
                      style={{
                        borderColor: 'var(--border-subtle)',
                        background: 'var(--bg-elevated)',
                      }}
                    >
                      <div
                        className="text-[11px] uppercase tracking-wide"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {degisenler.length} anahtar değişecek
                      </div>
                      {degisenler.map((d) => {
                        const f = diffLines(d.eski, d.yeni);
                        return (
                          <div key={d.key} className="text-[10px] font-mono">
                            <div style={{ color: 'var(--text-secondary)' }}>{d.key}</div>
                            {f.cikarilan.slice(0, 5).map((l, i) => (
                              <div key={`e${i}`} style={{ color: 'var(--status-danger)' }}>
                                - {l}
                              </div>
                            ))}
                            {f.eklenen.slice(0, 5).map((l, i) => (
                              <div key={`y${i}`} style={{ color: 'var(--status-success)' }}>
                                + {l}
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={SM}
                      style={vbtn('primary')}
                      disabled={!!busy || degisenler.length === 0}
                      onClick={kaydet}
                    >
                      <PencilSquareIcon className="h-3.5 w-3.5" /> Kaydet ({degisenler.length})
                    </button>
                    <button
                      type="button"
                      className={SM}
                      style={vbtn()}
                      disabled={!!busy || degisenler.length === 0}
                      onClick={() =>
                        setTaslak(Object.fromEntries(veri.map((x) => [x.key, x.value])))
                      }
                    >
                      <ArrowUturnLeftIcon className="h-3.5 w-3.5" /> Değişiklikleri geri al
                    </button>
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      Yazmadan önce yedek alınır; pod’lar yeniden başlatılmaz.
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {onay && (
        <OpsConfirm
          req={onay}
          namespace={namespace}
          tenantLabel={tenantLabel}
          onCancel={() => setOnay(null)}
          onConfirm={() => void yaz()}
        />
      )}

      {yazildi === null && secili && veri && veri.length > 0 && degisenler.length === 0 && (
        <div className="text-[11px] flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
          <CheckCircleIcon className="h-3.5 w-3.5" /> Kaydedilmemiş değişiklik yok.
        </div>
      )}
    </div>
  );
}

export default ConfigMapsPanel;
