// src/components/server_hub/RetirementAnaliziTab.tsx — Server Hub > Retirement Analizi (2026-11-07).
//
// Kullanıcı: "bir sayfa olmalı ki aksiyon ekranı gibi ... app1 yazdım bana bunu bunu yapabilirsin, şüphem bu
// gibi şeyleri yazdığın bir özet; tıklarsan açılacak modal ... en basit ekrandan detaya doğru ... bir kişi
// app1'de bir şey varsa ilk başta kafası karışmadan 'bu bu bu yapılmalı' diye görmeli; ne, nasıl, niye
// açılan kısımlarda olmalı".
//
// AKIŞ: arama (uygulama / sunucu / vhost / DNS / IP) -> SADE KART (büyük karar cümlesi, tek satır ana şüphe,
// en çok 3 "yapılabilecek", Admin sınıf rozetleri) -> "Ayrıntı" modalı: açılır bölümler (yalnız ilki açık):
// neden bu karar, kopyalar, doğrulama ve eksikler, zincir (web -> uygulama kanıtı), notlar. Aramasız ekranda
// karar sayıları ve uygulama listesi; Admin'in "Bilinen" dediği uygulamalar ayrı bölümde, sayılmaz.
// Ekran HİÇBİR ŞEY ÇALIŞTIRMAZ: "Retirement kaydı aç" yalnız Retirement sekmesindeki formu doldurur.
// Veri: /iliski/* ve /notlar (iliski-uclar.cjs, notlar-uclar.cjs). Ölçülemeyen hiçbir şey yeşil görünmez.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowPathIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import {
  serverHubApi,
  type ShAraSonuc,
  type ShKarar,
  type ShKararAyrinti,
  type ShKararlarSonuc,
  type ShKararOzet,
  type ShKopyaKarar,
  type ShMadde,
  type ShNot,
  type ShNotGovde,
  type ShSinif,
  type ShVarlik,
} from '@/api/serverHubApi';
import { toast } from '@/hooks/useToast';
import { Modal } from '@/components/common/Modal';
import LoadError from '@/components/common/LoadError';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { EarTablo, type EarKolon } from './EarTablo';
import { BTN, btnStil } from './RetireEtiketleri';
import Rozet, { type DurumTon } from './DurumRozeti';
import NotYonetimi, { SinifRozeti, type NotSuzgeci } from './NotYonetimi';

const MUTED: React.CSSProperties = { color: 'var(--text-muted)' };
const hataMetni = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Ölçülemeyen / karar verilemeyen hiçbir şey yeşil değil: yalnız KULLANIMDA ve SORUN_YOK "iyi".
export const KARAR_TON: Record<ShKarar, DurumTon> = {
  KULLANIMDA: 'iyi',
  SORUN_YOK: 'iyi',
  RETIRE_ADAYI: 'kotu',
  SUPHELI: 'uyari',
  KARAR_VERILEMEZ: 'notr',
};
export const KARAR_KISA: Record<ShKarar, string> = {
  KULLANIMDA: 'Kullanımda',
  RETIRE_ADAYI: 'Retire adayı',
  SUPHELI: 'Şüpheli',
  KARAR_VERILEMEZ: 'Karar verilemez',
  SORUN_YOK: 'Sorun yok',
};
export const KARAR_SIRA: ShKarar[] = [
  'RETIRE_ADAYI',
  'SUPHELI',
  'KARAR_VERILEMEZ',
  'KULLANIMDA',
  'SORUN_YOK',
];
const ETKI_BASLIK: Record<ShMadde['etki'], string> = {
  ENGELLER: 'Retire’a engel',
  DESTEKLER: 'Retire lehine',
  EKSIK: 'Eksik ya da çelişkili veri',
  NOTR: 'Bilgi / risk',
};
const TUR_ADI: Record<string, string> = {
  app: 'uygulama',
  sunucu: 'sunucu',
  vhost: 'vhost',
  dns: 'DNS',
  jvm: 'JVM',
  was: 'WebSphere',
  web: 'web sunucusu',
  ip: 'IP',
};

/** Kartın tek satırlık ana şüphesi: önce engel, sonra destek, sonra eksik (bilinenler hariç). */
export function anaSupheOf(maddeler: ShMadde[]): ShMadde | null {
  const acik = maddeler.filter((m) => !m.bilinen);
  return (
    acik.find((m) => m.etki === 'ENGELLER') ||
    acik.find((m) => m.etki === 'EKSIK' && m.kod === 'CELISKI') ||
    acik.find((m) => m.etki === 'DESTEKLER') ||
    acik.find((m) => m.etki === 'EKSIK') ||
    null
  );
}

// ── Arama ─────────────────────────────────────────────────────────────────────────────────────
function Arama({ onSec }: { onSec: (anahtar: string) => void }) {
  const [q, setQ] = useState('');
  const [sonuc, setSonuc] = useState<ShAraSonuc[] | null>(null);
  const [hata, setHata] = useState('');
  useEffect(() => {
    const m = q.trim();
    if (m.length < 2) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      serverHubApi
        .iliskiAra(m)
        .then((r) => alive && (setSonuc(r.sonuclar), setHata('')))
        .catch((e) => alive && (setSonuc(null), setHata(hataMetni(e))));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);
  const goster = q.trim().length >= 2;
  return (
    <div className="relative flex-1 min-w-[16rem] max-w-2xl">
      <MagnifyingGlassIcon
        className="w-4 h-4 absolute left-3 top-2.5"
        style={MUTED}
        aria-hidden="true"
      />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Uygulama, sunucu, vhost, DNS ya da IP ara"
        placeholder="Uygulama, sunucu, vhost, DNS ya da IP yazın (ör. app1)"
        className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
      />
      {goster && (hata || sonuc) && (
        <div
          className="absolute z-20 mt-1 w-full rounded-lg border shadow-sm max-h-80 overflow-auto"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          {hata ? (
            <div className="p-2">
              <LoadError compact title="Arama yapılamadı" message={hata} />
            </div>
          ) : sonuc && sonuc.length ? (
            <ul role="listbox" aria-label="Arama sonuçları">
              {sonuc.map((s) => (
                <li key={s.anahtar}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--bg-elevated)] flex items-center gap-2"
                    onClick={() => {
                      onSec(s.anahtar);
                      setQ('');
                      setSonuc(null);
                    }}
                  >
                    <span
                      className="text-[10px] uppercase tracking-wide w-20 shrink-0"
                      style={MUTED}
                    >
                      {TUR_ADI[s.tur] || s.tur}
                    </span>
                    <span className="font-mono truncate" title={s.ad}>
                      {s.ad}
                    </span>
                    {s.host && s.tur !== 'sunucu' && (
                      <span className="text-[11px] ml-auto shrink-0" style={MUTED}>
                        {s.host}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-3 py-2 text-sm" style={MUTED}>
              Eşleşen varlık yok.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Notlar ────────────────────────────────────────────────────────────────────────────────────
function NotFormu({
  konu,
  kodlar,
  siniflar,
  duzenlenen,
  onBitti,
  onVazgec,
}: {
  konu: string;
  kodlar: { kod: string; baslik: string }[];
  siniflar: ShSinif[];
  duzenlenen: ShNot | null;
  onBitti: () => void;
  onVazgec: () => void;
}) {
  const [sinif, setSinif] = useState(
    duzenlenen ? duzenlenen.sinif : siniflar[0] ? siniflar[0].ad : 'BILINEN',
  );
  const [kod, setKod] = useState(duzenlenen ? duzenlenen.supheli_kod || '' : '');
  const [etiket, setEtiket] = useState(duzenlenen ? duzenlenen.etiketler.join(', ') : '');
  const [metin, setMetin] = useState(duzenlenen ? duzenlenen.metin : '');
  const [yayilim, setYayilim] = useState<ShNotGovde['yayilim']>(
    duzenlenen ? duzenlenen.yayilim : 'YALNIZ',
  );
  const [mesgul, setMesgul] = useState(false);
  const [hata, setHata] = useState('');
  const kaydet = async () => {
    setMesgul(true);
    setHata('');
    const g: ShNotGovde = {
      konu,
      sinif,
      supheli_kod: kod || null,
      etiketler: etiket
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      metin,
      yayilim,
    };
    try {
      if (duzenlenen)
        await serverHubApi.notGuncelle(duzenlenen.id, { ...g, surum: duzenlenen.surum });
      else await serverHubApi.notEkle(g);
      toast.success(duzenlenen ? 'Not güncellendi.' : 'Not eklendi.');
      onBitti();
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setMesgul(false);
    }
  };
  const alan = 'w-full px-2 py-1 text-xs border rounded-lg';
  const alanStil: React.CSSProperties = {
    borderColor: 'var(--border)',
    background: 'var(--bg-surface)',
  };
  return (
    <div
      className="space-y-2 rounded-lg border p-2"
      style={{ borderColor: 'var(--border-subtle)' }}
      data-testid="not-formu"
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-[11px]">
          Sınıf
          <select
            aria-label="Not sınıfı"
            value={sinif}
            onChange={(e) => setSinif(e.target.value)}
            className={alan}
            style={alanStil}
          >
            {siniflar.map((s) => (
              <option key={s.ad} value={s.ad}>
                {s.baslik}
                {s.etki === 'BILINEN' ? ' (Bilinen bölümüne taşır)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px]">
          Hangi şüphe için
          <select
            aria-label="Şüphe"
            value={kod}
            onChange={(e) => setKod(e.target.value)}
            className={alan}
            style={alanStil}
          >
            <option value="">Varlığın tamamı</option>
            {kodlar.map((k) => (
              <option key={k.kod} value={k.kod}>
                {k.baslik}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px]">
          Nereye uygulanır
          <select
            aria-label="Yayılım"
            value={yayilim}
            onChange={(e) => setYayilim(e.target.value as ShNotGovde['yayilim'])}
            className={alan}
            style={alanStil}
          >
            <option value="YALNIZ">Yalnız bu</option>
            <option value="ASAGI">Bu ve altındakiler (kopya, vhost, IP)</option>
            <option value="ZINCIR">Bütün zincir</option>
          </select>
        </label>
      </div>
      <label className="block text-[11px]">
        Etiketler (virgülle)
        <input
          aria-label="Etiketler"
          value={etiket}
          onChange={(e) => setEtiket(e.target.value)}
          className={alan}
          style={alanStil}
          placeholder="ör. SCC-1234, geçiş"
        />
      </label>
      <label className="block text-[11px]">
        Not
        <textarea
          aria-label="Not metni"
          value={metin}
          onChange={(e) => setMetin(e.target.value)}
          rows={3}
          className={alan}
          style={alanStil}
          placeholder="Neye bakıldı, kim onayladı, ne yapılacak?"
        />
      </label>
      {hata && <LoadError compact title="Not kaydedilemedi" message={hata} />}
      <div className="flex gap-2">
        <button
          type="button"
          className={BTN}
          style={btnStil(true)}
          disabled={mesgul || metin.trim().length < 3}
          onClick={() => void kaydet()}
        >
          {duzenlenen ? 'Güncelle' : 'Kaydet'}
        </button>
        <button type="button" className={BTN} style={btnStil()} onClick={onVazgec}>
          İptal
        </button>
      </div>
    </div>
  );
}

function NotPaneli({
  konu,
  notlar,
  maddeler,
  siniflar,
  onDegisti,
}: {
  konu: string;
  notlar: ShNot[];
  maddeler: ShMadde[];
  siniflar: ShSinif[];
  onDegisti: () => void;
}) {
  const [form, setForm] = useState<ShNot | 'yeni' | null>(null);
  const kodlar = useMemo(
    () => [...new Map(maddeler.map((m) => [m.kod, { kod: m.kod, baslik: m.baslik }])).values()],
    [maddeler],
  );
  const arsivle = async (n: ShNot) => {
    try {
      await serverHubApi.notArsivle(n.id);
      toast.success('Not arşivlendi (geri alınabilir).');
      onDegisti();
    } catch (e) {
      toast.error(hataMetni(e));
    }
  };
  return (
    <div className="space-y-2">
      {notlar.length === 0 && (
        <div className="text-xs" style={MUTED}>
          Bu varlıkta not yok.
        </div>
      )}
      {notlar.map((n) => (
        <div
          key={n.id}
          className="rounded-lg border px-2 py-1.5 text-xs space-y-1"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <SinifRozeti ad={n.sinif} siniflar={siniflar} />
            {n.supheli_kod && (
              <span className="font-mono text-[10px]" style={MUTED}>
                {n.supheli_kod}
              </span>
            )}
            {n.etiketler.map((e) => (
              <span
                key={e}
                className="rounded px-1 text-[10px] border"
                style={{ borderColor: 'var(--border)' }}
              >
                {e}
              </span>
            ))}
            {n.veriDegisti && (
              <Rozet
                metin="veri değişti, tekrar bakın"
                ton="uyari"
                title="Not yazıldığından beri kanıt değişti; not silinmedi."
              />
            )}
            {n.dogrudan === false && n.yol && (
              <span className="text-[10px]" style={MUTED} title={n.yol.join(' → ')}>
                buradan geldi: {n.konu}
              </span>
            )}
            <span className="ml-auto text-[10px]" style={MUTED}>
              {n.guncelleyen || n.olusturan || ''}
            </span>
          </div>
          <div className="whitespace-pre-wrap">{n.metin}</div>
          {n.dogrudan !== false && (
            <div className="flex gap-2">
              <button type="button" className={BTN} style={btnStil()} onClick={() => setForm(n)}>
                Düzenle
              </button>
              <button
                type="button"
                className={BTN}
                style={btnStil()}
                onClick={() => void arsivle(n)}
              >
                Arşivle
              </button>
            </div>
          )}
        </div>
      ))}
      {form ? (
        <NotFormu
          key={form === 'yeni' ? 'yeni' : form.id}
          konu={konu}
          kodlar={kodlar}
          siniflar={siniflar}
          duzenlenen={form === 'yeni' ? null : form}
          onBitti={() => {
            setForm(null);
            onDegisti();
          }}
          onVazgec={() => setForm(null)}
        />
      ) : (
        <button type="button" className={BTN} style={btnStil()} onClick={() => setForm('yeni')}>
          Not ekle
        </button>
      )}
    </div>
  );
}

// ── Ayrıntı ───────────────────────────────────────────────────────────────────────────────────
function Bolum({
  baslik,
  acik = false,
  children,
}: {
  baslik: string;
  acik?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={acik}
      className="rounded-lg border"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold">
        {baslik}
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-2">{children}</div>
    </details>
  );
}

function MaddeListesi({ maddeler }: { maddeler: ShMadde[] }) {
  const acik = maddeler.filter((m) => !m.bilinen);
  const bilinen = maddeler.filter((m) => m.bilinen);
  return (
    <div className="space-y-2">
      {(['ENGELLER', 'EKSIK', 'DESTEKLER', 'NOTR'] as const).map((etki) => {
        const l = acik.filter((m) => m.etki === etki);
        if (!l.length) return null;
        return (
          <div key={etki}>
            <div className="text-[11px] font-semibold" style={MUTED}>
              {ETKI_BASLIK[etki]}
            </div>
            <ul className="space-y-1 mt-0.5">
              {l.map((m, i) => (
                <li key={`${m.kod}-${i}`} className="text-xs">
                  <span className="font-medium">{m.baslik}</span>
                  {m.metin && m.metin !== m.baslik && <span style={MUTED}> — {m.metin}</span>}
                  <div className="text-[11px]" style={MUTED}>
                    Nasıl doğrularsınız: {m.elle}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {bilinen.length > 0 && (
        <div data-testid="bilinen-maddeler">
          <div className="text-[11px] font-semibold" style={MUTED}>
            Bilinen (Admin notu; sayılmaz)
          </div>
          <ul className="space-y-1 mt-0.5">
            {bilinen.map((m, i) => (
              <li key={`${m.kod}-b${i}`} className="text-xs" style={MUTED}>
                {m.baslik} — not: {m.bilinen ? m.bilinen.metin : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Zincir({ kopya }: { kopya: ShKopyaKarar }) {
  const [v, setV] = useState<ShVarlik | null>(null);
  const [hata, setHata] = useState('');
  useAsyncEffect(
    async (alive) => {
      try {
        const r = await serverHubApi.iliskiVarlik(kopya.anahtar);
        if (alive()) setV(r);
      } catch (e) {
        if (alive()) setHata(hataMetni(e));
      }
    },
    [kopya.anahtar],
  );
  if (hata) return <LoadError compact title="Zincir okunamadı" message={hata} />;
  if (!v)
    return (
      <div className="text-xs" style={MUTED}>
        yükleniyor…
      </div>
    );
  const gelen = v.kenarlar.filter(
    (e) => e.yon === 'giris' && (e.tur === 'yonlendirir' || e.tur === 'cagirir'),
  );
  if (!gelen.length)
    return (
      <div className="text-xs" style={MUTED}>
        Bu kopyaya giden web ya da bağlantı kaydı yok (ölçülmedi olabilir; "eksik" listesine bakın).
      </div>
    );
  return (
    <ul className="space-y-1">
      {gelen.map((e, i) => (
        <li key={i} className="text-xs">
          <span className="font-mono">{e.karsi ? e.karsi.ad : '?'}</span>{' '}
          {e.tur === 'cagirir' ? '⇢ doğrudan bağlantı' : '→'}{' '}
          <span className="font-mono">{kopya.ad}</span>{' '}
          {e.guven && (
            <Rozet
              metin={e.guven}
              ton={e.guven === 'KESIN' ? 'iyi' : e.guven === 'GUCLU' ? 'uyari' : 'notr'}
            />
          )}{' '}
          {e.durum && (
            <Rozet
              metin={
                e.durum === 'DOGRULANDI'
                  ? 'doğrulandı'
                  : e.durum === 'CELISKI'
                    ? 'çelişki'
                    : 'tek kaynak'
              }
              ton={e.durum === 'DOGRULANDI' ? 'iyi' : e.durum === 'CELISKI' ? 'kotu' : 'notr'}
            />
          )}
          <div className="text-[11px]" style={MUTED}>
            {e.celiski || e.yontemler.map((y) => y.kanit).join(' · ')}
          </div>
        </li>
      ))}
    </ul>
  );
}

function AyrintiModal({
  veri,
  onKapat,
  onDegisti,
}: {
  veri: ShKararAyrinti;
  onKapat: () => void;
  onDegisti: () => void;
}) {
  const kopyalar = veri.kopyalar || (veri.kopya ? [veri.kopya] : []);
  const tumMaddeler = kopyalar.flatMap((k) => k.maddeler);
  const baslik = veri.uygulama
    ? veri.uygulama.ad
    : veri.kopya
      ? `${veri.kopya.ad} · ${veri.kopya.host}`
      : veri.sunucu
        ? veri.sunucu.ad
        : '';
  const konu = veri.uygulama
    ? veri.uygulama.anahtar
    : veri.kopya
      ? veri.kopya.anahtar
      : veri.sunucu
        ? veri.sunucu.anahtar
        : '';
  const notlar =
    (veri.uygulama && veri.uygulama.notlar) ||
    (veri.kopya && veri.kopya.notlar) ||
    veri.notlar ||
    [];
  return (
    <Modal
      open
      onClose={onKapat}
      title={`Ayrıntı: ${baslik}`}
      subtitle="Neden bu karar, kopyalar, doğrulama, zincir ve notlar"
      size="xl"
    >
      <div className="space-y-2" data-testid="ayrinti-modal">
        <Bolum baslik="Neden bu karar" acik>
          <MaddeListesi maddeler={tumMaddeler} />
        </Bolum>
        {kopyalar.length > 0 && (
          <Bolum baslik={`Kopyalar (${kopyalar.length})`}>
            {kopyalar.map((k) => (
              <details
                key={k.anahtar}
                className="rounded border px-2 py-1"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <summary className="cursor-pointer text-xs flex items-center gap-2">
                  <span className="font-mono">{k.ad}</span>
                  <span style={MUTED}>
                    {k.host}
                    {k.env ? ` · ${k.env}` : ''}
                  </span>
                  <Rozet metin={KARAR_KISA[k.karar]} ton={KARAR_TON[k.karar]} />
                </summary>
                <div className="pt-1">
                  <MaddeListesi maddeler={k.maddeler} />
                </div>
              </details>
            ))}
          </Bolum>
        )}
        <Bolum baslik="Doğrulama ve eksikler">
          {kopyalar.every((k) => !k.celiskiler.length && !k.eksikler.length) ? (
            <div className="text-xs" style={MUTED}>
              Çelişki ya da eksik veri yok.
            </div>
          ) : (
            <ul className="space-y-1 text-xs">
              {kopyalar.flatMap((k) =>
                k.celiskiler.map((c, i) => (
                  <li key={`${k.anahtar}-c${i}`}>
                    <Rozet metin="çelişki" ton="kotu" /> {k.ad}: {c.kod} — {c.metin}
                  </li>
                )),
              )}
              {kopyalar.flatMap((k) =>
                k.eksikler.map((x, i) => (
                  <li key={`${k.anahtar}-e${i}`}>
                    <Rozet metin="eksik" ton="uyari" /> {k.ad}: {x.ne} — {x.nasil}
                  </li>
                )),
              )}
            </ul>
          )}
        </Bolum>
        {kopyalar.length > 0 && (
          <Bolum baslik="Zincir (web → uygulama kanıtı)">
            {kopyalar.map((k) => (
              <div key={k.anahtar}>
                <div className="text-[11px] font-semibold" style={MUTED}>
                  {k.ad} · {k.host}
                </div>
                <Zincir kopya={k} />
              </div>
            ))}
          </Bolum>
        )}
        {konu && (
          <Bolum baslik={`Notlar ve etiketler (${notlar.length})`}>
            <NotPaneli
              konu={konu}
              notlar={notlar}
              maddeler={tumMaddeler}
              siniflar={veri.siniflar}
              onDegisti={onDegisti}
            />
          </Bolum>
        )}
      </div>
    </Modal>
  );
}

// ── Kart ──────────────────────────────────────────────────────────────────────────────────────
function KararKarti({
  anahtar,
  onSec,
  onKapat,
  onRetirementAc,
  onListeDegisti,
}: {
  anahtar: string;
  onSec: (a: string) => void;
  onKapat: () => void;
  onRetirementAc?: (uygulama: string, not: string) => void;
  onListeDegisti: () => void;
}) {
  const [veri, setVeri] = useState<ShKararAyrinti | null>(null);
  const [hata, setHata] = useState('');
  const [modal, setModal] = useState(false);
  const [surum, setSurum] = useState(0);
  const [varlik, setVarlik] = useState<ShVarlik | null>(null);
  const kararli = /^(app|sunucu|jvm|was):/.test(anahtar);
  useAsyncEffect(
    async (alive) => {
      try {
        if (kararli) {
          const r = await serverHubApi.iliskiKarar(anahtar);
          if (alive()) (setVeri(r), setVarlik(null), setHata(''));
        } else {
          const r = await serverHubApi.iliskiVarlik(anahtar);
          if (alive()) (setVarlik(r), setVeri(null), setHata(''));
        }
      } catch (e) {
        if (alive()) setHata(hataMetni(e));
      }
    },
    [anahtar, surum, kararli],
  );
  const degisti = useCallback(() => {
    setSurum((n) => n + 1);
    onListeDegisti();
  }, [onListeDegisti]);
  const kapat = (
    <button type="button" className={BTN} style={btnStil()} onClick={onKapat}>
      Kapat
    </button>
  );
  if (hata)
    return (
      <LoadError title="Varlık okunamadı" message={hata} onRetry={() => setSurum((n) => n + 1)} />
    );
  if (varlik) {
    // vhost / DNS / IP / web: karar kopya ve uygulamada; bağlı varlıklara geçiş.
    const bagli = varlik.kenarlar
      .map((e) => e.karsi)
      .filter((k): k is NonNullable<typeof k> => !!k && /^(app|sunucu|jvm|was|vhost)$/.test(k.tur));
    return (
      <div
        className="rounded-xl border p-4 space-y-2"
        style={{ borderColor: 'var(--border)' }}
        data-testid="varlik-karti"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase" style={MUTED}>
            {TUR_ADI[varlik.dugum.tur] || varlik.dugum.tur}
          </span>
          <span className="font-mono font-semibold">{varlik.dugum.ad}</span>
          <span className="ml-auto">{kapat}</span>
        </div>
        <div className="text-sm">
          Retirement kararı uygulama ve kopya düzeyinde verilir. Bağlı varlıklar:
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[...new Map(bagli.map((k) => [k.anahtar, k])).values()].map((k) => (
            <button
              key={k.anahtar}
              type="button"
              className={BTN}
              style={btnStil()}
              onClick={() => onSec(k.anahtar)}
            >
              {TUR_ADI[k.tur] || k.tur}: {k.ad}
            </button>
          ))}
          {!bagli.length && (
            <span className="text-xs" style={MUTED}>
              Bağlı uygulama ya da sunucu bulunamadı.
            </span>
          )}
        </div>
      </div>
    );
  }
  if (!veri) return <LoadingLogo />;
  const kopyalar = veri.kopyalar || (veri.kopya ? [veri.kopya] : []);
  const karar: ShKarar | null = veri.uygulama
    ? veri.uygulama.karar
    : veri.kopya
      ? veri.kopya.karar
      : null;
  const kararMetni = veri.uygulama
    ? veri.uygulama.kararMetni
    : veri.kopya
      ? veri.kopya.kararMetni
      : null;
  const ana = anaSupheOf(kopyalar.flatMap((k) => k.maddeler));
  const yap = veri.uygulama ? veri.uygulama.yapilabilecekler : [];
  const notlar =
    (veri.uygulama && veri.uygulama.notlar) ||
    (veri.kopya && veri.kopya.notlar) ||
    veri.notlar ||
    [];
  const ad = veri.uygulama
    ? veri.uygulama.ad
    : veri.kopya
      ? veri.kopya.ad
      : veri.sunucu
        ? veri.sunucu.ad
        : anahtar;
  const bilinen =
    (veri.uygulama && veri.uygulama.bilinen) || (veri.kopya && veri.kopya.bilinen) || null;
  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ borderColor: 'var(--border)' }}
      data-testid="karar-karti"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase" style={MUTED}>
          {veri.tur === 'app' ? 'uygulama' : veri.tur === 'sunucu' ? 'sunucu' : 'kopya'}
        </span>
        <span className="font-mono text-lg font-semibold">{ad}</span>
        {[...new Set(notlar.map((n) => n.sinif))].map((s) => (
          <SinifRozeti key={s} ad={s} siniflar={veri.siniflar} />
        ))}
        <span className="ml-auto flex gap-2">
          {veri.tur !== 'sunucu' && (
            <button
              type="button"
              className={BTN}
              style={btnStil(true)}
              onClick={() => setModal(true)}
            >
              Ayrıntı
            </button>
          )}
          {kapat}
        </span>
      </div>
      {veri.notOkunamadi && (
        <LoadError
          compact
          title="Notlar okunamadı"
          message="Karar notsuz gösteriliyor; Bilinen işaretleri eksik olabilir."
        />
      )}
      {karar && (
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="rounded-lg px-3 py-1.5 text-base font-semibold"
            style={{ ...TON_STIL[KARAR_TON[karar]] }}
            data-testid="karar-cumlesi"
          >
            {kararMetni}
          </span>
          {veri.uygulama && (
            <span className="text-sm" style={MUTED}>
              {veri.uygulama.ozet}
            </span>
          )}
          {bilinen && <Rozet metin={`Bilinen: ${bilinen.metin}`} ton="notr" />}
        </div>
      )}
      {ana && (
        <div className="text-sm" data-testid="ana-suphe">
          <span className="font-medium">
            {ana.etki === 'ENGELLER'
              ? 'Neden retire edilmez: '
              : ana.etki === 'DESTEKLER'
                ? 'Şüphe: '
                : 'Eksik: '}
          </span>
          {ana.metin || ana.baslik}
        </div>
      )}
      {yap.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold" style={MUTED}>
            Yapılabilecekler
          </div>
          <ol className="list-decimal ml-5 text-sm space-y-0.5" data-testid="yapilabilecekler">
            {yap.map((y, i) => (
              <li key={i}>
                {/* FAZ 0 (2026-11-11): dogrulamasiz "Retirement kaydi ac" dugmesi kaldirildi; yalniz metin. */}
                {y.metin}
              </li>
            ))}
          </ol>
        </div>
      )}
      {veri.tur === 'sunucu' && (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold" style={MUTED}>
            Bu sunucudaki kopyalar
          </div>
          {kopyalar.length === 0 && (
            <div className="text-xs" style={MUTED}>
              JVM / WebSphere kopyası yok.
            </div>
          )}
          {kopyalar.map((k) => (
            <button
              key={k.anahtar}
              type="button"
              className="flex items-center gap-2 text-xs w-full text-left hover:underline"
              onClick={() => onSec(k.anahtar)}
            >
              <span className="font-mono">{k.ad}</span>
              <Rozet metin={KARAR_KISA[k.karar]} ton={KARAR_TON[k.karar]} />
              <span style={MUTED}>{anaSupheOf(k.maddeler)?.baslik || ''}</span>
            </button>
          ))}
          {(veri.web || []).map((w) => (
            <div key={w.anahtar} className="text-xs" style={MUTED}>
              {w.ad}: {w.vhost} vhost
            </div>
          ))}
        </div>
      )}
      {veri.tur === 'kopya' && veri.kopya && (veri.kopya.uygulamalar || []).length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {(veri.kopya.uygulamalar || []).map((a) => (
            <button
              key={a}
              type="button"
              className={BTN}
              style={btnStil()}
              onClick={() => onSec(a)}
            >
              Uygulamaya git: {a.replace(/^app:/, '')}
            </button>
          ))}
        </div>
      )}
      {modal && <AyrintiModal veri={veri} onKapat={() => setModal(false)} onDegisti={degisti} />}
    </div>
  );
}

const TON_STIL: Record<DurumTon, React.CSSProperties> = {
  iyi: {
    background: 'var(--status-success-bg)',
    color: 'color-mix(in srgb, var(--status-success) 55%, var(--text-primary))',
  },
  uyari: { background: 'var(--status-warning-bg)', color: 'var(--status-warning-text)' },
  kotu: { background: 'var(--status-danger-bg)', color: 'var(--status-danger-text)' },
  notr: { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' },
};

// ── Liste ─────────────────────────────────────────────────────────────────────────────────────
function kolonlar(siniflar: ShSinif[]): EarKolon<ShKararOzet>[] {
  return [
    {
      anahtar: 'ad',
      baslik: 'Uygulama',
      aciklama: 'Taban uygulama adı (ortam ekleri -D / -T / -Q aynı uygulamadır).',
      suzgec: 'metin',
      sirala: true,
      deger: (u) => u.ad,
      hucre: (u) => <span className="font-mono font-semibold">{u.ad}</span>,
    },
    {
      anahtar: 'karar',
      baslik: 'Karar',
      aciklama: 'Karar motorunun sonucu; insan kararının yerini almaz.',
      suzgec: 'secim',
      secenekler: KARAR_SIRA.map((k) => ({ deger: k, etiket: KARAR_KISA[k] })),
      sirala: true,
      deger: (u) => u.karar,
      hucre: (u) => (
        <Rozet metin={KARAR_KISA[u.karar]} ton={KARAR_TON[u.karar]} title={u.kararMetni} />
      ),
    },
    {
      anahtar: 'ozet',
      baslik: 'Özet',
      aciklama: 'Kopyaların kararları.',
      suzgec: 'metin',
      deger: (u) => u.ozet,
      hucre: (u) => <span className="text-xs">{u.ozet}</span>,
    },
    {
      anahtar: 'not',
      baslik: 'Notlar',
      aciklama: 'Admin notlarının sınıfları; "veri değişti": not yazıldıktan sonra kanıt değişti.',
      suzgec: 'secim',
      deger: (u) => u.siniflar,
      hucre: (u) => (
        <span className="flex flex-wrap gap-1">
          {u.siniflar.map((s) => (
            <SinifRozeti key={s} ad={s} siniflar={siniflar} />
          ))}
          {u.veriDegisti && <Rozet metin="veri değişti" ton="uyari" />}
        </span>
      ),
    },
  ];
}

export default function RetirementAnaliziTab({
  onRetirementAc,
  baslangic,
}: {
  onRetirementAc?: (uygulama: string, not: string) => void;
  /** Başka sekmeden "Analizde aç": her yeni `no` o kaydı seçer (sekme gizli kalsa da). */
  baslangic?: { anahtar: string; no: number } | null;
}) {
  const [liste, setListe] = useState<ShKararlarSonuc | null>(null);
  const [hata, setHata] = useState('');
  const [yukleniyor, setYukleniyor] = useState(false);
  const [secili, setSecili] = useState<string | null>(baslangic ? baslangic.anahtar : null);
  // Render sırasında ayar (effect yok): yalnız yeni bir istek seçimi değiştirir.
  const [sonNo, setSonNo] = useState(baslangic ? baslangic.no : 0);
  if (baslangic && baslangic.no !== sonNo) {
    setSonNo(baslangic.no);
    setSecili(baslangic.anahtar);
  }
  const [kararSuzgec, setKararSuzgec] = useState<ShKarar | null>(null);
  // Not / sinif yonetimi penceresi; yazim olduysa kararlar ve acik kart tazelenir.
  const [yonetim, setYonetim] = useState<NotSuzgeci | 'SINIFLAR' | null>(null);
  const [kartNo, setKartNo] = useState(0);
  const yukle = useCallback(async (fresh = false) => {
    setYukleniyor(true);
    try {
      const r = await serverHubApi.iliskiKararlar(fresh);
      setListe(r);
      setHata('');
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setYukleniyor(false);
    }
  }, []);
  useAsyncEffect(async (alive) => {
    try {
      const r = await serverHubApi.iliskiKararlar(false);
      if (alive()) (setListe(r), setHata(''));
    } catch (e) {
      if (alive()) setHata(hataMetni(e));
    }
  }, []);
  const ana = useMemo(
    () =>
      liste
        ? liste.uygulamalar.filter((u) => !u.bilinen && (!kararSuzgec || u.karar === kararSuzgec))
        : [],
    [liste, kararSuzgec],
  );
  const bilinen = useMemo(() => (liste ? liste.uygulamalar.filter((u) => u.bilinen) : []), [liste]);
  const kol = useMemo(() => kolonlar(liste ? liste.siniflar : []), [liste]);
  const listeDegisti = useCallback(() => void yukle(false), [yukle]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Arama onSec={setSecili} />
        <button
          type="button"
          className={`${BTN} ml-auto`}
          style={btnStil()}
          onClick={() => void yukle(true)}
          disabled={yukleniyor}
        >
          <ArrowPathIcon className={`w-3.5 h-3.5 ${yukleniyor ? 'animate-spin' : ''}`} /> Yenile
        </button>
        <button type="button" className={BTN} style={btnStil()} onClick={() => setYonetim('AKTIF')}>
          Notlar ve sınıflar
        </button>
      </div>
      {yonetim && (
        <NotYonetimi
          baslangic={yonetim}
          onKapat={(degisti) => {
            setYonetim(null);
            if (degisti) {
              void yukle(false);
              setKartNo((n) => n + 1);
            }
          }}
          onAc={setSecili}
        />
      )}
      {secili && (
        <KararKarti
          key={`${secili}-${kartNo}`}
          anahtar={secili}
          onSec={setSecili}
          onKapat={() => setSecili(null)}
          onRetirementAc={onRetirementAc}
          onListeDegisti={listeDegisti}
        />
      )}
      {hata ? (
        <LoadError
          title="Retirement kararları okunamadı"
          message={hata}
          onRetry={() => void yukle(true)}
          retrying={yukleniyor}
        />
      ) : !liste ? (
        <LoadingLogo />
      ) : (
        <>
          {liste.notOkunamadi && (
            <LoadError
              compact
              title="Admin notları okunamadı"
              message="Kararlar notsuz gösteriliyor; Bilinen bölümü eksik olabilir."
            />
          )}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Karara göre süz">
            {KARAR_SIRA.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kararSuzgec === k}
                className="rounded-lg border px-3 py-1.5 text-sm text-left"
                style={{
                  borderColor: kararSuzgec === k ? 'var(--accent)' : 'var(--border)',
                  background: 'var(--bg-surface)',
                }}
                onClick={() => setKararSuzgec((s) => (s === k ? null : k))}
              >
                <div className="text-lg font-semibold tabular-nums">{liste.sayilar[k]}</div>
                <Rozet metin={KARAR_KISA[k]} ton={KARAR_TON[k]} />
              </button>
            ))}
            {liste.bilinenSayisi > 0 && (
              <div
                className="rounded-lg border px-3 py-1.5 text-sm"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <div className="text-lg font-semibold tabular-nums" style={MUTED}>
                  {liste.bilinenSayisi}
                </div>
                <span className="text-xs" style={MUTED}>
                  Bilinen (sayılmaz)
                </span>
              </div>
            )}
          </div>
          <EarTablo<ShKararOzet>
            kimlik="retirement-analizi"
            kolonlar={kol}
            satirlar={ana}
            satirAnahtari={(u) => u.anahtar}
            onSatir={(u) => setSecili(u.anahtar)}
            yerelCsv="retirement-analizi"
            araEtiketi="uygulama ya da özet ara"
            bosMetin={
              liste.uygulamalar.length
                ? 'Süzgeçle eşleşen uygulama yok.'
                : 'Grafikte uygulama yok (Server Hub taraması gerekli).'
            }
          />
          {bilinen.length > 0 && (
            <details
              className="rounded-lg border"
              style={{ borderColor: 'var(--border-subtle)' }}
              data-testid="bilinen-bolumu"
            >
              <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
                Bilinen ({bilinen.length}) — Admin “bilinen / olması gereken” dedi; ana sayımda yok
              </summary>
              <ul className="px-3 pb-3 space-y-1">
                {bilinen.map((u) => (
                  <li key={u.anahtar} className="text-xs flex items-center gap-2">
                    <button
                      type="button"
                      className="font-mono underline"
                      onClick={() => setSecili(u.anahtar)}
                    >
                      {u.ad}
                    </button>
                    <Rozet metin={KARAR_KISA[u.karar]} ton="notr" />
                    <span style={MUTED}>{u.bilinen ? u.bilinen.metin : ''}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {liste.yetimNotSayisi > 0 && (
            <div className="text-xs" style={MUTED}>
              Konusu artık bulunamayan {liste.yetimNotSayisi} not var (silinmedi).{' '}
              <button
                type="button"
                className="underline"
                style={{ color: 'var(--accent)' }}
                onClick={() => setYonetim('YETIM')}
              >
                Göster
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
