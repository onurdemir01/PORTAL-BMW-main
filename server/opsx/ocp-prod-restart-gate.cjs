// server/opsx/ocp-prod-restart-gate.cjs — GEÇİCİ kapı: OpsX ▸ Openshift ▸ uygulama restart
// PRODUCTION cluster seçildiğinde reddedilir. Adminler muaf.
//
// KULLANICI TALEBİ (2026-10-06, kendi sözleriyle): "Geçici süreliğine senden şöyle bir şey
// rica edeceğim. Opsix OpenShift tarafında eğer Production Cluster'ı seçilirse uygulama
// restart yapılamasın, izin verilmesin. Ancak adminler her işi yapabilir, onda sorun yok."
//
// GEÇİCİ: kapı TEK dosyada ve TEK çağrı noktasında (`server/opsx/index.cjs`, POST
// /api/opsx/run Openshift dalı) duruyor; kaldırmak için o çağrıyı silmek yeterli, başka
// hiçbir davranış bu dosyaya bağlı değil. Onyüz de aynı kuralı kendi tarafında gösterir
// ama KARAR BURADA verilir (istemciye güvenilmez).
//
// KAPSAM — YALNIZ RESTART. threaddump/heapdump (POST /api/opsx/dump/openshift) salt tanı
// işlemleridir, uygulamayı etkilemezler ve BU KAPIYA GİRMEZLER. Kullanıcı "uygulama restart
// yapılamasın" dedi; tanı almayı da kapatmak istenmeyen bir yan etki olurdu.
//
// NEDEN AYRI DOSYA VE YAPILANDIRILAMAZ: bu bir güvenlik kapısı. Admin ekranından ya da
// DB'den ayarlanabilir olsaydı, bayat bir satır kapıyı SESSİZCE açabilirdi — bu depoda aynı
// tuzağa üç kez düşüldü (portal_config_blobs satırı kod varsayılanını eziyor). Kural kodda
// sabit; değişmesi gerekiyorsa bu dosya değişir ve gözden geçirilir.
'use strict';

const { getRequestRole } = require('../auth/utils.cjs');

// ── "PRODUCTION" NASIL ANLAŞILIR ─────────────────────────────────────────────
//
// OCP kataloğundaki `env` alanı SERBEST METİN (ocp_cluster_index.env NVARCHAR(30), admin
// yazıyor): üretimde `prod`, `PROD`, `prd` görüldü. `was-state.cjs`'teki ENV_MAP yalnızca
// bu üç TAM eşleşmeyi biliyor; `prod-tr` ya da `prod1` gibi bir etiket oraya düşmez ve kapı
// SESSİZCE AÇILIRDI. Bir güvenlik kapısının fail-open davranması, kapıyı hiç koymamaktan
// kötüdür (korunduğunu sanırsınız), bu yüzden burada DESEN eşlemesi yapılır.
//
// YANLIŞ POZİTİFE KARŞI: `preprod` / `nonprod` içinde "prod" geçer ama üretim DEĞİLDİR;
// bunlar önce ayıklanır. Yanlış pozitifin bedeli zaten düşük (admin yine yapabilir ve
// mesaj neden reddedildiğini söyler); yanlış negatifin bedeli ise kullanıcının tam olarak
// engellemek istediği şeydir.
// ÖNCE AYIKLANANLAR: içinde "prod" geçen ama üretim OLMAYAN etiketler.
const URETIM_DISI_RE = /(non[-_ ]?prod|pre[-_ ]?prod|prod[-_ ]?(test|like|sim)|sandbox)/i;

// "prod" / "production" KELİME İÇİNDE DE ARANIR, sınır şartı YOKTUR. Gerçek cluster
// adlarında işaret ayırıcısız gömülü geliyor: `giocpank3rdwyprod1` (üretimdeki Wyden prod
// cluster'ı) — sınır şartlı bir desen bunu KAÇIRIR ve kapı fail-open olurdu. "prod" yeterince
// ayırt edici bir dizi; yanlış pozitif üretebilecek bileşikler (preprod/nonprod) yukarıda
// zaten ayıklandı.
const URETIM_GOMULU_RE = /(prod|production|canli|canlı)/i;

// `prd` KISALTMASI ise YALNIZ TAM SÖZCÜK olarak sayılır: üç harflik bir dizi kelime içinde
// rastgele eşleşebilir ve test cluster'larını yanlışlıkla kapatabilirdi.
const URETIM_PRD_RE = /(^|[^a-z])prd([^a-z]|$)/i;

/**
 * Bir ortam/cluster etiketi üretime mi işaret ediyor?
 * @param {unknown} etiket
 * @returns {boolean}
 */
function uretimEtiketi(etiket) {
  const s = String(etiket ?? '')
    .trim()
    .toLowerCase();
  if (!s) return false;
  if (URETIM_DISI_RE.test(s)) return false;
  return URETIM_GOMULU_RE.test(s) || URETIM_PRD_RE.test(s);
}

/**
 * Seçim üretim mi? ORTAM ETİKETİ birincil ölçüttür (kullanıcının gördüğü "Cluster grubu:
 * {tenant} / {env}" satırındaki env). Ama tenant ya da hedef cluster adı üretim işaretli
 * ise o da üretim sayılır: katalogda yanlış `env` ile kaydedilmiş bir satır kapıyı
 * açmasın (defence in depth — playbook hedefi `{{ oc_cluster }}_{{ env }}`).
 *
 * @param {{env?: unknown, tenant?: unknown, clusters?: unknown[]}} secim
 * @returns {{uretim: boolean, sebep: string|null}} sebep: hangi alan tetikledi
 */
function uretimSecimi(secim) {
  const { env, tenant, clusters } = secim || {};
  if (uretimEtiketi(env)) return { uretim: true, sebep: `ortam=${String(env).trim()}` };
  if (uretimEtiketi(tenant)) return { uretim: true, sebep: `cluster grubu=${String(tenant).trim()}` };
  for (const c of Array.isArray(clusters) ? clusters : []) {
    if (uretimEtiketi(c)) return { uretim: true, sebep: `cluster=${String(c).trim()}` };
  }
  return { uretim: false, sebep: null };
}

const MESAJ =
  'Production cluster üzerinde uygulama restart’ı şu an kapalı. Bu kısıt geçici olarak ' +
  'yürürlüktedir; üretimde restart gerekiyorsa yönetici ile ilerleyin. (Tanı işlemleri — ' +
  'thread dump / heap dump — etkilenmedi.)';

/**
 * GEÇİCİ KAPI. Reddedilecekse bir nesne, geçilecekse null döner.
 *
 * ADMIN MUAFİYETİ (kullanıcının duran kuralı: "Adminler default olarak her şeyi görebilir
 * ve her şeyi yapabiliyor olsun"): rolü Admin olan kullanıcı kapıya HİÇ girmez. Muafiyet
 * ÜRETİM TESPİTİNDEN ÖNCE değerlendirilir ki adminin isteği hiç sınıflandırılmasın.
 *
 * @param {import('express').Request} req
 * @param {{env?: unknown, tenant?: unknown, clusters?: unknown[]}} secim
 * @returns {{status: number, message: string, sebep: string}|null}
 */
function ocpProdRestartEngeli(req, secim) {
  if (getRequestRole(req) === 'Admin') return null;
  const { uretim, sebep } = uretimSecimi(secim);
  if (!uretim) return null;
  return { status: 403, message: MESAJ, sebep };
}

module.exports = { ocpProdRestartEngeli, uretimSecimi, uretimEtiketi, MESAJ };
