# Devreye Alma

Bu depoda **merge edilen bir PR tek başına yürürlüğe girmez.** İki paket AWX'e
**elle** kopyalanıyor ve bir kısım yapılandırma DB'de/`.env`'de duruyor. Kopyalama
unutulduğunda ortaya çıkan belirti hep aynı ve hep geç: ekran _"paket sürümü
uyuşmuyor"_ der, ya da playbook eski davranışı sürdürür ve kimse sebebini aramaz.

> **Tek komut:** `npm run preflight`
> Ne eksik olduğunu söyler; kesin eksikte `exit 1` döner, elle doğrulanacakları
> ayrıca listeler. Jenkins'te her yapıda koşar.

---

## 1. Önce kontrol et

```bash
npm run preflight
```

Çıktı üç seviyelidir:

| İşaret  | Anlamı                                                                       |
| ------- | ---------------------------------------------------------------------------- |
| `OK`    | Otomatik doğrulandı, yapılacak bir şey yok.                                  |
| `ELLE`  | Portal bunu göremez (AWX/DB dışarıda). **Gözle bak.** Çıkış kodunu düşürmez. |
| `EKSIK` | Kesin bir eksiklik. `exit 1`. Düzeltmeden dağıtma.                           |

---

## 2. AWX'e elle kopyalanacaklar

Portal, AWX'teki kopyayı doğrudan göremez — bu yüzden bu iki adım **her zaman**
gözle doğrulanır.

### 2.1 ScaleX paketi

```
server/ansible/bmw_portal/scalex/scalex_app/   →   <AWX projesi>/bmw_portal/scalex/scalex_app/
```

`scalex_app/` klasörü `global_variables/` ile **kardeş** olmalı.

Doğrulama: AWX'teki `scalex_app/VERSION` ile portalın beklediği sürüm aynı olmalı.
Portalın beklediği sürümü `npm run preflight` yazar.

> Uyuşmazlıkta ekran **tahmin etmez, söyler**: "AWX'te koşan sürüm X, portal Y
> bekliyor". Yani yanlış sürüm sessiz kalmaz — ama iş de doğru çalışmaz.

### 2.2 Telnet playbook'u

```
server/ansible/bmw_portal/telnet_openshift/telnet_openshift.yaml
   →   <AWX projesi>/bmw_openshift_jobs/ocp_telnet_control.yml
```

Repo'daki dosya **yalnızca referanstır**; portal onu çalıştırmaz.

> Kopyalanmazsa: _"pod hazır değil"_ durumu ekranda yine **KAPALI** olarak
> raporlanır — yani kullanıcı port kapalı sanıp ağ ekibine gider.

---

## 3. Otomatik olanlar (yapılacak bir şey yok)

- **DB tabloları** — sunucu açılışında `setupTables()` idempotent olarak kurar
  (`scalex_rbac_findings` dâhil).
- **Görünürlük seed'leri** — açılışta element bazında seed edilir.
- **Log dosyası ve rotasyonu** — `server/log.cjs` süreç içinde kendi dosyasını açar
  (`logs/<env>.app.log`), eşiği aşınca döndürür. **Hiçbir ayar gerekmez.**

---

## 4. Yapılandırma nerede

| Ne                               | Nerede                                                                | Boşsa ne olur                           |
| -------------------------------- | --------------------------------------------------------------------- | --------------------------------------- |
| AWX şablon kimlikleri            | Admin > Playbook Kayıtları (`ansible_playbook_registry`) ya da `.env` | İlgili özellik **501** ile kapanır      |
| ScaleX onay kapıları (SMART/OCO) | Admin > ScaleX Yönetimi → Alanları Yönet                              | Prod `apply` **fail-closed** reddedilir |
| Ortam son-eki eşlemesi           | Admin > LogX Yönetimi > Legacy Ortam Son-Eki                          | Son-eksiz ad **PROD** sayılır           |
| Log rotasyon ayarları            | `.env` (`LOG_*`)                                                      | Varsayılan: 20 MB eşik, 5 dosya         |

---

## 5. Dağıtım

```bash
npm ci
npm run preflight     # EKSIK varsa burada dur
npm test
npm run test:ui
npx tsc --noEmit
npm run build
deploy/release.sh <env>
```

Ayrıntı: `docs/DEPLOYMENT.md`.

---

## 6. Devreye aldıktan sonra ne izlenir

| Belirti                            | Muhtemel sebep                                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ScaleX "paket sürümü uyuşmuyor"    | §2.1 kopyalanmadı                                                                                                                                              |
| Telnet'te her şey KAPALI, `rc=143` | §2.2 kopyalanmadı (ya da port gerçekten kapalı)                                                                                                                |
| Bir özellik 501 dönüyor            | §4 — şablon kimliği boş                                                                                                                                        |
| `logs/<env>.out` büyüyor           | Normal değil: süreç içi logger kurulamamış olabilir. `logs/<env>.app.log` var mı bak; yoksa açılış çıktısında `[log] dosya loglamasi devre disi` satırını ara. |
| Prod `apply` başlamıyor            | SMART yapılandırılmamış — **bilinçli** fail-closed                                                                                                             |

---

## Node 22'ye geçiş

> **GÜNCEL DURUM (2026-10-23):** Portalı çalıştıran bir makine şimdilik **Node 22.22.2**'de kalıyor
> (yükseltme yapılamıyor). Bu yüzden iki kavram ayrıldı:
>
> - **Uyumluluk** — `package.json` `engines`: **`^22.22.2 || ^24.15.0 || >=26.0.0`**. Projenin
>   derleme dahil GERÇEKTEN çalıştığı en eski sürümler (`jsdom` bunu istiyor). Bekçi NV1, her hattın
>   en eski sürümünün kilitteki her paketin şartını karşıladığını denetler. 22.22.2'de `npm ci`
>   artık uyarı vermez.
> - **Güvenlik** — `server/node-guvenlik.cjs` `YAMALI` (22.23.4 / 24.22.1 / 26.12.1). Altındaki
>   sürümde açılışta `[Guvenlik]` uyarısı yazılır ve **telafi korumaları** kurulur:
>   - giden `fetch` Brotli istemez ve Brotli yanıtı reddeder (CVE-2026-111497);
>   - NUL baytlı konak adı DNS'e gitmez (CVE-2026-105482 / -48930).
>   Loglarda URL kimliği her sürümde maskelenir (CVE-2026-48615 için de).
>
> TLS sunucu kimliği / IP doğrulaması düzeltmeleri (CVE-2026-48618, -106069, -106072) **yalnızca
> Node yükseltmesiyle** gelir; 22.23.4 aynı hatta, uyumluluk ölçümü 22.22.2 ile aynı (#215).
> Kalan elle adım: Jenkins (aşağıda 4. adım).

Prod geçiş öncesinde **Node 20.20.2** koşuyordu ve `engines` o gün kırılmasın diye `>=20.18.0`
bırakılmıştı.

> **ARTIK ACİL (2026-10-23):** Node.js 2026-10-21 güvenlik yayını 10 CVE kapattı; en ağırı
> **CVE-2026-111497** (High, gömülü Brotli çözücüsünde sınır dışı yazma → uzaktan kod çalıştırma).
> Yamalı sürümler yalnız **22.23.4 / 24.22.1 / 26.12.1**. **20.x 2026-04-30'da ömrünü doldurdu, yama
> almadı** — 20.20.2 açık kalır. Portal'da çözücüye giden en kısa yol Express 5'in gövde
> ayrıştırıcısıydı (`Content-Encoding: br` gövdeyi açıyor, oturum kontrolünden önce koşuyor); bu yol
> `server/auth/brotli-govde-reddi.cjs` ile **kapatıldı** (415). Ama giden `fetch` yanıtları ve TLS /
> DNS açıkları (CVE-2026-106069, -105483, -106072, -105482) yalnız Node yükseltmesiyle kapanır.
> Hedef: **en az 22.23.4** (ya da 24.22.1 — geliştirme makinesi 24.x'te, test takımı orada yeşil).
> RHEL'de `dnf module reset -y nodejs && dnf module enable -y nodejs:22 && dnf install -y nodejs`;
> Red Hat paketi düzeltmeyi kendi sürüm numarasıyla taşıyabilir — `dnf updateinfo list --security`
> çıktısında ilgili RHSA'yı doğrulayın. dnf "Nothing to do" diyorsa (sunucu deposu geride):
> `deploy/install-node.sh` resmi ikiliyi root'suz `<BASE_DIR>/runtime/node` altına kurar
> (ayrıntı: `docs/DEPLOYMENT.md` → "Node dnf'ten yamali gelmiyorsa").

### Bugün ne uyumsuz

`npm run preflight` bunu **ölçer** (liste kodda gömülü değil, `package-lock.json`'dan
hesaplanır). Prod sürümünü sormak için:

```bash
PREFLIGHT_NODE_VERSION=20.20.2 npm run preflight
```

Çıktı iki kümeye ayırır — **ayrım önemli**:

| Küme               | Paketler                                                                                                                 | Anlamı                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| **Çalışma zamanı** | `tedious` (>=22)                                                                                                         | **Uygulamanın içinde koşar.** MSSQL sürücüsü; portal her DB çağrısında kullanıyor. Listedeki tek gerçek üretim riski budur. |
| Geliştirme         | `vitest`, `jsdom`, `lint-staged`, `@testing-library/jest-dom`, `whatwg-url`, `@asamuzakjp/*`, `jsdom`'un iç `undici@8`'i | Yalnızca geliştirici/CI makinesinde koşar. `npm ci` uyarısı verir, prod'u etkilemez.                                        |

> `undici@8.10.1` uyarısı yanıltıcıdır: o **jsdom'un iç kopyasıdır** (geliştirme).
> Portalın kendi çalışma zamanı `undici`'si `7.29.1` ve Node 20 ile uyumludur.

### Geçiş adımları

1. Sunucuya Node 22 kur (paket yöneticisi ya da `deploy/install-node.sh` ile resmi ikili).
2. `deploy/run.sh` kullandığı Node'u `PATH`ten alır; `<BASE_DIR>/runtime/node` varsa onu öne
   koyar ve açılışta yolunu + sürümünü yazar.
3. `npm ci` — EBADENGINE uyarıları biter.
4. **Jenkins**: Global Tool olarak `node22` tanımlayın, sonra `Jenkinsfile`'daki
   `tools { nodejs 'node20' }` satırını `'node22'` yapın. Matris **bilerek eklenmedi**:
   `tools` bloğu var olmayan bir araç adına bağlanırsa boru hattı **komple düşer**
   ve o tanım bu repodan doğrulanamıyor.
5. `package.json` `engines` uyumluluk aralığı: `^22.22.2 || ^24.15.0 || >=26.0.0`. Güvenlik tabanı
   ayrı tutulur (açılış uyarısı ve telafi korumaları, `server/node-guvenlik.cjs`).

### Geri dönüş

**Node 20'ye geri dönüş artık yok (2026-10-23).** Node 20 destek dışı ve Ekim 2026 güvenlik
yamasını almadı; `tedious` ve `ldapts` 9 Node 22 istiyor. Node sorunu olursa geri dönüş
22.x içinde yapılır (bir önceki 22 yama sürümü), 20'ye değil.
