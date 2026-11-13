// src/components/oco/OcoTakvimYapragi.tsx — OCO Takvimi'nin "takvim yaprağı" görünümü.
//
// Kullanıcı (2026-11-13): "OCO Takvimi sayfasını mevcut halinin dışında istek halinde gerçek bir
// takvim yaprağı şeklinde gösterebilir miyiz? bazı arkadaşlar o şekilde görmek istiyor".
//
// KURALLAR:
//  * Liste görünümü VARSAYILAN ve değişmedi; bu bileşen yalnız ?gorunum=takvim ile açılır.
//  * Günler listeyle AYNI kuralla (gunAnahtari, yerel saat) hesaplanır.
//  * Çok günlü OCO (bitişi sonraki bir günde) yayıldığı HER günde görünür, devam parçası işaretli.
//  * Tarihsiz OCO ATILMAZ: ayrı "Tarihsiz" kutusunda durur (listedeki kuralın aynısı).
//  * Geçmiş için YENİ SUNUCU ÇAĞRISI YOK: API'nin döndürdüğü kadarı. Görünen dönem servisin en
//    eski kaydından önceyse bu SÖYLENİR; boş günler "OCO yok" gibi okunmasın.
//  * Dar ekranda ay ızgarası yerine gün gün ajanda (yatay kaydırma yok).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { CodeChip } from '@/components/common/CodeChip';
import { fmtDate } from '@/utils/datetime';
import { pencereKapandi } from '@/components/oco/takvimVurgu';
import { DURUM_TON, OcoDetay, OcoRozetleri, saat, type OcoRow } from '@/components/oco/OcoOrtak';
import {
  AY_ADLARI,
  GUN_ADLARI,
  GUN_KISA,
  anahtardanTarih,
  ayIzgarasi,
  gunAnahtari,
  gunEkle,
  geceYarisiMi,
  gunlereYay,
  haftaGunleri,
  haftaSonuMu,
  tarihAnahtari,
  tasmaBol,
  type TakvimOgesi,
} from '@/components/oco/takvimIzgara';

type Kip = 'ay' | 'hafta';
type Secim = { tur: 'gun'; gun: string } | { tur: 'oco'; oco: number; gun: string } | null;
type Oge = TakvimOgesi<OcoRow>;

/** Dar ekran (< sm). matchMedia yoksa (test/eski tarayıcı) geniş varsayılır. */
function useDarEkran(): boolean {
  const sorgu = '(max-width: 639px)';
  const [dar, setDar] = useState(() => {
    try {
      return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(sorgu).matches
        : false;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia(sorgu);
    } catch {
      return;
    }
    const f = () => setDar(mq.matches);
    mq.addEventListener?.('change', f);
    return () => mq.removeEventListener?.('change', f);
  }, []);
  return dar;
}

function uzunGun(gun: string): string {
  const t = anahtardanTarih(gun);
  return `${t.getDate()} ${AY_ADLARI[t.getMonth()]} ${t.getFullYear()} ${GUN_ADLARI[(t.getDay() + 6) % 7]}`;
}

/** Hafta görünümündeki saat etiketi: parçanın o günkü dilimi.
 *  Son parça gece yarısı biten pencereyse (yayılım o günü bitiş günü sayar) '→ 24:00':
 *  '→ 00:00' o günün BAŞINDA bitmiş gibi okunurdu. Sınırda kırpılan son parça 'sürer'. */
export function saatEtiketi(o: Oge): string {
  const { row, devam, surer, sinirda } = o;
  if (sinirda) return 'tüm gün (sürüyor, bitiş takvim sınırının ötesinde)';
  if (!devam && !surer) {
    const ertesiGeceYarisi = geceYarisiMi(row.plannedEnd) && gunAnahtari(row.plannedEnd) > gunAnahtari(row.plannedStart);
    return `${saat(row.plannedStart)}–${ertesiGeceYarisi ? '24:00' : saat(row.plannedEnd)}`;
  }
  if (!devam && surer) return `${saat(row.plannedStart)} →`;
  if (devam && surer) return 'tüm gün (devam)';
  return geceYarisiMi(row.plannedEnd) ? '→ 24:00' : `→ ${saat(row.plannedEnd)}`;
}

/** Hücre/ızgara ögesinin tonu: listedeki DURUM_TON; penceresi kapanmış bugünkü OCO tehlike tonu. */
function ogeTonu(r: OcoRow, kapandi: boolean): string {
  if (kapandi) return 'var(--status-danger)';
  return DURUM_TON[r.statusText] || 'var(--border-strong)';
}

export interface OcoTakvimYapragiProps {
  /** Süzgeçlerden (arama, ilişki) geçmiş satırlar. */
  rows: OcoRow[];
  /** Süzülmemiş tüm satırlar: servisin en eski kaydını bulmak için. */
  tumRows: OcoRow[];
  /** Servis sayfa sınırına takıldı mı (liste eksik). */
  eksik: boolean;
  /** Bugünün gün anahtarı (test için dışarıdan verilebilir). */
  bugun: string;
}

export default function OcoTakvimYapragi({ rows, tumRows, eksik, bugun }: OcoTakvimYapragiProps) {
  const [kip, setKip] = useState<Kip>('ay');
  const [odak, setOdak] = useState<Date>(() => anahtardanTarih(bugun));
  const [secim, setSecimHam] = useState<Secim>(null);
  const dar = useDarEkran();
  const panelBaslik = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const takvimBaslik = useRef<HTMLHeadingElement>(null);
  // ODAK GERI DONUSU: paneli PANEL DISINDAN acan oge saklanir; Kapat/Escape odagi ona verir
  // (DOM'da yoksa takvim basligina). Panel icinden yapilan secim tetikleyiciyi degistirmez.
  const tetikleyici = useRef<HTMLElement | null>(null);
  const odakGeriVer = useRef(false);

  const { gunler, tarihsiz } = useMemo(() => gunlereYay(rows), [rows]);
  const tumGunler = useMemo(() => gunlereYay(tumRows).gunler, [tumRows]);

  /** Paneli açan/değiştiren seçim: panel dışından açılıyorsa tetikleyiciyi sakla. */
  const sec = (s: Exclude<Secim, null>) => {
    const aktif = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    if (aktif && aktif !== document.body && !panelRef.current?.contains(aktif)) tetikleyici.current = aktif;
    setSecimHam(s);
  };
  /** Paneli kullanıcı kapattı (Kapat / Escape): odak tetikleyiciye döner. */
  const kapatVeDon = () => {
    odakGeriVer.current = true;
    setSecimHam(null);
  };
  /** Gezinme paneli kapattı: odak zaten tıklanan gezinme düğmesinde kalır, tetikleyici unutulur. */
  const paneliBirak = () => {
    tetikleyici.current = null;
    setSecimHam(null);
  };

  useEffect(() => {
    if (secim) {
      panelBaslik.current?.focus();
      return;
    }
    if (!odakGeriVer.current) return;
    odakGeriVer.current = false;
    const t = tetikleyici.current;
    tetikleyici.current = null;
    if (t && t.isConnected) t.focus();
    else takvimBaslik.current?.focus();
  }, [secim]);

  const ay = useMemo(() => ayIzgarasi(odak.getFullYear(), odak.getMonth()), [odak]);
  const hafta = useMemo(() => haftaGunleri(odak), [odak]);

  const baslik =
    kip === 'ay'
      ? `${AY_ADLARI[odak.getMonth()]} ${odak.getFullYear()}`
      : (() => {
          const a = hafta[0].tarih;
          const b = hafta[6].tarih;
          return a.getMonth() === b.getMonth()
            ? `${a.getDate()} – ${b.getDate()} ${AY_ADLARI[b.getMonth()]} ${b.getFullYear()}`
            : `${a.getDate()} ${AY_ADLARI[a.getMonth()]} – ${b.getDate()} ${AY_ADLARI[b.getMonth()]} ${b.getFullYear()}`;
        })();

  const git = (yon: -1 | 1) => {
    paneliBirak();
    setOdak((d) => (kip === 'ay' ? new Date(d.getFullYear(), d.getMonth() + yon, 1) : gunEkle(d, 7 * yon)));
  };

  // GECMIS NOTU: gorunen donemin basi, servisten gelen EN ESKI tarihli kayittan once mi?
  const enEski = useMemo(() => {
    let m = '';
    for (const r of tumRows) {
      const k = gunAnahtari(r.plannedStart);
      if (k && (!m || k < m)) m = k;
    }
    return m;
  }, [tumRows]);
  const donemBasi = kip === 'ay' ? tarihAnahtari(new Date(odak.getFullYear(), odak.getMonth(), 1)) : hafta[0].gun;
  const donemSonu =
    kip === 'ay' ? tarihAnahtari(new Date(odak.getFullYear(), odak.getMonth() + 1, 0)) : hafta[6].gun;
  const servisOncesi = !!enEski && donemBasi < enEski;
  const donemdeOgeVar = useMemo(() => {
    for (const k of gunler.keys()) if (k >= donemBasi && k <= donemSonu) return true;
    return false;
  }, [gunler, donemBasi, donemSonu]);

  const ogeDugmesi = (o: Oge, gun: string, ayrinti: boolean) => {
    const r = o.row;
    const kapandi = gun === bugun && pencereKapandi(r.plannedEnd) === true;
    const ton = ogeTonu(r, kapandi);
    const secili = secim?.tur === 'oco' && secim.oco === r.oco && secim.gun === gun;
    const zaman = ayrinti ? saatEtiketi(o) : o.devam ? '↳' : saat(r.plannedStart);
    const etiket =
      `OCO ${r.oco}, ${saatEtiketi(o)}, ${r.subject || '(başlıksız)'}` +
      (r.statusText ? `, ${r.statusText}` : '') +
      (r.pcabRequired ? ', PCAB' : '') +
      (o.devam ? ', önceki günden devam' : '') +
      (o.sinirda ? ', bitiş tarihi takvim sınırının ötesinde' : '') +
      (kapandi ? ', penceresi kapandı' : '');
    return (
      <button
        key={`${r.oco}-${gun}`}
        type="button"
        onClick={() => sec({ tur: 'oco', oco: r.oco, gun })}
        aria-label={etiket}
        aria-pressed={secili}
        title={etiket}
        data-testid="oco-takvim-oge"
        data-devam={o.devam ? '1' : undefined}
        data-secili={secili ? '1' : undefined}
        className="w-full text-left rounded px-1 py-0.5 text-[11px] leading-tight flex items-baseline gap-1 min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        style={{
          borderLeft: `3px solid ${ton}`,
          background: `color-mix(in srgb, ${ton} 10%, var(--bg-surface))`,
          color: 'var(--text-primary)',
          textDecoration: kapandi ? 'line-through' : undefined,
          fontStyle: o.devam ? 'italic' : undefined,
          boxShadow: secili ? 'inset 0 0 0 2px var(--accent)' : undefined,
        }}
      >
        <span className="tabular-nums shrink-0" style={{ color: 'var(--text-muted)' }}>
          {zaman}
        </span>
        <span className={`min-w-0 ${ayrinti ? 'break-words' : 'truncate'}`}>
          <span className="font-medium">#{r.oco}</span> {r.subject || '(başlıksız)'}
        </span>
        {r.pcabRequired && (
          <span className="shrink-0 text-[9px] font-semibold" style={{ color: 'var(--status-warning-text)' }} aria-hidden>
            PCAB
          </span>
        )}
      </button>
    );
  };

  const gunDugmesi = (
    gun: string,
    n: number,
    metin: React.ReactNode,
    className: string,
    style?: React.CSSProperties,
    etiket?: string,
  ) => (
    <button
      type="button"
      onClick={() => sec({ tur: 'gun', gun })}
      aria-label={etiket ?? `${uzunGun(gun)}${gun === bugun ? ' (bugün)' : ''}, ${n} OCO — günün tüm listesini aç`}
      className={`${className} focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]`}
      style={style}
    >
      {metin}
    </button>
  );

  const ayHucresi = (h: { gun: string; tarih: Date; ayIci: boolean }) => {
    const liste = gunler.get(h.gun) || [];
    const { gorunen, fazla } = tasmaBol(liste);
    const bugunMu = h.gun === bugun;
    const hs = haftaSonuMu(h.tarih);
    return (
      <div
        key={h.gun}
        role="group"
        aria-label={`${uzunGun(h.gun)}${bugunMu ? ' (bugün)' : ''}, ${liste.length} OCO`}
        data-testid="oco-takvim-hucre"
        data-gun={h.gun}
        data-ay-disi={h.ayIci ? undefined : '1'}
        data-bugun={bugunMu ? '1' : undefined}
        className="min-h-[6.5rem] p-1 flex flex-col gap-0.5 min-w-0 border-t border-l"
        style={{
          borderColor: 'var(--border-subtle)',
          background: bugunMu
            ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-surface))'
            : hs
              ? 'var(--bg-elevated)'
              : 'var(--bg-surface)',
          opacity: h.ayIci ? 1 : 0.5,
          boxShadow: bugunMu ? 'inset 0 0 0 2px var(--accent)' : undefined,
        }}
      >
        <div className="flex items-center justify-between">
          {gunDugmesi(
            h.gun,
            liste.length,
            h.tarih.getDate(),
            'text-[11px] tabular-nums rounded-full w-6 h-6 inline-flex items-center justify-center',
            bugunMu
              ? { background: 'var(--accent)', color: 'var(--text-on-accent)', fontWeight: 600 }
              : { color: h.ayIci ? 'var(--text-secondary)' : 'var(--text-muted)' },
          )}
          {bugunMu && (
            <span className="text-[9px] font-semibold uppercase" style={{ color: 'var(--accent)' }}>
              Bugün
            </span>
          )}
        </div>
        {gorunen.map((o) => ogeDugmesi(o, h.gun, false))}
        {fazla > 0 &&
          gunDugmesi(
            h.gun,
            liste.length,
            `+${fazla} daha`,
            'text-[11px] text-left px-1 underline rounded',
            { color: 'var(--text-muted)' },
            `${uzunGun(h.gun)}: ${fazla} OCO daha gizli, günün tüm ${liste.length} OCO'sunu aç`,
          )}
      </div>
    );
  };

  // DAR EKRAN AJANDASI BOS METNI: kesin "OCO yok" yalniz servis bu donemi kapsiyor, liste eksik
  // degil ve suzgec bir sey gizlemiyorsa. Aksi halde gecmis notu / suzgecle celismesin.
  const ajandaBosMetni = () => {
    // Sira onemli: servisOncesi ayin YALNIZ basi en eski kayittan onceyse de dogru olur; suzulmemis
    // listede bu ayda oge varsa bos olmanin nedeni suzgectir. Yoksa servisOncesi tum ayi kapsar.
    for (const k of tumGunler.keys()) if (k >= donemBasi && k <= donemSonu) return 'Bu ayda süzgece uyan OCO yok.';
    if (servisOncesi) return 'Bu ay için servis veri döndürmedi.';
    if (eksik) return 'Bu ayda görünen OCO yok (liste eksik olabilir).';
    return 'Bu ayda OCO yok.';
  };

  const ayGorunumu = () =>
    dar ? (
      // DAR EKRAN: 7 sutun sigmaz; ayin OCO'lu gunleri alt alta (ajanda).
      <div className="space-y-2" data-testid="oco-takvim-ajanda">
        {ay.filter((h) => h.ayIci && gunler.has(h.gun)).length === 0 ? (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }} data-testid="oco-takvim-ajanda-bos">
            {ajandaBosMetni()}
          </div>
        ) : (
          ay
            .filter((h) => h.ayIci && gunler.has(h.gun))
            .map((h) => gunSutunu(h.gun, h.tarih))
        )}
      </div>
    ) : (
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
        data-testid="oco-takvim-ay"
      >
        <div className="grid grid-cols-7" aria-hidden>
          {GUN_KISA.map((g, i) => (
            <div
              key={g}
              className="px-1.5 py-1 text-[11px] uppercase tracking-wide"
              title={GUN_ADLARI[i]}
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
            >
              {g}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 border-r border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          {ay.map(ayHucresi)}
        </div>
      </div>
    );

  function gunSutunu(gun: string, tarih: Date) {
    const liste = gunler.get(gun) || [];
    const bugunMu = gun === bugun;
    return (
      <section
        key={gun}
        aria-label={`${uzunGun(gun)}${bugunMu ? ' (bugün)' : ''}, ${liste.length} OCO`}
        data-testid="oco-takvim-gun"
        data-gun={gun}
        className="rounded-lg border min-w-0 flex flex-col"
        style={{
          borderColor: bugunMu ? 'var(--accent)' : 'var(--border-subtle)',
          background: haftaSonuMu(tarih) ? 'var(--bg-elevated)' : 'var(--bg-surface)',
        }}
      >
        <div
          className="px-2 py-1 text-[11px] flex items-center gap-1"
          style={{
            color: bugunMu ? 'var(--accent)' : 'var(--text-muted)',
            background: bugunMu ? 'color-mix(in srgb, var(--accent) 12%, var(--bg-elevated))' : 'var(--bg-elevated)',
            fontWeight: bugunMu ? 600 : undefined,
          }}
        >
          <span>
            {GUN_KISA[(tarih.getDay() + 6) % 7]} {tarih.getDate()} {AY_ADLARI[tarih.getMonth()].slice(0, 3)}
          </span>
          {bugunMu && <span className="uppercase text-[9px]">Bugün</span>}
          <span className="ml-auto tabular-nums">{liste.length || ''}</span>
        </div>
        <div className="p-1 flex flex-col gap-0.5">
          {liste.length === 0 ? (
            <span className="text-[11px] px-1" style={{ color: 'var(--text-muted)' }}>
              —
            </span>
          ) : (
            liste.map((o) => ogeDugmesi(o, gun, true))
          )}
        </div>
      </section>
    );
  }

  const haftaGorunumu = () => (
    <div className="grid grid-cols-1 sm:grid-cols-7 gap-1.5" data-testid="oco-takvim-hafta">
      {hafta.map((h) => gunSutunu(h.gun, h.tarih))}
    </div>
  );

  const secilenOco = secim?.tur === 'oco' ? rows.find((r) => r.oco === secim.oco) : undefined;
  const secilenGunListe = secim ? gunler.get(secim.gun) || [] : [];

  const panel = () => {
    if (!secim) return null;
    const kapat = (
      <button
        type="button"
        onClick={kapatVeDon}
        className="ml-auto inline-flex items-center gap-1 h-7 px-2 text-xs rounded-lg border focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
      >
        <XMarkIcon className="h-3.5 w-3.5" /> Kapat
      </button>
    );
    return (
      <section
        ref={panelRef}
        aria-label="Seçilen OCO ayrıntısı"
        data-testid="oco-takvim-panel"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            kapatVeDon();
          }
        }}
        className="rounded-xl border p-3 space-y-2"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
      >
        {secim.tur === 'gun' ? (
          <>
            <div className="flex items-center gap-2">
              <h2 ref={panelBaslik} tabIndex={-1} className="text-sm font-semibold focus:outline-none" style={{ color: 'var(--text-primary)' }}>
                {uzunGun(secim.gun)} · {secilenGunListe.length} OCO
              </h2>
              {kapat}
            </div>
            <div className="flex flex-col gap-1">{secilenGunListe.map((o) => ogeDugmesi(o, secim.gun, true))}</div>
          </>
        ) : secilenOco ? (
          <>
            <div className="flex items-start gap-2">
              <h2 ref={panelBaslik} tabIndex={-1} className="text-sm font-semibold min-w-0 break-words focus:outline-none" style={{ color: 'var(--text-primary)' }}>
                {secilenOco.subject || '(başlıksız)'}
              </h2>
              {gunler.get(secim.gun) && gunler.get(secim.gun)!.length > 1 && (
                <button
                  type="button"
                  onClick={() => sec({ tur: 'gun', gun: secim.gun })}
                  className="text-xs underline whitespace-nowrap rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Günün listesi
                </button>
              )}
              {kapat}
            </div>
            <span className="flex flex-wrap items-center gap-1.5">
              <CodeChip value={String(secilenOco.oco)} label={`#${secilenOco.oco}`} copyable tone="muted" />
              <OcoRozetleri
                r={secilenOco}
                kapandi={secim.gun === bugun && pencereKapandi(secilenOco.plannedEnd) === true}
              />
            </span>
            <OcoDetay r={secilenOco} className="space-y-2" />
          </>
        ) : (
          <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <h2 ref={panelBaslik} tabIndex={-1} className="focus:outline-none">
              Bu OCO süzgeçlerle gizlendi.
            </h2>
            {kapat}
          </div>
        )}
      </section>
    );
  };

  const navDugme = 'inline-flex items-center justify-center h-8 px-2 text-xs rounded-lg border focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]';
  const navStil = { borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' };
  const birim = kip === 'ay' ? 'ay' : 'hafta';

  return (
    <div className="space-y-3" data-testid="oco-takvim">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => git(-1)} aria-label={`Önceki ${birim}`} title={`Önceki ${birim}`} className={navDugme} style={navStil}>
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => { paneliBirak(); setOdak(anahtardanTarih(bugun)); }} className={navDugme} style={navStil}>
          Bugün
        </button>
        <button type="button" onClick={() => git(1)} aria-label={`Sonraki ${birim}`} title={`Sonraki ${birim}`} className={navDugme} style={navStil}>
          <ChevronRightIcon className="h-4 w-4" />
        </button>
        <h2 ref={takvimBaslik} tabIndex={-1} className="text-base font-semibold focus:outline-none" style={{ color: 'var(--text-primary)' }} aria-live="polite" data-testid="oco-takvim-baslik">
          {baslik}
        </h2>
        <div
          role="radiogroup"
          aria-label="Takvim aralığı"
          className="flex gap-1 rounded-lg p-0.5 w-fit ml-auto"
          style={{ background: 'var(--bg-elevated)' }}
        >
          {(
            [
              { id: 'ay', label: 'Ay' },
              { id: 'hafta', label: 'Hafta' },
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={kip === s.id}
              onClick={() => {
                paneliBirak();
                setKip(s.id);
              }}
              className={`px-2.5 py-1 text-xs font-medium rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${kip === s.id ? 'shadow-sm' : ''}`}
              style={{
                background: kip === s.id ? 'var(--bg-surface)' : 'transparent',
                color: kip === s.id ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {(servisOncesi || (eksik && !donemdeOgeVar)) && (
        <div
          className="text-[11px] rounded-lg px-3 py-1.5 border"
          style={{ color: 'var(--status-warning-text)', background: 'var(--status-warning-bg)', borderColor: 'var(--status-warning)' }}
          data-testid="oco-takvim-gecmis-notu"
        >
          {servisOncesi
            ? `Servisten gelen en eski OCO ${fmtDate(enEski)} tarihli; bundan önceki günler boş görünür ama bu "OCO yok" demek değil, servis o tarihten eskisini döndürmedi.`
            : 'Servis sayfa sınırına takıldı; bu dönemde görünmeyen OCO olabilir.'}
        </div>
      )}

      {kip === 'ay' ? ayGorunumu() : haftaGorunumu()}

      {panel()}

      {tarihsiz.length > 0 && (
        <section
          aria-label="Tarihsiz OCO'lar"
          data-testid="oco-takvim-tarihsiz"
          className="rounded-xl border p-2 space-y-1"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
        >
          <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            Tarihsiz · {tarihsiz.length}
          </div>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {tarihsiz.map((r) => (
              <button
                key={r.oco}
                type="button"
                onClick={() => sec({ tur: 'oco', oco: r.oco, gun: '' })}
                aria-label={`OCO ${r.oco}, planlanan tarihi yok, ${r.subject || '(başlıksız)'}`}
                data-testid="oco-takvim-oge"
                className="w-full text-left rounded px-1 py-0.5 text-[11px] truncate focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                style={{
                  borderLeft: `3px solid ${ogeTonu(r, false)}`,
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                }}
              >
                <span className="font-medium">#{r.oco}</span> {r.subject || '(başlıksız)'}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
