# LogX v2 — Legacy (JBoss) log keşfi ve transferi

Bu dizinde iki playbook var:

| Playbook                    | AWX iş tipi        | Ne yapar                                                               |
| --------------------------- | ------------------ | ---------------------------------------------------------------------- |
| `logx_legacy_discovery.yml` | `legacy_discovery` | Seçilen uygulamanın kaynak sunuculardaki log dosyalarını listeler      |
| `logx_legacy_transfer.yml`  | `legacy_transfer`  | Seçilen dosyaları kaynak sunucuda ZIP'leyip paylaşımlı staging'e yazar |

Playbook dosyalarında `#` açıklama satırı **yoktur** (kullanıcı kuralı: playbook içinde yorum
yok). Tüm açıklamalar, gerekçeler ve tuzak notları bu README'dedir. Bir görevin neden öyle
yazıldığını merak ediyorsanız önce buraya bakın.

## Kopyalar ve yayın

- Dizin iki depoda **byte-aynı** tutulur: Portal `server/ansible/bmw_portal/logx/legacy/` ve
  Ansible deposu `bmw_portal/logx/legacy/`. AWX, Ansible deposundaki kopyayı koşturur.
- İlk sürümde bu dosyalar "referans/teslim" amacıyla yazılmıştı (prod playbook'u yazacak kişiye
  extra_vars ve JSON çıktı sözleşmesini anlatmak için; LogX v2 uygulama planı, Bölüm H). Bugün
  Ansible deposundaki kopya üretimde koşan playbook'tur.
- Portal playbook'u **kendisi çalıştırmaz**: AWX iş şablonunu başlatır ve sonucu YALNIZ AWX işinin
  `artifacts` alanındaki `logx_result` anahtarından okur. Ham stdout ASLA parse edilmez.
- Yayın kontrol listesi: iki playbook ve bu README için iki depo arasında `diff -q` boş olmalı.
  Portal bekçisi bunu `LOGX_ANSIBLE_DEPO=<ansible deposu kökü>` verildiğinde sınar
  (`logx-legacy-olculemedi.test.cjs`, X05). LogX değişikliği Ansible deposunda AYRI commit'tir
  ve Server Hub değişiklikleriyle karıştırılmaz; geri alınacaksa iki depoda aynı revizyona
  bağımsız geri alınır.

## Hangi kullanıcıyla okunur, hangisiyle yazılır

- Kullanıcı kuralı: JBoss'a ait her şey `was` ile; HTTP sunucuları (RHA, IHS, Nginx) `www` ile.
- Legacy akışı YALNIZCA `/vhosting` ve `/vhosting8` altını tarar (`legacy_log_roots`); ikisi de
  JBoss'tur, dolayısıyla loglar `was` ile okunur. Buraya JBoss dışı (HTTP sunucusu) bir yol
  eklenirse `become_user` seçimi yola göre ayrılmalıdır; bekçi kök listesini kilitler.
- Okuma kullanıcısı değişkendir: `logx_legacy_user`, varsayılan `was`. Sabit kodlanmaz.
- Keşif yalnız OKUR (find); play düzeyinde `become: true`, `become_user: was`,
  `become_method: dzdo`.
- Transferde yetki BÖLÜNMÜŞTÜR (üretim olayı 2026-10-01, ESJBOT02): kaynak logu OKUYAN görevler
  (stat ve geçici ZIP) görev düzeyinde `was`/dzdo ile; staging/fallback'e YAZAN görevler
  (copy `remote_src`, dizin oluşturma) bağlanan kullanıcıyla. Play'in tamamını `was` yapmak
  YANLIŞTI: staging (`/sw/BMW_PORTAL/logs/legacy`) ve fallback dizinleri bağlanan kullanıcınındır,
  `was` oraya yazamayabilir ve Portal'ın geri okuması `was`'ın dizinini okuyamaz.
- Playbook düzeyindeki Ansible become (`dzdo -u was /bin/sh -c ...`) "dzdo içinde sarmalayıcı
  yok" kuralının kullanıcı onaylı istisnasıdır (sözleşme ek S2); yeni become eklenmez.
- `ansible_pipelining: true`: ayrıcalıksızdan ayrıcalıksıza (`uxmid` -> `was`) geçişte pipelining
  kapalıyken Ansible modül geçici dosyasının iznini setfacl/chown/chmod ile açmaya çalışır; hiçbiri
  tutmazsa "Failed to set permissions on the temporary files" ile DÜŞER (job 3339002'de 130
  sunucuda yaşandı). `was`'a geçen görevi olan her kaynak play pipelining kullanır.
  KÖRLÜK: AWX envanteri `ansible_pipelining=false` ile bunu ezebilir; kanarya ile doğrulanır.

## `logx_legacy_discovery.yml` — keşif

### Girdi (extra_vars)

| Değişken           | Tip    | Anlamı                                                                                                                                                                    |
| ------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_name`         | string | Kullanıcının seçtiği uygulama adı (uygulama envanteri tablosunun `app` sütunu). Yalnız dosya/klasör filtrelemesi için kullanılır; ASLA bir kabuk komutuna yerleştirilmez. |
| `target_hosts`     | string | Virgülle ayrılmış, BÜYÜK HARF host listesi (Portal envanterden önceden çözer; elle girilen adlar biçim kapısından geçer). Verilmezse `all`.                               |
| `logx_legacy_user` | string | İsteğe bağlı okuma kullanıcısı, varsayılan `was`.                                                                                                                         |

### Çıktı sözleşmesi (`set_stats` -> `logx_result`)

```json
{
  "overall_status": "success | partial | failed",
  "hosts": [
    {
      "host": "GBJBOT22",
      "status": "ok | unreachable | error",
      "error": "...",
      "files": [
        {
          "path": "/vhosting8/APP-T.ear/logs/SystemOut.log",
          "size": 12345,
          "mtime": "2026-07-14T10:00:00Z"
        }
      ],
      "log_dir_regex": "logs?[0-9]*"
    }
  ],
  "log_dir_regex": "logs?[0-9]*"
}
```

- `files` öğeleri `find` modülünün ham sözlüğüdür (`path`, `size`, `mtime` ve diğer stat
  alanları); bir sonraki düzenleme yalnız bu üç anahtarı seçecek şekilde daraltabilir.
- `overall_status`: hiçbir host `ok` değilse `failed`; hepsi `ok` ise `success`; aksi `partial`.
- Portal `failed`'da isteği "Tüm sunucularda keşif başarısız oldu." ile kapatır; ekranda yalnız
  `status == ok` hostların dosyaları gösterilir, diğerleri "Taranamayan sunucular" listesindedir.
- **`hosts[].error` EKRANA ÇIKAR** (2026-10-07): `status != ok` olan her sunucu, sebebiyle
  birlikte hem kısmi keşifte (dosya seçimi) hem de keşif tümüyle düştüğünde (hata ekranı)
  listelenir. Metin kullanıcıya bir cümlelik özetle birlikte AYNEN gösterilir; yolu, asıl hatayı
  ve denenen kullanıcıyı taşımaya devam etmelidir. Özet kuralları `src/utils/legacySebep.ts`
  içindedir ve bu metinlerdeki sabit ifadelere dayanır (bkz. "Portalın okuduğu alanlar").

### Güvenlik

- Dosya keşfi `ansible.builtin.find` MODÜLÜ ile yapılır (kabuk `find` komutu DEĞİL).
  `app_name` kabuk meta karakteri (`;`, ters tırnak, `$()` vb.) içerse bile enjeksiyon olmaz:
  değer hiçbir kabuk komutuna girmez, yalnız Ansible'ın kendi Jinja `select`/`search`
  filtresiyle sonuç listesi içinde süzülür. `follow: false` sembolik bağlantı kaçışını engeller.
- Karşılaştırma: kaldırılan `server/ansible/playbooks/fetch_remote_logs.yml` yedeği
  `ansible.builtin.shell` ile `"{{ log_path }}"` Jinja dizesini doğrudan komuta yerleştiriyordu —
  gerçek bir kabuk enjeksiyonu yüzeyiydi. Bu playbook o deseni bilinçli olarak kullanmaz.

### Akış

1. EAR klasörleri: `legacy_log_roots` altında `<app_name>*.ear` dizinleri (daraltılmış keşif).
2. Log dizinleri: bulunan EAR'ların hemen altındaki `log`, `logs` ve numaralı olanlar
   (`log1`, `log2`, `logs1`, `logs2`, …) — bkz. "Log dizini adları" (stat döngüsü olmadan).
3. Dosyalar: yalnız bu log dizinlerinde, özyinelemeli.
4. Süzme: yol bir log dizini segmenti (aynı desen) ve `app_name` içermeli.
5. Ölçüm sorunları toplanır (aşağıda), `host_result` kurulur, host `logx_discovered` grubuna
   eklenir.
6. Ayrı localhost play'i tüm hostların `host_result`'ını TEK artifact olarak yayınlar.

### Log dizini adları (2026-10-07)

Kullanıcı isteği: `…/log|logs/…` yanında `…/log1|log2|logs1|logs2…/…` gibi dizinlerden de log
alınabilmeli. Eskiden yalnız `log` ve `logs` taranıyordu; numaralı dizinlerdeki dosyalar hiç
listelenmiyor, ekran "dosya bulunamadı" diyordu.

- **Tek kaynak:** play değişkeni `legacy_log_dir_regex` (varsayılan `logs?[0-9]*`). Hem dizin
  bulan `find` görevi (`patterns: "^(…)$"`, `use_regex: true` — desen dizin ADINA uygulanır)
  hem de son süzgeç (`/(…)/` yol segmenti) bu değişkenden türer. İkisi ayrışırsa `find`'ın
  bulduğu dizinin dosyaları süzgeçte düşer ve yine "dosya yok" görünür.
- **Eşleşen:** `log`, `logs`, `log1`, `log2`, `log10`, `logs1`, `logs2`, `logs25` …
- **Bilerek eşleşmeyen:** `log4j`, `logs_old`, `logs.bak`, `logsX`, `log-1`, `mylogs`, `Logs`.
  Desen yalnız rakam ekine izin verir: yapılandırma ya da yedek dizinlerinin içeriği "log" diye
  listelenip indirilebilir olmasın. Başka bir ad kalıbı gerekirse yalnız bu değişken genişletilir.
- Kapsam değişmedi: yalnız EAR klasörünün HEMEN altındaki dizinler (`recurse: false`), yalnız
  dizinler, sembolik bağ izlenmez.
- **Desen artifact'ta yayınlanır:** her `host_result` ve birleşik `logx_result` bir
  `log_dir_regex` alanı taşır. Bu klasör AWX'e ELLE kopyalandığı için kopya eski kalabilir; o
  zaman numaralı dizinler SESSİZCE taranmaz. Portal alanın yokluğundan bunu anlar ve dosya
  seçim ekranında "eski keşif playbook'u — numaralı dizinler taranmadı" uyarısını gösterir.

### Ölçülemedi ile yok karışmaz (kural 6, sözleşme LX2)

Eskiden find görevleri `ignore_errors: true` + boş varsayılanlarla koşuyordu ve sonuç yalnız
son find'a bakıyordu: `was` geçişi reddedilse, find bir dizini okuyamasa ya da host erişilemez
olsa bile sonuç "ok + 0 dosya" = "dosya yok" çıkıyordu. Artık:

- Üç find görevinin her biri için ("Keşif ölçüm sorunlarını topla" görevi, find görev adlarını
  etiket olarak taşır):
  - sonuç `failed` ise -> `error`; mesaj `msg` + `module_stderr` (ilk 300 karakter),
  - sonuç `unreachable` ise -> `unreachable`; mesaj bağlantı hatası,
  - `skipped_paths` doluysa -> `error`; mesaj okunamayan yol sayısı, ilk 5 yol ve ilk sebep.
- Sorun varsa `host_result = {status: error|unreachable, error: "<görev adı>: <mesaj> (kosan: <kullanıcı>)", files: []}`.
  Kısmi liste "tam" diye sunulmaz: okunamayan bir alt dizin varken bulunan dosyalar da
  gösterilmez, hata görünür.
- **Kök-yok istisnası (DAR):** `find` modülü verilen kök dizin yoksa onu da `skipped_paths`'e
  `'<kök>' is not a directory` diye yazar. Bir JBoss7 hostunda `/vhosting8`, bir JBoss8
  hostunda `/vhosting` yoktur; bunu hata saymak TÜM hostları `error` yapardı. Yalnız
  `legacy_log_roots` içindeki bir kök VE sebebi "is not a directory" olan kayıt sayılmaz (o kök
  ölçülmüştür: yok). Kökün kendisi başka bir sebeple (ör. G/Ç hatası) atlanmışsa yine `error`.
- `ignore_unreachable: true` iken erişilemeyen host durmaz; `set_fact`/`group_by` bağlantı
  istemediği için koşmaya devam eder ve kendisini `unreachable` olarak bildirir.
- `skipped_paths` ansible-core 2.12 ile geldi. Daha eski bir AWX yürütme ortamında alan gelmez ve
  okunamayan alt dizinler SESSİZ kalır (modül eski sürümde yürüyüş hatalarını yutuyordu).
- Bilinen bedel: kökte `was`'ın okuyamadığı bir dizin (ör. ext4 `lost+found`, root 0700) varsa o
  host `error` görünür ve dosyaları listelenmez. Bu bilerek seçildi (gizli kısmi sonuç yerine
  görünür hata); kanaryada ölçülür.

### Rescue ve toplayıcı

- `rescue` YALNIZCA görev hatalarını yakalar; SSH/DNS kesintisini (unreachable) YAKALAMAZ. O durumda
  host `unreachable` işaretlenir ve TÜM hostlar böyle düşerse Ansible "NO MORE HOSTS LEFT" ile
  SONRAKİ PLAY'LERİ ATLAR — toplayıcı play hiç çalışmaz. `rescue` ve `ignore_unreachable`
  BİRLİKTE gerekir.
- RESCUE (2026-08-28): bir görev düşerse host ölmez, sebep kaydedilir. Bu play'deki TÜM hostlar
  düşerse `set_stats`'in TEK yazarı olan toplayıcı play hiç çalışmaz, sonuç sözleşmesi
  yayınlanmaz ve Portal "sonuç gelmedi" der (üretimde Telnet'te yaşandı). Rescue bilerek yeniden
  `fail` ETMEZ. v3 ile rescue ayrıca `host_result = {status: error, error: <sebep> (kosan: ...), files: []}`
  yazar ve hostu `logx_discovered` grubuna ekler; eskiden rescue edilen host artifact'tan SESSİZCE
  düşüyordu.
- Per-host `set_stats` ÇAĞRILMAZ (çoklu-host düzeltmesi): eskiden her host
  `logx_result.hosts: [<yalnız kendisi>]`'ni `aggregate: true` ile yayıyordu; bir sözlük üzerinde
  aggregate son gelen hostun öncekini EZİYORDU ve 5 sunuculu uygulamada yalnız 1 sunucu
  görünüyordu. Çözüm: her host `logx_discovered` grubuna girer; birleştirme ayrı localhost
  play'inde, `hostvars`'tan `host_result` toplanıp TEK KEZ (`aggregate: false`) yayınlanarak yapılır.
- `strategy: free` altında play içi `run_once` güvenilmez olduğundan toplama AYRI bir localhost
  play'indedir. Tek-host durumunda da aynı yol çalışır (grup 1 host içerir).
- Toplayıcı **hedeflenen** host listesini kurar: `target_hosts` virgülle bölünür; envanterdeki bir
  grup adı o grubun hostlarına açılır; `target_hosts` yoksa `all`. Hedeflenip sonuç bildirmeyen
  her host `{status: unreachable, error: "sonuc bildirmedi", files: []}` olarak eklenir; ad AWX
  envanterinde hiç eşleşmediyse mesaj `sonuc bildirmedi (AWX envanterinde eslesmedi)` olur
  (Portal'dan elle girilen ve AWX'te olmayan bir sunucu eskiden sonuçtan sessizce kayboluyordu).
  Joker karakterli desenler (ör. `GBJBO*`) açılmaz, olduğu gibi listelenir.
- AWX işi kırmızı kalsın (2026-08-28): rescue hostu ayakta tuttuğu için, bu kural olmasaydı hiçbir
  şey çalışmadığı halde iş "successful" görünürdü. Hiçbir host `ok` değilse toplayıcı `fail` eder.
  `set_stats` bu görevden ÖNCE çalıştığı için artifact zaten yayınlanmıştır: Portal düzgün sonucu
  alır, AWX doğru şekilde "failed" der.

## `logx_legacy_transfer.yml` — transfer

### Girdi (extra_vars)

```yaml
selected_files:
  - host: GBJBOQ01
    path: /vhosting/application/logs/application.log
  - host: GBJBOQ02 # çoklu host desteklenir
    path: /vhosting/application/logs/application.log
staging_dir: /sw/BMW_PORTAL/logs/legacy
fallback_dir: /tmp/logx-v2-fallback
archive_name: fa52e9adfd9fc71572ea8c7b15b65ed4.zip
```

- Portal `archive_name`'i 128 bit rastgele üretir; her `(host, path)` çifti keşif sonucuyla
  birebir eşleşmek zorundadır (anti-TOCTOU, Portal tarafında).
- Dosyalar AWX/controller'a fetch EDİLMEZ; her host kendi diskindeki logları kendisi ZIP'ler.
- `community.general` koleksiyonu gerekir (`community.general.archive`).

### Çıktı sözleşmesi (`set_stats` -> `logx_result`)

`overall_status`, `staged_path`, `filename`, `size_bytes`, `is_fallback`, `error` ve tek-host'ta
`per_file_status`, çoklu-host'ta `hosts[]` (`host`, `status`, `part_filename`, `size_bytes`,
`per_file_status`, `error`). Portal `staged_path`/`filename`/`size_bytes`/`is_fallback` ile
indirme jetonu üretir; `overall_status` denetim kaydına yazılır.

### Portalın okuduğu alanlar (2026-10-07)

Eskiden portal yalnızca arşiv alanlarına bakıyordu: aktarım düştüğünde ekran "Transfer başarısız
oldu." deyip susuyor, aktarım KISMİ bittiğinde ise (bazı dosyalar ya da sunucular arşivde yok)
arşiv hiçbir uyarı olmadan "hazır" diye sunuluyordu. Artık şu alanlar ekrana çıkar:

| Alan                                                                                | Nerede gösterilir                                                                        |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| üst düzey `error`                                                                   | hata ekranı (çoklu-host birleştirme hatası)                                              |
| `hosts[].status`, `hosts[].error`                                                   | hata ekranı ve indirme ekranındaki "arşiv eksik" uyarısı: dosya alınamayan sunucular     |
| `per_file_status[].status`, `.error`, `.path` (üst düzeyde ya da `hosts[]` altında) | "arşiv eksik" uyarısı: arşive girmeyen dosyalar ve seçilen / giren / alınamayan sayıları |

Üç biçim de okunur: tek-host arşivli (üst düzey `per_file_status`), tek-host arşivsiz (yalnız
`hosts[{host, status, error}]`, dosya sebepleri metnin içinde), çoklu-host (`hosts[]` altında
`per_file_status`).

**Bu alanların adı ya da biçimi değişirse ekran sessizce boş kalır.** Bunu iki test bağlar:
`logx-legacy-gercek-kosum.test.cjs` LG5 her biçimi GERÇEK koşumla üretip
`src/components/logx_v2/__tests__/fixtures/legacy-sonuc-ornekleri.json` ile karşılaştırır; ekran
testleri (`LegacySebepler.test.tsx`) AYNI dosyayı girdi alır. Biçim bilerek değişecekse örnek
`LOGX_ORNEK_YAZ=1 node --test server/ansible/__tests__/logx-legacy-gercek-kosum.test.cjs` ile
yeniden üretilir ve ekranın yeni biçimi okuduğu doğrulanır.

Özet kurallarının dayandığı sabit ifadeler (değiştirilirse `src/utils/legacySebep.ts` de
güncellenir): `AWX envanterinde eslesmedi`, `sonuc bildirmedi`, `okunamayan N yol`,
`Dosya bulunamadi`, `Dosya okunamiyor`, `Path normal dosya degil`,
`Bu hostta arsivlenecek okunabilir dosya yok`,
`Arsivlenecek mevcut ve okunabilir bir dosya bulunamadi`,
`hicbir kaynak hosttan parca ZIP gelmedi`, `Parca dizini aranamadi`.

### Ortak hazırlık (her kaynak host)

1. Bu hosta ait seçili dosyalar ayrılır; geçici ZIP adı (`was_tmp_zip`) burada BİR KEZ üretilir.
2. Her dosya `was` ile `stat` edilir. `per_file_status` sebepleri:
   - `stat` sonucu hiç yoksa (dzdo reddi, modül hatası, erişilemez): `Dosya was ile denetlenemedi: <msg> <module_stderr>`,
   - `stat` başarılı ve `exists=false`: `Dosya bulunamadi` (YALNIZ bu durumda),
   - normal dosya değil: `Path normal dosya degil`; okunamıyor: `Dosya okunamiyor`.
3. Geçici dizin `/vhosting(8)/dumpdir/logx-<arşiv kökü>` (0711) `was` ile oluşturulur, loglar
   `was` ile oraya ZIP'lenir (0644, bağlanan kullanıcı kopyalayabilsin). Dizin, ilk geçerli dosya
   `/vhosting8/` altındaysa `/vhosting8/dumpdir`, değilse `/vhosting/dumpdir` altındadır.
   `/tmp` KULLANILMAZ: bu hostlarda küçük (opsx_legacy_dump 2026-08-12) ve sabit bir `/tmp` yolu
   hem çakışır hem de hata/iptal durumunda arkasında 0644 log kopyası bırakır.
4. `always`: geçici dizin her durumda `was` ile silinir.

### Geçici ZIP adı (sözleşme LX7)

- Eskiden ZIP adı `<arşiv kökü>.zip` idi, yani dizin adından türetilebiliyordu. `dumpdir`
  listelenebiliyorsa (heap dump dizinleri sıklıkla geniş izinli; ÖLÇÜLMEDİ) yerel bir kullanıcı
  yolu kurup kopya penceresinde ZIP'i okuyabilirdi.
- Artık bloğun İLK `set_fact` görevinde BİR KEZ:
  `was_tmp_zip: "{{ lookup('ansible.builtin.password', '/dev/null chars=ascii_lowercase,digits length=24') }}.zip"`.
  `/dev/null` yolu password lookup'ın özel durumudur: her çağrıda yeni rastgele değer üretir ve
  hiçbir yere yazmaz. Parametreler terim dizesi biçimindedir (eski ve yeni ansible-core sürümleri
  aynı şekilde ayrıştırır; anahtar kelime biçimi eski sürümlerde yok sayılırdı).
- `vars:` altında lookup YOK: play vars TEMBEL değerlendirilir, her başvuruda yeni ad üretilir ve
  archive, copy ve always FARKLI yollar görürdü. `was_tmp_archive = was_tmp_dir/was_tmp_zip`
  play vars'ta kalır (tembel; `was_tmp_dir` geçerli dosyalar belli olduktan sonra çözülmeli).
- Dizin 0711: listelenemez, ad tahmin edilemez.

### Tek-host yolu (eskisiyle birebir aynı)

1. En az bir geçerli kaynak dosya yoksa `assert` düşer; mesaj dosya başına sebebi, denenen yolları
   ve hangi kullanıcıyla denendiğini taşır -> rescue.
2. Geçici ZIP staging'e kopyalanır (bağlanan kullanıcı). Staging dizini yoksa ya da yazılamazsa
   fallback dizini oluşturulup oraya kopyalanır.
3. `host_logx_result` doğrudan nihai `logx_result` biçimindedir; ayrı localhost play'i onu
   yayınlar. Kaynak host sonuç üretememişse (transfer düştü, host erişilemedi) SENTETİK `failed`
   yayınlanır (`error` = rescue sebebi).
4. SIRA (2026-08-28): eskiden `assert` önce gelip `set_stats`'ı atlıyordu; iş doğru şekilde
   kırmızı dönüyor AMA sonuç sözleşmesi hiç yayınlanmıyordu ve Portal "yapılandırılmış sonuç
   gelmedi" deyip ham AWX log'u gösteriyordu. Artık önce sonuç yayınlanır (gerçek ya da sentetik),
   SONRA iş başarısız yapılır.

GİZLİ HATA notu: kararı `.failed` alanına bakan görev `failed_when: false` KULLANMAZ. Ansible
`failed_when: false` iken kayıttaki `failed`'ı HER ZAMAN false yazar; staging yazımı düşse bile
fallback hiç devreye girmezdi. `.failed`'ı okunan görev `ignore_errors: true` kullanır.

### Çoklu-host yolu

1. Her host KENDİ dosyalarını paylaşımlı staging altındaki `<arşiv kökü>__parts/<HOST>.zip`
   parçasına yazar (tek-host fallback yolu çoklu-host'ta uygulanmaz; tüm kaynak hostların aynı
   paylaşımlı `staging_dir`'i bağlamış olması gerekir).
2. Host sonucu `host_logx_result = {host, status, part_filename, size_bytes, per_file_status, error}`.
   Geçerli dosya yoksa mesaj dosya başına sebebi taşır; `stat` erişilemez döndüyse
   `status: unreachable` (ölçülemedi), aksi `error`.
3. Rescue (sözleşme LX2b): çoklu-host'ta `host_logx_result` yazar: `status: error`,
   `error: <rescue sebebi>`, `part_filename: ''`, `size_bytes: 0`, `per_file_status` (o ana kadar
   toplanan). Eskiden yalnız `host_blocked_reason` yazıyordu ve host toplayıcıdan sessizce
   düşüyordu.
4. Toplayıcı play (`run_once`, staging NFS'ini bağlamış bir kaynak hostta) parça ZIP'leri TEK
   `archive_name` ZIP'inde birleştirir (sonuç yine TEK arşiv: `staged_path`/`filename`/
   `size_bytes` -> Portal sözleşmesi değişmez; kullanıcı tek ZIP'i açınca her sunucunun ZIP'ini
   bulur), parça dizinini temizler ve arşiv durumunu `logx_cok_host_arsiv` fact'ine yazar
   (`mevcut`, `boyut`, `parca_sayisi`, `hata`). Toplayıcı YAYINLAMAZ. `run_once` ilk hostu
   erişilemezse Ansible sonraki görevleri bir sonraki hostta koşar ama parça araması erişilemez
   sonuç taşır; bu durumda `hata` = `Parca dizini aranamadi: <bağlantı hatası>` olur ("hiçbir
   hosttan parça gelmedi" denmez — parçalar aslında var olabilir).
5. Yayın ayrı bir localhost play'indedir ve TEK yazardır (iki yayın olsaydı `set_stats`
   aggregate ikinciyi birincinin üstüne birleştirirdi):
   - `source_hosts`'tan `host_logx_result` bildirmeyen her host
     `{status: unreachable, error: "sonuc bildirmedi"}` olarak eklenir,
   - `overall_status`: arşiv yoksa `failed`; arşiv var ve TÜM kaynak hostlar `ok` ve dosya başına
     hata yoksa `success`; aksi `partial`,
   - toplayıcı hiç koşmadıysa (`logx_cok_host_arsiv` hiçbir hostta yok) SENTETİK `failed`
     yayınlanır ve iş `fail` ile kırmızıya döner.
6. `ignore_unreachable: true` (kaynak play): rescue unreachable'ı yakalamaz; tüm hostlar böyle
   düşerse sonraki play'ler atlanırdı.

## Körlükler ve kanarya

Bekçiler: `server/ansible/__tests__/logx-legacy-run-as.test.cjs` (kullanıcı ayrımı, pipelining,
kök listesi, `failed_when` tuzağı) ve `logx-legacy-olculemedi.test.cjs` (kural 6; karar mantığı
python3 + jinja2 ile RENDER edilerek sınanır; jinja2 yoksa test açık hatayla düşer). Render
için yorumlayıcı sırası: `PORTAL_TEST_PYTHON`, PATH'teki `python3`/`python`, sonra kurulu
Ansible'ın KENDİ yorumlayıcısı (`ansible-playbook` betiğinin ilk satırı) — Ansible kuruluysa
ayrıca paket kurmak gerekmez.

`logx-legacy-gercek-kosum.test.cjs` iki playbook'u geçici bir dizin ağacında GERÇEK
`ansible-playbook` ile koşturur (yerel bağlantı, become kapalı, kökler `legacy_log_roots` ile
geçici dizine çevrilir). Render testi `find`'ın desen eşlemesini, atlanan yolları nasıl
bildirdiğini ve `archive`'ın ZIP'e ne yazdığını TAKLİT eder; bu test onları gerçekten çalıştırır:

- LG1: keşif `log`/`logs`/numaralı dizinleri bulur; `log4j`, `logs_old`, `logsX`, alt düzeydeki
  `…/alt/logs2` ve başka uygulamanın klasörünü bulmaz; desen artifact'ta yayınlanır.
- LG1b: uygulama hostta yok + köklerden biri hostta yok -> `ok` + 0 dosya (kök-yok istisnası
  `find`'ın "is not a directory" metnine dayanır; metin sürümle değişirse bu test kızarır).
- LG3: okunamayan log dizini -> `error`, yol adıyla; okunabilen dizinlerin dosyaları da
  listelenmez; iş başarısız biter ama sonuç yine yayınlanır.
- LG2: keşif -> aktarım (tek host): numaralı dizinlerden seçilen dosyalar ZIP'e girer;
  `log1/server.log` ile `log2/server.log` aynı adla birbirini ezmez; geçici dizin temizlenir.
- LG4: aktarım (iki host): host başına parça ZIP'ler tek arşivde birleşir; parça dizini ve
  geçici dizinler temizlenir.

- LG5: portalın okuduğu sonuç biçimleri (kısmi ve başarısız aktarım, tümüyle başarısız keşif)
  gerçek koşumla üretilir ve ekran testlerinin kullandığı örnek dosyasıyla karşılaştırılır.

Ansible yoksa atlanır (LG2, LG4 ve LG5'in aktarım örnekleri ayrıca `community.general.archive`
ister; LG3 ve okunamayan dosya/dizin örnekleri root ile koşulamaz).

Metinle ve render ile ölçülemeyenler (kanaryada doğrulanır):

- AWX envanteri `ansible_pipelining=false` ile pipelining'i ezebilir.
- dzdo'nun `was` become izni ve `dumpdir` modu/sahipliği.
- Gerçek Ansible yürütme semantiği: `run_once` ile `set_fact`'in tüm hostlara yayılması,
  `ignore_unreachable` sonrası hostun bağlantısız görevlere devam etmesi, toplayıcının hiç
  koşmadığı durum. Render betiği bunları Ansible belgelerindeki davranışa göre taklit eder.
- `skipped_paths` ansible-core 2.12 öncesinde yok.

Kanarya: bir JBoss hostunda Legacy keşif + tek-host transfer + iki-host transfer; `was` become'u
reddedilen bir hostta keşif `error`, transfer `error/unreachable` görünmeli ("Failed to set
permissions" ve "dosya yok" görünmemeli); kökünde `was`'ın okuyamadığı dizin olan bir hostta
keşfin `error` mesajı yolu adlandırmalı.
