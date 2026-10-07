// src/api/retirementApi.ts — Uygulama Retirement (2026-09-21): kayit + kesif + STOP adimi.
import { safeJson } from './http';

const BASE = '/api/retirement';

export interface RtWeb { host: string; serverName: string; product: string; port: string; confFile: string; trafik?: RtVhostTrafik }
export interface RtDiscoveredTarget {
  host: string; site: 'Pendik' | 'Ankara'; env: 'PROD' | 'QA' | 'TEST' | 'DEV'; appName: string; gen: number | null;
  appPath: string; inventoryStatus: string; domain: string; tier: string; web: RtWeb[]; webHow: string;
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
  message: string | null;
}
export interface RtTarget {
  id: number; recordId: number; host: string; site: string; env: string; appName: string; gen: number | null; appPath: string | null;
  web: RtWeb[]; status: RtTargetStatus; planText: string | null; resultText: string | null; lastJobId: number | null; stoppedAt: string | null; updatedAt: string;
  deletedAt: string | null; rolledBackAt: string | null; rollbackJobId: number | null;
  scheduledAt: string | null; windowEnd: string | null;
  /** STOP onayinda DONDURULMUS vhost listesi + her birinin akibeti (akis paneli). */
  webSonuc: RtWeb2[] | null;
  /** Playbook'un `set_stats` ile yayınladığı AYRINTI: STEP satırları ve yeniden
   *  adlandırılan paketler. `planText` yalnız özet ("2 paket yeniden adlandırılacak");
   *  HANGİ paketler olduğu burada. İşlem geri alınamaz, onay ekranı bunu göstermeli.
   *  `null` = eski playbook sürümü ya da alan hiç gelmedi — uydurulmaz. */
  detail: { steps: string[]; renamed: string[] } | null;
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
export interface RtRecordEnv { env: string; toplam: number; durdurulan: number; silinen: number; uygulamalar: string[] }
export interface RtRecordRow extends Omit<RtRecord, 'targets' | 'events'> { targets: number; stopped: number; envs?: RtRecordEnv[] }
export interface RtLaunch { ok: boolean; message?: string; jobId: number | null; status: string | null; awxServerId: number; planOnly?: boolean; sccWarning?: string | null }

const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const retirementApi = {
  config: (): Promise<{ ok: boolean; defaultDays: number; sccMailConfigured: boolean; sccMailTo: string | null; smartFlows: Record<string, string>; deleteHour?: number; pollSeconds?: number }> => fetch(`${BASE}/config`).then(safeJson),
  apps: (q: string): Promise<{ ok: boolean; apps: string[] }> => fetch(`${BASE}/apps?q=${encodeURIComponent(q)}`).then(safeJson),
  discover: (app: string): Promise<RtDiscovery> => fetch(`${BASE}/discover?app=${encodeURIComponent(app)}`).then(safeJson),
  list: (): Promise<{ ok: boolean; records: RtRecordRow[]; message?: string }> => fetch(BASE).then(safeJson),
  get: (id: number): Promise<{ ok: boolean; record: RtRecord; message?: string }> => fetch(`${BASE}/${id}`).then(safeJson),
  create: (p: { app: string; smartNo: string; ocoNo?: string; ownerEmail?: string; deleteAfterDays?: number; plannedDeleteAt?: string | null; dnsReuse?: boolean; lbReuse?: boolean; notes?: string; targets?: { host: string; appName: string }[] }): Promise<{ ok: boolean; id: number; record: RtRecord; message?: string }> =>
    fetch(BASE, json(p)).then(safeJson),
  cancel: (id: number, reason: string): Promise<{ ok: boolean; record: RtRecord; message?: string }> => fetch(`${BASE}/${id}/cancel`, json({ reason })).then(safeJson),
  note: (id: number, text: string): Promise<{ ok: boolean; record: RtRecord; message?: string }> => fetch(`${BASE}/${id}/note`, json({ text })).then(safeJson),
  stop: (id: number, tid: number, confirmed: boolean): Promise<RtLaunch> => fetch(`${BASE}/${id}/targets/${tid}/stop`, json({ confirmed })).then(safeJson),
  // GERI AL (2026-10-07): STOP'un tersi. Hedef 'rolling_back' olur olmaz zamanlanmis
  // SILME devre disi kalir (deleteTick yalniz 'stopped' hedefe bakar) - ayri bir iptal
  // cagrisi YOK ve olmasi da yanlis olurdu.
  rollback: (id: number, tid: number, confirmed: boolean): Promise<RtLaunch & { web?: { denendi: number; atlanan: number; hata: number; notlar: string[] } }> =>
    fetch(`${BASE}/${id}/targets/${tid}/rollback`, json({ confirmed })).then(safeJson),
  /** Gecis durumunda takilmis hedefin AWX isini OKUR ve gercek sonucu yazar.
   *  Okunamazsa hicbir sey yazmaz (okunamadi != basarisiz). */
  refreshStatus: (id: number, tid: number): Promise<{
    ok: boolean; degisti?: boolean; from?: string; to?: string; jobId?: number;
    jobStatus?: string; jobMissing?: boolean; message?: string; record?: RtRecord;
  }> => fetch(`${BASE}/${id}/targets/${tid}/refresh-status`, json({})).then(safeJson),
  /** ADMIN: beklemeyi atla. DELETE'i BASLATMAZ; silme tarihini bugune ceker, silmeyi her
   *  zamanki zamanlayici yakalar (bekleme yolu boylece sinanir). `confirmApp` = kayit
   *  uygulama adi, AYNEN. */
  deleteNow: (id: number, confirmApp: string): Promise<{ ok: boolean; message?: string; oncekiTarih?: string | null; hedefSayisi?: number; pollSaniye?: number; record?: RtRecord }> =>
    fetch(`${BASE}/${id}/delete-now`, json({ confirmApp })).then(safeJson),
  jobStatus: (id: number, tid: number, awxServerId: number, jobId: number): Promise<{ ok: boolean; status: string; output: string; result?: unknown; message?: string }> =>
    fetch(`${BASE}/${id}/targets/${tid}/job-status/${awxServerId}/${jobId}`).then(safeJson),
};
