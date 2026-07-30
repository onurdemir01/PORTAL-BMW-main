import { safeJson } from "./http";
export interface NobetPerson {
  name:     string | null;
  intercom: string | null;
  email:    string | null;
  phone:    string | null;
}

export interface NobetRecord {
  asRecordId:    string | null;
  startDate:     string | null;
  endDate:       string | null;
  isToday:       boolean;
  asNobetci:     NobetPerson | null;
  yedekNobetci:  NobetPerson | null;
}

export interface NobetListResult {
  ok:      boolean;
  source?: string;
  records?: NobetRecord[];
  error?:  string;
}

export interface NobetciResult {
  ok:           boolean;
  source?:      string;
  name?:        string | null;
  intercom?:    string | null;
  email?:       string | null;
  phone?:       string | null;
  avatarUrl?:   string | null;
  department?:  string | null;
  title?:       string | null;
  yedekName?:   string | null;
  yedekIntercom?: string | null;
  yedekEmail?:  string | null;
  teamName?:    string;
  startDate?:   string | null;
  endDate?:     string | null;
  date?:        string;
  message?:     string;
}

export interface QuickLink {
  id: string;
  label: string;
  url: string;
  icon?: string;
}

// Module-level TTL cache — prevents 8x duplicate fetches across components
const TTL_TODAY = 5 * 60 * 1000;  // 5 min
const TTL_LIST  = 5 * 60 * 1000;
const TTL_LINKS = 6 * 60 * 1000;  // B-08: 6min cache for duty-roster links

let _todayData: NobetciResult | null = null;
let _todayAt   = 0;
let _todayPromise: Promise<NobetciResult> | null = null;

let _listData: NobetListResult | null = null;
let _listAt   = 0;
let _listPromise: Promise<NobetListResult> | null = null;

let _linksData: QuickLink[] | null = null;
let _linksAt   = 0;
let _linksPromise: Promise<QuickLink[]> | null = null;

export const nobetciApi = {
  today: (): Promise<NobetciResult> => {
    if (_todayData && Date.now() - _todayAt < TTL_TODAY) return Promise.resolve(_todayData);
    if (_todayPromise) return _todayPromise;
    _todayPromise = fetch("/api/nobetci/today")
      .then(safeJson)
      .then((d) => { _todayData = d; _todayAt = Date.now(); _todayPromise = null; return d; })
      .catch((e) => { _todayPromise = null; throw e; });
    return _todayPromise;
  },

  list: (): Promise<NobetListResult> => {
    if (_listData && Date.now() - _listAt < TTL_LIST) return Promise.resolve(_listData);
    if (_listPromise) return _listPromise;
    _listPromise = fetch("/api/nobetci/list")
      .then(safeJson)
      .then((d) => { _listData = d; _listAt = Date.now(); _listPromise = null; return d; })
      .catch((e) => { _listPromise = null; throw e; });
    return _listPromise;
  },

  // B-08: 6min cache for duty-roster links (called 6x per HAR)
  // Nöbet hızlı linkleri artık genel PortalLink sisteminin (src/api/linksApi.ts)
  // category="Nöbet" alt kümesi — eski /api/duty-roster/links endpoint'i kaldırıldı.
  links: (): Promise<QuickLink[]> => {
    if (_linksData && Date.now() - _linksAt < TTL_LINKS) return Promise.resolve(_linksData);
    if (_linksPromise) return _linksPromise;
    _linksPromise = fetch("/api/links")
      .then(safeJson)
      .then((d: { ok: boolean; links?: (QuickLink & { category?: string; isActive?: boolean })[] }) => {
        _linksData = (d.links ?? []).filter((l) => l.category === "Nöbet" && l.isActive !== false);
        _linksAt = Date.now();
        _linksPromise = null;
        return _linksData;
      })
      .catch((e) => { _linksPromise = null; throw e; });
    return _linksPromise;
  },

  invalidateLinks: () => { _linksData = null; },
  invalidate: () => { _todayData = null; _listData = null; _linksData = null; },

  // actions.md #6 — admin ekraninda ACIKCA gosterilecek veri-kaynagi bilgisi (admin-only).
  sourceStatus: (): Promise<{
    ok: boolean; currentSource: "api_live" | "db_fallback" | "none"; memoryFresh: boolean;
    dbLastSyncedAt: string | null;
    config: { teamId: string | null; teamType: string | null; apiUrl: string | null; apiHost: string | null };
  }> => fetch("/api/admin/nobetci/source-status").then(safeJson),
};
