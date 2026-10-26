// IN-PLACE, kayit ayrintisi (2026-10-26). Kullanici: "Isi baslattiktan sonra sonucta yine her sey yolunda mi
// diye bir kontrol etmesi icin yonlendirme yapabiliriz. Hicbir sey engellemesin ama insanlar yine de bilincinde olsun."
//   IPR1 kayittaki isaret (boolean) oncelikli; eski kayitta (null / alan yok) bugunku kesif; kesif yok / dustu -> bilinmiyor
//   IPR2 asama: stopping / rolling_back / deleting suruyor, stopped durdu, deleted silindi, active geriAlindi,
//        rollback_failed ve (sunucuda is kosmus) failed hata; basarisiz ON KONTROL (hicbir sey degismedi) yok; notlar, maddeler
//   IPR5 (denetim B1) diger kurulum da bu kayitta (atlanmamis) hedefse "hala calisiyor mu" DENMEZ; kismi ise yalniz digeri
//   IPR3 InPlaceKontrol: diger kurulumun JVM'i (Server Hub), /vhosting8 paketi, vhost trafigi, adres; isaret kutusu / dugme YOK
//   IPR4 ayrinti satiri: Akis panelinde kontrol listesi yalniz in-place + asama varsa; "İş çıktısı" sekmesi alan yoksa yok; ok tuslari
//        yalniz sekmelerde (tablist YALNIZ sekmeleri sarar - denetim B7); panel odaklanabilir
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { RtRecord, RtTarget, RtTargetStatus } from '@/api/retirementApi';
import { InPlaceKontrol, inPlaceAsamasi, inPlaceBilgisi, inPlaceHaritasi, inPlaceKontrolMaddeleri, inPlaceSatirNotu, kayittakiDigerleri, kurulumKoku } from '@/components/server_hub/RetirementInPlace';
import RetirementHedefAyrinti from '@/components/server_hub/RetirementHedefAyrinti';

const hedef = (status: RtTargetStatus, o: Partial<RtTarget> = {}): RtTarget => ({
  id: 3, recordId: 1, host: 'GBJEXP05', site: 'Pendik', env: 'PROD', appName: 'GBPOSWEBAPI', gen: 7, appPath: '/vhosting/GBPOSWEBAPI.ear',
  web: [], status, planText: null, resultText: 'OK — durduruldu', lastJobId: 10, deleteJobId: null, stoppedAt: '2026-10-26T10:00:00Z', updatedAt: '2026-10-26T10:00:00Z',
  deletedAt: null, rolledBackAt: null, rollbackJobId: null, scheduledAt: null, windowEnd: null, webSonuc: null, detail: null, ...o,
});
const kayit = (t: RtTarget): RtRecord => ({
  id: 1, app: 'GBPOSWEBAPI', smartNo: '364244', ocoNo: null, ownerEmail: null, requestedBy: 'u', status: 'stopped', deleteAfterDays: 45, plannedDeleteAt: null,
  stopAt: null, dnsReuse: false, lbReuse: false, sccNotifiedAt: null, notes: null, createdAt: '2026-10-20T10:00:00Z', updatedAt: '2026-10-26T10:00:00Z',
  effectiveDeleteAt: '2026-12-10', targets: [t], events: [],
});
const kesif = { ok: true, targets: [
  { host: 'gbjexp05', appName: 'gbposwebapi', gen: 7, inPlace: true, digerSurumler: [8] },
  { host: 'GBJEXP05', appName: 'GBPOSWEBAPI', gen: 8, inPlace: true, digerSurumler: [7] },
  { host: 'GBJEXP06', appName: 'GBPOSWEBAPI', gen: 7 },
] };

describe('in-place kayit ayrintisi', () => {
  it('IPR1 kayit isareti oncelikli; eski kayitta kesif; kesif yoksa bilinmiyor', () => {
    const h = inPlaceHaritasi(kesif);
    const b = (inPlace: boolean | null, digerSurumler: number[] | null, kaynak: 'kayit' | 'kesif' | null) => ({ inPlace, digerSurumler, kaynak, kayitta: [] });
    expect(inPlaceBilgisi({ ...hedef('stopped'), inPlace: false, digerSurumler: [] }, h)).toEqual(b(false, [], 'kayit'));
    expect(inPlaceBilgisi({ ...hedef('stopped'), inPlace: true, digerSurumler: [8] }, null)).toEqual(b(true, [8], 'kayit'));
    expect(inPlaceBilgisi({ ...hedef('stopped'), inPlace: null }, h)).toEqual(b(true, [8], 'kesif'));
    expect(inPlaceBilgisi(hedef('stopped'), h)).toEqual(b(true, [8], 'kesif'));
    expect(inPlaceBilgisi({ ...hedef('stopped'), host: 'GBJEXP06', inPlace: null }, h)).toEqual(b(false, [], 'kesif'));
    // Bugunku kesifte hedef yok (silinmis / paket .old) ya da kesif dustu: bilinmiyor, "yok" DEGIL.
    expect(inPlaceBilgisi({ ...hedef('stopped'), gen: 6, inPlace: null }, h)).toEqual(b(null, null, null));
    expect(inPlaceHaritasi({ ok: false, targets: [] })).toBeNull();
    expect(inPlaceHaritasi(null)).toBeNull();
    expect(inPlaceBilgisi({ ...hedef('stopped'), inPlace: null }, inPlaceHaritasi(null))).toEqual(b(null, null, null));
  });

  it('IPR2 asama, satir notu, maddeler', () => {
    expect((['stopping', 'rolling_back', 'deleting', 'stopped', 'deleted', 'active', 'rollback_failed', 'pending', 'planning', 'planned', 'stop_scheduled', 'skipped', 'failed'] as RtTargetStatus[]).map((s) => inPlaceAsamasi({ status: s })))
      .toEqual(['suruyor', 'suruyor', 'suruyor', 'durdu', 'silindi', 'geriAlindi', 'hata', null, null, null, null, null, null]);
    expect(inPlaceAsamasi({ status: 'stopped', deletedAt: '2026-11-01T00:00:00Z' })).toBe('silindi');
    // failed: yalniz sunucuda is kostuysa (onayli STOP: web adimi kuyruga girdi ya da STOP / silme isi var).
    expect(inPlaceAsamasi({ status: 'failed', webSonuc: [{ status: 'ok' }] })).toBe('hata');
    expect(inPlaceAsamasi({ status: 'failed', awxIsleri: [{ adim: 'onkontrol' }, { adim: 'stop' }] })).toBe('hata');
    expect(inPlaceAsamasi({ status: 'failed', awxIsleri: [{ adim: 'onkontrol' }] })).toBeNull();
    expect(inPlaceSatirNotu('suruyor', [8])).toBe('in-place: iş bitince diğer kurulumu (JBoss 8) kontrol edin');
    expect(inPlaceSatirNotu('silindi', [8])).toBe('in-place: silindi — diğer kurulumu (JBoss 8) kontrol edin');
    expect(inPlaceSatirNotu('hata', [8])).toBe('in-place: iş başarısız — diğer kurulumu (JBoss 8) kontrol edin');
    expect(inPlaceKontrolMaddeleri('silindi', [8])[1]).toMatch(/\/vhosting8 altında\) yerinde mi — silinmemiş olmalı/);
    expect(inPlaceKontrolMaddeleri('hata', [8])[0]).toMatch(/İş çıktısında inceleyin/);
    expect(inPlaceSatirNotu('durdu', [8])).toBe('in-place: diğer kurulumu (JBoss 8) kontrol edin');
    expect(inPlaceSatirNotu('geriAlindi', [8])).toMatch(/geri alındı — bu kurulumu ve diğer kurulumu \(JBoss 8\)/);
    expect([kurulumKoku(7), kurulumKoku(8), kurulumKoku(0), kurulumKoku(null)]).toEqual(['/vhosting', '/vhosting8', null, null]);
    const m = inPlaceKontrolMaddeleri('durdu', [8]);
    expect(m).toHaveLength(4);
    expect(m[0]).toMatch(/JVM’i \(JBoss 8\) hâlâ çalışıyor mu — Server Hub/);
    expect(m[1]).toMatch(/\/vhosting8 altında/);
    expect(m[2]).toMatch(/vhost’u trafik almaya devam ediyor mu/);
    expect(m[3]).toMatch(/adresi açılıyor mu/);
    expect(inPlaceKontrolMaddeleri('durdu', [0])[1]).toMatch(/kendi kökünde/);
    expect(inPlaceKontrolMaddeleri('geriAlindi', [8])).toHaveLength(5);
  });

  it('IPR3 kontrol listesi yalniz yonlendirme: kutu / dugme yok', () => {
    const { container } = render(<InPlaceKontrol asama="durdu" diger={[8]} kaynak="kesif" />);
    expect(container.querySelectorAll('[data-rt-inplace-kontrol] li')).toHaveLength(4);
    expect(container).toHaveTextContent('In-place: her şey yolunda mı? Diğer kurulumu kontrol edin');
    expect(container).toHaveTextContent('işaretlemeniz gerekmez, hiçbir adımı engellemez');
    expect(container).toHaveTextContent('bugünkü keşiften hesaplandı');
    expect(container.querySelector('input, button, [role="alert"]')).toBeNull();
  });

  it('IPR4 ayrinti satiri: kontrol listesi, sekmeler', () => {
    const t = hedef('stopped', { awxIsleri: [] });
    const onSekme = vi.fn();
    const ortak = { rec: kayit(t), onSekme, onKapat: () => {}, onIsBitti: () => {} };
    const { rerender } = render(<RetirementHedefAyrinti {...ortak} t={t} sekme="akis" inPlace={{ inPlace: true, digerSurumler: [8], kaynak: 'kayit' }} />);
    expect(screen.getByText(/Diğer kurulumu kontrol edin/)).toBeTruthy();
    expect(document.querySelectorAll('[data-rt-inplace-kontrol] li')).toHaveLength(4);
    expect(screen.getAllByRole('tab').map((x) => x.textContent)).toEqual(['Akış', 'İş çıktısı']);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Akış' }), { key: 'ArrowRight' });
    expect(onSekme).toHaveBeenCalledWith('cikti');
    // in-place degil / bilinmiyor: liste yok.
    for (const ip of [{ inPlace: false, digerSurumler: [], kaynak: 'kayit' as const }, { inPlace: null, digerSurumler: null, kaynak: null }]) {
      rerender(<RetirementHedefAyrinti {...ortak} t={t} sekme="akis" inPlace={ip} />);
      expect(document.querySelector('[data-rt-inplace-kontrol]')).toBeNull();
    }
    // Pending hedefte (is baslamadi) liste yok.
    rerender(<RetirementHedefAyrinti {...ortak} t={hedef('pending', { awxIsleri: [] })} sekme="akis" inPlace={{ inPlace: true, digerSurumler: [8], kaynak: 'kayit' }} />);
    expect(document.querySelector('[data-rt-inplace-kontrol]')).toBeNull();
    // Silinmis hedefte de kontrol listesi (geri alinamaz adimdan sonra diger kurulumun paketi duruyor mu).
    rerender(<RetirementHedefAyrinti {...ortak} t={hedef('deleted', { awxIsleri: [], deletedAt: '2026-11-01T00:00:00Z' })} sekme="akis" inPlace={{ inPlace: true, digerSurumler: [8], kaynak: 'kayit' }} />);
    expect(screen.getByText('In-place: silme sonrası diğer kurulumu kontrol edin')).toBeTruthy();
    // ARIA: tablist YALNIZ sekmeleri sarar; kapat dugmesinde ok tusu sekme degistirmez; panel odaklanabilir.
    rerender(<RetirementHedefAyrinti {...ortak} t={t} sekme="akis" />);
    const tl = screen.getByRole('tablist');
    expect([...tl.children].map((x) => x.getAttribute('role'))).toEqual(['tab', 'tab']);
    onSekme.mockClear();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Ayrıntıyı kapat' }), { key: 'ArrowRight' });
    expect(onSekme).not.toHaveBeenCalled();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '0');
    // Eski sunucu (awxIsleri alani yok): "İş çıktısı" sekmesi yok.
    rerender(<RetirementHedefAyrinti {...ortak} t={hedef('stopped')} sekme="cikti" />);
    expect(screen.getAllByRole('tab').map((x) => x.textContent)).toEqual(['Akış']);
    expect(screen.getByRole('tab', { name: 'Akış' })).toHaveAttribute('aria-selected', 'true');
  });

  it('IPR5 diger kurulum da bu kayitta hedefse "hala calisiyor mu" denmez; kismi ise yalniz digeri icin', () => {
    const j7 = { ...hedef('stopped'), id: 1 };
    const j8 = { ...hedef('stopping'), id: 2, gen: 8 };
    const atlandi = { ...j8, status: 'skipped' as RtTargetStatus };
    expect(kayittakiDigerleri(j7, [j7, j8], [8])).toEqual([8]);
    expect(kayittakiDigerleri(j7, [j7, atlandi], [8])).toEqual([]);
    expect(kayittakiDigerleri(j7, [j7, { ...j8, host: 'GBJEXP06' }], [8])).toEqual([]);
    expect(inPlaceBilgisi({ ...j7, inPlace: true, digerSurumler: [8] }, null, [j7, j8]).kayitta).toEqual([8]);
    expect(inPlaceSatirNotu('durdu', [8], [8])).toBe('in-place: diğer kurulum (JBoss 8) da bu kayıtta hedef — onun satırını izleyin');
    expect(inPlaceSatirNotu('geriAlindi', [8], [8])).toMatch(/bu kayıtta hedef — bu kurulumu kontrol edin$/);
    const m = inPlaceKontrolMaddeleri('durdu', [8], [8]);
    expect(m.join(' ')).not.toMatch(/hâlâ çalışıyor mu/);
    expect(m[0]).toMatch(/da bu kayıtta hedef: o da durdurulacak — çalışmaya devam etmesi beklenmez/);
    expect(m[1]).toMatch(/‘elle’ vhost’lar otomatik kapatılmaz/);
    // Kismi: 0 (surumu bilinmeyen) kayitta degil, 8 kayitta -> calisirlik yalniz digeri icin + "8 de hedef" maddesi.
    const k = inPlaceKontrolMaddeleri('durdu', [0, 8], [8]);
    expect(k[0]).toMatch(/JVM’i \(sürümü bilinmeyen kurulum\) hâlâ çalışıyor mu/);
    expect(k[k.length - 1]).toBe('JBoss 8 de bu kayıtta hedef: o da durdurulacak');
    const { container } = render(<InPlaceKontrol asama="durdu" diger={[8]} kayitta={[8]} />);
    expect(container).toHaveTextContent('In-place: diğer kurulum da bu kayıtta hedef');
  });
});
