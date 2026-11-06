// src/components/server_hub/RetireEtiketleri.tsx — Server Hub › Bulgular › Retirement etiketleri (2026-11-06).
//
// Kullanıcı: "Kesin olarak retire edilecek teknoloji de retirement tagı olsun şüpheli olan da";
// "retiere etiketi ayrı olsun bulgular ayrı olsun"; "Manuel kontrol de gerekecek". Etiket konu +
// ortam başına tektir; eşlenik kopyalar ve web zinciri birlikte gösterilir. Manuel kontrol kanıt
// imzasına bağlıdır: kanıt değişirse sunucu 409 döner ve ekran yenileyip yeniden sorar. Yalnız
// KESİN + DOĞRULANDI etiket Retirement kaydına gönderilebilir.
import React, { useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
} from '@heroicons/react/24/outline';
import {
  serverHubApi,
  type ShEtiketKurali,
  type ShRetireEtiket,
  type ShRetireSonuc,
} from '@/api/serverHubApi';
import { toast } from '@/hooks/useToast';
import { fmtDateTime, fmtNumber } from '@/utils/datetime';
import { TableEmptyRow } from '@/components/common/EmptyState';
import {
  BOS_SUZGEC,
  ETIKET_SEVIYE,
  KONTROL_DURUM,
  TUR_ETIKET,
  etiketSuz,
  komutDoldur,
  konuMetni,
  retirementUygulamasi,
  type EtiketBilgi,
  type EtiketSuzgeci,
  type EtiketTon,
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
export function KontrolFormu({ e, onDegisti }: { e: ShRetireEtiket; onDegisti: () => void }) {
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
function KopyaTablosu({ e }: { e: ShRetireEtiket }) {
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
              <td className={`${td} font-mono font-semibold`}>
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
                        <div key={`${w.host}|${w.vhost}`} className="font-mono">
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
              <td className={`${td} font-mono`}>{c.kurallar.join(', ') || '—'}</td>
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
  e: ShRetireEtiket;
  kurallar: ShEtiketKurali[];
  onDegisti: () => void;
  onRetirementAc?: (uygulama: string, not: string) => void;
}) {
  const kAd = new Map(kurallar.map((k) => [k.kural, k]));
  const uyg = retirementUygulamasi(e);
  const log = e.kopyalar.flatMap((c) => c.web || []).find((w) => w.log)?.log || null;
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
      <KopyaTablosu e={e} />
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
  const [s, setS] = useState<EtiketSuzgeci>(BOS_SUZGEC);
  const [acik, setAcik] = useState<string | null>(null);
  const etiketler = useMemo(() => veri?.etiketler || [], [veri]);
  const satirlar = useMemo(() => etiketSuz(etiketler, s), [etiketler, s]);
  const ortamlar = useMemo(() => [...new Set(etiketler.map((e) => e.ortam))].sort(), [etiketler]);
  const kurallar = veri?.kurallar || [];
  const kAd = new Map(kurallar.map((k) => [k.kural, k.ad]));
  const set =
    <K extends keyof EtiketSuzgeci>(k: K) =>
    (x: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setS((o) => ({ ...o, [k]: x.target.value }));
  const oz = veri?.ozet;
  return (
    <div className="space-y-3" data-testid="retire-etiketleri">
      {veri?.ear?.okunamadi && (
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            borderColor: 'var(--status-warning)',
            background: 'var(--status-warning-bg)',
            color: 'var(--status-warning-text)',
          }}
        >
          Uygulama Envanteri okunamadı: EAR ve kök girdisi etiketleri listede YOK (“temiz” demek
          değil). {veri.ear.hata || ''}
        </div>
      )}
      {veri?.kontrolOkunamadi && (
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            borderColor: 'var(--status-warning)',
            background: 'var(--status-warning-bg)',
            color: 'var(--status-warning-text)',
          }}
        >
          {KONTROL_DURUM.BILINMIYOR.aciklama}
        </div>
      )}
      {oz && (
        <div className="flex flex-wrap gap-2 text-xs">
          {[
            ['kesin', oz.kesin, () => setS((o) => ({ ...o, seviye: 'KESIN', durum: 'acik' }))],
            [
              'şüpheli',
              oz.supheli,
              () => setS((o) => ({ ...o, seviye: 'SUPHELI', durum: 'acik' })),
            ],
            [
              'kontrol bekleyen',
              oz.bekliyor,
              () => setS((o) => ({ ...o, seviye: 'all', durum: 'BEKLIYOR' })),
            ],
            [
              'retirement’a hazır',
              oz.retirementHazir,
              () => setS((o) => ({ ...o, seviye: 'KESIN', durum: 'DOGRULANDI' })),
            ],
            [
              'yanlış alarm (gizli)',
              oz.yanlisAlarm,
              () => setS((o) => ({ ...o, seviye: 'all', durum: 'YANLIS_ALARM' })),
            ],
          ].map(([ad, n, f]) => (
            <button
              key={ad as string}
              type="button"
              onClick={f as () => void}
              className="px-2.5 py-1 rounded-lg border"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
            >
              {ad as string} <b className="tabular-nums">{fmtNumber(n as number)}</b>
            </button>
          ))}
          {oz.dusurulen > 0 && (
            <span className="self-center" style={{ color: 'var(--text-muted)' }}>
              · {fmtNumber(oz.dusurulen)} etiket “kesin”den şüpheliye indi (nedeni satırda)
            </span>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={s.q}
          onChange={set('q')}
          placeholder="uygulama, sunucu ya da neden ara"
          aria-label="Etiketlerde ara"
          className={`${GIRDI} w-64`}
          style={girdiStil}
        />
        <select
          value={s.seviye}
          onChange={set('seviye')}
          className={GIRDI}
          style={girdiStil}
          aria-label="etiket"
        >
          <option value="all">tüm etiketler</option>
          <option value="KESIN">kesin</option>
          <option value="SUPHELI">şüpheli</option>
        </select>
        <select
          value={s.durum}
          onChange={set('durum')}
          className={GIRDI}
          style={girdiStil}
          aria-label="kontrol durumu"
        >
          <option value="acik">açık (yanlış alarm hariç)</option>
          <option value="all">hepsi</option>
          {(Object.keys(KONTROL_DURUM) as (keyof typeof KONTROL_DURUM)[]).map((d) => (
            <option key={d} value={d}>
              {KONTROL_DURUM[d].etiket}
            </option>
          ))}
        </select>
        <select
          value={s.tur}
          onChange={set('tur')}
          className={GIRDI}
          style={girdiStil}
          aria-label="konu türü"
        >
          <option value="all">tüm türler</option>
          {(Object.keys(TUR_ETIKET) as (keyof typeof TUR_ETIKET)[]).map((t) => (
            <option key={t} value={t}>
              {TUR_ETIKET[t]}
            </option>
          ))}
        </select>
        <select
          value={s.ortam}
          onChange={set('ortam')}
          className={GIRDI}
          style={girdiStil}
          aria-label="ortam"
        >
          <option value="all">tüm ortamlar</option>
          {ortamlar.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {fmtNumber(satirlar.length)} / {fmtNumber(etiketler.length)} etiket
        </span>
        <button
          type="button"
          onClick={() => onYenile(true)}
          className={`${BTN} ml-auto`}
          style={btnStil()}
        >
          <ArrowPathIcon className={`w-3.5 h-3.5 ${yukleniyor ? 'animate-spin' : ''}`} /> Yenile
        </button>
      </div>
      <div
        className="overflow-x-auto rounded-xl border"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <table className="w-full text-xs">
          <thead>
            <tr
              className="text-left"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
            >
              <th className="px-3 py-2 w-6" aria-label="aç / kapa" />
              <th className="px-3 py-2">Etiket</th>
              <th className="px-3 py-2">Konu</th>
              <th className="px-3 py-2">Ortam</th>
              <th className="px-3 py-2">Kural</th>
              <th className="px-3 py-2">Sunucular</th>
              <th className="px-3 py-2">Zincir</th>
              <th className="px-3 py-2">Kontrol</th>
            </tr>
          </thead>
          <tbody>
            {satirlar.map((e) => {
              const ac = acik === e.anahtar;
              return (
                <React.Fragment key={e.anahtar}>
                  <tr
                    className="border-t cursor-pointer"
                    style={{
                      borderColor: 'var(--border-subtle)',
                      background: ac ? 'var(--bg-elevated)' : undefined,
                    }}
                    onClick={() => setAcik(ac ? null : e.anahtar)}
                    aria-expanded={ac}
                  >
                    <td className="px-3 py-1.5">
                      {ac ? (
                        <ChevronDownIcon className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRightIcon className="w-3.5 h-3.5" />
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <EtiketRozeti b={ETIKET_SEVIYE[e.seviye]} />
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="font-mono font-semibold">{konuMetni(e)}</div>
                      <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {TUR_ETIKET[e.tur]}
                        {e.tier.length ? ` · tier ${e.tier.join('/')}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-1.5">{e.ortam}</td>
                    <td
                      className="px-3 py-1.5"
                      title={e.kurallar.map((r) => `${r}: ${kAd.get(r) || ''}`).join('\n')}
                    >
                      {e.kurallar.map((r) => (
                        <div key={r} className="text-[11px]">
                          <span className="font-mono">{r}</span> {kAd.get(r) || ''}
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11px]">
                      {e.hostlar.slice(0, 3).join(', ')}
                      {e.hostlar.length > 3 ? ` +${e.hostlar.length - 3}` : ''}
                    </td>
                    <td className="px-3 py-1.5 text-[11px]">
                      {e.nedenler.length ? (
                        <span style={{ color: 'var(--status-warning-text)' }}>
                          {e.nedenler[0]}
                          {e.nedenler.length > 1 ? ` +${e.nedenler.length - 1}` : ''}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>kanıt tam</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <EtiketRozeti b={KONTROL_DURUM[e.durum]} kucuk />
                    </td>
                  </tr>
                  {ac && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-3"
                        style={{ background: 'var(--bg-surface)' }}
                      >
                        <EtiketAyrinti
                          e={e}
                          kurallar={kurallar}
                          onDegisti={() => onYenile(false)}
                          onRetirementAc={onRetirementAc}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {!yukleniyor && satirlar.length === 0 && (
              <TableEmptyRow
                colSpan={8}
                title={
                  etiketler.length ? 'Süzgeçle eşleşen etiket yok.' : 'Retirement etiketi yok.'
                }
                description={
                  veri?.ear?.okunamadi
                    ? 'Uygulama Envanteri okunamadığı için EAR etiketleri hesaplanmadı.'
                    : undefined
                }
              />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
