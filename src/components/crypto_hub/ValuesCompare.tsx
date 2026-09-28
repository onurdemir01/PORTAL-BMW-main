// src/components/crypto_hub/ValuesCompare.tsx — cluster values.yaml karşılaştırması.
//
// Kullanıcı (2026-09-27): "Wyden aktif-pasif yapıda çalışıyor, bu sebeple non-production'da
// her ortam için 2, production'da 3 OpenShift cluster'ına özgü values.yaml var. Bu dosyaları
// da Portal üzerinden karşılaştırabilmek istiyoruz."
//
// EŞİTLEME (2026-09-28, kullanıcı): tabloda görülen farkı hedef cluster'a yazmak. Yazma
// YİNE `values_put` ile olur (yedek alır, denetime yazar); bu ekran yalnızca hangi ayarın
// yazılacağını seçtirir. İçeriği sunucu üretir (values-compare.cjs `uygula`) — YAML mantığı
// tek kopya kalsın diye: "farklı" diyen ile "yazan" bir gün ayrışırsa, yanlış satır yazılır.
//
// KARŞILAŞTIRMA BURADA YAPILMAZ — sunucuda yapılır (server/crypto-hub/values-compare.cjs).
// Sebep: maskeleme her sırrı `****` yapıyor, dolayısıyla maskeli veri üzerinde karşılaştırma
// iki FARKLI parolayı "aynı" gösterirdi. Sunucu ham satırlarda karşılaştırıp yalnızca
// gösterilen değeri maskeliyor; ekran onun sonucunu gösteriyor. İkinci bir karşılaştırma
// kopyası burada tutulsaydı, bir gün maskeli veriyi karşılaştırır ve farkı sessizce yerdi.
import React, { useEffect, useState } from 'react';
import {
  EyeIcon,
  EyeSlashIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  ArrowRightCircleIcon,
} from '@heroicons/react/24/outline';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { useOps } from './OpsPanel';
import { vbtn } from './ValuesEditor';
import { cryptoOpsApi, type CryptoOpsResult } from '@/api/cryptoHubApi';
import { toast } from '@/hooks/useToast';

const SM =
  'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';

export function ValuesCompare({
  tenantKey,
  paths,
}: {
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

  useEffect(() => {
    void getir(false);
  }, [tenantKey, paths.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const k = sonuc?.compare;

  // ── ESITLEME DURUMU ──────────────────────────────────────────────────────────────
  const [kaynakIdx, setKaynakIdx] = useState(0);
  const [hedefIdx, setHedefIdx] = useState(1);
  const [secili, setSecili] = useState<string[]>([]);
  const [yaziyor, setYaziyor] = useState(false);

  const cevir = (anahtar: string) =>
    setSecili((x) => (x.includes(anahtar) ? x.filter((a) => a !== anahtar) : [...x, anahtar]));

  const esitle = async () => {
    if (!k || !sonuc) return;
    const kaynak = k.okunan[kaynakIdx];
    const hedef = k.okunan[hedefIdx];
    if (!kaynak || !hedef || kaynak.path === hedef.path) {
      toast.error('Kaynak ve hedef aynı olamaz.');
      return;
    }
    const hedefDosya = (sonuc.files || []).find((f) => f.path === hedef.path);
    if (!hedefDosya || hedefDosya.error) {
      toast.error('Hedef dosya okunamadı.');
      return;
    }

    // Degerler tablodan DEGIL, karsilastirmanin kendisinden alinir; tablo maskeli
    // gosterebilir ve maskeli bir degeri yazmak gercek parolayi silmek olurdu.
    const secimler = k.satirlar
      .filter((r) => secili.includes(r.anahtar))
      .map((r) => ({ anahtar: r.anahtar, deger: r.degerler[kaynakIdx] }))
      .filter((x): x is { anahtar: string; deger: string } => x.deger !== null);
    if (!secimler.length) {
      toast.error('Kaynakta değeri olmayan ayar yazılamaz.');
      return;
    }

    setYaziyor(true);
    try {
      const on = await cryptoOpsApi.valuesApply({
        tenant: tenantKey,
        lines: hedefDosya.lines,
        secimler,
      });
      if (!on.ok || !on.content) {
        toast.error(on.message || 'İçerik üretilemedi.');
        return;
      }
      const r = await run({
        action: 'values_put',
        targets: [],
        valuesPath: hedef.path,
        content: on.content,
      });
      if (!r) return;
      if (r.results.some((x) => x.ok && /yaz/i.test(x.message))) {
        const atlandi = (on.atlanan || []).length;
        toast.success(
          `${(on.degisen || []).length} ayar ${hedef.cluster} dosyasına yazıldı` +
            (atlandi ? ` · ${atlandi} ayar eklenemedi (elle eklenmeli)` : ''),
        );
        setSecili([]);
        void getir(!maskeli);
      } else {
        toast.error(r.results.map((x) => x.message).join(' · ') || 'Yazılamadı.');
      }
    } finally {
      setYaziyor(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={SM}
          style={vbtn()}
          disabled={!!busy}
          onClick={() => void getir(false)}
        >
          <ArrowPathIcon className="h-3.5 w-3.5" /> Yenile
        </button>
        <button
          type="button"
          className={SM}
          style={vbtn()}
          disabled={!!busy}
          onClick={() => void getir(maskeli)}
        >
          {maskeli ? <EyeIcon className="h-3.5 w-3.5" /> : <EyeSlashIcon className="h-3.5 w-3.5" />}
          {maskeli ? 'Gerçek değerleri göster' : 'Maskele'}
        </button>
        {busy && <LoadingLogo compact />}
        {busy && (
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            bastion&apos;dan {paths.length} dosya okunuyor…
          </span>
        )}
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

      {!busy && k && (
        <CompareTable
          compare={k}
          masked={maskeli}
          secili={secili}
          onSec={maskeli ? undefined : cevir}
        />
      )}

      {/* ── ESITLEME ──────────────────────────────────────────────────────────────── */}
      {!busy && k && k.karsilastirilabilir && k.farkliSayi > 0 && (
        <div
          className="rounded-lg border p-2 space-y-2"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          {maskeli ? (
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Eşitleme için gerçek değerler gerekiyor: maskeli metni yazmak parolaları
              <code> ****</code> ile değiştirirdi. Önce <b>Gerçek değerleri göster</b>.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span style={{ color: 'var(--text-muted)' }}>Kaynak</span>
                <select
                  className="h-7 px-2 rounded-lg border"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                  }}
                  value={kaynakIdx}
                  onChange={(e) => setKaynakIdx(Number(e.target.value))}
                >
                  {k.okunan.map((f, i) => (
                    <option key={f.path} value={i}>
                      {f.cluster}
                    </option>
                  ))}
                </select>
                <ArrowRightCircleIcon className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
                <span style={{ color: 'var(--text-muted)' }}>Hedef</span>
                <select
                  className="h-7 px-2 rounded-lg border"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                  }}
                  value={hedefIdx}
                  onChange={(e) => setHedefIdx(Number(e.target.value))}
                >
                  {k.okunan.map((f, i) => (
                    <option key={f.path} value={i}>
                      {f.cluster}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={SM}
                  style={vbtn('primary')}
                  disabled={!!busy || yaziyor || secili.length === 0 || kaynakIdx === hedefIdx}
                  onClick={() => void esitle()}
                >
                  Seçili {secili.length} ayarı hedefe yaz
                </button>
                {yaziyor && <LoadingLogo compact />}
              </div>
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Hedef dosyanın <b>yedeği alınır</b>; yalnızca <b>var olan</b> anahtarlar güncellenir
                — hedefte hiç bulunmayan anahtar, nereye ekleneceği belirsiz olduğu için yazılmaz ve
                size ayrıca bildirilir. Yazma kümeye dokunmaz; uygulamak için <b>Rollout</b>{' '}
                gerekir.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default ValuesCompare;

/** Karsilastirma SONUCUNU cizer. Hesap SUNUCUDA yapilir (maske tuzagi: bkz. dosya basi);
 *  bu bilesen yalnizca gosterir, boylece ayni tablo hem cluster karsilastirmasinda hem de
 *  rollout oncesi "canli vs uygulanacak" farkinda kullanilabiliyor. */
export function CompareTable({
  compare: k,
  masked,
  solEtiket,
  sagEtiket,
  secili = [],
  onSec,
}: {
  compare: NonNullable<CryptoOpsResult['compare']>;
  masked: boolean;
  /** sutun basliklari icin istege bagli takma adlar (diff'te "canlı" / "uygulanacak") */
  solEtiket?: string;
  sagEtiket?: string;
  /** esitleme icin secili anahtarlar; `onSec` verilmezse secim sutunu HIC cizilmez */
  secili?: string[];
  onSec?: (anahtar: string) => void;
}) {
  const bas = 'text-left font-medium px-2 py-1 whitespace-nowrap';
  const baslik = (i: number, cluster: string) => {
    if (i === 0 && solEtiket) return solEtiket;
    if (i === k.okunan.length - 1 && sagEtiket) return sagEtiket;
    return cluster;
  };

  if (!k.karsilastirilabilir) {
    return (
      <div
        className="text-[12px] rounded-lg px-3 py-2 border"
        style={{
          color: 'var(--status-warning)',
          background: 'var(--status-warning-bg)',
          borderColor: 'var(--status-warning)',
        }}
      >
        Karşılaştırma için iki tarafın da okunabilmesi gerekiyor — okunan: {k.okunan.length}. Bu{' '}
        <b>&quot;fark yok&quot;</b> anlamına gelmez.
        {k.okunamayan.length > 0 && (
          <ul className="mt-1 ml-4 list-disc">
            {k.okunamayan.map((f) => (
              <li key={f.path}>
                <code>{f.path}</code> — {f.error}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-[12px]">
        <span style={{ color: 'var(--text-secondary)' }}>
          <b style={{ color: k.farkliSayi ? 'var(--status-warning)' : 'var(--status-success)' }}>
            {k.farkliSayi}
          </b>{' '}
          farklı ayar / {k.anahtarSayi} anahtar
        </span>
        {k.farkliSayi === 0 && <span style={{ color: 'var(--status-success)' }}>● fark yok</span>}
        {masked && (
          <span style={{ color: 'var(--text-muted)' }}>
            sır değerleri <code>****</code> — fark tespiti ham içerikte yapılır, maske yalnızca
            gösterimi gizler
          </span>
        )}
      </div>

      {/* OKUNAMAYAN TARAF "FARK YOK" DEMEK DEGIL: ayrica ve gorunur sekilde soyleniyor. */}
      {k.okunamayan.length > 0 && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border"
          style={{
            color: 'var(--status-danger)',
            background: 'var(--status-danger-bg)',
            borderColor: 'var(--status-danger)',
          }}
        >
          {k.okunamayan.length} kaynak okunamadı ve karşılaştırmaya <b>girmedi</b> — bu &quot;fark
          yok&quot; anlamına gelmez:
          <ul className="mt-1 ml-4 list-disc">
            {k.okunamayan.map((f) => (
              <li key={f.path}>
                <code>{f.path}</code> — {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        className="overflow-x-auto rounded-lg border"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <table className="w-full text-[11px]">
          <thead>
            <tr style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
              {onSec && (
                <th className={bas} style={{ width: 28 }}>
                  {' '}
                </th>
              )}
              <th className={bas}>Ayar</th>
              {k.okunan.map((f, i) => (
                <th key={f.path} className={bas} title={f.path}>
                  {baslik(i, f.cluster)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {k.satirlar.map((sat) => (
              <tr
                key={sat.anahtar}
                className="border-t"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                {onSec && (
                  <td className="px-2 py-1">
                    <input
                      type="checkbox"
                      checked={secili.includes(sat.anahtar)}
                      onChange={() => onSec(sat.anahtar)}
                      aria-label={`${sat.anahtar} seç`}
                    />
                  </td>
                )}
                <td className="px-2 py-1 font-mono" style={{ color: 'var(--text-primary)' }}>
                  {sat.anahtar}
                  {sat.sirli && masked && (
                    <span
                      className="ml-1"
                      style={{ color: 'var(--text-muted)' }}
                      title="sır: fark var, değer gösterilmiyor"
                    >
                      sır
                    </span>
                  )}
                </td>
                {sat.degerler.map((v, i) => (
                  <td
                    key={k.okunan[i].path}
                    className="px-2 py-1 font-mono"
                    style={{ color: v === null ? 'var(--status-danger)' : 'var(--status-warning)' }}
                  >
                    {v === null ? '(yok)' : v}
                  </td>
                ))}
              </tr>
            ))}
            {k.satirlar.length === 0 && (
              <tr>
                <td
                  className="px-2 py-3 text-center"
                  colSpan={k.okunan.length + (onSec ? 2 : 1)}
                  style={{ color: 'var(--text-muted)' }}
                >
                  Tüm ayarlar aynı.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
