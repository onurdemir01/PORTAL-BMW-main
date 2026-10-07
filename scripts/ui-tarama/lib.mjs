// scripts/ui-tarama/lib.mjs — arka ucsuz UI gozlem araci (headless Chrome + CDP).
//
// NEDEN VAR (2026-10-07): jsdom gercek renkleri, gercek yerlesimi ve gercek tema katmanini
// hesaplamaz. "Dugme metni gorunmuyor", "uyari metni okunmuyor", "sayfa tasiyor" gibi hatalar
// ancak gercek bir tarayicida olculebilir. Bu arac portali ARKA UC OLMADAN acar: sayfaya
// enjekte edilen bir `fetch` sarmalayicisi her /api istegine sahte yanit verir. Boylece iki
// durum her sayfada denenebilir:
//   bos   -> her API "basarili ve bos" doner (bos-durum ekranlari)
//   hata  -> her API 500 doner (hata ekranlari; "hata"yi "yok" diye gosteren ekranlar)
//
// Bagimlilik YOK: Node'un yerlesik WebSocket'i ve fetch'i kullanilir (Node 22+).
import fs from 'node:fs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sayfaya enjekte edilen fetch sarmalayicisi. `ozel`: { 'url parcasi': govde | {__status, body} }.
export const enjekte = (mod, ozel = {}) => `(() => {
  const asil = window.fetch.bind(window);
  const OZEL = ${JSON.stringify(Object.entries(ozel))};
  const J = (o, s = 200) => Promise.resolve(new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } }));
  window.__istekler = [];
  window.fetch = (girdi, sec) => {
    const u = typeof girdi === 'string' ? girdi : girdi.url;
    if (!u.includes('/api/')) return asil(girdi, sec);
    window.__istekler.push((sec && sec.method ? sec.method : 'GET') + ' ' + u.replace(location.origin, ''));
    for (const [k, v] of OZEL) if (u.includes(k)) return (v && v.__status) ? J(v.body, v.__status) : J(v);
    const simdi = Date.now();
    if (u.includes('/api/auth/me')) return J({ ok: true, user: { username: 'tarama', displayName: 'Tarama Kullanicisi', role: 'Admin', groups: [] } });
    if (u.includes('/api/auth/session-policy')) return J({ ok: true, rememberEnabled: true, rememberDays: 7 });
    if (u.includes('/api/auth/session')) return J({ ok: true, idleExpiresAt: simdi + 3600e3, absoluteExpiresAt: simdi + 12 * 3600e3, warnSeconds: 120, remember: false, now: simdi });
    if (u.includes('/api/visibility/resolved')) return J({ ok: true, ok_engine: true, version: 1, visibility: {} });
    if (u.includes('/api/visibility/pages')) return J({ ok: true, visibility: {} });
    if (u.includes('/api/visibility/version') || u.includes('/api/admin/version')) return J({ ok: true, version: 1 });
    if (${JSON.stringify(mod)} === 'hata') return J({ ok: false, message: 'Sunucu hatasi (tarama)' }, 500);
    return J({ ok: true, items: [], rows: [], data: [], list: [], visibility: {}, version: 1 });
  };
  window.EventSource = class { constructor() { this.readyState = 0; } close() {} addEventListener() {} removeEventListener() {} };
})();`;

export async function sekme(cdpPort, taban) {
  const info = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const bekle = new Map();
  const konsol = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && bekle.has(m.id)) {
      const [r, j] = bekle.get(m.id);
      bekle.delete(m.id);
      if (m.error) j(new Error(JSON.stringify(m.error)));
      else r(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      konsol.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      konsol.push('ERR ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    }
  };
  const send = (method, params = {}) => {
    const i = ++id;
    ws.send(JSON.stringify({ id: i, method, params }));
    return new Promise((r, j) => bekle.set(i, [r, j]));
  };
  await send('Page.enable');
  await send('Runtime.enable');
  const t = {
    send,
    konsol,
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
      return r.result.value;
    },
    async ac(yol, { tema = 'light', w = 1440, h = 900, mod = 'bos', ozel = {}, bekle: ms = 2600 } = {}) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: tema }] });
      await send('Page.addScriptToEvaluateOnNewDocument', { source: enjekte(mod, ozel) + `try { localStorage.setItem('theme', '${tema}'); } catch {}` });
      await send('Page.navigate', { url: taban + yol });
      await sleep(ms);
    },
    async shot(dosya) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(dosya, Buffer.from(r.data, 'base64'));
    },
    // Metne ("text=...") ya da seciciye GERCEK fare olayi.
    async tikla(sel) {
      const c = await t.eval(`(() => { const sel = ${JSON.stringify(sel)}; let el = null;
        if (sel.startsWith('text=')) { const x = sel.slice(5); el = [...document.querySelectorAll('button,a,label,[role=button],[role=tab],summary')].find(e => e.textContent.trim().includes(x) && e.offsetParent !== null); }
        else el = document.querySelector(sel);
        if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!c) return false;
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
      await sleep(900);
      return true;
    },
    async kapat() {
      await fetch(`http://127.0.0.1:${cdpPort}/json/close/${info.id}`).catch(() => {});
      ws.close();
    },
  };
  return t;
}

// Sayfa ici denetim: cokme, tasma, kontrast (WCAG), etiketsiz girdi, adsiz dugme.
// Devre disi ogeler kontrast listesine GIRMEZ (WCAG onlari kapsam disi tutar).
export const DENETIM = `(() => {
  const gorunur = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < innerHeight * 3; };
  const tanim = (e) => (e.tagName.toLowerCase() + '.' + String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).trim().split(/\\s+/).slice(0, 5).join('.')).slice(0, 110) + ' «' + (e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 36) + '»';
  const ad = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').trim() || (e.getAttribute('aria-labelledby') ? 'x' : '') || (e.querySelector('img[alt]:not([alt=""]),svg[aria-label],svg title') ? 'x' : '');
  const lum = (c) => { const m = c.match(/[\\d.]+/g); if (!m) return null; const [r, g, b] = m.slice(0, 3).map((v) => { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return { l: 0.2126 * r + 0.7152 * g + 0.0722 * b, a: m.length > 3 ? parseFloat(m[3]) : 1 }; };
  const zemin = (e) => { for (let x = e; x; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; const b = lum(cs.backgroundColor); if (b && b.a > 0.6) return b.l; } const b = lum(getComputedStyle(document.body).backgroundColor); return b ? b.l : 1; };
  const out = {};
  const de = document.documentElement;
  const ana = document.querySelector('main') || document.body;
  out.cokme = /Bu sayfa y.klenemedi/.test(ana.innerText);
  out.tasmaX = de.scrollWidth - de.clientWidth;
  const hepsi = [...document.querySelectorAll('body *')].filter(gorunur);
  out.adsizDugme = hepsi.filter((e) => e.matches('button,[role=button],a[href]') && !ad(e)).slice(0, 8).map(tanim);
  out.etiketsizGirdi = hepsi.filter((e) => e.matches('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea') && !(e.labels && e.labels.length) && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby') && !e.getAttribute('title')).slice(0, 8).map((e) => tanim(e) + ' ph=' + (e.getAttribute('placeholder') || ''));
  const kontrast = [];
  for (const e of hepsi) {
    if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
    if (e.closest(':disabled,[aria-disabled="true"]')) continue;
    const cs = getComputedStyle(e); const f = lum(cs.color); const z = zemin(e); if (!f || z === null) continue;
    if (parseFloat(cs.opacity) < 0.5) continue;
    const o = (Math.max(f.l, z) + 0.05) / (Math.min(f.l, z) + 0.05);
    if (o < 3) kontrast.push({ o: Math.round(o * 100) / 100, px: parseFloat(cs.fontSize), e: tanim(e) });
  }
  kontrast.sort((a, b) => a.o - b.o);
  const gorulen = new Set();
  out.kontrast = kontrast.filter((k) => { const a = k.e.split(' «')[0]; if (gorulen.has(a)) return false; gorulen.add(a); return true; }).slice(0, 10);
  out.metin = ana.innerText.replace(/\\n{2,}/g, '\\n').slice(0, 500);
  out.hamJson = /\\{"ok":\\s*false/.test(ana.innerText);
  return JSON.stringify(out);
})()`;
