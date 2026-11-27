// @vitest-environment jsdom
// OpsX Smart onayi yapilandirma penceresi (2026-11-26, kapsam PR-2; %0): yukleme hatasi, platform sekmeleri ve uc durum
// rozeti (acik / kapali / eksik; ortam degiskeni anahtar sayilir), kapali kapinin uyarisi, ortam degiskeni uyarilari,
// Smart alanlarini getirme (hata / tablo / otomatik doldur), metadata onizlemesi (alan: deger ayristirma, bos deger,
// hic alan yok, hata), kaydetme (uc platform govdesi, reddedilen alanlar, hata) ve kapat.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const opsx = vi.hoisted(() => ({ getSmartConfig: vi.fn(), saveSmartConfig: vi.fn() }));
vi.mock('@/api/opsxApi', () => ({ opsxApi: opsx }));
const ans = vi.hoisted(() => ({ smartFlowMetadata: vi.fn(), smartMetadataPreview: vi.fn() }));
vi.mock('@/api/ansibleApi', () => ({ ansibleApi: ans }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));

import OpsXSmartConfigModal from '../OpsXSmartConfigModal';

const plat = (ek: Record<string, unknown> = {}) => ({
  enabled: true,
  flowKey: '',
  metadataFields: '',
  integrationKeySet: false,
  ...ek,
});
const yapilandirma = (ek: Record<string, unknown> = {}) => ({
  ok: true,
  smart: {
    legacy: plat({
      flowKey: 'OPSX_JBOSS',
      metadataFields: 'KONU: {{templateName}}',
      integrationKeySet: true,
    }),
    was: plat({ enabled: false }),
    openshift: plat(),
  },
  envFallback: {
    legacy: { flowKeySet: false, envName: 'OPSX_SMART_FLOW_KEY_LEGACY' },
    was: { flowKeySet: false, envName: 'OPSX_SMART_FLOW_KEY_WAS' },
    openshift: { flowKeySet: true, envName: 'OPSX_SMART_FLOW_KEY_OCP' },
  },
  integrationEnvSet: true,
  metadataEnvSet: true,
  ...ek,
});

beforeEach(() => {
  for (const f of [...Object.values(opsx), ...Object.values(ans)]) f.mockReset();
  toast.error.mockReset();
  toast.success.mockReset();
});

const sekme = (ad: RegExp) => screen.getByRole('button', { name: ad });

describe('OpsXSmartConfigModal', () => {
  it('kapaliyken yuklemez; yukleme hatasi gosterilir', async () => {
    const { rerender } = render(<OpsXSmartConfigModal open={false} onClose={vi.fn()} />);
    expect(opsx.getSmartConfig).not.toHaveBeenCalled();
    opsx.getSmartConfig.mockResolvedValueOnce({ ok: false, message: 'Ayar tablosu yok' });
    rerender(<OpsXSmartConfigModal open onClose={vi.fn()} />);
    expect(await screen.findByText('Ayar tablosu yok')).toBeTruthy();
  });

  it('sekmeler ve uc durum; kapali kapi; ortam degiskeni uyarilari', async () => {
    opsx.getSmartConfig.mockResolvedValue(yapilandirma());
    render(<OpsXSmartConfigModal open onClose={vi.fn()} />);
    expect(await screen.findByDisplayValue('OPSX_JBOSS')).toBeTruthy();
    const rozet = (ad: RegExp) => sekme(ad).querySelector('span[title]')?.getAttribute('title');
    expect(rozet(/Legacy/)).toBe('Smart onayı etkin, Flow Key tanımlı');
    expect(rozet(/WAS/)).toBe('Smart onayı KAPALI — production işlem onaysız çalışır');
    expect(rozet(/OpenShift/)).toBe('Smart onayı etkin, Flow Key tanımlı');
    expect(
      screen.getByPlaceholderText('Tanımlı — değiştirmek için yeni değeri yazın'),
    ).toBeTruthy();

    fireEvent.click(sekme(/WAS/));
    expect(screen.getByText('WAS JVM restart / stop / start')).toBeTruthy();
    expect(screen.getByText(/onaysız ve Smart'ta kayıtsız/)).toBeTruthy();
    expect(screen.getByPlaceholderText('Boşsa OPSX_SMART_INTEGRATION_KEY kullanılır')).toBeTruthy();
    expect(screen.getByText(/OPSX_SMART_METADATA_FIELDS/)).toBeTruthy();
    // Kapiyi acinca Flow Key yok: production reddedilir uyarisi ve rozet "eksik".
    fireEvent.click(screen.getByRole('checkbox', { name: /Smart onayı istensin/ }));
    expect(screen.getByText(/production işlem REDDEDİLİR/)).toBeTruthy();
    expect(rozet(/WAS/)).toBe('Smart onayı etkin ama Flow Key YOK — production işlem REDDEDİLİR');

    fireEvent.click(sekme(/OpenShift/));
    expect(screen.getByText(/OPSX_SMART_FLOW_KEY_OCP/)).toBeTruthy();
    expect(screen.queryByText(/production işlem REDDEDİLİR/)).toBeNull();
  });

  it('Smart alanlari: hata, tablo ve otomatik doldur', async () => {
    opsx.getSmartConfig.mockResolvedValue(yapilandirma());
    ans.smartFlowMetadata
      .mockResolvedValueOnce({ ok: false, message: 'Flow bulunamadi' })
      .mockResolvedValueOnce({
        ok: true,
        fields: [{ Name: 'KONU', ElementName: 'KONU', Type: 'Text', IsRequired: true }],
      });
    render(<OpsXSmartConfigModal open onClose={vi.fn()} />);
    await screen.findByDisplayValue('OPSX_JBOSS');
    const otomatik = screen.getByRole('button', { name: 'Otomatik Doldur' }) as HTMLButtonElement;
    expect(otomatik.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Alanları Getir' }));
    expect(await screen.findByText('Flow bulunamadi')).toBeTruthy();
    expect(ans.smartFlowMetadata).toHaveBeenCalledWith('OPSX_JBOSS');
    fireEvent.click(screen.getByRole('button', { name: 'Alanları Getir' }));
    await waitFor(() => expect(otomatik.disabled).toBe(false));
    fireEvent.click(otomatik);
    const metin = screen.getByLabelText('Metadata Eşlemesi') as HTMLTextAreaElement;
    expect(metin.value).toContain('KONU');
    // Flow Key bosken alan getirilemez.
    fireEvent.change(screen.getByLabelText('Smart Flow Key'), { target: { value: '  ' } });
    expect(
      (screen.getByRole('button', { name: 'Alanları Getir' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('onizleme: alan ayristirma, bos deger, hic alan, hata', async () => {
    opsx.getSmartConfig.mockResolvedValue(yapilandirma());
    ans.smartMetadataPreview
      .mockResolvedValueOnce({ ok: true, metadata: { KONU: 'OpsX: Legacy (JBoss)', ACIKLAMA: '' } })
      .mockResolvedValueOnce({ ok: true, metadata: {} })
      .mockResolvedValueOnce({ ok: false, message: 'Sablon hatasi' });
    render(<OpsXSmartConfigModal open onClose={vi.fn()} />);
    await screen.findByDisplayValue('OPSX_JBOSS');
    fireEvent.change(screen.getByDisplayValue(/env: prod/), {
      target: {
        value: 'env: prod\n# not: yorum satiri\nbozuk satir\n:degersiz\noperation: restart',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Önizle' }));
    expect(await screen.findByText('OpsX: Legacy (JBoss)')).toBeTruthy();
    expect(screen.getByText('(boş)')).toBeTruthy();
    expect(ans.smartMetadataPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataFields: 'KONU: {{templateName}}',
        extraVars: { env: 'prod', operation: 'restart' },
        templateName: 'OpsX: Legacy (JBoss)',
        opsx: expect.objectContaining({ platform: 'legacy', uygulama: 'ORNEKUYGULAMA' }),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Önizle' }));
    expect(await screen.findByText(/hiç alan yok/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Önizle' }));
    expect(await screen.findByText('Sablon hatasi')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Metadata Eşlemesi'), { target: { value: '' } });
    expect((screen.getByRole('button', { name: 'Önizle' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('kaydet: uc platform govdesi, reddedilen alanlar, hata; kapat', async () => {
    opsx.getSmartConfig.mockResolvedValue(yapilandirma());
    opsx.saveSmartConfig
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, reddedilen: ['legacy.flowKey'] })
      .mockResolvedValueOnce({ ok: false, message: 'Yetki yok' });
    const kapat = vi.fn();
    render(<OpsXSmartConfigModal open onClose={kapat} />);
    await screen.findByDisplayValue('OPSX_JBOSS');
    fireEvent.change(screen.getByLabelText('Smart Flow Key'), { target: { value: ' OPSX_YENI ' } });
    fireEvent.change(screen.getByLabelText('Integration Key (opsiyonel)'), {
      target: { value: ' anahtar ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Smart onay yapılandırması kaydedildi.'),
    );
    expect(opsx.saveSmartConfig.mock.calls[0][0]).toEqual({
      legacy: {
        enabled: true,
        flowKey: 'OPSX_YENI',
        metadataFields: 'KONU: {{templateName}}',
        integrationKey: 'anahtar',
      },
      was: { enabled: false, flowKey: '', metadataFields: '', integrationKey: '' },
      openshift: { enabled: true, flowKey: '', metadataFields: '', integrationKey: '' },
    });
    expect(opsx.getSmartConfig).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('legacy.flowKey')),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Yetki yok'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Kapat' }).at(-1)!);
    expect(kapat).toHaveBeenCalled();
  });
});
