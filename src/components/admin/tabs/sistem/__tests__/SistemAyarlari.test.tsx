// src/components/admin/tabs/sistem/__tests__/SistemAyarlari.test.tsx — Admin > Sistem davranisi.
//
// Gercek bilesen ve gercek istemci kodu calisir; yalniz `fetch` sahtedir (HataYokDegil deseni).
// Kapali gruplar `inert` ama MONTE: satirlar DOM'da, sorgular satirin kendi kabinda yapilir.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import { render } from '@/test/test-utils';
import SystemConfigTab from '@/components/admin/tabs/SystemConfigTab';
import { ENV_VARS } from '../ortamDegiskenleri';
import { GRUPLAR } from '../gruplar';
import { restartBekleyeneEkle, saklananTaslaklar, sistemOturumunuSifirla } from '../sistemOturumu';
import { onayGerekce, tehlikeliDeger, type ConfigValue } from '../ayarKurallari';
import { ogeyeKaydir } from '../kaydir';
import { toast } from '@/hooks/useToast';

// Oturum deposu KULLANICIYA BAGLI (denetim 2026-10-15): cikis + baska admin girisi sayfayi
// yenilemez; onceki adminin taslagi yeni admine gorunmemeli. Kimlik testte degistirilebilir.
const kimlik = vi.hoisted(() => ({ kullanici: 'admin1' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { username: kimlik.kullanici } }) }));

type Yanit = () => Response | Promise<Response>;
const json =
  (status: number, body: unknown): Yanit =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const DEGERLER = [
  { key: 'PORT', value: '3000', defined: true, masked: false, source: 'env', hotReloadable: false },
  { key: 'MSSQL_SERVER', value: 'db01.kurum', defined: true, masked: false, source: 'env', hotReloadable: false },
  { key: 'MSSQL_DATABASE', value: 'TBMWANS', defined: true, masked: false, source: 'env', hotReloadable: false },
  { key: 'MSSQL_RO_PASSWORD', value: 'qx•••zz', defined: true, masked: true, source: 'db', hotReloadable: false },
  { key: 'LDAP_URL', value: 'ldaps://dc', defined: true, masked: false, source: 'env', hotReloadable: false },
  { key: 'LDAP_BASE_DN', value: 'DC=kurum', defined: true, masked: false, source: 'env', hotReloadable: false },
  { key: 'AWX_URL', value: 'https://awx', defined: true, masked: false, source: 'env', hotReloadable: false },
  { key: 'SESSION_IDLE_MINUTES', value: '60', defined: true, masked: false, source: 'env', hotReloadable: true },
  { key: 'CSRF_ORIGIN_CHECK', value: 'enforce', defined: true, masked: false, source: 'env', hotReloadable: true },
  { key: 'OPSX_SMART_FLOW_KEY_LEGACY', value: '', defined: false, masked: false, source: 'env', hotReloadable: false },
];

/** Istek kurallari: (url, yontem) -> yanit. Eslesmeyen her istek "basarili ve bos". */
let kural: (url: string, yontem: string, govde: unknown) => Yanit | null = () => null;
const putlar: { key: string; value: string }[] = [];

beforeEach(() => {
  kimlik.kullanici = 'admin1';
  sistemOturumunuSifirla();
  putlar.length = 0;
  try {
    window.localStorage.clear();
  } catch {
    /* jsdom */
  }
  kural = () => null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (girdi: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof girdi === 'string' ? girdi : girdi instanceof URL ? girdi.href : girdi.url;
      const yontem = (init?.method || 'GET').toUpperCase();
      const govde = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (u.includes('/api/admin/system-config') && yontem === 'PUT') putlar.push(govde);
      const ozel = kural(u, yontem, govde);
      if (ozel) return ozel();
      if (u.includes('/api/admin/system-config') && yontem === 'GET') {
        return json(200, { ok: true, values: DEGERLER })();
      }
      return json(200, { ok: true })();
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const satir = (key: string) => {
  const el = document.getElementById(`ayar-${key}`);
  if (!el) throw new Error(`${key} satiri yok`);
  return el;
};

async function yuklendi() {
  await screen.findByText('3000');
}

function duzenle(key: string) {
  const s = satir(key);
  fireEvent.click(within(s).getByRole('button', { name: new RegExp(`\\(${key}\\) ayarını düzenle$`) }));
  return s;
}

/** Anahtarin grup kartindaki ac/kapa dugmesi. */
function grupBasligi(key: string) {
  const ad = ENV_VARS.find((m) => m.key === key)?.group;
  const g = GRUPLAR.find((x) => x.ad === ad);
  const el = g && document.querySelector<HTMLButtonElement>(`[data-grup="${g.id}"] h4 button`);
  if (!el) throw new Error(`${key} grup basligi yok`);
  return el;
}

describe('Admin > Sistem', () => {
  it('SA0 her meta girdisi bir gruba dusuyor; grup adlari benzersiz', () => {
    const adlar = new Set(GRUPLAR.map((g) => g.ad));
    expect(adlar.size).toBe(GRUPLAR.length);
    expect(ENV_VARS.filter((m) => !adlar.has(m.group)).map((m) => m.key)).toEqual([]);
  });

  it('SA1 gizli deger duzenleyicisi password, new-password, bos; bosken Kaydet kapali', async () => {
    render(<SystemConfigTab />);
    await yuklendi();
    const s = duzenle('MSSQL_RO_PASSWORD');
    const kutu = within(s).getByLabelText('Yeni değer') as HTMLInputElement;
    expect(kutu.type).toBe('password');
    expect(kutu.getAttribute('autocomplete')).toBe('new-password');
    expect(kutu.value).toBe('');
    expect((within(s).getByRole('button', { name: 'Kaydet' }) as HTMLButtonElement).disabled).toBe(true);
    // Maskeli onizleme title ya da kopyalama tasimaz.
    expect(within(s).queryByTitle(/qx/)).toBeNull();
    // Yazilan sir DOM'un `value` OZNITELIGINE dusmez (kontrollu input React'te onu esitler;
    // outerHTML / MutationObserver / CSS oznitelik secicisi okuyabilirdi).
    fireEvent.change(kutu, { target: { value: 'Sir-Deger-7788' } });
    expect(kutu.getAttribute('value') ?? '').not.toContain('Sir-Deger-7788');
    expect(document.body.innerHTML).not.toContain('Sir-Deger-7788');
    expect((within(s).getByRole('button', { name: 'Kaydet' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('SA2 "Değeri sil…" onay ister; İptal PUT gondermez, "Yine de kaydet" bos deger yazar', async () => {
    kural = (u, y) => (y === 'PUT' ? json(200, { ok: true, restartRequired: true }) : null);
    render(<SystemConfigTab />);
    await yuklendi();
    const s = duzenle('MSSQL_RO_PASSWORD');
    fireEvent.click(within(s).getByRole('button', { name: 'Değeri sil…' }));
    let pencere = await screen.findByRole('dialog');
    expect(pencere.textContent).toMatch(/ortam dosyasındaki değere dönmek değildir/);
    expect(pencere.textContent).not.toMatch(/qx/);
    fireEvent.click(within(pencere).getByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(putlar).toEqual([]);

    fireEvent.click(within(satir('MSSQL_RO_PASSWORD')).getByRole('button', { name: 'Değeri sil…' }));
    pencere = await screen.findByRole('dialog');
    fireEvent.click(within(pencere).getByRole('button', { name: 'Yine de kaydet' }));
    await waitFor(() => expect(putlar).toEqual([{ key: 'MSSQL_RO_PASSWORD', value: '' }]));
  });

  it('SA3 sunucu dogrulama hatasi alanin altinda; aria-invalid; duzenleyici acik kalir', async () => {
    kural = (u, y) =>
      y === 'PUT' ? json(400, { ok: false, error: 'SESSION_IDLE_MINUTES 5 ile 720 arasında olmalı.' }) : null;
    render(<SystemConfigTab />);
    await yuklendi();
    const s = duzenle('SESSION_IDLE_MINUTES');
    const kutu = within(s).getByLabelText('Yeni değer') as HTMLInputElement;
    fireEvent.change(kutu, { target: { value: '3' } });
    const kaydetDugmesi = within(s).getByRole('button', { name: 'Kaydet' });
    kaydetDugmesi.focus();
    fireEvent.click(kaydetDugmesi);
    const hata = await within(s).findByRole('alert');
    expect(hata.textContent).toMatch(/5 ile 720/);
    expect(kutu.getAttribute('aria-invalid')).toBe('true');
    expect(kutu.getAttribute('aria-describedby')).toContain(hata.id);
    expect(within(s).getByLabelText('Yeni değer')).toBe(kutu);
    // Kaydet yuklenirken kapanir ve odak dusebilir; hata gelince odak kutuya doner (plan #16).
    await waitFor(() => expect(document.activeElement).toBe(kutu));
  });

  it('SA4 restart bandi PUT yanitina bagli: sicakta yok, soguktta ayari listeler', async () => {
    kural = (u, y, g) =>
      y === 'PUT'
        ? json(200, { ok: true, restartRequired: (g as { key: string }).key !== 'SESSION_IDLE_MINUTES' })
        : null;
    render(<SystemConfigTab />);
    await yuklendi();
    let s = duzenle('SESSION_IDLE_MINUTES');
    fireEvent.change(within(s).getByLabelText('Yeni değer'), { target: { value: '90' } });
    fireEvent.click(within(s).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(putlar.length).toBe(1));
    await waitFor(() => expect(within(satir('SESSION_IDLE_MINUTES')).queryByLabelText('Yeni değer')).toBeNull());
    expect(screen.queryByText(/sunucu yeniden başlatılınca geçerli olacak/)).toBeNull();

    s = duzenle('AWX_URL');
    fireEvent.change(within(s).getByLabelText('Yeni değer'), { target: { value: 'https://awx2' } });
    fireEvent.click(within(s).getByRole('button', { name: 'Kaydet' }));
    const bant = await screen.findByText(/1 değişiklik sunucu yeniden başlatılınca geçerli olacak/);
    expect(within(bant.closest('[role="status"]') as HTMLElement).getByRole('button', { name: 'AWX URL' })).toBeTruthy();
    const kutu = screen.getByRole('button', { name: /Restart bekleyen/ });
    expect(kutu.textContent).toMatch(/1/);
    // Liste modul degiskeninde: F5'te kaybolur ve ekran bunu soyler ("tarayici oturumu" degil).
    const bantKabi = bant.closest('[role="status"]') as HTMLElement;
    expect(bantKabi.textContent).toMatch(/sayfayı yenilerseniz kaybolur/);
    expect(bantKabi.textContent).not.toMatch(/tarayıcı oturumu/);
    expect(kutu.textContent).toMatch(/Bu sayfa açıkken kaydedilen/);
  });

  it('SA5 ayni tick`te iki gonderim tek PUT', async () => {
    let coz: (r: Response) => void = () => {};
    kural = (u, y) => (y === 'PUT' ? () => new Promise<Response>((r) => (coz = r)) : null);
    render(<SystemConfigTab />);
    await yuklendi();
    const s = duzenle('AWX_URL');
    fireEvent.change(within(s).getByLabelText('Yeni değer'), { target: { value: 'https://awx3' } });
    const form = within(s).getByLabelText('Yeni değer').closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(putlar.length).toBe(1);
    await act(async () => {
      coz(await json(200, { ok: true, restartRequired: true })());
    });
    await waitFor(() => expect(within(satir('AWX_URL')).queryByLabelText('Yeni değer')).toBeNull());
    expect(putlar.length).toBe(1);
  });

  it('SA6 nobet onbellegi 404: "Temizlendi" denmez, HTTP 404 soylenir', async () => {
    kural = (u) => (u.includes('/api/admin/cache/nobetci') ? json(404, { ok: false, error: 'Not found' }) : null);
    render(<SystemConfigTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Nöbet listesi önbelleği: temizle' }));
    expect(await screen.findByText(/HTTP 404/)).toBeTruthy();
    expect(screen.queryByText('Temizlendi')).toBeNull();
  });

  it('SA7 kritik / tehlikeli / bosaltma degisiklikleri PUT oncesi onay ister', async () => {
    render(<SystemConfigTab />);
    await yuklendi();
    let s = duzenle('MSSQL_SERVER');
    fireEvent.change(within(s).getByLabelText('Yeni değer'), { target: { value: 'db02.kurum' } });
    fireEvent.click(within(s).getByRole('button', { name: 'Kaydet' }));
    let pencere = await screen.findByRole('dialog');
    expect(pencere.textContent).toMatch(/veritabanı, dizin ya da giriş güvenliği/);
    expect(putlar).toEqual([]);
    fireEvent.click(within(pencere).getByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    s = duzenle('CSRF_ORIGIN_CHECK');
    fireEvent.click(within(s).getByLabelText('off'));
    fireEvent.click(within(s).getByRole('button', { name: 'Kaydet' }));
    pencere = await screen.findByRole('dialog');
    expect(within(pencere).getByRole('button', { name: 'Yine de kaydet' }).className).toMatch(/btn-danger/);
    expect(pencere.textContent).toMatch(/CSRF\) denetimi kapanır/);
    fireEvent.click(within(pencere).getByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    s = duzenle('PORT');
    fireEvent.change(within(s).getByLabelText('Yeni değer'), { target: { value: '' } });
    fireEvent.click(within(s).getByRole('button', { name: 'Kaydet' }));
    pencere = await screen.findByRole('dialog');
    expect(pencere.textContent).toMatch(/Boş kaydetmek ortam dosyasındaki değere dönmek değildir/);
    expect(putlar).toEqual([]);
  });

  it('SA8 salt okunur satirlarda Duzenle yok', async () => {
    render(<SystemConfigTab />);
    await yuklendi();
    const salt = ENV_VARS.filter((m) => m.saltOkunur).map((m) => m.key);
    expect(salt).toEqual(
      expect.arrayContaining(['NODE_ENV', 'SMART_TICKET_TIMEOUT_MINUTES', 'OPSX_SMART_FLOW_KEY_LEGACY', 'OPSX_SMART_INTEGRATION_KEY']),
    );
    for (const k of salt) {
      expect(within(satir(k)).queryByRole('button', { name: /ayarını düzenle/ })).toBeNull();
    }
    expect(within(satir('OPSX_SMART_FLOW_KEY_LEGACY')).getByText("OpsX'te yönetilir")).toBeTruthy();
    expect(within(satir('NODE_ENV')).getByText('Yalnız sunucu ortamı')).toBeTruthy();
  });

  it('SA9 Duzenle dugmelerinin erisilebilir adlari benzersiz ve etiketi icerir', async () => {
    render(<SystemConfigTab />);
    await yuklendi();
    const dugmeler = screen.getAllByRole('button', { name: /ayarını düzenle$/ });
    const adlar = dugmeler.map((d) => d.getAttribute('aria-label') || '');
    expect(new Set(adlar).size).toBe(adlar.length);
    const duzenlenebilir = ENV_VARS.filter((m) => !m.saltOkunur);
    expect(dugmeler.length).toBe(duzenlenebilir.length);
    for (const m of duzenlenebilir) expect(adlar).toContain(`${m.label} (${m.key}) ayarını düzenle`);
  });

  it('SA10 arama: etiket/aciklama/deger eslesir, gizli degerde aranmaz, sonuc yoksa bos durum', async () => {
    render(<SystemConfigTab />);
    await yuklendi();
    const ara = screen.getByRole('searchbox', { name: 'Ayarlarda ara' });
    fireEvent.change(ara, { target: { value: 'ldap' } });
    expect(document.getElementById('ayar-LDAP_URL')).not.toBeNull();
    expect(document.getElementById('ayar-LDAP_BASE_DN')).not.toBeNull();
    expect(document.getElementById('ayar-MSSQL_SERVER')).toBeNull();
    expect(screen.getByText(`${document.querySelectorAll('[id^="ayar-"]').length} ayar gösteriliyor`)).toBeTruthy();

    fireEvent.change(ara, { target: { value: 'db01.kurum' } });
    expect(document.getElementById('ayar-MSSQL_SERVER')).not.toBeNull();

    fireEvent.change(ara, { target: { value: 'qx•••' } });
    expect(document.getElementById('ayar-MSSQL_RO_PASSWORD')).toBeNull();
    expect(screen.getByText('Eşleşen ayar yok')).toBeTruthy();

    fireEvent.change(ara, { target: { value: 'zzz' } });
    expect(screen.getByText('Eşleşen ayar yok')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Aramayı ve süzgeci temizle' }));
    expect(document.querySelectorAll('[id^="ayar-"]').length).toBe(ENV_VARS.length);
  });

  it('SA11 gizli olmayan taslak sekme degisiminde korunur; gizli taslak korunmaz', async () => {
    const ilk = render(<SystemConfigTab />);
    await yuklendi();
    let s = duzenle('PORT');
    fireEvent.change(within(s).getByLabelText('Yeni değer'), { target: { value: '4000' } });
    s = duzenle('MSSQL_RO_PASSWORD');
    fireEvent.change(within(s).getByLabelText('Yeni değer'), { target: { value: 'cokgizli123' } });
    expect([...saklananTaslaklar().keys()]).toEqual(['PORT']);
    ilk.unmount();

    render(<SystemConfigTab />);
    await waitFor(() => expect(within(satir('PORT')).getByText('Kaydedilmedi')).toBeTruthy());
    expect((within(satir('PORT')).getByLabelText('Yeni değer') as HTMLInputElement).value).toBe('4000');
    expect(within(satir('MSSQL_RO_PASSWORD')).queryByLabelText('Yeni değer')).toBeNull();
    expect(document.body.innerHTML).not.toContain('cokgizli123');
  });

  // HY4 bu kosulu KILITLEMIYOR (mutasyonla olculdu, 2026-10-15): Ayrintilar hep monte edilirse
  // PORT'un ornegi '3000' hata aninda da DOM'da olur ve HY4'un `findByText('3000')`u degerler
  // GELMEDEN o ornegi bulup yesil kalir. Kosul burada dogrudan olculur.
  it('SA13 Ayrintilar kosullu: kapaliyken ornek DOM`da yok, acilinca tam aciklama ve ornek gorunur', async () => {
    render(<SystemConfigTab />);
    await yuklendi();
    const s = satir('PORT');
    expect(within(s).getAllByText('3000').length).toBe(1);
    expect(within(s).queryByText('Kullanıldığı yer')).toBeNull();
    fireEvent.click(within(s).getByRole('button', { name: 'Ayrıntılar: Port' }));
    expect(within(s).getAllByText('3000').length).toBe(2);
    expect(within(s).getByText('Kullanıldığı yer')).toBeTruthy();
    expect(within(s).getByText('Sunucu yeniden başlatılınca geçerli olur.')).toBeTruthy();
    fireEvent.click(within(s).getByRole('button', { name: 'Ayrıntıları gizle: Port' }));
    expect(within(s).getAllByText('3000').length).toBe(1);
  });

  it('SA12 degerler okunamazsa ozet kutulari "—"; "hepsi tanimli" denmez', async () => {
    kural = (u, y) =>
      u.includes('/api/admin/system-config') && y === 'GET' ? json(500, { ok: false, message: 'DB yok' }) : null;
    render(<SystemConfigTab />);
    await screen.findByTestId('sistem-ayar-hatasi');
    const kutu = screen.getByRole('button', { name: /Eksik zorunlu/ });
    expect(kutu.textContent).toContain('—');
    expect((kutu as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('Zorunlu ayarların hepsi tanımlı')).toBeNull();
    expect(screen.getAllByText('Değerler okunamadı').length).toBe(4);
  });

  // ── Denetim duzeltmeleri (2026-10-15) ────────────────────────────────────────────────────

  it('SA14 kayit surerken duzenleyici kapanmaz; bilesen sokulurse hata bildirim balonuyla soylenir', async () => {
    const hataBalonu = vi.spyOn(toast, 'error');
    let coz: (r: Response) => void = () => {};
    kural = (u, y) => (y === 'PUT' ? () => new Promise<Response>((r) => (coz = r)) : null);
    const ekran = render(<SystemConfigTab />);
    await yuklendi();
    const s = duzenle('AWX_URL');
    const kutu = within(s).getByLabelText('Yeni değer');
    fireEvent.change(kutu, { target: { value: 'https://awx9' } });
    fireEvent.click(within(s).getByRole('button', { name: 'Kaydet' }));
    expect(putlar.length).toBe(1);
    // Kayit surerken "İptal" kapali ve Esc duzenleyiciyi kapatmaz: kapansaydi sunucu hatasi
    // hicbir yerde gorunmezdi (eski ekran bu durumda bildirim balonu gosteriyordu).
    expect((within(s).getByRole('button', { name: 'İptal' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(kutu, { key: 'Escape' });
    expect(within(satir('AWX_URL')).getByLabelText('Yeni değer')).toBe(kutu);
    // Admin sekmesi degisti (bilesen sokuldu), ardindan sunucu hata dondu.
    ekran.unmount();
    await act(async () => {
      coz(await json(500, { ok: false, error: 'Veritabanına yazılamadı.' })());
    });
    await waitFor(() =>
      expect(hataBalonu).toHaveBeenCalledWith(expect.stringMatching(/AWX URL kaydedilemedi: Veritabanına yazılamadı\./)),
    );
  });

  it('SA15 tanimsiz satir "varsayilan kullanilir" demez (zorunlu ve fail-closed anahtarlarin varsayilani yok)', async () => {
    const degerler = DEGERLER.map((v) => (v.key === 'LDAP_URL' ? { ...v, value: '', defined: false } : v));
    kural = (u, y) =>
      u.includes('/api/admin/system-config') && y === 'GET' ? json(200, { ok: true, values: degerler }) : null;
    render(<SystemConfigTab />);
    await yuklendi();
    const ldap = satir('LDAP_URL');
    expect(within(ldap).getByText('Zorunlu · boş')).toBeTruthy();
    expect(within(ldap).getByText('Tanımsız')).toBeTruthy();
    expect(ldap.textContent).not.toMatch(/varsayılan kullanılır/);
    expect(satir('OPSX_SMART_FLOW_KEY_LEGACY').textContent).not.toMatch(/varsayılan kullanılır/);
    const kutu = screen.getByRole('button', { name: /^Tanımsız/ });
    expect(kutu.textContent).not.toMatch(/Varsayılanla/);
    expect(kutu.textContent).toMatch(/tanımlı/);
  });

  it('SA16 secim duzenleyicisi "bos" secenegini durust adlandirir; pencere ayni ayrimi yapar', async () => {
    render(<SystemConfigTab />);
    await yuklendi();
    const s = duzenle('CSRF_ORIGIN_CHECK');
    expect(within(s).queryByText(/sunucu kendi varsayılanını kullanır/)).toBeNull();
    fireEvent.click(within(s).getByLabelText('Boş (kod varsayılanı)'));
    fireEvent.click(within(s).getByRole('button', { name: 'Kaydet' }));
    const pencere = await screen.findByRole('dialog');
    expect(pencere.textContent).toMatch(/ortam dosyasındaki değere dönmek değildir/);
    expect(pencere.textContent).not.toMatch(/varsayılana dönmek değildir/);
    expect(putlar).toEqual([]);
  });

  it('SA17 yalniz bosluktan olusan deger BOS sayilir: onay kapisindan gecer, sunucuya bos gider', async () => {
    kural = (u, y) => (y === 'PUT' ? json(200, { ok: true, restartRequired: true }) : null);
    render(<SystemConfigTab />);
    await yuklendi();
    let s = duzenle('AWX_URL');
    fireEvent.change(within(s).getByLabelText('Yeni değer'), { target: { value: '   ' } });
    fireEvent.click(within(s).getByRole('button', { name: 'Kaydet' }));
    let pencere = await screen.findByRole('dialog');
    expect(pencere.textContent).toMatch(/ortam dosyasındaki değere dönmek değildir/);
    expect(putlar).toEqual([]);
    fireEvent.click(within(pencere).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(putlar).toEqual([{ key: 'AWX_URL', value: '' }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    s = duzenle('MSSQL_RO_PASSWORD');
    fireEvent.change(within(s).getByLabelText('Yeni değer'), { target: { value: ' ' } });
    fireEvent.click(within(s).getByRole('button', { name: 'Kaydet' }));
    pencere = await screen.findByRole('dialog');
    expect(pencere.textContent).toMatch(/Silinecek/);
    fireEvent.click(within(pencere).getByRole('button', { name: 'Yine de kaydet' }));
    await waitFor(() => expect(putlar[1]).toEqual({ key: 'MSSQL_RO_PASSWORD', value: '' }));
  });

  it('SA18 kurallar: bosluk = bos; tehlikeli deger buyuk harf, https://* ve kamu soneki jokerlerini yakalar', () => {
    const awx = ENV_VARS.find((m) => m.key === 'AWX_URL')!;
    const sir = ENV_VARS.find((m) => m.key === 'MSSQL_RO_PASSWORD')!;
    const cerceve = ENV_VARS.find((m) => m.key === 'PORTAL_FRAME_ANCESTORS')!;
    const cv = (o: Partial<ConfigValue>): ConfigValue => ({ key: 'X', value: 'v', defined: true, masked: false, ...o });
    expect(onayGerekce(awx, cv({ value: 'https://awx' }), '   ')?.gerekceler).toContain('bosaltma');
    expect(onayGerekce(sir, cv({ value: 'qx•••zz', masked: true }), ' ')?.gerekceler).toContain('gizliSilme');
    expect(tehlikeliDeger('PORTAL_FRAME_ANCESTORS', 'https://*')).toBe('frameYildiz');
    expect(tehlikeliDeger('PORTAL_FRAME_ANCESTORS', "'self' http://*:8443")).toBe('frameYildiz');
    expect(tehlikeliDeger('PORTAL_FRAME_ANCESTORS', '*')).toBe('frameYildiz');
    expect(tehlikeliDeger('PORTAL_FRAME_ANCESTORS', "'self' https://*.kurum.com")).toBeNull();
    // Kamu soneki jokeri (yeniden denetim 2026-10-15): `*.` + tek etiket ya da iki etiket ve son
    // etiket iki harfli ulke kodu. Sunucu (oturum-ayarlari.cjs) bunlarin hepsini KABUL ediyor.
    expect(tehlikeliDeger('PORTAL_FRAME_ANCESTORS', 'https://*.com')).toBe('frameSonek');
    expect(tehlikeliDeger('PORTAL_FRAME_ANCESTORS', "'self' https://*.com.tr")).toBe('frameSonek');
    expect(tehlikeliDeger('PORTAL_FRAME_ANCESTORS', 'https://*.GOV.TR:8443')).toBe('frameSonek');
    expect(tehlikeliDeger('PORTAL_FRAME_ANCESTORS', 'http://*.tr')).toBe('frameSonek');
    expect(tehlikeliDeger('PORTAL_FRAME_ANCESTORS', "'self',https://*.co.uk")).toBe('frameSonek');
    expect(tehlikeliDeger('PORTAL_FRAME_ANCESTORS', 'https://*.garanti.com.tr')).toBeNull();
    expect(tehlikeliDeger('PORTAL_FRAME_ANCESTORS', 'https://portal.com.tr')).toBeNull();
    // Ikisi birden: daha genis olan (her site) soylenir.
    expect(tehlikeliDeger('PORTAL_FRAME_ANCESTORS', 'https://*.com https://*')).toBe('frameYildiz');
    const g = onayGerekce(cerceve, cv({ value: "'self'" }), "'self' https://*.com.tr");
    expect(g?.gerekceler).toContain('tehlikeliDeger');
    expect(g?.tehlikeli).toBe(true);
    expect(tehlikeliDeger('CSRF_ORIGIN_CHECK', 'OFF')).toBe('csrfOff');
    expect(tehlikeliDeger('CSRF_ORIGIN_CHECK', 'Log')).toBe('csrfLog');
    expect(tehlikeliDeger('CSRF_ORIGIN_CHECK', 'enforce')).toBeNull();
  });

  it('SA19 oturum deposu kullaniciya bagli: baska admin onceki adminin taslagini ve restart listesini gormez', async () => {
    const ilk = render(<SystemConfigTab />);
    await yuklendi();
    const s = duzenle('PORT');
    fireEvent.change(within(s).getByLabelText('Yeni değer'), { target: { value: '4000' } });
    restartBekleyeneEkle('AWX_URL', 'AWX URL');
    ilk.unmount();

    kimlik.kullanici = 'admin2';
    render(<SystemConfigTab />);
    await yuklendi();
    expect(within(satir('PORT')).queryByLabelText('Yeni değer')).toBeNull();
    expect(within(satir('PORT')).queryByText('Kaydedilmedi')).toBeNull();
    expect(screen.queryByText(/sunucu yeniden başlatılınca geçerli olacak/)).toBeNull();
    expect(saklananTaslaklar().size).toBe(0);
  });

  it('SA20 onay penceresi kayit surerken kapanmaz (İptal kapali, Esc etkisiz)', async () => {
    let coz: (r: Response) => void = () => {};
    kural = (u, y) => (y === 'PUT' ? () => new Promise<Response>((r) => (coz = r)) : null);
    render(<SystemConfigTab />);
    await yuklendi();
    const s = duzenle('CSRF_ORIGIN_CHECK');
    fireEvent.click(within(s).getByLabelText('off'));
    fireEvent.click(within(s).getByRole('button', { name: 'Kaydet' }));
    const pencere = await screen.findByRole('dialog');
    fireEvent.click(within(pencere).getByRole('button', { name: 'Yine de kaydet' }));
    await waitFor(() => expect(putlar.length).toBe(1));
    expect((within(pencere).getByRole('button', { name: 'İptal' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(pencere, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    await act(async () => {
      coz(await json(200, { ok: true, restartRequired: false })());
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('SA21 ekran okuyucu: Ayrintilar adlari benzersiz; basari tek kez duyurulur; bant bolgesi hep DOM`da', async () => {
    kural = (u, y) => (y === 'PUT' ? json(200, { ok: true, restartRequired: false }) : null);
    render(<SystemConfigTab />);
    await yuklendi();
    const ayrintilar = screen.getAllByRole('button', { name: /^Ayrıntılar: / });
    expect(ayrintilar.length).toBe(ENV_VARS.length);
    expect(new Set(ayrintilar.map((d) => d.getAttribute('aria-label'))).size).toBe(ENV_VARS.length);
    // Canli bolge icerikle birlikte eklenirse ekran okuyucu cogu zaman duyurmaz: bos da olsa DOM'da.
    expect(document.querySelector('[data-bolge="restart-bandi"][role="status"]')).not.toBeNull();
    const s = duzenle('SESSION_IDLE_MINUTES');
    fireEvent.change(within(s).getByLabelText('Yeni değer'), { target: { value: '90' } });
    fireEvent.click(within(s).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(within(satir('SESSION_IDLE_MINUTES')).queryByLabelText('Yeni değer')).toBeNull());
    // Basari bildirim balonuyla (kendi aria-live bolgesi) duyurulur; ikinci bir gizli duyuru yok.
    const ikinci = screen.queryAllByRole('status').filter((e) => /kaydedildi/.test(e.textContent || ''));
    expect(ikinci).toEqual([]);
  });

  it('SA22 ogeye kaydirma yalniz en yakin kaydirma kabini kaydirir ve yapiskan cubugu hesaba katar', () => {
    const kap = document.createElement('div');
    kap.style.overflowY = 'auto';
    const cubuk = document.createElement('div');
    const hedef = document.createElement('div');
    kap.append(cubuk, hedef);
    document.body.append(kap);
    Object.defineProperty(kap, 'scrollTop', { value: 500, configurable: true });
    const kutu = (top: number, height = 0) => () => ({ top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    kap.getBoundingClientRect = kutu(64);
    cubuk.getBoundingClientRect = kutu(64, 130);
    hedef.getBoundingClientRect = kutu(900);
    const kaydir = vi.fn();
    (kap as unknown as { scrollTo: typeof kaydir }).scrollTo = kaydir;
    // scrollIntoView butun kaydirma atalarini (overflow-hidden kok kap dahil) kaydirir.
    const govdeKaydir = vi.fn();
    hedef.scrollIntoView = govdeKaydir;
    ogeyeKaydir(hedef, cubuk, true);
    // 500 + (900 - 64) - (130 + 8) = 1198
    expect(kaydir).toHaveBeenCalledWith({ top: 1198, behavior: 'auto' });
    expect(govdeKaydir).not.toHaveBeenCalled();
    kap.remove();
  });

  // ── Yeniden denetim duzeltmeleri (2026-10-15) ────────────────────────────────────────────

  it('SA23a kayit surerken grup elle kapatilirsa sunucu hatasi grubu yeniden acar (hata elle kapatmayi ezer)', async () => {
    const hataBalonu = vi.spyOn(toast, 'error');
    let coz: (r: Response) => void = () => {};
    kural = (u, y) => (y === 'PUT' ? () => new Promise<Response>((r) => (coz = r)) : null);
    render(<SystemConfigTab />);
    await yuklendi();
    const s = duzenle('AWX_URL');
    fireEvent.change(within(s).getByLabelText('Yeni değer'), { target: { value: 'https://awx9' } });
    fireEvent.click(within(s).getByRole('button', { name: 'Kaydet' }));
    expect(putlar.length).toBe(1);
    const baslik = grupBasligi('AWX_URL');
    expect(baslik.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(baslik);
    expect(baslik.getAttribute('aria-expanded')).toBe('false');
    expect(satir('AWX_URL').closest('[inert]')).not.toBeNull();
    await act(async () => {
      coz(await json(500, { ok: false, error: 'Veritabanına yazılamadı.' })());
    });
    await waitFor(() => expect(baslik.getAttribute('aria-expanded')).toBe('true'));
    expect(satir('AWX_URL').closest('[inert]')).toBeNull();
    expect(within(satir('AWX_URL')).getByRole('alert').textContent).toMatch(/Veritabanına yazılamadı/);
    // Satir DOM'da ve gorunur: ikinci kanal (balon) gerekmez.
    expect(hataBalonu).not.toHaveBeenCalled();
    // Iptal'den sonra grup kullanicinin altindan kapanmaz (odak "Duzenle"ye donebilsin).
    fireEvent.click(within(satir('AWX_URL')).getByRole('button', { name: 'İptal' }));
    expect(baslik.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() =>
      expect(document.activeElement).toBe(within(satir('AWX_URL')).getByRole('button', { name: /\(AWX_URL\) ayarını düzenle$/ })),
    );
  });

  it('SA23b kayit surerken arama satiri listeden dusururse sunucu hatasi bildirim balonuyla soylenir', async () => {
    const hataBalonu = vi.spyOn(toast, 'error');
    let coz: (r: Response) => void = () => {};
    kural = (u, y) => (y === 'PUT' ? () => new Promise<Response>((r) => (coz = r)) : null);
    render(<SystemConfigTab />);
    await yuklendi();
    const s = duzenle('AWX_URL');
    fireEvent.change(within(s).getByLabelText('Yeni değer'), { target: { value: 'https://awx9' } });
    fireEvent.click(within(s).getByRole('button', { name: 'Kaydet' }));
    expect(putlar.length).toBe(1);
    const ara = screen.getByRole('searchbox', { name: 'Ayarlarda ara' });
    fireEvent.change(ara, { target: { value: 'LDAP_BASE_DN' } });
    expect(document.getElementById('ayar-AWX_URL')).toBeNull();
    await act(async () => {
      coz(await json(500, { ok: false, error: 'Veritabanına yazılamadı.' })());
    });
    await waitFor(() => expect(hataBalonu).toHaveBeenCalledWith('AWX URL kaydedilemedi: Veritabanına yazılamadı.'));
    expect(hataBalonu).toHaveBeenCalledTimes(1);
    // Arama temizlenince hata satirda da durur (taslak ve hata kaybolmadi).
    fireEvent.change(ara, { target: { value: '' } });
    expect(within(satir('AWX_URL')).getByRole('alert').textContent).toMatch(/Veritabanına yazılamadı/);
  });

  // AyarDuzenleyici: "kullanici bu arada baska yere gectiyse odak calinmaz" iddiasi testsizdi.
  it('SA24 PUT beklerken odak arama kutusuna gecerse sunucu hatasi odagi duzenleyiciye cekmez', async () => {
    let coz: (r: Response) => void = () => {};
    kural = (u, y) => (y === 'PUT' ? () => new Promise<Response>((r) => (coz = r)) : null);
    render(<SystemConfigTab />);
    await yuklendi();
    const s = duzenle('SESSION_IDLE_MINUTES');
    const kutu = within(s).getByLabelText('Yeni değer');
    fireEvent.change(kutu, { target: { value: '3' } });
    fireEvent.click(within(s).getByRole('button', { name: 'Kaydet' }));
    expect(putlar.length).toBe(1);
    const ara = screen.getByRole('searchbox', { name: 'Ayarlarda ara' });
    ara.focus();
    expect(document.activeElement).toBe(ara);
    await act(async () => {
      coz(await json(400, { ok: false, error: 'SESSION_IDLE_MINUTES 5 ile 720 arasında olmalı.' })());
    });
    expect((await within(s).findByRole('alert')).textContent).toMatch(/5 ile 720/);
    await act(async () => {});
    expect(document.activeElement).toBe(ara);
    expect(document.activeElement).not.toBe(kutu);
  });

  it('SA25 onay penceresi kayit surerken gorunur "Kaydediliyor…" der; X kapatmaz ama geri bildirim verir', async () => {
    let coz: (r: Response) => void = () => {};
    kural = (u, y) => (y === 'PUT' ? () => new Promise<Response>((r) => (coz = r)) : null);
    render(<SystemConfigTab />);
    await yuklendi();
    const s = duzenle('CSRF_ORIGIN_CHECK');
    fireEvent.click(within(s).getByLabelText('off'));
    fireEvent.click(within(s).getByRole('button', { name: 'Kaydet' }));
    const pencere = await screen.findByRole('dialog');
    // Canli bolge pencere acilirken DOM'da (bos): icerik gelince duyurulur.
    const durum = within(pencere).getByRole('status');
    expect(durum.textContent).toBe('');
    fireEvent.click(within(pencere).getByRole('button', { name: 'Yine de kaydet' }));
    await waitFor(() => expect(putlar.length).toBe(1));
    expect(durum.textContent).toBe('Kaydediliyor…');
    expect(durum.className).not.toMatch(/sr-only/);
    fireEvent.click(within(pencere).getByRole('button', { name: 'Kapat' }));
    expect(screen.getByRole('dialog')).toBe(pencere);
    expect(within(pencere).getByRole('status')).toBe(durum);
    expect(durum.textContent).toBe('Kaydediliyor… Kayıt bitmeden pencere kapanmaz.');
    expect(durum.className).not.toMatch(/sr-only/);
    expect(durum.className).toMatch(/--status-warning-text/);
    await act(async () => {
      coz(await json(200, { ok: true, restartRequired: false })());
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it("SA26 ortam dosyasindan gelen deger Portal'a sabitlenir: yalniz dugmeyle; kritikte onay penceresi", async () => {
    kural = (u, y) => (y === 'PUT' ? json(200, { ok: true, restartRequired: false }) : null);
    render(<SystemConfigTab />);
    await yuklendi();
    let s = duzenle('SESSION_IDLE_MINUTES');
    const kutu = within(s).getByLabelText('Yeni değer');
    const sabitle = within(s).getByRole('button', { name: "Portal'a sabitle" }) as HTMLButtonElement;
    expect(sabitle.disabled).toBe(false);
    const ipucu = within(s).getByText(
      "Değer ortam dosyasından geliyor; kaydederseniz Portal'da sabitlenir ve ortam dosyasındaki sonraki değişiklik etkisiz kalır.",
    );
    expect(sabitle.getAttribute('aria-describedby')).toBe(ipucu.id);
    // Degismemis kutuda Enter (form gonderimi) degeri sessizce sabitlemez.
    fireEvent.submit(kutu.closest('form') as HTMLFormElement);
    expect(putlar).toEqual([]);
    // Deger degisince dugme yine "Kaydet"; geri alininca "Portal'a sabitle".
    fireEvent.change(kutu, { target: { value: '61' } });
    expect(within(s).queryByRole('button', { name: "Portal'a sabitle" })).toBeNull();
    expect(within(s).getByRole('button', { name: 'Kaydet' })).toBeTruthy();
    fireEvent.change(kutu, { target: { value: '60' } });
    fireEvent.click(within(s).getByRole('button', { name: "Portal'a sabitle" }));
    await waitFor(() => expect(putlar).toEqual([{ key: 'SESSION_IDLE_MINUTES', value: '60' }]));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(within(satir('SESSION_IDLE_MINUTES')).queryByLabelText('Yeni değer')).toBeNull());

    // Kritik anahtar: sabitleme de onay penceresinden gecer (gerekce kritik).
    s = duzenle('MSSQL_SERVER');
    fireEvent.click(within(s).getByRole('button', { name: "Portal'a sabitle" }));
    const pencere = await screen.findByRole('dialog');
    expect(pencere.textContent).toMatch(/veritabanı, dizin ya da giriş güvenliği/);
    expect(pencere.textContent).toMatch(/Portal'da sabitlenir/);
    expect(putlar.length).toBe(1);
    fireEvent.click(within(pencere).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(putlar[1]).toEqual({ key: 'MSSQL_SERVER', value: 'db01.kurum' }));
  });

  it('SA26b gizli, kaynagi Portal olan ve tanimsiz anahtarda sabitleme yok', async () => {
    const degerler = DEGERLER.map((v) =>
      v.key === 'MSSQL_RO_PASSWORD'
        ? { ...v, source: 'env' }
        : v.key === 'AWX_URL'
          ? { ...v, source: 'db' }
          : v.key === 'LDAP_BASE_DN'
            ? { ...v, value: '', defined: false }
            : v,
    );
    kural = (u, y) =>
      u.includes('/api/admin/system-config') && y === 'GET' ? json(200, { ok: true, values: degerler }) : null;
    render(<SystemConfigTab />);
    await yuklendi();
    for (const key of ['MSSQL_RO_PASSWORD', 'AWX_URL', 'LDAP_BASE_DN']) {
      const s = duzenle(key);
      expect(within(s).queryByRole('button', { name: "Portal'a sabitle" }), key).toBeNull();
      expect((within(s).getByRole('button', { name: 'Kaydet' }) as HTMLButtonElement).disabled, key).toBe(true);
      expect(within(s).queryByText(/Portal'da sabitlenir/), key).toBeNull();
    }
    expect(putlar).toEqual([]);
  });

  // KARAR (bulgu 13): webhook adresi imza (sig=) tasir, sir sayilir. Gizlilik karari SUNUCUNUN
  // `masked` alanindan gelir (server/config/secret-pattern.cjs); istemci anahtar adina bakmaz.
  it('SA27 TEAMS_LONGJOB_WEBHOOK_URL sunucu maskeliyse gizli: acik deger, title ve aramada yok; duzenleyici bos', async () => {
    const degerler = [
      ...DEGERLER,
      { key: 'TEAMS_LONGJOB_WEBHOOK_URL', value: 'ht•••Zq', defined: true, masked: true, source: 'db', hotReloadable: false },
    ];
    kural = (u, y) =>
      u.includes('/api/admin/system-config') && y === 'GET' ? json(200, { ok: true, values: degerler }) : null;
    render(<SystemConfigTab />);
    await yuklendi();
    let s = satir('TEAMS_LONGJOB_WEBHOOK_URL');
    expect(within(s).getByText('Gizli')).toBeTruthy();
    expect(within(s).queryByTitle(/ht/)).toBeNull();
    expect(ENV_VARS.find((m) => m.key === 'TEAMS_LONGJOB_WEBHOOK_URL')!.description).toMatch(/Gizli değer/);
    s = duzenle('TEAMS_LONGJOB_WEBHOOK_URL');
    const kutu = within(s).getByLabelText('Yeni değer') as HTMLInputElement;
    expect(kutu.type).toBe('password');
    expect(kutu.value).toBe('');
    fireEvent.click(within(s).getByRole('button', { name: 'İptal' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Ayarlarda ara' }), { target: { value: 'ht•••' } });
    expect(document.getElementById('ayar-TEAMS_LONGJOB_WEBHOOK_URL')).toBeNull();
  });
});
