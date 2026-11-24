// src/components/server_hub/topluOrtak.tsx — Toplu Auto-Start ve Toplu Restart sekmelerinin ORTAK parcalari
// (2026-11-24). Iki sekme ayni iskeleti (aday bolumu, secim tablosu, dislananlar, is basligi, yoklama) iki kopya
// olarak tasiyordu (Sonar CPD ~350 satir). Sunucu tarafinin ortak cekirdegi: server/server-hub/toplu-cekirdek.cjs.
import React, { useEffect } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { fmtDateTime, fmtNumber } from '@/utils/datetime';

type SecimGuncelle = (f: (s: Set<string>) => Set<string>) => void;

/**
 * Secilebilir aday tablosu: baslikta "tumunu sec", her satirda secim kutusu; kalan hucreler modulden.
 * kilitli: aktif toplu is varken secim degismez.
 */
export function TopluAdayTablosu<T extends { host: string; jvm: string }>({
  satirlar,
  anahtar,
  secili,
  setSecili,
  kilitli,
  baslik,
  tumunuEtiketi,
  kolonlar,
  hucreler,
  satirSinifi = 'border-t',
}: {
  satirlar: T[];
  anahtar: (x: T) => string;
  secili: Set<string>;
  setSecili: SecimGuncelle;
  kilitli: boolean;
  baslik: React.ReactNode;
  tumunuEtiketi: string;
  /** Secim kolonundan sonraki kolon basliklari (sabit, birbirinden farkli metinler). */
  kolonlar: string[];
  /** Secim hucresinden sonraki hucreler (kolonlar ile ayni sayida <td>). */
  hucreler: (x: T) => React.ReactNode;
  satirSinifi?: string;
}) {
  if (!satirlar.length) return null;
  const hepsi = satirlar.every((x) => secili.has(anahtar(x)));
  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <div
        className="px-3 py-2 text-xs font-semibold flex items-center gap-2"
        style={{ background: 'var(--bg-elevated)' }}
      >
        <input
          type="checkbox"
          aria-label={tumunuEtiketi}
          checked={hepsi}
          disabled={kilitli}
          onChange={() =>
            setSecili((s) => {
              const n = new Set(s);
              for (const x of satirlar) {
                if (hepsi) n.delete(anahtar(x));
                else n.add(anahtar(x));
              }
              return n;
            })
          }
        />
        {baslik} <span style={{ color: 'var(--text-muted)' }}>({fmtNumber(satirlar.length)})</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th className="px-3 py-1 w-6" />
              {kolonlar.map((k) => (
                <th key={k} className="px-3 py-1 text-left font-medium">
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {satirlar.map((x) => (
              <tr
                key={anahtar(x)}
                className={satirSinifi}
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <td className="px-3 py-1">
                  <input
                    type="checkbox"
                    aria-label={`${x.host} ${x.jvm} seç`}
                    checked={secili.has(anahtar(x))}
                    disabled={kilitli}
                    onChange={() =>
                      setSecili((s) => {
                        const n = new Set(s);
                        if (n.has(anahtar(x))) n.delete(anahtar(x));
                        else n.add(anahtar(x));
                        return n;
                      })
                    }
                  />
                </td>
                {hucreler(x)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Aday bolumunun ustu: baslik + aciklama (son tarama zamani eklenir), taze okuma "Yenile" dugmesi, okuma hatasi,
 * ilk yuklemede gosterge.
 */
export function AdayBolumuUstu({
  baslik,
  aciklama,
  latestScan,
  yukleniyor,
  veriVar,
  hata,
  onYenile,
}: {
  baslik: string;
  aciklama: React.ReactNode;
  latestScan?: string | null;
  yukleniyor: boolean;
  veriVar: boolean;
  hata: string | null;
  onYenile: () => void;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {baslik}
          </h2>
          <p className="text-[12px] mt-0.5 max-w-3xl" style={{ color: 'var(--text-muted)' }}>
            {aciklama}
            {latestScan ? ` Son tarama: ${latestScan}.` : ''}
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-1 text-xs"
          disabled={yukleniyor}
          onClick={onYenile}
          title="Taze değerlendirme (tüm filo yeniden okunur)"
        >
          <ArrowPathIcon className="w-4 h-4" /> Yenile
        </button>
      </div>
      {hata && (
        <div
          className="text-[12px] rounded-lg border px-3 py-2"
          style={{ color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
        >
          {hata}
        </div>
      )}
      {yukleniyor && !veriVar && <LoadingLogo compact label="Adaylar okunuyor…" />}
    </>
  );
}

/** Aday listesinin durum notlari: sema okunamadi (aday yok) ya da uygun aday yok. */
export function AdayNotlari({
  schemaUnknown,
  bos,
  bosMetni,
}: {
  schemaUnknown?: boolean;
  bos: boolean;
  bosMetni: string;
}) {
  return (
    <>
      {schemaUnknown && (
        <div className="text-[12px]" style={{ color: 'var(--status-danger)' }}>
          Server Hub şeması okunamadı — aday yok. Sayfayı yenileyin.
        </div>
      )}
      {bos && !schemaUnknown && (
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {bosMetni}
        </div>
      )}
    </>
  );
}

/** Listeye alinmayan JVM'ler (nedeniyle), kapali ayrinti. */
export function DislananlarListesi<T extends { host: string; jvm: string; neden?: string }>({
  liste,
  anahtar,
  ozet,
}: {
  liste: T[];
  anahtar: (x: T) => string;
  ozet: string;
}) {
  if (!liste.length) return null;
  return (
    <details className="text-[12px]">
      <summary className="cursor-pointer" style={{ color: 'var(--text-muted)' }}>
        {ozet} {fmtNumber(liste.length)} JVM (nedeniyle)
      </summary>
      <ul className="mt-1 space-y-0.5">
        {liste.map((x) => (
          <li key={anahtar(x)}>
            <span className="font-mono">
              {x.host}/{x.jvm}
            </span>{' '}
            — {x.neden}
          </li>
        ))}
      </ul>
    </details>
  );
}

interface TopluIsOzeti {
  id: number;
  durum: string;
  olusturan: string;
  onaylayan?: string | null;
  iptalEden?: string | null;
  createdAt?: string | null;
}

/** Is bolumunun basligi: is numarasi, durum rozeti, kim acti / onayladi / iptal etti; Onayla ve Iptal. */
export function TopluIsBasligi({
  is,
  baslik,
  rozet,
  onayMetni,
  gecen,
  gonderiliyor,
  planDoldu,
  onOnay,
  onIptal,
}: {
  is: TopluIsOzeti;
  baslik: string;
  rozet: React.ReactNode;
  onayMetni: string;
  gecen: number;
  gonderiliyor: boolean;
  planDoldu: boolean;
  onOnay: () => void;
  onIptal: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {baslik}
        </h2>
        {rozet}
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          açan {is.olusturan}
          {is.onaylayan ? ` · onaylayan ${is.onaylayan}` : ''}
          {is.iptalEden ? ` · iptal eden ${is.iptalEden}` : ''}
          {is.createdAt ? ` · ${fmtDateTime(is.createdAt)}` : ''}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {is.durum === 'PLAN_HAZIR' && (
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={gonderiliyor || !gecen || planDoldu}
            onClick={onOnay}
          >
            {onayMetni} ({fmtNumber(gecen)} JVM)
          </button>
        )}
        {(is.durum === 'PLAN_HAZIR' || is.durum === 'PLANLANIYOR' || is.durum === 'CALISIYOR') && (
          <button type="button" className="btn-secondary text-xs" onClick={onIptal}>
            İptal
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Izlenen isin yoklamasi: yalniz sekme gorunurken ve is yururken (sik) ya da onay beklerken (seyrek).
 */
export function useTopluYoklama({
  gorunur,
  izlenen,
  yuruyor,
  onayBekliyor,
  durumOku,
  yoklamaMs,
  planYoklamaMs,
}: {
  gorunur: boolean;
  izlenen: number | null;
  yuruyor: boolean;
  onayBekliyor: boolean;
  durumOku: (id: number) => Promise<void>;
  yoklamaMs: number;
  planYoklamaMs: number;
}) {
  useEffect(() => {
    if (!gorunur || izlenen == null || (!yuruyor && !onayBekliyor)) return undefined;
    const t = setInterval(
      () => {
        void durumOku(izlenen).catch(() => {});
      },
      yuruyor ? yoklamaMs : planYoklamaMs,
    );
    return () => clearInterval(t);
  }, [gorunur, izlenen, yuruyor, onayBekliyor, durumOku, yoklamaMs, planYoklamaMs]);
}

/** Onay icin kalan sure (ms): plan bitisi + gecerlilik - simdi; onay beklemiyorsa null. */
export function planKalanMs(
  onayBekliyor: boolean,
  planBitisAt: string | null | undefined,
  gecerlilikMs: number,
  simdi: number,
): number | null {
  return onayBekliyor && planBitisAt
    ? new Date(planBitisAt).getTime() + gecerlilikMs - simdi
    : null;
}
