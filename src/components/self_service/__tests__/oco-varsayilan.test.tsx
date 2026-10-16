// src/components/self_service/__tests__/oco-varsayilan.test.tsx — ScaleX'in SMART / OCO ayar
// penceresi OCO kapısını farkında olmadan KAPATMAZ (2026-10-16).
//
// Kullanıcı: "ScaleX için hem OCO hem smart onay sürecini aktif edebilir misin?". Etkinleştirme
// yolu Admin > ScaleX > "SMART / OCO ayarlarını düzenle" (FieldOverridesModal). ScaleX sunucusu
// kayıtta `ocoCheck` YOKSA OCO kapısını AÇIK sayar (server/scalex/launch.cjs gatePolicyFor:
// `cfg.enabled !== false`); pencere ise aynı durumda kutuyu boş gösteriyor ve Kaydet
// `ocoCheck.enabled: false` yazıyordu. SMART'ı tanımlamak için pencereyi açıp kaydeden admin
// prod'daki OCO kapısını kapatırdı — tam da "ikisini de aç" isteğinin önünde.
//   OV1 ScaleX (ocoAyarYoksaAcik) + kayıtta ocoCheck yok -> kutu İŞARETLİ, Kaydet enabled:true yazar
//   OV2 ScaleX + kayıtta açıkça enabled:false -> kutu boş (admin kararı korunur)
//   OV3 Self Service (prop yok) + ocoCheck yok -> kutu boş (Self Service davranışı değişmez)
//   OV4 ScaleX yönetim sekmesi pencereyi bu kipte açıyor (kaynak iddiası)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

const ITEM = { awxServerId: 1, awxTemplateId: 42, title: 'ScaleX — Replica İşlemi' };

function kayit(ek: Record<string, unknown>) {
  api.getCustomization.mockResolvedValue({
    ok: true,
    customization: { fieldOverrides: [], rawExtraVars: '', launchOptionOverrides: {}, ...ek },
  });
}

async function ocoKutusu() {
  const baslik = await screen.findByText('OCO Kontrolü (opsiyonel)');
  const kutu = baslik.closest('div.border') as HTMLElement;
  return within(kutu).getByRole('checkbox');
}

describe('FieldOverridesModal OCO varsayılanı', () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.choiceSources.mockResolvedValue({ ok: true, sources: [] });
    api.surveySpecAdmin.mockResolvedValue({ ok: true, fields: [], surveyEnabled: true, launchOptions: null, askVariables: false });
    api.saveCustomization.mockResolvedValue({ ok: true });
  });

  it('OV1 ScaleX: kayıtta ocoCheck yoksa kutu işaretli; Kaydet OCO kapısını AÇIK yazar', async () => {
    kayit({ smartApproval: { enabled: false, flowKey: '', metadataFields: '' } });
    render(<FieldOverridesModal item={ITEM} onClose={vi.fn()} ocoAyarYoksaAcik />);
    expect(await ocoKutusu()).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(api.saveCustomization).toHaveBeenCalled());
    expect(api.saveCustomization.mock.calls[0][2].ocoCheck).toEqual({ enabled: true });
  });

  it('OV2 ScaleX: kayıtta açıkça enabled:false ise kutu boş (admin kararı korunur)', async () => {
    kayit({ ocoCheck: { enabled: false } });
    render(<FieldOverridesModal item={ITEM} onClose={vi.fn()} ocoAyarYoksaAcik />);
    expect(await ocoKutusu()).not.toBeChecked();
  });

  it('OV3 Self Service (prop yok): ocoCheck yoksa kutu boş — davranış değişmedi', async () => {
    kayit({});
    render(<FieldOverridesModal item={ITEM} onClose={vi.fn()} />);
    expect(await ocoKutusu()).not.toBeChecked();
  });

  it('OV4 ScaleX yönetim sekmesi pencereyi "ayar yoksa açık" kipinde açıyor', () => {
    const s = readFileSync(join(__dirname, '..', '..', 'admin', 'tabs', 'ScaleXAdminTab.tsx'), 'utf8');
    expect(s).toMatch(/<FieldOverridesModal[\s\S]{0,600}ocoAyarYoksaAcik[\s\S]{0,200}\/>/);
  });
});
