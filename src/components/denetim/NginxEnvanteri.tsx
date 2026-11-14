// src/components/denetim/NginxEnvanteri.tsx — Nginx Hub > "Envanter".
//
// Kaynak: dbo.nginx_inventory (bmw_nginx/nginx_metadata job'ı doldurur). Her sunucuda
// bir .metadata dosyası üretilip toplanıyor.
//
// Tablo her koşuda TRUNCATE edilip yeniden yazılıyor — yani GEÇMİŞ YOK, tablo her zaman
// "şu anki hâl". Bu yüzden burada tarih seçici yok; tazelik göstergesi olarak en yeni
// `source_last_update` gösteriliyor.
//
// YENİDEN TASARIM (kullanıcı, 2026-11-12: "göze hiç hoş gözükmüyor ... en güzel UI/UX ile düzeltelim"):
//   - Beş ayrı kutu yerine tek bir FİLO ÖZETİ: büyük sunucu sayısı, ortam çubuğu (PROD/QA/TEST/DEV/EDU,
//     ad kalıbından), kapasite rakamları ve nginx sürüm uyumu (en yaygın sürüm + farklı olanlar).
//   - Ortamlar: ikili production/non-production tablosu yerine ortam başına kart (lokasyon, sürüm,
//     OS, kapasite). Kart ve sürüm çiplerine tıklamak Sunucular listesini o süzgeçle açar.
//   - Sunucular: ortam / sürüm / etiket süzgeci, sıralanabilir kolonlar, service'ler çip olarak.
//   - ELLE ETİKET (aynı gün, kullanıcı): conf.d adlarından gelen otomatik service listesinin yerine
//     geçen ya da üstüne eklenen etiket (Admin yazar; bkz. NginxEtiketPenceresi).
//
// SÜRÜM GÖSTERİMİ + DİSK (kullanıcı, 2026-11-14: "versiyon gösterimleri göze güzel gözükmüyor ...
// sürüm uyumu diye bir şey yapmana gerek yok ... sunucular kısmında disk kapasiteleri görünmüyor"):
//   - "Sürüm uyumu" şeridi ve "en yaygın sürümden ayrışan" sarı vurgusu kaldırıldı; hiçbir sürüm
//     "yanlış" diye boyanmaz.
//   - Sürüm her yerde tek biçimde: SurumRozeti (eşit genişlikli rakam, major.minor koyu + yama soluk,
//     sayı varsa aynı rozetin ikinci bölmesinde). Listeler yeniden eskiye sıralı, uzun liste "+N".
//   - Sürümler sekmesinde nginx kartı major.minor ailesine göre gruplanır (SurumAileKarti).
//   - Sunucular tablosuna /usr/nginx ve /web_log disk kolonları (sıralanabilir). nginx_metadata
//     yalnız `df -hP` TOPLAM boyutunu ($2) yazar — kullanım/yüzde YOK; o yüzden doluluk çubuğu
//     çizilmez (olmayan veriyi uydurmak olur). Çözülemeyen değer "—" + title'da ham değer.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GuncellemeRozeti } from '@/components/common/GuncellemeRozeti';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  MagnifyingGlassIcon,
  ServerStackIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  TagIcon,
  PencilSquareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  denetimApi,
  type NginxInventoryResult,
  type NginxInvDist,
  type NginxInvHost,
} from '@/api/denetimApi';
import { Note } from './ui';
import { downloadCsv as csvDownload } from '@/utils/csv';
import { useAuth } from '@/contexts/AuthContext';
import { NginxEtiketPenceresi } from './NginxEtiketPenceresi';

const nf = (n: number) => new Intl.NumberFormat('tr-TR').format(n);

// ── Ortam ────────────────────────────────────────────────────────────────────────
// Sunucu tarafı satıra ad kalıbından ortam koyar (envByName: PROD/QA/TEST/DEV/EDU/BILINMIYOR).
// Tablodaki `env` yalnız production/non-production; kalıp dışı sunucu "Kalıp dışı" kovasında
// görünür (sessizce bir ortama atılmaz).
const ORTAM_SIRA = ['PROD', 'QA', 'TEST', 'DEV', 'EDU', 'BILINMIYOR'] as const;
const ORTAM_AD: Record<string, string> = { BILINMIYOR: 'Kalıp dışı' };
const ORTAM_RENK: Record<string, string> = {
  PROD: 'var(--nh-hub)',
  QA: 'var(--status-info)',
  TEST: 'var(--accent)',
  DEV: 'var(--ah-hue)',
  EDU: 'var(--bh-hue)',
  BILINMIYOR: 'var(--status-neutral)',
};
export function ortamOf(h: NginxInvHost): string {
  const e = (h.envByName || '').toUpperCase();
  if (e && e !== 'BILINMIYOR') return e;
  return h.env === 'production' ? 'PROD' : 'BILINMIYOR';
}
const ortamAdi = (o: string) => ORTAM_AD[o] || o;
const ortamRengi = (o: string) => ORTAM_RENK[o] || 'var(--status-neutral)';
const ortamSirala = (a: string, b: string) => {
  const ia = ORTAM_SIRA.indexOf(a as (typeof ORTAM_SIRA)[number]);
  const ib = ORTAM_SIRA.indexOf(b as (typeof ORTAM_SIRA)[number]);
  return (ia < 0 ? 50 : ia) - (ib < 0 ? 50 : ib) || a.localeCompare(b);
};

/** "16G" / "512M" -> GiB (sunucu özetindeki toGiB ile aynı kural); çözülemezse null. */
function gib(v: string | null): number | null {
  const m = /^([\d.]+)\s*([KMGT])i?B?$/i.exec(String(v || '').trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  return n * ({ k: 1 / 1048576, m: 1 / 1024, g: 1, t: 1024 } as Record<string, number>)[m[2].toLowerCase()];
}

const servisler = (h: NginxInvHost) =>
  String(h.services || '')
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Etiketle gelen (otomatik listede olmayan) adlar. */
const elleAdlar = (h: NginxInvHost) =>
  h.etiket ? new Set(h.etiket.etiketler.filter((x) => !h.etiket!.oto.includes(x))) : new Set<string>();

const UST_ETIKET = 'text-[11px] font-semibold uppercase tracking-[0.06em]';

// ── Küçük parçalar ─────────────────────────────────────────────────────────────

function OrtamRozeti({ ortam }: { ortam: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap"
      style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)', background: 'var(--bg-surface)' }}
    >
      <span aria-hidden="true" className="w-2 h-2 rounded-full" style={{ background: ortamRengi(ortam) }} />
      {ortamAdi(ortam)}
    </span>
  );
}

// ── Sürüm ──────────────────────────────────────────────────────────────────────
// nginx -v çıktısından gelen serbest metin: "1.24.0", "nginx/1.26.3", "1.25.1 (nginx-plus-r30)",
// "unknown". major.minor = aile; geri kalanı yama + ek.
const BILINMEYEN_SURUM = /^(unknown|\(bilinmiyor\)|n\/a|-)?$/i;
export type SurumParca = { ham: string; aile: string; yama: string; ek: string; bilinmiyor: boolean };
export function surumAyristir(v: string | null | undefined): SurumParca {
  const ham = String(v ?? '').trim();
  if (BILINMEYEN_SURUM.test(ham)) return { ham, aile: '', yama: '', ek: '', bilinmiyor: true };
  const m = /^(?:nginx(?:-plus)?\/)?(\d+\.\d+)((?:\.\d+)*)(.*)$/i.exec(ham);
  if (!m) return { ham, aile: ham, yama: '', ek: '', bilinmiyor: false };
  return { ham, aile: m[1], yama: m[2], ek: m[3].trim(), bilinmiyor: false };
}
/** Yeniden eskiye; bilinmeyen en sonda. */
export function surumKarsilastir(a: string, b: string): number {
  const pa = surumAyristir(a);
  const pb = surumAyristir(b);
  if (pa.bilinmiyor !== pb.bilinmiyor) return pa.bilinmiyor ? 1 : -1;
  const na = (pa.aile + pa.yama).split('.').map((x) => parseInt(x, 10));
  const nb = (pb.aile + pb.yama).split('.').map((x) => parseInt(x, 10));
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (Number.isFinite(nb[i]) ? nb[i] : -1) - (Number.isFinite(na[i]) ? na[i] : -1);
    if (d) return d;
  }
  return a.localeCompare(b);
}
const surumAnahtari = (v: string | null | undefined) => (surumAyristir(v).bilinmiyor ? '(bilinmiyor)' : String(v).trim());

/** Sürüm metni: aile koyu, yama soluk, ek (nginx-plus vb.) yalnız title'da. */
function SurumMetni({ v }: { v: string }) {
  const p = surumAyristir(v);
  if (p.bilinmiyor)
    return (
      <span className="italic" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
        bilinmiyor
      </span>
    );
  return (
    <span>
      <span style={{ color: 'var(--text-primary)' }} className="font-semibold">
        {p.aile}
      </span>
      {p.yama && <span style={{ color: 'var(--text-muted)' }}>{p.yama}</span>}
      {p.ek && (
        <>
          <span style={{ color: 'var(--text-muted)' }} aria-hidden="true">
            *
          </span>
          <span className="sr-only"> {p.ek}</span>
        </>
      )}
    </span>
  );
}

/**
 * Tek sürüm rozeti; `sayi` verilirse aynı rozetin sağ bölmesinde sunucu sayısı. Rakamlar eşit
 * genişlikte (font-mono + tabular-nums) ki alt alta gelen rozetler hizalı dursun. Renk YOK: hiçbir
 * sürüm "doğru/yanlış" diye boyanmaz (kullanıcı, 2026-11-14: sürüm uyumu istenmiyor).
 */
function SurumRozeti({
  v,
  sayi,
  onClick,
  title,
  aktif,
}: {
  v: string;
  sayi?: number;
  onClick?: () => void;
  title?: string;
  aktif?: boolean;
}) {
  const p = surumAyristir(v);
  const ipucu = title ?? (p.ek ? p.ham : undefined);
  const govde = (
    <>
      <span className="px-1.5 py-px">
        <SurumMetni v={v} />
      </span>
      {sayi != null && (
        <span
          className="px-1.5 py-px border-l"
          style={{
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-sans)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span className="sr-only">, </span>
          {nf(sayi)}
          <span className="sr-only"> sunucu</span>
        </span>
      )}
    </>
  );
  const cls =
    'inline-flex items-stretch rounded-[var(--radius-sm)] border text-[11.5px] leading-[1.35rem] tabular-nums whitespace-nowrap overflow-hidden';
  const stil: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    borderColor: aktif ? 'var(--accent)' : 'var(--border-subtle)',
    background: aktif ? 'var(--accent-bg)' : 'var(--bg-elevated)',
  };
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={`${cls} transition-colors hover:border-[var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]`}
      style={stil}
      title={ipucu}
      data-testid="surum-rozeti"
      data-surum={p.ham}
    >
      {govde}
    </button>
  ) : (
    <span className={cls} style={stil} title={ipucu} data-testid="surum-rozeti" data-surum={p.ham}>
      {govde}
    </span>
  );
}

/** Sürüm → sayı listesini yeniden eskiye rozetlerle verir; `sinir`dan fazlası "+N" ile açılır. */
function SurumListesi({
  items,
  sinir = 4,
  onSec,
  baslik,
  aktifSurum,
}: {
  items: [string, number][];
  sinir?: number;
  onSec?: (v: string) => void;
  baslik?: (v: string, c: number) => string;
  /** Sunucular'daki etkin sürüm süzgeci (surumAnahtari biçiminde); eşleşen rozet vurgulanır. */
  aktifSurum?: string;
}) {
  const [hepsi, setHepsi] = useState(false);
  const sirali = [...items].sort((a, b) => surumKarsilastir(a[0], b[0]));
  if (!sirali.length) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const gorunen = hepsi ? sirali : sirali.slice(0, sinir);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {gorunen.map(([v, c]) => (
        <SurumRozeti
          key={v}
          v={v}
          sayi={c}
          onClick={onSec ? () => onSec(v) : undefined}
          title={baslik?.(v, c)}
          aktif={!!aktifSurum && surumAnahtari(v) === aktifSurum}
        />
      ))}
      {sirali.length > sinir && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setHepsi((x) => !x);
          }}
          className="text-[11px] px-1 tabular-nums hover:underline"
          style={{ color: 'var(--accent)' }}
          aria-label={hepsi ? 'Daha az sürüm göster' : `${sirali.length - sinir} sürüm daha göster`}
        >
          {hepsi ? 'daha az' : `+${sirali.length - sinir}`}
        </button>
      )}
    </span>
  );
}

const sayac = (degerler: (string | null | undefined)[]) => {
  const m = new Map<string, number>();
  for (const v of degerler) {
    const k = surumAnahtari(v);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()];
};

/**
 * Sürümler sekmesi: nginx sürümleri major.minor ailesine göre. Aile satırı = pay çubuğu + sayı,
 * altında o ailenin yamaları rozet olarak (tıklayınca Sunucular o sürüme süzülür).
 */
function SurumAileKarti({
  items,
  total,
  onSec,
  aktifSurum,
}: {
  items: NginxInvDist[];
  total: number;
  onSec: (v: string) => void;
  aktifSurum?: string;
}) {
  // "unknown" / NULL / "(bilinmiyor)" sunucu tarafında ayrı kova olabilir; burada tek rozette toplanır.
  const birlesik = new Map<string, number>();
  for (const i of items) {
    const k = surumAnahtari(i.value);
    birlesik.set(k, (birlesik.get(k) || 0) + i.count);
  }
  const aileler = new Map<string, { aile: string; sayi: number; surumler: [string, number][] }>();
  for (const [v, c] of birlesik) {
    const p = surumAyristir(v);
    const a = p.bilinmiyor ? '' : p.aile;
    if (!aileler.has(a)) aileler.set(a, { aile: a, sayi: 0, surumler: [] });
    const g = aileler.get(a)!;
    g.sayi += c;
    g.surumler.push([v, c]);
  }
  const sirali = [...aileler.values()].sort((x, y) =>
    !x.aile ? 1 : !y.aile ? -1 : surumKarsilastir(`${x.aile}.0`, `${y.aile}.0`),
  );
  const max = Math.max(1, ...sirali.map((a) => a.sayi));
  return (
    <section
      className="rounded-xl border p-4 md:col-span-2 xl:col-span-1 xl:row-span-2"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
      data-testid="surum-aile-karti"
    >
      <header className="flex items-baseline justify-between gap-2 mb-3">
        <h4 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
          nginx sürümü
        </h4>
        <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {nf(sirali.filter((a) => a.aile).length)} aile · {nf(birlesik.size)} sürüm
        </span>
      </header>
      {!sirali.length ? (
        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Veri yok.</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
          {sirali.map((a, sira) => {
            const yuzde = total ? Math.round((a.sayi / total) * 100) : 0;
            return (
              <li key={a.aile || 'bilinmiyor'} className="py-2.5 first:pt-0 last:pb-0" style={{ borderColor: 'var(--border-subtle)' }} data-testid="surum-ailesi">
                <div className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3">
                  <span className="text-[13px] font-semibold tabular-nums" style={{ fontFamily: 'var(--font-mono)', color: a.aile ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {a.aile || <span className="italic text-[12px] font-normal" style={{ fontFamily: 'var(--font-sans)' }}>bilinmiyor</span>}
                  </span>
                  <span className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }} aria-hidden="true">
                    <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (a.sayi / max) * 100)}%`, background: 'var(--nh-hub)', opacity: 0.7 }} />
                  </span>
                  <span className="text-[12px] tabular-nums text-right" style={{ color: 'var(--text-secondary)' }}>
                    {nf(a.sayi)}
                    <span className="ml-1.5 inline-block w-9 text-right" style={{ color: 'var(--text-muted)' }}>
                      %{yuzde}
                    </span>
                  </span>
                </div>
                <div className="mt-1.5 pl-0 sm:pl-[5.25rem]">
                  <SurumListesi
                    items={a.surumler}
                    sinir={6}
                    onSec={onSec}
                    aktifSurum={aktifSurum}
                    baslik={(v, c) => `${v}: ${nf(c)} sunucu — listele`}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── Disk ───────────────────────────────────────────────────────────────────────
/** GiB -> "512 MiB" / "50 GiB" / "7,5 GiB" / "1,5 TiB" (1 GiB altı MiB, "0 GiB" görünmesin). */
function boyutYaz(g: number): string {
  if (g > 0 && g < 1) return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(g * 1024)} MiB`;
  if (g >= 1024) return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(g / 1024)} TiB`;
  return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: g < 10 ? 1 : 0 }).format(g)} GiB`;
}

/** Boyut hücresi (disk: df -hP toplam boyutu, bellek); çözülemezse "—" ve title'da neden. */
function DiskHucresi({ v, yol, tur = 'disk boyutu' }: { v: string | null; yol: string; tur?: string }) {
  const g = gib(v);
  if (g == null) {
    const ham = String(v ?? '').trim();
    const neden = ham ? `${yol}: "${ham}" çözümlenemedi` : `${yol}: değer yok`;
    return (
      <span style={{ color: 'var(--text-muted)' }} title={neden}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{neden}</span>
      </span>
    );
  }
  return (
    <span title={`${yol} ${tur}: ${String(v).trim()}`} style={{ color: 'var(--text-primary)' }}>
      {boyutYaz(g)}
    </span>
  );
}

function ServisCipleri({ h, sinir = 4 }: { h: NginxInvHost; sinir?: number }) {
  const [hepsi, setHepsi] = useState(false);
  const liste = servisler(h);
  const elle = elleAdlar(h);
  if (!liste.length) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const gorunen = hepsi ? liste : liste.slice(0, sinir);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {gorunen.map((s) =>
        s === 'too_many' ? (
          <span
            key={s}
            className="px-1.5 py-0.5 rounded-md text-[11px] italic"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
            title="5'ten fazla service; nginx_metadata listeyi toplamadı. Etiketle tam listeyi verebilirsiniz."
          >
            5+ service
          </span>
        ) : (
          <span
            key={s}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] border"
            style={{
              fontFamily: 'var(--font-mono)',
              borderColor: elle.has(s) ? 'var(--accent-light)' : 'var(--border-subtle)',
              background: elle.has(s) ? 'var(--accent-bg)' : 'var(--bg-surface)',
              color: 'var(--text-primary)',
            }}
            title={elle.has(s) ? 'Elle etiket' : 'conf.d dosya adından'}
          >
            {elle.has(s) && <TagIcon className="w-3 h-3" style={{ color: 'var(--accent)' }} aria-hidden="true" />}
            {s}
          </span>
        ),
      )}
      {liste.length > sinir && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setHepsi((x) => !x);
          }}
          className="text-[11px] px-1 hover:underline"
          style={{ color: 'var(--accent)' }}
        >
          {hepsi ? 'daha az' : `+${liste.length - sinir}`}
        </button>
      )}
    </span>
  );
}

/** Bir alanın değer dağılımı: kart, ilk 6 değer, gerisi açılır. */
function DagilimKarti({
  title,
  items,
  total,
  onSec,
}: {
  title: string;
  items: NginxInvDist[];
  total: number;
  onSec?: (v: string) => void;
}) {
  const [hepsi, setHepsi] = useState(false);
  const max = Math.max(1, ...items.map((i) => i.count));
  const gorunen = hepsi ? items : items.slice(0, 6);
  return (
    <section className="rounded-xl border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
      <header className="flex items-baseline justify-between gap-2 mb-3">
        <h4 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
          {title}
        </h4>
        <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {nf(items.length)} değer
        </span>
      </header>
      {!items.length ? (
        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Veri yok.</p>
      ) : (
        <ul className="space-y-2">
          {gorunen.map((i, n) => {
            const yuzde = total ? Math.round((i.count / total) * 100) : 0;
            const satir = (
              <>
                <span className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span
                    className="truncate"
                    style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}
                    title={i.value}
                  >
                    {i.value}
                  </span>
                  <span className="shrink-0 tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {nf(i.count)}
                    <span className="ml-1.5 inline-block w-9 text-right" style={{ color: 'var(--text-muted)' }}>
                      %{yuzde}
                    </span>
                  </span>
                </span>
                <span className="mt-1 block h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.max(2, (i.count / max) * 100)}%`,
                      background: 'var(--nh-hub)',
                      opacity: n === 0 ? 0.9 : 0.5,
                    }}
                  />
                </span>
              </>
            );
            return (
              <li key={i.value}>
                {onSec ? (
                  <button
                    type="button"
                    onClick={() => onSec(i.value)}
                    className="block w-full text-left rounded focus-visible:outline focus-visible:outline-2 group"
                    title={`${i.value} — sunucuları listele`}
                  >
                    {satir}
                  </button>
                ) : (
                  satir
                )}
              </li>
            );
          })}
        </ul>
      )}
      {items.length > 6 && (
        <button
          type="button"
          onClick={() => setHepsi((x) => !x)}
          className="mt-3 text-[12px] hover:underline"
          style={{ color: 'var(--accent)' }}
        >
          {hepsi ? 'Daha az göster' : `Tümünü göster (+${nf(items.length - 6)})`}
        </button>
      )}
    </section>
  );
}

// SERVICE AYRINTISI (2026-10-14, kullanici: "servislere geldigimde ... uzerine tikladigimda ilgili
// servisin hangi sunucuda ve hangi versiyonda oldugunu gormek istiyorum"). Envanterde service basina
// surum YOK (service adi .conf dosya adindan cikar); surum = o sunucudaki NGINX surumu. Ozet: hangi
// surum kac sunucuda - birden fazlaysa ayrica soylenir.
function ServiceSunuculari({
  service,
  hosts,
  unlisted,
}: {
  service: string;
  hosts: NginxInvHost[];
  unlisted: string[];
}) {
  const surumler = sayac(hosts.map((h) => h.nginx_version));
  const digerUnlisted = service === 'too_many' ? [] : unlisted;
  return (
    <div className="space-y-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2" data-testid="service-surumleri">
        <span className={UST_ETIKET} style={{ color: 'var(--text-muted)' }}>
          nginx
        </span>
        <SurumListesi items={surumler} sinir={8} baslik={(v, c) => `${v}: ${nf(c)} sunucu`} />
        {surumler.length > 1 && (
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {surumler.length} farklı sürüm
          </span>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th className="text-left font-semibold px-3 py-1.5">Sunucu</th>
              <th className="text-left font-semibold px-3 py-1.5">Ortam</th>
              <th className="text-left font-semibold px-3 py-1.5">Lokasyon</th>
              <th className="text-left font-semibold px-3 py-1.5">nginx sürümü</th>
              <th className="text-left font-semibold px-3 py-1.5">OS</th>
              <th className="text-left font-semibold px-3 py-1.5">IP</th>
              <th className="text-left font-semibold px-3 py-1.5">Sunucudaki service&apos;ler</th>
            </tr>
          </thead>
          <tbody>
            {hosts.map((h) => (
              <tr key={h.hostname} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <td className="px-3 py-1.5 whitespace-nowrap" style={{ fontFamily: 'var(--font-mono)' }} title={h.fqdn || h.hostname}>
                  {h.hostname}
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <OrtamRozeti ortam={ortamOf(h)} />
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap">{h.location || '—'}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <SurumRozeti v={h.nginx_version || ''} />
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap" title={h.kernel || ''}>
                  {h.os || '—'}
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap" style={{ fontFamily: 'var(--font-mono)' }}>
                  {h.ip || '—'}
                </td>
                <td className="px-3 py-1.5">{h.services || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {digerUnlisted.length > 0 && (
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          Not: {nf(digerUnlisted.length)} sunucunun service listesi toplanmadı (5&apos;ten fazla
          service — &quot;too_many&quot;); bu service o sunucularda da olabilir, bu listede
          görünmez: <span style={{ fontFamily: 'var(--font-mono)' }}>{digerUnlisted.join(', ')}</span>
        </p>
      )}
    </div>
  );
}

type View = 'ortam' | 'versiyon' | 'service' | 'kaynak' | 'sunucular';
type SiraAnahtar = 'hostname' | 'ortam' | 'location' | 'nginx' | 'os' | 'cpu' | 'bellek' | 'diskNginx' | 'diskWebLog' | 'konf';

function SiraTh({
  k,
  sira,
  onSirala,
  children,
  sag,
  title,
}: {
  k: SiraAnahtar;
  sira: { k: SiraAnahtar; yon: 1 | -1 };
  onSirala: (k: SiraAnahtar) => void;
  children: React.ReactNode;
  sag?: boolean;
  title?: string;
}) {
  const aktif = sira.k === k;
  const Ok = aktif && sira.yon === -1 ? ChevronDownIcon : ChevronUpIcon;
  return (
    <th
      className={`sticky top-0 z-10 px-3 py-2 font-semibold whitespace-nowrap ${sag ? 'text-right' : 'text-left'}`}
      style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
      aria-sort={aktif ? (sira.yon === 1 ? 'ascending' : 'descending') : 'none'}
      title={title}
    >
      <button
        type="button"
        onClick={() => onSirala(k)}
        className={`inline-flex items-center gap-1 hover:text-[var(--text-primary)] ${sag ? 'flex-row-reverse' : ''}`}
      >
        {children}
        <Ok className="w-3 h-3" style={{ opacity: aktif ? 1 : 0.25 }} aria-hidden="true" />
      </button>
    </th>
  );
}

const btnIkincil =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg hover:bg-[var(--bg-elevated)] transition-colors';

export function NginxEnvanteri() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';
  const [data, setData] = useState<NginxInventoryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [view, setView] = useState<View>('ortam');
  const [q, setQ] = useState('');
  const [sq, setSq] = useState('');
  const [ortamSuz, setOrtamSuz] = useState('');
  const [surumSuz, setSurumSuz] = useState('');
  /** Süzgeç nginx sürümüne mi OS'a mı? Ayrı tutulur: "(bilinmiyor)" iki alanda da olabilir. */
  const [surumTuru, setSurumTuru] = useState<'nginx' | 'os'>('nginx');
  const [etiketliSuz, setEtiketliSuz] = useState(false);
  const [sira, setSira] = useState<{ k: SiraAnahtar; yon: 1 | -1 }>({ k: 'hostname', yon: 1 });
  const [etiketHost, setEtiketHost] = useState<NginxInvHost | null>(null);
  const [acikService, setAcikService] = useState<Set<string>>(() => new Set());
  const serviceAc = (s: string) =>
    setAcikService((m) => {
      const y = new Set(m);
      if (y.has(s)) y.delete(s);
      else y.add(s);
      return y;
    });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await denetimApi.nginxInventory();
      if (r.ok) {
        setData(r);
        setErr('');
      } else setErr(r.message || 'Veri alınamadı.');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // ILK YUKLEME EFFECT ICINDE: istek BURADA kurulur, `load()` cagrilmaz.
  //
  // NEDEN: `load` ilk isi olarak `setLoading(true)` cagiriyor ve React 19'un
  // `set-state-in-effect` kurali, effect'ten cagrilan bir fonksiyonun ICINDEKI
  // setState'i de "effect'te senkron" sayiyor — `setLoading(true)`'yu cikarmak
  // BILE yetmiyor (olculdu). Burada ilk ifade `await`, yani hicbir setState
  // senkron degil. `loading` zaten `true` basladigi icin ilk yuklemede bayragi
  // ayrica kaldirmaya gerek de yok.
  //
  // `alive` bayragi ayri bir kazanc: sekme yanit gelmeden kapanirsa cozulmus
  // istegin sonucu artik olmayan bir bilesene yazilmaz.
  // `load` KALIYOR: Yenile dugmesi onu cagiriyor ve olay isleyicisinde
  // setState tamamen mesru.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await denetimApi.nginxInventory();
        if (!alive) return;
        if (r.ok) {
          setData(r);
          setErr('');
        } else setErr(r.message || 'Veri alınamadı.');
      } catch (e: unknown) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const hostByName = useMemo(() => new Map((data?.hosts ?? []).map((h) => [h.hostname, h])), [data]);

  const ortamlar = useMemo(() => {
    const m = new Map<
      string,
      { ortam: string; hosts: NginxInvHost[]; lok: Map<string, number>; surum: Map<string, number>; os: Map<string, number>; cpu: number; bellek: number; etiketli: number }
    >();
    for (const h of data?.hosts ?? []) {
      const o = ortamOf(h);
      if (!m.has(o)) m.set(o, { ortam: o, hosts: [], lok: new Map(), surum: new Map(), os: new Map(), cpu: 0, bellek: 0, etiketli: 0 });
      const g = m.get(o)!;
      g.hosts.push(h);
      const lok = h.location && h.location !== '(bilinmiyor)' ? h.location : 'lokasyonsuz';
      g.lok.set(lok, (g.lok.get(lok) || 0) + 1);
      const v = surumAnahtari(h.nginx_version);
      g.surum.set(v, (g.surum.get(v) || 0) + 1);
      const os = h.os || '(bilinmiyor)';
      g.os.set(os, (g.os.get(os) || 0) + 1);
      g.cpu += parseInt(String(h.cpu ?? ''), 10) || 0;
      g.bellek += gib(h.memory) || 0;
      if (h.etiket) g.etiketli += 1;
    }
    return [...m.values()].sort((a, b) => ortamSirala(a.ortam, b.ortam));
  }, [data]);

  const etiketliSayi = useMemo(() => (data?.hosts ?? []).filter((h) => h.etiket).length, [data]);

  const hostRows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const rows = data.hosts.filter((h) => {
      if (ortamSuz && ortamOf(h) !== ortamSuz) return false;
      if (surumSuz && (surumTuru === 'os' ? (h.os || '(bilinmiyor)') !== surumSuz : surumAnahtari(h.nginx_version) !== surumSuz))
        return false;
      if (etiketliSuz && !h.etiket) return false;
      if (!needle) return true;
      return `${h.hostname} ${h.fqdn || ''} ${ortamOf(h)} ${h.location || ''} ${h.services || ''} ${h.ip || ''} ${h.nginx_version || ''} ${h.os || ''}`
        .toLowerCase()
        .includes(needle);
    });
    const deger = (h: NginxInvHost): string | number | null => {
      switch (sira.k) {
        case 'ortam':
          return ORTAM_SIRA.indexOf(ortamOf(h) as (typeof ORTAM_SIRA)[number]);
        case 'location':
          return h.location || '';
        case 'nginx':
          return h.nginx_version || '';
        case 'diskNginx':
          return gib(h.disk_usr_nginx);
        case 'diskWebLog':
          return gib(h.disk_web_log);
        case 'os':
          return h.os || '';
        case 'cpu':
          return parseInt(String(h.cpu ?? ''), 10) || 0;
        case 'bellek':
          return gib(h.memory) || 0;
        case 'konf':
          return parseInt(String(h.config_count ?? ''), 10) || 0;
        default:
          return h.hostname;
      }
    };
    return [...rows].sort((a, b) => {
      const x = deger(a);
      const y = deger(b);
      // Değeri olmayan (disk "—") her iki yönde de en altta kalır.
      if (x == null || y == null) return x == null && y == null ? a.hostname.localeCompare(b.hostname) : x == null ? 1 : -1;
      const c =
        sira.k === 'nginx'
          ? -surumKarsilastir(String(x), String(y))
          : typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x).localeCompare(String(y), 'tr', { numeric: true });
      return c * sira.yon || a.hostname.localeCompare(b.hostname);
    });
  }, [data, q, ortamSuz, surumSuz, surumTuru, etiketliSuz, sira]);

  const serviceRows = useMemo(() => {
    if (!data) return [];
    const needle = sq.trim().toLowerCase();
    return data.byService
      .filter((s) => !needle || s.service.toLowerCase().includes(needle))
      .map((s) => {
        const hs = (s.hostnames ?? []).map((h) => hostByName.get(h)).filter((h): h is NginxInvHost => !!h);
        const ortamSet = hs.length ? [...new Set(hs.map(ortamOf))].sort(ortamSirala) : s.envs;
        const elle = hs.some((h) => elleAdlar(h).has(s.service));
        return { ...s, hs, ortamSet, elle };
      });
  }, [data, sq, hostByName]);

  if (loading && !data) return <LoadingLogo />;
  if (err)
    return (
      <Note tone="danger" title="Envanter okunamadı">
        {err}
      </Note>
    );
  if (!data) return null;

  if (data.totals.hosts === 0) {
    return (
      <Note tone="info" title="Henüz kayıt yok">
        <code className="font-mono">nginx_metadata</code> job&apos;ı çalıştıktan sonra burası
        dolacak.
      </Note>
    );
  }

  const t = data.totals;
  const n = t.hosts;
  const lokasyonSayi = new Set(
    data.hosts.map((h) => h.location).filter((l) => l && l !== '(bilinmiyor)'),
  ).size;

  const sunuculariAc = (o: { ortam?: string; surum?: string; os?: string }) => {
    setOrtamSuz(o.ortam ?? '');
    setSurumSuz(o.os ?? o.surum ?? '');
    setSurumTuru(o.os != null ? 'os' : 'nginx');
    setEtiketliSuz(false);
    setQ('');
    setView('sunucular');
  };

  const siralaTiklandi = (k: SiraAnahtar) =>
    setSira((s) => (s.k === k ? { k, yon: (s.yon * -1) as 1 | -1 } : { k, yon: 1 }));

  const SEKMELER: { id: View; label: string; sayi?: number }[] = [
    { id: 'ortam', label: 'Ortamlar', sayi: ortamlar.length },
    { id: 'versiyon', label: 'Sürümler' },
    { id: 'service', label: "Service'ler", sayi: t.services },
    { id: 'kaynak', label: 'Kaynaklar' },
    { id: 'sunucular', label: 'Sunucular', sayi: n },
  ];

  const kpi = (etiket: string, deger: React.ReactNode, ipucu?: string, uyari?: boolean) => (
    <div className="min-w-0" title={ipucu}>
      <dt className={UST_ETIKET} style={{ color: 'var(--text-muted)' }}>
        {etiket}
      </dt>
      <dd
        className="mt-1 text-xl font-semibold tabular-nums leading-none"
        style={{ color: uyari ? 'var(--status-warning-text)' : 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
      >
        {deger}
      </dd>
      {ipucu && uyari && (
        <p className="mt-1 text-[11px] leading-snug" style={{ color: 'var(--text-muted)' }}>
          {ipucu}
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-4" data-testid="nginx-envanteri">
      {/* ── FİLO ÖZETİ ─────────────────────────────────────────────────────────── */}
      <section
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)', boxShadow: 'var(--shadow-xs)' }}
        data-testid="filo-ozeti"
      >
        <div className="grid lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="p-5">
            <div className={`flex items-center gap-1.5 ${UST_ETIKET}`} style={{ color: 'var(--nh-hub)' }}>
              <ServerStackIcon className="w-4 h-4" aria-hidden="true" />
              nginx filosu
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span
                className="text-[2.75rem] font-semibold leading-none tabular-nums"
                style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
              >
                {nf(n)}
              </span>
              <span className="text-[15px]" style={{ color: 'var(--text-secondary)' }}>
                sunucu
              </span>
            </div>
            <p className="mt-1.5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
              {nf(ortamlar.length)} ortam · {nf(lokasyonSayi)} lokasyon · {nf(t.services)} service
              {etiketliSayi > 0 && ` · ${nf(etiketliSayi)} elle etiketli`}
            </p>

            {/* Ortam çubuğu: bölüm genişliği sunucu payı; efsane düğmesi Sunucular'ı o ortama süzer. */}
            <div className="mt-4 flex h-2.5 rounded-full overflow-hidden gap-[2px]" role="img" aria-label="Ortamlara göre sunucu dağılımı">
              {ortamlar.map((o) => (
                <span
                  key={o.ortam}
                  style={{ width: `${(o.hosts.length / n) * 100}%`, background: ortamRengi(o.ortam) }}
                  title={`${ortamAdi(o.ortam)}: ${o.hosts.length} sunucu`}
                />
              ))}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
              {ortamlar.map((o) => (
                <button
                  key={o.ortam}
                  type="button"
                  onClick={() => sunuculariAc({ ortam: o.ortam })}
                  className="inline-flex items-center gap-1.5 text-[12px] rounded hover:underline"
                  style={{ color: 'var(--text-secondary)' }}
                  title={`${ortamAdi(o.ortam)} sunucularını listele`}
                >
                  <span aria-hidden="true" className="w-2 h-2 rounded-full" style={{ background: ortamRengi(o.ortam) }} />
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {ortamAdi(o.ortam)}
                  </span>
                  <span className="tabular-nums">{nf(o.hosts.length)}</span>
                </button>
              ))}
            </div>
          </div>

          <dl
            className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5 p-5 border-t lg:border-t-0 lg:border-l"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}
          >
            {kpi('çekirdek', nf(t.cpuTotal))}
            {kpi(
              'bellek',
              <>
                {nf(t.memory.totalGiB)}
                <span className="text-[13px] font-normal ml-1" style={{ color: 'var(--text-muted)' }}>GiB</span>
              </>,
              t.memory.unparsed ? `${t.memory.unparsed} sunucunun bellek değeri çözümlenemedi, toplama dahil değil` : undefined,
              !!t.memory.unparsed,
            )}
            {kpi(
              'nginx sürümü',
              nf(data.hosts.length ? new Set(data.hosts.map((h) => surumAnahtari(h.nginx_version))).size : t.nginxVersions),
              'farklı sürüm sayısı (unknown/boş tek "bilinmiyor" sayılır)',
            )}
            {kpi(
              '/usr/nginx',
              <>
                {nf(t.diskNginx.totalGiB)}
                <span className="text-[13px] font-normal ml-1" style={{ color: 'var(--text-muted)' }}>GiB</span>
              </>,
              t.diskNginx.unparsed ? `${t.diskNginx.unparsed} sunucu çözümlenemedi` : undefined,
              !!t.diskNginx.unparsed,
            )}
            {kpi(
              '/web_log',
              <>
                {nf(t.diskWebLog.totalGiB)}
                <span className="text-[13px] font-normal ml-1" style={{ color: 'var(--text-muted)' }}>GiB</span>
              </>,
              t.diskWebLog.unparsed ? `${t.diskWebLog.unparsed} sunucu çözümlenemedi` : undefined,
              !!t.diskWebLog.unparsed,
            )}
            {kpi('işletim sistemi', nf(t.osVersions), 'farklı OS sürümü')}
          </dl>
        </div>
      </section>

      {data.etiketHatasi && (
        <Note tone="warning" title="Elle etiketler okunamadı">
          Liste otomatik keşifle (conf.d dosya adları) gösteriliyor. Ayrıntı: {data.etiketHatasi}
        </Note>
      )}

      {/* ── ARAÇ ÇUBUĞU ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Envanter görünümü" className="inline-flex gap-0.5 rounded-lg p-0.5 bg-[var(--bg-elevated)] border" style={{ borderColor: 'var(--border-subtle)' }}>
          {SEKMELER.map((v) => {
            const aktif = view === v.id;
            return (
              <button
                key={v.id}
                role="tab"
                aria-selected={aktif}
                onClick={() => setView(v.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium rounded-md transition-colors ${
                  aktif
                    ? 'bg-[var(--bg-surface)] shadow-sm text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span>{v.label}</span>
                {v.sayi != null && (
                  <span
                    className="px-1.5 rounded-full text-[10.5px] tabular-nums"
                    style={{ background: aktif ? 'var(--bg-elevated)' : 'transparent', color: 'var(--text-muted)' }}
                  >
                    {nf(v.sayi)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <span className="ml-auto inline-flex items-center gap-2">
          {data.lastUpdate && <GuncellemeRozeti tarih={data.lastUpdate.slice(0, 19).replace('T', ' ')} />}
          <button onClick={load} className={btnIkincil} style={{ borderColor: 'var(--border)' }}>
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile
          </button>
        </span>
      </div>

      {/* ── ORTAMLAR ───────────────────────────────────────────────────────────── */}
      {view === 'ortam' && (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {ortamlar.map((o) => {
              const lokMax = Math.max(1, ...o.lok.values());
              const osler = [...o.os.entries()].sort((a, b) => b[1] - a[1]);
              return (
                <article
                  key={o.ortam}
                  className="rounded-xl border flex flex-col"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                  data-testid="ortam-karti"
                >
                  <header className="flex items-start justify-between gap-3 px-4 pt-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full" style={{ background: ortamRengi(o.ortam) }} />
                        <h3 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                          {ortamAdi(o.ortam)}
                        </h3>
                      </div>
                      <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                        %{Math.round((o.hosts.length / n) * 100)} filo
                        {o.etiketli > 0 && ` · ${o.etiketli} elle etiketli`}
                      </p>
                    </div>
                    <span className="text-[1.75rem] font-semibold leading-none tabular-nums" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                      {nf(o.hosts.length)}
                    </span>
                  </header>
                  <div className="px-4 py-3 space-y-3 flex-1">
                    <div>
                      <div className={UST_ETIKET} style={{ color: 'var(--text-muted)' }}>lokasyon</div>
                      <ul className="mt-1.5 space-y-1">
                        {[...o.lok.entries()]
                          .sort((a, b) => b[1] - a[1])
                          .map(([l, c]) => (
                            <li key={l} className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2 text-[12px]">
                              <span className="truncate capitalize" style={{ color: 'var(--text-secondary)' }} title={l}>
                                {l}
                              </span>
                              <span className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
                                <span className="block h-full rounded-full" style={{ width: `${(c / lokMax) * 100}%`, background: ortamRengi(o.ortam), opacity: 0.75 }} />
                              </span>
                              <span className="text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{c}</span>
                            </li>
                          ))}
                      </ul>
                    </div>
                    <div>
                      <div className={UST_ETIKET} style={{ color: 'var(--text-muted)' }}>nginx</div>
                      <div className="mt-1.5">
                        <SurumListesi
                          items={[...o.surum.entries()]}
                          onSec={(v) => sunuculariAc({ ortam: o.ortam, surum: v })}
                          aktifSurum={surumTuru === 'nginx' && ortamSuz === o.ortam ? surumSuz : undefined}
                          baslik={(v, c) => `${ortamAdi(o.ortam)} · ${v}: ${nf(c)} sunucu — listele`}
                        />
                      </div>
                    </div>
                    <div>
                      <div className={UST_ETIKET} style={{ color: 'var(--text-muted)' }}>işletim sistemi</div>
                      <p className="mt-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                        {osler.map(([v, c], i) => (
                          <React.Fragment key={v}>
                            {i > 0 && <span style={{ color: 'var(--text-muted)' }}> · </span>}
                            {v} <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>×{c}</span>
                          </React.Fragment>
                        ))}
                      </p>
                    </div>
                  </div>
                  <footer
                    className="flex items-center justify-between gap-2 px-4 py-2.5 border-t text-[12px]"
                    style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                  >
                    <span className="tabular-nums">
                      {nf(o.cpu)} çekirdek · {nf(Math.round(o.bellek))} GiB
                    </span>
                    <button
                      type="button"
                      onClick={() => sunuculariAc({ ortam: o.ortam })}
                      className="inline-flex items-center gap-0.5 font-medium hover:underline"
                      style={{ color: 'var(--accent)' }}
                    >
                      Sunucular <ChevronRightIcon className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Ortam sunucu adı kalıbından gelir (GBNGXP/GBRVPP = PROD, …Q = QA, …T = TEST, …D = DEV, GBNGXT51 = EDU).
            {t.envCorrected
              ? ` ${nf(t.envCorrected)} sunucuda tablodaki ortam kalıpla çelişiyordu; kalıp esas alındı.`
              : ''}
          </p>
        </>
      )}

      {/* ── SÜRÜMLER ───────────────────────────────────────────────────────────── */}
      {view === 'versiyon' && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <SurumAileKarti
            items={data.versions.nginx}
            total={n}
            onSec={(v) => sunuculariAc({ surum: surumAnahtari(v) })}
            aktifSurum={surumTuru === 'nginx' && !ortamSuz ? surumSuz : undefined}
          />
          <DagilimKarti title="İşletim sistemi" items={data.versions.os} total={n} onSec={(v) => sunuculariAc({ os: v })} />
          <DagilimKarti title="Çekirdek (kernel)" items={data.versions.kernel} total={n} />
          <DagilimKarti title="Mimari" items={data.versions.architecture} total={n} />
          <DagilimKarti title="nginx kullanıcısı" items={data.other.nginxUser} total={n} />
          <DagilimKarti title="metadata sürümü" items={data.versions.metadata} total={n} />
        </div>
      )}

      {/* ── SERVICE'LER ────────────────────────────────────────────────────────── */}
      {view === 'service' && (
        <section className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <header className="flex flex-wrap items-center gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="min-w-0 flex-1">
              <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                Service&apos;ler
              </h3>
              <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                conf.d dosya adlarından ve elle etiketlerden. Satıra tıklayınca hangi sunucularda, hangi nginx sürümüyle durduğu açılır.
              </p>
            </div>
            <div className="relative">
              <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={sq}
                onChange={(e) => setSq(e.target.value)}
                placeholder="service ara"
                aria-label="service ara"
                className="pf-input pl-8 text-xs w-52"
              />
            </div>
            <button
              onClick={() =>
                csvDownload(
                  'nginx_envanter_service',
                  ['service', 'sunucu', 'ortamlar', 'sunucular', 'nginx_surumleri'],
                  serviceRows.map((s) => [
                    s.service,
                    s.hosts,
                    s.ortamSet.join(' '),
                    (s.hostnames ?? []).join(' '),
                    [...new Set(s.hs.map((h) => surumAnahtari(h.nginx_version)))].sort(surumKarsilastir).join(' '),
                  ]),
                )
              }
              className={btnIkincil}
              style={{ borderColor: 'var(--border)' }}
            >
              <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
            </button>
          </header>
          <div className="overflow-auto" style={{ maxHeight: '36rem' }}>
            <table className="w-full text-[12.5px] border-collapse">
              <thead>
                <tr>
                  {['Service', 'Sunucu', 'Ortamlar', 'nginx'].map((b, i) => (
                    <th
                      key={b}
                      className={`sticky top-0 z-10 px-4 py-2 font-semibold whitespace-nowrap ${i === 1 ? 'text-right' : 'text-left'}`}
                      style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                    >
                      {b}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {serviceRows.map((s) => {
                  const acik = acikService.has(s.service);
                  const surumler = sayac(s.hs.map((h) => h.nginx_version));
                  return (
                    <React.Fragment key={s.service}>
                      <tr
                        onClick={() => serviceAc(s.service)}
                        className="cursor-pointer hover:bg-[var(--bg-elevated)]"
                        style={{ borderTop: '1px solid var(--border-subtle)', background: acik ? 'var(--bg-elevated)' : undefined }}
                      >
                        <td className="px-4 py-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              serviceAc(s.service);
                            }}
                            aria-expanded={acik}
                            aria-label={`${s.service} sunucularını ${acik ? 'gizle' : 'göster'}`}
                            className="inline-flex items-center gap-1.5"
                            style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}
                          >
                            <ChevronRightIcon className={`w-3.5 h-3.5 transition-transform ${acik ? 'rotate-90' : ''}`} style={{ color: 'var(--text-muted)' }} />
                            {s.service === 'too_many' ? '5+ service (liste toplanmadı)' : s.service}
                          </button>
                          {s.elle && (
                            <span className="ml-2 inline-flex items-center gap-0.5 text-[10.5px] font-semibold" style={{ color: 'var(--accent)' }} title="En az bir sunucuda elle etiketle geliyor">
                              <TagIcon className="w-3 h-3" aria-hidden="true" /> elle
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {nf(s.hosts)}
                        </td>
                        <td className="px-4 py-2">
                          <span className="flex flex-wrap gap-1">
                            {s.ortamSet.map((e) => (
                              <OrtamRozeti key={e} ortam={e} />
                            ))}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <SurumListesi items={surumler} sinir={3} baslik={(v, c) => `${v}: ${nf(c)} sunucu`} />
                        </td>
                      </tr>
                      {acik && (
                        <tr>
                          <td colSpan={4} className="px-4 pb-3" style={{ background: 'var(--bg-elevated)' }}>
                            <ServiceSunuculari service={s.service} hosts={s.hs} unlisted={t.servicesUnlisted ?? []} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {!serviceRows.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center" style={{ color: 'var(--text-muted)' }}>
                      Eşleşen service yok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── KAYNAKLAR ──────────────────────────────────────────────────────────── */}
      {view === 'kaynak' && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <DagilimKarti title="Çekirdek (cpu)" items={data.resources.cpu} total={n} />
          <DagilimKarti title="Bellek" items={data.resources.memory} total={n} />
          <DagilimKarti title="/usr/nginx disk" items={data.resources.diskNginx} total={n} />
          <DagilimKarti title="/web_log disk" items={data.resources.diskWebLog} total={n} />
          <DagilimKarti title="Konfigürasyon sayısı" items={data.resources.configCount} total={n} />
          <DagilimKarti title="Service sayısı" items={data.resources.serviceCount} total={n} />
        </div>
      )}

      {/* ── SUNUCULAR ──────────────────────────────────────────────────────────── */}
      {view === 'sunucular' && (
        <section className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <header className="px-4 py-3 border-b space-y-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="sunucu, service, IP, sürüm ara"
                  aria-label="sunucu ara"
                  className="pf-input pl-8 text-xs w-64"
                />
              </div>
              <span className="text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }} data-testid="sunucu-sayaci">
                {nf(hostRows.length)} / {nf(n)} sunucu
              </span>
              <span className="ml-auto inline-flex items-center gap-2">
                <button
                  onClick={() =>
                    csvDownload(
                      'nginx_envanteri',
                      [
                        'hostname', 'fqdn', 'ortam', 'lokasyon', 'ip', 'subnet', 'os', 'kernel', 'mimari', 'cpu', 'bellek',
                        'nginx_surum', 'nginx_kullanici', 'konf_sayisi', 'service_sayisi', 'services', 'services_otomatik',
                        'etiket_kipi', 'disk_usr_nginx', 'disk_web_log',
                      ],
                      hostRows.map((h) => [
                        h.hostname,
                        h.fqdn || '',
                        ortamOf(h),
                        h.location || '',
                        h.ip || '',
                        h.subnet || '',
                        h.os || '',
                        h.kernel || '',
                        h.architecture || '',
                        String(h.cpu ?? ''),
                        h.memory || '',
                        h.nginx_version || '',
                        h.nginx_user || '',
                        String(h.config_count ?? ''),
                        String(h.service_count ?? ''),
                        h.services || '',
                        h.etiket ? h.etiket.oto.join(',') : h.services || '',
                        h.etiket ? h.etiket.mod : '',
                        h.disk_usr_nginx || '',
                        h.disk_web_log || '',
                      ]),
                    )
                  }
                  className={btnIkincil}
                  style={{ borderColor: 'var(--border)' }}
                >
                  <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
                </button>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Ortam süzgeci">
              {[{ ortam: '', ad: 'Tümü', sayi: n }, ...ortamlar.map((o) => ({ ortam: o.ortam, ad: ortamAdi(o.ortam), sayi: o.hosts.length }))].map((o) => {
                const aktif = ortamSuz === o.ortam;
                return (
                  <button
                    key={o.ortam || 'tumu'}
                    type="button"
                    aria-pressed={aktif}
                    onClick={() => setOrtamSuz(o.ortam)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] transition-colors"
                    style={{
                      borderColor: aktif ? 'var(--accent)' : 'var(--border-subtle)',
                      background: aktif ? 'var(--accent-bg)' : 'var(--bg-surface)',
                      color: aktif ? 'var(--text-primary)' : 'var(--text-secondary)',
                    }}
                  >
                    {o.ortam && <span aria-hidden="true" className="w-2 h-2 rounded-full" style={{ background: ortamRengi(o.ortam) }} />}
                    {o.ad}
                    <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{nf(o.sayi)}</span>
                  </button>
                );
              })}
              {etiketliSayi > 0 && (
                <button
                  type="button"
                  aria-pressed={etiketliSuz}
                  onClick={() => setEtiketliSuz((x) => !x)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px]"
                  style={{
                    borderColor: etiketliSuz ? 'var(--accent)' : 'var(--border-subtle)',
                    background: etiketliSuz ? 'var(--accent-bg)' : 'var(--bg-surface)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <TagIcon className="w-3.5 h-3.5" aria-hidden="true" /> Elle etiketli
                  <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{nf(etiketliSayi)}</span>
                </button>
              )}
              {surumSuz && (
                <span
                  className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full border text-[12px]"
                  style={{ borderColor: 'var(--accent)', background: 'var(--accent-bg)', color: 'var(--text-primary)' }}
                  data-testid="surum-suzgeci"
                >
                  {surumTuru === 'os' ? (
                    <>
                      OS: <span>{surumSuz}</span>
                    </>
                  ) : (
                    <>
                      nginx: <SurumRozeti v={surumSuz} />
                    </>
                  )}
                  <button type="button" onClick={() => setSurumSuz('')} aria-label="Sürüm süzgecini kaldır" className="p-0.5 rounded-full hover:bg-[var(--bg-elevated)]">
                    <XMarkIcon className="w-3.5 h-3.5" />
                  </button>
                </span>
              )}
            </div>
          </header>
          <div className="overflow-auto" style={{ maxHeight: '40rem' }}>
            <table className="w-full text-[12.5px] border-collapse">
              <thead>
                <tr>
                  <SiraTh sira={sira} onSirala={siralaTiklandi} k="hostname">Sunucu</SiraTh>
                  <SiraTh sira={sira} onSirala={siralaTiklandi} k="ortam">Ortam</SiraTh>
                  <SiraTh sira={sira} onSirala={siralaTiklandi} k="location">Lokasyon</SiraTh>
                  <SiraTh sira={sira} onSirala={siralaTiklandi} k="nginx">nginx</SiraTh>
                  <SiraTh sira={sira} onSirala={siralaTiklandi} k="os">OS</SiraTh>
                  <SiraTh sira={sira} onSirala={siralaTiklandi} k="cpu" sag>CPU</SiraTh>
                  <SiraTh sira={sira} onSirala={siralaTiklandi} k="bellek" sag>Bellek</SiraTh>
                  <SiraTh sira={sira} onSirala={siralaTiklandi} k="diskNginx" sag title="/usr/nginx disk boyutu (df -hP toplam)">/usr/nginx</SiraTh>
                  <SiraTh sira={sira} onSirala={siralaTiklandi} k="diskWebLog" sag title="/web_log disk boyutu (df -hP toplam)">/web_log</SiraTh>
                  <SiraTh sira={sira} onSirala={siralaTiklandi} k="konf" sag>Konf.</SiraTh>
                  <th className="sticky top-0 z-10 px-3 py-2 font-semibold text-left whitespace-nowrap" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                    Service / etiket
                  </th>
                  {isAdmin && (
                    <th className="sticky top-0 z-10 px-2 py-2" style={{ background: 'var(--bg-elevated)' }}>
                      <span className="sr-only">İşlem</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {hostRows.map((h) => (
                  <tr key={h.hostname} className="group hover:bg-[var(--bg-elevated)]" style={{ borderTop: '1px solid var(--border-subtle)' }} data-testid="sunucu-satiri">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }} className="font-medium">
                        {h.hostname}
                      </div>
                      {h.ip && (
                        <div className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }} title={h.fqdn || ''}>
                          {h.ip}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <OrtamRozeti ortam={ortamOf(h)} />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap capitalize" style={{ color: 'var(--text-secondary)' }}>
                      {h.location || '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <SurumRozeti
                        v={h.nginx_version || ''}
                        onClick={() => {
                          setSurumSuz(surumAnahtari(h.nginx_version));
                          setSurumTuru('nginx');
                        }}
                        title={`${h.nginx_version || 'bilinmiyor'} — bu sürüme süz`}
                        aktif={surumTuru === 'nginx' && surumSuz === surumAnahtari(h.nginx_version)}
                      />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" title={h.kernel || ''} style={{ color: 'var(--text-secondary)' }}>
                      {h.os || '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{h.cpu ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap" data-testid="bellek">
                      <DiskHucresi v={h.memory} yol="bellek" tur="toplam" />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap" data-testid="disk-usr-nginx">
                      <DiskHucresi v={h.disk_usr_nginx} yol="/usr/nginx" />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap" data-testid="disk-web-log">
                      <DiskHucresi v={h.disk_web_log} yol="/web_log" />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{h.config_count ?? '—'}</td>
                    <td className="px-3 py-2 min-w-[14rem]">
                      <ServisCipleri h={h} />
                      {h.etiket && (
                        <div className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }} title={h.etiket.not || undefined}>
                          {h.etiket.mod === 'degistir' ? 'elle (otomatiğin yerine)' : 'otomatik + elle'}
                          {h.etiket.by ? ` · ${h.etiket.by}` : ''}
                          {h.etiket.not ? ` · ${h.etiket.not}` : ''}
                        </div>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setEtiketHost(h)}
                          aria-label={`${h.hostname} etiketini düzenle`}
                          title="Etiketi düzenle"
                          className="p-1.5 rounded-md opacity-60 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-[var(--bg-surface)]"
                          style={{ color: h.etiket ? 'var(--accent)' : 'var(--text-secondary)' }}
                        >
                          <PencilSquareIcon className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {!hostRows.length && (
                  <tr>
                    <td colSpan={isAdmin ? 12 : 11} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                      Süzgece uyan sunucu yok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {etiketHost && (
        <NginxEtiketPenceresi
          host={etiketHost}
          onClose={() => setEtiketHost(null)}
          onKaydedildi={() => {
            setEtiketHost(null);
            load();
          }}
        />
      )}
    </div>
  );
}
