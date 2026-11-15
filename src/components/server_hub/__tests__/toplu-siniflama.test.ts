// src/components/server_hub/__tests__/toplu-siniflama.test.ts — Toplu iş başarısızlık kategorileri (2026-11-15).
//
//   TS1 GERÇEK mesajlar (toplu-autostart.cjs, toplu-restart.cjs, autostart-dogrulama.cjs, Ansible server_hub_fix.sh;
//       betik mesajı Portal'da "canlı okumada: <mesaj>" olarak öğeye yazılır) doğru kümeye düşer
//   TS2 sıra: domain kapalı > tarama eski ("artık aday değil (JBoss 8 domain kapalı ...)"); İPTAL durumu metinle
//       ezilir ("plan eskidi"); YARIM_KALDI "AWX'e gitmiş olabilir" iptal kümesi (bağlantı değil); "AWX çıktısına bakın"
//       tek başına bağlantı değildir
//   TS3 sayım: yalnız başarısız durumlar, yalnız sıfır olmayan kümeler, sabit sıra; süzme
import { describe, it, expect } from 'vitest';
import {
  AUTOSTART_BASARISIZ,
  KATEGORI,
  KATEGORI_SIRASI,
  RESTART_BASARISIZ,
  kategoriSayimi,
  kategoriyeGore,
  siniflandir,
  type TopluKategori,
} from '@/components/server_hub/topluSiniflama';

const ORNEK: [string, string, TopluKategori][] = [
  // ── host controller / domain kapali ──
  [
    'FAIL',
    "canlı okumada: host controller'a baglanilamadi ya da adi okunamadi (controller gbbfaa01:9990, :read-attribute(name=local-host-name)): Failed to connect to the controller: The controller is not available at gbbfaa01:9990: java.net.ConnectException: WFLYPRT0053: Could not connect to remote+http://gbbfaa01:9990. The connection failed: Connection refused - HICBIR SEY DEGISMEDI (auto-start / server-config yalniz calisan host controller uzerinden degisir; XML elle duzenlenmez)",
    'hc_kapali',
  ],
  ['DUSTU', "canlı okumada: host controller'a baglanilamadi ya da adi okunamadi (controller x:9990, :read-attribute(name=local-host-name)): - HICBIR SEY DEGISMEDI", 'hc_kapali'],
  ['DUSTU', 'seçim doğrulamasında düştü: artık aday değil (JBoss 8 domain kapalı (taramada host controller çalışmıyordu) — auto-start canlı okunamaz; iş açılmaz.)', 'hc_kapali'],
  ['DUSTU', 'onay anında: JBoss 7 domain kapalı (taramada host controller çalışmıyordu) — auto-start canlı okunamaz; iş açılmaz.', 'hc_kapali'],
  // metin kesilse de (M(..., 1000)) "domain kapalı" tek başına yeter
  ['DUSTU', 'seçim doğrulamasında düştü: artık aday değil (JBoss 7 domain kapalı', 'hc_kapali'],
  // ── ortam / yetki ──
  ['DUSTU', 'canlı okumada: yedek dizini acilamadi: /sw/WAS_IMAGES/server-hub-backup/GBX - mkdir: cannot create directory: Permission denied - HICBIR SEY DEGISMEDI', 'ortam_yetki'],
  ['FAIL', 'jboss-cli was olarak kosulmuyor (betik www ile kostu; fix play become_user was olmali)', 'ortam_yetki'],
  ['FAIL', 'gecici dizin acilamadi', 'ortam_yetki'],
  ['FAIL', "dzdo izin vermedi (www -> was): kural listesine '/usr/jboss/bin/jboss-cli.sh' eklenmeli", 'ortam_yetki'],
  ['FAIL', "Sorry, user www is not allowed to execute '/bin/bash -lc ...' as was", 'ortam_yetki'],
  // ── tarama eski / zaten hedefte ──
  ['DUSTU', 'canlı değer zaten false — tarama eski (app1 auto-start zaten false (host=master, CLI))', 'tarama_eski'],
  ['SKIP', 'app1 auto-start zaten false (host=master, CLI)', 'tarama_eski'],
  ['DUSTU', 'seçim doğrulamasında düştü: artık aday değil (tarama değişti)', 'tarama_eski'],
  ['DUSTU', 'seçim doğrulamasında düştü: artık aday değil (eylem değişti)', 'tarama_eski'],
  ['IPTAL', 'plan eskidi (15 dk)', 'tarama_eski'],
  ['IPTAL', 'önizleme eskidi (15 dk)', 'tarama_eski'],
  ['DUSTU', 'önizlemede düştü: fark kalmadı', 'tarama_eski'],
  ['DUSTU', 'önizlemede düştü: JVM artık çalışmıyor', 'tarama_eski'],
  ['DUSTU', "onay anında: app1 son taramada ÇALIŞIYOR — çalışan JVM'in auto-start'ı kapatılmaz (betik reddeder); iş açılmadı. Önce JVM'i durdurun, sonra sunucuyu yeniden tarayın.", 'tarama_eski'],
  ['FAIL', "app1 su an CALISIYOR; calisan JVM'in auto-start'i kapatilmaz (FORCE=true ile zorlanabilir)", 'tarama_eski'],
  // ── tanim ──
  ['DUSTU', "canlı okumada: app1 bu host controller'da (host=master) tanimli degil - HICBIR SEY DEGISMEDI", 'tanim'],
  ['DUSTU', 'seçim doğrulamasında düştü: Taramada bu sunucuda aynı adlı JVM iki kez var (iki kayıt) — hangisi olduğu belirsiz, iş açılmaz; sunucu ayrıntısından bakın.', 'tanim'],
  ['FAIL', 'app1 auto-start ifade (${...}) ile tanimli; Portal\'dan degistirilmez (elle)', 'tanim'],
  // ── iptal / yarim kaldi ──
  ['IPTAL', 'iptal edildi', 'iptal'],
  ['IPTAL', 'iptal edildi (çalıştırılmadı)', 'iptal'],
  ['YARIM_KALDI', 'Portal yeniden başladı — çalıştırılmadı', 'iptal'],
  ['YARIM_KALDI', "AWX'e gitmiş olabilir — AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın", 'iptal'],
  ['YARIM_KALDI', "iş numarası yazılamadı — AWX'e gitmiş olabilir; AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın", 'iptal'],
  ['DUSTU', 'kayıt yarım kaldı', 'iptal'],
  // ── baglanti / sure / AWX ──
  ['DUSTU', 'plan başlatılamadı: AWX 503', 'baglanti_sure'],
  ['DUSTU', "plan işi #77 3 saatte bitmedi — AWX'ten kontrol edin", 'baglanti_sure'],
  ['FAIL', "iş #88 3 saatte bitmedi — sonucu AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın", 'baglanti_sure'],
  ['FAIL', 'iş başlatılamadı: ETIMEDOUT', 'baglanti_sure'],
  ['FAIL', 'sonuç okunamadı (iş #9 failed)', 'baglanti_sure'],
  ['FAIL', 'canlı okumada: cli_timeout', 'baglanti_sure'],
  ['DUSTU', "seçim doğrulanamadı: 10 dakikada başarılamadı — taze değerlendirme (TBMWANS kapalı); JVM'e dokunulmadı", 'baglanti_sure'],
  ['FAIL', "restart isteği belirsiz hatayla döndü (AWX'te sürüyor olabilir): socket hang up — AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın", 'baglanti_sure'],
  ['DUSTU', "önizlemede düştü: tarama işi #5 failed; sonuç (set_stats) okunamadı — AWX'ten kontrol edin", 'baglanti_sure'],
  ['FAIL', 'host GBX unreachable', 'baglanti_sure'],
  // ── diger ──
  ['FAIL', 'restart işi #4 bitti ama JVM STARTED olmadı (30 × 5 sn) — AWX çıktısına bakın; aynı uygulamanın bekleyen kopyaları atlandı', 'diger'],
  [
    'KAPANMADI',
    "restart edildi ama fark kapanmadı — tarama yanlış uyarı veriyor olabilir (server-group jvm ayarı domain.xml'de olabilir ya da host XML diskte değişmiş ama host controller yeniden yüklenmemiş olabilir)",
    'diger',
  ],
  ['FAIL', 'restart sonrası taramada JVM çalışmıyor (iş #4) — aynı uygulamanın bekleyen kopyaları atlandı', 'diger'],
  ['ATLANDI', "aynı uygulamanın kopyası A/app1 restart'ta ayağa kalkmadı — bu kopya korunmak için çalıştırılmadı", 'diger'],
  ['FAIL', 'CLI basarili gorundu ama geri okunan auto-start=true (host=master)', 'diger'],
  ['FAIL', '', 'diger'],
];

// İnceleme (2026-11-15) bulguları: her satır kaynaktaki GERÇEK şablondan (yer tutucular örnek değerle).
const INCELEME: [string, string, TopluKategori][] = [
  // B-F1 bayat tarama -> tarama eski (autostart-dogrulama.cjs:97 onay anında / atlandı; toplu-restart.cjs:199)
  ['DUSTU', 'onay anında: GBX01 taraması bayat (bayat kanıt: 2026-11-10) — auto-start değiştirilemez, iş açılmadı. Önce sunucuyu yeniden tarayın.', 'tarama_eski'],
  ['DUSTU', 'atlandı: GBX01 taraması bayat (bayat kanıt: 2026-11-10, son yükleme dışlandı) — auto-start değiştirilemez, iş açılmadı. Önce sunucuyu yeniden tarayın.', 'tarama_eski'],
  ['ATLANDI', 'atlandı: tarama bayat (2026-11-10) — önce sunucuyu yeniden tarayın.', 'tarama_eski'],
  ['DUSTU', 'önizlemede düştü: tarama bayat (2026-11-10, son yükleme dışlandı) — önce sunucuyu yeniden tarayın.', 'tarama_eski'],
  // B-F2 "artık aday değil (<iç neden>)": iç neden kazanır (toplu-autostart.cjs:486 / toplu-restart.cjs:643)
  ['DUSTU', 'seçim doğrulamasında düştü: artık aday değil (Taramada bu sunucuda aynı adlı JVM iki kez var (iki kayıt) — hangisi olduğu belirsiz, iş açılmaz; sunucu ayrıntısından bakın.)', 'tanim'],
  ['DUSTU', 'seçim doğrulamasında düştü: artık aday değil (JBoss sürümü (7/8) taramada belirlenemedi — iş açılmaz.)', 'tanim'],
  ['DUSTU', 'seçim doğrulamasında düştü: artık aday değil (GBX01 taraması bayat (bayat kanıt: 2026-11-10) — auto-start değiştirilemez, iş açılmadı. Önce sunucuyu yeniden tarayın.)', 'tarama_eski'],
  // B-F3 server_hub_fix.sh backup() "yedek alinamadi: $1 -> $BK"
  ['FAIL', 'canlı okumada: yedek alinamadi: /usr/jboss8/domain/configuration/host.xml -> /sw/WAS_IMAGES/server-hub-backup/GBX01/20261115', 'ortam_yetki'],
  // B-F4 ortam / tanım / tarama
  ['DUSTU', "onay anında: GBX01 üzerinde app1 yalnız envanterde (MWAppsInventory) — taramada JVM'i yok, auto-start değiştirilemez; iş açılmadı.", 'tanim'],
  ['ATLANDI', "atlandı: envanterde (MWAppsInventory) eşleşen uygulama yok — OpsX restart'ı uygulama adıyla çalışır; OpsX'ten tek tek.", 'tanim'],
  ['DUSTU', 'önizlemede düştü: JBoss sürümü (7/8) bilinmiyor.', 'tanim'],
  ['DUSTU', 'önizlemede düştü: fark artık ölçülemiyor', 'tarama_eski'],
  ['DUSTU', 'önizlemede düştü: JVM yeni taramada yok', 'tarama_eski'],
  ['FAIL', 'jboss-cli yok (/usr/jboss8/bin) - HICBIR SEY DEGISMEDI', 'ortam_yetki'],
  ['FAIL', "CLI hatasi: Error: Could not find or load main class org.jboss.modules.Main java: '/usr/jboss8/jdk/bin/java' yok, JAVA_HOME='/usr/jboss/jdk' gecersiz; PATH'teki java denendi", 'ortam_yetki'],
  ['FAIL', "canlı okumada: host controller'a baglanilamadi ya da adi okunamadi (controller x:9990, :read-attribute(name=local-host-name)): java: '/usr/jboss8/jdk/bin/java' yok, JAVA_HOME='' gecersiz; PATH'teki java denendi - HICBIR SEY DEGISMEDI", 'ortam_yetki'],
  // B-F5 "Connection refused" yalnız controller bağlamında host controller
  ['DUSTU', "seçim doğrulanamadı: 10 dakikada başarılamadı — Taze değerlendirme okunamadı (connect ECONNREFUSED 10.1.1.1:1433 Connection refused); JVM'e dokunulmadı", 'baglanti_sure'],
  ['FAIL', 'WFLYPRT0053: Could not connect to remote+http://gbbfaa01:9990. The connection failed', 'hc_kapali'],
  // B-F6 hiç çalıştırılmayan satır (toplu-restart.cjs topluDurdur): içteki neden başka öğenindir
  ['ATLANDI', "atlandı: toplu iş durduruldu: GBX01/app1 restart isteği belirsiz hatayla döndü (AWX'te sürüyor olabilir): socket hang up — sonucu AWX'ten kontrol edin, sonra kalanlar için yeni toplu iş açın", 'iptal'],
  ['ATLANDI', "atlandı: toplu iş durduruldu: GBX01/app1 host controller'a baglanilamadi — sonucu AWX'ten kontrol edin, sonra kalanlar için yeni toplu iş açın", 'iptal'],
  ['ATLANDI', "atlandı: prod — OpsX'ten tek tek (Smart onayı; toplu restart prod'a dokunmaz).", 'diger'],
  // B-F7 restart kanıtı yok -> kardeşleriyle aynı küme; şema okunamadı Portal tarafı
  ['FAIL', 'restart kanıtı yok: set_stats STARTED yok ve süreç başlangıç zamanı ölçülemedi (iş #12) — AWX çıktısına bakın', 'diger'],
  ['ATLANDI', 'atlandı: Server Hub şeması (sys.columns) okunamadı — eylem önerilmez.', 'diger'],
  ['DUSTU', "plan okunamadı (iş #123 failed; set_stats yok — AWX'teki server_hub_fix.yml jboss_autostart_items kipini tanımıyor olabilir (playbook güncel mi?))", 'ortam_yetki'],
];

describe('topluSiniflama', () => {
  it('TS4 inceleme bulguları: gerçek şablonlar doğru kümede', () => {
    for (const [durum, neden, beklenen] of INCELEME) expect([neden, siniflandir(neden, durum)]).toEqual([neden, beklenen]);
    expect(KATEGORI.iptal.etiket).toMatch(/durduruldu/);
    expect(KATEGORI.diger.ne).toMatch(/OpsX/);
  });

  it('TS1 gerçek mesajlar doğru kümeye düşer', () => {
    for (const [durum, neden, beklenen] of ORNEK) expect([neden, siniflandir(neden, durum)]).toEqual([neden, beklenen]);
    expect(siniflandir(null, 'FAIL')).toBe('diger');
    expect(siniflandir(null, 'IPTAL')).toBe('iptal');
  });

  it('TS2 her kümenin Türkçe etiketi ve "ne yapılır" satırı var; İptal yazımı', () => {
    for (const k of KATEGORI_SIRASI) {
      expect(KATEGORI[k].etiket.length).toBeGreaterThan(2);
      expect(KATEGORI[k].ne.length).toBeGreaterThan(20);
    }
    expect(KATEGORI.iptal.etiket).toMatch(/^İptal/);
    expect(Object.values(KATEGORI).some((x) => /Vazgeç/.test(x.etiket + x.ne))).toBe(false);
    expect(KATEGORI.hc_kapali.ne).toMatch(/domain açılınca sunucuyu yeniden tarayıp yeniden planlayın/);
    expect(KATEGORI.ortam_yetki.ne).toMatch(/dzdo/);
  });

  it('TS3 sayım: yalnız başarısız, yalnız sıfır olmayan, sabit sıra; süzme', () => {
    const og = [
      { durum: 'OK', neden: 'app auto-start=false (host=m, CLI ile dogrulandi)' },
      { durum: 'FAIL', neden: 'Connection refused gbbfaa01:9990' },
      { durum: 'DUSTU', neden: 'canlı değer zaten true — tarama eski' },
      { durum: 'FAIL', neden: "host controller'a baglanilamadi" },
      { durum: 'PLAN_GECTI', neden: 'canlı değer hâlâ uyumsuz' },
    ];
    expect(kategoriSayimi(og, AUTOSTART_BASARISIZ)).toEqual([
      { kategori: 'hc_kapali', adet: 2 },
      { kategori: 'tarama_eski', adet: 1 },
    ]);
    expect(kategoriyeGore(og, AUTOSTART_BASARISIZ, 'hc_kapali').map((o) => o.durum)).toEqual(['FAIL', 'FAIL']);
    expect(kategoriyeGore(og, AUTOSTART_BASARISIZ, null)).toHaveLength(5);
    // secili kume bosaldiysa (yenilenen liste) hepsi
    expect(kategoriyeGore(og, AUTOSTART_BASARISIZ, 'iptal')).toHaveLength(5);
    expect(RESTART_BASARISIZ.has('KAPANMADI')).toBe(true);
    expect(RESTART_BASARISIZ.has('KAPANDI')).toBe(false);
    expect(AUTOSTART_BASARISIZ.has('OK')).toBe(false);
  });
});
