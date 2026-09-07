# AWX'e kopyalama haritası

`server/ansible/bmw_portal/` klasörü, AWX projesindeki `bmw_portal/` ile **birebir
aynıdır**. Klasörü olduğu gibi kopyalayabilirsiniz:

```bash
cp -r server/ansible/bmw_portal/ <AWX_PROJECT_DIR>/
```

## Neden birebir aynı olmak zorunda

Bu kozmetik bir tercih değil. Playbook'lar kimlik dosyasını **`playbook_dir`'e göreli**
arar:

```yaml
playbook_dir ~ '/../../../bmw_openshift_jobs/global_variables/credentials.yaml'
```

İki repoda derinlik aynı olmazsa, portalda geçen bir şey AWX'te patlar.

> **Üretimde bu oldu (AWX #3296360, #3296365, #3296411 — 2026-09-06).** Playbook AWX'te
> `bmw_portal/logx/ocp/` altına (üç seviye) taşınmıştı ama yolu iki seviye varsayıyordu.
> Kimlik dosyası bulunamadı, **Ansible bunu hata saymadı**, parola boş kaldı,
> `oc login` sessizce patladı ve ekran `Missing or incomplete configuration info`
> diye yanıltıcı bir hata gösterdi — kullanıcıyı elinde olmayan `~/.kube/config`
> dosyasına yönlendirerek. Portal reposunda hiçbir test kırmızı dönmemişti: burada
> ağaç düzdü ve "derinlik" diye bir kavram yoktu.

`server/ansible/__tests__/playbook-tree.test.cjs` (AT3) artık her playbook'un göreli
yollarının **kendi derinliğiyle** tutarlı olduğunu ölçer.

## Ağaç

| Portal                            | AWX                       | Derinlik |
| --------------------------------- | ------------------------- | -------- |
| `bmw_portal/logx/legacy/`         | `bmw_portal/logx/legacy/` | 2        |
| `bmw_portal/logx/ocp/`            | `bmw_portal/logx/ocp/`    | 2        |
| `bmw_portal/opsx_legacy_dump/`    | aynı                      | 1        |
| `bmw_portal/opsx_openshift_dump/` | aynı                      | 1        |
| `bmw_portal/scalex/scalex_app/`   | aynı                      | 2        |
| `bmw_portal/telnet_openshift/`    | aynı                      | 1        |

`bmw_openshift_jobs/` **`bmw_portal/` ile kardeştir** — yani her iki repoda da aynı
kökün altında. Derinlik `d` olan bir playbook'un kimlik dosyasına ulaşmak için
`(d+1)` adet `../` gerekir.

## Ad değişikliği

Portal içinde `ocp_telnet_control` diye anılan playbook AWX'te
**`telnet_openshift/telnet_openshift.yaml`** adıyla durur. Eşleme
`server/ansible/paths.cjs` içindeki `PLAYBOOKS` haritasındadır — tek kaynak orasıdır.

## AWX'e KOPYALANMAYANLAR

`server/ansible/playbooks/` altındakiler AWX projesinde **yoktur**: portal/AI
tanılaması için dururlar (`nginx_status.yml`, `disk_usage_status.yml`, …). Oraya
kopyalamayın. `AT4` bekçisi iki ağaçta aynı adın bulunmadığını doğrular.

## Yeni playbook eklerken

1. AWX'teki **gerçek** yerini ve adını öğrenin.
2. `server/ansible/bmw_portal/` altına aynı yolla koyun.
3. `server/ansible/paths.cjs` → `PLAYBOOKS` haritasına ekleyin.
4. `npm test` — `AT2` kayıtsız dosyayı, `AT3` yanlış derinliği yakalar.
