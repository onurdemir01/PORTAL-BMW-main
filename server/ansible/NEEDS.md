# Ansible / OCP Entegrasyonu — Gerekli Bilgiler

Bu dosya, Sprint 11 Ansible ve OCP özelliklerini etkinleştirmek için doldurulması gereken
bağlantı bilgilerini listeler. Doldurduktan sonra `.env.local` veya production secret store'a ekleyin.
Bu dosyayı git'e commit etmeyin; sadece referans olarak kullanın.

---

## Ansible AWX / Tower

```env
# AWX REST API base URL (örn: https://maestro2 veya https://10.x.x.x)
AWX_URL=

# AWX Personal Access Token (Settings > Users > Tokens)
AWX_TOKEN=

# Virgülle ayrılmış izin verilen Job Template ID'leri (SADECE read-only template'lar)
# Bu ID'lerin dışındaki template'lar /api/ansible/run endpoint'inden reddedilir.
AWX_READ_ONLY_TEMPLATE_IDS=

# Örnek:
# AWX_URL=https://maestro2
# AWX_TOKEN=eyJ0eXAiOiJKV1Q...
# AWX_READ_ONLY_TEMPLATE_IDS=101,102,103,104,105
```

---

## OCP Cluster Jump Server Bilgileri

`server/ansible/ocp-clusters.json` dosyasını düzenleyin:

```json
{
  "clusters": [
    {
      "name": "ocp-prod-01",
      "display": "OCP Production 1",
      "jumpServer": "10.x.x.x",
      "jumpUser": "svc_user",
      "ocpUrl": "https://api.ocp-prod-01.example.com:6443"
    }
  ]
}
```

Her cluster için:
- `name`: kod içinde kullanılan kısa ad (değiştirilmez)
- `display`: UI'da gösterilen ad
- `jumpServer`: SSH jump host IP (OCP API'ye erişim için)
- `jumpUser`: SSH kullanıcı adı
- `ocpUrl`: OCP API endpoint

---

## LDAP (henüz doldurulmadıysa)

```env
LDAP_URL=ldaps://adds.fw.garanti.com.tr:636
LDAP_BASE_DN=DC=fw,DC=garanti,DC=com,DC=tr
LDAP_BIND_DN=CN=svc_portal,OU=ServiceAccounts,DC=fw,DC=garanti,DC=com,DC=tr
LDAP_BIND_PASSWORD=
LDAP_ADMIN_GROUP=CN=BMW_Portal_Admins,OU=Groups,DC=fw,DC=garanti,DC=com,DC=tr
LDAP_USER_GROUP=CN=BMW_Portal_Users,OU=Groups,DC=fw,DC=garanti,DC=com,DC=tr
# Şirket CA sertifikası PEM dosyası yolu (LDAPS doğrulaması için)
LDAP_CA_CERT_PATH=/etc/ssl/garanti-root.pem
```

---

## LogX Ansible Log Fetch Template

```env
AWX_LOG_FETCH_TEMPLATE_ID=   # AWX template ID for fetch_remote_logs.yml playbook
# This template must be in AWX_READ_ONLY_TEMPLATE_IDS list
```

---

## Güvenlik Notları

- `AWX_TOKEN` ve `LDAP_BIND_PASSWORD` ASLA kaynak koda yazılmaz.
- `AWX_READ_ONLY_TEMPLATE_IDS` yalnızca analiz/izleme playbook'larını içermeli.
  Değişiklik yapan (changed: true) herhangi bir task içeren template'lar bu listeye EKLENMEMELİ.
- Production'da bu değerler vault, Kubernetes secret veya CI/CD secret store'dan inject edilmeli.
