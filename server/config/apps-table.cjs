// server/config/apps-table.cjs — kurumsal uygulama envanteri tablosunun ADI.
//
// NEDEN SABIT DEGIL: bu tablo portal'in KENDI semasi degil, kurumsal envanter
// DB'sinde yasar (server/inventory/mssql.cjs havuzu). Adi kurumsal tarafta
// degisebilir — nitekim 'EnvanterApps' -> 'MWAppsInventory' olarak degisti ve
// LogX legacy akisi sessizce snapshot fallback'ine dustu. Env'den okunmasi,
// bir sonraki degisiklikte kod degistirip yeniden deploy etmek yerine
// Admin > Sistem ekranindan duzeltilmesini saglar.
//
// Kod bu tablodan su sutunlari bekler: app, host, env (+ OpsX icin jboss_version)
//
// GUVENLIK: SQL tanimlayicilari (tablo adi) parametre olarak baglanamaz —
// sorguya string olarak girer. Bu yuzden deger KATI bir bicim kontrolunden
// gecer; beyaz listeye uymayan bir deger reddedilir ve varsayilana dusulur.
// Boylece env/DB uzerinden SQL enjeksiyonu mumkun olmaz.
'use strict';

const DEFAULT_APPS_TABLE = 'MWAppsInventory';

// Yalniz harf/rakam/alt-cizgi; istege bagli tek seviyeli sema oneki (dbo.Tablo).
// Bosluk, tirnak, noktali virgul, parantez vb. hicbir sey gecmez.
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

let warned = false;

function getAppsTable() {
  const raw = String(process.env.LOGX_APPS_TABLE || '').trim();
  if (!raw) return DEFAULT_APPS_TABLE;
  if (!SAFE_IDENTIFIER.test(raw)) {
    if (!warned) {
      console.warn(
        `[Config] LOGX_APPS_TABLE gecersiz bicimde ("${raw}") — yok sayildi, ` +
        `varsayilan kullaniliyor: ${DEFAULT_APPS_TABLE}`
      );
      warned = true;
    }
    return DEFAULT_APPS_TABLE;
  }
  return raw;
}

module.exports = { getAppsTable, DEFAULT_APPS_TABLE };
