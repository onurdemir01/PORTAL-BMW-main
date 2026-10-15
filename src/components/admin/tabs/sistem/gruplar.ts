// src/components/admin/tabs/sistem/gruplar.ts — Admin > Sistem bolum ve grup tanimlari.
//
// Grup `ad` alani ortamDegiskenleri.ts'teki `group` alaniyla BIREBIR eslesir (SistemAyarlari
// testleri her anahtarin bir gruba dustugunu olcer). Bu dosyada `key:` alani YOKTUR: S11/S12
// toplayicilari yalniz ortamDegiskenleri.ts'i okur, ama ad cakismasi da istemiyoruz.
//
// Sira SABIT ve bilinclidir (kod sirasina degil, yoneticinin zihnindeki sira: once altyapi,
// sonra kimlik, sonra dis sistemler, en son portal modulleri).
import {
  ServerIcon,
  CircleStackIcon,
  ArchiveBoxIcon,
  LockClosedIcon,
  IdentificationIcon,
  ShieldCheckIcon,
  CommandLineIcon,
  BellAlertIcon,
  TicketIcon,
  CalendarDaysIcon,
  UserGroupIcon,
  ChartBarIcon,
  SparklesIcon,
  WrenchScrewdriverIcon,
  ShieldExclamationIcon,
  ArrowsPointingOutIcon,
  DocumentMagnifyingGlassIcon,
} from '@heroicons/react/24/outline';

export type BolumId = 'altyapi' | 'kimlik' | 'entegrasyon' | 'moduller';

export interface Bolum {
  id: BolumId;
  ad: string;
}

export interface Grup {
  id: string;
  ad: string;
  bolum: BolumId;
  aciklama: string;
  ikon: typeof ServerIcon;
  /** Bu ayarlarin asil yonetildigi ekran (varsa). */
  asilYeri?: string;
  asilYeriEtiketi?: string;
}

export const BOLUMLER: Bolum[] = [
  { id: 'altyapi', ad: 'Altyapı' },
  { id: 'kimlik', ad: 'Kimlik ve Güvenlik' },
  { id: 'entegrasyon', ad: 'Entegrasyonlar' },
  { id: 'moduller', ad: 'Modüller' },
];

export const GRUPLAR: Grup[] = [
  {
    id: 'sunucu',
    ad: 'Sunucu',
    bolum: 'altyapi',
    aciklama: 'Node sunucusunun temel çalışma ayarları.',
    ikon: ServerIcon,
  },
  {
    id: 'veritabani',
    ad: 'Veritabanı',
    bolum: 'altyapi',
    aciklama: 'Portal veritabanı bağlantısı ve envanter sorguları için salt okunur hesap.',
    ikon: CircleStackIcon,
  },
  {
    id: 'yedekleme',
    ad: 'Veritabanı yedekleme',
    bolum: 'altyapi',
    aciklama: 'Günlük tam yedeğin yeri, saati ve saklama süresi.',
    ikon: ArchiveBoxIcon,
    asilYeri: '/admin?tab=dbbackup',
    asilYeriEtiketi: 'DB Yedekleme',
  },
  {
    id: 'tls',
    ad: 'TLS / Sertifika',
    bolum: 'altyapi',
    aciklama: 'Dış bağlantılarda güvenilecek kurumsal CA zinciri.',
    ikon: LockClosedIcon,
  },
  {
    id: 'ldap',
    ad: 'Dizin (LDAP)',
    bolum: 'kimlik',
    aciklama: 'Kullanıcı doğrulamasında kullanılan Active Directory bağlantısı.',
    ikon: IdentificationIcon,
  },
  {
    id: 'oturum',
    ad: 'Oturum ve Giriş',
    bolum: 'kimlik',
    aciklama: 'Oturum süreleri, giriş sınırları ve tarayıcı güvenlik başlıkları.',
    ikon: ShieldCheckIcon,
  },
  {
    id: 'awx',
    ad: 'Ansible (AWX)',
    bolum: 'entegrasyon',
    aciklama: 'Varsayılan AWX sunucusu, servis hesabı ve şablon kısıtları.',
    ikon: CommandLineIcon,
    asilYeri: '/admin?tab=ansible',
    asilYeriEtiketi: 'Ansible Info',
  },
  {
    id: 'teams',
    ad: 'Uzun iş bildirimi (Teams)',
    bolum: 'entegrasyon',
    aciklama: 'Uzun süren AWX işleri için Teams bildirimi.',
    ikon: BellAlertIcon,
  },
  {
    id: 'smart',
    ad: 'Smart',
    bolum: 'entegrasyon',
    aciklama: 'Talep yönetim sistemi bağlantısı ve onay takibi.',
    ikon: TicketIcon,
  },
  {
    id: 'oco',
    ad: 'OCO',
    bolum: 'entegrasyon',
    aciklama: 'Değişiklik kaydı ve kesinti penceresi sorguları.',
    ikon: CalendarDaysIcon,
  },
  {
    id: 'nobet',
    ad: 'Nöbet',
    bolum: 'entegrasyon',
    aciklama: 'Nöbetçi listesinin alındığı harici sistem.',
    ikon: UserGroupIcon,
  },
  {
    id: 'izleme',
    ad: 'İzleme',
    bolum: 'entegrasyon',
    aciklama: 'Dynatrace ve Instana MCP adresleri.',
    ikon: ChartBarIcon,
  },
  {
    id: 'yapay-zeka',
    ad: 'Yapay zekâ',
    bolum: 'entegrasyon',
    aciklama: "AI Analist'in sağlayıcısı, modeli ve API anahtarları.",
    ikon: SparklesIcon,
  },
  {
    id: 'opsx',
    ad: 'OpsX',
    bolum: 'moduller',
    aciklama: 'Sunucu operasyonları ve thread/heap dump için yedek değerler.',
    ikon: WrenchScrewdriverIcon,
    asilYeri: '/admin?tab=playbooks',
    asilYeriEtiketi: 'Playbook Kayıtları',
  },
  {
    id: 'opsx-smart',
    ad: 'OpsX · Smart onayı yedekleri',
    bolum: 'moduller',
    aciklama: 'Production onayı için ortam değişkeni yedekleri; bu ekrandan değiştirilmez.',
    ikon: ShieldExclamationIcon,
    asilYeri: '/opsx',
    asilYeriEtiketi: 'OpsX › Smart Onayı',
  },
  {
    id: 'scalex',
    ad: 'ScaleX',
    bolum: 'moduller',
    aciklama: 'Doğrulama bütçesi, hedef tavanları ve production SMART kuralı.',
    ikon: ArrowsPointingOutIcon,
    asilYeri: '/admin?tab=scalex',
    asilYeriEtiketi: 'ScaleX Yönetimi',
  },
  {
    id: 'logx',
    ad: 'LogX',
    bolum: 'moduller',
    aciklama: 'Uygulama envanteri tablosu ve indirme ara dizinleri.',
    ikon: DocumentMagnifyingGlassIcon,
  },
];
