// src/components/crypto_hub/nodeOrtak.ts — Crypto Hub > "Indexer / Node" ortak, SAF yardımcılar.
//
// Ekran metinleri BİREBİR sözleşmeden (cryptohub/sozlesme.md 9.2): sunucu ret metinleri ve
// ekran metinleri ayrı yerlerde yazılırsa zamanla ayrışır; ekran metni burada TEK yerde durur.
// Bu dosyada React yok — bileşenler ve testler aynı fonksiyonları kullanır.
import type {
  NodeAday,
  NodeBekleyen,
  NodeDep,
  NodeGrup,
  NodeRol,
  NodeSonuc,
  NodeTalepDurumu,
  NodeTalepOzet,
} from '@/api/cryptoHubApi';
import { fmtDateTime } from '@/utils/datetime';

export const BILESENLER = ['adapter', 'api', 'indexer', 'processor'] as const;
export const GEREKCE_EN_AZ = 10;
export const GEREKCE_EN_COK = 500;
/** Ankara önerisi yalnız bu kiracının talebinden sonra (D4). */
export const ISTANBUL_PROD = 'metaco_das_prod';
export const ACIK_DURUMLAR: readonly NodeTalepDurumu[] = ['ACILIYOR', 'BEKLIYOR', 'CALISIYOR'];

export const METIN = {
  sekme: 'Indexer / Node',
  baslik: 'Indexer / Node bağlantıları',
  etiket: {
    kiraci: 'Kiracı',
    lokasyon: 'Lokasyon',
    cluster: 'Cluster',
    namespace: 'Namespace',
    tarama: 'Bileşen taraması',
    sonOkuma: 'Son okuma',
  },
  okumaYok: 'Henüz okunmadı',
  okunuyor: 'Mevcut değerler okunuyor (~1 dk)…',
  okuDugme: "Mevcut node'ları oku",
  okumaBayat: '10 dakikadan eski — değişiklik öncesi yeniden okunur',
  taramaEski: (zaman: string) =>
    `Bileşen listesi 24 saatten eski (tarama: ${zaman}). Yeni kurulan bileşen listede olmayabilir.`,
  okumaEksik: 'Okumanın bazı aşamaları tamamlanamadı; ölçülemeyen gruplar değiştirilemez.',
  prodKapali: 'Bu ortamda node değişikliği şimdilik kapalı (ilk aşamada yalnız test ortamları).',
  yetkiYok: 'Talep açma yetkiniz yok — yalnız görüntüleyebilirsiniz.',
  bolumUis: "Yeni tip indexer'lar (uis)",
  bolumEski: "Eski tip indexer'lar",
  eskiOkumaYok: 'Eski tip grupları görmek için mevcut node\'ları okuyun.',
  bilesenYok: '— bu ağda yok',
  baglantiYok: 'node bağlantısı yok',
  katalogda: (ad: string) => `Katalog: ${ad}`,
  katalogdaYok: 'Katalogda yok',
  rozet: {
    tutarsiz: "Tutarsız: bileşenler farklı node'a bağlı",
    degiskenYok: 'Değiştirilemez: node değişkeni bulunamadı',
    olculemedi: 'Ölçülemedi',
    referans: 'Secret/ConfigMap referansı — Portal bu sürümde değiştirmez',
    gitops: 'GitOps sahipli — Portal değiştirmez',
    durdurulmus: 'Durdurulmuş (replika 0)',
    helm: "Helm values'ta da var",
    yeniTip: 'Yeni tip',
    eskiTip: 'Eski tip',
  },
  /** `no` = smartNo(...) ("Smart #SM-1" ya da "Portal #12") — sunucunun metniyle aynı (PS7) */
  bekleyen: (no: string, kullanici: string, zaman: string) =>
    `Onay bekleyen değişiklik: ${no} — ${kullanici}, ${zaman}`,
  envFromVar: 'envFrom var (node değişkeni tanımlamıyor)',
  envFromOlculemedi: 'envFrom kaynağı okunamadı',
  secimBaslik: 'Değişecek bileşenler',
  secimAciklama:
    'Varsayılan: node taşıyan bileşenlerin hepsi birlikte değişir. Yalnız bir kısmını değiştirmek için işareti kaldırın; seçilenler arasında hepsi ya da hiçbiri uygulanır.',
  secimFarkli: "Bileşenler farklı node'lara bağlı.",
  secimBos: 'En az bir bileşen seçin.',
  secimMevcut: (m: string) => `şu an: ${m}`,
  secilemez: 'node değeri yok — seçilemez',
  secimAyniNode: "Seçilen bileşenler zaten bu node'da — değişiklik yok.",
  degistir: 'Değiştir',
  smartOnizle: 'Smart önizleme',

  sihirbazBaslik: (grupBaslik: string) => `Node değişikliği — ${grupBaslik}`,
  adimlar: ['Mevcut', 'Yeni node', 'Etki', 'Gerekçe', 'Onay'] as const,
  mevcutBasliklar: ['Bileşen', 'Kap', 'Env', 'Değer (maskeli)', 'Katalog'] as const,
  yeniNodeEtiket: 'Yeni node',
  yeniNodeYerTutucu: 'Node seçin',
  ekKullanimda: ' (şu an kullanımda)',
  ekCozulemedi: ' (sırrı çözülemedi — seçilemez)',
  adayYok:
    'Bu grup için katalogda uygun node yok. Kataloğa ekleme Ansible tarafında yapılır (README).',
  etkiListe: "Şu deployment'lar yeniden başlatılacak (her biri tek rollout):",
  etkiDurustluk:
    "İş başarılı sayılırsa env yazılmış ve pod'lar hazır demektir; node'a gerçekten bağlandığını uygulama loglarından doğrulayın.",
  etkiHelm:
    "Bu değişiklik canlı deployment'a yazılır; sonraki helm upgrade eski değeri geri getirebilir. Values dosyasındaki karşılığını ayrıca güncelleyin.",
  tutarsizOnay:
    "Seçilen bileşenler şu an farklı node'lara bağlı; hepsini seçilen node'a getirmeyi onaylıyorum.",
  ankaraUyari: (esKiraci: string) =>
    `Ankara (${esKiraci}) bu talepte değiştirilmez; talep açıldıktan sonra ayrıca önerilir.`,
  gerekceEtiket: 'Gerekçe (10–500 karakter)',
  sayac: (n: number) => `${n}/${GEREKCE_EN_COK}`,
  onayBilgi:
    "Smart talebi açılır; onaylanınca değişiklik otomatik uygulanır. Onay beklerken mevcut node, seçilen node'un kaydı ya da gruptaki bileşenler değişirse iş hiçbir şey yazmadan durur.",
  onayTest:
    'Smart talebi açılacağını ve onaydan sonra değişikliğin otomatik uygulanacağını anlıyorum.',
  onayProd: (grupId: string) => `Onaylamak için grup adını yazın: ${grupId}`,
  dugme: {
    iptal: 'İptal',
    geri: 'Geri',
    ileri: 'İleri',
    talepAc: 'Talep aç',
    gonderiliyor: 'Talep açılıyor…',
    kapat: 'Kapat',
  },

  takipBaslik: 'Talep takibi',
  talepAcildi: (no: string) =>
    `Smart talebi açıldı (kayıt no: ${no}). Onay 24 saat içinde gelirse değişiklik otomatik uygulanır; bu ekranda beklemeniz gerekmez.`,
  onayBekliyor: (statusName: string) => `Onay bekliyor (${statusName})`,
  sonTarih: (kalan: string) => `Son tarih: ${kalan}`,
  uygulaniyor: 'Uygulanıyor…',
  aciliyor: 'Talep açılıyor…',
  sonucBasliklar: [
    'Bileşen',
    'Kap',
    'Env',
    'Eski',
    'Yeni',
    'Yazıldı',
    'Rollout',
    'Geri okuma',
    'Durum',
  ] as const,
  ankaraDegismedi: (esKiraci: string) => `Ankara (${esKiraci}) bu talepte değiştirilmedi.`,
  ankaraDugme: 'Ankara için de talep aç',
  ankaraKapali: 'Bu ortamda node değişikliği şimdilik kapalı.',
  gecmisBaslik: 'Son talepler',
  gecmisBasliklar: ['Zaman', 'Grup', 'Yeni node', 'Talep eden', 'Smart', 'Durum'] as const,

  adminKapatDugme: 'Talebi kapat (yönetici)',
  adminKapatBilgi:
    "Talep kapatılır ve grup kilidi açılır. Smart'ta onay bekleyen kayıt Portal'da iptal edilir (sonradan onaylansa da iş başlamaz). İşlem denetime yazılır.",
  adminKapatGerekce: 'Kapatma gerekçesi (10–500 karakter)',
  adminKapatOnay: 'Kapat',
  adminKapatiliyor: 'Kapatılıyor…',
} as const;

// ── Sonuç metinleri (9.2 "Takip") ────────────────────────────────────────────────────
const GERI_ALINDI_NEDEN: Record<string, string> = {
  ROLLOUT: 'rollout zamanında bitmedi',
  VERIFY: 'geri okuma tutmadı',
  YAZMA: 'yazma başarısız',
  BETIK: 'betikte beklenmeyen bir hata oluştu',
};
const BAYAT_NEDEN: Record<string, string> = {
  BAYAT_ESKI_DEGER: 'onay beklerken mevcut node değişmiş',
  BAYAT_KATALOG: "seçilen node'un kaydı değişmiş",
  BAYAT_KAPSAM: 'gruba bileşen eklenmiş/silinmiş',
};

/** Durum kısa etiketi (geçmiş tablosu). */
export const DURUM_ETIKETI: Record<NodeTalepDurumu, string> = {
  ACILIYOR: 'Açılıyor',
  BEKLIYOR: 'Onay bekliyor',
  CALISIYOR: 'Uygulanıyor',
  BASARILI: 'Tamamlandı',
  GERI_ALINDI: 'Geri alındı',
  BAYAT: 'Durdu (bayat)',
  BASARISIZ: 'Başarısız',
  OLCULEMEDI: 'Durum bilinmiyor',
  REDDEDILDI: 'Reddedildi',
  ZAMAN_ASIMI: 'Zaman aşımı',
  IPTAL: 'İptal edildi',
  HATA: 'Hata',
};

export type Ton = 'ok' | 'warn' | 'danger' | 'muted' | 'accent';

export function durumTonu(d: NodeTalepDurumu): Ton {
  if (d === 'BASARILI') return 'ok';
  if (d === 'BEKLIYOR' || d === 'ACILIYOR' || d === 'CALISIYOR') return 'accent';
  if (d === 'GERI_ALINDI' || d === 'BAYAT' || d === 'ZAMAN_ASIMI' || d === 'OLCULEMEDI') return 'warn';
  if (d === 'IPTAL') return 'muted';
  return 'danger';
}

export function acikMi(d: NodeTalepDurumu): boolean {
  return ACIK_DURUMLAR.includes(d);
}

/**
 * Geri alma da düştüğünde yedeğin yolu: yol biçimli (/ ile başlayan) SON `ERR geri_alma`
 * satırı, yoksa ilk NODEYEDEK. Betik önce hedef başına `<deployment>: <neden>` satırları,
 * en sonda yedek yolunu basar; ilk satırı almak yol yerine hata nedenini gösterirdi.
 */
export function yedekYolu(sonuc: NodeSonuc | null | undefined): string {
  const yollar = (sonuc?.hatalar ?? [])
    .filter((h) => h.stage === 'geri_alma' && String(h.message || '').startsWith('/'))
    .map((h) => h.message);
  return yollar[yollar.length - 1] || sonuc?.yedek?.[0] || '—';
}

/** Kapanmış talebin sonuç cümlesi. Açık talepte null. */
export function sonucMetni(
  durum: NodeTalepDurumu,
  kod: string | null | undefined,
  sonuc?: NodeSonuc | null,
): string | null {
  const k = (kod || '').trim();
  switch (durum) {
    case 'BASARILI':
      return "Tamamlandı — env yazıldı, pod'lar hazır.";
    case 'GERI_ALINDI':
      return `Geri alındı — ${GERI_ALINDI_NEDEN[k] || k || 'neden bildirilmedi'}. Eski node'a dönüldü.`;
    case 'BAYAT':
      return `Durdu, hiçbir şey yazılmadı — ${BAYAT_NEDEN[k] || k || 'neden bildirilmedi'}. Yeniden okuyup yeni talep açın.`;
    case 'BASARISIZ':
      if (k === 'GERI_ALMA')
        return `Geri alma da başarısız oldu; yedek: ${yedekYolu(sonuc)}. Middleware ekibine haber verin.`;
      return `Başarısız — ${k || 'kod yok'}.`;
    case 'OLCULEMEDI':
      if (k === 'TAKILDI')
        return "Durum bilinmiyor — talep belirlenen sürede sonuçlanmadı ve iş sonucu okunamadı. Mevcut node'ları okuyun.";
      return "Durum bilinmiyor — sonuç satırı gelmedi. Mevcut node'ları okuyun.";
    case 'REDDEDILDI':
      return "Smart'ta reddedildi.";
    case 'ZAMAN_ASIMI':
      return 'Onay 24 saat içinde gelmedi; talep kapandı.';
    case 'IPTAL':
      if (k === 'ADMIN_KAPATTI') return "Yönetici tarafından kapatıldı. Mevcut node'ları okuyun.";
      return 'İptal edildi.';
    case 'HATA':
      return `Talep hatayla kapandı: ${k || 'kod yok'}.`;
    default:
      return null;
  }
}

// ── Sihirbaz yardımcıları ────────────────────────────────────────────────────────────
export function gerekceGecerli(s: string): boolean {
  const n = s.trim().length;
  return n >= GEREKCE_EN_AZ && n <= GEREKCE_EN_COK;
}

/** Production onayı: grup kimliği AYNEN yazılmalı (parça eşleşmesi yetmez). */
export function onayMetniEslesir(yazilan: string, grupId: string): boolean {
  return !!grupId && yazilan.trim() === grupId;
}

export function adaySecilebilir(a: NodeAday): boolean {
  return !a.kullanimda && !a.cozulemedi;
}

/** Rol sırası grubun rol tanımından; tanımda olmayan rol (beklenmez) sona. */
export function maskeliOzet(maskeli: Record<string, string>, roller: NodeRol[]): string {
  const sira = roller.map((r) => r.rol);
  const anahtarlar = [
    ...sira.filter((r) => r in maskeli),
    ...Object.keys(maskeli).filter((r) => !sira.includes(r)),
  ];
  return anahtarlar.map((r) => `${r}=${maskeli[r]}`).join('; ');
}

export function adayEtiketi(a: NodeAday, roller: NodeRol[]): string {
  const ek = a.kullanimda ? METIN.ekKullanimda : a.cozulemedi ? METIN.ekCozulemedi : '';
  const oz = maskeliOzet(a.maskeli || {}, roller);
  return `${a.ad}${oz ? ' — ' + oz : ''}${ek}`;
}

/** Grubun "yeniden başlatılacak" deployment'ları: seçim verildiyse yalnız seçilenler,
 *  yoksa node'a bağlı olanların hepsi. */
export function etkilenenDeploymentlar(g: NodeGrup, secim?: readonly string[] | null): string[] {
  if (secim && secim.length) return g.deploymentlar.filter((d) => secim.includes(d.ad)).map((d) => d.ad);
  const bagli = g.deploymentlar.filter((d) => d.nodeBagli).map((d) => d.ad);
  if (bagli.length) return bagli;
  return Array.from(new Set(g.envler.map((e) => e.deployment)));
}

// ── Bileşen seçimi (kullanıcı kararı 2026-11-02) ─────────────────────────────────────
/** Seçilebilir bileşenler: literal node değeri olan deployment'lar (eski sunucu: nodeBagli). */
export function secilebilirler(g: NodeGrup): NodeDep[] {
  return g.deploymentlar.filter((d) => (d.secilebilir === undefined ? d.nodeBagli : d.secilebilir));
}

/** Sihirbaz bileşen seçimini gösterir mi: birden çok seçilebilir bileşen varsa. */
export function secimGoster(g: NodeGrup): boolean {
  return secilebilirler(g).length > 1;
}

export function bilesenAdi(d: Pick<NodeDep, 'ad' | 'bilesen'>): string {
  return d.bilesen || d.ad;
}

/** Bileşenin şu anki node'u: katalog adı, yoksa maskeli değer(ler). */
export function mevcutNodeMetni(d: NodeDep, roller: NodeRol[]): string {
  const m = d.mevcutNode;
  if (!m) return '—';
  if (m.katalogId) return m.ad || m.katalogId;
  return `${METIN.katalogdaYok} (${maskeliOzet(m.maskeli || {}, roller)})`;
}

/** Seçilen bileşenler şu an farklı node'larda mı (rol başına birden çok sha)? */
export function secimTutarsiz(g: NodeGrup, secim: readonly string[]): boolean {
  const roller = new Map<string, Set<string>>();
  for (const e of g.envler) {
    if (e.kaynak !== 'literal' || !secim.includes(e.deployment)) continue;
    if (!roller.has(e.rol)) roller.set(e.rol, new Set());
    roller.get(e.rol)!.add(e.sha || e.maskeli);
  }
  return [...roller.values()].some((s) => s.size > 1);
}

/** Seçilen bileşenlerin hepsi zaten bu adayda mı (sunucu "aynı node" der)? */
export function secimAdaydaMi(g: NodeGrup, secim: readonly string[], adayId: string): boolean {
  const sat = g.envler.filter((e) => e.kaynak === 'literal' && secim.includes(e.deployment));
  return sat.length > 0 && sat.every((e) => e.katalogId === adayId);
}

export interface Rozet {
  metin: string;
  ton: Ton;
}

export function grupRozetleri(g: NodeGrup): Rozet[] {
  const r: Rozet[] = [];
  if (g.tutarsiz) r.push({ metin: METIN.rozet.tutarsiz, ton: 'warn' });
  if (g.degiskenYok) r.push({ metin: METIN.rozet.degiskenYok, ton: 'warn' });
  if (g.olculemedi) r.push({ metin: METIN.rozet.olculemedi, ton: 'muted' });
  if (g.referans) r.push({ metin: METIN.rozet.referans, ton: 'warn' });
  if (g.gitops) r.push({ metin: METIN.rozet.gitops, ton: 'warn' });
  if (g.durdurulmus.length > 0) r.push({ metin: METIN.rozet.durdurulmus, ton: 'muted' });
  if (g.envler.some((e) => e.helm === 'evet')) r.push({ metin: METIN.rozet.helm, ton: 'accent' });
  return r;
}

/** Node satırının katalog rozeti: tüm roller aynı katalog kaydına eşleşiyorsa adı. */
export function katalogRozeti(g: NodeGrup): string {
  const m = g.mevcutNode;
  if (m && m.katalogId) return METIN.katalogda(m.ad || m.katalogId);
  return METIN.katalogdaYok;
}

/** Talep numarası metni — sunucudaki shared/cryptoHubNodes.cjs `talepNoMetni` ile AYNI (PS7). */
export function smartNo(externalTicketId: string | null | undefined, talepId?: number): string {
  const dis = String(externalTicketId ?? '').trim();
  if (dis) return `Smart #${dis}`;
  return talepId != null ? `Portal #${talepId}` : '—';
}

export function bekleyenMetni(b: NodeBekleyen): string {
  return METIN.bekleyen(smartNo(b.externalTicketId, b.talepId), b.username, fmtDateTime(b.createdAt));
}

/** Ankara önerisi yalnız İstanbul DAS prod talebinden sonra (D4); GAR'da Ankara yok. */
export function esOneriGoster(tenantKey: string, oneri: unknown): boolean {
  return tenantKey === ISTANBUL_PROD && !!oneri;
}

// ── Sayaç ────────────────────────────────────────────────────────────────────────────
/** Onay son tarihine kalan süre. Saat kayması: sunucu saati + yanıttan bu yana geçen yerel süre. */
export function kalanSure(
  deadline: string | null | undefined,
  serverNow: string | null | undefined,
  alindiMs: number | null | undefined,
  simdiMs: number,
): string | null {
  if (!deadline) return null;
  const son = Date.parse(deadline);
  if (!Number.isFinite(son)) return null;
  const sunucu = serverNow ? Date.parse(serverNow) : NaN;
  const simdi =
    Number.isFinite(sunucu) && alindiMs != null ? sunucu + (simdiMs - alindiMs) : simdiMs;
  const ms = son - simdi;
  if (ms <= 0) return 'süresi doldu';
  const dk = Math.floor(ms / 60000);
  const sa = Math.floor(dk / 60);
  return sa > 0 ? `${sa} sa ${dk % 60} dk` : `${dk} dk`;
}

// ── Sekmeler (CryptoHubPage) ─────────────────────────────────────────────────────────
export type CryptoSekme = 'durum' | 'podlar' | 'surumler' | 'configmap' | 'node';

/** Hangi sekmeler görünür: node sekmesi yalnız Metaco'da; node-only kullanıcıda YALNIZ o. */
export function sekmeListesi(app: string, nodeOnly: boolean): [CryptoSekme, string][] {
  const temel: [CryptoSekme, string][] = [
    ['durum', 'Durum'],
    ['podlar', 'Podlar'],
    ['surumler', 'Sürümler'],
    ['configmap', 'Config Map'],
  ];
  if (app !== 'metaco') return temel;
  if (nodeOnly) return [['node', METIN.sekme]];
  return [...temel, ['node', METIN.sekme]];
}

/** URL'deki `s` ile başlangıç sekmesi: listede yoksa ilk sekme. */
export function baslangicSekmesi(s: string | null, liste: [CryptoSekme, string][]): CryptoSekme {
  const var_ = liste.find(([id]) => id === s);
  return var_ ? var_[0] : liste[0][0];
}

/** "Değiştir" düğmesi açık mı, kapalıysa neden (title). Okuma bayat / yoksa düğme AÇIK kalır:
 *  sihirbaz önce okumayı kendisi başlatır, okuma sonrası engel çıkarsa kapanır (9.2). */
export function degistirDurumu(
  g: NodeGrup,
  o: { talep: boolean; nodeAcik: boolean; okumaTaze: boolean },
): { acik: boolean; neden: string | null } {
  if (!o.nodeAcik) return { acik: false, neden: METIN.ankaraKapali };
  if (!o.talep) return { acik: false, neden: METIN.yetkiYok };
  if (g.bekleyen) return { acik: false, neden: bekleyenMetni(g.bekleyen) };
  if (g.degistirilebilir) return { acik: true, neden: null };
  if (!o.okumaTaze) return { acik: true, neden: null };
  return { acik: false, neden: g.engel || METIN.rozet.olculemedi };
}

export interface SonucSatiri {
  deployment: string;
  container: string;
  env: string;
  eski: string;
  yeni: string;
  yazildi: string;
  rollout: string;
  geriOkuma: string;
  durum: string;
}

const CHG_DURUM: Record<string, string> = {
  yazildi: 'yazıldı',
  geri_alindi: 'geri alındı',
  BAYAT: 'bayat — yazılmadı',
};

/** NODECHG satırlarına ROLLOUT / VERIFY / ROLLBACK bilgisini ekler (sonuç tablosu). */
export function sonucSatirlari(s: NodeSonuc | null | undefined): SonucSatiri[] {
  if (!s) return [];
  return (s.degisiklikler || []).map((d) => {
    const r = (s.rollout || []).find((x) => x.deployment === d.deployment);
    const v = (s.verify || []).find(
      (x) => x.deployment === d.deployment && x.container === d.container && x.env === d.env,
    );
    const rb = (s.rollback || []).find((x) => x.deployment === d.deployment);
    return {
      deployment: d.deployment,
      container: d.container,
      env: d.env,
      eski: d.eski,
      yeni: d.yeni,
      yazildi: d.durum === 'BAYAT' ? 'hayır' : 'evet',
      rollout: r ? `${r.durum}${r.sureSn != null ? ` (${r.sureSn} sn)` : ''}` : '—',
      geriOkuma: v ? v.durum : '—',
      durum: rb ? `geri alma: ${rb.durum}` : CHG_DURUM[d.durum] || d.durum,
    };
  });
}

/** Geçmiş satırının grup başlığı (sunucu vermediyse grup kimliği). */
export function talepGrupBasligi(t: NodeTalepOzet): string {
  return t.grupBaslik || t.grup;
}
