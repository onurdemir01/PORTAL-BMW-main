// src/components/admin/tabs/sistem/kaydir.ts — Admin > Sistem: ogeye kaydirma.
//
// NEDEN scrollIntoView DEGIL (denetim 2026-10-15, gercek AppLayout icinde olculdu):
// scrollIntoView BUTUN kaydirma atalarini hizalar. AppLayout'un kok kabi `h-screen
// overflow-hidden` — kullanicinin kaydiramadigi ama programla kayabilen bir kap. "Gruba git"
// koku 64px kaydirdi: arama cubugu masthead'in altinda kaldi, altta bos serit acildi ve
// kullanici geri donemedi. Burada YALNIZ en yakin kaydirilabilir ata (main) kaydirilir.
//
// Yapiskan arama cubugu hedefin ustunu ortmesin diye cubugun yuksekligi + 8px pay birakilir
// (sabit `scroll-mt-*` cubuk sarinca yetmiyordu: 128px pay, 130.6px cubuk).
const PAY = 8;

/** En yakin dikey kaydirilabilir ata (overflow-y auto/scroll); yoksa null (sayfa kayar). */
export function kaydirmaKabi(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = window.getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll') return p;
  }
  return null;
}

export function ogeyeKaydir(el: HTMLElement, ustCubuk: HTMLElement | null, hareketAzalt: boolean) {
  const davranis: ScrollBehavior = hareketAzalt ? 'auto' : 'smooth';
  const pay = (ustCubuk?.getBoundingClientRect().height ?? 0) + PAY;
  const kap = kaydirmaKabi(el);
  if (kap) {
    const hedef = kap.scrollTop + el.getBoundingClientRect().top - kap.getBoundingClientRect().top - pay;
    kap.scrollTo?.({ top: Math.max(0, hedef), behavior: davranis });
    return;
  }
  const hedef = window.scrollY + el.getBoundingClientRect().top - pay;
  window.scrollTo?.({ top: Math.max(0, hedef), behavior: davranis });
}
