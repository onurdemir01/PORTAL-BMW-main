# Veri Kataloğu

Denetim › **Veri Kataloğu** sekmesi, Portal DB ve TBMWANS'taki her tablonun ne için tutulduğunu,
kimin yazdığını (Portal işi, AWX playbook'u ya da betik), kimin okuduğunu ve saklama kuralını
gösterir. Satır sayısı ve boyut veritabanından canlı okunur.

| Parça | Yer |
| --- | --- |
| Katalog (elle tutulur) | `server/katalog/tablolar.json` |
| Uç (salt okunur, 10 dk önbellek) | `GET /api/denetim/veri-katalogu` — `server/audit/veri-katalogu.cjs` |
| Ekran | `src/components/denetim/VeriKatalogu.tsx` |
| Bekçiler | `server/audit/__tests__/veri-katalogu-bekci.test.cjs` |
| Erişim | `tab:denetim:katalog` — varsayılan yalnız Admin; Admin › Denetim Erişimi ile açılır |

## Yeni tablo eklerken

Yeni bir tablo açan her değişiklik (Portal'da `CREATE TABLE`, Ansible'da `INSERT INTO dbo.X`,
`TABLE = "dbo.X"` vb.) **aynı committe** `server/katalog/tablolar.json`'a bir girdi ekler.
Eklenmezse bekçi kırmızı olur:

- **VB1** — `server/**` altındaki her `CREATE TABLE ad (` için `db: "Portal"` girdisi olmalı.
- **VB2** — her girdi geçerli olmalı (aşağıdaki alanlar).
- **VB3** — Ansible deposunda yazılan her tablo için `db: "TBMWANS"` girdisi olmalı. Görülen ad
  biçimleri: `INSERT/MERGE/UPDATE/TRUNCATE/DELETE ... dbo.X` (isteğe bağlı `[TBMWANS].` önekiyle),
  `TABLE = "dbo.X"`, tek başına tırnaklı `"dbo.X"` sabiti ve `("WDS_X", "x.csv", ...)` demeti
  (`wds_db_loader.py` KINDS). Depo `VERI_KATALOGU_ANSIBLE_DIR` ile verilir; verilmezse
  `~/Downloads/Compressed/gar_bmt_ansible_scripts` aranır, yoksa test **atlanır** (Portal tek başına
  da test edilebilsin). **VB3a** toplayıcının bu biçimleri gördüğünü depodan bağımsız sabitler.
  Bunların dışında bir biçimle (ör. adı başka dosyadan argüman olarak alan genel bir yükleyici)
  yazılan tablo görülmez: kataloğa elle eklenir.
- **VB4** — her `dosya` / `uzerinden` başvurusu gerçek olmalı: dosya ve satır var, satır **başka**
  bir katalog tablosunu göstermiyor (kayma) ve tabloya giden modül tablo adını **kodda** (yorumda
  değil) geçiriyor. Ansible yolları yalnız depo varsa denetlenir. **VB4a** sahte dosyalarla kilit.
- **VB5** — Portal kodunun `dbo.X` ile okuduğu her tablo (ve envanter gezgininin
  `FALLBACK_TABLES` listesi) katalogda olmalı.

Çalıştırma: `node --test server/audit/__tests__/veri-katalogu-bekci.test.cjs`

## Girdi biçimi

```json
{
  "db": "TBMWANS",
  "tablo": "Inventory",
  "amac": "Bir-iki cümle: bu tablo ne için var?",
  "alan": "Envanter",
  "yazanlar": [
    { "tur": "playbook", "ad": "middleware_inventory", "dosya": "yol:satir",
      "nasil": "TRUNCATE + INSERT", "ne_zaman": "Günlük AWX zamanlaması" }
  ],
  "okuyanlar": [
    { "ad": "Envanter gezgini", "dosya": "yol:satir" },
    { "ad": "OpsX hedef seçimi", "dosya": "server/opsx/index.cjs:103", "uzerinden": "server/config/apps-table.cjs" }
  ],
  "saklama": "her koşuda baştan yazılır",
  "notlar": "",
  "kullanilmiyor": false,
  "guven": "KESIN"
}
```

- `db`: `Portal` | `TBMWANS` (Portal tabloları kurulumda TBMWANS ile aynı fiziksel veritabanında
  durabilir; ekran bunu algılar ve farkı birleşik hesaplar).
- `alan`: `server/audit/veri-katalogu.cjs` içindeki `ALANLAR` listesinden biri. Yeni alan gerekiyorsa
  önce o listeye eklenir.
- `yazanlar[].tur`: `portal` | `playbook` | `betik` | `bilinmiyor`.
- `guven`: `KESIN` (kod okunup izlendi) | `MAKUL` (kod okunarak çıkarıldı, çalıştırılarak
  doğrulanmadı).
- `kullanilmiyor`: okuyanı olmayan ya da artık hiçbir işin dokunmadığı tablo. Silmeden önce gözden
  geçirilir; katalogdan **çıkarılmaz** (tablo veritabanında durdukça girdi kalır).
- `dosya`: kodu gösterir; satır numarası verilirse o satır tabloyu gerçekten kullanan satır olmalı
  (yorum bloğu ya da başka tablonun satırı değil).
- `uzerinden` (isteğe bağlı, satırsız yol): `dosya` tabloyu kendisi sorgulamıyor, bir yardımcı modül
  üzerinden okuyor/yazıyorsa o modül (ör. `server/logx/v2/ocp-cache.cjs`). Ekranda “tabloya şu modül
  üzerinden gider” diye görünür.
- Dosya yollarında Ansible deposu için `gar_bmt_ansible_scripts/` öneki yazılmaz.
- Kimlik bilgisi (parola, token, bağlantı dizesi) kataloğa **yazılmaz**.

## Sapma paneli

- **Katalogda yok**: veritabanında var, katalogda girdisi yok. Yeni bir iş tablo açmış olabilir
  ya da elle oluşturulmuş bir tablo vardır. Girdi eklenir ya da tablo kaldırılır.
- **Veritabanında yok**: katalogda var, canlı veritabanında bulunamadı. Tablo kaldırıldıysa girdi
  silinir; henüz oluşturulmadıysa (iş hiç koşmadı) beklenir.
- Bir veritabanı okunamazsa (bağlantı, zaman aşımı) o veritabanının satırları `?` görünür ve farkı
  hesaplanmaz: okunamayan veritabanını "tablo yok" saymak yanlış alarm olur.
- Biri okunamazsa iki havuzun aynı fiziksel veritabanı olup olmadığı da **bilinemez** (havuzlar ayrı
  düşebilir). O zaman okunan veritabanının “katalogda yok” listesi iki kataloğun birleşimine göre
  süzülür (`sapmaKismi: true`); aksi halde aynı fiziksel veritabanındaki öteki kataloğun tabloları
  yanlış “katalogda yok” çıkardı.
- Aynı fiziksel veritabanında iki kutucuk aynı tablo listesini gösterir; ipucu “Ortak fiziksel
  veritabanı” der, boyutlar toplanmaz.

## Kapsam dışı / doğrulanmamış

- `GTCloud_ORGANIZATION` — `bmw_automation_folder/jb8_uyg_kurulumu_smart/jboss_frontend.yml:200` ve
  `:214` (kopyası `bmw_test_folder/jboss_frontend.yml`) her JBoss 8 Smart kurulumunda `HysFirmId` /
  `SmartFirmId` okur. Bağlantı `db: "{{ mssql_db }}"` AWX extra var'ından gelir; depoda değeri yok,
  bu yüzden tablonun TBMWANS'ta mı başka bir veritabanında mı (ör. PGARINTUYGENV) olduğu doğrulanmadı.
  AWX'te `jb8_uyg_kurulumu_smart` şablonunun `mssql_db` değeri TBMWANS çıkarsa kataloğa `db: "TBMWANS"`,
  yazan `bilinmiyor` (kurumsal besleme), `guven: "MAKUL"` girdisi eklenir; canlı sapma paneli o
  durumda tabloyu zaten “katalogda yok” diye gösterir.
- `VIEW DATABASE STATE` izni yoksa boyut `—` görünür, satır sayısı yine gelir.
