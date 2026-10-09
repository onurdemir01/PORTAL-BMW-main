// server/server-hub/reboot-rapor.cjs — Reboot Kontrolu "Durum Raporu" HTML'i (2026-10-09).
//
// Kullanici: "ekip arkadasimin emeklerinin de kaybolmasini istemiyorum; onun HTML raporunu Portal'da
// bir butona tiklaninca goruntulenebilir yap." Tasarim ekip arkadasinin
// patch_remediation/scripts/patch-aggregate-report.py `write_html` ciktisinin AYNISIDIR (stil, baslik,
// ozet kutulari, Bulgular / Otomatik Duzeltme tablolari, Normal Sunucular izgarasi, Durumlar notu;
// Outlook uyumlu tablo yerlesimi - e-postaya da yapistirilabilir).
//
// Veri ise artik o betigin okudugu compare.psv / summary.env / remediation.psv DEGIL (o boru hatti
// kaldirildi): Portal'da saklanan reboot_checks kaydidir (once goruntusu + sonra sonucu). Siniflar
// kullanicinin kuralina gore (2026-10-08/09):
//   * Surec SAYISI fark degildir (eski COUNT_CHANGED yok).
//   * DOWN = once calisan urun/JVM duzeltmeden SONRA da calismiyor -> Kritik
//   * Fazladan calisan JVM (once yoktu, duzeltmeye ragmen calisiyor) -> Kritik
//   * Duzeltilen (kapaliydi acildi / fazladan kapatildi), once calismayan yeni urun -> Bilgi
//   * boot_id degismemis -> Uyari (reboot dogrulanamadi)
//   * Olculemedi (sonuc gelmedi / son goruntu alinamadi) -> Kritik ("sorunsuz" SAYILMAZ)
'use strict';

const URUN_ADI = { NGINX: 'Nginx', RHA: 'Apache HTTP Server', IHS: 'IBM HTTP Server (IHS)', CTG: 'CTG', JBOSS7: 'JBoss 7', JBOSS8: 'JBoss 8', WAS: 'WebSphere' };
const JVM_ADI = { JBOSS7: 'JBoss 7 JVM', JBOSS8: 'JBoss 8 JVM', WAS: 'WebSphere JVM' };

function goruntu(satirlar) {
  const g = { boot: null, urun: new Set(), jvm: new Set() };
  for (const l of Array.isArray(satirlar) ? satirlar : []) {
    const p = String(l).split('|');
    if (p[0] === 'BOOT') g.boot = p[1] || null;
    else if (p[0] === 'URUN' && p[1]) g.urun.add(p[1]);
    else if (p[0] === 'JVM' && p[1] && p[2]) g.jvm.add(`${p[1]}|${p[2]}`);
  }
  return g;
}
const servisAdi = (anahtar) => {
  const [u, ad] = anahtar.split('|');
  return ad ? `${JVM_ADI[u] || u} — ${ad}` : URUN_ADI[u] || u;
};

/** Sunucu basina bulgular ve sonuc (saf; test edilir). */
function sunucuDegerlendir(onceSat, s) {
  const bulgu = [];
  if (!s || s.sonuc_yok) return { sonuc: 'PROBLEM', bulgu: [{ durum: 'OLCULEMEDI', servis: 'Sistem kontrolü', aciklama: 'Sunucudan sonuç gelmedi (ulaşılamadı ya da kopya doğrulanamadı).', onceSonra: '—' }] };
  const o = goruntu(onceSat);
  const ilk = goruntu(s.goruntu);
  const son = s.son_olculdu ? goruntu(s.son_goruntu) : null;
  if (o.boot && ilk.boot && o.boot !== 'bilinmiyor' && o.boot === ilk.boot)
    bulgu.push({ durum: 'REBOOT_NOT_CONFIRMED', servis: 'Sistem kontrolü', aciklama: 'Sunucunun boot kimliği değişmemiş; reboot doğrulanamadı.', onceSonra: '—' });
  if (!son) bulgu.push({ durum: 'OLCULEMEDI', servis: 'Sistem kontrolü', aciklama: 'Düzeltmeden sonraki son görüntü alınamadı; sorunsuz sayılmadı.', onceSonra: '—' });
  else {
    const anahtarlar = new Set([...o.urun, ...ilk.urun, ...son.urun, ...[...o.jvm, ...ilk.jvm, ...son.jvm]]);
    for (const k of [...anahtarlar].sort()) {
      const jvm = k.includes('|');
      const var_ = (g) => (jvm ? g.jvm.has(k) : g.urun.has(k));
      const urun = k.split('|')[0];
      const once = var_(o); const ilkV = var_(ilk); const sonV = var_(son);
      if (once && sonV && ilkV) continue;
      if (once && !sonV) bulgu.push({ durum: 'DOWN', servis: servisAdi(k), aciklama: 'Reboot öncesi çalışıyordu; otomatik düzeltmeye rağmen çalışmıyor.', onceSonra: 'çalışıyordu → çalışmıyor' });
      else if (once && !ilkV && sonV) bulgu.push({ durum: 'DUZELTILDI', servis: servisAdi(k), aciklama: 'Reboot sonrası kapalıydı; otomatik açıldı.', onceSonra: 'kapalıydı → çalışıyor' });
      else if (!once && jvm && !o.urun.has(urun) && sonV) bulgu.push({ durum: 'NEW_URUN', servis: servisAdi(k), aciklama: 'Ürün reboot öncesi çalışmıyordu; dokunulmadı.', onceSonra: 'yoktu → çalışıyor' });
      else if (!once && !jvm && sonV) bulgu.push({ durum: 'NEW_URUN', servis: servisAdi(k), aciklama: 'Reboot öncesi çalışmıyordu, şimdi çalışıyor; dokunulmadı.', onceSonra: 'yoktu → çalışıyor' });
      else if (!once && jvm && sonV) bulgu.push({ durum: 'NEW_KALAN', servis: servisAdi(k), aciklama: 'Reboot öncesi çalışmıyordu; kapatılması gerekirken hâlâ çalışıyor.', onceSonra: 'yoktu → çalışıyor' });
      else if (!once && ilkV && !sonV) bulgu.push({ durum: 'KAPATILDI', servis: servisAdi(k), aciklama: 'Reboot öncesi çalışmıyordu; reboot sonrası açılmıştı, otomatik kapatıldı.', onceSonra: 'yoktu → kapatıldı' });
    }
  }
  const kritik = bulgu.some((b) => ['DOWN', 'NEW_KALAN', 'OLCULEMEDI'].includes(b.durum));
  const sonuc = kritik ? 'PROBLEM' : bulgu.some((b) => b.durum === 'REBOOT_NOT_CONFIRMED') ? 'WARNING' : bulgu.length ? 'INFO' : 'OK';
  return { sonuc, bulgu };
}

const DURUM = {
  DOWN: ['Çalışmıyor (DOWN)', 'problem'], NEW_KALAN: ['Fazladan çalışıyor (NEW)', 'problem'], OLCULEMEDI: ['Ölçülemedi', 'problem'],
  REBOOT_NOT_CONFIRMED: ['Reboot doğrulanamadı', 'warning'],
  DUZELTILDI: ['Otomatik açıldı', 'info'], KAPATILDI: ['Otomatik kapatıldı', 'info'], NEW_URUN: ['Yeni süreç (NEW)', 'info'],
};
const RENK = { problem: ['#fff0f0', '#a12631'], warning: ['#fff4df', '#805300'], info: ['#edf4ff', '#17549f'], ok: ['#eaf6ee', '#20633f'] };
const SIRA = { PROBLEM: 0, WARNING: 1, INFO: 2, OK: 3 };
const e = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const kisaHost = (h) => String(h).split('.', 1)[0];
const pill = (css, metin) => `<span class='pill ${css}' style='background:${RENK[css][0]};color:${RENK[css][1]};padding:3px 8px;font-weight:bold'>${e(metin)}</span>`;

const STIL = [
  'body{margin:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;color:#202938;font-size:14px;line-height:1.45}',
  '.shell{width:100%;max-width:960px;margin:0 auto;background:#fff}', '.pad{padding:24px 28px}',
  'h1{font-size:23px;line-height:1.25;margin:0 0 6px}', 'h2{font-size:17px;margin:26px 0 10px}', '.muted{color:#687385;font-size:12px}',
  'table{width:100%;border-collapse:collapse}', 'th{font-weight:bold;text-align:left;background:#f1f4f8;color:#344054;font-size:12px}',
  'td,th{padding:10px 11px;border-bottom:1px solid #e6e9ef;vertical-align:top}', '.summary td{text-align:center;padding:13px 5px;border:1px solid #e6e9ef}',
  '.host{font-weight:bold;white-space:nowrap}', '.minor{color:#6d7581;font-size:12px;word-break:break-word}', '.note{color:#576477;font-size:12px;margin-top:9px}',
  '.pill{display:inline-block;padding:3px 8px;border-radius:4px;font-size:12px;font-weight:bold}',
  '.healthy td{padding:7px 10px;font-size:12px;border:none;color:#344054}',
].join('\n');

/** reboot_checks satiri (satir(r, true) bicimi) -> tam HTML belge. */
function raporHtml(k) {
  const onceS = k?.once?.sonuc?.sunucular || {};
  const sonraS = k?.sonra?.sonuc?.sunucular || null;
  const hostlar = Array.isArray(k?.hosts) ? k.hosts : [];
  const p = [`<!doctype html><html lang='tr'><head><meta charset='utf-8'><title>Reboot Kontrolü #${e(k?.id)} — Durum Raporu</title><style>${STIL}</style></head><body>`,
    "<table role='presentation' cellpadding='0' cellspacing='0' border='0' style='width:100%;background:#f5f7fa'><tr><td align='center'>",
    "<table role='presentation' class='shell' cellpadding='0' cellspacing='0' border='0' style='width:100%;max-width:960px;background:#ffffff'><tr><td class='pad' style='padding:24px 28px'>",
    '<h1>Patch Reboot | Durum Raporu</h1>'];
  const ust = (faz) => `<div class='muted'>${e(faz)} &nbsp;·&nbsp; Kayıt: <b>#${e(k?.id)}</b>${k?.not ? ` &nbsp;·&nbsp; ${e(k.not)}` : ''} &nbsp;·&nbsp; ${hostlar.length} sunucu &nbsp;·&nbsp; ${e(k?.olusturan || '')}</div>`;
  const kutular = (ogeler) => `<table role='presentation' class='summary' cellpadding='0' cellspacing='0'><tr>${ogeler.map(([l, v, fg, bg]) =>
    `<td style='text-align:center;border:1px solid #e6e9ef;background:${bg};padding:13px 5px'><span style='display:block;font-size:24px;font-weight:bold;color:${fg}'>${v}</span><span style='font-size:12px;color:#596579'>${e(l)}</span></td>`).join('')}</tr></table>`;

  if (!sonraS) {
    // Yalniz "once" kaydi var: neyin kaydedildigini gosterir.
    const alinan = hostlar.filter((h) => onceS[h]?.goruntu_ok && (onceS[h]?.goruntu || []).some((l) => String(l).startsWith('BOOT|')));
    p.push(ust('Reboot öncesi kayıt'), `<p style='font-size:15px;margin:17px 0 14px'><b>${alinan.length} / ${hostlar.length} sunucunun reboot öncesi görüntüsü kaydedildi.</b></p>`,
      kutular([['Sunucu', hostlar.length, '#202938', '#f7f9fc'], ['Kaydedildi', alinan.length, '#20633f', '#eaf6ee'], ['Alınamadı', hostlar.length - alinan.length, '#a12631', '#fff0f0']]),
      "<h2>Kaydedilen ürünler</h2><table cellpadding='0' cellspacing='0'><tr><th>Sunucu</th><th>Çalışan ürünler</th><th>JVM</th></tr>");
    for (const h of hostlar) {
      const g = goruntu(onceS[h]?.goruntu);
      const ok = alinan.includes(h);
      p.push(`<tr><td class='host'>${e(kisaHost(h))}</td><td>${ok ? e([...g.urun].map((u) => URUN_ADI[u] || u).join(', ') || 'izlenen ürün yok') : pill('problem', 'Görüntü alınamadı')}</td><td>${ok ? g.jvm.size : '—'}</td></tr>`);
    }
    p.push('</table>');
  } else {
    const deg = hostlar.map((h) => ({ h, ...sunucuDegerlendir(onceS[h]?.goruntu, sonraS[h]) }));
    const say = { PROBLEM: 0, WARNING: 0, INFO: 0, OK: 0 };
    for (const d of deg) say[d.sonuc] += 1;
    const baslik = !deg.length ? 'Karşılaştırma için sunucu verisi bulunamadı.' : say.PROBLEM ? `${say.PROBLEM} sunucuda kritik durum tespit edildi.`
      : say.WARNING ? `Kritik sorun yok; ${say.WARNING} sunucuda uyarı var.` : say.INFO ? `Kritik sorun ve uyarı yok; ${say.INFO} sunucuda bilgi kaydı var.` : 'Tüm sunucuların karşılaştırma sonucu normal.';
    p.push(ust('Otomatik düzeltme sonrası • Son kontrol'), `<p style='font-size:15px;margin:17px 0 14px'><b>${e(baslik)}</b></p>`,
      kutular([['Sunucu', deg.length, '#202938', '#f7f9fc'], ['Kritik', say.PROBLEM, '#a12631', '#fff0f0'], ['Uyarı', say.WARNING, '#805300', '#fff4df'], ['Bilgi', say.INFO, '#17549f', '#edf4ff'], ['Normal', say.OK, '#20633f', '#eaf6ee']]));
    const bulgular = deg.flatMap((d) => d.bulgu.map((b) => ({ ...b, h: d.h, hs: d.sonuc }))).sort((a, b) => SIRA[a.hs] - SIRA[b.hs] || a.h.localeCompare(b.h));
    p.push(`<h2>Bulgular <span class='muted'>(${bulgular.length} kayıt)</span></h2>`, "<p class='muted'>Yalnız sorunlu, düzeltilen ya da değişen kayıtlar gösterilir; normal çalışanlar tabloyu kalabalıklaştırmaz.</p>");
    if (bulgular.length) {
      p.push("<table cellpadding='0' cellspacing='0' style='width:100%;border-collapse:collapse'><tr><th>Sunucu</th><th>Servis / JVM</th><th>Durum</th><th>Önce → Sonra</th></tr>");
      for (const b of bulgular) {
        const [etiket, css] = DURUM[b.durum] || [b.durum, 'info'];
        p.push(`<tr><td class='host'>${e(kisaHost(b.h))}</td><td>${e(b.servis)}</td><td>${pill(css, etiket)}<div class='minor'>${e(b.aciklama)}</div></td><td style='white-space:nowrap'>${e(b.onceSonra)}</td></tr>`);
      }
      p.push('</table>');
    } else p.push("<p style='padding:12px 14px;background:#eaf6ee'>İzlenen ürün ve JVM'lerde sorun veya değişiklik görünmüyor.</p>");

    const islemler = deg.flatMap(({ h }) => (sonraS[h]?.islemler || []).filter((l) => String(l).startsWith('SONUC|')).map((l) => {
      const q = String(l).split('|');
      return { h, islem: q[1], urun: q[2], ad: q[3], sonuc: q[4], mesaj: q.slice(5).join('|') };
    }));
    if (islemler.length) {
      const c = { OK: 0, FAIL: 0, SKIP: 0 };
      for (const x of islemler) c[x.sonuc] = (c[x.sonuc] || 0) + 1;
      p.push(`<h2>Otomatik Düzeltme <span class='muted'>(${islemler.length} hedef)</span></h2>`,
        `<p>Başarılı komut: <b>${c.OK}</b> &nbsp;·&nbsp; Başarısız: <b>${c.FAIL}</b> &nbsp;·&nbsp; Gerek kalmadı: <b>${c.SKIP}</b></p>`,
        "<p class='note'><b>Önemli:</b> Komutun başarılı dönmesi, son görüntüde servis durumunun doğrulandığı anlamına gelmez. Nihai sonuç yukarıdaki karşılaştırmadır.</p>",
        "<table cellpadding='0' cellspacing='0'><tr><th>Sunucu</th><th>Servis / JVM</th><th>İşlem</th><th>Komut sonucu</th></tr>");
      for (const x of islemler.sort((a, b) => (a.sonuc === 'FAIL' ? 0 : 1) - (b.sonuc === 'FAIL' ? 0 : 1) || a.h.localeCompare(b.h))) {
        const css = x.sonuc === 'OK' ? 'ok' : x.sonuc === 'FAIL' ? 'problem' : 'info';
        const etiket = x.sonuc === 'OK' ? 'Komut başarılı' : x.sonuc === 'FAIL' ? 'Komut başarısız' : 'Gerek kalmadı';
        p.push(`<tr><td class='host'>${e(kisaHost(x.h))}</td><td>${e(servisAdi(x.ad ? `${x.urun}|${x.ad}` : x.urun))}</td><td>${x.islem === 'baslat' ? 'Başlat' : x.islem === 'durdur' ? 'Durdur' : e(x.islem)}</td><td>${pill(css, etiket)}<div class='minor'>${e(x.mesaj)}</div></td></tr>`);
      }
      p.push('</table>');
    }
    const normal = deg.filter((d) => d.sonuc === 'OK').map((d) => kisaHost(d.h));
    p.push(`<h2>Normal Sunucular <span class='muted'>(${normal.length})</span></h2>`);
    if (normal.length) {
      p.push("<table role='presentation' class='healthy' cellpadding='0' cellspacing='0'>");
      for (let i = 0; i < normal.length; i += 3) {
        const satir = normal.slice(i, i + 3);
        p.push(`<tr>${satir.map((h) => `<td style='width:33.33%;padding:7px 10px'>${e(h)}</td>`).join('')}${'<td style=\'width:33.33%\'>&nbsp;</td>'.repeat(3 - satir.length)}</tr>`);
      }
      p.push('</table>');
    } else p.push("<p class='muted'>Normal sınıfında sunucu bulunmuyor.</p>");
  }
  p.push("<p class='note' style='border-top:1px solid #e6e9ef;padding-top:14px'><b>Durumlar:</b> DOWN = reboot öncesi çalışıyordu, düzeltmeden sonra da çalışmıyor; NEW = reboot öncesi yoktu, şimdi çalışıyor. "
    + 'İzlenen ürünler: Nginx, Apache, IBM HTTP Server, CTG, JBoss 7/8, WebSphere ve JVM\'leri. Süreç sayısındaki değişim fark sayılmaz. '
    + 'Rapor tasarımı: patch-aggregate-report.py (patch_remediation).</p>',
  '</td></tr></table></td></tr></table></body></html>');
  return p.join('\n');
}

module.exports = { raporHtml, sunucuDegerlendir };
