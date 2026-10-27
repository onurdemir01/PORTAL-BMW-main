// src/components/nginx_console/__tests__/yuk-testi-har.test.ts — harSenaryo.ts (HAR -> senaryo, tarayicida) (2026-10-27).
//
// HS1-HS5: el kitinin testler/test_har_senaryo.py vakalari birebir (sentetik HAR'a bilerek sir konur: cerez,
// Authorization, Set-Cookie, govde, sorgu; ciktida hicbiri olmamali). HS6: FARK testi - ayni ureteclerle kurulan
// HAR'larda K.tsv / B.tsv / OZET.txt, Python'un (har_senaryo.py, 3.12) urettigiyle BAYT BAYT ayni olmali
// (beklenen cikti harSenaryo.python.json'da; test Python gerektirmez). HS7-HS9: Portal'a ozgu kapilar.
// Inceleme duzeltmeleri (2026-10-27): HS12 yoldaki ';' parametresi (;jsessionid) tekillestirmeden once atilir ve
// sayilir; HS13 yapistirilan listede ';' sunucu metniyle reddedilir; HS14 dogrusal e-posta denetimi eski duzenli
// ifadeyle >= 20.000 rastgele dizgide BIREBIR ayni; HS15 2 KB '/a..@a..' 50 ms altinda, alan kismi en cok 253.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EN_COK_SATIR, KOD_GUVENLIK, KOD_KULLANIM, YOL_PARAMETRESI_METNI, bicim, epostaMi, gonderilecekOzet, gonderimKapisi, harOku, kisiselVeriSuphesi,
  satirMetni, senaryoUret, yolListesiSenaryosu, yolParametresiniAt, yolSorunu, type HarGirdisi, type SenaryoSatiri,
} from '../yukTesti/harSenaryo';

const HOST = 'glomo-test.fw.garantibbva.com.tr';
const H = `https://${HOST}`;
const SIRLAR = ['GIZLICEREZ', 'GIZLITOKEN', 'GIZLISET', 'GIZLIGOVDE', 'GIZLIPOST', 'GIZLIYORUM', '12345678901', 'tckn', 'ali.veli'];

// ── test_har_senaryo.py ureteclerinin portu ──────────────────────────────────────────
type G = Record<string, unknown>;
function girdi(url: string, o: { yontem?: string; durum?: unknown; boyut?: unknown; mime?: unknown; onbellek?: unknown; zaman?: string } = {}): G {
  const { yontem = 'GET', durum = 200, boyut = 1000, mime = 'application/javascript', zaman = '2026-10-26T10:00:00.000Z' } = o;
  const g: G = {
    startedDateTime: zaman,
    request: {
      method: yontem, url,
      headers: [{ name: 'Cookie', value: 'SESSION=GIZLICEREZ' }, { name: 'Authorization', value: 'Bearer GIZLITOKEN' }],
      cookies: [{ name: 'SESSION', value: 'GIZLICEREZ' }],
      queryString: [{ name: 'token', value: 'GIZLITOKEN' }],
    },
    response: {
      status: durum, headers: [{ name: 'Set-Cookie', value: 'a=GIZLISET' }], cookies: [{ name: 'a', value: 'GIZLISET' }],
      content: { size: boyut, mimeType: mime, text: 'GIZLIGOVDE' },
    },
  };
  if (yontem === 'POST') (g.request as G).postData = { text: 'GIZLIPOST' };
  if ('onbellek' in o) g._fromCache = o.onbellek;
  return g;
}
function sentetik(ek: unknown[] = []) {
  return { log: { version: '1.2', entries: [
    girdi(`${H}/app-v1/assets/a.js`, { boyut: 600000, zaman: '2026-10-26T10:00:01.000Z' }),
    girdi(`${H}/app-v1/`, { mime: 'text/html', boyut: 3000, zaman: '2026-10-26T10:00:00.500Z' }),
    girdi(`${H}/app-v1/assets/a.js`, { boyut: 600000, zaman: '2026-10-26T10:00:02.000Z' }),
    girdi(`${H}/app-v1/assets/s.css`, { boyut: 60000, mime: 'text/css' }),
    girdi(`${H}/app-v1/config`, { mime: 'application/json', durum: 304 }),
    girdi(`${H}/app-v1/assets/__federation_shared_@scope-ui/x.js`),
    girdi(`${H}/api/x`, { yontem: 'POST' }),
    girdi(`${H}/app-v1/assets/a.js`, { yontem: 'HEAD' }),
    girdi(`http://${HOST}/app-v1/`, { durum: 307 }),
    girdi(`${H}/eski`, { durum: 301 }),
    girdi(`${H}/yok.js`, { durum: 404 }),
    girdi(`${H}/patla`, { durum: 500 }),
    girdi(`${H}/iptal.js`, { durum: 0 }),
    girdi(`${H}/app-v1/assets/m.js`, { onbellek: 'memory' }),
    girdi(`${H}/app-v1/assets/d.js`, { onbellek: 'disk' }),
    girdi('https://customers-test.example/api/me'),
    girdi('data:image/png;base64,AAAA'),
    girdi(`${H}/rb_abc123`),
    girdi(`${H}/app-v1/assets/q.js?tckn=12345678901&token=GIZLITOKEN`),
    girdi(`${H}/app-v1/u/ali.veli@ornek.com/x`),
    girdi(`${H}/musteri/123456789/profil`),
    ...ek,
  ] } };
}
// Fark vakalarinin kenar HAR'i (scratchpad har_fark_uret.py `kenar()` ile ayni sira ve deger).
function kenar() {
  const k = (p: string, o: Parameters<typeof girdi>[1] = {}) => girdi(`${H}${p}`, o);
  return { comment: 'GIZLIYORUM', log: { entries: [
    k('/k/b.js', { zaman: '2026-10-26T10:00:05Z', mime: '' }),
    k('/k/b.js', { boyut: 70000, zaman: '2026-10-26T10:00:06Z' }),
    k('/k/index.html', { mime: 'text/html; charset=utf-8', zaman: '2026-10-26T10:00:07Z' }),
    k('/k/veri', { mime: 'application/json; charset=utf-8' }), k('/k/vnd', { mime: 'application/vnd.api+json' }),
    k('/k/f', { mime: 'application/font-woff' }), k('/k/f2', { mime: 'font/woff2' }), k('/k/img', { mime: 'image/avif' }),
    k('/k/tj', { mime: 'text/javascript' }), k('/k/c', { mime: 'text/css' }), k('/k/x.MJS'), k('/k/x.WOFF2'),
    k('/k/x.svg', { mime: 'image/svg+xml' }), k('/k/x.map', { mime: '' }), k('/k/dizin/'), girdi(H),
    girdi(`${H}:443/k/port.css`, { mime: 'text/css' }),
    girdi('HTTPS://GLOMO-TEST.FW.GARANTIBBVA.COM.TR/k/buyukharf.js'),
    girdi(`  ${H}/k/bosluk.js`), girdi(`https://kullanici@${HOST}:8443/k/kullanici.js`),
    girdi('https://glomo-te\tst.fw.garantibbva.com.tr/k/sekme.js'),
    k('/k/sorgu-bos.js?'), k('/k/parca.js#bolum'), k('//k/cift.js'), k('/k/../ust.js'), k('/k/rb_x/y.js'), k('/k/rb_beacon'),
    k('/k/١٢٣٤٥٦/a.js'), k('/k/u/x@2x.png', { mime: 'image/png' }), k('/k/@kapsam/paket.js'),
    k('/k/12345678901.js'), k('/k/1234567890/a.js'), k('/k/123456/a.js'), k('/k/a12345678901b.js'),
    k('/k/durum-metin.js', { durum: '200' }), k('/k/durum-kotu.js', { durum: 'abc' }), k('/k/durum-ondalik.js', { durum: 200.7 }),
    k('/k/durum-1.js', { durum: 1 }), k('/k/durum-399.js', { durum: 399 }), k('/k/durum-204.js', { durum: 204 }),
    k('/k/durum-alt.js', { durum: ' 2_00 ' }), k('/k/boyut-metin.js', { boyut: '52000' }), k('/k/boyut-eksi.js', { boyut: -1 }),
    k('/k/boyut-kotu.js', { boyut: 'x' }), k('/k/boyut-ondalik.js', { boyut: 51200.9 }), k('/k/esik.js', { boyut: 51200 }),
    k('/k/esik-alt.js', { boyut: 51199 }), k('/k/kucuk-post.js', { yontem: 'post' }), k('/k/patch.js', { yontem: 'PATCH' }),
    k('/k/uzun-yontem.js', { yontem: 'ABCDEFGHIJK' }), k('/k/yontem-sayi.js', { yontem: '' }),
    k('/k/onbellek-bos.js', { onbellek: '' }), k('/k/onbellek-prefetch.js', { onbellek: 'prefetch' }),
    k('/k/onbellek-liste.js', { onbellek: [] }), k('/k/onbellek-dolu-liste.js', { onbellek: ['x'] }),
    k('/k/onbellek-sifir.js', { onbellek: 0 }), k('/k/onbellek-dogru.js', { onbellek: true }),
    girdi(`blob:${H}/uuid`), girdi(`//${HOST}/k/semasiz.js`), girdi(`https:/${HOST}/k/tekbolu.js`),
    girdi('https://[::1]/k/v6.js'), girdi('https://[::1/k/v6kotu.js'), girdi('https://[1.2.3.4]/k/v4kose.js'),
    girdi('https://[v1.x]/k/vfuture.js'), girdi('https://x[::1]/k/onceveri.js'), girdi('https://[::1]x/k/sonraveri.js'),
    girdi(`https://${HOST}℀/k/nfkc.js`), girdi(`https://${HOST}．/k/nfkc2.js`),
    'metin-girdi', 17, null, [1, 2],
    { request: {}, response: [] },
    { request: { method: 'GET', url: `${H}/k/yanitsiz.js` } },
    { request: { method: 'GET', url: `${H}/k/icerik-yok.js` }, response: { status: 200 } },
    { request: { method: 'GET', url: `${H}/k/mime-sayi.js` }, response: { status: 200, content: { size: 5, mimeType: null } } },
    { request: { url: `${H}/k/yontem-yok.js` }, response: { status: 200 } },
    k('/k/kosullu.js', { durum: 304, boyut: 0 }), k('/k/kosullu.js', { durum: 200, boyut: 900000 }),
  ] } };
}
function ikinci() {
  return { log: { entries: [
    girdi(`${H}/app-v1/assets/a.js`, { boyut: 600000, zaman: '2026-10-26T11:00:00Z' }),
    girdi(`${H}/app-v1/assets/b.js`, { boyut: 10, zaman: '2026-10-26T10:59:00Z' }),
    girdi(`${H}/app-v1/assets/b.js`, { boyut: 10, zaman: '2026-10-26T10:59:00Z' }),
    girdi(`${H}/app-v1/assets/b.js`, { boyut: 10, zaman: '2026-10-26T10:59:00Z' }),
    girdi(`${H}/app-v1/assets/c.css`, { boyut: 800000, mime: 'text/css', durum: 304 }),
  ] } };
}
const ihlalli = () => sentetik([girdi(`${H}/app-v1/a<b>.js`), girdi(`${H}/app-v1/x".js`), girdi(`${H}/a b/c.js`)]);
const URETEC: Record<string, () => string> = {
  sentetik: () => JSON.stringify(sentetik()), kenar: () => JSON.stringify(kenar()), ikinci: () => JSON.stringify(ikinci()),
  ihlalli: () => JSON.stringify(ihlalli()), bos: () => JSON.stringify({ log: { entries: [] } }),
  bicim: () => JSON.stringify({ log: { entries: 'x' } }), bozuk: () => '{bozuk json',
};
const har = (veri: unknown, ad = 's.har.json', agirlik?: number): HarGirdisi => ({ ad, metin: JSON.stringify(veri), agirlik });
const tsv = (l: SenaryoSatiri[]) => l.map(satirMetni).join('\n') + (l.length ? '\n' : '');
const ozet = (r: ReturnType<typeof senaryoUret>) => (r.ok ? r.ozetMetni.join('\n') : '');

/** test_har_senaryo.sir_yok: ciktinin HICBIR yerinde sir, sorgu isareti ya da baslik adi yok. Kenar HAR'inda
 *  OZET'in kendi neden etiketi `get_degil_?` tasir (Python da boyle yazar): orada '?' yalniz SATIRLARDA aranir. */
function sirYok(r: ReturnType<typeof senaryoUret>, ozetteSoruOlabilir = false) {
  const tum = JSON.stringify(r) + (r.ok ? r.ozetMetni.join('\n') : '');
  for (const s of SIRLAR) expect(tum.includes(s), `ciktida '${s}' var`).toBe(false);
  const soruAlani = ozetteSoruOlabilir && r.ok ? tsv(r.K) + tsv(r.B) : tum;
  expect(soruAlani.includes('?'), "ciktida '?' var").toBe(false);
  for (const s of ['cookie', 'authorization', 'bearer', 'set-cookie', 'token', 'jsessionid']) expect(tum.toLowerCase().includes(s), `ciktida '${s}' geciyor`).toBe(false);
}

describe('harSenaryo — test_har_senaryo.py portu', () => {
  it('HS1 (A) eleme nedenleri, agirlik, tur/boyut, B.tsv, 304 sayimi ve sir sizmamasi', () => {
    const r = senaryoUret([har(sentetik())], { host: HOST });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const o = ozet(r);
    for (const parca of ['kalan=6 ', 'tekil_yol=5 ', 'get_degil_POST=1', 'get_degil_HEAD=1', 'yonlendirme_307=1',
      'yonlendirme_301=1', 'hata_404=1', 'hata_500=1', 'durum_0=1', 'onbellek_memory=1', 'onbellek_disk=1', 'baska_host=1',
      'sema_disi(data/blob)=1', 'oneagent_rb=1', 'sorgulu=1', 'kisisel_veri_suphesi=2', 'K_satir=5 ', 'K_toplam_agirlik=6 ',
      'B_satir=1 ', 'kosullu_304=1', 'K_304_agirlik=1', "NOT: K agirliginin %16.7'i tarayicida 304"]) {
      expect(o.includes(parca), `OZET'te '${parca}' yok`).toBe(true);
    }
    const k = tsv(r.K).trimEnd().split('\n').map((s) => s.split('\t'));
    expect(k.length === 5 && k.every((s) => s.length === 5)).toBe(true);
    const agirlik = Object.fromEntries(k.map((s) => [s[4], s[0]]));
    expect(agirlik['/app-v1/assets/a.js']).toBe('2');
    const turler = Object.fromEntries(k.map((s) => [s[4], [s[2], s[3]]]));
    expect(turler['/app-v1/assets/a.js']).toEqual(['js', 'buyuk']);
    expect(turler['/app-v1/assets/s.css']).toEqual(['css', 'orta']);
    expect(turler['/app-v1/config'][0]).toBe('config');
    expect(turler['/app-v1/'][0]).toBe('html');
    expect('/app-v1/assets/__federation_shared_@scope-ui/x.js' in agirlik).toBe(true);
    expect(tsv(r.B).trimEnd().split('\n')).toEqual(['1\t1\tjs\tbuyuk\t/app-v1/assets/a.js']);
    expect(r.ozet.harlar[0].belgeIlkSatirda).toBe(true);
    expect(r.ozet.harlar[0].sayfaSatir).toBe(6);
    sirYok(r);
  });

  it('HS2 (B) --sorgu-at ve sayfa agirligi 2: q.js yolu tutulur, toplam 14', () => {
    const r = senaryoUret([har(sentetik(), 's.har.json', 2)], { host: HOST, sorguAt: true });
    expect(r.ok).toBe(true);
    const o = ozet(r);
    expect(o.includes('sorgusu_atilan=1') && o.includes('kalan=7 ')).toBe(true);
    expect(o.includes('K_toplam_agirlik=14 ')).toBe(true);
    expect(r.ok && r.K.some((s) => s.yol === '/app-v1/assets/q.js')).toBe(true);
    sirYok(r);
  });

  it('HS3 (C) beyaz liste disi yol: kod 3, HICBIR satir donmez, mesaj yolu basmaz (yalniz iskelet)', () => {
    const r = senaryoUret([har(ihlalli(), 'c.har.json')], { host: HOST });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kod).toBe(KOD_GUVENLIK);
    expect(r).not.toHaveProperty('K');
    expect(r.mesaj.includes('a<b>')).toBe(false);
    expect(r.mesaj).toContain('/xxx-xx/x<x>.xx');
  });

  it('HS4 (E) kullanim hatalari kod 2: negatif agirlik, gecersiz JSON, log.entries yok, bos sonuc, gecersiz host', () => {
    const k = (r: ReturnType<typeof senaryoUret>) => (r.ok ? 0 : r.kod);
    expect(k(senaryoUret([har(sentetik(), 's.har.json', -1)], { host: HOST }))).toBe(KOD_KULLANIM);
    expect(k(senaryoUret([{ ad: 'j.har', metin: '{bozuk' }], { host: HOST }))).toBe(KOD_KULLANIM);
    expect(k(senaryoUret([har({ log: { entries: 'x' } })], { host: HOST }))).toBe(KOD_KULLANIM);
    expect(k(senaryoUret([har(sentetik())], { host: 'baska.example' }))).toBe(KOD_KULLANIM);
    expect(k(senaryoUret([har(sentetik())], { host: 'kotu host!' }))).toBe(KOD_KULLANIM);
    expect(k(senaryoUret([], { host: HOST }))).toBe(KOD_KULLANIM);
  });

  it('HS5 durustluk: kaynak kendi hakkinda abartili iddiada bulunmaz (denetim M9)', () => {
    const kaynak = readFileSync(join(__dirname, '..', 'yukTesti', 'harSenaryo.ts'), 'utf8');
    for (const ifade of ['bellekte bile', 'OKUNMAZ']) expect(kaynak.includes(ifade), `abartili ifade: ${ifade}`).toBe(false);
  });
});

describe('harSenaryo — Python ile FARK testi', () => {
  const fark = JSON.parse(readFileSync(join(__dirname, '..', 'yukTesti', 'harSenaryo.python.json'), 'utf8')) as {
    vakalar: { ad: string; host: string; sorguAt: boolean; buyukEsik: number | null; harlar: { uretec: string; ad: string; agirlik: number | null }[]; beklenen: { rc: number; K?: string; B?: string; OZET?: string } }[];
  };
  it('HS6 fikstur bos degil ve kenar vakalarini kapsiyor', () => {
    expect(fark.vakalar.length).toBeGreaterThanOrEqual(10);
    expect(fark.vakalar.some((v) => v.beklenen.OZET?.includes('url_ayristirilamadi=5'))).toBe(true);
  });
  for (const v of fark.vakalar) {
    it(`HS6 ${v.ad}: K.tsv / B.tsv / OZET.txt Python ile bayt bayt ayni`, () => {
      const r = senaryoUret(v.harlar.map((h) => ({ ad: h.ad, metin: URETEC[h.uretec](), agirlik: h.agirlik ?? undefined })),
        { host: v.host, sorguAt: v.sorguAt, buyukEsik: v.buyukEsik ?? undefined });
      if (v.beklenen.rc !== 0) {
        expect(r.ok ? 0 : r.kod).toBe(v.beklenen.rc);
        return;
      }
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(tsv(r.K)).toBe(v.beklenen.K);
      expect(tsv(r.B)).toBe(v.beklenen.B);
      expect(`${r.ozetMetni.join('\n')}\n`).toBe(v.beklenen.OZET);
      sirYok(r, true);
    });
  }
});

describe('harSenaryo — Portal kapilari', () => {
  it('HS7 bicim(): "%d" / "%g" Python gibi', () => {
    expect([bicim(2), bicim(0.5), bicim(0.1 * 3), bicim(1234567.5), bicim(7407405), bicim(0.0000123456789)])
      .toEqual(['2', '0.5', '0.3', '1.23457e+06', '7407405', '1.23457e-05']);
  });

  it('HS8 gonderim kapisi: // ile baslayan ve .. segmentli yol, 400 satir siniri', () => {
    const satir = (yol: string): SenaryoSatiri => ({ agirlik: 1, har: 1, tur: 'js', boyut: 'kucuk', yol });
    expect(gonderimKapisi([satir('/a.js')])).toEqual([]);
    expect(gonderimKapisi([satir('//k/cift.js')]).join(' ')).toContain('// ile başlıyor');
    expect(gonderimKapisi([satir('/k/../ust.js')]).join(' ')).toContain('“..” segmenti var');
    expect(gonderimKapisi(Array.from({ length: EN_COK_SATIR + 1 }, (_, i) => satir(`/a${i}.js`))).join(' ')).toContain(`en çok ${EN_COK_SATIR} satır`);
    expect(gonderimKapisi([])).not.toEqual([]);
    // Kenar HAR'i Python'dan gecen iki "kotu" yolu tasir: Portal onlari GONDERMEZ.
    const r = senaryoUret([har(kenar(), 'kenar.har.json')], { host: HOST });
    expect(r.ok && gonderimKapisi(r.K).length).toBe(1);
  });

  it('HS9 yapistirilan yol listesi: ayni kurallar, tekrar agirlik olur, satir numarali red', () => {
    const iyi = yolListesiSenaryosu('/app/a.js\n\n  /app/a.js \r\n/app/s.css\n/app/');
    expect(iyi.ok).toBe(true);
    if (iyi.ok) {
      expect(iyi.K.map((s) => [s.agirlik, s.tur, s.yol])).toEqual([[2, 'js', '/app/a.js'], [1, 'css', '/app/s.css'], [1, 'html', '/app/']]);
      expect(iyi.tekrar).toBe(1);
    }
    const kotu = yolListesiSenaryosu('/a.js\n/b.js?x=1\nhttps://h/x\n/c d.js\n/musteri/1234567/x\n//e\n/f/../g');
    expect(kotu.ok).toBe(false);
    if (!kotu.ok) expect(kotu.sorunlar.map((s) => s.satir)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(yolListesiSenaryosu('  \n').ok).toBe(false);
  });

  it('HS11 ayristirma (object_hook=_kirp karsiligi): baslik / cerez / govde / sorgu alanlari kurulurken duser', () => {
    const r = harOku('s.har.json', `${String.fromCharCode(0xfeff)}${JSON.stringify(sentetik())}`);
    expect(r.ok).toBe(true);
    const metin = JSON.stringify(r.girdiler);
    // request.url kalir (Python'da da): sorgusu ele() ile elenir / atilir, disariya yalniz yol cikar (HS1-HS2).
    for (const s of ['GIZLICEREZ', 'GIZLISET', 'GIZLIGOVDE', 'GIZLIPOST']) expect(metin.includes(s), `ayristirilan girdide '${s}' kaldi`).toBe(false);
    for (const k of ['"headers"', '"cookies"', '"queryString"', '"postData"', '"text"']) expect(metin.includes(k), `${k} silinmedi`).toBe(false);
    expect(metin).toContain('"mimeType"');
  });

  it('HS10 sunucuya giden OZET HAR dosya adini tasimaz', () => {
    const r = senaryoUret([har(sentetik(), 'musteri-ali.har')], { host: HOST });
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.stringify(gonderilecekOzet(r.ozet))).not.toContain('musteri-ali');
  });

  it('HS12 yoldaki ";" parametresi (;jsessionid) tekillestirmeden once atilir, ayri sayilir, hicbir ciktiya girmez', () => {
    expect(yolParametresiniAt('/a;jsessionid=X/b.js')).toEqual({ yol: '/a/b.js', atildi: true });
    expect(yolParametresiniAt('/a/b.js')).toEqual({ yol: '/a/b.js', atildi: false });
    const TOKEN = '8F3A2B9C0D1E2F3A4B5C6D7E8F9A0B1C';
    const r = senaryoUret([har({ log: { entries: [
      girdi(`${H}/glomo/a;jsessionid=${TOKEN}/b.js`),
      girdi(`${H}/glomo/a/b.js`),
      girdi(`${H}/glomo/login.jsf;jsessionid=${TOKEN}`, { mime: 'text/html' }),
      girdi(`${H}/glomo/x.css;JSESSIONID=${TOKEN};foo=bar`, { mime: 'text/css' }),
      girdi(`${H}/glomo/yok.js;jsessionid=${TOKEN}`, { durum: 404 }),
    ] } })], { host: HOST });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.K.map((s) => [s.agirlik, s.tur, s.yol])).toEqual([[2, 'js', '/glomo/a/b.js'], [1, 'html', '/glomo/login.jsf'], [1, 'css', '/glomo/x.css']]);
    // Tutulan istekler sayilir (404 elenen sayilmaz); OZET.txt el kitiyle ayni bicimde kalir (sayac yalniz sayisal ozette).
    expect(r.ozet.harlar[0].parametresiAtilan).toBe(3);
    expect(r.ozet.harlar[0].elenen).toEqual({ hata_404: 1 });
    const her = JSON.stringify(r) + r.ozetMetni.join('\n') + JSON.stringify(gonderilecekOzet(r.ozet));
    expect(her.includes(TOKEN)).toBe(false);
    expect(her.toLowerCase().includes('jsessionid')).toBe(false);
    expect(r.K.every((s) => !s.yol.includes(';'))).toBe(true);
    expect(gonderimKapisi(r.K)).toEqual([]);
    // Parametresiz HAR'da sayac 0.
    const temiz = senaryoUret([har(sentetik())], { host: HOST });
    expect(temiz.ok && temiz.ozet.harlar[0].parametresiAtilan).toBe(0);
  });

  it('HS13 yapistirilan listede ";" iceren yol sunucu metniyle reddedilir; gonderim kapisi da reddeder', () => {
    expect(YOL_PARAMETRESI_METNI).toBe('yolda ";" parametresi var (ör. ;jsessionid) — oturum bilgisi senaryoya giremez');
    expect(yolSorunu('/app/login.jsp;jsessionid=8F3A')).toBe(YOL_PARAMETRESI_METNI);
    expect(yolSorunu('/app/a;b/c.js')).toBe(YOL_PARAMETRESI_METNI);
    expect(yolSorunu('/app/a/c.js')).toBeNull();
    const l = yolListesiSenaryosu('/app/a.js\n/app/login.jsp;jsessionid=8F3A\n/app/b.js');
    expect(l.ok).toBe(false);
    if (!l.ok) expect(l.sorunlar).toEqual([{ satir: 2, neden: YOL_PARAMETRESI_METNI, iskelet: '/xxx/xxxxx.xxx;xxxxxxxxxx=xxxx' }]);
    expect(gonderimKapisi([{ agirlik: 1, har: 1, tur: 'js', boyut: 'kucuk', yol: '/a;x=1/b.js' }]).join(' ')).toContain('";" parametresi');
  });
});

// ── E-posta suphesi: eski duzenli ifade (polinom geri izleme) ile dogrusal uygulama AYNI sonucu vermeli ─────────
// Eski ifade ve eski kisiselVeriSuphesi BURADA referans olarak durur (uretim kodunda yok).
const ESKI_EPOSTA = /[^/@]+@[A-Za-z0-9-]*[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const ESKI_STATIK = ['.js', '.mjs', '.css', '.json', '.map', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.html', '.htm', '.txt', '.wasm'];
function eskiKisiselVeriSuphesi(yol: string): boolean {
  for (const seg of yol.split('/')) {
    if (!seg) continue;
    if (/^\p{Nd}{6,}$/u.test(seg)) return true;
    if (seg.includes('@') && !ESKI_STATIK.some((u) => seg.toLowerCase().endsWith(u)) && ESKI_EPOSTA.test(seg)) return true;
  }
  return /(?<!\p{Nd})\p{Nd}{11}(?!\p{Nd})/u.test(yol);
}
/** Tohumlu (tekrarlanabilir) uretec: mulberry32. */
function uretec(tohum: number) {
  let a = tohum >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ALFABE = ['a', 'A', '1', '-', '.', '@', '/', '_'];
/** >= 20.000 dizgi, alfabe `a A 1 - . @ / _`, uzunluk 0..40. Yarisi duz rastgele; yarisi e-postaya BENZER kurulur
 *  (yerel kisim + '@' + etiketler + '.' + harf; arada bir alfabenin tamami: hemen-hemen vakalar) ve 40'ta kesilir. */
function dizgiler(adet: number, tohum: number): string[] {
  const r = uretec(tohum);
  const harf = (n: number, kume = ALFABE) => Array.from({ length: n }, () => kume[Math.floor(r() * kume.length)]).join('');
  const out: string[] = [];
  for (let i = 0; i < adet; i += 1) {
    if (i % 2 === 0) { out.push(harf(Math.floor(r() * 41))); continue; }
    const etiket = () => harf(Math.floor(r() * 5), r() < 0.85 ? ['a', 'A', '1', '-'] : ALFABE);
    const etiketler = Array.from({ length: 1 + Math.floor(r() * 3) }, etiket);
    const tld = harf(Math.floor(r() * 5), r() < 0.85 ? ['a', 'A'] : ['a', 'A', '1', '-']);
    out.push(`${harf(Math.floor(r() * 8))}@${etiketler.join('.')}.${tld}`.slice(0, 40));
  }
  return out;
}

describe('harSenaryo — e-posta şüphesi doğrusal (2026-10-27)', () => {
  it('HS14 eski düzenli ifadeyle >= 20.000 rastgele dizgide birebir aynı (segment ve yol düzeyinde)', () => {
    const l = dizgiler(24000, 20261027);
    expect(l.length).toBeGreaterThanOrEqual(20000);
    expect(l.every((s) => s.length <= 40 && [...s].every((c) => ALFABE.includes(c)))).toBe(true);
    const farkli = l.filter((s) => ESKI_EPOSTA.test(s) !== epostaMi(s));
    expect(farkli.slice(0, 10)).toEqual([]);
    // Yol duzeyi: eski kisiselVeriSuphesi (segment basina EPOSTA.test) ile yenisi ayni.
    const yolFarki = l.map((s) => `/${s}`).filter((y) => eskiKisiselVeriSuphesi(y) !== kisiselVeriSuphesi(y));
    expect(yolFarki.slice(0, 10)).toEqual([]);
    // Test bos degil: iki sonuc da bolca var.
    const pozitif = l.filter((s) => ESKI_EPOSTA.test(s)).length;
    expect(pozitif).toBeGreaterThan(1000);
    expect(l.length - pozitif).toBeGreaterThan(1000);
    // Elle secilmis kenarlar (eski ifadeyle ayni).
    for (const [s, beklenen] of [['a@b.cc', true], ['@b.cc', false], ['a@@b.cc', false], ['a/@b.cc', false], ['x/y@b.cc', true], ['a@b@c.dd', true],
      ['a@1.cc', false], ['a@1a.cc', true], ['a@b..cc', false], ['a@b.c1', false], ['a@-.cc', false], ['a_@b.cc', true], ['a@b_c.cc', false]] as const) {
      expect([s, epostaMi(s)]).toEqual([s, beklenen]);
      expect([s, ESKI_EPOSTA.test(s)]).toEqual([s, beklenen]);
    }
  });

  it('HS15 2 KB "/a..@a.." 50 ms altında; alan kısmı en çok 253 karakter (bilinçli tavan)', () => {
    const uzun = `/${'a'.repeat(1000)}@${'a'.repeat(1000)}`;
    const yarim = `/${'a'.repeat(1500)}@${'a'.repeat(250)}`;
    const t0 = performance.now();
    expect(kisiselVeriSuphesi(uzun)).toBe(false);
    expect(yolSorunu(uzun)).toBeNull();
    expect(kisiselVeriSuphesi(yarim)).toBe(false);
    expect(epostaMi(`${'a'.repeat(2047)}@${'a'.repeat(240)}.cc`)).toBe(true);
    expect(performance.now() - t0).toBeLessThan(50);
    const alan = (n: number) => `${'a'.repeat(n - 3)}.cc`;
    expect(epostaMi(`x@${alan(253)}`)).toBe(true);
    expect(epostaMi(`x@${alan(254)}`)).toBe(false);
  });
});
