# BMW Portal — Basit Kurulum (yerel gelistirme)

> ⚠ **Bu dosya SADECE yerel gelistirme icindir.** VM/sunucuda (`gblabt02`) **ASLA**
> `npm run dev`, `npm run dev:all` veya `npm start` calistirmayin — bunlar iki-portlu
> (vite :3000 + API :5055) gelistirme modunu acar, kurumsal nginx'in bekledigi tek-port
> `:3000` production modelini DEGIL. Sunucuda daima [DEPLOYMENT.md](DEPLOYMENT.md)'deki
> `deploy/run.sh` / `deploy/release.sh` kullanilir.

Sunucu kurulumu icin: [DEPLOYMENT.md](DEPLOYMENT.md). Bu dosya yalnizca yerel
gelistirme akisini anlatir.

## Gereksinimler
- Node.js 20+
- (Opsiyonel) Kurumsal aga erisim — MSSQL/LDAP/AWX olmadan da acilir, store'lar
  dosya/seed fallback ile calisir ve uyari loglar.

## Kurulum

```bash
npm ci
cp .env.example .env.local
# .env.local: PORT=5055 + NODE_ENV=development yapin (vite :3000, /api proxy → :5055)
```

`.env.local` icin yerel gelistirme degerleri:

```
PORT=5055
NODE_ENV=development
SESSION_STORE=memory        # yerelde DB yoksa
LOCAL_ADMIN_USER=admin
LOCAL_ADMIN_PASS=admin
```

## Calistirma

```bash
npm run dev:all     # SERVER (:5055) + WEB (vite :3000) birlikte
# http://localhost:3000  → admin/admin ile giris (LDAP yoksa local fallback)
```

Testler ve kontroller:

```bash
npm test            # node --test birim testleri
npx tsc --noEmit    # tip kontrolu
npm run lint:ascii  # yorum/log ASCII guard'i
npm run build       # uretim paketi (dist/)
```

## Notlar
- Prod'da vite CALISMAZ: `node server/index.cjs prod` dist/ + /api'yi :3000'den verir.
- Tum kalici veri MSSQL'de — yerelde DB yoksa degisiklikler ucucu olur (beklenen).
- Env yukleme sirasi: `.env.<APP_ENV>` → `.env.local` → `.env` (ilk yuklenen kazanir).
