// src/utils/derinBaglanti.ts — OpsX / LogX sihirbazlarına uygulaması ÖN-SEÇİLİ gelen bağlantılar.
//
// Kullanıcı (Uygulama Hub): "Tıkladığı an OpsX'e yönlendiresin ve otomatik olarak OpsX JBoss
// sayfasında uygulaması girili halde işlemler başlasın."
//
// SÖZLEŞME (değiştirmeyin; Uygulama Hub bu biçimde bağlantı kurar):
//   /opsx?platform=jboss&app=<JBoss uygulama adı ya da taban ad>
//   /opsx?platform=was&app=<WASAppsInventory.app>
//   /opsx?platform=ocp&app=<ad>&env=<env>&tenant=<tenant>&namespace=<ns>[&cluster=<c>]
//   /logx?platform=legacy&app=<JBoss uygulama adı>
//   /logx?platform=openshift&app=<ad>&env=<env>&tenant=<tenant>&namespace=<ns>[&cluster=<c>]
//
// KURALLAR
//   * Parametreler sayfa açılışında BİR KEZ okunur; sayfa onları uyguladıktan sonra
//     `derinBaglantiTemizle()` ile URL'den siler. Yenilemede tekrar uygulanmaz (LogX'te ikinci
//     bir logx_v2_requests kaydı açılmaz).
//   * Ön-seçim bir KOLAYLIKTIR, yetki değildir: uygulama-host eşleşmesi, namespace kısıtı ve
//     prod Smart onayı sunucuda aynen doğrulanır. Burada yalnız biçim denetlenir.
//   * Geçersiz değer sessizce yutulmaz: `uyari` dolu döner, sayfa normal akışa düşer.

export const DERIN_BAGLANTI_ANAHTARLARI = ['platform', 'app', 'env', 'tenant', 'namespace', 'cluster'] as const;

// Sunucudaki SAFE_MANUAL_APP_RE / SAFE_OCP_NAME_RE ile aynı karakter kümesi.
const AD_RE = /^[A-Za-z0-9._-]{1,253}$/;

export interface OcpHedef {
  app: string;
  env: string;
  tenant: string;
  namespace: string;
  cluster?: string;
}

export type OpsxOnSecim =
  | { platform: 'jboss'; app: string }
  | { platform: 'was'; app: string }
  | ({ platform: 'ocp' } & OcpHedef);

export type LogxOnSecim = { platform: 'legacy'; app: string } | ({ platform: 'openshift' } & OcpHedef);

export interface OnSecimOkuma<T> {
  onSecim: T | null;
  /** Bağlantı vardı ama uygulanamadı: kullanıcıya gösterilecek kısa açıklama. */
  uyari: string | null;
}

function al(p: URLSearchParams, k: string): string {
  return (p.get(k) || '').trim();
}

function ocpHedefOku(p: URLSearchParams): { hedef: OcpHedef | null; uyari: string | null } {
  const hedef: OcpHedef = {
    app: al(p, 'app'),
    env: al(p, 'env'),
    tenant: al(p, 'tenant'),
    namespace: al(p, 'namespace'),
  };
  const cluster = al(p, 'cluster');
  if (cluster) hedef.cluster = cluster;
  const eksik = (['app', 'env', 'tenant', 'namespace'] as const).filter((k) => !hedef[k]);
  if (eksik.length) {
    return { hedef: null, uyari: `Bağlantıda eksik bilgi var (${eksik.join(', ')}) — hedefi elle seçin.` };
  }
  const bozuk = (Object.entries(hedef) as [string, string][]).filter(([, v]) => !AD_RE.test(v));
  if (bozuk.length) {
    return {
      hedef: null,
      uyari: `Bağlantıdaki değer geçersiz (${bozuk.map(([k]) => k).join(', ')}) — hedefi elle seçin.`,
    };
  }
  return { hedef, uyari: null };
}

function appOku(p: URLSearchParams): { app: string | null; uyari: string | null } {
  const app = al(p, 'app');
  if (!app) return { app: null, uyari: 'Bağlantıda uygulama adı yok — uygulamayı elle seçin.' };
  if (!AD_RE.test(app)) return { app: null, uyari: `Bağlantıdaki uygulama adı geçersiz: "${app}" — uygulamayı elle seçin.` };
  return { app, uyari: null };
}

function parametreler(search: string | URLSearchParams): URLSearchParams {
  return typeof search === 'string' ? new URLSearchParams(search) : search;
}

export function opsxOnSecimOku(search: string | URLSearchParams): OnSecimOkuma<OpsxOnSecim> {
  const p = parametreler(search);
  const platform = al(p, 'platform').toLowerCase();
  if (!platform) return { onSecim: null, uyari: null };
  if (platform === 'jboss' || platform === 'was') {
    const { app, uyari } = appOku(p);
    return { onSecim: app ? { platform, app } : null, uyari };
  }
  if (platform === 'ocp') {
    const { hedef, uyari } = ocpHedefOku(p);
    return { onSecim: hedef ? { platform: 'ocp', ...hedef } : null, uyari };
  }
  return { onSecim: null, uyari: `Bağlantıdaki platform tanınmadı: "${platform}".` };
}

export function logxOnSecimOku(search: string | URLSearchParams): OnSecimOkuma<LogxOnSecim> {
  const p = parametreler(search);
  const platform = al(p, 'platform').toLowerCase();
  if (!platform) return { onSecim: null, uyari: null };
  if (platform === 'legacy') {
    const { app, uyari } = appOku(p);
    return { onSecim: app ? { platform: 'legacy', app } : null, uyari };
  }
  if (platform === 'openshift') {
    const { hedef, uyari } = ocpHedefOku(p);
    return { onSecim: hedef ? { platform: 'openshift', ...hedef } : null, uyari };
  }
  return { onSecim: null, uyari: `Bağlantıdaki platform tanınmadı: "${platform}".` };
}

/** Ön-seçim parametrelerini URL'den siler (diğer parametrelere, ör. `logxRequest`, dokunmaz).
 *  `history.state` korunur: React Router geçmiş anahtarını orada tutar. */
export function derinBaglantiTemizle(): void {
  const url = new URL(window.location.href);
  let degisti = false;
  for (const k of DERIN_BAGLANTI_ANAHTARLARI) {
    if (url.searchParams.has(k)) {
      url.searchParams.delete(k);
      degisti = true;
    }
  }
  if (degisti) window.history.replaceState(window.history.state, '', url.toString());
}

/** Arama sonucu TEK satırsa ve o satır aranan adın kendisiyse (büyük/küçük harf duyarsız)
 *  envanterdeki yazımıyla döner; aksi halde null. Taban ad + -D/-T/-Q varyantları birden çok
 *  satır döndürdüğü için otomatik seçilmez — kullanıcı varyantı kendisi seçer. */
export function tekTamEslesme(apps: readonly string[], aranan: string): string | null {
  if (apps.length !== 1) return null;
  return apps[0].toUpperCase() === aranan.trim().toUpperCase() ? apps[0] : null;
}

function sorgu(v: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, d] of Object.entries(v)) if (d) p.set(k, d);
  return p.toString();
}

/** Uygulama Hub gibi çağıranlar için: sözleşmeye uygun OpsX bağlantısı. */
export function opsxDerinBaglanti(v: OpsxOnSecim): string {
  if (v.platform === 'ocp') {
    const { platform, app, env, tenant, namespace, cluster } = v;
    return `/opsx?${sorgu({ platform, app, env, tenant, namespace, cluster })}`;
  }
  return `/opsx?${sorgu({ platform: v.platform, app: v.app })}`;
}

/** Uygulama Hub gibi çağıranlar için: sözleşmeye uygun LogX bağlantısı. */
export function logxDerinBaglanti(v: LogxOnSecim): string {
  if (v.platform === 'openshift') {
    const { platform, app, env, tenant, namespace, cluster } = v;
    return `/logx?${sorgu({ platform, app, env, tenant, namespace, cluster })}`;
  }
  return `/logx?${sorgu({ platform: v.platform, app: v.app })}`;
}
