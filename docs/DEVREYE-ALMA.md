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
| Ortam son-eki eşlemesi           | Admin > LogX Yapılandırma > Ortam Son-ekleri                          | Son-eksiz ad **PROD** sayılır           |
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
