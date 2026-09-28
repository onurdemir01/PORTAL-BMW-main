// shared/cryptoHubConfigMaps.cjs — config map değişince NE rollout edilmeli?
//
// Kullanıcı (2026-09-28): "Crypto Hub'a config map'leri editleyebilmeleri için bir özellik
// ekle. Mesela Ledger Accounting Config Map'i değiştirilince Ledger Accounting'in rollout
// edilmesi gerektiğinde oraya yazalım."
//
// NEDEN BU DOSYA VAR: config map'i güncellemek pod'ları yeniden başlatmaz. Env olarak
// verilmiş değerler HİÇ değişmez; dosya olarak mount edilmişse kubelet birkaç dakikada
// tazeler ama uygulama çoğu zaman değeri başlangıçta okur. Yani "kaydettim" ile "yürürlüğe
// girdi" ayrı şeylerdir ve aradaki farkı ekran söylemezse, kimse fark etmeden eski
// değerlerle koşan bir sistem kalır.
//
// İKİ SEVİYE, KARIŞTIRILMAZ:
//   kayitli — buraya ELLE yazılmış, doğrulanmış eşleşme. Ekran kesin konuşur.
//   tahmin  — ada bakarak çıkarılan öneri ("ledger-accounting-config" → "ledger-accounting").
//             Ekran bunu TAHMİN olarak gösterir; yanlış olabilir, onayı kullanıcı verir.
// Eşleşme yoksa uydurulmaz: "kayıtlı değil" denir ve buraya eklenmesi istenir. Yanlış bir
// bileşeni rollout etmek, düzeltmeye çalıştığınız kesintiyi büyütmenin en hızlı yoludur.
'use strict';

/**
 * @typedef {Object} ConfigMapKurali
 * @property {string} app        'metaco' | 'wyden' (hangi uygulamanın ortamlarında geçerli)
 * @property {string} [name]     tam config map adı
 * @property {string} [pattern]  ad deseni (RegExp kaynağı) — `name` yoksa kullanılır
 * @property {string[]} targets  rollout edilecek hedefler (deployment/<ad>, statefulset/<ad>)
 * @property {string} [note]     ekranda gösterilecek not (neden, sıra, dikkat edilecekler)
 */

/** @type {ConfigMapKurali[]} */
const KURALLAR = [
  // ÖRNEK VE İLK GERÇEK KAYIT (kullanıcının verdiği): Ledger Accounting.
  // Adlar ortamda farklıysa burası güncellenmeli — tahmin yerine kayıt tercih edilir.
  {
    app: 'wyden',
    pattern: '^ledger-?accounting(-config)?$',
    targets: ['deployment/ledger-accounting'],
    note: 'Ledger Accounting config map’i değişince Ledger Accounting rollout edilmeli.',
  },
];

/** Ada bakarak bileşen tahmini: "ledger-accounting-config" -> "ledger-accounting". */
function tahminHedef(cmName) {
  const ad = String(cmName || '')
    .trim()
    .toLowerCase();
  if (!ad) return null;
  // Yaygın son ekler atılır; geriye anlamlı bir ad kalmazsa tahmin YAPILMAZ.
  const kok = ad.replace(/[-_](config|configmap|cm|settings|properties|env)$/i, '');
  if (!kok || kok === ad) return null;
  return `deployment/${kok}`;
}

/**
 * Bir config map için rollout hedefleri.
 * @returns {{ kaynak: 'kayitli'|'tahmin'|'yok', targets: string[], note: string }}
 */
function rolloutHedefleri(app, cmName) {
  const ad = String(cmName || '').trim();
  const uygulama = String(app || '')
    .trim()
    .toLowerCase();

  for (const k of KURALLAR) {
    if (k.app && k.app !== uygulama) continue;
    const tutar = k.name
      ? k.name.toLowerCase() === ad.toLowerCase()
      : k.pattern && new RegExp(k.pattern, 'i').test(ad);
    if (tutar) return { kaynak: 'kayitli', targets: [...k.targets], note: k.note || '' };
  }

  const t = tahminHedef(ad);
  if (t) {
    return {
      kaynak: 'tahmin',
      targets: [t],
      // TAHMIN OLDUGU EKRANDA YAZAR: yanlis bileseni rollout etmek, duzeltmeye calisilan
      // kesintiyi buyutur.
      note: 'Bu eşleşme config map ADINDAN çıkarıldı, kayıtlı değil — doğrulayın.',
    };
  }

  return {
    kaynak: 'yok',
    targets: [],
    note:
      'Bu config map için rollout hedefi kayıtlı değil. Hangi bileşenin yeniden ' +
      'başlatılması gerektiğini biliyorsanız shared/cryptoHubConfigMaps.cjs içine ekleyin.',
  };
}

module.exports = { KURALLAR, rolloutHedefleri, tahminHedef };
