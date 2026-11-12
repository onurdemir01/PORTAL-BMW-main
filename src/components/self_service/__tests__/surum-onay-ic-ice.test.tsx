// src/components/self_service/__tests__/surum-onay-ic-ice.test.tsx — uygulamadaki GERCEK ic ice
// pencere (2026-11-08): alan ozellestirme penceresi (FieldOverridesModal) icinde surum geri yukleme
// onayi. Eskiden window.confirm'di; portal ici pencereye gecince ESC iki pencereyi birden kapatirdi
// (her Modal window'a kendi dinleyicisini ekliyordu). Modal yigini bunu onler.
//   SI1 ESC yalniz onayi kapatir; ozellestirme penceresi acik kalir; geri yukleme yapilmaz
//   SI2 onaylaninca geri yukleme dogru surumle istenir
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';

const api = vi.hoisted(() => ({
  choiceSources: vi.fn(),
  surveySpecAdmin: vi.fn(),
  getCustomization: vi.fn(),
  saveCustomization: vi.fn(),
  customizationHistory: vi.fn(),
  smartMetadataPreview: vi.fn(),
  smartFlowMetadata: vi.fn(),
  restoreCustomization: vi.fn(),
}));
vi.mock('@/api/ansibleApi', () => ({ ansibleApi: api }));
import FieldOverridesModal from '../FieldOverridesModal';

const ITEM = { awxServerId: 1, awxTemplateId: 42, title: 'Örnek Servis' };
const SURUM = {
  id: 9,
  savedAt: '2026-11-01T10:00:00Z',
  savedBy: 'ornek.kullanici',
  reason: 'save',
  customSurveyFields: 2,
  fieldOverrides: 1,
  smart: false,
  oco: false,
  customFieldNames: [],
};

async function gecmisiAc() {
  const ozet = await screen.findByText(/Geçmiş sürümler/);
  const details = ozet.closest('details') as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  return screen.findByRole('button', { name: 'Geri yükle' });
}
const onayPenceresi = () =>
  screen
    .getAllByRole('dialog')
    .find((d) => /tarihli sürümü geri yüklemek/.test(d.textContent || ''));

describe('FieldOverridesModal içinde sürüm geri yükleme onayı (iç içe pencere)', () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.choiceSources.mockResolvedValue({ ok: true, sources: [] });
    api.surveySpecAdmin.mockResolvedValue({
      ok: true,
      fields: [],
      surveyEnabled: true,
      launchOptions: null,
      askVariables: false,
    });
    api.getCustomization.mockResolvedValue({
      ok: true,
      customization: { fieldOverrides: [], rawExtraVars: '', launchOptionOverrides: {} },
    });
    api.customizationHistory.mockResolvedValue({ ok: true, items: [SURUM] });
    api.restoreCustomization.mockResolvedValue({ ok: true });
  });

  it('SI1 ESC yalnız onayı kapatır; özelleştirme penceresi açık kalır', async () => {
    // onClose sahte (vi.fn) oldugu icin pencere kendiliginden kapanmaz: kapatma ISTEGI sayilir.
    const onClose = vi.fn();
    render(<FieldOverridesModal item={ITEM} onClose={onClose} />);
    fireEvent.click(await gecmisiAc());
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(2));
    expect(onayPenceresi()).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(onayPenceresi()).toBeUndefined();
    expect(screen.getByText(/Geçmiş sürümler/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(api.restoreCustomization).not.toHaveBeenCalled();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('SI2 onaylanınca geri yükleme doğru sürümle istenir', async () => {
    render(<FieldOverridesModal item={ITEM} onClose={vi.fn()} />);
    fireEvent.click(await gecmisiAc());
    await waitFor(() => expect(onayPenceresi()).toBeTruthy());
    fireEvent.click(within(onayPenceresi()!).getByRole('button', { name: 'Geri yükle' }));
    await waitFor(() => expect(api.restoreCustomization).toHaveBeenCalledWith(1, 42, 9));
  });
});
