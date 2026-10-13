// Retirement kayit listesi kolon filtreleri (2026-10-13): uygulama adi (ortam adlari dahil, '_'/'-'/bosluk
// duyarsiz), Smart, OCO, durum, ortam, acan kisi.
import { describe, it, expect } from 'vitest';
import { BOS_FILTRE, kayitFiltrele } from '../retirementFiltre';
import type { RtRecordRow } from '@/api/retirementApi';

const kayit = (o: Partial<RtRecordRow>): RtRecordRow => ({
  id: 1, app: 'X', smartNo: '1', ocoNo: null, ownerEmail: null, requestedBy: 'onur.demir', status: 'open', envs: [], targets: 1, stopped: 0,
  ...o,
} as unknown as RtRecordRow);
const ROWS = [
  kayit({ id: 1, app: 'GFY_INTERNET_SERVICES', smartNo: '23392995', ocoNo: '23359160', requestedBy: 'onur.demir', status: 'stopping',
    envs: [{ env: 'PROD', toplam: 2, durdurulan: 0, silinen: 0, uygulamalar: ['GFY_INTERNET_SERVICES'] }, { env: 'DEV', toplam: 2, durdurulan: 2, silinen: 1, uygulamalar: ['GFY_INTERNET_SERVICES-D'] }] }),
  kayit({ id: 2, app: 'CRM', smartNo: '111', requestedBy: 'Cansu Özgöz', status: 'deleted', envs: [{ env: 'QA', toplam: 1, durdurulan: 1, silinen: 1, uygulamalar: ['CRM-Q'] }] }),
];
const ids = (f: Partial<typeof BOS_FILTRE>) => kayitFiltrele(ROWS, { ...BOS_FILTRE, ...f }).map((r) => r.id);

describe('retirement kayit filtreleri', () => {
  it('bos filtre hepsini gosterir', () => expect(ids({})).toEqual([1, 2]));
  it("uygulama: buyuk/kucuk ve '_'/'-'/bosluk duyarsiz; ortam adlarinda da arar", () => {
    expect(ids({ app: 'gfy internet' })).toEqual([1]);
    expect(ids({ app: 'gfy-int' })).toEqual([1]);
    expect(ids({ app: 'crm-q' })).toEqual([2]);
  });
  it('acan kisi (Turkce harf)', () => expect(ids({ acan: 'özgöz' })).toEqual([2]));
  it('smart / oco / durum / ortam', () => {
    expect(ids({ smart: '2339' })).toEqual([1]);
    expect(ids({ oco: '23359160' })).toEqual([1]);
    expect(ids({ durum: 'deleted' })).toEqual([2]);
    expect(ids({ ortam: 'DEV' })).toEqual([1]);
  });
  it('filtreler VE ile birlesir', () => expect(ids({ app: 'gfy', acan: 'cansu' })).toEqual([]));
});
