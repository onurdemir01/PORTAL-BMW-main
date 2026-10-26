// Retirement hedef satirinin saf yardimcilari (2026-10-26, tablo yeniden tasarimi).
//   RS1 sonrakiAdim 13 durumun hepsinde anlamli metin (yedek "Durum: x" metnine dusmez)
//   RS2 ton tablosu: failed / planned / pending / rollback_failed aksan; yarim STOP, iptal, silme bugun uyari
//   RS4 webSonuclari buyuk/kucuk harften bagimsiz eslesir ve OZGUN sirayi dondurur (is ciktisi `web` parametresi)
//   RS5 gecisAdimi / hedefteCanliIs
//   RS6 (denetim D1-2) satir metni birincil eylemle CELISMEZ: "Retirement’ı başlat" dugmesi varken "işlem yapılmaz" denmez
// (RS3 sonucAyir: retirement-ui.test.tsx)
import { describe, it, expect } from 'vitest';
import type { RtTarget, RtTargetStatus, RtWeb2 } from '@/api/retirementApi';
import { gecisAdimi, hedefteCanliIs, sonrakiAdim, webSonuclari, type SatirBaglami } from '@/components/server_hub/retirementSatir';
import { retirementAdimi } from '@/components/server_hub/retirementAdim';

const hedef = (status: RtTargetStatus, o: Partial<RtTarget> = {}): RtTarget => ({
  id: 1, recordId: 1, host: 'GBJBOP01', site: 'Pendik', env: 'PROD', appName: 'CRM', gen: 7, appPath: '/vhosting/CRM.ear',
  web: [], status, planText: null, resultText: null, lastJobId: null, deleteJobId: null, stoppedAt: null, updatedAt: '2026-10-26T10:00:00Z',
  deletedAt: null, rolledBackAt: null, rollbackJobId: null, scheduledAt: null, windowEnd: null, webSonuc: null, detail: null, ...o,
});
const web = (status: string, o: Partial<RtWeb2> = {}): RtWeb2 => ({ host: 'GBJBWP01', serverName: 'crm.bmw.de', product: 'IHS', confFile: 'mod-jk.conf', status, jobId: 5, message: null, ...o });
const k: SatirBaglami = { kayitKapali: false, kayitIptal: false, effectiveDeleteAt: '2026-11-10', saat: '23:00', bugun: new Date('2026-11-01T10:00:00Z') };
const TUM: RtTargetStatus[] = ['pending', 'planning', 'planned', 'stop_scheduled', 'stopping', 'stopped', 'deleting', 'deleted', 'rolling_back', 'active', 'rollback_failed', 'failed', 'skipped'];

describe('retirementSatir', () => {
  it('RS1 her durumda anlamli "sıradaki" metni', () => {
    for (const s of TUM) {
      const r = sonrakiAdim(hedef(s, { scheduledAt: '2026-11-02T20:00:00Z', deletedAt: s === 'deleted' ? '2026-11-03T21:00:00Z' : null, rolledBackAt: '2026-11-01T09:00:00Z' }), k);
      expect(r.metin.trim().length, s).toBeGreaterThan(5);
      expect(r.metin, s).not.toMatch(/^Durum: /);
    }
    expect(sonrakiAdim(hedef('stop_scheduled', { scheduledAt: '2026-11-02T20:00:00Z', windowEnd: '2026-11-02T23:00:00Z' }), k).metin).toMatch(/^STOP .+ – .+ OCO penceresinde başlar$/);
  });

  it('RS2 ton tablosu', () => {
    const t = (st: RtTargetStatus, o: Partial<RtTarget> = {}, kk: Partial<SatirBaglami> = {}) => sonrakiAdim(hedef(st, o), { ...k, ...kk });
    for (const s of ['failed', 'planned', 'pending', 'rollback_failed'] as RtTargetStatus[]) expect(t(s).ton, s).toBe('aksan');
    expect(t('failed').metin).toMatch(/İş çıktısında inceleyin/);
    // YARIM STOP: vhost kalkti ama JBoss durmadi.
    expect(t('failed', { webSonuc: [web('ok')] })).toEqual({ metin: expect.stringMatching(/vhost kaldırıldı ama JBoss durmadı/), ton: 'uyari' });
    expect(t('stopped', {}, { kayitIptal: true, kayitKapali: true })).toEqual({ metin: expect.stringMatching(/DURDURULMUŞ kaldı/), ton: 'uyari' });
    expect(t('stopped', { webSonuc: [web('failed')] })).toEqual({ metin: 'Sıradaki: web adımını yeniden deneyin', ton: 'aksan' });
    expect(t('stopped', { deleteNowAt: '2026-11-01T08:00:00Z' }).ton).toBe('uyari');
    expect(t('stopped', {}, { kayitAtladi: '2026-11-01T08:00:00Z' }).metin).toMatch(/^Silme sırada/);
    expect(t('stopped')).toEqual({ metin: expect.stringMatching(/ 23:00 · 9 gün kaldı$/), ton: 'notr' });
    expect(t('stopped', {}, { effectiveDeleteAt: '2026-11-01' })).toEqual({ metin: 'Silme BUGÜN 23:00', ton: 'uyari' });
    expect(t('stopped', {}, { effectiveDeleteAt: '2026-10-30' }).metin).toMatch(/^Silme günü geçti/);
    expect(t('stopped', {}, { effectiveDeleteAt: null }).metin).toBe('Silme tarihi yok');
    for (const s of ['planning', 'stopping', 'deleting', 'rolling_back', 'deleted', 'skipped', 'active'] as RtTargetStatus[]) expect(t(s).ton, s).toBe('notr');
    // Kayit kapaliyken baslat / onayla "sıradaki" denmez.
    expect(t('pending', {}, { kayitKapali: true })).toEqual({ metin: 'Kayıt kapalı · bu hedefte işlem yapılmaz', ton: 'notr' });
    // Atlanan hedef yeniden alinabilir (BASLATILABILIR): metin dugmeyi soyler; kayit kapaliyken dugme yok.
    expect(t('skipped').metin).toBe('Kayıttan çıkarıldı — işlem yapılmaz; yeniden almak için “Retirement’ı başlat”');
    expect(t('skipped', {}, { kayitKapali: true }).metin).toBe('Kayıttan çıkarıldı · işlem yapılmaz');
  });

  it('RS6 satir metni birincil eylemle celismez', () => {
    for (const kayitKapali of [false, true]) {
      for (const s of TUM) {
        const adim = retirementAdimi(s, kayitKapali);
        const metin = sonrakiAdim(hedef(s, { scheduledAt: '2026-11-02T20:00:00Z', rolledBackAt: '2026-11-01T09:00:00Z' }), { ...k, kayitKapali }).metin;
        if (adim.tur === 'baslat') expect(metin, `${s}/${kayitKapali}`).not.toMatch(/işlem yapılmaz$/);
        if (adim.tur === 'yok' && kayitKapali) expect(metin, `${s}/${kayitKapali}`).not.toMatch(/^Sıradaki: (Retirement’ı başlat|sonucu gör)/);
      }
    }
  });

  it('RS4 webSonuclari buyuk/kucuk harf duyarsiz, OZGUN sira', () => {
    const ws = [web('ok', { host: 'GBA' }), web('failed', { host: 'GBB', serverName: 'CRM.BMW.DE' }), web('skip', { host: ' gba', serverName: ' CRM.bmw.de ' })];
    expect(webSonuclari(ws, 'gba', 'crm.BMW.de').map((x) => x.i)).toEqual([0, 2]);
    expect(webSonuclari(ws, 'GBB', 'crm.bmw.de').map((x) => [x.i, x.w.status])).toEqual([[1, 'failed']]);
    expect(webSonuclari(null, 'GBA', 'x')).toEqual([]);
  });

  it('RS5 gecisAdimi ve hedefteCanliIs', () => {
    expect(['planning', 'stopping', 'deleting', 'rolling_back', 'stopped'].map(gecisAdimi)).toEqual(['onkontrol', 'stop', 'delete', 'rollback', undefined]);
    const is = (durum: 'suruyor' | 'basarili') => ({ adim: 'stop' as const, jobId: 1, durum, basladi: null, bitti: null });
    expect(hedefteCanliIs({ awxIsleri: [is('basarili'), is('suruyor')] })).toBe(true);
    expect(hedefteCanliIs({ awxIsleri: [is('basarili')] })).toBe(false);
    expect(hedefteCanliIs({})).toBe(false);
  });
});
