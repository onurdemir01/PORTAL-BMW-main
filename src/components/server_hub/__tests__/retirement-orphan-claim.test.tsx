// Retirement gecis claim'i var ama job kimligi yoksa is "calisiyor" diye sunulamaz.
import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/test/test-utils';
import type { RtTarget } from '@/api/retirementApi';
import RetirementCanli, {
  hedefAktif,
  hedefTazelenmeli,
  orphanUzlastirilabilir,
} from '../RetirementCanli';

const hedef = (status: RtTarget['status'], overrides: Partial<RtTarget> = {}): RtTarget => ({
  id: 7,
  recordId: 3,
  host: 'GBJBOP01',
  site: 'Pendik',
  env: 'PROD',
  appName: 'CRM',
  gen: 7,
  appPath: '/hysdeploy/CRM.ear',
  web: [],
  status,
  planText: null,
  resultText: null,
  lastJobId: null,
  deleteJobId: null,
  rollbackJobId: null,
  stoppedAt: null,
  updatedAt: '2026-10-10T10:00:00Z',
  deletedAt: null,
  rolledBackAt: null,
  scheduledAt: null,
  windowEnd: null,
  webSonuc: null,
  detail: null,
  ...overrides,
});

describe('Retirement orphan claim gorunurlugu', () => {
  test('RO1 DELETE claim var ama job ID yoksa calisiyor denmez; belirsizlik aciklanir', () => {
    render(<RetirementCanli targets={[hedef('deleting')]} />);
    expect(screen.getByRole('alert').textContent).toMatch(/başlangıç sonucu doğrulanamıyor/i);
    expect(screen.queryByText(/Silme.*çalışıyor/)).toBeNull();
    expect(screen.queryByText(/AWX işi başlatılıyor/i)).toBeNull();
    expect(screen.queryByRole('list', { name: /Silme adımları/i })).toBeNull();
  });

  test('RO2 DELETE job ID varsa is numarasi gosterilir; AWX durumu uydurulmaz', () => {
    render(<RetirementCanli targets={[hedef('deleting', { deleteJobId: 77 })]} />);
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === 'SPAN' && /Silme.*iş #77.*AWX durumu okunuyor/.test(el.textContent || ''),
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Silme.*çalışıyor/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('RO3 STOP claim var ama job ID yoksa ayni fail-closed uyari kullanilir', () => {
    render(<RetirementCanli targets={[hedef('stopping')]} />);
    expect(screen.getByRole('alert').textContent).toMatch(/otomatik yeniden başlatılmaz/i);
    expect(screen.queryByText(/JBoss STOP.*çalışıyor/)).toBeNull();
  });

  test('RO4 gecici ID boslugu spinner acmaz ama kayit yenilemesini durdurmaz', () => {
    const ilk = hedef('stopping');
    expect(hedefAktif(ilk)).toBe(false);
    expect(hedefTazelenmeli(ilk)).toBe(true);
    expect(hedefAktif(hedef('stopping', { lastJobId: 88 }))).toBe(true);
    expect(hedefTazelenmeli(hedef('stopped', { deleteNowAt: '2026-10-12T12:00:00Z' }))).toBe(true);
    expect(hedefTazelenmeli(hedef('stopped'), '2026-10-12T12:00:00Z')).toBe(true);
  });

  test('RO5 suren silme / geri alma on kontrolu canli tazeleme ister (hedef stopped kalir); biten istemez', () => {
    const ok = (durum: string) => ({ jobId: 5, at: null, durum, mesaj: null, onkontrol: [], kisaltildi: false, kaynak: null, kullanici: null, kullanildi: false, hazir: false, izinler: [] });
    expect(hedefTazelenmeli(hedef('stopped'))).toBe(false);
    expect(hedefTazelenmeli(hedef('stopped', { silmeOnKontrol: ok('running') }))).toBe(true);
    expect(hedefTazelenmeli(hedef('stopped', { geriAlOnKontrol: ok('baslatiliyor') }))).toBe(true);
    expect(hedefTazelenmeli(hedef('stopped', { geriAlOnKontrol: ok('ok'), silmeOnKontrol: ok('failed') }))).toBe(false);
  });

  test('RO6 uzlastirma yalniz gercek STOP/DELETE orphan claim icin sunulur', () => {
    expect(orphanUzlastirilabilir(hedef('stopping'))).toBe(true);
    expect(orphanUzlastirilabilir(hedef('deleting'))).toBe(true);
    expect(orphanUzlastirilabilir(hedef('planning'))).toBe(false);
    expect(orphanUzlastirilabilir(hedef('rolling_back'))).toBe(false);
  });
});
