'use strict';
// server/ansible/awx-sunucu-bagimlilik.cjs - bir AWX sunucusunu devre disi birakmadan once
// bagimlilik ozeti (2026-10-26).
//
// Kullanici: "portalin eski maestro.fwgaranti.com.tr yani maestro 1'e olan baglantisini
// kapatmak istiyorum ... Burasi cok sik guncellenen ortamlar degil ... 2-3 yilda bir." Seyrek
// yapilan bir is oldugu icin tuzaklar unutulur; bu ozet onlari ekrana getirir:
//
//   ENGEL   sunucuda yarim kalacak is: OCO zamanlamasi, bekleyen Smart bileti, tutulan kilit,
//           kosan ScaleX / LogX isi, sonucu denetlenmemis OpsX WAS islemi, ucustaki Retirement.
//           Kapatma bunlar bitmeden REDDEDILIR (AWX_SCHEDULED OCO kaydi maestro'nun KENDI
//           zamanlamasidir: Portal kesilse de orada kosar, once Portal'dan iptal edilmeli).
//   UYARI   kapatinca calismayacak ayar: bu sunucuya bagli Self Service servisleri, Playbook
//           Kayitlari satirlari, *_AWX_SERVER_ID / AWX_LOGX_SERVER_ID, eski tek-sunucu AWX_URL.
//           Kapatmayi engellemez; admin bilerek kapatir.
//
// Bir sorgu okunamazsa (tablo yok, DB hatasi) ozet "kapatilabilir" DEMEZ: bilinmeyen sayi
// sifir sayilmaz.

const UCUSTA_RETIREMENT = "('stop_scheduled','stopping','deleting','rolling_back','restoring')";

const ENGELLER = [
  {
    anahtar: 'oco',
    baslik: 'OCO zamanlanmış başlatma',
    ipucu: 'Admin > Smart Talepleri > OCO Zamanlamaları ekranından iptal edin (sunucu henüz etkinken). AWX_SCHEDULED kayıt sunucunun kendi zamanlamasıdır; Portal kesilse de orada koşar, iptal onu da siler.',
    sql: `SELECT COUNT(*) AS n FROM oco_scheduled_launches
           WHERE awx_server_id = $1 AND status IN ('SCHEDULED','LAUNCHING','PENDING_APPROVAL','AWX_SCHEDULED')`,
  },
  {
    anahtar: 'smart',
    baslik: 'Onay bekleyen Smart bileti',
    ipucu: 'Onaylanırsa iş bu sunucuda başlatılmak istenir ve hata verir; Admin > Smart Talepleri ekranında sonuçlanmasını bekleyin ya da iptal edin.',
    sql: `SELECT COUNT(*) AS n FROM smart_tickets WHERE awx_server_id = $1 AND status IN ('PENDING','LAUNCHING')`,
  },
  {
    anahtar: 'kilit',
    baslik: 'Tutulan OpsX / Crypto Hub kilidi',
    ipucu: 'Kilit, işin sonucu bu sunucudan okunarak bırakılır; kapatılırsa süre dolana kadar kalır.',
    sql: `SELECT (SELECT COUNT(*) FROM opsx_was_locks WHERE held = 1 AND awx_server_id = $1)
               + (SELECT COUNT(*) FROM crypto_hub_locks WHERE held = 1 AND awx_server_id = $1) AS n`,
  },
  {
    anahtar: 'scalex',
    baslik: 'Süren ScaleX işlemi',
    ipucu: 'İşlem bitene kadar bekleyin.',
    sql: `SELECT COUNT(*) AS n FROM scalex_operations
           WHERE awx_server_id = $1 AND status IN ('RUNNING','PENDING_APPROVAL','SCHEDULED')`,
  },
  {
    anahtar: 'logx',
    baslik: 'Süren LogX işi',
    ipucu: 'İş bitene kadar bekleyin.',
    sql: `SELECT COUNT(*) AS n FROM logx_v2_jobs
           WHERE awx_server_id = $1 AND status NOT IN ('successful','failed','error','canceled')`,
  },
  {
    anahtar: 'opsx',
    baslik: 'Sonucu denetlenmemiş OpsX WAS işlemi',
    ipucu: 'Uzlaştırıcı sonucu bu sunucudan okur; birkaç dakika içinde kendiliğinden kapanır.',
    sql: `SELECT COUNT(*) AS n FROM opsx_was_ops WHERE awx_server_id = $1 AND audited_at IS NULL`,
  },
  {
    // retirement_targets sunucu numarasi tutmuyor: isin sunucusu okuma aninda Playbook
    // Kayitlarindan cozulur. Retirement kayitlari bu sunucuyu gosteriyorsa ucustaki hedef
    // ENGELDIR (kapatilirsa "durumu okunamadi"da kalir; kayit cevrilirse BASKA sunucuda ayni
    // numarali is okunur).
    anahtar: 'retirement',
    baslik: 'Uçuştaki Retirement hedefi',
    ipucu: 'Retirement ekranında durdurma / silme / geri alma bitene kadar bekleyin.',
    sql: `SELECT CASE WHEN EXISTS (SELECT 1 FROM ansible_playbook_registry
                                    WHERE key_name LIKE 'app[_]retirement[_]%' AND awx_server_id = $1)
                      THEN (SELECT COUNT(*) FROM retirement_targets WHERE status IN ${UCUSTA_RETIREMENT})
                      ELSE 0 END AS n`,
  },
];

function urlHost(u) {
  try {
    return new URL(String(u || '').trim()).host.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * @param {number} no  server_no
 * @param {{ db: { query: Function }, env?: object, sunucuUrl?: string }} ctx
 */
async function bagimlilikOzeti(no, { db, env = process.env, sunucuUrl = '' } = {}) {
  const engeller = [];
  const uyarilar = [];
  const okunamayan = [];

  for (const e of ENGELLER) {
    try {
      const { rows } = await db.query(e.sql, [no]);
      const n = Number(rows && rows[0] && rows[0].n) || 0;
      if (n > 0) engeller.push({ anahtar: e.anahtar, baslik: e.baslik, adet: n, ipucu: e.ipucu });
    } catch (err) {
      okunamayan.push({ anahtar: e.anahtar, baslik: e.baslik, hata: String((err && err.message) || err) });
    }
  }

  const liste = async (anahtar, baslik, sql, alan, ipucu) => {
    try {
      const { rows } = await db.query(sql, [no]);
      const adlar = (rows || []).map((r) => String(r[alan] == null ? '' : r[alan])).filter(Boolean);
      if (adlar.length) uyarilar.push({ anahtar, baslik, adet: adlar.length, ornekler: adlar.slice(0, 20), ipucu });
    } catch (err) {
      okunamayan.push({ anahtar, baslik, hata: String((err && err.message) || err) });
    }
  };
  await liste(
    'ss',
    'Bu sunucuya bağlı Self Servis servisi',
    `SELECT title FROM ansible_ss_items WHERE awx_server_id = $1 ORDER BY title`,
    'title',
    'Kapatınca "Başlat" hata verir. Servisi diğer sunucudaki template ile yeniden ekleyin (template numarası sunucuya özgüdür).',
  );
  await liste(
    'kayit',
    'Bu sunucuyu gösteren Playbook Kayıtları satırı',
    `SELECT key_name FROM ansible_playbook_registry WHERE enabled = 1 AND awx_server_id = $1 ORDER BY key_name`,
    'key_name',
    "Admin > Playbook Kayıtları'nda sunucuyu ve template ID'sini güncelleyin.",
  );
  if (Number(no) === 1) {
    await liste(
      'kayit_bos',
      'Sunucusu seçilmemiş Playbook Kayıtları satırı',
      `SELECT key_name FROM ansible_playbook_registry WHERE enabled = 1 AND awx_server_id IS NULL ORDER BY key_name`,
      'key_name',
      "LogX ve ScaleX sunucusu seçilmemiş kaydı #1'e yönlendirir; kapatınca bunlar çalışmaz. Sunucuyu açıkça seçin.",
    );
  }

  const envAnahtarlari = Object.keys(env || {})
    // OPSX_AWX_SERVER_ID, SCALEX_..., FILEX_..., TELNET_... ve AWX_LOGX_SERVER_ID
    .filter((k) => /(^|_)AWX_(\w+_)?SERVER_ID$/.test(k) && String(env[k]).trim() === String(no))
    .sort();
  if (envAnahtarlari.length) {
    uyarilar.push({
      anahtar: 'env',
      baslik: 'Bu sunucuyu gösteren ortam değişkeni',
      adet: envAnahtarlari.length,
      ornekler: envAnahtarlari,
      ipucu: '.env ya da Admin > Sistem değerlerini diğer sunucunun numarasına çevirin.',
    });
  }
  const host = urlHost(sunucuUrl);
  if (host && urlHost(env && env.AWX_URL) === host) {
    uyarilar.push({
      anahtar: 'awx_url',
      baslik: 'Eski tek-sunucu AWX_URL bu sunucuyu gösteriyor',
      adet: 1,
      ornekler: ['AWX_URL'],
      ipucu: 'AI araçları, LogX v1 ve OCP sağlık kontrolü bu yoldan gider; devre dışı bırakmak onları KESMEZ. AWX_URL ve AWX_LOG_FETCH_TEMPLATE_ID değerlerini diğer sunucuya çevirin.',
    });
  }

  return {
    serverNo: Number(no),
    engeller,
    uyarilar,
    okunamayan,
    kapatilabilir: engeller.length === 0 && okunamayan.length === 0,
  };
}

module.exports = { bagimlilikOzeti, _ENGELLER: ENGELLER };
