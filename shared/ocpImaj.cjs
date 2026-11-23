// shared/ocpImaj.cjs - OpenShift container imaj adresini parcalarina ayirir (2026-11-23).
//
// Kullanan: server/spa-report/paket-kurulum.cjs (Intranet SPA paket kurulumu: paket surumu = imaj etiketi,
// paket yolu = <namespace>/<uygulama>) ve ekranda src/components/app_hub/ocpKarsilastir.ts imajSurumu
// (Application Hub gorunen surum). Iki taraf bu tek ayristiriciyi kullanir.
//
// Bicim: [<registry>[:port]/]<yol...>/<namespace>/<uygulama>[:<etiket>][@<alg>:<ozet>]
//   * registry ilk parcadir yalniz '.' ya da ':' iceriyorsa ya da 'localhost' ise (Docker kurali).
//   * etiket SON parcadaki ':' sonrasidir (registry portu etiket sayilmaz); bos etiket ('app:') null.
//   * digest '@' sonrasidir; digest'li imajin etiketi olsa bile kosan surum etikete guvenilerek okunmaz
//     (cagiran karar verir: digest alani dolu doner).
'use strict';

const BOS = Object.freeze({
  yol: null,
  registry: null,
  namespace: null,
  uygulama: null,
  etiket: null,
  digest: null,
});

function registryMi(parca) {
  return parca.includes('.') || parca.includes(':') || parca === 'localhost';
}

/** '@' ile digest'i ayirir. */
function digestAyir(s) {
  const at = s.indexOf('@');
  if (at < 0) return { govde: s, digest: null };
  return { govde: s.slice(0, at), digest: s.slice(at + 1) || null };
}

/** Son parcadan etiketi ayirir. */
function etiketAyir(son) {
  const ik = son.lastIndexOf(':');
  if (ik < 0) return { ad: son, etiket: null };
  return { ad: son.slice(0, ik), etiket: son.slice(ik + 1) || null };
}

/**
 * @param {string|null|undefined} imaj
 * @returns {{yol: string|null, registry: string|null, namespace: string|null, uygulama: string|null,
 *            etiket: string|null, digest: string|null}}
 */
function imajCoz(imaj) {
  const s = String(imaj == null ? '' : imaj).trim();
  if (!s || /\s/.test(s)) return { ...BOS };
  const { govde, digest } = digestAyir(s);
  const parcalar = govde.split('/');
  const registry = parcalar.length > 1 && registryMi(parcalar[0]) ? parcalar.shift() : null;
  if (parcalar.some((p) => !p)) return { ...BOS, digest };
  const { ad, etiket } = etiketAyir(parcalar.pop());
  if (!ad) return { ...BOS, digest };
  parcalar.push(ad);
  const namespace = parcalar.length > 1 ? parcalar[parcalar.length - 2] : null;
  return {
    yol: parcalar.join('/'),
    registry,
    namespace,
    uygulama: ad,
    etiket,
    digest,
  };
}

module.exports = { imajCoz };
