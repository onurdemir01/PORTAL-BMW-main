// @vitest-environment jsdom
// Ansible sayfasi (2026-11-24, kapsam PR-2): sunucu listesi (yukleme hatasi / bos / sekmeler), sablon izgarasi
// (arama, sayfalama, kimlik bilgisi eksik sunucu), baslatma penceresi (YAML / JSON degisken editoru, gecersiz
// JSON, limit, reddedilen baslatma), is ciktisi penceresi (yoklama, changed uyarisi) ve sablon bilgi penceresi
// (survey, extra vars, gizli degiskenler, Self Service olarak ekle -> alan incelemesi).
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  servers: vi.fn(),
  templates: vi.fn(),
  templateDetail: vi.fn(),
  run: vi.fn(),
  jobStatus: vi.fn(),
  jobOutput: vi.fn(),
  saveSsItem: vi.fn(),
}));
vi.mock('@/api/ansibleApi', () => ({ ansibleApi: api }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));
vi.mock('@/components/self_service/FieldOverridesModal', () => ({
  default: (p: { item: { title: string }; onClose: () => void }) => (
    <div>
      alan incelemesi {p.item.title}
      <button type="button" onClick={p.onClose}>
        incelemeyi kapat
      </button>
    </div>
  ),
}));

import AnsiblePage from '../AnsiblePage';

const sablon = (id: number, ek: Record<string, unknown> = {}) => ({
  id,
  name: `Sablon ${id}`,
  description: `aciklama ${id}`,
  playbook: `pb_${id}.yml`,
  inventory: 'inv1',
  ask_variables: false,
  variables: '',
  labels: [],
  isReadOnly: false,
  lastLaunch: null,
  ...ek,
});

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  api.servers.mockResolvedValue({
    ok: true,
    servers: [
      { id: 1, name: 'AWX Prod', configured: true },
      { id: 2, name: 'AWX Eksik', configured: false },
    ],
  });
  api.templates.mockResolvedValue({
    ok: true,
    templates: [
      sablon(10, {
        name: 'Health Check',
        ask_variables: true,
        isReadOnly: true,
        variables: 'env_mode: qa\nretry: 3\n# yorum\n---\nadi: "tirnakli"',
        hiddenVariables: ['vault_pass'],
        labels: ['ops'],
        lastLaunch: '2026-11-20T08:00:00Z',
      }),
      sablon(11, { name: 'Deploy App' }),
    ],
  });
});
afterEach(() => vi.useRealTimers());

async function sayfa() {
  render(<AnsiblePage />);
  await screen.findByText('Health Check');
}

describe('AnsiblePage', () => {
  it('sunucu listesi okunamazsa hata ve tekrar dene; bos listede yonlendirme', async () => {
    api.servers.mockRejectedValueOnce(new Error('AWX yanit vermedi'));
    render(<AnsiblePage />);
    expect(await screen.findByText('AWX sunucu listesi okunamadı')).toBeTruthy();
    expect(screen.getByText('AWX yanit vermedi')).toBeTruthy();
    api.servers.mockResolvedValueOnce({ ok: true, servers: [] });
    fireEvent.click(screen.getByRole('button', { name: /Tekrar dene/i }));
    expect(await screen.findByText(/Yapılandırılmış AWX sunucusu bulunamadı/)).toBeTruthy();
  });

  it('sablon izgarasi: arama, kimlik bilgisi eksik sunucu, sablon hatasi', async () => {
    await sayfa();
    expect(screen.getByText('2 şablon')).toBeTruthy();
    expect(screen.getByText('Vars')).toBeTruthy();
    expect(screen.getByText('Read-only')).toBeTruthy();
    expect(screen.getByText('Hiç çalıştırılmadı')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Ara...'), { target: { value: 'deploy' } });
    expect(screen.getByText('1 şablon')).toBeTruthy();
    expect(screen.queryByText('Health Check')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Ara...'), { target: { value: 'yokyok' } });
    expect(screen.getByText('Eşleşen şablon bulunamadı.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /AWX Eksik/ }));
    expect(await screen.findByText(/AWX Eksik için kimlik bilgisi yapılandırılmamış/)).toBeTruthy();
    expect(api.templates).toHaveBeenCalledTimes(2);
  });

  it('sablon cekimi reddedilirse mesaj; sunucuda sablon yoksa bos durum', async () => {
    api.templates.mockResolvedValueOnce({ ok: false, templates: [], message: 'Yetki yok' });
    render(<AnsiblePage />);
    expect(await screen.findByText('Yetki yok')).toBeTruthy();
    // Kimlik bilgisi eksik sunucu sekmesi de cekim yapar (panel her sekmede yeniden kurulur).
    fireEvent.click(screen.getByRole('button', { name: /AWX Eksik/ }));
    await screen.findByText(/AWX Eksik için kimlik bilgisi yapılandırılmamış/);
    api.templates.mockResolvedValueOnce({ ok: true, templates: [] });
    fireEvent.click(screen.getByRole('button', { name: /AWX Prod/ }));
    expect(await screen.findByText('Bu sunucuda yetkili şablon yok.')).toBeTruthy();
  });

  it('sayfalama: 24 kartlik sayfalar, ileri / geri / numara', async () => {
    api.templates.mockResolvedValueOnce({
      ok: true,
      templates: Array.from({ length: 30 }, (_, i) => sablon(100 + i)),
    });
    render(<AnsiblePage />);
    await screen.findByText('Sablon 100');
    expect(screen.queryByText('Sablon 124')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '›' }));
    expect(await screen.findByText('Sablon 124')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '‹' }));
    expect(await screen.findByText('Sablon 100')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(await screen.findByText('Sablon 129')).toBeTruthy();
  });

  it('baslatma: YAML varsayilanlar, JSON a gecis, gecersiz JSON, limit ve is ciktisi', async () => {
    api.run.mockResolvedValue({ ok: true, jobId: 501 });
    api.jobStatus
      .mockResolvedValueOnce({ ok: true, status: 'running', elapsed: 1.5 })
      .mockResolvedValueOnce({ ok: true, status: 'successful', elapsed: 4.25 });
    api.jobOutput
      .mockResolvedValueOnce({ ok: true, output: 'TASK [a]', changedWarning: false })
      .mockResolvedValueOnce({ ok: true, output: 'PLAY RECAP ok=3', changedWarning: true });
    await sayfa();
    const kart = screen.getByText('Health Check').closest('div.rounded-xl') as HTMLElement;
    fireEvent.click(within(kart).getByRole('button', { name: /Başlat/ }));
    const editor = screen.getByRole('textbox', { name: '' }) as HTMLTextAreaElement;
    expect(editor.value).toBe('env_mode: qa\nretry: 3\nadi: tirnakli');
    expect(screen.getByText('3 değişken · geçerli YAML')).toBeTruthy();
    expect(screen.getByTestId('gizli-degiskenler').textContent).toMatch(
      /1 gizli değişken.*vault_pass/,
    );

    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    expect(JSON.parse(editor.value)).toEqual({ env_mode: 'qa', retry: 3, adi: 'tirnakli' });
    fireEvent.change(editor, { target: { value: '[1, 2]' } });
    expect(screen.getByText(/JSON bir nesne \(obje\) olmalı/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /İş Başlat/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(editor, { target: { value: '{bozuk' } });
    expect(screen.getByText(/Geçersiz JSON/)).toBeTruthy();
    // Gecersiz metinde format degisimi metni oldugu gibi birakir.
    fireEvent.click(screen.getByRole('button', { name: 'YAML' }));
    expect(editor.value).toBe('{bozuk');
    fireEvent.change(editor, { target: { value: 'hedef: ORNAPP01\nadet: 2' } });
    fireEvent.change(screen.getByLabelText('Limit (opsiyonel)'), { target: { value: 'web*' } });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole('button', { name: /İş Başlat/ }));
    await waitFor(() =>
      expect(api.run).toHaveBeenCalledWith(10, { hedef: 'ORNAPP01', adet: 2 }, 'web*'),
    );
    expect(await screen.findByText('Job #501 — Health Check')).toBeTruthy();
    expect(await screen.findByText('TASK [a]')).toBeTruthy();
    expect(screen.getByText('— güncelleniyor…')).toBeTruthy();
    // 3 sn'lik yoklama, 'running' durumu islendiginde (cikti gelmeden once) kurulmus olur.
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(await screen.findByText('PLAY RECAP ok=3')).toBeTruthy();
    expect(screen.getByText(/değişiklik \(changed\) tespit edildi/)).toBeTruthy();
    expect(screen.getByText('Süre: 4.3s')).toBeTruthy();
    expect(screen.getByText('Başarılı')).toBeTruthy();
    expect(api.jobStatus).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Kapat' }).at(-1)!);
    expect(screen.queryByText('Job #501 — Health Check')).toBeNull();
  });

  it('baslatma reddi pencerede kalir; durum okunamazsa yoklama 5 sn sonra yeniden dener', async () => {
    api.run.mockResolvedValueOnce({ ok: false, message: 'Prompt on launch kapali' });
    await sayfa();
    const kart = screen.getByText('Deploy App').closest('div.rounded-xl') as HTMLElement;
    fireEvent.click(within(kart).getByRole('button', { name: /Başlat/ }));
    expect(screen.getByText('0 değişken · geçerli YAML')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /İş Başlat/ }));
    expect(await screen.findByText('Prompt on launch kapali')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'İptal' }));
    expect(screen.queryByText('Prompt on launch kapali')).toBeNull();

    api.run.mockResolvedValueOnce({ ok: true, jobId: 77 });
    api.jobStatus
      .mockRejectedValueOnce(new Error('ag'))
      .mockResolvedValueOnce({ ok: true, status: 'failed' });
    api.jobOutput.mockResolvedValue({ ok: true, output: '', changedWarning: false });
    fireEvent.click(within(kart).getByRole('button', { name: /Başlat/ }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole('button', { name: /İş Başlat/ }));
    expect(await screen.findByText('Job #77 — Deploy App')).toBeTruthy();
    expect(screen.getByText('Çıktı bekleniyor…')).toBeTruthy();
    // Yuk altinda deterministik: ilk durum sorgusunun reddi islenip 5 sn'lik yeniden deneme
    // kurulmadan saat ilerletilmez (kapi K8'de bu yaris yakalandi).
    await waitFor(() => expect(api.jobStatus).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 5; i++) await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await waitFor(() => expect(api.jobStatus).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Başarısız')).toBeTruthy();
    expect(screen.getByText('Çıktı yok.')).toBeTruthy();
  });

  it('bilgi penceresi: survey, extra vars, credentials, son isler; Self Service olarak ekle', async () => {
    api.templateDetail.mockResolvedValue({
      ok: true,
      template: {
        description: 'Saglik kontrolu',
        jobType: 'run',
        playbook: 'hc.yml',
        inventory: 'inv1',
        project: 'proj1',
        limit: 'WEB01',
        verbosity: 2,
        askVariables: true,
        askLimit: true,
        askInventory: false,
        modified: '2026-11-01T10:00:00Z',
        surveyEnabled: false,
        surveyFields: [
          {
            name: 'env_mode',
            label: 'Ortam',
            type: 'multiplechoice',
            required: true,
            default: 'qa',
            choices: 'qa\nprod',
          },
          {
            name: 'hedef',
            label: 'Hedef',
            type: 'text',
            required: false,
            choices: ['A', ' ', 'B'],
          },
        ],
        extraVars: 'env_mode: qa',
        extraVarsParsed: { env_mode: 'qa' },
        hiddenVariables: ['vault_pass'],
        credentials: [{ name: 'ssh-key', kind: 'ssh' }, { name: 'vault' }],
        recentJobs: [
          { id: 9, status: 'successful', finished: '2026-11-19T10:00:00Z' },
          { id: 8, status: 'garip', finished: null },
        ],
      },
    });
    api.saveSsItem.mockResolvedValueOnce({ ok: false, message: 'Kayit reddedildi' });
    await sayfa();
    const kart = screen.getByText('Health Check').closest('div.rounded-xl') as HTMLElement;
    fireEvent.click(within(kart).getByRole('button', { name: /Bilgi/ }));
    expect(await screen.findByText('Saglik kontrolu')).toBeTruthy();
    expect(api.templateDetail).toHaveBeenCalledWith(1, 10);
    expect(screen.getByText('Değişken sorar · Limit sorar')).toBeTruthy();
    expect(screen.getByText('Survey Soruları (2)')).toBeTruthy();
    expect(screen.getByText(/AWX'te KAPALI/)).toBeTruthy();
    expect(screen.getByText('Seçenekler: qa, prod')).toBeTruthy();
    expect(screen.getByText('Seçenekler: A, B')).toBeTruthy();
    expect(screen.getByText('Varsayılan: qa')).toBeTruthy();
    expect(screen.getByText('Extra Vars (1 değişken)')).toBeTruthy();
    expect(screen.getByText(/1 gizli değişken gösterilmiyor \(vault_pass\)/)).toBeTruthy();
    expect(screen.getByText('ssh-key (ssh)')).toBeTruthy();
    expect(screen.getByText('Job #9')).toBeTruthy();
    expect(screen.getByText('garip')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Self Service Olarak Ekle/ }));
    const isim = screen.getByLabelText('İsim') as HTMLInputElement;
    expect(isim.value).toBe('Health Check');
    fireEvent.change(isim, { target: { value: '  ' } });
    expect((screen.getByRole('button', { name: /Kaydet/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(isim, { target: { value: ' Saglik ' } });
    fireEvent.change(screen.getByLabelText('Açıklama'), { target: { value: 'kisa' } });
    fireEvent.click(screen.getByRole('button', { name: /Kaydet/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Kayit reddedildi'));
    const govde = api.saveSsItem.mock.calls[0][0];
    expect(govde).toMatchObject({
      title: 'Saglik',
      description: 'kisa',
      awxServerId: 1,
      awxTemplateId: 10,
      enabled: false,
    });
    expect(govde.order).toBeLessThan(2 ** 31);

    api.saveSsItem.mockResolvedValueOnce({ ok: true, item: { id: 'x1', title: 'Saglik' } });
    fireEvent.click(screen.getByRole('button', { name: /Kaydet/ }));
    expect(await screen.findByText('alan incelemesi Saglik')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('"Saglik" self service kataloğuna eklendi.');
    fireEvent.click(screen.getByRole('button', { name: 'incelemeyi kapat' }));
    expect(screen.queryByText('alan incelemesi Saglik')).toBeNull();
    expect(screen.queryByText('Saglik kontrolu')).toBeNull();
  });

  it('bilgi penceresi detay alinamazsa hata gosterir; mini form iptal edilir', async () => {
    api.templateDetail.mockResolvedValueOnce({ ok: false, message: 'Detay yok' });
    await sayfa();
    const kart = screen.getByText('Deploy App').closest('div.rounded-xl') as HTMLElement;
    fireEvent.click(within(kart).getByRole('button', { name: /Bilgi/ }));
    expect(await screen.findByText('Detay yok')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Self Service Olarak Ekle/ })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Kapat' }).at(-1)!);
    api.templateDetail.mockRejectedValueOnce(new Error('ag hatasi'));
    fireEvent.click(within(kart).getByRole('button', { name: /Bilgi/ }));
    expect(await screen.findByText('ag hatasi')).toBeTruthy();
  });
});
