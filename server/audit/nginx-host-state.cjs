// server/audit/nginx-host-state.cjs — bir nginx sunucusunun OLCULEBILIRLIK durumu.
//
// Kullanici (2026-09-26): "tum envanterlerde gecerli olmak uzere, bir Nginx instance'i
// calismiyorsa ve Nginx dizini var ancak Nginx hic kurulu degilse bunu belirt."
//
// NEDEN AYRI BIR MODUL: ayni soru Rate Limit, Audit, CIS, Kullanilmayan... her envanterde
// soruluyor. Her ekranin kendi tahminini yurutmesi, ayni sunucu icin ayri cevaplar
// uretirdi.
//
// UC AYRI GERCEK, UC AYRI KOLON:
//   1. KURULU MU     -> status 'noinst' (dizin yok ya da dizin var binary yok)
//   2. CALISIYOR MU  -> run_state running | stopped | unknown
//   3. KONFIGURASYON -> status ok | fail  (`nginx -T`)
//
// Bunlar birbirinin yerine gecmez. `nginx -T` nginx AYAKTA OLMASA DA calisir: duran bir
// sunucunun konfigurasyonu gecerli olabilir. Eskiden binary yoklugu da 'fail' idi ve
// ekranda "nginx sozdizimi hatali" yaziyordu - oysa sunucuda nginx HIC YOKTU.
'use strict';

const HOSTS_TABLE = 'dbo.Nginx_Audit_Hosts';

/** Olculemeyen durum bir BULGU DEGILDIR: 'bilinmiyor' der, "kurulu degil" demez. */
const DURUM = {
  kurulumyok: {
    label: 'nginx kurulu değil',
    tone: 'danger',
    hint: 'Sunucuda nginx dizini ve/veya çalıştırılabilir dosya yok — bu envanterde ölçülecek bir şey yok.',
  },
  calismiyor: {
    label: 'nginx çalışmıyor',
    tone: 'warning',
    hint: 'Konfigürasyon okunabildi ama nginx ayakta değil: burada görünen değerler DOSYADA yazan değerler, şu an uygulanmıyor.',
  },
  configbozuk: {
    label: 'konfigürasyon geçersiz',
    tone: 'danger',
    hint: '`nginx -T` düştü: konfigürasyon reload edilemez, ölçüm eksik olabilir.',
  },
  olculdu: { label: 'ölçüldü', tone: 'success', hint: 'nginx kurulu, çalışıyor ve konfigürasyonu geçerli.' },
  bilinmiyor: {
    label: 'ölçülmedi',
    tone: 'neutral',
    hint: 'Bu sunucu için tarama kaydı yok ya da tarama çalışma durumunu hiç ölçmemiş (eski nginx_audit sürümü).',
  },
};

/**
 * Tek satirdan durum cikarir. Sira ONEMLI: kurulu degilse gerisi anlamsiz.
 * @param {{status?: string, runState?: string}|null} row
 */
function classify(row) {
  if (!row) return 'bilinmiyor';
  const st = String(row.status || '?').toLowerCase();
  const run = String(row.runState || '?').toLowerCase();

  if (st === 'noinst') return 'kurulumyok';
  // 'stopped' ile 'unknown' ayri: olcemedigimiz icin "durdu" demek, olmayan bir bulgu
  // uretmek olurdu.
  if (run === 'stopped') return 'calismiyor';
  if (st === 'fail') return 'configbozuk';
  if (st === 'ok' && run === 'running') return 'olculdu';
  return 'bilinmiyor';
}

/** Bu durumda sayisal olcum GUVENILIR mi? Degilse ekran "eksik" DEMEMELI. */
function olculebilir(durum) {
  return durum === 'olculdu' || durum === 'calismiyor';
}

function describe(durum) {
  return { durum, ...(DURUM[durum] || DURUM.bilinmiyor) };
}

/**
 * Bir tarama gununun host durumlarini okur.
 * run_state/run_msg kolonlari HENUZ YOKSA (eski sema) sorgu duser; o durumda yalnizca
 * status okunur ve calisma durumu 'bilinmiyor' kalir - ekran "calismiyor" DEMEZ.
 */
async function loadHostStates({ query, sql, scanDate = null } = {}) {
  if (typeof query !== 'function') return new Map();

  const tarih = scanDate
    ? `CAST(@d AS DATE)`
    : `(SELECT MAX(scan_date) FROM ${HOSTS_TABLE})`;
  const params = scanDate ? [{ name: 'd', type: sql.NVarChar(10), value: scanDate }] : [];

  const calis = async (kolonlar) => {
    const r = await query(
      `SELECT host, status, status_msg${kolonlar} FROM ${HOSTS_TABLE} WHERE scan_date = ${tarih}`,
      params,
    );
    return r.recordset || [];
  };

  let rows;
  try {
    rows = await calis(', run_state, run_msg');
  } catch {
    try {
      rows = await calis('');
    } catch {
      return new Map();
    }
  }

  const out = new Map();
  for (const r of rows) {
    const host = String(r.host || '').trim().toUpperCase();
    if (!host) continue;
    const kayit = {
      host,
      status: String(r.status || '?'),
      statusMsg: r.status_msg || null,
      runState: r.run_state ? String(r.run_state) : '?',
      runMsg: r.run_msg || null,
    };
    kayit.durum = classify(kayit);
    kayit.olculebilir = olculebilir(kayit.durum);
    Object.assign(kayit, describe(kayit.durum));
    out.set(host, kayit);
  }
  return out;
}

module.exports = { loadHostStates, classify, describe, olculebilir, DURUM, HOSTS_TABLE };
