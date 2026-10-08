// src/components/opsx/__tests__/ocp-target-anlik-ekle.test.tsx — OT1..OT3 (2026-10-08).
//
// Kullanici: "namespace ve uygulamayi sectikten sonra listeye ekle diye bir buton var. Insanlar
// bunu fark etmiyor ve sanki job calismiyormus gibi bir durum olusuyor ... adam uygulamayi sectigi
// an listeye eklensin." Uygulamaya TIKLAMAK cifti ekler; "Devam Et" hemen acilir.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';

vi.mock('@/api/opsxApi', () => ({
  opsxApi: {
    getClusters: vi.fn(async () => ({ tree: { PROD: { ark: ['gbocpprod1'] } } })),
    getOcpNamespaces: vi.fn(async () => ({ namespaces: ['ns-a'] })),
    getOcpApps: vi.fn(async () => ({ apps: ['app-1', 'app-2'] })),
  },
}));

import OcpTargetStep from '../steps/OcpTargetStep';

async function namespaceSec() {
  fireEvent.click(await screen.findByText('PROD'));
  fireEvent.click(await screen.findByText('ark'));
  fireEvent.click(await screen.findByText('ns-a'));
  await screen.findByText('app-1');
}

describe('OpenShift hedefi: secilen uygulama aninda listeye girer', () => {
  let gonderilen: unknown;
  beforeEach(() => { gonderilen = null; });

  it('OT1 uygulamaya tiklamak cifti ekler ve Devam Et acilir (ayri "Listeye Ekle" yok)', async () => {
    render(<OcpTargetStep onSubmit={(v) => { gonderilen = v; }} />);
    await namespaceSec();
    const devam = screen.getByRole('button', { name: 'Devam Et' }) as HTMLButtonElement;
    expect(devam.disabled).toBe(true);
    expect(screen.getByText('Devam etmek için en az bir namespace / uygulama seçin.')).toBeTruthy();
    expect(screen.queryByText('Listeye Ekle')).toBeNull();
    fireEvent.click(screen.getByText('app-1'));
    expect(await screen.findByText('ns-a / app-1')).toBeTruthy();
    await waitFor(() => expect(devam.disabled).toBe(false));
    fireEvent.click(devam);
    expect(gonderilen).toEqual({ env: 'PROD', tenant: 'ark', pairs: [{ namespace: 'ns-a', application: 'app-1' }] });
  });

  it('OT2 ayni namespace\'ten ikinci uygulama da eklenir; eklenen listeden duser', async () => {
    render(<OcpTargetStep onSubmit={() => {}} />);
    await namespaceSec();
    fireEvent.click(screen.getByText('app-1'));
    await screen.findByText('ns-a / app-1');
    expect(screen.queryByRole('button', { name: 'app-1' })).toBeNull();
    fireEvent.click(screen.getByText('app-2'));
    expect(await screen.findByText('ns-a / app-2')).toBeTruthy();
    expect(screen.getByText("Bu namespace'in bütün uygulamaları listeye eklendi.")).toBeTruthy();
  });

  it('OT3 eklenen cift silinince uygulama listeye geri doner', async () => {
    render(<OcpTargetStep onSubmit={() => {}} />);
    await namespaceSec();
    fireEvent.click(screen.getByText('app-1'));
    const satir = (await screen.findByText('ns-a / app-1')).parentElement as HTMLElement;
    fireEvent.click(satir.querySelector('button') as HTMLButtonElement);
    expect(await screen.findByText('app-1')).toBeTruthy();
    expect(screen.queryByText('ns-a / app-1')).toBeNull();
  });
});
