// src/components/app_hub/JvmKarsilastirPage.tsx — Application Hub: toplu JVM argümanı karşılaştırması (2026-11-16).
//
// Kullanıcı: "Belli sayıda (5-10) JBoss uygulamasını verdiğimde bunların özellikle production'da kendi
// sunucuları arasında JVM argümanlarının eşit olup olmadığını görmek istiyorum. Toplu liste verip daha
// özet bir bilgi alabilmek istiyorum."
//
// YALNIZ Admin (rota AdminRoute içinde; sayfa da ayrıca bakar). SALT OKUNUR: düzeltme / yazma düğmesi yok.
// Adres: /application-hub/jvm-karsilastir?uygulamalar=A,B&ortam=PROD&nesil=hepsi (paylaşılabilir; açılınca koşar).
import React, { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDownIcon, ChevronRightIcon, ExclamationTriangleIcon, ScaleIcon } from '@heroicons/react/24/outline';
import Button from '@/components/common/Button';
import LoadError from '@/components/common/LoadError';
import { useAuth } from '@/contexts/AuthContext';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtDateTime } from '@/utils/datetime';
import {
  jvmKarsilastirApi,
  UYGULAMA_TAVANI,
  type JvmKarsilastirmaYaniti,
  type KarsilastirmaDurumu,
  type KarsilastirmaGrubu,
  type NesilSecimi,
  type UygulamaKarsilastirmasi,
} from '@/api/appHubJvmKarsilastirApi';
import { Hap, TH, TD } from './ortak';

const AD_RE = /^[A-Za-z0-9._-]{1,128}$/;

// Sunucunun ürettiği ortam kümesi (discover hedefOrtami): PROD, QA, TEST, DEV, ALPHA, ODM.
const ORTAMLAR: { deger: string; ad: string }[] = [
  { deger: 'PROD', ad: 'Production' },
  { deger: 'TUMU', ad: 'Tüm ortamlar (ortam başına ayrı)' },
  { deger: 'QA', ad: 'QA' },
  { deger: 'TEST', ad: 'TEST' },
  { deger: 'DEV', ad: 'DEV' },
  { deger: 'ALPHA', ad: 'ALPHA' },
  { deger: 'ODM', ad: 'ODM' },
];

/** URL'deki ortam listede yoksa Production: seçim kutusu ile gönderilen istek aynı şeyi gösterir. */
function ortamOku(v: string | null): string {
  const o = String(v || '').toUpperCase();
  return ORTAMLAR.some((x) => x.deger === o) ? o : 'PROD';
}

const DURUM: Record<KarsilastirmaDurumu, { ad: string; ton: 'iyi' | 'uyari' | 'kritik' | 'notr' | 'bilgi'; aciklama: string }> = {
  ESIT: { ad: 'Eşit', ton: 'iyi', aciklama: 'Tüm JVM’lerde argümanlar aynı (sıra önemsiz; sunucuya özgü değerler hariç).' },
  FARKLI: { ad: 'Farklı', ton: 'kritik', aciklama: 'En az bir argümanın değeri farklı ya da bazı sunucularda eksik.' },
  TEK_SUNUCU: { ad: 'Tek sunucu', ton: 'bilgi', aciklama: 'Bu ortamda karşılaştırılacak ikinci JVM yok.' },
  OLCULEMEDI: { ad: 'Ölçülemedi', ton: 'uyari', aciklama: 'Argüman okunamadı, tarama yok ya da bayat.' },
  BULUNAMADI: { ad: 'Bulunamadı', ton: 'notr', aciklama: 'Uygulama yok ya da seçilen ortamda JVM’i yok.' },
};

/** Metin kutusundaki adlar: virgül, noktalı virgül, boşluk ya da satır ile ayrılır; tekrar (harf duyarsız) atılır. */
export function adlariAyir(metin: string): string[] {
  const gorulen = new Set<string>();
  const out: string[] = [];
  for (const p of String(metin || '').split(/[\s,;]+/)) {
    const ad = p.trim();
    if (!ad || gorulen.has(ad.toUpperCase())) continue;
    gorulen.add(ad.toUpperCase());
    out.push(ad);
  }
  return out;
}

function nesilOku(v: string | null): NesilSecimi {
  if (v === '7') return 7;
  if (v === '8') return 8;
  return 'hepsi';
}

export function DurumRozeti({ durum }: { durum: KarsilastirmaDurumu }) {
  const d = DURUM[durum] || DURUM.OLCULEMEDI;
  return (
    <Hap ton={d.ton} title={d.aciklama}>
      {d.ad}
    </Hap>
  );
}

const kod = (s: string) => (
  <code className="px-1 py-0.5 rounded text-[11.5px] break-all" style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
    {s === '' ? '(değersiz)' : s}
  </code>
);

function GrupAyrintisi({ g }: { g: KarsilastirmaGrubu }) {
  return (
    <div className="space-y-3 px-4 py-3" data-testid="fark-ayrintisi" style={{ background: 'var(--bg-inset)' }}>
      {g.neden && <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{g.neden}</p>}
      {g.uyarilar.map((u) => (
        <p key={u} className="text-[12px] flex items-start gap-1.5" style={{ color: 'var(--status-warning-text)' }}>
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" /> {u}
        </p>
      ))}

      {g.degerFarklari.length > 0 && (
        <div>
          <h4 className="text-[12px] font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Değer farkı ({g.degerFarklari.length})</h4>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead style={{ color: 'var(--text-muted)' }}>
                <tr>
                  <th className={TH}>Argüman</th>
                  <th className={TH}>Çoğunluk değeri</th>
                  <th className={TH}>Sapan sunucu(lar) ve değerleri</th>
                </tr>
              </thead>
              <tbody>
                {g.degerFarklari.map((f) => (
                  <tr key={f.anahtar} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td className={TD}>{kod(f.anahtar)}</td>
                    <td className={TD}>
                      {f.belirsiz ? (
                        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Belirsiz: değer bazı sunucularda kendi adını taşıyor, sapan seçilemedi</span>
                      ) : f.cogunluk != null ? (
                        <div className="space-y-0.5">
                          {kod(f.cogunluk)}
                          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{f.cogunlukUyeler.length} JVM</div>
                        </div>
                      ) : (
                        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Çoğunluk yok (eşit bölünmüş)</span>
                      )}
                    </td>
                    <td className={TD}>
                      <ul className="space-y-0.5">
                        {f.sapanlar.map((s) => (
                          <li key={s.uye} className="text-[12px]">
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{s.uye}</span> {kod(s.deger)}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {g.eksikFazla.length > 0 && (
        <div>
          <h4 className="text-[12px] font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Yalnız bazı sunucularda olan ({g.eksikFazla.length})</h4>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead style={{ color: 'var(--text-muted)' }}>
                <tr>
                  <th className={TH}>Argüman</th>
                  <th className={TH}>Olan</th>
                  <th className={TH}>Olmayan</th>
                </tr>
              </thead>
              <tbody>
                {g.eksikFazla.map((f) => (
                  <tr key={f.anahtar} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td className={TD}>
                      {kod(f.anahtar)}{' '}
                      <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{f.cogunlukta ? 'çoğunlukta var · eksik' : 'azınlıkta · fazla'}</span>
                    </td>
                    <td className={TD}>
                      <ul className="space-y-0.5">
                        {f.degerler.map((d) => (
                          <li key={d.uye} className="text-[12px]">
                            <span style={{ fontFamily: 'var(--font-mono)' }}>{d.uye}</span> {kod(d.deger)}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className={TD}>
                      <span className="text-[12px]" style={{ fontFamily: 'var(--font-mono)' }}>{f.olmayan.join(', ')}</span>
                      {f.kesikte.length > 0 && (
                        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          Kesik metin, bilinmiyor: {f.kesikte.join(', ')}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(g.sunucuyaOzgu.length > 0 || g.maskeli.length > 0 || g.karsilastirilamadi.length > 0) && (
        <div className="text-[12px] space-y-1" style={{ color: 'var(--text-muted)' }}>
          {g.sunucuyaOzgu.length > 0 && (
            <p title={g.sunucuyaOzgu.map((s) => `${s.anahtar}: ${s.degerler.map((d) => `${d.uye}=${d.deger}`).join(', ')}`).join('\n')}>
              Sunucuya özgü ({g.sunucuyaOzgu.length}, eşitsizlik sayılmadı): {g.sunucuyaOzgu.map((s) => s.anahtar).join(', ')}
            </p>
          )}
          {g.maskeli.length > 0 && <p>Maskeli değer (*** kısmı görülmez; açık kalan kısım karşılaştırıldı): {g.maskeli.join(', ')}</p>}
          {g.karsilastirilamadi.length > 0 && (
            <p title={g.karsilastirilamadi.map((x) => `${x.anahtar}: ${x.kesik.join(', ')}`).join('\n')}>
              Karşılaştırılamadı ({g.karsilastirilamadi.length}, argüman metni kesik JVM’lerde görülmüyor): {g.karsilastirilamadi.map((x) => x.anahtar).join(', ')}
            </p>
          )}
        </div>
      )}

      <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
        <span className="font-semibold">JVM’ler: </span>
        {g.jvmler.map((j, i) => (
          <span key={j.etiket}>
            {i > 0 && ' · '}
            <span style={{ fontFamily: 'var(--font-mono)', color: j.olculdu ? 'var(--text-primary)' : 'var(--text-muted)' }}>{j.etiket}</span>
            {' '}({!j.olculdu ? 'okunamadı' : j.kaynak === 'YAPILANDIRILAN' ? 'yapılandırma' : 'çalışan süreç'}
            {j.calisiyor === false ? ', kapalı' : ''}
            {!j.taze ? ', bayat tarama' : ''}
            {j.kesik ? ', kesik metin' : ''})
          </span>
        ))}
        {g.esitSayisi > 0 && <span> · {g.esitSayisi} argüman eşit</span>}
      </div>
    </div>
  );
}

interface Satir {
  anahtar: string;
  u: UygulamaKarsilastirmasi;
  g: KarsilastirmaGrubu | null;
  ilk: boolean;
}

function satirlar(liste: UygulamaKarsilastirmasi[]): Satir[] {
  const out: Satir[] = [];
  for (const u of liste) {
    if (!u.gruplar.length) out.push({ anahtar: u.ad, u, g: null, ilk: true });
    u.gruplar.forEach((g, i) => out.push({ anahtar: `${u.ad}|${g.ortam}|${g.nesil}`, u, g, ilk: i === 0 }));
  }
  return out;
}

function Sonuclar({ y, tumOrtam }: { y: JvmKarsilastirmaYaniti; tumOrtam: boolean }) {
  const [acik, setAcik] = useState<Set<string>>(() => new Set());
  const degistir = (k: string) =>
    setAcik((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const oz = y.ozet;
  const parcalar = [
    `${oz.ESIT} eşit`,
    `${oz.FARKLI} farklı`,
    `${oz.TEK_SUNUCU} tek sunucu`,
    `${oz.OLCULEMEDI + oz.BULUNAMADI} ölçülemedi/bulunamadı`,
  ];
  return (
    <section className="card p-0 overflow-hidden">
      <header className="px-4 py-3 flex flex-wrap items-center justify-between gap-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <p className="text-[14px]" data-testid="karsilastirma-ozeti" style={{ color: 'var(--text-primary)' }}>
          <strong>{oz.toplam} uygulama:</strong> {parcalar.join(', ')}
        </p>
        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }} title={fmtDateTime(y.okundu)}>
          {ORTAMLAR.find((o) => o.deger === y.ortam)?.ad || y.ortam} · {y.nesil === 'hepsi' ? 'JBoss 7 ve 8 ayrı ayrı' : `JBoss ${y.nesil}`} · {fmtDateTime(y.okundu)}
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead style={{ color: 'var(--text-muted)' }}>
            <tr>
              <th className={TH} aria-label="Aç / kapat" />
              <th className={TH}>Uygulama</th>
              <th className={TH}>{tumOrtam ? 'Ortam · nesil' : 'Nesil'}</th>
              <th className={TH}>Sunucu / JVM</th>
              <th className={TH}>Durum</th>
              <th className={TH}>Fark</th>
            </tr>
          </thead>
          <tbody>
            {satirlar(y.uygulamalar).map(({ anahtar, u, g, ilk }) => {
              const acilir = !!g && (g.farkSayisi > 0 || g.uyarilar.length > 0 || g.sunucuyaOzgu.length > 0 || g.maskeli.length > 0 || g.karsilastirilamadi.length > 0 || !!g.neden || g.jvmSayisi > 0);
              const ac = acik.has(anahtar);
              const durum = g ? g.durum : u.durum;
              return (
                <React.Fragment key={anahtar}>
                  <tr
                    data-testid="karsilastirma-satiri"
                    onClick={acilir ? () => degistir(anahtar) : undefined}
                    className={acilir ? 'cursor-pointer' : undefined}
                    style={{ borderTop: '1px solid var(--border-subtle)' }}
                  >
                    <td className={TD}>
                      {acilir && (
                        <button type="button" aria-expanded={ac} aria-label={`${u.ad} ayrıntısı`} className="pf-btn-link" onClick={(e) => { e.stopPropagation(); degistir(anahtar); }}>
                          {ac ? <ChevronDownIcon className="w-4 h-4" /> : <ChevronRightIcon className="w-4 h-4" />}
                        </button>
                      )}
                    </td>
                    <td className={TD}>
                      {ilk ? (
                        <div className="space-y-0.5">
                          <Link
                            to={`/application-hub?tip=jboss&ad=${encodeURIComponent(u.tabanAd || u.ad)}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}
                          >
                            {u.ad}
                          </Link>
                          {u.neden && !g && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{u.neden}</div>}
                          {u.uyarilar.map((w) => (
                            <div key={w} className="text-[11px]" style={{ color: 'var(--status-warning-text)' }}>{w}</div>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <td className={TD}>{g ? `${tumOrtam ? `${g.ortam} · ` : ''}${g.nesil ? `JBoss ${g.nesil}` : 'Nesil bilinmiyor'}` : '—'}</td>
                    <td className={`${TD} tabular-nums`}>{g ? `${g.sunucuSayisi} / ${g.jvmSayisi}` : '—'}</td>
                    <td className={TD}>
                      <DurumRozeti durum={durum} />
                    </td>
                    <td className={`${TD} tabular-nums`}>{g && (g.durum === 'FARKLI' || g.durum === 'ESIT') ? g.farkSayisi : '—'}</td>
                  </tr>
                  {g && ac && (
                    <tr>
                      <td colSpan={6} className="p-0" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        <GrupAyrintisi g={g} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function JvmKarsilastirPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const listeParam = params.get('uygulamalar') || '';
  const ortam = ortamOku(params.get('ortam'));
  const nesil = nesilOku(params.get('nesil'));

  const [metin, setMetin] = useState(() => adlariAyir(listeParam).join('\n'));
  const [ortamSec, setOrtamSec] = useState(ortam);
  const [nesilSec, setNesilSec] = useState<NesilSecimi>(nesil);
  const [sonuc, setSonuc] = useState<JvmKarsilastirmaYaniti | null>(null);
  const [hata, setHata] = useState('');
  const [bilgi, setBilgi] = useState('');
  const [yukleniyor, setYukleniyor] = useState(false);
  const [kosuNo, setKosuNo] = useState(0);
  const iptalRef = useRef<AbortController | null>(null);

  const yazilan = adlariAyir(metin);
  const gecersiz = yazilan.filter((a) => !AD_RE.test(a));
  const fazla = yazilan.length > UYGULAMA_TAVANI;
  const isAdmin = user?.role === 'Admin';

  useAsyncEffect(
    async (alive) => {
      const liste = adlariAyir(listeParam);
      if (!isAdmin || !liste.length || liste.length > UYGULAMA_TAVANI) return;
      const ac = new AbortController();
      iptalRef.current = ac;
      setYukleniyor(true);
      setHata('');
      setBilgi('');
      try {
        const r = await jvmKarsilastirApi.karsilastir({ uygulamalar: liste, ortam, nesil }, ac.signal);
        if (!alive() || ac.signal.aborted) return;
        setSonuc(r);
      } catch (e) {
        if (!alive()) return;
        if (ac.signal.aborted) setBilgi('Karşılaştırma iptal edildi.');
        else {
          setSonuc(null);
          setHata((e as Error).message);
        }
      } finally {
        if (iptalRef.current === ac) iptalRef.current = null;
        if (alive()) setYukleniyor(false);
      }
    },
    [listeParam, ortam, nesil, kosuNo, isAdmin],
  );

  if (!isAdmin) {
    return (
      <div className="card px-5 py-4 text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Bu sayfa yalnız Admin rolüne açıktır.
      </div>
    );
  }

  const karsilastir = (e: React.FormEvent) => {
    e.preventDefault();
    if (!yazilan.length || gecersiz.length || fazla) return;
    setParams({ uygulamalar: yazilan.join(','), ortam: ortamSec, nesil: String(nesilSec) });
    setKosuNo((n) => n + 1);
  };
  const iptal = () => iptalRef.current?.abort();

  return (
    <div className="space-y-5">
      <header className="card px-5 py-4 space-y-1" style={{ borderTop: '3px solid var(--ah-hue)' }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="inline-flex items-center gap-2" style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--text-primary)' }}>
            <ScaleIcon className="w-6 h-6" style={{ color: 'var(--ah-hue)' }} /> JVM argümanı karşılaştırması
          </h1>
          <Link to="/application-hub" className="pf-btn-link text-[13px]">Application Hub’a dön</Link>
        </div>
        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          Her JBoss uygulamasının JVM’leri kendi aralarında karşılaştırılır (JBoss 7 ve 8 ayrı). Sıra önemsizdir; host adı, IP ya da JVM adı içeren
          değerler ve node adı / port ofseti gibi sunucuya özgü argümanlar eşitsizlik sayılmaz. Salt okunur: Server Hub taramasındaki argümanlar okunur, hiçbir şey değiştirilmez.
        </p>
      </header>

      <form className="card px-5 py-4 space-y-3" onSubmit={karsilastir}>
        <label className="block text-[13px] font-semibold" htmlFor="jk-uygulamalar" style={{ color: 'var(--text-secondary)' }}>
          Uygulamalar (en çok {UYGULAMA_TAVANI}; virgül, boşluk ya da satırla ayırın)
        </label>
        <textarea
          id="jk-uygulamalar"
          value={metin}
          onChange={(e) => setMetin(e.target.value)}
          rows={5}
          placeholder={'MUSTERI\nKREDI\nODEME'}
          className="w-full rounded border px-3 py-2 text-[13px]"
          style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        />
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[12px] flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
            Ortam
            <select value={ortamSec} onChange={(e) => setOrtamSec(e.target.value)} className="rounded border px-2 py-1 text-[13px]" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              {ORTAMLAR.map((o) => (
                <option key={o.deger} value={o.deger}>{o.ad}</option>
              ))}
            </select>
          </label>
          <label className="text-[12px] flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
            Nesil
            <select value={String(nesilSec)} onChange={(e) => setNesilSec(nesilOku(e.target.value))} className="rounded border px-2 py-1 text-[13px]" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <option value="hepsi">JBoss 7 ve 8 (ayrı ayrı)</option>
              <option value="7">Yalnız JBoss 7</option>
              <option value="8">Yalnız JBoss 8</option>
            </select>
          </label>
          <Button type="submit" variant="primary" icon={<ScaleIcon className="w-4 h-4" />} loading={yukleniyor} disabled={!yazilan.length || gecersiz.length > 0 || fazla}>
            Karşılaştır
          </Button>
          {yukleniyor && (
            <Button type="button" variant="secondary" onClick={iptal}>
              İptal
            </Button>
          )}
          <span className="text-[12px] tabular-nums" style={{ color: fazla ? 'var(--status-danger)' : 'var(--text-muted)' }}>
            {yazilan.length} / {UYGULAMA_TAVANI} uygulama
          </span>
        </div>
        {gecersiz.length > 0 && (
          <p role="alert" className="text-[12px]" style={{ color: 'var(--status-danger)' }}>
            Geçersiz ad: {gecersiz.slice(0, 5).join(', ')} (harf, rakam, nokta, alt çizgi, tire).
          </p>
        )}
        {fazla && (
          <p role="alert" className="text-[12px]" style={{ color: 'var(--status-danger)' }}>
            En çok {UYGULAMA_TAVANI} uygulama karşılaştırılabilir.
          </p>
        )}
      </form>

      {bilgi && <p className="text-[13px]" role="status" style={{ color: 'var(--text-muted)' }}>{bilgi}</p>}
      {hata ? (
        <LoadError title="Karşılaştırma yapılamadı" message={hata} onRetry={() => setKosuNo((n) => n + 1)} retrying={yukleniyor} />
      ) : yukleniyor && !sonuc ? (
        <div className="h-48 card skeleton" />
      ) : sonuc ? (
        <Sonuclar key={sonuc.okundu} y={sonuc} tumOrtam={sonuc.ortam === 'TUMU'} />
      ) : null}
    </div>
  );
}
