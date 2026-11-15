// server/util/siralama.cjs — Array.prototype.sort'un VARSAYILAN sirasini birebir veren karsilastirici.
//
// NEDEN (2026-11-15): SonarQube S2871 karsilastiricisiz `.sort()`u bug sayar (sayilari alfabetik
// siralar). Karsilastirici eklemek sirayi DEGISTIRMEMELI: plan ozeti (ss-tasima kararliJson),
// onbellek anahtarlari, "ilk oge" secimleri ve ekranlardaki alisilmis sira varsayilana dayaniyor.
// `localeCompare` sirayi degistirir ve surecin yerel ayarina baglidir; `a - b` sayi olmayanda NaN
// verir.
//
// Varsayilan sira: degerler String()'e cevrilip UTF-16 kod birimiyle karsilastirilir; `undefined`
// her zaman sona gider (karsilastirici onlar icin hic cagrilmaz). Bu islev ayni sonucu verir.
// Sayi dizisinde sayisal sira isteniyorsa `(a, b) => a - b` bilerek yazilir.
'use strict';

function varsayilanSira(a, b) {
  const x = String(a);
  const y = String(b);
  if (x < y) return -1;
  return x > y ? 1 : 0;
}

module.exports = { varsayilanSira };
