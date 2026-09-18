# opsx_openshift_pod_delete — OpsX › Openshift › "Çalışan podlarımı silmek (restart etmek) istiyorum"

`bmw_openshift_jobs/pod_restart` playbook'unun Portal sürümü. Farkı: kullanıcı `ns,pod;ns,pod`
metni yazmaz — Portal, dump akışıyla **aynı pod keşfini** (`opsx_openshift_pods.yaml`) çalıştırır,
kullanıcı listeden pod seçer, onay kutusunu işaretler ve bu playbook tetiklenir.

## Akış

1. Portal `POST /api/opsx/poddelete/openshift` → AWX job template (`opsx_openshift_pod_delete`,
   Admin › Playbook Kayıtları'nda Template ID doldurulmalı).
2. Play 1 — girdi doğrulama (`pod_delete_consent` **true değilse fail**) ve bastion fan-out
   (`terminal_hosts` → `opsx_terminal` grubu).
3. Play 2 — her bastion kendi cluster'larına `oc login` olur, seçilen her pod için:
   `oc get pod` (var mı?) → `oc delete pod <pod> -n <ns> --force`. Sonuç satırı
   `EXISTENCE|OK|MESAJ`. Hata bastion'u düşürmez (rescue).
4. Play 3 — sonuçlar birleştirilir, `set_stats opsx_pod_delete_result` ile Portal'a döner,
   isteği açana e-posta gider; `opsx_teams_webhook_url` tanımlıysa Teams kartı atılır.
   Hiçbir pod silinemediyse job **failed** (kısmi ise `overall_status: partial`, job yine failed
   olabilir — Portal sonucu her iki durumda da okur).

## extra_vars (Portal gönderir)

| Değişken | Açıklama |
|---|---|
| `ocp_clusters` | `resolveOcpClusterFanout` çıktısı — cluster adları/URL'leri |
| `terminal_hosts` | bastion host listesi |
| `ocp_pod_targets` | `[{cluster_name, namespace, pod}]` (en fazla 50) |
| `pod_delete_consent` | `true` — Portal'daki "Yaptığım işlemin sonuçlarını kabul ediyorum" kutusu |
| `email`, `requester` | bildirim + kayıt |

## set_stats çıktısı

```yaml
opsx_pod_delete_result:
  overall_status: ok | partial | failed
  results:
    - { cluster, namespace, pod, existence: Exist|Not Exist, ok: true|false, error?: "..." }
```

## Notlar / tuzaklar

- Teams webhook URL'si depoda **yazılmaz** (`sig=` içerir). AWX tarafında
  `opsx_teams_webhook_url` extra var/credential olarak verilmezse Teams adımı atlanır.
- Mail ayarları `../../bmw_openshift_jobs/global_variables/mail_vars.yml` varsa oradan,
  yoksa play içindeki varsayılanlardan gelir.
- Deployment/rollout'a dokunulmaz; sadece pod silinir, OpenShift yenisini ayağa kaldırır.
- `--force` kullanılır (kaynak playbook ile aynı) — graceful termination beklenmez.
