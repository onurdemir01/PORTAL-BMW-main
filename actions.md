# Portal Geliştirme ve Düzenleme Talepleri

## 1. Ansible Template Self Service Kaydı Hatası

Bir Ansible template’i Self Service olarak kaydetmeye çalışırken aşağıdaki bilgiler bulunuyor:

### Aware restart

**Template ID:** 837
**Server:** 1

### Genel

**Açıklama**
Aware Restart

**Job Type**
run

**Playbook**
bmw_automation_folder/aware_automation/executeCmd.yml

**Inventory**
Linux 6203 - Dynamic Inventory

**Project**
ANSIBLE_6203

### Launch Ayarları

**Değişken sorar**

**Son Değişiklik**
14.08.2024 13:07:56

### Extra Vars (4 değişken)

```yaml
hostname: gsadasfasd
appusername: www
command: /vhosting/scripts/
email: YigithanG@contractor.garantibbva.com.tr
```

### Credentials

```text
application_was_credentials (ssh)
```

### Self Service Kaydı

**İsim**
Aware restart

**Açıklama**
Aware Restart

```text
Server ID (1), Template ID (837) ve değişken şeması otomatik doldurulur.
```

Bu bilgilerle **Kaydet** butonuna basıldığında aşağıdaki hata alınıyor:

```text
Unexpected token '<', "<!doctype "... is not valid JSON
```

Hataya ait network detaylarını HAR dosyası olarak ilettim.

Bu hata incelenmeli ve düzeltilmelidir.

Backend’in JSON dönmesi beklenen bir noktada HTML hata sayfası döndürdüğü görülüyor. Frontend tarafı da HTML yanıtı JSON olarak parse etmeye çalıştığı için bu hata oluşuyor olabilir.

Kontrol edilmesi gerekenler:

* Kaydetme isteğinin gönderildiği endpoint
* Endpoint’in HTTP status kodu
* Response Content-Type değeri
* Backend exception logları
* Yetkilendirme veya session yönlendirmeleri
* Reverse proxy yönlendirmeleri
* 404, 500, 502 veya login sayfası dönüşleri
* Frontend JSON parse işlemi
* HAR dosyasındaki request ve response detayları

Frontend, JSON olmayan bir response geldiğinde doğrudan:

```text
Unexpected token '<'
```

hatasını göstermemelidir.

Bunun yerine response status, response body ve backend hata mesajı kullanıcıya anlamlı şekilde gösterilmelidir.

---

# 2. Self Service Üzerinden Çalıştırılan Ansible Job Loglarının Görünmemesi

Self Service kısmından herhangi bir job çalıştırıldığında job Ansible tarafında çalışıyor ve logları Ansible tarafında bulunuyor.

Ancak portal tarafında loglar gelmiyor.

Portal üzerinde şu mesaj gösteriliyor:

```text
AWX job başlatıldı — konsol çıktısı akmaya başlayacak…
```

Ardından aşağıdaki mesaj görüntüleniyor:

```text
Job başarısız oldu ancak AWX bu iş için stdout/traceback döndürmedi. AWX arayüzünden job detayını kontrol edin (çoğu zaman playbook parse/şablon hatası).
```

Ancak job aslında çalışıyor ve Ansible tarafında log bulunuyor.

Örnek gerçek Ansible logu:

```text
Identity added: /runner/artifacts/3165048/ssh_key_data (uxmid@gbansp01)
add_file: sshkey_cert_copy: invalid argument
[DEPRECATION WARNING]: ANSIBLE_COLLECTIONS_PATHS option, does not fit var 
naming standard, use the singular form ANSIBLE_COLLECTIONS_PATH instead. This 
feature will be removed from ansible-core in version 2.19. Deprecation warnings
 can be disabled by setting deprecation_warnings=False in ansible.cfg.
Vault password: 
PLAY [PREPARE] *****************************************************************
TASK [include_tasks] ***********************************************************
included: /runner/project/bmw_openshift_jobs/chaos_scale_app/tasks/01_validate.yml for localhost
TASK [Normalize scalar survey values safely] ***********************************
ok: [localhost]
TASK [Convert survey lists to first value] *************************************
ok: [localhost]
```

Portalın AWX job stdout bilgisini doğru endpoint üzerinden çekmesi gerekiyor.

Kontrol edilmesi gerekenler:

* Job başlatıldıktan sonra dönen AWX job ID
* Job detay endpoint’i
* Job stdout endpoint’i
* Job events endpoint’i
* Job status polling işlemi
* Job tamamlanmadan stdout sorgulanıp sorgulanmadığı
* Başarısız joblarda stdout çekme işleminin kesilip kesilmediği
* AWX kullanıcı veya token yetkileri
* AWX response formatı
* stdout response’unun text veya JSON gelme durumu
* Job ID ile yanlış template ID kullanılma ihtimali

Job başarısız olsa bile mevcut stdout portalda gösterilmelidir.

Job status şu değerlerden biri olsa bile log çekme işlemi devam etmelidir:

```text
new
pending
waiting
running
successful
failed
error
canceled
```

Portal yalnızca job başarılı olduğunda değil, başarısız olduğunda da AWX üzerinde oluşmuş bütün logları göstermelidir.

AWX stdout boşsa job events üzerinden alternatif log toplama mekanizması kullanılmalıdır.

---

# 3. LogX Yapılandırma Verilerinin Veritabanında Tutulması

LogX yapılandırması altında bulunan aşağıdaki bütün alanlar ve bu alanların içindeki tablolar veritabanında tutulmalıdır:

* OCP Cluster Hiyerarşisi
* Terminal/Bastion Host
* Legacy Ortam Son-Eki
* Kısıtlamalar
* Bu bölümlerin içindeki bütün tablo verileri

Bu verilerin gerçekten veritabanında olup olmadığı kontrol edilmelidir.

Veritabanında değilse uygun tablolar oluşturularak veritabanına taşınmalıdır.

Bu alanlar:

* Eklenebilir
* Güncellenebilir
* Düzenlenebilir
* Silinebilir
* Aktif/pasif yapılabilir

olmalıdır.

Uygulama yeniden başladığında bu bilgiler kaybolmamalıdır.

---

# 4. Denetim Kaydı ve Portal Logları

Denetim Kaydı kısmında portal logları bulunuyor.

Self Service Ansible üzerinden execute edilen bütün işlemler de bu denetim kayıtlarına yazılmalıdır.

Aşağıdaki işlemler audit log kapsamında tutulmalıdır:

* Self Service job başlatma
* Ansible job çalıştırma
* AWX job ID oluşması
* Job başarılı olma
* Job başarısız olma
* Job iptal edilmesi
* Kullanıcının gönderdiği değişkenler
* Template bilgisi
* Server bilgisi
* Inventory bilgisi
* Project bilgisi
* Credential bilgisi
* İşlem başlangıç zamanı
* İşlem bitiş zamanı
* İşlemi yapan kullanıcı
* Sonuç durumu
* Hata mesajı
* AWX stdout veya log referansı

Denetim kayıtları kesinlikle veritabanında tutulmalıdır.

Audit kayıtları uygulama restart olduğunda veya versiyon güncellendiğinde kaybolmamalıdır.

---

# 5. Self Service Grup, Alt Grup ve Servis Yapısı

Self Service içerisindeki aşağıdaki ana kategoriler için grup, alt grup ve servis bilgileri veri olarak tutulmalıdır:

* Smart
* Ansible
* Diğerleri

Bu yapı statik frontend kodu içerisinde bulunmamalıdır.

Aşağıdaki yapılar veritabanında tutulmalıdır:

* Ana grup
* Alt grup
* Servis
* Servis açıklaması
* Servis tipi
* Görünürlük
* Sıralama
* Aktif/pasif durumu
* İkon bilgisi
* İlgili template
* İlgili server
* İlgili form şeması
* Yetki bilgisi

Örnek hiyerarşi:

```text
Smart
 └── Alt Grup
      └── Servis

Ansible
 └── Alt Grup
      └── Servis

Diğerleri
 └── Alt Grup
      └── Servis
```

Bu yapı dinamik olarak veritabanından okunmalıdır.

Admin ekranından:

* Grup eklenebilmeli
* Alt grup eklenebilmeli
* Servis eklenebilmeli
* Düzenlenebilmeli
* Silinebilmeli
* Sıralaması değiştirilebilmeli
* Aktif/pasif yapılabilmeli

---

# 6. Nöbet Bilgilerinin Dinamik Çekilmesi

Nöbet bilgileri statik olmamalıdır.

Nöbet bilgileri dinamik bir şekilde çekilmelidir.

Nöbet bilgilerinin kaynağı belirlenmeli ve yapılandırılabilir olmalıdır.

Mümkünse aşağıdaki bilgiler veritabanında tutulmalıdır:

* Nöbet grubu
* Nöbetçi kişi
* Başlangıç tarihi
* Bitiş tarihi
* İletişim bilgisi
* Ekip
* Servis
* Aktiflik durumu
* Veri kaynağı
* Son güncellenme zamanı

Nöbet bilgileri harici bir sistemden çekiliyorsa cache veya senkronizasyon kayıtları da veritabanında tutulmalıdır.

---

# 7. Görevlerin Veritabanında Tutulması

Portal içerisindeki görevler veritabanında tutulmalıdır.

Görevler uygulama belleğinde veya statik yapı içerisinde tutulmamalıdır.

Görev tablosunda en az aşağıdaki bilgiler bulunmalıdır:

* Görev ID
* Görev adı
* Görev açıklaması
* Görev tipi
* Durum
* Öncelik
* Oluşturan kullanıcı
* Atanan kullanıcı
* Oluşturulma tarihi
* Güncellenme tarihi
* Başlangıç tarihi
* Bitiş tarihi
* İlgili servis
* İlgili job
* İlgili AWX job ID
* Sonuç
* Hata bilgisi
* Aktif/pasif durumu

Görevler:

* Eklenebilmeli
* Düzenlenebilmeli
* Güncellenebilmeli
* Silinebilmeli
* Durumu değiştirilebilmeli
* Filtrelenebilmeli
* Aranabilmeli

---

# 8. AWX Bağlantı Durumu ve AWX Şablonları

## AWX Bağlantı Durumu

AWX bağlantı durumu gerçek zamanlı veya belirli aralıklarla kontrol edilmelidir.

Aşağıdaki bilgiler gösterilmelidir:

* AWX erişilebilir mi
* Authentication başarılı mı
* Son kontrol zamanı
* Response süresi
* AWX versiyonu
* Hata mesajı
* Kullanılan bağlantı tipi
* Token durumu

## AWX Şablonları

AWX Şablonları dinamik olarak çekilebilmelidir.

Template listesi statik olmamalıdır.

AWX üzerinden en az aşağıdaki bilgiler alınmalıdır:

* Template ID
* Template adı
* Açıklama
* Job Type
* Playbook
* Inventory
* Project
* Survey bilgisi
* Extra Vars
* Credentials
* Son değişiklik tarihi
* Aktiflik durumu

Bu template bilgileri gerekiyorsa veritabanında cache olarak tutulabilir.

AWX tarafındaki template bilgileriyle veritabanındaki kayıtlar senkronize edilebilmelidir.

---

# 9. OCP Cluster Yönetimi

Mevcut ekran:

```text
OCP Cluster Yönetimi
Cluster Ekle
Portal genelinde referans alınan OpenShift cluster'larını yönet. Her cluster; ortam, API URL ve namespace bilgisi içerir.

Henüz cluster tanımlı değil. "Cluster Ekle" ile başlayın.
```

Bu yapı veritabanı tabanlı olmalıdır.

Her cluster için en az aşağıdaki bilgiler tutulmalıdır:

* Cluster adı
* Ortam
* API URL
* Namespace
* Token veya credential referansı
* Terminal/Bastion Host
* Aktif/pasif durumu
* Açıklama
* Oluşturulma tarihi
* Güncellenme tarihi
* Oluşturan kullanıcı
* Son bağlantı kontrolü
* Bağlantı durumu

Cluster kayıtları:

* Eklenebilmeli
* Düzenlenebilmeli
* Güncellenebilmeli
* Silinebilmeli
* Aktif/pasif yapılabilmeli
* Bağlantısı test edilebilmeli

---

# 10. Gerekli Env Değişkenleri Bölümü

Ekranda aşağıdaki alanlar bulunuyor:

```text
Gerekli Env Değişkenleri

AWX_URL
AWX_USER + AWX_PASSWORD (token otomatik alınır)
AWX_READ_ONLY_TEMPLATE_IDS (virgülle ayrılmış)
AWX_LOG_FETCH_TEMPLATE_ID
```

Bu kısmın ne işe yaradığı kullanıcıya açık şekilde anlatılmalıdır.

## AWX_URL

Portalın bağlanacağı AWX sunucusunun adresidir.

## AWX_USER + AWX_PASSWORD

AWX API bağlantısı için kullanılacak kullanıcı adı ve şifredir.

Bu bilgiler kullanılarak otomatik token alınır.

## AWX_READ_ONLY_TEMPLATE_IDS

AI Analist veya portal tarafından salt-okunur şekilde kullanılabilecek AWX template ID listesidir.

Virgülle ayrılmış şekilde tanımlanır.

Örnek:

```text
2139,2140,2141,2142
```

## AWX_LOG_FETCH_TEMPLATE_ID

Log çekme işlemleri için kullanılacak özel AWX template ID bilgisidir.

Bu alanların sadece `.env` üzerinden yönetilmesi yerine, güvenli olanların veritabanı üzerinden yönetilmesi değerlendirilmelidir.

Şifre, token ve credential değerleri açık metin olarak tutulmamalıdır.

Bu bölüm için yardım açıklaması bulunmalıdır.

Her değişkenin:

* Ne işe yaradığı
* Zorunlu olup olmadığı
* Örnek değeri
* Kullanıldığı bölüm
* Değişiklik sonrası restart gerekip gerekmediği

gösterilmelidir.

---

# 11. Playbook Kayıtlarının Veritabanında Tutulması

Playbook kayıtları veritabanında tutulmalıdır.

Ekranda bulunan aşağıdaki tanımların tamamı veri tabanlı olmalıdır:

```text
AI Analist'in sohbette kendi kararıyla çağırabildiği salt-okunur tanılama playbook'ları (JVM, network, disk, sistem sağlığı, vb.). Template ID admin ekranından (DB) VEYA.env'deki ilgili değişkenden alınabilir — hiçbiri tanımlı değilse araç sohbette hiç görünmez (hata gösterilmez).
```

## Mevcut Örnek Kayıtlar

### jvm

```text
JVM Heap/GC Durumu
jvm_heap_status · host_target
JBoss/WildFly/EAP JVM prosesinin heap/GC istatistiklerini ve başlangıç bayraklarını (jstat/jmap, salt-okunur) getirir.
Tanımsız
```

### logx

```text
LogX — Legacy Log Keşfi
logx_legacy_discovery · legacy_discovery
Bir uygulamanın /vhosting ve /vhosting8 altındaki log dosyalarını (salt-okunur, find) keşfeder.
AWX: Maestro 2
DB: #2139
```

### logx

```text
LogX — Legacy Log Transferi
logx_legacy_transfer · legacy_transfer
Seçilen log dosyalarını zip'leyip portalın okuyabildiği staging dizinine bırakır.
AWX: Maestro 2
DB: #2140
```

### logx

```text
LogX — OCP Namespace Keşfi
logx_ocp_namespace_discovery · ocp_namespace_discovery
Seçilen cluster(lar)da kullanıcının erişebildiği namespace/proje listesini (oc get projects, salt-okunur) getirir.
AWX: Maestro 2
DB: #2142
```

### logx

```text
LogX — OCP Pod Log Keşfi+Çekme
logx_ocp_discover_fetch · ocp_discover_fetch
Seçilen cluster(lar)da uygulama adına eşleşen tüm pod'ların loglarını çeker, zip'ler, staging dizinine bırakır.
AWX: Maestro 2
DB: #2141
```

### network

```text
Network Bağlantı Durumu
network_connectivity_check · host_target
Ağ arayüzleri, route, DNS çözümleme ve dinleyen portları (salt-okunur) getirir.
Tanımsız
```

### network

```text
Web Sunucu Durumu
web_server_status · host_target
Nginx/Apache/Tomcat proses ve config durumunu, 80/443 bağlantılarını (salt-okunur) getirir.
Tanımsız
```

### openshift

```text
OpenShift Pod Durumu
ocp_pod_status · ocp_cluster
Kayıtlı bir OpenShift cluster'ının pod/node/cluster-operator durumunu (oc get, salt-okunur) getirir.
Tanımsız
```

### system

```text
Disk Kullanım Durumu
disk_usage_status · host_target
Disk/inode kullanımı ve en büyük dizinleri (salt-okunur) getirir.
Tanımsız
```

### system

```text
Servis Durumu Kontrolü
service_status_check · host_target
Yaygın servislerin (nginx/httpd/docker/podman/jbossas/tomcat) durumunu (salt-okunur) getirir.
Tanımsız
```

### system

```text
Sistem Sağlığı Genel Görünüm
system_health_overview · host_target
Uptime, bellek, CPU ve en yoğun prosesleri (salt-okunur) getirir.
```

Bu kayıtların her biri için veritabanında en az aşağıdaki bilgiler bulunmalıdır:

* Kategori
* Görünen ad
* Teknik anahtar
* Hedef tipi
* Açıklama
* AWX instance
* Template ID
* Kaynak tipi
* Salt-okunur bilgisi
* Aktif/pasif durumu
* Görünürlük
* Sıralama
* Env fallback anahtarı
* Oluşturulma tarihi
* Güncellenme tarihi

Bu kayıtlar admin ekranından yönetilebilmelidir.

Tanımsız olan template ID bilgileri sonradan eklenebilmelidir.

DB kaydı varsa öncelikle DB kullanılmalıdır.

DB kaydı yoksa `.env` fallback olarak kullanılabilir.

Hem DB hem `.env` tanımsızsa araç görünmemelidir ve kullanıcıya gereksiz hata gösterilmemelidir.

---

# 12. Kullanıcı Tablo Görünürlüğü

Kullanıcı Tablo Görünürlüğü ile ilgili bütün bilgiler veritabanında tutulmalıdır.

Yeni bir tablo eklendiğinde ilgili görünürlük tablosuna otomatik olarak kayıt eklenmelidir.

Bir tablo değiştiğinde ilgili kayıt güncellenebilmelidir.

Bir tablo silindiğinde ilgili görünürlük kaydı kontrollü şekilde pasife alınmalı veya silinmelidir.

Aşağıdaki bilgiler veritabanında tutulmalıdır:

* Tablo adı
* Schema adı
* Görünen ad
* Aktif/pasif durumu
* Kullanıcı rolü
* Kullanıcı bazlı görünürlük
* Kolon görünürlüğü
* Sıralama
* Açıklama
* Oluşturulma tarihi
* Güncellenme tarihi

Bu yapı tamamen dinamik olmalıdır.

---

# 13. Tablo Takma Adları

Tablo Takma Adları yani alias bilgileri veritabanında tutulmalıdır.

Örnek olarak teknik tablo adı:

```text
awx_job_templates
```

Kullanıcıya şu şekilde gösterilebilir:

```text
AWX Job Şablonları
```

Alias tablosunda aşağıdaki bilgiler bulunmalıdır:

* Teknik tablo adı
* Schema adı
* Görünen ad
* Kısa açıklama
* Aktif/pasif durumu
* Dil
* Sıralama
* Güncellenme tarihi

Alias bilgileri admin ekranından düzenlenebilmelidir.

---

# 14. Kullanıcı Rol Yönetimi

Mevcut bölüm:

```text
Kullanıcı Rol Yönetimi
Belirli LDAP kullanıcılarına manuel rol atayın. LDAP grup üyeliğinden bağımsız, her login'de geçerlidir. Override silinince kullanıcı LDAP grubuna döner.

Kullanıcı adı (sAMAccountName)
ahmet.yilmaz
Rol

Admin
Ekle
Henüz manuel rol ataması yok.

Kullanıcılar LDAP grup üyeliklerine göre rol alır.

Not: Değişiklikler kullanıcının bir sonraki giriş yapmasında geçerli olur. Aktif oturumları etkilemez.
```

Bu bölümdeki bütün kullanıcı rol override kayıtları veritabanında tutulmalıdır.

En az aşağıdaki bilgiler bulunmalıdır:

* Kullanıcı adı
* sAMAccountName
* Atanan rol
* Kaynak tipi
* LDAP rolü
* Override rolü
* Aktif/pasif durumu
* Oluşturan kullanıcı
* Oluşturulma tarihi
* Güncellenme tarihi
* Açıklama
* Son uygulanma tarihi

Override silindiğinde kullanıcı LDAP grubundan gelen rolüne dönmelidir.

Bu işlem audit log’a yazılmalıdır.

Aktif oturumların etkilenip etkilenmeyeceği açık şekilde belirtilmelidir.

Mümkünse aktif session yenileme veya session iptal mekanizması sağlanmalıdır.

---

# 15. Sayfa Erişimi

Bu bölüm en önemli kısımlardan biridir.

Mevcut açıklama:

```text
Sayfa Erişimi
Görünürlük & Modüller
Her sayfa/tab/buton için: Aktif = global kill-switch (kapatınca admin dahil hiçbir yerde görünmez), User görür = User rolü görebilir mi (Admin her zaman görür), ve kullanıcı-bazlı override. Değişiklikler kaydedilince anında yansır (reload gerekmez).

Yeni Element
Öğe    Aktif    User görür    Kullanıcı override
```

Bu yapı tamamen veritabanında tutulmalıdır.

Sayfa, tab, buton, menü, alt menü, modül ve diğer bütün UI elementleri veritabanında tanımlanabilmelidir.

Her element için en az aşağıdaki alanlar bulunmalıdır:

* Element ID
* Element anahtarı
* Element adı
* Element tipi
* Parent element
* Route
* Sayfa
* Tab
* Buton
* Menü
* Alt menü
* Modül
* Aktif
* User görür
* Admin görür
* Kullanıcı override
* Rol bazlı görünürlük
* Sıralama
* Açıklama
* Oluşturulma tarihi
* Güncellenme tarihi

## Aktif

Global kill-switch olarak çalışmalıdır.

Kapatıldığında admin dahil hiçbir kullanıcı ilgili elementi görmemelidir.

## User görür

User rolündeki kullanıcıların elementi görüp göremeyeceğini belirlemelidir.

Admin normal durumda her zaman görmelidir.

Ancak `Aktif` kapalıysa admin de görmemelidir.

## Kullanıcı override

Belirli bir kullanıcı için genel görünürlük kurallarının üzerine yazabilmelidir.

Override seçenekleri en az şu şekilde olabilir:

```text
inherit
allow
deny
```

Değişiklikler kaydedildiğinde mümkün olduğunca anında yansımalıdır.

Reload gerekmemelidir.

Bu yapı için cache kullanılıyorsa cache invalidation yapılmalıdır.

---

# 16. Sayfa Erişimi İçin Önerilen Veritabanı Tablosu

Dokümantasyon içerisinde tablonun nasıl olacağı açık şekilde yazılmalıdır.

Örnek dummy tablo yardım butonu içerisinde gösterilmelidir.

Örnek tablo:

| id | element_key     | element_name       | element_type | parent_id | route        | active | user_visible | admin_visible | sort_order |
| -- | --------------- | ------------------ | ------------ | --------- | ------------ | ------ | ------------ | ------------- | ---------- |
| 1  | admin           | Admin              | menu         | null      | /admin       | true   | false        | true          | 100        |
| 2  | admin_users     | Kullanıcı Yönetimi | page         | 1         | /admin/users | true   | false        | true          | 10         |
| 3  | admin_users_add | Kullanıcı Ekle     | button       | 2         | null         | true   | false        | true          | 20         |
| 4  | logx            | LogX               | menu         | null      | /logx        | true   | true         | true          | 30         |

Kullanıcı override için örnek tablo:

| id | user_name    | element_key | override_type | active |
| -- | ------------ | ----------- | ------------- | ------ |
| 1  | ahmet.yilmaz | logx        | allow         | true   |
| 2  | test.user    | admin_users | deny          | true   |

Rol bazlı yetkilendirme için örnek tablo:

| id | role_name | element_key | can_view | can_execute |
| -- | --------- | ----------- | -------- | ----------- |
| 1  | Admin     | admin_users | true     | true        |
| 2  | User      | logx        | true     | true        |
| 3  | User      | admin_users | false    | false       |

Bu tablolar dummy örnek olarak yardım butonunda gösterilmelidir.

Yardım alanında şu konular açıklanmalıdır:

* Aktif ne demek
* User görür ne demek
* Admin görünürlüğü nasıl çalışır
* Kullanıcı override nasıl çalışır
* Parent-child ilişkisi nasıl çalışır
* Bir menü kapatılırsa alt elemanların durumu
* Değişikliklerin ne zaman yansıdığı
* Yeni element nasıl eklenir
* Element anahtarı nasıl belirlenir

---

# 17. Veritabanı Tabanlı Dinamik Yapı

Veritabanında olan her şey, yapısı ve mantığı uygunsa:

* Eklenebilmeli
* Düzenlenebilmeli
* Güncellenebilmeli
* Silinebilmeli
* Aktif/pasif yapılabilmeli
* Listelenebilmeli
* Aranabilmeli
* Filtrelenebilmeli
* Audit kaydı tutulabilmeli

Ancak kritik sistem kayıtları için doğrudan fiziksel silme yerine soft delete tercih edilebilir.

Örnek alan:

```text
is_active
deleted_at
deleted_by
```

Silme işlemleri yetki kontrolüne tabi olmalıdır.

---

# 18. Portal Güncelleme ve Yeniden Başlatma Sonrası Kalıcılık

Portal versiyonu güncellendiğinde, servis açılıp kapandığında, container yeniden başladığında veya sunucu reboot olduğunda portalın tekrar baştan düzenlenmesi gerekmemelidir.

Mümkün olduğunca aşağıdaki bütün alanlar veritabanında tutulmalıdır:

* Menü yapıları
* Sayfa erişimleri
* Buton görünürlükleri
* Kullanıcı override kayıtları
* Rol kayıtları
* LDAP rol override kayıtları
* AWX template kayıtları
* Playbook kayıtları
* Self Service kayıtları
* Grup kayıtları
* Alt grup kayıtları
* Servis kayıtları
* LogX ayarları
* OCP cluster kayıtları
* Terminal/Bastion Host kayıtları
* Legacy ortam son-ekleri
* Kısıtlamalar
* Görevler
* Nöbet bilgileri
* Audit kayıtları
* Tablo görünürlükleri
* Tablo alias bilgileri
* Yardım içerikleri
* UI element tanımları
* Sıralama bilgileri
* Aktif/pasif durumları

Deployment sırasında veritabanı migration mekanizması kullanılmalıdır.

Migration işlemleri mevcut verileri silmemelidir.

Seed işlemleri sadece eksik kayıtları eklemelidir.

Mevcut kullanıcı düzenlemelerinin üzerine yazmamalıdır.

---

# 19. Ana Menü Düzenlemesi

Mevcut ana menüler:

```text
Genel
Gözlemlenebilirlik
Operasyon
Otomasyon
AI Analist
Yardımcı Araçlar
Admin
```

`Gözlemlenebilirlik` kaldırılmalıdır.

Bunun yerine `LogX` ayrı bir buton veya ana menü olarak bulunmalıdır.

Yeni yapı şu şekilde olmalıdır:

```text
Genel
LogX
Operasyon
Otomasyon
AI Analist
Yardımcı Araçlar
Admin
```

Bu menü yapısı statik olmamalıdır.

Veritabanından yönetilebilmelidir.

Menü sırası, görünürlüğü ve aktiflik durumu admin ekranından değiştirilebilmelidir.

---

# 20. Custom SQL Sorgusu

Mevcut ekran:

```text
Custom SQL Sorgusu
Kapat
Sadece SELECT sorguları çalıştırılabilir. Limit varsayılan 200, maksimum 10.000 satır.
```

Bu alan hiçbir şekilde veri değiştiren sorgular çalıştırmamalıdır.

Sadece read-only sorgular çalıştırılabilmelidir.

Yalnızca `SELECT` sorgularına izin verilmelidir.

Aşağıdaki sorgular ve ifadeler kesinlikle engellenmelidir:

```sql
INSERT
UPDATE
DELETE
DROP
ALTER
TRUNCATE
CREATE
GRANT
REVOKE
MERGE
CALL
EXEC
EXECUTE
COPY
VACUUM
REINDEX
COMMENT
LOCK
SET
RESET
DO
```

Ayrıca çoklu statement çalıştırılması engellenmelidir.

Örnek olarak aşağıdaki sorguya izin verilmemelidir:

```sql
SELECT * FROM users; DELETE FROM users;
```

SQL comment veya farklı karakter kullanılarak güvenlik kontrolünün aşılması engellenmelidir.

Sadece metin içerisinde `SELECT` ile başlayıp başlamadığını kontrol etmek yeterli değildir.

SQL parser veya güvenli bir sorgu doğrulama mekanizması kullanılmalıdır.

Veritabanı bağlantısı da read-only yetkiye sahip ayrı bir kullanıcı ile yapılmalıdır.

Bu kullanıcıya hiçbir şekilde write yetkisi verilmemelidir.

## Limit Kuralları

Varsayılan limit:

```text
200
```

Maksimum limit:

```text
10.000
```

Kullanıcı limit yazmazsa otomatik olarak 200 uygulanmalıdır.

Kullanıcı 10.000 üzerinde limit girerse maksimum 10.000 uygulanmalıdır veya sorgu reddedilmelidir.

## Tablo İsimleri Yardımı

Custom SQL alanında tablo isimleri kullanıcıya yardımcı olacak şekilde gösterilmelidir.

Yardım alanında aşağıdaki bilgiler bulunmalıdır:

* Kullanılabilir schema isimleri
* Kullanılabilir tablo isimleri
* Tablo alias isimleri
* Tablo açıklamaları
* Kolon isimleri
* Kolon veri tipleri
* Örnek SELECT sorguları
* JOIN örnekleri
* LIMIT kullanımı
* Salt-okunur güvenlik açıklaması

Örnek yardım tablosu:

| Schema | Tablo               | Alias                  | Açıklama                                    |
| ------ | ------------------- | ---------------------- | ------------------------------------------- |
| public | awx_job_templates   | AWX Job Şablonları     | AWX template kayıtlarını içerir             |
| public | audit_logs          | Denetim Kayıtları      | Portal işlem geçmişini içerir               |
| public | page_elements       | Sayfa Erişim Öğeleri   | Sayfa, tab ve buton görünürlüklerini içerir |
| public | user_role_overrides | Kullanıcı Rol Override | LDAP dışı manuel rol atamalarını içerir     |

Örnek sorgular:

```sql
SELECT *
FROM awx_job_templates
LIMIT 200;
```

```sql
SELECT *
FROM audit_logs
ORDER BY created_at DESC
LIMIT 200;
```

```sql
SELECT element_key, element_name, active, user_visible
FROM page_elements
ORDER BY sort_order
LIMIT 200;
```

Custom SQL ekranında yapılan bütün sorgular audit log’a yazılmalıdır.

Audit kaydında en az şu bilgiler bulunmalıdır:

* Sorguyu çalıştıran kullanıcı
* Sorgu metni
* Çalıştırma zamanı
* Dönen satır sayısı
* İşlem süresi
* Başarılı/başarısız durumu
* Hata mesajı
* Kullanılan schema
* Kullanılan tablolar

---

# 21. Genel Veritabanı Kontrolü

Yukarıda belirtilen bütün alanlar için mevcut kod ve veritabanı yapısı incelenmelidir.

Her özellik için aşağıdaki kontrol yapılmalıdır:

1. Veri şu anda nerede tutuluyor?
2. Veritabanında bir tablo var mı?
3. Tablo varsa gerçekten kullanılıyor mu?
4. Frontend veriyi API üzerinden mi alıyor?
5. Backend veriyi DB’den mi alıyor?
6. Statik fallback var mı?
7. `.env` üzerinden gelen alanlar var mı?
8. Uygulama restart olduğunda veri korunuyor mu?
9. Admin ekranından düzenlenebiliyor mu?
10. Değişiklik audit log’a yazılıyor mu?

Veritabanında olmayan ancak kalıcı olması gereken alanlar için yeni tablolar eklenmelidir.

Var olan tablolar eksikse migration ile güncellenmelidir.

---

# 22. Beklenen Sonuç

Çalışma tamamlandığında:

* Self Service kayıt hatası düzeltilmiş olmalıdır.
* HTML response’un JSON parse edilmesi problemi çözülmüş olmalıdır.
* AWX job logları portalda doğru şekilde gösterilmelidir.
* Başarısız AWX jobların mevcut stdout bilgisi de gösterilmelidir.
* Self Service execute işlemleri audit log’a yazılmalıdır.
* LogX yapılandırmaları DB’de tutulmalıdır.
* OCP Cluster Hiyerarşisi DB’de tutulmalıdır.
* Terminal/Bastion Host bilgileri DB’de tutulmalıdır.
* Legacy Ortam Son-Eki bilgileri DB’de tutulmalıdır.
* Kısıtlamalar DB’de tutulmalıdır.
* Smart, Ansible ve Diğerleri grup yapıları DB’de tutulmalıdır.
* Grup, alt grup ve servis yapıları dinamik olmalıdır.
* Nöbet bilgileri dinamik çekilmelidir.
* Görevler DB’de tutulmalıdır.
* AWX şablonları dinamik çekilebilmelidir.
* OCP cluster kayıtları DB’de tutulmalıdır.
* Playbook kayıtları DB’de tutulmalıdır.
* Kullanıcı tablo görünürlükleri DB’de tutulmalıdır.
* Tablo alias bilgileri DB’de tutulmalıdır.
* Kullanıcı rol override kayıtları DB’de tutulmalıdır.
* Sayfa, tab, buton ve modül erişimleri DB’de tutulmalıdır.
* Sayfa erişim sistemi anında yansımalıdır.
* Yardım butonunda dummy tablo örnekleri gösterilmelidir.
* Veriler mantığı uygunsa eklenebilir, düzenlenebilir, güncellenebilir ve silinebilir olmalıdır.
* Portal restart ve deployment işlemlerinden sonra ayarlar kaybolmamalıdır.
* `Gözlemlenebilirlik` kaldırılmalıdır.
* `LogX` ayrı bir menü veya buton olmalıdır.
* Custom SQL yalnızca read-only çalışmalıdır.
* Custom SQL hiçbir şekilde veri değiştirememelidir.
* Custom SQL yardım alanında tablo ve kolon bilgileri gösterilmelidir.
* Portal üzerinde kalıcı olması gereken mümkün olan her şey veritabanı tabanlı ve dinamik hale getirilmelidir.
