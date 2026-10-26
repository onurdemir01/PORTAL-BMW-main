// src/api/retirementApi.ts — Uygulama Retirement (2026-09-21): kayit + kesif + STOP adimi.
import { safeJson } from './http';

const BASE = '/api/retirement';

export interface RtWeb { host: string; serverName: string; product: string; port: string; confFile: string; trafik?: RtVhostTrafik;
  /** Nasil bulundu (2026-10-12): 'ad' = ServerName eslesmesi, 'ajp' = vhost'un mod_jk/proxy hedefi JVM portu, 'ad+ajp' = ikisi. */
  kaynak?: 'ad' | 'ajp' | 'ad+ajp' | 'mc' | 'ad+mc' | 'ajp+mc' | 'ad+ajp+mc' | string; ajpHedef?: string;
  /** mod_cluster: vhost'un balancer adi (= uygulama adi). Uye JVM dogrulanmaz. */
  mcBalancer?: string;
  /** In-place hedefte yalniz ad/sertifika ile eslesen vhost: otomatik KAPATILMAZ, sebep metni. */
  elle?: string }
export interface RtDiscoveredTarget {
  host: string; site: 'Pendik' | 'Ankara'; env: 'PROD' | 'QA' | 'TEST' | 'DEV'; appName: string; gen: number | null;
  appPath: string; inventoryStatus: string; domain: string; tier: string; web: RtWeb[]; webHow: string;
  /** Ayni sunucuda uygulama baska JBoss kurulumunda da var (in-place); digerSurumler = o kurulum(lar). */
  inPlace?: boolean; digerSurumler?: number[];
  /** Web vhost'u bulunamadiysa uyari metni (denenen web sunuculari ile); bulunduysa null. */
  webUyari?: string | null;
  // runningKnown (sozlesme v3) = running_src !== 'UNMEASURED'; alan yoksa (eski sunucu) bilinen sayilir.
  hub: { running: boolean; autoStart: string; scanDate: string | null; runningSrc?: string | null; runningKnown?: boolean | null } | null;
}
// hubUnavailable (kural 6): Server_Hub_Jvms (ya da kolon listesi) okunamadi -> TUM hedeflerde hub null;
// bu "tarama yok" DEGIL "olculemedi"dir. Alan yoksa (eski sunucu yaniti) okundu sayilir.
export interface RtDiscovery { ok: boolean; message?: string; base: string; targets: RtDiscoveredTarget[]; summary: { total: number; bySite: { Pendik: number; Ankara: number }; byEnv: Record<string, number>; webMatched: number; prod: boolean; hubUnavailable?: boolean;
  /** Vhost trafik ozeti (hc HARIC). Uc kova AYRI: 'olculemedi' ne var ne yok. */
  trafik?: { vhost: number; var: number; yok: number; olculemedi: number; req7Toplam: number; altSinir: boolean; okunamadi: string | null } } }
// SUNUCUDAKI TUM DURUMLAR. 'stop_scheduled' (OCO penceresi), 'deleting'/'deleted' ve
// geri alma durumlari ('rolling_back' | 'active' | 'rollback_failed') tipe GIRMEMISTI;
// eksik birakmak, ekranda bu durumlarin hic ele alinmadigini derleyicinin ONAYLAMASI
// demekti (tsc "overlap yok" diye uyardi, bkz. 2026-10-07).
export type RtTargetStatus =
  | 'pending' | 'planning' | 'planned' | 'stop_scheduled' | 'stopping' | 'stopped'
  | 'deleting' | 'deleted' | 'rolling_back' | 'active' | 'rollback_failed'
  | 'failed' | 'skipped';
/** Uygulanan vhost sonucu. `status`: pending | ok | manual | failed | restoring |
 *  restore_manual | restore_failed — sunucu serbest metin yaziyor, enum dayatilmaz. */
/** Vhost trafigi (Apache/IHS access log, hc HARIC). `durum`:
 *  var | yok | olculemedi. "olculemedi" ASLA "yok" sayilmaz. */
export interface RtVhostTrafik {
  durum: 'var' | 'yok' | 'olculemedi';
  sebep?: string;
  req24?: number | null;
  req7?: number;
  hc24?: number | null;
  /** Log kuyrugu kesildi: sayilar ALT SINIR. */
  sampled?: boolean;
  sonIstek?: string | null;
  tarama?: string | null;
}
export interface RtWeb2 {
  host: string;
  serverName: string;
  product: string;
  confFile: string;
  status: string;
  jobId: number | null;
  awxServerId?: number | null;
  message: string | null;
  /** Isin baslatildigi / sonucunun okundugu an (ISO). Eski kayitlarda yok. */
  basladi?: string;
  bitti?: string;
}
export interface RtTarget {
  id: number; recordId: number; host: string; site: string; env: string; appName: string; gen: number | null; appPath: string | null;
  web: RtWeb[]; status: RtTargetStatus; planText: string | null; resultText: string | null; lastJobId: number | null; deleteJobId: number | null; stoppedAt: string | null; updatedAt: string;
  deletedAt: string | null; rolledBackAt: string | null; rollbackJobId: number | null;
  /** Hedef basina "beklemeyi atla" (admin): doluysa ilk zamanlayici turunda silinir. */
  deleteNowAt?: string | null;
  scheduledAt: string | null; windowEnd: string | null;
  /** STOP onayinda DONDURULMUS vhost listesi + her birinin akibeti (akis paneli). */
  webSonuc: RtWeb2[] | null;
  /** Playbook'un `set_stats` ile yayınladığı AYRINTI: STEP satırları ve yeniden
   *  adlandırılan paketler. `planText` yalnız özet ("2 paket yeniden adlandırılacak");
   *  HANGİ paketler olduğu burada. İşlem geri alınamaz, onay ekranı bunu göstermeli.
   *  `null` = eski playbook sürümü ya da alan hiç gelmedi — uydurulmaz. */
  detail: {
    steps: string[]; renamed: string[];
    /** ON KONTROL LISTESI (2026-10-22): `ONKONTROL\t<tur>\t<ne>\t<ayrinti>` satirlari — tur: uygulama |
     *  konfig | komut | dosya | dokunulmaz | ozet. Eski playbook ciktisinda yok. */
    onkontrol?: string[];
    /** Ayrinti cok uzundu ve kisaltildi (kesik JSON yerine). */
    kisaltildi?: boolean;
  } | null;
  /** Onaylanacak on kontrolun izin listesi; yalniz son on kontrol isine aitse dolu. Bos ise onay acilmaz:
   *  onayli STOP betige yalniz bu listeyi gonderir, betik liste disi hicbir islem yapmaz. */
  stopIzin?: { jobId: number | null; at: string | null; izinler: string[] } | null;
  /** SILME ON KONTROLU (2026-10-22): zamanlayici silme saatinden bir saat once kosar (ya da elle "Silme ön
   *  kontrolü"); silme YALNIZ taze ve hazir listeyle yapilir. null = hic on kontrol yok. */
  silmeOnKontrol?: RtOnKontrolKaydi | null;
  /** GERI ALMA ON KONTROLU (2026-10-22): onayli geri alma YALNIZ hazir listeyle; bir liste bir onaya. */
  geriAlOnKontrol?: RtOnKontrolKaydi | null;
  /** HEDEFIN BILINEN AWX ISLERI (2026-10-26, sunucu: retirement/is-ciktisi.cjs hedefIsleri). Yalniz DB'den;
   *  pipeline sirasinda, adim basina son is. Alan yoksa (eski sunucu) is ciktisi dugmeleri gizlenir. */
  awxIsleri?: RtHedefIs[];
  /** Bir is numarasinin hangi adima ait oldugu kanitlanamadi; o is listede YOK (tahmin yok). */
  awxIsleriEksik?: boolean;
  /** IN-PLACE (kayit acilirken saklanir): ayni sunucuda uygulamanin diger JBoss kurulumu da var.
   *  null = bu alandan once acilmis kayit (bilinmiyor - "yok" DEGIL); alan yoksa eski sunucu. */
  inPlace?: boolean | null;
  /** Diger kurulum(lar)in JBoss surumu (0 = surumu bilinmeyen kurulum); [] = tek kurulum; null = bilinmiyor. */
  digerSurumler?: number[] | null;
}
/** Retirement isinin adimi (is ciktisi ucu `adim` parametresi). */
export type RtIsAdim = 'onkontrol' | 'stop' | 'web' | 'delete_onkontrol' | 'delete' | 'rollback_onkontrol' | 'rollback';
/** Hedefin bir AWX isi. `web`: `webSonuc` icindeki OZGUN sira (yalniz adim 'web'). `sunucuKapali`: isin
 *  AWX sunucusu devre disi / bulunamiyor (cikti ancak Portal arsivinden); sunucu bilinmiyorsa alan yok. */
export interface RtHedefIs {
  adim: RtIsAdim; web?: number; jobId: number; durum: 'suruyor' | 'basarili' | 'basarisiz' | 'iptal' | 'bilinmiyor';
  basladi: string | null; bitti: string | null; kaynak?: 'elle' | 'zamanlayici' | null; sunucuKapali?: boolean;
}
/** Is ciktisi (GET /:id/targets/:tid/is-ciktisi). `output` sunucuda MASKELI. `kaynak: 'arsiv'`: AWX sunucusu
 *  kapali ya da is AWX'te yok; Portal arsivi (status null, bitti true). `kirpildi`: Portal sinirinda kesildi. */
export interface RtIsCiktisi {
  ok: true; kaynak: 'awx' | 'arsiv'; adim: RtIsAdim; web?: number; jobId: number; awxServerId: number | null; sunucuAdi: string | null;
  status: string | null; bitti: boolean; output: string; kirpildi: boolean; started: string | null; finished: string | null; elapsed: number | null;
  awxUrl?: string | null; arsivTarihi?: string | null; uyari?: string | null; jobExplanation?: string | null; resultTraceback?: string | null;
}
/** Ret: `kalici` true (HTTP 400/409) = yeniden denemek ise yaramaz; false (HTTP 424) = gecici, yeniden dene.
 *  Kodlar: gecersiz | hedef_yok | is_yok | sunucu_belirsiz | template_uyusmuyor | awx_server_missing |
 *  awx_job_missing | olculemedi | awx_okunamadi. */
export interface RtIsCiktisiRed { ok: false; code: string; kalici: boolean; message: string; _httpStatus?: number }
/** Silme / geri alma on kontrolunun kaydi (sunucu: stop-sonuc.onKontrolGorunum). */
export interface RtOnKontrolKaydi {
  jobId: number | null; at: string | null;
  /** baslatiliyor | running | ok | failed */
  durum: string; mesaj: string | null;
  /** `ONKONTROL\t<tur>\t<ne>\t<ayrinti>` satirlari (STOP ile ayni bicim). */
  onkontrol: string[]; kisaltildi: boolean;
  kaynak: string | null; kullanici: string | null;
  /** Liste bir onaya / bir silmeye verildi; yeniden icin yeni on kontrol gerekir. */
  kullanildi: boolean;
  /** Onaya / silmeye verilebilir (basarili, kullanilmamis, silmede taze). */
  hazir: boolean; izinler: string[];
}
export interface RtRecord {
  id: number; app: string; smartNo: string; ocoNo: string | null; ownerEmail: string | null; requestedBy: string;
  status: 'open' | 'stopping' | 'stopped' | 'deleted' | 'cancelled'; deleteAfterDays: number; plannedDeleteAt: string | null; stopAt: string | null;
  dnsReuse: boolean; lbReuse: boolean; sccNotifiedAt: string | null; notes: string | null; createdAt: string; updatedAt: string; effectiveDeleteAt: string | null;
  /** Silme ANI: gun + TR silme saati (23:00). Zamanlayiciyla AYNI kaynak (schedule.cjs). */
  deleteAt?: { gun: string; saat: string; iso: string } | null;
  /** Admin "beklemeyi atla": doluysa silme saati beklenmez, ilk turda baslar. */
  deleteNowAt?: string | null;
  targets: RtTarget[]; events: { id: number; at: string; username: string | null; kind: string; text: string | null }[];
}
/** Kaydin ortam kirilimi: kayit TABAN adla tutulur, ortam hedeflerden gelir. */
/** Zamanlayici durumu (kuyruk gorunumu): son/sonraki tur ani, tur araligi. */
export interface RtZamanlayici { calisiyor: boolean; aralikSn: number; sonTurAt: string | null; sonrakiTurAt: string | null; turSuruyor: boolean }
/** Suren JBoss isinin son okunan AWX durumu (hedef id -> is). `status` yoksa henuz okunmadi. */
export type RtIsler = Record<number, { jobId: number; status?: string; at?: string }>;
export interface RtRecordEnv { env: string; toplam: number; durdurulan: number; silinen: number; uygulamalar: string[] }
export interface RtRecordRow extends Omit<RtRecord, 'targets' | 'events'> { targets: number; stopped: number; envs?: RtRecordEnv[] }
/** SCC adresinin kaynagi: ekrandan girildi / Portal ortam degiskeni / hic yok. */
export type SccKaynak = 'ekran' | 'env' | 'yok';
export interface RtLaunch { ok: boolean; message?: string; jobId: number | null; status: string | null; awxServerId: number; planOnly?: boolean; sccWarning?: string | null;
  /** On kontrolde web sunucularinda baslatilan Server Hub taramasi (taze vhost trafigi). */
  trafikTarama?: { ok: boolean; jobId?: number | null; awxServerId?: number; hosts: string[]; message?: string; tids?: number[] } | null;
  /** TOPLU: hedef id -> vhost plani (tek hedefte vhostPlan ile ayni bicim). */
  vhostPlanlar?: Record<number, RtVhostPlan[] | null>;
  /** Isin kapsadigi hedefler (toplu iste hepsi ayni is no). */
  tids?: number[];
  /** PROD: OCO penceresine zamanlandi, is BASLATILMADI. */
  scheduled?: boolean; runAtText?: string;
  /** On kontrolde vhost basina apache_retire_vhost PLANI (kapatilacak blok). `elle`: otomatik
   *  kapatma yok (NGINX / conf bilinmiyor) - is baslatilmadi. */
  vhostPlan?: RtVhostPlan[] | null }
export interface RtVhostPlan { host: string; serverName: string; confFile: string; ok: boolean; elle?: boolean; jobId?: number | null; awxServerId?: number; message?: string }

const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** DNS silme / IP iadesi ozeti (server/retirement/dns-ip.cjs). */
export type DnsTur = 'intranet' | 'internet';
export interface RtDnsSatiri {
  ad: string; vhostlar: { host: string; serverName: string }[];
  /** DNS'in cozuldugu IPv4'ler (LB VIP); null = cozulemedi (cozumHata). */
  vip: string[] | null; cozumHata: string | null;
  /** Bu adi kullanan, bu kayda AIT OLMAYAN vhost'lar -> DNS silinmemeli. */
  paylasilan: { host: string; serverName: string; confFile: string }[];
  tur: DnsTur | null; smartAkisi: string | null; durum: 'silinecek' | 'silinmemeli' | 'kalacak';
}
export interface RtVipSatiri { ip: string; dnsler: string[]; durum: 'iade' | 'iade_edilmez' | 'kalacak'; sebep: string | null }
export interface RtVhostIpSatiri { ip: string | null; host: string; vhostlar: string[]; durum: 'iade' | 'iade_edilmez' | 'olculemedi' | 'ozel_ip_yok'; digerleri: string[] }
export interface RtDnsIp { ok: boolean; message?: string; dnsReuse?: boolean; lbReuse?: boolean; dns: RtDnsSatiri[]; vip: RtVipSatiri[]; vhostIp: RtVhostIpSatiri[]; hubHata?: string | null; taranmayan?: string[] }

export const retirementApi = {
  config: (): Promise<{ ok: boolean; defaultDays: number; sccMailConfigured: boolean; sccMailTo: string | null; smartFlows: Record<string, string>; deleteHour?: number; pollSeconds?: number; sccMailCc?: string | null;
    sccKaynak?: SccKaynak; sccGuncelleyen?: string | null; sccGuncellendi?: string | null; sccDbHatasi?: string | null }> => fetch(`${BASE}/config`).then(safeJson),
  apps: (q: string): Promise<{ ok: boolean; apps: string[] }> => fetch(`${BASE}/apps?q=${encodeURIComponent(q)}`).then(safeJson),
  discover: (app: string): Promise<RtDiscovery> => fetch(`${BASE}/discover?app=${encodeURIComponent(app)}`).then(safeJson),
  list: (): Promise<{ ok: boolean; records: RtRecordRow[]; message?: string }> => fetch(BASE).then(safeJson),
  get: (id: number): Promise<{ ok: boolean; record: RtRecord; message?: string; zamanlayici?: RtZamanlayici; isler?: RtIsler }> => fetch(`${BASE}/${id}`).then(safeJson),
  /** Canli durum: bu kaydin vhost islerini baslatir/sonuclandirir ve kaydi dondurur. */
  /** Henuz dokunulmamis hedefi kayittan cikarir ('skipped'). */
  cikar: (id: number, tid: number, neden: string): Promise<{ ok: boolean; message?: string; record?: RtRecord }> =>
    fetch(`${BASE}/${id}/targets/${tid}/cikar`, json({ neden })).then(safeJson),
  /** Web kesfini bugunku kurallarla yeniden kosturur. uygula=false: yalniz onizleme. */
  webKesif: (id: number, uygula: boolean): Promise<{ ok: boolean; message?: string; uygulandi?: boolean; eklenenToplam?: number; record?: RtRecord;
    hedefler?: { tid: number; host: string; appName: string; env: string; status: string; eski: number; eklenen: RtWeb[]; webHow: string; webUyari: string | null; islem: string }[] }> =>
    fetch(`${BASE}/${id}/web-kesif`, json({ uygula })).then(safeJson),
  canli: (id: number): Promise<{ ok: boolean; record: RtRecord; message?: string; canli?: { kilitli?: boolean; kosan?: number; kapanan?: number; hata?: string }; zamanlayici?: RtZamanlayici; isler?: RtIsler }> => fetch(`${BASE}/${id}/canli`).then(safeJson),
  create: (p: { app: string; smartNo: string; ocoNo?: string; ownerEmail?: string; deleteAfterDays?: number; plannedDeleteAt?: string | null; dnsReuse?: boolean; lbReuse?: boolean; notes?: string; targets?: { host: string; appName: string; gen: number | null }[] }): Promise<{ ok: boolean; id: number; record: RtRecord; message?: string }> =>
    fetch(BASE, json(p)).then(safeJson),
  cancel: (id: number, reason: string): Promise<{ ok: boolean; record: RtRecord; message?: string }> => fetch(`${BASE}/${id}/cancel`, json({ reason })).then(safeJson),
  note: (id: number, text: string): Promise<{ ok: boolean; record: RtRecord; message?: string }> => fetch(`${BASE}/${id}/note`, json({ text })).then(safeJson),
  dnsIp: (id: number): Promise<RtDnsIp> => fetch(`${BASE}/${id}/dns-ip`).then(safeJson),
  dnsTur: (id: number, ad: string, tur: DnsTur | null): Promise<{ ok: boolean; message?: string }> =>
    fetch(`${BASE}/${id}/dns-tur`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ad, tur }) }).then(safeJson),
  /** `simdiCalistir`: yalniz Admin; OCO penceresi ileride olsa da STOP'u HEMEN calistirir (varsayilan: pencereye zamanla). */
  stop: (id: number, tid: number, confirmed: boolean, simdiCalistir = false): Promise<RtLaunch> => fetch(`${BASE}/${id}/targets/${tid}/stop`, json({ confirmed, simdiCalistir })).then(safeJson),
  /** TOPLU (2026-10-08): secilen hedefler TEK iste (on kontrol ya da onayli STOP); SCC'ye tek mail. */
  stopToplu: (id: number, tids: number[], confirmed: boolean, simdiCalistir = false): Promise<RtLaunch> => fetch(`${BASE}/${id}/stop-toplu`, json({ tids, confirmed, simdiCalistir })).then(safeJson),
  // GERI AL (2026-10-07): STOP'un tersi. Hedef 'rolling_back' olur olmaz zamanlanmis
  // SILME devre disi kalir (deleteTick yalniz 'stopped' hedefe bakar) - ayri bir iptal
  // cagrisi YOK ve olmasi da yanlis olurdu.
  /** `onKontrolJobId`: onayda ZORUNLU - ekranda gosterilen geri alma on kontrolunun is numarasi (sunucu yalniz o listeyi onaylar). */
  rollback: (id: number, tid: number, confirmed: boolean, onKontrolJobId?: number | null): Promise<RtLaunch & { web?: { denendi: number; atlanan: number; hata: number; notlar: string[] } }> =>
    fetch(`${BASE}/${id}/targets/${tid}/rollback`, json({ confirmed, onKontrolJobId: onKontrolJobId ?? undefined })).then(safeJson),
  /** SILME ON KONTROLU (elle, 2026-10-22): durdurulmus hedefte "ne silinecek?" - hicbir sey silinmez. */
  deletePlan: (id: number, tid: number): Promise<RtLaunch & { record?: RtRecord }> =>
    fetch(`${BASE}/${id}/targets/${tid}/delete-plan`, json({})).then(safeJson),
  /** Gecis durumunda takilmis hedefin AWX isini OKUR ve gercek sonucu yazar.
   *  Okunamazsa hicbir sey yazmaz (okunamadi != basarisiz). */
  /** Web (vhost) adimini yeniden dene: 'failed'/'skip' girdiler 'pending'e doner, zamanlayici
   *  bir sonraki turda yeniden baslatir. Suren ('running') islere dokunulmaz. */
  /** Yeniden deneme ONIZLEMESI (2026-10-08): failed/skip vhost'lar icin plan isleri baslatilir,
   *  HICBIR SEY degismez. Donus STOP on kontrolundeki vhostPlan ile ayni bicim. */
  webRetryPlan: (id: number, tid: number): Promise<{ ok: boolean; message?: string; vhostPlan?: RtLaunch['vhostPlan'] }> =>
    fetch(`${BASE}/${id}/targets/${tid}/web-retry/plan`, json({})).then(safeJson),
  webRetry: (id: number, tid: number): Promise<{ ok: boolean; message?: string; adet?: number; basladi?: number; kilitli?: boolean; baslatmaHatasi?: string | null; pollSaniye?: number; record?: RtRecord }> =>
    fetch(`${BASE}/${id}/targets/${tid}/web-retry`, json({})).then(safeJson),
  refreshStatus: (id: number, tid: number): Promise<{
    ok: boolean; degisti?: boolean; from?: string; to?: string; jobId?: number;
    jobStatus?: string; jobMissing?: boolean; uncertainLaunch?: boolean; message?: string; record?: RtRecord;
  }> => fetch(`${BASE}/${id}/targets/${tid}/refresh-status`, json({})).then(safeJson),
  /** Job ID yazimi dusmus claim'e kanitli mevcut AWX isini baglar; yeni is baslatmaz. */
  reconcileJob: (id: number, tid: number, jobId: number): Promise<{
    ok: boolean; jobId?: number; jobStatus?: string; message?: string; record?: RtRecord;
  }> => fetch(`${BASE}/${id}/targets/${tid}/reconcile-job`, json({ jobId })).then(safeJson),
  /** SCC bilgilendirme adresi (virgulle). Kime BOS -> ekran degeri kalkar, ortam degiskenine dusulur. */
  sccKaydet: (to: string, cc: string): Promise<{ ok: boolean; message?: string; sccMailTo?: string | null; sccMailCc?: string | null; sccKaynak?: SccKaynak; sccGuncelleyen?: string | null; sccGuncellendi?: string | null }> =>
    fetch(`${BASE}/config/scc`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, cc }) }).then(safeJson),
  /** ADMIN: beklemeyi atla. DELETE'i BASLATMAZ; silme tarihini bugune ceker, silmeyi her
   *  zamanki zamanlayici yakalar (bekleme yolu boylece sinanir). `confirmApp` = kayit
   *  uygulama adi, AYNEN. */
  /** HEDEF BASINA beklemeyi atla (admin): yalniz bu hedef ilk zamanlayici turunda silinir. */
  deleteNowTarget: (id: number, tid: number, confirmApp: string): Promise<{ ok: boolean; message?: string; pollSaniye?: number; record?: RtRecord }> =>
    fetch(`${BASE}/${id}/targets/${tid}/delete-now`, json({ confirmApp })).then(safeJson),
  deleteNow: (id: number, confirmApp: string): Promise<{ ok: boolean; message?: string; oncekiTarih?: string | null; hedefSayisi?: number; pollSaniye?: number; record?: RtRecord }> =>
    fetch(`${BASE}/${id}/delete-now`, json({ confirmApp })).then(safeJson),
  /** IS CIKTISI (salt okunur, yan etkisiz): istemci sunucu / is numarasi VERMEZ; sunucu hedefin kendi
   *  kaydindan cozer. Is surerken yoklanir (bitti: true gelince durulur). */
  isCiktisi: (id: number, tid: number, adim: RtIsAdim, web?: number, signal?: AbortSignal): Promise<RtIsCiktisi | RtIsCiktisiRed> =>
    fetch(`${BASE}/${id}/targets/${tid}/is-ciktisi?adim=${encodeURIComponent(adim)}${web != null ? `&web=${web}` : ''}`, { signal }).then(safeJson),
  jobStatus: (id: number, tid: number, awxServerId: number, jobId: number): Promise<{ ok: boolean; status: string; output: string; result?: unknown; message?: string;
    /** server_hub_fix isleri (vhost plani): kapatilacak blok + RESULT satiri. */
    fixResult?: { line?: string; blok?: string[]; jk?: string[]; kip?: string; jkdeg?: string[] } | null }> =>
    fetch(`${BASE}/${id}/targets/${tid}/job-status/${awxServerId}/${jobId}`).then(safeJson),
};
