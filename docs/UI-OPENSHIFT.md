# Arayüz — Red Hat OpenShift (PatternFly) görünümü

Portalın ön yüzü, OpenShift Console'un kullandığı **PatternFly v5** tasarım diline
taşındı. Bu doküman neyin nerede tanımlandığını ve yeni bir sayfa yazarken nelere
uyulması gerektiğini anlatır.

## Katman planı

| Katman | Dosya | İşlevi |
|---|---|---|
| Token'lar | `src/index.css` (`:root` / `:root[data-theme="dark"]`) | Renk, tipografi, gölge, köşe yarıçapı, ölçüler |
| PF bileşen sınıfları | `src/index.css` | `.card`, `.btn-primary`, `.pf-input`, `.pf-label--*`, `.pf-alert`, `.pf-tabs`, `.pf-nav*`, `.pf-masthead*` |
| Uyumluluk katmanı | `src/index.css` (dosya sonu) | Henüz PF bileşenlerine geçirilmemiş sayfalardaki ham Tailwind utility'lerini PF paletine eşler |
| Yerleşim | `src/layouts/AppLayout.tsx`, `src/components/layout/Masthead.tsx`, `src/components/layout/PageNav.tsx` | Masthead + dikey nav + içerik alanı |
| Ortak bileşenler | `src/components/common/*` | Card, Button, Badge, Tabs, Modal, Toast, StatTile, EmptyState, SectionHeader |

## Renk paleti (PatternFly global token'ları)

| Rol | Değer | Kullanım |
|---|---|---|
| Aksan / bağlantı | `#0066cc` (`--accent`) | Butonlar, bağlantılar, aktif sekme ve nav öğesi |
| Aksan hover | `#004080` | Buton/bağlantı hover |
| Marka kırmızısı | `#ee0000` (`--rh-red`) | Yalnızca logo ve yönetici rozeti |
| Masthead | `#151515` | Üst bant |
| Navigasyon | `#212427` / hover `#3c3f42` / aktif `#4f5255` | Sol menü |
| Sayfa zemini | `#f0f0f0` | İçerik alanı |
| Kart | `#ffffff` | Tüm kartlar |
| Kritik / Uyarı / Başarı / Bilgi | `#c9190b` / `#f0ab00` / `#3e8635` / `#2b9af3` | Durum göstergeleri |

Koyu tema PF dark paletini kullanır (`#0f1214` zemin, `#1b1d21` kart).

## Tipografi

- Gövde: **Red Hat Text**, 14px, satır yüksekliği 1.5
- Başlık: **Red Hat Display**, ağırlık 500 (PF'de 800/900 kullanılmaz)
- Kod/log: **Red Hat Mono**
- Fontlar `index.html` üzerinden yüklenir. Kurumsal ağ dışarıya kapalıysa istek
  sessizce başarısız olur ve sistem font zinciri devreye girer — kırılma olmaz.
  Fontları içeriden servis etmek isterseniz `.woff2` dosyalarını `public/fonts/`
  altına koyup `index.css`'e bir `@font-face` bloğu ekleyin.

## Yeni sayfa yazarken

```tsx
<SectionHeader title="Sayfa adı" subtitle="Kısa açıklama" actions={<Button variant="primary">Oluştur</Button>} />

<Card>                      {/* beyaz yüzey, 3px köşe, PF gölge */}
  <h2 className="pf-card-title p-0">Bölüm</h2>
  ...
</Card>

<label className="pf-label-text">Alan adı</label>
<input className="pf-input" />
<p className="pf-helper-text">Yardım metni</p>

<span className="badge pf-label--green">Çalışıyor</span>
<div className="pf-alert pf-alert--danger">…</div>
```

Kurallar:

1. **Köşe yarıçapı 3px.** Yeni markup'ta `rounded-xl` gibi sınıflar kullanmayın;
   uyumluluk katmanı bunları zaten 3px'e indirir ama doğrudan `--radius-sm` tercih edin.
2. **Gradyan yok, gölge minimum.** PF'de yükseklik hissi `--shadow-sm`/`--shadow-md` ile verilir.
3. **Büyük harf bölüm başlığı yok.** `.section-label` artık 16px normal başlıktır.
4. **Renk doğrudan yazılmaz**, token kullanılır (`var(--accent)`, `var(--status-danger)`).
5. Durum metinlerini `statusColor()` ile PF Label sınıflarına eşleyin.

## Bilinçli olarak kaldırılanlar

- Üst yatay menü (`src/components/Sidebar.tsx`) → yerini `PageNav` aldı.
- Giriş ekranındaki canvas ağ animasyonu, aurora ve fırça-darbesi aksanı.
- Dashboard'daki yörünge görseli ve teknik-bilgi kartı
  (`src/components/dashboard/MissionOrbit.tsx`, `TechFactCard.tsx` dosyaları duruyor
  ama artık import edilmiyor — istenirse silinebilir).

## Sırada ne var

Uyumluluk katmanı sayesinde iç sayfalar (Envanter, LogX sihirbazı, Performance,
Admin sekmeleri, Self Service, Görevler) doğru palet ve köşe değerleriyle görünür.
Bunları tam PF bileşenlerine (PF Table, Toolbar, Wizard, Description List,
Breadcrumb) çevirmek ayrı ve sayfa-sayfa ilerleyecek bir iştir.
