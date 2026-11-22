// shared/nginxApiClusters.cjs — API gateway sunucu kümeleri ve kapsam hesabı.
//
// NEDEN PAYLAŞILAN DOSYA: "bu API hangi sunucularda var, hangilerinde yok?" sorusunu
// geliştiriciler Nginx Hub > API Envanteri > API Bazlı ekranından soruyor (kullanıcı,
// 2026-09-23). Listeler kurum tanımıdır ve `bmw_nginx/api_generator` playbook'undaki
// production sunucu listesiyle aynı olmalıdır; tek bir yerde durması, ekran ile job'ın
// birbirinden ayrışmasını önler. Saf fonksiyon olduğu için node ile doğrudan test edilir.
//
// Burada YALNIZCA production gateway kümeleri vardır; dev/test/qa sunucuları ekranda
// zaten ortam kırılımında görünür.
'use strict';

// SUNUCU ADLARI BURADA DEGIL (2026-11-20, kalite kapisi K17): kumelerin sunuculari kurum ayarindadir
// (`nginx.apiKumeleri` {<kanal>: [SUNUCU]}, `nginx.apiGeneratorNonprod` {DEV|TEST|QA: [SUNUCU]}); kume
// listesini sunucularla birlikte server/audit/nginx-api-kumeleri.cjs kurar. Bu dosya ekranla paylasilan
// kisimdir (kanal kimligi + etiket); ekran yalniz etiketleri kullanir.

/** @typedef {{ key: string, label: string }} ApiClusterTanimi */

/** @type {ReadonlyArray<ApiClusterTanimi>} */
const API_CLUSTERS = Object.freeze([
  Object.freeze({ key: 'mblcustomers', label: 'mblcustomers' }),
  Object.freeze({ key: 'customers', label: 'customers' }),
  Object.freeze({ key: 'mcustomers', label: 'mcustomers' }),
]);

module.exports = { API_CLUSTERS };
