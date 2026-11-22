// src/__tests__/renk-koru-modu.test.tsx — Renk körü modu (2026-11-17).
//
// Kullanıcı: "Portal'ın geneline renk körü modu gibi bir şey yapar mısın? ekipteki renk körü bir arkadaşımız kırmızıları
// göremiyor." Kırmızılar turuncuya, yeşiller gök mavisine döner (mavi ↔ turuncu: kırmızı-yeşil körlüğünde en güvenli ayrım).
//   RK1 üst banttaki düğme modu açar/kapatır: <html data-renk="cvd">, aria-pressed, localStorage ve sunucu tercihi (bmw-renk)
//   RK2 sunucudaki açık tercih (cvd / yok) girişte uygulanır
//   RK3 CSS bekçisi: Portal'da kullanılan HER kırmızı / yeşil / zümrüt Tailwind sınıfının tonu modda yeniden tanımlı; durum
//       token'ları açık ve koyu temada; normal görünüm (:root) değişmedi; sabit kırmızı/yeşil bileşen renkleri token'a bağlı
//   RK4 açılış betiği ilk boyamadan önce uygular; sunucu tercihi HTML'e gömülür (server/index.cjs __BMW_BOOT__.renk)
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import Masthead from '@/components/layout/Masthead';
import { prefsApi } from '@/api/prefsApi';

const KOK = path.resolve(__dirname, '..', '..');
const oku = (p: string) => fs.readFileSync(path.join(KOK, p), 'utf8');

let sunucuPrefs: Record<string, string> = {};
let yazilan: Record<string, string>[] = [];
beforeEach(() => {
  sunucuPrefs = {};
  yazilan = [];
  document.documentElement.removeAttribute('data-renk');
  try {
    localStorage.removeItem('bmw-renk');
  } catch {
    /* yok */
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT')
        yazilan.push(JSON.parse(String(init.body)).prefs || JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true, prefs: sunucuPrefs }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const ciz = () =>
  render(
    <AuthContext.Provider
      value={
        {
          user: { username: 'ayse', displayName: 'Ayşe', role: 'User' },
          logout: vi.fn(),
          canViewPage: () => true,
        } as never
      }
    >
      <ThemeProvider>
        <MemoryRouter>
          <Masthead onToggleNav={() => {}} />
        </MemoryRouter>
      </ThemeProvider>
    </AuthContext.Provider>,
  );

describe('Renk körü modu', () => {
  it('RK1 düğme modu açar / kapatır; öznitelik, aria-pressed, yerel ve sunucu tercihi', async () => {
    ciz();
    const d = screen.getByTestId('renk-koru-dugme');
    expect(d.getAttribute('aria-pressed')).toBe('false');
    expect(d.getAttribute('aria-label')).toBe('Renk körü modunu aç');
    fireEvent.click(d);
    expect(document.documentElement.getAttribute('data-renk')).toBe('cvd');
    expect(d.getAttribute('aria-pressed')).toBe('true');
    expect(d.getAttribute('aria-label')).toBe('Renk körü modunu kapat');
    expect(localStorage.getItem('bmw-renk')).toBe('cvd');
    await waitFor(() =>
      expect(yazilan.some((p) => JSON.stringify(p).includes('"bmw-renk":"cvd"'))).toBe(true),
    );
    fireEvent.click(d);
    expect(document.documentElement.hasAttribute('data-renk')).toBe(false);
    expect(localStorage.getItem('bmw-renk')).toBe('yok');
    await waitFor(() =>
      expect(yazilan.some((p) => JSON.stringify(p).includes('"bmw-renk":"yok"'))).toBe(true),
    );
  });

  it('RK2 sunucudaki tercih girişte uygulanır (başka tarayıcıda açılmış mod)', async () => {
    sunucuPrefs = { 'bmw-renk': 'cvd' };
    // prefsApi oturum basina onbellekler: onceki testin bos tercihi tasinmasin.
    await prefsApi.getAll(true);
    ciz();
    await waitFor(() => expect(document.documentElement.getAttribute('data-renk')).toBe('cvd'));
    expect(screen.getByTestId('renk-koru-dugme').getAttribute('aria-pressed')).toBe('true');
  });

  it('RK3 CSS: kullanılan her kırmızı/yeşil tonu modda yeniden tanımlı; durum token’ları iki temada; normal görünüm aynı', () => {
    const css = oku('src/index.css');
    const blok = (bas: string) => {
      const i = css.indexOf(bas);
      expect(i, `${bas} yok`).toBeGreaterThan(0);
      return css.slice(i, css.indexOf('}', i));
    };
    const acik = blok(':root[data-renk="cvd"] {');
    const koyu = blok(':root[data-theme="dark"][data-renk="cvd"] {');
    // Kaynakta kullanılan her (aile, ton) çifti modda tanımlı olmalı
    const kullanilan = new Set<string>();
    const gez = (d: string) => {
      for (const g of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, g.name);
        if (g.isDirectory()) {
          if (g.name !== '__tests__' && g.name !== 'node_modules') gez(p);
        } else if (/\.(tsx|ts)$/.test(g.name)) {
          for (const m of fs
            .readFileSync(p, 'utf8')
            .matchAll(/\b[a-z]+-(red|green|emerald)-(\d{2,3})\b/g))
            kullanilan.add(`${m[1]}-${m[2]}`);
        }
      }
    };
    gez(path.join(KOK, 'src'));
    expect(kullanilan.size).toBeGreaterThan(5);
    for (const k of kullanilan)
      expect(acik, `--color-${k} modda tanımlı değil`).toMatch(
        new RegExp(`--color-${k}:\\s*oklch\\(`),
      );
    // kırmızılar turuncu tonuna (hue 36-76), yeşiller gök mavisine (hue 230-244) döner
    for (const m of acik.matchAll(/--color-red-\d+:\s*oklch\([^ ]+ [^ ]+ ([\d.]+)\)/g))
      expect(Number(m[1])).toBeLessThan(80);
    for (const m of acik.matchAll(/--color-(green|emerald)-\d+:\s*oklch\([^ ]+ [^ ]+ ([\d.]+)\)/g))
      expect(Number(m[2])).toBeGreaterThan(225);
    for (const t of [
      '--status-danger:',
      '--status-danger-bg:',
      '--status-success:',
      '--status-success-bg:',
      '--status-danger-text:',
    ]) {
      expect(acik).toContain(t);
      expect(koyu).toContain(t);
    }
    for (const t of ['--solid-danger:', '--solid-success:', '--nokta-ok:', '--nokta-hata:'])
      expect(acik).toContain(t);
    // normal görünüm: :root'taki eski değerler duruyor
    expect(css).toMatch(/--status-danger:\s+#b1380b;/);
    expect(css).toMatch(/--status-success:\s+#3d7317;/);
    expect(css).toMatch(/--solid-danger:\s+#c9190b;/);
    // sabit kırmızı/yeşil bileşen renkleri token'a bağlı
    expect(oku('src/components/common/Badge.tsx')).not.toMatch(/#c9190b|#3e8635/);
    expect(oku('src/components/ansible/AnsiblePage.tsx')).not.toMatch(/#22c55e|#ef4444/);
  });

  it('RK4 açılış betiği ilk boyamadan önce uygular; sunucu tercihi HTML’e gömülür', () => {
    const html = oku('index.html');
    expect(html).toContain('localStorage.getItem("bmw-renk")');
    expect(html).toContain('boot.renk === "cvd"');
    expect(html).toContain('document.documentElement.setAttribute("data-renk", "cvd")');
    const srv = oku('server/index.cjs');
    expect(srv).toContain("renk: prefs['bmw-renk'] === 'cvd' ? 'cvd' : null");
    expect(srv).toMatch(/if \((?:p && p\.renk|p\?\.renk) === 'cvd'\) boot\.renk = 'cvd';/);
  });
});
