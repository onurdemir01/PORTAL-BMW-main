// src/components/server_hub/RetireEtiketleri.tsx — Server Hub › Bulgular › Retirement etiketleri (2026-11-06).
//
// Kullanıcı: "Kesin olarak retire edilecek teknoloji de retirement tagı olsun şüpheli olan da";
// "retiere etiketi ayrı olsun bulgular ayrı olsun"; "Manuel kontrol de gerekecek". Etiket konu +
// ortam başına tektir; eşlenik kopyalar ve web zinciri birlikte gösterilir. Manuel kontrol kanıt
// imzasına bağlıdır: kanıt değişirse sunucu 409 döner ve ekran yenileyip yeniden sorar. Yalnız
// KESİN + DOĞRULANDI etiket Retirement kaydına gönderilebilir.
import React, { useMemo, useState } from 'react';
import { ArrowPathIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import {
  serverHubApi,
  type ShEtiketKurali,
  type ShRetireEtiket,
  type ShRetireEtiketHer,
  type ShRetireEtiketOzet,
  type ShRetireSonuc,
} from '@/api/serverHubApi';
import { toast } from '@/hooks/useToast';
import { fmtDateTime, fmtNumber } from '@/utils/datetime';
import { downloadCsv } from '@/utils/csv';
import { EarTablo, formulGuvenli, type EarKolon } from './EarTablo';
import LoadError from '@/components/common/LoadError';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import {
  ETIKET_SEVIYE,
  HIZLI_SUZGECLER,
  KONTROL_DURUM,
  TUR_ETIKET,
  hizliSuz,
  komutDoldur,
  konuMetni,
  retirementUygulamasi,
  zincirDurumu,
  type EtiketBilgi,
  type EtiketTon,
  type HizliSuzgec,
} from './retireEtiket';

const TON: Record<EtiketTon, { zemin: string; metin: string; renk: string }> = {
  kesin: {
    zemin: 'var(--status-danger-bg)',
    metin: 'var(--status-danger-text)',
    renk: 'var(--status-danger)',
  },
  supheli: {
    zemin: 'var(--status-warning-bg)',
    metin: 'var(--status-warning-text)',
    renk: 'var(--status-warning)',
  },
  uyari: {
    zemin: 'var(--status-warning-bg)',
    metin: 'var(--status-warning-text)',
    renk: 'var(--status-warning)',
  },
  iyi: {
    zemin: 'var(--status-success-bg)',
    metin: 'color-mix(in srgb, var(--status-success) 55%, var(--text-primary))',
    renk: 'var(--status-success)',
  },
  bilgi: {
    zemin: 'var(--status-info-bg)',
    metin: 'var(--status-info)',
    renk: 'var(--status-info)',
  },
  notr: { zemin: 'var(--bg-elevated)', metin: 'var(--text-secondary)', renk: 'var(--text-muted)' },
};
export const BTN =
  'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';
export const btnStil = (birincil = false): React.CSSProperties =>
  birincil
    ? {
        background: 'var(--accent)',
        borderColor: 'var(--accent)',
        color: 'var(--text-on-accent, #fff)',
      }
    : {
        background: 'var(--bg-surface)',
        borderColor: 'var(--border)',
        color: 'var(--text-primary)',
      };
const GIRDI = 'h-8 px-2 text-xs border rounded-lg';
const girdiStil: React.CSSProperties = {
  borderColor: 'var(--border)',
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
};

export function EtiketRozeti({ b, kucuk = false }: { b: EtiketBilgi; kucuk?: boolean }) {
  const t = TON[b.ton];
  return (
    <span
      title={b.aciklama}
      data-ton={b.ton}
      className={`inline-flex items-center gap-1 rounded-full px-2 ${kucuk ? 'py-0 text-[10px]' : 'py-0.5 text-[11px]'} font-semibold whitespace-nowrap`}
      style={{ background: t.zemin, color: t.metin }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.renk }} aria-hidden />
      {b.etiket}
    </span>
  );
}

/** Kopyalanabilir komut satırı. */
export function KomutSatiri({ komut }: { komut: string }) {
  return (
    <div className="flex items-start gap-1.5">
      <code
        className="flex-1 min-w-0 px-2 py-1 rounded font-mono text-[11px] break-all"
        style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
      >
        {komut}
      </code>
      <button
        type="button"
        title="Kopyala"
        aria-label="Komutu kopyala"
        className="shrink-0 p-1 rounded border"
        style={{ borderColor: 'var(--border-subtle)' }}
        onClick={() => {
          navigator.clipboard?.writeText(komut).then(
            () => toast.success('Kopyalandı.'),
            () => toast.error('Kopyalanamadı.'),
          );
        }}
      >
        <ClipboardDocumentIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/**
 * Manuel kontrol: doğrulandı / yanlış alarm + not (zorunlu). Kanıt değiştiyse (409) çağırana haber
 * verir; ekran listeyi yenileyip kullanıcıya yeniden sorar.
 */
export function KontrolFormu({ e, onDegisti }: { e: ShRetireEtiketHer; onDegisti: () => void }) {
  const [sonuc, setSonuc] = useState<'DOGRULANDI' | 'YANLIS_ALARM'>('DOGRULANDI');
  const [not, setNot] = useState('');
  const [mesgul, setMesgul] = useState(false);
  const kilitli = e.durum === 'BILINMIYOR';
  const gonder = async (s: 'DOGRULANDI' | 'YANLIS_ALARM' | 'GERI_AL') => {
    setMesgul(true);
    try {
      const r = await serverHubApi.retireKontrol({
        anahtar: e.anahtar,
        sonuc: s,
        aciklama: s === 'GERI_AL' ? '' : not,
        imza: e.imza,
      });
      if (!r.ok) {
        toast.error(r.message || 'Kaydedilemedi.');
        if (r._httpStatus === 409) onDegisti();
        return;
      }
      toast.success(
        s === 'GERI_AL'
          ? 'Kontrol geri alındı.'
          : `“${KONTROL_DURUM[s].etiket}” olarak kaydedildi.`,
      );
      setNot('');
      onDegisti();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setMesgul(false);
    }
  };
  return (
    <div className="space-y-2" data-testid="kontrol-formu">
      {e.kontrol && (
        <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          <EtiketRozeti b={KONTROL_DURUM[e.durum]} kucuk />{' '}
          {e.durum === 'VERI_DEGISTI' ? 'önceki karar: ' : ''}
          <b>{KONTROL_DURUM[e.kontrol.sonuc].etiket}</b> · {e.kontrol.isaretleyen || '?'}
          {e.kontrol.zaman ? ` · ${fmtDateTime(e.kontrol.zaman)}` : ''} — “{e.kontrol.aciklama}”
          <button
            type="button"
            className="ml-2 underline decoration-dotted"
            style={{ color: 'var(--accent)' }}
            disabled={mesgul}
            onClick={() => gonder('GERI_AL')}
          >
            geri al
          </button>
        </div>
      )}
      {kilitli ? (
        <div className="text-[11px]" style={{ color: 'var(--status-warning-text)' }}>
          {KONTROL_DURUM.BILINMIYOR.aciklama} Şimdi kayıt yazılamaz.
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-2">
          <fieldset className="flex items-center gap-3 text-xs">
            <legend className="sr-only">Kontrol sonucu</legend>
            {(['DOGRULANDI', 'YANLIS_ALARM'] as const).map((s) => (
              <label key={s} className="inline-flex items-center gap-1">
                <input
                  type="radio"
                  name={`sonuc-${e.anahtar}`}
                  checked={sonuc === s}
                  onChange={() => setSonuc(s)}
                  className="accent-[var(--accent)]"
                />
                {KONTROL_DURUM[s].etiket}
              </label>
            ))}
          </fieldset>
          <textarea
            value={not}
            onChange={(x) => setNot(x.target.value)}
            rows={2}
            placeholder="Neye bakıldı, kim onayladı? (zorunlu)"
            aria-label="Kontrol notu"
            className="flex-1 min-w-[16rem] px-2 py-1 text-xs border rounded-lg"
            style={girdiStil}
          />
          <button
            type="button"
            className={BTN}
            style={btnStil(true)}
            disabled={mesgul || not.trim().length < 5}
            title={not.trim().length < 5 ? 'Not en az 5 karakter' : undefined}
            onClick={() => gonder(sonuc)}
          >
            {mesgul ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      )}
    </div>
  );
}

/** Kopyalar = zincir: sunucu → JVM durumu → web sunucusu / vhost → trafik (ya da EAR / girdi). */
function KopyaTablosu({ e, kAd }: { e: ShRetireEtiket; kAd: Map<string, string> }) {
  const th = 'px-2 py-1 text-left font-medium whitespace-nowrap';
  const td = 'px-2 py-1 align-top';
  const durum = (c: ShRetireEtiket['kopyalar'][number]) =>
    c.calisiyor == null ? 'ölçülemedi' : c.calisiyor ? 'çalışıyor' : 'kapalı';
  return (
    <div
      className="overflow-x-auto rounded-lg border"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <table className="w-full text-[11px]">
        <thead style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
          {e.tur === 'JVM' ? (
            <tr>
              <th className={th}>Sunucu</th>
              <th className={th}>JVM</th>
              <th className={th}>auto-start</th>
              <th className={th}>tier</th>
              <th className={th}>Web sunucusu / vhost → trafik (7 gün)</th>
              <th className={th}>Kural</th>
            </tr>
          ) : e.tur === 'EAR' ? (
            <tr>
              <th className={th}>Sunucu</th>
              <th className={th}>Konum</th>
              <th className={th}>Tarama</th>
              <th className={th}>WAR</th>
              <th className={th}>JVM (domain.xml / host.xml)</th>
              <th className={th}>Kural</th>
            </tr>
          ) : (
            <tr>
              <th className={th}>Sunucu</th>
              <th className={th}>Konum</th>
              <th className={th}>Tip</th>
              <th className={th}>Tarama</th>
              <th className={th}>Kural</th>
            </tr>
          )}
        </thead>
        <tbody>
          {e.kopyalar.map((c) => (
            <tr
              key={`${c.host}|${c.kok || ''}|${c.gen ?? ''}`}
              className="border-t"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <td className={`${td} font-mono text-[11px] font-semibold`}>
                {c.host}
                {c.taze === false && (
                  <div
                    className="font-sans text-[10px]"
                    style={{ color: 'var(--status-warning-text)' }}
                  >
                    bayat ({c.taramaTarihi || '?'})
                  </div>
                )}
              </td>
              {e.tur === 'JVM' ? (
                <>
                  <td className={td}>{durum(c)}</td>
                  <td className={td}>
                    {c.autoStart === 'true'
                      ? 'açık'
                      : c.autoStart === 'false'
                        ? 'kapalı'
                        : 'bilinmiyor'}
                  </td>
                  <td className={td}>{c.tier || '—'}</td>
                  <td className={td}>
                    {(c.web || []).length === 0 ? (
                      <span style={{ color: 'var(--text-muted)' }}>
                        web katmanı eşlenemedi ({c.esleme || '?'})
                      </span>
                    ) : (
                      (c.web || []).map((w) => (
                        <div key={`${w.host}|${w.vhost}`} className="font-mono text-[11px]">
                          {w.host === c.host ? 'aynı sunucu' : w.host} / {w.vhost || '?'} →{' '}
                          <b>{w.trafik || '?'}</b>
                          {w.istek7g != null && w.istek7g >= 0
                            ? ` (${fmtNumber(w.istek7g)} istek)`
                            : ''}
                          {w.log ? (
                            <span style={{ color: 'var(--text-muted)' }}> · {w.log}</span>
                          ) : null}
                        </div>
                      ))
                    )}
                    {c.engel && (
                      <div className="text-[10px]" style={{ color: 'var(--status-warning-text)' }}>
                        kanıt eksik: {c.engel}
                      </div>
                    )}
                  </td>
                </>
              ) : e.tur === 'EAR' ? (
                <>
                  <td className={`${td} font-mono`}>
                    {c.kok}/{e.ad}
                  </td>
                  <td className={td}>{c.durum || '?'}</td>
                  <td className={td}>{c.warSayisi == null ? '—' : fmtNumber(c.warSayisi)}</td>
                  <td className={td}>
                    {c.xml == null
                      ? 'ölçülmedi'
                      : c.xml === 'OLCULEMEDI'
                        ? `okunamadı${c.xmlNeden ? ` (${c.xmlNeden})` : ''}`
                        : c.xml === 'JVM_YOK'
                          ? `JVM yok (${c.xmlNeden || 'TANIM_YOK'})`
                          : (c.jvmler || [])
                              .map(
                                (j) =>
                                  `${j.ad}: ${j.calisiyor == null ? 'Server Hub’da yok' : j.calisiyor ? 'çalışıyor' : 'kapalı'}`,
                              )
                              .join(', ')}
                  </td>
                </>
              ) : (
                <>
                  <td className={`${td} font-mono`}>
                    {c.kok}/{e.ad}
                    {c.hedef ? ` → ${c.hedef}` : ''}
                  </td>
                  <td className={td}>
                    {({ D: 'dizin', F: 'dosya', L: 'bağ' } as Record<string, string>)[
                      c.tip || ''
                    ] || '?'}
                  </td>
                  <td className={td}>{c.taranma ? fmtDateTime(c.taranma) : '—'}</td>
                </>
              )}
              <td className={td}>
                {c.kurallar.length
                  ? c.kurallar.map((r) => (
                      <div key={r} className="text-[11px]">
                        <span className="font-mono">{r}</span> {kAd.get(r) || ''}
                      </div>
                    ))
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tek etiketin ayrıntısı: neden düştü, zincir, doğrulama adımları, manuel kontrol ve eylem. */
export function EtiketAyrinti({
  e,
  kurallar,
  onDegisti,
  onRetirementAc,
}: {
  e: ShRetireEtiketHer;
  kurallar: ShEtiketKurali[];
  onDegisti: () => void;
  onRetirementAc?: (uygulama: string, not: string) => void;
}) {
  // Liste ozet tasir (kopyalar yok): zincir acilinca ayrinti ucundan EKSIKSIZ gelir. Kanit (imza)
  // degisince yeniden istenir; etiket artik yoksa (409) liste yenilenir.
  const [tam, setTam] = useState<ShRetireEtiket | null>(e.kopyalar ? (e as ShRetireEtiket) : null);
  const [ayrintiHata, setAyrintiHata] = useState('');
  const [tazele, setTazele] = useState(0);
  useAsyncEffect(
    async (alive) => {
      if (e.kopyalar) return;
      try {
        const r = await serverHubApi.retireEtiketAyrinti(e.anahtar);
        if (!alive()) return;
        if (r.ok && r.etiket) {
          setTam(r.etiket);
          setAyrintiHata('');
        } else {
          setAyrintiHata(r.message || 'Etiket ayrıntısı alınamadı.');
          if (r._httpStatus === 409) onDegisti();
        }
      } catch (err) {
        if (alive()) setAyrintiHata(err instanceof Error ? err.message : String(err));
      }
    },
    [e.anahtar, e.imza, tazele],
  );
  const kAd = new Map(kurallar.map((k) => [k.kural, k]));
  const uyg = retirementUygulamasi(e);
  const log = (tam?.kopyalar || []).flatMap((c) => c.web || []).find((w) => w.log)?.log || null;
  const yer = {
    JVM: e.tur === 'JVM' ? e.ad : null,
    EAR: e.tur === 'EAR' ? e.ad : null,
    GIRDI: e.tur === 'GIRDI' ? e.ad : null,
    ACCESS_LOG: log,
  };
  return (
    <div className="space-y-3 text-xs" data-testid="etiket-ayrinti">
      {e.hamSeviye === 'KESIN' && e.seviye !== 'KESIN' && (
        <div
          className="rounded-lg border px-3 py-2"
          style={{ borderColor: 'var(--status-warning)', background: 'var(--status-warning-bg)' }}
        >
          <b style={{ color: 'var(--status-warning-text)' }}>
            Kural “kesin” diyor ama şüpheliye indi:
          </b>
          <ul className="list-disc ml-5 mt-1" style={{ color: 'var(--text-primary)' }}>
            {e.nedenler.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      {e.hamSeviye !== 'KESIN' && e.nedenler.length > 0 && (
        <ul className="list-disc ml-5" style={{ color: 'var(--text-secondary)' }}>
          {e.nedenler.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {e.notlar.map((n) => (
        <div key={n} style={{ color: 'var(--status-info)' }}>
          ℹ {n}
        </div>
      ))}
      {tam ? (
        <KopyaTablosu e={tam} kAd={new Map(kurallar.map((k) => [k.kural, k.ad]))} />
      ) : ayrintiHata ? (
        <LoadError
          title="Eşlenik kopyalar okunamadı"
          message={ayrintiHata}
          onRetry={() => setTazele((n) => n + 1)}
          compact
        />
      ) : (
        <div style={{ color: 'var(--text-muted)' }}>
          {fmtNumber(e.kopyalar ? e.kopyalar.length : (e as ShRetireEtiketOzet).kopyaSayisi)}{' '}
          eşlenik kopya yükleniyor…
        </div>
      )}
      {e.kurallar.map((r) => {
        const k = kAd.get(r);
        if (!k || !k.dogrulama) return null;
        return (
          <details
            key={r}
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <summary className="cursor-pointer font-semibold">
              {r} · {k.ad} — nasıl doğrulanır?
            </summary>
            <div className="mt-2 space-y-1.5" style={{ color: 'var(--text-secondary)' }}>
              <div>
                <b>Neden:</b> {k.dogrulama.neden}
              </div>
              <div>
                <b>Ne eksik olabilir:</b> {k.dogrulama.eksik}
              </div>
              {k.dogrulama.kontrol.map((c) => (
                <KomutSatiri key={c} komut={komutDoldur(c, yer)} />
              ))}
            </div>
          </details>
        );
      })}
      <KontrolFormu e={e} onDegisti={onDegisti} />
      {e.seviye === 'KESIN' && (
        <div>
          {e.retirementHazir && uyg && onRetirementAc ? (
            <button
              type="button"
              className={BTN}
              style={btnStil(true)}
              onClick={() =>
                onRetirementAc(
                  uyg,
                  `Server Hub retirement etiketi (${e.kurallar.join(', ')}; ${e.ortam}): ${e.kontrol?.isaretleyen || '?'} doğruladı — ${e.kontrol?.aciklama || ''}`,
                )
              }
            >
              Retirement kaydı aç ({uyg})
            </button>
          ) : (
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {!uyg
                ? 'Kök girdisi Retirement akışının konusu değil; elle temizlenir.'
                : 'Retirement kaydı, etiket elle “doğrulandı” işaretlenince açılabilir.'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Bulgular sekmesindeki ikinci görünüm: etiket listesi (süzgeçli, satır açılır). */
/** R1–R6 ne demek: kural kodu, okunur adı, koşulu ve şu anki seviyesi (Admin değiştirir). */
export function KuralSozlugu({ kurallar }: { kurallar: ShEtiketKurali[] }) {
  return (
    <details
      className="rounded-lg border px-3 py-2 text-xs"
      style={{ borderColor: 'var(--border-subtle)' }}
      data-testid="kural-sozlugu"
    >
      <summary className="cursor-pointer font-semibold">
        Kurallar ne demek? (R1–R{kurallar.length})
      </summary>
      <table className="w-full mt-2 text-[11px]">
        <thead style={{ color: 'var(--text-muted)' }}>
          <tr>
            <th className="text-left pr-3 py-1">Kod</th>
            <th className="text-left pr-3 py-1">Ne zaman konur</th>
            <th className="text-left pr-3 py-1">Şu anki etiket</th>
          </tr>
        </thead>
        <tbody>
          {kurallar.map((k) => (
            <tr key={k.kural} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <td className="pr-3 py-1 font-mono align-top">{k.kural}</td>
              <td className="pr-3 py-1 align-top">
                <b>{k.ad}</b>
                <div style={{ color: 'var(--text-secondary)' }}>{k.kosul}</div>
              </td>
              <td className="pr-3 py-1 align-top">
                {k.gecerli === 'KAPALI' ? (
                  <span style={{ color: 'var(--text-muted)' }}>kapalı (etiket üretmez)</span>
                ) : (
                  <EtiketRozeti b={ETIKET_SEVIYE[k.gecerli]} kucuk />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1" style={{ color: 'var(--text-muted)' }}>
        Seviyeleri Server Hub › Kurallar &amp; Limitler › “Retirement etiket kuralları”ndan Admin
        değiştirir.
      </div>
    </details>
  );
}

type E = ShRetireEtiketOzet;
const ZINCIR: Record<'TAM' | 'DUSTU' | 'NEDENLI', string> = {
  TAM: 'kanıt tam',
  DUSTU: 'kesinden şüpheliye indi',
  NEDENLI: 'şüpheli (nedenli)',
};

function kolonlarOf(kAd: Map<string, string>): EarKolon<E>[] {
  const kuralMetni = (k: string) => `${k} · ${kAd.get(k) || ''}`;
  return [
    {
      anahtar: 'seviye',
      baslik: 'Etiket',
      aciklama:
        'kesin: kurallar retire edilebilir diyor (elle doğrulanmalı); şüpheli: inceleme gerekir.',
      suzgec: 'secim',
      secenekler: [
        { deger: 'KESIN', etiket: 'kesin' },
        { deger: 'SUPHELI', etiket: 'şüpheli' },
      ],
      sirala: true,
      deger: (e) => e.seviye,
      hucre: (e) => <EtiketRozeti b={ETIKET_SEVIYE[e.seviye]} />,
    },
    {
      anahtar: 'konu',
      baslik: 'Konu',
      aciklama: 'Etiketin konusu: JVM / uygulama (nesil), diskteki EAR ya da kökteki girdi.',
      suzgec: 'metin',
      sirala: true,
      deger: (e) => konuMetni(e),
      hucre: (e) => (
        <div>
          <div className="font-mono text-[12px] font-semibold">{konuMetni(e)}</div>
          <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {TUR_ETIKET[e.tur]}
            {e.tier.length ? ` · tier ${e.tier.join('/')}` : ''}
          </div>
        </div>
      ),
    },
    {
      anahtar: 'tur',
      baslik: 'Tür',
      aciklama: 'JVM / uygulama, EAR ya da kökteki girdi.',
      suzgec: 'secim',
      secenekler: (Object.keys(TUR_ETIKET) as (keyof typeof TUR_ETIKET)[]).map((t) => ({
        deger: t,
        etiket: TUR_ETIKET[t],
      })),
      sirala: true,
      varsayilan: false,
      deger: (e) => e.tur,
      hucre: (e) => TUR_ETIKET[e.tur],
    },
    {
      anahtar: 'ortam',
      baslik: 'Ortam',
      aciklama:
        'Etiket ortam başına tektir; aynı ortamdaki eşlenik kopyalar birlikte değerlendirilir.',
      suzgec: 'secim',
      sirala: true,
      deger: (e) => e.ortam,
      hucre: (e) => e.ortam,
    },
    {
      anahtar: 'kural',
      baslik: 'Kural',
      aciklama: 'Etiketi koyan kural(lar); R1–R6 açıklaması tablonun üstünde.',
      suzgec: 'secim',
      sirala: true,
      deger: (e) => e.kurallar.map(kuralMetni).join(' + '),
      hucre: (e) => (
        <div>
          {e.kurallar.map((r) => (
            <div key={r} className="text-[11px]">
              <span className="font-mono">{r}</span> {kAd.get(r) || ''}
            </div>
          ))}
        </div>
      ),
    },
    {
      anahtar: 'sunucular',
      baslik: 'Sunucular',
      aciklama: 'Eşlenik kopyaların bulunduğu sunucular.',
      suzgec: 'metin',
      deger: (e) => e.hostlar.join(', '),
      hucre: (e) => (
        <span className="font-mono text-[11px]">
          {e.hostlar.slice(0, 3).join(', ')}
          {e.hostlar.length > 3 ? ` +${e.hostlar.length - 3}` : ''}
        </span>
      ),
    },
    {
      anahtar: 'sunucuSayisi',
      baslik: 'Sunucu sayısı',
      aciklama: 'Kaç sunucuda kopya var.',
      suzgec: 'sayi',
      sirala: true,
      varsayilan: false,
      deger: (e) => e.hostlar.length,
      hucre: (e) => fmtNumber(e.hostlar.length),
    },
    {
      anahtar: 'zincir',
      baslik: 'Zincir',
      aciklama:
        'kanıt tam / kesinden şüpheliye indi (eşlenik kopya çalışıyor, trafik ölçülemedi…) / şüpheli ve nedeni.',
      suzgec: 'secim',
      secenekler: (Object.keys(ZINCIR) as (keyof typeof ZINCIR)[]).map((z) => ({
        deger: z,
        etiket: ZINCIR[z],
      })),
      deger: (e) => zincirDurumu(e),
      hucre: (e) =>
        e.nedenler.length ? (
          <span className="text-[11px]" style={{ color: 'var(--status-warning-text)' }}>
            {e.nedenler[0]}
            {e.nedenler.length > 1 ? ` +${e.nedenler.length - 1}` : ''}
          </span>
        ) : (
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            kanıt tam
          </span>
        ),
    },
    {
      anahtar: 'nedenler',
      baslik: 'Nedenler',
      aciklama: 'Kesinden şüpheliye inme ya da şüphe nedenlerinin tamamı.',
      suzgec: 'metin',
      varsayilan: false,
      deger: (e) => e.nedenler.join(' | ') || null,
      hucre: (e) => <span className="text-[11px]">{e.nedenler.join(' · ') || '—'}</span>,
    },
    {
      anahtar: 'tier',
      baslik: 'Tier',
      aciklama: 'MWAppsInventory tier (JVM etiketlerinde).',
      suzgec: 'secim',
      varsayilan: false,
      deger: (e) => e.tier.join('/') || null,
      hucre: (e) => e.tier.join('/') || '—',
    },
    {
      anahtar: 'nesil',
      baslik: 'JBoss',
      aciklama: 'JBoss nesli (7 ya da 8).',
      suzgec: 'secim',
      varsayilan: false,
      deger: (e) => (e.gen ? String(e.gen) : e.nesil && e.nesil !== '?' ? e.nesil : null),
      hucre: (e) =>
        e.gen ? `JBoss ${e.gen}` : e.nesil && e.nesil !== '?' ? `JBoss ${e.nesil}` : '—',
    },
    {
      anahtar: 'durum',
      baslik: 'Kontrol',
      aciklama: 'Manuel kontrol: bekliyor, doğrulandı, yanlış alarm, veri değişti.',
      suzgec: 'secim',
      secenekler: (Object.keys(KONTROL_DURUM) as (keyof typeof KONTROL_DURUM)[]).map((d) => ({
        deger: d,
        etiket: KONTROL_DURUM[d].etiket,
      })),
      sirala: true,
      deger: (e) => e.durum,
      hucre: (e) => <EtiketRozeti b={KONTROL_DURUM[e.durum]} kucuk />,
    },
    {
      anahtar: 'isaretleyen',
      baslik: 'Kontrol eden',
      aciklama: 'Manuel kontrolü işaretleyen kullanıcı.',
      suzgec: 'metin',
      varsayilan: false,
      deger: (e) => e.kontrol?.isaretleyen || null,
      hucre: (e) => e.kontrol?.isaretleyen || '—',
    },
    {
      anahtar: 'kontrolZamani',
      baslik: 'Kontrol zamanı',
      aciklama: 'Manuel kontrolün işaretlendiği an.',
      suzgec: 'tarih',
      sirala: true,
      varsayilan: false,
      deger: (e) => e.kontrol?.zaman || null,
      hucre: (e) => (e.kontrol?.zaman ? fmtDateTime(e.kontrol.zaman) : '—'),
    },
    {
      anahtar: 'hazir',
      baslik: 'Retirement’a hazır',
      aciklama: 'Kesin + elle doğrulandı: Retirement kaydı açılabilir.',
      suzgec: 'bit',
      varsayilan: false,
      deger: (e) => e.retirementHazir,
      hucre: (e) => (e.retirementHazir ? 'evet' : 'hayır'),
    },
  ];
}

/** Bulgular sekmesindeki ikinci görünüm: etiket listesi (sütun süzgeçli, sıralı, sayfalı; satır açılır). */
export default function RetireEtiketleriGorunum({
  veri,
  yukleniyor,
  onYenile,
  onRetirementAc,
}: {
  veri: ShRetireSonuc | null;
  yukleniyor: boolean;
  onYenile: (fresh?: boolean) => void;
  onRetirementAc?: (uygulama: string, not: string) => void;
}) {
  const [hizli, setHizli] = useState<HizliSuzgec>('acik');
  const etiketler = useMemo(() => veri?.etiketler || [], [veri]);
  const satirlar = useMemo(() => hizliSuz(etiketler, hizli), [etiketler, hizli]);
  const kurallar = useMemo(() => veri?.kurallar || [], [veri]);
  const kolonlar = useMemo(
    () => kolonlarOf(new Map(kurallar.map((k) => [k.kural, k.ad]))),
    [kurallar],
  );
  const oz = veri?.ozet;
  const sayilar: Partial<Record<HizliSuzgec, number>> = oz
    ? {
        kesin: oz.kesin,
        supheli: oz.supheli,
        bekleyen: oz.bekliyor,
        hazir: oz.retirementHazir,
        dusen: oz.dusurulen,
        yanlis: oz.yanlisAlarm,
      }
    : {};
  const tumunuCsv = () =>
    downloadCsv(
      'retirement-etiketleri',
      kolonlar.map((k) => k.baslik),
      satirlar.map((e) => kolonlar.map((k) => formulGuvenli(k.deger ? k.deger(e) : ''))),
    );
  const bant = (metin: React.ReactNode) => (
    <div
      className="rounded-lg border px-3 py-2 text-xs"
      style={{
        borderColor: 'var(--status-warning)',
        background: 'var(--status-warning-bg)',
        color: 'var(--status-warning-text)',
      }}
    >
      {metin}
    </div>
  );
  return (
    <div className="space-y-3" data-testid="retire-etiketleri">
      {veri?.ear?.okunamadi &&
        bant(
          <>
            Uygulama Envanteri okunamadı: EAR ve kök girdisi etiketleri listede YOK (“temiz” demek
            değil). {veri.ear.hata || ''}
          </>,
        )}
      {veri?.kontrolOkunamadi && bant(KONTROL_DURUM.BILINMIYOR.aciklama)}
      <div
        className="flex flex-wrap items-center gap-2 text-xs"
        role="group"
        aria-label="Hızlı süzgeç"
      >
        {HIZLI_SUZGECLER.map((h) => (
          <button
            key={h.id}
            type="button"
            aria-pressed={hizli === h.id}
            onClick={() => setHizli(h.id)}
            className="px-2.5 py-1 rounded-lg border"
            style={{
              borderColor: hizli === h.id ? 'var(--accent)' : 'var(--border-subtle)',
              background: hizli === h.id ? 'var(--bg-elevated)' : 'var(--bg-surface)',
            }}
          >
            {h.etiket}
            {sayilar[h.id] != null ? (
              <>
                {' '}
                <b className="tabular-nums">{fmtNumber(sayilar[h.id] as number)}</b>
              </>
            ) : null}
          </button>
        ))}
      </div>
      <KuralSozlugu kurallar={kurallar} />
      <EarTablo<E>
        kimlik="retire-etiketleri"
        kolonlar={kolonlar}
        satirlar={satirlar}
        satirAnahtari={(e) => e.anahtar}
        acilir={(e) => (
          <EtiketAyrinti
            e={e}
            kurallar={kurallar}
            onDegisti={() => onYenile(false)}
            onRetirementAc={onRetirementAc}
          />
        )}
        csvAdi="retirement-etiketleri_secili"
        araEtiketi="uygulama, sunucu ya da neden ara"
        bosMetin={
          etiketler.length
            ? 'Süzgeçle eşleşen etiket yok.'
            : veri?.ear?.okunamadi
              ? 'Retirement etiketi yok (Uygulama Envanteri okunamadığı için EAR etiketleri hesaplanmadı).'
              : 'Retirement etiketi yok.'
        }
        ustSag={
          <span className="flex items-center gap-2">
            <button
              type="button"
              className={BTN}
              style={btnStil()}
              onClick={tumunuCsv}
              disabled={!satirlar.length}
            >
              CSV ({fmtNumber(satirlar.length)})
            </button>
            <button type="button" onClick={() => onYenile(true)} className={BTN} style={btnStil()}>
              <ArrowPathIcon className={`w-3.5 h-3.5 ${yukleniyor ? 'animate-spin' : ''}`} /> Yenile
            </button>
          </span>
        }
      />
    </div>
  );
}
