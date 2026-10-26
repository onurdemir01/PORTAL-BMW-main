// src/components/self_service/__tests__/ss-erisim.test.tsx — "Alanları Yönet" > Kimler
// kullanabilir? (2026-10-26). Kullanıcı: "bazı playbookları sadece bazı ekiplere açabilmek
// istiyoruz ... default olarak kullanıcılara kapalı gelsin ... tek bir ekip olmayabilir."
//   SEU1 mod kuralı sunucuyla aynı: eski kayıt + açık = herkes, kapalı, bilinmeyen = kapalı
//   SEU2 LDAP'tan seçilen grup DN olarak eklenir, çip CN gösterir, çıkarılabilir; seçili grup tekrar eklenmez
//   SEU3 arama düşerse "grup yok" denmez; Enter ile elle eklenir
//   SEU4 Kaydet erişimi YALNIZ değiştiyse yazar; değişince mod + gruplar gider, liste haberdar edilir
//   SEU5 "Seçili ekipler" + ekip yok -> hiçbir şey kaydedilmez, neden söylenir
//   SEU6 erişim yazılamazsa pencere açık kalır ve yarım kayıt söylenir
//   SEU7 Self Service dışı çağıran (ScaleX) bölümü görmez
//   SEU8 yeni servis KAPALI başlar; iki Self Service çağıranı da öğeyi pencereye verir (kaynak)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const api = vi.hoisted(() => ({
  choiceSources: vi.fn(),
  surveySpecAdmin: vi.fn(),
  getCustomization: vi.fn(),
  saveCustomization: vi.fn(),
  saveSsAccess: vi.fn(),
  customizationHistory: vi.fn(),
  smartMetadataPreview: vi.fn(),
  smartFlowMetadata: vi.fn(),
  restoreCustomization: vi.fn(),
}));
vi.mock('@/api/ansibleApi', () => ({ ansibleApi: api }));
// Pencere hatalari toast olarak cikar (FieldOverridesModal: kirmizi kutu gorunmuyordu).
const toastHata = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useToast', () => ({ toast: { error: toastHata, success: vi.fn(), info: vi.fn() } }));
import FieldOverridesModal from '../FieldOverridesModal';
import { SsErisimBolumu, ssErisimModu, grupEtiketi } from '../SsErisimBolumu';

const DN = 'CN=GT-Middleware,OU=Groups,DC=fw,DC=garanti,DC=com,DC=tr';
const SS = {
  id: 'ss-1',
  title: 'Nginx - RVP Operations',
  description: '',
  awxServerId: 2,
  awxTemplateId: 42,
  enabled: false,
  order: 1,
  accessMode: 'kapali' as const,
  accessGroups: [] as string[],
};

function Kontrollu(props: { ilk?: string[]; search?: Parameters<typeof SsErisimBolumu>[0]['search'] }) {
  const React = require('react') as typeof import('react');
  const [v, setV] = React.useState({ mode: 'ekipler' as const, groups: props.ilk || [] });
  return (
    <>
      <SsErisimBolumu mode={v.mode} groups={v.groups} onChange={setV as never} search={props.search} />
      <output data-testid="durum">{JSON.stringify(v)}</output>
    </>
  );
}

describe('Self Service erişimi', () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    toastHata.mockReset();
    api.choiceSources.mockResolvedValue({ ok: true, sources: [] });
    api.surveySpecAdmin.mockResolvedValue({ ok: true, fields: [], surveyEnabled: true, launchOptions: null, askVariables: false });
    api.getCustomization.mockResolvedValue({
      ok: true,
      customization: { fieldOverrides: [], rawExtraVars: '', launchOptionOverrides: {} },
    });
    api.saveCustomization.mockResolvedValue({ ok: true });
    api.saveSsAccess.mockResolvedValue({ ok: true, item: { ...SS, enabled: true, accessMode: 'herkes' } });
  });

  it('SEU1 mod kuralı sunucuyla aynı', () => {
    expect(ssErisimModu({ enabled: true, accessMode: null })).toBe('herkes');
    expect(ssErisimModu({ enabled: true })).toBe('herkes');
    expect(ssErisimModu({ enabled: false, accessMode: 'herkes' })).toBe('kapali');
    expect(ssErisimModu({ enabled: true, accessMode: 'ekipler' })).toBe('ekipler');
    expect(ssErisimModu({ enabled: true, accessMode: 'tuhaf' as never })).toBe('kapali');
    expect(grupEtiketi(DN)).toBe('GT-Middleware');
    expect(grupEtiketi('GT-Network')).toBe('GT-Network');
  });

  it('SEU2 LDAP tan seçilen grup DN olarak eklenir, çip CN gösterir, çıkarılabilir', async () => {
    vi.useFakeTimers();
    try {
      const search = vi.fn().mockResolvedValue({ groups: [{ dn: DN, cn: 'GT-Middleware', description: 'Middleware ekibi' }] });
      render(<Kontrollu search={search} />);
      fireEvent.change(screen.getByLabelText('LDAP grubu ara'), { target: { value: 'GT-Mid' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
      expect(search).toHaveBeenCalledWith('GT-Mid');
      fireEvent.click(screen.getByText('GT-Middleware'));
      expect(JSON.parse(screen.getByTestId('durum').textContent || '{}').groups).toEqual([DN]);
      expect(screen.getByTestId('ss-erisim-ekip-listesi').textContent).toContain('GT-Middleware');

      // Aynı grup ikinci kez eklenmez (listede "seçili" ve tıklanamaz)
      fireEvent.change(screen.getByLabelText('LDAP grubu ara'), { target: { value: 'GT-Mid' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
      expect(screen.getByText('seçili')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'GT-Middleware ekibini çıkar' }));
      expect(JSON.parse(screen.getByTestId('durum').textContent || '{}').groups).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('SEU3 arama düşerse "grup yok" denmez; Enter ile elle eklenir', async () => {
    vi.useFakeTimers();
    try {
      const search = vi.fn().mockResolvedValue({ groups: [], error: 'LDAP grup araması yapılamadı: timeout' });
      render(<Kontrollu search={search} />);
      const kutu = screen.getByLabelText('LDAP grubu ara');
      fireEvent.change(kutu, { target: { value: 'GT-Network' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
      expect(screen.getByTestId('ss-erisim-sonuc').textContent).toContain('timeout');
      expect(screen.getByTestId('ss-erisim-sonuc').textContent).not.toContain('bulunamadı');
      fireEvent.keyDown(kutu, { key: 'Enter' });
      expect(JSON.parse(screen.getByTestId('durum').textContent || '{}').groups).toEqual(['GT-Network']);
      // Aynı grup (harf farkıyla da) ikinci kez eklenmez
      fireEvent.change(kutu, { target: { value: 'gt-network' } });
      fireEvent.keyDown(kutu, { key: 'Enter' });
      expect(JSON.parse(screen.getByTestId('durum').textContent || '{}').groups).toEqual(['GT-Network']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('SEU4 Kaydet erişimi yalnız değiştiyse yazar', async () => {
    const onClose = vi.fn();
    const r = render(<FieldOverridesModal item={SS} ssErisimItem={SS} onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.saveSsAccess).not.toHaveBeenCalled();
    r.unmount();

    const onClose2 = vi.fn();
    const haber = vi.fn();
    render(<FieldOverridesModal item={SS} ssErisimItem={SS} onClose={onClose2} onErisimKaydedildi={haber} />);
    expect(screen.getByTestId('ss-erisim-kapali')).toBeChecked();
    fireEvent.click(screen.getByTestId('ss-erisim-herkes'));
    fireEvent.click(await screen.findByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(onClose2).toHaveBeenCalled());
    expect(api.saveSsAccess).toHaveBeenCalledWith('ss-1', { mode: 'herkes', groups: [] });
    expect(haber).toHaveBeenCalledWith(expect.objectContaining({ accessMode: 'herkes' }));
  });

  it('SEU5 "Seçili ekipler" + ekip yok -> hiçbir şey kaydedilmez', async () => {
    const onClose = vi.fn();
    render(<FieldOverridesModal item={SS} ssErisimItem={SS} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('ss-erisim-ekipler'));
    expect(screen.getByTestId('ss-erisim-ekip-yok')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(toastHata).toHaveBeenCalledWith(expect.stringMatching(/hiç ekip eklenmedi/), 8000));
    expect(api.saveCustomization).not.toHaveBeenCalled();
    expect(api.saveSsAccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('SEU6 erişim yazılamazsa pencere açık kalır, yarım kayıt söylenir', async () => {
    api.saveSsAccess.mockResolvedValue({ ok: false, message: 'Kaydedilemedi: invalid column' });
    const onClose = vi.fn();
    render(<FieldOverridesModal item={SS} ssErisimItem={SS} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('ss-erisim-herkes'));
    fireEvent.click(await screen.findByRole('button', { name: 'Kaydet' }));
    await waitFor(() =>
      expect(toastHata).toHaveBeenCalledWith('Alan ayarları kaydedildi, erişim kaydedilemedi: Kaydedilemedi: invalid column', 8000),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('SEU7 Self Service dışı çağıran bölümü görmez', async () => {
    render(<FieldOverridesModal item={{ awxServerId: 2, awxTemplateId: 9, title: 'ScaleX' }} onClose={vi.fn()} />);
    await screen.findByRole('button', { name: 'Kaydet' });
    expect(screen.queryByTestId('ss-erisim')).toBeNull();
  });

  it('SEU8 yeni servis kapalı başlar; Self Service çağıranları öğeyi pencereye verir', () => {
    const kok = join(__dirname, '..', '..');
    const ss = readFileSync(join(kok, 'SelfServicePage.tsx'), 'utf8');
    expect(ss).toMatch(/saveSsItem\(\{ \.\.\.draft, enabled: false,/);
    expect(ss).not.toMatch(/saveSsItem\(\{ \.\.\.draft, enabled: true/);
    expect(ss.match(/<FieldOverridesModal item=\{fieldsItem\} ssErisimItem=\{fieldsItem\}/g)?.length).toBe(2);
    const ap = readFileSync(join(kok, 'ansible', 'AnsiblePage.tsx'), 'utf8');
    expect(ap).toMatch(/<FieldOverridesModal item=\{fieldsReviewItem\} ssErisimItem=\{fieldsReviewItem\}/);
    expect(ap).toMatch(/enabled: false,/);
  });
});
