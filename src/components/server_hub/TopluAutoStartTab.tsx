// src/components/server_hub/TopluAutoStartTab.tsx — Server Hub › Toplu Auto-Start (2026-11-14).
//
// Kullanıcı: "auto-start'lari toplu duzeltebilmek icin bir sayfa ve tek bir buton hazirlayabilir misin?"
//
// Güvenlik modeli (server/server-hub/toplu-autostart.cjs başlığı): liste yalnız TAZE taramada auto-start'ı
// uyumsuz JVM'ler (çalışıyor + kapalı → AÇ, durmuş + açık → KAPAT). TEK düğme önce salt okunur PLAN işi açar
// (canlı değer jboss-cli ile okunur; artık uyumsuz olmayan düşer), sonra onay; onaydan sonra sunucu başına
// en çok N JVM'lik AWX işleri (Admin › Kurallar & Limitler "Toplu iş başına JVM", 2026-11-15), işler SIRAYLA. Yürütme sunucu tarafında: sayfa yenilense ya da başka admin açsa da ilerleme
// görünür. Gizli sekme yoklama yapmaz (useSekmeGorunur). Doğrulanan öğe açık sunucu paneline ve Bulgular'a
// hemen yansır (autoStartSonucYay).
//
// 2026-11-15 ("olur ekle lütfen"): domain'i kapalı (taramada host controller çalışmayan) JVM'ler artık "listeye alınmayan"
// değil, ayrı bölüm: "Domain kapalı — auto-start host XML üzerinden kapat" (TopluXmlKapat.tsx). Aynı motor, ayrı toplu iş
// (CLI öğeleriyle karışmaz); iş tablosunda bu öğeler "host XML" etiketi taşır; prod sunucu onayda ayrıca işaret ister.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import {
  serverHubApi,
  type ShTopluAday,
  type ShTopluAdaylar,
  type ShTopluIs,
  type ShTopluOge,
  type ShTopluOgeDurum,
  type ShTopluSecim,
} from '@/api/serverHubApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { toast } from '@/hooks/useToast';
import { fmtNumber, fmtDateTime } from '@/utils/datetime';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { useOnay } from '@/components/common/OnayPenceresi';
import { useSekmeGorunur } from './sekmeGorunurlugu';
import {
  AdayBolumuUstu,
  AdayNotlari,
  DislananlarListesi,
  TopluAdayTablosu,
  TopluIsBasligi,
  planKalanMs,
  useTopluYoklama,
} from './topluOrtak';
import { belirsizHataMi, belirsizMesaji, belirsizSonrasiIs } from './topluBelirsiz';
import { autoStartSonucYay } from './autoStartIsi';
import { AUTOSTART_BASARISIZ, kategoriyeGore, type TopluKategori } from './topluSiniflama';
import { KategoriEtiketi, TopluKategoriFiltresi } from './TopluKategoriFiltresi';
import {
  TopluXmlKapatBolumu,
  XmlOnayPenceresi,
  prodOgesiMi,
  prodOnayRedMi,
  xmlKapsami,
  xmlOgesiMi,
  xmlSecimi,
  type XmlOnayKapsami,
} from './TopluXmlKapat';

/** Yoklama aralığı (sunucu yürütücüsü 10 sn'de bir ilerler). */
export const YOKLAMA_MS = 4000;
/** Onay bekleyen iste (PLAN_HAZIR) seyrek yoklama: baska admin onaylar / iptal eder ya da sure dolar. */
export const PLAN_YOKLAMA_MS = 30000;
/** Plan gecerliligi (sunucu PLAN_YAS_MS ile ayni). */
export const PLAN_GECERLILIK_MS = 15 * 60 * 1000;
const YURUYEN = new Set(['PLANLANIYOR', 'CALISIYOR', 'IPTAL_ISTENDI']);
const anahtar = (x: { host: string; gen: number; jvm: string }) => `${x.host}|${x.gen}|${x.jvm}`;

const IS_ETIKET: Record<string, string> = {
  PLANLANIYOR: 'Plan okunuyor (salt okunur)',
  PLAN_HAZIR: 'Plan hazır — onay bekliyor',
  CALISIYOR: 'Uygulanıyor (sunucular sırayla)',
  IPTAL_ISTENDI: 'İptal istendi — süren iş bitince durur',
  BITTI: 'Bitti',
  BITTI_HATALI: 'Bitti — hatalı öğe var',
  IPTAL: 'İptal edildi',
  YARIM_KALDI: 'Yarım kaldı (Portal yeniden başladı)',
  PLAN_HATA: 'Plan okunamadı',
  PLAN_ESKIDI: 'Plan eskidi (bitişinden 15 dk sonra)',
};
const OGE_ETIKET: Record<ShTopluOgeDurum, string> = {
  SECIM: 'seçim doğrulanıyor (taze tarama)',
  ADAY: 'sırada (plan)',
  PLANLANIYOR: 'canlı değer okunuyor',
  PLAN_GECTI: 'uygulanacak',
  DUSTU: 'düştü',
  BEKLIYOR: 'sırada',
  BASLATILIYOR: 'başlatılıyor',
  CALISIYOR: 'çalışıyor',
  OK: 'OK',
  SKIP: 'zaten hedefte',
  FAIL: 'BAŞARISIZ',
  IPTAL: 'iptal',
  YARIM_KALDI: 'yarım kaldı',
};
const kirmiziMi = (d: string) => d === 'BITTI_HATALI' || d === 'PLAN_HATA' || d === 'YARIM_KALDI';
const ogeRengi = (d: ShTopluOgeDurum) =>
  d === 'OK' || d === 'SKIP' || d === 'PLAN_GECTI'
    ? 'var(--status-success)'
    : d === 'FAIL' || d === 'YARIM_KALDI'
      ? 'var(--status-danger)'
      : d === 'DUSTU' || d === 'IPTAL'
        ? 'var(--status-warning)'
        : 'var(--text-muted)';

/**
 * AWX işi sayısı: her sunucunun JVM'leri en çok isBasina'lık işlere bölünür (sunucudaki
 * server/server-hub/toplu-autostart.cjs parcala ile aynı kural).
 */
export function awxIsSayisi(liste: { host: string }[], isBasina: number): number {
  const n = Math.max(1, Math.floor(isBasina) || 1);
  const say = new Map<string, number>();
  for (const x of liste) say.set(x.host, (say.get(x.host) || 0) + 1);
  let toplam = 0;
  for (const k of say.values()) toplam += Math.ceil(k / n);
  return toplam;
}

/**
 * Sonucu belirsiz öğe (AWX'e gitmiş / AWX'te sürüyor olabilir): sunucudaki BELIRSIZ_IZ ("sonucu belirsiz") ya da
 * eski kayıtlardaki "AWX'e gitmiş olabilir". "çalıştırılmadı: toplu iş durduruldu" satırı belirsiz DEĞİLDİR.
 */
export function belirsizMi(o: { durum: string; neden?: string | null }): boolean {
  if (o.durum !== 'YARIM_KALDI' && o.durum !== 'FAIL') return false;
  const t = String(o.neden ?? '');
  if (/^çalıştırılmadı/.test(t)) return false;
  return /sonucu belirsiz|AWX['’]e gitmiş olabilir/.test(t);
}

/** Açılan AWX işi sayısı: (sunucu, iş numarası) çifti başına bir iş (parça = aynı iş numarasını taşıyan öğeler). */
export function acilanIsSayisi(ogeler: ShTopluOge[], tur: 'plan' | 'uygulama'): number {
  const k = new Set<string>();
  for (const o of ogeler) {
    const id = tur === 'plan' ? o.planJobId : o.awxJobId;
    if (id == null) continue;
    k.add(tur === 'plan' ? String(id) : `${o.awxServerId ?? ''}|${id}`);
  }
  return k.size;
}

/** "12 AWX işi, iş başına en çok 10 JVM" */
export const isOzeti = (liste: { host: string }[], isBasina: number): string =>
  `${fmtNumber(awxIsSayisi(liste, isBasina))} AWX işi, iş başına en çok ${fmtNumber(isBasina)} JVM`;

/** Onay metni: kapsam, iş sayısı ve sıra açıkça yazılır. isBasina: AWX işi başına en çok JVM (bilinmiyorsa null). */
export function onayMetni(ogeler: ShTopluOge[], isBasina: number | null = null): string {
  const gecen = ogeler.filter((o) => o.durum === 'PLAN_GECTI');
  const hostlar = [...new Set(gecen.map((o) => o.host))];
  const ac = gecen.filter((o) => o.hedef === 'true').length;
  const sira =
    isBasina != null
      ? `Her sunucunun JVM'leri iş başına en çok ${fmtNumber(isBasina)} JVM'lik AWX işlerine bölünür (${isOzeti(gecen, isBasina)}); işler tek tek, sırayla çalışır (bir sunucunun işleri bitmeden sonraki sunucuya geçilmez). `
      : 'Her sunucu için ayrı AWX işi açılır, işler sırayla çalışır. ';
  return (
    `${gecen.length} JVM, ${hostlar.length} sunucu: ${ac} JVM'de auto-start AÇILACAK, ${gecen.length - ac} JVM'de KAPATILACAK.\n\n` +
    sira +
    'Bir işteki hata ötekileri durdurmaz (özet kırmızı olur); sonucu belirsiz iş (AWX’te sürüyor olabilir) toplu işi durdurur. ' +
    'Her JVM canlı değeri yeniden okunarak yazılır ve geri okunarak doğrulanır.\n\nDevam edilsin mi?'
  );
}

function Rozet({ durum }: { durum: string }) {
  const renk = kirmiziMi(durum)
    ? 'var(--status-danger)'
    : durum === 'BITTI'
      ? 'var(--status-success)'
      : YURUYEN.has(durum) || durum === 'PLAN_HAZIR'
        ? 'var(--accent)'
        : 'var(--status-warning)';
  return (
    <span
      className="text-[11px] font-semibold px-2 py-0.5 rounded-full border"
      style={{ color: renk, borderColor: renk }}
    >
      {IS_ETIKET[durum] || durum}
    </span>
  );
}

function AdayTablosu({
  baslik,
  satirlar,
  secili,
  setSecili,
  kilitli,
}: {
  baslik: string;
  satirlar: ShTopluAday[];
  secili: Set<string>;
  setSecili: (f: (s: Set<string>) => Set<string>) => void;
  kilitli: boolean;
}) {
  return (
    <TopluAdayTablosu
      satirlar={satirlar}
      anahtar={anahtar}
      secili={secili}
      setSecili={setSecili}
      kilitli={kilitli}
      baslik={baslik}
      tumunuEtiketi={`${baslik}: tümünü seç`}
      kolonlar={['Sunucu', 'Ortam', 'JVM', 'Taramada', 'Tarama']}
      hucreler={(x) => (
        <>
          <td className="px-3 py-1 font-mono">{x.host}</td>
          <td className="px-3 py-1">{x.env || '—'}</td>
          <td className="px-3 py-1 font-mono">
            {x.jvm} <span style={{ color: 'var(--text-muted)' }}>JBoss {x.gen}</span>
          </td>
          <td className="px-3 py-1">
            {x.running ? 'çalışıyor' : 'durmuş'} · auto-start{' '}
            {x.autoStart === 'true' ? 'açık' : 'kapalı'}
          </td>
          <td className="px-3 py-1" style={{ color: 'var(--text-muted)' }}>
            {x.scanDate || '—'}
          </td>
        </>
      )}
    />
  );
}

function OgeTablosu({ ogeler }: { ogeler: ShTopluOge[] }) {
  return (
    <div
      className="overflow-x-auto rounded-lg border"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <table className="w-full text-[12px]">
        <thead>
          <tr style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
            <th className="px-3 py-1 text-left font-medium">Sunucu</th>
            <th className="px-3 py-1 text-left font-medium">JVM</th>
            <th className="px-3 py-1 text-left font-medium">Hedef</th>
            <th className="px-3 py-1 text-left font-medium">Durum</th>
            <th className="px-3 py-1 text-left font-medium">Neden / sonuç</th>
            <th className="px-3 py-1 text-left font-medium">İş</th>
          </tr>
        </thead>
        <tbody>
          {ogeler.map((o) => (
            <tr
              key={o.id}
              className="border-t align-top"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <td className="px-3 py-1 font-mono">{o.host}</td>
              <td className="px-3 py-1 font-mono">
                {o.jvm} <span style={{ color: 'var(--text-muted)' }}>JBoss {o.gen}</span>
              </td>
              <td className="px-3 py-1 whitespace-nowrap">
                {o.hedef === 'true' ? 'AÇ' : 'KAPAT'}
                {xmlOgesiMi(o) && (
                  <span
                    className="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border"
                    style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
                    title="Domain kapalı: auto-start host XML dosyasında kapatılır (canlı CLI yok)."
                  >
                    host XML
                  </span>
                )}
              </td>
              <td className="px-3 py-1 font-semibold" style={{ color: ogeRengi(o.durum) }}>
                {OGE_ETIKET[o.durum] || o.durum}
                {o.dogrulandi ? ' · doğrulandı' : ''}
              </td>
              <td className="px-3 py-1" style={{ color: 'var(--text-secondary)' }}>
                <KategoriEtiketi oge={o} basarisiz={AUTOSTART_BASARISIZ} />
                {o.neden || '—'}
              </td>
              <td className="px-3 py-1 tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {o.awxJobId ? `#${o.awxJobId}` : o.planJobId ? `plan #${o.planJobId}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TopluAutoStartTab() {
  const gorunur = useSekmeGorunur();
  const { onayla, onayPenceresi } = useOnay();
  const [veri, setVeri] = useState<ShTopluAdaylar | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [secili, setSecili] = useState<Set<string>>(new Set());
  // Host XML (domain kapalı) seçimi: domain anahtarları (host|gen); varsayılan boş (prod dahil bilinçli seçim).
  const [xmlSecili, setXmlSecili] = useState<Set<string>>(new Set());
  // Host XML onay penceresi: plan (olusturma) ya da uygulama onayı; prodOnay sunucuya gönderilir.
  const [xmlOnay, setXmlOnay] = useState<{
    tur: 'plan' | 'uygula';
    kapsam: XmlOnayKapsami[];
    uyari?: string;
  } | null>(null);
  const [izlenen, setIzlenen] = useState<number | null>(null);
  const [okunanIs, setIs] = useState<ShTopluIs | null>(null);
  const [ogeler, setOgeler] = useState<ShTopluOge[]>([]);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  // Kategori seçimi izlenen işe bağlı: başka iş / yeni toplu iş açılınca seçim kendiliğinden düşer (inceleme B-F8).
  const [kategoriSecimi, setKategoriSecimi] = useState<{
    isId: number | null;
    k: TopluKategori | null;
  }>({ isId: null, k: null });
  // Bu ekranda daha once gorulen dogrulanmis ogeler (yayin bir kez; ilk okumada gorulenler yayilmaz: eski sonuc).
  const yayilan = useRef<{ isId: number | null; ids: Set<number> }>({ isId: null, ids: new Set() });

  const adaylariYukle = useCallback(async (fresh: boolean) => {
    setYukleniyor(true);
    setHata(null);
    try {
      const [a, l] = await Promise.all([
        serverHubApi.topluAutoStartAdaylar(fresh),
        serverHubApi.topluAutoStartListe(),
      ]);
      if (!a.ok) throw new Error(a.message || 'Aday listesi okunamadı.');
      setVeri(a);
      setSecili(new Set(a.adaylar.map(anahtar)));
      setXmlSecili(new Set());
      const hedef = a.aktif || (l.ok ? l.aktif || l.son[0] || null : null);
      setIzlenen(hedef ? hedef.id : null);
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useAsyncEffect(async () => {
    if (gorunur && !veri && !yukleniyor && !hata) await adaylariYukle(false);
  }, [gorunur]);

  const [simdi, setSimdi] = useState(() => Date.now());
  const durumOku = useCallback(async (id: number) => {
    const r = await serverHubApi.topluAutoStartDurum(id);
    setSimdi(Date.now());
    if (!r.ok || !r.is) return;
    setIs(r.is);
    const og = r.ogeler || [];
    setOgeler(og);
    const y = yayilan.current;
    if (y.isId !== id) {
      // ilk okuma: bu ana kadar dogrulananlar eski sonuc, yayilmaz
      yayilan.current = { isId: id, ids: new Set(og.filter((o) => o.dogrulandi).map((o) => o.id)) };
      return;
    }
    for (const o of og) {
      if (!o.dogrulandi || y.ids.has(o.id)) continue;
      y.ids.add(o.id);
      autoStartSonucYay(o.host, o.gen, o.jvm, {
        tur: o.durum === 'SKIP' ? 'skip' : 'ok',
        mesaj: o.neden || '',
        deger: o.hedef === 'false' ? 'false' : 'true',
        jobId: o.awxJobId,
      });
    }
  }, []);

  useAsyncEffect(async () => {
    if (izlenen != null) await durumOku(izlenen).catch(() => {});
  }, [izlenen, durumOku]);

  // Gosterilen is: yalniz izlenen isin okunmus satiri (izlenen degisince eski is gosterilmez).
  const is = okunanIs && okunanIs.id === izlenen ? okunanIs : null;
  const kategori = kategoriSecimi.isId === izlenen ? kategoriSecimi.k : null;
  const setKategori = (k: TopluKategori | null) => setKategoriSecimi({ isId: izlenen, k });
  // YOKLAMA: yalniz sekme gorunurken ve is yururken (ya da yarim kalmis isin calisan ogesi varken).
  const yuruyor =
    !!is &&
    (YURUYEN.has(is.durum) ||
      (is.durum === 'YARIM_KALDI' && ogeler.some((o) => o.durum === 'CALISIYOR')));
  const onayBekliyor = !!is && is.durum === 'PLAN_HAZIR';
  useTopluYoklama({
    gorunur,
    izlenen,
    yuruyor,
    onayBekliyor,
    durumOku,
    yoklamaMs: YOKLAMA_MS,
    planYoklamaMs: PLAN_YOKLAMA_MS,
  });
  const kalanMs = planKalanMs(onayBekliyor, is?.planBitisAt, PLAN_GECERLILIK_MS, simdi);
  const planDoldu = kalanMs != null && kalanMs <= 0;

  const adaylar = useMemo(() => veri?.adaylar || [], [veri]);
  const acAdaylar = useMemo(() => adaylar.filter((x) => x.eylem === 'ac'), [adaylar]);
  const kapatAdaylar = useMemo(() => adaylar.filter((x) => x.eylem === 'kapat'), [adaylar]);
  const secim = useMemo(() => adaylar.filter((x) => secili.has(anahtar(x))), [adaylar, secili]);
  const limit = veri?.limit ?? null;
  const isBasina = veri?.isBasinaJvm ?? null;
  const limitAsti = limit != null && secim.length > limit;
  const aktifVar = !!is && (YURUYEN.has(is.durum) || is.durum === 'PLAN_HAZIR');

  const xmlGruplari = useMemo(() => veri?.adaylarXml || [], [veri]);
  const xmlSecim = useMemo(() => xmlSecimi(xmlGruplari, xmlSecili), [xmlGruplari, xmlSecili]);

  // İnceleme 2026-11-15 #2: sunucu prod_onay 400'ü döndüyse kapsamın TAMAMI prod işaretli yeniden sorulur (sunucu
  // mesajı en çok 5 sunucu sayar; ekran tahmini yanılmış demektir).
  const prodOnayIste = (
    tur: 'plan' | 'uygula',
    liste: { host: string; gen: number; jvm: string }[],
    mesaj?: string,
  ) =>
    setXmlOnay({
      tur,
      kapsam: xmlKapsami(liste.map((x) => ({ host: x.host, gen: x.gen, jvm: x.jvm, prod: true }))),
      uyari: `Sunucu prod onayı istedi: ${mesaj || 'kapsamda Production / ortamı bilinmeyen sunucu var'}`,
    });

  const gonder = async (liste: ShTopluSecim[], prodOnay?: boolean) => {
    if (!liste.length || aktifVar || (limit != null && liste.length > limit)) return;
    setGonderiliyor(true);
    const baslangic = Date.now();
    const oncekiSonId = izlenen;
    try {
      const r = prodOnay
        ? await serverHubApi.topluAutoStartOlustur(liste, { prodOnay: true })
        : await serverHubApi.topluAutoStartOlustur(liste);
      if (!r.ok || r.id == null) {
        // Sunucu seçimi prod saydı (ekran saymadıysa da; ör. ortam okunamadı): pencere prod işaretiyle yeniden açılır.
        if (r.code === 'prod_onay' && !prodOnay && liste.some((x) => x.eylem === 'xml_kapat')) {
          prodOnayIste('plan', liste, r.message);
          return;
        }
        toast.error(r.message || 'Toplu iş açılamadı.');
        return;
      }
      toast.success(
        `Toplu iş #${r.id} açıldı: ${r.adet} JVM, ${r.hostSayisi} sunucu. Seçim taze taramayla doğrulanıyor; ardından canlı değerler okunur (salt okunur plan).`,
      );
      setIzlenen(r.id);
    } catch (e) {
      const mesaj = e instanceof Error ? e.message : String(e);
      if (prodOnayRedMi(e) && !prodOnay && liste.some((x) => x.eylem === 'xml_kapat')) {
        prodOnayIste('plan', liste, mesaj);
        return;
      }
      if (!belirsizHataMi(e)) {
        toast.error(mesaj);
        return;
      }
      // 5xx / ağ geçidi / ağ hatası: iş yine de açılmış olabilir — kör yeniden deneme yerine durumu yeniden oku.
      let okunan: ShTopluIs | null = null;
      let okunamadi = false;
      try {
        okunan = belirsizSonrasiIs(
          await serverHubApi.topluAutoStartListe(),
          baslangic,
          oncekiSonId,
        );
      } catch {
        okunamadi = true;
      }
      if (okunan) setIzlenen(okunan.id);
      toast.error(belirsizMesaji('Toplu auto-start', mesaj, { is: okunan, okunamadi }));
    } finally {
      setGonderiliyor(false);
    }
  };

  const planla = () =>
    gonder(secim.map((x) => ({ host: x.host, gen: x.gen, jvm: x.jvm, eylem: x.eylem })));
  const xmlProdMu = (host: string) => xmlGruplari.some((g) => g.host === host && g.prod);
  // Host XML planı: önce kapsam penceresi (prod varsa işaret); pencere onaylayınca toplu iş açılır.
  const xmlPlanla = () => {
    if (!xmlSecim.length || aktifVar) return;
    setXmlOnay({
      tur: 'plan',
      kapsam: xmlKapsami(xmlSecim.map((x) => ({ ...x, prod: xmlProdMu(x.host) }))),
    });
  };
  const xmlIs = ogeler.some(xmlOgesiMi);

  const onayGonder = async (id: number, prodOnay?: boolean) => {
    setGonderiliyor(true);
    try {
      const r = prodOnay
        ? await serverHubApi.topluAutoStartOnayla(id, { prodOnay: true })
        : await serverHubApi.topluAutoStartOnayla(id);
      if (!r.ok && r.code === 'prod_onay' && !prodOnay && xmlIs)
        prodOnayIste(
          'uygula',
          ogeler.filter((o) => o.durum === 'PLAN_GECTI'),
          r.message,
        );
      else if (!r.ok) toast.error(r.message || 'Onay verilemedi.');
      else toast.success(`Toplu iş #${id}: ${r.adet} JVM uygulanıyor (sunucular sırayla).`);
      await durumOku(id);
    } catch (e) {
      if (prodOnayRedMi(e) && !prodOnay && xmlIs)
        prodOnayIste(
          'uygula',
          ogeler.filter((o) => o.durum === 'PLAN_GECTI'),
          e instanceof Error ? e.message : String(e),
        );
      else toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setGonderiliyor(false);
    }
  };

  const onayVer = async () => {
    if (!is || is.durum !== 'PLAN_HAZIR') return;
    if (xmlIs) {
      const gecen = ogeler.filter((o) => o.durum === 'PLAN_GECTI');
      setXmlOnay({
        tur: 'uygula',
        kapsam: xmlKapsami(
          gecen.map((o) => ({
            host: o.host,
            gen: o.gen,
            jvm: o.jvm,
            prod: prodOgesiMi(o, veri?.adaylarXml),
          })),
        ),
      });
      return;
    }
    if (
      !(await onayla({
        baslik: 'Toplu auto-start',
        metin: onayMetni(ogeler, isBasina),
        onayMetni: 'Onayla ve uygula',
      }))
    )
      return;
    await onayGonder(is.id);
  };

  const xmlOnayla = (prodOnay: boolean) => {
    const o = xmlOnay;
    setXmlOnay(null);
    if (!o) return;
    if (o.tur === 'plan') void gonder(xmlSecim, prodOnay);
    else if (is && is.durum === 'PLAN_HAZIR') void onayGonder(is.id, prodOnay);
  };

  const iptalEt = async () => {
    if (!is) return;
    if (
      !(await onayla({
        baslik: 'Toplu işi iptal et',
        metin:
          is.durum === 'CALISIYOR'
            ? 'Yeni sunucu başlatılmaz; şu an süren AWX işi iptal EDİLMEZ, bitmesi beklenir ve sonucu yazılır. Bekleyen JVM’ler çalıştırılmaz.'
            : is.durum === 'PLANLANIYOR'
              ? 'Süren salt okunur plan işi (canlı değer okuma) bitince iş durur; hiçbir JVM’e dokunulmaz.'
              : 'Plan iptal edilir; hiçbir JVM’e dokunulmaz.',
        onayMetni: 'İptal et',
        iptalMetni: 'Devam etsin',
        tehlikeli: true,
      }))
    )
      return;
    try {
      const r = await serverHubApi.topluAutoStartIptal(is.id);
      if (!r.ok) toast.error(r.message || 'İptal edilemedi.');
      await durumOku(is.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const say = (d: ShTopluOgeDurum) => ogeler.filter((o) => o.durum === d).length;
  // Açılan AWX işleri (parça = aynı iş numarasını taşıyan öğeler).
  const planIsSayisi = acilanIsSayisi(ogeler, 'plan');
  const uygulamaIsSayisi = acilanIsSayisi(ogeler, 'uygulama');
  // "yarım kaldı" iki ayrı şey: sonucu belirsiz (AWX'te sürüyor olabilir; JVM kilitli) ve hiç çalıştırılmayan.
  const belirsizSayisi = ogeler.filter(belirsizMi).length;
  const calistirilmayanSayisi = ogeler.filter(
    (o) => o.durum === 'YARIM_KALDI' && !belirsizMi(o),
  ).length;
  const dusenler = ogeler.filter((o) => o.durum === 'DUSTU');
  const bitti = !!is && !YURUYEN.has(is.durum) && is.durum !== 'PLAN_HAZIR';
  // Hic uygulanmadiysa (hepsi planda / onayda dustu ya da iptal) ozet yesil 'Tamamlandi' degil, notr.
  const uygulanan = say('OK') + say('SKIP') + say('FAIL') + say('YARIM_KALDI');
  const hicUygulanmadi = bitti && !!is && uygulanan === 0 && !kirmiziMi(is.durum);

  return (
    <div className="space-y-4">
      {onayPenceresi}
      <XmlOnayPenceresi
        acik={xmlOnay !== null}
        baslik={
          xmlOnay?.tur === 'plan'
            ? 'Host XML ile auto-start kapat — plan'
            : 'Host XML ile auto-start kapat — uygula'
        }
        aciklama={
          xmlOnay?.tur === 'plan'
            ? 'Önce salt okunur plan çalışır (dosya, host adı, JVM başına mevcut değer); hiçbir şey değişmez. Uygulama için plandan sonra ayrıca onay istenir.'
            : `Sunucular sırayla, host + JBoss sürümü başına${isBasina != null ? ` en çok ${fmtNumber(isBasina)} JVM'lik` : ''} AWX işleri. Her işte önce yedek alınır; host controller o an kapalı değilse betik yazmaz (açıldıysa geri alır). Bu JVM'ler reboot'ta açılmaz.`
        }
        uyari={xmlOnay?.uyari}
        kapsam={xmlOnay?.kapsam || []}
        onayMetni={xmlOnay?.tur === 'plan' ? 'Planla' : 'Onayla ve uygula'}
        onIptal={() => setXmlOnay(null)}
        onOnayla={xmlOnayla}
      />
      <section
        className="rounded-xl border p-4 space-y-3"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
      >
        <AdayBolumuUstu
          baslik="Auto-start uyumsuz JVM’ler"
          aciklama="Yalnız taze taramada şeması okunan, tanımlı ve çalışma durumu ölçülmüş JVM’ler listelenir. Düğme önce her JVM’in canlı değerini salt okunur bir planla okur; artık uyumsuz olmayanlar düşer. Sonra onay istenir."
          latestScan={veri?.latestScan}
          yukleniyor={yukleniyor}
          veriVar={!!veri}
          hata={hata}
          onYenile={() => void adaylariYukle(true)}
        />
        {veri && (
          <>
            <AdayNotlari
              schemaUnknown={veri.schemaUnknown}
              bos={!adaylar.length}
              bosMetni="Taze taramada uyumsuz JVM yok."
            />
            <AdayTablosu
              baslik="AÇ — çalışıyor ama auto-start kapalı (reboot sonrası açılmaz)"
              satirlar={acAdaylar}
              secili={secili}
              setSecili={setSecili}
              kilitli={aktifVar}
            />
            <AdayTablosu
              baslik="KAPAT — durmuş ama auto-start açık (reboot’ta açılır)"
              satirlar={kapatAdaylar}
              secili={secili}
              setSecili={setSecili}
              kilitli={aktifVar}
            />
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={gonderiliyor || !secim.length || limitAsti || aktifVar}
                onClick={() => void planla()}
              >
                Planla ({fmtNumber(secim.length)} JVM)
              </button>
              {limit != null && (
                <span
                  className="text-[11px] tabular-nums"
                  style={{ color: limitAsti ? 'var(--status-danger)' : 'var(--text-muted)' }}
                >
                  {fmtNumber(secim.length)} / {fmtNumber(limit)} JVM
                  {limitAsti
                    ? ' — sınır aşıldı; seçimi azaltın ya da Admin › Kurallar & Limitler’den artırın'
                    : ''}
                </span>
              )}
              {isBasina != null && secim.length > 0 && (
                <span
                  className="text-[11px] tabular-nums"
                  style={{ color: 'var(--text-muted)' }}
                  data-testid="toplu-is-ozeti"
                  title="Çok JVM’li sunucu tek işte AWX zaman aşımına takılmasın diye bölünür (Admin › Kurallar & Limitler › Toplu iş başına JVM)."
                >
                  · {isOzeti(secim, isBasina)}
                </span>
              )}
              {aktifVar && (
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Toplu iş #{is?.id} aktif — bitene ya da iptal edilene kadar yenisi açılmaz.
                </span>
              )}
            </div>
            {/* Domain kapalı (host XML) adayları burada değil, aşağıdaki ayrı bölümde. */}
            <DislananlarListesi
              liste={veri.dislananlar}
              anahtar={anahtar}
              ozet="Uyumsuz görünen ama listeye alınmayan"
            />
          </>
        )}
      </section>

      {veri && xmlGruplari.length > 0 && (
        <TopluXmlKapatBolumu
          gruplar={xmlGruplari}
          secili={xmlSecili}
          setSecili={setXmlSecili}
          kilitli={aktifVar}
          gonderiliyor={gonderiliyor}
          limit={limit}
          onPlanla={xmlPlanla}
        />
      )}

      {is && (
        <section
          className="rounded-xl border p-4 space-y-3"
          style={{
            borderColor: kirmiziMi(is.durum) ? 'var(--status-danger)' : 'var(--border-subtle)',
            background: 'var(--bg-surface)',
          }}
          aria-label={`Toplu iş #${is.id}`}
        >
          <TopluIsBasligi
            is={is}
            baslik={`Toplu iş #${is.id}`}
            rozet={<Rozet durum={is.durum} />}
            onayMetni="Onayla ve uygula"
            gecen={say('PLAN_GECTI')}
            gonderiliyor={gonderiliyor}
            planDoldu={planDoldu}
            onOnay={() => void onayVer()}
            onIptal={() => void iptalEt()}
          />
          <div
            className="text-[12px] tabular-nums flex gap-3 flex-wrap"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span>{fmtNumber(ogeler.length)} JVM</span>
            {(planIsSayisi > 0 || uygulamaIsSayisi > 0) && (
              <span data-testid="toplu-awx-isleri">
                AWX işi: plan {fmtNumber(planIsSayisi)}
                {uygulamaIsSayisi ? ` · uygulama ${fmtNumber(uygulamaIsSayisi)}` : ''}
                {isBasina != null ? ` (iş başına en çok ${fmtNumber(isBasina)} JVM)` : ''}
              </span>
            )}
            <span>
              uygulanacak / uygulanan{' '}
              {fmtNumber(
                ogeler.length - say('DUSTU') - say('SECIM') - say('ADAY') - say('PLANLANIYOR'),
              )}
            </span>
            <span>düşen {fmtNumber(say('DUSTU'))}</span>
            <span style={{ color: 'var(--status-success)' }}>OK {fmtNumber(say('OK'))}</span>
            <span>zaten hedefte {fmtNumber(say('SKIP'))}</span>
            <span style={{ color: say('FAIL') ? 'var(--status-danger)' : undefined }}>
              başarısız {fmtNumber(say('FAIL'))}
            </span>
            {belirsizSayisi > 0 && (
              <span
                style={{ color: 'var(--status-danger)' }}
                data-testid="toplu-belirsiz"
                title="AWX’e gitmiş ya da AWX’te sürüyor olabilir: bu JVM’ler AWX işi bitene kadar kilitli (yeni iş açılmaz). AWX’ten kontrol edin, sonra sunucuyu yeniden tarayın."
              >
                sonucu belirsiz {fmtNumber(belirsizSayisi)}
              </span>
            )}
            {calistirilmayanSayisi > 0 && (
              <span style={{ color: 'var(--status-danger)' }} data-testid="toplu-calistirilmadi">
                yarım kaldı (çalıştırılmadı) {fmtNumber(calistirilmayanSayisi)}
              </span>
            )}
          </div>
          {is.hata && (
            <div
              className="text-[12px]"
              style={{ color: kirmiziMi(is.durum) ? 'var(--status-danger)' : 'var(--text-muted)' }}
            >
              {is.hata}
            </div>
          )}
          {is.durum === 'PLAN_HAZIR' && (
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Plan canlı değerleri okumayı {is.planBitisAt ? fmtDateTime(is.planBitisAt) : ''}{' '}
              itibarıyla bitirdi. 15 dakikalık onay süresi planlama BİTTİĞİNDE başladı (planlamanın
              kendi süresi buna dahil değil); bu sürede onaylanmazsa yeniden planlanmalı. Not: “AÇ”
              adayının JVM’i plan anında durmuşsa plan bunu ayırmaz (auto-start açmak durmuş JVM’e
              zarar vermez; reboot’ta açılır).
              {xmlIs
                ? ' Host XML: uygulamada betik dosyayı yeniden okur, önce yedek alır; host controller o an kapalı olmalı.'
                : ''}
              {dusenler.length ? ` ${fmtNumber(dusenler.length)} JVM düştü (nedeni tabloda).` : ''}
              {kalanMs != null && (
                <span style={{ color: planDoldu ? 'var(--status-danger)' : undefined }}>
                  {planDoldu
                    ? ' Süre doldu — onaylanamaz; yeniden planlayın.'
                    : ` Kalan süre: ~${fmtNumber(Math.max(1, Math.ceil(kalanMs / 60000)))} dk.`}
                </span>
              )}
            </p>
          )}
          {bitti && (
            <div
              className="text-[12px] font-semibold"
              style={{
                color: hicUygulanmadi
                  ? 'var(--text-secondary)'
                  : kirmiziMi(is.durum) || say('FAIL') || say('YARIM_KALDI')
                    ? 'var(--status-danger)'
                    : 'var(--status-success)',
              }}
            >
              {hicUygulanmadi
                ? `Uygulanan JVM yok: ${fmtNumber(say('DUSTU'))} düştü, ${fmtNumber(say('IPTAL'))} iptal — nedeni tabloda (canlı değeri zaten hedefte olanlar da “düştü” sayılır).`
                : is.durum === 'BITTI' && !say('FAIL') && !say('YARIM_KALDI')
                  ? `Tamamlandı: ${fmtNumber(say('OK'))} JVM değişti, ${fmtNumber(say('SKIP'))} zaten hedefteydi.`
                  : `Özet: ${fmtNumber(say('OK'))} OK, ${fmtNumber(say('FAIL'))} başarısız, ${fmtNumber(say('YARIM_KALDI'))} yarım kaldı — başarısız JVM’ler için AWX işine bakın, sonra sunucuyu yeniden tarayın.`}
            </div>
          )}
          <TopluKategoriFiltresi
            ogeler={ogeler}
            basarisiz={AUTOSTART_BASARISIZ}
            secili={kategori}
            onSec={setKategori}
          />
          <OgeTablosu ogeler={kategoriyeGore(ogeler, AUTOSTART_BASARISIZ, kategori)} />
          {bitti && (
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => void adaylariYukle(true)}
            >
              Listeyi yenile
            </button>
          )}
        </section>
      )}
    </div>
  );
}
