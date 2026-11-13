// src/components/denetim/VeriKatalogu.tsx — Denetim > "Veri Kataloğu" (2026-11-13).
//
// Kullanıcı: "veritabanındaki her bir tablonun hangi job veya portal işi tarafından ne amaçla
// kullanıldığını yaz; artık çok fazla playbook, portal işi ve tablo oluştu".
// Kaynak: server/katalog/tablolar.json + canlı satır/boyut (server/audit/veri-katalogu.cjs).
// Üstte SAPMA (katalogda olmayan tablo / veritabanında olmayan katalog girdisi), altında
// aranabilir, süzülebilir, alana göre gruplanan tablo; satır açılınca yazanlar/okuyanlar.
import React, { useCallback, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
  CircleStackIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { TableEmptyRow } from '@/components/common/EmptyState';
import CodeChip from '@/components/common/CodeChip';
import { Select } from '@/components/ui/Form';
import { denetimApi, type KatalogTablo, type KatalogVeritabani, type VeriKataloguResult } from '@/api/denetimApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtDateTime, fmtNumber } from '@/utils/datetime';
import { Panel, Pill, StatTile, Note, type Tone } from '@/components/denetim/ui';

const norm = (s: string) => (s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i');

export const YAZAN_ETIKET: Record<string, { label: string; tone: Tone; aciklama: string }> = {
  portal: { label: 'Portal', tone: 'accent', aciklama: 'Portal sunucusunun kendi kodu yazıyor (ekran, zamanlanmış iş, API).' },
  playbook: { label: 'Playbook', tone: 'info', aciklama: 'Ansible/AWX job’ı (playbook ya da onun yükleyici betiği) yazıyor.' },
  betik: { label: 'Betik', tone: 'warning', aciklama: 'Elle ya da cron ile koşan ayrı bir betik yazıyor.' },
  bilinmiyor: { label: 'Bilinmiyor', tone: 'danger', aciklama: 'Yazan kod iki depoda da bulunamadı.' },
};

type Sira = 'alan' | 'tablo' | 'db' | 'satir' | 'mb';
type Kullanim = 'tumu' | 'kullanilan' | 'kullanilmayan';

const anahtarOf = (t: { db: string; tablo: string }) => `${t.db}:${t.tablo}`;

export function fmtMb(mb: number | null | undefined): string {
  if (mb == null || !Number.isFinite(mb)) return '—';
  if (mb < 1) return `${fmtNumber(Math.round(mb * 100) / 100)} MB`;
  if (mb >= 1024) return `${fmtNumber(Math.round(mb / 102.4) / 10)} GB`;
  return `${fmtNumber(Math.round(mb * 10) / 10)} MB`;
}

/**
 * DB kutucuğu ipucu. İki havuz AYNI fiziksel veritabanını gösteriyorsa iki kutucuk da aynı
 * listeyi okur; bunu açıkça yaz ki okuyan iki boyutu toplamasın.
 */
export function dbIpucu(v: KatalogVeritabani, ayniFiziksel: boolean): string {
  const ozet = `${fmtNumber(v.tabloSayisi ?? 0)} tablo${v.toplamMb != null ? ` · ${fmtMb(v.toplamMb)}` : ''}`;
  return ayniFiziksel ? `Ortak fiziksel veritabanı (iki kutucuk aynı): ${ozet}` : `Veritabanında ${ozet}`;
}

/** Arama: tablo adı, amaç, alan, yazan (ad/dosya/nasıl/ne zaman), okuyan (ad/dosya), notlar. */
export function aramaMetni(t: KatalogTablo): string {
  return norm(
    [
      t.tablo,
      t.amac,
      t.alan,
      t.notlar,
      t.saklama,
      ...t.yazanlar.flatMap((y) => [y.ad, y.dosya, y.nasil, y.ne_zaman, y.uzerinden ?? '']),
      ...t.okuyanlar.flatMap((o) => [o.ad, o.dosya, o.uzerinden ?? '']),
    ].join(' \u0001 '),
  );
}

export default function VeriKatalogu() {
  const [data, setData] = useState<VeriKataloguResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [fDb, setFDb] = useState('');
  const [fAlan, setFAlan] = useState('');
  const [fYazan, setFYazan] = useState('');
  const [fKullanim, setFKullanim] = useState<Kullanim>('tumu');
  const [sira, setSira] = useState<Sira>('alan');
  const [artan, setArtan] = useState(true);
  const [acik, setAcik] = useState<Set<string>>(() => new Set());

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const r = await denetimApi.veriKatalogu(fresh);
      if (r && r.ok) {
        setData(r);
        setErr('');
      } else setErr((r && r.message) || 'Veri kataloğu alınamadı.');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useAsyncEffect(async () => {
    await load();
  }, [load]);

  const metinler = useMemo(() => new Map((data?.tablolar ?? []).map((t) => [anahtarOf(t), aramaMetni(t)])), [data]);
  const alanlar = useMemo(() => {
    const s = new Set((data?.tablolar ?? []).map((t) => t.alan));
    return [...s].sort((a, b) => a.localeCompare(b, 'tr'));
  }, [data]);

  const gorunen = useMemo(() => {
    const nq = norm(q.trim());
    const liste = (data?.tablolar ?? []).filter((t) => {
      if (fDb && t.db !== fDb) return false;
      if (fAlan && t.alan !== fAlan) return false;
      if (fYazan && !t.yazanlar.some((y) => y.tur === fYazan)) return false;
      if (fKullanim === 'kullanilan' && t.kullanilmiyor) return false;
      if (fKullanim === 'kullanilmayan' && !t.kullanilmiyor) return false;
      if (nq && !(metinler.get(anahtarOf(t)) || '').includes(nq)) return false;
      return true;
    });
    const yon = artan ? 1 : -1;
    const sayi = (v: number | null) => (v == null ? -1 : v);
    liste.sort((a, b) => {
      let d = 0;
      if (sira === 'alan') d = a.alan.localeCompare(b.alan, 'tr') || a.tablo.localeCompare(b.tablo, 'tr');
      else if (sira === 'tablo') d = a.tablo.localeCompare(b.tablo, 'tr');
      else if (sira === 'db') d = a.db.localeCompare(b.db) || a.tablo.localeCompare(b.tablo, 'tr');
      else if (sira === 'satir') d = sayi(a.satir) - sayi(b.satir);
      else d = sayi(a.mb) - sayi(b.mb);
      return d * yon;
    });
    return liste;
  }, [data, metinler, q, fDb, fAlan, fYazan, fKullanim, sira, artan]);

  const siralaBy = (s: Sira) => {
    if (sira === s) setArtan((v) => !v);
    else {
      setSira(s);
      // Sayilar buyukten kucuge daha anlamli; metinler A-Z.
      setArtan(!(s === 'satir' || s === 'mb'));
    }
  };
  const ac = (k: string) =>
    setAcik((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  if (loading && !data) return <LoadingLogo />;
  if (err && !data)
    return (
      <div className="text-sm rounded-xl px-3 py-2 border" style={{ color: 'var(--status-danger)', background: 'var(--status-danger-bg)', borderColor: 'var(--status-danger)' }}>
        {err}
      </div>
    );
  if (!data) return null;

  const toplam = data.tablolar.length;
  const kullanilmayan = data.tablolar.filter((t) => t.kullanilmiyor).length;
  const { katalogdaYok, veritabanindaYok } = data.sapma;
  const hataliDb = data.veritabanlari.filter((v) => !v.ok);
  const filtreVar = !!(q || fDb || fAlan || fYazan || fKullanim !== 'tumu');
  const kolon = 7;

  const siraTh = (s: Sira, children: React.ReactNode, align: 'left' | 'right' = 'left') => (
    <th
      key={s}
      className={`sticky top-0 z-10 px-3 py-2 font-semibold whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}
      style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
      aria-sort={sira === s ? (artan ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" onClick={() => siralaBy(s)} className="inline-flex items-center gap-1 hover:underline">
        {children}
        {sira === s && <span aria-hidden>{artan ? '▲' : '▼'}</span>}
      </button>
    </th>
  );

  const alanSayisi = new Map<string, number>();
  for (const t of gorunen) alanSayisi.set(t.alan, (alanSayisi.get(t.alan) ?? 0) + 1);
  // Grup basligi: alan siralamasinda bir alanin ILK satiri (render disinda hesaplanir).
  const grupBasi = new Set<string>();
  if (sira === 'alan') gorunen.forEach((t, i) => (i === 0 || gorunen[i - 1].alan !== t.alan) && grupBasi.add(anahtarOf(t)));
  return (
    <div className="space-y-4">
      <Note title="Bu sekme ne gösterir?">
        Portal DB ve TBMWANS’taki her tablonun <b>ne için</b> tutulduğunu, <b>kimin yazdığını</b> (Portal işi, AWX playbook’u ya da betik),{' '}
        <b>kimin okuduğunu</b> ve saklama kuralını gösterir. Açıklamalar <code>server/katalog/tablolar.json</code> kataloğundan gelir; satır sayısı ve
        boyut veritabanından <b>canlı</b> okunur (10 dk önbellek, “Yenile” atlar). Yeni bir tablo eklendiğinde kataloğa da yazılmalıdır — test
        bekçisi eksik girdiyi yakalar (docs/VERI-KATALOGU.md).
      </Note>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatTile icon={CircleStackIcon} label="Katalogdaki tablo" value={fmtNumber(toplam)} />
        {data.veritabanlari.map((v) => (
          <StatTile
            key={v.db}
            label={v.db === 'Portal' ? 'Portal DB' : v.db}
            tone={v.ok ? 'neutral' : 'danger'}
            value={fmtNumber(v.katalogSayisi)}
            hint={v.ok ? dbIpucu(v, data.ayniFiziksel) : `Okunamadı: ${v.hata}`}
          />
        ))}
        <StatTile label="Kullanılmıyor" tone={kullanilmayan ? 'warning' : 'neutral'} value={fmtNumber(kullanilmayan)} hint="Okuyanı olmayan ya da artık hiçbir işin dokunmadığı tablolar" />
        <StatTile
          icon={ExclamationTriangleIcon}
          label="Sapma"
          tone={katalogdaYok.length + veritabanindaYok.length ? 'warning' : 'success'}
          value={fmtNumber(katalogdaYok.length + veritabanindaYok.length)}
          hint="Katalogda olmayan tablolar + veritabanında bulunmayan katalog girdileri"
        />
      </div>

      {/* SAPMA — en üstte: kataloğun gerçekle uyuşmadığı yer burası. */}
      <Panel
        title="Katalog ile veritabanı farkı"
        description={
          data.ayniFiziksel
            ? 'Portal DB ve TBMWANS aynı fiziksel veritabanını gösteriyor; fark iki kataloğun birleşimine göre hesaplandı.'
            : 'Her veritabanı kendi kataloğuyla karşılaştırılır.'
        }
        actions={
          <button
            type="button"
            onClick={() => load(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg"
            style={{ borderColor: 'var(--border)' }}
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile
          </button>
        }
      >
        <div className="space-y-3" data-testid="sapma">
          {hataliDb.map((v) => (
            <Note key={v.db} tone="danger" title={`${v.db === 'Portal' ? 'Portal DB' : v.db} okunamadı`}>
              {v.hata}. Bu veritabanının tabloları için satır sayısı ve fark hesaplanmadı (durum: <b>bilinmiyor</b>); katalog yine gösteriliyor.
            </Note>
          ))}
          {data.sapmaKismi && hataliDb.length < data.veritabanlari.length && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }} data-testid="sapma-kismi">
              İki veritabanının aynı fiziksel veritabanı olup olmadığı bilinemedi; okunan veritabanındaki fark iki kataloğun birleşimine göre
              süzüldü (yanlış “katalogda yok” çıkmasın).
            </p>
          )}
          <div className="flex flex-wrap gap-2 text-xs">
            <Pill tone={katalogdaYok.length ? 'warning' : 'success'}>Katalogda yok: {katalogdaYok.length}</Pill>
            <Pill tone={veritabanindaYok.length ? 'warning' : 'success'}>Veritabanında yok: {veritabanindaYok.length}</Pill>
            <span style={{ color: 'var(--text-muted)' }}>
              Hesaplandı: {fmtDateTime(data.hesaplandi)}
            </span>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <details open={katalogdaYok.length > 0 && katalogdaYok.length <= 20} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <summary className="text-xs font-semibold cursor-pointer" style={{ color: 'var(--text-primary)' }}>
                Katalogda yok ({katalogdaYok.length}) — veritabanında var, kataloğa yazılmamış
              </summary>
              {katalogdaYok.length === 0 ? (
                <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>Fark yok.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-xs max-h-64 overflow-auto" aria-label="Katalogda olmayan tablolar">
                  {katalogdaYok.map((t) => (
                    <li key={`${t.db}:${t.tablo}`} className="flex items-center gap-2 min-w-0">
                      <Pill tone="neutral">{t.db}</Pill>
                      <span className="font-mono truncate" title={t.tablo}>{t.tablo}</span>
                      <span className="ml-auto tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {fmtNumber(t.satir)} satır{t.mb != null ? ` · ${fmtMb(t.mb)}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
            <details open={veritabanindaYok.length > 0 && veritabanindaYok.length <= 20} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <summary className="text-xs font-semibold cursor-pointer" style={{ color: 'var(--text-primary)' }}>
                Veritabanında yok ({veritabanindaYok.length}) — katalogda var, tablo bulunamadı
              </summary>
              {veritabanindaYok.length === 0 ? (
                <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>Fark yok.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-xs max-h-64 overflow-auto" aria-label="Veritabanında olmayan katalog girdileri">
                  {veritabanindaYok.map((t) => (
                    <li key={`${t.db}:${t.tablo}`} className="flex items-center gap-2 min-w-0">
                      <Pill tone="neutral">{t.db === 'Portal' ? 'Portal DB' : t.db}</Pill>
                      <span className="font-mono truncate" title={t.tablo}>{t.tablo}</span>
                      <span className="ml-auto" style={{ color: 'var(--text-muted)' }}>
                        {t.alan}
                        {t.kullanilmiyor ? ' · kullanılmıyor' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </div>
        </div>
      </Panel>

      {/* SUZGECLER */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="tablo, amaç, job, dosya ara"
            aria-label="Katalogda ara"
            className="pl-8 pr-2.5 py-1.5 text-xs border rounded-lg w-64"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
          />
        </div>
        <Select sizeVariant="sm" aria-label="Veritabanı" value={fDb} onChange={(e) => setFDb(e.target.value)}>
          <option value="">Tüm veritabanları</option>
          {data.secenekler.veritabanlari.map((d) => (
            <option key={d} value={d}>{d === 'Portal' ? 'Portal DB' : d}</option>
          ))}
        </Select>
        <Select sizeVariant="sm" aria-label="Alan" value={fAlan} onChange={(e) => setFAlan(e.target.value)}>
          <option value="">Tüm alanlar</option>
          {alanlar.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </Select>
        <Select sizeVariant="sm" aria-label="Yazan türü" value={fYazan} onChange={(e) => setFYazan(e.target.value)}>
          <option value="">Yazan: hepsi</option>
          {data.secenekler.yazanTurleri.map((y) => (
            <option key={y} value={y}>Yazan: {YAZAN_ETIKET[y]?.label ?? y}</option>
          ))}
        </Select>
        <Select sizeVariant="sm" aria-label="Kullanım" value={fKullanim} onChange={(e) => setFKullanim(e.target.value as Kullanim)}>
          <option value="tumu">Kullanım: hepsi</option>
          <option value="kullanilan">Yalnız kullanılanlar</option>
          <option value="kullanilmayan">Yalnız kullanılmayanlar</option>
        </Select>
        {filtreVar && (
          <button
            type="button"
            onClick={() => {
              setQ('');
              setFDb('');
              setFAlan('');
              setFYazan('');
              setFKullanim('tumu');
            }}
            className="text-xs underline"
            style={{ color: 'var(--text-muted)' }}
          >
            Süzgeçleri temizle
          </button>
        )}
        <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }} data-testid="katalog-sayac">
          {gorunen.length} / {toplam} tablo
        </span>
      </div>

      <details className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        <summary className="cursor-pointer select-none" style={{ color: 'var(--text-muted)' }}>Sütunlar ve rozetler ne demek?</summary>
        <div className="mt-2 rounded-lg border px-3 py-2 space-y-1.5 max-w-3xl" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          {Object.entries(YAZAN_ETIKET).map(([k, v]) => (
            <p key={k}>
              <Pill tone={v.tone}>{v.label}</Pill> {v.aciklama}
            </p>
          ))}
          <p><Pill tone="warning">kullanılmıyor</Pill> Okuyanı yok ya da artık hiçbir iş dokunmuyor; silmeden önce gözden geçirin.</p>
          <p><Pill tone="neutral">MAKUL</Pill> Bilgi kod okunarak çıkarıldı ama çalıştırılarak doğrulanmadı (diğerleri KESİN).</p>
          <p><Pill tone="danger">veritabanında yok</Pill> Katalogda var, canlı veritabanında bu adda tablo bulunamadı.</p>
          <p><b>Satır / Boyut:</b> canlı; boyut ayrılmış alandır (veri + indeks). İzin yoksa boyut “—” görünür, satır yine gelir.</p>
          <p><b>Alan</b> sütununa göre sıralıyken tablolar alan başlıkları altında gruplanır.</p>
        </div>
      </details>

      <div className="overflow-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)', maxHeight: '70vh' }}>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="sticky top-0 z-10 w-8" style={{ background: 'var(--bg-elevated)' }} aria-label="Aç / kapa" />
              {siraTh('tablo', 'Tablo')}
              {siraTh('alan', 'Alan')}
              <th className="sticky top-0 z-10 px-3 py-2 font-semibold text-left" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                Amaç
              </th>
              <th className="sticky top-0 z-10 px-3 py-2 font-semibold text-left whitespace-nowrap" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                Yazan
              </th>
              {siraTh('satir', 'Satır', 'right')}
              {siraTh('mb', 'Boyut', 'right')}
            </tr>
          </thead>
          <tbody>
            {gorunen.length === 0 && <TableEmptyRow colSpan={kolon} title="Süzgeçlere uyan tablo yok." />}
            {gorunen.map((t) => {
              const k = anahtarOf(t);
              const isAcik = acik.has(k);
              const grupBasligi = grupBasi.has(k);
              const turler = [...new Set(t.yazanlar.map((y) => y.tur))];
              return (
                <React.Fragment key={k}>
                  {grupBasligi && (
                    <tr data-testid="alan-basligi">
                      <td colSpan={kolon} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ background: 'var(--bg-inset, var(--bg-elevated))', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-subtle)' }}>
                        {t.alan} <span style={{ color: 'var(--text-muted)' }}>· {alanSayisi.get(t.alan) ?? 0}</span>
                      </td>
                    </tr>
                  )}
                  <tr data-testid="katalog-satir" style={{ borderTop: '1px solid var(--border-subtle)', opacity: t.kullanilmiyor ? 0.8 : 1 }}>
                    <td className="px-2 py-1.5 align-top">
                      <button
                        type="button"
                        onClick={() => ac(k)}
                        aria-expanded={isAcik}
                        aria-label={`${t.tablo} ayrıntısı`}
                        className="p-0.5 rounded"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {isAcik ? <ChevronDownIcon className="w-4 h-4" /> : <ChevronRightIcon className="w-4 h-4" />}
                      </button>
                    </td>
                    <td className="px-3 py-1.5 align-top" style={{ color: 'var(--text-primary)' }}>
                      <div className="font-mono break-all">{t.tablo}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Pill tone="neutral">{t.db === 'Portal' ? 'Portal DB' : t.db}</Pill>
                        {t.kullanilmiyor && <Pill tone="warning">kullanılmıyor</Pill>}
                        {t.guven === 'MAKUL' && <Pill tone="neutral" title="Kod okunarak çıkarıldı, çalıştırılarak doğrulanmadı">MAKUL</Pill>}
                        {t.durum === 'yok' && <Pill tone="danger">veritabanında yok</Pill>}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 align-top whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{t.alan}</td>
                    <td className="px-3 py-1.5 align-top" style={{ color: 'var(--text-primary)', minWidth: '18rem' }}>
                      <span className={isAcik ? '' : 'line-clamp-2'}>{t.amac}</span>
                    </td>
                    <td className="px-3 py-1.5 align-top">
                      <div className="flex flex-wrap gap-1">
                        {turler.map((tr) => (
                          <Pill key={tr} tone={YAZAN_ETIKET[tr]?.tone ?? 'neutral'} title={YAZAN_ETIKET[tr]?.aciklama}>
                            {YAZAN_ETIKET[tr]?.label ?? tr}
                          </Pill>
                        ))}
                        {t.yazanlar.length === 0 && <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </div>
                      {t.yazanlar[0] && (
                        <div className="mt-1 truncate max-w-[16rem]" style={{ color: 'var(--text-muted)' }} title={t.yazanlar.map((y) => y.ad).join('\n')}>
                          {t.yazanlar[0].ad}
                          {t.yazanlar.length > 1 ? ` +${t.yazanlar.length - 1}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 align-top text-right tabular-nums whitespace-nowrap" style={{ color: 'var(--text-primary)' }} title={t.durum === 'bilinmiyor' ? 'Veritabanı okunamadı' : undefined}>
                      {t.durum === 'bilinmiyor' ? '?' : fmtNumber(t.satir)}
                    </td>
                    <td className="px-3 py-1.5 align-top text-right tabular-nums whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                      {t.durum === 'bilinmiyor' ? '?' : fmtMb(t.mb)}
                    </td>
                  </tr>
                  {isAcik && (
                    <tr data-testid="katalog-ayrinti">
                      <td />
                      <td colSpan={kolon - 1} className="px-3 pb-3 pt-1">
                        <Ayrinti t={t} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Baslik({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>
      {children}
    </h4>
  );
}

/** Dosya tabloyu kendisi sorgulamıyorsa tabloya giden yardımcı modül. */
function Uzerinden({ yol }: { yol?: string }) {
  if (!yol) return null;
  return (
    <div className="mt-0.5 flex items-center gap-1.5 min-w-0" style={{ color: 'var(--text-muted)' }}>
      <span className="shrink-0">tabloya şu modül üzerinden gider:</span>
      <CodeChip value={yol} wrap="break" copyable tone="muted" />
    </div>
  );
}

function Ayrinti({ t }: { t: KatalogTablo }) {
  return (
    <div className="grid lg:grid-cols-2 gap-3 rounded-lg border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
      <div className="min-w-0">
        <Baslik>Yazanlar ({t.yazanlar.length})</Baslik>
        {t.yazanlar.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Yazan bulunamadı.</p>}
        <ul className="space-y-2">
          {t.yazanlar.map((y, i) => (
            <li key={i} className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Pill tone={YAZAN_ETIKET[y.tur]?.tone ?? 'neutral'}>{YAZAN_ETIKET[y.tur]?.label ?? y.tur}</Pill>
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{y.ad}</span>
              </div>
              {y.nasil && (
                <p className="mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  <b>Nasıl:</b> {y.nasil}
                </p>
              )}
              {y.ne_zaman && (
                <p style={{ color: 'var(--text-secondary)' }}>
                  <b>Ne zaman:</b> {y.ne_zaman}
                </p>
              )}
              {y.dosya && (
                <div className="mt-0.5 min-w-0">
                  <CodeChip value={y.dosya} wrap="break" copyable tone="muted" />
                </div>
              )}
              <Uzerinden yol={y.uzerinden} />
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0 space-y-3">
        <div>
          <Baslik>Okuyanlar ({t.okuyanlar.length})</Baslik>
          {t.okuyanlar.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Okuyan bulunamadı.</p>}
          <ul className="space-y-1.5">
            {t.okuyanlar.map((o, i) => (
              <li key={i} className="min-w-0">
                <span style={{ color: 'var(--text-primary)' }}>{o.ad}</span>
                {o.dosya && (
                  <div className="mt-0.5 min-w-0">
                    <CodeChip value={o.dosya} wrap="break" copyable tone="muted" />
                  </div>
                )}
                <Uzerinden yol={o.uzerinden} />
              </li>
            ))}
          </ul>
        </div>
        <div>
          <Baslik>Saklama</Baslik>
          <p style={{ color: 'var(--text-secondary)' }}>{t.saklama || '—'}</p>
        </div>
        {t.notlar && (
          <div>
            <Baslik>Notlar</Baslik>
            <p style={{ color: 'var(--text-secondary)' }}>{t.notlar}</p>
          </div>
        )}
        <div>
          <Baslik>Güven</Baslik>
          <p style={{ color: 'var(--text-secondary)' }}>
            {t.guven === 'KESIN' ? 'KESİN — kod okunarak ve izlenerek doğrulandı.' : 'MAKUL — kod okunarak çıkarıldı, çalıştırılarak doğrulanmadı.'}
          </p>
        </div>
      </div>
    </div>
  );
}
