// src/components/server_hub/EarTemizlikToplu.tsx — Server Hub › EAR Temizliği: toplu teyit ve toplu iptal pencereleri
// (2026-11-16, Admin).
//
// Kullanıcı: "çıktı neredeyse istediğim gibi; toplu halde temizlik için gerekli düzenlemeyi yap" (örnek: 8 PROD
// sunucuda aynı EAR). Önceki şart geçerli: silmeden önce HER EAR'ın ls -ltr çıktısı görülür ve kullanıcı teyit eder.
// Toplu teyit penceresi her kaydın çıktısını ayrı ayrı gösterir; onay metni tam "<n> EAR SIL" (n = dahil edilen).
// Sunucu (server/server-hub/ear-temizlik.cjs) hepsi-ya-hiç doğrular; aynı sunucudaki silmeleri sırayla başlatır
// (betik EAR kökünde kilit alır). Bu dosya ayrıca sekmeyle ortak küçük yardımcıları taşır (döngüsel içe aktarma
// olmasın diye burada).
import React, { useMemo, useState } from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { serverHubApi, type EtKayit, type EtTopluSilYanit } from '@/api/serverHubApi';
import { fmtNumber } from '@/utils/datetime';
import { Modal } from '@/components/common/Modal';

/** Toplu teyitte bir kaydın ls -ltr çıktısının kısaltılmış gösterimindeki satır sayısı. */
export const LS_KISA_SATIR = 8;
/** Kısaltılmış gösterimde baştan gösterilen satır (dizin satırı + "total"); gerisi SONDAN gösterilir. */
export const LS_BAS_SATIR = 2;
/** Sunucu sözleşmesi: toplu on kontrol ve toplu silme en çok bu kadar öğe alır. */
export const TOPLU_UST_SINIR = 50;

/** KB değerini okunur boyuta çevirir ("812 KB", "3,4 MB", "1,2 GB"). */
export function kbMetin(v: string | number | null | undefined): string {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return '—';
  if (n >= 1024 * 1024) return `${fmtNumber(Math.round(n / 1024 / 102.4) / 10)} GB`;
  if (n >= 1024) return `${fmtNumber(Math.round(n / 102.4) / 10)} MB`;
  return `${fmtNumber(n)} KB`;
}

/** Saniyeyi "dd:ss" biçimine çevirir (eksi değer 00:00). */
export function sureMetni(sn: number): string {
  const s = Math.max(0, Math.floor(sn));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Toplu silme onay metni: sunucu birebir bunu bekler. */
export const topluOnayMetni = (n: number) => `${n} EAR SIL`;

export function ProdRozeti() {
  return (
    <span
      className="ml-1 rounded px-1 text-[10px] font-semibold border"
      style={{ color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
      data-testid="et-prod"
    >
      PROD
    </span>
  );
}

export function SiradaRozeti() {
  return (
    <span
      className="ml-1 rounded px-1 text-[10px] font-semibold border"
      style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
      data-testid="et-sirada"
      title="Silme istendi; aynı sunucudaki silme bitince kuyruktan başlar"
    >
      sırada
    </span>
  );
}

const hataMetni = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Toplu teyit penceresindeki bir öğe: kayıt, bu andaki kalan saniye ve taze taramadaki engel. */
export type TopluOge = { k: EtKayit; kalan: number | null; engel: string | null };

/** Öğe toplu silmeye dahil edilebilir mi; edilemiyorsa nedeni (null = edilebilir). */
export function haricNedeni(o: TopluOge): string | null {
  if (o.k.durum !== 'PLAN_HAZIR' || o.k.sirada || !o.k.plan || o.k.planJobId == null)
    return 'Plan artık teyit beklemiyor';
  // Kullanıcı şartı: her EAR'ın ls -ltr çıktısı görülmeden silinmez; boş çıktı teyit edilemez.
  if (!o.k.plan.ls.length) return 'ls -ltr çıktısı yok; yeniden ön kontrol yapın';
  if (o.engel) return o.engel;
  if (o.kalan == null) return 'Plan geçerlilik süresi bilinmiyor; yeniden ön kontrol yapın';
  if (o.kalan <= 0) return 'Plan süresi doldu; yeniden ön kontrol yapın';
  return null;
}

/**
 * ls -ltr kısaltması: eskiden yeniye sıralı olduğu için EN YENİ dosyalar sondadır (son deploy izi); kısaltmada
 * baştaki dizin/"total" satırları ve SON satırlar görünür, aradakiler "… N satır gizli" ile belirtilir.
 */
export function lsKisalt(ls: string[], acik: boolean): string[] {
  if (acik || ls.length <= LS_KISA_SATIR) return ls;
  const son = LS_KISA_SATIR - LS_BAS_SATIR;
  const gizli = ls.length - LS_KISA_SATIR;
  return [
    ...ls.slice(0, LS_BAS_SATIR),
    `… ${fmtNumber(gizli)} satır gizli (eski dosyalar) …`,
    ...ls.slice(ls.length - son),
  ];
}

const bilgiDegeri = (k: EtKayit, anahtar: string) =>
  k.plan?.info.find((x) => x.anahtar === anahtar)?.deger ?? null;

function TopluOgeSatiri({
  o,
  dahil,
  acik,
  onDahil,
  onAc,
}: {
  o: TopluOge;
  dahil: boolean;
  acik: boolean;
  onDahil: (v: boolean) => void;
  onAc: (v: boolean) => void;
}) {
  const k = o.k;
  const neden = haricNedeni(o);
  const ls = k.plan?.ls || [];
  const uzun = ls.length > LS_KISA_SATIR;
  const gosterilen = lsKisalt(ls, acik);
  const war = bilgiDegeri(k, 'war');
  const alanlar: { etiket: string; deger: string }[] = [
    { etiket: 'Boyut', deger: kbMetin(bilgiDegeri(k, 'boyut_kb')) },
    { etiket: 'Dosya sayısı', deger: bilgiDegeri(k, 'dosya_sayisi') ?? '—' },
    { etiket: 'WAR', deger: war === '0' ? '0 (WAR yok)' : (war ?? '—') },
    { etiket: 'domain.xml', deger: bilgiDegeri(k, 'domain_xml') ?? '—' },
    { etiket: 'Süreç', deger: bilgiDegeri(k, 'surec') ?? '—' },
    {
      etiket: 'Kalan süre',
      deger: o.kalan == null ? 'bilinmiyor' : o.kalan <= 0 ? 'süre doldu' : sureMetni(o.kalan),
    },
  ];
  return (
    <li
      className="rounded-lg border p-3 space-y-2"
      style={{
        borderColor: neden ? 'var(--border-subtle)' : 'var(--status-danger)',
        opacity: neden ? 0.7 : 1,
      }}
      data-testid="et-toplu-oge"
    >
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={dahil}
          disabled={!!neden}
          onChange={(e) => onDahil(e.target.checked)}
          aria-label={`Dahil: ${k.host} ${k.kok}/${k.ad}`}
        />
        <span>
          <span className="font-mono font-semibold">{k.host}</span>
          {k.prod && <ProdRozeti />}{' '}
          <span className="font-mono">
            {k.kok}/{k.ad}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            {' '}
            — JBoss {k.jboss}, ön kontrol işi #{k.planJobId ?? '—'}
          </span>
        </span>
      </label>
      {neden && (
        <div
          className="text-[11px] flex items-start gap-1"
          style={{ color: 'var(--status-danger)' }}
          data-testid="et-toplu-haric"
        >
          <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0" />
          <span>Hariç: {neden}</span>
        </div>
      )}
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5 text-[11px]">
        {alanlar.map((a) => (
          <div key={a.etiket} className="flex gap-1 min-w-0">
            <dt style={{ color: 'var(--text-muted)' }}>{a.etiket}:</dt>
            <dd className="font-mono break-all">{a.deger}</dd>
          </div>
        ))}
      </dl>
      <div
        className="rounded border max-h-64 overflow-auto"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}
      >
        <pre
          className="font-mono text-[11px] leading-snug p-2 whitespace-pre w-max min-w-full"
          data-testid="et-toplu-ls"
        >
          {gosterilen.length ? gosterilen.join('\n') : '(çıktı yok)'}
        </pre>
      </div>
      {uzun && (
        <button
          type="button"
          className="text-[11px] underline"
          style={{ color: 'var(--accent)' }}
          onClick={() => onAc(!acik)}
        >
          {acik
            ? 'Kısalt (baş ve son satırlar)'
            : `Tamamını göster (${fmtNumber(ls.length)} satır)`}
        </button>
      )}
    </li>
  );
}

export function TopluTeyitPenceresi({
  ogeler,
  onKapat,
  onGonderildi,
}: {
  ogeler: TopluOge[];
  onKapat: () => void;
  onGonderildi: (ids: number[], y: EtTopluSilYanit) => void;
}) {
  const [haric, setHaric] = useState<Set<number>>(() => new Set());
  const [acik, setAcik] = useState<Set<number>>(() => new Set());
  const [yazilan, setYazilan] = useState('');
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [reddedilenler, setReddedilenler] = useState<{ id: number; message: string }[]>([]);

  const dahil = useMemo(
    () => ogeler.filter((o) => !haricNedeni(o) && !haric.has(o.k.id)),
    [ogeler, haric],
  );
  const n = dahil.length;
  const beklenen = topluOnayMetni(n);
  const prodSayisi = dahil.filter((o) => o.k.prod).length;
  const toplamKb = dahil.reduce((t, o) => t + (Number(bilgiDegeri(o.k, 'boyut_kb')) || 0), 0);
  const asti = n > TOPLU_UST_SINIR;
  const etkin = n > 0 && !asti && yazilan === beklenen && !gonderiliyor;
  const neden =
    n === 0
      ? 'Dahil edilen kayıt yok'
      : asti
        ? `En çok ${fmtNumber(TOPLU_UST_SINIR)} kayıt tek seferde silinebilir`
        : yazilan !== beklenen
          ? `Onaylamak için tam “${beklenen}” yazın`
          : undefined;

  const kume = (s: Set<number>, id: number, ekle: boolean) => {
    const m = new Set(s);
    if (ekle) m.add(id);
    else m.delete(id);
    return m;
  };

  const sil = async () => {
    if (!etkin) return;
    setGonderiliyor(true);
    setHata(null);
    setReddedilenler([]);
    const kayitlar = dahil.flatMap((o) =>
      o.k.planJobId == null ? [] : [{ id: o.k.id, planJobId: o.k.planJobId }],
    );
    try {
      const r = await serverHubApi.earTemizlikTopluSil({ onayMetni: yazilan, kayitlar });
      if (!r || !r.ok) {
        setReddedilenler((r && r.reddedilenler) || []);
        throw new Error((r && r.message) || 'Toplu silme başlatılamadı.');
      }
      onGonderildi(
        kayitlar.map((x) => x.id),
        r,
      );
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setGonderiliyor(false);
    }
  };

  const ogeAdi = (id: number) => {
    const o = ogeler.find((x) => x.k.id === id);
    return o ? `${o.k.host} ${o.k.kok}/${o.k.ad}` : `#${id}`;
  };

  return (
    <Modal
      open
      onClose={onKapat}
      title="Hazır olanları toplu teyit et"
      subtitle={`${fmtNumber(ogeler.length)} plan — her birinin ls -ltr çıktısını inceleyin`}
      size="wide"
      dismissOnBackdrop={false}
      footer={
        <>
          <button
            type="button"
            className="btn-danger"
            disabled={!etkin}
            title={neden}
            onClick={() => void sil()}
          >
            {gonderiliyor ? 'Başlatılıyor…' : `Sil (${fmtNumber(n)})`}
          </button>
          <button type="button" className="btn-secondary" onClick={onKapat}>
            İptal
          </button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]" data-testid="et-toplu-teyit">
        <p>
          Her EAR için ön kontrol işinin salt okunur ls -ltr çıktısı aşağıdadır. Onaydan sonra her
          biri için AWX parmak izini yeniden hesaplar; içerik değiştiyse o EAR{' '}
          <strong>silinmez</strong>. Değişmediyse önce tar.gz yedek alınır, sonra silinir. Aynı
          sunucudaki silmeler sırayla başlar. Süresi dolan ya da engeli olan plan otomatik hariç
          tutulur.
        </p>
        <ul className="space-y-2">
          {ogeler.map((o) => (
            <TopluOgeSatiri
              key={o.k.id}
              o={o}
              dahil={!haricNedeni(o) && !haric.has(o.k.id)}
              acik={acik.has(o.k.id)}
              onDahil={(v) => setHaric((s) => kume(s, o.k.id, !v))}
              onAc={(v) => setAcik((s) => kume(s, o.k.id, v))}
            />
          ))}
        </ul>
        <p
          className="rounded-lg border px-3 py-2 text-[12px] tabular-nums"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
          data-testid="et-toplu-ozet"
        >
          Dahil: {fmtNumber(n)} / {fmtNumber(ogeler.length)} EAR · PROD: {fmtNumber(prodSayisi)} ·
          Toplam boyut: {kbMetin(toplamKb)}
        </p>
        <label className="block">
          <span className="text-[12px]">
            Onaylamak için yazın: <span className="font-mono font-semibold">{beklenen}</span>
          </span>
          <input
            type="text"
            className="input-modern mt-1 w-full font-mono"
            value={yazilan}
            onChange={(e) => setYazilan(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label="Toplu onay metni"
          />
        </label>
        {hata && (
          <div
            className="rounded-lg border px-3 py-2 text-[12px] space-y-1"
            role="alert"
            style={{ borderColor: 'var(--status-danger)', color: 'var(--status-danger)' }}
          >
            <div>{hata}</div>
            {reddedilenler.length > 0 && (
              <ul className="list-disc pl-5" data-testid="et-toplu-red">
                {reddedilenler.map((x) => (
                  <li key={x.id}>
                    <span className="font-mono">{ogeAdi(x.id)}</span>: {x.message}
                  </li>
                ))}
              </ul>
            )}
            {reddedilenler.length > 0 && (
              <div>Hiçbir kayıt değişmedi; reddedilenleri hariç tutup yeniden deneyin.</div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Tekli "Sıradan çıkar" onayı (toplu iptal gibi onaylı; geri almak yeniden ön kontrol + teyit ister). */
export function SiradanCikarPenceresi({
  k,
  onKapat,
  onOnay,
}: {
  k: EtKayit;
  onKapat: () => void;
  onOnay: () => void;
}) {
  return (
    <Modal
      open
      onClose={onKapat}
      title="Sıradan çıkar"
      subtitle={`${k.host} — ${k.kok}/${k.ad}`}
      footer={
        <>
          <button type="button" className="btn-danger" onClick={onOnay}>
            Sıradan çıkar
          </button>
          <button type="button" className="btn-secondary" onClick={onKapat}>
            Kapat
          </button>
        </>
      }
    >
      <p className="text-[13px]" data-testid="et-siradan-cikar">
        Bu EAR için istenen silme henüz başlamadı; sıradan çıkarılırsa plan iptal edilir. Yeniden
        silmek için ön kontrol ve teyit baştan yapılır.
      </p>
    </Modal>
  );
}

export function TopluIptalPenceresi({
  topluId,
  sirada,
  onKapat,
  onBitti,
}: {
  topluId: string;
  sirada: number;
  onKapat: () => void;
  onBitti: (iptal: number, suren: number) => void;
}) {
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const iptalEt = async () => {
    setGonderiliyor(true);
    setHata(null);
    try {
      const r = await serverHubApi.earTemizlikTopluIptal(topluId);
      if (!r || !r.ok) throw new Error((r && r.message) || 'Sıradakiler iptal edilemedi.');
      onBitti(r.iptal ?? 0, r.suren ?? 0);
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setGonderiliyor(false);
    }
  };
  return (
    <Modal
      open
      onClose={onKapat}
      title="Sıradakileri iptal et"
      subtitle={`Toplu işlem ${topluId.slice(0, 8)}`}
      footer={
        <>
          <button
            type="button"
            className="btn-danger"
            disabled={gonderiliyor}
            onClick={() => void iptalEt()}
          >
            {gonderiliyor ? 'İptal ediliyor…' : `Sıradakileri iptal et (${fmtNumber(sirada)})`}
          </button>
          <button type="button" className="btn-secondary" onClick={onKapat}>
            Kapat
          </button>
        </>
      }
    >
      <div className="space-y-2 text-[13px]" data-testid="et-toplu-iptal">
        <p>
          Bu toplu işlemde henüz başlamamış {fmtNumber(sirada)} silme iptal edilir. Şu anda
          yedeklenip silinmekte olanlara dokunulmaz; onlar tamamlanır.
        </p>
        {hata && (
          <p
            className="rounded-lg border px-3 py-2 text-[12px]"
            role="alert"
            style={{ borderColor: 'var(--status-danger)', color: 'var(--status-danger)' }}
          >
            {hata}
          </p>
        )}
      </div>
    </Modal>
  );
}
