// @vitest-environment jsdom
// "Alanları Yönet" penceresi (2026-11-26, kapsam PR-2; dal %25): AWX alanlari (gizli alan varsayilani, secenek kaynagi
// ve parametre baglama, kodla bagli alan), launch secenekleri, cikti filtresi, kullanici bilgisi, OCO ortam listesi,
// Smart onayi (metadata sorgusu, otomatik doldur, onizleme), oneriler, kaydetme dogrulamalari ve gonderilen yuk;
// survey tasarimcisi (eski kosul bicimlerinin normallesmesi, alan ekle / tasi / kaldir, secenekler, kosul gruplari,
// tasarimci dogrulamalari); yukleme hatalari ve gecmis surumler (geri yukleme).
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
const toastHata = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useToast', () => ({
  toast: { error: toastHata, success: vi.fn(), info: vi.fn() },
}));
const onay = vi.hoisted(() => ({ cevap: true }));
vi.mock('@/components/common/OnayPenceresi', () => ({
  useOnay: () => ({ onayla: async () => onay.cevap, onayPenceresi: null }),
}));

import FieldOverridesModal from '../FieldOverridesModal';

const OGE = {
  id: 'ss-9',
  title: 'Nginx rate limit',
  description: '',
  awxServerId: 2,
  awxTemplateId: 42,
};
const bayrak = (enabled: boolean) => ({ enabled, default: '' });
// Kodla bagli alan AWX'te gizli isaretli: pencere onu yine gorunur tutar (secenekleri kod verir).
const SPEC = {
  ok: true,
  surveyEnabled: true,
  askVariables: true,
  launchOptions: {
    limit: bayrak(true),
    forks: bayrak(false),
    jobTags: bayrak(false),
    skipTags: bayrak(false),
    verbosity: bayrak(false),
    jobType: bayrak(false),
  },
  fields: [
    {
      name: 'env',
      label: 'Ortam',
      type: 'text',
      required: true,
      description: 'hedef ortam',
      defaultValue: 'test',
      hidden: false,
    },
    {
      name: 'parola',
      label: 'Parola',
      type: 'password',
      required: false,
      description: '',
      defaultValue: '',
      hidden: false,
    },
    {
      name: 'api',
      label: 'API',
      type: 'multiplechoice',
      required: false,
      description: '',
      defaultValue: '',
      hidden: false,
    },
    {
      name: 'islem',
      label: 'Islem',
      type: 'multiplechoice',
      required: false,
      description: '',
      defaultValue: '',
      hidden: true,
      kodlaBagli: true,
    },
  ],
};
const KAYNAKLAR = {
  ok: true,
  sources: [
    {
      name: 'apiler',
      label: 'API listesi',
      params: [
        { name: 'env', label: 'Ortam', required: true },
        { name: 'bolge', label: 'Bolge', required: false },
        // Bir form alaninin adini tasiyan parametre kendiliginden o alana baglanir.
        { name: 'api', label: 'API alani', required: false },
      ],
      options: [{ name: 'limit', label: 'En fazla', default: '50' }],
    },
  ],
};
const ozellestirme = (ek: Record<string, unknown> = {}) => ({
  ok: true,
  customization: {
    fieldOverrides: [
      { fieldName: 'api', choicesSource: { source: 'apiler', params: { env: 'env' } } },
    ],
    rawExtraVars: 'host_group: web',
    launchOptionOverrides: {},
    outputFilter: { enabled: false, contains: '' },
    customSurveyFields: [],
    injectUserInfo: { enabled: false },
    ocoCheck: { enabled: true },
    dismissedSuggestions: [],
    smartApproval: { enabled: false },
    ...ek,
  },
});

beforeEach(() => {
  // jsdom'da yok: yeni alan eklenince pencere ona kayar.
  Element.prototype.scrollIntoView = vi.fn();
  Object.values(api).forEach((f) => f.mockReset());
  toastHata.mockReset();
  onay.cevap = true;
  api.choiceSources.mockResolvedValue(KAYNAKLAR);
  api.surveySpecAdmin.mockResolvedValue(SPEC);
  api.getCustomization.mockResolvedValue(ozellestirme());
  api.saveCustomization.mockResolvedValue({ ok: true });
});

// Etiket alana bagli degil (htmlFor yok): kapsayicidaki girdi.
const etiketliGirdi = (metin: string) =>
  screen.getByText(metin).parentElement?.querySelector('input') as HTMLInputElement;
const sonHata = () => toastHata.mock.calls.at(-1)?.[0] as string;
const kaydet = () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
const etkin = (baslik: string) =>
  within(screen.getByText(baslik).closest('div')?.parentElement as HTMLElement).getByRole(
    'checkbox',
    {
      name: /Etkin/,
    },
  );

describe('FieldOverridesModal: AWX alanlari', () => {
  it('dogrulamalar sirayla calisir; dolu form dogru yukle kaydedilir', async () => {
    const kapat = vi.fn();
    render(<FieldOverridesModal item={OGE} onClose={kapat} />);
    expect(await screen.findByText('Ortam')).toBeTruthy();
    // Parola alani ayari yoksa gizli onerilir; varsayilani bos oldugu icin kaydetme durur.
    kaydet();
    await waitFor(() =>
      expect(sonHata()).toBe(
        '"Parola" gizli ama varsayılan değeri yok — önce bir varsayılan değer girin.',
      ),
    );
    fireEvent.change(etiketliGirdi('Varsayılan Değer (zorunlu — kullanıcı bu alanı görmeyecek)'), {
      target: { value: 'gizli-varsayilan' },
    });

    // Launch secenegi: gizli ama varsayilansiz.
    const limit = screen.getByText('Limit').closest('div')?.parentElement as HTMLElement;
    fireEvent.click(within(limit).getByRole('checkbox'));
    kaydet();
    await waitFor(() =>
      expect(sonHata()).toBe(
        '"Limit" gizli ama varsayılan değeri yok — önce bir varsayılan değer girin.',
      ),
    );
    fireEvent.change(within(limit).getByPlaceholderText('Varsayılan değer (zorunlu)'), {
      target: { value: 'web' },
    });

    // Cikti filtresi: etkin ama metin bos.
    fireEvent.click(screen.getByLabelText(/Yalnızca belirli satırları göster/));
    kaydet();
    await waitFor(() => expect(sonHata()).toContain('Çıktı filtresi etkin ama aranacak metin boş'));
    fireEvent.change(screen.getByPlaceholderText('Aranacak metin (ör. ——)'), {
      target: { value: '——' },
    });

    // Smart: etkin ama Flow Key bos.
    fireEvent.click(etkin('Smart Onayı Gerekli (opsiyonel)'));
    kaydet();
    await waitFor(() => expect(sonHata()).toContain('Smart onayı etkin ama Flow Key boş'));
    fireEvent.change(screen.getByPlaceholderText('ör. VIRTUAL_SERVER_TICKET_FLOW'), {
      target: { value: ' AKIS_1 ' },
    });

    // Kullanici bilgisi: bos anahtar varsayilana duser.
    fireEvent.click(etkin('Kullanıcı Bilgisi Ekle (opsiyonel)'));
    fireEvent.change(screen.getByPlaceholderText('email'), { target: { value: ' ' } });
    fireEvent.change(screen.getByPlaceholderText('username'), { target: { value: ' kadi ' } });

    // OCO ortam listesi: ac, production'i cikar (uyari), hepsini cikar (uyari), varsayilana don, yeniden ac.
    fireEvent.click(screen.getByRole('button', { name: 'ortam seç' }));
    for (const e of ['prod', 'production'])
      fireEvent.click(screen.getByRole('checkbox', { name: e }));
    expect(screen.getByText(/production yok/)).toBeTruthy();
    for (const e of ['preprod', 'test', 'dev', 'lab'])
      fireEvent.click(screen.getByRole('checkbox', { name: e }));
    expect(screen.getByText(/Hiçbir ortam seçili değil/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'varsayılana dön (yalnızca production)' }));
    fireEvent.click(screen.getByRole('button', { name: 'ortam seç' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'lab' }));

    fireEvent.change(screen.getByPlaceholderText(/^anahtar: değer/), {
      target: { value: '  ' },
    });
    kaydet();
    await waitFor(() => expect(kapat).toHaveBeenCalled());
    const [sunucu, sablon, yuk] = api.saveCustomization.mock.calls[0];
    expect([sunucu, sablon]).toEqual([2, 42]);
    expect(yuk.fieldOverrides).toEqual([
      { fieldName: 'env', label: 'Ortam', defaultValue: 'test', hidden: false },
      { fieldName: 'parola', label: 'Parola', defaultValue: 'gizli-varsayilan', hidden: true },
      {
        fieldName: 'api',
        label: 'API',
        defaultValue: '',
        hidden: false,
        choicesSource: { source: 'apiler', params: { env: 'env' } },
      },
      { fieldName: 'islem', label: 'Islem', defaultValue: '', hidden: false },
    ]);
    expect(yuk.rawExtraVars).toBeUndefined();
    expect(yuk.launchOptionOverrides).toEqual({ limit: { hidden: true, default: 'web' } });
    expect(yuk.outputFilter).toEqual({ enabled: true, contains: '——' });
    expect(yuk.injectUserInfo).toEqual({ enabled: true, emailKey: 'email', usernameKey: 'kadi' });
    expect(yuk.ocoCheck).toEqual({
      enabled: true,
      environments: ['prod', 'production', 'preprod', 'test', 'dev'],
    });
    expect(yuk.smartApproval).toEqual({
      enabled: true,
      flowKey: 'AKIS_1',
      metadataFields: undefined,
      integrationKey: undefined,
      skipWhen: undefined,
    });
  });

  it('secenek kaynagi: parametre baglanmadan kaydedilmez; kodla bagli alan kilitli; kayit hatasi', async () => {
    render(<FieldOverridesModal item={OGE} onClose={vi.fn()} />);
    await screen.findByText('Ortam');
    // Kodla bagli alan: secim tipi metne doner, gorunurluk degistirilemez.
    const kodlu = screen.getByText('Islem').closest('div')?.parentElement as HTMLElement;
    expect((within(kodlu).getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    // Mevcut kaynakli alanin secici ve secenegi gorunur.
    const kaynaklar = screen.getAllByLabelText(
      'Seçenek kaynağı (serbest metin yerine envanterden liste)',
    );
    // env (text) ve api (kaynakli -> text): iki secici.
    expect(kaynaklar).toHaveLength(2);
    expect((kaynaklar[1] as HTMLSelectElement).value).toBe('apiler');
    fireEvent.change(kaynaklar[0], { target: { value: 'apiler' } });
    // Kendi adiyla ayni parametre kendine baglanmaz -> zorunlu parametre bos.
    expect(screen.getAllByText('En fazla')).toHaveLength(2);
    fireEvent.change(etiketliGirdi('Varsayılan Değer (zorunlu — kullanıcı bu alanı görmeyecek)'), {
      target: { value: 'x' },
    });
    kaydet();
    await waitFor(() => expect(sonHata()).toMatch(/Ortam/));
    expect(api.saveCustomization).not.toHaveBeenCalled();
    // Parametreyi bagla, secenegi degistir.
    // Select kendi sarmalayicisinda: duzenleyicinin koku iki ust.
    const envKutusu = kaynaklar[0].parentElement?.parentElement as HTMLElement;
    const [ortamPar] = within(envKutusu).getAllByRole('combobox').slice(1);
    fireEvent.change(ortamPar, { target: { value: 'api' } });
    fireEvent.change(within(envKutusu).getAllByPlaceholderText('50')[0], {
      target: { value: '10' },
    });
    api.saveCustomization.mockResolvedValueOnce({ ok: false, message: 'yazma reddedildi' });
    kaydet();
    await waitFor(() => expect(sonHata()).toBe('yazma reddedildi'));
    const yuk = api.saveCustomization.mock.calls[0][2];
    expect(yuk.fieldOverrides[0].choicesSource).toEqual({
      source: 'apiler',
      params: { env: 'api', bolge: '', api: 'api' },
      optional: ['bolge', 'api'],
      options: { limit: '10' },
    });
    // Kaynagi kapat.
    fireEvent.change(kaynaklar[0], { target: { value: '' } });
    api.saveCustomization.mockRejectedValueOnce(new Error('ag koptu'));
    kaydet();
    await waitFor(() => expect(sonHata()).toBe('ag koptu'));
    expect(api.saveCustomization.mock.calls[1][2].fieldOverrides[0].choicesSource).toBeUndefined();
  });

  it('Smart: metadata sorgusu, otomatik doldur, onizleme; oneriler', async () => {
    api.getCustomization.mockResolvedValue(
      ozellestirme({
        smartApproval: {
          enabled: true,
          flowKey: 'AKIS_1',
          metadataFields: '',
          integrationKey: 'ik',
          skipWhen: 'env: test',
        },
        ocoCheck: { enabled: false },
      }),
    );
    render(<FieldOverridesModal item={OGE} onClose={vi.fn()} />);
    await screen.findByText('Ortam');
    const sorgula = screen.getByTitle(
      "Smart'ın bu flow için beklediği metadata alanlarını sorgula",
    );
    api.smartFlowMetadata.mockResolvedValueOnce({ ok: false, message: 'flow yok' });
    fireEvent.click(sorgula);
    expect(await screen.findByText(/flow yok/)).toBeTruthy();
    api.smartFlowMetadata.mockRejectedValueOnce(new Error('zaman asimi'));
    fireEvent.click(sorgula);
    expect(await screen.findByText(/zaman asimi/)).toBeTruthy();
    api.smartFlowMetadata.mockResolvedValueOnce({
      ok: true,
      fields: [{ ElementName: 'ACIKLAMA', ComponentType: 'TEXTBOX', IsRequired: 'true' }],
    });
    fireEvent.click(sorgula);
    await waitFor(() => expect(api.smartFlowMetadata).toHaveBeenLastCalledWith('AKIS_1'));
    const doldur = await screen.findByRole('button', { name: /Otomatik Doldur/ });
    fireEvent.click(doldur);
    const esleme = screen
      .getAllByRole('textbox')
      .find((t) => (t as HTMLTextAreaElement).value.includes('ACIKLAMA: {{username}}'));
    expect(esleme).toBeTruthy();

    // Onizleme degiskenleri: iki noktasiz satir ve bos anahtar atlanir; virgullu YOL listeye bolunur.
    const degiskenler = screen
      .getAllByRole('textbox')
      .find((t) => (t as HTMLTextAreaElement).value.startsWith('action: create')) as HTMLElement;
    fireEvent.change(degiskenler, {
      target: { value: 'action: create\nbozuk satir\n: bos\ninput_path: /a, /b\nliste: x, y' },
    });
    api.smartMetadataPreview.mockResolvedValueOnce({ ok: false, message: 'sablon hatali' });
    fireEvent.click(screen.getByRole('button', { name: /Önizle/ }));
    expect(await screen.findByText(/sablon hatali/)).toBeTruthy();
    expect(api.smartMetadataPreview.mock.calls[0][0]).toMatchObject({
      templateName: 'Nginx rate limit',
      extraVars: { action: 'create', input_path: ['/a', '/b'], liste: 'x, y' },
    });
    expect(Object.keys(api.smartMetadataPreview.mock.calls[0][0].extraVars)).toEqual([
      'action',
      'input_path',
      'liste',
    ]);
    api.smartMetadataPreview.mockResolvedValueOnce({
      ok: true,
      metadata: { aciklama: 'Nginx test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Önizle/ }));
    expect(await screen.findByText('Nginx test')).toBeTruthy();
    api.smartMetadataPreview.mockRejectedValueOnce(new Error('ag'));
    fireEvent.click(screen.getByRole('button', { name: /Önizle/ }));
    expect(await screen.findByText(/^ag$|ag$/)).toBeTruthy();
  });
});

describe('FieldOverridesModal: oneriler', () => {
  it('degisiklik sablonu: Smart, OCO, kullanici bilgisi ve parola onerileri uygulanir / reddedilir', async () => {
    api.surveySpecAdmin.mockResolvedValue({
      ...SPEC,
      fields: [
        ...SPEC.fields.slice(0, 2),
        {
          name: 'username',
          label: 'Kullanici',
          type: 'text',
          required: false,
          description: '',
          defaultValue: '',
          hidden: false,
        },
      ],
    });
    // Parola alaninin ayari VAR ve gorunur: gizleme onerisi cikar.
    api.getCustomization.mockResolvedValue(
      ozellestirme({
        fieldOverrides: [{ fieldName: 'parola', hidden: false }],
        ocoCheck: { enabled: false },
      }),
    );
    const kapat = vi.fn();
    render(
      <FieldOverridesModal item={{ ...OGE, title: 'Nginx rate limit güncelle' }} onClose={kapat} />,
    );
    expect(await screen.findByText('4 yapılandırma önerisi')).toBeTruthy();
    // Basliktan yukari: dugme tasiyan ilk kapsayici o onerinin kartidir.
    const uygula = (baslik: string) => {
      let kart: HTMLElement | null = screen.getByText(baslik);
      while (kart && !kart.querySelector('button')) kart = kart.parentElement;
      fireEvent.click(within(kart as HTMLElement).getByRole('button', { name: 'Uygula' }));
    };
    uygula('Smart onayı önerilir');
    expect((etkin('Smart Onayı Gerekli (opsiyonel)') as HTMLInputElement).checked).toBe(true);
    uygula('OCO kesinti penceresi kontrolü önerilir');
    expect((etkin('OCO Kontrolü (opsiyonel)') as HTMLInputElement).checked).toBe(true);
    uygula('Kullanıcı bilgisini sunucu enjekte etsin');
    expect((etkin('Kullanıcı Bilgisi Ekle (opsiyonel)') as HTMLInputElement).checked).toBe(true);
    uygula('"parola" alanı gizlensin');
    expect(screen.queryByText(/yapılandırma önerisi/)).toBeNull();
    const parola = screen.getByText('Parola').closest('div')?.parentElement as HTMLElement;
    expect(
      (within(parola).getByRole('checkbox', { name: /Kullanıcıya göster/ }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    // Smart'i kapatinca oneri geri gelir; "bu sablonda onerme" kalici reddeder.
    fireEvent.click(etkin('Smart Onayı Gerekli (opsiyonel)'));
    expect(await screen.findByText('1 yapılandırma önerisi')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bu şablonda önerme' }));
    expect(screen.queryByText(/yapılandırma önerisi/)).toBeNull();
    fireEvent.change(etiketliGirdi('Varsayılan Değer (zorunlu — kullanıcı bu alanı görmeyecek)'), {
      target: { value: 'p' },
    });
    kaydet();
    await waitFor(() => expect(kapat).toHaveBeenCalled());
    const yuk = api.saveCustomization.mock.calls[0][2];
    expect(yuk.dismissedSuggestions).toEqual(['smartApproval']);
    expect(yuk.ocoCheck).toEqual({ enabled: true });
    expect(yuk.injectUserInfo.enabled).toBe(true);
    expect(
      yuk.fieldOverrides.find((f: { fieldName: string }) => f.fieldName === 'parola').hidden,
    ).toBe(true);
  });
});

describe('FieldOverridesModal: survey tasarimcisi', () => {
  beforeEach(() => {
    api.surveySpecAdmin.mockResolvedValue({ ...SPEC, surveyEnabled: false, fields: [] });
    api.getCustomization.mockResolvedValue(
      ozellestirme({
        fieldOverrides: [],
        customSurveyFields: [
          {
            name: 'ortam',
            label: 'Ortam',
            type: 'multiplechoice',
            required: true,
            defaultValue: '',
            choices: ['test', 'prod'],
            hidden: false,
            description: '',
          },
          // Eski bicim: tek {field, equals}.
          {
            name: 'neden',
            label: 'Neden',
            type: 'text',
            required: false,
            defaultValue: '',
            choices: [],
            hidden: false,
            description: '',
            dependsOn: { field: 'ortam', equals: 'prod' },
          },
          // Eski bicim: tek grup kosul dizisi.
          {
            name: 'onay',
            label: 'Onay',
            type: 'text',
            required: false,
            defaultValue: '',
            choices: [],
            hidden: false,
            description: '',
            dependsOn: {
              mode: 'all',
              conditions: [
                { field: 'ortam', equals: 'prod' },
                { field: 'neden', operator: 'notEmpty' },
                null,
              ],
            },
          },
          // Bozuk kosul: yok sayilir.
          {
            name: 'bozuk',
            label: 'Bozuk',
            type: 'text',
            required: false,
            defaultValue: '',
            choices: [],
            hidden: false,
            description: '',
            dependsOn: 'x',
          },
        ],
      }),
    );
  });

  it('kendine ya da olmayan alana bagli kosul kaydedilmez', async () => {
    api.getCustomization.mockResolvedValue(
      ozellestirme({
        customSurveyFields: [
          {
            name: 'a',
            label: 'A',
            type: 'text',
            required: false,
            defaultValue: '',
            choices: [],
            hidden: false,
            description: '',
            dependsOn: { field: 'a', equals: 'x' },
          },
        ],
      }),
    );
    const a = render(<FieldOverridesModal item={OGE} onClose={vi.fn()} />);
    await screen.findByText('Alan 1');
    kaydet();
    await waitFor(() => expect(sonHata()).toBe('"A" için geçerli bir koşul alanı seçin.'));
    expect(api.saveCustomization).not.toHaveBeenCalled();
    a.unmount();
    toastHata.mockReset();
    api.getCustomization.mockResolvedValue(
      ozellestirme({
        customSurveyFields: [
          {
            name: 'b',
            label: 'B',
            type: 'text',
            required: false,
            defaultValue: '',
            choices: [],
            hidden: false,
            description: '',
            dependsOn: { field: 'yok', equals: 'x' },
          },
        ],
      }),
    );
    render(<FieldOverridesModal item={OGE} onClose={vi.fn()} />);
    await screen.findByText('Alan 1');
    kaydet();
    await waitFor(() => expect(sonHata()).toBe('"B" için geçerli bir koşul alanı seçin.'));
  });

  it('eski kosul bicimleri normallesir ve okunur ozetlenir', async () => {
    render(<FieldOverridesModal item={OGE} onClose={vi.fn()} />);
    expect(await screen.findByText(/survey <\/strong>|AWX survey/)).toBeTruthy();
    expect(screen.getByText('Ortam = "prod"')).toBeTruthy();
    expect(screen.getByText('Ortam = "prod" VE Neden doldurulduysa')).toBeTruthy();
    expect(screen.getAllByText(/Alan \d/).length).toBeGreaterThanOrEqual(4);
  });

  it('alan ekle, tasi, secenekler, kosul gruplari ve tasarimci dogrulamalari', async () => {
    const kapat = vi.fn();
    render(<FieldOverridesModal item={OGE} onClose={kapat} />);
    await screen.findByText('Ortam = "prod"');
    // Bozuk alani kaldir.
    const kutu = (n: number) =>
      screen.getByText(`Alan ${n}`).closest('div')?.parentElement as HTMLElement;
    fireEvent.click(within(kutu(4)).getByRole('button', { name: /Alanı Kaldır/ }));
    expect(screen.queryByText('Alan 4')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Alan Ekle/ }));
    expect(screen.getByText('Alan 4')).toBeTruthy();
    kaydet();
    await waitFor(() =>
      expect(sonHata()).toBe('Her özel survey alanının bir değişken adı ve görünen adı olmalı.'),
    );
    const yeni = kutu(4);
    fireEvent.change(within(yeni).getByPlaceholderText('ör. Hedef Ortam'), {
      target: { value: 'Bolge' },
    });
    fireEvent.change(within(yeni).getByPlaceholderText('ör. target_env'), {
      target: { value: '1bolge' },
    });
    kaydet();
    await waitFor(() => expect(sonHata()).toMatch(/1bolge/));
    fireEvent.change(within(yeni).getByPlaceholderText('ör. target_env'), {
      target: { value: 'ortam' },
    });
    kaydet();
    await waitFor(() => expect(sonHata()).toBe('Değişken adı tekrar ediyor: "ortam"'));
    fireEvent.change(within(yeni).getByPlaceholderText('ör. target_env'), {
      target: { value: 'bolge' },
    });
    fireEvent.click(within(yeni).getByLabelText('Kullanıcıdan gizle'));
    kaydet();
    await waitFor(() => expect(sonHata()).toMatch(/Bolge/));
    fireEvent.click(within(yeni).getByLabelText('Kullanıcıdan gizle'));
    // Secim tipi ama secenek yok.
    fireEvent.change(within(yeni).getByLabelText('Tip'), { target: { value: 'multiplechoice' } });
    kaydet();
    await waitFor(() => expect(sonHata()).toBe('"Bolge" bir seçim alanı ama hiç seçeneği yok.'));
    fireEvent.click(within(yeni).getByRole('button', { name: /Seçenek Ekle/ }));
    fireEvent.click(within(yeni).getByRole('button', { name: /Seçenek Ekle/ }));
    const degerler = within(yeni).getAllByPlaceholderText('değer');
    fireEvent.change(degerler[0], { target: { value: 'ist' } });
    fireEvent.change(within(yeni).getAllByPlaceholderText('görünen ad (opsiyonel)')[0], {
      target: { value: 'Istanbul' },
    });
    // Deger degisince gorunen ad yeni degere tasinir.
    fireEvent.change(degerler[0], { target: { value: 'ist1' } });
    fireEvent.change(degerler[1], { target: { value: 'ank' } });
    fireEvent.click(within(yeni).getAllByTitle('Seçeneği kaldır')[1]);
    fireEvent.change(within(yeni).getByPlaceholderText(/Kullanıcıya gösterilecek ipucu/), {
      target: { value: 'bolge secin' },
    });

    // Kosullu goster: kosul alani secilmeden gecersiz.
    fireEvent.click(within(yeni).getByLabelText(/Koşullu göster/));
    kaydet();
    await waitFor(() => expect(sonHata()).toMatch(/Bolge/));
    const kosulAlani = () =>
      within(kutu(4))
        .getAllByRole('combobox')
        .filter((s) => within(s).queryByText('Alan secin...'));
    fireEvent.change(kosulAlani()[0], { target: { value: 'ortam' } });
    fireEvent.change(within(kutu(4)).getByPlaceholderText('or. deactive'), {
      target: { value: 'prod' },
    });
    fireEvent.click(within(kutu(4)).getByRole('button', { name: /Kosul Ekle/ }));
    fireEvent.change(kosulAlani()[1], { target: { value: 'neden' } });
    const operatorler = within(kutu(4))
      .getAllByRole('combobox')
      .filter((s) => within(s).queryByText('su degere esitse'));
    fireEvent.change(operatorler[1], { target: { value: 'notEmpty' } });
    expect(within(kutu(4)).getByText('bos birakilmadikca')).toBeTruthy();
    fireEvent.click(within(kutu(4)).getByLabelText('Hepsi (VE)'));
    expect(within(kutu(4)).getByText('Ortam = "prod" VE Neden doldurulduysa')).toBeTruthy();
    fireEvent.click(within(kutu(4)).getByRole('button', { name: /Grup Ekle/ }));
    fireEvent.change(kosulAlani()[2], { target: { value: 'onay' } });
    fireEvent.change(within(kutu(4)).getAllByPlaceholderText('or. deactive')[1], {
      target: { value: 'evet' },
    });
    fireEvent.click(within(kutu(4)).getByLabelText('Herhangi bir grup (VEYA)'));
    expect(
      within(kutu(4)).getByText('(Ortam = "prod" VE Neden doldurulduysa) VEYA Onay = "evet"'),
    ).toBeTruthy();
    // Ikinci grubun TEK kosulu kaldirilinca grup da duser (tek grup kalinca "Grubu kaldir" yok).
    fireEvent.click(within(kutu(4)).getAllByTitle('Koşulu kaldır')[2]);
    expect(within(kutu(4)).queryAllByTitle('Grubu kaldır')).toHaveLength(0);
    expect(within(kutu(4)).getByText('Ortam = "prod" VE Neden doldurulduysa')).toBeTruthy();
    fireEvent.click(within(kutu(4)).getByRole('button', { name: /Grup Ekle/ }));
    fireEvent.click(within(kutu(4)).getAllByTitle('Grubu kaldır')[1]);
    expect(within(kutu(4)).queryAllByTitle('Grubu kaldır')).toHaveLength(0);
    // Ilk grubun bir kosulu kaldirilinca (grupta kosul kalir) grup durur.
    fireEvent.click(within(kutu(4)).getAllByTitle('Koşulu kaldır')[1]);
    expect(within(kutu(4)).getByText('Ortam = "prod"')).toBeTruthy();

    // Tasima: son alani yukari tasi; ilk alani yukari tasimak etkisiz.
    fireEvent.click(within(kutu(4)).getByTitle('Yukarı taşı'));
    expect(within(kutu(3)).getByDisplayValue('Bolge')).toBeTruthy();
    fireEvent.click(within(kutu(1)).getByTitle('Yukarı taşı'));
    fireEvent.click(within(kutu(4)).getByTitle('Aşağı taşı'));
    expect(within(kutu(4)).getByDisplayValue('Onay')).toBeTruthy();

    kaydet();
    await waitFor(() => expect(kapat).toHaveBeenCalled());
    const ozel = api.saveCustomization.mock.calls.at(-1)?.[2].customSurveyFields;
    expect(ozel.map((f: { name: string }) => f.name)).toEqual(['ortam', 'neden', 'bolge', 'onay']);
    expect(ozel[2]).toMatchObject({
      label: 'Bolge',
      type: 'multiplechoice',
      choices: ['ist1'],
      choiceLabels: { ist1: 'Istanbul' },
      description: 'bolge secin',
      dependsOn: {
        mode: 'any',
        groups: [
          { mode: 'all', conditions: [{ field: 'ortam', equals: 'prod', operator: 'equals' }] },
        ],
      },
    });
  });
});

describe('FieldOverridesModal: yukleme ve gecmis', () => {
  it('alanlar yuklenemedi; mevcut ayarlar okunamadi -> kaydetme kilitli', async () => {
    api.surveySpecAdmin.mockResolvedValueOnce({ ok: false, message: 'template yok' });
    const a = render(<FieldOverridesModal item={OGE} onClose={vi.fn()} />);
    await waitFor(() => expect(toastHata).toHaveBeenCalledWith('template yok', 8000));
    a.unmount();
    api.getCustomization.mockRejectedValueOnce(new Error('DB kapali'));
    const b = render(<FieldOverridesModal item={OGE} onClose={vi.fn()} />);
    expect(await screen.findByText(/Mevcut ayarlar okunamadı \(DB kapali\)/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Kaydet (kilitli)' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    b.unmount();
    api.getCustomization.mockResolvedValueOnce({ ok: false });
    const c = render(<FieldOverridesModal item={OGE} onClose={vi.fn()} />);
    expect(await screen.findByText(/sunucu hatası/)).toBeTruthy();
    c.unmount();
    api.surveySpecAdmin.mockRejectedValueOnce(new Error('awx kapali'));
    render(<FieldOverridesModal item={OGE} onClose={vi.fn()} />);
    await waitFor(() => expect(toastHata).toHaveBeenCalledWith('awx kapali', 8000));
  });

  it('gecmis surumler: liste, geri yukleme (iptal / hata / basari), bos gecmis', async () => {
    api.customizationHistory.mockResolvedValueOnce({
      ok: true,
      items: [
        {
          id: 7,
          savedAt: '2026-11-20T10:00:00Z',
          savedBy: 'ayse',
          reason: 'restore',
          customSurveyFields: 2,
          fieldOverrides: 1,
          smart: true,
          oco: true,
          customFieldNames: ['ortam', 'neden'],
        },
        {
          id: 6,
          savedAt: '2026-11-19T10:00:00Z',
          savedBy: '',
          reason: 'save',
          customSurveyFields: 0,
          fieldOverrides: 3,
          smart: false,
          oco: false,
          customFieldNames: [],
        },
      ],
    });
    render(<FieldOverridesModal item={OGE} onClose={vi.fn()} />);
    await screen.findByText('Ortam');
    // Ozet satirina tiklamak <details>'i acar ve toggle olayini tetikler.
    fireEvent.click(
      (screen.getByText(/Geçmiş sürümler/).closest('details') as HTMLElement).querySelector(
        'summary',
      ) as HTMLElement,
    );
    const baslik = await screen.findByTitle('ortam, neden');
    const satirMetni = baslik.parentElement?.textContent || '';
    expect(satirMetni).toContain('ayse · restore');
    expect(satirMetni).toContain('2 tasarımcı alanı, 1 AWX alan ayarı · Smart · OCO');
    const geriYukle = () => screen.getAllByRole('button', { name: 'Geri yükle' })[0];
    onay.cevap = false;
    fireEvent.click(geriYukle());
    await Promise.resolve();
    expect(api.restoreCustomization).not.toHaveBeenCalled();
    onay.cevap = true;
    api.restoreCustomization.mockResolvedValueOnce({ ok: false, message: 'surum bulunamadi' });
    fireEvent.click(geriYukle());
    await waitFor(() => expect(sonHata()).toBe('surum bulunamadi'));
    expect(api.restoreCustomization).toHaveBeenCalledWith(2, 42, 7);
    api.restoreCustomization.mockRejectedValueOnce(new Error('ag'));
    fireEvent.click(geriYukle());
    await waitFor(() => expect(sonHata()).toBe('ag'));
    const n = api.surveySpecAdmin.mock.calls.length;
    api.restoreCustomization.mockResolvedValueOnce({ ok: true });
    fireEvent.click(geriYukle());
    await waitFor(() => expect(api.surveySpecAdmin.mock.calls.length).toBe(n + 1));
    // Yeniden yuklemeden sonra gecmis kapali; yeniden acinca tekrar istenir (bu kez hata -> bos).
    api.customizationHistory.mockRejectedValueOnce(new Error('x'));
    fireEvent.click(
      (
        (await screen.findByText(/Geçmiş sürümler/)).closest('details') as HTMLElement
      ).querySelector('summary') as HTMLElement,
    );
    expect(await screen.findByText(/Bu servis için kayıtlı geçmiş yok/)).toBeTruthy();
  });
});
