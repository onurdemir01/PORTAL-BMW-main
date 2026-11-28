// server/__tests__/fixtures/husky-coz.mjs — kanca-kur.test.js'in alt surecine `node --import` ile
// yuklenir: 'husky' cozumunu bozan bir yukleme kancasi kurar. HUSKY_COZ=yok -> paket kurulu degil
// (ERR_MODULE_NOT_FOUND, kok manifest kurulumu); baska deger -> baska bir yukleme hatasi.
import { register } from 'node:module';
import process from 'node:process';

const kip = process.env.HUSKY_COZ;
const kod = kip === 'yok' ? 'ERR_MODULE_NOT_FOUND' : 'ERR_SAHTE_BOZUK';
const kanca = `export async function resolve(belirtec, baglam, sonraki) {
  if (belirtec === 'husky') {
    const e = new Error('sahte husky: ${kip}');
    e.code = '${kod}';
    throw e;
  }
  return sonraki(belirtec, baglam);
}`;
register(`data:text/javascript,${encodeURIComponent(kanca)}`);
