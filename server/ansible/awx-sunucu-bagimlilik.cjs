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
    // Nginx Yuk Testi (2026-10-27) da burada: kosu ve on kontrol isleri kilit tutar; kilidi ve
    // kosunun sonucu bu sunucudan okunur. Yuk testi ISI basina BIR sayilir (uc kilidi tek is):
    // tutulan kilidin isi ile suren kosu satirinin isi UNION ile tekillestirilir; kilidi
    // baglanamamis (yarim) kosu da sayilir.
    anahtar: 'kilit',
    baslik: 'Tutulan OpsX / Crypto Hub kilidi ya da süren Nginx Yük Testi',
    ipucu: 'Kilit, işin sonucu bu sunucudan okunarak bırakılır; kapatılırsa süre dolana kadar kalır. Yük testi için Nginx Hub > Yük Testi ekranında koşunun bitmesini bekleyin ya da Durdur ile durdurun.',
    sql: `SELECT (SELECT COUNT(*) FROM opsx_was_locks WHERE held = 1 AND awx_server_id = $1)
               + (SELECT COUNT(*) FROM crypto_hub_locks WHERE held = 1 AND awx_server_id = $1)
               + (SELECT COUNT(*) FROM (
                    SELECT awx_job_id FROM nginx_loadtest_kilitleri WHERE held = 1 AND awx_server_id = $1 AND awx_job_id IS NOT NULL
                    UNION
                    SELECT awx_job_id FROM nginx_loadtest_kosular
                     WHERE awx_server_id = $1 AND awx_job_id IS NOT NULL AND durum IN ('QUEUED','RUNNING','FINALIZING')
                  ) yt) AS n`,
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
    // Ucustaki isin sahibi GUNCEL Playbook Kaydi degildir: kayit yeni AWX'e tasinmis olsa da
    // eski AWX'te baslayan isin sonucu oradan okunur. STOP / DELETE / ROLLBACK sahipligini
    // launch aninda yazilan history kanitlar. History INSERT'i best-effort dustuyse sahiplik
    // belirsizdir ve butun disable denemeleri engellenir; registry tasindiginda yeni sunucuya
    // yanlis sahiplik verilmez. Zamanlanmis STOP henuz launch edilmedigi icin yalniz gelecekte
    // kullanacagi guncel kayitla baglanir. Web geri acma history'ye yazilmiyor; onun sahibi jobId ile
    // birlikte web_result_json'a yazilan awxServerId + sunucuIsi isaretidir. History/JSON
    // sorgusu okunamazsa dis dongu bunu okunamayan sayip fail-closed kalir.
    anahtar: 'retirement',
    baslik: 'Uçuştaki Retirement hedefi',
    ipucu: 'Retirement ekranında durdurma / silme / geri alma bitene kadar bekleyin.',
    sql: `SELECT COUNT(*) AS n
            FROM retirement_targets t
            OUTER APPLY (
              SELECT COUNT(*) AS history_count,
                     SUM(CASE WHEN h.awx_server_id = $1 THEN 1 ELSE 0 END) AS server_count
                FROM ansible_job_history h
               WHERE h.job_id = CASE t.status
                       WHEN 'stopping' THEN t.last_job_id
                       WHEN 'deleting' THEN t.delete_job_id
                       WHEN 'rolling_back' THEN t.rollback_job_id
                     END
                 AND JSON_VALUE(CASE WHEN ISJSON(h.params) = 1 THEN h.params ELSE '{}' END, '$.plan_only') = 'false'
                 AND (
                   (t.status = 'stopping' AND h.template_name LIKE 'Retirement: STOP %')
                   OR (t.status = 'deleting' AND h.template_name LIKE 'Retirement: DELETE %')
                   OR (t.status = 'rolling_back' AND h.template_name LIKE 'Retirement: GERI AL%')
                 )
                 AND (
                   (
                     UPPER(JSON_VALUE(CASE WHEN ISJSON(h.params) = 1 THEN h.params ELSE '{}' END, '$.target_host')) = UPPER(t.host)
                     AND UPPER(JSON_VALUE(CASE WHEN ISJSON(h.params) = 1 THEN h.params ELSE '{}' END, '$.application')) = UPPER(t.app_name)
                     AND COALESCE(JSON_VALUE(CASE WHEN ISJSON(h.params) = 1 THEN h.params ELSE '{}' END, '$.jboss_gen'), '<NULL>')
                         = COALESCE(CONVERT(NVARCHAR(50), t.jboss_gen), '<NULL>')
                   )
                   OR EXISTS (
                     SELECT 1
                       FROM OPENJSON(CASE WHEN ISJSON(h.params) = 1 THEN h.params ELSE '{}' END, '$.rt_hedefler')
                       WITH (host NVARCHAR(255) '$.host', application NVARCHAR(255) '$.application', jboss_gen NVARCHAR(50) '$.jboss_gen') ht
                      WHERE UPPER(ht.host) = UPPER(t.host)
                        AND UPPER(ht.application) = UPPER(t.app_name)
                        AND COALESCE(ht.jboss_gen, '<NULL>') = COALESCE(CONVERT(NVARCHAR(50), t.jboss_gen), '<NULL>')
                   )
                 )
            ) owner
           WHERE (
               (t.status IN ${UCUSTA_RETIREMENT} AND (
                  (t.status = 'stop_scheduled' AND EXISTS (
                     SELECT 1 FROM ansible_playbook_registry r
                      WHERE r.key_name LIKE 'app[_]retirement[_]%' AND r.awx_server_id = $1
                  ))
                  OR (t.status IN ('stopping','deleting','rolling_back')
                      AND (COALESCE(owner.server_count, 0) > 0 OR owner.history_count = 0))
               ))
               -- Web isi ana STOP'tan bagimsiz tamamlanir: hedef 'stopped' olduktan sonra da
               -- web_result_json 'running' kalabilir, dolayisiyla hedef status filtresine girmez.
               OR EXISTS (
                  SELECT 1
                    FROM OPENJSON(CASE WHEN ISJSON(t.web_result_json) = 1 THEN t.web_result_json ELSE '[]' END)
                    WITH (status NVARCHAR(32) '$.status', jobId BIGINT '$.jobId',
                          awxServerId INT '$.awxServerId', sunucuIsi BIGINT '$.sunucuIsi') w
                   WHERE w.status IN ('running','restoring')
                     AND (
                       (w.awxServerId = $1 AND (w.status <> 'restoring' OR w.sunucuIsi = w.jobId))
                       OR w.awxServerId IS NULL
                       OR (w.status = 'restoring' AND (w.sunucuIsi IS NULL OR w.sunucuIsi <> w.jobId))
                     )
               )
             )`,
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
