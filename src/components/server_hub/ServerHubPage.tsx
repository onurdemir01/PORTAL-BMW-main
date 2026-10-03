// src/components/server_hub/ServerHubPage.tsx — Server Hub (2026-09-21).
//
// Kullanici: "sunucu reboot oldugunda her sey dogru acilacak mi ve sunucularda atil bir sey var mi;
// Nginx Hub gibi ama RAPOR gibi gozuksun: once genel durum bar ve yuvarlak grafiklerle".
// Veri: gunluk server_hub_scan (dbo.Server_Hub_*), degerlendirme sunucuda (server/server-hub/assess.cjs).
// Sunucu satiri -> "Simdi tara" (reboot oncesi tek sunucu) ve "Duzelt" (once PLAN, sonra onay).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ServerStackIcon,
  ArrowPathIcon,
  MagnifyingGlassIcon,
  BoltIcon,
  WrenchScrewdriverIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  CheckCircleIcon,
  ShieldExclamationIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import {
  serverHubApi,
  type ShOverview,
  type ShHostRow,
  type ShHostDetail,
  type ShFindingRow,
  type ShReadiness,
  type ShFinding,
  type ShSeverity,
  type ShFindingsResult,
  type ShJvm,
  type ShSummary,
  type ShEnvBlock,
  type ShStaleFleet,
  type ShRollback,
  type ShUnattributed,
} from '@/api/serverHubApi';
import { useJobTracker } from '@/contexts/JobTrackerContext';
import { Modal } from '@/components/common/Modal';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtNumber, fmtDate } from '@/utils/datetime';
import { toast } from '@/hooks/useToast';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import RetirementTab from './RetirementTab';
import { LoadingLogo } from '@/components/common/LoadingLogo';

const SM_BTN =
  'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';
const smBtn = (primary = false): React.CSSProperties =>
  primary
    ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-fg, #fff)' }
    : {
        borderColor: 'var(--border)',
        background: 'var(--bg-surface)',
        color: 'var(--text-primary)',
      };
const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
const nf = (n: number | null | undefined) => (n == null ? '—' : fmtNumber(n));

const SEV: Record<
  ShSeverity,
  {
    label: string;
    color: string;
    bg: string;
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  }
> = {
  ok: {
    label: 'sorun yok',
    color: 'var(--status-success)',
    bg: 'var(--status-success-bg)',
    icon: CheckCircleIcon,
  },
  info: {
    label: 'bilgi',
    color: 'var(--status-info)',
    bg: 'var(--status-info-bg)',
    icon: InformationCircleIcon,
  },
  warning: {
    label: 'uyarı',
    color: 'var(--status-warning)',
    bg: 'var(--status-warning-bg)',
    icon: ExclamationTriangleIcon,
  },
  danger: {
    label: 'kritik',
    color: 'var(--status-danger)',
    bg: 'var(--status-danger-bg)',
    icon: ShieldExclamationIcon,
  },
};
const AREA: Record<string, string> = {
  init: 'Init script',
  jboss: 'JBoss',
  jvm: 'JVM',
  web: 'Web sunucu',
  ip: 'IP',
  ssh: 'SSH',
  scan: 'Tarama',
};

// ── Sozlesme v3, dalga 1: "OLCULEMEDI" ILE "YOK / KAPALI / 0" AYRI ──────────────────────
//
// Kural 6: okunamayan sey ekranda 0 / yok / kapali / temiz diye GOSTERILMEZ. Sunucu (assess +
// index) olculemeyeni artik ayri tasiyor (runningKnown, runningSrc, jvmsUnmeasured,
// summary.jvm.unmeasured, notRunningUnmeasured, 'unverified' IP, INIT UNREADABLE, staleFleet);
// bu blok o alanlari OKUR ve ayri etiketle basar.
//
// YEREL TIP GENISLETMESI: alanlarin bir kismi burada yerel (sayaclar, runningKnown). Dalga 2 ile
// eklenenler (staleFleet, rollback, schemaUnknown, targetsTruncated, unattributed) serverHubApi.ts'te;
// tur 4: targetsDynamic, trafficState/trafficReason, unattributed[].reason, cfgSrc, fresh.
// Yeni alanlarin hepsi ISTEGE BAGLIDIR: eski sunucu yaniti alani tasimaz, ekran o zaman eski
// davranisi gosterir ve eksik sayaci "0" diye UYDURMAZ (alan yoksa satir hic basilmaz).
//
// Bekci: server/server-hub/__tests__/ui-v2.test.cjs (bu yardimcilari kaynaktan derleyip cagirir;
// bantlari jsx fabrikasiyla CAGIRIR, yerlesimi AST ile denetler).
type ShHostRowV3 = ShHostRow & { jvmsUnmeasured?: number };
type ShJvmV3 = ShJvm & { runningKnown?: boolean | null; runningSrc?: string | null };
type ShWebV3 = ShHostDetail['web'][number] & { runningSrc?: string | null };
type ShHostDetailV3 = Omit<ShHostDetail, 'jvms' | 'web'> & { jvms: ShJvmV3[]; web: ShWebV3[] };
type ShSummaryV3 = ShSummary & {
  jvm: ShSummary['jvm'] & { unmeasured?: number; retireBlockedByWebTier?: number };
  /** unverified: sozlesmede donuk DEGIL; gelirse ayri dilim, gelmezse etiket durumu soyler. */
  ips: ShSummary['ips'] & { unverified?: number };
  web: Record<string, ShSummary['web'][string] & { notRunningUnmeasured?: number }>;
  byEnv?: Record<string, ShEnvBlock & { jvmUnmeasured?: number }>;
};
type ShOverviewV3 = Omit<ShOverview, 'hosts' | 'summary'> & {
  hosts: ShHostRowV3[];
  summary: ShSummaryV3 | null;
};
type CalismaKaniti = { running: boolean; runningKnown?: boolean | null; runningSrc?: string | null };

/** Sayi alani GELDIYSE sayidir; gelmediyse (eski sunucu) "bilinmiyor" - asla 0 degil. */
const sayiMi = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * runningKnown (sozlesme v3) = running_src !== 'UNMEASURED'. hidepid'li sunucuda ps baskasinin
 * surecini gostermez; JVM'in "running=0" satiri o zaman "kapali" DEGIL "bilinmiyor"dur.
 * Alan yoksa (eski satir / eski sunucu) bilinen sayilir - C'nin NULL kurali ile ayni.
 */
function jvmCalismaBilinir(j: { runningKnown?: boolean | null; runningSrc?: string | null }): boolean {
  if (j.runningKnown === false) return false;
  return String(j.runningSrc || '').toUpperCase() !== 'UNMEASURED';
}

/**
 * JVM tablosu "Durum" hucresi. `sema` = sunucu ayrintisinin schemaUnknown'u (C3): sys.columns
 * okunamadiginda running_src hic secilmez ve running=0 satiri "bilinmiyor" gelir. Sebep o zaman
 * hidepid/ps korlugu DEGIL semadir; yanlis sebep operatoru yanlis yere baktirir.
 */
function jvmDurumu(j: CalismaKaniti, sema = false): { metin: string; renk: string; aciklama: string } {
  if (!jvmCalismaBilinir(j))
    return sema
      ? {
          metin: 'bilinmiyor (şema okunamadı)',
          renk: SEV.warning.color,
          aciklama:
            'Çalışma durumu ölçülemedi: Server Hub şeması (sys.columns) okunamadığı için çalışma kaynağı (running_src) seçilemedi. Bu "kapalı" demek DEĞİL.',
        }
      : {
          metin: 'bilinmiyor (süreç görünmüyor)',
          renk: SEV.warning.color,
          aciklama:
            'Çalışma durumu ölçülemedi: sunucuda süreç listesi kısıtlı (hidepid) ve JBoss CLI durum vermedi. Bu "kapalı" demek DEĞİL.',
        };
  if (j.running) return { metin: 'çalışıyor', renk: SEV.ok.color, aciklama: '' };
  return { metin: 'kapalı', renk: 'var(--status-neutral)', aciklama: '' };
}

/** Web urunu karti: running_src=UNMEASURED iken "calismiyor" DEGIL. `sema`: bkz. jvmDurumu. */
function webDurumu(
  w: { running: boolean; runningSrc?: string | null },
  sema = false,
): {
  metin: string;
  renk: string;
} {
  if (String(w.runningSrc || '').toUpperCase() === 'UNMEASURED')
    return {
      metin: sema ? 'bilinmiyor (şema okunamadı)' : 'bilinmiyor (süreç görünmüyor)',
      renk: 'var(--status-neutral)',
    };
  if (w.running) return { metin: 'çalışıyor', renk: SEV.ok.color };
  return { metin: 'çalışmıyor', renk: SEV.warning.color };
}

/**
 * Sunucular sekmesindeki ozet kartlari ve liste hucresi basliklari icin OLCULEMEYEN calisma
 * durumunun SEBEBI. `sema` = /overview schemaUnknown (C3): sys.columns okunamadiginda running_src
 * hic secilmez; sebep o zaman hidepid/ps korlugu DEGIL semadir (bkz. jvmDurumu).
 */
function olcumSebebi(sema: boolean): string {
  return sema ? 'şema okunamadı' : 'süreç görünmüyor';
}
function olculemeyenAciklama(tur: 'jvm' | 'web', sema: boolean): string {
  if (sema)
    return tur === 'jvm'
      ? "Server Hub şeması (sys.columns) okunamadı: çalışma kaynağı (running_src) seçilemedi — bu JVM'ler ne çalışan ne kapalı sayıldı."
      : "Server Hub şeması (sys.columns) okunamadı: web sürecinin çalışma kaynağı (running_src) seçilemedi — 'çalışmıyor' sayılmadı.";
  return tur === 'jvm'
    ? "Süreç listesi kısıtlı (hidepid) ve CLI durum vermedi: bu JVM'ler ne çalışan ne kapalı sayıldı."
    : "Süreç listesi kısıtlı (hidepid): bu sunucularda web sürecinin çalışıp çalışmadığı ölçülemedi — 'çalışmıyor' sayılmadı.";
}

/** Sunucu listesi JVM hucresi: "calisan/toplam" + olculemeyen varsa "? N". */
function jvmSayimMetni(h: { jvms: number; jvmsRunning: number; jvmsUnmeasured?: number }): string {
  if (!h.jvms) return '—';
  const u = sayiMi(h.jvmsUnmeasured) ? h.jvmsUnmeasured : 0;
  return `${h.jvmsRunning}/${h.jvms}${u > 0 ? ` · ? ${u}` : ''}`;
}

/**
 * Tek-JVM auto-start onayi. Olculemeyen JVM'de dugme admine ACIK kalir (kural 7) ama kullanici
 * neyi bilmeden degistirdigini gorur.
 */
function autoStartOnayMetni(
  host: string,
  j: { gen: number; name: string } & CalismaKaniti,
  ac: boolean,
  sema = false,
): string {
  const uyari = jvmCalismaBilinir(j)
    ? ''
    : `UYARI: bu JVM'in çalışma durumu ölçülemedi (${sema ? 'Server Hub şeması okunamadı' : 'süreç görünmüyor'}) — çalışıyor da olabilir, kapalı da. ` +
      'Kararı bunu bilerek verin.\n\n';
  return (
    `${host} üzerinde ${j.name} (JBoss ${j.gen}) için auto-start ${ac ? 'AÇILACAK' : 'KAPATILACAK'}.\n\n` +
    uyari +
    'Yalnız bu JVM etkilenir. Devam edilsin mi?'
  );
}

/**
 * Tek-JVM auto-start dugmesi gosterilsin mi (tur 4). Sunucu /jvm-autostart su durumlarda 400 doner
 * ve is ACMAZ; dugme de gizlenir, yerine sebep yazilir (tiklayip hata toast'i almak yerine):
 *   - cfg_src=UNAVAILABLE (EK-7.6): JVM tanim kaynaginda yok - degistirilecek bir auto-start yok
 *   - sema okunamadi (EK-6.13) ya da bayat / son yuklemede disarida kalan sunucu (v3)
 * Calisma durumu OLCULEMEYEN JVM'de dugme ACIK kalir (v3, kural 7): onay metni uyarir.
 */
function autoStartDugmesi(
  j: { source?: string; cfgSrc?: string | null },
  h: { schemaUnknown?: boolean; fresh?: boolean } | null | undefined,
): { goster: boolean; neden: string } {
  if (String(j.source || 'cli') === 'cli' && String(j.cfgSrc || '').toUpperCase() === 'UNAVAILABLE')
    return { goster: false, neden: "tanım kaynağında yok (ps'te tanımsız süreç) — auto-start değiştirilemez" };
  if (h?.schemaUnknown === true)
    return { goster: false, neden: 'Server Hub şeması okunamadı — eylemler kapalı' };
  if (h?.fresh === false)
    return { goster: false, neden: 'tarama bayat ya da son yükleme dışlandı — eylemler kapalı' };
  return { goster: true, neden: '' };
}

/** IP "Kullanan" hucresi. 'unverified' BOSTA degildir ve urun adi da degildir. */
function ipKullanan(usedBy: string): { etiket: string; renk: string; kalin: boolean; aciklama: string } {
  const u = String(usedBy || '').toLowerCase();
  if (u === 'none')
    return { etiket: 'BOŞTA', renk: SEV.warning.color, kalin: true, aciklama: 'hiçbir vhost/soket kullanmıyor' };
  if (u === 'unverified')
    return {
      etiket: 'DOĞRULANAMADI',
      renk: SEV.info.color,
      kalin: true,
      aciklama:
        'Kullanım doğrulanamadı: web sunucusu ölçülemedi ya da soketler görünmüyor. Boşta SAYILMAZ.',
    };
  if (u === 'wildcard')
    return { etiket: 'joker dinleyici (*)', renk: 'var(--text-primary)', kalin: false, aciklama: '' };
  if (u === 'other') return { etiket: 'web dışı soket', renk: 'var(--text-primary)', kalin: false, aciklama: '' };
  return { etiket: String(usedBy || '').toUpperCase(), renk: 'var(--text-primary)', kalin: false, aciklama: '' };
}

/** Log kaniti OLCULDU mu: okundu VE sayi >= 0. -1 / null olcum DEGILDIR. */
const logOlculdu = (l: { read: boolean; req7d: number | null }) =>
  !!l.read && l.req7d != null && l.req7d >= 0;

/**
 * sampled=1 (EK-7.3): sayi ALT SINIRDIR. Iki sebebi var: log kuyrugu 7 gunu kapsamadi (kesildi /
 * boyut bilinmiyor) YA DA trafigin bir kismi okunan logda yok (location duzeyi ya da kosullu log,
 * acilamayan include). Eski metin yalniz ilkini soyluyordu; logu 7 gunu kapsayan satirda yanlis kok
 * neden olurdu.
 */
const ALT_SINIR_ACIKLAMA =
  'sayı alt sınır: log kuyruğu 7 günü kapsamadı ya da trafiğin bir kısmı bu logda yok (location düzeyi / koşullu log, açılamayan include)';

/** Log kaniti satirinin sayi kismi. Okunamayan dosya "7g 0" ya da "7g -1" diye BASILMAZ. */
function logKanitMetni(l: { read: boolean; req7d: number | null; sampled: boolean }): string {
  if (!logOlculdu(l)) return ' · OKUNAMADI — bu dosya kanıt sayılmaz';
  return ` · 7g ${l.req7d}${l.sampled ? ' (alt sınır: kuyruk 7 günü kapsamadı ya da trafiğin bir kısmı bu logda yok)' : ''}`;
}

/**
 * vhost tablosu trafik sebebi (tur 4). '?' hucresi eskiden hep "log okunamadi" diye
 * aciklaniyordu; oysa UNVERIFIED satirlarin cogunda log OKUNDU (LOCATION_LOG, CONDITIONAL_LOG,
 * INCLUDE_UNRESOLVED, NO_HOST_FIELD, WINDOW_NOT_COVERED): sayi kanit degildir ama sebep "okunamadi"
 * DEGIL. UNREADABLE'da (log ya da conf okunamadi) "okunamadi" dogrudur. Bilinmeyen sebep ham kodla.
 */
const TRAFIK_SEBEP_ETIKET: Record<string, string> = {
  CONF_UNREADABLE: "vhost conf'u okunamadı (hedefleri de görülmedi)",
  NO_VHOST_LOG: 'vhost için access log tanımı görülmedi',
  LOG_OFF: 'access_log off',
  PIPED_LOG_UNRESOLVED: 'log bir programa yönlendiriliyor (dosyası çözülemedi)',
  UNSUPPORTED_LOG_TARGET: 'desteklenmeyen log hedefi (syslog vb.)',
  READ_ERROR: 'log okunamadı',
  EMPTY_LOG: 'log okundu ama boş',
  NO_TIMESTAMP: 'log okundu ama zaman damgası çözülemedi',
  DZDO_DENIED: 'log okunamadı (dzdo izni yok)',
  PERM_DENIED: 'log okunamadı (dosya izni yok)',
  TIMEOUT: 'log okunamadı (zaman aşımı)',
  LOG_MISSING: 'log dosyası yok',
  BUDGET_EXCEEDED: 'log okunamadı (tarama bütçesi)',
  DEADLINE: 'log okunamadı (tarama süresi doldu)',
  NO_HOST_FIELD: "log okundu ama paylaşımlı logda bu vhost'un istekleri ayırt edilemedi",
  WINDOW_NOT_COVERED: 'log okundu ama 7 günü kapsamıyor',
  VHOST_INVENTORY_PARTIAL: 'vhost envanteri kısmi (yapılandırma tam çözülemedi)',
  LOCATION_LOG: "log okundu ama proxy'li bir location başka loga yazıyor (ya da logu kapalı)",
  INCLUDE_UNRESOLVED: 'log okundu ama server bloğundaki bir include açılamadı',
  CONDITIONAL_LOG: 'log okundu ama koşullu (yalnız koşulu tutan istekler yazılıyor)',
};
const TRAFIK_DURUM_ETIKET: Record<string, string> = {
  ACTIVE: 'istek var',
  NO_RECENT_TRAFFIC: '7 gündür istek yok (log okundu)',
  UNVERIFIED: 'doğrulanamadı — sayı kanıt değil',
  UNREADABLE: 'ölçülemedi',
};
function vhostTrafikAciklamasi(v: {
  trafficState?: string | null;
  trafficReason?: string | null;
  sampled?: boolean;
}): string {
  const ts = String(v.trafficState || '').toUpperCase();
  const rs = String(v.trafficReason || '').toUpperCase();
  const parca: string[] = [];
  if (ts) parca.push(TRAFIK_DURUM_ETIKET[ts] || ts);
  if (rs && rs !== 'OK') parca.push(`sebep: ${TRAFIK_SEBEP_ETIKET[rs] || rs}`);
  if (v.sampled) parca.push(ALT_SINIR_ACIKLAMA);
  return parca.join(' · ');
}

/** Init script durumu. UNREADABLE (bakilamadi) "yok" DEGILDIR. */
function initDurumu(status: string): { etiket: string; renk: string } {
  const s = String(status || '').toUpperCase();
  if (s === 'OK') return { etiket: 'referansla aynı', renk: SEV.ok.color };
  if (s === 'DIFF') return { etiket: 'FARKLI', renk: SEV.warning.color };
  if (s === 'MISSING') return { etiket: 'yok', renk: 'var(--status-neutral)' };
  if (s === 'UNREADABLE') return { etiket: 'okunamadı (ölçülemedi)', renk: SEV.info.color };
  return { etiket: `bilinmiyor (${s || '—'})`, renk: SEV.info.color };
}

/**
 * Bulgu kodu etiketleri. Ham kod listede kalir (arama/CSV icin); yaninda ne demek oldugu yazar.
 * v3 dalga 1 kodlarinin HEPSI burada olmali (bekci D1-U03/U09); EK-3/EK-5 kodlari dahil.
 * EK-6.13: assess.cjs kaynagindaki HER add(..., 'KOD') ve code: 'KOD' degismezi burada olmali;
 * ui-v2 bekcisi kaynagi tarar, etiketsiz kod KIRMIZI. Kod adini sablon dizgeyle/degiskenle
 * ureten add() cagrisi da KIRMIZI (etiketi denetlenemez).
 * Acilis hazirliginda 'unknown' sayilan her kod (reboot-readiness KOD_ANLAMI) ve hazirlik sebep
 * kodlari (SCHEMA_UNKNOWN, STALE_EVIDENCE) da burada olmali: bekci bunu GERCEK modulden okur.
 */
const KOD_ETIKET: Record<string, string> = {
  RUNNING_UNMEASURED: 'JVM çalışma durumu ölçülemedi (süreç görünmüyor ya da şema okunamadı) — kapalı sayılmadı',
  TRAFFIC_UNVERIFIED: 'JVM kapalı, web trafiği doğrulanamadı — retire kanıtı yok',
  INIT_UNREADABLE: 'init script okunamadı — eksik ya da farklı sayılmadı',
  LOAD_EXCLUDED: 'sunucu son yüklemede yazılamadı — önceki tarama gösteriliyor, eylemler kapalı',
  JVM_DATA_MISSING: 'JBoss var ama taramada JVM verisi yok (ölçülemedi)',
  JVM_INVENTORY_UNMEASURED: "tanımlı JVM envanteri ölçülemedi (CLI ve host XML okunamadı) — durmuş JVM'ler listede olmayabilir",
  // T2-C2 (cfg_src=UNAVAILABLE): tanim kaynagi OKUNDU; sorun erisim degil tanim.
  JVM_UNDEFINED_PROCESS: "çalışan JVM tanım kaynağında yok (ps'te tanımsız süreç) — tanım listesi alındı; reboot sonrası kimin açacağı bilinmiyor",
  SCAN_PARTIAL: 'tarama kısmi (zaman bütçesi ya da çıktı sigortası)',
  LOAD_DUPLICATE: 'aynı makine AWX envanterinde iki adla',
  // C1/C4: engel artik KATMAN genisliginde (ortam+site); hedef baska sunucuda olabilir.
  // Tur 4 (EK-7.5): HEDEF nedenleri - cozulemeyen, dinamik (hedef kaydi yok), JVM'siz/taranmamis
  // hedef sunucu, okunamayan vhost conf'u.
  TRAFFIC_UNATTRIBUTED:
    "web katmanında hiçbir JVM'e atfedilemeyen proxy trafiği (port; çözülemeyen ya da dinamik hedef; JVM'siz ya da taranmamış hedef sunucu; okunamayan vhost conf'u; kesik hedef listesi) — retire önerilmez",
  WEB_PRESENCE_UNKNOWN: 'web ürününün varlığı ölçülemedi — "kurulu değil" sayılmadı',
  PRODUCT_NOT_SCANNED: 'envanterdeki ürün taramada görülemedi — "kurulu değil" sayılmadı',
  AUTOSTART_UNKNOWN: 'JVM auto-start durumu bilinmiyor — "kapalı" sayılmadı (sebep bulgu metninde)',
  CLI_FAIL: 'JBoss CLI okunamadı',
  CLI_SKIP: 'JBoss CLI hiç çalıştırılamadı (kurulum/süreç)',
  CLI_DENIED: 'JBoss CLI yetki reddi (dzdo kuralı eksik)',
  // Acilis hazirligi sebep kodlari (bulgu degil; reboot-readiness.cjs SEMA / BAYAT)
  SCHEMA_UNKNOWN: 'Server Hub şeması (sys.columns) okunamadı — tarayıcı şema sürümü bilinmiyor, eylemler kapalı',
  STALE_EVIDENCE: 'tarama bayat ya da son yükleme dışlandı — güncel durum bilinmiyor',
  REBOOT_RISK: 'JVM çalışıyor ama auto-start kapalı — reboot sonrası açılmaz',
  STOPPED_AUTOSTART_ON: "JVM kapalı ama auto-start açık — reboot'ta açılır",
  RETIRE_CANDIDATE: 'JVM kapalı ve web katmanında 7 gündür istek yok — retire adayı',
  NO_LOAD: 'JVM çalışıyor ama 7 gündür istek yok',
  SYNTAX_FAIL: 'web sunucusu sözdizimi hatalı',
  SYNTAX_UNVERIFIED: 'web sözdizimi doğrulanamadı (dosya erişimi)',
  SYNTAX_UNKNOWN: 'web sözdizimi ölçülemedi',
  INIT_MISSING: 'init script yok',
  IP_UNUSED: 'boşta IP',
  // EK-6.13: assess.cjs'in urettigi kalan kodlar (bekci: kaynaktaki her add(..., 'KOD') etiketli).
  // Olculmus durumlar olculmus diye, olculemeyenler "bilinmiyor" diye yazilir (kural 6).
  HOST_RESTART: 'JBoss host controller restart/reload bekliyor (restart-required / reload-required)',
  RESTART_REQUIRED: "JVM restart/reload bekliyor — runtime'da etkin olmayan yapılandırma değişikliği var",
  INIT_DIFF: 'init script filo çoğunluğundan farklı',
  INIT_HOST_SPECIFIC: 'sunucuya özel init dosyası çoğunluktan farklı — beklenen durum, uyumsuzluk sayılmaz',
  INV_MISMATCH: 'JVM envanteri (MWAppsInventory) ile tarama çelişiyor (çalışma durumu ya da auto-start)',
  STOPPED: 'JVM kapalı, auto-start kapalı; web katmanı eşlenemedi — trafiği bilinmiyor, retire önerilmez',
  NOT_RUNNING: 'web sunucusu çalışmıyor (süreç listesinde görülmedi) ama vhost tanımları var',
  VHOST_IDLE: "JVM'e eşlenmemiş vhost'a 7 gündür istek yok (access log okundu)",
  PRODUCT_NOT_IN_INVENTORY: 'taramada bulunan ürün envanterde (dbo.Inventory) yok',
  SSH_SESSIONS_NEAR: 'sshd açık oturum sayısı MaxSessions sınırına yakın (mux_client_request_session riski)',
  SSH_MAXSESSIONS_LOW: 'sshd MaxSessions düşük (10 ya da altı, varsayılan) — Ansible delegate/forks ile tıkanabilir',
  SCAN_COST: "tarama 10 sn'den fazla CPU harcadı",
};

/** "KOD — anlami"; etiketsiz kod oldugu gibi. */
function kodEtiketi(code: string): string {
  const e = KOD_ETIKET[code];
  return e ? `${code} — ${e}` : code;
}

/**
 * Acilis hazirligi sebep satiri: sunucunun aciklamasi; bossa ekran etiketi; o da yoksa kod.
 * SCHEMA_UNKNOWN / STALE_EVIDENCE gibi hazirlik kodlari ham kod olarak basilmasin diye.
 */
function hazirlikSebebi(r: { code: string; aciklama?: string | null }): string {
  return String(r.aciklama || '').trim() || KOD_ETIKET[r.code] || r.code;
}

/**
 * summary.jvm.autoUnknownBy anahtarlari (assess AUTOSTART_SEBEP). "Bilinmiyor" hicbirinde
 * "KAPALI" demek DEGILDIR. tanimsiz-surec (T2-C2): tanim kaynagi OKUNDU, bu JVM orada yok -
 * "CLI cevap vermedi" DEGIL.
 */
const AUTOSTART_SEBEP_ETIKET: Record<string, string> = {
  'cli-okunamadi': 'CLI cevap vermedi',
  'envanterde-yok': 'envanterde alan boş',
  'envanter-celiskili': 'envanter çelişkili',
  'tanimsiz-surec': "JVM tanımda yok (ps'te tanımsız süreç)",
};

/** autoUnknownBy kirilimi; etiketi olmayan (yeni) anahtar DUSURULMEZ, ham adiyla yazilir. */
function autoBilinmiyorKirilimi(by: Record<string, number> | null | undefined): string {
  if (!by || typeof by !== 'object') return '';
  const bilinen = Object.keys(AUTOSTART_SEBEP_ETIKET);
  const sira = [...bilinen, ...Object.keys(by).filter((k) => !bilinen.includes(k)).sort()];
  return sira
    .filter((k) => sayiMi(by[k]) && by[k] > 0)
    .map((k) => `${AUTOSTART_SEBEP_ETIKET[k] || k}: ${by[k]}`)
    .join(' · ');
}

/**
 * Tarama isinin yukleyici sonucu (server_hub_scan_result.loader = LOADER_RESULT json'u).
 * Sonuc YOKSA "hepsi yazildi" DENMEZ: kac sunucunun yazildigi bilinmiyordur.
 */
function yukleyiciOzeti(result: unknown): { satirlar: string[]; sorun: boolean } {
  let ld: unknown = result && typeof result === 'object' ? (result as { loader?: unknown }).loader : null;
  if (typeof ld === 'string') {
    try {
      ld = JSON.parse(ld);
    } catch {
      ld = null;
    }
  }
  const o = (ld && typeof ld === 'object' ? ld : {}) as {
    hosts_total?: number;
    hosts_written?: number;
    hosts_excluded?: number;
    hosts_not_attempted?: number;
    excluded?: { host?: string; issue?: string }[];
  };
  if (!sayiMi(o.hosts_total) && !sayiMi(o.hosts_written) && !sayiMi(o.hosts_excluded))
    return {
      satirlar: ['Yükleyici sonucu okunamadı — kaç sunucunun veritabanına yazıldığı bilinmiyor.'],
      sorun: true,
    };
  const satirlar: string[] = [];
  if (sayiMi(o.hosts_written) && sayiMi(o.hosts_total))
    satirlar.push(`${o.hosts_written}/${o.hosts_total} sunucu yazıldı`);
  const ex = sayiMi(o.hosts_excluded) ? o.hosts_excluded : 0;
  const na = sayiMi(o.hosts_not_attempted) ? o.hosts_not_attempted : 0;
  if (ex > 0) {
    const liste = Array.isArray(o.excluded) ? o.excluded : [];
    const sebep = liste
      .slice(0, 5)
      .map((x) => `${x.host || '?'}: ${x.issue || '?'}`)
      .join(', ');
    satirlar.push(
      `${ex} sunucu yazılamadı (${sebep || 'sebep bildirilmedi'}${liste.length > 5 ? ` +${liste.length - 5}` : ''}) — bu sunucularda önceki tarama gösterilir`,
    );
  }
  if (na > 0)
    satirlar.push(
      `${na} sunucu denenmedi (NOT_ATTEMPTED — yükleyici veritabanı hatasında durdu)`,
    );
  return { satirlar, sorun: ex > 0 || na > 0 };
}

/** EK-2 kirmizi bant metni; bayat degilse null. */
function bayatFiloMetni(sf: ShStaleFleet | undefined): string | null {
  if (!sf) return null;
  return sayiMi(sf.ageDays)
    ? `Son başarılı yükleme ${sf.ageDays} gün önce — eylemler kapalı`
    : 'Son başarılı yükleme zamanı bilinmiyor — eylemler kapalı';
}

function BayatFiloBandi({ sf }: { sf: ShStaleFleet | undefined }) {
  const metin = bayatFiloMetni(sf);
  if (!metin) return null;
  return (
    <div
      role="alert"
      className="rounded-xl border px-4 py-2.5 text-[12px] font-semibold"
      style={{
        borderColor: 'var(--status-danger)',
        background: 'var(--status-danger-bg)',
        color: 'var(--status-danger)',
      }}
      title="Tarama verisi bayat: düzeltme eylemleri sunucuda kapatıldı (bayat kanıtla satır yorumlanmaz, JVM emekliye ayrılmaz). Açılış hazırlığı bu sunucular için 'bilinmiyor' der."
    >
      {metin}
      {sf?.lastLoad ? (
        <span className="ml-2 font-normal">(son yükleme {fmtDate(sf.lastLoad)})</span>
      ) : null}
    </div>
  );
}

/**
 * EK-1 geri alma bandi metni. Yalniz sunucu ACIKCA allowed=false dediginde metin doner; alan
 * yoksa (eski Portal yaniti) ya da allowed=true ise null. Sunucunun mesaji oldugu gibi basilir,
 * mesaj bossa v3Hosts'tan kurulur. schemaUnknown (C3): v3 sayimi YAPILAMADI - "N sunucu yeni
 * tarayicidan" denmez (bilinmiyor), sebep sema okunamamasidir.
 */
function geriAlmaMetni(rb: ShRollback | null | undefined): string | null {
  if (!rb || rb.allowed !== false) return null;
  const ayrinti =
    (rb.message || '').trim() ||
    (rb.schemaUnknown === true
      ? 'Server Hub şeması okunamadı — kaç sunucunun yeni tarayıcıdan tarandığı bilinmiyor; Portal eski sürüme geri alınmamalı'
      : `${sayiMi(rb.v3Hosts) ? rb.v3Hosts : 'Bazı'} sunucunun son taraması yeni tarayıcıdan (scan_ver dolu) — Portal eski sürüme geri alınmamalı`);
  return `Portal'ı geri almadan önce: ${ayrinti}`;
}

/**
 * C3 SEMA BILINMIYOR bandi: sys.columns okunamadi -> sunucu TUM eylemleri kapatti, running_src /
 * vhost_trust / scan_errors secilemedi. /overview, /findings ve sunucu ayrintisi schemaUnknown
 * tasir; alan yoksa (eski yanit) ya da false ise bant yok.
 */
const SEMA_ACIKLAMA =
  "Server Hub tablolarının kolon listesi (sys.columns) okunamadı: verinin hangi tarayıcı sürümünden geldiği ve v3 kanıtları (running_src, vhost_trust, scan_errors) seçilemedi. Düzeltme eylemleri sunucuda kapatıldı; çalışma durumu kanıtsız satırlar 'bilinmiyor (şema okunamadı)' gösterilir — süreç görünürlüğü (hidepid) ile ilgisi yok. Sayfayı yenileyin.";
function semaBilinmiyorMetni(su: boolean | null | undefined): string | null {
  return su === true ? 'Tarayıcı şema sürümü bilinmiyor; eylemler kapalı' : null;
}
function SemaBandi({ su }: { su: boolean | null | undefined }) {
  const metin = semaBilinmiyorMetni(su);
  if (!metin) return null;
  return (
    <div
      role="alert"
      className="rounded-xl border px-4 py-2.5 text-[12px] font-semibold"
      style={{
        borderColor: 'var(--status-danger)',
        background: 'var(--status-danger-bg)',
        color: 'var(--status-danger)',
      }}
      title={SEMA_ACIKLAMA}
    >
      {metin}
    </div>
  );
}

/**
 * C4 rozeti: yukleyici proxy hedef listesini kesti (~); kesilen kisimdaki sunucu:port bilinmez.
 * EK-6.9: kesik liste katmandaki durmus JVM'in retire'ini JVM'in port bilgisinden (otoriter
 * cfg_ports dahil) BAGIMSIZ olarak engeller; aciklama engeli "portu bilinmeyen" ile daraltmaz.
 */
function hedefKesikRozeti(kesik: boolean | null | undefined): { metin: string; aciklama: string } | null {
  if (kesik !== true) return null;
  return {
    metin: 'hedef listesi kesik',
    aciklama:
      "Proxy hedef listesi yükleyicide kesildi (~): kesilen kısımda hangi sunucu:port olduğu bilinmiyor. Kesilen kısımdaki hedef bilinmediği için katmandaki durmuş JVM'lere (port bilgisinden bağımsız) retire önerilmez.",
  };
}
function HedefKesikRozeti({ kesik }: { kesik: boolean | null | undefined }) {
  const r = hedefKesikRozeti(kesik);
  if (!r) return null;
  return (
    <span
      className="mt-0.5 inline-flex px-1.5 py-0.5 rounded-full border font-sans text-[9px] font-semibold whitespace-nowrap"
      style={{ color: SEV.warning.color, borderColor: SEV.warning.color }}
      title={r.aciklama}
    >
      {r.metin}
    </span>
  );
}

/**
 * Tur 4 (EK-7.4/7.5) rozeti: vhosts[].targetsDynamic - proxy_targets '~DYNAMIC'. Trafik conf'ta
 * hedef kaydi birakmayan bir mekanizmayla tasiniyor ya da vhost conf'u okunamadi / blogu
 * bulunamadi: hedef bilinmez. "Proxy yok" DEGIL; kesik liste de degil (liste tam, hedef yok).
 */
function dinamikProxyRozeti(dinamik: boolean | null | undefined): { metin: string; aciklama: string } | null {
  if (dinamik !== true) return null;
  return {
    metin: 'dinamik proxy',
    aciklama:
      "Bu vhost'un trafiği conf'ta hedef kaydı bırakmayan bir mekanizmayla (RewriteRule [P], JkMount, Include, mod_proxy_cluster, fastcgi/uwsgi/grpc_pass) taşınıyor ya da vhost conf'u okunamadığı / bloğu bulunamadığı için hedefleri görülmedi (~DYNAMIC). Hedef bilinmediği için trafiği varsa ya da ölçülemediyse katmandaki durmuş JVM'lere (port bilgisinden bağımsız) retire önerilmez.",
  };
}
function DinamikProxyRozeti({ dinamik }: { dinamik: boolean | null | undefined }) {
  const r = dinamikProxyRozeti(dinamik);
  if (!r) return null;
  return (
    <span
      className="mt-0.5 inline-flex px-1.5 py-0.5 rounded-full border font-sans text-[9px] font-semibold whitespace-nowrap"
      style={{ color: SEV.warning.color, borderColor: SEV.warning.color }}
      title={r.aciklama}
    >
      {r.metin}
    </span>
  );
}

/**
 * EK-3 unattributed[].kind -> ekran etiketi. Bilinmeyen tur ham adiyla yazilir. HEDEF genel
 * etikettir ("hedefi bilinmeyen proxy"); NEDENI (EK-7.5 reason) ATF_NEDEN'den eklenir. Eski
 * etiket "hedef hicbir sunucuya cozulemedi" JVMSIZ / TARANMAMIS / DINAMIK icin yanlis kok
 * nedendi (o hedefler bir sunucuya cozuldu ya da hic hedef kaydi yok).
 */
const ATF_TUR: Record<string, string> = {
  PORT: "port hiçbir JVM'e ait değil",
  HEDEF: 'hedefi bilinmeyen proxy',
  EKSIK: 'hedef listesi kesik',
};
/** EK-7.5 unattributed[].reason (yalniz HEDEF) -> ekran etiketi; assess metniyle ayni kok neden. */
const ATF_NEDEN: Record<string, string> = {
  COZULEMEDI: 'hedef hiçbir sunucuya çözülemedi (balancer / VIP / DNS adı)',
  DINAMIK: 'dinamik proxy — hedef kaydı yok',
  JVMSIZ: 'hedef sunucuda JVM ya da bu portu dinleyen ölçülmüş vhost yok',
  TARANMAMIS: 'hedef sunucu taranmamış',
  CONF_OKUNAMADI: "vhost conf'u okunamadı — hedefleri görülmedi",
};
/** TRAFFIC_UNATTRIBUTED ekindeki tek kayit: nereden -> nereye · tur (neden) · trafik. */
function atfedilemeyenSatiri(x: ShUnattributed): string {
  const kind = String(x.kind || '');
  const tur0 = ATF_TUR[kind] || `tür: ${kind || '—'}`;
  const nd = kind === 'HEDEF' && x.reason ? ATF_NEDEN[x.reason] || `neden: ${x.reason}` : '';
  const tur = nd ? `${tur0} (${nd})` : tur0;
  const hedef =
    kind === 'EKSIK'
      ? '~ (kesilen kısım bilinmiyor)'
      : kind === 'PORT'
        ? `:${x.port ?? '?'}`
        : `${x.target || '?'}${x.target && x.port != null && !String(x.target).endsWith(`:${x.port}`) ? ` (:${x.port})` : ''}`;
  const trafik =
    x.trafficState || (sayiMi(x.req7d) && x.req7d > 0 ? `7g ${x.req7d}` : 'trafik ölçülemedi');
  return `${x.host || '?'}/${x.serverName || '?'} → ${hedef} · ${tur} · ${trafik}`;
}
/** Bulgunun ayrinti paneli: atfedilemeyen proxy kayitlari (kind + target). */
function AtfedilemeyenTrafik({ f }: { f: ShFinding }) {
  const liste = Array.isArray(f.unattributed) ? f.unattributed : [];
  if (!liste.length) return null;
  return (
    <details className="mt-1">
      <summary
        className="text-[10px] cursor-pointer select-none"
        style={{ color: 'var(--text-muted)' }}
      >
        Atfedilemeyen proxy: {liste.length}
      </summary>
      <ul className="mt-1 space-y-0.5">
        {liste.map((x, i) => (
          <li
            key={i}
            className="text-[10px] font-mono break-all"
            style={{ color: 'var(--text-secondary)' }}
          >
            {atfedilemeyenSatiri(x)}
          </li>
        ))}
      </ul>
    </details>
  );
}

function GeriAlmaBandi({ rb }: { rb: ShRollback | null | undefined }) {
  const metin = geriAlmaMetni(rb);
  if (!metin) return null;
  return (
    <div
      role="note"
      className="rounded-xl border px-4 py-1.5 text-[11px] truncate"
      style={{
        borderColor: 'var(--status-warning)',
        background: 'var(--status-warning-bg)',
        color: 'var(--text-secondary)',
      }}
      title={metin}
    >
      {metin}
    </div>
  );
}

// ── Grafik parcalari (SVG; kutuphane yok) ──────────────────────────────────────────
function Donut({
  parts,
  size = 112,
  label,
  sub,
}: {
  parts: { value: number; color: string; title: string }[];
  size?: number;
  label: React.ReactNode;
  sub?: string;
}) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const r = 40,
    c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex items-center gap-3">
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        role="img"
        aria-label={typeof label === 'string' ? label : undefined}
      >
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--bg-elevated)" strokeWidth="12" />
        {parts
          .filter((p) => p.value > 0)
          .map((p, i) => {
            const len = (p.value / total) * c;
            const el = (
              <circle
                key={i}
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke={p.color}
                strokeWidth="12"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-acc}
                transform="rotate(-90 50 50)"
              >
                <title>
                  {p.title}: {p.value}
                </title>
              </circle>
            );
            acc += len;
            return el;
          })}
        <text
          x="50"
          y="47"
          textAnchor="middle"
          fontSize="18"
          fontWeight="700"
          fill="var(--text-primary)"
        >
          {typeof label === 'string' ? label : ''}
        </text>
        {sub && (
          <text x="50" y="62" textAnchor="middle" fontSize="8" fill="var(--text-muted)">
            {sub}
          </text>
        )}
      </svg>
      <ul className="text-[11px] space-y-0.5">
        {parts.map((p, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />{' '}
            <span style={{ color: 'var(--text-secondary)' }}>{p.title}</span>{' '}
            <b className="tabular-nums">{nf(p.value)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Bar({
  value,
  total,
  color = 'var(--accent)',
  title,
}: {
  value: number;
  total: number;
  color?: string;
  title?: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div
      className="h-2 rounded-full overflow-hidden"
      style={{ background: 'var(--bg-elevated)' }}
      title={title || `${value}/${total} (%${pct})`}
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${pct}%`, background: color, transition: 'width .3s' }}
      />
    </div>
  );
}

function Kpi({
  title,
  children,
  tone,
  onClick,
}: {
  title: string;
  children: React.ReactNode;
  tone?: ShSeverity;
  onClick?: () => void;
}) {
  return (
    <section
      className={`rounded-xl border p-4 ${onClick ? 'cursor-pointer hover:shadow-sm' : ''}`}
      style={{
        borderColor: tone && tone !== 'ok' ? SEV[tone].color : 'var(--border-subtle)',
        background: 'var(--bg-surface)',
      }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      title={onClick ? 'Bulgu detayını aç' : undefined}
    >
      <h3
        className="text-[11px] font-semibold uppercase tracking-wide mb-2 truncate"
        style={{ color: 'var(--text-muted)' }}
        title={title}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

// Kapsama tablosunun satiri. MODUL DUZEYINDE (2026-10-03): eskiden KapsamaPaneli'nin
// render'i icinde tanimliydi; her render'da YENI bir bilesen turu olusuyor, React tum
// satirlari sokup yeniden kuruyordu (react-hooks/static-components).
function KapsamaSatiri({
  ad,
  env,
  tar,
  eksikHosts,
  birim = 'sunucu',
  envBilinmiyor = false,
}: {
  ad: string;
  env: number;
  tar: number;
  eksikHosts?: string[];
  birim?: string;
  /** Envanterde bu ürünün sütunu YOK — sayı 0 değil, BİLİNMİYOR. */
  envBilinmiyor?: boolean;
}) {
  // "SUTUN YOK" ILE "ENVANTERDE YOK" AYRI: ikisini 0 diye gostermek, envanterde hic
  // kayit olmadigi izlenimi verir ve kapsama yuzdesi uydurma olur.
  if (envBilinmiyor)
    return (
      <tr className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
        <td className="px-2.5 py-1.5 font-semibold">{ad}</td>
        <td
          className="px-2.5 py-1.5 text-right"
          colSpan={2}
          style={{ color: SEV.warning.color }}
          title="dbo.Inventory'de bu ürünün sürüm sütunu yok — envanter tarafı ölçülemiyor."
        >
          envanter sütunu yok
        </td>
        <td className="px-2.5 py-1.5 text-right" style={{ color: 'var(--text-muted)' }}>
          —
        </td>
        <td className="px-2.5 py-1.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>
          taramada {fmtNumber(tar)}
        </td>
      </tr>
    );
  const p = env > 0 ? Math.round((tar / env) * 100) : 0;
  // RENK OLCUTU KAPSAMA: %100 yesil, %90+ sari, altinda kirmizi. Dusuk kapsama bir
  // "bulgu yok" degil, "bakamadik" demektir.
  const renk = env === 0 ? 'var(--status-neutral)' : p >= 100 ? SEV.ok.color : p >= 90 ? SEV.warning.color : SEV.danger.color;
  return (
    <tr className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
      <td className="px-2.5 py-1.5 font-semibold">{ad}</td>
      <td className="px-2.5 py-1.5 text-right tabular-nums">{fmtNumber(env)}</td>
      <td className="px-2.5 py-1.5 text-right tabular-nums" style={{ color: renk, fontWeight: 600 }}>
        {fmtNumber(tar)}
      </td>
      <td className="px-2.5 py-1.5 text-right tabular-nums" style={{ color: renk }}>
        %{p}
      </td>
      <td
        className="px-2.5 py-1.5 text-right tabular-nums"
        style={{ color: env - tar > 0 ? SEV.danger.color : 'var(--text-muted)' }}
        title={
          eksikHosts && eksikHosts.length
            ? `Erişilemeyen (ilk ${eksikHosts.length}): ${eksikHosts.join(', ')}`
            : undefined
        }
      >
        {env - tar > 0 ? `${fmtNumber(env - tar)} ${birim}` : '—'}
      </td>
    </tr>
  );
}

/**
 * Envanter <-> tarama kapsamasi.
 *
 * IKI KAYNAK AYRI TUTULUR: envanter `dbo.Inventory` (urun sutunlari) ve
 * `dbo.MWAppsInventory` (JVM sayisi); tarama ise `Server_Hub_*` tablolari. Biri otekini
 * DUZELTMEZ - aradaki fark bilgidir ve gosterilmesi gereken sey tam olarak odur.
 */
function KapsamaPaneli({ c }: { c: NonNullable<ShOverview['summary']>['scanCoverage'] }) {
  if (!c) return null;
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)' }}>
      <div
        className="px-3 py-2 text-[12px] font-semibold border-b"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}
      >
        Kapsama — envanterde ne var, tarama neye erişebildi
        <span className="ml-2 font-normal" style={{ color: 'var(--text-muted)' }}>
          aşağıdaki tüm sayılar yalnız <b>taranan</b> sunuculardan hesaplanır
        </span>
      </div>
      <table className="w-full text-xs border-collapse">
        <thead style={{ background: 'var(--bg-surface)' }}>
          <tr style={{ color: 'var(--text-muted)' }}>
            <th className="px-2.5 py-1.5 text-left text-[11px] font-semibold">Kapsam</th>
            <th className="px-2.5 py-1.5 text-right text-[11px] font-semibold">Envanter</th>
            <th className="px-2.5 py-1.5 text-right text-[11px] font-semibold">Veri çekilen</th>
            <th className="px-2.5 py-1.5 text-right text-[11px] font-semibold">Kapsama</th>
            <th className="px-2.5 py-1.5 text-right text-[11px] font-semibold">Erişilemeyen</th>
          </tr>
        </thead>
        <tbody>
          <KapsamaSatiri ad="Sunucu (tümü)" env={c.hosts.inventory} tar={c.hosts.scanned} />
          <KapsamaSatiri ad="JBoss" env={c.products.JBOSS.inventory} tar={c.products.JBOSS.scanned} eksikHosts={c.products.JBOSS.missingHosts} envBilinmiyor={c.products.JBOSS.inventoryUnknown} />
          <KapsamaSatiri ad="JVM" env={c.jvm.inventory} tar={c.jvm.scanned} birim="JVM" />
          <KapsamaSatiri ad="Red Hat Apache" env={c.products.RHA.inventory} tar={c.products.RHA.scanned} eksikHosts={c.products.RHA.missingHosts} envBilinmiyor={c.products.RHA.inventoryUnknown} />
          <KapsamaSatiri ad="IBM HTTP Server" env={c.products.IHS.inventory} tar={c.products.IHS.scanned} eksikHosts={c.products.IHS.missingHosts} envBilinmiyor={c.products.IHS.inventoryUnknown} />
          <KapsamaSatiri ad="Nginx" env={c.products.NGINX.inventory} tar={c.products.NGINX.scanned} eksikHosts={c.products.NGINX.missingHosts} envBilinmiyor={c.products.NGINX.inventoryUnknown} />
        </tbody>
      </table>
      <div className="px-3 py-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
        {/* ENVANTERDE OLMAYAN AMA TARAMADA CIKAN: envanterin eksik oldugunu gosterir,
            gizlenmemeli - "kapsama %100" yazip envanteri kusursuz sanmak yaniltici olurdu. */}
        {c.hosts.scannedNotInInventory > 0 && (
          <>
            {c.hosts.scannedNotInInventory} sunucu taramada çıktı ama <b>envanterde yok</b> —
            envanter eksik olabilir.{' '}
          </>
        )}
        {c.jvm.fromInventory > 0 && (
          <>
            {c.jvm.fromInventory} JVM’in bilgisi sunucudan okunamadı, <b>envanterden</b>{' '}
            tamamlandı — &quot;veri çekilen&quot; sayısına dahil değil.
          </>
        )}
      </div>
    </div>
  );
}

/**
 * "Bu sunucular sorunsuz acilir mi?" — kullanici (2026-10-01): "sunucu listesi verdigimde
 * ... bana bir executive summary gibi vermeni istiyorum."
 *
 * SORU "SORUN VAR MI" DEGIL, "YENIDEN BASLATSAM GERI GELIR MI". Server Hub bulgularinin
 * cogu (atil vhost, SSH tavani, envanter uyusmazligi) yeniden baslatmayi etkilemez ve
 * ozeti kalabaliklastirirdi; yalniz ilgili olanlar siniflanir.
 *
 * TARANMAMIS SUNUCU "HAZIR" SAYILMAZ - ayri kova. Onu yesil saymak, bu raporun
 * verebilecegi en pahali yanlis olurdu.
 */
function ReadinessTab() {
  const [metin, setMetin] = useState('');
  const [r, setR] = useState<ShReadiness | null>(null);
  const [busy, setBusy] = useState(false);

  const calistir = async () => {
    if (!metin.trim()) return;
    setBusy(true);
    try {
      const cevap = await serverHubApi.rebootReadiness(metin);
      if (!cevap.ok) toast.error(cevap.message || 'Rapor alınamadı.');
      setR(cevap.ok ? cevap : null);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const K: Record<string, { label: string; color: string; aciklama: string }> = {
    blocked: { label: 'AÇILMAZ', color: SEV.danger.color, aciklama: 'yeniden başlatınca servis gelmez' },
    unknown: { label: 'BİLİNMİYOR', color: SEV.warning.color, aciklama: 'ölçülemedi — "sorun yok" demek değil' },
    risk: { label: 'DİKKAT', color: SEV.info.color, aciklama: 'açılır ama sürpriz var' },
    ok: { label: 'HAZIR', color: SEV.ok.color, aciklama: 'bilinen engel yok' },
    notScanned: { label: 'TARANMADI', color: 'var(--status-neutral)', aciklama: 'bu sunucu taramada yok' },
  };
  const s = r?.summary;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="text-xs font-semibold">Sunucu listesi</div>
        <textarea
          value={metin}
          onChange={(e) => setMetin(e.target.value)}
          rows={3}
          placeholder="GBAPP01, GBAPP02 … (virgül, boşluk ya da satır ile ayırın; FQDN de olur)"
          className="w-full px-2 py-1.5 text-xs font-mono border rounded-lg"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
        />
        <div className="flex items-center gap-2">
          <button onClick={calistir} disabled={busy || !metin.trim()} className={SM_BTN} style={smBtn(true)}>
            {busy ? 'Bakılıyor…' : 'Açılır mı?'}
          </button>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            Salt okunur — hiçbir iş başlatmaz. Son taramanın verisine bakar
            {r?.latestScan ? ` (${r.latestScan})` : ''}.
          </span>
        </div>
      </div>

      {s && (
        <>
          <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="text-sm">
              <b>{s.requested}</b> sunucu soruldu.{' '}
              {s.blocked > 0 ? (
                <b style={{ color: SEV.danger.color }}>
                  {s.blocked} tanesi şu an yeniden başlatılırsa sorunsuz açılmaz.{' '}
                </b>
              ) : (
                <>Bilinen bir açılış engeli <b>yok</b>. </>
              )}
              {s.unknown > 0 && (
                <>
                  <b style={{ color: SEV.warning.color }}>{s.unknown} sunucuda ölçüm yapılamadı</b> —
                  bunlar için güvence verilemez.{' '}
                </>
              )}
              {s.notScanned > 0 && (
                <>
                  <b>{s.notScanned} sunucu hiç taranmamış</b>; listede duruyor ama hakkında bir şey
                  söylenemez.{' '}
                </>
              )}
              {s.risk > 0 && <>{s.risk} sunucuda açılışta sürpriz var (durdurulmuş JVM kalkar gibi).</>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(['blocked', 'unknown', 'risk', 'ok', 'notScanned'] as const).map((k) => (
                <span
                  key={k}
                  className="px-2 py-0.5 text-[11px] rounded-full border"
                  title={K[k].aciklama}
                  style={{ borderColor: K[k].color, color: K[k].color }}
                >
                  {K[k].label} {s[k]}
                </span>
              ))}
            </div>
          </div>

          {!!r?.topReasons?.length && (
            <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="text-xs font-semibold mb-1">Sebepler</div>
              {r.topReasons.map((t) => (
                <div key={t.code} className="text-[11px] py-0.5" title={kodEtiketi(t.code)}>
                  <span
                    style={{
                      color:
                        t.tip === 'blocker'
                          ? SEV.danger.color
                          : t.tip === 'unknown'
                            ? SEV.warning.color
                            : SEV.info.color,
                    }}
                  >
                    ●
                  </span>{' '}
                  {hazirlikSebebi(t)} — <b>{t.hostCount}</b> sunucu
                  <span className="ml-1 font-mono" style={{ color: 'var(--text-muted)' }}>
                    {t.hosts.slice(0, 8).join(', ')}
                    {t.hostCount > 8 ? ` +${t.hostCount - 8}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)' }}>
            <table className="w-full text-xs border-collapse">
              <thead style={{ background: 'var(--bg-elevated)' }}>
                <tr style={{ color: 'var(--text-muted)' }}>
                  {['Sunucu', 'Sonuç', 'Sebep'].map((h) => (
                    <th key={h} className="px-2.5 py-1.5 text-left text-[11px] font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(r?.rows || []).map((x) => (
                  <tr key={x.host} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-2.5 py-1.5 font-mono font-semibold">{x.host}</td>
                    <td
                      className="px-2.5 py-1.5 font-semibold"
                      style={{ color: K[x.verdict].color }}
                      title={K[x.verdict].aciklama}
                    >
                      {K[x.verdict].label}
                    </td>
                    <td className="px-2.5 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                      {x.note || x.reasons.map((y) => hazirlikSebebi(y)).join(' · ') || 'bilinen engel yok'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function SevPill({ s, n }: { s: ShSeverity; n?: number }) {
  const t = SEV[s];
  const I = t.icon;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap"
      style={{ color: t.color, background: t.bg, borderColor: t.color }}
    >
      <I className="w-3 h-3" />
      {t.label}
      {n != null ? ` · ${n}` : ''}
    </span>
  );
}

// ── Sayfa ────────────────────────────────────────────────────────────────────────────
export default function ServerHubPage() {
  // Sekmeler: Sunucular (tarama raporu) | Retirement (uygulama emeklilik akisi, 2026-09-21)
  const [tab, setTab] = useState<'hosts' | 'findings' | 'readiness' | 'retirement'>('hosts');
  // Kartlardan bulgu detayina gecis (kullanici, 2026-09-22): kart -> Bulgular sekmesi + hazir suzgec
  const [findingsFilter, setFindingsFilter] = useState<{
    area?: string;
    code?: string;
    product?: string;
    envGroup?: string;
  } | null>(null);
  const goFindings = (f: { area?: string; code?: string; product?: string; envGroup?: string }) => {
    setFindingsFilter(f);
    setTab('findings');
  };
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ServerStackIcon className="w-6 h-6" style={{ color: 'var(--accent)' }} />{' '}
            <span className="nginx-hub-label">
              <span>Server</span>{' '}
              <span
                className="nginx-hub-word"
                style={{ color: 'var(--accent)', textShadow: 'none', animation: 'none' }}
              >
                Hub
              </span>
            </span>
          </h1>
          <p className="text-sm mt-0.5 max-w-4xl" style={{ color: 'var(--text-muted)' }}>
            {tab === 'hosts'
              ? 'Reboot sonrası her şey doğru açılacak mı, sunucularda atıl bir şey var mı? Günlük tarama: init script referans uyumu, JBoss 7/8 JVM’leri (auto-start, kapalı, restart-required), RHA/IHS/Nginx syntax ve vhost yükü (hc.html/hc.jsp hariç), boşta IP, sshd sınırları.'
              : 'Uygulama retirement: Smart silme kaydı → tüm ortam/site keşfi → STOP (auto-start kapat, durdur, paketi .old) → seçilen tarihte silme → IP/LB/DNS kayıtları.'}
          </p>
        </div>
        <div className="flex gap-1 rounded-lg p-0.5" style={{ background: 'var(--bg-elevated)' }}>
          {(
            [
              { id: 'hosts', label: 'Sunucular' },
              { id: 'findings', label: 'Bulgular' },
              { id: 'readiness', label: 'Açılış Hazırlığı' },
              { id: 'retirement', label: 'Retirement' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${tab === t.id ? 'shadow-sm' : ''}`}
              style={{
                background: tab === t.id ? 'var(--bg-surface)' : 'transparent',
                color: tab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'hosts' && <HostsTab onGoFindings={goFindings} />}
      {tab === 'findings' && <FindingsTab initial={findingsFilter} />}
      {tab === 'readiness' && <ReadinessTab />}
      {tab === 'retirement' && <RetirementTab />}
    </div>
  );
}

function HostsTab({
  onGoFindings,
}: {
  onGoFindings: (f: { area?: string; code?: string; product?: string; envGroup?: string }) => void;
}) {
  const { addJob } = useJobTracker();
  const [data, setData] = useState<ShOverviewV3 | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  // Son tarama isinin yukleyici sonucu (D1-U04/U09): toast gecicidir, bant kalici.
  const [yukleme, setYukleme] = useState<{ baslik: string; satirlar: string[]; sorun: boolean } | null>(
    null,
  );
  const [q, setQ] = useState('');
  const [sev, setSev] = useState<'all' | ShSeverity>('all');
  const [product, setProduct] = useState('all');
  // GBEVM*/GBPRV* genel envanterden ayri (kullanici, 2026-09-24): ozet ve varsayilan liste
  // GENEL envanteri gosterir, bu sunucular kendi sekmelerinde listelenir.
  const [cls, setCls] = useState<'genel' | 'ozel'>('genel');
  const [openHost, setOpenHost] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const r = await serverHubApi.overview(fresh);
      if (r.ok) {
        setData(r as ShOverviewV3);
        setErr('');
      } else setErr(r.message || 'Veri alınamadı.');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  function trackJob(
    title: string,
    r: { jobId: number | null; awxServerId: number },
    onDone?: (status: string, result: unknown) => void,
  ) {
    if (r.jobId == null) return;
    let done = false;
    addJob({
      title,
      fetchStatus: async () => {
        const s = await serverHubApi.jobStatus(r.awxServerId, r.jobId as number);
        if (!s.ok) throw new Error(s.message || 'Durum okunamadı.');
        if (TERMINAL.has(s.status) && !done) {
          done = true;
          onDone?.(s.status, s.result);
        }
        return { status: s.status, output: s.output || '', result: s.result };
      },
    });
  }

  const scanNow = async (hosts: string[]) => {
    setBusy('scan');
    try {
      const r = await serverHubApi.scan(hosts);
      if (!r.ok) {
        toast.error(r.message || 'Tarama başlatılamadı.');
        return;
      }
      toast.success(`Tarama başladı (iş #${r.jobId}). Bitince liste yenilenir.`);
      const baslik = `Tarama #${r.jobId} (${hosts.length === 1 ? hosts[0] : hosts.length + ' sunucu'})`;
      trackJob(
        `Server Hub: tara ${hosts.length === 1 ? hosts[0] : hosts.length + ' sunucu'}`,
        r,
        (status, result) => {
          // YUKLEYICI SONUCU GORUNUR (D1-U04/U09): dislanan sunucu "yazildi" sanilmasin;
          // NOT_ATTEMPTED yukleyicinin durdugunu gosterir. Sonuc yoksa "bilinmiyor" denir.
          const oz = yukleyiciOzeti(result);
          setYukleme({ baslik: `${baslik}: ${status}`, ...oz });
          if (oz.sorun) toast.warning(`${baslik}: ${oz.satirlar.join(' · ')}`);
          load(true);
        },
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const products = useMemo(() => {
    const s = new Set<string>();
    for (const h of data?.hosts || []) h.products.forEach((p) => s.add(p));
    return [...s].sort();
  }, [data]);
  const rows = useMemo(() => {
    const needle = q.trim().toUpperCase();
    return (data?.hosts || []).filter(
      (h) =>
        (h.hostClass || 'genel') === cls &&
        (sev === 'all' || h.status === sev) &&
        (product === 'all' || h.products.includes(product)) &&
        (!needle || h.host.includes(needle) || (h.topFinding || '').toUpperCase().includes(needle)),
    );
  }, [data, q, sev, product, cls]);
  const clsCounts = useMemo(() => {
    const all = data?.hosts || [];
    return {
      genel: all.filter((h) => (h.hostClass || 'genel') === 'genel').length,
      ozel: all.filter((h) => h.hostClass === 'ozel').length,
    };
  }, [data]);

  if (loading && !data) return <LoadingLogo compact />;
  if (err)
    return (
      <div
        className="text-sm rounded-xl px-3 py-2 border"
        style={{
          color: 'var(--status-danger)',
          background: 'var(--status-danger-bg)',
          borderColor: 'var(--status-danger)',
        }}
      >
        {err}
      </div>
    );
  if (!data) return null;
  const s = data.summary;
  // C3: sema okunamadiysa olculemeyen sayaclarin sebebi hidepid DEGIL sema (kart basliklari).
  const sema = data.schemaUnknown === true;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          Son tarama: <b>{data.latestScan ? fmtDate(data.latestScan) : '—'}</b>
        </span>
        <button onClick={() => load(true)} className={SM_BTN} style={smBtn()}>
          <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile
        </button>
      </div>

      {/* EK-2: son basarili yukleme bayatsa KIRMIZI bant - sunucu tum fix eylemlerini kapatir. */}
      <BayatFiloBandi sf={data.staleFleet} />
      {/* C3: sys.columns okunamadi - tarayici sema surumu bilinmiyor, tum eylemler kapali. */}
      <SemaBandi su={data.schemaUnknown} />
      {/* EK-1: v3 tarayici verisi varken Portal eski surume geri ALINMAZ - tek satir uyari. */}
      <GeriAlmaBandi rb={data.rollback} />

      {yukleme && (
        <div
          className="rounded-xl border px-4 py-2.5 text-[12px] flex items-start gap-2"
          style={{
            borderColor: yukleme.sorun ? 'var(--status-warning)' : 'var(--border-subtle)',
            background: yukleme.sorun ? 'var(--status-warning-bg)' : 'var(--bg-surface)',
            color: 'var(--text-secondary)',
          }}
        >
          <div className="min-w-0 flex-1">
            <b>{yukleme.baslik}</b>
            {yukleme.satirlar.map((s, i) => (
              <div key={i}>{s}</div>
            ))}
          </div>
          <button
            onClick={() => setYukleme(null)}
            className="p-0.5 rounded"
            style={{ color: 'var(--text-muted)' }}
            title="Kapat"
          >
            <XMarkIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {data.tableMissing && (
        <div
          className="rounded-xl border px-4 py-3 text-[12px]"
          style={{
            borderColor: 'var(--status-warning)',
            background: 'var(--status-warning-bg)',
            color: 'var(--text-secondary)',
          }}
        >
          {data.message}
        </div>
      )}

      {s && (
        <>
          {/* ── KAPSAMA: envanterde kac var, tarama kacina erisebildi ──────────────
              Kullanici (2026-10-01): "envanterde kac JBoss oldugunu, ancak Server Hub'in
              kacina erisip veri cekebildigini... Inventory tablosunda 1800-1900 kusur
              sunucu var, Server Hub playbook'undan su kadarina erisebildik gibi bir sey
              yapabilir miyiz?"

              EN BASTA DURUYOR cunku altindaki TUM sayilar yalnizca TARANAN sunuculardan
              hesaplaniyor. Erisilemeyen sunucu hicbir bulgu uretmez; kapsama gorunmezse
              "sorun yok" ile "bakamadik" ayni okunur. */}
          {s.scanCoverage && <KapsamaPaneli c={s.scanCoverage} />}

          {/* ── Genel durum: yuvarlak + bar ── */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Kpi
              title="Sunucular"
              tone={s.hosts.danger ? 'danger' : s.hosts.warning ? 'warning' : 'ok'}
              onClick={() => onGoFindings({})}
            >
              <Donut
                label={String(s.hosts.total)}
                sub="sunucu"
                parts={[
                  { value: s.hosts.ok, color: SEV.ok.color, title: 'sorun yok' },
                  { value: s.hosts.info, color: SEV.info.color, title: 'bilgi' },
                  { value: s.hosts.warning, color: SEV.warning.color, title: 'uyarı' },
                  { value: s.hosts.danger, color: SEV.danger.color, title: 'kritik' },
                ]}
              />
            </Kpi>
            <Kpi
              title="JBoss JVM auto-start"
              tone={s.jvm.rebootRisk ? 'danger' : 'ok'}
              onClick={() => onGoFindings({ area: 'jvm' })}
            >
              <Donut
                label={String(s.jvm.total)}
                sub="JVM"
                parts={[
                  { value: s.jvm.autoOn, color: SEV.ok.color, title: 'auto-start açık' },
                  { value: s.jvm.autoOff, color: SEV.warning.color, title: 'auto-start kapalı' },
                  {
                    value: s.jvm.autoUnknown,
                    color: 'var(--status-neutral)',
                    // NE BILINMIYOR (kullanici, 2026-09-28): tek kelime dort apayri durumu
                    // ortuyordu. "Bilinmiyor" hicbirinde "KAPALI" demek DEGILDIR.
                    title: `bilinmiyor${autoBilinmiyorKirilimi(s.jvm.autoUnknownBy) ? ` — ${autoBilinmiyorKirilimi(s.jvm.autoUnknownBy)}` : ''}`,
                  },
                ]}
              />
              <div
                className="mt-2 text-[11px]"
                style={{ color: 'var(--text-secondary)' }}
                title="auto-start ve durum önce JBoss CLI'dan, CLI okuyamazsa dbo.MWAppsInventory (middleware_applications_inventory/jboss job'ı) kaydından alınır; iki kaynak çelişirse satırda işaretlenir."
              >
                <b style={{ color: SEV.danger.color }}>{s.jvm.rebootRisk}</b> reboot riski ·{' '}
                <b>{s.jvm.restartRequired}</b> restart gerekli
                {(s.jvm.fromInventory ?? 0) > 0 && (
                  <>
                    {' '}
                    · <b>{s.jvm.fromInventory}</b> JVM envanterden
                  </>
                )}
                {(s.jvm.mismatched ?? 0) > 0 && (
                  <>
                    {' '}
                    · <b style={{ color: SEV.warning.color }}>{s.jvm.mismatched}</b> envanterle
                    çelişiyor
                  </>
                )}
              </div>
            </Kpi>
            <Kpi
              title="JVM durumu / trafik"
              tone={s.jvm.retireCandidates ? 'warning' : 'ok'}
              onClick={() => onGoFindings({ area: 'jvm', code: 'RETIRE_CANDIDATE' })}
            >
              <Donut
                label={String(s.jvm.running)}
                sub="çalışıyor"
                parts={[
                  { value: s.jvm.running, color: SEV.ok.color, title: 'çalışıyor' },
                  { value: s.jvm.stopped, color: 'var(--status-neutral)', title: 'kapalı' },
                  // OLCULEMEYEN AYRI DILIM (v3): hidepid'li sunucuda gorunmeyen JVM "kapali"
                  // dilimine KARISMAZ. Alan yoksa (eski sunucu) dilim de yok - 0 uydurulmaz.
                  ...(sayiMi(s.jvm.unmeasured)
                    ? [
                        {
                          value: s.jvm.unmeasured,
                          color: SEV.warning.color,
                          title: `bilinmiyor (${olcumSebebi(sema)})`,
                        },
                      ]
                    : []),
                ]}
              />
              {/* Kullanici (2026-09-22): "ne gosteriyor anlamadim" -> her sayi acik yazilir */}
              <div
                className="mt-2 text-[11px]"
                style={{ color: 'var(--text-secondary)' }}
                title="Trafik: JVM'in önündeki web sunucusu vhost'unun access log'unda son 7 günde istek var mı (hc.html/hc.jsp hariç). Eşleme: vhost proxy hedefi (host:port) = JVM portu; olmazsa server_name içinde JVM adı."
              >
                <b style={{ color: SEV.warning.color }}>{s.jvm.retireCandidates}</b> retire adayı
                (kapalı + 7 gün istek yok) · <b>{s.jvm.noLoad}</b> çalışıyor ama 7 gün istek yok ·{' '}
                {s.jvm.mapped}/{s.jvm.total} JVM web vhost'una eşlendi
                {sayiMi(s.jvm.unmeasured) && (
                  <>
                    {' '}
                    ·{' '}
                    <b
                      style={s.jvm.unmeasured ? { color: SEV.warning.color } : undefined}
                      title={olculemeyenAciklama('jvm', sema)}
                    >
                      {s.jvm.unmeasured}
                    </b>{' '}
                    JVM'in çalışma durumu ölçülemedi
                  </>
                )}
                {sayiMi(s.jvm.retireBlockedByWebTier) && (
                  <>
                    {' '}
                    ·{' '}
                    <b
                      title="RETIRE_CANDIDATE bulgusu duruyor ama aynı ortam+sitedeki web katmanında ölçülemeyen sunucu olduğu için retire eylemi önerilmedi."
                    >
                      {s.jvm.retireBlockedByWebTier}
                    </b>{' '}
                    retire adayı eylemsiz (web katmanında ölçülemeyen sunucu var)
                  </>
                )}
              </div>
            </Kpi>
            <Kpi
              title="Boşta IP"
              tone={s.ips.unused ? 'warning' : 'ok'}
              onClick={() => onGoFindings({ area: 'ip' })}
            >
              <Donut
                label={String(s.ips.unused)}
                sub="boşta"
                parts={
                  // 'unverified' IP (v3) BOSTA da KULLANIMDA da degildir. Sunucu ayri sayi
                  // verirse ayri dilim; vermezse "bosta degil" dilimi onu da icerdigini SOYLER.
                  sayiMi(s.ips.unverified)
                    ? [
                        {
                          value: s.ips.total - s.ips.unused - s.ips.unverified,
                          color: SEV.ok.color,
                          title: 'kullanımda',
                        },
                        { value: s.ips.unverified, color: SEV.info.color, title: 'doğrulanamadı' },
                        { value: s.ips.unused, color: SEV.warning.color, title: 'boşta' },
                      ]
                    : [
                        {
                          value: s.ips.total - s.ips.unused,
                          color: SEV.ok.color,
                          title: 'boşta değil (doğrulanamayan dahil)',
                        },
                        { value: s.ips.unused, color: SEV.warning.color, title: 'boşta' },
                      ]
                }
              />
              {s.ssh && s.ssh.hosts > 0 && (
                <div
                  className="mt-2 text-[11px]"
                  style={{ color: 'var(--text-secondary)' }}
                  title="sshd MaxSessions ≤ 10 olan sunucular — Ansible delegate/forks ile mux_client_request_session hatası verir"
                >
                  SSH:{' '}
                  <b style={s.ssh.near ? { color: SEV.warning.color } : undefined}>{s.ssh.near}</b>{' '}
                  sınıra yakın · <b>{s.ssh.lowMaxSessions}</b>/{s.ssh.hosts} MaxSessions ≤ 10
                </div>
              )}
            </Kpi>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Kpi
              title="Init script uyumu"
              tone={s.init.diffFiles ? 'warning' : 'ok'}
              onClick={() => onGoFindings({ area: 'init' })}
            >
              <div className="text-2xl font-bold tabular-nums">
                {s.init.compliant}{' '}
                <span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>
                  / {s.init.hosts} sunucu filo çoğunluğuyla aynı
                </span>
              </div>
              <div className="mt-2">
                <Bar value={s.init.compliant} total={s.init.hosts} color={SEV.ok.color} />
              </div>
              <div
                className="mt-1 text-[11px]"
                style={{ color: 'var(--text-secondary)' }}
                title="Ölçüt Denetim › Init Script ile aynı: dosya başına en kalabalık sha çoğunluktur. Repo referansından fark tek başına bulgu değildir."
              >
                {s.init.diffFiles} dosya çoğunluktan farklı
                {s.init.missingFiles ? ` · ${s.init.missingFiles} eksik` : ''}
                {s.init.refDiffFiles && s.init.refDiffFiles.length
                  ? ` · ${s.init.refDiffFiles.length} dosyada çoğunluk repo referansından farklı`
                  : ''}
              </div>
            </Kpi>
            {(['RHA', 'IHS', 'NGINX'] as const).map((p) => {
              const w = s.web[p];
              if (!w) return null;
              return (
                <Kpi
                  key={p}
                  title={`${p === 'RHA' ? 'Red Hat Apache' : p === 'IHS' ? 'IBM HTTP Server' : 'Nginx'} syntax`}
                  tone="ok"
                  onClick={() => onGoFindings({ area: 'web', code: 'SYNTAX_FAIL', product: p })}
                >
                  <div className="text-2xl font-bold tabular-nums">
                    {w.syntaxOk}{' '}
                    <span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>
                      / {w.hosts} sunucu OK
                    </span>
                  </div>
                  <div className="mt-2">
                    <Bar value={w.syntaxOk} total={w.hosts} color={SEV.ok.color} />
                  </div>
                  <div className="mt-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                    <span
                      style={
                        w.syntaxFail ? { color: SEV.danger.color, fontWeight: 600 } : undefined
                      }
                    >
                      {w.syntaxFail} hatalı
                    </span>{' '}
                    · {w.notRunning} çalışmıyor
                    {sayiMi(w.notRunningUnmeasured) && (
                      <span
                        style={w.notRunningUnmeasured ? { color: SEV.warning.color } : undefined}
                        title={olculemeyenAciklama('web', sema)}
                      >
                        {' '}
                        · {w.notRunningUnmeasured} durumu ölçülemedi
                      </span>
                    )}{' '}
                    · {w.vhosts} vhost, {w.idleVhosts} yüksüz
                  </div>
                  {s.coverage?.[p] && (
                    <div
                      className="mt-1 text-[11px]"
                      style={{
                        color:
                          s.coverage[p].inventory > s.coverage[p].scanned
                            ? 'var(--status-warning)'
                            : 'var(--text-muted)',
                      }}
                      title="Envanter (dbo.Inventory) bu ürünü kaç sunucuda gösteriyor, tarama kaçında görebildi. Fark, ürünün yok olduğu anlamına gelmez - tarama yetki ya da yol farkı yüzünden görememiş olabilir."
                    >
                      Envanter: {nf(s.coverage[p].inventory)} sunucu · tarama{' '}
                      {nf(s.coverage[p].scanned)} tanesinde gördü
                      {s.coverage[p].inventory > s.coverage[p].scanned
                        ? ` · ${nf(s.coverage[p].inventory - s.coverage[p].scanned)} eksik`
                        : ''}
                      {s.coverage[p].scannedNotInInventory
                        ? ` · envanterde olmayan ${nf(s.coverage[p].scannedNotInInventory)}`
                        : ''}
                    </div>
                  )}
                </Kpi>
              );
            })}
          </div>

          {s.byEnv && Object.keys(s.byEnv).length > 0 && (
            <div
              className="rounded-xl border p-4"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
            >
              <h3
                className="text-[11px] font-semibold uppercase tracking-wide mb-2"
                style={{ color: 'var(--text-muted)' }}
              >
                Ortam kırılımı
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left" style={{ color: 'var(--text-muted)' }}>
                      <th className="px-2 py-1">Ortam</th>
                      <th className="px-2 py-1 text-right">Sunucu</th>
                      <th className="px-2 py-1 text-right">Kritik</th>
                      <th className="px-2 py-1 text-right">Uyarı</th>
                      <th className="px-2 py-1 text-right">JVM</th>
                      <th className="px-2 py-1 text-right">Çalışan</th>
                      <th
                        className="px-2 py-1 text-right"
                        title={`Çalışma durumu ölçülemeyen JVM (${olcumSebebi(sema)}) — kapalı sayılmadı`}
                      >
                        Ölçülemeyen
                      </th>
                      <th className="px-2 py-1 text-right">auto-start kapalı</th>
                      <th className="px-2 py-1 text-right">Reboot riski</th>
                      <th className="px-2 py-1 text-right">Init farkı</th>
                      <th className="px-2 py-1">Sözdizimi hatası</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(s.byEnv).map(([g, e]) => (
                      <tr
                        key={g}
                        className="border-t cursor-pointer hover:bg-[var(--bg-elevated)]"
                        style={{ borderColor: 'var(--border-subtle)' }}
                        onClick={() => onGoFindings({ envGroup: g })}
                        title="Bu ortamın bulgularını aç"
                      >
                        <td className="px-2 py-1 font-semibold">{g}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{nf(e.hosts)}</td>
                        <td
                          className="px-2 py-1 text-right tabular-nums"
                          style={{ color: e.danger ? SEV.danger.color : undefined }}
                        >
                          {nf(e.danger)}
                        </td>
                        <td
                          className="px-2 py-1 text-right tabular-nums"
                          style={{ color: e.warning ? SEV.warning.color : undefined }}
                        >
                          {nf(e.warning)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{nf(e.jvms)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{nf(e.jvmRunning)}</td>
                        <td
                          className="px-2 py-1 text-right tabular-nums"
                          style={e.jvmUnmeasured ? { color: SEV.warning.color } : undefined}
                        >
                          {nf(e.jvmUnmeasured)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{nf(e.autoOff)}</td>
                        <td
                          className="px-2 py-1 text-right tabular-nums"
                          style={{ color: e.rebootRisk ? SEV.danger.color : undefined }}
                        >
                          {nf(e.rebootRisk)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{nf(e.initDiff)}</td>
                        <td
                          className="px-2 py-1 text-[11px]"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {(['RHA', 'IHS', 'NGINX'] as const).map((p) =>
                            e.web?.[p]?.syntaxFail ? (
                              <span key={p} className="mr-2">
                                {p}:{' '}
                                <b style={{ color: SEV.danger.color }}>{e.web[p].syntaxFail}</b>
                              </span>
                            ) : null,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {cls === 'ozel' && (
        <div
          className="rounded-xl border px-4 py-2.5 text-[12px]"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
          }}
        >
          GBEVM* ve GBPRV* sunucuları <b>genel envanterden ayrı</b> tutulur: yukarıdaki özet ve
          ortam kırılımı bunları saymaz. Taranırlar, bulguları ve “şimdi tara / düzelt” işlemleri
          çalışır.
        </div>
      )}

      {/* ── Sunucu listesi ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <MagnifyingGlassIcon
            className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-muted)' }}
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="sunucu ya da bulgu ara"
            className="pl-8 pr-2.5 py-1.5 text-xs border rounded-lg w-64"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
            }}
          />
        </div>
        <div className="flex gap-1 rounded-lg p-0.5" style={{ background: 'var(--bg-elevated)' }}>
          {(['all', 'danger', 'warning', 'info', 'ok'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setSev(k)}
              className="px-2.5 py-1 text-[11px] font-medium rounded-md"
              style={{
                background: sev === k ? 'var(--bg-surface)' : 'transparent',
                color: sev === k ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {k === 'all' ? 'tümü' : SEV[k].label}
              {s ? ` · ${k === 'all' ? s.hosts.total : s.hosts[k]}` : ''}
            </button>
          ))}
        </div>
        <select
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          className="text-xs border rounded-lg px-2 py-1.5"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
          }}
        >
          <option value="all">tüm ürünler</option>
          {products.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <div className="flex gap-1 rounded-lg p-0.5" style={{ background: 'var(--bg-elevated)' }}>
          {(
            [
              { id: 'genel', label: 'Genel envanter' },
              { id: 'ozel', label: 'GBEVM / GBPRV' },
            ] as const
          ).map((c) => (
            <button
              key={c.id}
              onClick={() => setCls(c.id)}
              className="px-2.5 py-1 text-[11px] font-medium rounded-md"
              style={{
                background: cls === c.id ? 'var(--bg-surface)' : 'transparent',
                color: cls === c.id ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
              title={
                c.id === 'ozel'
                  ? 'Genel envanterden ayrı tutulur: özet ve ortam kırılımı bu sunucuları saymaz'
                  : 'Özet ve ortam kırılımı bu sunuculardan hesaplanır'
              }
            >
              {c.label} · {nf(clsCounts[c.id])}
            </button>
          ))}
        </div>
        <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {nf(rows.length)} / {nf(cls === 'ozel' ? clsCounts.ozel : clsCounts.genel)} sunucu
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => {
              const header = [
                'sunucu',
                'tarama',
                'urunler',
                'durum',
                'kritik',
                'uyari',
                'bilgi',
                'jvm',
                'calisan_jvm',
                'olculemeyen_jvm',
                'vhost',
                'bosta_ip',
                'tarama_cpu_s',
                'en_onemli_bulgu',
              ];
              const body = [
                header,
                ...rows.map((h) => [
                  h.host,
                  h.scanDate || '',
                  h.products.join(' '),
                  SEV[h.status].label,
                  h.counts.danger,
                  h.counts.warning,
                  h.counts.info,
                  h.jvms,
                  h.jvmsRunning,
                  // alan yoksa bos hucre: "0 olculemeyen" UYDURULMAZ
                  sayiMi(h.jvmsUnmeasured) ? h.jvmsUnmeasured : '',
                  h.vhosts,
                  h.unusedIps,
                  h.cpuS ?? '',
                  h.topFinding || '',
                ]),
              ]
                .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
                .join('\n');
              const url = URL.createObjectURL(
                new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' }),
              );
              const a = document.createElement('a');
              a.href = url;
              a.download = `server_hub_${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className={SM_BTN}
            style={smBtn()}
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
          </button>
          <button
            disabled={busy != null || rows.length === 0 || rows.length > 50}
            onClick={() => scanNow(rows.map((h) => h.host))}
            className={SM_BTN}
            style={smBtn(true)}
            title="Listedeki sunucuları şimdi tara (en çok 50)"
          >
            <BoltIcon className="w-3.5 h-3.5" /> Listedekileri tara
          </button>
        </div>
      </div>

      <div
        className="overflow-auto rounded-xl border"
        style={{ borderColor: 'var(--border-subtle)', maxHeight: '44rem' }}
      >
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0" style={{ background: 'var(--bg-elevated)' }}>
            <tr>
              {[
                'Sunucu',
                'Durum',
                'Ürünler',
                'JVM',
                'vhost',
                'Boşta IP',
                'En önemli bulgu',
                'Tarama',
                '',
              ].map((t, i) => (
                <th
                  key={t + i}
                  className={`px-3 py-2 text-[11px] font-semibold ${i >= 3 && i <= 5 ? 'text-right' : 'text-left'}`}
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <TableEmptyRow
                colSpan={9}
                title={
                  data.hosts.length ? 'Süzgeçle eşleşen sunucu yok.' : 'Henüz tarama verisi yok.'
                }
                description={
                  data.hosts.length
                    ? undefined
                    : 'server_hub_scan job’ı bir kez koşunca burası dolar.'
                }
              />
            ) : (
              rows.map((h) => (
                <tr
                  key={h.host}
                  className="border-t cursor-pointer hover:bg-[var(--bg-elevated)]"
                  style={{ borderColor: 'var(--border-subtle)' }}
                  onClick={() => setOpenHost(h.host)}
                >
                  <td className="px-3 py-1.5 font-mono font-semibold">{h.host}</td>
                  <td className="px-3 py-1.5">
                    <SevPill
                      s={h.status}
                      n={
                        h.status === 'ok'
                          ? undefined
                          : h.counts.danger + h.counts.warning + h.counts.info
                      }
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                      {h.products.join(' · ') || '—'}
                    </span>
                  </td>
                  <td
                    className="px-3 py-1.5 text-right tabular-nums"
                    title={
                      (h.jvmsUnmeasured || 0) > 0
                        ? `çalışan/toplam · ? ${h.jvmsUnmeasured} = çalışma durumu ölçülemeyen JVM (${olcumSebebi(sema)}) — kapalı sayılmadı`
                        : undefined
                    }
                  >
                    {jvmSayimMetni(h)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{h.vhosts || '—'}</td>
                  <td
                    className="px-3 py-1.5 text-right tabular-nums"
                    style={h.unusedIps ? { color: SEV.warning.color, fontWeight: 600 } : undefined}
                  >
                    {h.unusedIps || '—'}
                  </td>
                  <td className="px-3 py-1.5">
                    <div
                      className="truncate max-w-[28rem]"
                      title={h.topFinding || ''}
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {h.topFinding || <span style={{ color: SEV.ok.color }}>temiz</span>}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {h.scanDate ? fmtDate(h.scanDate) : '—'}
                    {h.cpuS != null ? ` · ${h.cpuS.toFixed(1)}s cpu` : ''}
                  </td>
                  <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      disabled={busy != null}
                      onClick={() => scanNow([h.host])}
                      className={SM_BTN}
                      style={smBtn()}
                      title="Reboot öncesi şimdi tara (geceden beri değişiklik olmuş olabilir)"
                    >
                      <BoltIcon className="w-3.5 h-3.5" /> Şimdi tara
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {openHost && (
        <HostModal
          host={openHost}
          onClose={() => setOpenHost(null)}
          onScan={() => scanNow([openHost])}
          trackJob={trackJob}
          reload={() => load(true)}
        />
      )}
    </div>
  );
}

function HostModal({
  host,
  onClose,
  onScan,
  trackJob,
  reload,
}: {
  host: string;
  onClose: () => void;
  onScan: () => void;
  trackJob: (
    title: string,
    r: { jobId: number | null; awxServerId: number },
    onDone?: (status: string, result: unknown) => void,
  ) => void;
  reload: () => void;
}) {
  // v3 alanlari (runningKnown, runningSrc) yerel tipte ve istege bagli; API tipi aynen atanir.
  const [d, setD] = useState<ShHostDetailV3 | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'findings' | 'jvm' | 'web' | 'init' | 'ip'>('findings');
  const [fix, setFix] = useState<{
    f: ShFinding;
    phase: 'ask' | 'planning' | 'planned' | 'applying';
    plan?: string;
    jobId?: number;
    reload: boolean;
  } | null>(null);

  // SATIR BAZINDA AUTO-START (kullanici, 2026-10-01): "satir satir hangi jvm'lerde auto
  // start kapaliysa onun saginda bir buton olsun ben tikladigimda acilsin veya ben
  // tikladigimda kapansin. Toplu islem sakin olmasin cok tehlikeli."
  //
  // ONAY TARAYICIDA: tek satir icin ayri bir plan turu, kullaniciyi her JVM'de iki tiklamaya
  // zorlardi. Yine de sessiz DEGIL - ne yapilacagi ve hangi sunucuda oldugu aciklanir.
  const [asBusy, setAsBusy] = useState<string | null>(null);
  // OLCULEMEYEN JVM (v3, kural 7): dugme admine ACIK kalir; onay metni "calisma durumu
  // olculemedi" uyarisini tasir (bkz. autoStartOnayMetni).
  const jvmAutoStart = async (j: ShJvmV3) => {
    const ac = j.autoStart !== 'true';
    const k = `${j.gen}|${j.name}`;
    if (!window.confirm(autoStartOnayMetni(host, j, ac, d?.schemaUnknown === true))) return;
    setAsBusy(k);
    try {
      const r = await serverHubApi.jvmAutoStart({ host, gen: j.gen, jvm: j.name, enable: ac });
      if (!r.ok) {
        toast.error(r.message || 'İş başlatılamadı.');
        return;
      }
      trackJob(
        `Server Hub: auto-start ${ac ? 'AÇ' : 'KAPAT'} @ ${host}/${j.name}`,
        { jobId: r.jobId ?? null, awxServerId: r.awxServerId ?? 0 },
        (status) => {
          if (status === 'successful') {
            toast.success(`${j.name}: auto-start ${ac ? 'açıldı' : 'kapatıldı'}.`);
            reload();
            // TARAMA TAZELENIR: ekran eski degeri gostermeye devam ederse kullanici
            // islemin olmadigini sanir ve ikinci kez tiklar.
            serverHubApi
              .host(host, true)
              .then((x) => x.ok && setD(x.host))
              .catch(() => {});
          } else toast.error(`${j.name}: iş ${status}.`);
        },
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setAsBusy(null);
    }
  };

  useEffect(() => {
    let alive = true;
    serverHubApi
      .host(host)
      .then((r) => {
        if (!alive) return;
        if (r.ok) setD(r.host);
        else setErr(r.message || 'Sunucu verisi alınamadı.');
      })
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [host]);

  const runFix = async (confirmed: boolean) => {
    if (!fix) return;
    setFix({ ...fix, phase: confirmed ? 'applying' : 'planning' });
    try {
      const r = await serverHubApi.fix({
        host,
        code: fix.f.code,
        fix: fix.f.fix!,
        confirmed,
        reload: fix.reload,
      });
      if (!r.ok) {
        toast.error(r.message || 'İş başlatılamadı.');
        setFix({ ...fix, phase: 'ask' });
        return;
      }
      trackJob(
        `Server Hub: ${confirmed ? 'düzelt' : 'plan'} ${fix.f.fix!.action} @ ${host}`,
        r,
        (status, result) => {
          const line = (result as { line?: string } | null)?.line || '';
          const msg = line.split('\t').slice(2).join(' — ') || status;
          if (!confirmed)
            setFix((cur) =>
              cur ? { ...cur, phase: 'planned', plan: msg, jobId: r.jobId ?? undefined } : cur,
            );
          else {
            if (status === 'successful') {
              toast.success(`Uygulandı: ${msg}`);
              setFix(null);
              reload();
              serverHubApi
                .host(host, true)
                .then((x) => x.ok && setD(x.host))
                .catch(() => {});
            } else {
              toast.error(`Düzeltme başarısız: ${msg}`);
              setFix((cur) => (cur ? { ...cur, phase: 'planned', plan: msg } : cur));
            }
          }
        },
      );
      toast.success(
        `${confirmed ? 'Düzeltme' : 'Plan'} işi başladı (#${r.jobId}). Sonuç bu pencerede görünecek.`,
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
      setFix({ ...fix, phase: 'ask' });
    }
  };

  const tabs = [
    { id: 'findings', label: `Bulgular${d ? ` · ${d.findings.length}` : ''}` },
    { id: 'jvm', label: `JVM${d ? ` · ${d.jvms.length}` : ''}` },
    { id: 'web', label: `Web / vhost${d ? ` · ${d.vhosts.length}` : ''}` },
    { id: 'init', label: `Init${d ? ` · ${d.init.length}` : ''}` },
    { id: 'ip', label: `IP${d ? ` · ${d.ips.length}` : ''}` },
  ] as const;

  return (
    <Modal
      open
      onClose={onClose}
      title={host}
      subtitle={
        d
          ? `${d.products.join(' · ') || 'ürün yok'} · son tarama ${d.scanDate ? fmtDate(d.scanDate) : '—'}${d.cpuS != null ? ` · tarama ${d.cpuS.toFixed(1)} sn CPU` : ''}`
          : undefined
      }
      icon={ServerStackIcon}
      size="xl"
      footer={
        <div className="flex items-center gap-2 w-full">
          <button onClick={onScan} className={SM_BTN} style={smBtn()}>
            <BoltIcon className="w-3.5 h-3.5" /> Şimdi tara
          </button>
          <span className="ml-auto" />
          <button onClick={onClose} className={SM_BTN} style={smBtn()}>
            Kapat
          </button>
        </div>
      }
    >
      {err && (
        <div
          className="text-sm px-3 py-2 rounded-xl border"
          style={{
            color: 'var(--status-danger)',
            background: 'var(--status-danger-bg)',
            borderColor: 'var(--status-danger)',
          }}
        >
          {err}
        </div>
      )}
      {!d && !err && <LoadingLogo compact />}
      {d && (
        <div className="space-y-3">
          {/* C3: bu sunucuda sema okunamadi - eylem yok; durum hucreleri sebebi soyler. */}
          <SemaBandi su={d.schemaUnknown} />
          <div
            className="flex gap-1 rounded-lg p-0.5 w-fit"
            style={{ background: 'var(--bg-elevated)' }}
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="px-3 py-1.5 text-xs font-medium rounded-md"
                style={{
                  background: tab === t.id ? 'var(--bg-surface)' : 'transparent',
                  color: tab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'findings' &&
            (d.findings.length === 0 ? (
              <div
                className="rounded-xl border px-4 py-3 text-sm"
                style={{
                  borderColor: SEV.ok.color,
                  background: SEV.ok.bg,
                  color: 'var(--text-secondary)',
                }}
              >
                <b style={{ color: SEV.ok.color }}>Sorun yok.</b> Reboot için engel görünmüyor.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {d.findings.map((f, i) => {
                  const t = SEV[f.severity];
                  const I = t.icon;
                  return (
                    <li
                      key={i}
                      className="flex items-start gap-2.5 rounded-xl border px-3 py-2"
                      style={{
                        borderColor: 'var(--border-subtle)',
                        background: 'var(--bg-surface)',
                        boxShadow: `inset 3px 0 0 ${t.color}`,
                      }}
                    >
                      <I className="w-4 h-4 shrink-0 mt-0.5" style={{ color: t.color }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px]" style={{ color: 'var(--text-primary)' }}>
                          {f.text}
                        </div>
                        <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {AREA[f.area] || f.area} · {kodEtiketi(f.code)}
                        </div>
                        <LogKanit f={f} />
                        <AtfedilemeyenTrafik f={f} />
                      </div>
                      {f.fix && (
                        <button
                          onClick={() => setFix({ f, phase: 'ask', reload: false })}
                          className={SM_BTN}
                          style={smBtn(true)}
                          title={`Düzelt: ${f.fix.action}`}
                        >
                          <WrenchScrewdriverIcon className="w-3.5 h-3.5" /> Düzelt
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ))}

          {tab === 'jvm' && (
            <div
              className="overflow-auto rounded-lg border"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <table className="w-full text-xs border-collapse">
                <thead style={{ background: 'var(--bg-elevated)' }}>
                  <tr>
                    {[
                      'Nesil',
                      'JVM',
                      'Grup',
                      'Durum',
                      'Auto-start',
                      'server-state',
                      'Portlar',
                      'Web katmanı',
                      '24 sa',
                      '7 gün',
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-2.5 py-1.5 text-left text-[11px] font-semibold"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.jvms.length === 0 ? (
                    <TableEmptyRow colSpan={10} title="Bu sunucuda JBoss JVM tanımı yok." />
                  ) : (
                    d.jvms.map((j) => (
                      <tr
                        key={j.gen + j.name}
                        className="border-t"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        <td className="px-2.5 py-1.5">JBoss {j.gen}</td>
                        <td className="px-2.5 py-1.5 font-mono font-semibold">{j.name}</td>
                        <td className="px-2.5 py-1.5" style={{ color: 'var(--text-muted)' }}>
                          {j.group || '—'}
                        </td>
                        <td className="px-2.5 py-1.5">
                          {/* OLCULEMEDI != KAPALI (v3): hidepid'li sunucuda gorunmeyen JVM
                              "kapali" yazilmaz (runningKnown=false). Sema okunamadiysa (C3)
                              sebep hidepid DEGIL sema: ayrintinin schemaUnknown'u verilir. */}
                          <span
                            style={{ color: jvmDurumu(j, d.schemaUnknown === true).renk, fontWeight: 600 }}
                            title={
                              [
                                jvmDurumu(j, d.schemaUnknown === true).aciklama,
                                j.runningSrc ? `kaynak: ${j.runningSrc}` : '',
                              ]
                                .filter(Boolean)
                                .join(' · ') || undefined
                            }
                          >
                            {jvmDurumu(j, d.schemaUnknown === true).metin}
                          </span>
                        </td>
                        <td className="px-2.5 py-1.5">
                          <span
                            style={{
                              color:
                                j.autoStart === 'true'
                                  ? SEV.ok.color
                                  : j.autoStart === 'false'
                                    ? SEV.warning.color
                                    : 'var(--status-neutral)',
                              fontWeight: 600,
                            }}
                          >
                            {j.autoStart === 'true'
                              ? 'açık'
                              : j.autoStart === 'false'
                                ? 'kapalı'
                                : '?'}
                          </span>
                          {/* TEK SATIR, TEK TIK. Toplu islem 2026-10-01'de kaldirildi:
                              yanlis bir tarama sonucu yuzlerce sunucuya yayilirdi. Tur 4: tanimsiz
                              surec (UNAVAILABLE), sema okunamadi ya da bayat sunucuda dugme YOK
                              (sunucu 400 doner); sebep yazilir. */}
                          {autoStartDugmesi(j, d).goster ? (
                            <button
                              onClick={() => jvmAutoStart(j)}
                              disabled={asBusy === `${j.gen}|${j.name}`}
                              className="ml-2 px-1.5 py-0.5 text-[10px] border rounded disabled:opacity-50"
                              style={{ borderColor: 'var(--border)' }}
                              title={
                                (j.autoStart === 'true'
                                  ? `${j.name} için auto-start'ı KAPAT (yalnız bu JVM)`
                                  : j.autoStart === 'false'
                                    ? `${j.name} için auto-start'ı AÇ (yalnız bu JVM)`
                                    : `${j.name} için auto-start ölçülemedi — AÇ'a basarsanız açıkça açılır`) +
                                (jvmCalismaBilinir(j) ? '' : ' · çalışma durumu ölçülemedi')
                              }
                            >
                              {asBusy === `${j.gen}|${j.name}`
                                ? '…'
                                : j.autoStart === 'true'
                                  ? 'Kapat'
                                  : 'Aç'}
                            </button>
                          ) : (
                            <span
                              className="ml-2 text-[10px]"
                              style={{ color: 'var(--text-muted)' }}
                              title={autoStartDugmesi(j, d).neden}
                            >
                              değiştirilemez
                            </span>
                          )}
                        </td>
                        <td
                          className="px-2.5 py-1.5"
                          style={
                            /required/.test(j.serverState)
                              ? { color: SEV.warning.color, fontWeight: 600 }
                              : undefined
                          }
                        >
                          {j.serverState}
                        </td>
                        <td className="px-2.5 py-1.5 font-mono text-[10px]">
                          {j.ports.join(', ') || '—'}
                        </td>
                        <td className="px-2.5 py-1.5 text-[10px]">
                          {j.vhosts.length ? (
                            j.vhosts.map((v) => (
                              <div
                                key={v.host + v.serverName}
                                title={`${v.product} @ ${v.host} (${j.matchKind === 'proxy' ? 'proxy hedefi' : 'ad eşleşmesi'})`}
                              >
                                {v.serverName}{' '}
                                <span style={{ color: 'var(--text-muted)' }}>@{v.host}</span>
                              </div>
                            ))
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>eşlenemedi</span>
                          )}
                        </td>
                        {/* Esli vhost var ama sayi yok = trafik DOGRULANAMADI ("?"), "—" degil. */}
                        <td
                          className="px-2.5 py-1.5 tabular-nums text-right"
                          title={
                            j.req24h == null && j.vhosts.length
                              ? 'trafik doğrulanamadı (log okunamadı ya da web katmanı ölçülemedi)'
                              : undefined
                          }
                        >
                          {j.req24h == null && j.vhosts.length ? '?' : nf(j.req24h)}
                        </td>
                        <td
                          className="px-2.5 py-1.5 tabular-nums text-right"
                          style={
                            j.req7d === 0
                              ? { color: SEV.warning.color, fontWeight: 600 }
                              : undefined
                          }
                          title={
                            j.req7d == null && j.vhosts.length
                              ? 'trafik doğrulanamadı (log okunamadı ya da web katmanı ölçülemedi)'
                              : undefined
                          }
                        >
                          {j.req7d == null && j.vhosts.length ? '?' : nf(j.req7d)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {d.jboss.map((b) => (
                <div
                  key={b.gen}
                  className="px-2.5 py-1.5 text-[10px] border-t"
                  style={{ color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }}
                >
                  JBoss {b.gen} host controller "{b.hostName}": {b.hostState} · CLI {b.cli}
                  {b.note ? ` — ${b.note}` : ''}
                </div>
              ))}
            </div>
          )}

          {tab === 'web' && (
            <div className="space-y-2">
              {d.web.map((w) => (
                <div
                  key={w.product}
                  className="rounded-lg border px-3 py-2 text-xs flex items-center gap-3"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                >
                  <b>{w.product}</b>
                  {/* running_src=UNMEASURED (hidepid ya da sema okunamadi) "calismiyor" DEGIL */}
                  <span
                    style={{ color: webDurumu(w, d.schemaUnknown === true).renk }}
                    title={w.runningSrc ? `kaynak: ${w.runningSrc}` : undefined}
                  >
                    {webDurumu(w, d.schemaUnknown === true).metin}
                  </span>
                  <span
                    style={{
                      color:
                        w.syntax === 'OK'
                          ? SEV.ok.color
                          : w.syntax === 'FAIL'
                            ? SEV.danger.color
                            : 'var(--text-muted)',
                      fontWeight: 600,
                    }}
                  >
                    syntax {w.syntax}
                  </span>
                  <span
                    className="truncate"
                    style={{ color: 'var(--text-muted)' }}
                    title={w.detail}
                  >
                    {w.detail}
                  </span>
                </div>
              ))}
              <div
                className="overflow-auto rounded-lg border"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <table className="w-full text-xs border-collapse">
                  <thead style={{ background: 'var(--bg-elevated)' }}>
                    <tr>
                      {[
                        'Ürün',
                        'Listen',
                        'server_name',
                        'Proxy hedefi',
                        'JVM',
                        '24 sa',
                        '7 gün',
                        'hc 24 sa',
                        'Log',
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-2.5 py-1.5 text-left text-[11px] font-semibold"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.vhosts.length === 0 ? (
                      <TableEmptyRow colSpan={9} title="vhost tanımı yok." />
                    ) : (
                      d.vhosts.map((v, i) => (
                        <tr
                          key={i}
                          className="border-t"
                          style={{ borderColor: 'var(--border-subtle)' }}
                        >
                          <td className="px-2.5 py-1.5">{v.product}</td>
                          <td className="px-2.5 py-1.5 font-mono text-[10px]">{v.listen}</td>
                          <td className="px-2.5 py-1.5">
                            <div
                              className="truncate max-w-[16rem]"
                              title={`${v.serverName} ${v.aliases}`}
                            >
                              {v.serverName}
                              {v.aliases ? (
                                <span style={{ color: 'var(--text-muted)' }}>
                                  {' '}
                                  +{v.aliases.split(' ').filter(Boolean).length}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-2.5 py-1.5 font-mono text-[10px]">
                            <div className="truncate max-w-[14rem]" title={v.proxyTargets}>
                              {v.proxyTargets || '—'}
                            </div>
                            {/* C4: kesik liste rozeti truncate disinda - her zaman gorunur */}
                            <HedefKesikRozeti kesik={v.targetsTruncated} />
                            {/* EK-7.4/7.5: '~DYNAMIC' - hedef bilinmiyor ("proxy yok" DEGIL) */}
                            <DinamikProxyRozeti dinamik={v.targetsDynamic} />
                          </td>
                          <td className="px-2.5 py-1.5 text-[10px]">
                            {v.jvm || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                          </td>
                          <td className="px-2.5 py-1.5 tabular-nums text-right">
                            {v.req24h == null || v.req24h < 0 ? '?' : nf(v.req24h)}
                          </td>
                          <td
                            className="px-2.5 py-1.5 tabular-nums text-right"
                            style={
                              v.req7d === 0
                                ? { color: SEV.warning.color, fontWeight: 600 }
                                : undefined
                            }
                            title={vhostTrafikAciklamasi(v) || undefined}
                          >
                            {v.req7d == null || v.req7d < 0 ? '?' : nf(v.req7d)}
                            {v.sampled ? '~' : ''}
                          </td>
                          <td
                            className="px-2.5 py-1.5 tabular-nums text-right"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {v.hc24h == null || v.hc24h < 0 ? '?' : nf(v.hc24h)}
                          </td>
                          <td className="px-2.5 py-1.5 font-mono text-[10px]">
                            <div className="truncate max-w-[14rem]" title={v.accessLog}>
                              {v.accessLog || '—'}
                              {v.shared ? ' (paylaşımlı)' : ''}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                "~" = sayı alt sınır (log kuyruğu 7 günü kapsamadı ya da trafiğin bir kısmı bu logda
                yok). Sayılar hc.html/hc.jsp hariç; "?" = sayı yok: log ya da conf okunamadı veya
                trafik bu logdan doğrulanamadı — sebep hücrenin üzerinde.
              </p>
            </div>
          )}

          {tab === 'init' && (
            <div
              className="overflow-auto rounded-lg border"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <table className="w-full text-xs border-collapse">
                <thead style={{ background: 'var(--bg-elevated)' }}>
                  <tr>
                    {['Kök', 'Dosya', 'Durum'].map((h) => (
                      <th
                        key={h}
                        className="px-2.5 py-1.5 text-left text-[11px] font-semibold"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.init.length === 0 ? (
                    <TableEmptyRow
                      colSpan={3}
                      title="Init script dizini yok ya da referans verilmedi."
                    />
                  ) : (
                    d.init.map((i, k) => (
                      <tr
                        key={k}
                        className="border-t"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        <td className="px-2.5 py-1.5 font-mono text-[10px]">{i.root}</td>
                        <td className="px-2.5 py-1.5 font-mono">{i.file}</td>
                        <td className="px-2.5 py-1.5">
                          {/* UNREADABLE (bakilamadi) "yok" DEGIL - kural 6. */}
                          <span
                            style={{ color: initDurumu(i.status).renk, fontWeight: 600 }}
                            title={
                              String(i.status).toUpperCase() === 'UNREADABLE'
                                ? 'Dosyaya bakılamadı (yetki reddi ya da okunamadı) — eksik ya da farklı sayılmadı.'
                                : undefined
                            }
                          >
                            {initDurumu(i.status).etiket}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'ip' && (
            <div
              className="overflow-auto rounded-lg border"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <table className="w-full text-xs border-collapse">
                <thead style={{ background: 'var(--bg-elevated)' }}>
                  <tr>
                    {['IP', 'Arayüz', 'Kullanan', ''].map((h, i) => (
                      <th
                        key={h + i}
                        className="px-2.5 py-1.5 text-left text-[11px] font-semibold"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.ips.length === 0 ? (
                    <TableEmptyRow colSpan={4} title="IP bilgisi yok." />
                  ) : (
                    d.ips.map((ip) => (
                      <tr
                        key={ip.ip}
                        className="border-t"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        <td className="px-2.5 py-1.5 font-mono">{ip.ip}</td>
                        <td className="px-2.5 py-1.5">{ip.iface}</td>
                        <td className="px-2.5 py-1.5">
                          {/* 'unverified' (v3): kullanim DOGRULANAMADI - bosta sayilmaz, urun
                              adi gibi buyuk harfle de basilmaz (D1-U01). */}
                          {(() => {
                            const k = ipKullanan(ip.usedBy);
                            return (
                              <span
                                style={{ color: k.renk, fontWeight: k.kalin ? 600 : 400 }}
                                title={k.aciklama || undefined}
                              >
                                {k.etiket}
                              </span>
                            );
                          })()}
                        </td>
                        <td
                          className="px-2.5 py-1.5 text-[10px]"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {ip.primary ? 'birincil' : ''}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {d.sshd && (
                <div
                  className="px-2.5 py-1.5 text-[11px] border-t"
                  style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)' }}
                >
                  sshd: MaxSessions <b>{d.sshd.maxSessions ?? '?'}</b> · MaxStartups{' '}
                  <b>{d.sshd.maxStartups || '?'}</b> · açık ssh oturumu{' '}
                  <b>{d.sshd.activeSessions ?? '?'}</b>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Duzelt: once PLAN, sonra onay ── */}
      {fix && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,.45)' }}
          onClick={() => (fix.phase === 'ask' || fix.phase === 'planned' ? setFix(null) : null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border p-5 space-y-3"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-2">
              <WrenchScrewdriverIcon
                className="w-5 h-5 shrink-0"
                style={{ color: 'var(--accent)' }}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Düzelt — {fix.f.fix!.action}</div>
                <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  {fix.f.text}
                </div>
              </div>
              <button
                onClick={() => setFix(null)}
                className="p-1 rounded-lg"
                style={{ color: 'var(--text-muted)' }}
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
            <div
              className="rounded-xl border px-3 py-2 text-[12px] font-mono"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}
            >
              {Object.entries(fix.f.fix!)
                .filter(([k]) => k !== 'action')
                .map(([k, v]) => (
                  <div key={k}>
                    <span style={{ color: 'var(--text-muted)' }}>{k}=</span>
                    {String(v)}
                  </div>
                ))}
              <div>
                <span style={{ color: 'var(--text-muted)' }}>host=</span>
                {host}
              </div>
            </div>
            {fix.f.fix!.action.startsWith('apache_') && (
              <label
                className="flex items-center gap-2 text-[12px]"
                style={{ color: 'var(--text-secondary)' }}
              >
                <input
                  type="checkbox"
                  checked={fix.reload}
                  onChange={(e) => setFix({ ...fix, reload: e.target.checked })}
                  disabled={fix.phase !== 'ask' && fix.phase !== 'planned'}
                />{' '}
                Sözdizimi geçerse <b>graceful reload</b> da yap
              </label>
            )}
            {fix.phase === 'ask' && (
              <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                Önce sunucuda <b>plan</b> koşulur: ne değişeceği gösterilir, hiçbir şey değişmez.
                Planı gördükten sonra onaylarsınız. Her değişiklikten önce yedek alınır;
                sözdizimi/doğrulama geçmezse geri alınır.
              </p>
            )}
            {fix.phase === 'planning' && (
              <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                Plan koşuyor… (iş penceresinden izlenebilir)
              </p>
            )}
            {fix.phase === 'planned' && (
              <div
                className="rounded-xl border px-3 py-2 text-[12px]"
                style={{
                  borderColor: 'var(--status-info)',
                  background: 'var(--status-info-bg)',
                  color: 'var(--text-primary)',
                }}
              >
                <b>Plan:</b> {fix.plan}
              </div>
            )}
            {fix.phase === 'applying' && (
              <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                Uygulanıyor…
              </p>
            )}
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setFix(null)}
                className={SM_BTN}
                style={smBtn()}
                disabled={fix.phase === 'planning' || fix.phase === 'applying'}
              >
                İptal
              </button>
              {fix.phase === 'ask' && (
                <button onClick={() => runFix(false)} className={SM_BTN} style={smBtn(true)}>
                  Planı göster
                </button>
              )}
              {fix.phase === 'planned' && !/FAIL/.test(fix.plan || '') && (
                <button
                  onClick={() => runFix(true)}
                  className={SM_BTN}
                  style={{
                    ...smBtn(true),
                    background: 'var(--status-danger)',
                    borderColor: 'var(--status-danger)',
                  }}
                >
                  Onayla ve uygula
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Bulgular sekmesi (2026-09-22) ─────────────────────────────────────────────────
// Kullanici: "Init script / RHA / IHS sözdizimi sorunlarını toplu halde liste şeklinde nasıl
// görebilirim?" Tüm sunucuların bulguları tek tabloda; alan (init/web/jvm/…), kod, önem ve
// ürün süzgeci; CSV. Satırdaki sunucuya tıklayınca sunucu penceresi açılır (Sunucular sekmesi).
/**
 * Bulgunun DAYANDIĞI log dosyaları.
 *
 * Kullanıcı (2026-09-28): "NO_LOAD bulguları için en son hangi log dosyasının okunduğunu
 * da görmek istiyorum." Bulgu metni en fazla iki vhost gösterip gerisini "+3" diye
 * kısıyordu; eksik kalan tam da bakılması gereken satır olabilirdi.
 *
 * OKUNAN ile OKUNAMAYAN AYRI GÖSTERİLİR: okunamayan bir log "0 istek" değildir, ölçüm
 * yokluğudur — "7 gündür istek yok" iddiasının dayanağı sayılamaz.
 */
function LogKanit({ f }: { f: ShFinding }) {
  if (!f.logs || !f.logs.length) return null;
  // OLCULDU = okundu VE sayi >= 0 (v3: -1 degismezi). Sunucu read=true dese bile -1/null kanit degil.
  const okunan = f.logs.filter((l) => logOlculdu(l));
  const okunamayan = f.logs.filter((l) => !logOlculdu(l));
  return (
    <details className="mt-1">
      <summary
        className="text-[10px] cursor-pointer select-none"
        style={{ color: 'var(--text-muted)' }}
      >
        Okunan log: {okunan.length}
        {okunamayan.length ? ` · okunamayan: ${okunamayan.length}` : ''}
        {f.scanDate ? ` · tarama ${f.scanDate}` : ''}
      </summary>
      <ul className="mt-1 space-y-0.5">
        {f.logs.map((l, i) => (
          <li
            key={i}
            className="text-[10px] font-mono break-all"
            style={{ color: logOlculdu(l) ? 'var(--text-secondary)' : 'var(--status-warning)' }}
          >
            {l.path || '(access_log tanımsız)'}
            <span className="font-sans" style={{ color: 'var(--text-muted)' }}>
              {' — '}
              {l.host}/{l.serverName || '?'}
              {logKanitMetni(l)}
              {l.shared ? ' · paylaşımlı log' : ''}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

const AREA_TR: Record<string, string> = {
  init: 'Init script',
  jboss: 'JBoss host',
  jvm: 'JVM',
  web: 'Web syntax / vhost',
  ip: 'IP',
  ssh: 'SSH',
  scan: 'Tarama',
};
export function FindingsTab({
  initial,
}: {
  initial?: { area?: string; code?: string; product?: string; envGroup?: string } | null;
}) {
  const [data, setData] = useState<ShFindingsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [area, setArea] = useState<string>(initial?.area || 'all');
  const [code, setCode] = useState<string>(initial?.code || 'all');
  const [sev, setSev] = useState<'all' | ShSeverity>('all');
  const [product, setProduct] = useState<string>(initial?.product || 'all');
  const [envGroup, setEnvGroup] = useState<string>(initial?.envGroup || 'all');
  const [fCls, setFCls] = useState<'genel' | 'ozel' | 'all'>('genel');
  // SATIR BAZINDA AUTO-START (kullanici, 2026-10-01). Dugme once yalniz sunucu detayinin
  // JVM sekmesindeydi; auto-start sorunlarina BAKILAN yer ise burasi - her bulgu icin
  // sunucuyu acip JVM sekmesine gecmek gereksiz bir tur attiriyordu.
  //
  // TOPLU ISLEM YOK (kullanici: "cok tehlikeli"): her satir kendi onayini ister, her tiklama
  // TEK (host, jvm) hedefler.
  const [asBusy, setAsBusy] = useState<string | null>(null);
  const autoStartDuzelt = async (f: ShFindingRow) => {
    const fix = f.fix;
    if (!fix || !fix.jvm || fix.gen == null) return;
    const ac = fix.action === 'jboss_autostart_on';
    const k = `${f.host}|${fix.gen}|${fix.jvm}`;
    if (
      !window.confirm(
        `${f.host} üzerinde ${fix.jvm} (JBoss ${fix.gen}) için auto-start ` +
          `${ac ? 'AÇILACAK' : 'KAPATILACAK'}.\n\nYalnız bu JVM etkilenir. Devam edilsin mi?`,
      )
    )
      return;
    setAsBusy(k);
    try {
      const r = await serverHubApi.jvmAutoStart({
        host: f.host,
        gen: fix.gen,
        jvm: fix.jvm,
        enable: ac,
      });
      if (!r.ok) {
        toast.error(r.message || 'İş başlatılamadı.');
        return;
      }
      toast.success(`${fix.jvm}: iş başlatıldı (#${r.jobId ?? '?'}). Tarama tazelenince durum güncellenir.`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setAsBusy(null);
    }
  };

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const r = await serverHubApi.findings(fresh);
      if (r.ok) setData(r);
      else toast.error(r.message || 'Bulgular alınamadı.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useAsyncEffect(async () => {
    await load();
  }, [load]);
  const all = data?.findings || [];
  const codes = useMemo(
    () =>
      [...new Set(all.filter((f) => area === 'all' || f.area === area).map((f) => f.code))].sort(),
    [all, area],
  );
  const products = useMemo(() => [...new Set(all.flatMap((f) => f.products))].sort(), [all]);
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return all.filter(
      (f) =>
        (area === 'all' || f.area === area) &&
        (code === 'all' || f.code === code) &&
        (sev === 'all' || f.severity === sev) &&
        (product === 'all' || f.products.includes(product)) &&
        (envGroup === 'all' || (f.envGroup || 'Bilinmiyor') === envGroup) &&
        (fCls === 'all' || (f.hostClass || 'genel') === fCls) &&
        (!n || f.host.toLowerCase().includes(n) || f.text.toLowerCase().includes(n)),
    );
  }, [all, q, area, code, sev, product, envGroup, fCls]);
  const byCode = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of rows) m.set(f.code, (m.get(f.code) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const csv = () => {
    const head = [
      'sunucu',
      'ortam',
      'urunler',
      'onem',
      'alan',
      'kod',
      'bulgu',
      'duzeltilebilir',
      'tarama',
    ];
    const body = rows.map((f) => [
      f.host,
      f.env || '',
      f.products.join(' '),
      f.severity,
      f.area,
      f.code,
      f.text,
      f.fixable ? 'evet' : '',
      f.scanDate || '',
    ]);
    const text = [head, ...body]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';'))
      .join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' }));
    a.download = `server_hub_bulgular_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };
  const sel = 'h-8 px-2 text-xs border rounded-lg';
  const selStyle: React.CSSProperties = {
    borderColor: 'var(--border)',
    background: 'var(--bg-surface)',
    color: 'var(--text-primary)',
  };
  return (
    <div className="space-y-3">
      <BayatFiloBandi sf={data?.staleFleet} />
      <SemaBandi su={data?.schemaUnknown} />
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="sunucu ya da bulgu metni ara"
          className="h-8 px-3 text-xs border rounded-lg w-64"
          style={selStyle}
        />
        <select
          value={area}
          onChange={(e) => {
            setArea(e.target.value);
            setCode('all');
          }}
          className={sel}
          style={selStyle}
          aria-label="alan"
        >
          <option value="all">tüm alanlar</option>
          {Object.entries(AREA_TR).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={sel}
          style={selStyle}
          aria-label="bulgu kodu"
        >
          <option value="all">tüm kodlar</option>
          {codes.map((c) => (
            <option key={c} value={c}>
              {kodEtiketi(c)}
            </option>
          ))}
        </select>
        <select
          value={sev}
          onChange={(e) => setSev(e.target.value as 'all' | ShSeverity)}
          className={sel}
          style={selStyle}
          aria-label="önem"
        >
          <option value="all">tüm önemler</option>
          <option value="danger">kritik</option>
          <option value="warning">uyarı</option>
          <option value="info">bilgi</option>
        </select>
        <select
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          className={sel}
          style={selStyle}
          aria-label="ürün"
        >
          <option value="all">tüm ürünler</option>
          {products.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={fCls}
          onChange={(e) => setFCls(e.target.value as 'genel' | 'ozel' | 'all')}
          className={sel}
          style={selStyle}
          aria-label="envanter sınıfı"
        >
          <option value="genel">genel envanter</option>
          <option value="ozel">GBEVM / GBPRV</option>
          <option value="all">hepsi</option>
        </select>
        <select
          value={envGroup}
          onChange={(e) => setEnvGroup(e.target.value)}
          className={sel}
          style={selStyle}
          aria-label="ortam"
        >
          <option value="all">tüm ortamlar</option>
          <option value="Production">Production</option>
          <option value="Non-Production">Non-Production</option>
          <option value="Bilinmiyor">Bilinmiyor</option>
        </select>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {fmtNumber(rows.length)} bulgu · {fmtNumber(new Set(rows.map((f) => f.host)).size)} sunucu
          {data?.latestScan ? ` · son tarama ${data.latestScan}` : ''}
        </span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={csv}
            className="px-2.5 py-1.5 text-xs border rounded-lg"
            style={{ borderColor: 'var(--border)' }}
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5 inline" /> CSV
          </button>
          <button
            onClick={() => load(true)}
            className="px-2.5 py-1.5 text-xs border rounded-lg"
            style={{ borderColor: 'var(--border)' }}
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 inline ${loading ? 'animate-spin' : ''}`} />{' '}
            Yenile
          </button>
        </div>
      </div>
      {byCode.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {byCode.map(([c, n]) => (
            <button
              key={c}
              onClick={() => setCode(code === c ? 'all' : c)}
              title={kodEtiketi(c)}
              className="px-2 py-0.5 rounded-full border text-[11px]"
              style={{
                borderColor: code === c ? 'var(--accent)' : 'var(--border-subtle)',
                background: 'var(--bg-surface)',
                color: 'var(--text-secondary)',
              }}
            >
              {c} <b className="tabular-nums">{fmtNumber(n)}</b>
            </button>
          ))}
        </div>
      )}
      <div
        className="overflow-x-auto rounded-xl border"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <table className="w-full text-xs">
          <thead>
            <tr
              className="text-left"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
            >
              <th className="px-3 py-2">Sunucu</th>
              <th className="px-3 py-2">Ortam</th>
              <th className="px-3 py-2">Önem</th>
              <th className="px-3 py-2">Alan</th>
              <th className="px-3 py-2">Kod</th>
              <th className="px-3 py-2">Bulgu</th>
              <th className="px-3 py-2">Ürünler</th>
              <th className="px-3 py-2">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 2000).map((f, i) => (
              <tr
                key={f.host + f.code + i}
                className="border-t"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <td className="px-3 py-1.5 font-mono font-semibold">{f.host}</td>
                <td className="px-3 py-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {f.env || f.envGroup || '—'}
                </td>
                <td className="px-3 py-1.5">
                  <SevPill s={f.severity} />
                </td>
                <td className="px-3 py-1.5">{AREA_TR[f.area] || f.area}</td>
                <td className="px-3 py-1.5 font-mono text-[11px]" title={kodEtiketi(f.code)}>
                  {f.code}
                  {KOD_ETIKET[f.code] ? (
                    <div className="font-sans text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {KOD_ETIKET[f.code]}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-1.5">
                  <div className="max-w-[40rem] truncate" title={f.text}>
                    {f.text}
                  </div>
                </td>
                <td className="px-3 py-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {f.products.join(' · ')}
                </td>
                <td className="px-3 py-1.5">
                  {/* Yalniz auto-start bulgulari: oteki duzeltmeler plan/onay akisindan
                      gecer (sunucu detayindaki "Duzelt" dugmesi). */}
                  {f.fix &&
                  (f.fix.action === 'jboss_autostart_on' || f.fix.action === 'jboss_autostart_off') ? (
                    <button
                      onClick={() => autoStartDuzelt(f)}
                      disabled={asBusy === `${f.host}|${f.fix.gen}|${f.fix.jvm}`}
                      title={
                        f.fix.action === 'jboss_autostart_on'
                          ? `${f.fix.jvm} için auto-start'ı AÇ (yalnız bu JVM)`
                          : `${f.fix.jvm} için auto-start'ı KAPAT (yalnız bu JVM)`
                      }
                      className="px-1.5 py-0.5 text-[10px] border rounded disabled:opacity-50"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      {asBusy === `${f.host}|${f.fix.gen}|${f.fix.jvm}`
                        ? '…'
                        : f.fix.action === 'jboss_autostart_on'
                          ? 'Auto-start AÇ'
                          : 'Auto-start KAPAT'}
                    </button>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <TableEmptyRow
                colSpan={8}
                title={all.length ? 'Süzgeçle eşleşen bulgu yok.' : 'Bulgu yok.'}
                description={
                  data?.tableMissing ? "server_hub_scan job'ı henüz koşmadı." : undefined
                }
              />
            )}
          </tbody>
        </table>
        {rows.length > 2000 && (
          <div className="px-3 py-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            İlk 2.000 satır gösteriliyor; tamamı CSV'de.
          </div>
        )}
      </div>
    </div>
  );
}
