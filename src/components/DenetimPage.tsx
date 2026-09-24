// src/components/DenetimPage.tsx — "Middleware Ic Denetim" sayfasi.
// Alti sekme (2026-08-25'te adlar sadelestirildi; rota ve element_key "denetim"
// olarak KALDI - gorunurluk kayitlari ve yer imleri kirilmasin diye):
//   Nginx SPA Audit             -> nginx vhost/location denetimi + SPA kapsami
//   Openshift Audit             -> uygulama hangi ortamlarda var/eksik
//   Init Script Audit           -> sunucular arasi init script sha512 sapmasi
//   Deployment Scripts Audit    -> /vhosting[8]/HYSUXSCRIPTS/*.sh sha512 sapmasi (ayni ekran)
//   Envanter Audit              -> Inventory/MWApps/WASApps dagilimlari
//   Jboss/WAS Applications Audit-> ad kuralindan ortam matrisi + sapmalar
//   Web-App Relations           -> uygulamayi servis eden web sunucusu/vhost
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import {
  ShieldCheckIcon,
  ArrowPathIcon,
  MagnifyingGlassIcon,
  ServerStackIcon,
  Squares2X2Icon,
  QuestionMarkCircleIcon,
  ArrowDownTrayIcon,
  DocumentDuplicateIcon,
  ChevronRightIcon,
  ChartBarSquareIcon,
  RectangleGroupIcon,
  LinkIcon,
  ClockIcon,
  SignalIcon,
} from '@heroicons/react/24/outline';
import {
  denetimApi,
  type NginxSpaResult,
  type OcpCoverageResult,
  type OcpCoverageRow,
  type NginxSpaEnvCell,
  type InitScriptsResult,
  type InitScriptStat,
  type NginxSpaRow,
} from '@/api/denetimApi';
import { Select } from '@/components/ui/Form';
import HelpModal, { type HelpSection } from '@/components/common/HelpModal';
import EnvanterMetrics from '@/components/denetim/EnvanterMetrics';
import EnvanterDegisim from '@/components/denetim/EnvanterDegisim';
import NginxProdMigration from '@/components/denetim/NginxProdMigration';
import { OwnerCell, ownerText } from '@/components/denetim/OwnerCell';
import { DirCell, HacLegend } from '@/components/denetim/HacCell';
import NginxSpaSummary from '@/components/denetim/NginxSpaSummary';
import AppEnvs from '@/components/denetim/AppEnvs';
import WebApp from '@/components/denetim/WebApp';
import RouteTraffic from '@/components/denetim/RouteTraffic';
import { toast } from '@/hooks/useToast';
import { TableEmptyRow } from '@/components/common/EmptyState';
import CodeChip from '@/components/common/CodeChip';
import { fmtNumber } from '@/utils/datetime';
import { downloadCsv as csvDownload } from '@/utils/csv';

// NGINX BOLUMLERI NGINX HUB'A TASINDI (kullanici, 2026-09-22): sekmeler ve yardim metinleri
// Nginx Hub'da; bilesenler yerinde. Bu dizi oradan import edilir.
export const NGINX_DENETIM_HELP: HelpSection[] = [
  {
    icon: ServerStackIcon,
    title: 'Nginx SPA Audit',
    body: "nginx_config_audit job'ının günlük taramasını gösterir. Her satır bir uygulama; sütunlar ortamlar. Hücre rengi o ortamdaki durumu anlatır; hücredeki H A C harfleri o sunucudaki dizinleri gösterir (H=/hysdeploy, A=/usr/nginx/applications, C=application-confs; büyük harf var, küçük harf yok — matrisin üstündeki sözlük). Internet katmanında ayrıca 'OpenShift route istatistikleri' paneli: ortam başına kaç route, kaçı SPA / SPA değil, hangi IP'lere çözüyor (route_inventory job'ının nslookup sonucu). PROD kapsamı eski GBRVP* sunucularının proxy_pass satırlarından çözülür (Production Taşımaları ile aynı çözüm, -prod eki dâhil); dipnotta kaç satırın çözüldüğü yazar. 'Kırık include' = vhost'un çağırdığı conf dosyası yok, nginx -t düşer. 'Paket Nginx'te yok' = konfigürasyon yerinde ama uygulamanın dosyaları /usr/nginx/applications altında bulunamadı, yani o adres 404 döner — ya hiç dağıtılmamış ya da conf adının işaret ettiğinden başka bir namespace dizinine dağıtılmış. 'Envanterde yok' = OpenShift envanterinde karşılığı bulunamadı, uygulama kapatılmış olabilir. Hücre birden çok sunucunun en kötü durumunu gösterir; üzerine gelince hangi sunucular olduğunu görebilirsiniz. PRODUCTION TAŞIMALARI sekmesi (2026-09-14): eski GBRVP* sunucularının vhost'larındaki her proxy_pass hedefi OpenShift route envanteriyle (namespace, uygulama)'ya çözülür ve yeni GBNGXP4x/5x sunucularında /hysdeploy/<ns>/<app>/ ile /usr/nginx/applications/<ns>/<app>/ var mı gösterilir (H/A/C hücreleri). Bir uygulama ancak yeni sunucuların HEPSİNDE H+A varsa 'hazır'dır; SPA olmayan (API) hedefler dizin beklemez, ayrı listelenir. Satırdaki 'Tanım oluştur' düğmesi, seçilen location için yeni sunucularda <SERVICE>-PROD.conf içine location bloğu ve application-confs/<service>-<app>-<ns>.conf dosyasını üreten AWX job'ını (nginx_ops/nginx_prod_migration.yml) tetikler — non-prod SPA oluşturma akışının aynısı; uygulama dizini yoksa durur, nginx -t düşerse geri alır. Eski sunucuya dokunmaz. 'Eski tanımı kaldır' düğmesi ise eski GBRVP* sunucusundaki location bloğunu ve (başka tanım kullanmıyorsa) upstream'i kaldırmak için mevcut nginx_ops job'ını action=delete/env=prod ile tetikler — PROD kuralı gereği iş şimdi doğrular, 23:00 kesinti penceresine zamanlar, gerçek silmeyi nginx_scheduled_ops yapar; geçiş kaydı 'geçti' değilse pencere uyarır. Geçiş sütunu: planlandı/geçti/iptal + tarih, tıklayarak düzenlenir. Sıralama ekip bazında yapılabilir (çok uygulaması olan ekip üstte).",
  },
  {
    icon: ServerStackIcon,
    title: 'Nginx API Envanteri',
    body: "nginx_ratelimit_inventory job'ının günlük taramasını gösterir: hangi sunucuda, hangi konfigürasyon dosyasında kaç API (location) bloğu tanımlı ve bunların rate limit durumu. ÖNEMLİ: kaynak tablo ortam bilgisi TAŞIMAZ ve konfigürasyon dosya adları ortamdan bağımsız olarak AYNIDIR — aynı 'x.conf' hem DEV hem PROD sunucusunda bulunur. Bu yüzden ortam sunucu adından türetilir (GBNGWD..=dev, GBNGWT..=test, GBNGWQ..=qa, GBNGWP../GBNGWAP..=prod); kalıba uymayan sunucu sessizce bir ortama atanmaz, 'BİLİNMİYOR' olarak görünür. 'Konfigürasyon Karşılaştırma' görünümü asıl bulguyu üretir: bir satır tek bir dosyanın tüm ortamlardaki hâlidir, hücredeki sayı o ortamdaki API bloğu sayısıdır ve '—' dosyanın o ortamda hiç bulunmadığı anlamına gelir. İki tür sürüklenme ayrı işaretlenir: 'ortam farkı' ortamların beklenen API sayısı birbirinden farklı, 'sunucu farkı' AYNI ortamdaki sunucular birbirinden farklı (hücrede aralık olarak gösterilir, örn. 17–20) — ikincisi genelde bir sunucuya dağıtımın ulaşmadığı anlamına gelir. 'Rate limit tanımı olmayan konfigürasyonlar' listesi ise hiçbir location'ında ne IP bazlı ne de sunucu bazlı limit bulunmayan dosyaları toplar.",
  },
  {
    icon: ServerStackIcon,
    title: 'Nginx Audit',
    body: "TUM nginx sunucularinin konfigurasyon denetimi; veriyi bmw_nginx/nginx_audit isi uretir. Konfigurasyon 'nginx -T' ile okunur - yani include'lar dahil, nginx'in kendi gordugu haliyle; dosyalari tek tek okumak conf/ altindaki include'lari kacirirdi. Hostlar dbo.Inventory'den kesfedilir, sabit liste yoktur. Ortam once sunucu adi kalibindan, tutmazsa dbo.Inventory.env kaydindan gelir; ikisi de bilmiyorsa BILINMIYOR gorunur. Her satir bir SUNUCU; tiklayinca sunucunun KENDI SAYFASI acilir (/denetim/nginx-audit/<host>), bes bolum: (1) server bloklari - hangi ip:port dinleniyor, hangi sertifika sunuluyor; (2) location'lar dosya basina - kac tane, kaci proxy_pass tasiyor, kaci tanimli bir upstream'e gidiyor, kaci dogrudan DNS adina gidiyor (calisir ama resolve/keepalive/zone devre disi), kaci TANIMSIZ bir hedefe gidiyor (nginx BASLAMAZ); (3) upstream'ler - resolve/keepalive/zone var mi, en az bir location kullaniyor mu; (4) ayarlar - kurulum referansiyla (nginx_installation: bmw_defaults.conf, proxy_settings.conf, rate_limits.conf, nginx.conf) karsilastirma. AYAR MANTIGI: sunucudaki GLOBAL deger referanstan farkliysa bulgudur; bir location'in kendi icinde farkli deger vermesi (orn. 60s timeout) bulgu DEGIL yerel ayardir ve ayri listelenir. (5) kurulum dosyasi uyumu - nginx_installation/operations/files altindaki dosyalar (licences haric) sunucuya oldugu gibi kopyalanir; sunucudaki kopya referansla birebir mi, degilse hangi direktif eksik/degismis/fazla. Referans degerler koda gomulu degildir, her kosuda kurulum dosyalarindan okunur. Terimler icin sekmenin ustundeki Sozluk acilir. ISTISNA: yonetici bir sunucuyu not ile istisna yapabilir (en sagdaki sutun) - o satirda ayar sapmasi/atlayan/tanimsiz/dosya farki gosterilmez, toplam kartlarina girmez, siralamada sona duser; sunucu sayfasi ham veriyi gostermeye devam eder. Not zorunludur (neden istisna?). 'nginx -T' hata verdiyse sunucu HATA olarak isaretlenir: konfigurasyon reload edilemez. (Eski 'Nginx Legacy (PROD)' sekmesi 2026-09-17'de kaldirildi: burada gosterilenler onu kapsiyor.)",
  },
  {
    icon: ServerStackIcon,
    title: 'Nginx Envanteri',
    body: "nginx_metadata job'ının topladığı sunucu üst verisini gösterir (dbo.nginx_inventory). Her sunucuda bir .metadata dosyası üretilip toplanır. ÖNEMLİ: tablo her koşuda TRUNCATE edilip yeniden yazılır — yani GEÇMİŞ YOKTUR, gördüğünüz her zaman \"şu anki hâl\"dir; bu yüzden tarih seçici yerine en yeni source_last_update değeri gösterilir. NginxRateLimitInventory'den farklı olarak bu tabloda ORTAM KOLONU vardır, sunucu adından türetmeye gerek kalmaz. Beş görünüm var: 'Ortam' hangi ortamda kaç sunucu olduğunu ve bunların Pendik/Ankara dağılımını; 'Versiyonlar' nginx/OS/kernel/mimari dağılımını; 'Service'ler' bir service'i kaç sunucunun barındırdığını (services alanı tekil adlara bölünüp sayılır); 'Kaynaklar' cpu/bellek/disk/konfigürasyon dağılımını; 'Sunucular' ise tüm alanları arama ve CSV ile birlikte verir. Bellek ve disk toplamları yalnızca ÇÖZÜMLENEBİLEN değerlerden hesaplanır — çözümlenemeyen sunucu varsa sayı sarı renkle işaretlenir ve kaçının dışarıda kaldığı ipucunda yazar; uydurulmuş bir sayı toplamı sessizce bozardı.",
  },
];

const HELP: HelpSection[] = [
  {
    icon: ChartBarSquareIcon,
    title: 'Envanter Audit',
    body: "Inventory, MWAppsInventory ve WASAppsInventory tablolarının dağılımları. Üstte özet sayaçlar; Sunucular kaynağında ayrıca ürün kapsamı (hangi üründen kaç sunucuda var, kaç ayrı sürümle). Dağılımlar bölümünde boyut seçerek (domain, subnet, OS, sürüm…) oransal kırılımı görürsünüz. En altta çapraz dağılım: satır ve sütunu kendiniz seçip örneğin JBoss sürümlerinin domain'lere göre yayılımını çıkarırsınız; hücre koyulaştıkça sayı büyür. Uygulama tablolarında sayımı 'uygulama' yerine 'sunucu' yapabilirsiniz — aynı sunucuda birden çok uygulama olabildiği için ikisi farklı sorulara cevap verir.",
  },
  {
    icon: ClockIcon,
    title: 'Envanter Değişim',
    body: "Envanter Audit BUGÜNÜ gösterir; bu sekme ZAMANI gösterir. Üstte seçtiğiniz iki tarih arasında kaç satır gelmiş, gitmiş ve değişmiş; altında satır sayısının gün gün trendi. 'Gelen ve giden kayıtlar' hangi sunucunun/uygulamanın eklendiğini veya düştüğünü tek tek listeler. 'En çok değişen kolonlar' gürültü kaynağını gösterir — bir kolon sürekli başı çekiyorsa farkı kirletiyordur ve hesabın dışına alınması konuşulabilir. 'Tarama sağlığı' her tablonun son anlık görüntüsünü verir; 'Durduruldu' satır sayısının ani düştüğü ve güvenlik eşiği devreye girip geçmişe kitlesel silme YAZILMADIĞI anlamına gelir — yani envanter job'ı yarım kalmış olabilir. 'Sessiz tablolar' bir haftadır hiç değişmemiş olanları işaret eder: ya gerçekten sabittirler ya da taramaları kırılmıştır. ÖNEMLİ: geçmiş yalnızca Portal günlük anlık görüntü almaya başladıktan sonrasını kapsar; envanter tabloları her yenilemede sıfırdan yazıldığı için daha eski tarihler geriye dönük üretilemez.",
  },
  {
    icon: LinkIcon,
    title: 'Web-App Relations',
    body: "Her uygulama satırının önünde onu servis eden web sunucusunu gösterir: host, IP, port, server_name. Kaynak MWAppsInventory/WASAppsInventory ile BMW_Certificates_Inventory'nin çarpıştırılmasıdır. 3-tier sunucularda web sunucusu, uygulama sunucusunun adındaki 5. karakter A→W çevrilerek bulunur (DACRAAP01 → DACRWAP01); 2-tier'de web sunucusu uygulamanın kendi sunucusudur. Doğru vhost'u seçmek için uygulama adı küçük harfle server_name içinde aranır — önce tam ad, tutmazsa ortam son eki atılmış taban ad. Eşleşmenin hangi yolla kurulduğu her satırda yazar; kural tahmine dayalı olduğu için bu bilgi gizlenmez. Hiçbir yol tutmazsa satır 'eşleşmedi' der ve uydurma bir sunucu yazılmaz, yalnızca kurala göre beklenen aday gösterilir.",
  },
  {
    icon: RectangleGroupIcon,
    title: 'Jboss/WAS Applications Audit',
    body: "MWAppsInventory / WASAppsInventory üzerinden, bir uygulamanın hangi ortamlara dağıtıldığını gösterir. Ortam uygulama adının son ekinden türer: -D geliştirme, -T test, -Q QA, eksiz ad production; satırlar son ek atılmış taban ada göre gruplanır. 'Ad kuralı dışı' sekmesinde bu kalıba uymayan adlar (küçük harfli son ek, tanınmayan tek harf, -DEV/-PROD gibi ortam sözcüğü) sebebiyle birlikte listelenir. 'Çelişki' sekmesinde ise adın söylediği ortam ile envanterdeki env sütunu uyuşmayanlar çıkar — env sütunu sunucu adından türetildiği için bu, uygulamanın başka bir ortamın sunucusunda çalıştığına işaret eder. Sunucu adı geliştirme ile testi ayırt edemediğinden -D uygulamaları bu listeye alınmaz.",
  },
  {
    icon: DocumentDuplicateIcon,
    title: 'Init Script Audit',
    body: "check_initialize job'ının topladığı sha512 değerlerini karşılaştırır: bir script sunucular arasında kaç ayrı sürümle duruyor, hangi sunucular çoğunluktan ayrılmış, hangilerinde dosya hiç yok. Referans olarak en kalabalık hash alınır — tabloda kanonik sürümü işaretleyen bir alan yok, initialize.yaml da şablonu tüm sunuculara aynı dağıttığı için en kalabalık sürüm pratikte şablonun kendisidir. startCustom.sh bunun bilinen istisnasıdır: sunucuya özel olması tasarım gereğidir (initialize.yaml yeniden kurulumda onu yedekten geri kopyalar), o yüzden sapma sayılmaz, ayrıca listelenir.",
  },
  {
    icon: DocumentDuplicateIcon,
    title: 'Deployment Scripts Audit',
    body: "check_deployment_scripts job'ının topladığı sha512 değerlerini karşılaştırır: /vhosting/HYSUXSCRIPTS ve /vhosting8/HYSUXSCRIPTS altındaki deployment script'leri (was_startstop.sh, was_fulldeploy_rsync.sh, was_fulldeploy_unzip.sh, was_setenvironment.sh, was_checkapp.sh …) sunucular arasında kaç ayrı sürümle duruyor, hangi sunucular çoğunluktan ayrılmış, hangilerinde dosya hiç yok. Init Script ile aynı mantık; script listesi sabit değil, sunucuda ne varsa o gelir (vhosting8'de ek script'ler var).",
  },
  {
    icon: SignalIcon,
    title: 'Route Trafiği',
    body: "route_traffic job'ının her cluster'ın Thanos'undan çektiği route başına HTTP istek sayıları (OCP router/HAProxy sayacı, günde bir). Soru: bu uygulama yaşıyor mu? 'aktif' = son 30 günde istek var; 'atıl aday' = 30 gündür istek yok ama 90 gün içinde vardı; 'emekli aday' = 90 gündür (ya da verinin tamamında) hiç istek yok; 'veri yok' = route envanterde var ama router sayacında hiç görünmedi. Job yeni koşmaya başladıysa üstteki not kaç günün kapsandığını yazar — 'emekli' hükmü 90 gün dolunca kesinleşir. 4xx/5xx yüzdeleri son 90 günün toplamına göre; %100 4xx = trafik geliyor ama uygulama cevap vermiyor. Dikkat: GBNGX'e taşınan internet SPA'larında paket doğrudan nginx'ten sunulur, OCP route sayacı düşer — bu atıl demek değildir.",
  },
  {
    icon: Squares2X2Icon,
    title: 'Openshift Audit',
    body: "Bir uygulamanın bir platformun hangi ortamlarında var, hangilerinde eksik olduğunu gösterir. Ortam bilgisi cluster'dan DEĞİL, namespace son ekinden (-dev/-test/-qa/-prod) gelir — çünkü ark_dev ile ark_test aynı cluster'ları paylaşır, cluster tek başına ortam bilgisi taşımaz. Hücredeki k/n, uygulamanın o ortamın kaç cluster'ında bulunduğunu söyler: yeşil hepsinde, SARI ise bir kısmında (kısmi kapsam), kırmızı hiçbirinde. Önceden hücre yalnızca VAR/YOK gösteriyordu ve 5 cluster'ın 1'inde olan uygulama 5'inde olanla ayırt edilemiyordu. n sayısı sabit bir liste değildir, veriden çıkarılır — o ortamda gerçekten namespace barındıran cluster'lar sayılır; 'Ortam başına cluster'lar' paneli hangileri olduğunu ve her birindeki uygulama sayısını gösterir. KISMİ KAPSAM BİR HÜKÜM DEĞİL GÖZLEMDİR: bazı uygulamaların bazı cluster'larda (örneğin DR) bulunmaması meşru olabilir, o yüzden 'eksik' damgası vurulmaz — yalnızca görünür kılınır. Üstteki 'Sadece kısmi kapsam' filtresiyle bunları ayıklayabilirsiniz.",
  },
];

const STATUS_META: Record<string, { label: string; cls: string }> = {
  OK: { label: 'Sorunsuz', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  DUP_SUFFIX: { label: 'Yinelenen ek', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  NOT_IN_INVENTORY: { label: 'Envanterde yok', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  NAME_MISMATCH: {
    label: 'Ad/içerik uyuşmuyor',
    cls: 'bg-orange-50 text-orange-700 border-orange-200',
  },
  // "Dagitilmamis" NEREDE olmadigini soylemiyordu. Ayni durum Teams kartinda
  // "Deploy Yok" olarak geciyordu - iki ad tek ada indirildi.
  NOT_DEPLOYED: { label: "Paket Nginx'te yok", cls: 'bg-red-50 text-red-700 border-red-200' },
  BROKEN_INCLUDE: { label: 'Kırık include', cls: 'bg-red-100 text-red-800 border-red-300' },
  // PROD (2026-09-14): eski GBRVP* sunucusunda proxy_pass ile sunuluyor; SPA include'u yok.
  PROXY: { label: 'Proxy (eski sunucu)', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  // Yeni prod SPA sunucusunda dizin var ama eski sunucuda proxy tanimi YOK.
  // Yalnizca dev/test/qa'da gorunen uygulamalara eklenir; baska ortamda olmayanlar satir acmaz.
  NEW_ONLY: { label: 'Yalnız yeni sunucuda', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
};

/** Hucre sorunlu mu: OK/PROXY disi durum, eski sunucuda eksik proxy, eksik dizin. */
function cellHasProblem(c?: NginxSpaEnvCell): boolean {
  if (!c || !c.status) return false;
  if (c.status !== 'OK' && c.status !== 'PROXY') return true;
  if ((c.oldMissing || []).length > 0) return true;
  return (c.dirs || []).some((d) => d.flags && !(d.flags.hys && d.flags.app && d.flags.conf));
}

/** Ortam farki (kullanici, 2026-09-14): prod'da olan non-prod'da yok (ya da tersi) gorunsun. */
type EnvGap = 'prod-only' | 'no-prod' | 'none';
function envGapOf(r: NginxSpaRow): EnvGap {
  const has = (e: string) => !!r.envs[e]?.present;
  const nonProd = ['DEV', 'TEST', 'QA'].some(has);
  const prod = has('PROD');
  if (prod && !nonProd) return 'prod-only';
  if (!prod && nonProd) return 'no-prod';
  return 'none';
}


type DenetimTab =
  | 'ocp'
  | 'init'
  | 'deploy'
  | 'routetraffic'
  | 'envanter'
  | 'degisim'
  | 'appenvs'
  | 'webapp';
// nginx sekmeleri (nginx, nginxapi, nginxenv, nginxaudit) 2026-09-22'de Nginx Hub'a tasindi.
const DENETIM_TABS: DenetimTab[] = [
  'ocp', 'init', 'deploy', 'routetraffic', 'envanter', 'degisim', 'appenvs', 'webapp',
];

export default function DenetimPage() {
  // ?tab=<id>: dis baglantidan dogru sekmeye gelsin. Tanınmayan deger sessizce ilk sekmeye duser.
  const [searchParams] = useSearchParams();
  const initialTab = ((): DenetimTab => {
    const v = searchParams.get('tab') as DenetimTab | null;
    return v && DENETIM_TABS.includes(v) ? v : 'ocp';
  })();
  const [tab, setTab] = useState<DenetimTab>(initialTab);
  const [showHelp, setShowHelp] = useState(false);
  // SEKME BAZLI erisim (2026-09-17): Admin > "Denetim Erisimi" ile acilan sekmeler; Admin
  // hepsini gorur. Gorunmeyen sekme URL'den istense de acilmaz (sunucu ucu zaten 403).
  const { canSee } = useAuth();
  const visibleTabs = DENETIM_TABS.filter((id) => canSee(`tab:denetim:${id}`));
  // TUREVDIR, DURUM DEGIL. Onceden bir `useEffect` icinde `setTab(visibleTabs[0])`
  // cagriliyordu; bu hem fazladan bir render turu uretiyor (o arada ekran BOS
  // kaliyor: `tabAllowed` false oldugu icin hicbir sekme cizilmiyordu) hem de
  // `react-hooks/set-state-in-effect` uyarisi veriyordu. Gorunur sekmeler yalnizca
  // `canSee`den turuyor — yani zaten bir TUREV; durum olarak tutmaya gerek yok.
  const tabAllowed = visibleTabs.includes(tab);
  const activeTab: DenetimTab = tabAllowed ? tab : (visibleTabs[0] ?? tab);

  if (visibleTabs.length === 0) {
    return (
      <div className="rounded-xl border px-6 py-10 text-center" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Bu sayfada size açılmış bir bölüm yok</div>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Middleware İç Denetim yalnız yöneticilere açıktır; bir bölüme erişim gerekiyorsa yöneticinizden isteyin (Admin › Denetim Erişimi).</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* BASLIK — sayfa kimligi tek bir yuzeyde toplanir. Onceden baslik, aciklama ve
          yardim dugmesi serbestce diziliydi; sekme cubugu da hemen altinda basliyordu
          ve ikisi arasinda gorsel bir sinir yoktu. */}
      <header
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap px-5 pt-4 pb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="grid place-items-center w-8 h-8 rounded-lg flex-shrink-0"
                style={{ background: 'var(--accent-bg)' }}
              >
                <ShieldCheckIcon className="w-5 h-5" style={{ color: 'var(--accent)' }} />
              </span>
              <h1
                className="text-lg font-bold leading-tight"
                style={{ color: 'var(--text-primary)' }}
              >
                Middleware İç Denetim
              </h1>
            </div>
            <p
              className="text-[13px] mt-1.5 max-w-2xl leading-relaxed"
              style={{ color: 'var(--text-muted)' }}
            >
              Nginx, OpenShift, init script'leri, envanter dağılımları, JBoss/WAS uygulamaları ve
              web-uygulama ilişkilerinin iç denetimi.
            </p>
          </div>
          <button
            onClick={() => setShowHelp(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors flex-shrink-0"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <QuestionMarkCircleIcon className="w-4 h-4" /> Nasıl kullanılır?
          </button>
        </div>

        {/* SEKMELER — yedi sekme dolgulu bir hap seridinde sikisiyordu. Alt-cizgi
            secimi daha az gurultu uretir ve dar ekranda yatay kaydirilir; kaydirma
            KENDI icinde olur, sayfa govdesi yana kaymaz. */}
        <nav
          className="flex gap-0.5 px-3 overflow-x-auto border-t"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}
          aria-label="Denetim bölümleri"
        >
          {(
            [
              { id: 'ocp', label: 'OpenShift', icon: Squares2X2Icon },
              { id: 'init', label: 'Init Script', icon: DocumentDuplicateIcon },
              { id: 'deploy', label: 'Deployment Scripts', icon: DocumentDuplicateIcon },
              { id: 'routetraffic', label: 'Route Trafiği', icon: SignalIcon },
              { id: 'envanter', label: 'Envanter', icon: ChartBarSquareIcon },
              { id: 'degisim', label: 'Envanter Değişim', icon: ClockIcon },
              { id: 'appenvs', label: 'JBoss/WAS', icon: RectangleGroupIcon },
              { id: 'webapp', label: 'Web-App', icon: LinkIcon },
            ] as const
          )
            // SEKME BAZLI erisim (2026-09-17): Admin > Denetim Erisimi ile acilan sekmeler.
            // Admin hepsini gorur (motor); sunucu uclari da ayni anahtarla kapali.
            .filter((t) => canSee(`tab:denetim:${t.id}`))
            .map((t) => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={active ? 'page' : undefined}
                className="flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors border-b-2"
                style={{
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                  borderColor: active ? 'var(--accent)' : 'transparent',
                }}
              >
                <t.icon className="w-4 h-4 flex-shrink-0" /> {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      {activeTab === 'ocp' && <OcpCoverage />}
      {activeTab === 'init' && <ScriptsAudit kind="init" />}
      {activeTab === 'deploy' && <ScriptsAudit kind="deploy" />}
      {activeTab === 'routetraffic' && <RouteTraffic />}
      {activeTab === 'envanter' && <EnvanterMetrics />}
      {activeTab === 'degisim' && <EnvanterDegisim />}
      {activeTab === 'appenvs' && <AppEnvs />}
      {activeTab === 'webapp' && <WebApp />}

      <HelpModal
        open={showHelp}
        onClose={() => setShowHelp(false)}
        title="Middleware İç Denetim — Nasıl Kullanılır?"
        sections={HELP}
      />
    </div>
  );
}

// ── SPA KAPSAMI ───────────────────────────────────────────────────────────────────────
// Iki soru ayri ayri cevaplanir:
//   1) nginx'e CIKMASI GEREKEN (route tipi passthrough = internet) SPA'larin kaci cikmis?
//   2) nginx'e CIKMAMASI GEREKEN (route tipi reencrypt = intranet) SPA'lardan kaci
//      yanlislikla cikmis? -> bu bir GUVENLIK/KONFIGURASYON BULGUSUDUR.
// Kapsam yuzdesi YALNIZCA internet kumesi uzerinden hesaplanir; intranet uygulamalarini
// paydaya katmak, cikmasi zaten yasak olanlari "eksik" saymak olurdu.
// Grafik CSS ile cizilir - projede grafik kutuphanesi yok.
/** Bar renklerinin ne anlama geldigini gosteren kucuk kare + etiket. */
export function NginxSpaAudit() {
  // KATMAN BURADA TUTULUYOR, ozet bileseninin icinde DEGIL. Icerideyken yalnizca kapsam
  // paneli katmani biliyordu; altindaki servis matrisi (GLOMO/SAKLAMA...), Location
  // Detayi ve Proxy panelleri INTERNET tarafina ait olduklari halde her iki katmanda da
  // duruyordu - "Intranet"e basildiginda ekranin alt yarisi hic degismiyordu
  // (kullanici bulgusu, 2026-09-10).
  //
  // Intranet sunucularinda servis vhost'u YOKTUR; dolayisiyla servis matrisi, location
  // detayi ve proxy tanimlari orada TANIMSIZDIR - gizlenmeleri kozmetik degil, dogru
  // olan.
  // 'tasima' (2026-09-14): eski GBRVP* -> yeni GBNGXP4x/5x prod tasimasi. Kapsam
  // paneli/servis matrisi burada ANLAMSIZ; yalnizca NginxProdMigration gosterilir.
  const [tier, setTier] = useState<'internet' | 'intranet' | 'tasima'>('internet');
  // Kullanici talebi: matrisin yani sira, her servis icin location bazinda AYRINTI.
  const [data, setData] = useState<NginxSpaResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [service, setService] = useState<string>('');
  const [scanDate, setScanDate] = useState<string>('');
  const [q, setQ] = useState('');
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [gapFilter, setGapFilter] = useState<'all' | 'prod-only' | 'no-prod'>('all');

  const load = useCallback(async (d?: string, fresh = false) => {
    setLoading(true);
    try {
      const r = await denetimApi.nginxSpa(d, fresh);
      if (r.ok) {
        setData(r);
        setErr('');
        setScanDate(r.scanDate || '');
        setService((prev) => (prev && r.services.includes(prev) ? prev : r.services[0] || ''));
      } else setErr(r.message || 'Veri alınamadı.');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useAsyncEffect(async () => {
    await load();
  }, [load]);

  const envs = data?.envs || ['DEV', 'TEST', 'QA', 'PROD'];
  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (service && r.service !== service) return false;
      // Ekip adiyla da aranabilir (2026-09-14): "hangi uygulamalar X ekibinin" sorusu.
      if (needle && !r.application.toLowerCase().includes(needle) && !ownerText(r.owner).includes(needle)) return false;
      if (onlyProblems) {
        // "Sorunlu" (kullanici, 2026-09-17: "kalan tanimlar neden sorunlu?"): PROXY normal
        // PROD durumudur, sorun DEGILDIR. Sorun = OK/PROXY disi durum, eski sunucularda eksik
        // proxy, ya da herhangi bir sunucuda H/A/C'den birinin eksik olmasi.
        const bad = Object.values(r.envs).some((c) => cellHasProblem(c));
        if (!bad) return false;
      }
      if (gapFilter !== 'all' && envGapOf(r) !== gapFilter) return false;
      return true;
    });
  }, [data, service, q, onlyProblems, gapFilter]);

  const tierTabs = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 rounded-lg p-0.5 bg-[var(--bg-elevated)] w-fit">
        {(
          [
            { id: 'internet', label: 'Internet' },
            { id: 'intranet', label: 'Intranet' },
            { id: 'tasima', label: 'Production Taşımaları' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTier(t.id)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              tier === t.id
                ? 'bg-[var(--bg-surface)] shadow-sm text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <details className="ml-auto group">
        <summary className="text-[11px] text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)] select-none">
          Terimler ne demek?
        </summary>
        <div className="mt-2 text-[11px] text-[var(--text-secondary)] leading-relaxed max-w-3xl rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 space-y-1.5">
          <p>
            <b>SPA sayısı (Toplam):</b> OpenShift’teki uygulama sayısıdır, sunucudaki değil.
            Sayım <b>uygulama × ortam</b> çiftidir: aynı uygulama dev, test ve prod’da varsa{' '}
            <b>3</b> sayılır. Yalnızca ARK cluster’ları ve adında{' '}
            <code className="px-1 rounded bg-[var(--bg-surface)]">-app-v</code> /{' '}
            <code className="px-1 rounded bg-[var(--bg-surface)]">-app-emb-v</code> geçenler.
          </p>
          <p>
            <b>İnternet / intranet ayrımı:</b> uygulamanın <b>route tipinden</b> gelir.{' '}
            <code className="px-1 rounded bg-[var(--bg-surface)]">passthrough</code> = internete
            açık · <code className="px-1 rounded bg-[var(--bg-surface)]">reencrypt</code> =
            intranet.
          </p>
          <p>
            <b>route bulunamadı:</b> uygulamanın route kaydı bulunamadı, dolayısıyla internet mi
            intranet mi <b>belirlenemedi</b>. “Sorun var” demek değil, “sınıflandıramadık” demek.
          </p>
          <p>
            <b>route tipi edge/TLS yok:</b> route var ama tipi passthrough da reencrypt de değil.
            Bu kuralın dışında kalır, tahmin edilmez.
          </p>
          <p>
            <b>OpenShift’te karşılığı olmayan tanım (Internet):</b> nginx’te bir uygulamaya
            giden location tanımı var, ama OpenShift’te o adda bir SPA <b>artık yok</b>. Örnek:
            uygulama emekliye ayrılmış, nginx tanımı kaldırılmamış. Servisi bozmaz; temizlik
            adayı.
          </p>
          <p>
            <b>OpenShift’te karşılığı olmayan kurulum (Intranet):</b> aynı durumun intranet
            hâli. Sunucuda uygulamanın dizinleri (<code className="px-1 rounded bg-[var(--bg-surface)]">/hysdeploy</code>,{' '}
            <code className="px-1 rounded bg-[var(--bg-surface)]">/usr/nginx/applications</code>)
            duruyor, ama OpenShift o adda bir intranet SPA listelemiyor. Ya uygulama
            kaldırılmış ya da route tipi değişmiş. Servisi bozmaz; temizlik adayı.
          </p>
          <p>
            <b>intranet olduğu hâlde dışarıda:</b> route tipi <i>reencrypt</i> (yani intranet)
            olduğu hâlde <b>internete açık</b> bir nginx sunucusunda tanımlı. Gerçek bir
            bulgudur. İntranet sunucusunda olması normaldir, bulgu değildir.
          </p>
          <p>
            <b>Ortam (DEV/TEST/QA/PROD):</b> uygulamanın namespace son ekinden gelir
            (-dev / -test / -qa / -prod), taranan sunucudan değil.
          </p>
          <p>
            <b>Kapsam yüzdesi:</b> internet katmanında “nginx’te tanımlı / toplam”; intranet
            katmanında <b>yalnızca tam kurulumlar</b> üzerinden. Yarım kurulumu kapsandı saymak,
            404 dönen bir uygulamayı yeşil göstermek olurdu.
          </p>
          <p>
            <b>ölçülemedi:</b> o ortama ait hiç kayıt yok. “Hiçbiri tanımlı değil” demek
            <b>değildir</b> — taralı gri bar bunu gösterir.
          </p>
          <p>
            <b>tam kurulu / yarım kurulum / hiç kurulmamış:</b> yalnızca intranet için. Üç dizinin
            kaçı yerinde:{' '}
            <code className="px-1 rounded bg-[var(--bg-surface)]">/hysdeploy/&lt;ns&gt;/&lt;app&gt;/</code>
            ,{' '}
            <code className="px-1 rounded bg-[var(--bg-surface)]">
              /usr/nginx/applications/&lt;ns&gt;/&lt;app&gt;/
            </code>{' '}
            ve{' '}
            <code className="px-1 rounded bg-[var(--bg-surface)]">
              application-confs/&lt;app&gt;-&lt;ns&gt;.conf
            </code>
            . Üçü de varsa tam; biri eksikse yarım (404 döner ama kurulum başlamış); hiçbiri
            yoksa hiç kurulmamış.
          </p>
        </div>
      </details>
    </div>
  );

  if (loading && !data)
    return <LoadingLogo />;
  if (err)
    return (
      <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
        {err}
      </div>
    );
  if (!data?.scanDate) {
    // Kapsam paneli nginx taramasi HIC yokken de anlamli: OpenShift tarafi zaten dolu ve
    // "hicbiri nginx'e tanimli degil" gercek bir bulgudur, bos ekran degil.
    return (
      <div className="space-y-3">
        {tierTabs}
        {tier !== 'tasima' && <NginxSpaSummary tier={tier} />}
        {tier === 'tasima' && <NginxProdMigration />}
        {/* Bu uyari INTERNET taramasi hakkinda: intranet olcumu ayri bir tablodan gelir
            ve kendi eksik-veri mesajini kendisi gosterir. */}
        {tier === 'internet' && (
          <div className="text-sm text-[var(--text-muted)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl px-4 py-6 text-center">
            Henüz bir nginx tarama kaydı yok.{' '}
            <code className="font-mono">nginx_config_audit</code> job&apos;ı çalıştıktan sonra
            burası dolacak.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tierTabs}
      {tier === 'tasima' && <NginxProdMigration />}
      {/* ORTAM OZETI en ustte (kullanici, 2026-09-17): tek tabloda SPA sayisi, nginx'e cikan,
          route'lar; eksik uygulamalar + sahiplik hucreye tiklayinca pencerede.
          Kapsam cubuklari ("Ayrinti"), "Location Detayi" ve "Proxy Tanimlari (PROD)"
          gorunumleri kaldirildi (kafa karistiriyordu). */}
      {tier !== 'tasima' && <NginxSpaSummary tier={tier} />}

      {/* ENV TESHISI: bir ortam bos gorunuyorsa NEDENI burada gorulur. env degeri vhost
          DOSYA ADINDAN turer (<SERVIS>-<ORTAM>.conf), taranan SUNUCUDAN degil - bu ayrim
          "PROD nicin bos" sorusunun cevabi. */}
      {tier === 'internet' && data.envStats && data.envStats.some((e) => e.rows === 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <div className="font-semibold mb-1">
            Bazı ortamlarda hiç kayıt yok:{' '}
            {data.envStats
              .filter((e) => e.rows === 0)
              .map((e) => e.env)
              .join(', ')}
          </div>
          <p className="text-[11px] leading-relaxed">
            Bu denetim <b>SPA/include mimarisi</b> için yazılmıştır: yalnızca{' '}
            <code className="px-1 rounded bg-white/70 border border-amber-200">
              location …&#123; include application-confs/…&#125;
            </code>{' '}
            kalıbındaki satırlar kaydedilir. Ortam bilgisi de taranan sunucudan değil, vhost{' '}
            <b>dosya adından</b> türer:{' '}
            <code className="px-1 rounded bg-white/70 border border-amber-200">
              &lt;SERVİS&gt;-&lt;ORTAM&gt;.conf
            </code>{' '}
            (örnek{' '}
            <code className="px-1 rounded bg-white/70 border border-amber-200">
              GLOMO-TEST.conf
            </code>{' '}
            → TEST). Bir ortamın boş görünmesi dört şeyden biri anlamına gelir: sunucular hâlâ{' '}
            <code className="px-1 rounded bg-white/70 border border-amber-200">proxy_pass</code>{' '}
            mimarisinde (bu kalıp hiç bulunmaz), sunuculara ulaşılamadı, vhost dosya adları kalıba
            uymuyor, ya da adlarındaki ortam eki farklı. Aşağıda hangi etiket altında kaç kayıt
            olduğu görünüyor — beklenmedik bir etiket varsa sebep odur; tüm etiketler sıfırsa o
            ortam bu denetimin kapsamı dışındadır.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {data.envStats.map((e) => (
              <span
                key={e.env}
                title={e.rows ? `vhost: ${e.vhosts.join(', ')}` : 'kayıt yok'}
                className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                  e.rows
                    ? 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border)]'
                    : 'bg-amber-100 text-amber-800 border-amber-300'
                }`}
              >
                {e.env}: {fmtNumber(e.rows)}
              </span>
            ))}
          </div>
        </div>
      )}

      {tier === 'internet' && (
        <>
          {data.dirsReady && <HacLegend defaultOpen={false} />}
          <div className="flex flex-wrap items-center gap-2">
            <Select
              sizeVariant="sm"
              value={scanDate}
              onChange={(e) => {
                setScanDate(e.target.value);
                load(e.target.value);
              }}
            >
              {data.availableDates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
            <div className="relative">
              <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="uygulama ya da ekip ara"
                className="pl-8 pr-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg w-56"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                checked={onlyProblems}
                onChange={(e) => setOnlyProblems(e.target.checked)}
              />
              Sadece sorunlular
            </label>
            <select
              value={gapFilter}
              onChange={(e) => setGapFilter(e.target.value as 'all' | 'prod-only' | 'no-prod')}
              className="px-2 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--bg-surface)]"
              title="Ortam farkı: PROD ile non-prod (dev/test/qa) arasındaki eksikler"
            >
              <option value="all">ortam farkı: hepsi</option>
              <option value="prod-only">yalnız PROD'da var (non-prod'da yok)</option>
              <option value="no-prod">non-prod'da var, PROD'da yok</option>
            </select>
            <span className="text-xs text-[var(--text-muted)] tabular-nums">
              {rows.length} uygulama
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() =>
                  csvDownload(
                    `nginx_spa_audit_${service || 'tum'}`,
                    ['service', 'application', 'ekip', 'ekip_eposta', ...envs],
                    rows.map((r) => [
                      r.service,
                      r.application,
                      r.owner?.groups.join(' | ') || '',
                      r.owner?.emails.join(' | ') || '',
                      ...envs.map((e) => r.envs[e]?.status || '-'),
                    ]),
                  )
                }
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
              >
                <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
              </button>
              <button
                onClick={() => load(scanDate, true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
              >
                <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile
              </button>
            </div>
          </div>

          {/* Servis sekmeleri — kullanici talebi: "yan yana sekme sekme <Servis>" */}
          <div className="flex gap-1 flex-wrap border-b border-[var(--border)]">
            {data.services.map((s) => (
              <button
                key={s}
                onClick={() => setService(s)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg border-b-2 -mb-px transition-colors ${
                  service === s
                    ? 'border-[var(--accent)] text-[var(--accent)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {s}
                {(() => {
                  const st = data.serviceStats?.find((x) => x.service === s);
                  if (!st) return null;
                  const total = Object.values(st.envs).reduce((a, n) => a + n, 0);
                  return (
                    <span className="ml-1 text-[10px] font-normal text-[var(--text-muted)]" title={`location tanımı: ${envs.map((e) => `${e} ${st.envs[e] || 0}`).join(' · ')}`}>
                      {total}
                    </span>
                  );
                })()}
              </button>
            ))}
          </div>

          {/* Secili servisin ortam basina location sayisi (kullanici, 2026-09-14) */}
          {(() => {
            const st = data.serviceStats?.find((x) => x.service === service);
            if (!st) return null;
            return (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                <span className="text-[var(--text-muted)]">{service} location tanımı:</span>
                {envs.map((e) => (
                  <span key={e} className="px-1.5 py-0.5 rounded border tabular-nums" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
                    {e} <b>{st.envs[e] || 0}</b>
                  </span>
                ))}
                <span className="text-[var(--text-muted)]">(vhost içindeki farklı location sayısı; aynı tanım birden fazla sunucuda olsa da bir kez)</span>
              </div>
            );
          })()}
          <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
            <table className="w-full text-sm pf-table-sticky">
              <thead>
                <tr className="bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)] text-left">
                  <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">
                    Uygulama
                  </th>
                  <th
                    className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]"
                    title="Sorumlu ekip: uygulamanin namespace'inin CMDB sahibi (dbo.Openshift_Namespace_Owners)"
                  >
                    Ekip
                  </th>
                  {envs.map((e) => (
                    <th
                      key={e}
                      className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]"
                    >
                      {e}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {rows.length === 0 && <TableEmptyRow colSpan={envs.length + 2} />}
                {rows.map((r) => (
                  <tr key={r.service + r.application} className="hover:bg-[var(--bg-elevated)]/60">
                    <td className="px-3 py-2 font-mono text-xs text-[var(--text-primary)]">
                      {r.application}
                      {envGapOf(r) === 'prod-only' && (
                        <span className="ml-1.5 text-[9px] px-1 rounded border font-sans bg-amber-50 text-amber-700 border-amber-200" title="PROD'da tanımlı ama dev/test/qa'da yok">yalnız PROD</span>
                      )}
                      {envGapOf(r) === 'no-prod' && (
                        <span className="ml-1.5 text-[9px] px-1 rounded border font-sans bg-[var(--bg-elevated)] text-[var(--text-muted)] border-[var(--border-subtle)]" title="dev/test/qa'da var, PROD'da tanım yok">PROD'da yok</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <OwnerCell owner={r.owner} ready={data.ownersReady !== false} />
                    </td>
                    {envs.map((e) => (
                      <EnvCell key={e} cell={r.envs[e]} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function EnvCell({ cell }: { cell?: NginxSpaEnvCell }) {
  if (!cell)
    return (
      <td className="px-3 py-2">
        <span className="text-xs text-[var(--text-muted)]">—</span>
      </td>
    );
  // DIZIN EKSIGI durumu ezer (kullanici, 2026-09-17: "hAC olanlara sorunsuz yazmissin, kafa
  // karistiriyor"): H/A/C'den biri herhangi bir sunucuda kucuk harfse hucre "Sorunsuz"
  // DEGILDIR. Hangi harfin nerede eksik oldugu ipucunda.
  const missingDirs = (cell.dirs || [])
    .filter((d) => d.flags && !(d.flags.hys && d.flags.app && d.flags.conf))
    .map((d) => `${d.host}: ${[!d.flags!.hys && 'H', !d.flags!.app && 'A', !d.flags!.conf && 'C'].filter(Boolean).join('')} yok`);
  const dirsIncomplete = missingDirs.length > 0;
  const meta =
    cell.status === 'OK' && dirsIncomplete
      ? { label: 'Dizin eksik', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
      : STATUS_META[cell.status] || {
          label: cell.status,
          cls: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border)]',
        };
  const isProd = cell.status === 'PROXY' || cell.status === 'NEW_ONLY';
  const title = [
    `Durum: ${meta.label}`,
    dirsIncomplete ? `Eksik dizinler:\n  ${missingDirs.join('\n  ')}` : null,
    cell.status === 'NOT_DEPLOYED'
      ? 'Konfigürasyon yerinde ama uygulamanın dosyaları /usr/nginx/applications ' +
        'altında bulunamadı — bu adres 404 döner.\nYa hiç dağıtılmamış ya da conf ' +
        'adının işaret ettiğinden BAŞKA bir namespace dizinine dağıtılmış.\n' +
        'Kontrol birden çok sunucuda ayrı ayrı yapılır; aşağıdaki sunucu listesi ' +
        'eksiğin görüldüğü yerlerdir.'
      : null,
    cell.status === 'PROXY'
      ? [
          "PROD: eski sunucuda proxy_pass ile OpenShift route'una yönlendiriliyor (SPA include'u yok).",
          `Hedef: ${cell.proxyTarget || '—'}${cell.suffixAdded ? ' (namespace -prod eksikti, eklendi)' : ''}`,
          'H/A/C bayrakları YENİ prod SPA sunucularından okunur (Production Taşımaları).',
        ].join(String.fromCharCode(10))
      : null,
    cell.namespace ? `Namespace: ${cell.namespace}` : null,
    cell.deployMode ? `Dağıtım: ${cell.deployMode}` : null,
    `Context path: ${cell.locationPath}`,
    `Sunucular: ${cell.hosts.join(', ')}`,
  ]
    .filter(Boolean)
    .join('\n');
  const dirsBlock = cell.dirs && cell.dirs.length > 0 && (
    <span className="inline-flex flex-wrap gap-1">
      {cell.dirs.map((d) => (
        <span key={d.host} className="inline-flex items-center gap-1" title={d.host}>
          {cell.dirs && (cell.dirs.length > 1 || isProd) && <span className="text-[9px] opacity-70">{d.host.replace(/^GBNGX/, '')}</span>}
          <DirCell f={d.flags} />
        </span>
      ))}
    </span>
  );
  if (isProd) {
    // PROD (kullanici, 2026-09-17): eski ve yeni sunucu AYNI sutunda ama AYRI kucuk kutular.
    // Eski sunucular (kullanici, 2026-09-17): grubun 8 sunucusunun HEPSINDE tanim varsa
    // yesil; bazisinda eksikse amber ve eksikler yazilir; hic yoksa 'tanim yok'.
    const oldHas = cell.status === 'PROXY';
    const oldExpected = cell.oldExpected || cell.hosts;
    const oldMissing = cell.oldMissing || [];
    const oldCls = !oldHas
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : oldMissing.length === 0
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : 'bg-amber-50 text-amber-700 border-amber-200';
    const oldTitle = oldHas
      ? `proxy tanımı olan: ${cell.hosts.join(', ')}` + (oldMissing.length ? `\nTANIM OLMAYAN: ${oldMissing.join(', ')}` : '\n(grubun tüm eski sunucularında var)')
      : 'eski GBRVP* sunucularında proxy tanımı bulunamadı';
    return (
      <td className="px-3 py-2">
        <div className="inline-flex flex-col gap-1 text-[11px]" title={title}>
          <div className={`px-2 py-1 rounded-lg border ${oldCls}`} title={oldTitle}>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-wide opacity-70">Eski</span>
              <span className="font-semibold">{oldHas ? `proxy · ${cell.hosts.length}/${oldExpected.length} sunucu` : 'tanım yok'}</span>
              {cell.suffixAdded && <span className="text-[9px] opacity-70">+prod</span>}
            </div>
            {oldMissing.length > 0 && (
              <span className="block text-[10px]">eksik: {oldMissing.map((h) => h.replace(/^GBRVP/, '')).join(', ')}</span>
            )}
            {cell.locationPath && <span className="font-mono text-[10px] opacity-90">{cell.locationPath}</span>}
          </div>
          <div className={`px-2 py-1 rounded-lg border ${dirsIncomplete || !cell.dirs?.length ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[9px] font-semibold uppercase tracking-wide opacity-70">Yeni</span>
              {cell.dirs?.length ? dirsBlock : <span className="opacity-80">taranmadı</span>}
            </div>
            {!cell.inOcpInventory && <span className="opacity-80">OCP'de yok</span>}
          </div>
        </div>
      </td>
    );
  }
  return (
    <td className="px-3 py-2">
      <div className={`inline-flex flex-col gap-0.5 text-[11px] px-2 py-1 rounded-lg border ${meta.cls}`} title={title}>
        <span className="font-semibold">{meta.label}</span>
        {/* Context path GORUNUR (kullanici, 2026-09-14: "servislerde location bilgisi yok") */}
        {cell.locationPath && <span className="font-mono text-[10px] opacity-90">{cell.locationPath}</span>}
        {!cell.inOcpInventory && <span className="opacity-80">OCP'de yok</span>}
        {/* H/A/C dizin bayraklari (sunucu basina) - Production Tasimalari ile ayni gosterim */}
        {dirsBlock && <span className="mt-0.5">{dirsBlock}</span>}
      </div>
    </td>
  );
}

// ── 2) OPENSHIFT KAPSAM ───────────────────────────────────────────────────────────────
function OcpCoverage() {
  const [platform, setPlatform] = useState('ark');
  const [data, setData] = useState<OcpCoverageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(true);
  // Kismi kapsam: uygulama o ortamin cluster'larinin BIR KISMINDA var. Bu bir HUKUM
  // degil GOZLEMDIR - bazi uygulamalarin bazi cluster'larda (or. DR) olmamasi mesru
  // olabilir; amac gorunur kilmak.
  const [onlyPartial, setOnlyPartial] = useState(false);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    try {
      const r = await denetimApi.ocpCoverage(p);
      if (r.ok) {
        setData(r);
        setErr('');
      } else setErr(r.message || 'Veri alınamadı.');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useAsyncEffect(async () => {
    await load(platform);
  }, [platform, load]);

  const envs = data?.envs || ['dev', 'test', 'qa', 'prod'];
  /** Bir uygulamanin bir ortamdaki cluster kapsami: kacinda var / o ortamda kac cluster. */
  const coverageOf = useCallback(
    (row: OcpCoverageRow, env: string) => {
      const all = data?.envClusters?.[env] ?? [];
      const on = new Set((row.envs[env] ?? []).map((h) => h.cluster));
      return { k: on.size, n: all.length, on, all: all.map((c) => c.cluster) };
    },
    [data],
  );

  const isPartial = useCallback(
    (row: OcpCoverageRow) =>
      (data?.envs ?? []).some((e) => {
        const { k, n } = coverageOf(row, e);
        return k > 0 && n > 0 && k < n;
      }),
    [data, coverageOf],
  );

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (onlyMissing && r.missingCount === 0) return false;
      if (onlyPartial && !isPartial(r)) return false;
      if (needle && !r.application.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data, q, onlyMissing, onlyPartial, isPartial]);

  const partialCount = useMemo(
    () => (data ? data.rows.filter(isPartial).length : 0),
    [data, isPartial],
  );

  if (loading && !data)
    return <LoadingLogo />;
  if (err)
    return (
      <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
        {err}
      </div>
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select sizeVariant="sm" value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {(data?.platforms || ['ark']).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="uygulama ara"
            className="pl-8 pr-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg w-56"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
          <input
            type="checkbox"
            checked={onlyMissing}
            onChange={(e) => setOnlyMissing(e.target.checked)}
          />
          Sadece eksiği olanlar
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={onlyPartial}
            onChange={(e) => setOnlyPartial(e.target.checked)}
          />
          Sadece kısmi kapsam
        </label>
        <span className="text-xs text-[var(--text-muted)] tabular-nums">
          {rows.length} uygulama
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() =>
              csvDownload(
                `ocp_kapsam_${platform}`,
                ['application', ...envs, 'eksik'],
                rows.map((r) => [
                  r.application,
                  ...envs.map((e) => {
                    const { k, n } = coverageOf(r, e);
                    return k ? `${k}/${n}` : 'YOK';
                  }),
                  r.missing.join(' '),
                ]),
              )
            }
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
          </button>
          <button
            onClick={() => load(platform)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile
          </button>
        </div>
      </div>

      {data && (
        <div className="grid gap-3 md:grid-cols-4">
          <Stat n={data.totalApplications} l="toplam uygulama" />
          <Stat n={data.completeCount} l="tüm ortamlarda var" tone="ok" />
          <Stat
            n={data.totalApplications - data.completeCount}
            l="en az bir ortamda eksik"
            tone="warn"
          />
          <Stat n={data.clusters.length} l="cluster" />
          <Stat
            n={partialCount}
            l="kısmi cluster kapsamı"
            tone={partialCount ? 'warn' : undefined}
          />
        </div>
      )}

      {/* Kullanici istegi: cluster secimi tek basina yeterli degil - hangi ORTAMDA kac
          uygulama var? Sayilar data.rows (TAMAMI) uzerinden hesaplanir, ekrandaki
          filtrelenmis `rows` uzerinden DEGIL: "sadece eksigi olanlar" varsayilan olarak
          acik oldugu icin filtreli sayim ortam toplamlarini oldugundan KUCUK gosterirdi. */}
      {data && data.rows.length > 0 && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3.5">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Ortama göre uygulama sayısı
              </h3>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                <span className="font-mono">{platform}</span> cluster’ında bir uygulamanın o ortamda
                en az bir namespace’i varsa sayılır. Ekrandaki filtrelerden etkilenmez.
              </p>
            </div>
            <span className="text-[11px] text-[var(--text-muted)] tabular-nums">
              toplam {fmtNumber(data.rows.length)} uygulama
            </span>
          </div>
          <div className="space-y-1.5">
            {envs.map((e) => {
              const apps = data.rows.filter((r) => (r.envs[e] || []).length > 0);
              const nsCount = data.rows.reduce((a, r) => a + (r.envs[e] || []).length, 0);
              const pct = data.rows.length ? (apps.length / data.rows.length) * 100 : 0;
              return (
                <div key={e} className="flex items-center gap-3">
                  <span className="w-14 shrink-0 text-xs font-semibold uppercase text-[var(--text-secondary)]">
                    {e}
                  </span>
                  <span className="flex-1 h-5 rounded bg-[var(--bg-elevated)] overflow-hidden">
                    <span
                      className="block h-full bg-[var(--accent)]/70"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="w-32 shrink-0 text-right text-xs tabular-nums text-[var(--text-secondary)]">
                    {fmtNumber(apps.length)} uygulama
                  </span>
                  <span className="w-28 shrink-0 text-right text-[11px] tabular-nums text-[var(--text-muted)]">
                    {fmtNumber(nsCount)} namespace
                  </span>
                  <span className="w-14 shrink-0 text-right text-xs tabular-nums font-semibold text-[var(--text-secondary)]">
                    %{pct.toFixed(0)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* "k/n" ifadesindeki n BURADA aciklanir. Kume sabit DEGIL, veriden cikarilir:
          platformun cluster listesi ortam ayrimi tasimaz (bkz. ocp-platforms.cjs).
          Uygulama sayilari DR gibi bilerek az kullanilan cluster'lari gorunur kilar -
          oralarda "eksik" gorunmesi cogu zaman NORMALDIR. */}
      {data && Object.values(data.envClusters || {}).some((c) => c.length > 0) && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3.5">
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            Ortam başına cluster'lar
          </div>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5 mb-2">
            Tablodaki <span className="font-mono">k/n</span> ifadesindeki <b>n</b> budur: o ortamda
            gerçekten namespace barındıran cluster sayısı. Parantez içindeki sayı o cluster'daki
            uygulama sayısıdır — az uygulamalı bir cluster (örn. DR) için "eksik" görünmesi çoğu
            zaman normaldir.
          </p>
          <div className="space-y-1.5">
            {envs.map((e) => {
              const list = data.envClusters?.[e] ?? [];
              if (!list.length) return null;
              return (
                <div key={e} className="flex flex-wrap items-baseline gap-1.5">
                  <span className="w-12 shrink-0 text-xs font-semibold uppercase text-[var(--text-secondary)]">
                    {e}
                  </span>
                  {list.map((c) => (
                    <span
                      key={c.cluster}
                      className="text-[11px] px-2 py-0.5 rounded-lg border font-mono"
                      style={{
                        borderColor: 'var(--border-subtle)',
                        background: 'var(--bg-elevated)',
                        color: 'var(--text-secondary)',
                      }}
                      title={`${c.apps} uygulama`}
                    >
                      {c.cluster}
                      <span className="ml-1 tabular-nums text-[var(--text-muted)]">({c.apps})</span>
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data && data.patterns.length > 0 && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 px-4 py-3">
          <div className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5">
            En sık eksik ortam desenleri
          </div>
          <div className="flex flex-wrap gap-2">
            {data.patterns.map((p) => (
              <span
                key={p.missing.join(',')}
                className="text-[11px] px-2 py-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]"
              >
                eksik: <b className="font-mono">{p.missing.join(', ')}</b> · {p.count} uygulama
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
        <table className="w-full text-sm pf-table-sticky">
          <thead>
            <tr className="bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)] text-left">
              <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Uygulama</th>
              {envs.map((e) => (
                <th
                  key={e}
                  className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)] uppercase"
                >
                  {e}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {rows.length === 0 && <TableEmptyRow colSpan={envs.length + 1} />}
            {rows.slice(0, 500).map((r) => (
              <tr key={r.application} className="hover:bg-[var(--bg-elevated)]/60">
                <td className="px-3 py-2 font-mono text-xs text-[var(--text-primary)]">
                  {r.application}
                </td>
                {envs.map((e) => {
                  const hit = r.envs[e];
                  // Onceden hucre yalnizca VAR/YOK gosteriyordu: 5 cluster'in 1'inde
                  // olan uygulama, 5'inde olanla AYNI gorunuyordu (2026-09-10 bulgusu).
                  // Artik kac cluster'da oldugu yazili; kismi kapsam sari.
                  const { k, n, on, all } = coverageOf(r, e);
                  const partial = k > 0 && n > 0 && k < n;
                  const cls = !k
                    ? 'bg-red-50 text-red-600 border-red-200'
                    : partial
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200';
                  const eksik = all.filter((c) => !on.has(c));
                  return (
                    <td key={e} className="px-3 py-2">
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-lg border tabular-nums ${cls}`}
                        title={
                          k
                            ? `VAR: ${[...on].sort().join(', ')}` +
                              (eksik.length ? `\nYOK: ${eksik.sort().join(', ')}` : '') +
                              `\n\n${hit?.map((h) => `${h.cluster} / ${h.namespace}`).join('\n')}`
                            : `Bu ortamda hiç yok (${n} cluster tarandı)`
                        }
                      >
                        {k ? `${k}/${n}` : 'YOK'}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 500 && (
        <p className="text-xs text-[var(--text-muted)]">
          İlk 500 satır gösteriliyor — daraltmak için arama kutusunu kullanın ya da CSV indirin.
        </p>
      )}
    </div>
  );
}

// ── 3) INIT / DEPLOYMENT SCRIPT SAPMASI ───────────────────────────────────────────────
// Iki bakis acisi: SCRIPT bazli (bir dosya kac ayri surumle duruyor) ve SUNUCU bazli
// (bir host cogunluktan kac dosyada ayriliyor). Ikisi de ayni veriden turer.
// kind='deploy' (2026-09-18): /vhosting[8]/HYSUXSCRIPTS/*.sh - ayni ekran, ayni yanit sekli;
// tek fark veri ucu, CSV adi ve sunucuya ozel (startCustom.sh) sutununun olmamasi.
const SCRIPTS_AUDIT_META = {
  init: {
    api: (root: string) => denetimApi.initScripts(root),
    csv: 'init',
    job: 'check_initialize',
    intro: 'İnit script\'leri (/vhosting[8]/scripts/initialize) — sha512 çoğunluktan sapanlar.',
  },
  deploy: {
    api: (root: string) => denetimApi.deployScripts(root),
    csv: 'deployment',
    job: 'check_deployment_scripts',
    intro: 'Deployment script\'leri (/vhosting[8]/HYSUXSCRIPTS/*.sh: was_startstop.sh, was_fulldeploy_*.sh …) — sha512 çoğunluktan sapanlar.',
  },
} as const;
function ScriptsAudit({ kind }: { kind: keyof typeof SCRIPTS_AUDIT_META }) {
  const meta = SCRIPTS_AUDIT_META[kind];
  const [root, setRoot] = useState('vhosting');
  const [data, setData] = useState<InitScriptsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [view, setView] = useState<'script' | 'host'>('script');
  const [q, setQ] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // "dosya yok" satirindaki SUNUCU LISTESI varsayilan GIZLI (kullanici talebi):
  // bu liste yuzlerce host icerebiliyor ve asil bilgi olan surum dagilimini
  // ekrandan itiyordu. Sayi hep gorunur; adlar istenince aciliyor.
  const [openMissing, setOpenMissing] = useState<string | null>(null);

  const load = useCallback(async (r: string) => {
    setLoading(true);
    try {
      const res = await meta.api(r);
      if (res.ok) {
        setData(res);
        setErr('');
      } else setErr(res.message || 'Veri alınamadı.');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [meta]);

  useAsyncEffect(async () => {
    await load(root);
  }, [root, load]);

  // GBEVM* / GBPRV* genel envanterden AYRI (kullanici, 2026-09-24; ayni ayrim Server Hub'da).
  // Cogunluk sunucuda GENEL envanterden hesaplanir; bu sunucular AYNI cogunluga gore olculur,
  // yalnizca ayri listelenir. Ucta `special` yoksa (eski yanit / hic ozel sunucu yok) secim
  // gorunmez ve ekran eskisi gibi calisir.
  const [cls, setCls] = useState<'genel' | 'ozel'>('genel');
  const shown = useMemo(
    () => (cls === 'ozel' && data?.special ? ({ ...data, ...data.special } as InitScriptsResult) : data),
    [data, cls],
  );

  // startCustom.sh (sunucuya ozel) sutunu yalniz Init'te var
  const hasCustomCol = !!shown?.scripts.some((sc) => sc.perServer);

  const scripts = useMemo(() => {
    if (!shown) return [];
    const needle = q.trim().toLowerCase();
    return shown.scripts.filter((sc) => {
      if (onlyDiff && !sc.perServer && sc.variantCount <= 1 && sc.missing === 0) return false;
      if (needle && !sc.label.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [shown, q, onlyDiff]);

  const hostRows = useMemo(() => {
    if (!shown) return [];
    const needle = q.trim().toLowerCase();
    return shown.hostRows
      .filter((h) => {
        if (onlyDiff && h.deviationCount === 0 && h.missingCount === 0) return false;
        if (needle && !h.host.toLowerCase().includes(needle)) return false;
        return true;
      })
      .sort((a, b) => b.deviationCount - a.deviationCount || a.host.localeCompare(b.host));
  }, [shown, q, onlyDiff]);

  if (loading && !data)
    return <LoadingLogo />;
  if (err)
    return (
      <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
        {err}
      </div>
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select sizeVariant="sm" value={root} onChange={(e) => setRoot(e.target.value)}>
          {(data?.roots || ['vhosting']).map((r) => (
            <option key={r} value={r}>
              /{r}
            </option>
          ))}
        </Select>

        {data?.special && (
          <div className="flex gap-1 rounded-lg p-0.5 bg-[var(--bg-elevated)]">
            {(
              [
                { id: 'genel', label: 'Genel envanter', n: data.hosts },
                { id: 'ozel', label: 'GBEVM / GBPRV', n: data.special.hosts },
              ] as const
            ).map((c) => (
              <button
                key={c.id}
                onClick={() => setCls(c.id)}
                title={
                  c.id === 'ozel'
                    ? 'Genel envanterden ayrı tutulur: çoğunluk bu sunuculardan hesaplanmaz, ama aynı çoğunluğa göre ölçülürler'
                    : 'Çoğunluk yalnızca bu sunuculardan hesaplanır'
                }
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  cls === c.id
                    ? 'bg-[var(--bg-surface)] shadow-sm text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {c.label} · {c.n}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-1 rounded-lg p-0.5 bg-[var(--bg-elevated)]">
          {(
            [
              { id: 'script', label: 'Script bazlı' },
              { id: 'host', label: 'Sunucu bazlı' },
            ] as const
          ).map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                view === v.id
                  ? 'bg-[var(--bg-surface)] shadow-sm text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={view === 'script' ? 'script ara' : 'sunucu ara'}
            className="pl-8 pr-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg w-56"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
          <input
            type="checkbox"
            checked={onlyDiff}
            onChange={(e) => setOnlyDiff(e.target.checked)}
          />
          Sadece farkı olanlar
        </label>
        <span className="text-xs text-[var(--text-muted)] tabular-nums">
          {view === 'script' ? `${scripts.length} script` : `${hostRows.length} sunucu`}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() =>
              view === 'script'
                ? csvDownload(
                    `${meta.csv}_script_sapma_${root}`,
                    [
                      'script',
                      'sunucuya_ozel',
                      'surum_sayisi',
                      'cogunluk_hash',
                      'cogunluk_adet',
                      'sapan_adet',
                      'eksik_adet',
                    ],
                    scripts.map((sc) => [
                      sc.label,
                      sc.perServer ? 'EVET' : 'HAYIR',
                      sc.variantCount,
                      sc.majorityHash ? sc.majorityHash.slice(0, 16) : '',
                      sc.majorityCount,
                      sc.deviatingCount,
                      sc.missing,
                    ]),
                  )
                : csvDownload(
                    `${meta.csv}_sunucu_sapma_${root}`,
                    [
                      'host',
                      'sapma_adedi',
                      'sapan_scriptler',
                      'eksik_adedi',
                      'eksik_scriptler',
                      'startCustom_var',
                    ],
                    hostRows.map((h) => [
                      h.host,
                      h.deviationCount,
                      h.deviations.join(' '),
                      h.missingCount,
                      h.missing.join(' '),
                      h.hasCustom ? 'EVET' : 'HAYIR',
                    ]),
                  )
            }
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
          </button>
          <button
            onClick={() => load(root)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile
          </button>
        </div>
      </div>

      <div className="text-xs text-[var(--text-muted)]">
        {meta.intro} Kaynak job: <code>{meta.job}</code>{data?.scanDate ? ` · son tarama ${data.scanDate.split('-').reverse().join('.')}` : ''}.
        {data?.message && data.hosts === 0 && <span className="ml-1 text-amber-700">{data.message}</span>}
      </div>

      {data && (
        <div className="grid gap-3 md:grid-cols-4">
          <Stat n={shown!.hosts} l="sunucu" />
          <Stat n={shown!.identicalHosts} l="çoğunlukla birebir aynı" tone="ok" />
          <Stat n={shown!.hosts - shown!.identicalHosts} l="en az bir script'te farklı" tone="warn" />
          <Stat n={shown!.totalVariants} l="toplam farklı sürüm" />
        </div>
      )}

      {data && data.missingColumns.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          Şu dosyalar için veritabanında henüz sütun yok: <b>{data.missingColumns.join(', ')}</b>.
          check_initialize job'ı yeni haliyle bir kez çalıştığında sütun otomatik açılır ve buraya
          düşer.
        </div>
      )}

      {view === 'script' ? (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
          <table className="w-full text-sm pf-table-sticky">
            <thead>
              <tr className="bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)] text-left">
                <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Script</th>
                <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">
                  Farklı sürüm
                </th>
                <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">
                  Çoğunluk
                </th>
                <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Sapan</th>
                <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Yok</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {scripts.length === 0 && <TableEmptyRow colSpan={5} />}
              {scripts.map((sc) => (
                <React.Fragment key={sc.key}>
                  <tr
                    className="hover:bg-[var(--bg-elevated)]/60 cursor-pointer"
                    onClick={() => setOpen(open === sc.key ? null : sc.key)}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <ChevronRightIcon
                          className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform ${open === sc.key ? 'rotate-90' : ''}`}
                        />
                        <span className="font-mono text-xs text-[var(--text-primary)]">
                          {sc.label}
                        </span>
                        {sc.perServer && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border bg-violet-50 text-violet-700 border-violet-200">
                            sunucuya özel
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <VariantBadge sc={sc} />
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--text-secondary)] tabular-nums">
                      {sc.majorityHash ? (
                        // Kirpilmis hash okunabiliyordu ama KOPYALANAMIYORDU; oysa
                        // bu degerin tek isi baska bir yerdeki hash ile karsilastirilmak.
                        // CodeChip tam degeri `title`da tutar ve tiklayinca panoya yazar.
                        <span className="inline-flex items-center gap-1 min-w-0">
                          <CodeChip
                            value={sc.majorityHash}
                            label={`${sc.majorityHash.slice(0, 10)}…`}
                            wrap="truncate"
                            copyable
                          />
                          <span className="tabular-nums flex-shrink-0">· {sc.majorityCount}</span>
                        </span>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums">
                      {sc.perServer ? (
                        <span className="text-[var(--text-muted)]">—</span>
                      ) : sc.deviatingCount > 0 ? (
                        <span className="text-amber-700 font-semibold">{sc.deviatingCount}</span>
                      ) : (
                        <span className="text-[var(--text-muted)]">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums">
                      {sc.missing > 0 ? (
                        <span className="text-[var(--text-secondary)]">{sc.missing}</span>
                      ) : (
                        <span className="text-[var(--text-muted)]">0</span>
                      )}
                    </td>
                  </tr>
                  {open === sc.key && (
                    <tr className="bg-[var(--bg-elevated)]/60">
                      <td colSpan={5} className="px-3 py-3">
                        <div className="space-y-2">
                          {sc.variants.map((v, i) => (
                            <div
                              key={v.hash}
                              className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2"
                            >
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={`text-[10px] px-1.5 py-0.5 rounded border ${
                                    sc.perServer
                                      ? 'bg-violet-50 text-violet-700 border-violet-200'
                                      : i === 0
                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                        : 'bg-amber-50 text-amber-700 border-amber-200'
                                  }`}
                                >
                                  {sc.perServer
                                    ? `sürüm ${i + 1}`
                                    : i === 0
                                      ? 'çoğunluk'
                                      : `farklı sürüm ${i}`}
                                </span>
                                <span className="font-mono text-[11px] text-[var(--text-muted)] break-all">
                                  {v.hash.slice(0, 32)}…
                                </span>
                                <span className="text-xs text-[var(--text-muted)] tabular-nums ml-auto">
                                  {v.count} sunucu
                                </span>
                              </div>
                              <div className="mt-1.5 text-[11px] text-[var(--text-secondary)] font-mono break-words">
                                {v.hosts.slice(0, 40).join(', ')}
                                {v.hosts.length > 40 && ` … (+${v.hosts.length - 40})`}
                              </div>
                            </div>
                          ))}
                          {sc.missing > 0 && (
                            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] px-1.5 py-0.5 rounded border bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border)]">
                                  dosya yok
                                </span>
                                <span className="text-xs text-[var(--text-muted)] tabular-nums ml-auto">
                                  {sc.missing} sunucu
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    // Bu blok ACILMIS satirin ICINDE; tiklama yukari
                                    // yayilirsa ust satir kapanir ve liste hic gorunmez.
                                    e.stopPropagation();
                                    setOpenMissing(openMissing === sc.key ? null : sc.key);
                                  }}
                                  className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                                >
                                  {openMissing === sc.key
                                    ? 'sunucuları gizle'
                                    : 'sunucuları göster'}
                                </button>
                              </div>
                              {openMissing === sc.key && (
                                <div className="mt-1.5 text-[11px] text-[var(--text-secondary)] font-mono break-words">
                                  {sc.missingHosts.slice(0, 40).join(', ')}
                                  {sc.missingHosts.length > 40 &&
                                    ` … (+${sc.missingHosts.length - 40})`}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
          <table className="w-full text-sm pf-table-sticky">
            <thead>
              <tr className="bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)] text-left">
                <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Sunucu</th>
                <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">
                  Çoğunluktan sapan
                </th>
                <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Eksik</th>
                {hasCustomCol && (
                  <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">
                    startCustom.sh
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {hostRows.length === 0 && <TableEmptyRow colSpan={hasCustomCol ? 4 : 3} />}
              {hostRows.slice(0, 500).map((h) => (
                <tr key={h.host} className="hover:bg-[var(--bg-elevated)]/60 align-top">
                  <td className="px-3 py-2 font-mono text-xs text-[var(--text-primary)] whitespace-nowrap">
                    {h.host}
                  </td>
                  <td className="px-3 py-2">
                    {h.deviationCount === 0 ? (
                      <span className="text-[11px] px-2 py-0.5 rounded-lg border bg-emerald-50 text-emerald-700 border-emerald-200">
                        aynı
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {h.deviations.map((d) => (
                          <span
                            key={d}
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200"
                          >
                            {d}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {h.missingCount === 0 ? (
                      <span className="text-xs text-[var(--text-muted)]">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {h.missing.map((d) => (
                          <span
                            key={d}
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border)]"
                          >
                            {d}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  {hasCustomCol && (
                  <td className="px-3 py-2">
                    {h.hasCustom ? (
                      <span
                        className="text-[11px] font-mono text-violet-700"
                        title={h.customHash || ''}
                      >
                        {(h.customHash || '').slice(0, 10)}…
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--text-muted)]">yok</span>
                    )}
                  </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view === 'host' && hostRows.length > 500 && (
        <p className="text-xs text-[var(--text-muted)]">
          İlk 500 satır gösteriliyor — daraltmak için arama kutusunu kullanın ya da CSV indirin.
        </p>
      )}
    </div>
  );
}

function VariantBadge({ sc }: { sc: InitScriptStat }) {
  const n = sc.variantCount;
  const cls = sc.perServer
    ? 'bg-violet-50 text-violet-700 border-violet-200'
    : n <= 1
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : n <= 3
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-red-50 text-red-700 border-red-200';
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-lg border tabular-nums ${cls}`}>
      {n === 0 ? 'hiç yok' : `${n} sürüm`}
    </span>
  );
}

// `hint`: sayinin NE OLDUGUNU tek cumlede soyler. Etiketler kisa olmak zorunda
// (kutuya sigmali) ama kisa etiket cogu zaman belirsiz kaliyordu - "Toplam" neyin
// toplami? Aciklama etiketin ALTINDA duruyor, fare ipucunda gizli degil.
function Stat({
  n,
  l,
  tone,
  hint,
}: {
  n: number;
  l: string;
  tone?: 'ok' | 'warn';
  hint?: string;
}) {
  const color =
    tone === 'ok'
      ? 'text-emerald-600'
      : tone === 'warn'
        ? 'text-amber-600'
        : 'text-[var(--text-primary)]';
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{fmtNumber(n)}</div>
      <div className="text-xs text-[var(--text-secondary)] mt-0.5">{l}</div>
      {hint && (
        <div className="text-[10px] text-[var(--text-muted)] mt-1 leading-snug">{hint}</div>
      )}
    </div>
  );
}
