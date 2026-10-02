# OpsX WAS (WebSphere ND): keşif ve tek JVM restart / stop / start

OpsX Legacy ekranının WAS kolu. Bir uygulamanın envanterdeki hostlarında **salt okunur keşif**
yapılır, kullanıcı **tek bir (host, JVM)** seçer, JVM adını elle yazarak onaylar ve işlem yalnız o
JVM'e uygulanır. Toplu işlem yoktur: UI tek seçim, Portal tek string host, playbook `assert` +
`add_host`, bekçiler (bkz. "Bekçiler").

Tasarım: 2026-10-02 (OpsX Legacy WAS tasarımı). Kullanıcı kararları:

| Karar | Seçim |
|---|---|
| K1 | **a**: play düzeyinde `become: true`, `become_method: dzdo`, `become_user: was` (server_hub_fix.yml deseni). Yeni dzdo kuralı yok; betikte dzdo/sudo/su **yok**; betik `id -un` was değilse FAIL. |
| K2 | **a**: kimlik hostun profil `properties/soap.client.props` dosyasından. Portal, AWX, extra_vars ve log parolayı hiç görmez. Betik dosya içeriğini basmaz, yalnız `loginUserid` satırını sayar. Kimlik yoksa işlem **yapılmaz**, sonuç `OLCULEMEDI` (kimlik). |
| K3 | **a**: stop'ta kill **yok**. Restart'ta **stop süresi dolup** (stopServer rc 124/137 ya da `ADMU3060E`) süreç hâlâ varsa ya da JVM ASKIDA ise `kill -9` **yalnız** cell+node+server üçlüsüyle **tek** PID eşleşirse; sonra start. Hızlı ret (yetki, çalıştırılamayan betik) süre dolması değildir: kill yok, FAIL. |
| K4 | **a**: prod için ek kapı yok (JBoss ile aynı): her ortamda JVM adını elle yazarak onay + ortam rozeti + denetim kaydı (Portal). |

## Dosyalar

| Dosya | İş |
|---|---|
| `opsx_was_discover.yml` | Keşif (salt okunur). `target_hosts` (≤ 10) → `add_host` → was ile `bash` → `set_stats opsx_was_discover_result`. |
| `opsx_was_operation.yml` | İşlem. Girdi kapısı (`assert`) → tek `add_host` → was ile `bash` → `set_stats opsx_was_op_result` → FAIL/OLCULEMEDI'de `fail`. OK/SKIP'te GBLABT02'de tek satırlık envanter yazımı. |
| `files/opsx_was.sh` | Ölçüm + işlem betiği (`MODE=discover` ya da `MODE=op`). Tek sınıflandırıcı (`classify`). |
| `files/update_wasapp_status.py` | `dbo.WASAppsInventory` tek satır `UPDATE ... WHERE host = ? AND app = ?`. |

Portal'daki birebir aynası: `server/ansible/bmw_portal/opsx_was/**` (iki kopya **bayt bayt aynı**).

## Akış

1. **Keşif** (`opsx_was_discover`): Portal, uygulamanın `dbo.WASAppsInventory` hostlarını (en çok 10)
   `target_hosts` ile gönderir. Her host için betik `MODE=discover` koşar: profilleri, kendi
   node'unun JVM'lerini, küme üyeliklerini, kimlik varlığını ve her JVM'in durumunu ölçer.
   **Erişilemeyen host listeden düşmez** (`overall: olculemedi`).
2. **Seçim ve onay** (Portal): yalnız ölçülmüş, durumu işleme uygun tek JVM; JVM adı elle yazılır.
3. **İşlem** (`opsx_was_operation`): betik hedefi config'den **yeniden** türetir (profil →
   cell/node → serverindex.xml'de `APPLICATION_SERVER` mı), kimliği sayar, önceki durumu ölçer,
   duruma uymayan işlemde komut çalıştırmaz (`SKIP`), sonra işlemi uygular ve sonucu ölçer.
4. **Sonuç**: `set_stats` **her yolda** yayınlanır (girdi reddi, erişilemeyen host, betik
   kopyası doğrulanamadı, betik RESULT basmadı, beklenmeyen hata dahil); sonra FAIL/OLCULEMEDI
   ise job düşürülür. Portal artifact'ı başarısız işte de okur.

## Portal ↔ AWX sözleşmesi

Portal katalog anahtarları: `opsx_was_discover` (env `OPSX_WAS_DISCOVER_TEMPLATE_ID`) ve
`opsx_was_operation` (env `OPSX_WAS_OPERATION_TEMPLATE_ID`); ikisinde de `playbook_path` dolu.
**AWX'e `limit` gönderilmez** (AWX, Limit prompt-on-launch kapalıyken limit'i sessizce yutar);
hedef extra_var + `add_host` ile kurulur.

### Keşif: `opsx_was_discover.yml`

| extra_var | Kural |
|---|---|
| `target_hosts` | string, virgülle ayrılmış 1-10 host, her biri `^[A-Za-z0-9_.-]+$` (tekrarlar tekilleştirilir) |
| `was_server_filter` | isteğe bağlı, `^[A-Za-z0-9_.-]+$`. Verilirse yalnız o JVM **ve aynı kümedeki kardeşleri** ölçülür (keşif hızlanır). **Portal uygulama (JVM) adını gönderir**: çok JVM'li hostta hedef JVM keşif bütçesinden önce ölçülür; küme bilgisi ölçülemezse kardeşler listelenmez ve Portal bunu "küme bilinmiyor" sayar. |

`set_stats` anahtarı `opsx_was_discover_result`:

```
{ hosts: [ { host, overall: 'ok'|'olculemedi', reason,
             profiles: [ { profile, cell, node, kimlik: 'var'|'yok'|'olculemedi', reason,
                           servers: [ { server, cluster, state, pids, ss, reason } ] } ] } ],
  reason }
```

- `state`: `RUNNING` | `STOPPED` | `ASKIDA` | `COKLU_SUREC` | `OLCULEMEDI` (durum tablosu).
- `pids`: eşleşen süreç **sayısı**; ps ölçülemediyse `-1`.
- `ss`: `UP` | `ULASILAMIYOR` | `TANIMSIZ` | `?`.
- `cluster`: küme adı; üye değilse `''`; küme bilgisi **ölçülemediyse `'?'`** (`''` "üye değil"
  demektir, ölçülemeyen bilgi `''` yazılmaz). Birden çok kümede görünürse virgülle. Portal `'?'`yu
  **bilinmiyor** sayar: küme adı gibi gruplamaz; hedefin kümesi `'?'` ise stop/restart'ta "son
  çalışan" uyarısını (SON_CALISAN) her zaman ister.
- `overall: 'ok'` yalnız JVM **listesi tam** ise (profil okunamadı, `WAS_CELL` çözülemedi, geçersiz
  adlı JVM, listede olup erişilemeyen giriş, erişilemeyen host, betik sonuç basmadı → `olculemedi`).
  Liste tam ama bir JVM'in durumu ölçülemediyse (ör. kimlik yok, **keşif süre bütçesi aşıldı**)
  `overall` yine `ok`, o JVM `state: OLCULEMEDI`; bütçe aşımında host `reason`'ı ve RESULT mesajı
  "k JVM keşif süre bütçesi aşıldığı için OLCULMEDI" der.
- Profil olmayan dizin (`bin/setupCmdLine.sh` kesin yok) listede `servers: []` ve sebeple görünür,
  `overall`'ı bozmaz. WAS kurulu değilse `overall: ok`, `profiles: []`, sebep yazılı.
- Üst düzey `reason`: girdi reddedildiyse sebep (o durumda `hosts: []`), aksi halde `''`.
- Job: girdi reddi ya da en az bir host `olculemedi` ise **failed** (sonuç yine yayınlanır).

### İşlem: `opsx_was_operation.yml`

| extra_var | Kural |
|---|---|
| `target_host` | **TEK** host, string, virgülsüz, `^[A-Za-z0-9_.-]+$` |
| `was_profile`, `was_cell`, `was_node`, `was_server` | `^[A-Za-z0-9_.-]+$`; betik profilden cell/node'u yeniden okur, uyuşmazsa FAIL |
| `operation` | `restart` \| `stop` \| `start` |
| `consent` | `true` |
| `confirm_text` | `== was_server` (playbook `assert`'i ve betik ikisi de bakar) |
| `opsx_request_id` | isteğe bağlı, `^[A-Za-z0-9_.:-]{0,64}$` (sonuca `request_id` olarak geri yazılır) |
| `tbmwans_pwd` | AWX credential'dan (extra_var olarak Portal göndermez) |

`set_stats` anahtarı `opsx_was_op_result`:

```
{ host, profile, cell, node, server, op, request_id, before, after,
  result: 'OK'|'SKIP'|'FAIL'|'OLCULEMEDI',
  steps: [ { step, status, msg } ], line }
```

- `before` / `after`: durum adı ya da `-` (JVM durumu hiç ölçülmedi: girdi/kullanıcı/hedef/kimlik reddi).
- `request_id`: `opsx_request_id`'nin yansıması. Portal, sonucun başlattığı isteğe ait olduğunu
  bununla (ve host/JVM eşitliğiyle) doğrular; uyuşmazsa sonuç `OLCULEMEDI` sayılır.
- `steps`: betiğin `STEP` satırları + playbook adımları (`girdi`, `hedef`, `kopya`, `baglanti`,
  `betik`, `beklenmeyen_hata`, `envanter`). Adım durumunun anlamı aşağıda ("STEP durumu").
- `line`: betiğin `RESULT` satırı (ya da playbook'un ürettiği eşdeğeri).
- Job: `result` FAIL ya da OLCULEMEDI ise **failed**; OK/SKIP'te successful.

## Betik çıktı biçimi (`files/opsx_was.sh`)

TAB ayrımlı satırlar; son satır `RESULT`. Beklenmeyen çıkışta ve dış sınırın (playbook'taki
`timeout`) gönderdiği sinyalde `trap` basar: uzun komutlar arka planda + `wait` ile koştuğu için
trap ertelenmez (bkz. "Zaman bütçesi"). Dış sınırın KILL'i (`-k 30`) gelene kadar basılamazsa
playbook RESULT'suz koşuyu `OLCULEMEDI` sayar.

```
STEP\t<adim>\t<OK|SKIP|FAIL|OLCULEMEDI>\t<mesaj>
PROF\t<profil>\t<cell>\t<node>\t<kimlik>\t<sebep>
SRV\t<profil>\t<cell>\t<node>\t<server>\t<cluster>\t<state>\t<pids>\t<ss>\t<sebep>
DISCOVER\t<json: {"overall","reason","profiles":[...]}>
RESULT\t<op|discover>\t<OK|SKIP|FAIL|OLCULEMEDI>\t<once>\t<sonra>\t<mesaj>
```

- `PROF`, `SRV`, `DISCOVER` yalnız keşifte. Playbook keşif verisini **`DISCOVER` json'undan** alır;
  `PROF`/`SRV` AWX logunda okunur özet. Bekçi ikisinin aynı olduğunu sınar.
- **STEP durumu** adımın **hedefine** ulaşıp ulaşmadığıdır (Portal ↔ betik sözleşmesi):

  | Durum | Anlam |
  |---|---|
  | `OK` | adım hedefine ulaştı (ölçüm adımında, ör. `once`: durum ölçüldü) |
  | `OK` + mesaj `UYARI:` ile başlar | adım tamam ama dikkat gerektiren durum var (nodeagent yok, JVM ASKIDA, restart'ta JVM kendiliğinden geri geldi). Portal sarı "Uyarı" gösterir |
  | `SKIP` | bilerek yapılmadı (ör. `kill`: stop süresi dolmadı) |
  | `FAIL` | hedefe ulaşılamadı (ör. `stop_dogrulama`: JVM hâlâ RUNNING; `start_dogrulama`: RUNNING olmadı) |
  | `OLCULEMEDI` | ölçülemedi |

  `stop_dogrulama`/`start_dogrulama` yalnız hedef durum (STOPPED/RUNNING) ölçüldüyse `OK`'dir.
- rc: OK/SKIP 0, FAIL 1, OLCULEMEDI 3.
- Tüm mesajlar `clean()`'den geçer: TAB/satır sonu boşluğa, ASCII dışı silinir, 400 karakter,
  parola desenleri maskelenir (`password=...`, `password: ...`, tireli parola argümanı).
- Girdi (env): `MODE`, `OP`, `PROFILE`, `CELL`, `NODE`, `SERVER`, `CONSENT`, `CONFIRM`,
  `SERVER_FILTER`, `WAS_ROOT` (varsayılan `/usr/WebSphere/AppServer`), `OP_BUDGET_S`,
  `DISC_DEADLINE_S`. Diğer süre değişkenleri yalnız bekçi için (kısaltma).

## Hedef çözümleme (salt okunur, was olarak)

1. `profiles/*/bin/setupCmdLine.sh` dosyasından `WAS_CELL` ve `WAS_NODE` **okunur** (kaynaklanmaz).
2. Yalnız profilin **kendi** node'unun `config/cells/<cell>/nodes/<node>/serverindex.xml`'i okunur
   (Dmgr01'in ana deposu tüm node'ları içerir; okunmaz) ve yalnız
   `serverType="APPLICATION_SERVER"` girdileri alınır. nodeagent, dmgr ve web sunucusu hedef olamaz.
3. Küme: `config/cells/<cell>/clusters/*/cluster.xml` içindeki `memberName` + `nodeName`.
4. "Yok" ile "okunamadı" ayrılır: **yok** yalnız yol `[ -e ]` ile görülemiyor, üst dizin
   listelenebiliyor (`ls -A`) **ve listede o ad yok** iken. Listede görünüp `[ -e ]` ile görülemeyen
   giriş (x izni olmayan `r--` dizin, çözülemeyen bağ) ve listelenemeyen üst dizin **ölçülemedi**.
   Aynı kural profil listesinde (listede olup erişilemeyen profil `olculemedi` kaydı olur, host
   `overall: olculemedi`) ve `clusters/` listesinde (küme `'?'`) uygulanır; hiçbir giriş sessizce
   atlanmaz (yalnız düzenli dosya "profil/küme değil" diye atlanır).

## Durum tablosu

İki bağımsız ölçüm:

- **PS**: `ps -eo pid=,args= -ww` satırlarının **son üç alanı** `<cell> <node> <server>` ile
  **tam** eşleşen süreç sayısı N (`app1` ile `app10` karışmaz; başka node'daki aynı adlı JVM
  sayılmaz). ps'in rc'si 0 değilse ya da çıktı boşsa PS = `?`.
- **SS**: `serverStatus.sh <server>` (`timeout`, `</dev/null`). Yalnız bilinen kodlar:
  `ADMU0508I` (ilgili sunucu adıyla) → UP, `ADMU0509I` (sunucu adıyla) → ULASILAMIYOR,
  `ADMU0522E` → TANIMSIZ. Zaman aşımı, **her** SECJ kodu (I/W/E fark etmez), ADMN0022E,
  ADMU0522E dışındaki her `ADMU....E`, yetki/kimlik/istisna metni, boş ya da çelişkili çıktı → `?`.
  UP/ULASILAMIYOR ayrıca **rc 0** ister. Sebep: WAS kimlik/yetki hatasında da "appears to be
  stopped" (ADMU0509I) basabilir; hata izi varsa kodlara bakılmaz (bekçi senaryosu D4).
  SECJ/ADMN0022E **kodları** satırın aslında aranır; serbest metin sözcükleri (DENIED, AUTHORIZ,
  EXCEPTION, PASSWORD...) ise sunucu ve profil **adları** (tam sözcük olarak) çıkarılmış satırda
  aranır: WAS adı log yolunda, `for <ad>` ve tırnak içinde basar; `AuthorizationWS` adlı JVM
  kendi adı yüzünden "kimlik hatası" sayılmaz (D11), adı bir kodla çakışan JVM'de kod yine
  yakalanır (D13).

| PS | SS | Durum | İzinli işlem |
|---|---|---|---|
| N=1 | UP | RUNNING | stop, restart |
| N=0 | ULASILAMIYOR | STOPPED | start |
| N=1 | ULASILAMIYOR | ASKIDA (süreç var, yanıt yok) | stop, restart (uyarıyla) |
| N≥2 | herhangi | COKLU_SUREC | hiçbiri |
| N=0 | UP | OLCULEMEDI (çelişki) | hiçbiri |
| N≥0 | `?` | OLCULEMEDI (çoğunlukla kimlik) | hiçbiri |
| `?` | herhangi | OLCULEMEDI | hiçbiri |
| herhangi | TANIMSIZ (serverindex.xml'de var) | OLCULEMEDI (tutarsızlık) | hiçbiri |

**Ölçülemeyen durum hiçbir zaman STOPPED yazılmaz**, envantere yazılmaz ve onunla işlem yapılmaz.
Kimlik yoksa (`kimlik` ≠ `var`) serverStatus hiç çalıştırılmaz; JVM `OLCULEMEDI` (`ss: ?`).

## İşlem akışı ve başarı ölçütleri

Komutlar (betikte, was olarak, parolasız):

```
DURUM : timeout -k 5 90   <profil>/bin/serverStatus.sh <server>                 </dev/null
STOP  : timeout -k 15 330 <profil>/bin/stopServer.sh   <server> -timeout 300    </dev/null
START : timeout -k 15 630 <profil>/bin/startServer.sh  <server> -timeout <=600  </dev/null
```

Sıra: kullanıcı (`id -un` = was) → girdi (OP, CONSENT, adlar, CONFIRM) → hedef (profil, cell/node
uyumu, `APPLICATION_SERVER`) → kimlik (sayım) → nodeagent süreci (yoksa **uyarı** adımı: JVM başlar
ama izlenmez) → önceki durum → işlem.

- **TOCTOU**: önceki durum işleme uymuyorsa komut çalıştırılmaz, sonuç `SKIP`
  (stop+STOPPED, start+RUNNING, start+ASKIDA, restart+STOPPED). Önceki durum OLCULEMEDI ise
  `OLCULEMEDI`, COKLU_SUREC ise `FAIL` (ret); ikisinde de komut yok.
- **stop OK**: stopServer rc 0, 6×10 sn pencerede STOPPED, **60 sn sonraki stabilite ölçümünde hâlâ
  STOPPED** (nodeagent geri getirmedi). Geri geldiyse FAIL. Pencere dolup süreç duruyorsa FAIL
  "durdurulamadı" + PID (kill **yok**).
- **start OK**: startServer rc 0 ve 30×10 sn pencerede RUNNING. ASKIDA kalırsa FAIL "süreç var,
  e-business açılmadı".
- **restart**: stop → (gerekirse K3-a kill) → 60 sn stabilite → start. Stabilitede JVM kendiliğinden
  geri geldiyse (nodeagent) startServer çalıştırılmaz, RUNNING beklenir (`stabilite` adımı `OK` +
  `UYARI:`). Stop hızlı reddedildiyse ve JVM yanıt veriyorsa (RUNNING) sonuç FAIL "stop başarısız
  ...; kill -9 YAPILMADI", start çalıştırılmaz. Kill yapıldıysa OK mesajı bunu söyler
  ("stop tamamlanamadı, kill -9 ile").
- Pencereler **duvar saatidir** (yavaş serverStatus pencereyi uzatmaz). Son ölçüm OLCULEMEDI ise
  sonuç `OLCULEMEDI` (rc 3): Portal'da ayrı (sarı) "gerçek durum bilinmiyor".

## Kill politikası (K3-a)

- **stop**: `kill` hiç yok. Süre dolarsa FAIL "durdurulamadı" + eşleşen PID'ler.
- **restart**: stop penceresi dolup durum RUNNING/ASKIDA ise `kill_one` **yalnız şu iki
  durumda** çağrılır:
  1. stop **gerçekten süre doldurdu**: stopServer'ın dış `timeout`'u doldu (rc 124/137) ya da WAS'ın
     kendi zaman aşımı kodu `ADMU3060E` basıldı;
  2. pencere sonunda JVM **ASKIDA** (süreç var, yanıt yok): graceful stop zaten mümkün değil.

  Aksi halde (ör. `ADMN0022E` yetki reddi, rc 126/127 çalıştırılamayan stopServer; JVM RUNNING ve
  yanıt veriyor) `kill` adımı `SKIP` "stop süresi DOLMADI", sonuç FAIL, start yok. `kill_one`: ps
  yeniden ölçülür; cell+node+server üçlüsüyle **tek** PID eşleşiyorsa `kill -9 <pid>` ve PID'in
  kaybolması 30 sn beklenir; sonra stabilite + start. İki ve daha fazla PID → kill **yapılmaz**,
  FAIL (COKLU_SUREC). ps ölçülemezse kill yapılmaz, OLCULEMEDI. `kill` adımı gerçek sebebi yazar.
- Toplu öldürme komutları ve süreç adına göre öldürme hiç kullanılmaz; `kill -9` betikte tek yerde.
  Betikteki tek diğer `kill`, dış sınırda `on_exit` içinde **betiğin kendi başlattığı** iç
  `timeout` sürecine giden `kill -TERM "$CHILD"`dir (JVM'e değil; bkz. "Zaman bütçesi").

## Kimlik (K2-a)

- Kaynak: `<profil>/properties/soap.client.props`. Betik yalnız
  `grep -Ec '^[[:space:]]*com\.ibm\.SOAP\.loginUserid[[:space:]]*=[[:space:]]*[^[:space:]]'` ile
  satır **sayar**; içeriği (kullanıcı adı, parola) hiçbir zaman basmaz.
- `kimlik: var` (≥1 satır) | `yok` (dosya yok ya da boş loginUserid) | `olculemedi` (okunamadı).
- Kimlik yoksa serverStatus/stop/start **çalıştırılmaz**: keşifte JVM `OLCULEMEDI`, işlemde
  sonuç `OLCULEMEDI` (`before: -`).
- Komut satırında kullanıcı/parola argümanı **yoktur**; komutlar `</dev/null` ile koşar (kimlik
  eksikse istemde asılı kalmaz).

## Kullanıcı ve yetki (K1-a)

- WAS komutları **yalnız was** ile; HTTP sunucusu kullanıcısı hiç kullanılmaz.
- Uzak play: `become: true`, `become_method: dzdo`, `become_user: was`. dzdo'nun gördüğü tek satır
  Ansible'ın `dzdo ... -u was /bin/sh -c 'echo BECOME-SUCCESS-...; <python>'` satırıdır (WAS
  envanteri her gece aynı yolla koşar). Yeni dzdo kuralı **istenmez**. Bu, sarmalayıcı dzdo
  kuralının bilinen istisnasıdır (server_hub README, S2).
- Betik kopyası bağlanan kullanıcıyla (`become: false`) `/var/tmp`'de koşuya özel `tempfile` adına
  yazılır; çalıştırmadan önce **sha1 + sahip uid + düzenli dosya + grup/diğer yazamaz** doğrulanır;
  `always` ile silinir. `ansible.builtin.script` kullanılmaz (copy + `bash`), `ansible_pipelining: true`.

## Zaman bütçesi

| | Değer |
|---|---|
| İşlem betiği iç bütçe (`OP_BUDGET_S`) | 1500 sn; restart sonunda start süresi ve RUNNING penceresi kalan bütçeye sığdırılır (start en az 60 sn) |
| İşlem komutu dış sınırı | `timeout -k 30 1560 bash <betik>` (dolarsa aşağıdaki trap yolu) |
| Keşif bütçesi (`DISC_DEADLINE_S`) | 300 sn; aşılırsa kalan JVM'lerde serverStatus çalıştırılmaz (OLCULEMEDI, `ss: ?`); liste tam olduğu için `overall: ok`, ama RESULT mesajı ve host `reason`'ı "k JVM ... bütçe aşıldığı için OLCULMEDI" der |
| Keşif komutu dış sınırı | `timeout -k 30 420 bash <betik>` |

Dış sınır dolduğunda: GNU `timeout` bash'e TERM gönderir. WAS komutları (`serverStatus`,
`stopServer`, `startServer`) ve beklemeler **arka planda + `wait`** ile koştuğu için bash'in TERM
trap'i hemen çalışır (komut ikamesi `$(...)` içinde koşsalardı trap komut bitene kadar ertelenir,
bash `-k` süresinde KILL yer ve RESULT basılmazdı). `on_exit`: önce TERM/INT'i yok sayar (timeout
TERM'u hem bash'e hem gruba gönderir; ikincisi RESULT'u yutmasın), sonra iç `timeout`'a
`kill -TERM "$CHILD"` gönderir (iç timeout kendi süreç grubunu, yani WAS komutunu ve çocuklarını
sonlandırır; gerekirse kendi `-k`'sıyla KILL eder), `RESULT ... OLCULEMEDI` basar ("iç komut (pid)
sonlandırıldı"). Böylece Portal kilidi bıraktıktan sonra arka planda süren stop/start kalmaz
(bekçi O22). Playbook yine de RESULT'suz koşuyu `OLCULEMEDI` sayar (J6).

## Envanter yazımı (`dbo.WASAppsInventory`)

- Yalnız `result` OK/SKIP **ve** `after` ölçülmüş `RUNNING`/`STOPPED` iken; `running`/`stopped`.
  OLCULEMEDI, ASKIDA, COKLU_SUREC **yazılmaz**.
- GBLABT02'ye `delegate_to`; betik kopyası aynı sha1/uid/izin kapısından geçer; komut play
  become'unu (was) devralır (GBLABT02'deki diğer TBMWANS yükleyicileri gibi).
- Parola: AWX credential `tbmwans_pwd` → görevin **stdin**'i (`--pwd-stdin`), görev `no_log: true`.
  `environment:` kullanılmaz: Ansible ortam değerlerini become (dzdo) komut satırına yazar ve
  ps/dzdo denetim kaydında görünür. Sonuç satırı (`WASAPP_UPDATE\t<OK|NOROW|FAIL>\t<mesaj>`)
  parolasızdır ve ayrı görevde okunur.
- SQL: yalnız `UPDATE dbo.WASAppsInventory SET status = ?, updated_at = SYSUTCDATETIME() WHERE host = ? AND app = ?`
  (host = envanterdeki kısa, büyük harf ad). >1 satır eşleşirse geri alınır. DELETE/INSERT/MERGE yok.
- UPDATE'ten önce aynı oturumda `SET NOCOUNT OFF`. Etkilenen satır sayısı **bilinmiyorsa**
  (pyodbc rowcount -1/None) geri alınır ve `FAIL` "etkilenen satır sayısı bilinmiyor" yazılır;
  "OK (n satır)" yalnız gerçek sayı 1 iken basılır.
- `tbmwans_pwd` yoksa envanter adımı FAIL yazılır, işlem sonucu değişmez.

## AWX template ayarları

| Ayar | `opsx_was_discover` | `opsx_was_operation` |
|---|---|---|
| Playbook | `bmw_portal/opsx_was/opsx_was_discover.yml` | `bmw_portal/opsx_was/opsx_was_operation.yml` |
| Credential | makine credential'ı (uxmid, dzdo → was) | makine credential'ı + `tbmwans_pwd` veren custom credential |
| Extra variables prompt on launch | açık | açık |
| Limit prompt | kapalı (Portal limit **göndermez**) | kapalı |
| `allow_simultaneous` | açık olabilir (salt okunur) | **kapalı** |
| Timeout | 900 sn (15 dk) | 1800 sn (30 dk; Portal kilit TTL'si bundan uzun) |
| Forks | 10 (10 host tek turda) | varsayılan |
| Envanter | WAS hostlarını ve GBLABT02'yi çözebilen envanter | aynı |

Portal tarafı: `OPSX_WAS_DISCOVER_TEMPLATE_ID`, `OPSX_WAS_OPERATION_TEMPLATE_ID`.

## Tuzaklar

- `setupCmdLine.sh` kaynaklanmaz (`.`): yalnız `WAS_CELL`/`WAS_NODE` satırları okunur; değer
  `^[A-Za-z0-9_.-]+$` değilse profil `olculemedi`.
- Betikte `CELL`/`NODE` hem girdi hem çalışma değişkeni adıdır: girdiler betiğin başında
  `IN_*` olarak alınır (2026-10-02'de sıfırlama satırı girdiyi siliyordu; bekçi yakaladı).
- serverStatus yalnız süreç sayısı hedefe uyuyorsa koşar (pencere içinde), aksi halde ps yeter.
- Playbook `.yml` dosyalarında `#` satırı yok; açıklamalar burada.
- Uzun komutlar `$(...)` içinde koşturulmaz (trap ertelenir; bkz. "Zaman bütçesi"). Çıktı koşuya
  özel `mktemp -d` dizinine (0700) yazılır ve `on_exit`'te silinir; dizin oluşturulamazsa ölçüm ve
  işlem yapılmaz (`OLCULEMEDI`).
- 2026-10-02 düzeltici turunda kapatılanlar: restart'ta hızlı stop reddinde kill -9 (O18/O19),
  ad içindeki anahtar sözcükle sahte "kimlik hatası" (D11), `r--` dizinde "yok" (D15/G5), bütçe
  bekçisi (D14), dış sınırda RESULT'suz çıkış ve yetim WAS komutu (O22), rowcount -1'de "OK" (W6),
  hedefe ulaşmayan doğrulamanın `OK` görünmesi (O2/O13 + ortak değişmez).

## Bekçiler

- Ansible deposu: `python -B bmw_nginx/tests/check_opsx_was.py` (Git Bash, jinja2, PyYAML).
  Metin (W1-W3), gerçek betik + sahte WAS araçları + gerçek kukla süreçlerle davranış (W4),
  playbook karar zincirinin Jinja2 ile koşulması (W5), sahte pyodbc ile envanter (W6), README (W7),
  isteğe bağlı Portal aynası (W8, `OPSX_WAS_PORTAL_DEPO`). `OPSX_WAS_ONLY=<regex>` senaryo süzer.
  "Listede var ama erişilemiyor" durumu sahte `ls` ile her platformda (D15), gerçek `r--` izinleriyle
  yalnız izin semantiği olan ortamda (G5; Windows'ta ya da root'ta **ATLANDI** yazar, yeşil
  saymaz) ölçülür.
- Portal: `server/ansible/__tests__/opsx-was-playbook.test.cjs`,
  `server/ansible/__tests__/opsx-was-script.test.cjs` (iki depo aynası: `OPSX_WAS_ANSIBLE_DEPO`).
- Her bekçi mutasyonla doğrulanır (mutasyon yalnız kopyada; ortam değişkenleri `OPSX_WAS_SH`,
  `OPSX_WAS_OP_YML`, `OPSX_WAS_DISC_YML`, `OPSX_WAS_UPD`, `OPSX_WAS_README`).

## Kanarya

Bir prod dışı Linux WAS hostu, mümkünse küme üyesi olan:

1. `uxmid → was` become ve pipelining keşif playbook'unda çalışıyor mu; `dzdo -l` ile /bin/sh
   kuralının tam metni.
2. `setupCmdLine.sh` içindeki `WAS_CELL`/`WAS_NODE` ve `serverindex.xml` ayrıştırması; AppSrv01
   dışında profil adı var mı.
3. ps satırının son üç alanı gerçekten `<cell> <node> <server>` mı ve `-ww` gerekli mi; aynı anda
   elle koşan `serverStatus.sh <server>` süreci üçlüyle eşleşiyor mu (eşleşirse COKLU_SUREC = güvenli ret).
4. serverStatus / stopServer / startServer çıktı metinleri ve rc değerleri (8.5.5 ve 9.0.5);
   özellikle durmuş JVM'de serverStatus (ADMU0509I) rc'si 0 mı (değilse durmuş JVM'ler
   OLCULEMEDI görünür ve start açılmaz: güvenli taraf, ama kural gevşetilmeden önce ölçülmeli);
   kimlik yokken `</dev/null` ile asılmadan düşüyor mu.
5. `soap.client.props` içinde kimlik var mı (yalnız sayım); global security açık mı. Güvenliği
   kapalı hostta kimlik satırı yoksa işlem yapılmaz (K2-a gereği).
6. Graceful stop'tan sonra JVM 60 sn durmuş kalıyor mu; `kill -9` sonrası nodeagent onu geri
   getiriyor mu.
7. `WASAppsInventory.app` her zaman JVM adı mı; NOAPP ve `.ear` yedek adı oranı; env değerleri.
8. AWX template ayarları (yukarıdaki tablo); envanterdeki host adı (kısa, büyük harf) AWX'te çözülüyor mu.
9. AIX WAS host sayısı (v1 yalnız Linux).
10. GBLABT02'de python3/pyodbc (was ile) ve `tbmwans_pwd` credential'ı; `command` modülünün
    `stdin` parametresi become + pipelining ile parolayı iletiyor mu.
11. 30 dk template zaman aşımı en kötü restart'a (stop 300 + pencereler + start 600) yetiyor mu.
12. was kullanıcısı `${TMPDIR:-/tmp}` altında `mktemp -d` yapabiliyor mu (yapamazsa ölçüm/işlem
    yapılmaz, sonuç `OLCULEMEDI`); dış sınırda (`timeout` TERM) trap'in RESULT bastığı ve iç
    WAS komutunun sonlandığı gerçek RHEL'de bir kez gözlensin (bekçi O22 Git Bash ve WSL'de ölçer).
13. Gerçek WAS çıktısında sunucu adının geçtiği satırlar (ADMU0116I log yolu, ADMU0500I, ADMU0508I/0509I)
    ve stopServer'ın yetki reddi metni (`ADMN0022E`) ile zaman aşımı kodu (`ADMU3060E`) 8.5.5/9.0.5'te
    doğrulansın (kill kararı bu kodlara bağlı).

## Kapsam dışı

- `bmw_automation_folder/java_app_ops` ve `bmw_portal/java_app_ops` WAS görevleri (ters kurulmuş
  varlık kontrolü, içinde parola olan ölü kod): ayrı görev.
- Paylaşılan WAS bağlama hesabının parolasının döndürülmesi: ayrı görev.
- Uygulama düzeyi (tek EAR) ve küme düzeyi durdur/başlat: kapsam dışı (tasarım (2)).
