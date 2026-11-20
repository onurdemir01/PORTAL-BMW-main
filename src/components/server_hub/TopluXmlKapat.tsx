// src/components/server_hub/TopluXmlKapat.tsx — Toplu Auto-Start › "Domain kapalı — auto-start host XML üzerinden
// kapat" bölümü (2026-11-15).
//
// Kullanıcı: Toplu Auto-Start'ta "Uyumsuz görünen ama listeye alınmayan 130 JVM" listesinde ~25 sunucuda "JBoss <n> domain
// kapalı (taramada host controller çalışmıyordu)" JVM'leri vardı; "bunlar yanlış retire edilmiş uygulamalar, auto-start'ları
// kapatılmalı" → "olur ekle lütfen".
//
// Model (server/server-hub/toplu-autostart.cjs başlığı, DOMAIN KAPALI - HOST XML): domain kapalıyken canlı CLI yok; yalnız
// KAPATMA, host XML dosyasında. Seçim domain düzeyinde (bir sunucu + JBoss sürümünün tüm adayları birlikte). Önce salt okunur
// plan, sonra onay; sunucular sırayla. Production / ortamı bilinmeyen sunucu açık işaret ister (sunucu da zorunlu tutar:
// prodOnay yoksa 400). CLI öğeleriyle aynı toplu işe girmez.
import React, { useMemo, useState } from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import type { ShTopluOge, ShTopluSecim, ShTopluXmlGrup } from '@/api/serverHubApi';
import { fmtNumber } from '@/utils/datetime';
import { Modal } from '@/components/common/Modal';

/** Sunucu öğe eylemi (autostart-dogrulama.cjs XML_KAPAT_EYLEMI). */
export const XML_EYLEMI = 'jboss_autostart_xml_off';
/** Prod onay işaretinin metni (kullanıcı onaylı ifade). */
export const PROD_ONAY_METNI =
  'Prod sunucuların domainleri kalıcı olarak kapalı; auto-start kapatılsın';

export const domainAnahtari = (g: { host: string; gen: number }) => `${g.host}|${g.gen}`;
export const xmlOgesiMi = (o: Pick<ShTopluOge, 'eylem'> & { hostXml?: boolean }) =>
  o.hostXml === true || o.eylem === XML_EYLEMI;

/** Seçili domain'lerin tüm JVM'leri → toplu iş seçimi (eylem xml_kapat). */
export function xmlSecimi(gruplar: ShTopluXmlGrup[], secili: Set<string>): ShTopluSecim[] {
  return gruplar
    .filter((g) => secili.has(domainAnahtari(g)))
    .flatMap((g) =>
      g.jvms.map((j) => ({ host: g.host, gen: g.gen, jvm: j.jvm, eylem: 'xml_kapat' as const })),
    );
}

/** "Prod dışı tümünü seç": Production / ortamı bilinmeyen sunucular hariç tüm domain'ler. */
export const prodDisiAnahtarlar = (gruplar: ShTopluXmlGrup[]) =>
  gruplar.filter((g) => !g.prod).map(domainAnahtari);

/** Öğenin sunucusu prod mu: aday grubundaki bayrak; yoksa ortam adına göre (bilinmeyen = prod, güvenli taraf). */
export function prodOgesiMi(
  o: { host: string; env: string | null },
  gruplar: ShTopluXmlGrup[] | undefined,
): boolean {
  const g = (gruplar || []).find((x) => x.host === o.host);
  if (g) return g.prod;
  return !['DEV', 'TEST', 'QA', 'ODM'].includes(String(o.env || '').toUpperCase());
}

/** Rozet etiketi: sunucu prodMu (toplu-autostart.cjs) ile aynı — Production ya da ortamı PROD ise PROD; aksi halde bilinmiyor. */
export const prodRozetEtiketi = (g: { env: string | null; envGroup: string | null }) =>
  g.envGroup === 'Production' || String(g.env || '').toUpperCase() === 'PROD'
    ? 'PROD'
    : 'ORTAM BİLİNMİYOR';

/** Sunucunun prod onayı reddi (400 code prod_onay): yanıt gövdesi ya da fırlatılan hata. */
export const prodOnayRedMi = (x: unknown) =>
  !!x && typeof x === 'object' && (x as { code?: unknown }).code === 'prod_onay';

function ProdRozeti({ env, envGroup }: { env: string | null; envGroup: string | null }) {
  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-0.5 rounded border"
      style={{ color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
      title="Production ya da ortamı bilinmeyen sunucu: ayrıca açık onay istenir."
    >
      {prodRozetEtiketi({ env, envGroup })}
    </span>
  );
}

/** Domain kapalı (host XML) aday bölümü: domain seçimi, "Prod dışı tümünü seç", Planla. */
export function TopluXmlKapatBolumu({
  gruplar,
  secili,
  setSecili,
  kilitli,
  gonderiliyor,
  limit,
  onPlanla,
}: {
  gruplar: ShTopluXmlGrup[];
  secili: Set<string>;
  setSecili: (f: (s: Set<string>) => Set<string>) => void;
  kilitli: boolean;
  gonderiliyor: boolean;
  limit: number | null;
  onPlanla: () => void;
}) {
  const secim = useMemo(() => xmlSecimi(gruplar, secili), [gruplar, secili]);
  const domainSayisi = gruplar.filter((g) => secili.has(domainAnahtari(g))).length;
  const prodSecili = gruplar.some((g) => g.prod && secili.has(domainAnahtari(g)));
  const limitAsti = limit != null && secim.length > limit;
  const toplamJvm = gruplar.reduce((n, g) => n + g.jvms.length, 0);
  const hostSayisi = new Set(gruplar.map((g) => g.host)).size;
  return (
    <section
      className="rounded-xl border p-4 space-y-3"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
      aria-label="Domain kapalı — auto-start host XML üzerinden kapat"
    >
      <div>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Domain kapalı — auto-start host XML üzerinden kapat
        </h2>
        <p className="text-[12px] mt-0.5 max-w-3xl" style={{ color: 'var(--text-muted)' }}>
          Taramada host controller’ı çalışmayan JBoss domain’lerinin durmuş ama auto-start’ı açık
          JVM’leri ({fmtNumber(toplamJvm)} JVM, {fmtNumber(hostSayisi)} sunucu). Domain kapalı
          olduğu için canlı CLI yok: auto-start host XML dosyasında <b>false</b> yapılır — yalnız
          kapatma. Dosya önce yedeklenir; betik yazmadan önce ve sonra host controller’ın o an hâlâ
          kapalı olduğunu kontrol eder, açıldıysa değişikliği geri alır. Bir domain’in JVM’leri
          birlikte seçilir; önce salt okunur plan, sonra onay, sunucular sırayla. Normal (CLI)
          adaylarla aynı toplu işe girmez.
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={kilitli}
          onClick={() => setSecili(() => new Set(prodDisiAnahtarlar(gruplar)))}
        >
          Prod dışı tümünü seç
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={kilitli || !secili.size}
          onClick={() => setSecili(() => new Set())}
        >
          Seçimi temizle
        </button>
      </div>
      <div
        className="rounded-lg border overflow-hidden"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <ul className="divide-y text-[12px]" style={{ borderColor: 'var(--border-subtle)' }}>
          {gruplar.map((g) => {
            const k = domainAnahtari(g);
            return (
              <li key={k} className="px-3 py-1.5" data-testid={`xml-domain-${k}`}>
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    aria-label={`${g.host} JBoss ${g.gen} domain seç`}
                    checked={secili.has(k)}
                    disabled={kilitli}
                    onChange={() =>
                      setSecili((s) => {
                        const n = new Set(s);
                        if (n.has(k)) n.delete(k);
                        else n.add(k);
                        return n;
                      })
                    }
                  />
                  <details className="min-w-0 flex-1">
                    <summary className="cursor-pointer flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold">{g.host}</span>
                      <span style={{ color: 'var(--text-muted)' }}>JBoss {g.gen}</span>
                      <span>{g.env || '—'}</span>
                      {g.prod && <ProdRozeti env={g.env} envGroup={g.envGroup} />}
                      <span className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                        {fmtNumber(g.jvms.length)} JVM
                      </span>
                      {g.scanDate && (
                        <span style={{ color: 'var(--text-muted)' }}>tarama {g.scanDate}</span>
                      )}
                    </summary>
                    <div
                      className="mt-1 font-mono text-[11px]"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {g.jvms.map((j) => j.jvm).join(', ')}
                    </div>
                  </details>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          className="btn-primary text-xs"
          disabled={gonderiliyor || !secim.length || limitAsti || kilitli}
          onClick={onPlanla}
        >
          Planla — host XML ({fmtNumber(secim.length)} JVM, {fmtNumber(domainSayisi)} domain)
        </button>
        {prodSecili && (
          <span
            className="text-[11px] inline-flex items-center gap-1"
            style={{ color: 'var(--status-danger)' }}
          >
            <ExclamationTriangleIcon className="w-4 h-4" /> Seçimde Production / ortamı bilinmeyen
            sunucu var — ayrıca onay istenecek.
          </span>
        )}
        {limitAsti && (
          <span className="text-[11px]" style={{ color: 'var(--status-danger)' }}>
            {fmtNumber(secim.length)} / {fmtNumber(limit)} JVM — sınır aşıldı; seçimi azaltın ya da
            Admin › Kurallar & Limitler’den artırın
          </span>
        )}
        {kilitli && (
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Aktif toplu iş bitene ya da iptal edilene kadar yenisi açılmaz.
          </span>
        )}
      </div>
    </section>
  );
}

export interface XmlOnayKapsami {
  host: string;
  gen: number;
  prod: boolean;
  jvms: string[];
}

/** Öğe ya da seçim listesinden sunucu + JBoss sürümü başına kapsam (onay penceresi). */
export function xmlKapsami(
  liste: { host: string; gen: number; jvm: string; prod: boolean }[],
): XmlOnayKapsami[] {
  const m = new Map<string, XmlOnayKapsami>();
  for (const x of liste) {
    const k = `${x.host}|${x.gen}`;
    let g = m.get(k);
    if (!g) {
      g = { host: x.host, gen: x.gen, prod: x.prod, jvms: [] };
      m.set(k, g);
    }
    g.prod = g.prod || x.prod;
    g.jvms.push(x.jvm);
  }
  return [...m.values()];
}

/**
 * Host XML onay penceresi: sunucuları / JVM'leri listeler; kapsamda prod sunucu varsa PROD_ONAY_METNI işaretlenmeden
 * onay düğmesi açılmaz. onayla(prodOnay) — prodOnay yalnız prod kapsamda true.
 */
export function XmlOnayPenceresi({
  acik,
  baslik,
  aciklama,
  kapsam,
  onayMetni,
  uyari,
  onIptal,
  onOnayla,
}: {
  acik: boolean;
  baslik: string;
  aciklama: string;
  /** Sunucunun prod onayı reddinden sonra yeniden açılışta gösterilir. */
  uyari?: string;
  kapsam: XmlOnayKapsami[];
  onayMetni: string;
  onIptal: () => void;
  onOnayla: (prodOnay: boolean) => void;
}) {
  const [prodIsaret, setProdIsaret] = useState(false);
  const prodVar = kapsam.some((g) => g.prod);
  const jvmSayisi = kapsam.reduce((n, g) => n + g.jvms.length, 0);
  const hostSayisi = new Set(kapsam.map((g) => g.host)).size;
  const kapat = () => {
    setProdIsaret(false);
    onIptal();
  };
  return (
    <Modal
      open={acik}
      onClose={kapat}
      title={baslik}
      size="xl"
      dismissOnBackdrop={false}
      footer={
        <>
          <button
            type="button"
            className="btn-danger"
            disabled={prodVar && !prodIsaret}
            title={prodVar && !prodIsaret ? 'Prod onayını işaretleyin' : undefined}
            onClick={() => {
              const p = prodVar && prodIsaret;
              setProdIsaret(false);
              onOnayla(p);
            }}
          >
            {onayMetni}
          </button>
          <button type="button" className="btn-secondary" onClick={kapat}>
            İptal
          </button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        <p className="whitespace-pre-line">
          {`${fmtNumber(jvmSayisi)} JVM, ${fmtNumber(hostSayisi)} sunucu: auto-start host XML dosyasında KAPATILACAK (domain kapalı). `}
          {aciklama}
        </p>
        {uyari && (
          <p
            className="rounded-lg border px-3 py-2 text-[12px]"
            role="alert"
            style={{ borderColor: 'var(--status-danger)', color: 'var(--status-danger)' }}
          >
            {uyari}
          </p>
        )}
        <div
          className="rounded-lg border max-h-64 overflow-auto"
          style={{ borderColor: 'var(--border-subtle)' }}
          data-testid="xml-onay-kapsam"
        >
          <table className="w-full text-[12px]">
            <tbody>
              {kapsam.map((g) => (
                <tr
                  key={`${g.host}|${g.gen}`}
                  className="border-t align-top"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <td className="px-2 py-1 font-mono font-semibold whitespace-nowrap">
                    {g.host} <span style={{ color: 'var(--text-muted)' }}>JBoss {g.gen}</span>
                    {g.prod && (
                      <span className="ml-1 text-[10px]" style={{ color: 'var(--status-danger)' }}>
                        PROD
                      </span>
                    )}
                  </td>
                  <td
                    className="px-2 py-1 font-mono text-[11px]"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {g.jvms.join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {prodVar && (
          <label
            className="flex items-start gap-2 rounded-lg border px-3 py-2"
            style={{ borderColor: 'var(--status-danger)' }}
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={prodIsaret}
              onChange={(e) => setProdIsaret(e.target.checked)}
            />
            <span>{PROD_ONAY_METNI}</span>
          </label>
        )}
      </div>
    </Modal>
  );
}
