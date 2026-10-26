// Retirement "İş çıktısı" (2026-10-26). Kullanici: "is ciktisini gormek icin bir buton koy".
//   IC1  URL tam: /api/retirement/5/targets/9/is-ciktisi?adim=stop (web ile &web=2); jobId / serverId YOK
//   IC2  yoklamaGecikmesi: uzadi 1500; uzamadi ya da kuyrukta 3000
//   IC3  bitti gelince istek durur; onBitti yalniz canli gorulmusse ve BIR kez; bitmis is onbellekten (istek yok)
//   IC4  409 kalici -> durur, mesaj ekranda (terminal yerine)
//   IC5  gecici hata: 3, 6, 12, 24, 30 sn geri cekilme; 6. hatada durur, "Yeniden dene"
//   IC6  sekme gizliyken istek yok; visibilitychange ile hemen istek
//   IC7  arsiv cipi ve bandi; terminal "arşiv · durum bilinmiyor"
//   IC8  kirpildi bandi
//   IC9  is degisti bandi + onBitti
//   IC10 ciktiSonucu siniflamasi (409 kalici, 424 gecici, firlatilan 403 kalici, gecit / TypeError gecici, Abort yok sayilir)
//   IC11 hataOzeti (fatal / FAILED! / ERROR! / FAIL / recap failed=1; failed=0 ve RETRYING secilmez; en cok 6)
//   IC12 varsayilanIs onceligi; isEtiketi (geri acma yalniz restoring / restored)
//   IC13 Modal icinde Buyut katmani: Esc yalniz katmani kapatir (Modal onClose CAGRILMAZ), odak geri doner
//   IC14 AnsibleLogTerminal: autoScroll verilmeyince yeni ciktida sona iner; false iken inmez; true'ya donunce iner
//   IC15 RetirementCanli "çıktıyı izle": yalniz onCikti + O ADIMIN isi listedeyse; span metni degismez; web ozgun sira
//   IC16 (denetim B2) Buyut katmaninda odak tuzagi: Tab / Shift+Tab katmanda doner, Modal'in tuzagi odagi arkaya tasimaz
//   IC17 (denetim B3) Buyut acikken "Hata özeti" (role=alert) TEK kez
//   IC18 (M33) "Takibi durdur" terminale bagli: durunca yeni ciktida sona inmez, "Sona git" ile iner
//   IC19 (M40) listede "AWX kapalı" isareti; IC20 (denetim D1-1) istenen is listede yoksa bant (sessizce baska is degil)
//   IC21 (denetim B17) yukleniyor iskeletinde ekran okuyucu metni; "● canlı" sembolu okunmaz
// Korluk: gorsel yerlesim (yukseklik, yapiskan baslik) jsdom'da olculmez (sartname §11).
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { retirementApi, type RtHedefIs, type RtIsCiktisi, type RtTarget } from '@/api/retirementApi';
import { IsGoruntuleyici, type CiktiOnbellegi } from '@/components/server_hub/RetirementIsCiktisi';
import { ciktiSonucu, geriCekilme, hataOzeti, ipucuEslesir, isEtiketi, kaliciMesaj, sureMetni, varsayilanIs, yoklamaGecikmesi } from '@/components/server_hub/retirementCikti';
import RetirementIsCiktisi from '@/components/server_hub/RetirementIsCiktisi';
import AnsibleLogTerminal from '@/components/common/AnsibleLogTerminal';
import { Modal } from '@/components/common/Modal';
import RetirementCanli from '@/components/server_hub/RetirementCanli';

const hedef = (o: Partial<RtTarget> = {}): RtTarget => ({
  id: 9, recordId: 5, host: 'GBJBOP01', site: 'Pendik', env: 'PROD', appName: 'CRM', gen: 7, appPath: '/vhosting/CRM.ear', web: [], status: 'stopping',
  planText: null, resultText: 'OK — durduruldu', lastJobId: 500, deleteJobId: null, stoppedAt: null, updatedAt: '2026-10-26T10:00:00Z', deletedAt: null,
  rolledBackAt: null, rollbackJobId: null, scheduledAt: null, windowEnd: null, webSonuc: null, detail: null, ...o,
});
const is = (o: Partial<RtHedefIs> = {}): RtHedefIs => ({ adim: 'stop', jobId: 500, durum: 'suruyor', basladi: '2026-10-26T10:00:00Z', bitti: null, ...o });
const veri = (o: Partial<RtIsCiktisi> = {}): RtIsCiktisi => ({
  ok: true, kaynak: 'awx', adim: 'stop', jobId: 500, awxServerId: 1, sunucuAdi: 'maestro', status: 'running', bitti: false, output: 'PLAY [x]',
  kirpildi: false, started: '2026-10-26T10:00:00Z', finished: null, elapsed: 3, awxUrl: 'https://awx1.test/#/jobs/playbook/500/output', ...o,
});
const isle = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const goster = (o: { t?: RtTarget; i?: RtHedefIs; onbellek?: CiktiOnbellegi; onIsBitti?: () => void } = {}) =>
  render(<IsGoruntuleyici kayitId={5} t={o.t ?? hedef()} is={o.i ?? is()} onbellek={o.onbellek ?? new Map()} onIsBitti={o.onIsBitti ?? (() => {})} />);

describe('Retirement is ciktisi — saf yardimcilar', () => {
  it('IC1 URL: yalniz kayit, hedef, adim (+web); jobId / serverId yok', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', f);
    try {
      await retirementApi.isCiktisi(5, 9, 'stop');
      await retirementApi.isCiktisi(5, 9, 'web', 2);
      const urls = f.mock.calls.map((c) => String((c as unknown[])[0]));
      expect(urls).toEqual(['/api/retirement/5/targets/9/is-ciktisi?adim=stop', '/api/retirement/5/targets/9/is-ciktisi?adim=web&web=2']);
      for (const u of urls) expect(u).not.toMatch(/jobId|serverId|job-status|\/\d+\/\d+\/is-ciktisi/);
    } finally { vi.unstubAllGlobals(); }
  });

  it('IC2 yoklama araligi', () => {
    expect(yoklamaGecikmesi(true, 'running')).toBe(1500);
    expect(yoklamaGecikmesi(false, 'running')).toBe(3000);
    for (const s of ['new', 'pending', 'waiting']) expect(yoklamaGecikmesi(true, s), s).toBe(3000);
    expect([1, 2, 3, 4, 5, 6].map(geriCekilme)).toEqual([3000, 6000, 12000, 24000, 30000, 30000]);
    expect([0, 59, 60, 61, 3599, 3600, 3725].map(sureMetni)).toEqual(['0 sn', '59 sn', '1 dk 00 sn', '1 dk 01 sn', '59 dk 59 sn', '1 sa 00 dk', '1 sa 02 dk']);
  });

  it('IC10 ciktiSonucu siniflamasi', () => {
    expect(ciktiSonucu(veri())).toBe('veri');
    expect(ciktiSonucu({ ok: false, code: 'is_yok', kalici: true, message: '', _httpStatus: 409 })).toBe('kalici');
    expect(ciktiSonucu({ ok: false, code: 'olculemedi', kalici: false, message: '', _httpStatus: 424 })).toBe('gecici');
    // Bayraksiz red (kapi / eski sunucu): HTTP kodu.
    expect(ciktiSonucu({ ok: false, _httpStatus: 403 })).toBe('kalici');
    expect(ciktiSonucu({ ok: false, _httpStatus: 500 })).toBe('gecici');
    expect(ciktiSonucu(Object.assign(new Error('yasak'), { status: 403 }))).toBe('kalici');
    expect(ciktiSonucu(Object.assign(new Error('oturum'), { status: 401 }))).toBe('kalici');
    expect(ciktiSonucu(Object.assign(new Error('yok'), { status: 404 }))).toBe('kalici');
    expect(ciktiSonucu(Object.assign(new Error('gecit'), { status: 503, gatewayUnavailable: true }))).toBe('gecici');
    expect(ciktiSonucu(Object.assign(new Error('5xx'), { status: 500 }))).toBe('gecici');
    expect(ciktiSonucu(new TypeError('Failed to fetch'))).toBe('gecici');
    expect(ciktiSonucu(Object.assign(new Error('iptal'), { name: 'AbortError' }))).toBe('iptal');
    expect(kaliciMesaj('template_uyusmuyor', '', { jobId: 77 })).toBe('AWX’teki #77 bu adımın playbook’u değil; çıktı gösterilmedi.');
    expect(kaliciMesaj('awx_server_missing', 'AWX sunucusu #1 (maestro) devre dışı bırakıldı.')).toBe('AWX sunucusu #1 (maestro) devre dışı bırakıldı. Bu işin çıktısı Portal arşivinde de yok.');
    expect(kaliciMesaj('is_yok', '', { gecis: true })).toMatch(/‘Durumu tazele’/);
    expect(kaliciMesaj('http_403')).toMatch(/yalnız Admin/);
  });

  it('IC11 hata ozeti', () => {
    const cikti = [
      'TASK [durdur] ***',
      'FAILED - RETRYING: [GBJBOP01]: bekle (3 retries left).',
      'fatal: [GBJBOP01]: FAILED! => {"msg": "x"}',
      'ERROR! the role was not found',
      'STEP\tstop\tFAIL\tJVM durmadi',
      'GBJBOP01 : ok=3 changed=0 unreachable=0 failed=0 skipped=0',
      'GBJBOP02 : ok=3 changed=0 unreachable=0 failed=1 skipped=0',
      'GBJBOP03 : ok=1 changed=0 unreachable=2 failed=0 skipped=0',
      'GBJBOP04 : ok=1 changed=0 unreachable=0 failed=10 skipped=0',
      'GBJBOP05 : ok=1 changed=0 unreachable=0 failed=3 skipped=0',
      'GBJBOP06 : ok=1 changed=0 unreachable=0 failed=4 skipped=0',
    ].join('\n');
    const o = hataOzeti(cikti);
    expect(o.map((x) => x.satir)).toEqual([3, 4, 5, 7, 8, 9]);
    expect(o[0].metin).toMatch(/^fatal: /);
    expect(hataOzeti('x : ok=1 failed=0 unreachable=0')).toEqual([]);
    expect(hataOzeti(`fatal: ${'a'.repeat(400)}`)[0].metin.length).toBe(301);
  });

  it('IC12 varsayilan secim ve etiket', () => {
    const l: RtHedefIs[] = [
      is({ adim: 'onkontrol', jobId: 1, durum: 'basarili' }), is({ adim: 'stop', jobId: 2, durum: 'basarisiz' }),
      is({ adim: 'web', web: 0, jobId: 3, durum: 'suruyor' }), is({ adim: 'web', web: 1, jobId: 4, durum: 'basarili' }),
    ];
    expect(varsayilanIs(l, { adim: 'web', web: 1 })?.jobId).toBe(4);
    expect(varsayilanIs(l, { adim: 'delete' })?.jobId).toBe(3);
    expect(varsayilanIs(l, { jobId: 2 })?.jobId).toBe(2);
    expect(varsayilanIs(l, {})?.jobId).toBe(3);
    expect(varsayilanIs(l.filter((x) => x.durum !== 'suruyor'))?.jobId).toBe(2);
    expect(varsayilanIs([is({ adim: 'onkontrol', jobId: 1, durum: 'basarili' }), is({ adim: 'stop', jobId: 2, durum: 'basarili' })])?.jobId).toBe(2);
    expect(varsayilanIs([])).toBeNull();
    const ws = [{ host: 'GBW', serverName: 'a.bmw.de', product: 'IHS', confFile: 'x', status: 'restoring', jobId: 9, message: null }, { host: 'GBW', serverName: 'b.bmw.de', product: 'IHS', confFile: 'x', status: 'restore_failed', jobId: 8, message: null }];
    expect(isEtiketi({ adim: 'web', web: 0 }, ws)).toEqual({ etiket: 'Web geri açma: a.bmw.de', ipucu: 'GBW' });
    expect(isEtiketi({ adim: 'web', web: 1 }, ws).etiket).toBe('Web: b.bmw.de');
    expect(isEtiketi({ adim: 'delete_onkontrol' }).etiket).toBe('Silme ön kontrolü');
  });
});

describe('Retirement is ciktisi — goruntuleyici ve yoklama', () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { vi.useFakeTimers(); spy = vi.spyOn(retirementApi, 'isCiktisi'); });
  afterEach(() => { spy.mockRestore(); vi.useRealTimers(); });

  it('IC3 bitince durur; onBitti canli gorulmusse BIR kez; bitmis is onbellekten', async () => {
    spy.mockResolvedValueOnce(veri({ output: 'a' })).mockResolvedValueOnce(veri({ output: 'ab' })).mockResolvedValue(veri({ output: 'abc', bitti: true, status: 'successful', finished: '2026-10-26T10:05:00Z' }));
    const onIsBitti = vi.fn();
    const onbellek: CiktiOnbellegi = new Map();
    const { unmount } = goster({ onbellek, onIsBitti });
    await isle(0);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toEqual([5, 9, 'stop', undefined, expect.any(AbortSignal)]);
    // Takip dugmesi (yalniz is surerken): acik secimle durur, yeniden acilir. aria-pressed YOK (degisen etiketle celisirdi).
    const takip = screen.getByRole('button', { name: 'Takibi durdur' });
    expect(takip).not.toHaveAttribute('aria-pressed');
    fireEvent.click(takip);
    expect(screen.getByRole('button', { name: 'Sona git · takip et' })).not.toHaveAttribute('aria-pressed');
    fireEvent.click(screen.getByRole('button', { name: 'Sona git · takip et' }));
    await isle(1499);
    expect(spy).toHaveBeenCalledTimes(1);
    await isle(1);
    expect(spy).toHaveBeenCalledTimes(2);
    await isle(1500);
    expect(spy).toHaveBeenCalledTimes(3);
    await isle(60000);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(onIsBitti).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/CRM işi #500 bitti: başarılı|JBoss STOP işi #500 bitti: başarılı/)).toBeTruthy();
    unmount();
    // Bitmis is onbellekte: yeniden acilinca istek yok, onBitti yok (canli gorulmedi).
    const ikinci = vi.fn();
    goster({ onbellek, onIsBitti: ikinci });
    await isle(5000);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(ikinci).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('abc');
  });

  it('IC3b zaten bitmis is: tek istek, onBitti yok', async () => {
    spy.mockResolvedValue(veri({ bitti: true, status: 'failed', output: 'fatal: [h]: FAILED! => x', jobExplanation: 'Job failed' }));
    const onIsBitti = vi.fn();
    goster({ onIsBitti });
    await isle(0);
    await isle(30000);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(onIsBitti).not.toHaveBeenCalled();
    const ozet = screen.getByText('Hata özeti').closest('[role="alert"]') as HTMLElement;
    expect(ozet).toHaveTextContent('Job failed');
    expect(ozet).toHaveTextContent('fatal: [h]: FAILED! => x');
  });

  it('IC4 kalici ret: durur, mesaj terminal yerine', async () => {
    spy.mockResolvedValue({ ok: false, code: 'sunucu_belirsiz', kalici: true, message: 'x', _httpStatus: 409 });
    goster({ t: hedef({ resultText: 'FAIL — STOP dustu' }) });
    await isle(0);
    await isle(60000);
    expect(spy).toHaveBeenCalledTimes(1);
    const k = screen.getByRole('alert');
    expect(k).toHaveTextContent('aynı numaralı başka bir işi göstermemek için çıktı okunmadı');
    expect(k).toHaveTextContent('Portal’ın kaydettiği sonuç: FAIL — STOP dustu');
    expect(document.querySelector('pre')).toBeNull();
  });

  it('IC5 gecici hata: 3-6-12-24-30 sn, 6. hatada durur; Yeniden dene', async () => {
    spy.mockRejectedValue(new TypeError('Failed to fetch'));
    goster();
    await isle(0);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/AWX okunamadı — 3 sn sonra yeniden denenecek \(1\/6\)/)).toBeTruthy();
    let n = 1;
    for (const ms of [3000, 6000, 12000, 24000, 30000]) {
      await isle(ms - 1);
      expect(spy).toHaveBeenCalledTimes(n);
      await isle(1);
      n += 1;
      expect(spy).toHaveBeenCalledTimes(n);
    }
    await isle(120000);
    expect(spy).toHaveBeenCalledTimes(6);
    expect(screen.getByText(/otomatik deneme durdu \(6\/6\)/)).toBeTruthy();
    spy.mockResolvedValue(veri());
    fireEvent.click(screen.getByRole('button', { name: 'Yeniden dene' }));
    await isle(0);
    expect(spy).toHaveBeenCalledTimes(7);
    expect(screen.queryByText(/otomatik deneme durdu/)).toBeNull();
  });

  it('IC6 sekme gizliyken istek yok; gorunur olunca hemen', async () => {
    let gizli = true;
    const eski = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => gizli });
    try {
      spy.mockResolvedValue(veri());
      goster();
      await isle(10000);
      expect(spy).not.toHaveBeenCalled();
      expect(screen.getByText('sekme gizli — duraklatıldı')).toBeTruthy();
      gizli = false;
      document.dispatchEvent(new Event('visibilitychange'));
      await isle(0);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('sekme gizli — duraklatıldı')).toBeNull();
    } finally {
      delete (document as unknown as Record<string, unknown>).hidden;
      if (eski) Object.defineProperty(Document.prototype, 'hidden', eski);
    }
  });

  it('IC7 arsiv cipi, bandi ve terminal durumu', async () => {
    spy.mockResolvedValue(veri({ kaynak: 'arsiv', status: null, bitti: true, sunucuAdi: null, awxUrl: null, arsivTarihi: '2026-10-22T08:00:00.000Z', uyari: 'AWX sunucusu #1 (maestro) devre dışı bırakıldı. Portal arşivi gösteriliyor.' }));
    goster();
    await isle(0);
    expect(screen.getByText('arşivden')).toBeTruthy();
    expect(screen.getByText(/AWX sunucusu #1 \(maestro\) devre dışı bırakıldı\. Portal arşivi gösteriliyor\./)).toBeTruthy();
    expect(screen.getByText('arşiv · durum bilinmiyor')).toBeTruthy();
    expect(screen.queryByText('AWX’te aç ↗')).toBeNull();
  });

  it('IC8 kirpildi bandi', async () => {
    spy.mockResolvedValue(veri({ kirpildi: true, bitti: true, status: 'successful' }));
    goster();
    await isle(0);
    expect(screen.getByText(/Çıktı Portal sınırında kırpıldı/)).toBeTruthy();
  });

  it('IC9 is degisti bandi + onBitti', async () => {
    spy.mockResolvedValue(veri({ jobId: 600 }));
    const onIsBitti = vi.fn();
    goster({ onIsBitti });
    await isle(0);
    expect(screen.getByText(/Bu adımın işi değişti: #500 → #600/)).toBeTruthy();
    expect(onIsBitti).toHaveBeenCalledTimes(1);
    await isle(10000);
    expect(onIsBitti).toHaveBeenCalledTimes(1);
  });

  it('IC13 Modal icinde Buyut: Esc yalniz katmani kapatir; odak Buyut dugmesine doner', async () => {
    spy.mockResolvedValue(veri({ bitti: true, status: 'successful' }));
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Kayıt"><IsGoruntuleyici kayitId={5} t={hedef()} is={is()} onbellek={new Map()} onIsBitti={() => {}} /></Modal>);
    await isle(0);
    fireEvent.click(screen.getByRole('button', { name: /Büyüt/ }));
    const katman = screen.getByRole('dialog', { name: /İş çıktısı — JBoss STOP/ });
    const kapat = screen.getByRole('button', { name: 'Büyütmeyi kapat' });
    expect(document.activeElement).toBe(kapat);
    expect(katman).toContainElement(kapat);
    fireEvent.keyDown(kapat, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /İş çıktısı/ })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Büyüt/ }));
    // Katman kapaliyken Esc yine Modal'i kapatir (Modal dinleyicisi bozulmadi).
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Retirement is ciktisi — Buyut, takip, liste (denetim tur 2)', () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { vi.useFakeTimers(); spy = vi.spyOn(retirementApi, 'isCiktisi'); });
  afterEach(() => { spy.mockRestore(); vi.useRealTimers(); });

  it('IC16 Buyut katmaninda odak tuzagi: Tab katmanda doner, Modal kapanmaz', async () => {
    spy.mockResolvedValue(veri({ bitti: true, status: 'successful' }));
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Kayıt"><button type="button">Arkadaki düğme</button><IsGoruntuleyici kayitId={5} t={hedef()} is={is()} onbellek={new Map()} onIsBitti={() => {}} /><button type="button">Sondaki düğme</button></Modal>);
    await isle(0);
    fireEvent.click(screen.getByRole('button', { name: /Büyüt/ }));
    const katman = screen.getByRole('dialog', { name: /İş çıktısı — JBoss STOP/ });
    const odaklanabilir = [...katman.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
    expect(odaklanabilir.length).toBeGreaterThan(1);
    const ilk = odaklanabilir[0];
    const son = odaklanabilir[odaklanabilir.length - 1];
    son.focus();
    fireEvent.keyDown(son, { key: 'Tab' });
    expect(document.activeElement).toBe(ilk);
    fireEvent.keyDown(ilk, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(son);
    // Odak bir sekilde disari ciktiysa Tab onu katmana geri alir.
    screen.getByRole('button', { name: 'Sondaki düğme' }).focus();
    fireEvent.keyDown(katman, { key: 'Tab' });
    expect(katman).toContainElement(document.activeElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('IC17 Buyut acikken Hata ozeti TEK kez (role=alert iki kez duyurulmaz)', async () => {
    spy.mockResolvedValue(veri({ bitti: true, status: 'failed', output: 'fatal: [h]: FAILED! => x' }));
    goster();
    await isle(0);
    expect(screen.getAllByText('Hata özeti')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Büyüt/ }));
    expect(screen.getAllByText('Hata özeti')).toHaveLength(1);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: /İş çıktısı/ })).toContainElement(screen.getByText('Hata özeti'));
  });

  it('IC18 takip dugmesi terminale bagli: durunca sona inmez, yeniden acinca iner', async () => {
    spy.mockResolvedValueOnce(veri({ output: 'a' })).mockResolvedValueOnce(veri({ output: 'ab' })).mockResolvedValue(veri({ output: 'abc' }));
    const { container } = goster();
    await isle(0);
    const el = container.querySelector('.overflow-auto') as HTMLDivElement;
    expect(el).toBeTruthy();
    let ust = 0;
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 500 });
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => ust, set: (v: number) => { ust = v; } });
    fireEvent.click(screen.getByRole('button', { name: 'Takibi durdur' }));
    await isle(1500);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(ust).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Sona git · takip et' }));
    expect(ust).toBe(500);
  });

  it('IC19 listede AWX kapali isareti; IC20 istenen is listede yoksa bant', async () => {
    spy.mockResolvedValue(veri({ bitti: true, status: 'successful' }));
    const t = hedef({ awxIsleri: [is({ adim: 'onkontrol', jobId: 400, durum: 'basarili', sunucuKapali: true })] });
    const { rerender } = render(<RetirementIsCiktisi kayitId={5} t={t} ipucu={{ adim: 'stop' }} onIsBitti={() => {}} />);
    await isle(0);
    const nav = screen.getByRole('navigation', { name: 'Bu hedefin AWX işleri' });
    expect(nav).toHaveTextContent('#400 · başarılı');
    expect(nav).toHaveTextContent('· AWX kapalı');
    expect(screen.getByText(/İstenen iş bu hedefin iş listesinde yok/)).toBeTruthy();
    rerender(<RetirementIsCiktisi kayitId={5} t={t} ipucu={{ adim: 'onkontrol' }} onIsBitti={() => {}} />);
    expect(screen.queryByText(/İstenen iş bu hedefin iş listesinde yok/)).toBeNull();
    rerender(<RetirementIsCiktisi kayitId={5} t={t} ipucu={{ jobId: 999 }} onIsBitti={() => {}} />);
    expect(screen.getByText(/İstenen iş bu hedefin iş listesinde yok/)).toBeTruthy();
    const l = [is({ adim: 'onkontrol', jobId: 1 }), is({ adim: 'web', web: 2, jobId: 3 })];
    expect([ipucuEslesir(l, undefined), ipucuEslesir(l, {}), ipucuEslesir(l, { adim: 'web', web: 2 }), ipucuEslesir(l, { adim: 'web', web: 0 }), ipucuEslesir(l, { jobId: 3 }), ipucuEslesir(l, { adim: 'stop' })])
      .toEqual([true, true, true, false, true, false]);
  });

  it('IC21 yukleniyor iskeletinde ekran okuyucu metni; canli sembolu okunmaz', async () => {
    spy.mockReturnValue(new Promise(() => {}));
    goster();
    await isle(0);
    expect(screen.getByText('İş çıktısı yükleniyor…')).toHaveClass('sr-only');
    spy.mockReset();
    spy.mockResolvedValue(veri());
    cleanup();
    goster();
    await isle(0);
    const canli = screen.getByText(/canlı · son okuma/);
    expect(canli.querySelector('[aria-hidden]')?.textContent).toBe('●');
  });
});

describe('RetirementCanli cikti baglantisi', () => {
  it('IC15 "çıktıyı izle" yalniz is listesi + onCikti ile; is #N span metni degismez (RO2); web girdisi ozgun sirayla', () => {
    const onCikti = vi.fn();
    const t = hedef({ status: 'stopping', lastJobId: 77, awxIsleri: [is(), is({ adim: 'web', web: 0, jobId: 91 }), is({ adim: 'web', web: 2, jobId: 92 })], webSonuc: [{ host: 'GBW', serverName: 'a.bmw.de', product: 'IHS', confFile: 'x', status: 'running', jobId: 91, message: null }, { host: 'GBW', serverName: 'b.bmw.de', product: 'IHS', confFile: 'y', status: 'pending', jobId: null, message: null }, { host: 'GBW', serverName: 'c.bmw.de', product: 'IHS', confFile: 'z', status: 'running', jobId: 92, message: null }] });
    const { rerender, container } = render(<RetirementCanli targets={[t]} onCikti={onCikti} />);
    // Canli bolge YALNIZ baslik (denetim B16): saniyede bir ilerleyen sure canli bolgede olsa ekran okuyucu her saniye konusurdu.
    const canliBolgeler = container.querySelectorAll('[aria-live]');
    expect(canliBolgeler).toHaveLength(1);
    expect(canliBolgeler[0]).toHaveTextContent(/^Çalışan ve sıradaki işler$/);
    const linkler = screen.getAllByRole('button', { name: 'çıktıyı izle' });
    expect(linkler).toHaveLength(3);
    fireEvent.click(linkler[0]);
    expect(onCikti).toHaveBeenLastCalledWith(9, { adim: 'stop' });
    fireEvent.click(linkler[1]);
    expect(onCikti).toHaveBeenLastCalledWith(9, { adim: 'web', web: 0 });
    fireEvent.click(linkler[2]);
    expect(onCikti).toHaveBeenLastCalledWith(9, { adim: 'web', web: 2 });
    // Span'in metni yalniz is bilgisi (baglanti kardes oge).
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && /JBoss STOP.*iş #77.*AWX durumu okunuyor/.test(el.textContent || '') && !/çıktıyı izle/.test(el.textContent || ''))).toBeTruthy();
    rerender(<RetirementCanli targets={[{ ...t, awxIsleri: undefined }]} onCikti={onCikti} />);
    expect(screen.queryByRole('button', { name: 'çıktıyı izle' })).toBeNull();
    // Listede o adimin isi yoksa baglanti YOK (baska bir isin ciktisini acardi): STOP yok, web 2 yok -> yalniz web 0.
    rerender(<RetirementCanli targets={[{ ...t, awxIsleri: [is({ adim: 'onkontrol', jobId: 76, durum: 'basarili' }), is({ adim: 'web', web: 0, jobId: 91 })] }]} onCikti={onCikti} />);
    const kalan = screen.getAllByRole('button', { name: 'çıktıyı izle' });
    expect(kalan).toHaveLength(1);
    fireEvent.click(kalan[0]);
    expect(onCikti).toHaveBeenLastCalledWith(9, { adim: 'web', web: 0 });
    rerender(<RetirementCanli targets={[t]} />);
    expect(screen.queryByRole('button', { name: 'çıktıyı izle' })).toBeNull();
  });
});

describe('AnsibleLogTerminal autoScroll', () => {
  it('IC14 varsayilan sona iner; false iken inmez; true olunca iner', () => {
    const { container, rerender } = render(<AnsibleLogTerminal output="a" status="running" />);
    const el = container.querySelector('.overflow-auto') as HTMLDivElement;
    let ust = 0;
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 500 });
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => ust, set: (v: number) => { ust = v; } });
    rerender(<AnsibleLogTerminal output="ab" status="running" />);
    expect(ust).toBe(500);
    ust = 0;
    rerender(<AnsibleLogTerminal output="abc" status="running" autoScroll={false} />);
    expect(ust).toBe(0);
    rerender(<AnsibleLogTerminal output="abc" status="running" autoScroll />);
    expect(ust).toBe(500);
    rerender(<AnsibleLogTerminal output="abc" status="arsiv" statusLabel="arşiv · durum bilinmiyor" />);
    expect(screen.getByText('arşiv · durum bilinmiyor')).toBeTruthy();
  });
});
