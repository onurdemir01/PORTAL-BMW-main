# Playbook Kayıtları — AI'ın Kendi Kararıyla Çağırdığı Tanılama Araçları

Bu doküman, AI Analist'in sohbette kendi kararıyla çağırabildiği salt-okunur Ansible
tanılama playbook'larının (JVM heap, network, disk, sistem sağlığı, OpenShift pod durumu, vb.)
nasıl çalıştığını ve yeni bir tane nasıl ekleneceğini anlatır.

## Bu sistem neyi çözüyor, ne DEĞİL

Bu, portaldaki **ayrı** "AWX'ten template listele → Self Service kataloğuna kaydet" akışıyla
(`AnsibleConfigTab.tsx`, `SelfServiceAdminTab.tsx`, `ansible-ss-items.json`) **karıştırılmamalı**.
O akış kullanıcının portal üzerinden manuel tetiklediği self-service işlemler içindir.

Playbook Kayıtları sistemi ise **AI'ın sohbette otomatik/kendi kararıyla** çağırdığı, her zaman
salt-okunur (read-only), parametreleri AI'ın kendisinin doldurduğu tanılama araçları içindir.
İkisi tamamen paralel, birbirine dokunmayan iki sistemdir.

## Mimari — tek bakışta

1. `server/ansible/playbooks/*.yml` — salt-okunur Ansible playbook dosyaları (dosya sistemi,
   yalnızca referans/dokümantasyon amaçlı — gerçek çalıştırma AWX üzerinden olur).
2. `ansible_playbook_registry` (DB tablosu) — hangi playbook'un hangi AWX job template ID'sine
   karşılık geldiğinin tek doğruluk kaynağı. `server/db/mssql-setup.cjs` içinde idempotent olarak
   kurulur ve 7 satırlık başlangıç seed'i (`awx_template_id = NULL` ile) eklenir.
3. `server/ansible/playbook-registry.cjs` — DB CRUD katmanı + **`getEffectiveTemplateId(row)`**:
   önce DB'deki `awx_template_id`'ye bakar, o boşsa `.env`'deki `env_var_name` değişkenine bakar.
   İkisi de yoksa `null` döner.
4. `server/ai-analyst/portal-tools.cjs` → `buildRegistryTools()` — DB'deki `enabled=1` satırları
   okur, her biri için `getEffectiveTemplateId()` çağırır. **Template ID bulunamayan satır sessizce
   atlanır** — bu, "tanımlanmamışsa kullanıcı fark etmemeli" kuralının uygulandığı tek yer. AI'a o
   araç hiç sunulmaz; dolayısıyla AI onu hiçbir zaman çağırıp hata alamaz.
5. `server/ansible/runner.cjs` — admin CRUD route'ları (`/api/ansible/playbooks*`) + herkese açık
   `GET /api/ansible/playbooks/available` (yalnızca `enabled` + template ID'si çözülebilen
   satırları döner, template ID'nin kendisini asla sızdırmaz).
6. `src/components/admin/tabs/PlaybookRegistryTab.tsx` — Admin > Playbook Kayıtları ekranı
   (ekle/düzenle/sil, template ID kaynağını "DB" / ".env" / "Tanımsız" rozetiyle gösterir).
7. `src/components/logx/LogXPage.tsx` — seçili host için `available()`'dan gelen araçları
   dinamik buton listesi olarak gösterir, `POST /api/logx/playbook-run` ile çalıştırır.

## Yeni bir tanılama playbook'u eklemek (kod değişikliği GEREKMEZ)

1. **Playbook'u yaz** — `server/ansible/playbooks/` altına, mevcut playbook'larla (`jvm_heap_status.yml`
   vb.) AYNI konvansiyonu takip ederek:
   - `hosts: "{{ target_hosts | default('all') }}"`
   - `gather_facts: false`, `become: false`
   - Her task'ta `ignore_errors: true` ve (shell/command varsa) `changed_when: false`
   - Shell operatörü (`||`, `|`, `2>/dev/null` vb.) kullanan HER task `ansible.builtin.shell`
     olmalı — `ansible.builtin.command` shell çağırmaz, operatörleri işleyemez ve task'ı
     hard-fail eder.
   - Sonuçları `ansible.builtin.debug` ile `.stdout_lines` olarak yüzeye çıkar (AWX job
     çıktısında görünmesi için).
   - `ansible-playbook --syntax-check` ve `ansible-lint --profile production` ile doğrula.
2. **AWX'te bir job template olarak kaydet** (bu adım portalın dışında, kurumsal AWX/Tower
   arayüzünden yapılır) ve numeric template ID'yi not al.
3. **Admin > Playbook Kayıtları**'ndan yeni kayıt ekle: anahtar adı (`key_name`, örn.
   `dns_lookup_check`), görünen ad, açıklama (AI'ın "ne zaman kullanmalı" kararını buradan verir),
   kategori, ve AWX template ID (DB'ye direkt yazılır) **VEYA** template ID alanını boş bırakıp
   `.env`'e `AWX_<ANAHTAR_BÜYÜK_HARF>_TEMPLATE_ID=<id>` satırı ekle (otomatik oluşan
   `env_var_name` alanı bunu bekler).
4. Hepsi bu — **kod değişikliği veya sunucu yeniden başlatma gerekmez** (env değişikliği hariç;
   `.env` değişikliği sunucu restart'ı gerektirir, DB üzerinden template ID girmek gerektirmez).

## `host_target` vs `ocp_cluster` handler

- **`host_target`** (varsayılan, admin ekranından oluşturulan HER yeni kayıt bunu kullanır):
  tek parametre — `hostname`. AI veya LogX sayfası bir host adı verir, playbook
  `target_hosts` extra_var'ı olarak alır. Yeni playbook'ların neredeyse tamamı bu kalıba uyar.
- **`ocp_cluster`**: yalnızca `ocp_pod_status` seed satırı için — cluster adından jump/bastion
  host çözümlemesi gerektiren özel mantık (`makeOcpPodStatusTool` içinde, `portal-tools.cjs`).
  Bu handler yalnızca kod tarafında tanımlıdır, admin ekranından yeni `ocp_cluster` kaydı
  oluşturulamaz (silinemez de — UI'da kilitli).

## "Sessiz başarısızlık" ilkesi — neden ve nasıl

Kullanıcı gereksinimi açıktı: bir playbook yapılandırılmamışsa veya bir sorunu varsa, sohbetteki
kişi bunu ASLA fark etmemeli. Bu üç katmanda uygulanır:

1. `getEffectiveTemplateId()` — DB VEYA env'den ID bulunamazsa `null` (hata fırlatmaz).
2. `buildRegistryTools()` — `null` dönen satırları `continue` ile atlar (AI'a o araç hiç
   sunulmaz — LLM onu görmediği için asla çağırmaya çalışamaz).
3. `GET /api/ansible/playbooks/available` — aynı filtreyi LogX sayfası için uygular; buton hiç
   render edilmez.

Yalnızca **admin** ekranında (Playbook Kayıtları), yapılandırma eksikliği görünür kılınır
("Tanımsız" rozeti) — çünkü orayı düzeltecek kişi zaten admin'dir.

## Dokunulmayan sistemler

`AnsibleConfigTab.tsx` (gerçek AWX template'lerini listeleme), `SelfServiceAdminTab.tsx` /
`SelfServicePage.tsx` (`ansible-ss-items.json`, `ansibleApi.saveSsItem`/`launchSs`) — bunlar bu
sistemin dışındadır ve bu playbook kayıt sistemi tarafından hiçbir şekilde değiştirilmez veya
üzerine yazılmaz.
