// server/server-hub/ear-envanter-alim.cjs - Uygulama Envanteri: /sw ham dosyasi -> DB (2026-11-04).
//
// ear_envanter.yml her host icin <EAR_ENVANTER_DIR>/kosu-<id>/raw/<HOST>.out yazar: isaretler arasinda
// zlib + base64 JSON (ear_tara.py, sema 1). Bu modul:
//   1. dosyayi SINIRLI okur (boyut once stat ile; acilmis JSON zlib maxOutputLength ile sinirli),
//   2. semayi dogrular ve kayitlari duzler (her metin kirpilir; agac satirlari DB'ye YAZILMAZ),
//   3. kutuphane listelerinden teknoloji kolonlarini cikarir (Spring Boot / Framework, log4j ...),
//   4. host basina TEK transaction ile yazar (yeniden alim ayni host satirlarini silip yeniden yazar).
//
// TARAYICI SURUM 2 (2026-11-06): kokteki .ear disi girdiler (host.kok_girdileri), JBoss domain.xml /
// host.xml ozeti (host.xml_ozeti) ve uygulama basina EAR -> JVM eslemesi (uygulama.xml_eslesme).
// Eski tarayicinin paketinde bu alanlar yoktur: kolon NULL = OLCULMEDI ("yok" DEGIL).
//
// FAZ 2 (2026-11-06): ayni ham dosyada, tarayici paketinden SONRA istege bagli deployment blogu
// (files/deployment_oku.sh; ear_deployment_kontrol). Calisan JVM basina JBoss CLI
// read-children-resources(child-type=deployment) ciktisi (DMR metni) -> host.deployment_ozeti. Blok
// yoksa NULL = olculmedi (kontrol kapali ya da eski playbook).
//
// KUTUPHANE SETLERI: ayni uygulamanin eslenik sunuculardaki WAR'lari ayni kutuphane listesini tasir.
// Liste her WAR satirina yazilsa haftalik filo kosusu yuzlerce MB olurdu; liste parmak iziyle
// (sha256, 32 hex) BIR KEZ yazilir, WAR satiri yalniz izi tasir.
//
// BELLEK (OOM sinifi, 2026-09): ham dosya ve acilmis JSON ayri sinirli; buyuk metinden alt dizi
// (V8 sliced string) tutulmaz, base64 dogrudan Buffer dilimi uzerinden cozulur. Agac satirlari
// alimdan sonra birakilir.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BASLA = Buffer.from('@@EAR_ENVANTER_BASLA@@');
const BITTI = Buffer.from('@@EAR_ENVANTER_BITTI@@');
const HAM_SINIR = 48 * 1024 * 1024;
const JSON_SINIR = 64 * 1024 * 1024;
const SINIR_UYGULAMA = 2000;
const SINIR_WAR = 200;
const SINIR_KUTUPHANE = 2000;
const SINIR_KOK_GIRDI = 500;
const SINIR_XML_KAYIT = 300;
const XML_DURUMLARI = Object.freeze(['OKUNDU', 'YOK', 'IZIN', 'DOSYA_DEGIL', 'BUYUK', 'REDDEDILDI', 'BOZUK', 'HATA']);
const ESLESME_DURUMLARI = Object.freeze(['VAR', 'JVM_YOK', 'OLCULEMEDI']);
const DEP_BASLA = Buffer.from('@@EAR_DEPLOYMENT_BASLA@@');
const DEP_BITTI = Buffer.from('@@EAR_DEPLOYMENT_BITTI@@');
// OK: CLI okundu; digerleri olculemedi. AYRISTIRILAMADI: CLI cevap verdi ama metin DMR degil.
const DEP_JVM_DURUMLARI = Object.freeze([
  'OK',
  'CLI_YOK',
  'ZAMAN_ASIMI',
  'HATA',
  'GECERSIZ_AD',
  'BUTCE_DOLDU',
  'BASH_YOK',
  'AYRISTIRILAMADI',
]);
const SINIR_DEP_JVM = 200;
const SINIR_DEP = 200;
const VARSAYILAN_DIZIN = '/sw/BMW_PORTAL/ear_envanter';
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

// Host durumlari. veri_var: tarayici paketi okundu (KOK_YOK da bir cevaptir: o sunucuda uygulama yok).
const HOST_DURUMLARI = Object.freeze([
  'TAM',
  'KISMI',
  'KOK_YOK',
  'ZAMAN_ASIMI',
  'PYTHON_YOK',
  'KIMLIK_GECISI_YOK',
  'ULASILAMADI',
  'YAZILAMADI',
  'HATA',
  'SONUC_YOK',
  'OKUNAMADI',
]);

function kodluHata(kod, mesaj) {
  return Object.assign(new Error(mesaj), { kod });
}

const M = (v, n) => String(v == null ? '' : v).slice(0, n);
const S = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(Math.trunc(n), 2147483647)) : 0;
};
const B = (v) => (v === true ? 1 : 0);
const D = (v, liste, varsayilan) => (liste.includes(v) ? v : varsayilan);
const N = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.trunc(Number(v))));
const dizi = (v) => (Array.isArray(v) ? v : []);
const nesne = (v) => (v && typeof v === 'object' ? v : {});

/**
 * Cikti koku. Env (Admin > Sistem, EAR_ENVANTER_DIR) HER KULLANIMDA okunur; gecersizse varsayilan.
 * Mutlak, '..' yok, en az iki seviye (kok '/' ya da '/sw' silinecek dizin olarak secilemesin).
 */
function earDizin(env = process.env) {
  const s = String(env.EAR_ENVANTER_DIR || '')
    .trim()
    .replace(/\/+$/, '');
  if (!s) return VARSAYILAN_DIZIN;
  const parcalar = s.split('/');
  if (!/^\/[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(s) || parcalar.includes('..') || parcalar.length < 3)
    return VARSAYILAN_DIZIN;
  return s;
}

// Kosunun /sw alt dizini: Portal'in kosusu kosu-<id>; AWX'ten (Limit ile) alinan kosu awx-<AWX is no>.
const ALT_DIZIN_RE = /^(kosu|awx)-\d{1,9}$/;

/** Kosu satirindan alt dizin. AWX kosusunun is numarasi parametrelerde; yoksa yol KURULMAZ. */
function kosuAltDizini(kosu) {
  if (kosu && kosu.kaynak === 'AWX') {
    let p = {};
    try {
      p = typeof kosu.parametreler === 'string' ? JSON.parse(kosu.parametreler) : kosu.parametreler;
    } catch {
      p = {};
    }
    const n = Number(p && p.awx_job_id);
    if (!Number.isInteger(n) || n <= 0) throw kodluHata('GECERSIZ', 'AWX koşusunun iş numarası yok');
    return `awx-${n}`;
  }
  return `kosu-${Number(kosu && kosu.id)}`;
}

/** kosu: Portal kosu numarasi ya da kosuAltDizini() sonucu (kosu-<n> / awx-<n>). */
function hamDosyaYolu(dizin, kosu, host) {
  const alt =
    typeof kosu === 'string' && ALT_DIZIN_RE.test(kosu)
      ? kosu
      : Number.isInteger(Number(kosu))
        ? `kosu-${Number(kosu)}`
        : null;
  if (!alt || !HOST_RE.test(String(host))) throw kodluHata('GECERSIZ', 'geçersiz koşu / host');
  return path.join(dizin, alt, 'raw', `${String(host).toUpperCase()}.out`);
}

/** Dosyayi sinirli okur: once stat; sinir asilirsa okumaz. */
async function hamOku(yol) {
  let st;
  try {
    st = await fs.promises.stat(yol);
  } catch (e) {
    throw kodluHata(
      e.code === 'ENOENT' ? 'DOSYA_YOK' : 'OKUNAMADI',
      `ham dosya okunamadı (${e.code || e.message})`,
    );
  }
  if (!st.isFile()) throw kodluHata('OKUNAMADI', 'ham dosya düz dosya değil');
  if (st.size > HAM_SINIR)
    throw kodluHata(
      'COK_BUYUK',
      `ham dosya ${Math.round(st.size / 1048576)} MB (sınır ${HAM_SINIR / 1048576} MB)`,
    );
  try {
    return await fs.promises.readFile(yol);
  } catch (e) {
    throw kodluHata('OKUNAMADI', `ham dosya okunamadı (${e.code || e.message})`);
  }
}

/** Ham cikti (Buffer) -> tarayici yuku. Isaret yok / bozuk / sinir asimi / sema disi -> kodlu hata. */
function paketCoz(buf) {
  const a = buf.indexOf(BASLA);
  const b = a < 0 ? -1 : buf.indexOf(BITTI, a + BASLA.length);
  if (a < 0 || b < 0) throw kodluHata('PAKET_YOK', 'tarayıcı paketi yok (işaretler bulunamadı)');
  // Base64 cozucu bosluk / satir sonunu yok sayar; latin1 kopyasi ASCII'dir ve hemen birakilir.
  const z = Buffer.from(buf.subarray(a + BASLA.length, b).toString('latin1'), 'base64');
  let ham;
  try {
    ham = zlib.inflateSync(z, { maxOutputLength: JSON_SINIR });
  } catch (e) {
    if (e && (e.code === 'ERR_BUFFER_TOO_LARGE' || /larger than/i.test(e.message)))
      throw kodluHata('COK_BUYUK', `açılmış paket ${JSON_SINIR / 1048576} MB sınırını aştı`);
    throw kodluHata('BOZUK', `paket açılamadı (${e.code || e.message})`);
  }
  let p;
  try {
    p = JSON.parse(ham.toString('utf8'));
  } catch {
    throw kodluHata('BOZUK', 'paket JSON değil');
  }
  if (!p || typeof p !== 'object' || p.sema !== 1 || !Array.isArray(p.uygulamalar))
    throw kodluHata('SEMA', `beklenmeyen paket şeması (${p && p.sema})`);
  return p;
}

/** '/vhosting8' -> '8', '/vhosting' -> '7', digeri '?'. Koke gore JBoss nesli (pilot: ayni EAR iki kokte). */
function jbossOf(kok) {
  const s = String(kok || '').replace(/\/+$/, '');
  if (/\/vhosting8$/.test(s)) return '8';
  if (/\/vhosting$/.test(s)) return '7';
  return '?';
}

const anaSurum = (v) => {
  const m = /^(\d+)/.exec(String(v || ''));
  return m ? Number(m[1]) : null;
};

/**
 * Kutuphane listesi [[ad, surum, boyut], ...] -> teknoloji kolonlari. Ayni adda birden cok jar
 * (cakisan surumler) varsa surumler ', ' ile birlesir: ekran bunu GIZLEMEZ.
 * servlet: jakarta.* / javax.* jar'i, yoksa Spring nesli (Boot 3+ / Framework 6+ jakarta).
 */
function teknoloji(liste) {
  const surumler = new Map();
  let jakarta = false;
  let javax = false;
  for (const k of Array.isArray(liste) ? liste : []) {
    const ad = String((k && k[0]) || '').toLowerCase();
    const surum = String((k && k[1]) || '');
    if (ad.startsWith('jakarta.')) jakarta = true;
    if (ad.startsWith('javax.')) javax = true;
    if (!surumler.has(ad)) surumler.set(ad, new Set());
    if (surum) surumler.get(ad).add(surum);
  }
  const al = (...adlar) => {
    const out = new Set();
    for (const a of adlar) for (const s of surumler.get(a) || []) out.add(s);
    return M([...out].sort().join(', '), 64) || null;
  };
  const boot = al('spring-boot');
  const fw = al('spring-core');
  if (!jakarta && !javax) {
    const b = anaSurum(boot);
    const f = anaSurum(fw);
    if ((b != null && b >= 3) || (f != null && f >= 6)) jakarta = true;
    else if ((b != null && b < 3) || (f != null && f < 6)) javax = true;
  }
  return {
    spring_boot: boot,
    spring_framework: fw,
    spring_security: al('spring-security-core'),
    log4j: al('log4j-core', 'log4j'),
    logback: al('logback-classic', 'logback-core'),
    jackson: al('jackson-databind'),
    thymeleaf: al('thymeleaf'),
    struts: al('struts2-core', 'struts-core', 'struts'),
    servlet: jakarta && javax ? 'karisik' : jakarta ? 'jakarta' : javax ? 'javax' : null,
  };
}

const izOf = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);

/**
 * SURUM IZI (2026-11-05): ayni setin BOYUTSUZ izi ([ad, surum] listesi, ayni sirayla). Iki kopyanin
 * kutuphane izleri farkli ama surum izleri ayniysa fark yalniz jar boyutundadir (ayni surum, farkli
 * dosya). DB'deki eski setler icin eslenik analizi bunu set satirlarindan (sira ile) yeniden hesaplar.
 */
function surumIzi(satirlar) {
  return izOf((satirlar || []).map((k) => [k[0], k[1]]));
}

/** Kutuphane listesi -> { iz, surumIzi, satirlar, kesildi } (sirali, kirpilmis). Bos liste -> null. */
function kutuphaneSeti(liste) {
  const ham = Array.isArray(liste) ? liste : [];
  const satirlar = ham
    .slice(0, SINIR_KUTUPHANE)
    .map((k) => [M(k && k[0], 200), M(k && k[1], 100), S(k && k[2])])
    .sort((x, y) =>
      x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : x[2] - y[2],
    );
  if (!satirlar.length) return null;
  return {
    iz: izOf(satirlar),
    surumIzi: surumIzi(satirlar),
    satirlar,
    kesildi: ham.length > SINIR_KUTUPHANE,
  };
}

/** Kokteki .ear disi girdiler -> JSON { girdiler, kesilen }. Alan yok (eski tarayici) -> null. */
function kokGirdileri(p) {
  if (!Array.isArray(p.kok_girdileri)) return null;
  const girdiler = p.kok_girdileri.slice(0, SINIR_KOK_GIRDI).map((ham) => {
    const g = nesne(ham);
    return {
      kok: M(g.kok, 128),
      ad: M(g.ad, 256),
      tip: D(g.tip, ['D', 'F', 'L'], '?'),
      boyut: N(g.boyut),
      mtime: N(g.mtime),
      hedef: M(g.hedef, 300) || null,
    };
  });
  const kesilen = S(p.kok_girdisi_kesilen) + Math.max(0, p.kok_girdileri.length - SINIR_KOK_GIRDI);
  return JSON.stringify({ girdiler, kesilen });
}

/**
 * JBoss yapilandirma ozeti (kurulum basina) -> JSON. Yalniz adlar, yollar, grup ve auto-start;
 * tarayici baska deger gondermez, burada da yalniz bilinen alanlar secilir. Alan yok -> null.
 */
function xmlOzeti(p) {
  if (!Array.isArray(p.yapilandirma)) return null;
  return JSON.stringify(
    p.yapilandirma.slice(0, 4).map((ham) => {
      const k = nesne(ham);
      const sunucular = dizi(k.sunucular);
      const gruplar = dizi(k.gruplar);
      const deploymentlar = dizi(k.deploymentlar);
      return {
        kurulum: M(k.kurulum, 200),
        nesil: D(k.nesil, ['7', '8'], '?'),
        dizin: M(k.dizin, 300),
        domain: D(k.domain, XML_DURUMLARI, 'HATA'),
        host: D(k.host, XML_DURUMLARI, 'HATA'),
        host_adi: M(k.host_adi, 128),
        sunucular: sunucular.slice(0, SINIR_XML_KAYIT).map((x) => ({
          ad: M(nesne(x).ad, 128),
          grup: M(nesne(x).grup, 128),
          auto_start: nesne(x).auto_start !== false,
        })),
        gruplar: gruplar.slice(0, SINIR_XML_KAYIT).map((x) => ({
          ad: M(nesne(x).ad, 128),
          deploymentlar: dizi(nesne(x).deploymentlar)
            .slice(0, 50)
            .map((d) => ({ ad: M(nesne(d).ad, 256), acik: nesne(d).acik !== false })),
        })),
        deploymentlar: deploymentlar.slice(0, SINIR_XML_KAYIT).map((x) => ({
          ad: M(nesne(x).ad, 256),
          tur: D(nesne(x).tur, ['ACIK', 'ARSIV', 'YONETILEN'], 'YONETILEN'),
          yol: M(nesne(x).yol, 400),
        })),
        kesildi:
          k.kesildi === true ||
          sunucular.length > SINIR_XML_KAYIT ||
          gruplar.length > SINIR_XML_KAYIT ||
          deploymentlar.length > SINIR_XML_KAYIT,
      };
    }),
  );
}

/** Uygulama -> JVM eslemesi -> JSON. Alan yok (eski tarayici) -> null; bilinmeyen durum OLCULEMEDI. */
function xmlEslesme(u) {
  if (!u.xml_eslesme || typeof u.xml_eslesme !== 'object') return null;
  const x = u.xml_eslesme;
  const durum = D(x.durum, ESLESME_DURUMLARI, 'OLCULEMEDI');
  return JSON.stringify({
    durum,
    neden: M(x.neden, 300) || null,
    deploymentlar: dizi(x.deploymentlar)
      .slice(0, 10)
      .map((ham) => {
        const d = nesne(ham);
        return {
          kurulum: M(d.kurulum, 200),
          ad: M(d.ad, 256),
          tur: D(d.tur, ['ACIK', 'ARSIV', 'YONETILEN'], 'YONETILEN'),
          yol: M(d.yol, 400),
          yontem: D(d.yontem, ['YOL', 'AD'], 'AD'),
          gruplar: dizi(d.gruplar)
            .slice(0, 20)
            .map((g) => ({ ad: M(nesne(g).ad, 128), acik: nesne(g).acik !== false })),
        };
      }),
    jvmler: dizi(x.jvmler)
      .slice(0, 50)
      .map((ham) => {
        const j = nesne(ham);
        return {
          ad: M(j.ad, 128),
          grup: M(j.grup, 128),
          auto_start: j.auto_start !== false,
          deployment_acik: j.deployment_acik !== false,
          kurulum: M(j.kurulum, 200),
        };
      }),
  });
}

/**
 * JBoss DMR metni (CLI ciktisi) -> JS degeri. Sinirli: derinlik 64, metin 256 KB. Desteklenen:
 * { "a" => v }, [ ... ], ("a" => v), "metin", 12 / 12L / -1.5, true / false / undefined, bytes {..}
 * (null), expression "..", big decimal / big integer N; bilinmeyen ciplak sozcuk metin olur.
 * Gecersiz metin -> hata firlatir (cagiran AYRISTIRILAMADI der).
 */
function dmrAyristir(metin) {
  const s = String(metin).slice(0, 256 * 1024);
  let i = s.indexOf('{');
  if (i < 0) throw new Error('DMR nesnesi yok');
  const bosluk = () => {
    while (i < s.length && /[\s,]/.test(s[i])) i += 1;
  };
  const deger = (derinlik) => {
    if (derinlik > 64) throw new Error('DMR cok derin');
    bosluk();
    const c = s[i];
    if (c === '{' || c === '[') {
      const nesne = c === '{';
      const kapa = nesne ? '}' : ']';
      i += 1;
      const out = nesne ? {} : [];
      for (;;) {
        bosluk();
        if (i >= s.length) throw new Error('DMR kapanmadi');
        if (s[i] === kapa) {
          i += 1;
          return out;
        }
        if (nesne) {
          const k = deger(derinlik + 1);
          bosluk();
          if (s.slice(i, i + 2) !== '=>') throw new Error('DMR => bekleniyordu');
          i += 2;
          out[String(k)] = deger(derinlik + 1);
        } else out.push(deger(derinlik + 1));
      }
    }
    if (c === '(') {
      i += 1;
      const k = deger(derinlik + 1);
      bosluk();
      if (s.slice(i, i + 2) !== '=>') throw new Error('DMR => bekleniyordu');
      i += 2;
      const v = deger(derinlik + 1);
      bosluk();
      if (s[i] !== ')') throw new Error('DMR ) bekleniyordu');
      i += 1;
      return { [String(k)]: v };
    }
    if (c === '"') {
      let out = '';
      i += 1;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length) i += 1;
        out += s[i];
        i += 1;
      }
      if (i >= s.length) throw new Error('DMR metni kapanmadi');
      i += 1;
      return out;
    }
    const kalan = s.slice(i, i + 64);
    let m = /^bytes\s*\{/.exec(kalan);
    if (m) {
      const son = s.indexOf('}', i);
      if (son < 0) throw new Error('DMR bytes kapanmadi');
      i = son + 1;
      return null;
    }
    m = /^expression\s+/.exec(kalan);
    if (m) {
      i += m[0].length;
      return deger(derinlik + 1);
    }
    m = /^big (?:decimal|integer)\s+/.exec(kalan);
    if (m) i += m[0].length;
    m = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?L?/.exec(s.slice(i, i + 64));
    if (m) {
      i += m[0].length;
      return Number(m[0].replace(/L$/, ''));
    }
    m = /^[A-Za-z_][\w.$-]*/.exec(kalan);
    if (m) {
      i += m[0].length;
      return m[0] === 'true' ? true : m[0] === 'false' ? false : m[0] === 'undefined' ? null : m[0];
    }
    throw new Error(`DMR beklenmeyen karakter: ${JSON.stringify(c)}`);
  };
  return deger(0);
}

/**
 * Ham dosyadaki deployment blogu -> { surum, kesik, jvmler: [{ nesil, ad, durum, rc, hata,
 * deploymentlar: [{ ad, calisma_adi, etkin, durum }] | null }] }. Blok yoksa null (olculmedi).
 */
function deploymentCoz(buf) {
  const a = buf.indexOf(DEP_BASLA);
  if (a < 0) return null;
  const b = buf.indexOf(DEP_BITTI, a + DEP_BASLA.length);
  const metin = buf.subarray(a + DEP_BASLA.length, b < 0 ? buf.length : b).toString('utf8');
  const out = { surum: null, kesik: b < 0, jvmler: [] };
  let son = null;
  let govde = [];
  const kapat = () => {
    if (!son) return;
    if (son.durum === 'OK') {
      try {
        const v = dmrAyristir(govde.join('\n'));
        if (v && v.outcome === 'success' && v.result && typeof v.result === 'object' && !Array.isArray(v.result)) {
          const liste = Object.entries(v.result);
          son.deploymentlar = liste.slice(0, SINIR_DEP).map(([k, d]) => {
            const r = d && typeof d === 'object' ? d : {};
            return {
              ad: M(r.name || k, 256),
              calisma_adi: M(r['runtime-name'] || '', 256) || null,
              etkin: r.enabled === false ? false : r.enabled === true ? true : null,
              durum: r.status == null ? null : M(r.status, 32),
            };
          });
          if (liste.length > SINIR_DEP) out.kesik = true;
        } else {
          son.durum = 'HATA';
          son.hata = M((v && v['failure-description']) || 'CLI basarisiz', 300);
        }
      } catch (e) {
        son.durum = 'AYRISTIRILAMADI';
        son.hata = M(e.message, 300);
      }
    } else if (son.durum === 'HATA') son.hata = M(govde.join(' ').replace(/\s+/g, ' ').trim(), 300) || null;
    if (out.jvmler.length < SINIR_DEP_JVM) out.jvmler.push(son);
    else out.kesik = true;
    son = null;
    govde = [];
  };
  for (const satir of metin.split('\n')) {
    const t = satir.replace(/\r$/, '');
    let m;
    if ((m = /^surum=(\d+)$/.exec(t)) && !son) out.surum = Number(m[1]);
    else if ((m = /^@@JVM@@ (\S+) (\S+) (\S+)(?: (-?\d+))?$/.exec(t))) {
      kapat();
      son = {
        nesil: D(m[1], ['7', '8'], '?'),
        ad: M(m[2], 128),
        durum: D(m[3], DEP_JVM_DURUMLARI, 'HATA'),
        rc: m[4] == null ? null : Number(m[4]),
        hata: null,
        deploymentlar: null,
      };
    } else if (t === '@@JVM_SON@@') kapat();
    else if (son) govde.push(t);
  }
  kapat();
  return out;
}

const birlesik = (degerler, n) => {
  const s = new Set();
  for (const v of degerler) if (v) for (const p of String(v).split(', ')) s.add(p);
  return M([...s].sort().join(', '), n) || null;
};

/**
 * Tarayici yuku -> DB'ye yazilacak duz kayitlar. Agac satirlari (satirlar) ALINMAZ.
 * @returns {{ host: object, uygulamalar: object[], warlar: object[], setler: Map<string, Array<[string, string, number]>> }}
 */
function hostKaydi(p, { host, kip, partiNo, ortam, playbookDurum, hamBayt, deployment = null }) {
  const setler = new Map();
  // SESSIZ KESILME YOK (2026-11-05): sinirdan fazlasi alinmaz ama uygulama KISMI_SINIR olur ve
  // uyarisi yazilir; eksik liste eslenik karsilastirmasinda "ayni" ya da "farkli" sayilmaz.
  let kesilen = null;
  const setEkle = (liste, yer) => {
    const s = kutuphaneSeti(liste);
    if (!s) return null;
    if (s.kesildi && kesilen) kesilen.push(`${yer}: kütüphane sayısı ${liste.length}; ilk ${SINIR_KUTUPHANE} alındı`);
    if (!setler.has(s.iz)) setler.set(s.iz, s.satirlar);
    return s.iz;
  };
  const uygulamalar = [];
  const warlar = [];
  const kaynak = p.uygulamalar.slice(0, SINIR_UYGULAMA);
  let eksikUygulama = false;
  kaynak.forEach((u, i) => {
    kesilen = [];
    const tumWar = Array.isArray(u.warlar) ? u.warlar : [];
    if (tumWar.length > SINIR_WAR)
      kesilen.push(`WAR sayısı ${tumWar.length}; ilk ${SINIR_WAR} alındı`);
    const wlist = tumWar.slice(0, SINIR_WAR);
    const wtek = wlist.map((w, j) => {
      const t = teknoloji(w.kutuphaneler);
      const kutuphaneSayisi = Array.isArray(w.kutuphaneler) ? w.kutuphaneler.length : 0;
      const once = kesilen.length;
      const kutuphaneSetiIz = setEkle(w.kutuphaneler, M(w.yol || w.ad, 200));
      const warDurum = M(w.durum, 24);
      const satir = {
        uyg_no: i,
        war_no: j,
        yol: M(w.yol, 400),
        ad: M(w.ad, 256),
        bicim: M(w.bicim, 16),
        durum: kesilen.length > once && warDurum === 'TAM' ? 'KISMI_SINIR' : warDurum,
        jsp: S(w.jsp),
        tld: S(w.tld),
        jar: S(w.jar),
        class_sayisi: S(w.class),
        tld_dizini: B(w.tld_dizini),
        web_xml: B(w.web_xml),
        web_varyantlari:
          M((Array.isArray(w.web_varyantlari) ? w.web_varyantlari : []).join(','), 400) || null,
        jboss_web_xml: B(w.jboss_web_xml),
        jboss_deployment_structure: B(w.jboss_deployment_structure),
        kutuphane_seti: kutuphaneSetiIz,
        kutuphane_sayisi: S(kutuphaneSayisi),
        ...t,
      };
      warlar.push(satir);
      return satir;
    });
    const earLib = Array.isArray(u.ear_kutuphaneleri) ? u.ear_kutuphaneleri : [];
    const earTek = teknoloji(earLib);
    const earSet = setEkle(earLib, 'EAR lib');
    const uygDurum = M(u.durum, 24);
    const durumU = kesilen.length && uygDurum === 'TAM' ? 'KISMI_SINIR' : uygDurum;
    if (durumU !== 'TAM') eksikUygulama = true;
    const uyariListesi = [
      ...kesilen,
      ...(Array.isArray(u.uyarilar) ? u.uyarilar : []),
    ];
    uygulamalar.push({
      uyg_no: i,
      kip: M(kip, 8),
      kok: M(u.kok, 128),
      jboss: jbossOf(u.kok),
      ad: M(u.ad, 256),
      bicim: M(u.bicim, 16),
      durum: durumU,
      bag_hedefi: M(u.bag_hedefi, 400) || null,
      giris: S(u.giris),
      jsp: S(u.jsp),
      tld: S(u.tld),
      jar: S(u.jar),
      class_sayisi: S(u.class),
      application_xml: B(u.application_xml),
      ear_kutuphane_seti: earSet,
      ear_kutuphane_sayisi: S(earLib.length),
      // GERCEK sayi: alinan WAR satiri sinirdaysa uyarida yazar.
      war_sayisi: tumWar.length,
      yapi_izi: M(u.yapi_izi, 32) || null,
      kutuphane_izi: M(u.kutuphane_izi, 32) || null,
      spring_boot: birlesik([earTek.spring_boot, ...wtek.map((w) => w.spring_boot)], 100),
      spring_framework: birlesik(
        [earTek.spring_framework, ...wtek.map((w) => w.spring_framework)],
        100,
      ),
      log4j: birlesik([earTek.log4j, ...wtek.map((w) => w.log4j)], 100),
      servlet: birlesik([earTek.servlet, ...wtek.map((w) => w.servlet)], 16),
      uyari_sayisi: S(u.uyari_sayisi) + kesilen.length,
      uyarilar: M(JSON.stringify(uyariListesi.slice(0, 20).map((x) => M(x, 300))), 8000),
      xml_eslesme: xmlEslesme(u),
    });
  });
  kesilen = null;
  const uyarilar = (Array.isArray(p.uyarilar) ? p.uyarilar : []).slice(0, 50).map((x) => M(x, 300));
  if (p.uygulamalar.length > kaynak.length)
    uyarilar.push(`uygulama sayısı ${p.uygulamalar.length}; ilk ${SINIR_UYGULAMA} alındı`);
  const durum = HOST_DURUMLARI.includes(p.durum) ? p.durum : 'KISMI';
  const eksikHost = p.uygulamalar.length > kaynak.length || eksikUygulama;
  return {
    host: {
      parti_no: S(partiNo),
      ortam: M(ortam, 128) || null,
      durum: eksikHost && durum === 'TAM' ? 'KISMI' : durum,
      playbook_durum: M(playbookDurum, 24) || null,
      veri_var: 1,
      uygulama_sayisi: uygulamalar.length,
      war_sayisi: warlar.length,
      giris: S(p.giris),
      sure_sn: Number.isFinite(Number(p.sure_sn)) ? Number(p.sure_sn) : null,
      python: M(p.python, 32) || null,
      kullanici: M(p.kullanici, 64) || null,
      kokler: M(JSON.stringify(Array.isArray(p.kokler) ? p.kokler.slice(0, 8) : []), 1000),
      uyarilar: M(JSON.stringify(uyarilar), 16000),
      hata: null,
      ham_bayt: S(hamBayt),
      // 'Z' atilir: DATETIME2 donusumu bicim kuralina takilmasin (deger zaten UTC).
      taranma_utc: /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(String(p.baslangic_utc || ''))
        ? p.baslangic_utc.slice(0, 19)
        : null,
      bildirilen_host: M(p.host, 128) || null,
      kok_girdileri: kokGirdileri(p),
      xml_ozeti: xmlOzeti(p),
      deployment_ozeti: deployment ? JSON.stringify(deployment) : null,
    },
    uygulamalar,
    warlar,
    setler,
    host_adi: host,
  };
}

/** Paket okunamayan host icin tek satir (uygulama yok, veri_var 0). */
function bosHostKaydi({ partiNo, ortam, durum, playbookDurum, hata, hamBayt }) {
  return {
    host: {
      parti_no: S(partiNo),
      ortam: M(ortam, 128) || null,
      durum: HOST_DURUMLARI.includes(durum) ? durum : 'HATA',
      playbook_durum: M(playbookDurum, 24) || null,
      veri_var: 0,
      uygulama_sayisi: 0,
      war_sayisi: 0,
      giris: null,
      sure_sn: null,
      python: null,
      kullanici: null,
      kokler: null,
      uyarilar: null,
      hata: M(hata, 1000) || null,
      ham_bayt: hamBayt == null ? null : S(hamBayt),
      taranma_utc: null,
      bildirilen_host: null,
      kok_girdileri: null,
      xml_ozeti: null,
      deployment_ozeti: null,
    },
    uygulamalar: [],
    warlar: [],
    setler: new Map(),
  };
}

const HOST_KOLONLAR = [
  'parti_no INT',
  'ortam NVARCHAR(128)',
  'durum NVARCHAR(24)',
  'playbook_durum NVARCHAR(24)',
  'veri_var BIT',
  'uygulama_sayisi INT',
  'war_sayisi INT',
  'giris INT',
  'sure_sn FLOAT',
  'python NVARCHAR(32)',
  'kullanici NVARCHAR(64)',
  'kokler NVARCHAR(1000)',
  'uyarilar NVARCHAR(MAX)',
  'hata NVARCHAR(1000)',
  'ham_bayt INT',
  'taranma_utc DATETIME2',
  'bildirilen_host NVARCHAR(128)',
  'kok_girdileri NVARCHAR(MAX)',
  'xml_ozeti NVARCHAR(MAX)',
  'deployment_ozeti NVARCHAR(MAX)',
];
const UYG_KOLONLAR = [
  'uyg_no INT',
  'kip NVARCHAR(8)',
  'kok NVARCHAR(128)',
  'jboss NVARCHAR(4)',
  'ad NVARCHAR(256)',
  'bicim NVARCHAR(16)',
  'durum NVARCHAR(24)',
  'bag_hedefi NVARCHAR(400)',
  'giris INT',
  'jsp INT',
  'tld INT',
  'jar INT',
  'class_sayisi INT',
  'application_xml BIT',
  'ear_kutuphane_seti CHAR(32)',
  'ear_kutuphane_sayisi INT',
  'war_sayisi INT',
  'yapi_izi VARCHAR(32)',
  'kutuphane_izi VARCHAR(32)',
  'spring_boot NVARCHAR(100)',
  'spring_framework NVARCHAR(100)',
  'log4j NVARCHAR(100)',
  'servlet NVARCHAR(16)',
  'uyari_sayisi INT',
  'uyarilar NVARCHAR(MAX)',
  'xml_eslesme NVARCHAR(MAX)',
];
const WAR_KOLONLAR = [
  'uyg_no INT',
  'war_no INT',
  'yol NVARCHAR(400)',
  'ad NVARCHAR(256)',
  'bicim NVARCHAR(16)',
  'durum NVARCHAR(24)',
  'jsp INT',
  'tld INT',
  'jar INT',
  'class_sayisi INT',
  'tld_dizini BIT',
  'web_xml BIT',
  'web_varyantlari NVARCHAR(400)',
  'jboss_web_xml BIT',
  'jboss_deployment_structure BIT',
  'kutuphane_seti CHAR(32)',
  'kutuphane_sayisi INT',
  'spring_boot NVARCHAR(64)',
  'spring_framework NVARCHAR(64)',
  'spring_security NVARCHAR(64)',
  'log4j NVARCHAR(64)',
  'logback NVARCHAR(64)',
  'jackson NVARCHAR(64)',
  'thymeleaf NVARCHAR(64)',
  'struts NVARCHAR(64)',
  'servlet NVARCHAR(16)',
];
const ad = (k) => k.split(' ')[0];

// Host basina TEK batch: eski satirlar silinir, yenileri OPENJSON ile kume halinde yazilir. Yeni
// kutuphane setleri NOT EXISTS + HOLDLOCK ile eklenir; satirlari yalniz BU transaction'in ekledigi
// setler icin yazilir (iki surec ayni seti ayni anda gorurse ikincisi satir eklemez).
const HOST_YAZ_SQL = `SET XACT_ABORT ON;
BEGIN TRAN;
DELETE FROM ear_envanter_warlari WHERE kosu_id = $1 AND host = $2;
DELETE FROM ear_envanter_uygulamalari WHERE kosu_id = $1 AND host = $2;
DELETE FROM ear_envanter_hostlari WHERE kosu_id = $1 AND host = $2;
INSERT INTO ear_envanter_hostlari (kosu_id, host, ${HOST_KOLONLAR.map(ad).join(', ')})
  SELECT $1, $2, j.* FROM OPENJSON($3) WITH (${HOST_KOLONLAR.join(', ')}) j;
INSERT INTO ear_envanter_uygulamalari (kosu_id, host, ${UYG_KOLONLAR.map(ad).join(', ')})
  SELECT $1, $2, j.* FROM OPENJSON($4) WITH (${UYG_KOLONLAR.join(', ')}) j;
INSERT INTO ear_envanter_warlari (kosu_id, host, ${WAR_KOLONLAR.map(ad).join(', ')})
  SELECT $1, $2, j.* FROM OPENJSON($5) WITH (${WAR_KOLONLAR.join(', ')}) j;
DECLARE @yeni TABLE (iz CHAR(32) PRIMARY KEY);
INSERT INTO ear_envanter_kutuphane_setleri (iz, sayi, surum_izi)
  OUTPUT inserted.iz INTO @yeni
  SELECT s.iz, s.sayi, s.surum_izi FROM OPENJSON($6) WITH (iz CHAR(32), sayi INT, surum_izi CHAR(32)) s
   WHERE NOT EXISTS (SELECT 1 FROM ear_envanter_kutuphane_setleri x WITH (UPDLOCK, HOLDLOCK) WHERE x.iz = s.iz);
INSERT INTO ear_envanter_set_kutuphaneleri (iz, sira, ad, surum, boyut)
  SELECT k.iz, k.sira, k.ad, k.surum, k.boyut
    FROM OPENJSON($7) WITH (iz CHAR(32), sira INT, ad NVARCHAR(200), surum NVARCHAR(100), boyut BIGINT) k
    JOIN @yeni y ON y.iz = k.iz;
COMMIT;`;

/**
 * Kaydi DB'ye yazar. Yalniz DB'de olmayan setlerin satirlari gonderilir (onceden sorulur);
 * yarisi HOST_YAZ_SQL'in kendi kosulu cozer.
 */
async function hostuYaz(dbx, kosuId, host, kayit) {
  const izler = [...kayit.setler.keys()];
  let eksik = izler;
  if (izler.length) {
    const { rows } = await dbx.query(
      `SELECT iz FROM ear_envanter_kutuphane_setleri WHERE iz IN (SELECT value FROM OPENJSON($1))`,
      [JSON.stringify(izler)],
    );
    const var_ = new Set((rows || []).map((r) => String(r.iz).trim()));
    eksik = izler.filter((iz) => !var_.has(iz));
  }
  const setSatirlari = [];
  for (const iz of eksik)
    kayit.setler
      .get(iz)
      .forEach(([a, s, b], sira) => setSatirlari.push({ iz, sira, ad: a, surum: s, boyut: b }));
  await dbx.query(HOST_YAZ_SQL, [
    Number(kosuId),
    String(host),
    JSON.stringify([kayit.host]),
    JSON.stringify(kayit.uygulamalar),
    JSON.stringify(kayit.warlar),
    JSON.stringify(
      eksik.map((iz) => ({
        iz,
        sayi: kayit.setler.get(iz).length,
        surum_izi: surumIzi(kayit.setler.get(iz)),
      })),
    ),
    JSON.stringify(setSatirlari),
  ]);
  return { uygulama: kayit.uygulamalar.length, war: kayit.warlar.length, yeniSet: eksik.length };
}

module.exports = {
  BASLA,
  BITTI,
  HAM_SINIR,
  JSON_SINIR,
  HOST_RE,
  HOST_DURUMLARI,
  VARSAYILAN_DIZIN,
  HOST_YAZ_SQL,
  kodluHata,
  earDizin,
  ALT_DIZIN_RE,
  kosuAltDizini,
  hamDosyaYolu,
  hamOku,
  paketCoz,
  jbossOf,
  teknoloji,
  kutuphaneSeti,
  surumIzi,
  SINIR_WAR,
  SINIR_KUTUPHANE,
  SINIR_KOK_GIRDI,
  XML_DURUMLARI,
  ESLESME_DURUMLARI,
  kokGirdileri,
  xmlOzeti,
  xmlEslesme,
  dmrAyristir,
  deploymentCoz,
  DEP_JVM_DURUMLARI,
  hostKaydi,
  bosHostKaydi,
  hostuYaz,
};
