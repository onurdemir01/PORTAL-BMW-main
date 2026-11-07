// src/components/server_hub/NotYonetimi.tsx — Server Hub notları ve sınıf taksonomisi (2026-11-08).
//
// Kullanıcı: "etiket düzenleme silme ekleme yorum koyma sınıflandırma ... her şey admin tarafından
// editlenebilir olmalı ve her işlem konfigüratif olmalı". Retirement Analizi kartı bir varlığın notlarını
// gösterir; burası BÜTÜN notları (arşiv ve konusu artık bulunamayanlar dahil) ve sınıfları yönetir.
//   - Tarama notu silmez; arşivlemek varsayılan. Kalıcı silme yalnız arşivdeki notta, iki adımlı onayla
//     (sunucu da onay=1 ister; geçmiş kalır).
//   - Sınıf etkisi: BILINEN şüpheyi "Bilinen" bölümüne taşır (karar DEĞİŞMEZ), BILGI yalnız gösterilir.
//   - Varsayılan sınıf ve aktif notu olan sınıf silinemez (sunucu 409; düğme de nedeniyle kapalı).
// Ekran hiçbir tarama ya da sunucu işlemi çalıştırmaz; yalnız Portal DB'deki notları / sınıfları yazar.
import React, { useMemo, useState } from 'react';
import {
  serverHubApi,
  type ShNot,
  type ShNotGecmis,
  type ShNotlarSonuc,
  type ShSinif,
  type ShSinifGovde,
} from '@/api/serverHubApi';
import { toast } from '@/hooks/useToast';
import { Modal } from '@/components/common/Modal';
import LoadError from '@/components/common/LoadError';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import Rozet from './DurumRozeti';
import { BTN, btnStil } from './RetireEtiketleri';
import { TON } from './retirementStil';

const MUTED: React.CSSProperties = { color: 'var(--text-muted)' };
const hataMetni = (e: unknown) => (e instanceof Error ? e.message : String(e));
const ALAN = 'w-full px-2 py-1 text-xs border rounded-lg';
const ALAN_STIL: React.CSSProperties = {
  borderColor: 'var(--border)',
  background: 'var(--bg-surface)',
};
const tarih = (s: string | null) => (s ? s.slice(0, 16).replace('T', ' ') : '—');

// Sunucu kurallarıyla aynı (notlar.cjs SINIF_RE / RENKLER); istemci yalnız erken uyarı verir.
export const SINIF_AD_RE = /^[A-Z][A-Z0-9_]{1,39}$/;
export const RENK_ADI: Record<ShSinif['renk'], string> = {
  notr: 'Nötr (gri)',
  bilgi: 'Bilgi (mavi)',
  aksan: 'Aksan',
  uyari: 'Uyarı (sarı)',
  basari: 'Başarı (yeşil)',
  hata: 'Hata (kırmızı)',
};
export const ETKI_METNI: Record<ShSinif['etki'], string> = {
  BILINEN: 'Şüpheyi “Bilinen” bölümüne taşır (karar değişmez)',
  BILGI: 'Yalnız bilgi',
};
const ISLEM_ADI: Record<string, string> = {
  EKLE: 'eklendi',
  GUNCELLE: 'güncellendi',
  ARSIV: 'arşivlendi',
  GERI_AL: 'arşivden geri alındı',
  SIL: 'kalıcı silindi',
};
const YAYILIM_ADI: Record<ShNot['yayilim'], string> = {
  YALNIZ: 'yalnız bu',
  ASAGI: 'bu ve altındakiler',
  ZINCIR: 'bütün zincir',
};
// Analiz kartı bu türleri açabilir (iliski-uclar /iliski/karar).
const KARTLI = /^(app|sunucu|jvm|was):/;

/** Admin sınıfının rozeti: başlık + renk; açıklama ipucu. Bilinmeyen sınıf adıyla, nötr. */
export function SinifRozeti({ ad, siniflar }: { ad: string; siniflar: ShSinif[] }) {
  const s = siniflar.find((x) => x.ad === ad);
  const t = TON[s ? s.renk : 'notr'];
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border"
      style={{ background: t.zemin, color: t.metin, borderColor: t.kenar }}
      title={s ? s.aciklama : ad}
    >
      {s ? s.baslik : ad}
    </span>
  );
}

/** Geri alınamaz işlem: ilk tık onay sorar, ikinci tık yapar. Tarayıcı penceresi (confirm) açmaz. */
function OnayliDugme({
  etiket,
  soru,
  onEvet,
  disabled,
  title,
}: {
  etiket: string;
  soru: string;
  onEvet: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const [soruyor, setSoruyor] = useState(false);
  if (!soruyor)
    return (
      <button
        type="button"
        className={BTN}
        style={btnStil()}
        disabled={disabled}
        title={title}
        onClick={() => setSoruyor(true)}
      >
        {etiket}
      </button>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" role="group" aria-label={soru}>
      <span className="text-[11px]" style={{ color: 'var(--status-danger-text)' }}>
        {soru}
      </span>
      <button
        type="button"
        className={BTN}
        style={{ ...btnStil(), color: 'var(--status-danger-text)' }}
        onClick={() => {
          setSoruyor(false);
          onEvet();
        }}
      >
        Evet, {etiket.toLocaleLowerCase('tr')}
      </button>
      <button type="button" className={BTN} style={btnStil()} onClick={() => setSoruyor(false)}>
        İptal
      </button>
    </span>
  );
}

// ── Notlar ───────────────────────────────────────────────────────────────────────────────────────
export type NotSuzgeci = 'AKTIF' | 'YETIM' | 'DEGISTI' | 'ARSIV';
type ListeNotu = ShNotlarSonuc['notlar'][number];
const SUZGEC: { id: NotSuzgeci; ad: string; f: (n: ListeNotu) => boolean }[] = [
  { id: 'AKTIF', ad: 'Aktif', f: (n) => n.durum === 'AKTIF' },
  { id: 'YETIM', ad: 'Konusu bulunamayan', f: (n) => n.durum === 'AKTIF' && n.yetim === true },
  { id: 'DEGISTI', ad: 'Veri değişti', f: (n) => n.durum === 'AKTIF' && n.veriDegisti },
  { id: 'ARSIV', ad: 'Arşiv', f: (n) => n.durum === 'ARSIV' },
];
const EN_COK = 200;

function Gecmis({ id }: { id: number }) {
  const [g, setG] = useState<ShNotGecmis[] | null>(null);
  const [hata, setHata] = useState('');
  useAsyncEffect(
    async (alive) => {
      try {
        const r = await serverHubApi.notGecmisi(id);
        if (alive()) setG(Array.isArray(r.gecmis) ? r.gecmis : []);
      } catch (e) {
        if (alive()) setHata(hataMetni(e));
      }
    },
    [id],
  );
  if (hata) return <LoadError compact title="Geçmiş okunamadı" message={hata} />;
  if (!g)
    return (
      <div className="text-[11px]" style={MUTED}>
        okunuyor…
      </div>
    );
  if (!g.length)
    return (
      <div className="text-[11px]" style={MUTED}>
        Geçmiş kaydı yok.
      </div>
    );
  return (
    <ol className="text-[11px] space-y-0.5" data-testid="not-gecmisi">
      {g.map((x, i) => (
        <li key={i}>
          <span className="font-mono">{tarih(x.zaman)}</span> · {x.kim || '—'} ·{' '}
          {ISLEM_ADI[x.islem] || x.islem}
          {x.onceki && x.islem === 'GUNCELLE' && (
            <span style={MUTED}>
              {' '}
              — önceki: {x.onceki.sinif} · “{String(x.onceki.metin || '').slice(0, 120)}”
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function NotSatiri({
  n,
  siniflar,
  mesgul,
  onIslem,
  onAc,
}: {
  n: ListeNotu;
  siniflar: ShSinif[];
  mesgul: boolean;
  onIslem: (ne: 'ARSIV' | 'GERI_AL' | 'SIL', id: number) => void;
  onAc?: (anahtar: string) => void;
}) {
  const [gecmis, setGecmis] = useState(false);
  return (
    <li
      className="rounded-lg border px-2.5 py-2 space-y-1"
      style={{ borderColor: 'var(--border-subtle)' }}
      data-testid="yonetim-notu"
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-mono break-all">{n.konu}</span>
        <SinifRozeti ad={n.sinif} siniflar={siniflar} />
        {n.supheli_kod && (
          <span className="font-mono text-[10px]" style={MUTED}>
            {n.supheli_kod}
          </span>
        )}
        {n.durum === 'ARSIV' && <Rozet metin="arşivde" ton="notr" />}
        {n.durum === 'AKTIF' && n.yetim === true && (
          <Rozet
            metin="konusu bulunamadı"
            ton="uyari"
            title="Son taramada bu varlık yok; not silinmedi, burada bekliyor."
          />
        )}
        {n.durum === 'AKTIF' && n.veriDegisti && <Rozet metin="veri değişti" ton="uyari" />}
      </div>
      <div className="text-xs whitespace-pre-wrap">{n.metin}</div>
      {n.etiketler.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {n.etiketler.map((e) => (
            <Rozet key={e} metin={e} ton="notr" />
          ))}
        </div>
      )}
      <div className="text-[11px]" style={MUTED}>
        {n.olusturan || '—'} · {tarih(n.olusturuldu)}
        {n.guncelleyen && ` · son değişiklik ${n.guncelleyen} ${tarih(n.guncellendi)}`} · yayılım:{' '}
        {YAYILIM_ADI[n.yayilim]}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {onAc && n.durum === 'AKTIF' && n.yetim !== true && KARTLI.test(n.konu) && (
          <button type="button" className={BTN} style={btnStil()} onClick={() => onAc(n.konu)}>
            Analizde aç
          </button>
        )}
        <button
          type="button"
          className={BTN}
          style={btnStil(gecmis)}
          aria-pressed={gecmis}
          onClick={() => setGecmis((v) => !v)}
        >
          Geçmiş
        </button>
        {n.durum === 'AKTIF' ? (
          <button
            type="button"
            className={BTN}
            style={btnStil()}
            disabled={mesgul}
            onClick={() => onIslem('ARSIV', n.id)}
          >
            Arşivle
          </button>
        ) : (
          <>
            <button
              type="button"
              className={BTN}
              style={btnStil()}
              disabled={mesgul}
              onClick={() => onIslem('GERI_AL', n.id)}
            >
              Geri al
            </button>
            <OnayliDugme
              etiket="Kalıcı sil"
              soru="Not kalıcı silinsin mi? Geri alınamaz (geçmiş kalır)."
              disabled={mesgul}
              onEvet={() => onIslem('SIL', n.id)}
            />
          </>
        )}
      </div>
      {gecmis && <Gecmis id={n.id} />}
    </li>
  );
}

function NotlarBolumu({
  veri,
  baslangic,
  mesgul,
  onIslem,
  onAc,
}: {
  veri: ShNotlarSonuc;
  baslangic: NotSuzgeci;
  mesgul: boolean;
  onIslem: (ne: 'ARSIV' | 'GERI_AL' | 'SIL', id: number) => void;
  onAc?: (anahtar: string) => void;
}) {
  const [suzgec, setSuzgec] = useState<NotSuzgeci>(baslangic);
  const [q, setQ] = useState('');
  const [sinif, setSinif] = useState('');
  const sayi = useMemo(
    () => Object.fromEntries(SUZGEC.map((s) => [s.id, veri.notlar.filter(s.f).length])),
    [veri],
  );
  const gorunen = useMemo(() => {
    const f = SUZGEC.find((s) => s.id === suzgec)!.f;
    const k = q.trim().toLocaleLowerCase('tr');
    return veri.notlar.filter(
      (n) =>
        f(n) &&
        (!sinif || n.sinif === sinif) &&
        (!k ||
          [n.konu, n.metin, n.sinif, n.supheli_kod || '', n.olusturan || '', ...n.etiketler]
            .join(' ')
            .toLocaleLowerCase('tr')
            .includes(k)),
    );
  }, [veri, suzgec, q, sinif]);
  return (
    <div className="space-y-2">
      {veri.grafikYok && (
        <div className="text-[11px]" style={{ color: 'var(--status-warning-text)' }}>
          İlişki grafiği okunamadı: hangi notun konusu bulunamıyor ve hangisinde veri değişti
          bilinmiyor (notlar yine listeleniyor).
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Not süzgeci">
        {SUZGEC.map((s) => (
          <button
            key={s.id}
            type="button"
            className={BTN}
            style={btnStil(suzgec === s.id)}
            aria-pressed={suzgec === s.id}
            onClick={() => setSuzgec(s.id)}
          >
            {s.ad} {veri.grafikYok && (s.id === 'YETIM' || s.id === 'DEGISTI') ? '?' : sayi[s.id]}
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
        <input
          aria-label="Notlarda ara"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="konu, metin, etiket, kişi ara"
          className={ALAN}
          style={ALAN_STIL}
        />
        <select
          aria-label="Sınıf süzgeci"
          value={sinif}
          onChange={(e) => setSinif(e.target.value)}
          className={ALAN}
          style={ALAN_STIL}
        >
          <option value="">Bütün sınıflar</option>
          {veri.siniflar.map((s) => (
            <option key={s.ad} value={s.ad}>
              {s.baslik}
            </option>
          ))}
        </select>
      </div>
      {gorunen.length === 0 ? (
        <div className="text-xs py-2" style={MUTED}>
          {veri.okunamadi
            ? 'Not tablosu okunamadı; notlar gösterilemiyor (yok demek değil).'
            : veri.notlar.length
              ? 'Bu süzgeçle eşleşen not yok.'
              : 'Henüz not yok.'}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {gorunen.slice(0, EN_COK).map((n) => (
            <NotSatiri
              key={n.id}
              n={n}
              siniflar={veri.siniflar}
              mesgul={mesgul}
              onIslem={onIslem}
              onAc={onAc}
            />
          ))}
        </ul>
      )}
      {gorunen.length > EN_COK && (
        <div className="text-[11px]" style={MUTED}>
          İlk {EN_COK} / {gorunen.length} not gösteriliyor; süzgeci ya da aramayı daraltın.
        </div>
      )}
    </div>
  );
}

// ── Sınıflar ─────────────────────────────────────────────────────────────────────────────────────
const BOS_SINIF: ShSinifGovde = {
  ad: '',
  baslik: '',
  renk: 'notr',
  etki: 'BILGI',
  aciklama: '',
  sira: 100,
};

function SinifFormu({
  ilk,
  yeni,
  mesgul,
  onKaydet,
  onIptal,
}: {
  ilk: ShSinifGovde;
  yeni: boolean;
  mesgul: boolean;
  onKaydet: (s: ShSinifGovde) => void;
  onIptal: () => void;
}) {
  const [s, setS] = useState<ShSinifGovde>(ilk);
  const alan = <K extends keyof ShSinifGovde>(k: K, v: ShSinifGovde[K]) =>
    setS((o) => ({ ...o, [k]: v }));
  const adHatasi =
    yeni && !SINIF_AD_RE.test(s.ad) ? 'Ad BÜYÜK_HARF, harfle başlar, 2-40 karakter.' : '';
  const baslikHatasi =
    s.baslik.trim().length < 2 || s.baslik.trim().length > 80 ? 'Başlık 2-80 karakter.' : '';
  const gosterilecek = (s.ad && adHatasi) || (s.baslik && baslikHatasi) || '';
  return (
    <div
      className="space-y-2 rounded-lg border p-2"
      style={{ borderColor: 'var(--border-subtle)' }}
      data-testid="sinif-formu"
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-[11px]">
          Ad (değişmez)
          <input
            aria-label="Sınıf adı"
            value={s.ad}
            readOnly={!yeni}
            onChange={(e) => alan('ad', e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
            placeholder="ör. SAHIBI_ONAYLADI"
            className={`${ALAN} font-mono`}
            style={{ ...ALAN_STIL, ...(yeni ? {} : { background: 'var(--bg-elevated)' }) }}
          />
        </label>
        <label className="text-[11px]">
          Başlık
          <input
            aria-label="Sınıf başlığı"
            value={s.baslik}
            onChange={(e) => alan('baslik', e.target.value)}
            className={ALAN}
            style={ALAN_STIL}
          />
        </label>
        <label className="text-[11px]">
          Sıra (küçük önce)
          <input
            aria-label="Sınıf sırası"
            type="number"
            min={0}
            max={999}
            value={s.sira}
            onChange={(e) => alan('sira', Number(e.target.value))}
            className={ALAN}
            style={ALAN_STIL}
          />
        </label>
        <label className="text-[11px]">
          Renk
          <select
            aria-label="Sınıf rengi"
            value={s.renk}
            onChange={(e) => alan('renk', e.target.value as ShSinif['renk'])}
            className={ALAN}
            style={ALAN_STIL}
          >
            {(Object.keys(RENK_ADI) as ShSinif['renk'][]).map((r) => (
              <option key={r} value={r}>
                {RENK_ADI[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] sm:col-span-2">
          Etki
          <select
            aria-label="Sınıf etkisi"
            value={s.etki}
            onChange={(e) => alan('etki', e.target.value as ShSinif['etki'])}
            className={ALAN}
            style={ALAN_STIL}
          >
            {(Object.keys(ETKI_METNI) as ShSinif['etki'][]).map((x) => (
              <option key={x} value={x}>
                {ETKI_METNI[x]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-[11px]">
        Açıklama (rozet ipucu)
        <input
          aria-label="Sınıf açıklaması"
          value={s.aciklama}
          maxLength={300}
          onChange={(e) => alan('aciklama', e.target.value)}
          className={ALAN}
          style={ALAN_STIL}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span style={MUTED}>Önizleme:</span>
        <SinifRozeti
          ad={s.ad || 'YENI'}
          siniflar={[{ ...s, ad: s.ad || 'YENI', baslik: s.baslik || 'Başlık' }]}
        />
      </div>
      {/* Uyarı yazmaya başlayınca; boş formda bağırmaz (Kaydet yine kapalı). */}
      {gosterilecek && (
        <div className="text-[11px]" style={{ color: 'var(--status-warning-text)' }}>
          {gosterilecek}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className={BTN}
          style={btnStil(true)}
          disabled={mesgul || !!adHatasi || !!baslikHatasi}
          onClick={() => onKaydet({ ...s, baslik: s.baslik.trim(), aciklama: s.aciklama.trim() })}
        >
          Kaydet
        </button>
        <button type="button" className={BTN} style={btnStil()} onClick={onIptal}>
          İptal
        </button>
      </div>
    </div>
  );
}

function SiniflarBolumu({
  siniflar,
  notlar,
  notOkunamadi,
  mesgul,
  onKaydet,
  onSil,
}: {
  siniflar: ShSinif[];
  notlar: ListeNotu[];
  /** Not tablosu okunamadı: "0 aktif not" denmez, sayı bilinmiyor. */
  notOkunamadi: boolean;
  mesgul: boolean;
  onKaydet: (s: ShSinifGovde) => Promise<boolean>;
  onSil: (ad: string) => void;
}) {
  const [form, setForm] = useState<{ ilk: ShSinifGovde; yeni: boolean } | null>(null);
  const aktif = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notlar) if (n.durum === 'AKTIF') m.set(n.sinif, (m.get(n.sinif) || 0) + 1);
    return m;
  }, [notlar]);
  return (
    <div className="space-y-2">
      <div className="text-[11px]" style={MUTED}>
        Sınıflar notları gruplar. “Bilinen” etkili sınıftaki not, şüpheyi Retirement Analizi’nde
        ayrı “Bilinen” bölümüne taşır; kararı değiştirmez. Varsayılan sınıfların başlığı, rengi ve
        etkisi değiştirilebilir ama silinemez.
      </div>
      {form ? (
        <SinifFormu
          key={form.ilk.ad || 'yeni'}
          ilk={form.ilk}
          yeni={form.yeni}
          mesgul={mesgul}
          onKaydet={async (s) => {
            if (await onKaydet(s)) setForm(null);
          }}
          onIptal={() => setForm(null)}
        />
      ) : (
        <button
          type="button"
          className={BTN}
          style={btnStil(true)}
          onClick={() => setForm({ ilk: BOS_SINIF, yeni: true })}
        >
          Yeni sınıf
        </button>
      )}
      <ul className="space-y-1.5">
        {siniflar.map((s) => {
          const n = aktif.get(s.ad) || 0;
          const neden = s.varsayilan
            ? 'Varsayılan sınıf silinemez (başlığı / rengi değiştirilebilir).'
            : n
              ? `Bu sınıfta ${n} aktif not var; önce notları başka sınıfa taşıyın.`
              : undefined;
          return (
            <li
              key={s.ad}
              className="flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs"
              style={{ borderColor: 'var(--border-subtle)' }}
              data-testid="yonetim-sinifi"
            >
              <SinifRozeti ad={s.ad} siniflar={siniflar} />
              <span className="font-mono text-[10px]" style={MUTED}>
                {s.ad}
              </span>
              {s.varsayilan && <Rozet metin="varsayılan" ton="notr" />}
              <span>{ETKI_METNI[s.etki]}</span>
              <span style={MUTED}>· {notOkunamadi ? '?' : n} aktif not</span>
              {s.aciklama && <span style={MUTED}>· {s.aciklama}</span>}
              <span className="ml-auto inline-flex gap-1.5">
                <button
                  type="button"
                  className={BTN}
                  style={btnStil()}
                  onClick={() => setForm({ ilk: { ...s }, yeni: false })}
                >
                  Düzenle
                </button>
                <OnayliDugme
                  etiket="Sil"
                  soru={`“${s.baslik}” sınıfı silinsin mi?`}
                  disabled={mesgul || !!neden}
                  title={neden}
                  onEvet={() => onSil(s.ad)}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Pencere ──────────────────────────────────────────────────────────────────────────────────────
export default function NotYonetimi({
  baslangic = 'AKTIF',
  onKapat,
  onAc,
}: {
  baslangic?: NotSuzgeci | 'SINIFLAR';
  /** `degisti`: pencerede bir şey yazıldıysa çağıran kararları tazeler. */
  onKapat: (degisti: boolean) => void;
  onAc?: (anahtar: string) => void;
}) {
  const [bolum, setBolum] = useState<'notlar' | 'siniflar'>(
    baslangic === 'SINIFLAR' ? 'siniflar' : 'notlar',
  );
  const [veri, setVeri] = useState<ShNotlarSonuc | null>(null);
  const [hata, setHata] = useState('');
  const [tazele, setTazele] = useState(0);
  const [mesgul, setMesgul] = useState(false);
  const [degisti, setDegisti] = useState(false);
  useAsyncEffect(
    async (alive) => {
      try {
        const r = await serverHubApi.notlarListe();
        if (!alive()) return;
        if (!r || !Array.isArray(r.notlar)) throw new Error('Not listesi yanıtı okunamadı.');
        setVeri(r);
        setHata('');
      } catch (e) {
        if (alive()) setHata(hataMetni(e));
      }
    },
    [tazele],
  );
  const yaz = async (is: () => Promise<unknown>, basari: string): Promise<boolean> => {
    setMesgul(true);
    try {
      await is();
      toast.success(basari);
      setDegisti(true);
      setTazele((n) => n + 1);
      return true;
    } catch (e) {
      toast.error(hataMetni(e));
      return false;
    } finally {
      setMesgul(false);
    }
  };
  const notIslem = (ne: 'ARSIV' | 'GERI_AL' | 'SIL', id: number) =>
    void yaz(
      () =>
        ne === 'ARSIV'
          ? serverHubApi.notArsivle(id)
          : ne === 'GERI_AL'
            ? serverHubApi.notGeriAl(id)
            : serverHubApi.notKaliciSil(id),
      ne === 'ARSIV'
        ? 'Not arşivlendi.'
        : ne === 'GERI_AL'
          ? 'Not geri alındı.'
          : 'Not kalıcı silindi.',
    );
  return (
    <Modal
      open
      onClose={() => onKapat(degisti)}
      title="Notlar ve sınıflar"
      subtitle="Bütün Admin notları (arşiv ve konusu bulunamayanlar dahil) ve sınıf taksonomisi. Taramalar bunları silmez."
      size="xl"
    >
      <div className="space-y-3" data-testid="not-yonetimi">
        <div className="flex gap-1.5" role="group" aria-label="Bölüm">
          {(
            [
              ['notlar', `Notlar${veri ? ` (${veri.notlar.length})` : ''}`],
              ['siniflar', `Sınıflar${veri ? ` (${veri.siniflar.length})` : ''}`],
            ] as const
          ).map(([id, ad]) => (
            <button
              key={id}
              type="button"
              className={BTN}
              style={btnStil(bolum === id)}
              aria-pressed={bolum === id}
              onClick={() => setBolum(id)}
            >
              {ad}
            </button>
          ))}
        </div>
        {hata ? (
          <LoadError
            compact
            title="Notlar okunamadı"
            message={hata}
            onRetry={() => setTazele((n) => n + 1)}
          />
        ) : !veri ? (
          <div className="text-xs py-2" style={MUTED}>
            okunuyor…
          </div>
        ) : (
          <>
            {veri.okunamadi && (
              <LoadError
                compact
                title="Not tablosu okunamadı"
                message={veri.hata || 'Portal DB okunamadı; liste boş görünüyor olabilir.'}
              />
            )}
            {bolum === 'notlar' ? (
              <NotlarBolumu
                veri={veri}
                baslangic={baslangic === 'SINIFLAR' ? 'AKTIF' : baslangic}
                mesgul={mesgul}
                onIslem={notIslem}
                onAc={
                  onAc
                    ? (a) => {
                        onAc(a);
                        onKapat(degisti);
                      }
                    : undefined
                }
              />
            ) : (
              <SiniflarBolumu
                siniflar={veri.siniflar}
                notlar={veri.notlar}
                notOkunamadi={veri.okunamadi}
                mesgul={mesgul}
                onKaydet={(s) => yaz(() => serverHubApi.sinifKaydet(s), 'Sınıf kaydedildi.')}
                onSil={(ad) => void yaz(() => serverHubApi.sinifSil(ad), 'Sınıf silindi.')}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
