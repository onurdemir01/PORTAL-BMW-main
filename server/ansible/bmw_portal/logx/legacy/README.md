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
### Legacy Python interpreter uyumluluğu (2026-10-21)

Bazı legacy JBoss sunucularında Ansible interpreter discovery varsayılan olarak
`/usr/libexec/platform-python` / `python3` üzerinden Python 3.6 seçebiliyor. Güncel AWX/Ansible
execution environment ile bu durumda `ansible.builtin.find` gibi Python gerektiren modüller,
dosya sistemi ve `was` erişimi doğru olsa bile `MODULE FAILURE` ile çalışmayabiliyor.

Sahadaki örnekte uygulama ve log dizinleri `was` kullanıcısıyla okunabiliyor ve
`/usr/libexec/platform-python` çalışıyordu; ancak sürümü 3.6.8 idi. Aynı sunucuda
`/usr/bin/python3.11` bulunduğu halde Ansible otomatik keşifte eski platform Python'ı seçiyordu.

Çözüm olarak discovery play'ine Python gerektirmeyen `ansible.builtin.raw` tabanlı bir
`pre_tasks` kontrolü eklendi:

- PATH ile `/usr/bin` ve `/usr/local/bin` altındaki Python adayları bulunur.
- Adaylar gerçekten çalıştırılarak sürümleri doğrulanır; yalnız Python `>= 3.8` kabul edilir.
- Birden fazla uygun interpreter varsa gerçek sürümü en yüksek olan seçilir ve
  `ansible_python_interpreter` yalnız bu play için ayarlanır.
- Bozuk binary/symlink veya Python olmayan `python3*` adayları otomatik elenir.
- Uygun modern Python bulunamazsa `ansible_python_interpreter` değiştirilmez; Ansible'ın normal
  interpreter discovery/fallback davranışı korunur.
- Probe görevi `failed_when: false` olduğundan interpreter araştırmasının kendisi legacy keşif
  akışını düşürmez.

Bu kontrol özellikle Python kullanan ilk `ansible.builtin.find` görevinden önce çalışır.
Amaç sunuculara yeni Python kurmak veya sistemdeki `python3` symlink'ini değiştirmek değil;
sunucuda zaten bulunan uyumlu interpreter'ı Ansible için güvenli ve dinamik olarak seçmektir.

Transfer playbook'u ek olarak yorumlayiciyi iki yetki baglaminda dogrular. Adaylar `PATH` veya
`/usr/local` altindan alinmaz; yalniz literal `/usr/bin/python3.8`–`python3.14` ve
`/usr/bin/python3` yollari taranir. Cozulmus hedefin `/usr/bin`/`/bin` altinda, root sahipli ve
grup/diger kullanicilar tarafindan yazilamaz olmasi gerekir. Ayni aday hem baglanan kullanici hem
`logx_legacy_user` (varsayilan `was`) ile Python >= 3.8 olarak calisiyorsa secilir. Ortak aday
yoksa transfer eski interpreter'a sessizce dusmez; host sonucu
`modern_python_bulunamadi` ile `failed/error` yayinlanir ve Python isteyen dosya/arsiv gorevleri
o hostta calistirilmaz.
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
- İsteğe bağlı: `logx_legacy_tmp_bases` — geçici alan aday listesi (bkz. "Geçici alan"). Portal
  göndermez; varsayılan playbook'tadır. Gerekirse AWX iş şablonunun extra_vars'ından verilir.
- Dosyalar AWX/controller'a fetch EDİLMEZ; her host kendi diskindeki logları kendisi ZIP'ler.
- `community.general` koleksiyonu gerekir (`community.general.archive`).

### Çıktı sözleşmesi (`set_stats` -> `logx_result`)

`overall_status`, `staged_path`, `filename`, `size_bytes`, `is_fallback`, `error` ve tek-host'ta
`per_file_status`, çoklu-host'ta `hosts[]` (`host`, `status`, `part_filename`, `size_bytes`,
`per_file_status`, `error`). Portal `staged_path`/`filename`/`size_bytes`/`is_fallback` ile
indirme jetonu üretir; `overall_status` denetim kaydına yazılır.

Geçici alan alanları (2026-10-13; tek-host'ta üst düzeyde, çoklu-host'ta `hosts[]` altında):
`tmp_dir` (ZIP'in yazıldığı aday dizin; arşiv üretilemediyse boş) ve `tmp_adaylar`
(`[{dir, uygun, olusturan, sebep}]` — her adayın ölçüm sonucu). Portal bunları okumaz; AWX
işinin artifact'ında teşhis içindir. Rescue ile biten tek-host sonucunda bu alanlar yoktur.

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
`hicbir kaynak hosttan parca ZIP gelmedi`, `Parca dizini aranamadi`, `Gecici alan bulunamadi`,
`ziplenemedi`.

### Ortak hazırlık (her kaynak host)

1. Bu hosta ait seçili dosyalar ayrılır; geçici ZIP adı (`was_tmp_zip`) burada BİR KEZ üretilir.
2. Her dosya `was` ile `stat` edilir. `per_file_status` sebepleri:
   - `stat` sonucu hiç yoksa (dzdo reddi, modül hatası, erişilemez): `Dosya was ile denetlenemedi: <msg> <module_stderr>`,
   - `stat` başarılı ve `exists=false`: `Dosya bulunamadi` (YALNIZ bu durumda),
   - normal dosya değil: `Path normal dosya degil`; okunamıyor: `Dosya okunamiyor`.
3. Geçici alan seçilir (bkz. "Geçici alan"): aday dizinler ölçülür, ilk uygun adayın altında
   işe özel dizin `logx-<arşiv kökü>-<sunucu adı>` açılır ve loglar `was` ile oraya ZIP'lenir
   (0644, bağlanan kullanıcı kopyalayabilsin). Yazarken düşerse sıradaki uygun aday bir kez
   denenir.
4. `always`: işe özel dizin her durumda SAHİBİYLE silinir (`was` açtıysa `was`, bağlanan
   kullanıcı açtıysa o). Aday dizinin kendisine dokunulmaz.

### Geçici alan (2026-10-13)

Loglar `was` ile okunur, teslim dizinine bağlanan kullanıcı yazar; arada `was`'ın yazıp
bağlanan kullanıcının okuyabildiği bir ara dizin gerekir. Eskiden bu dizin TEK ve sabitti:
`/vhosting(8)/dumpdir`. Sahada bir sunucuda `/vhosting8/dumpdir` **dosyaya dönüştü**; o sunucudan
log alınamadı ve ekran yalnızca "ZIP arsivi olusturulamadi" dedi. İki ayrı kusur vardı:

- **Tek dizine bağımlılık:** o dizin bozulunca başka yer denenmiyordu.
- **Sebep kayboluyordu:** dizin açılamayınca arşiv görevi ATLANIYOR, hata metni ise yalnızca
  arşiv görevinin sonucuna bakıyordu. Playbook asıl hatayı (`[Errno 20] Not a directory`)
  biliyor ama yayınlamıyordu; seçilen dosyaların hepsi "ok" görünüyordu.

**Aday listesi** — play değişkeni `logx_legacy_tmp_bases`, sırayla (kullanıcı kararı):

| Sıra | Dizin                         | Kayıt           | Ne zaman uygun                                                                  |
| ---- | ----------------------------- | --------------- | ------------------------------------------------------------------------------- |
| 1    | `staging_dir` (teslim dizini) | `tur: teslim`   | dizin var; `was` yazabiliyor ya da (0733 yolu) bağlanan kullanıcı yazabiliyor   |
| 2    | `/tmp`                        | `yuzde: 80`     | dizin yazılabilir VE seçilen dosyaların toplamı boş alanın %80'ini aşmıyor      |
| 3    | `/vhosting/dumpdir`           |                 | dizin var ve `was` yazabiliyor                                                  |
| 4    | `/vhosting8/dumpdir`          |                 | dizin var ve `was` yazabiliyor                                                  |
| 5    | `/vhosting/logx-tmp`          | `olustur: true` | varsa kullanılır; yoksa ve üst dizine `was` yazabiliyorsa açılır (0711, kalıcı) |
| 6    | `/vhosting8/logx-tmp`         | `olustur: true` | aynı                                                                            |

- Admin ekranı YOKTUR (karar). Liste tek değişkendedir ve dışarıdan verilebilir: her kayıt
  `{dir, tur?, yuzde?, olustur?}`, `dir` mutlak yol (ilk play doğrular). Sabit dizin adları
  playbook'ta YALNIZ bu listede geçer (bekçi).
- Teslim dizini ilk adaydır çünkü ZIP zaten oraya kopyalanacaktır ve yeri vardır. Bedeli: ZIP
  paylaşımlı diske iki kez yazılır (geçici + nihai); nihai kopyadan sonra geçici dizin silinir.
- İşe özel dizin `<aday>/logx-<arşiv kökü>-<sunucu adı>`. Sunucu adı şarttır: teslim dizini
  paylaşımlıdır, aynı işte iki sunucu aynı dizini kullansaydı birinin temizliği ötekinin ZIP'ini
  silerdi.

**Ön kontrol (yan etkisiz; yalnız `stat` ve `df`).** Dosyaların `stat`'ından sonra, arşivlenecek
dosyası olan her sunucuda:

1. Her aday `was` ile `stat` edilir (var mı, dizin mi, yazılabilir mi).
2. `olustur` adayı yoksa üst dizini `was` ile `stat` edilir.
3. Teslim adayına `was` yazamıyorsa bağlanan kullanıcıyla `stat` edilir.
4. `yuzde` taşıyan adayın boş alanı `df -Pk <dizin>` ile ölçülür (`command` + `argv`: yol bir
   kabuk dizesine yerleşmez; çıktının son satırının 4. kolonu, KB).
5. Her aday için karar verilir ve `tmp_adaylar`'a yazılır. Uygun olmayanın `sebep`'i:

| `sebep`                                                             | Anlamı                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `dizin degil (dosya)` / `dizin degil`                               | yol var ama dizin değil (sahadaki olay)                                   |
| `yok` / `teslim dizini yok`                                         | dizin yok ve açılacak aday değil                                          |
| `yok; ust dizin de yok` / `yok; ust dizine was yazamiyor`           | `olustur` adayı açılamaz (playbook dizin ağacı uydurmaz)                  |
| `yok; ust dizin denetlenemedi`                                      | üst dizinin `stat`'ı hata verdi                                           |
| `was yazamiyor`                                                     | dizin var, okuma kullanıcısı yazamıyor                                    |
| `ne was ne de baglanan kullanici yazabiliyor`                       | teslim dizinine kimse yazamıyor ya da `was` içine giremiyor               |
| `yer yetersiz: gerekli X MB, izinli Y MB (bos alan Z MB, sinir %N)` | bütçe aşıldı                                                              |
| `bos alan olculemedi`                                               | `df` düştü ya da çıktısı okunamadı — ölçülemeyen aday uygun SAYILMAZ      |
| `was ile denetlenemedi: <mesaj>`                                    | `stat` hata verdi (ör. `was` dizine erişemiyor) — ölçülemedi, uygun değil |

**`/tmp` bütçesi.** Gereken = geçerli dosyaların `stat` boyutlarının toplamı (SIKIŞTIRILMAMIŞ);
izinli = boş alan × yüzde / 100. Sıkıştırılmamış boyut bilerek seçildi (temkinli taraf): ZIP
sığacak olsa bile büyük bir seçim `/tmp`'yi atlar ve sıradaki adaya geçer. `/tmp` bu sunucularda
küçüktür (opsx_legacy_dump 2026-08-12); bütçesiz aday yapılmaz (bekçi). Aynı sunucuda aynı anda
iki iş ikisi de "boş" görebilir; sıkıştırma payı bunu pratikte karşılar, kilit yoktur.

**0733 yolu.** `was` teslim dizinine yazamıyorsa işe özel dizini BAĞLANAN kullanıcı 0733 ile
açar: `was` içine yazabilir ama listeleyemez, sahibi bağlanan kullanıcıdır ve iş bitince o
siler. Bunun için `was`'ın teslim dizinine GİREBİLMESİ (x) gerekir; giremiyorsa aday uygun
değildir. `was`'ın açtığı dizin 0711'dir (bağlanan kullanıcı içinden geçip ZIP'i kopyalar, kimse
listeleyemez). `tmp_adaylar[].olusturan` hangi yolun seçildiğini söyler (`was` / `baglanan`).

**Deneme.** İlk uygun adayda dizin açılır ve ZIP yazılır. Düşerse (dizin açılamadı ya da ZIP
yazılamadı) o denemenin dizini hemen temizlenir ve sıradaki uygun aday BİR KEZ denenir
(karar). Üçüncü aday denenmez. Aşağı akıştaki kopyalama görevleri tek olguya bakar:
`was_arsiv_hazir`.

**Hata metni** (tek-host'ta üst düzey `error`, çoklu-host'ta `hosts[].error`):

- uygun aday yok: `Gecici alan bulunamadi. Adaylar: <dizin>: <sebep> | <dizin>: <sebep> …`
- yazılamadı: `Loglar was kullanicisiyla ziplenemedi. 1. deneme (<dizin>): <modülün mesajı> | 2. deneme (<dizin>): <mesaj>`
- `ZIP arsivi olusturulamadi` / `Per-host ZIP olusturulamadi` yalnızca başka sebep yoksa son
  çare olarak kalır.

Arşiv üretilemese de tek-host işinde AWX işi "successful" biter: sonuç yayınlanmıştır ve
başarısızlığı sonuç söyler (`overall_status: failed`, `staged_path` boş); portal isteği
başarısız kapatır ve sebebi gösterir.

**Bilinen sınırlar.** İptal edilen işte geçici ZIP kalabilir (`always` iptalde koşmaz): `/tmp`'de
sistem temizliği siler, diğer adaylarda kalır. `fallback_dir` (teslim dizini kullanılamazsa nihai
arşivin yazıldığı yer) bu listenin parçası DEĞİLDİR ve bütçesizdir. OpsX heap dump playbook'u
(`opsx_legacy_dump`) hâlâ yalnız `dumpdir`'e yazar; aynı bozulma onu da durdurur.

### Geçici ZIP adı (sözleşme LX7)

- Eskiden ZIP adı `<arşiv kökü>.zip` idi, yani dizin adından türetilebiliyordu. Aday dizin
  listelenebiliyorsa (`/tmp` herkese açıktır; heap dump dizinleri sıklıkla geniş izinli) yerel
  bir kullanıcı yolu kurup kopya penceresinde ZIP'i okuyabilirdi.
- Artık bloğun İLK `set_fact` görevinde BİR KEZ:
  `was_tmp_zip: "{{ lookup('ansible.builtin.password', '/dev/null chars=ascii_lowercase,digits length=24') }}.zip"`.
  `/dev/null` yolu password lookup'ın özel durumudur: her çağrıda yeni rastgele değer üretir ve
  hiçbir yere yazmaz. Parametreler terim dizesi biçimindedir (eski ve yeni ansible-core sürümleri
  aynı şekilde ayrıştırır; anahtar kelime biçimi eski sürümlerde yok sayılırdı).
- `vars:` altında lookup YOK: play vars TEMBEL değerlendirilir, her başvuruda yeni ad üretilir ve
  archive, copy ve always FARKLI yollar görürdü. `was_tmp_archive = was_tmp_dir/was_tmp_zip`
  play vars'ta kalır (tembel; `was_tmp_dir` aday seçildikten sonra çözülmeli, ikinci denemede
  yeni adayı görmeli).
- Dizin 0711 (ya da 0733): listelenemez, ad tahmin edilemez.

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

- LG5: portalın okuduğu sonuç biçimleri (kısmi ve başarısız aktarım, tümüyle başarısız keşif,
  geçici alan bulunamadı, iki deneme de düştü) gerçek koşumla üretilir ve ekran testlerinin
  kullandığı örnek dosyasıyla karşılaştırılır.
- LG6: geçici alan adayı DOSYA olmuş (sahadaki olay) -> iş düşmez, sıradaki adayla tamamlanır;
  bozuk yola dokunulmaz.
- LG7: teslim dizini ilk adaysa o kullanılır; iş bitince teslimde yalnız nihai ZIP kalır.
- LG8: bütçe gerçek `df -Pk` çıktısıyla: `yuzde: 0` adayı elenir, `yuzde: 100` adayı kullanılır
  (çıktı bu işletim sisteminde okunamasaydı sebep `bos alan olculemedi` olurdu).
- LG9: olmayan `logx-tmp` adayı 0711 ile açılır, işe özel dizin temizlenir, ikinci iş var olanı
  kullanır; üst dizini de olmayan aday açılmaz.
- LG10: hiçbir aday uygun değil -> `failed`; her adayın sebebi yazılır, genel metin yok.
- LG11: ön kontrolü geçen adaya yazılamazsa sıradaki bir kez denenir; ikisi de düşerse iki
  sebep birden yazılır, üçüncü aday denenmez.
- LG12: dışarıdan verilen aday listesinde göreli ya da kök (`/`) yol -> ilk play reddeder,
  hiçbir sunucuya dokunulmaz.
- LG4 ayrıca iki sunucunun AYNI (paylaşımlı) adayı kullandığı durumu ölçer; LG6'da kullanılan
  aday bir sembolik bağdır (`stat` bağı izler).

Render tarafında X11 (`logx-legacy-olculemedi.test.cjs`) aday kararını enjekte edilmiş `stat` /
`df` sonuçlarıyla tablo halinde sınar: bütçe tam sınırda ve bir bayt fazlasında, boş alan
ölçülemedi, aday denetlenemedi, 0733 yolu (hangi görev hangi kullanıcıyla, hangi kiple koştu),
iki deneme, dışarıdan verilen liste, çoklu-host.

Ansible yoksa atlanır (LG2, LG4 ve LG5'in aktarım örnekleri ayrıca `community.general.archive`
ister; LG3 ve okunamayan dosya/dizin örnekleri root ile koşulamaz).

Metinle ve render ile ölçülemeyenler (kanaryada doğrulanır):

- AWX envanteri `ansible_pipelining=false` ile pipelining'i ezebilir.
- dzdo'nun `was` become izni ve aday dizinlerin gerçek modu/sahipliği.
- **0733 yolu iki kullanıcıyla:** yerel testler tek kullanıcıyla koşar; "`was` yazamıyor ama
  bağlanan kullanıcı yazabiliyor" durumu gerçek dosya sisteminde ÖLÇÜLEMEZ (karar mantığı ve
  görev bağlantıları X11'de render ile ölçülür). `was`'ın paylaşımlı diskteki (NFS) 0733 dizine
  gerçekten yazabildiği ve bağlanan kullanıcının o ZIP'i silebildiği kanaryada görülmelidir.
- `df -Pk` çıktısının hedef sunuculardaki biçimi (POSIX biçimi beklenir; okunamazsa `/tmp`
  adayı `bos alan olculemedi` ile elenir, iş sıradaki adayla sürer).
- Gerçek Ansible yürütme semantiği: `run_once` ile `set_fact`'in tüm hostlara yayılması,
  `ignore_unreachable` sonrası hostun bağlantısız görevlere devam etmesi, toplayıcının hiç
  koşmadığı durum. Render betiği bunları Ansible belgelerindeki davranışa göre taklit eder.
- `skipped_paths` ansible-core 2.12 öncesinde yok.

Kanarya: bir JBoss hostunda Legacy keşif + tek-host transfer + iki-host transfer; `was` become'u
reddedilen bir hostta keşif `error`, transfer `error/unreachable` görünmeli ("Failed to set
permissions" ve "dosya yok" görünmemeli); kökünde `was`'ın okuyamadığı dizin olan bir hostta
keşfin `error` mesajı yolu adlandırmalı.

Geçici alan kanaryası (2026-10-13): tek-host transferin AWX artifact'ında `tmp_dir` ve
`tmp_adaylar`'a bakın.

1. `tmp_dir` teslim dizini mi? `tmp_adaylar[0].olusturan` `was` ise `was` teslime yazabiliyor;
   `baglanan` ise 0733 yolu koştu — iş bittikten sonra teslim dizininde `logx-…` dizini
   KALMAMALI (kaldıysa bağlanan kullanıcı `was`'ın dosyasını silememiştir).
2. `/tmp` adayı `uygun` mu, yoksa `bos alan olculemedi` mi? İkincisi `df` çıktısının beklenen
   biçimde olmadığını gösterir.
3. `dumpdir`'i bozuk olan sunucuda iş BAŞARILI bitmeli ve `tmp_adaylar` o dizin için
   `dizin degil (dosya)` demeli.
