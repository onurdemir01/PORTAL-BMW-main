// src/components/admin/__tests__/KurumAyari.test.tsx — Admin > Kurum Ayarı ekranı.
//
// Gerçek bileşen ve gerçek istemci kodu çalışır; yalnız `fetch` sahtedir (HataYokDegil deseni).
//   KE1 bölüm düzenle -> fark ön izlemesi (değişen alan, listede eklenen / çıkan) -> kayıt; PUT
//       gövdesi dosyanın TAMAMI (diğer bölümler aynen) + okunan sha
//   KE2 409 çakışma: sunucunun mesajı + "Yeniden yükle"; yeniden yükleme metni korur, yeni sha ile kaydeder;
//       tüm dosya kipinde "eski hale dayanıyor" uyarısı, ön izlemede başkasının değiştirdiği yol işaretli
//   KE3 env tanımsız: salt okunur ekran, ne yapılacağı yazılı; düzenleyici yok
//   KE4 geçersiz JSON: "Farkı göster" kapalı, hata yazılı
//   KE5 üst düzey bölüm silme onay ister; onaylanınca bolumSilmeOnayi gider, vazgeçilince PUT yok
//   KE6 yeni sunucu adı ihlali ön izlemede gösterilir, Kaydet kapalı
//   KE7 yedekten geri dönüş: fark -> "Bu yedeğe geri dön" -> geriYuklenenYedek ile aynı kayıt yolu
//   KE8 saf yardımcılar: hedefOlustur / onizlemeOlustur (bölüm boşaltma, sunucu alanı silme, biçim,
//       çakışan yol, boyut); nesne öğeli listede alan alan fark; Türkçe konumlu JSON hatası
//   KE9 çift tıklama tek PUT (mesgulRef)
//   KE10 bölüm boşaltma ve sunucu alanı silme onay penceresinde
//   KE11 yalnız biçim değişikliği kaydedilebilir
//   KE12 repo içi dosya: uyarı, Kaydet kapalı
//   KE13 kayıttaki 5xx (424 nginxRed) sunucunun mesajıyla gösterilir
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import KurumAyariTab from '@/components/admin/tabs/KurumAyariTab';
import {
  hedefOlustur,
  jsonHataMetni,
  onizlemeOlustur,
} from '@/components/admin/tabs/kurumayari/duzenleyici';

type Yanit = () => Response;
const json =
  (status: number, body: unknown): Yanit =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ORNEK = {
  surum: 1,
  nginx: { intranetSunuculari: ['ORNGXD50', 'ORNGXT50'], exposeHedefi: 'ORNGXT07' },
  smart: { domain: 'KURUM' },
};
const metin = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
const SHA1 = 'a'.repeat(64);
const SHA2 = 'b'.repeat(64);

function durum(icerik: string, sha = SHA1, ek: Record<string, unknown> = {}) {
  const veri = JSON.parse(icerik);
  return {
    ok: true,
    envAdi: 'KURUM_AYAR_DOSYASI',
    envTanimli: true,
    dosyaAdi: 'kurum-ayari.json',
    okunabilir: true,
    gecerli: true,
    hata: null,
    icerik,
    sha,
    boyut: icerik.length,
    mtime: '2026-11-27T08:00:00.000Z',
    dosyaYazilabilir: true,
    dizinYazilabilir: true,
    bolumler: Object.keys(veri),
    sinirlar: { maksBayt: 1048576, maksYedek: 30 },
    ...ek,
  };
}

let gecerliDurum: Yanit;
let putYaniti: Yanit;
let yedekListesi: unknown[];
const putlar: Record<string, unknown>[] = [];

beforeEach(() => {
  putlar.length = 0;
  gecerliDurum = json(200, durum(metin(ORNEK)));
  putYaniti = json(200, { ok: true, sha: SHA2, yedek: '20261127T080000000Z.json' });
  yedekListesi = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (girdi: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof girdi === 'string' ? girdi : girdi instanceof URL ? girdi.href : girdi.url;
      const yontem = (init?.method || 'GET').toUpperCase();
      if (yontem === 'PUT') {
        putlar.push(JSON.parse(String(init?.body)));
        return putYaniti();
      }
      if (u.endsWith('/yedekler')) return json(200, { ok: true, yedekler: yedekListesi })();
      if (u.includes('/yedekler/'))
        return json(200, {
          ok: true,
          ad: '20261126T080000000Z.json',
          zaman: '2026-11-26T08:00:00.000Z',
          icerik: metin({ ...ORNEK, smart: { domain: 'ESKI' } }),
          sha: SHA2,
        })();
      return gecerliDurum();
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const editor = () => screen.getByLabelText('Kurum ayarı JSON') as HTMLTextAreaElement;
const yaz = (s: string) => fireEvent.change(editor(), { target: { value: s } });
const onizleme = () => screen.getByRole('region', { name: 'Fark ön izlemesi' });

async function ac() {
  render(<KurumAyariTab />);
  await waitFor(() => expect(editor().value).toBe(metin(ORNEK)));
}

describe('Kurum Ayarı ekranı', () => {
  it('KE1 bölüm düzenle -> fark -> kayıt; PUT dosyanın tamamını ve okunan sha yı taşır', async () => {
    await ac();
    fireEvent.change(screen.getByLabelText('Bölüm'), { target: { value: 'nginx' } });
    expect(JSON.parse(editor().value)).toEqual(ORNEK.nginx);
    yaz(JSON.stringify({ intranetSunuculari: ['ORNGXD50', 'ORNGXP50'], exposeHedefi: 'ORNGXT08' }));
    fireEvent.click(screen.getByRole('button', { name: /Farkı göster/ }));
    const p = within(onizleme());
    expect(p.getByText('Kaydedilecek değişiklik: “nginx” bölümü')).toBeTruthy();
    expect(p.getByText('~ nginx.exposeHedefi')).toBeTruthy();
    expect(p.getByText('+ "ORNGXP50"')).toBeTruthy();
    expect(p.getByText('− "ORNGXT50"')).toBeTruthy();
    fireEvent.click(p.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Kaydedildi/));
    expect(putlar).toHaveLength(1);
    expect(putlar[0].oncekiSha).toBe(SHA1);
    const gonderilen = JSON.parse(String(putlar[0].icerik));
    expect(gonderilen.smart).toEqual(ORNEK.smart);
    expect(gonderilen.nginx.exposeHedefi).toBe('ORNGXT08');
    expect(putlar[0].bolumSilmeOnayi).toBeUndefined();
  });

  it('KE2 409 çakışma: mesaj + Yeniden yükle; metin korunur, yeni sha ile kaydedilir', async () => {
    putYaniti = json(409, {
      ok: false,
      code: 'cakisma',
      error: 'Dosya siz düzenlerken değişti (başka bir yönetici ya da sunucuda elle).',
      sha: SHA2,
    });
    await ac();
    const yeni = metin({ ...ORNEK, surum: 2 });
    yaz(yeni);
    fireEvent.click(screen.getByRole('button', { name: /Farkı göster/ }));
    fireEvent.click(within(onizleme()).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/siz düzenlerken değişti/),
    );
    gecerliDurum = json(200, durum(metin({ ...ORNEK, smart: { domain: 'BASKA' } }), SHA2));
    putYaniti = json(200, { ok: true, sha: SHA1, yedek: 'x.json' });
    fireEvent.click(screen.getByRole('button', { name: 'Yeniden yükle' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/metniniz korundu/));
    expect(screen.getByRole('alert').textContent).toMatch(/ESKİ haline dayanıyor/);
    expect(editor().value).toBe(yeni);
    fireEvent.click(screen.getByRole('button', { name: /Farkı göster/ }));
    expect(within(onizleme()).getByText('~ smart.domain')).toBeTruthy();
    expect(within(onizleme()).getByRole('alert').textContent).toMatch(
      /başkası değiştirdi[\s\S]*• smart\.domain/,
    );
    fireEvent.click(within(onizleme()).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(putlar).toHaveLength(2));
    expect(putlar[1].oncekiSha).toBe(SHA2);
  });

  it('KE3 env tanımsız: salt okunur, ne yapılacağı yazılı', async () => {
    gecerliDurum = json(200, {
      ...durum('{}'),
      envTanimli: false,
      dosyaAdi: null,
      okunabilir: false,
      gecerli: false,
      icerik: null,
      sha: null,
      hata: 'KURUM_AYAR_DOSYASI tanımlı değil',
    });
    render(<KurumAyariTab />);
    const kutu = await screen.findByTestId('salt-okunur');
    expect(kutu.textContent).toMatch(/KURUM_AYAR_DOSYASI tanımlı değil/);
    expect(kutu.textContent).toMatch(/deploy\/kurum-ayari\.ornek\.json/);
    expect(kutu.textContent).toMatch(/yeniden başlatın/);
    expect(screen.queryByLabelText('Kurum ayarı JSON')).toBeNull();
  });

  it('KE4 geçersiz JSON: Farkı göster kapalı, hata yazılı', async () => {
    await ac();
    yaz('{ "a": ');
    expect(screen.getByTestId('json-durumu').textContent).toMatch(/Geçersiz JSON/);
    expect(
      (screen.getByRole('button', { name: /Farkı göster/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    yaz('[1, 2]');
    expect(screen.getByTestId('json-durumu').textContent).toMatch(/JSON nesnesi olmalı/);
  });

  it('KE5 üst düzey bölüm silme onay ister', async () => {
    await ac();
    yaz(metin({ surum: 1, nginx: ORNEK.nginx }));
    fireEvent.click(screen.getByRole('button', { name: /Farkı göster/ }));
    expect(within(onizleme()).getByText(/^− smart$/)).toBeTruthy();
    fireEvent.click(within(onizleme()).getByRole('button', { name: 'Kaydet' }));
    const pencere = await screen.findByRole('dialog');
    expect(pencere.textContent).toMatch(/smart/);
    fireEvent.click(within(pencere).getByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(putlar).toHaveLength(0);
    fireEvent.click(within(onizleme()).getByRole('button', { name: 'Kaydet' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sil ve kaydet' }),
    );
    await waitFor(() => expect(putlar).toHaveLength(1));
    expect(putlar[0].bolumSilmeOnayi).toBe(true);
  });

  it('KE6 yeni sunucu adı ihlali ön izlemede, Kaydet kapalı', async () => {
    await ac();
    yaz(metin({ ...ORNEK, nginx: { ...ORNEK.nginx, exposeHedefi: '1-bozuk' } }));
    fireEvent.click(screen.getByRole('button', { name: /Farkı göster/ }));
    const p = within(onizleme());
    expect(p.getByRole('alert').textContent).toMatch(
      /nginx\.exposeHedefi: sunucu adı kuralına uymuyor/,
    );
    expect((p.getByRole('button', { name: 'Kaydet' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('KE9 çift tıklama tek PUT', async () => {
    await ac();
    yaz(metin({ ...ORNEK, surum: 2 }));
    fireEvent.click(screen.getByRole('button', { name: /Farkı göster/ }));
    const btn = within(onizleme()).getByRole('button', { name: 'Kaydet' });
    act(() => {
      btn.click();
      btn.click();
    });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Kaydedildi/));
    expect(putlar).toHaveLength(1);
  });

  it('KE10 bölüm boşaltma ve sunucu alanı silme onay penceresinde', async () => {
    await ac();
    yaz(metin({ ...ORNEK, nginx: {} }));
    fireEvent.click(screen.getByRole('button', { name: /Farkı göster/ }));
    fireEvent.click(within(onizleme()).getByRole('button', { name: 'Kaydet' }));
    const pencere = await screen.findByRole('dialog');
    expect(pencere.textContent).toMatch(/boşaltılan bölüm: nginx/);
    expect(pencere.textContent).toMatch(
      /sunucu alanı: nginx\.intranetSunuculari, nginx\.exposeHedefi/,
    );
    fireEvent.click(within(pencere).getByRole('button', { name: 'Sil ve kaydet' }));
    await waitFor(() => expect(putlar).toHaveLength(1));
    expect(putlar[0].bolumSilmeOnayi).toBe(true);
  });

  it('KE11 yalnız biçim değişikliği kaydedilebilir', async () => {
    await ac();
    yaz(JSON.stringify(ORNEK));
    fireEvent.click(screen.getByRole('button', { name: /Farkı göster/ }));
    const p = within(onizleme());
    expect(p.getByText(/Yalnız biçim değişti/)).toBeTruthy();
    fireEvent.click(p.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(putlar).toHaveLength(1));
    expect(putlar[0].icerik).toBe(JSON.stringify(ORNEK));
  });

  it('KE12 repo içi dosya: uyarı, Kaydet kapalı', async () => {
    gecerliDurum = json(200, durum(metin(ORNEK), SHA1, { repoIci: true }));
    await ac();
    expect(screen.getByText(/repo çalışma ağacının içinde/)).toBeTruthy();
    yaz(metin({ ...ORNEK, surum: 2 }));
    fireEvent.click(screen.getByRole('button', { name: /Farkı göster/ }));
    expect(
      (within(onizleme()).getByRole('button', { name: 'Kaydet' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('KE13 kayıttaki 5xx (424 nginxRed) sunucunun mesajıyla gösterilir', async () => {
    putYaniti = json(424, {
      ok: false,
      code: 'yazma-izni',
      error:
        'Kurum ayar dosyasına yazılamadı (EACCES). Dosyaya VE bulunduğu dizine yazma izni olmalı.',
      message:
        'Kurum ayar dosyasına yazılamadı (EACCES). Dosyaya VE bulunduğu dizine yazma izni olmalı.',
      upstreamStatus: 500,
      nginxRed: true,
    });
    await ac();
    yaz(metin({ ...ORNEK, surum: 2 }));
    fireEvent.click(screen.getByRole('button', { name: /Farkı göster/ }));
    fireEvent.click(within(onizleme()).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/EACCES/));
    expect(screen.getByRole('alert').textContent).not.toMatch(/HTML/);
  });

  it('KE7 yedekten geri dönüş aynı kayıt yolundan', async () => {
    yedekListesi = [
      {
        ad: '20261126T080000000Z.json',
        zaman: '2026-11-26T08:00:00.000Z',
        boyut: 120,
        shaKisa: 'abcdef012345',
      },
    ];
    await ac();
    const gecmis = within(screen.getByRole('region', { name: 'Yedek geçmişi' }));
    fireEvent.click(await gecmis.findByRole('button', { name: 'Farkı göster' }));
    const p = within(await screen.findByRole('region', { name: 'Fark ön izlemesi' }));
    expect(p.getByText('~ smart.domain')).toBeTruthy();
    fireEvent.click(p.getByRole('button', { name: 'Bu yedeğe geri dön' }));
    await waitFor(() => expect(putlar).toHaveLength(1));
    expect(putlar[0].geriYuklenenYedek).toBe('20261126T080000000Z.json');
    expect(JSON.parse(String(putlar[0].icerik)).smart.domain).toBe('ESKI');
  });
});

describe('Kurum Ayarı yardımcıları', () => {
  it('KE8 hedefOlustur / onizlemeOlustur', () => {
    const h = hedefOlustur(ORNEK, 'smart', '{"domain":"X"}');
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    expect(Object.keys(h.veri)).toEqual(['surum', 'nginx', 'smart']);
    expect(h.metin.endsWith('\n')).toBe(true);
    expect(hedefOlustur(null, 'smart', '{}')).toMatchObject({ ok: false });
    expect(hedefOlustur(ORNEK, '', '{"a":1}')).toMatchObject({ ok: true, metin: '{"a":1}' });
    const o = onizlemeOlustur('t', ORNEK, '{}', { surum: 2, yeni: {} });
    expect(o.silinenBolumler).toEqual(['nginx', 'smart']);
    expect(o.silinenSunucuAlanlari).toEqual(['nginx.intranetSunuculari', 'nginx.exposeHedefi']);
    expect(o.bos).toBe(false);
    expect(o.fark.eklenen.map((x) => x.yol)).toEqual(['yeni']);
    expect(onizlemeOlustur('t', ORNEK, '', ORNEK).bos).toBe(true);
    // Bölümü boşaltmak silmekle aynı.
    expect(onizlemeOlustur('t', ORNEK, '', { ...ORNEK, nginx: {} }).silinenBolumler).toEqual([
      'nginx',
    ]);
    // Yalnız biçim: anlamsal fark yok, metin farklı.
    const b = onizlemeOlustur('t', ORNEK, JSON.stringify(ORNEK), ORNEK, {
      mevcutMetin: metin(ORNEK),
    });
    expect(b).toMatchObject({ bos: true, yalnizBicim: true });
    expect(
      onizlemeOlustur('t', ORNEK, metin(ORNEK), ORNEK, { mevcutMetin: metin(ORNEK) }).yalnizBicim,
    ).toBe(false);
    // Çakışan yol: başkası smart.domain'i değiştirdi, bu kayıt da ona dokunuyor.
    const c = onizlemeOlustur(
      't',
      ORNEK,
      '',
      { ...ORNEK, smart: { domain: 'X' }, surum: 3 },
      {
        baskasininYollari: ['smart.domain', 'nginx.exposeHedefi'],
      },
    );
    expect(c.cakisanYollar).toEqual(['smart.domain']);
    expect(onizlemeOlustur('t', ORNEK, 'çç', ORNEK, { maksBayt: 3 }).boyutAsimi).toBe(true);
    // Nesne öğeli liste alan alan.
    const l = onizlemeOlustur('t', { u: [{ s: 'ORNGXD50', a: 'x'.repeat(200), b: 'eski' }] }, '', {
      u: [{ s: 'ORNGXD50', a: 'x'.repeat(200), b: 'yeni' }],
    });
    expect(l.fark.degisen).toEqual([{ yol: 'u[0].b', eski: 'eski', yeni: 'yeni' }]);
    // JSON hatası Türkçe ve konumlu; tarayıcının İngilizce metni yok.
    expect(
      jsonHataMetni(new Error('Unexpected token } in JSON at position 9'), '{\n  "a": }'),
    ).toBe('Geçersiz JSON (satır 2, sütun 8)');
    expect(jsonHataMetni(new Error('x (line 3 column 4)'), '')).toBe(
      'Geçersiz JSON (satır 3, sütun 4)',
    );
    expect(jsonHataMetni(new Error('Unexpected end of JSON input'), '{')).toBe('Geçersiz JSON');
    const h2 = hedefOlustur(null, '', '{ "a": ');
    expect(h2).toMatchObject({ ok: false });
    if (!h2.ok) expect(h2.hata).not.toMatch(/Unexpected|JSON at|position/);
    let derin = '1';
    for (let i = 0; i < 70; i++) derin = `{"a":${derin}}`;
    expect(hedefOlustur(null, '', derin)).toMatchObject({
      ok: false,
      hata: expect.stringMatching(/iç içe/),
    });
  });
});
