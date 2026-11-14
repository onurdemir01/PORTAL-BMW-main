# gelistirme/ — tam bağımlılık manifesti

Bu dizindeki `package.json` + `package-lock.json` projenin **tam** bağımlılık ağacıdır: çalışma zamanı + geliştirme araçları (vite, vitest, eslint, typescript…). **Tek kaynak budur.**

Kökteki `package.json` (`dependencies`, `overrides`) ve `package-lock.json` buradan **türetilir** ve yalnız çalışma zamanı paketlerini taşır. Neden: `docs/GUVENLIK-0-ZAFIYET.md` ("Model").

| İş                        | Komut                                                             |
| ------------------------- | ----------------------------------------------------------------- |
| Kurulum (geliştirici, CI) | `npm run kur` (kökte)                                             |
| Paket ekle / güncelle     | `cd gelistirme && npm install <paket>` → kökte `npm run manifest` |
| Eşitliği denetle          | `npm run manifest -- --dogrula` (testler de sınar)                |

`npm run kur`, ağacı `gelistirme/node_modules` altına kurar ve kökteki `node_modules`'u ona bağlar. Kökte yanlışlıkla `npm install` çalıştırılırsa geliştirme araçları silinir; `npm run kur` geri getirir.

Bu dizin çalışma zamanı paketine (`npm run paket`) girmez.
