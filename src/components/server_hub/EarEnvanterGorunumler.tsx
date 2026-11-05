// src/components/server_hub/EarEnvanterGorunumler.tsx — Uygulama Envanteri listeleri (2026-11-04).
//
// Uygulamalar · Eşlenikler · Kütüphaneler · Sunucular · Koşular. Hepsi "son durum"u okur: her sunucunun
// veri taşıyan EN SON taraması (bir hafta düşen sunucunun önceki verisi görünür, yaşıyla birlikte).
// Okunamadı ile kayıt yok ayrıdır (LoadError / TableEmptyRow).
import React, { useState } from 'react';
import {
  MagnifyingGlassIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import {
  earApi,
  earIndir,
  type EarUygulama,
  type EarEslenik,
  type EarIkiNesil,
  type EarEslenikFarki,
  type EarFarkSatiri,
  type EarOrtamYok,
  type EarKutuphaneSatiri,
  type EarKullanan,
  type EarHost,
  type EarKosu,
  type EarParti,
} from '@/api/earEnvanterApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtNumber, fmtDateTime } from '@/utils/datetime';
import { TableEmptyRow } from '@/components/common/EmptyState';
import LoadError from '@/components/common/LoadError';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import {
  uygulamaDurumu,
  hostDurumu,
  kosuDurumu,
  kararDurumu,
  partiDurumu,
  veriYasiGun,
  boyutMetni,
  kaynakEtiketi,
} from './earEnvanter';
import {
  Rozet,
  Kirp,
  IndirBag,
  BTN,
  btnStil,
  GIRDI,
  girdiStil,
  TABLO,
  TH,
  TD,
  thStil,
} from './EarEnvanterUi';

export type DetayAc = (kosu: number, host: string, uyg: number) => void;
const say = (n: number | null | undefined) => (n == null ? '—' : fmtNumber(n));
const SAYFA = 100;

function Yukleniyor() {
  return (
    <div className="py-10 flex justify-center">
      <LoadingLogo />
    </div>
  );
}

// ── UYGULAMALAR ─────────────────────────────────────────────────────────────────────────────────
export function UygulamalarGorunum({ onAc }: { onAc: DetayAc }) {
  const [taslak, setTaslak] = useState({ q: '', ortam: '' });
  const [s, setS] = useState({ q: '', ortam: '', jboss: '', durum: '', servlet: '', offset: 0 });
  const [veri, setVeri] = useState<{ satirlar: EarUygulama[]; toplam: number } | null>(null);
  const [hata, setHata] = useState('');
  const [tazele, setTazele] = useState(0);
  useAsyncEffect(
    async (alive) => {
      setHata('');
      try {
        const r = await earApi.uygulamalar({ ...s, limit: SAYFA });
        if (alive()) setVeri({ satirlar: r.satirlar, toplam: r.toplam });
      } catch (e) {
        if (alive()) setHata(e instanceof Error ? e.message : String(e));
      }
    },
    [s, tazele],
  );
  const ara = (e: React.FormEvent) => {
    e.preventDefault();
    setS((x) => ({ ...x, ...taslak, offset: 0 }));
  };
  const sec = (k: 'jboss' | 'durum' | 'servlet') => (e: React.ChangeEvent<HTMLSelectElement>) =>
    setS((x) => ({ ...x, [k]: e.target.value, offset: 0 }));
  return (
    <div className="space-y-2">
      <form onSubmit={ara} className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Uygulama ya da sunucu ara"
          placeholder="uygulama / sunucu"
          className={`${GIRDI} w-56`}
          style={girdiStil}
          value={taslak.q}
          onChange={(e) => setTaslak({ ...taslak, q: e.target.value })}
        />
        <input
          aria-label="Ortam"
          placeholder="ortam"
          className={`${GIRDI} w-28`}
          style={girdiStil}
          value={taslak.ortam}
          onChange={(e) => setTaslak({ ...taslak, ortam: e.target.value })}
        />
        <button type="submit" className={BTN} style={btnStil()}>
          <MagnifyingGlassIcon className="w-3.5 h-3.5" aria-hidden /> Ara
        </button>
        <select
          aria-label="JBoss nesli"
          className={GIRDI}
          style={girdiStil}
          value={s.jboss}
          onChange={sec('jboss')}
        >
          <option value="">JBoss: hepsi</option>
          <option value="7">JBoss 7 (/vhosting)</option>
          <option value="8">JBoss 8 (/vhosting8)</option>
        </select>
        <select
          aria-label="Durum"
          className={GIRDI}
          style={girdiStil}
          value={s.durum}
          onChange={sec('durum')}
        >
          <option value="">Durum: hepsi</option>
          <option value="TAM">yalnız tam</option>
          <option value="EKSIK">eksik taranan</option>
        </select>
        <select
          aria-label="Servlet API"
          className={GIRDI}
          style={girdiStil}
          value={s.servlet}
          onChange={sec('servlet')}
        >
          <option value="">Servlet: hepsi</option>
          <option value="jakarta">jakarta</option>
          <option value="javax">javax</option>
          <option value="karisik">karışık</option>
        </select>
        <span className="ml-auto flex gap-1">
          <IndirBag href={earIndir.csv('uygulamalar')}>Uygulamalar CSV</IndirBag>
          <IndirBag href={earIndir.csv('warlar')}>WAR'lar CSV</IndirBag>
        </span>
      </form>
      {hata ? (
        <LoadError
          title="Uygulama listesi okunamadı"
          message={hata}
          onRetry={() => setTazele((n) => n + 1)}
          compact
        />
      ) : !veri ? (
        <Yukleniyor />
      ) : (
        <>
          <div
            className="overflow-x-auto rounded-lg border"
            style={{ borderColor: 'var(--border)' }}
          >
            <table className={TABLO}>
              <thead>
                <tr>
                  {[
                    'Sunucu',
                    'Ortam',
                    'JBoss',
                    'Uygulama',
                    'Durum',
                    'WAR',
                    'Spring Boot',
                    'Spring FW',
                    'Servlet',
                    'log4j',
                    'JSP',
                    'TLD',
                    'Taranma',
                  ].map((b) => (
                    <th key={b} className={TH} style={thStil}>
                      {b}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {veri.satirlar.length === 0 ? (
                  <TableEmptyRow
                    colSpan={13}
                    title="Kayıt bulunamadı."
                    description="Henüz tarama yok ya da süzgece uyan uygulama yok."
                  />
                ) : (
                  veri.satirlar.map((u) => {
                    const yas = veriYasiGun(u.taranma_utc);
                    return (
                      <tr
                        key={`${u.kosu_id}-${u.host}-${u.uyg_no}`}
                        className="cursor-pointer border-t"
                        style={{ borderColor: 'var(--border)' }}
                        onClick={() => onAc(u.kosu_id, u.host, u.uyg_no)}
                      >
                        <td className={TD}>{u.host}</td>
                        <td className={TD}>
                          <Kirp v={u.ortam} en="max-w-[7rem]" />
                        </td>
                        <td className={TD}>{u.jboss}</td>
                        <td className={TD}>
                          <button
                            type="button"
                            className="text-left underline-offset-2 hover:underline"
                            style={{ color: 'var(--accent)' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              onAc(u.kosu_id, u.host, u.uyg_no);
                            }}
                          >
                            <Kirp v={u.ad} en="max-w-[18rem]" />
                          </button>
                        </td>
                        <td className={TD}>
                          <Rozet d={uygulamaDurumu(u.durum)} kucuk />
                        </td>
                        <td className={TD}>{say(u.war_sayisi)}</td>
                        <td className={TD}>
                          <Kirp v={u.spring_boot} en="max-w-[7rem]" />
                        </td>
                        <td className={TD}>
                          <Kirp v={u.spring_framework} en="max-w-[7rem]" />
                        </td>
                        <td className={TD}>{u.servlet || '—'}</td>
                        <td className={TD}>
                          <Kirp v={u.log4j} en="max-w-[7rem]" />
                        </td>
                        <td className={TD}>{say(u.jsp)}</td>
                        <td className={TD}>{say(u.tld)}</td>
                        <td className={TD} title={u.taranma_utc ? fmtDateTime(u.taranma_utc) : ''}>
                          {yas == null ? '—' : yas === 0 ? 'bugün' : `${yas} gün önce`}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div
            className="flex items-center gap-2 text-[11px]"
            style={{ color: 'var(--text-muted)' }}
          >
            <span>
              {fmtNumber(veri.toplam)} uygulama · {s.offset + 1}–
              {Math.min(s.offset + SAYFA, veri.toplam)}
            </span>
            <button
              type="button"
              className={BTN}
              style={btnStil()}
              disabled={s.offset === 0}
              onClick={() => setS((x) => ({ ...x, offset: Math.max(0, x.offset - SAYFA) }))}
            >
              Önceki
            </button>
            <button
              type="button"
              className={BTN}
              style={btnStil()}
              disabled={s.offset + SAYFA >= veri.toplam}
              onClick={() => setS((x) => ({ ...x, offset: x.offset + SAYFA }))}
            >
              Sonraki
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── ESLENIKLER ──────────────────────────────────────────────────────────────────────────────────
const FARK_ETIKETI: Record<EarFarkSatiri['kategori'], string> = {
  WAR: 'WAR yalnız bazılarında',
  EKSIK: 'yalnız bazılarında var',
  SURUM: 'sürüm farklı',
  BOYUT: 'aynı sürüm, boyut farklı',
};

/** [[sürüm, boyut], ...] -> "6.1.0 (1.2 MB)"; null -> "yok". */
function surumMetni(v: [string, number | null][] | null, kategori: EarFarkSatiri['kategori']): string {
  if (v == null) return 'yok';
  if (kategori === 'WAR') return 'var';
  return v.map(([s, b]) => (kategori === 'BOYUT' ? `${s} (${boyutMetni(b)})` : s)).join(', ');
}

function EslenikFarki({ g }: { g: EarEslenik }) {
  const [f, setF] = useState<EarEslenikFarki | null>(null);
  const [hata, setHata] = useState('');
  useAsyncEffect(
    async (alive) => {
      try {
        const r = await earApi.eslenik(g.uygulama, g.ortam, g.jboss, { limit: 2000 });
        if (alive()) setF(r);
      } catch (e) {
        if (alive()) setHata(e instanceof Error ? e.message : String(e));
      }
    },
    [g.uygulama, g.ortam, g.jboss],
  );
  if (hata) return <LoadError title="Kütüphane farkı okunamadı" message={hata} compact />;
  if (!f) return <Yukleniyor />;
  return (
    <div className="space-y-2 py-2">
      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {f.kopyalar
          .map(
            (k) =>
              `${k.host}${k.degisken ? ` [${k.degisken}]` : ''} (${uygulamaDurumu(k.durum).etiket}, ${k.kip === 'TAM' ? 'TAM' : 'ÖZET'})`,
          )
          .join(' · ')}
      </div>
      {f.toplam === 0 ? (
        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {g.kutuphane === 'KARSILASTIRILAMADI'
            ? 'Kütüphaneler karşılaştırılmadı: kopyalardan biri tam taranmadı.'
            : 'Kütüphane listeleri birebir aynı (ad, sürüm ve dosya boyutu).'}
        </div>
      ) : (
        <>
          <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            {fmtNumber(f.toplam)} fark ·{' '}
            {(Object.keys(FARK_ETIKETI) as EarFarkSatiri['kategori'][])
              .filter((k) => f.sayilar[k])
              .map((k) => `${FARK_ETIKETI[k]}: ${f.sayilar[k]}`)
              .join(' · ')}
            {f.farklar.length < f.toplam && ` · ilk ${fmtNumber(f.farklar.length)} gösteriliyor; tamamı CSV'de`}
          </div>
          <div className="overflow-x-auto">
            <table className={TABLO}>
              <thead>
                <tr>
                  {['Fark', 'Yer', 'Kütüphane', ...f.kopyalar.map((k) => k.host)].map((b, i) => (
                    <th key={`${b}-${i}`} className={TH} style={thStil}>
                      {b}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {f.farklar.map((x) => (
                  <tr
                    key={`${x.kategori}|${x.konum}|${x.kutuphane}`}
                    className="border-t"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <td className={TD}>{FARK_ETIKETI[x.kategori]}</td>
                    <td className={TD}>
                      <Kirp v={x.konum || 'EAR lib/'} en="max-w-[12rem]" mono />
                    </td>
                    <td className={TD}>
                      <Kirp v={x.kutuphane || '—'} en="max-w-[14rem]" mono />
                    </td>
                    {f.kopyalar.map((k) => (
                      <td key={k.anahtar} className={TD}>
                        <Kirp v={surumMetni(x.degerler[k.anahtar] ?? null, x.kategori)} en="max-w-[10rem]" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export function EsleniklerGorunum() {
  const [ortam, setOrtam] = useState('');
  const [taslak, setTaslak] = useState('');
  const [tumu, setTumu] = useState(false);
  const [veri, setVeri] = useState<{
    gruplar: EarEslenik[];
    ikiNesil: EarIkiNesil[];
    ortamYok: EarOrtamYok[];
  } | null>(null);
  const [hata, setHata] = useState('');
  const [acik, setAcik] = useState<string | null>(null);
  const [tazele, setTazele] = useState(0);
  useAsyncEffect(
    async (alive) => {
      setHata('');
      try {
        const r = await earApi.eslenikler(ortam, tumu);
        if (alive()) setVeri({ gruplar: r.gruplar, ikiNesil: r.ikiNesil, ortamYok: r.ortamYok || [] });
      } catch (e) {
        if (alive()) setHata(e instanceof Error ? e.message : String(e));
      }
    },
    [ortam, tumu, tazele],
  );
  const anahtar = (g: EarEslenik) => `${g.uygulama}|${g.ortam}|${g.jboss}`;
  return (
    <div className="space-y-2">
      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Aynı uygulama, aynı ortam ve aynı JBoss neslinde birden çok sunucuda. Kütüphane ve yapı ayrı
        karşılaştırılır; kopyalardan biri bile tam taranmadıysa karşılaştırma yapılmaz. Ortamı
        envanterde boş olan sunucular karşılaştırılmaz, aşağıda ayrı listelenir.
      </p>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setOrtam(taslak);
        }}
      >
        <input
          aria-label="Ortam"
          placeholder="ortam (tam ad, ör. PROD)"
          className={`${GIRDI} w-44`}
          style={girdiStil}
          value={taslak}
          onChange={(e) => setTaslak(e.target.value)}
        />
        <button type="submit" className={BTN} style={btnStil()}>
          Süz
        </button>
        <label
          className="flex items-center gap-1 text-xs"
          style={{ color: 'var(--text-secondary)' }}
        >
          <input type="checkbox" checked={tumu} onChange={(e) => setTumu(e.target.checked)} /> tek
          kopyalıları da göster
        </label>
        <span className="ml-auto">
          <IndirBag href={earIndir.csv('eslenikler')}>Eşlenikler CSV</IndirBag>
        </span>
      </form>
      {hata ? (
        <LoadError
          title="Eşlenikler okunamadı"
          message={hata}
          onRetry={() => setTazele((n) => n + 1)}
          compact
        />
      ) : !veri ? (
        <Yukleniyor />
      ) : (
        <>
          <div
            className="overflow-x-auto rounded-lg border"
            style={{ borderColor: 'var(--border)' }}
          >
            <table className={TABLO}>
              <thead>
                <tr>
                  {[
                    '',
                    'Uygulama',
                    'Ortam',
                    'JBoss',
                    'Sonuç',
                    'Sunucular',
                    'Değişkenler',
                  ].map((b, i) => (
                    <th key={i} className={TH} style={thStil}>
                      {b}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {veri.gruplar.length === 0 ? (
                  <TableEmptyRow
                    colSpan={7}
                    title="Kayıt bulunamadı."
                    description="Birden çok sunucuda duran uygulama yok ya da henüz tarama yok."
                  />
                ) : (
                  veri.gruplar.map((g) => {
                    const k = anahtar(g);
                    const ac = acik === k;
                    return (
                      <React.Fragment key={k}>
                        <tr
                          className="border-t cursor-pointer"
                          style={{ borderColor: 'var(--border)' }}
                          onClick={() => setAcik(ac ? null : k)}
                        >
                          <td className={TD}>
                            {ac ? (
                              <ChevronDownIcon className="w-3.5 h-3.5" aria-hidden />
                            ) : (
                              <ChevronRightIcon className="w-3.5 h-3.5" aria-hidden />
                            )}
                          </td>
                          <td className={TD}>
                            <Kirp v={g.uygulama} en="max-w-[18rem]" />
                          </td>
                          <td className={TD}>{g.ortam}</td>
                          <td className={TD}>{g.jboss}</td>
                          <td className={TD}>
                            <Rozet d={kararDurumu(g.karar)} kucuk />
                            {g.tarih_farki_gun > 1 && (
                              <span
                                className="ml-1 text-[10px]"
                                style={{
                                  color:
                                    g.tarih_farki_gun > 7
                                      ? 'var(--status-warning-text)'
                                      : 'var(--text-muted)',
                                }}
                                title="Kopyalar farklı tarihlerde tarandı; karar yine verildi."
                              >
                                {g.tarih_farki_gun} gün tarama farkı
                              </span>
                            )}
                          </td>
                          <td className={TD}>
                            <Kirp
                              v={`${g.host_sayisi}: ${g.hostlar.join(', ')}`}
                              en="max-w-[18rem]"
                            />
                          </td>
                          <td className={TD}>
                            <Kirp
                              v={(g.degiskenler || [])
                                .map((x) => `${x.harf}: ${x.hostlar.join(',')}`)
                                .join(' | ')}
                              en="max-w-[22rem]"
                              mono
                            />
                          </td>
                        </tr>
                        {ac && (
                          <tr>
                            <td
                              colSpan={7}
                              className="px-3"
                              style={{ background: 'var(--bg-elevated)' }}
                            >
                              {g.eksik.length > 0 && (
                                <div
                                  className="text-[11px] pt-2"
                                  style={{ color: 'var(--status-warning-text)' }}
                                >
                                  Eksik taranan: {g.eksik.join(', ')}
                                </div>
                              )}
                              <EslenikFarki g={g} />
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
          {veri.ortamYok.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-xs font-semibold">
                Ortam bilinmiyor: karşılaştırılmadı ({veri.ortamYok.length})
              </h3>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Bu sunucuların ortamı envanterde boş. Farklı ortamlar karışmasın diye
                karşılaştırılmadı; ortam girilince kendiliğinden eşlenir.
              </p>
              <div className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                {veri.ortamYok.map((x) => (
                  <div key={`${x.uygulama}|${x.jboss}`}>
                    {x.uygulama} (JBoss {x.jboss}): {x.hostlar.join(', ')}
                  </div>
                ))}
              </div>
            </div>
          )}
          {veri.ikiNesil.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-xs font-semibold">
                Aynı sunucuda hem JBoss 7 hem JBoss 8 ({veri.ikiNesil.length})
              </h3>
              <div
                className="overflow-x-auto rounded-lg border"
                style={{ borderColor: 'var(--border)' }}
              >
                <table className={TABLO}>
                  <thead>
                    <tr>
                      {['Sunucu', 'Uygulama', 'Ortam', 'Kütüphaneler'].map((b) => (
                        <th key={b} className={TH} style={thStil}>
                          {b}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {veri.ikiNesil.map((x) => (
                      <tr
                        key={`${x.host}|${x.uygulama}`}
                        className="border-t"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        <td className={TD}>{x.host}</td>
                        <td className={TD}>
                          <Kirp v={x.uygulama} en="max-w-[18rem]" />
                        </td>
                        <td className={TD}>{x.ortam}</td>
                        <td className={TD}>
                          <Rozet kucuk d={kararDurumu(x.karar)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── KUTUPHANELER ────────────────────────────────────────────────────────────────────────────────
function Kullananlar({ ad, surum, onAc }: { ad: string; surum: string; onAc: DetayAc }) {
  const [l, setL] = useState<EarKullanan[] | null>(null);
  const [hata, setHata] = useState('');
  useAsyncEffect(
    async (alive) => {
      try {
        const r = await earApi.kutuphane(ad, surum);
        if (alive()) setL(r.kullananlar);
      } catch (e) {
        if (alive()) setHata(e instanceof Error ? e.message : String(e));
      }
    },
    [ad, surum],
  );
  if (hata) return <LoadError title="Kullanan uygulamalar okunamadı" message={hata} compact />;
  if (!l) return <Yukleniyor />;
  return (
    <ul className="py-2 text-xs space-y-0.5">
      {l.map((k) => (
        <li key={`${k.host}|${k.uyg_no}`}>
          <button
            type="button"
            className="hover:underline"
            style={{ color: 'var(--accent)' }}
            onClick={() => onAc(k.kosu_id, k.host, k.uyg_no)}
          >
            {k.host} · {k.kok}/{k.uygulama}
          </button>{' '}
          <span style={{ color: 'var(--text-muted)' }}>{k.ortam || ''}</span>
        </li>
      ))}
    </ul>
  );
}

export function KutuphanelerGorunum({ onAc }: { onAc: DetayAc }) {
  const [q, setQ] = useState('');
  const [taslak, setTaslak] = useState('');
  const [l, setL] = useState<EarKutuphaneSatiri[] | null>(null);
  const [hata, setHata] = useState('');
  const [acik, setAcik] = useState<string | null>(null);
  const [tazele, setTazele] = useState(0);
  useAsyncEffect(
    async (alive) => {
      setHata('');
      try {
        const r = await earApi.kutuphaneler(q);
        if (alive()) setL(r.kutuphaneler);
      } catch (e) {
        if (alive()) setHata(e instanceof Error ? e.message : String(e));
      }
    },
    [q, tazele],
  );
  return (
    <div className="space-y-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(taslak);
        }}
      >
        <input
          aria-label="Kütüphane ara"
          placeholder="ör. log4j, spring-core"
          className={`${GIRDI} w-56`}
          style={girdiStil}
          value={taslak}
          onChange={(e) => setTaslak(e.target.value)}
        />
        <button type="submit" className={BTN} style={btnStil()}>
          <MagnifyingGlassIcon className="w-3.5 h-3.5" aria-hidden /> Ara
        </button>
        <span className="ml-auto">
          <IndirBag href={earIndir.csv('kutuphaneler')}>Kütüphaneler CSV</IndirBag>
        </span>
      </form>
      {hata ? (
        <LoadError
          title="Kütüphaneler okunamadı"
          message={hata}
          onRetry={() => setTazele((n) => n + 1)}
          compact
        />
      ) : !l ? (
        <Yukleniyor />
      ) : (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
          <table className={TABLO}>
            <thead>
              <tr>
                {['', 'Kütüphane', 'Sürüm', 'Sunucu', 'Uygulama', 'Kopya'].map((b, i) => (
                  <th key={i} className={TH} style={thStil}>
                    {b}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {l.length === 0 ? (
                <TableEmptyRow colSpan={6} title="Kayıt bulunamadı." />
              ) : (
                l.map((k) => {
                  const a = `${k.ad}@${k.surum}`;
                  const ac = acik === a;
                  return (
                    <React.Fragment key={a}>
                      <tr
                        className="border-t cursor-pointer"
                        style={{ borderColor: 'var(--border)' }}
                        onClick={() => setAcik(ac ? null : a)}
                      >
                        <td className={TD}>
                          {ac ? (
                            <ChevronDownIcon className="w-3.5 h-3.5" aria-hidden />
                          ) : (
                            <ChevronRightIcon className="w-3.5 h-3.5" aria-hidden />
                          )}
                        </td>
                        <td className={TD}>
                          <Kirp v={k.ad} en="max-w-[20rem]" mono />
                        </td>
                        <td className={TD}>
                          <Kirp v={k.surum || '(sürümsüz)'} en="max-w-[10rem]" mono />
                        </td>
                        <td className={TD}>{say(k.host_sayisi)}</td>
                        <td className={TD}>{say(k.uygulama_sayisi)}</td>
                        <td className={TD}>{say(k.kopya)}</td>
                      </tr>
                      {ac && (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-3"
                            style={{ background: 'var(--bg-elevated)' }}
                          >
                            <Kullananlar ad={k.ad} surum={k.surum} onAc={onAc} />
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
    </div>
  );
}

// ── SUNUCULAR ───────────────────────────────────────────────────────────────────────────────────
export function SunucularGorunum({ hostlar: verilen }: { hostlar?: EarHost[] }) {
  const [l, setL] = useState<EarHost[] | null>(verilen || null);
  const [hata, setHata] = useState('');
  const [yalnizSorunlu, setYalnizSorunlu] = useState(false);
  const [tazele, setTazele] = useState(0);
  useAsyncEffect(
    async (alive) => {
      if (verilen) return setL(verilen);
      setHata('');
      try {
        const r = await earApi.hostlar();
        if (alive()) setL(r.hostlar);
      } catch (e) {
        if (alive()) setHata(e instanceof Error ? e.message : String(e));
      }
    },
    [verilen, tazele],
  );
  const gorunen = (l || []).filter((h) => !yalnizSorunlu || h.durum !== 'TAM');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label
          className="flex items-center gap-1 text-xs"
          style={{ color: 'var(--text-secondary)' }}
        >
          <input
            type="checkbox"
            checked={yalnizSorunlu}
            onChange={(e) => setYalnizSorunlu(e.target.checked)}
          />{' '}
          yalnız tam olmayanlar
        </label>
        {!verilen && (
          <span className="ml-auto">
            <IndirBag href={earIndir.csv('sunucular')}>Sunucular CSV</IndirBag>
          </span>
        )}
      </div>
      {hata ? (
        <LoadError
          title="Sunucu listesi okunamadı"
          message={hata}
          onRetry={() => setTazele((n) => n + 1)}
          compact
        />
      ) : !l ? (
        <Yukleniyor />
      ) : (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
          <table className={TABLO}>
            <thead>
              <tr>
                {[
                  'Sunucu',
                  'Ortam',
                  'Durum',
                  'Playbook',
                  'Uygulama',
                  'WAR',
                  'Süre (sn)',
                  'Python',
                  'Veri',
                  'Neden',
                ].map((b) => (
                  <th key={b} className={TH} style={thStil}>
                    {b}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gorunen.length === 0 ? (
                <TableEmptyRow colSpan={10} title="Kayıt bulunamadı." />
              ) : (
                gorunen.map((h) => {
                  const eskiVeri = h.veri_kosu_id != null && h.veri_kosu_id !== h.kosu_id;
                  return (
                    <tr key={h.host} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className={TD}>{h.host}</td>
                      <td className={TD}>
                        <Kirp v={h.ortam} en="max-w-[7rem]" />
                      </td>
                      <td className={TD}>
                        <Rozet d={hostDurumu(h.durum)} kucuk />
                      </td>
                      <td className={TD} title={h.playbook_durum || ''}>
                        {h.playbook_etiket || h.playbook_durum || '—'}
                      </td>
                      <td className={TD}>{h.veri_var ? say(h.uygulama_sayisi) : '—'}</td>
                      <td className={TD}>{h.veri_var ? say(h.war_sayisi) : '—'}</td>
                      <td className={TD}>{h.sure_sn == null ? '—' : h.sure_sn.toFixed(1)}</td>
                      <td className={TD}>{h.python || '—'}</td>
                      <td className={TD}>
                        {h.veri_kosu_id == null ? (
                          <span style={{ color: 'var(--status-danger-text)' }}>hiç veri yok</span>
                        ) : eskiVeri ? (
                          <span
                            style={{ color: 'var(--status-warning-text)' }}
                            title="Son taramada veri gelmedi; ekranda önceki koşunun verisi var."
                          >
                            eski · koşu #{h.veri_kosu_id}
                          </span>
                        ) : (
                          `koşu #${h.kosu_id}`
                        )}
                      </td>
                      <td className={TD}>
                        <Kirp v={h.neden || h.hata} en="max-w-[26rem]" />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── KOSULAR ─────────────────────────────────────────────────────────────────────────────────────
function KosuAyrinti({ id }: { id: number }) {
  const [d, setD] = useState<{ partiler: EarParti[]; hostlar: EarHost[] } | null>(null);
  const [hata, setHata] = useState('');
  useAsyncEffect(
    async (alive) => {
      try {
        const r = await earApi.kosu(id);
        if (alive()) setD({ partiler: r.partiler, hostlar: r.hostlar });
      } catch (e) {
        if (alive()) setHata(e instanceof Error ? e.message : String(e));
      }
    },
    [id],
  );
  if (hata) return <LoadError title="Koşu ayrıntısı okunamadı" message={hata} compact />;
  if (!d) return <Yukleniyor />;
  return (
    <div className="space-y-2 py-2">
      <div className="flex flex-wrap gap-1">
        {d.partiler.map((p) => (
          <span
            key={p.parti_no}
            className="inline-flex items-center gap-1 text-[11px]"
            title={p.hata || ''}
          >
            #{p.parti_no} <Rozet d={partiDurumu(p.durum)} kucuk />
            {p.awx_job_id != null && (
              <span style={{ color: 'var(--text-muted)' }}>AWX {p.awx_job_id}</span>
            )}
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <IndirBag href={earIndir.zip(id)}>Bu koşunun ZIP'i</IndirBag>
      </div>
      <SunucularGorunum hostlar={d.hostlar} />
    </div>
  );
}

export function KosularGorunum({ tazeleme }: { tazeleme: number }) {
  const [l, setL] = useState<EarKosu[] | null>(null);
  const [hata, setHata] = useState('');
  const [acik, setAcik] = useState<number | null>(null);
  const [tazele, setTazele] = useState(0);
  useAsyncEffect(
    async (alive) => {
      setHata('');
      try {
        const r = await earApi.kosular(30);
        if (alive()) setL(r.kosular);
      } catch (e) {
        if (alive()) setHata(e instanceof Error ? e.message : String(e));
      }
    },
    [tazeleme, tazele],
  );
  if (hata)
    return (
      <LoadError
        title="Koşular okunamadı"
        message={hata}
        onRetry={() => setTazele((n) => n + 1)}
        compact
      />
    );
  if (!l) return <Yukleniyor />;
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
      <table className={TABLO}>
        <thead>
          <tr>
            {[
              '',
              '#',
              'Kip',
              'Kaynak',
              'Kapsam',
              'Durum',
              'Beklenen',
              'Tam',
              'Kısmi',
              'Kök yok',
              'Başarısız',
              'Başlatan',
              'Başladı',
              'Bitti',
            ].map((b, i) => (
              <th key={i} className={TH} style={thStil}>
                {b}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {l.length === 0 ? (
            <TableEmptyRow
              colSpan={14}
              title="Kayıt bulunamadı."
              description="Henüz tarama yapılmadı."
            />
          ) : (
            l.map((k) => {
              const ac = acik === k.id;
              return (
                <React.Fragment key={k.id}>
                  <tr
                    className="border-t cursor-pointer"
                    style={{ borderColor: 'var(--border)' }}
                    onClick={() => setAcik(ac ? null : k.id)}
                  >
                    <td className={TD}>
                      {ac ? (
                        <ChevronDownIcon className="w-3.5 h-3.5" aria-hidden />
                      ) : (
                        <ChevronRightIcon className="w-3.5 h-3.5" aria-hidden />
                      )}
                    </td>
                    <td className={TD}>{k.id}</td>
                    <td className={TD}>{k.kip === 'TAM' ? 'TAM' : 'ÖZET'}</td>
                    <td className={TD}>{kaynakEtiketi(k.kaynak)}</td>
                    <td className={TD}>{k.kapsam === 'FILO' ? 'filo' : 'seçili'}</td>
                    <td className={TD} title={k.hata || ''}>
                      <Rozet d={kosuDurumu(k.durum)} kucuk />
                    </td>
                    <td className={TD}>{say(k.beklenen)}</td>
                    <td className={TD}>{say(k.tam)}</td>
                    <td className={TD}>{say(k.kismi)}</td>
                    <td className={TD}>{say(k.kok_yok)}</td>
                    <td className={TD}>{say(k.basarisiz)}</td>
                    <td className={TD}>
                      <Kirp v={k.baslatan} en="max-w-[9rem]" />
                    </td>
                    <td className={TD}>{fmtDateTime(k.created_at)}</td>
                    <td className={TD}>{k.finished_at ? fmtDateTime(k.finished_at) : '—'}</td>
                  </tr>
                  {ac && (
                    <tr>
                      <td
                        colSpan={14}
                        className="px-3"
                        style={{ background: 'var(--bg-elevated)' }}
                      >
                        <KosuAyrinti id={k.id} />
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
  );
}
