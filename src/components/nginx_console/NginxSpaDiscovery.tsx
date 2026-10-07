// src/components/nginx_console/NginxSpaDiscovery.tsx — Nginx Hub > "Gerçek SPA Keşfi".
//
// Kullanıcı (2026-10-01): "gerçekten SPA olan tüm uygulamaların çekilmesi, bu uygulamalara
// nazaran route envanterinin karşılaştırılması ve route'larının yazılması, aynı zamanda
// uygulama trafiğinin de yanlarına işlenmesi."
//
// SADELEŞTİRME (kullanıcı, aynı gün): "her uygulama için tek satır olsun; route adresleri ve
// cluster isimleri aynı satıra yazılsın; iş yükü kolonuna gerek yok; SPA, ad kalıbı ve istek
// kolonları önemli; 'kalıp kaçırdı' ne demek anlamadım." Satırlar sunucuda uygulama başına
// gruplanır (spa-discovery.cjs uygulamalar()); bu bileşen yalnız gösterir ve süzer.
//
// AYNI TABLODA ÜÇ SORU DAHA (kullanıcı, aynı gün): "uygulamanın istek alıp almadığı, intranet
// mi internet mi, internet ise BİZİM reverse proxy sunucularımızda tanımlı mı ve RP tanımı
// istek alıyor mu — hepsi tek yerde."
//
// KAYNAKLAR — hiçbiri ötekini düzeltmez, fark bilgidir:
//   keşif            → kabinde gerçekten nginx var mı (SPA) + route TLS tipi (Ağ)
//   route envanteri  → route'u envanterde kayıtlı mı (Route envanteri) + Ağ çapraz kontrolü
//   Dynatrace        → uygulama (pod) istek alıyor mu (Uygulama isteği)
//   nginx denetimi   → internet RP'de tanımlı mı (Reverse proxy) ve access log (RP isteği)
// ÖLÇÜLEMEDİ ile YOK/TANIMSIZ ASLA KARIŞMAZ: her hücre ayrı etiket taşır; satırda yalnız kod
// ve sayı var, tanım listesi satıra tıklayınca ayrı uçtan (/spa-discovery/rp) gelir.
//
// KULLANICI KARARLARI (2026-10-02): (1) yeni PROD dizin tanımlarının RP isteği host kipiyle
// (uygulama vhost'u, Host/SNI) ölçülür; (2) yalnız başka ortamın RP'sinde tanımlı uygulama
// KENDİ ortamında "tanımsız" (ya da ölçülemedi) görünür, "ortam dışı" yalnız uyarıdır;
// (3, K3) hem kendi hem başka ortamın RP'sinde tanımlıysa RP isteği kararı ve sayısı YALNIZ
// kendi ortamının tanımlarındandır — başka ortamın isteği (rpReq7Disi) yalnız bilgi olarak
// hücrede/ipucunda görünür, sayıya eklenmez, kararı değiştirmez.
//
// OKUNURLUK (kullanıcı, 2026-10-03): "kolonlar çok geniş görünüyor, okumakta çok
// zorlanıyorum". Ölçülen sebepler ve çözüm index.css `.ng-spa-tablo` başında. Düzen:
// Uygulama+namespace tek hücre (yapışkan ilk kolon), SPA+ad kalıbı tek hücre, "Reverse
// proxy" üst başlığı altında Ağ / Tanım / İstek, Adresler ve Cluster'lar ilk öğe + "+N"
// (tamamı ipucunda ve ayrıntı panelinde). Yoğunluk (Sıkı/Rahat) ve gizlenebilir kolonlar
// tarayıcıda hatırlanır. Süzgeçler ve CSV DEĞİŞMEDİ.
// DOĞRULAMA TURU (aynı gün): ikinci satırdaki rozetler kırpılmaz (yalnız düz metin kısalır);
// adresin alan adı ve uygulama adının "-app-v" eki görünür kalır (baş kısım kısalır); artan
// genişliği Adresler alır; yapışkan başlık klavye odağını örtmez (scroll-padding); ikincil
// metin --text-secondary (AA); "Reverse proxy" başlığı kendi <colgroup>'unda.
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ArrowPathIcon,
  ArrowDownTrayIcon,
  MagnifyingGlassIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ViewColumnsIcon,
} from '@heroicons/react/24/outline';
import {
  nginxConsoleApi,
  type NgSpaApp,
  type NgSpaCoverage,
  type NgSpaDiscovery,
  type NgSpaRpDetay,
  type NgSpaRpHost,
  type NgSpaRpIstekNeden,
  type NgSpaRpKapsam,
  type NgSpaRpTanim,
} from '@/api/nginxConsoleApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { downloadCsv } from '@/utils/csv';
import { fmtDateTime, fmtNumber } from '@/utils/datetime';

// ORTAK BICIMLENDIRICI (G19): yerel ayar ve saat dilimi tek yerde (utils/datetime.ts).
const nf = (n: number) => fmtNumber(n);

const DURUM_ETIKETI: Record<string, { t: string; renk: string }> = {
  ok: { t: 'tarandı', renk: 'var(--status-success)' },
  kismi: { t: 'kısmi', renk: 'var(--status-warning)' },
  login: { t: 'giriş yapılamadı', renk: 'var(--status-danger)' },
  hata: { t: 'taranamadı', renk: 'var(--status-danger)' },
  erisilemedi: { t: 'sonuç gelmedi', renk: 'var(--status-danger)' },
  bilinmiyor: { t: 'durum bilinmiyor', renk: 'var(--text-muted)' },
};

// ── AĞ / RP / RP İSTEĞİ ETİKETLERİ ─────────────────────────────────────────────────────
const MUTED = 'var(--text-muted)';
/**
 * TABLODA ikincil ama ANLAM taşıyan metin (namespace, "Hayır", "kapsam dışı", "—" ...).
 * --text-muted küçük metinde AA'nın altında kalıyordu (doğrulama, 2026-10-03: koyu temada
 * normal satır 4.33, zebra 3.92, seçili satır 3.11; eşik 4.5). MUTED yalnız süs ekleri ("/7g").
 */
const SOLUK = 'var(--text-secondary)';
const WARN = 'var(--status-warning)';
const DANGER = 'var(--status-danger)';
const OK = 'var(--status-success)';

const AG_ETIKET: Record<NgSpaApp['ag'], { t: string; renk: string; ipucu: string }> = {
  internet: {
    t: 'internet',
    renk: 'var(--text-primary)',
    ipucu: 'Route TLS passthrough → internet (kural).',
  },
  intranet: {
    t: 'intranet',
    renk: 'var(--text-secondary)',
    ipucu: 'Route TLS reencrypt → intranet (kural).',
  },
  karisik: {
    t: 'karışık',
    renk: WARN,
    ipucu: "Hem passthrough hem reencrypt route var. RP'de internet gibi aranır.",
  },
  diger: {
    t: 'diğer',
    renk: SOLUK,
    ipucu: "Yalnız edge ya da TLS'siz route — kural dışında, sınıflanmaz; RP aranmaz.",
  },
  bilinmiyor: {
    t: 'bilinmiyor',
    renk: WARN,
    ipucu: 'Route TLS bilgisi boş (NULL) — ağ ölçülemedi; "intranet" sayılmaz.',
  },
};
const AG_SAY_ADI: Record<string, string> = {
  passthrough: 'passthrough',
  reencrypt: 'reencrypt',
  edge: 'edge/diğer',
  tlsYok: "TLS'siz",
  bos: 'bilinmiyor',
};
const AG_ENVANTER_METNI: Record<NgSpaApp['agEnvanter'], string> = {
  uyumlu: 'termination_type keşifle aynı',
  celisik: 'termination_type keşiften FARKLI (Ağ keşiften alınır, bu yalnız uyarı)',
  'envanterde-yok': 'route envanterde yok (haftalık tablo; bilgi)',
  olculemedi: 'route envanteri okunamadı ya da termination_type gelmedi',
};

const RP_ETIKET: Record<NgSpaApp['rp'], { t: string; renk: string }> = {
  tanimli: { t: 'tanımlı', renk: OK },
  tanimsiz: { t: 'tanımsız', renk: DANGER },
  olculemedi: { t: 'ölçülemedi', renk: WARN },
  'kapsam-disi': { t: 'kapsam dışı', renk: SOLUK },
  uygulanamaz: { t: '—', renk: SOLUK },
};
const RPI_ETIKET: Record<NgSpaApp['rpIstek'], { t: string; renk: string; ipucu: string }> = {
  var: {
    t: 'istek var',
    renk: 'var(--text-primary)',
    ipucu:
      "RP access log: kendi ortamının RP tanımlarında son 7 günde istek var (hc.jsp/hc.html hariç).",
  },
  yok: {
    t: 'istek yok',
    renk: WARN,
    ipucu:
      "Kendi ortamının tüm RP tanımları ölçüldü, pencere ≥ 7 gün, örnekleme yok ve toplam 0 (başka ortamın RP'sindeki istek bu karara girmez).",
  },
  kismi: {
    t: 'kısmi',
    renk: WARN,
    ipucu: '0 istek bir ALT SINIRDIR — "istek yok" DEĞİL. Neden:',
  },
  olculemedi: {
    t: 'ölçülemedi',
    renk: WARN,
    ipucu:
      'En az bir tanım ölçülemedi (log okunamadı, satır yok, location tipi) ve hiçbir yerde istek görülmedi.',
  },
  'kaynak-yok': {
    t: 'ölçüm kaynağı yok',
    renk: MUTED,
    ipucu:
      "Yalnız yeni PROD dizin tanımı var ve o gün hiçbir sunucuda host kipi satırı üretilmedi (nginx_spa_traffic.sh host kipi henüz koşmadı ya da SPA_HOST_MODE kapalı) — uygulama vhost'ları için access log sayımı yok.",
  },
  ayrilamaz: {
    t: 'ayrılamaz',
    renk: MUTED,
    ipucu:
      'Tanım bu uygulamaya ayrılamıyor (adresi başka route\'larla paylaşılıyor ya da ad birden çok uygulamaya çözülüyor) — trafiği bu uygulamanın "istek var/yok" kararına katılmaz. Ayrıntı için satıra tıklayın.',
  },
  uygulanamaz: {
    t: '—',
    renk: SOLUK,
    ipucu:
      "Kendi ortamının RP'sinde tanım yok, bulunamadı (RP ölçülemedi — 'yok' denmedi) ya da RP kapsam dışı; veya RP kolonları bu uygulama için hesaplanmıyor.",
  },
};
/** rpIstek='kismi' iken 0'ın neden alt sınır olduğu (sunucu: spa-rp.cjs KODLAR.rpIstekNeden). */
const RPI_NEDEN_METNI: Record<NgSpaRpIstekNeden, string> = {
  pencere:
    'ölçülen pencere 7 günden kısa, log örneklendi (512 MB kuyruk ya da Host alanı olmayan satır) veya pencere başı bilinmiyor',
  'eslesmeyen-host':
    "yeni PROD sunucusunda hiçbir uygulamaya yazılamayan istek var (eşleşmeyen Host / IP / Host alanı yok) — nginx bunları varsayılan sunucuya düşürür, o vhost bu uygulama olabilir",
  'kaynak-yok':
    'ölçüm kaynağı olmayan tanım da var (yeni PROD dizin tanımı; host kipi satırı hiç üretilmedi)',
  ayrilamaz: 'uygulamaya ayrılamayan (paylaşımlı / belirsiz) tanım da var',
  'host-taranmadi':
    'ortamın bir RP sunucusu son taramada yok — orada görülmeyen bir tanım istek alıyor olabilir',
};
const YOL_ADI: Record<string, { t: string; ipucu: string }> = {
  proxy: { t: 'proxy', ipucu: 'Eski PROD (GBRVP*) proxy_pass → OpenShift route' },
  include: { t: 'include', ipucu: 'Servis vhost location → application-confs include' },
  dizin: {
    t: 'dizin',
    ipucu:
      "Yeni PROD (GBNGXP4x/AP3x) dizin kurulumu (application-confs conf var). RP isteği: uygulama vhost'unun (conf.d/<app>-<ns>.conf) ortak log'unda Host/SNI sayımı (host kipi).",
  },
};
const ESLES_ADI: Record<string, string> = {
  kesin: 'kesin',
  'ek-prod': "'-prod' eki eklenerek eşlendi",
  ad: 'ad kalıbından eşlendi',
  envanter: 'route envanteri üzerinden eşlendi',
  zayif: 'zayıf eşleşme (yalnız ad + ortam)',
  paylasimli: "aynı adresi paylaşan route'lar — tanım bu uygulamaya ayrılamaz",
  belirsiz: 'ad birden çok uygulamaya çözülüyor — tanım bu uygulamaya ayrılamaz',
};
const TABLO_ADI: Record<string, string> = {
  config: 'Nginx_Config_Audit',
  dizin: 'Nginx_Intranet_Audit',
  upstream: 'Nginx_Audit_Upstreams',
};
/** Tanım başına trafik 'ölçülemedi' nedeni (sunucu: spa-rp.cjs KODLAR.trafikNeden). */
const TRAFIK_NEDEN: Record<string, string> = {
  log: 'log / betik hatası',
  'location-tipi': 'location tipi ölçülmüyor (=, ~ ya da regex)',
  host: "sunucunun o gün hiç trafik satırı yok (zaman aşımı, ulaşılamadı ya da spa_traffic=false)",
  'satir-yok': "bu location / uygulama vhost'u için trafik satırı yok",
  'host-kipi-yok':
    "sunucuda host kipi (uygulama vhost'u) satırı yok — SPA_HOST_MODE kapalı ya da conf.d'de uygulama vhost'u bulunamadı",
  'tablo-yok': 'trafik tablosu yok',
  okunamadi: 'trafik tablosu okunamadı',
};
/** Ortam dışı tanım uyarısı: "PROD RP'de tanımlı". */
const ortamDisiMetni = (a: NgSpaApp) =>
  `${(a.rpOrtamDisi || []).join(', ') || 'başka ortam'} RP'sinde tanımlı`;
/**
 * K3 BİLGİSİ: başka ortamın RP tanımlarında görülen istek (rpReq7Disi). Sayıya EKLENMEZ, kararı
 * değiştirmez; yalnız sunucu yazdıysa (> 0) metin döner.
 */
const disiIstekMetni = (a: NgSpaApp) =>
  a.rpReq7Disi != null
    ? `Bilgi (ortam dışı): ${(a.rpOrtamDisi || []).join('/') || 'başka ortam'} RP tanımında son 7 günde ${nf(a.rpReq7Disi)} istek görüldü — ${String(a.env || '').toUpperCase() || 'kendi ortamının'} RP isteği kararına ve sayısına girmez.`
    : '';
/**
 * rpIstek='uygulanamaz' GEREKÇESİ: RP kolonları hesaplanmıyor (K4) ya da uygulama KENDİ
 * ortamının RP'sinde tanımlı değil (K1/K3 — başka ortamın tanımı RP isteği sorusunu açmaz).
 * rp 'ölçülemedi' iken "tanım yok" denmez: tanım BULUNAMADI (olmadığı kesin değil).
 */
function rpIstekUygulanamazMetni(a: NgSpaApp): string {
  if (a.rp === 'uygulanamaz')
    return a.spa !== 'evet'
      ? 'RP kolonları yalnız SPA uygulamalar için hesaplanır.'
      : `Ağ "${AG_ETIKET[a.ag]?.t || a.ag}": RP yalnız internet ve karışık uygulamalarda aranır.`;
  const ENV = String(a.env || '').toUpperCase() || '?';
  if (a.rp === 'olculemedi')
    return `Kendi ortamının (${ENV}) RP'sinde tanım bulunamadı — RP ölçülemedi ("tanımsız" da denmedi); RP isteği sorulmaz.`;
  if (a.rp === 'kapsam-disi')
    return `RP kapsam dışı (${ENV}) — kendi ortamının RP'sinde tanım aranmıyor; RP isteği sorulmaz.`;
  return `Kendi ortamının (${ENV}) RP'sinde tanım yok — RP isteği sorulmaz.`;
}
/** Kovanın 7 günlük toplamı (hiçbir uygulamaya yazılmayan istek). */
const kovaToplam = (k?: NgSpaRpHost['kova']) => (k ? k.eslesmeyen + k.ip + k.alansiz : 0);
const kovaMetni = (k?: NgSpaRpHost['kova']) =>
  k
    ? `uygulamaya yazılamayan istek (7g): eşleşmeyen Host ${nf(k.eslesmeyen)} · IP ${nf(k.ip)} · Host alanı yok ${nf(k.alansiz)}`
    : '';

/** 'yyyymmddHHMMSS' → 'yyyy-mm-dd HH:MM' */
const zaman = (s?: string | null) =>
  s && s.length >= 12
    ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`
    : s || '—';
const pencere = (sa?: number | null) =>
  sa == null ? 'bilinmiyor' : sa >= 48 ? `${Math.floor(sa / 24)} gün` : `${sa} sa`;

/** rpNeden kodu → okunur metin (ortamın taranmayan host listesi kapsamdan). */
function rpNedenMetni(a: NgSpaApp, k?: NgSpaRpKapsam | null): string {
  const [kod, ek] = String(a.rpNeden || '').split(':');
  const ENV = String(a.env || '').toUpperCase();
  switch (kod) {
    case 'host-taranmadi': {
      const l = k?.taranmayan?.[ENV] || [];
      return `${l.join(', ') || 'Ortamın RP sunucularından biri'} son taramada yok → ${ENV} için "tanımsız" denmiyor.`;
    }
    case 'proxy-kolonu-yok':
      return "Nginx_Config_Audit'te proxy kolonları (kind/upstream_name/target_url/upstream_defined) yok: PROD proxy_pass satırları yazılmıyor.";
    case 'tablo-yok':
      return `${TABLO_ADI[ek] || ek || 'Tablo'} tablosu yok.`;
    case 'okunamadi':
      return `${TABLO_ADI[ek] || ek || 'Tablo'} okunamadı (sorgu düştü).`;
    case 'ortam-yok':
      return "Namespace'ten ortam çıkmıyor (-dev/-test/-qa/-edu/-prod eki yok).";
    case 'rp-listesi-yok':
      return `${ENV} ortamı için internet RP listesi yok (kapsam dışı).`;
    case 'platform':
      return 'ARK dışı platform — bizim RP\'lerden geçtiği teyit edilmedi; tanım bulunamazsa "tanımsız" denmez.';
    case 'hedef-cozulemedi':
      return `${ENV} RP'lerinde gerçek arka ucu bulunamayan upstream takma adlı proxy tanımı var (Nginx_Audit_Upstreams adı içermiyor) — bu uygulamaya gidiyor olabilir; "tanımsız" denmiyor.`;
    case 'belirsiz':
      return "Aynı adlı uygulama birden çok namespace'te; RP'deki namespace'siz (flat) tanım hangisine ait bilinmiyor — \"tanımsız\" denmiyor.";
    case 'tarih-farkli':
      return `${TABLO_ADI[ek] || ek || 'Tablo'} taraması (${k?.dizinTarih || '?'}) config taramasından (${k?.configTarih || '?'}) farklı günden — yeni PROD sunucularının o günkü durumu bilinmiyor; PROD için "tanımsız" denmiyor.`;
    default:
      return a.rpNeden || '';
  }
}

/** RP isteği 'kısmi'nin NEDEN alt sınır olduğu (taranmayan sunucular kapsamdan). */
function rpIstekNedenMetni(a: NgSpaApp, k?: NgSpaRpKapsam | null): string {
  const ENV = String(a.env || '').toUpperCase();
  return (a.rpIstekNeden || [])
    .map((n) => {
      const m = RPI_NEDEN_METNI[n] || n;
      if (n !== 'host-taranmadi') return `• ${m}`;
      const l = k?.taranmayan?.[ENV] || [];
      return `• ${m}${l.length ? ` (taranmayan: ${l.join(', ')})` : ''}`;
    })
    .join('\n');
}

/**
 * CLUSTER KAPSAMI (2026-10-01, ilk üretim koşusu): 43 cluster'ın 27'si hiç veri üretmedi
 * ama ekran yalnızca "0 SPA" diyordu. "Taranamadı" ile "SPA'sı yok" burada AYRILIR.
 * Kovalar AYRIKTIR: her cluster tek sayıda geçer, toplamları cluster sayısıdır.
 */
function Kapsam({ k }: { k: NgSpaCoverage }) {
  if (k.error)
    return (
      <div className="text-[11px]" style={{ color: 'var(--status-warning)' }}>
        Kapsam ölçülemedi: {k.error} — hangi cluster'ların taranamadığı şu an bilinmiyor.
      </div>
    );
  if (!k.measured)
    return (
      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Cluster tarama durumu kaydı yok (yükleyicinin eski sürümüyle yüklenmiş veri) — hangi
        cluster'ların taranamadığı bilinmiyor.
      </div>
    );
  const sorunlu = k.clusters.filter((c) => c.bucket !== 'guncel');
  return (
    <details open={k.failed > 0} className="text-[11px]">
      <summary
        className="cursor-pointer"
        style={{ color: k.failed ? 'var(--status-danger)' : 'var(--text-secondary)' }}
      >
        Kapsam ({nf(k.total)} cluster): {nf(k.ok)} son koşuda tam tarandı
        {k.older > 0 && <> · {nf(k.older)} önceki koşudan</>}
        {k.partial > 0 && <> · {nf(k.partial)} kısmi</>}
        {k.failed > 0 && (
          <>
            {' '}
            · <b>{nf(k.failed)} taranamadı</b>
          </>
        )}
        {k.unknown > 0 && <> · {nf(k.unknown)} durumu bilinmiyor</>}
        {k.noData > 0 && <> (bunların {nf(k.noData)} tanesinin ekranda hiç verisi yok)</>}
      </summary>
      {sorunlu.length > 0 && (
        // font-size inherit: index.css `table` kurali (katmansiz, 14 px) ozetin 11 px'ini eziyordu.
        <table className="mt-1.5 w-full" style={{ fontSize: 'inherit' }}>
          <tbody>
            {sorunlu.map((c) => {
              const e =
                c.bucket === 'onceki'
                  ? {
                      t: `son koşuya dahil değildi (son tarama ${c.runDate})`,
                      renk: 'var(--text-muted)',
                    }
                  : DURUM_ETIKETI[c.status] || DURUM_ETIKETI.bilinmiyor;
              return (
                <tr
                  key={c.cluster}
                  className="border-t"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <td className="py-0.5 pr-2 font-mono">{c.cluster}</td>
                  <td
                    className="py-0.5 pr-2 whitespace-nowrap"
                    style={{ color: e.renk, fontWeight: 600 }}
                  >
                    {e.t}
                  </td>
                  <td
                    className="py-0.5 pr-2 whitespace-nowrap"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {c.noData
                      ? 'ekranda verisi yok'
                      : c.stale
                        ? `ekrandaki veri ${c.dataDate} tarihli, önceki koşudan`
                        : `veri ${c.dataDate}`}
                  </td>
                  <td className="py-0.5 break-all" style={{ color: 'var(--text-secondary)' }}>
                    {c.reason || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </details>
  );
}

/** Tablo durumu + tarih: "2026-10-01" | "tablo yok" | "okunamadı". */
const kaynakMetni = (durum: string | undefined, tarih: string) =>
  durum === 'yok' ? 'tablo yok' : durum === 'okunamadi' ? 'okunamadı' : tarih || 'satır yok';

/**
 * RP KAYNAK KAPSAMI: "ölçülemedi"nin NEREDEN geldiği burada yazar. Bir ortamın "tanımsız"
 * sayısı yalnız o ortamın tüm RP sunucuları taranmışsa anlamlıdır.
 */
function RpKapsamBand({ k }: { k: NgSpaRpKapsam }) {
  const taranan = k.hostlar.filter((h) => h.taranan).length;
  const eksikler = Object.entries(k.taranmayan || {});
  const cozulemeyen = Object.entries(k.cozulemeyen || {}).filter(([, n]) => n > 0);
  const hedefYok = Object.entries(k.hedefCozulemeyen || {}).filter(([, n]) => n > 0);
  const t = k.tablolar;
  // YENI PROD host kipi: o gun hicbir sunucuda '@' satiri yoksa dizin tanimlari olculmez.
  const yeniProd = k.hostlar.filter((h) => h.rol === 'prod-yeni');
  const hostKipiYok = t.trf === 'var' && k.hostKipi === false && yeniProd.length > 0;
  const kovali = k.hostlar.filter((h) => kovaToplam(h.kova) > 0);
  return (
    <details
      open={
        eksikler.length > 0 ||
        k.envanterOkunamadi ||
        k.dynatraceOkunamadi ||
        !!k.dizinFarkli ||
        hedefYok.length > 0
      }
      className="text-[11px]"
    >
      <summary className="cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
        Reverse proxy kaynakları: config {kaynakMetni(t.cfg, k.configTarih)} · dizin{' '}
        {kaynakMetni(t.dir, k.dizinTarih)} · trafik {kaynakMetni(t.trf, k.trafikTarih)} · upstream{' '}
        {kaynakMetni(t.ups, k.upsTarih)} · taranan internet RP {nf(taranan)}/{nf(k.hostlar.length)}
        {k.proxyKolonu === false && (
          <b style={{ color: WARN }}> · proxy kolonları yok (PROD "tanımsız" denmiyor)</b>
        )}
      </summary>
      <div className="mt-1 space-y-0.5">
        {eksikler.map(([env, l]) => (
          <div key={env} style={{ color: WARN }}>
            {l.join(', ')} son taramada yok → {env} için "tanımsız" ve "RP isteği yok" denmiyor
            (ölçülemedi / kısmi).
          </div>
        ))}
        {k.dizinFarkli && (
          <div style={{ color: WARN }}>
            Dizin taraması (Nginx_Intranet_Audit {k.dizinTarih || '?'}) config taramasından (
            {k.configTarih || '?'}) farklı günden → yeni PROD sunucuları o gün taranmış sayılmıyor;
            PROD için "tanımsız" denmiyor (ölçülemedi).
          </div>
        )}
        {hedefYok.length > 0 && (
          <div style={{ color: WARN }}>
            Gerçek arka ucu bulunamayan upstream takma adlı proxy tanımı:{' '}
            {hedefYok.map(([e, n]) => `${e} ${nf(n)}`).join(' · ')} (upstream{' '}
            {kaynakMetni(t.ups, k.upsTarih)}) → bu ortamlarda "tanımsız" denmiyor (ölçülemedi).
          </div>
        )}
        {hostKipiYok && (
          <div style={{ color: MUTED }} data-testid="rp-host-kipi-yok">
            Yeni PROD uygulama vhost'ları için host kipi ölçümü yok (trafik taramasında '@'
            satırı üretilmedi: nginx_spa_traffic.sh host kipi henüz koşmadı ya da SPA_HOST_MODE
            kapalı) → dizin tanımlarının RP isteği "ölçüm kaynağı yok".
          </div>
        )}
        {kovali.length > 0 && (
          <div style={{ color: MUTED }}>
            Hiçbir uygulamaya yazılamayan RP isteği (7 gün):{' '}
            {kovali.map((h) => `${h.host} ${nf(kovaToplam(h.kova))}`).join(' · ')} — bu
            sunuculardaki uygulamaların 0 isteği alt sınırdır (kısmi).
          </div>
        )}
        {k.envanterOkunamadi && (
          <div style={{ color: WARN }}>
            Route envanteri okunamadı — "Route envanteri" ve Ağ çapraz kontrolü ölçülemedi.
          </div>
        )}
        {k.dynatraceOkunamadi && (
          <div style={{ color: WARN }}>
            Dynatrace ölçümü okunamadı — "Uygulama isteği" tüm satırlarda ölçülemedi.
          </div>
        )}
        {cozulemeyen.length > 0 && (
          <div style={{ color: MUTED }}>
            Keşifteki hiçbir uygulamaya bağlanamayan RP tanımı:{' '}
            {cozulemeyen.map(([e, n]) => `${e} ${nf(n)}`).join(' · ')}
            {k.belirsiz > 0 && <> · {nf(k.belirsiz)} belirsiz (birden çok aday)</>} (keşfe girmeyen
            cluster, API ya da özel alan adı olabilir).
          </div>
        )}
        <div style={{ color: MUTED }}>
          Sunucular:{' '}
          {k.hostlar.map((h, i) => (
            <span key={h.host}>
              {i > 0 && ' · '}
              <span
                className="font-mono"
                style={{ color: h.taranan ? 'var(--text-secondary)' : WARN }}
                title={[
                  `${h.env} · ${h.rol} · ${h.taranan ? 'tarandı' : 'son taramada YOK'} · trafik: ${h.trafik}${h.trafikHata ? ` (${h.trafikHata} log hatası)` : ''}`,
                  h.hostKipi != null ? `host kipi satırı: ${nf(h.hostKipi)}` : '',
                  kovaMetni(h.kova),
                ]
                  .filter(Boolean)
                  .join('\n')}
              >
                {h.host}
                {!h.taranan && '✗'}
              </span>
            </span>
          ))}
        </div>
      </div>
    </details>
  );
}

// ── HÜCRE YAPI TAŞLARI (2026-10-03) ───────────────────────────────────────────────────
// Kullanıcı: "kolonlar çok geniş, okumakta zorlanıyorum". Her hücre İKİ SATIR: 1. satır
// karar (rozet ya da sayı), 2. satır ikincil işaret (ad kalıbı, envanter farkı, ortam dışı,
// ölçülemedi nedeni...). Uzun açıklama ipucunda kalır; hücre tek satırda uzamaz.
type Ton = 'iyi' | 'kotu' | 'uyari' | 'notr' | 'bilgi';
/** PF Label tonları (index.css .pf-label--*): metin rengi iki temada da okunur. */
const TON_SINIFI: Record<Ton, string> = {
  iyi: 'pf-label--green',
  kotu: 'pf-label--red',
  uyari: 'pf-label--gold',
  notr: 'pf-label--grey',
  bilgi: 'pf-label--orange',
};

/**
 * Durum rozeti. `olcum`: ÖLÇÜLEMEDİ türü durum (ölçülemedi / bilinmiyor / ölçüm yok / ölçüm
 * kaynağı yok) KESİK çerçeveyle çizilir; "yok" ve "tanımsız" düz çerçeve. Ayrım yalnız renge
 * kalmaz: rozet metni her zaman yazar, çerçeve ikinci işarettir.
 */
function Rozet({
  ton,
  olcum,
  testId,
  ipucu,
  children,
}: {
  ton: Ton;
  olcum?: boolean;
  testId?: string;
  ipucu?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`pf-label ${TON_SINIFI[ton]}${olcum ? ' ng-olcum' : ''}`}
      data-testid={testId}
      title={ipucu}
    >
      {children}
    </span>
  );
}

/**
 * İki satırlı hücre. İpucu (title) DIŞ kapta: td'nin ilk öğesi bütün hücrenin ipucunu taşır.
 * Satırlar arasındaki boşluk metin düğümü: kopyalanan metin "istek yok ortam dışı ..." diye
 * ayrılır (bloklar arasında görünmez).
 *
 * İKİNCİ SATIR SIRASI YAPIDAN GELİR (doğrulama bulgusu, 2026-10-03): önce `rozetler`, en sonda
 * `kisa` düz metin. Eskiden ikinci satır TEK kırpılan satırdı (11rem + "…"); rozet bölünmeyen
 * bir kutu olduğundan kısa neden metninin ARKASINDAKİ rozet hiç çizilmiyordu ("ölçülemedi /
 * sunucu taranmadı…" görünür, "PROD RP'sinde tanımlı" görünmez; tanımlı hücrede
 * BROKEN_INCLUDE "…" arkasında). Şimdi rozetler KIRPILMAZ (sığmazsa alt satıra sarar,
 * index.css `.ng-ikinci`); yalnız `kisa` metin (`.ng-kisa`) kısalır, tamamı ipucunda.
 * Rozet sırası çağıranda: kötü (kırmızı) → uyarı → bilgi.
 */
function Hucre({
  ipucu,
  rozetler,
  kisa,
  children,
}: {
  ipucu?: string;
  rozetler?: ReactNode[];
  kisa?: string;
  children: ReactNode;
}) {
  const dolu = (rozetler || []).filter((r) => r != null && r !== false && r !== '');
  return (
    <span className="block" title={ipucu || undefined}>
      <span className="block">{children}</span>
      {dolu.length || kisa ? (
        <>
          {' '}
          <span className="ng-ikinci">
            {dolu.map((r, i) => (
              // Boşluk metni kopyalamada ayırır; flex kapta görünmez (gap aralığı verir).
              <Fragment key={i}>
                {i > 0 && ' '}
                {r}
              </Fragment>
            ))}
            {kisa && (
              <>
                {dolu.length > 0 && ' '}
                <span className="ng-kisa">{kisa}</span>
              </>
            )}
          </span>
        </>
      ) : null}
    </span>
  );
}

/**
 * Ad kalıbı (SPA hücresinin 2. satırı): uygulama adı -app-v / -app-emb-v kuralına uyuyor mu.
 * İşaretli durumlar (gerçek SPA ama ad uymuyor / ad uyuyor ama nginx yok) ROZET; olağan durum
 * kısa metin. Kalıbın kendisi hücrenin ipucunda.
 */
const KALIP_IPUCU = 'Ad kalıbı: -app-v / -app-emb-v';
function kalipIsareti(a: NgSpaApp): { rozet?: ReactNode; kisa?: string } {
  if (a.patternMiss)
    return {
      rozet: (
        <Rozet
          ton="kotu"
          ipucu="Gerçekten SPA ama adı -app-v / -app-emb-v kuralına uymuyor. Eski (ada bakan) yöntem bu uygulamayı SPA saymıyordu."
        >
          kalıba uymuyor
        </Rozet>
      ),
    };
  if (a.patternFalse)
    return {
      rozet: (
        <Rozet ton="uyari" ipucu="Adı SPA kuralına uyuyor ama kabinde nginx bulunamadı.">
          kalıba uyuyor
        </Rozet>
      ),
    };
  return { kisa: `kalıba ${a.pattern}` };
}

/**
 * SPA kolonu (ad kalıbı ikinci satırda). ÜÇ DURUM AYRI: hiçbir route eşleşmediyse
 * "bilinmiyor" — "hayır" DEĞİL.
 */
function SpaHucre({ a }: { a: NgSpaApp }) {
  const kalip = kalipIsareti(a);
  const kalipSatiri = `\n${KALIP_IPUCU} → ${a.pattern}`;
  if (a.spa === 'evet')
    return (
      <Hucre
        ipucu={`Kabinde nginx çalışıyor · kanıt: ${a.signals.join(', ') || '—'}${kalipSatiri}`}
        rozetler={[kalip.rozet]}
        kisa={kalip.kisa}
      >
        <Rozet ton="iyi">Evet</Rozet>
        {a.weakEvidence && (
          <span
            className="ml-1"
            title="Servis okunamadı; route, servisle aynı adı taşıyan iş yüküne bağlandı. Selector eşleşmesinden zayıf bir kanıt."
          >
            <Rozet ton="uyari">zayıf kanıt</Rozet>
          </span>
        )}
      </Hucre>
    );
  if (a.spa === 'hayir')
    return (
      <Hucre
        ipucu={`Route'un ardındaki iş yükünde nginx bulunamadı${kalipSatiri}`}
        rozetler={[kalip.rozet]}
        kisa={kalip.kisa}
      >
        <span style={{ color: SOLUK }}>Hayır</span>
      </Hucre>
    );
  return (
    <Hucre
      ipucu={`Hiçbir route bir iş yüküne eşlenemedi — SPA olup olmadığı ölçülemedi.\n${a.notes.join('\n')}${kalipSatiri}`}
      rozetler={[kalip.rozet]}
      kisa={kalip.kisa}
    >
      <Rozet ton="uyari" olcum>
        Bilinmiyor
      </Rozet>
    </Hucre>
  );
}

/**
 * Uygulama isteği kolonu (Dynatrace). BEŞ DURUM AYRI: istek var ≠ istek yok ≠ Dynatrace
 * servisi yok ≠ ölçülemedi ≠ ölçüm yok. Statik SPA'nın pod'una istek gitmeyebilir: "istek yok"
 * ile "RP isteği var" birlikte tutarlıdır.
 */
function IstekHucre({ a }: { a: NgSpaApp }) {
  if (a.istek === 'olcum-yok')
    return (
      <Hucre ipucu="Bu uygulama için Dynatrace ölçümü bulunamadı — “istek almıyor” DEMEK DEĞİL.">
        <Rozet ton="notr" olcum>
          ölçüm yok
        </Rozet>
      </Hucre>
    );
  if (a.istek === 'olculemedi')
    return (
      <Hucre
        ipucu={
          a.usage
            ? `Dynatrace ölçümü denendi ama düştü${a.usage.note ? ': ' + a.usage.note : ''}. “0 istek” anlamına GELMEZ.`
            : 'Dynatrace ölçüm tablosu okunamadı. “0 istek” anlamına GELMEZ.'
        }
      >
        <Rozet ton="uyari" olcum>
          ölçülemedi
        </Rozet>
      </Hucre>
    );
  const pencereMetni = a.usage
    ? `Dynatrace servis çağrıları · son ${a.usage.windowDays} gün · ${a.usage.services} servis · ölçüm ${a.usage.scanDate}`
    : '';
  if (a.istek === 'servis-yok')
    return (
      <Hucre
        ipucu={`Dynatrace servisi yok: Dynatrace'te bu uygulama için servis oluşmamış — “istek yok” DEMEK DEĞİL (statik SPA'nın pod'u istek almayabilir).\n${pencereMetni}`}
      >
        <Rozet ton="notr">servis yok</Rozet>
      </Hucre>
    );
  if (a.istek === 'yok')
    return (
      <Hucre ipucu={pencereMetni}>
        <Rozet ton="uyari">istek yok</Rozet>
      </Hucre>
    );
  return (
    <Hucre ipucu={pencereMetni}>
      <span style={{ color: 'var(--text-primary)' }}>{nf(a.reqShown || 0)}</span>
    </Hucre>
  );
}

/** Ağ kolonu: route TLS tipinden; envanter çapraz kontrolü 2. satırda rozet, değeri EZMEZ. */
function AgHucre({ a }: { a: NgSpaApp }) {
  const e = AG_ETIKET[a.ag] || AG_ETIKET.bilinmiyor;
  const celisik = a.agEnvanter === 'celisik';
  const say = Object.entries(a.agSay || {})
    .map(([k, v]) => `${AG_SAY_ADI[k] || k} ${v}`)
    .join(' · ');
  const title =
    `${e.ipucu}\nRoute'lar: ${say || '—'}\nRoute envanteri: ${AG_ENVANTER_METNI[a.agEnvanter] || a.agEnvanter}${celisik && a.agCelisikRoute ? ` (${a.agCelisikRoute} route)` : ''}` +
    (a.agCelisme ? "\nÇelişki: intranet uygulama internet RP'de tanımlı (kural ile tanım çelişiyor)." : '') +
    (a.staleClusters.length ? '\nBir cluster son koşuda taranamadı; değer önceki koşudan.' : '');
  // Kırmızı çelişki ÖNCE: ikisi birlikteyse sayılı uyarı rozeti onu satırın dışına itmesin.
  const rozetler = [
    a.agCelisme && (
      <Rozet ton="kotu" testId="ag-celisme">
        RP'de tanımlı
      </Rozet>
    ),
    celisik && (
      <Rozet ton="uyari" testId="ag-envanter-farkli">
        envanter farklı{a.agCelisikRoute ? ` (${a.agCelisikRoute})` : ''}
      </Rozet>
    ),
  ];
  return (
    <Hucre ipucu={title} rozetler={rozetler}>
      {a.ag === 'karisik' ? (
        <Rozet ton="uyari">{e.t}</Rozet>
      ) : a.ag === 'bilinmiyor' ? (
        <Rozet ton="uyari" olcum>
          {e.t}
        </Rozet>
      ) : (
        <span style={{ color: e.renk, fontWeight: a.ag === 'internet' ? 600 : 400 }}>{e.t}</span>
      )}
    </Hucre>
  );
}

/**
 * RP 'ölçülemedi' / 'kapsam dışı' NEDENİNİN kısa adı (hücrenin 2. satırı; tam metin ipucunda,
 * rpNedenMetni). Listede olmayan kod 2. satırda HAM görünmez (yalnız ipucu).
 */
const RP_NEDEN_KISA: Record<string, string> = {
  'ortam-yok': 'ortam çıkmıyor',
  'rp-listesi-yok': 'RP listesi yok',
  platform: 'ARK dışı platform',
  'tablo-yok': 'tablo yok',
  okunamadi: 'tablo okunamadı',
  'tarih-farkli': 'tarama günü farklı',
  'proxy-kolonu-yok': 'proxy kolonu yok',
  'host-taranmadi': 'sunucu taranmadı',
  'hedef-cozulemedi': 'hedef çözülemedi',
  belirsiz: 'birden çok namespace',
};
/** Eşleşme yolunun kısa adı (tanımlı hücrenin 2. satırı; tam metin ESLES_ADI ipucunda). */
const ESLES_KISA: Record<string, string> = {
  'ek-prod': "'-prod' eki",
  ad: 'ad kalıbından',
  envanter: 'envanterden',
  zayif: 'zayıf eşleşme',
  paylasimli: 'paylaşımlı',
  belirsiz: 'belirsiz',
};

/** Reverse proxy › Tanım kolonu: tanımlı / tanımsız / ölçülemedi / kapsam dışı / —. */
function RpHucre({ a, k }: { a: NgSpaApp; k?: NgSpaRpKapsam | null }) {
  const e = RP_ETIKET[a.rp] || RP_ETIKET.olculemedi;
  if (a.rp === 'uygulanamaz')
    return (
      <Hucre
        ipucu={
          a.spa !== 'evet'
            ? 'RP kolonları yalnız SPA uygulamalar için hesaplanır.'
            : `Ağ "${AG_ETIKET[a.ag]?.t || a.ag}": RP yalnız internet ve karışık uygulamalarda aranır.`
        }
      >
        <span style={{ color: e.renk }}>{e.t}</span>
      </Hucre>
    );
  const ortamDisi = !!a.rpSorun?.includes('ORTAM_DISI');
  if (a.rp === 'tanimli') {
    const sorunlar = (a.rpSorun || []).filter((s) => s !== 'ORTAM_DISI');
    // SIRA: sorun kodları (kırmızı, her biri AYRI rozet) → ortam dışı (bilgi) → eşleşme yolu.
    // Satırda yeşil "tanımlı" görünürken sorun kodu "…" arkasında kalmaz (doğrulama bulgusu).
    const rozetler = [
      ...sorunlar.map((s) => (
        <Rozet key={s} ton="kotu" testId="rp-sorun">
          {s}
        </Rozet>
      )),
      ortamDisi && (
        <Rozet ton="bilgi" testId="rp-ortam-disi">
          ortam dışı: {(a.rpOrtamDisi || []).join(', ')}
        </Rozet>
      ),
      a.rpEsles && <Rozet ton="uyari">{ESLES_KISA[a.rpEsles] || a.rpEsles}</Rozet>,
    ];
    return (
      <Hucre
        ipucu={[
          `Internet RP'de tanımlı · ${a.rpHost || '?'} sunucu (bulunan/beklenen, ${String(a.env || '').toUpperCase()} RP'leri)`,
          a.rpEsles ? `Eşleşme: ${ESLES_ADI[a.rpEsles] || a.rpEsles}` : 'Eşleşme: kesin',
          a.rpSorun?.length ? `Sorun: ${a.rpSorun.join(', ')}` : '',
          ortamDisi ? `Ortam dışı: ${ortamDisiMetni(a)} (uyarı)` : '',
          'Ayrıntı için satıra tıklayın.',
        ]
          .filter(Boolean)
          .join('\n')}
        rozetler={rozetler}
      >
        <Rozet ton="iyi">{e.t}</Rozet>
        {(a.rpYol || []).map((y) => (
          <span key={y} className="ml-1" style={{ color: SOLUK }} title={YOL_ADI[y]?.ipucu}>
            {YOL_ADI[y]?.t || y}
          </span>
        ))}
        {a.rpHost && (
          <span className="ml-1 tabular-nums" style={{ color: SOLUK }}>
            {a.rpHost}
          </span>
        )}
      </Hucre>
    );
  }
  // YALNIZ BASKA ORTAMIN RP'SINDE TANIMLI (kullanici karari, 2026-10-02): hucre KENDI
  // ortaminin kararini gosterir (tanimsiz / olculemedi / kapsam disi); oteki ortamdaki tanim
  // yalniz uyaridir ve "tanimsiz" suzgecinde gorunur.
  const ENV = String(a.env || '').toUpperCase();
  const ana =
    a.rp === 'tanimsiz'
      ? `Ortamın (${ENV}) tüm internet RP sunucuları tarandı, tablolar okundu; ${ENV} RP'lerinde bu uygulamaya bağlanan tanım yok.`
      : rpNedenMetni(a, k);
  const kisa = a.rp === 'tanimsiz' ? '' : RP_NEDEN_KISA[String(a.rpNeden || '').split(':')[0]] || '';
  // Ortam dışı uyarısı neden metninden ÖNCE (Hucre sırası): "ölçülemedi / sunucu taranmadı"
  // kısalınca "PROD RP'sinde tanımlı" kaybolmaz (2026-10-02 kararı: hücrede görünür).
  return (
    <Hucre
      ipucu={[
        ana,
        ortamDisi
          ? `Uyarı: yalnız ${ortamDisiMetni(a)} — ${ENV} için sayılmaz. Ayrıntı için satıra tıklayın.`
          : '',
      ]
        .filter(Boolean)
        .join('\n')}
      rozetler={[
        ortamDisi && (
          <Rozet ton="bilgi" testId="rp-ortam-disi">
            {ortamDisiMetni(a)}
          </Rozet>
        ),
      ]}
      kisa={kisa}
    >
      {a.rp === 'tanimsiz' ? (
        <Rozet ton="kotu">{e.t}</Rozet>
      ) : a.rp === 'olculemedi' ? (
        <Rozet ton="uyari" olcum>
          {e.t}
        </Rozet>
      ) : (
        <span style={{ color: e.renk }}>{e.t}</span>
      )}
    </Hucre>
  );
}

/**
 * Reverse proxy › İstek kolonu (access log). Ölçülemeyen hücreye 0 YAZILMAZ. 'kısmi'nin ipucu
 * genel bir metin DEĞİL, sunucunun yazdığı nedenlerdir (rpIstekNeden) — "pencere kısa" demek,
 * asıl neden "Ankara taranmadı" iken ipucunu kendisiyle çelişkiye düşürürdü (doğrulama bulgusu).
 */
function RpIstekHucre({ a, k }: { a: NgSpaApp; k?: NgSpaRpKapsam | null }) {
  const e = RPI_ETIKET[a.rpIstek] || RPI_ETIKET.olculemedi;
  // K3 (2026-10-02): karar ve sayı YALNIZ kendi ortamının RP tanımlarından. Başka ortamın RP
  // tanımında görülen istek (rpReq7Disi) yalnız BİLGİ: sayıya eklenmez, kararı değiştirmez;
  // hücrede ayrı rozet, ipucunda ayrı satır. Yazılmazsa TEST RP'de 0 alan uygulamanın "istek
  // yok"u, PROD RP'nin test adresine proxy'sinin isteğini gizlerdi.
  const ENV = String(a.env || '').toUpperCase();
  const disiOrt = (a.rpOrtamDisi || []).join('/') || 'başka ortam';
  const kendiRp = a.rpOrtamDisi?.length && ENV ? ` (${ENV} RP'leri)` : '';
  const ipucu = [
    a.rpIstek === 'uygulanamaz' ? rpIstekUygulanamazMetni(a) : e.ipucu,
    a.rpIstek === 'kismi' ? rpIstekNedenMetni(a, k) : '',
    a.rpReq24 != null ? `son 24 saat${kendiRp}: ${nf(a.rpReq24)}` : '',
    a.rpReq7 != null ? `son 7 gün${kendiRp}: ${nf(a.rpReq7)}` : '',
    a.rpSon ? `son istek: ${zaman(a.rpSon)}` : '',
    a.rpPencereSa != null ? `ölçülen pencere (en kısa): ${pencere(a.rpPencereSa)}` : '',
    a.rpOlcum ? `ölçülen/ölçülebilir tanım: ${a.rpOlcum}` : '',
    disiIstekMetni(a),
  ]
    .filter(Boolean)
    .join('\n');
  // Başka ortamın isteği: kendi kararının ALTINDA ayrı rozet (uygulanamaz satırda yalnız ipucu).
  const disiRozet =
    a.rpIstek !== 'uygulanamaz' && a.rpReq7Disi != null && a.rpReq7Disi > 0 ? (
      <Rozet ton="bilgi" testId="rp-istek-disi">
        ortam dışı {disiOrt}: {nf(a.rpReq7Disi)}
      </Rozet>
    ) : null;
  if (a.rpIstek === 'var')
    return (
      <Hucre ipucu={ipucu} rozetler={[disiRozet]}>
        <span style={{ color: e.renk }}>{nf(a.rpReq7 ?? 0)}</span>
        <span className="text-[10px]" style={{ color: MUTED }}>
          {' '}
          /7g
        </span>
      </Hucre>
    );
  if (a.rpIstek === 'kismi') {
    const neden = a.rpIstekNeden?.includes('host-taranmadi')
      ? 'sunucu taranmadı'
      : a.rpIstekNeden?.includes('eslesmeyen-host')
        ? 'atanamayan istek'
        : a.rpPencereSa != null
          ? `pencere ${pencere(a.rpPencereSa)}`
          : '';
    // Başka ortamın isteği (rozet) nedenden ÖNCE: "sunucu taranmadı" kısalınca kaybolmaz.
    return (
      <Hucre ipucu={ipucu} rozetler={[disiRozet]} kisa={neden}>
        0 <Rozet ton="uyari">{e.t}</Rozet>
      </Hucre>
    );
  }
  if (a.rpIstek === 'uygulanamaz')
    return (
      <Hucre ipucu={ipucu}>
        <span style={{ color: SOLUK }}>{e.t}</span>
      </Hucre>
    );
  return (
    <Hucre ipucu={ipucu} rozetler={[disiRozet]}>
      <Rozet
        ton={a.rpIstek === 'yok' || a.rpIstek === 'olculemedi' ? 'uyari' : 'notr'}
        olcum={a.rpIstek === 'olculemedi' || a.rpIstek === 'kaynak-yok'}
      >
        {e.t}
        {a.rpIstek === 'olculemedi' && a.rpOlcum && ` (${a.rpOlcum})`}
      </Rozet>
    </Hucre>
  );
}

/** Tanım başına trafik metni (ayrıntı paneli). */
function TrafikHucre({ t, yol }: { t: NgSpaRpTanim['trafik']; yol?: NgSpaRpTanim['yol'] }) {
  if (!t)
    return (
      <span
        style={{ color: MUTED }}
        title={
          yol === 'dizin'
            ? "O gün hiçbir sunucuda host kipi satırı üretilmedi (eski betik ya da SPA_HOST_MODE kapalı) — uygulama vhost'u sayılmadı. 0 DEĞİL."
            : ''
        }
      >
        ölçüm kaynağı yok
      </span>
    );
  if (t.durum === 'olculemedi')
    return (
      <span style={{ color: WARN }} title={t.hata || ''}>
        ölçülemedi: {TRAFIK_NEDEN[t.neden || ''] || t.neden}
        {t.neden === 'log' && t.hata ? ` — ${t.hata}` : ''}
      </span>
    );
  const kismi = (t.kismi || []).map((n) => RPI_NEDEN_METNI[n] || n);
  return (
    <span
      style={{ color: t.durum === 'var' ? 'var(--text-primary)' : WARN }}
      title={[
        `ilk kayıt (pencere başı): ${zaman(t.ilk)}${t.sampled ? ' · log örneklendi (512 MB kuyruk ya da Host alanı olmayan satır)' : ''}`,
        t.atanmamis
          ? `bu sunucuda hiçbir uygulamaya yazılamayan istek (7g): ${nf(t.atanmamis)}`
          : '',
        kismi.length ? `0 alt sınır: ${kismi.join('; ')}` : '',
      ]
        .filter(Boolean)
        .join('\n')}
    >
      {nf(t.req24 ?? 0)} / {nf(t.req7 ?? 0)}
      {t.durum === 'sifir-kismi' && ' · kısmi'}
    </span>
  );
}

/**
 * Satıra tıklayınca açılan panel: tanımlar + tanım başına trafik + beklenen sunucular.
 *
 * İKİ KAYNAK TEK EKRANDA ÇELİŞMEZ (doğrulama bulguları, 2026-10-01):
 *   surum      tablo her yüklendiğinde artar; bağımlılıkta olduğu için "Yenile" sonrası açık
 *              panel YENİDEN çekilir (eskiden satır yeni hesabı, panel eski hesabı gösteriyordu).
 *   tabloHesap tablonun geldiği sunucu hesabı; panelin hesabı farklıysa (bellek özeti 10 dk'da
 *              eskidi ya da başka bir kullanıcı yeniledi) bu AÇIKÇA yazılır ve Yenile önerilir.
 */
function RpAyrinti({
  a,
  k,
  surum,
  tabloHesap,
  onYenile,
}: {
  a: NgSpaApp;
  k?: NgSpaRpKapsam | null;
  surum: number;
  tabloHesap?: string;
  onYenile: () => void;
}) {
  // Yanit HANGI tablo surumu icin cekildi: eski surumun yaniti yenisi gelene kadar GOSTERILMEZ
  // ("Yükleniyor…"), yoksa Yenile sonrasi bir an eski tanimlar yeni satirin altinda kalirdi.
  const [yanit, setYanit] = useState<{ r: NgSpaRpDetay; surum: number } | null>(null);
  const [hata, setHata] = useState('');
  useAsyncEffect(
    async (alive) => {
      try {
        const r = await nginxConsoleApi.spaRp(a.namespace, a.application);
        if (!alive()) return;
        if (r && r.ok === false) setHata(r.message || 'Ayrıntı okunamadı.');
        else {
          setHata('');
          setYanit({ r, surum });
        }
      } catch (e: unknown) {
        if (alive()) setHata(e instanceof Error ? e.message : String(e));
      }
    },
    [a.namespace, a.application, surum],
  );
  const d = yanit && yanit.surum === surum ? yanit.r : null;
  const ag = AG_ETIKET[a.ag] || AG_ETIKET.bilinmiyor;
  const tanimlar = d?.tanimlar || [];
  const ENV = String(a.env || '').toUpperCase();
  // ORTAM DISI: uygulamanin ortami biliniyorsa baska ortamin RP'sindeki tanim isaretlenir.
  const disiMi = (t: NgSpaRpTanim) => !!ENV && t.env !== ENV;
  const yalnizDisi = tanimlar.length > 0 && tanimlar.every(disiMi);
  // K3: hem kendi hem başka ortamın tanımı var — başka ortamınki satırdaki karara ve sayıya
  // girmez; panelde listelenir ve işaretlenir.
  const karisik = !yalnizDisi && tanimlar.some(disiMi);
  const farkliHesap = !!(d?.hesaplandi && tabloHesap && d.hesaplandi !== tabloHesap);
  return (
    <div
      className="space-y-2 text-[11px] p-2 rounded-lg"
      style={{ background: 'var(--bg-surface)' }}
    >
      {farkliHesap && (
        <div style={{ color: WARN }} data-testid="rp-ayrinti-farkli-hesap">
          Bu ayrıntı tablodan farklı bir hesaptan geliyor (tablo {fmtDateTime(tabloHesap)}, ayrıntı{' '}
          {fmtDateTime(d?.hesaplandi)}) — satırdaki değerlerle çelişebilir; tabloyu yenileyin.{' '}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onYenile();
            }}
            className="ml-1 px-1.5 py-0.5 text-[11px] border rounded"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            Yenile
          </button>
        </div>
      )}
      <div style={{ color: 'var(--text-secondary)' }}>
        <b>Ağ</b>: {ag.t} — {ag.ipucu} Route'lar:{' '}
        {Object.entries(a.agSay || {})
          .map(([x, v]) => `${AG_SAY_ADI[x] || x} ${v}`)
          .join(' · ') || '—'}
        . Envanter: {AG_ENVANTER_METNI[a.agEnvanter] || a.agEnvanter}
        {a.agEnvanter === 'celisik' && a.agCelisikRoute ? ` (${nf(a.agCelisikRoute)} route)` : ''}.
        {/* ÇELİŞKİ PANELDE DE YAZAR (doğrulama bulgusu, 2026-10-03): hücrede rozet, ama ipucu
            fareyle okunur; klavye / dokunmatik kullanıcı bu bilgiye panelden ulaşır. */}
        {a.agCelisme && (
          <span style={{ color: DANGER }} data-testid="ayrinti-ag-celisme">
            {' '}
            Çelişki: intranet uygulama internet RP'de tanımlı (kural ile tanım çelişiyor).
          </span>
        )}
      </div>
      <div style={{ color: 'var(--text-secondary)' }}>
        <b>Reverse proxy</b>: {RP_ETIKET[a.rp]?.t || a.rp}
        {a.rpNeden ? ` — ${rpNedenMetni(a, k)}` : ''}
        {a.rp === 'tanimli' && a.rpEsles ? ` — ${ESLES_ADI[a.rpEsles] || a.rpEsles}` : ''}
        {a.rpSorun?.includes('ORTAM_DISI') ? ` — uyarı: ${ortamDisiMetni(a)}` : ''} ·{' '}
        <b>RP isteği</b>: {RPI_ETIKET[a.rpIstek]?.t || a.rpIstek}
        {a.rpIstek === 'kismi' && a.rpIstekNeden?.length
          ? ` (${a.rpIstekNeden.map((n) => RPI_NEDEN_METNI[n] || n).join('; ')})`
          : ''}
        {a.rpIstek === 'uygulanamaz' && a.rp !== 'uygulanamaz'
          ? ` — ${rpIstekUygulanamazMetni(a)}`
          : ''}
        {a.rpReq7Disi != null && (
          <span style={{ color: '#d97706' }} data-testid="rp-ayrinti-disi-istek">
            {' '}
            — {disiIstekMetni(a)}
          </span>
        )}{' '}
        · <b>Uygulama isteği (Dynatrace)</b>: {a.istek}
      </div>
      {hata ? (
        <div style={{ color: DANGER }}>Ayrıntı okunamadı: {hata}</div>
      ) : !d ? (
        <div style={{ color: MUTED }}>Yükleniyor…</div>
      ) : (
        <>
          {yalnizDisi && (
            <div style={{ color: WARN }} data-testid="rp-ayrinti-yalniz-disi">
              {ENV} RP'lerinde tanım yok — aşağıdaki tanımlar yalnız başka ortamın RP'sinde
              (ortam dışı) ve {ENV} kararına sayılmaz: Reverse proxy "{RP_ETIKET[a.rp]?.t || a.rp}",
              RP isteği sorulmaz; ortam dışı tanımların isteği yalnız bilgidir.
            </div>
          )}
          {karisik && (
            <div style={{ color: WARN }} data-testid="rp-ayrinti-karisik">
              "ortam dışı" işaretli tanımlar başka ortamın RP'sinde: {ENV} RP isteği kararına ve
              sayısına girmez (satırdaki RP isteği yalnız {ENV} RP tanımlarından), yalnız bilgi.
            </div>
          )}
          {tanimlar.length ? (
            <table className="w-full">
              <thead>
                <tr style={{ color: MUTED }}>
                  {[
                    'Sunucu',
                    'Vhost',
                    'Location / dizin',
                    'Yol',
                    'Durum',
                    'Hedef',
                    '24s / 7g',
                    'Son istek',
                    'Pencere',
                  ].map((h) => (
                    <th key={h} className="text-left pr-2 font-semibold whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tanimlar.map((t) => (
                  <tr
                    key={`${t.host}|${t.yol}|${t.vhost}|${t.location}`}
                    className="border-t align-top"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <td className="pr-2 font-mono whitespace-nowrap">
                      {t.host}{' '}
                      <span className="text-[10px]" style={{ color: MUTED }}>
                        {t.env} {t.rol}
                      </span>
                      {disiMi(t) && (
                        <span className="ml-1 text-[10px]" style={{ color: WARN }}>
                          ortam dışı
                        </span>
                      )}
                    </td>
                    <td className="pr-2 font-mono">
                      {t.vhost || '—'}
                      {t.trafik?.ad && (
                        <div className="text-[10px]" style={{ color: MUTED }} title="server_name">
                          {t.trafik.ad}
                        </div>
                      )}
                    </td>
                    <td className="pr-2 font-mono break-all">{t.location}</td>
                    <td className="pr-2" title={YOL_ADI[t.yol]?.ipucu}>
                      {YOL_ADI[t.yol]?.t || t.yol}
                    </td>
                    <td className="pr-2 whitespace-nowrap">
                      <span style={{ color: t.status === 'OK' ? 'var(--text-secondary)' : DANGER }}>
                        {t.status}
                      </span>
                      {t.esles !== 'kesin' && (
                        <span className="ml-1 text-[10px]" style={{ color: WARN }}>
                          ({ESLES_ADI[t.esles] || t.esles})
                        </span>
                      )}
                    </td>
                    <td className="pr-2 font-mono break-all" title={t.hedefKaynak}>
                      {t.hedef || t.conf || '—'}
                    </td>
                    <td className="pr-2 whitespace-nowrap tabular-nums">
                      <TrafikHucre t={t.trafik} yol={t.yol} />
                    </td>
                    <td className="pr-2 whitespace-nowrap">
                      {t.trafik?.son ? zaman(t.trafik.son) : '—'}
                    </td>
                    <td className="pr-2 whitespace-nowrap">
                      {t.trafik && t.trafik.durum !== 'olculemedi'
                        ? pencere(t.trafik.pencereSa)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ color: MUTED }}>
              Bu uygulamaya bağlanan internet RP tanımı yok
              {a.rp === 'tanimsiz' ? ' (ortamın tüm RP sunucuları tarandı).' : '.'}
            </div>
          )}
          {!!d.beklenen?.length && (
            <div style={{ color: MUTED }}>
              {String(a.env || '').toUpperCase()} internet RP sunucuları:{' '}
              {d.beklenen.map((h, i) => (
                <span key={h.host}>
                  {i > 0 && ' · '}
                  <span
                    className="font-mono"
                    style={{ color: h.taranan ? 'var(--text-secondary)' : WARN }}
                  >
                    {h.host}
                  </span>{' '}
                  {h.taranan ? 'tarandı' : 'TARANMADI'}, trafik {h.trafik}
                  {kovaToplam(h.kova) > 0 && (
                    <span title={kovaMetni(h.kova)} style={{ color: WARN }}>
                      {' '}
                      (atanamayan {nf(kovaToplam(h.kova))})
                    </span>
                  )}
                </span>
              ))}
            </div>
          )}
          {d.kapsam && (
            <div style={{ color: MUTED }}>
              Kaynak tarihleri: config {kaynakMetni(d.kapsam.tablolar?.cfg, d.kapsam.configTarih)} ·
              dizin {kaynakMetni(d.kapsam.tablolar?.dir, d.kapsam.dizinTarih)} · trafik{' '}
              {kaynakMetni(d.kapsam.tablolar?.trf, d.kapsam.trafikTarih)} · upstream{' '}
              {kaynakMetni(d.kapsam.tablolar?.ups, d.kapsam.upsTarih)}
              {d.hesaplandi ? ` · hesaplandı ${fmtDateTime(d.hesaplandi)}` : ''}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Route envanteri kolonu: uygulamanın route'u Openshift route envanterinde kayıtlı mı. */
function EnvanterHucre({ a }: { a: NgSpaApp }) {
  const title =
    "Bu uygulamanın route'u Openshift route envanterinde (dbo.BMW_Openshift_Route_Inventory) kayıtlı mı";
  if (a.inventory === 'olculemedi')
    return (
      <Hucre ipucu="Route envanteri okunamadı — “kayıtlı değil” DEMEK DEĞİL.">
        <Rozet ton="uyari" olcum>
          ölçülemedi
        </Rozet>
      </Hucre>
    );
  if (a.inventory === 'kayitli')
    return (
      <Hucre ipucu={title}>
        <span style={{ color: 'var(--text-secondary)' }}>kayıtlı</span>
      </Hucre>
    );
  if (a.inventory === 'kismen')
    return (
      <Hucre ipucu={title}>
        <Rozet ton="uyari">
          kısmen ({a.invRoutes}/{a.routeCount})
        </Rozet>
      </Hucre>
    );
  return (
    <Hucre ipucu={title}>
      {a.spa === 'evet' ? (
        <Rozet ton="uyari">kayıtlı değil</Rozet>
      ) : (
        <span style={{ color: SOLUK }}>kayıtlı değil</span>
      )}
    </Hucre>
  );
}

/**
 * Uygulama adını İKİYE böler: baş kısım kısalır, AYIRT EDEN SON kısım ("-app-v" /
 * "-app-emb-v"; kalıp dışı adda son "-parça") her zaman görünür. Sondan kesmek aynı
 * namespace'teki "<ad>-app-v" ile "<ad>-app-emb-v" kardeşlerini aynı gösteriyordu (doğrulama
 * bulgusu, 2026-10-03). Kısa adda iki parça yan yana: görünüm ve metin aynı.
 */
function adParcala(ad: string): [string, string] {
  const m = /-app(?:-emb)?-v$/.exec(ad);
  if (m && m.index > 0) return [ad.slice(0, m.index), m[0]];
  const i = ad.lastIndexOf('-');
  return i > 0 && ad.length - i <= 12 ? [ad.slice(0, i), ad.slice(i)] : [ad, ''];
}

/**
 * Uygulama + namespace TEK hücre (yapışkan ilk kolon). Ad bir düğme: satır klavyeyle de açılır
 * (tıklama satırın onClick'ine kabarır; düğmenin kendi işleyicisi YOK, çift tetiklenmez).
 */
function UygulamaHucre({ a, acik }: { a: NgSpaApp; acik: boolean }) {
  const [bas, son] = adParcala(a.application);
  return (
    <span className="flex items-start gap-1">
      {acik ? (
        <ChevronDownIcon className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
      ) : (
        <ChevronRightIcon className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
      )}
      <span className="block min-w-0">
        {/* Erişilebilir ad = iki parçanın birleşimi = tam ad (aralarında boşluk yok). */}
        <button
          type="button"
          aria-expanded={acik}
          title={a.application}
          className="flex max-w-[14rem] text-left font-semibold"
          style={{ color: 'var(--text-primary)' }}
        >
          <span className="truncate min-w-0" title={a.application}>
            {bas}
          </span>
          {son && <span className="shrink-0 ng-ad-son">{son}</span>}
        </button>
        {/* Namespace satırı ANLAM taşır: SOLUK (--text-secondary), MUTED değil (kontrast). */}
        <span
          className="flex items-center gap-1 max-w-[14rem] text-[11px] leading-4"
          style={{ color: SOLUK }}
        >
          <span className="truncate" title={a.namespace}>
            {a.namespace}
          </span>
          {a.env && (
            <>
              {' '}
              <span className="shrink-0 text-[10px] uppercase" data-testid="ortam">
                {a.env}
              </span>
            </>
          )}
        </span>
      </span>
    </span>
  );
}

/**
 * İlk öğe + "+N" çipi. Tamamı hücrenin ipucunda ve ayrıntı panelinde (UygulamaAyrinti).
 * `ilk` verilirse ilk öğeyi o çizer (adres: iki parça); verilmezse `genislik`te sondan kısalır.
 */
function CokluDeger({
  liste,
  genislik,
  ilk,
  sinif,
}: {
  liste: string[];
  genislik: string;
  ilk?: (s: string) => ReactNode;
  sinif?: string;
}) {
  if (!liste.length) return <span style={{ color: SOLUK }}>—</span>;
  return (
    <span className={`flex items-center gap-1${sinif ? ` ${sinif}` : ''}`}>
      {ilk ? (
        ilk(liste[0])
      ) : (
        <span className="truncate" style={{ maxWidth: genislik }}>
          {liste[0]}
        </span>
      )}
      {liste.length > 1 && <span className="ng-cip">+{liste.length - 1}</span>}
    </span>
  );
}

/**
 * Adres İKİ PARÇA (doğrulama bulgusu, 2026-10-03): varsayılan route adresi
 * "<uygulama>-<namespace>.apps(-t).fw.garanti.com.tr" sondan kesilince görünen kısım yalnız
 * 1. kolonun tekrarıydı (54 adresin 52'si); ayırt eden alan adı (apps / apps-t / kurumsal alan
 * adı) hep kesilen sondaydı. İlk etiket uygulama adıyla başlıyorsa (tekrar) ÖNCE o kısalır ve
 * soluk yazılır; alan adı soneki (`.ng-adres-son`) en son kısalır. Kurumsal adreste
 * ("kartlimit.garantibbva.com.tr") baş kısım anlamlıdır: bölünmez, sondan kısalır.
 */
function AdresMetni({ h, a }: { h: string; a: NgSpaApp }) {
  const i = h.indexOf('.');
  const tekrar = i > 0 && h.toLowerCase().startsWith(a.application.toLowerCase());
  if (!tekrar) return <span className="ng-adres-tek">{h}</span>;
  return (
    <span className="ng-adres">
      <span className="ng-adres-on" style={{ color: SOLUK }}>
        {h.slice(0, i)}
      </span>
      <span className="ng-adres-son">{h.slice(i)}</span>
    </span>
  );
}

/**
 * Adresler: adres yoksa route adları (sunucu adreste geçen route adını göndermez). ESNEYEN
 * KOLON: tablodaki artan genişlik buraya verilir (<col> genişliksiz; index.css `.ng-adresler`
 * içeriğin genişliğe katkısını 11rem'de tutar) — geniş ekranda adres daha az kısalır, dar
 * ekranda tabloyu genişletmez.
 */
function AdresHucre({ a }: { a: NgSpaApp }) {
  const liste = a.hosts.length ? a.hosts : a.routes;
  return (
    <Hucre ipucu={`${a.hosts.length ? 'Adresler' : "Route'lar"} (${liste.length}):\n${liste.join('\n')}`}>
      <CokluDeger
        liste={liste}
        genislik="11rem"
        sinif="ng-adresler"
        ilk={(h) => <AdresMetni h={h} a={a} />}
      />
    </Hucre>
  );
}

/**
 * Cluster'lar. ESKI VERI SUNUCUDAN: son kosusu basarisiz cluster'in satiri onceki bir kosudan
 * (staleClusters, kapsamdan turetilir) — ipucunda cluster basina, 2. satirda rozetle.
 */
function ClusterHucre({ a }: { a: NgSpaApp }) {
  const eski = a.clusters.filter((c) => a.staleClusters.includes(c)).length;
  // KAPSAM ORANI (kullanici, 2026-10-06): "4 prod cluster'in 4'unde de varsa 4/4 Tam,
  // 3'unde varsa 3/4 Kismi". Payda ortamin katalogdaki TARANABILEN cluster'lari;
  // ERISILEMEYEN cluster paydaya GIRMEZ (uretimde 12 cluster login'de dusuyor) - onun
  // yuzunden "Kismi" demek uydurma bir eksiklik raporu olurdu. Ayrica yazilir.
  const kapsam =
    a.kapsamDurum === 'tam'
      ? { metin: `${a.kapsamVar}/${a.kapsamToplam} Tam`, ton: 'iyi' as const }
      : a.kapsamDurum === 'kismi'
        ? { metin: `${a.kapsamVar}/${a.kapsamToplam} Kısmi`, ton: 'uyari' as const }
        : a.kapsamDurum === 'yok'
          ? { metin: `0/${a.kapsamToplam}`, ton: 'kotu' as const }
          : null;
  const ipucu = [
    `Cluster'lar (${a.clusters.length}):`,
    ...a.clusters.map((c) => (a.staleClusters.includes(c) ? `${c} · önceki koşudan` : c)),
    eski ? '"Önceki koşudan": cluster son koşusunda taranamadı; veri önceki bir koşudan.' : '',
    kapsam
      ? `Kapsam: ortamın ${a.kapsamToplam} taranabilen cluster'ından ${a.kapsamVar}'inde var.`
      : 'Kapsam oranı ÖLÇÜLEMEDİ: ortam tek bir cluster ortamına çözülemedi ya da katalog okunamadı.',
    a.kapsamBakilamayan
      ? `${a.kapsamBakilamayan} cluster'a hiç bakılamadı (login/DNS/yetki) — paydaya GİRMEZ, ` +
        'orada var mı yok mu bilinmiyor.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <Hucre
      ipucu={ipucu}
      rozetler={[
        kapsam && <Rozet ton={kapsam.ton}>{kapsam.metin}</Rozet>,
        a.kapsamBakilamayan > 0 && (
          <Rozet ton="bilgi">{a.kapsamBakilamayan} cluster ölçülemedi</Rozet>
        ),
        eski > 0 && (
          <Rozet ton="uyari">
            {eski === a.clusters.length
              ? 'önceki koşudan'
              : `${eski}/${a.clusters.length} önceki koşudan`}
          </Rozet>
        ),
      ]}
    >
      <CokluDeger liste={a.clusters} genislik="9rem" />
    </Hucre>
  );
}

/** Ayrıntı panelinin başı: satırda kısaltılan adreslerin ve cluster'ların TAMAMI. */
function UygulamaAyrinti({ a }: { a: NgSpaApp }) {
  const liste = a.hosts.length ? a.hosts : a.routes;
  return (
    <div
      className="grid gap-x-3 gap-y-0.5 text-[11px] p-2 mb-1.5 rounded-lg"
      style={{
        background: 'var(--bg-surface)',
        color: 'var(--text-secondary)',
        gridTemplateColumns: 'max-content minmax(0, 1fr)',
      }}
      data-testid="ayrinti-uygulama"
    >
      <b>
        {a.hosts.length ? 'Adresler' : "Route'lar"} ({nf(liste.length)})
      </b>
      <span className="font-mono break-all">{liste.join(' · ') || '—'}</span>
      <b>Cluster'lar ({nf(a.clusters.length)})</b>
      <span className="font-mono">
        {a.clusters.map((c, i) => (
          <Fragment key={c}>
            {i > 0 && ' · '}
            {c}
            {a.staleClusters.includes(c) && (
              <>
                {' '}
                <Rozet ton="uyari">önceki koşudan</Rozet>
              </>
            )}
          </Fragment>
        ))}
      </span>
      <b>SPA kanıtı</b>
      <span>
        {a.signals.join(', ') || '—'}
        {a.weakEvidence ? ' (zayıf kanıt: route servis yerine ad eşleşmesiyle bağlandı)' : ''}
      </span>
      {a.notes.length > 0 && (
        <>
          <b>Not</b>
          <span>{a.notes.join(' | ')}</span>
        </>
      )}
    </div>
  );
}

// ── KOLON DÜZENİ (2026-10-03) ─────────────────────────────────────────────────────────
// Başlık VE satır AYNI listeden (görünür kolonlar) çizilir: sıra, colSpan ve hücre sayısı
// tek kaynaktan; gizlenen kolon ikisinden birlikte düşer. Eski düzen (11 kolon) ve CSV
// kolonları: CSV DEĞİŞMEDİ (aşağıda csv()).
type KolonId =
  | 'uygulama'
  | 'spa'
  | 'istek'
  | 'ag'
  | 'rp'
  | 'rpIstek'
  | 'envanter'
  | 'adresler'
  | 'clusterlar';
interface KolonTanim {
  id: KolonId;
  baslik: string;
  /** Başlığın altındaki küçük satır (birleşik hücrenin ikinci bilgisi). */
  alt?: string;
  ipucu?: string;
  /** Üst başlık grubu (iki satırlı thead, colSpan). */
  grup?: 'rp';
  /** Sayısal: sağa yaslı, tabular rakam. */
  sag?: boolean;
  /** "Kolonlar" menüsünden gizlenebilir (varsayılan GÖRÜNÜR). */
  gizlenebilir?: boolean;
}
const RP_GRUP_BASLIGI = 'Reverse proxy';
const KOLONLAR: readonly KolonTanim[] = [
  {
    id: 'uygulama',
    baslik: 'Uygulama',
    alt: 'namespace · ortam',
    ipucu: "Satıra tıklayınca adreslerin, cluster'ların ve RP tanımlarının tamamı açılır.",
  },
  {
    id: 'spa',
    baslik: 'SPA',
    alt: 'ad kalıbı',
    ipucu:
      "Kabinde nginx çalışıyor mu · altında: uygulama adı -app-v / -app-emb-v kuralına uyuyor mu (eski yöntem SPA'yı yalnız adından tanıyordu)",
  },
  {
    id: 'istek',
    baslik: 'Uygulama isteği',
    alt: 'Dynatrace',
    sag: true,
    ipucu: 'Dynatrace: uygulamanın pod/servis çağrıları (RP access log değil)',
  },
  {
    id: 'ag',
    baslik: 'Ağ',
    grup: 'rp',
    ipucu:
      'Route TLS tipi: passthrough = internet, reencrypt = intranet. Reverse proxy yalnız internet ve karışık uygulamalarda aranır.',
  },
  {
    id: 'rp',
    baslik: 'Tanım',
    grup: 'rp',
    ipucu:
      'Internet SPA kendi ortamının RP sunucularında tanımlı mı (yalnız başka ortamın RP\'sinde tanımlıysa "tanımsız" + ortam dışı uyarısı)',
  },
  {
    id: 'rpIstek',
    baslik: 'İstek',
    grup: 'rp',
    sag: true,
    ipucu:
      'RP access log\'una göre kendi ortamının RP tanımı istek alıyor mu (son 7 gün; yeni PROD: uygulama vhost\'unun Host/SNI sayımı; başka ortamın RP\'sindeki istek yalnız "ortam dışı" bilgisi, karara ve sayıya girmez)',
  },
  {
    id: 'envanter',
    baslik: 'Route envanteri',
    gizlenebilir: true,
    ipucu: "Route'u Openshift route envanterinde kayıtlı mı",
  },
  {
    id: 'adresler',
    baslik: 'Adresler',
    gizlenebilir: true,
    ipucu:
      'İlk adres ve "+N" (alan adı soneki hep görünür, uygulama-namespace öneki önce kısalır); tamamı ipucunda ve ayrıntı panelinde',
  },
  {
    id: 'clusterlar',
    baslik: "Cluster'lar",
    gizlenebilir: true,
    ipucu: 'İlk cluster ve "+N"; tamamı ipucunda ve ayrıntı panelinde',
  },
];
const KOLON = Object.fromEntries(KOLONLAR.map((k) => [k.id, k])) as Record<KolonId, KolonTanim>;
const GIZLENEBILIR: KolonId[] = KOLONLAR.filter((k) => k.gizlenebilir).map((k) => k.id);
/** İlk kolon yapışkan (yatay kaydırmada), sayısal kolonlar sağa yaslı. */
const kolonSinifi = (id: KolonId) =>
  [id === 'uygulama' ? 'ng-yapiskan' : '', KOLON[id].sag ? 'ng-sag' : '']
    .filter(Boolean)
    .join(' ') || undefined;
/**
 * <colgroup> PARÇALARI: ardışık aynı gruptaki kolonlar bir <colgroup>. "Reverse proxy"
 * başlığı scope="colgroup": HTML tablo modelinde bu başlık AYNI sütun grubundaki hücrelere
 * bağlanır. Tek <colgroup> bütün kolonları kapsadığında başlık Route envanteri / Adresler /
 * Cluster'lar hücrelerine de bağlanıyordu (doğrulama bulgusu, 2026-10-03); RP kolonları
 * artık KENDİ grubunda.
 */
function kolonParcalari(gorunur: readonly KolonId[]) {
  const l: { grup?: 'rp'; idler: KolonId[] }[] = [];
  for (const id of gorunur) {
    const g = KOLON[id].grup;
    const son = l[l.length - 1];
    if (son && son.grup === g) son.idler.push(id);
    else l.push({ grup: g, idler: [id] });
  }
  return l;
}
/** Artan genişliği alan TEK kolon: Adresler (gizliyse son kolon). Ötekiler içerik kadar. */
const esneyenKolon = (gorunur: readonly KolonId[]): KolonId | undefined =>
  gorunur.includes('adresler') ? 'adresler' : gorunur[gorunur.length - 1];

function hucreIcerigi(
  id: KolonId,
  a: NgSpaApp,
  acik: boolean,
  k?: NgSpaRpKapsam | null,
): ReactNode {
  switch (id) {
    case 'uygulama':
      return <UygulamaHucre a={a} acik={acik} />;
    case 'spa':
      return <SpaHucre a={a} />;
    case 'istek':
      return <IstekHucre a={a} />;
    case 'ag':
      return <AgHucre a={a} />;
    case 'rp':
      return <RpHucre a={a} k={k} />;
    case 'rpIstek':
      return <RpIstekHucre a={a} k={k} />;
    case 'envanter':
      return <EnvanterHucre a={a} />;
    case 'adresler':
      return <AdresHucre a={a} />;
    case 'clusterlar':
      return <ClusterHucre a={a} />;
  }
}

// ── GÖRÜNÜM TERCİHİ: yoğunluk + gizli kolonlar ─────────────────────────────────────────
// Yalnız BU tarayıcının görünüm tercihi (paylaşılan durum değil). Okunamazsa ya da bozuksa
// VARSAYILAN: Sıkı, tüm kolonlar görünür. Erişim try/catch içinde: gizli pencere ya da
// engelli site verisinde localStorage hata atabilir; ekran yine çizilir.
type Yogunluk = 'siki' | 'rahat';
interface Gorunum {
  yogunluk: Yogunluk;
  gizli: KolonId[];
}
const GORUNUM_ANAHTARI = 'nginx-hub:spa-kesfi:gorunum';
const VARSAYILAN_GORUNUM: Gorunum = { yogunluk: 'siki', gizli: [] };
function gorunumOku(): Gorunum {
  try {
    const ham = window.localStorage.getItem(GORUNUM_ANAHTARI);
    if (!ham) return VARSAYILAN_GORUNUM;
    const o = JSON.parse(ham) as { yogunluk?: unknown; gizli?: unknown } | null;
    const gizli: unknown[] = Array.isArray(o?.gizli) ? o.gizli : [];
    return {
      yogunluk: o?.yogunluk === 'rahat' ? 'rahat' : 'siki',
      // Yalnız GİZLENEBİLİR kolonlar: bozuk/eski kayıt zorunlu kolonu gizleyemez.
      gizli: GIZLENEBILIR.filter((id) => gizli.includes(id)),
    };
  } catch {
    return VARSAYILAN_GORUNUM;
  }
}
function gorunumYaz(g: Gorunum) {
  try {
    window.localStorage.setItem(GORUNUM_ANAHTARI, JSON.stringify(g));
  } catch {
    // Yazılamazsa tercih yalnız bu sayfa açıkken geçerli kalır.
  }
}

type SpaSecim = 'tumu' | NgSpaApp['spa'];
type KalipSecim = 'tumu' | NgSpaApp['pattern'];
type IstekSecim = 'tumu' | NgSpaApp['istek'];
type AgSecim = 'tumu' | NgSpaApp['ag'];
type RpSecim = 'tumu' | NgSpaApp['rp'];
type RpIstekSecim = 'tumu' | NgSpaApp['rpIstek'];

const sayac = <K extends string>(apps: NgSpaApp[], f: (a: NgSpaApp) => K) =>
  apps.reduce<Record<string, number>>((m, a) => {
    const k = f(a);
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {});

const anahtar = (a: NgSpaApp) => `${a.namespace}|${a.application}`;

interface SpaSatirProps {
  a: NgSpaApp;
  acik: boolean;
  k?: NgSpaRpKapsam | null;
  /** SABIT referans (useCallback): degisirse memo her satiri yeniden cizer. */
  onSec: (key: string) => void;
  surum: number;
  tabloHesap?: string;
  onYenile: () => void;
  /** Zebra: tablodaki sıranın tek/çift oluşu (yalnız süzgeç değişince değişir). */
  cizgili: boolean;
  /** Görünür kolonlar — SABIT referans (useMemo); yalnız kolon menüsünde değişir. */
  gorunur: readonly KolonId[];
}

/**
 * TEK UYGULAMA SATIRI — React.memo (doğrulama bulgusu, 2026-10-01): seçili satır state'i üst
 * bileşende; satırlar memo'suzken her tıklama 10 bin satırın tüm hücrelerini (ipucu dizgeleri
 * dahil) yeniden hesaplıyordu (jsdom: tık başına 300-400 ms). Props'lar tıklamada yalnız
 * açılan/kapanan iki satır için değişir (acik); onSec/onYenile/gorunur sabit, a ve k veri
 * yüklenene kadar aynı nesne. Yoğunluk tablo özniteliğinde (CSS): satırlar yeniden çizilmez.
 */
const SpaSatir = memo(function SpaSatir({
  a,
  acik,
  k,
  onSec,
  surum,
  tabloHesap,
  onYenile,
  cizgili,
  gorunur,
}: SpaSatirProps) {
  return (
    <Fragment>
      <tr
        className={`ng-satir cursor-pointer${cizgili ? ' ng-cizgili' : ''}${acik ? ' ng-secili' : ''}`}
        onClick={() => onSec(anahtar(a))}
      >
        {gorunur.map((id) => (
          <td key={id} data-kolon={id} className={kolonSinifi(id)}>
            {hucreIcerigi(id, a, acik, k)}
          </td>
        ))}
      </tr>
      {acik && (
        <tr className="ng-ayrinti">
          <td colSpan={gorunur.length}>
            <div className="ng-ayrinti-ic">
              <UygulamaAyrinti a={a} />
              <RpAyrinti a={a} k={k} surum={surum} tabloHesap={tabloHesap} onYenile={onYenile} />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
});

/**
 * İKİ SATIRLI BAŞLIK: gruplu kolonlar (Reverse proxy › Ağ / Tanım / İstek) üst satırda tek
 * başlık (colSpan), alt satırda kendi başlıkları; ötekiler iki satırı kaplar (rowSpan).
 */
function TabloBasligi({ gorunur }: { gorunur: readonly KolonId[] }) {
  const grupta = gorunur.filter((id) => KOLON[id].grup === 'rp');
  const th = (kol: KolonTanim, ikiSatir: boolean) => (
    <th
      key={kol.id}
      scope="col"
      rowSpan={ikiSatir ? 2 : undefined}
      data-kolon={kol.id}
      title={kol.ipucu}
      className={kolonSinifi(kol.id)}
    >
      {kol.baslik}
      {kol.alt && <span className="ng-baslik-alt">{kol.alt}</span>}
    </th>
  );
  return (
    <thead>
      <tr>
        {gorunur.map((id) => {
          const kol = KOLON[id];
          if (!kol.grup) return th(kol, true);
          return id === grupta[0] ? (
            <th
              key="grup-rp"
              scope="colgroup"
              colSpan={grupta.length}
              className="ng-grup"
              title="Internet SPA kendi ortamının reverse proxy sunucularında tanımlı mı ve tanım istek alıyor mu. Satıra tıklayınca tanımlar açılır."
            >
              {RP_GRUP_BASLIGI}
            </th>
          ) : null;
        })}
      </tr>
      <tr>{grupta.map((id) => th(KOLON[id], false))}</tr>
    </thead>
  );
}

/** Satır yoğunluğu: Sıkı (varsayılan) / Rahat. */
function YogunlukSecimi({ deger, onDegis }: { deger: Yogunluk; onDegis: (y: Yogunluk) => void }) {
  return (
    <div
      role="group"
      aria-label="Satır yoğunluğu"
      className="flex rounded-lg border overflow-hidden text-xs"
      style={{ borderColor: 'var(--border)' }}
    >
      {(['siki', 'rahat'] as const).map((y) => (
        <button
          key={y}
          type="button"
          aria-pressed={deger === y}
          onClick={() => onDegis(y)}
          className="px-2.5 py-1.5"
          title={y === 'siki' ? 'Sıkı: ekrana daha çok satır sığar' : 'Rahat: hücreler daha geniş'}
          style={
            deger === y
              ? { background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontWeight: 600 }
              : { color: SOLUK }
          }
        >
          {y === 'siki' ? 'Sıkı' : 'Rahat'}
        </button>
      ))}
    </div>
  );
}

/**
 * "Kolonlar" menüsü: Route envanteri / Adresler / Cluster'lar gizlenebilir. Klavye: düğme
 * Enter/Space ile açılır, Tab onay kutularına geçer, Esc kapatıp odağı düğmeye döndürür;
 * dışarı tıklamak kapatır.
 */
function KolonMenusu({
  gizli,
  onDegis,
}: {
  gizli: readonly KolonId[];
  onDegis: (gizli: KolonId[]) => void;
}) {
  const [acik, setAcik] = useState(false);
  const kapRef = useRef<HTMLDivElement>(null);
  const dugmeRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!acik) return;
    const disari = (e: MouseEvent) => {
      if (kapRef.current && !kapRef.current.contains(e.target as Node)) setAcik(false);
    };
    const tus = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setAcik(false);
      dugmeRef.current?.focus();
    };
    document.addEventListener('mousedown', disari);
    document.addEventListener('keydown', tus);
    return () => {
      document.removeEventListener('mousedown', disari);
      document.removeEventListener('keydown', tus);
    };
  }, [acik]);
  return (
    <div ref={kapRef} className="relative">
      <button
        ref={dugmeRef}
        type="button"
        aria-expanded={acik}
        aria-controls={panelId}
        onClick={() => setAcik((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg"
        style={{ borderColor: 'var(--border)' }}
        title="Route envanteri, Adresler ve Cluster'lar kolonlarını gizle / göster"
      >
        <ViewColumnsIcon className="w-3.5 h-3.5" aria-hidden="true" /> Kolonlar
        {gizli.length ? ` (${gizli.length} gizli)` : ''}
      </button>
      {acik && (
        <div
          id={panelId}
          role="group"
          aria-label="Gösterilecek kolonlar"
          className="absolute right-0 z-20 mt-1 w-56 rounded-lg border p-2 space-y-1 text-xs shadow-md"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
        >
          {GIZLENEBILIR.map((id) => (
            <label key={id} className="flex items-center gap-2 px-1 py-0.5 cursor-pointer">
              <input
                type="checkbox"
                checked={!gizli.includes(id)}
                onChange={(e) =>
                  onDegis(
                    GIZLENEBILIR.filter((x) => (x === id ? !e.target.checked : gizli.includes(x))),
                  )
                }
              />
              {KOLON[id].baslik}
            </label>
          ))}
          <div className="pt-1 text-[10px]" style={{ color: SOLUK }}>
            Uygulama, SPA, uygulama isteği ve reverse proxy kolonları her zaman görünür.
          </div>
        </div>
      )}
    </div>
  );
}

export default function NginxSpaDiscovery() {
  const [data, setData] = useState<NgSpaDiscovery | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [q, setQ] = useState('');
  const [ns, setNs] = useState('tumu');
  const [spa, setSpa] = useState<SpaSecim>('tumu');
  const [kalip, setKalip] = useState<KalipSecim>('tumu');
  const [istek, setIstek] = useState<IstekSecim>('tumu');
  const [ag, setAg] = useState<AgSecim>('tumu');
  const [rp, setRp] = useState<RpSecim>('tumu');
  const [rpIstek, setRpIstek] = useState<RpIstekSecim>('tumu');
  const [cluster, setCluster] = useState('tumu');
  // AYRINTI: tıklanan satırın altında RP tanımları paneli (tek satır açık). onSec SABİT
  // (useCallback, anahtarı parametre alır): memo'lu satırlar tıklamada yeniden çizilmez.
  const [secili, setSecili] = useState<string | null>(null);
  const onSec = useCallback((key: string) => setSecili((s) => (s === key ? null : key)), []);
  // TABLO SURUMU: her basarili yuklemede artar; acik ayrinti paneli buna bagli olarak
  // YENIDEN cekilir ("Yenile" sonrasi satir yeni, panel eski hesabi gostermesin).
  const [surum, setSurum] = useState(0);
  // GORUNUM (2026-10-03): yogunluk + gizli kolonlar; ilk deger tarayicidan (yoksa varsayilan),
  // degisiklik olay isleyicisinde yazilir (effect yok).
  const [gorunum, setGorunum] = useState<Gorunum>(gorunumOku);
  const gorunumDegis = (g: Gorunum) => {
    setGorunum(g);
    gorunumYaz(g);
  };
  // SABIT referans: memo'lu satirlar yalniz kolon menusu degisince yeniden cizilir.
  const gorunur = useMemo(
    () => KOLONLAR.map((kol) => kol.id).filter((id) => !gorunum.gizli.includes(id)),
    [gorunum.gizli],
  );

  // HATA GORUNUR: uc nokta 500 ya da ag hatasi verdiginde ekran "bu suzgeclerle satir yok"
  // DEMEZ (dusmanca dogrulama bulgusu - hata "yok" gibi sunuluyordu).
  const [hata, setHata] = useState('');
  // fresh: "Yenile" sunucudaki 60 sn yanit onbellegini atlar.
  const yukle = useCallback(async (fresh = false) => {
    setYukleniyor(true);
    setHata('');
    try {
      const d = await nginxConsoleApi.spaDiscovery(fresh);
      if (d && d.ok === false) {
        setHata(d.message || 'SPA keşfi okunamadı.');
        setData(null);
      } else {
        setData(d);
        setSurum((n) => n + 1);
      }
    } catch (e: unknown) {
      setHata(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setYukleniyor(false);
    }
  }, []);
  const yenile = useCallback(() => void yukle(true), [yukle]);
  useAsyncEffect(async () => {
    await yukle();
  }, [yukle]);

  const apps = useMemo(() => data?.apps || [], [data]);
  const say = useMemo(
    () => ({
      spa: sayac(apps, (a) => a.spa),
      kalip: sayac(apps, (a) => a.pattern),
      istek: sayac(apps, (a) => a.istek),
      ag: sayac(apps, (a) => a.ag),
      rp: sayac(apps, (a) => a.rp),
      rpIstek: sayac(apps, (a) => a.rpIstek),
    }),
    [apps],
  );

  const satirlar = useMemo(() => {
    const ara = q.trim().toLowerCase();
    return apps.filter((a) => {
      if (ns !== 'tumu' && a.namespace !== ns) return false;
      if (spa !== 'tumu' && a.spa !== spa) return false;
      if (kalip !== 'tumu' && a.pattern !== kalip) return false;
      if (istek !== 'tumu' && a.istek !== istek) return false;
      if (ag !== 'tumu' && a.ag !== ag) return false;
      if (rp !== 'tumu' && a.rp !== rp) return false;
      if (rpIstek !== 'tumu' && a.rpIstek !== rpIstek) return false;
      if (cluster !== 'tumu' && !a.clusters.includes(cluster)) return false;
      if (!ara) return true;
      return (
        a.application.toLowerCase().includes(ara) ||
        a.namespace.toLowerCase().includes(ara) ||
        a.hosts.some((h) => h.toLowerCase().includes(ara)) ||
        a.routes.some((r) => r.toLowerCase().includes(ara))
      );
    });
  }, [apps, q, ns, spa, kalip, istek, ag, rp, rpIstek, cluster]);

  const suzgecVar =
    !!q ||
    ns !== 'tumu' ||
    spa !== 'tumu' ||
    kalip !== 'tumu' ||
    istek !== 'tumu' ||
    ag !== 'tumu' ||
    rp !== 'tumu' ||
    rpIstek !== 'tumu' ||
    cluster !== 'tumu';
  const temizle = () => {
    setQ('');
    setNs('tumu');
    setSpa('tumu');
    setKalip('tumu');
    setIstek('tumu');
    setAg('tumu');
    setRp('tumu');
    setRpIstek('tumu');
    setCluster('tumu');
  };

  const csv = useCallback(() => {
    downloadCsv(
      'gercek_spa_kesfi',
      [
        'uygulama',
        'namespace',
        'ortam',
        'spa',
        'kanit',
        'ad_kalibi',
        'istek',
        'olcum_penceresi_gun',
        'ag',
        'ag_envanter',
        'reverse_proxy',
        'rp_yol',
        'rp_host',
        'rp_neden',
        'rp_sorun',
        'rp_istegi',
        'rp_istegi_nedeni',
        'rp_istek_7g',
        'rp_istek_7g_ortam_disi',
        'rp_istek_24s',
        'rp_son_istek',
        'route_envanteri',
        'adresler',
        'clusterlar',
        'not',
      ],
      satirlar.map((a) => [
        a.application,
        a.namespace,
        a.env || '',
        a.spa === 'evet' ? 'evet' : a.spa === 'hayir' ? 'hayır' : 'bilinmiyor',
        a.signals.join(' ') + (a.weakEvidence ? ' (zayıf kanıt)' : ''),
        a.patternMiss ? 'uymuyor (SPA)' : a.pattern,
        // OLCULEMEYEN SATIRA 0 YAZILMAZ: elektronik tabloda toplanip "istek yok" okunurdu.
        a.istek === 'var' || a.istek === 'yok' ? (a.reqShown ?? '') : a.istek,
        a.usage?.windowDays ?? '',
        a.ag,
        a.agEnvanter,
        a.rp,
        (a.rpYol || []).join(' '),
        a.rpHost || '',
        a.rpNeden || '',
        // ORTAM_DISI hangi ortam(lar)la birlikte: "tanimsiz" satirin baska ortamdaki tanimi.
        (a.rpSorun || [])
          .map((s) =>
            s === 'ORTAM_DISI' && a.rpOrtamDisi?.length ? `${s}(${a.rpOrtamDisi.join('+')})` : s,
          )
          .join(' '),
        a.rpIstek,
        (a.rpIstekNeden || []).join(' '),
        // Ayni kural: olculmeyen RP istegine 0 yazilmaz (sayi yalniz olculen tanimlardan).
        // K3: rp_istek_7g YALNIZ kendi ortaminin RP tanimlari; baska ortamin RP tanimlarinda
        // gorulen istek AYRI kolonda (bilgi; toplanmaz, rp_istegi kararina girmez).
        a.rpReq7 ?? '',
        a.rpReq7Disi ?? '',
        a.rpReq24 ?? '',
        a.rpSon ? zaman(a.rpSon) : '',
        a.inventory === 'kismen' ? `kısmen (${a.invRoutes}/${a.routeCount})` : a.inventory,
        a.hosts.join(' '),
        a.clusters.join(' '),
        a.notes.join(' | '),
      ]),
    );
  }, [satirlar]);

  const s = data?.appSummary;
  const rs = data?.summary;
  // HICBIR route ESLESMEDI: "SPA yok" DEGIL, "bakamadik". Ilk uretim kosusunda 4532 route'un
  // tamami eslesmesizdi (servis yetkisi) ve ekran yalnizca "0 SPA" diyordu.
  const hepsiEslesmesiz = !!rs && rs.routes > 0 && rs.unmatched === rs.routes;
  const kovalar = Object.entries(rs?.unmatchedReasons || {}).sort((a, b) => b[1] - a[1]);
  // ── ESLESME KANITI ORANI (kullanici bulgusu 2026-10-08) ─────────────────────────────
  // Uygulama satirinda "zayif kanit" rozeti VARDI ama TOPLAM oran ekranda YOKTU; kullanici
  // ancak SQL ile gorebildi: 26.426 satirin 25.072'si (%94,9) 'ad' eslesmesi, 'selector'
  // yalnizca 48. Bu sayi butun SPA kararlarinin zeminini anlatiyor ve gorunmek zorunda.
  //
  // `selector` = servis selector'u okundu, route'un arkasindaki is yuku KESIN.
  // `ad`       = servis OKUNAMADI, servisle ayni adi tasiyan is yukune dusuldu - ZAYIF.
  // ''         = hic eslesmedi.
  const bm = rs?.byMatch || {};
  const bmSelector = bm.selector || 0;
  const bmAd = bm.ad || 0;
  const bmOlculen = bmSelector + bmAd;
  // YUZDE YALNIZ ESLESENLER UZERINDEN: eslesmeyenleri paydaya koymak "kanit kalitesi"
  // sorusunu "kapsam" sorusuyla karistirirdi; eslesmeyen sayisi ayrica gosteriliyor.
  const bmAdYuzde = bmOlculen > 0 ? Math.round((bmAd / bmOlculen) * 1000) / 10 : null;
  // TARAMA EKSIGI: "adi kurala uymayan SPA yok" cumlesi ancak tam taramada nitelemesiz soylenir.
  const cv = data?.coverage;
  const eksikTarama = [
    cv && cv.failed > 0 ? `${nf(cv.failed)} cluster taranamadı` : '',
    cv && cv.partial > 0 ? `${nf(cv.partial)} cluster kısmi tarandı` : '',
    cv && (cv.error || (!cv.measured && (s?.apps || 0) > 0)) ? 'cluster kapsamı bilinmiyor' : '',
    s && s.unknown > 0 ? `${nf(s.unknown)} uygulamada SPA olup olmadığı ölçülemedi` : '',
  ]
    .filter(Boolean)
    .join(', ');
  // max-w: kutu genisligi en uzun SECENEGE gore buyuyordu (RP istegi "uygulanamaz" secenegi
  // kutuyu ~270 px yapip suzgec satirini ikiye boluyordu); acilan listede secenek tam okunur.
  const SELECT = 'px-2 py-1.5 text-xs border rounded-lg max-w-[12rem]';
  const selStyle = { borderColor: 'var(--border)', background: 'var(--bg-surface)' };
  const sec = (n?: number) => (n != null ? ` (${nf(n)})` : '');
  const kirilim = (m: Record<string, number> | undefined, ad: Record<string, { t: string }>) =>
    Object.entries(m || {})
      .map(([k, v]) => `${ad[k]?.t === '—' ? 'uygulanamaz' : ad[k]?.t || k} ${nf(v)}`)
      .join(' · ');

  return (
    <div className="space-y-3">
      {hata && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border"
          style={{ color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
        >
          SPA keşfi okunamadı: {hata}
        </div>
      )}

      {data?.tableMissing && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border"
          style={{ color: 'var(--status-warning)', borderColor: 'var(--status-warning)' }}
        >
          {data.message}
        </div>
      )}

      {/* KANIT ZEMINI: 'ad' esleşmesi baskınsa bunu ozette SOYLE. Uygulama basina rozet
          vardi ama toplam oran gorunmuyordu; "12.458 SPA" ile "12.458 SPA, cogu ad
          benzerligine dayali" ayni guven duzeyinde okunuyordu. */}
      {bmAdYuzde != null && bmAd > 0 && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border"
          style={
            bmAdYuzde >= 50
              ? { color: 'var(--status-warning)', borderColor: 'var(--status-warning)' }
              : { color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)' }
          }
        >
          <b>Eşleşme kanıtı:</b> {nf(bmSelector)} satır servis <b>selector</b>’ü ile (kesin),{' '}
          {nf(bmAd)} satır yalnız <b>ad benzerliği</b> ile (zayıf — %{bmAdYuzde})
          {bm[''] ? `, ${nf(bm[''])} satır hiç eşleşmedi` : ''}.
          {bmAdYuzde >= 50 && (
            <>
              {' '}
              Servis okunamadığı için route’lar servisle aynı adı taşıyan iş yüküne bağlandı;
              ad ile iş yükü adı ayrıştığı yerde <b>yanlış iş yüküne</b> bakılmış olabilir.
              Düzeltmesi kod değil <b>yetki</b>: <code>services</code> (get/list) okuma izni.
            </>
          )}
        </div>
      )}

      {hepsiEslesmesiz && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border"
          style={{ color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
        >
          <b>Hiçbir route bir iş yüküne eşlenemedi</b> — bu “SPA yok” demek DEĞİL, keşif route'ların
          arkasına bakamadı. Sebep: {kovalar.map(([k, v]) => `${k} (${nf(v)})`).join(' · ') || '—'}.
        </div>
      )}

      {s && (
        <div
          className="rounded-xl border p-3 space-y-1"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="text-sm">
            <b>{nf(s.apps)}</b> uygulama tarandı; <b>{nf(s.spa)}</b> tanesi gerçekten SPA (kabinde
            nginx çalışıyor).{' '}
            {s.patternMiss > 0 ? (
              <b style={{ color: 'var(--status-danger)' }}>
                Bunların {nf(s.patternMiss)} tanesinin adı -app-v / -app-emb-v kuralına uymuyor —
                eski yöntem bunları SPA saymıyordu.
              </b>
            ) : hepsiEslesmesiz ? null : s.apps === 0 ? (
              // VERI YOKKEN "KACIRILAN YOK" DENMEZ: olculmemis sey yok diye sunulmaz.
              <>Keşif verisi yok.</>
            ) : eksikTarama ? (
              <>Taranabilen kısımda adı kurala uymayan SPA yok ({eksikTarama}).</>
            ) : (
              <>Adı kurala uymayan SPA yok.</>
            )}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            SPA'lardan {nf(s.spaRequestActive)} tanesi istek alıyor · {nf(s.spaRequestIdle)} istek
            almıyor
            {!!s.spaRequestNoService && (
              <> · {nf(s.spaRequestNoService)} Dynatrace servisi yok</>
            )} · {nf(s.spaRequestUnknown)} ölçülemedi/ölçüm yok
            {s.spaNotInInventory > 0 && (
              <> · {nf(s.spaNotInInventory)} SPA route envanterinde tam kayıtlı değil</>
            )}
            {s.unknown > 0 && <> · {nf(s.unknown)} uygulamada SPA olup olmadığı ölçülemedi</>}
            {data?.scanDate ? ` · keşif ${data.scanDate}` : ''}
          </div>
          {s.spa > 0 && s.spaAg && (
            <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              SPA'ların ağı: {kirilim(s.spaAg, AG_ETIKET)} · reverse proxy:{' '}
              {kirilim(s.spaRp, RP_ETIKET)} · RP isteği: {kirilim(s.spaRpIstek, RPI_ETIKET)}
            </div>
          )}
          {!!data?.platformHidden?.routes && (
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              OpenShift platform namespace'leri (openshift-*, kube-*, default) kapsam dışı:{' '}
              {nf(data.platformHidden.namespaces)} namespace, {nf(data.platformHidden.routes)} route
              gösterilmiyor (konsol, oauth, monitoring gibi platform route'ları; uygulama değil).
            </div>
          )}
          {data?.coverage && <Kapsam k={data.coverage} />}
          {data?.rpKapsam && <RpKapsamBand k={data.rpKapsam} />}
        </div>
      )}

      {/* KOLON AÇIKLAMASI katlanır (2026-10-03): tablonun üstündeki uzun gri paragraf her açılışta
          okunmuyordu; her başlığın ipucu da aynı açıklamayı taşır. */}
      <details className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        <summary className="cursor-pointer select-none" style={{ color: 'var(--text-secondary)' }}>
          Kolonlar ne anlatıyor? · rozetlerde kesik çerçeve = ölçülemedi (yok / tanımsız değil) ·
          satıra tıklayınca adreslerin, cluster'ların ve RP tanımlarının tamamı açılır
        </summary>
        <div className="mt-1">
          <b>SPA</b>: kabinde nginx çalışıyor mu; altında <b>ad kalıbı</b>: uygulama adı -app-v /
          -app-emb-v kuralına uyuyor mu (eski yöntem SPA'yı yalnız adından tanıyordu) ·{' '}
          <b>Uygulama isteği</b>: Dynatrace'e göre uygulama (pod) istek alıyor mu ·{' '}
          <b>Reverse proxy › Ağ</b>: route TLS tipi (passthrough = internet, reencrypt = intranet)
          · <b>Reverse proxy › Tanım</b>: internet SPA kendi ortamının RP sunucularında tanımlı mı
          (yalnız başka ortamın RP'sinde tanımlıysa "tanımsız" + ortam dışı uyarısı) ·{' '}
          <b>Reverse proxy › İstek</b>: RP access log'una göre kendi ortamının RP tanımı istek
          alıyor mu (yeni PROD: uygulama vhost'unun Host/SNI sayımı; başka ortamın RP'sindeki
          istek yalnız "ortam dışı" bilgisi, karara ve sayıya girmez) · <b>Route envanteri</b>:
          route'u envanterde kayıtlı mı. <b>Adresler</b> ve <b>Cluster'lar</b> ilk öğeyi ve "+N"
          gösterir; tamamı ipucunda ve ayrıntıda.
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <MagnifyingGlassIcon
            className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-muted)' }}
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="uygulama, namespace ya da adres"
            className="pl-8 pr-2.5 py-1.5 text-xs border rounded-lg w-56"
            style={{ borderColor: 'var(--border)' }}
          />
        </div>
        <select
          value={ns}
          onChange={(e) => setNs(e.target.value)}
          className={SELECT}
          style={selStyle}
          title="Namespace"
        >
          <option value="tumu">tüm namespace'ler</option>
          {(data?.namespaces || []).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <select
          value={spa}
          onChange={(e) => setSpa(e.target.value as SpaSecim)}
          className={SELECT}
          style={selStyle}
          title="SPA"
        >
          <option value="tumu">SPA: tümü</option>
          <option value="evet">SPA: evet{sec(say.spa.evet)}</option>
          <option value="hayir">SPA: hayır{sec(say.spa.hayir)}</option>
          <option value="bilinmiyor">SPA: bilinmiyor{sec(say.spa.bilinmiyor)}</option>
        </select>
        <select
          value={kalip}
          onChange={(e) => setKalip(e.target.value as KalipSecim)}
          className={SELECT}
          style={selStyle}
          title="Ad kalıbı"
        >
          <option value="tumu">ad kalıbı: tümü</option>
          <option value="uyuyor">ad kalıbı: uyuyor{sec(say.kalip.uyuyor)}</option>
          <option value="uymuyor">ad kalıbı: uymuyor{sec(say.kalip.uymuyor)}</option>
        </select>
        <select
          value={istek}
          onChange={(e) => setIstek(e.target.value as IstekSecim)}
          className={SELECT}
          style={selStyle}
          title="Uygulama isteği (Dynatrace)"
        >
          <option value="tumu">uygulama isteği: tümü</option>
          <option value="var">istek alıyor{sec(say.istek.var)}</option>
          <option value="yok">istek almıyor{sec(say.istek.yok)}</option>
          <option value="servis-yok">Dynatrace servisi yok{sec(say.istek['servis-yok'])}</option>
          <option value="olculemedi">istek ölçülemedi{sec(say.istek.olculemedi)}</option>
          <option value="olcum-yok">istek ölçümü yok{sec(say.istek['olcum-yok'])}</option>
        </select>
        <select
          value={ag}
          onChange={(e) => setAg(e.target.value as AgSecim)}
          className={SELECT}
          style={selStyle}
          title="Ağ (route TLS tipi)"
        >
          <option value="tumu">ağ: tümü</option>
          <option value="internet">ağ: internet{sec(say.ag.internet)}</option>
          <option value="intranet">ağ: intranet{sec(say.ag.intranet)}</option>
          <option value="karisik">ağ: karışık{sec(say.ag.karisik)}</option>
          <option value="diger">ağ: diğer{sec(say.ag.diger)}</option>
          <option value="bilinmiyor">ağ: bilinmiyor{sec(say.ag.bilinmiyor)}</option>
        </select>
        <select
          value={rp}
          onChange={(e) => setRp(e.target.value as RpSecim)}
          className={SELECT}
          style={selStyle}
          title="Reverse proxy'de tanımlı mı"
        >
          <option value="tumu">reverse proxy: tümü</option>
          <option value="tanimli">RP: tanımlı{sec(say.rp.tanimli)}</option>
          <option value="tanimsiz">RP: tanımsız{sec(say.rp.tanimsiz)}</option>
          <option value="olculemedi">RP: ölçülemedi{sec(say.rp.olculemedi)}</option>
          <option value="kapsam-disi">RP: kapsam dışı{sec(say.rp['kapsam-disi'])}</option>
          <option value="uygulanamaz">RP: uygulanamaz{sec(say.rp.uygulanamaz)}</option>
        </select>
        <select
          value={rpIstek}
          onChange={(e) => setRpIstek(e.target.value as RpIstekSecim)}
          className={SELECT}
          style={selStyle}
          title="RP isteği (access log)"
        >
          <option value="tumu">RP isteği: tümü</option>
          <option value="var">RP isteği var{sec(say.rpIstek.var)}</option>
          <option value="yok">RP isteği yok{sec(say.rpIstek.yok)}</option>
          <option value="kismi">RP isteği kısmi{sec(say.rpIstek.kismi)}</option>
          <option value="olculemedi">RP isteği ölçülemedi{sec(say.rpIstek.olculemedi)}</option>
          <option value="kaynak-yok">RP ölçüm kaynağı yok{sec(say.rpIstek['kaynak-yok'])}</option>
          <option value="ayrilamaz">RP isteği ayrılamaz{sec(say.rpIstek.ayrilamaz)}</option>
          <option value="uygulanamaz">
            RP isteği uygulanamaz (kendi ortamında tanım yok, bulunamadı ya da kapsam dışı / RP
            hesaplanmıyor)
            {sec(say.rpIstek.uygulanamaz)}
          </option>
        </select>
        <select
          value={cluster}
          onChange={(e) => setCluster(e.target.value)}
          className={SELECT}
          style={selStyle}
          title="Cluster"
        >
          <option value="tumu">tüm cluster'lar</option>
          {(data?.clusters || []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {suzgecVar && (
          <button
            onClick={temizle}
            className="px-2 py-1.5 text-xs border rounded-lg"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            süzgeçleri temizle
          </button>
        )}
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {nf(satirlar.length)} uygulama
        </span>
        <div className="ml-auto flex items-center gap-2">
          <YogunlukSecimi
            deger={gorunum.yogunluk}
            onDegis={(y) => gorunumDegis({ ...gorunum, yogunluk: y })}
          />
          <KolonMenusu
            gizli={gorunum.gizli}
            onDegis={(gizli) => gorunumDegis({ ...gorunum, gizli })}
          />
          <button
            onClick={csv}
            disabled={!satirlar.length}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg disabled:opacity-50"
            style={{ borderColor: 'var(--border)' }}
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV ({nf(satirlar.length)})
          </button>
          <button
            onClick={() => void yukle(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg"
            style={{ borderColor: 'var(--border)' }}
            title="Sunucudaki 60 sn önbelleği atlayıp yeniden hesaplar"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${yukleniyor ? 'animate-spin' : ''}`} /> Yenile
          </button>
        </div>
      </div>

      {/* KAYDIRMA KABI SINIRLI YUKSEKLIKTE (2026-10-03): eskiden yuksekligi sinirsizdi; kap
          yatay kaydirma icin `overflow-auto` oldugundan yapiskan baslik ONA gore yapisiyor ve
          sayfa kayarken HIC yapismiyordu (tarayicida olculdu). Kap dikeyde de kayinca baslik
          ve ilk kolon (uygulama) yerinde kalir. Yukseklik siniri ve klavye odagi icin
          scroll-padding index.css `.ng-spa-kap`ta (bekci: nginx-console.test.cjs GS28). */}
      <div className="ng-spa-kap overflow-auto rounded-xl border" style={{ borderColor: 'var(--border-subtle)' }}>
        {/* GENISLIK: tablo icerigi kadar (w-max), en az kap kadar (min-w-full). Esneyen kolon
            (Adresler; gizliyse son kolon) disindakiler <col> ile icerige sikisir (1px =
            "icerik kadar"); kalan bosluk YALNIZ esneyen kolona gider, kolonlar arasina
            yayilip tabloyu seyreltmez. */}
        <table className="ng-spa-tablo w-max min-w-full" data-yogunluk={gorunum.yogunluk}>
          <caption className="sr-only">
            Gerçek SPA keşfi: uygulama başına tek satır. Satırdaki düğme ayrıntıyı açar.
          </caption>
          {kolonParcalari(gorunur).map((p) => (
            <colgroup key={p.idler[0]} data-grup={p.grup}>
              {p.idler.map((id) => (
                <col
                  key={id}
                  style={id === esneyenKolon(gorunur) ? undefined : { width: '1px' }}
                />
              ))}
            </colgroup>
          ))}
          <TabloBasligi gorunur={gorunur} />
          <tbody>
            {satirlar.map((a, i) => (
              <SpaSatir
                key={anahtar(a)}
                a={a}
                acik={secili === anahtar(a)}
                k={data?.rpKapsam}
                onSec={onSec}
                surum={surum}
                tabloHesap={data?.hesaplandi}
                onYenile={yenile}
                cizgili={i % 2 === 1}
                gorunur={gorunur}
              />
            ))}
            {!satirlar.length && !yukleniyor && (
              <tr>
                <td
                  colSpan={gorunur.length}
                  style={{ color: SOLUK, whiteSpace: 'normal', padding: '12px 8px' }}
                  data-testid="bos-sonuc"
                >
                  {hata ? (
                    // HATA "SATIR YOK" DEGIL: ust bantta sebep yazar; burada da bos sonuc
                    // gibi konusulmaz.
                    <span style={{ color: 'var(--status-danger)' }}>
                      Veri okunamadı — sebep yukarıda.
                    </span>
                  ) : apps.length ? (
                    <>
                      Bu süzgeçlerle uygulama yok; toplam {nf(apps.length)} uygulama var.{' '}
                      <button
                        onClick={temizle}
                        className="ml-1 px-1.5 py-0.5 text-[11px] border rounded"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      >
                        süzgeçleri temizle
                      </button>
                    </>
                  ) : (
                    'Keşif verisi yok.'
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
