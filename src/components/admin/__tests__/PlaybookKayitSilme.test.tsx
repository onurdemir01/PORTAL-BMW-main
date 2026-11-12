// src/components/admin/__tests__/PlaybookKayitSilme.test.tsx - PKU1..PKU4 (2026-11-02).
//
// Admin > Playbook Kayıtları: silinen varsayılan satırlar restart'ta geri geliyordu. Artık
// silme onayı kaydı kullanan Portal özelliğini söyler, silinen varsayılanlar ayrı bölümde
// listelenir ve "Geri yükle" ile geri getirilir. Gerçek istemci çalışır; yalnız fetch sahtedir.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import PlaybookRegistryTab, { silmeOnayMetni } from '@/components/admin/tabs/PlaybookRegistryTab';

const satir = {
  id: 7, keyName: 'nginx_loadtest_run', displayName: 'Nginx Yük Testi', description: '', category: 'nginx',
  handler: 'host_target', playbookPath: '', awxTemplateId: 12, awxServerId: null, envVarName: '', enabled: true,
  sourceType: 'awx_template', isReadonly: false, visibility: 'Admin', sortOrder: 0, effectiveTemplateId: 12,
  varsayilan: true, kullanan: 'Nginx Hub > Yük Testi',
};
const silinen = { keyName: 'jvm_heap_status', displayName: 'JVM Heap/GC Durumu', category: 'jvm', deletedBy: 'ali', deletedAt: null };

let liste: Record<string, unknown>;
const istekler: { url: string; method: string }[] = [];
const yanit = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  istekler.length = 0;
  liste = { ok: true, playbooks: [satir], silinenVarsayilanlar: [silinen], silinenHata: null };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (girdi: RequestInfo | URL, init?: RequestInit) => {
      const url = String(girdi);
      const method = init?.method || 'GET';
      istekler.push({ url, method });
      if (url === '/api/ansible/playbooks' && method === 'GET') return yanit(liste);
      if (url.includes('/geri-yukle')) {
        liste = { ok: true, playbooks: [satir], silinenVarsayilanlar: [], silinenHata: null };
        return yanit({ ok: true });
      }
      if (method === 'DELETE') return yanit({ ok: true, varsayilan: true, kullanan: satir.kullanan });
      return yanit({ ok: true, servers: [] });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('Playbook Kayıtları silme / geri yükleme', () => {
  it('PKU1 onay metni kullanan özelliği ve varsayılan notunu söyler', () => {
    const m = silmeOnayMetni(satir);
    expect(m).toContain('Bu kaydı Nginx Hub > Yük Testi kullanıyor; silerseniz o ekran çalışmaz.');
    expect(m).toContain('Silinen varsayılanlar');
    const yalin = silmeOnayMetni({ displayName: 'X', kullanan: null, varsayilan: false });
    expect(yalin).not.toContain('kullanıyor');
    expect(yalin).not.toContain('varsayılan kayıt');
  });

  it('PKU2 silme onayı kullanan uyarısıyla sorulur, onaylanınca silinir (engellenmez)', async () => {
    render(<PlaybookRegistryTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Nginx Yük Testi kaydını sil' }));
    const pencere = await screen.findByRole('dialog');
    expect(pencere).toHaveTextContent('Bu kaydı Nginx Hub > Yük Testi kullanıyor; silerseniz o ekran çalışmaz.');
    expect(istekler.some((i) => i.method === 'DELETE')).toBe(false);
    fireEvent.click(within(pencere).getByRole('button', { name: 'Sil' }));
    await waitFor(() => expect(istekler.some((i) => i.method === 'DELETE' && i.url === '/api/ansible/playbooks/7')).toBe(true));
  });

  it('PKU3 "Silinen varsayılanlar (N)" listelenir; Geri yükle POST atar ve listeyi tazeler', async () => {
    render(<PlaybookRegistryTab />);
    expect(await screen.findByText('Silinen varsayılanlar (1)')).toBeTruthy();
    expect(screen.getByText('JVM Heap/GC Durumu')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Geri yükle/ }));
    await waitFor(() =>
      expect(istekler.some((i) => i.method === 'POST' && i.url === '/api/ansible/playbooks/silinen/jvm_heap_status/geri-yukle')).toBe(true),
    );
    await waitFor(() => expect(screen.queryByTestId('silinen-varsayilanlar')).toBeNull());
  });

  it('PKU4 silinenler okunamadıysa "(0)" değil "okunamadı" der; hiç yoksa bölüm görünmez', async () => {
    liste = { ok: true, playbooks: [satir], silinenVarsayilanlar: null, silinenHata: 'tablo yok' };
    const { unmount } = render(<PlaybookRegistryTab />);
    expect(await screen.findByText(/Silinen varsayılanlar okunamadı: tablo yok/)).toBeTruthy();
    expect(screen.queryByText(/Silinen varsayılanlar \(0\)/)).toBeNull();
    unmount();
    liste = { ok: true, playbooks: [satir], silinenVarsayilanlar: [], silinenHata: null };
    render(<PlaybookRegistryTab />);
    await screen.findByText('Nginx Yük Testi');
    expect(screen.queryByTestId('silinen-varsayilanlar')).toBeNull();
  });
});
