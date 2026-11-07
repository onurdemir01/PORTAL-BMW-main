// src/components/server_hub/EarTablo.tsx — Uygulama Envanteri tabloları için ortak tablo (2026-11-05).
//
// Kullanıcı: "tablolarımıza verilerimize sütun satır olarak filtreleme drop down arama seçme seçenekleri koy …
// veriler çok olabilir optimize gösterelim ama eksik olmasın asla … better ui".
//
//   * Sıralama: başlığa tıkla (artan → azalan → kapalı); aria-sort.
//   * Sütun süzgeci: başlıktaki huni → açılır pencere. Seçim kolonunda değer listesi (sunucudan, öteki
//     süzgeçlere göre daralmış, sayılarıyla; içinde arama, çoklu seçim, "(boş)"); metin: içerir / eşittir /
//     boş / dolu; sayı: en az / en çok; tarih: son N gün; evet / hayır.
//   * Etkin süzgeç çipleri, tek tıkla kaldırma; kolon seçici; sayfa boyu; KESİN sayaç "1–100 / 48.213".
//   * Satır seçimi ve seçilenlerle eylemler; seçilenler CSV'si formül enjeksiyonuna kapalı.
//   * İki kip: SUNUCU (getir: sayfa + süzgeç + sıralama sunucuda; liste sessizce kesilmez) ve YEREL
//     (satirlar: aynı süzgeç anlamı tarayıcıda).
//   * Kolon seçimi, sayfa boyu ve süzgeçler görüntüleyen başına localStorage'da (okunamazsa varsayılan).
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDownTrayIcon,
  BookmarkIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  FunnelIcon,
  InformationCircleIcon,
  ViewColumnsIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtNumber } from '@/utils/datetime';
import { downloadCsv } from '@/utils/csv';
import LoadError from '@/components/common/LoadError';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { BTN, btnStil, GIRDI, girdiStil, TABLO, TH, TD, thStil } from './EarEnvanterUi';

export type SuzgecTuru = 'secim' | 'metin' | 'sayi' | 'tarih' | 'bit';
export interface Suzgec {
  k: string;
  op: string;
  v?: unknown;
}
export interface EarKolon<T> {
  anahtar: string;
  baslik: string;
  /** Tek cümle: kolon ne gösterir. Başlıkta ⓘ ile görünür. */
  aciklama: string;
  suzgec?: SuzgecTuru | null;
  /** Sabit seçenekler (değer listesi sunucudan gelmez). */
  secenekler?: { deger: string; etiket: string }[];
  sirala?: boolean;
  /** Varsayılan görünür mü (kolon seçici). */
  varsayilan?: boolean;
  hucre: (r: T) => React.ReactNode;
  /**
   * CSV / yerel süzgeç / yerel sıralama için ham değer. Dizi dönerse kolon ÇOK DEĞERLİDİR (yerel kip):
   * süzgeç öğelerden biri uyarsa satırı alır, değer listesi her öğeyi ayrı sayar; arama, sıralama ve
   * CSV birleşik metni (" + ") kullanır.
   */
  deger?: (r: T) => unknown;
}
export interface Sayfa<T> {
  satirlar: T[];
  toplam: number;
}
export interface GetirParam {
  f: Suzgec[];
  s: string;
  q: string;
  limit: number;
  offset: number;
}
export type DegerListesi = { degerler: { deger: string | null; sayi: number }[]; farkli: number };

const SAYFA_BOYLARI = [50, 100, 250, 500];
const BOS = '(boş)';

// ── KALICI GÖRÜNÜM (localStorage; yalnız görüntüleyen kolaylığı) ─────────────────────────────────
interface Kalici {
  gorunur?: string[];
  sayfaBoyu?: number;
  f?: Suzgec[];
  s?: string;
}
function kaliciOku(kimlik: string): Kalici {
  try {
    const v = window.localStorage.getItem(`ear-tablo:${kimlik}`);
    const x = v ? JSON.parse(v) : {};
    return x && typeof x === 'object' ? x : {};
  } catch {
    return {};
  }
}
function kaliciYaz(kimlik: string, d: Kalici) {
  try {
    window.localStorage.setItem(`ear-tablo:${kimlik}`, JSON.stringify(d));
  } catch {
    /* gizli pencere / engelli depolama: görünüm yalnız bu oturumda kalır */
  }
}

/**
 * KAYITLI GÖRÜNÜM (2026-11-07): süzgeç + sıralama (+ isteğe bağlı kolonlar) adı ile. Hazır görünümler
 * ekranın kendisinden gelir; kişisel görünümler tarayıcıda (en çok 20). Görünüm uygulanınca tablonun
 * süzgeci olur: kullanıcı yine istediği gibi değiştirir.
 */
export interface EarGorunum {
  ad: string;
  aciklama?: string;
  f: Suzgec[];
  s?: string;
  kolonlar?: string[];
}
/** Ortak (Admin) görünümler: liste + isteğe bağlı kaydet / sil (hata atarsa menüde yazılır). */
export interface EarOrtakGorunumler {
  gorunumler: EarGorunum[];
  okunamadi?: boolean;
  kaydet?: (g: EarGorunum) => Promise<void>;
  sil?: (ad: string) => Promise<void>;
}
const KISISEL_EN_COK = 20;
function kisiselOku(kimlik: string): EarGorunum[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(`ear-tablo-gorunum:${kimlik}`) || '[]');
    return Array.isArray(v) ? v.filter((g) => g && typeof g.ad === 'string' && Array.isArray(g.f)) : [];
  } catch {
    return [];
  }
}
function kisiselYaz(kimlik: string, l: EarGorunum[]) {
  try {
    window.localStorage.setItem(`ear-tablo-gorunum:${kimlik}`, JSON.stringify(l));
  } catch {
    /* depolama kapalı: kişisel görünüm yalnız bu oturumda */
  }
}

// ── SAF YARDIMCILAR (test edilir) ────────────────────────────────────────────────────────────────

/** CSV hücresi: = + - @ sekme / CR ile başlayan metin "'" önekiyle (Excel formül olarak çalıştırmasın). */
export function formulGuvenli(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** Süzgecin çip metni. */
export function suzgecMetni(s: Suzgec, etiket?: (d: string) => string): string {
  const e = (d: unknown) => (d == null ? BOS : etiket ? etiket(String(d)) : String(d));
  if (s.op === 'in') {
    const l = (s.v as unknown[]) || [];
    return l.length > 3
      ? `${l.slice(0, 3).map(e).join(', ')} +${l.length - 3}`
      : l.map(e).join(', ');
  }
  if (s.op === 'icerir') return `içerir "${s.v}"`;
  if (s.op === 'esit') return `= ${e(s.v)}`;
  if (s.op === 'bos') return 'boş';
  if (s.op === 'dolu') return 'dolu';
  if (s.op === 'min') return `≥ ${s.v}`;
  if (s.op === 'max') return `≤ ${s.v}`;
  if (s.op === 'gun') return `son ${s.v} gün`;
  if (s.op === 'evet') return 'evet';
  if (s.op === 'hayir') return 'hayır';
  if (s.op === 'eksik') return 'tam olmayan';
  return s.op;
}

/** Çok değerli kolonun düz hâli (arama, sıralama, CSV): öğeler " + " ile; boş dizi boş değerdir. */
export const duzDeger = (v: unknown): unknown =>
  Array.isArray(v) ? (v.length ? v.map((x) => String(x ?? '')).join(' + ') : null) : v;

/** Yerel süzgeç: sunucudaki işleçlerle aynı anlam. */
export function yerelUyar(deger: unknown, s: Suzgec, simdi = Date.now()): boolean {
  if (Array.isArray(deger)) {
    // Çok değerli kolon: boş dizi boş değerdir; aksi halde öğelerden biri uyarsa satır uyar.
    if (!deger.length) return yerelUyar(null, s, simdi);
    if (s.op === 'bos') return false;
    return deger.some((x) => yerelUyar(x, s, simdi));
  }
  const bos = deger == null || deger === '';
  const metin = bos ? '' : String(deger);
  switch (s.op) {
    case 'in': {
      const l = (s.v as (string | null)[]) || [];
      return l.some((x) => (x == null ? bos : !bos && metin === x));
    }
    case 'icerir':
      return metin.toLowerCase().includes(String(s.v ?? '').toLowerCase());
    case 'esit':
      return metin === String(s.v ?? '');
    case 'bos':
      return bos;
    case 'dolu':
      return !bos;
    case 'min':
      return !bos && Number(deger) >= Number(s.v);
    case 'max':
      return !bos && Number(deger) <= Number(s.v);
    case 'gun': {
      const t = bos ? NaN : Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(metin) ? metin : `${metin}Z`);
      return Number.isFinite(t) && t >= simdi - Number(s.v) * 86400000;
    }
    case 'evet':
      return deger === true || deger === 1;
    case 'hayir':
      return !(deger === true || deger === 1);
    case 'eksik':
      return metin !== 'TAM';
    default:
      return true;
  }
}

function karsilastir(a: unknown, b: unknown): number {
  const ab = a == null || a === '';
  const bb = b == null || b === '';
  if (ab || bb) return ab === bb ? 0 : ab ? 1 : -1;
  const na = Number(a);
  const nb = Number(b);
  if (
    typeof a === 'number' ||
    typeof b === 'number' ||
    (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '')
  )
    return na - nb;
  return String(a).localeCompare(String(b), 'tr');
}

// ── SÜZGEÇ PENCERESİ ─────────────────────────────────────────────────────────────────────────────

function SuzgecPenceresi<T>({
  kolon,
  mevcut,
  konum,
  degerGetir,
  onUygula,
  onKapat,
}: {
  kolon: EarKolon<T>;
  mevcut: Suzgec[];
  konum: { sol: number; ust: number };
  degerGetir: (ara: string) => Promise<DegerListesi>;
  /** Kolonun YENİ süzgeç listesi (boş = kaldır). Sayı kolonunda en az ve en çok birlikte olabilir. */
  onUygula: (l: Suzgec[]) => void;
  onKapat: () => void;
}) {
  const tur = kolon.suzgec as SuzgecTuru;
  const [ara, setAra] = useState('');
  const [liste, setListe] = useState<{ ara: string; d: DegerListesi } | null>(null);
  const [hata, setHata] = useState('');
  const ilk = mevcut[0] || null;
  const [secili, setSecili] = useState<(string | null)[]>(
    ilk && ilk.op === 'in' ? (ilk.v as (string | null)[]) || [] : [],
  );
  const [op, setOp] = useState(ilk && ilk.op !== 'in' ? ilk.op : tur === 'metin' ? 'icerir' : 'in');
  const [metin, setMetin] = useState(ilk && typeof ilk.v !== 'object' ? String(ilk.v ?? '') : '');
  const bul = (o: string) => mevcut.find((x) => x.op === o);
  const [enAz, setEnAz] = useState(bul('min') ? String(bul('min')!.v) : '');
  const [enCok, setEnCok] = useState(bul('max') ? String(bul('max')!.v) : '');
  useAsyncEffect(
    async (alive) => {
      if (tur !== 'secim') return;
      try {
        const d = kolon.secenekler
          ? {
              degerler: kolon.secenekler.map((x) => ({ deger: x.deger, sayi: NaN })),
              farkli: kolon.secenekler.length,
            }
          : await degerGetir(ara);
        if (alive()) setListe({ ara, d });
      } catch (e) {
        if (alive()) setHata(e instanceof Error ? e.message : String(e));
      }
    },
    [tur, ara],
  );
  const etiket = (d: string | null) =>
    d == null ? BOS : kolon.secenekler?.find((x) => x.deger === d)?.etiket || d;
  const k = kolon.anahtar;
  const sayi = (v: string) => v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
  const uygula = () => {
    if (tur === 'secim') return onUygula(secili.length ? [{ k, op: 'in', v: secili }] : []);
    if (tur === 'bit') return onUygula(op === 'evet' || op === 'hayir' ? [{ k, op }] : []);
    if (tur === 'sayi')
      return onUygula([
        ...(sayi(enAz) ? [{ k, op: 'min', v: Number(enAz) }] : []),
        ...(sayi(enCok) ? [{ k, op: 'max', v: Number(enCok) }] : []),
      ]);
    if (tur === 'tarih')
      return onUygula(sayi(metin) && Number(metin) > 0 ? [{ k, op: 'gun', v: Number(metin) }] : []);
    if (op === 'bos' || op === 'dolu') return onUygula([{ k, op }]);
    return onUygula(metin.trim() ? [{ k, op, v: metin.trim() }] : []);
  };
  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onKapat} aria-hidden />
      <div
        role="dialog"
        aria-label={`${kolon.baslik} süzgeci`}
        className="fixed z-50 w-72 rounded-lg border shadow-lg p-2 space-y-2 text-xs"
        style={{
          left: konum.sol,
          top: konum.ust,
          background: 'var(--bg-surface)',
          borderColor: 'var(--border)',
          color: 'var(--text-primary)',
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onKapat();
        }}
      >
        <div className="font-semibold">{kolon.baslik}</div>
        <div style={{ color: 'var(--text-muted)' }}>{kolon.aciklama}</div>
        {tur === 'secim' && (
          <>
            {!kolon.secenekler && (
              <input
                aria-label={`${kolon.baslik} değerlerinde ara`}
                className={`${GIRDI} w-full`}
                style={girdiStil}
                placeholder="değerlerde ara"
                value={ara}
                onChange={(e) => setAra(e.target.value)}
                autoFocus
              />
            )}
            {hata ? (
              <LoadError title="Değerler okunamadı" message={hata} compact />
            ) : !liste ? (
              <div style={{ color: 'var(--text-muted)' }}>Değerler okunuyor…</div>
            ) : (
              <>
                <div className="max-h-56 overflow-y-auto space-y-0.5">
                  {liste.d.degerler.length === 0 && (
                    <div style={{ color: 'var(--text-muted)' }}>Değer yok.</div>
                  )}
                  {liste.d.degerler.map((x) => (
                    <label key={x.deger ?? BOS} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        aria-label={`${kolon.baslik}: ${etiket(x.deger)}`}
                        checked={secili.includes(x.deger)}
                        onChange={(e) =>
                          setSecili(
                            e.target.checked
                              ? [...secili, x.deger]
                              : secili.filter((y) => y !== x.deger),
                          )
                        }
                      />
                      <span className="truncate" title={etiket(x.deger)}>
                        {etiket(x.deger)}
                      </span>
                      {Number.isFinite(x.sayi) && (
                        <span className="ml-auto" style={{ color: 'var(--text-muted)' }}>
                          {fmtNumber(x.sayi)}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
                {liste.d.farkli > liste.d.degerler.length && (
                  <div style={{ color: 'var(--text-muted)' }}>
                    {fmtNumber(liste.d.farkli)} farklı değerden en sık{' '}
                    {fmtNumber(liste.d.degerler.length)} tanesi; aradığınızı yazın.
                  </div>
                )}
              </>
            )}
          </>
        )}
        {tur === 'metin' && (
          <div className="space-y-1">
            <select
              aria-label={`${kolon.baslik} işlem`}
              className={GIRDI}
              style={girdiStil}
              value={op}
              onChange={(e) => setOp(e.target.value)}
            >
              <option value="icerir">içerir</option>
              <option value="esit">eşittir</option>
              <option value="bos">boş</option>
              <option value="dolu">dolu</option>
            </select>
            {(op === 'icerir' || op === 'esit') && (
              <input
                aria-label={`${kolon.baslik} değer`}
                className={`${GIRDI} w-full`}
                style={girdiStil}
                value={metin}
                onChange={(e) => setMetin(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && uygula()}
                autoFocus
              />
            )}
          </div>
        )}
        {tur === 'sayi' && (
          <div className="flex items-center gap-1">
            <input
              aria-label={`${kolon.baslik} en az`}
              className={`${GIRDI} w-20`}
              style={girdiStil}
              inputMode="numeric"
              placeholder="en az"
              value={enAz}
              onChange={(e) => setEnAz(e.target.value)}
            />
            <span>–</span>
            <input
              aria-label={`${kolon.baslik} en çok`}
              className={`${GIRDI} w-20`}
              style={girdiStil}
              inputMode="numeric"
              placeholder="en çok"
              value={enCok}
              onChange={(e) => setEnCok(e.target.value)}
            />
          </div>
        )}
        {tur === 'tarih' && (
          <label className="flex items-center gap-1">
            son
            <input
              aria-label={`${kolon.baslik} gün`}
              className={`${GIRDI} w-16`}
              style={girdiStil}
              inputMode="numeric"
              value={metin}
              onChange={(e) => setMetin(e.target.value)}
            />
            gün
          </label>
        )}
        {tur === 'bit' && (
          <div className="flex gap-3">
            {[
              ['evet', 'evet'],
              ['hayir', 'hayır'],
            ].map(([v, e]) => (
              <label key={v} className="flex items-center gap-1">
                <input
                  type="radio"
                  name={`bit-${kolon.anahtar}`}
                  checked={op === v}
                  onChange={() => setOp(v)}
                />
                {e}
              </label>
            ))}
          </div>
        )}
        <div className="flex gap-1 justify-end">
          <button type="button" className={BTN} style={btnStil()} onClick={() => onUygula([])}>
            Temizle
          </button>
          <button type="button" className={BTN} style={btnStil(true)} onClick={uygula}>
            Uygula
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

// ── TABLO ────────────────────────────────────────────────────────────────────────────────────────

export function EarTablo<T>({
  kimlik,
  kolonlar,
  getir,
  satirlar: yerelSatirlar,
  degerler,
  satirAnahtari,
  onSatir,
  acilir,
  secimEylemleri,
  csvAdi,
  indirBag,
  araEtiketi = 'ara',
  bosMetin = 'Süzgece uyan kayıt yok.',
  tazele = 0,
  ustSag,
  gorunumler,
  yerelCsv,
  satirEtiketi,
  onSuzuldu,
  ortak,
}: {
  kimlik: string;
  kolonlar: EarKolon<T>[];
  getir?: (p: GetirParam) => Promise<Sayfa<T>>;
  satirlar?: T[];
  degerler?: (kolon: string, ara: string, f: Suzgec[], q: string) => Promise<DegerListesi>;
  satirAnahtari: (r: T) => string;
  onSatir?: (r: T) => void;
  acilir?: (r: T) => React.ReactNode;
  secimEylemleri?: (secili: T[], temizle: () => void) => React.ReactNode;
  csvAdi?: string;
  /** Sunucu kipinde tüm süzülmüş kümenin CSV bağlantısı. */
  indirBag?: (p: { f: Suzgec[]; s: string; q: string }) => string;
  araEtiketi?: string;
  bosMetin?: string;
  tazele?: number;
  ustSag?: React.ReactNode;
  /** Hazır görünümler; verilirse "Görünümler" menüsü (hazır + kişisel) çıkar. */
  gorunumler?: EarGorunum[];
  /** Yerel kipte süzülen satırların TAMAMININ CSV'si (dosya adı); görünen kolonlarla. */
  yerelCsv?: string;
  /** Açılır satırın düğme adı (ekran okuyucu); yoksa satır anahtarı. */
  satirEtiketi?: (r: T) => string;
  /**
   * Yerel kipte süzgeç + aramadan sonra kalan satırlar (sayfadan bağımsız). "Listedekileri tara" gibi
   * eylemler EKRANDA görünen kümeyi alsın diye. Verilen geri çağrı kararlı olmalı (setState gibi).
   */
  onSuzuldu?: (l: T[]) => void;
  /** Ortak (Admin) görünümler; verilirse menüde "Ortak" bölümü ve "Ortak kaydet" çıkar. */
  ortak?: EarOrtakGorunumler;
}) {
  const [kalici] = useState(() => kaliciOku(kimlik));
  const varsayilanGorunur = kolonlar.filter((k) => k.varsayilan !== false).map((k) => k.anahtar);
  const [gorunur, setGorunur] = useState<string[]>(() =>
    (kalici.gorunur || varsayilanGorunur).filter((a) => kolonlar.some((k) => k.anahtar === a)),
  );
  const gecerli = (f: Suzgec[]) =>
    f.filter((x) => kolonlar.some((k) => k.anahtar === x.k && k.suzgec));
  const [f, setF] = useState<Suzgec[]>(() => gecerli(Array.isArray(kalici.f) ? kalici.f : []));
  const [s, setS] = useState<string>(() => (typeof kalici.s === 'string' ? kalici.s : ''));
  const [sayfaBoyu, setSayfaBoyu] = useState<number>(() =>
    SAYFA_BOYLARI.includes(Number(kalici.sayfaBoyu)) ? Number(kalici.sayfaBoyu) : 100,
  );
  const [offset, setOffset] = useState(0);
  const [qTaslak, setQTaslak] = useState('');
  const [q, setQ] = useState('');
  const [veri, setVeri] = useState<{ anahtar: string; sayfa: Sayfa<T> } | null>(null);
  const [hata, setHata] = useState('');
  const [yeniden, setYeniden] = useState(0);
  const [acik, setAcik] = useState<{ kolon: string; sol: number; ust: number } | null>(null);
  const [kolonPencere, setKolonPencere] = useState<{ sol: number; ust: number } | null>(null);
  const [secili, setSecili] = useState<Map<string, T>>(() => new Map());
  const [acikSatir, setAcikSatir] = useState<string | null>(null);
  const [gorunumPencere, setGorunumPencere] = useState<{ sol: number; ust: number } | null>(null);
  const menuVar = !!(gorunumler || ortak);
  const [kisisel, setKisisel] = useState<EarGorunum[]>(() => (gorunumler || ortak ? kisiselOku(kimlik) : []));
  const [yeniAd, setYeniAd] = useState('');
  const [ortakHata, setOrtakHata] = useState('');
  const [ortakMesgul, setOrtakMesgul] = useState(false);

  const kaydet = (d: Partial<Kalici>) => kaliciYaz(kimlik, { gorunur, sayfaBoyu, f, s, ...d });
  const suzgecDegis = (yeni: Suzgec[]) => {
    setF(yeni);
    setOffset(0);
    kaydet({ f: yeni });
  };
  const siraDegis = (yeni: string) => {
    setS(yeni);
    setOffset(0);
    kaydet({ s: yeni });
  };

  // SUNUCU KİPİ: sayfa + süzgeç + sıralama sunucuda. Önceki sayfa görünür kalır (soluk) — boş ekran yok.
  const istekAnahtari = JSON.stringify({ f, s, q, sayfaBoyu, offset, tazele, yeniden });
  useAsyncEffect(
    async (alive) => {
      if (!getir) return;
      try {
        const sayfa = await getir({ f, s, q, limit: sayfaBoyu, offset });
        if (alive()) {
          setVeri({ anahtar: istekAnahtari, sayfa });
          setHata('');
        }
      } catch (e) {
        if (alive()) setHata(e instanceof Error ? e.message : String(e));
      }
    },
    [istekAnahtari],
  );

  // YEREL KİP: aynı süzgeç / sıralama anlamı tarayıcıda.
  const kolonOf = (a: string) => kolonlar.find((k) => k.anahtar === a);
  const hamDeger = (k: EarKolon<T> | undefined, r: T) => (k && k.deger ? k.deger(r) : undefined);
  const duz = (k: EarKolon<T> | undefined, r: T) => duzDeger(hamDeger(k, r));
  // Bulgular on binlerce satır olabilir (2026-11-07): süzme yalnız girdiler değişince (useMemo); açılan
  // satır, seçim ya da pencere çizimleri yeniden süzmez.
  const yerel = useMemo(() => {
    if (!yerelSatirlar) return null;
    const kOf = (a: string) => kolonlar.find((k) => k.anahtar === a);
    const ham = (k: EarKolon<T> | undefined, r: T) => (k && k.deger ? k.deger(r) : undefined);
    const qn = q.trim().toLowerCase();
    let l = yerelSatirlar.filter(
      (r) =>
        f.every((x) => yerelUyar(ham(kOf(x.k), r), x)) &&
        (!qn ||
          kolonlar.some((k) =>
            String(duzDeger(ham(k, r)) ?? '')
              .toLowerCase()
              .includes(qn),
          )),
    );
    if (s) {
      const [a, yon] = s.split(':');
      const k = kOf(a);
      l = [...l].sort(
        (x, y) =>
          karsilastir(duzDeger(ham(k, x)), duzDeger(ham(k, y))) * (yon === 'desc' ? -1 : 1),
      );
    }
    return l;
  }, [yerelSatirlar, kolonlar, f, s, q]);
  useEffect(() => {
    if (onSuzuldu && yerel) onSuzuldu(yerel);
  }, [onSuzuldu, yerel]);

  // Yerel satirlar disaridan daralinca (ust seciciler) sayfa konumu son gecerli sayfaya kirpilir: bos sayfa yok.
  const ofs =
    yerel && offset > 0 && offset >= yerel.length
      ? Math.max(0, Math.floor((yerel.length - 1) / sayfaBoyu) * sayfaBoyu)
      : offset;
  const sayfa: Sayfa<T> | null = yerel
    ? { satirlar: yerel.slice(ofs, ofs + sayfaBoyu), toplam: yerel.length }
    : veri
      ? veri.sayfa
      : null;
  const bekliyor = !!getir && (!veri || veri.anahtar !== istekAnahtari) && !hata;

  const degerGetir =
    (kolon: string) =>
    async (ara: string): Promise<DegerListesi> => {
      const digerleri = f.filter((x) => x.k !== kolon);
      if (yerelSatirlar) {
        const k = kolonOf(kolon);
        const say = new Map<string | null, number>();
        for (const r of yerelSatirlar) {
          if (!digerleri.every((x) => yerelUyar(hamDeger(kolonOf(x.k), r), x))) continue;
          const v = hamDeger(k, r);
          // Çok değerli kolonda her öğe ayrı değerdir; satır aynı öğeyi bir kez sayar.
          const ogeler = Array.isArray(v) ? (v.length ? [...new Set(v)] : [null]) : [v];
          for (const o of ogeler) {
            const d = o == null || o === '' ? null : String(o);
            if (ara && !(d ?? '').toLowerCase().includes(ara.toLowerCase())) continue;
            say.set(d, (say.get(d) || 0) + 1);
          }
        }
        const l = [...say.entries()]
          .map(([deger, sayi]) => ({ deger, sayi }))
          .sort((a, b) => b.sayi - a.sayi);
        return { degerler: l.slice(0, 200), farkli: l.length };
      }
      if (!degerler) return { degerler: [], farkli: 0 };
      return degerler(kolon, ara, digerleri, q);
    };

  const gorunenKolonlar = kolonlar.filter((k) => gorunur.includes(k.anahtar));
  const secimVar = !!secimEylemleri;
  const kolonSayisi = gorunenKolonlar.length + (secimVar ? 1 : 0) + (acilir ? 1 : 0);
  const sayfadakiler = sayfa ? sayfa.satirlar : [];
  const hepsiSecili =
    sayfadakiler.length > 0 && sayfadakiler.every((r) => secili.has(satirAnahtari(r)));

  const konumOf = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { sol: Math.max(8, Math.min(r.left, window.innerWidth - 300)), ust: r.bottom + 4 };
  };

  const seciliCsv = () => {
    const l = [...secili.values()];
    downloadCsv(
      csvAdi || kimlik,
      gorunenKolonlar.map((k) => k.baslik),
      l.map((r) => gorunenKolonlar.map((k) => formulGuvenli(duz(k, r)))),
    );
  };

  const tumCsv = () => {
    if (!yerel) return;
    downloadCsv(
      yerelCsv || kimlik,
      gorunenKolonlar.map((k) => k.baslik),
      yerel.map((r) => gorunenKolonlar.map((k) => formulGuvenli(duz(k, r)))),
    );
  };

  const ayni = (g: EarGorunum) =>
    JSON.stringify(gecerli(g.f || [])) === JSON.stringify(f) && (g.s || '') === s;
  const aktifGorunum = menuVar
    ? [...(gorunumler || []), ...(ortak ? ortak.gorunumler : []), ...kisisel].find(ayni) || null
    : null;
  const gorunumUygula = (g: EarGorunum) => {
    const yf = gecerli(g.f || []);
    const ys = g.s || '';
    const yg = (g.kolonlar || []).filter((a) => kolonlar.some((k) => k.anahtar === a));
    setF(yf);
    setS(ys);
    if (yg.length) setGorunur(yg);
    setOffset(0);
    kaydet({ f: yf, s: ys, gorunur: yg.length ? yg : gorunur });
    setGorunumPencere(null);
  };
  const kisiselKaydet = () => {
    const ad = yeniAd.trim().slice(0, 60);
    if (!ad) return;
    const yeni = [...kisisel.filter((g) => g.ad !== ad), { ad, f, s, kolonlar: gorunur }].slice(-KISISEL_EN_COK);
    setKisisel(yeni);
    kisiselYaz(kimlik, yeni);
    setYeniAd('');
  };
  const ortakIs = async (is: () => Promise<void>) => {
    setOrtakMesgul(true);
    setOrtakHata('');
    try {
      await is();
    } catch (e) {
      setOrtakHata(e instanceof Error ? e.message : String(e));
    } finally {
      setOrtakMesgul(false);
    }
  };
  const ortakKaydet = () => {
    const ad = yeniAd.trim().slice(0, 60);
    if (!ad || !ortak || !ortak.kaydet) return;
    const kaydet = ortak.kaydet;
    void ortakIs(async () => {
      await kaydet({ ad, f, s, kolonlar: gorunur });
      setYeniAd('');
    });
  };
  const kisiselSil = (ad: string) => {
    const yeni = kisisel.filter((g) => g.ad !== ad);
    setKisisel(yeni);
    kisiselYaz(kimlik, yeni);
  };

  const etkinler = f.map((x) => ({ x, k: kolonOf(x.k) })).filter((x) => x.k);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(qTaslak);
            setOffset(0);
          }}
        >
          <input
            aria-label={araEtiketi}
            placeholder={araEtiketi}
            className={`${GIRDI} w-56`}
            style={girdiStil}
            value={qTaslak}
            onChange={(e) => {
              setQTaslak(e.target.value);
              if (yerelSatirlar) {
                setQ(e.target.value);
                setOffset(0);
              }
            }}
          />
          {!yerelSatirlar && (
            <button type="submit" className={BTN} style={btnStil()}>
              Ara
            </button>
          )}
        </form>
        <button
          type="button"
          className={BTN}
          style={btnStil()}
          onClick={(e) => setKolonPencere(konumOf(e))}
          aria-haspopup="dialog"
        >
          <ViewColumnsIcon className="w-3.5 h-3.5" aria-hidden /> Kolonlar ({gorunur.length}/
          {kolonlar.length})
        </button>
        {menuVar && (
          <button
            type="button"
            className={BTN}
            style={btnStil(!!aktifGorunum && aktifGorunum.f.length > 0)}
            onClick={(e) => setGorunumPencere(konumOf(e))}
            aria-haspopup="dialog"
            title="Hazır ve kaydettiğiniz görünümler (süzgeç + sıralama + kolonlar)"
          >
            <BookmarkIcon className="w-3.5 h-3.5" aria-hidden />{' '}
            {aktifGorunum ? `Görünüm: ${aktifGorunum.ad}` : 'Görünümler'}
          </button>
        )}
        {indirBag && (
          <a className={BTN} style={btnStil()} href={indirBag({ f, s, q })} download>
            Süzülenleri CSV
          </a>
        )}
        {yerelCsv && yerel && (
          <button
            type="button"
            className={BTN}
            style={btnStil()}
            onClick={tumCsv}
            disabled={!yerel.length}
            title="Süzgeç ve aramaya uyan satırların tamamı, görünen kolonlarla"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" aria-hidden /> CSV ({fmtNumber(yerel.length)})
          </button>
        )}
        <span className="ml-auto flex items-center gap-1">{ustSag}</span>
      </div>
      {etkinler.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-[11px]">
          {etkinler.map(({ x, k }, i) => (
            <span
              key={`${x.k}-${x.op}-${i}`}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
            >
              <b>{k!.baslik}:</b>{' '}
              {suzgecMetni(x, (d) => k!.secenekler?.find((o) => o.deger === d)?.etiket || d)}
              <button
                type="button"
                aria-label={`${k!.baslik} süzgecini kaldır`}
                onClick={() => suzgecDegis(f.filter((_, j) => j !== i))}
              >
                <XMarkIcon className="w-3 h-3" aria-hidden />
              </button>
            </span>
          ))}
          <button type="button" className="underline" onClick={() => suzgecDegis([])}>
            tümünü temizle
          </button>
        </div>
      )}
      {secimVar && secili.size > 0 && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border px-2 py-1 text-xs"
          style={{ borderColor: 'var(--accent)', background: 'var(--bg-elevated)' }}
        >
          <b>{fmtNumber(secili.size)} satır seçili</b>
          {secimEylemleri!([...secili.values()], () => setSecili(new Map()))}
          <button type="button" className={BTN} style={btnStil()} onClick={seciliCsv}>
            Seçilenleri CSV
          </button>
          <button type="button" className="underline" onClick={() => setSecili(new Map())}>
            seçimi kaldır
          </button>
        </div>
      )}
      {hata ? (
        <LoadError
          title="Liste okunamadı"
          message={hata}
          onRetry={() => setYeniden((n) => n + 1)}
          compact
        />
      ) : (
        <div
          className="overflow-auto rounded-lg border max-h-[70vh]"
          style={{ borderColor: 'var(--border)', opacity: bekliyor && sayfa ? 0.6 : 1 }}
          aria-busy={bekliyor}
        >
          <table className={TABLO}>
            <thead>
              <tr>
                {acilir && (
                  <th className={`${TH} sticky top-0 z-10`} style={thStil} aria-label="aç" />
                )}
                {secimVar && (
                  <th className={`${TH} sticky top-0 z-10`} style={thStil}>
                    <input
                      type="checkbox"
                      aria-label="sayfadakilerin hepsini seç"
                      checked={hepsiSecili}
                      onChange={(e) => {
                        const m = new Map(secili);
                        for (const r of sayfadakiler)
                          if (e.target.checked) m.set(satirAnahtari(r), r);
                          else m.delete(satirAnahtari(r));
                        setSecili(m);
                      }}
                    />
                  </th>
                )}
                {gorunenKolonlar.map((k) => {
                  const [sa, sy] = s.split(':');
                  const yon = sa === k.anahtar ? sy : '';
                  const etkin = f.some((x) => x.k === k.anahtar);
                  return (
                    <th
                      key={k.anahtar}
                      className={`${TH} sticky top-0 z-10 whitespace-nowrap`}
                      style={thStil}
                      aria-sort={
                        yon === 'asc' ? 'ascending' : yon === 'desc' ? 'descending' : undefined
                      }
                    >
                      <span className="inline-flex items-center gap-0.5">
                        {k.sirala ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-0.5"
                            onClick={() =>
                              siraDegis(
                                yon === ''
                                  ? `${k.anahtar}:asc`
                                  : yon === 'asc'
                                    ? `${k.anahtar}:desc`
                                    : '',
                              )
                            }
                          >
                            {k.baslik}
                            {yon === 'asc' && <ChevronUpIcon className="w-3 h-3" aria-hidden />}
                            {yon === 'desc' && <ChevronDownIcon className="w-3 h-3" aria-hidden />}
                          </button>
                        ) : (
                          k.baslik
                        )}
                        <span title={k.aciklama} aria-label={`${k.baslik}: ${k.aciklama}`}>
                          <InformationCircleIcon className="w-3 h-3 opacity-50" aria-hidden />
                        </span>
                        {k.suzgec && (
                          <button
                            type="button"
                            aria-label={`${k.baslik} süz`}
                            aria-haspopup="dialog"
                            onClick={(e) => setAcik({ kolon: k.anahtar, ...konumOf(e) })}
                            style={{ color: etkin ? 'var(--accent)' : undefined }}
                          >
                            <FunnelIcon className="w-3 h-3" aria-hidden />
                          </button>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {!sayfa ? (
                <tr>
                  <td colSpan={kolonSayisi} className={TD} style={{ color: 'var(--text-muted)' }}>
                    Okunuyor…
                  </td>
                </tr>
              ) : sayfa.satirlar.length === 0 ? (
                <TableEmptyRow
                  colSpan={kolonSayisi}
                  title="Kayıt bulunamadı."
                  description={bosMetin}
                />
              ) : (
                sayfa.satirlar.map((r) => {
                  const a = satirAnahtari(r);
                  const ac = acikSatir === a;
                  return (
                    <React.Fragment key={a}>
                      <tr
                        className={`border-t ${onSatir || acilir ? 'cursor-pointer' : ''}`}
                        style={{ borderColor: 'var(--border)' }}
                        onClick={() =>
                          acilir ? setAcikSatir(ac ? null : a) : onSatir && onSatir(r)
                        }
                      >
                        {acilir && (
                          <td className={TD}>
                            {/* Klavye ve ekran okuyucu: satır tıklaması yalnız fare içindi (2026-11-07). */}
                            <button
                              type="button"
                              aria-expanded={ac}
                              aria-label={`${satirEtiketi ? satirEtiketi(r) : a} ayrıntısı`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setAcikSatir(ac ? null : a);
                              }}
                              className="align-middle"
                            >
                              {ac ? (
                                <ChevronDownIcon className="w-3.5 h-3.5" aria-hidden />
                              ) : (
                                <ChevronRightIcon className="w-3.5 h-3.5" aria-hidden />
                              )}
                            </button>
                          </td>
                        )}
                        {secimVar && (
                          <td className={TD} onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`seç: ${a}`}
                              checked={secili.has(a)}
                              onChange={(e) => {
                                const m = new Map(secili);
                                if (e.target.checked) m.set(a, r);
                                else m.delete(a);
                                setSecili(m);
                              }}
                            />
                          </td>
                        )}
                        {gorunenKolonlar.map((k) => (
                          // Tek satır: uzun metin Kirp ile kırpılır (tamamı title'da); tablo yatay kayar.
                          <td key={k.anahtar} className={`${TD} whitespace-nowrap`}>
                            {k.hucre(r)}
                          </td>
                        ))}
                      </tr>
                      {ac && acilir && (
                        <tr>
                          <td
                            colSpan={kolonSayisi}
                            className="px-3"
                            style={{ background: 'var(--bg-elevated)' }}
                          >
                            {acilir(r)}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
      {sayfa && (
        <div
          className="flex flex-wrap items-center gap-2 text-[11px]"
          style={{ color: 'var(--text-muted)' }}
        >
          <span aria-live="polite">
            {sayfa.toplam === 0
              ? '0 kayıt'
              : `${fmtNumber(ofs + 1)}–${fmtNumber(Math.min(ofs + sayfaBoyu, sayfa.toplam))} / ${fmtNumber(sayfa.toplam)}`}
          </span>
          <button
            type="button"
            className={BTN}
            style={btnStil()}
            disabled={ofs === 0}
            onClick={() => setOffset(0)}
            aria-label="ilk sayfa"
          >
            «
          </button>
          <button
            type="button"
            className={BTN}
            style={btnStil()}
            disabled={ofs === 0}
            onClick={() => setOffset(Math.max(0, ofs - sayfaBoyu))}
          >
            Önceki
          </button>
          <button
            type="button"
            className={BTN}
            style={btnStil()}
            disabled={ofs + sayfaBoyu >= sayfa.toplam}
            onClick={() => setOffset(ofs + sayfaBoyu)}
          >
            Sonraki
          </button>
          <button
            type="button"
            className={BTN}
            style={btnStil()}
            disabled={ofs + sayfaBoyu >= sayfa.toplam}
            onClick={() =>
              setOffset(Math.max(0, Math.floor((sayfa.toplam - 1) / sayfaBoyu) * sayfaBoyu))
            }
            aria-label="son sayfa"
          >
            »
          </button>
          <label className="flex items-center gap-1">
            sayfa boyu
            <select
              aria-label="sayfa boyu"
              className={GIRDI}
              style={girdiStil}
              value={sayfaBoyu}
              onChange={(e) => {
                const n = Number(e.target.value);
                setSayfaBoyu(n);
                setOffset(0);
                kaydet({ sayfaBoyu: n });
              }}
            >
              {SAYFA_BOYLARI.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {acik && kolonOf(acik.kolon) && (
        <SuzgecPenceresi
          kolon={kolonOf(acik.kolon)!}
          mevcut={f.filter((x) => x.k === acik.kolon)}
          konum={{ sol: acik.sol, ust: acik.ust }}
          degerGetir={degerGetir(acik.kolon)}
          onKapat={() => setAcik(null)}
          onUygula={(yeni) => {
            suzgecDegis([...f.filter((x) => x.k !== acik.kolon), ...yeni]);
            setAcik(null);
          }}
        />
      )}
      {gorunumPencere &&
        menuVar &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setGorunumPencere(null)} aria-hidden />
            <div
              role="dialog"
              aria-label="Görünümler"
              className="fixed z-50 w-72 max-h-[60vh] overflow-y-auto rounded-lg border shadow-lg p-2 space-y-2 text-xs"
              style={{
                left: gorunumPencere.sol,
                top: gorunumPencere.ust,
                background: 'var(--bg-surface)',
                borderColor: 'var(--border)',
                color: 'var(--text-primary)',
              }}
              onKeyDown={(e) => e.key === 'Escape' && setGorunumPencere(null)}
            >
              {gorunumler && gorunumler.length > 0 && (
                <div>
                  <div className="font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
                    Hazır
                  </div>
                  {gorunumler.map((g) => (
                    <button
                      key={g.ad}
                      type="button"
                      aria-pressed={aktifGorunum === g}
                      onClick={() => gorunumUygula(g)}
                      className="block w-full text-left rounded px-1.5 py-1"
                      style={{ background: aktifGorunum === g ? 'var(--bg-elevated)' : undefined }}
                      title={g.aciklama}
                    >
                      {g.ad}
                      {g.aciklama && (
                        <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          {g.aciklama}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {ortak && (
                <div>
                  <div className="font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
                    Ortak (Admin)
                  </div>
                  {ortak.okunamadi && (
                    <div className="text-[11px]" style={{ color: 'var(--status-warning-text)' }}>
                      Ortak görünümler okunamadı.
                    </div>
                  )}
                  {!ortak.okunamadi && ortak.gorunumler.length === 0 && (
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      Henüz yok: herkesin görmesi için süzgeci kurup “Ortak kaydet”.
                    </div>
                  )}
                  {ortak.gorunumler.map((g) => (
                    <div key={g.ad} className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-pressed={aktifGorunum === g}
                        onClick={() => gorunumUygula(g)}
                        className="flex-1 text-left rounded px-1.5 py-1"
                        style={{ background: aktifGorunum === g ? 'var(--bg-elevated)' : undefined }}
                        title={g.aciklama}
                      >
                        {g.ad}
                      </button>
                      {ortak.sil && (
                        <button
                          type="button"
                          aria-label={`${g.ad} ortak görünümünü sil`}
                          disabled={ortakMesgul}
                          onClick={() => {
                            const sil = ortak.sil!;
                            void ortakIs(() => sil(g.ad));
                          }}
                        >
                          <XMarkIcon className="w-3 h-3" aria-hidden />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div>
                <div className="font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
                  Kaydettiklerim
                </div>
                {kisisel.length === 0 && (
                  <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    Henüz yok: süzgeci kurup aşağıdan kaydedin (yalnız bu tarayıcıda).
                  </div>
                )}
                {kisisel.map((g) => (
                  <div key={g.ad} className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-pressed={aktifGorunum === g}
                      onClick={() => gorunumUygula(g)}
                      className="flex-1 text-left rounded px-1.5 py-1"
                      style={{ background: aktifGorunum === g ? 'var(--bg-elevated)' : undefined }}
                    >
                      {g.ad}
                    </button>
                    <button type="button" aria-label={`${g.ad} görünümünü sil`} onClick={() => kisiselSil(g.ad)}>
                      <XMarkIcon className="w-3 h-3" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
              <form
                className="flex flex-wrap items-center gap-1 border-t pt-2"
                style={{ borderColor: 'var(--border)' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  kisiselKaydet();
                }}
              >
                <input
                  aria-label="Görünüm adı"
                  placeholder="bu görünümü kaydet: ad"
                  className={`${GIRDI} w-full`}
                  style={girdiStil}
                  maxLength={60}
                  value={yeniAd}
                  onChange={(e) => setYeniAd(e.target.value)}
                />
                <button type="submit" className={BTN} style={btnStil(true)} disabled={!yeniAd.trim()}>
                  Kaydet
                </button>
                {ortak && ortak.kaydet && (
                  <button
                    type="button"
                    className={BTN}
                    style={btnStil()}
                    disabled={!yeniAd.trim() || ortakMesgul}
                    onClick={ortakKaydet}
                    title="Server Hub'ı açan herkes görür"
                  >
                    Ortak kaydet
                  </button>
                )}
              </form>
              {ortakHata && (
                <div role="alert" className="text-[11px]" style={{ color: 'var(--status-danger-text)' }}>
                  {ortakHata}
                </div>
              )}
              <button
                type="button"
                className="underline"
                // Süzgeç ve sıralama temizlenir, kolonlar varsayılana döner.
                onClick={() => gorunumUygula({ ad: '', f: [], s: '', kolonlar: varsayilanGorunur })}
              >
                süzgeçsiz görünüm
              </button>
            </div>
          </>,
          document.body,
        )}
      {kolonPencere &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setKolonPencere(null)} aria-hidden />
            <div
              role="dialog"
              aria-label="Kolon seçimi"
              className="fixed z-50 w-64 max-h-[60vh] overflow-y-auto rounded-lg border shadow-lg p-2 space-y-1 text-xs"
              style={{
                left: kolonPencere.sol,
                top: kolonPencere.ust,
                background: 'var(--bg-surface)',
                borderColor: 'var(--border)',
                color: 'var(--text-primary)',
              }}
            >
              {kolonlar.map((k) => (
                <label key={k.anahtar} className="flex items-start gap-1.5" title={k.aciklama}>
                  <input
                    type="checkbox"
                    aria-label={`kolon: ${k.baslik}`}
                    checked={gorunur.includes(k.anahtar)}
                    disabled={gorunur.length === 1 && gorunur.includes(k.anahtar)}
                    onChange={(e) => {
                      const yeni = e.target.checked
                        ? kolonlar
                            .map((x) => x.anahtar)
                            .filter((x) => x === k.anahtar || gorunur.includes(x))
                        : gorunur.filter((x) => x !== k.anahtar);
                      setGorunur(yeni);
                      kaydet({ gorunur: yeni });
                    }}
                  />
                  <span>
                    {k.baslik}
                    <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {k.aciklama}
                    </span>
                  </span>
                </label>
              ))}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setGorunur(varsayilanGorunur);
                  kaydet({ gorunur: varsayilanGorunur });
                }}
              >
                varsayılana dön
              </button>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
