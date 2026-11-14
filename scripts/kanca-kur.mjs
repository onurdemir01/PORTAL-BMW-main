// scripts/kanca-kur.mjs — `npm install` sonrasi git kancalarini (husky) kurar. package.json `prepare`.
//
// Kokteki .npmrc (omit=dev) yuzunden varsayilan kurulumda husky YOKTUR (kurumsal pipeline, uretim
// sunucusu). `prepare: husky` orada "komut bulunamadi" ile kurulumun TAMAMINI dusururdu. Husky
// kurulu degilse sessizce cikilir; kuruluysa hatasi gizlenmez.
let husky;
try {
  husky = (await import('husky')).default;
} catch (e) {
  if (e && e.code === 'ERR_MODULE_NOT_FOUND') process.exit(0);
  throw e;
}
const cikti = husky();
if (cikti) console.log(cikti);
