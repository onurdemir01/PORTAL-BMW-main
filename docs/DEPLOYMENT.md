# BMW Portal — Deployment (RHEL, tek :3000 semasi)

> ⚠ **Bu VM'de calistirilacak TEK komutlar:** `deploy/release.sh <env>` (surum guncelleme)
> ve `deploy/run.sh <env> {start|stop|restart|status|logs}` (gunluk operasyon) — VEYA
> `systemctl {start|stop|status} bmw-portal@<env>` (systemd tercih edilirse, bkz. asagi).
> `npm run dev` / `npm run dev:all` / `npm start` **KULLANILMAZ** (bkz. [SETUP-SIMPLE.md](SETUP-SIMPLE.md) —
> bunlar yalnizca yerel gelistirme icindir, iki ayri port acar ve `.env.<env>` dosyalarini okumaz).

Guncel uretim modeli (gblabt02):

```
Kullanici → https://bmwportal-d.fw.garanti.com.tr (kurumsal nginx, 443)
          → proxy_pass http://10.151.162.147:3000
          → node server/index.cjs <env>   (production: dist/ statik + /api ayni port)
          → MSSQL TBMWANS (tum kalici veri) · LDAP · AWX · MCP
```

- **Kurumsal nginx'e dokunulmaz.** `/usr/nginx/conf.d/BMW_Portal-D.conf` 443'u `:3000`'e
  proxy'ler; onerilen header/timeout eklemeleri icin referans: `deploy/BMW_Portal-D.conf`.
- **Vite dev prod'da calistirilmaz.** Node production modda hem `dist/` statik dosyalarini
  hem `/api`'yi `:3000`'den servis eder.
- **Tum kalici veri MSSQL'dedir (TBMWANS).** Uygulama dizini ezilebilir/silinebilir —
  kayit, ayar, oturum, tercih, sohbet, audit hicbir sey kaybolmaz.

## Erisim gereksinimleri

| Hedef | Port | Amac |
|---|---|---|
| MSSQL (10.230.111.44) | 1453 TCP | TBMWANS — portal + envanter verisi |
| LDAP (adds.fw.garanti.com.tr) | 636 TCP | LDAPS kimlik dogrulama |
| AWX (maestro/maestro2) | 443 TCP | Ansible template/job |
| Nobet API (gbnys) | 443 TCP | Nobetci bilgisi |
| Dynatrace/Instana MCP | 443 TCP | Performance/AI Analist |

## Sunucu yerlesimi

```
/vhosting8/bmw_portal/
├── deploy/
│   ├── PORTAL-BMW-main.zip      ← surum zip'i buraya kopyalanir
│   └── backup-<ts>/             ← release.sh'in aldigi son 3 yedek
└── app/
    └── PORTAL-BMW-main/         ← acilan repo agaci (uygulama koku)
        ├── .env.dev|test|qa|prod  (zip'te YOK — sunucuda elle olusur, release.sh korur)
        ├── server/  src/  dist/  deploy/  docs/
        └── logs/<env>.{pid,out}   (run.sh)
```

## Ilk kurulum

```bash
# root ile (bir kez):
sudo bash deploy/setup-rhel.sh          # dizinler + firewalld + SELinux
sudo dnf module enable -y nodejs:20 && sudo dnf install -y nodejs

# was kullanicisiyla:
dzdo su - was
cd /vhosting8/bmw_portal
cp /tmp/PORTAL-BMW-main.zip deploy/
unzip -o deploy/PORTAL-BMW-main.zip -d app/
cd app/PORTAL-BMW-main
cp .env.example .env.prod && vi .env.prod
# SESSION_SECRET MUTLAKA doldurulmali (openssl rand -hex 32) — bos birakilirsa
# run.sh baslatmayi REDDEDER (guvensiz varsayilan anahtar production'da kullanilmaz).
./deploy/run.sh prod start
./deploy/run.sh prod status
```

`run.sh start` **node_modules ve dist eksikse otomatik `npm ci` + `npm run build` calistirir**
— elle kurulum adimi gerekmez, tek komut yeterlidir ("bir kere calistir, calissin").

## Surum guncelleme (rutin)

```bash
# 1) Yeni zip'i kopyala
cp /tmp/PORTAL-BMW-main.zip /vhosting8/bmw_portal/deploy/

# 2) release.sh her seyi yapar: stop → yedek → unzip → env koru → npm ci → build → start
cd /vhosting8/bmw_portal/app/PORTAL-BMW-main
./deploy/release.sh prod
```

`release.sh` env dosyalarini otomatik korur, son 3 yedegi `deploy/backup-<ts>` altinda tutar.
Veri DB'de oldugu icin surum degisiminde hicbir kayit/ayar kaybolmaz.

## Ortamlar

Tum ortamlar `PORT=3000` kullanir ve ayni hostta **karsilikli munhasirdir** — `run.sh`
yeni ortami baslatirken calisani otomatik durdurur:

```bash
./deploy/run.sh <dev|test|qa|prod> [start|stop|restart|status|logs]
```

Env dosyasi secimi: `node server/index.cjs <env>` → `.env.<env>` yuklenir
(oncelik: `.env.<APP_ENV>` → `.env.local` → `.env`). **APP_ENV disaridan (argv) gelir**,
`.env.<env>` dosyalarinin ICINDE `APP_ENV=...` satiri YOKTUR ve olsa da okunmaz.

## Kalici Calisma (crash + reboot kurtarma)

`deploy/run.sh` tek basina crash sonrasi kendini yeniden BASLATMAZ ve VM reboot sonrasi
otomatik ACILMAZ — bunun icin asagidaki IKI mekanizmadan BIRINI (operatorun erisimine gore)
kurun. **Ikisini AYNI ortam icin birlikte kullanmayin** (cift-surec/port cakismasi olur).

| | Root/sudo gerekir mi? | Crash sonrasi otomatik restart | VM reboot sonrasi otomatik acilma |
|---|---|---|---|
| **cron + watchdog** (onerilen, root yoksa) | Hayir | Evet (2 dk'da bir kontrol) | Evet (`@reboot`) |
| **systemd** (root varsa) | Evet | Evet (aninda, `Restart=on-failure`) | Evet (`systemctl enable`) |

### Secenek A — cron + watchdog (root gerekmez)

```bash
cd /vhosting8/bmw_portal/app/PORTAL-BMW-main
./deploy/install-cron.sh prod
```

Tek seferlik kurulum; idempotent (tekrar calistirilirsa satirlari ikinci kez eklemez).
Kurulanlar: `@reboot` ile VM acilinca `run.sh prod start`, ve her 2 dakikada bir
`deploy/watchdog.sh prod` (surec olmusse otomatik yeniden baslatir; siz `run.sh prod stop`
dediyseniz DOKUNMAZ). Olaylar `logs/prod.watchdog.log`'a yazilir. Kaldirmak icin `crontab -e`
ile ilgili iki satiri elle silin.

### Secenek B — systemd (root/sudo varsa)

```bash
sudo cp deploy/bmw-portal@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bmw-portal@prod   # <dev|test|qa|prod> ortami sec
sudo systemctl status bmw-portal@prod
journalctl -u bmw-portal@prod -f              # canli log
```

Bu durumda **`deploy/run.sh` KULLANILMAZ** — systemd dogrudan `node server/index.cjs prod`
calistirir, `Restart=on-failure` + `enable` reboot/crash kurtarmayi ucretsiz saglar.
Durdurmak/baslatmak icin `sudo systemctl stop|start bmw-portal@prod`.

## Kalicilik notlari

- **Oturumlar:** MSSQL session store VARSAYILAN (`portal_sessions`) — restart'ta logout olmaz.
  Kapatmak icin `SESSION_STORE=memory`.
- **Admin Sistem sekmesi:** degisiklikler `portal_env_overrides` tablosuna yazilir,
  boot'ta env dosyalarinin USTUNE uygulanir. `.env.local`'a artik yazilmaz.
- **Eski JSON store'lar:** ilk boot'ta tablolara tek seferlik goc edilir
  (`[DB] migrated ...` loglari); dosyalar yalnizca geri donus emniyeti olarak kalir.
- Tablolarin tam listesi: `docs/DATABASE.md`.

## Sorun giderme

```bash
./deploy/run.sh prod logs          # canli log
curl -s http://127.0.0.1:3000/api/auth/session-debug | head   # session/proxy teshisi
node scripts/test-tls.cjs          # TLS zinciri
npm test                           # birim testleri
npm run lint:ascii                 # yorum/log ASCII guard'i
```

Kalici calisma (crash/reboot kurtarma) kurulumu icin yukaridaki "Kalici Calisma" bolumune bakin.
