// server/logx/maske-deseni.cjs - LogX maskeleme kurali deseninin guvenlik denetimi (2026-10-23).
//
// Kurali admin yazar; masker onu AI'ya giden her log satirina olay dongusunde uygular. Iki risk:
//   1. Felaket geri izleme: `(\w+\s?)+$` gibi bir desen uygun bir satirda saniyeler-dakikalar
//      surer ve o sure boyunca portalin TAMAMI cevap vermez. JS regex'i yarida kesilemez.
//   2. Bayrak: `g` yoksa replace yalniz ILK eslesmeyi degistirir - satirdaki ikinci kimlik
//      numarasi maskelenmeden dis AI'ya gider. `y` (yapiskan) eslesmeyi tek konuma baglar.
//
// Denetim iki katmanli:
//   - Yapisal (senkron, ucuz): sinirsiz niceleyici iceren bir grubun kendisi sinirsiz
//     nicelenmisse (`(a+)+`, `(?:x*)*`, `(a+){2,}`) red.
//   - Davranissal (worker thread, sure siniri): desen sentetik zor girdilere uygulanir; sure
//     asilirsa worker sonlandirilir ve desen reddedilir. Yapisal kontrolun goremedigi ortusen
//     alternatifler (`(a|a)*b`) burada yakalanir. Worker ana olay dongusunu kilitlemez.
//     Sure siniri comert tutulur: seed kurallari ~10-25 ms surer; ustel bir desen 40 karakterde
//     bile hic bitmez. Yuk altinda saglam bir kuralin YANLISLIKLA reddi o PII turunu maskesiz
//     birakir; bu yuzden sinir dar degil.
'use strict';

const { Worker } = require('node:worker_threads');

const IZINLI_BAYRAKLAR = 'gimsu';
const DAVRANIS_SURE_MS = 1500;
const KISA_TEKRAR = 40;
const UZUN_TEKRAR = 1500;

// `g` her zaman eklenir, `y` atilir, tekrar ve sira normallestirilir.
function bayraklariNormallestir(flags) {
  const set = new Set(String(flags || '').split(''));
  set.add('g');
  return [...IZINLI_BAYRAKLAR].filter((b) => set.has(b)).join('');
}

function niceleyiciOku(desen, i) {
  const c = desen[i];
  if (c === '*' || c === '+') return { sinirsiz: true, son: i + 1 };
  if (c === '?') return { sinirsiz: false, son: i + 1 };
  if (c === '{') {
    const m = /^\{(\d+)(,(\d*))?\}/.exec(desen.slice(i));
    if (!m) return null;
    const alt = Number(m[1]);
    const ust = m[2] ? (m[3] === '' ? Infinity : Number(m[3])) : alt;
    return { sinirsiz: ust === Infinity || ust - alt >= 100, son: i + m[0].length };
  }
  return null;
}

// Yapisal denetim: sinirsiz niceleyici iceren grup yeniden sinirsiz nicelenmis mi?
// Donus: null (sorun yok) ya da aciklama metni.
function icIceSinirsizNiceleyici(desen) {
  const s = String(desen);
  const yigin = [{ sinirsizIcerir: false }];
  let i = 0;
  const atomSonrasi = (j) => {
    const q = niceleyiciOku(s, j);
    if (!q) return j;
    if (q.sinirsiz) yigin[yigin.length - 1].sinirsizIcerir = true;
    return s[q.son] === '?' || s[q.son] === '+' ? q.son + 1 : q.son;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      i = atomSonrasi(i + 2);
    } else if (c === '[') {
      let j = i + 1;
      if (s[j] === '^') j += 1;
      if (s[j] === ']') j += 1;
      while (j < s.length && s[j] !== ']') j += s[j] === '\\' ? 2 : 1;
      i = atomSonrasi(j + 1);
    } else if (c === '(') {
      yigin.push({ sinirsizIcerir: false });
      i += 1;
      if (s[i] === '?') {
        i += 1;
        if (s[i] === '<' && s[i + 1] !== '=' && s[i + 1] !== '!') {
          while (i < s.length && s[i] !== '>') i += 1;
          i += 1;
        } else if (s[i] === '<') {
          i += 2;
        } else {
          i += 1;
        }
      }
    } else if (c === ')') {
      const grup = yigin.length > 1 ? yigin.pop() : { sinirsizIcerir: false };
      const q = niceleyiciOku(s, i + 1);
      if (q && q.sinirsiz && grup.sinirsizIcerir) {
        return `iç içe sınırsız niceleyici (konum ${i}): sınırsız tekrar içeren bir grup yeniden sınırsız tekrarlanıyor`;
      }
      const ust = yigin[yigin.length - 1];
      ust.sinirsizIcerir = ust.sinirsizIcerir || grup.sinirsizIcerir || Boolean(q && q.sinirsiz);
      if (q) {
        i = s[q.son] === '?' || s[q.son] === '+' ? q.son + 1 : q.son;
      } else {
        i += 1;
      }
    } else {
      i = atomSonrasi(i + 1);
    }
  }
  return null;
}

// Davranissal denetim girdileri: log satirlarinda sik gecen karakterlerin ve DESENIN KENDI duz
// karakterlerinin uzun tekrarlari ve ikilileri; her birinin sonunda eslesmeyi bozan bir
// karakter (geri izlemeyi tetikleyen durum). Desen karakterleri sart: `(x|x)*y` yalniz `x`
// tekrarinda patlar, sabit kumede `x` yoksa hic tetiklenmez.
const REGEX_OZEL = new Set('\\^$.|?*+()[]{}'.split(''));
function desenKarakterleri(desen) {
  const s = String(desen || '');
  const out = new Set();
  for (let i = 0; i < s.length && out.size < 24; i += 1) {
    if (s[i] === '\\') {
      i += 1;
      continue;
    }
    if (!REGEX_OZEL.has(s[i]) && s[i].trim() !== '') out.add(s[i]);
  }
  return [...out];
}

function zorGirdiler(desen) {
  const tekler = ['a', 'Z', '0', ' ', '\t', '-', '_', '.', '@', ':', '/', '=', ',', '"'];
  const ikililer = ['a ', 'a0', 'a.', 'a-', 'a@', '0 ', '0.', '0-', 'a:', 'a/', 'aA', 'a_'];
  const kendi = desenKarakterleri(desen);
  for (let i = 0; i + 1 < kendi.length; i += 1) ikililer.push(kendi[i] + kendi[i + 1]);
  const out = [];
  for (const t of new Set([...tekler, ...kendi, ...ikililer])) {
    for (const son of ['\u0000', '!', '\n']) {
      out.push(t.repeat(KISA_TEKRAR) + son);
      out.push(t.repeat(Math.ceil(UZUN_TEKRAR / t.length)) + son);
    }
  }
  return out;
}

const WORKER_KODU = `
const { parentPort, workerData } = require('node:worker_threads');
const re = new RegExp(workerData.pattern, workerData.flags);
parentPort.postMessage({ hazir: true });
for (const s of workerData.girdiler) { re.lastIndex = 0; s.replace(re, ''); }
parentPort.postMessage({ bitti: true });
`;

// Davranissal denetim. Worker acilisi sureye sayilmaz; sayac desen calismaya baslayinca kurulur.
function davranisDenetle(pattern, flags, { sureMs = DAVRANIS_SURE_MS } = {}) {
  return new Promise((resolve) => {
    let sayac = null;
    let bitti = false;
    const sonuc = (r) => {
      if (bitti) return;
      bitti = true;
      if (sayac) clearTimeout(sayac);
      worker.terminate().catch(() => {});
      resolve(r);
    };
    const worker = new Worker(WORKER_KODU, {
      eval: true,
      workerData: { pattern, flags, girdiler: zorGirdiler(pattern) },
      resourceLimits: { maxOldGenerationSizeMb: 64 },
    });
    worker.on('message', (m) => {
      if (m && m.hazir) {
        sayac = setTimeout(
          () =>
            sonuc({
              ok: false,
              sebep: `desen ${sureMs} ms içinde bitmedi (felaket geri izleme riski)`,
            }),
          sureMs,
        );
      } else if (m && m.bitti) {
        sonuc({ ok: true });
      }
    });
    worker.on('error', (e) => sonuc({ ok: false, sebep: `desen çalıştırılamadı: ${e.message}` }));
    worker.on('exit', () => sonuc({ ok: false, sebep: 'denetim yarıda kaldı' }));
  });
}

// Tam denetim: derleme + yapisal + davranissal. Donus { ok, flags, sebep }.
async function maskeDeseniDenetle(pattern, flags, secenek) {
  const f = bayraklariNormallestir(flags);
  try {
    new RegExp(pattern, f);
  } catch (e) {
    return { ok: false, flags: f, sebep: `derlenemedi: ${e.message}` };
  }
  const yapisal = icIceSinirsizNiceleyici(pattern);
  if (yapisal) return { ok: false, flags: f, sebep: yapisal };
  const d = await davranisDenetle(pattern, f, secenek);
  return d.ok ? { ok: true, flags: f } : { ok: false, flags: f, sebep: d.sebep };
}

module.exports = {
  bayraklariNormallestir,
  icIceSinirsizNiceleyici,
  davranisDenetle,
  maskeDeseniDenetle,
  zorGirdiler,
  desenKarakterleri,
  DAVRANIS_SURE_MS,
};
