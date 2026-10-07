# UI taraması (`npm run ui:tarama`)

Portalın sayfalarını **gerçek bir tarayıcıda**, arka uç olmadan açıp ölçen geliştirici aracı.
CI'da koşmaz; bir ekran değişikliğinden önce ve sonra elle çalıştırılır.

## Neden var

Bileşen testleri (vitest + jsdom) gerçek renkleri, gerçek yerleşimi ve tema katmanını
hesaplamaz. 2026-10-07 taramasında bulunan hataların hiçbirini bir test görmüyordu:

| Bulgu                                                   | Neden testler görmedi                            |
| ------------------------------------------------------- | ------------------------------------------------ |
| 403 sayfasında düğme metni görünmüyor (kontrast 1.0)    | Renk, CSS kurallarının önceliğinden doğuyor      |
| Açık temada siyah düğmeler beyaz-üstüne-açık-gri (1.12) | Sınıf → token eşlemesi yalnız tarayıcıda çözülür |
| Açık temada sarı uyarı metinleri okunmuyor (2.0)        | Aynı                                             |
| Telnet / FileX, liste API'si 500 dönünce çöküyor        | Testler API'yi başarıyla taklit ediyordu         |
| API düşünce ekran "kayıt yok" diyor                     | Aynı                                             |

## Ne yapar

1. Vite geliştirme sunucusunu ve headless Chrome'u başlatır.
2. Sayfaya bir `fetch` sarmalayıcısı enjekte eder; `/api/*` istekleri ağa çıkmaz:
   - **`bos`** durumu: her API "başarılı ve boş" döner → boş-durum ekranları
   - **`hata`** durumu: her API 500 döner → hata ekranları
   - oturum ve görünürlük uçları iki durumda da başarılıdır (sayfa açılabilsin diye)
3. Her sayfayı iki durumda, üç görünümde açar: açık 1440, koyu 1440, açık 1024.
4. Sihirbazlarda ilk adımı tıklar (Telnet ve LogX: Legacy / OpenShift), Admin'de her sekmeyi gezer.
5. Her ölçümde şunlara bakar:

| Ölçüm             | Anlamı                                                       |
| ----------------- | ------------------------------------------------------------ |
| `cokme`           | Sayfa alanında "Bu sayfa yüklenemedi" (hata sınırı)          |
| `tasma`           | Yatay kaydırma çubuğu çıkaran taşma (px)                     |
| `kontrast<3`      | Metin / zemin oranı 3:1'in altında (devre dışı öğeler hariç) |
| `etiketsiz girdi` | Erişilebilir adı olmayan `input` / `select` / `textarea`     |
| `adsiz dugme`     | Erişilebilir adı olmayan düğme ya da bağlantı                |
| `ham JSON`        | Ekrana basılmış `{"ok":false…}`                              |
| `konsol`          | Tarayıcı konsolundaki hata ve yakalanmamış istisnalar        |

## Kullanım

```bash
npm run ui:tarama                        # tüm sayfalar
npm run ui:tarama -- --sayfa /telnet     # tek sayfa
npm run ui:tarama -- --cikti /tmp/tarama # rapor ve ekran görüntüleri buraya
npm run ui:tarama -- --kati              # çökme / taşma / kontrast / ham JSON varsa çıkış kodu 1
```

Çıktı: konsolda bulgu olan satırlar ve bir özet; `rapor.json` ile her ölçümün ekran görüntüsü
çıktı dizininde (varsayılan: sistem geçici dizini altında `ui-tarama/`).

Gerekenler: Node 22+, Chrome ya da Chromium (`CHROME_BIN` ile yolu verilebilir). Portlar
`UI_TARAMA_VITE_PORT` (5199) ve `UI_TARAMA_CDP_PORT` (9333) ile değiştirilebilir.

## Sınırları

- Yanıtlar sahtedir: sayfaların **veriyle dolu** hâli görülmez. Bir ekranı veriyle görmek için
  `scripts/ui-tarama/lib.mjs` içindeki `ac(yol, { ozel: { '/api/…': yanıt } })` kullanılır.
- "Her API boş döner" durumunda genel yanıt `{ ok: true, items: [], … }` biçimindedir; bir ekran
  başka bir alan bekliyorsa orada görülen çökme gerçek API'de yaşanmayabilir. **`hata`
  durumundaki çökme her zaman gerçektir** (sunucu gerçekten 500 dönebilir).
- Kontrast ölçümü düz renkli zeminlerde çalışır; degrade ya da görsel üstündeki metni atlar.
- Kapsam dışı ağaçlar (nginx-console, server-hub, crypto-hub) varsayılan listede yoktur;
  `--sayfa` ile taranabilir.

## İlgili bekçiler

Taramanın bulduğu sınıflar kalıcı testlere bağlandı; tarama onların yerine geçmez, yeni
sınıfları bulmak içindir.

- `src/__tests__/tema-kontrast.test.cjs` — tema token çiftlerinin kontrastı (≥ 4.5)
- `src/components/__tests__/ListeUclari.test.tsx` — liste API'si düşünce adım çökmez
- `src/components/__tests__/HataYokDegil.test.tsx` — "okunamadı" ile "yok" ayrı gösterilir
- `src/components/admin/__tests__/AdminDayaniklilik.test.tsx` — çöken sekme menüyü düşürmez
- `src/components/__tests__/KlavyeErisim.test.tsx` — Esc, odak, etiketler
