// server/ansible/ss-tasima.cjs - Self Servis Tasima (maestro2 -> maestro3), SAF cekirdek.
//
// 2026-11-10 (kullanici): "maestro2 emekli oluyor ... self servis otomasyonunda bulunan
// sayfalarin gecisini kolaylastirmasi icin bir yol yontem." Bu dosya DB ve AWX'e dogrudan
// gitmez (engel sayimi ve survey yazicisi `db` / `istek` fonksiyonunu disaridan alir);
// rotalar server/ansible/ss-tasima-rotalari.cjs'te.
//
// Kararlar (ayrintisi docs/PLAYBOOK-REGISTRY.md "Self Servis Tasima" bolumu):
//   - Template ADI ile tam esleme (trim, buyuk/kucuk harf DUYARLI). Eslesmeyen elle secilir.
//   - Kaynak ayar satiri (ansible_ss_customizations) TASINMAZ, KOPYALANIR: gecmis islerin
//     cikti filtresi kaynak satirdan okunur; geri alma tek UPDATE ile aninda olur.
//   - Survey farki `variable` anahtariyla; parola varsayilanlari ($encrypted$) karsilastirmaya
//     girmez ve hedefe KOPYALANMAZ (sir Portal'a girmez); hedefte ayni parola sorusunun dolu
//     varsayilani `$encrypted$` gonderilerek KORUNUR (parolaHazirla).
//   - Bilinmeyen sayi sifir sayilmaz: okunamayan engel sorgusu "kontrol_edilemedi" ENGEL'idir.
'use strict';

const crypto = require('crypto');

// Durum oncelik sirasi (ilk cip birincil durumdur).
const CIP_ONCELIK = ['ESLESME_YOK', 'ENGEL', 'SURVEY_BOS', 'SURVEY_FARKLI', 'OZELLESTIRME_UYUMSUZ'];

// ---------------------------------------------------------------------------
// Kararli JSON + hash
// ---------------------------------------------------------------------------
function kararliJson(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(kararliJson).join(',') + ']';
  const anahtarlar = Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort();
  return '{' + anahtarlar.map((k) => JSON.stringify(k) + ':' + kararliJson(v[k])).join(',') + '}';
}

function sha(v) {
  return crypto.createHash('sha256').update(kararliJson(v)).digest('hex');
}

function veriHash(data) {
  return sha(data && typeof data === 'object' ? data : {});
}

// ---------------------------------------------------------------------------
// Esleme
// ---------------------------------------------------------------------------
function adAnahtari(s) {
  return String(s == null ? '' : s).trim();
}

/**
 * @param {Array<{id:string, kaynakAd:string}>} kartlar
 * @param {Array<{id:number, name:string}>} hedefTemplateleri
 * @param {Record<string, number>} elleSecimler  itemId -> hedef template id
 * @returns {Map<string, {toT:number|null, toAd:string, eslesme:'ad'|'elle'|null, neden:string|null, adaylar:Array<{id:number,name:string}>, cakisma:boolean}>}
 */
function eslestir(kartlar, hedefTemplateleri, elleSecimler = {}) {
  const hedef = Array.isArray(hedefTemplateleri) ? hedefTemplateleri : [];
  const adla = new Map();
  for (const t of hedef) {
    const k = adAnahtari(t && t.name);
    if (!k) continue;
    if (!adla.has(k)) adla.set(k, []);
    adla.get(k).push({ id: Number(t.id), name: String(t.name) });
  }
  const sonuc = new Map();
  for (const kart of Array.isArray(kartlar) ? kartlar : []) {
    const elle = elleSecimler && elleSecimler[kart.id];
    if (elle !== undefined && elle !== null && elle !== '') {
      const t = hedef.find((x) => Number(x.id) === Number(elle));
      sonuc.set(
        kart.id,
        t
          ? { toT: Number(t.id), toAd: String(t.name), eslesme: 'elle', neden: null, adaylar: [], cakisma: false }
          : { toT: null, toAd: '', eslesme: null, neden: 'elle_secim_yok', adaylar: [], cakisma: false },
      );
      continue;
    }
    const ad = adAnahtari(kart.kaynakAd);
    const adaylar = ad ? adla.get(ad) || [] : [];
    if (!ad) sonuc.set(kart.id, { toT: null, toAd: '', eslesme: null, neden: 'kaynak_adi_yok', adaylar: [], cakisma: false });
    else if (adaylar.length === 0) sonuc.set(kart.id, { toT: null, toAd: '', eslesme: null, neden: 'ad_yok', adaylar: [], cakisma: false });
    else if (adaylar.length > 1)
      sonuc.set(kart.id, { toT: null, toAd: '', eslesme: null, neden: 'birden_fazla_aday', adaylar, cakisma: false });
    else sonuc.set(kart.id, { toT: adaylar[0].id, toAd: adaylar[0].name, eslesme: 'ad', neden: null, adaylar: [], cakisma: false });
  }
  // Iki kart ayni hedefe esleniyorsa ikisi de ENGEL (UNIQUE(awx_server_id, awx_template_id)).
  const sayac = new Map();
  for (const v of sonuc.values()) if (v.toT) sayac.set(v.toT, (sayac.get(v.toT) || 0) + 1);
  for (const v of sonuc.values()) if (v.toT && sayac.get(v.toT) > 1) v.cakisma = true;
  return sonuc;
}

const ESLESME_NEDENI = {
  ad_yok: 'Hedef sunucuda aynı adda template yok; listeden elle seçin.',
  birden_fazla_aday: 'Hedef sunucuda aynı adda birden fazla template var; listeden elle seçin.',
  elle_secim_yok: 'Elle seçilen hedef template artık hedef sunucunun listesinde yok.',
  kaynak_adi_yok: 'Kaynak template adı okunamadı (template kaynak sunucuda silinmiş olabilir); hedefi elle seçin.',
  kaynak_okunamadi: 'Kaynak sunucunun template listesi okunamadı (bağlantı / yetki); ad eşlemesi yapılamadı.',
  hedef_okunamadi: 'Hedef sunucunun template listesi okunamadı (bağlantı / yetki); ad eşlemesi yapılamadı.',
};

// ---------------------------------------------------------------------------
// Survey normalizasyonu ve farki
// ---------------------------------------------------------------------------
// Secenekler KIRPILMAZ: AWX " a" ile "a"yi ayri deger sayar. Yalniz bos satir atilir.
function secenekler(c) {
  if (Array.isArray(c)) return c.map((x) => String(x == null ? '' : x)).filter((x) => x.trim() !== '');
  if (typeof c === 'string') return c.split(/\r?\n/).filter((x) => x.trim() !== '');
  return [];
}

function sayi(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function varsayilanMetni(d) {
  if (d === undefined || d === null) return '';
  if (Array.isArray(d)) return d.map((x) => String(x)).join('\n');
  return String(d);
}

// Varsayilan tipine gore: sayisal "1.0" == 1; multiselect sirasiz kume.
function varsayilanNormalize(type, d) {
  if (type === 'integer' || type === 'float') {
    const n = sayi(d);
    return n === null ? varsayilanMetni(d) : String(n);
  }
  if (type === 'multiselect') {
    const l = Array.isArray(d) ? d.map((x) => String(x)) : String(d == null ? '' : d).split(/\r?\n/);
    return l.filter((x) => x !== '').sort().join('\n');
  }
  return varsayilanMetni(d);
}

function specListesi(spec) {
  if (Array.isArray(spec)) return spec;
  if (spec && Array.isArray(spec.spec)) return spec.spec;
  return [];
}

function surveyNormalize(spec) {
  return specListesi(spec)
    .filter((f) => f && f.variable)
    .map((f, i) => {
      const parola = f.type === 'password';
      return {
        variable: String(f.variable),
        question_name: String(f.question_name == null ? '' : f.question_name),
        question_description: String(f.question_description == null ? '' : f.question_description),
        type: String(f.type || ''),
        required: f.required === true || f.required === 'true',
        // Parola varsayilani GET'te `$encrypted$` doner: karsilastirmaya ve hash'e girmez.
        default: parola ? null : varsayilanNormalize(String(f.type || ''), f.default),
        choices: secenekler(f.choices),
        min: sayi(f.min),
        max: sayi(f.max),
        parola,
        sira: i,
      };
    });
}

/**
 * @returns {{ satirlar: Array<object>, kritikVar: boolean, bilgiVar: boolean, kaynakSoru: number, hedefSoru: number, parolaSoru: number }}
 */
function surveyFarki(kaynakSpec, hedefSpec) {
  const K = surveyNormalize(kaynakSpec);
  const H = surveyNormalize(hedefSpec);
  const hMap = new Map(H.map((f) => [f.variable, f]));
  const kMap = new Map(K.map((f) => [f.variable, f]));
  const satirlar = [];
  for (const k of K) {
    const h = hMap.get(k.variable);
    if (!h) {
      satirlar.push({ variable: k.variable, etiket: 'yalniz_kaynakta', kritik: true, farklar: ['eksik'], kaynak: k, hedef: null });
      continue;
    }
    const farklar = [];
    const kritikler = [];
    const ekle = (alan, kritik) => {
      farklar.push(alan);
      if (kritik) kritikler.push(alan);
    };
    if (k.type !== h.type) ekle('type', true);
    const hSecenek = new Set(h.choices);
    const kSecenek = new Set(k.choices);
    if (k.choices.some((c) => !hSecenek.has(c))) ekle('choices', true);
    else if (h.choices.some((c) => !kSecenek.has(c))) ekle('choices', false);
    // Kaynak zorunlu, hedef degil: bos deger playbook'a gider (kritik). Hedef zorunlu ve
    // varsayilansiz: kaynakta bos gecen form hedefte reddedilir (kritik).
    if (k.required !== h.required)
      ekle('required', (k.required && !h.required) || (!k.required && h.required && (h.default === '' || h.default === null)));
    if (!k.parola && !h.parola && k.default !== h.default) ekle('default', true);
    if (k.question_name !== h.question_name) ekle('question_name', false);
    if (k.question_description !== h.question_description) ekle('question_description', false);
    // Hedefte daha siki sinir (null = sinirsiz): kaynakta gecen deger launch'ta reddedilir -> kritik.
    if (k.min !== h.min) ekle('min', h.min !== null && (k.min === null || h.min > k.min));
    if (k.max !== h.max) ekle('max', h.max !== null && (k.max === null || h.max < k.max));
    if (k.sira !== h.sira) ekle('sira', false);
    satirlar.push({
      variable: k.variable,
      etiket: farklar.length ? 'farkli' : 'ayni',
      kritik: kritikler.length > 0,
      farklar,
      kaynak: k,
      hedef: h,
    });
  }
  for (const h of H) {
    if (kMap.has(h.variable)) continue;
    satirlar.push({ variable: h.variable, etiket: 'yalniz_hedefte', kritik: true, farklar: ['fazla'], kaynak: null, hedef: h });
  }
  return {
    satirlar,
    kritikVar: satirlar.some((s) => s.kritik),
    bilgiVar: satirlar.some((s) => s.etiket !== 'ayni' && !s.kritik),
    kaynakSoru: K.length,
    hedefSoru: H.length,
    parolaSoru: K.filter((f) => f.parola).length,
  };
}

function surveyHash(surveyEnabled, spec) {
  return sha({
    e: typeof surveyEnabled === 'boolean' ? surveyEnabled : null,
    s: surveyNormalize(spec).map((f) => {
      const k = { ...f };
      delete k.parola;
      return k;
    }),
  });
}

/**
 * AWX       survey acik ve spec dolu
 * TASARIMCI survey kapali (Portal Survey Tasarimcisi ya da hic soru yok)
 * EXTRA_VARS survey acik ama spec bos (form template extra_vars'tan uretilir)
 * OLCULEMEDI detay ya da spec okunamadi / survey_enabled boolean degil
 */
function surveyModu(detail, spec) {
  if (!detail || typeof detail !== 'object') return 'OLCULEMEDI';
  if (detail.survey_enabled === false) return 'TASARIMCI';
  if (detail.survey_enabled !== true) return 'OLCULEMEDI';
  if (spec === undefined || spec === null) return 'OLCULEMEDI';
  return specListesi(spec).length > 0 ? 'AWX' : 'EXTRA_VARS';
}

/**
 * Survey turune gore cip ve onerilen eylem.
 * @returns {{ cip: (null|'SURVEY_BOS'|'SURVEY_FARKLI'), eylem: (null|'yaz'|'kapat'), olculemedi: boolean, uyarilar: string[] }}
 */
function surveyKarari(kaynakModu, hedefModu, hedefDetail, hedefSpec, fark) {
  const uyarilar = [];
  if (kaynakModu === 'OLCULEMEDI' || hedefModu === 'OLCULEMEDI') return { cip: null, eylem: null, olculemedi: true, uyarilar };
  const hedefSoru = surveyNormalize(hedefSpec).length;
  if (kaynakModu === 'AWX') {
    if (hedefSoru === 0) return { cip: 'SURVEY_BOS', eylem: 'yaz', olculemedi: false, uyarilar };
    if ((fark && fark.kritikVar) || !hedefDetail || hedefDetail.survey_enabled !== true)
      return { cip: 'SURVEY_FARKLI', eylem: 'yaz', olculemedi: false, uyarilar };
    return { cip: null, eylem: null, olculemedi: false, uyarilar };
  }
  if (kaynakModu === 'TASARIMCI') {
    if (hedefDetail && hedefDetail.survey_enabled === true) return { cip: 'SURVEY_FARKLI', eylem: 'kapat', olculemedi: false, uyarilar };
    return { cip: null, eylem: null, olculemedi: false, uyarilar };
  }
  // EXTRA_VARS: kaynak form alanlarini template extra_vars'tan uretiyor.
  if (hedefModu === 'AWX') uyarilar.push("Kaynak survey'siz (extra_vars yedeği) çalışıyor, hedefte AWX survey'i var: form değişir.");
  if (hedefModu === 'TASARIMCI') uyarilar.push("Kaynakta survey açık ama soru yok; hedefte survey kapalı: form alanları görünmez.");
  return { cip: null, eylem: null, olculemedi: false, uyarilar };
}

// ---------------------------------------------------------------------------
// Template ayar karsilastirmasi (Portal DUZELTMEZ, yalniz gosterir)
// ---------------------------------------------------------------------------
const TEMPLATE_ALANLARI = [
  ['playbook', 'Playbook'],
  ['survey_enabled', 'Survey açık'],
  ['ask_variables_on_launch', 'Variables (prompt on launch)'],
  ['ask_limit_on_launch', 'Limit (prompt on launch)'],
  ['ask_tags_on_launch', 'Job tags (prompt on launch)'],
  ['ask_skip_tags_on_launch', 'Skip tags (prompt on launch)'],
  ['ask_job_type_on_launch', 'Job type (prompt on launch)'],
  ['ask_inventory_on_launch', 'Envanter (prompt on launch)'],
  ['ask_verbosity_on_launch', 'Verbosity (prompt on launch)'],
  ['ask_forks_on_launch', 'Forks (prompt on launch)'],
];

function extraVarsAnahtarlari(detail) {
  const ham = String((detail && detail.extra_vars) || '').trim();
  if (!ham) return [];
  let obj = null;
  try {
    obj = JSON.parse(ham);
  } catch {
    try {
      obj = require('../smart/metadata.cjs').parseSimpleYaml(ham);
    } catch {
      obj = null;
    }
  }
  return obj && typeof obj === 'object' && !Array.isArray(obj) ? Object.keys(obj).sort() : [];
}

function templateKarsilastir(kaynak, hedef) {
  const deger = (d, fn) => {
    if (!d || typeof d !== 'object') return undefined;
    return fn(d);
  };
  const satir = (alan, etiket, fn) => {
    const k = deger(kaynak, fn);
    const h = deger(hedef, fn);
    return {
      alan,
      etiket,
      kaynak: k === undefined ? null : k,
      hedef: h === undefined ? null : h,
      kaynakOlculemedi: k === undefined,
      hedefOlculemedi: h === undefined,
      farkli: k === undefined || h === undefined ? true : kararliJson(k) !== kararliJson(h),
    };
  };
  const satirlar = TEMPLATE_ALANLARI.map(([alan, etiket]) => satir(alan, etiket, (d) => d[alan]));
  satirlar.push(satir('extra_vars', 'extra_vars anahtarları', (d) => extraVarsAnahtarlari(d).join(', ')));
  satirlar.push(satir('inventory', 'Envanter', (d) => (d.summary_fields && d.summary_fields.inventory && d.summary_fields.inventory.name) || ''));
  satirlar.push(satir('project', 'Proje', (d) => (d.summary_fields && d.summary_fields.project && d.summary_fields.project.name) || ''));
  satirlar.push(
    satir('credentials', 'Kimlik bilgileri', (d) =>
      ((d.summary_fields && d.summary_fields.credentials) || []).map((c) => String((c && c.name) || '')).sort().join(', '),
    ),
  );
  return satirlar;
}

// ---------------------------------------------------------------------------
// Ayar (customization) uyumu
// ---------------------------------------------------------------------------
const GOMULU_KIMLIK_RE = /(template|server)_?id/i;

/** Ayar JSON'unda adi template/sunucu kimligine benzeyen anahtar yollari. */
function gomuluKimlikTara(data) {
  const yollar = [];
  const gez = (v, yol) => {
    if (Array.isArray(v)) v.forEach((x, i) => gez(x, `${yol}[${i}]`));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        const y = yol ? `${yol}.${k}` : k;
        if (GOMULU_KIMLIK_RE.test(k)) yollar.push(y);
        gez(x, y);
      }
    }
  };
  gez(data, '');
  return yollar;
}

const LAUNCH_BAYRAGI = {
  limit: 'ask_limit_on_launch',
  forks: 'ask_forks_on_launch',
  jobTags: 'ask_tags_on_launch',
  skipTags: 'ask_skip_tags_on_launch',
  verbosity: 'ask_verbosity_on_launch',
  jobType: 'ask_job_type_on_launch',
};

const OZEL_PLAYBOOKLAR = [
  { ad: 'API Generator', test: (p) => /(^|\/)api_generator\/api_generator\.ya?ml$/i.test(p) },
  { ad: 'nginx_ops', test: (p) => /(^|\/)nginx_ops\/nginx_ops\.ya?ml$/i.test(p) },
  {
    ad: 'OpsX WAS',
    test: (p) => {
      try {
        return require('../opsx/was.cjs').isWasPlaybook(p);
      } catch {
        return false;
      }
    },
  },
];

function metadataDegiskenleri(metin) {
  const out = new Set();
  const re = /\{\{\s*extraVars\.([A-Za-z_][A-Za-z0-9_]*)/g;
  let m;
  while ((m = re.exec(String(metin || '')))) out.add(m[1]);
  return [...out];
}

function rawAnahtarlar(raw) {
  if (!raw) return [];
  try {
    const o = require('../smart/metadata.cjs').parseSimpleYaml(String(raw));
    return o && typeof o === 'object' ? Object.keys(o) : [];
  } catch {
    return [];
  }
}

/**
 * Kaynak ayarlar hedef template'e (spec + detay) karsi gecerli mi.
 * @returns {{ hatalar: string[], uyarilar: string[], gomulu: string[] }}
 */
function ozellestirmeUyumu(data, { hedefSpec, hedefDetail, kaynakDetail, kaynakModu } = {}) {
  const hatalar = [];
  const uyarilar = [];
  const d = data && typeof data === 'object' ? JSON.parse(JSON.stringify(data)) : {};
  const spec = specListesi(hedefSpec);
  const specAdlari = new Set(spec.map((f) => String(f.variable)));

  // 1) /ss/custom ile ayni kurallar (ortak dogrulayici).
  for (const m of require('./ss-ozellestirme-dogrulama.cjs').dogrula(spec, d)) hatalar.push(`Ayar doğrulaması: ${m}`);

  const overrides = Array.isArray(data && data.fieldOverrides) ? data.fieldOverrides : [];
  const ozelAlanlar = Array.isArray(data && data.customSurveyFields) ? data.customSurveyFields : [];

  // 2) Yetim alan gecersiz kilmalari ve kosullari (yalniz AWX survey kullanan kaynakta anlamli).
  if (kaynakModu === 'AWX') {
    for (const ov of overrides) {
      if (!ov || !ov.fieldName) continue;
      if (!specAdlari.has(String(ov.fieldName)))
        hatalar.push(`Alan geçersiz kılma "${ov.fieldName}": hedef survey'de yok, sessizce yok sayılır.`);
      if (ov.dependsOn) {
        let kosullar = [];
        try {
          kosullar = require('../../shared/surveyConditions.cjs').allConditions(ov.dependsOn);
        } catch {
          kosullar = [];
        }
        for (const c of kosullar) {
          const alan = String((c && c.field) || '').trim();
          if (alan && !specAdlari.has(alan) && !ozelAlanlar.some((o) => String((o && o.name) || '') === alan))
            hatalar.push(`"${ov.fieldName}" koşulu "${alan}" alanına bağlı; hedefte bu alan yok.`);
        }
      }
    }
  }

  // 3) Smart onayi: metadata sablonu ve istisna kurali degiskenleri.
  const sa = data && data.smartApproval;
  if (sa && sa.enabled) {
    const bilinen = new Set([
      ...specAdlari,
      ...ozelAlanlar.map((o) => String((o && o.name) || '')),
      ...rawAnahtarlar(data.rawExtraVars),
      ...extraVarsAnahtarlari(hedefDetail),
    ]);
    if (data.injectUserInfo && data.injectUserInfo.enabled) {
      bilinen.add(String(data.injectUserInfo.emailKey || '').trim() || 'email');
      bilinen.add(String(data.injectUserInfo.usernameKey || '').trim() || 'username');
    }
    for (const v of metadataDegiskenleri(sa.metadataFields)) {
      if (!bilinen.has(v)) hatalar.push(`Smart metadata şablonu {{extraVars.${v}}} kullanıyor, hedefte bu değişken yok.`);
    }
    // Istisna kurali alani yoksa kural TUTMAZ -> onay HER ZAMAN istenir (guvenli taraf): uyari.
    let kurallar = [];
    try {
      kurallar = require('./change-gates.cjs').parseSmartSkipRules(sa.skipWhen).rules;
    } catch {
      kurallar = [];
    }
    const kucuk = new Set([...bilinen].map((x) => x.toLowerCase()));
    for (const r of kurallar) {
      if (!kucuk.has(r.field))
        uyarilar.push(`Smart istisna kuralı "${r.field}" alanına bakıyor, hedefte yok: onay her zaman istenir.`);
    }
  }

  // 4) Launch secenekleri: hedefte "prompt on launch" kapaliysa AWX degeri SESSIZCE yok sayar.
  for (const [anahtar, ov] of Object.entries((data && data.launchOptionOverrides) || {})) {
    if (!ov || typeof ov !== 'object') continue;
    const bayrak = LAUNCH_BAYRAGI[anahtar];
    if (!bayrak) continue;
    const h = hedefDetail ? hedefDetail[bayrak] : undefined;
    const k = kaynakDetail ? kaynakDetail[bayrak] : undefined;
    if (h === undefined) hatalar.push(`Hedef template'te ${bayrak} ölçülemedi.`);
    else if (h !== true && k === true)
      hatalar.push(`Launch seçeneği "${anahtar}" ayarlı ama hedefte ${bayrak} kapalı: değer sessizce yok sayılır.`);
  }

  // 5) Survey disi ek degiskenler hedefte "Prompt on launch > Variables" ister.
  const ekDegisken =
    String((data && data.rawExtraVars) || '').trim() !== '' ||
    !!(data && data.injectUserInfo && data.injectUserInfo.enabled) ||
    (kaynakModu === 'TASARIMCI' && ozelAlanlar.length > 0);
  if (ekDegisken) {
    const h = hedefDetail ? hedefDetail.ask_variables_on_launch : undefined;
    const k = kaynakDetail ? kaynakDetail.ask_variables_on_launch : undefined;
    if (h === undefined) hatalar.push("Hedef template'te ask_variables_on_launch ölçülemedi.");
    else if (h !== true) {
      const m = "Servis survey dışı değişken gönderiyor (rawExtraVars / kullanıcı bilgisi / tasarımcı alanları) ama hedefte 'Prompt on launch > Variables' kapalı.";
      if (k === true) hatalar.push(m);
      else uyarilar.push(m + ' (Kaynakta da kapalı.)');
    }
  }

  // 6) Playbook: kodla playbook yoluna bagli davranislar.
  const kp = String((kaynakDetail && kaynakDetail.playbook) || '');
  const hp = String((hedefDetail && hedefDetail.playbook) || '');
  const ozel = OZEL_PLAYBOOKLAR.find((o) => o.test(kp));
  if (ozel && !ozel.test(hp)) hatalar.push(`Kaynak playbook ${ozel.ad} (${kp}); hedef playbook (${hp || 'boş'}) değil: Portal'ın bu playbook'a özel davranışı kapanır.`);
  else if (kp && hp && kp !== hp) uyarilar.push(`Playbook farklı: kaynak ${kp}, hedef ${hp}.`);

  return { hatalar, uyarilar, gomulu: gomuluKimlikTara(data) };
}

// ---------------------------------------------------------------------------
// Engeller (template kapsamli; `$1` sunucu, `$2` template)
// ---------------------------------------------------------------------------
const AKTIF_OCO = "('SCHEDULED','LAUNCHING','PENDING_APPROVAL','AWX_SCHEDULED')";

const ENGELLER = [
  {
    anahtar: 'smart',
    baslik: 'Onay bekleyen Smart bileti',
    ipucu: "Admin > Smart Talepleri'nde sonuçlanmasını bekleyin ya da iptal edin. Onaylanırsa iş eski sunucuda koşar.",
    sql: `SELECT COUNT(*) AS n FROM smart_tickets
           WHERE awx_server_id = $1 AND awx_template_id = $2 AND status IN ('PENDING','LAUNCHING')`,
  },
  {
    anahtar: 'oco',
    baslik: 'OCO zamanlanmış başlatma',
    ipucu: "Admin > Smart Talepleri > OCO Zamanlamaları'ndan iptal edin. AWX_SCHEDULED kaydı sunucunun kendi zamanlamasıdır.",
    sql: `SELECT COUNT(*) AS n FROM oco_scheduled_launches
           WHERE awx_server_id = $1 AND awx_template_id = $2 AND status IN ${AKTIF_OCO}`,
  },
];

const SUREN_IS_SQL = `SELECT COUNT(*) AS n FROM ansible_job_history
   WHERE awx_server_id = $1 AND template_id = $2 AND status IN ('new','pending','waiting','running')`;

const PLAYBOOK_KAYDI_SQL = `SELECT TOP 1 key_name FROM ansible_playbook_registry WHERE awx_server_id = $1 AND awx_template_id = $2`;

/** Okunamayan sorgu SIFIR sayilmaz: `okunamayan` listesine girer (cagiran ENGEL yapar). */
async function engelleriSay(db, serverId, templateId, liste = ENGELLER) {
  const engeller = [];
  const okunamayan = [];
  for (const e of liste) {
    try {
      const { rows } = await db.query(e.sql, [Number(serverId), Number(templateId)]);
      const n = Number(rows && rows[0] && rows[0].n) || 0;
      if (n > 0) engeller.push({ anahtar: e.anahtar, baslik: e.baslik, adet: n, ipucu: e.ipucu });
    } catch (err) {
      okunamayan.push({ anahtar: e.anahtar, baslik: e.baslik, hata: String((err && err.message) || err) });
    }
  }
  return { engeller, okunamayan };
}

// ---------------------------------------------------------------------------
// Durum
// ---------------------------------------------------------------------------
function durumBelirle({ eslesmeYok = false, engelVar = false, surveyCip = null, uyumsuz = false } = {}) {
  const var_ = new Set();
  if (eslesmeYok) var_.add('ESLESME_YOK');
  if (engelVar) var_.add('ENGEL');
  if (surveyCip) var_.add(surveyCip);
  if (uyumsuz) var_.add('OZELLESTIRME_UYUMSUZ');
  const cipler = CIP_ONCELIK.filter((c) => var_.has(c));
  return { durum: cipler[0] || 'HAZIR', cipler: cipler.length ? cipler : ['HAZIR'] };
}

// Hedef ayarin ICERIGI hash'e girer (yalniz var/yok degil): plan ile tasi arasinda hedef
// ayar degisirse tasi 409 doner.
function planHash({ itemId, from, fromT, to, toT, kaynakData, hedefSurveyHash, hedefData }) {
  return sha({
    kart: { id: String(itemId), from: Number(from), fromT: Number(fromT) },
    to: Number(to),
    toT: Number(toT),
    kaynakData: kaynakData || {},
    hedefSurveyHash: hedefSurveyHash || null,
    hedefDataHash: veriHash(hedefData),
  });
}

// ---------------------------------------------------------------------------
// Survey yazici cekirdegi (AWX istegi disaridan: `istek(method, path, body)`).
// Sira: spec yaz -> ac/kapat -> GERI OKU ve karsilastir. Bos survey'in acma anahtari soru
// olmadan kalici olmaz (AWX tuzagi), bu yuzden once spec.
// ---------------------------------------------------------------------------
function parolaTemizle(spec) {
  return specListesi(spec).map((f) => (f && f.type === 'password' ? { ...f, default: '' } : f));
}

/**
 * Parola sorularinin varsayilani: hedefte AYNI degisken adli parola sorusu ve dolu (GET'te
 * `$encrypted$`) varsayilan varsa `$encrypted$` gonderilir - AWX survey_spec POST'unda bu deger
 * eski sifreli varsayilani KORUR, '' SILER. Hedefte yoksa '' (AWX onceki soru olmadan
 * $encrypted$'i reddeder). Kaynagin sifreli degeri hicbir zaman tasinmaz.
 * @returns {{ spec: Array<object>, korunan: string[], elle: string[] }}
 */
function parolaHazirla(spec, hedefOnceki) {
  const eski = new Map(
    specListesi(hedefOnceki)
      .filter((f) => f && f.type === 'password' && f.variable)
      .map((f) => [String(f.variable), f]),
  );
  const korunan = [];
  const elle = [];
  const out = specListesi(spec).map((f) => {
    if (!f || f.type !== 'password') return f;
    const h = eski.get(String(f.variable));
    if (h && typeof h.default === 'string' && h.default !== '') {
      korunan.push(String(f.variable));
      return { ...f, default: '$encrypted$' };
    }
    elle.push(String(f.variable));
    return { ...f, default: '' };
  });
  return { spec: out, korunan, elle };
}

async function surveyYaz(istek, templateId, spec, { enable = true, name = '', description = '' } = {}) {
  const id = Number(templateId);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('Geçersiz template ID.'), { status: 400 });
  // Hedefin su anki spec'i parola varsayilanlarini korumak icin okunur. 404 = survey yok;
  // baska hata FIRLATILIR (bilinmeyen hedefe kor yazim yok).
  let hedefOnceki = [];
  try {
    hedefOnceki = specListesi(await istek('GET', `/api/v2/job_templates/${id}/survey_spec/`));
  } catch (err) {
    if (!(err && err.status === 404)) throw err;
  }
  const { spec: temiz, korunan, elle } = parolaHazirla(spec, hedefOnceki);
  await istek('POST', `/api/v2/job_templates/${id}/survey_spec/`, {
    name: String(name || ''),
    description: String(description || ''),
    spec: temiz,
  });
  await istek('PATCH', `/api/v2/job_templates/${id}/`, { survey_enabled: !!enable });
  const detail = await istek('GET', `/api/v2/job_templates/${id}/`);
  const geri = await istek('GET', `/api/v2/job_templates/${id}/survey_spec/`);
  const geriSpec = specListesi(geri);
  const fark = surveyFarki(temiz, geriSpec);
  const specEsit = fark.satirlar.every((s) => s.etiket === 'ayni');
  const acikDogru = !!detail && detail.survey_enabled === !!enable;
  return {
    ok: specEsit && acikDogru,
    fark: specEsit ? null : fark.satirlar.filter((s) => s.etiket !== 'ayni'),
    surveyEnabled: detail ? detail.survey_enabled : undefined,
    hash: surveyHash(detail ? detail.survey_enabled : undefined, geriSpec),
    parolaKorunan: korunan,
    parolaElle: elle,
  };
}

async function surveyKapat(istek, templateId) {
  const id = Number(templateId);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('Geçersiz template ID.'), { status: 400 });
  await istek('PATCH', `/api/v2/job_templates/${id}/`, { survey_enabled: false });
  const detail = await istek('GET', `/api/v2/job_templates/${id}/`);
  const geri = await istek('GET', `/api/v2/job_templates/${id}/survey_spec/`).catch(() => null);
  return {
    ok: !!detail && detail.survey_enabled === false,
    fark: null,
    surveyEnabled: detail ? detail.survey_enabled : undefined,
    hash: surveyHash(detail ? detail.survey_enabled : undefined, specListesi(geri)),
  };
}

// ---------------------------------------------------------------------------
// Tek transaction SQL'leri (parametreli; sayi SQL metnine yazilmaz)
// ---------------------------------------------------------------------------
// Hedef ayar satiri HER ZAMAN kaynagin birebir kopyasi olur: kaynakta satir yoksa hedefteki
// (bayat sahneleme / baska servisin geri alinmis tasimasi) satir arsivlenip SILINIR. Kaynak
// satir transaction icinde kilitlenip $7 ile karsilastirilir (onbellekten eski kopya yazilmaz).
// $1 from, $2 fromT, $3 to, $4 toT, $5 itemId, $6 kaynakVar(0/1), $7 data (kaynak satirin DB'deki
// HAM metni), $8 by, $9 reason,
// $10 onceki_json, $11 uygulanan_json, $12 gerekce, $13 fromAd, $14 toAd, $15 eslesme
const TASIMA_SQL = `BEGIN TRY
  BEGIN TRAN;
  IF EXISTS (SELECT 1 FROM smart_tickets WITH (UPDLOCK, HOLDLOCK)
              WHERE awx_server_id = $1 AND awx_template_id = $2 AND status IN ('PENDING','LAUNCHING'))
     THROW 51002, 'ss_tasima_engel_smart', 1;
  IF EXISTS (SELECT 1 FROM oco_scheduled_launches WITH (UPDLOCK, HOLDLOCK)
              WHERE awx_server_id = $1 AND awx_template_id = $2 AND status IN ${AKTIF_OCO})
     THROW 51003, 'ss_tasima_engel_oco', 1;
  UPDATE ansible_ss_items
     SET awx_server_id = $3, awx_template_id = $4, updated_at = GETUTCDATE()
   WHERE id = $5 AND awx_server_id = $1 AND awx_template_id = $2;
  IF @@ROWCOUNT <> 1 THROW 51001, 'ss_tasima_cas', 1;
  IF $6 = 1
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM ansible_ss_customizations WITH (UPDLOCK, HOLDLOCK)
                    WHERE awx_server_id = $1 AND template_id = $2 AND data = $7)
       THROW 51004, 'ss_tasima_kaynak_degisti', 1;
    INSERT INTO ansible_ss_customizations_history (awx_server_id, template_id, data, saved_by, reason)
      SELECT awx_server_id, template_id, data, $8, $9
        FROM ansible_ss_customizations WHERE awx_server_id = $3 AND template_id = $4;
    UPDATE ansible_ss_customizations SET data = $7, updated_at = GETUTCDATE()
     WHERE awx_server_id = $3 AND template_id = $4;
    IF @@ROWCOUNT = 0
      INSERT INTO ansible_ss_customizations (awx_server_id, template_id, data) VALUES ($3, $4, $7);
  END
  ELSE
  BEGIN
    IF EXISTS (SELECT 1 FROM ansible_ss_customizations WITH (UPDLOCK, HOLDLOCK)
                WHERE awx_server_id = $1 AND template_id = $2)
       THROW 51004, 'ss_tasima_kaynak_degisti', 1;
    INSERT INTO ansible_ss_customizations_history (awx_server_id, template_id, data, saved_by, reason)
      SELECT awx_server_id, template_id, data, $8, $9
        FROM ansible_ss_customizations WHERE awx_server_id = $3 AND template_id = $4;
    DELETE FROM ansible_ss_customizations WHERE awx_server_id = $3 AND template_id = $4;
  END;
  UPDATE ansible_ss_migrations
     SET status = 'TASINDI', from_server = $1, from_template = $2, from_template_name = $13,
         to_server = $3, to_template = $4, to_template_name = $14, eslesme = $15,
         onceki_json = $10, uygulanan_json = $11, tasiyan = $8, tasindi_at = SYSUTCDATETIME(),
         denemesiz_gerekce = $12
   WHERE item_id = $5 AND status = 'HAZIRLIK';
  IF @@ROWCOUNT = 0
    INSERT INTO ansible_ss_migrations (item_id, from_server, from_template, from_template_name, to_server,
      to_template, to_template_name, status, eslesme, onceki_json, uygulanan_json, denemesiz_gerekce,
      created_by, tasiyan, tasindi_at)
    VALUES ($5, $1, $2, $13, $3, $4, $14, 'TASINDI', $15, $10, $11, $12, $8, $8, SYSUTCDATETIME());
  COMMIT TRAN;
  SELECT TOP 1 id FROM ansible_ss_migrations WHERE item_id = $5 AND status = 'TASINDI' ORDER BY id DESC;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH`;

// $1 to, $2 toT, $3 from, $4 fromT, $5 itemId, $6 migrationId, $7 by, $8 not
const GERI_AL_SQL = `BEGIN TRY
  BEGIN TRAN;
  IF EXISTS (SELECT 1 FROM smart_tickets WITH (UPDLOCK, HOLDLOCK)
              WHERE awx_server_id = $1 AND awx_template_id = $2 AND status IN ('PENDING','LAUNCHING'))
     THROW 51012, 'ss_geri_al_engel_smart', 1;
  IF EXISTS (SELECT 1 FROM oco_scheduled_launches WITH (UPDLOCK, HOLDLOCK)
              WHERE awx_server_id = $1 AND awx_template_id = $2 AND status IN ${AKTIF_OCO})
     THROW 51013, 'ss_geri_al_engel_oco', 1;
  UPDATE ansible_ss_items
     SET awx_server_id = $3, awx_template_id = $4, updated_at = GETUTCDATE()
   WHERE id = $5 AND awx_server_id = $1 AND awx_template_id = $2;
  IF @@ROWCOUNT <> 1 THROW 51011, 'ss_geri_al_cas', 1;
  UPDATE ansible_ss_migrations
     SET status = 'GERI_ALINDI', geri_alan = $7, geri_alindi_at = SYSUTCDATETIME(), geri_alma_notu = $8
   WHERE id = $6 AND item_id = $5 AND status = 'TASINDI';
  IF @@ROWCOUNT <> 1 THROW 51014, 'ss_geri_al_kayit', 1;
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH`;

/** Transaction hatasi -> { status, message } ya da null (beklenmeyen hata). */
function tasimaHatasi(err) {
  const m = String((err && (err.number ?? '')) || '') + ' ' + String((err && err.message) || '');
  if (/ss_tasima_cas|ss_geri_al_cas/.test(m)) return { status: 409, message: 'Kart siz bakarken değişti; raporu yenileyin.' };
  if (/ss_tasima_engel_smart|ss_geri_al_engel_smart/.test(m))
    return { status: 409, message: `Onay bekleyen Smart bileti var. ${ENGELLER[0].ipucu}` };
  if (/ss_tasima_engel_oco|ss_geri_al_engel_oco/.test(m)) return { status: 409, message: `Zamanlanmış OCO başlatması var. ${ENGELLER[1].ipucu}` };
  if (/ss_tasima_kaynak_degisti/.test(m)) return { status: 409, message: 'Kaynak ayarları siz bakarken değişti; raporu yenileyin.' };
  if (/ss_geri_al_kayit/.test(m)) return { status: 409, message: 'Taşıma kaydı siz bakarken değişti; raporu yenileyin.' };
  if (/UX_ss_migrations_acik/.test(m)) return { status: 409, message: 'Bu servis için başka bir taşıma açık.' };
  if (/2627|2601|duplicate|UNIQUE/i.test(m)) return { status: 409, message: 'Hedef template başka bir servise bağlandı.' };
  return null;
}

/** DB satiri -> istemci kaydi (JSON alanlari ayrisitirilir; bozuksa null). */
function kayitSatiri(r) {
  if (!r) return null;
  const js = (v) => {
    if (v === null || v === undefined || v === '') return null;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  };
  return {
    id: Number(r.id),
    itemId: String(r.item_id),
    fromServer: Number(r.from_server),
    fromTemplate: Number(r.from_template),
    fromTemplateName: r.from_template_name || '',
    toServer: Number(r.to_server),
    toTemplate: Number(r.to_template),
    toTemplateName: r.to_template_name || '',
    status: String(r.status),
    eslesme: r.eslesme || null,
    surveyYazildi: !!r.survey_yazildi,
    hedefSurveyHash: r.hedef_survey_hash || null,
    hedefSurveyOnceki: js(r.hedef_survey_onceki_json),
    onceki: js(r.onceki_json),
    uygulanan: js(r.uygulanan_json),
    denemeJobId: r.deneme_job_id == null ? null : Number(r.deneme_job_id),
    denemeAt: r.deneme_at || null,
    denemeKaynakHash: r.deneme_kaynak_hash || null,
    denemeHedefSurveyHash: r.deneme_hedef_survey_hash || null,
    denemesizGerekce: r.denemesiz_gerekce || null,
    createdBy: r.created_by || null,
    createdAt: r.created_at || null,
    tasiyan: r.tasiyan || null,
    tasindiAt: r.tasindi_at || null,
    geriAlan: r.geri_alan || null,
    geriAlindiAt: r.geri_alindi_at || null,
    geriAlmaNotu: r.geri_alma_notu || null,
  };
}

/**
 * Istemciye giden kayit: onceki_json / uygulanan_json / hedef_survey_onceki_json servis
 * ayarlarinin TAMAMINI (gizli alan varsayilanlari dahil) tasir; ekrana yalniz hash ve alan
 * adlari gider.
 */
function istemciKaydi(k) {
  if (!k) return null;
  const { onceki, uygulanan, hedefSurveyOnceki, ...geri } = k;
  const anahtarlar = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).sort() : []);
  return {
    ...geri,
    ozet: {
      hedefOncekiAyarAlanlari: anahtarlar(onceki && onceki.hedefCustom),
      uygulananAyarAlanlari: anahtarlar(uygulanan && uygulanan.kaynakCustom),
      kaynakCustomHash: (uygulanan && uygulanan.kaynakCustomHash) || null,
      hedefCustomHash: (uygulanan && uygulanan.hedefCustomHash) || null,
      hedefSurveyOncekiVar: !!hedefSurveyOnceki,
    },
  };
}

/**
 * Kart listesi yaziminda (writeSsItems) TASINDI kaydi olan kartin bagi degisiyor mu. Bayat
 * onbellekten ya da /ss/items duzenlemesinden gelen yazim tasimayi sessizce geri almasin.
 * Listeden CIKARILAN kart serbesttir (silme).
 * @returns {Array<{id: string, title: string, beklenen: string, gelen: string}>}
 */
function kartBagIhlalleri(items, tasinanlar) {
  const bekl = new Map();
  for (const r of Array.isArray(tasinanlar) ? tasinanlar : []) {
    if (r && r.item_id != null) bekl.set(String(r.item_id), [Number(r.to_server), Number(r.to_template)]);
  }
  const out = [];
  for (const i of Array.isArray(items) ? items : []) {
    const b = i ? bekl.get(String(i.id)) : null;
    if (!b) continue;
    if (Number(i.awxServerId) !== b[0] || Number(i.awxTemplateId) !== b[1])
      out.push({
        id: String(i.id),
        title: String(i.title || i.id),
        beklenen: `${b[0]}/${b[1]}`,
        gelen: `${Number(i.awxServerId)}/${Number(i.awxTemplateId)}`,
      });
  }
  return out;
}

/** AWX sunucu URL'inin host'u (kucuk harf); bozuksa ''. */
function urlHost(u) {
  try {
    return new URL(String(u || '').trim()).host.toLowerCase();
  } catch {
    return '';
  }
}

/** Iki sunucu kaydi ayni AWX mi: ayni id ya da ayni URL host'u (takma ad / eski kayit). */
function ayniSunucu(a, b) {
  if (!a || !b) return false;
  if (Number(a.id) === Number(b.id)) return true;
  const ha = urlHost(a.url);
  return !!ha && ha === urlHost(b.url);
}

/** Iki duz nesnenin ust duzey anahtar farki (geri alma onizlemesi icin). */
function alanFarki(once, simdi) {
  const a = once && typeof once === 'object' ? once : {};
  const b = simdi && typeof simdi === 'object' ? simdi : {};
  const out = [];
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (kararliJson(a[k]) !== kararliJson(b[k])) out.push({ alan: k, once: a[k] === undefined ? null : a[k], simdi: b[k] === undefined ? null : b[k] });
  }
  return out;
}

/**
 * Kart listesine `oncekiBaglar` ekler: TASINDI kaydinin kaynagi, GERI_ALINDI kaydinin iki ucu
 * (geri alinana kadar hedefte de is kosmus olabilir). Kartin GUNCEL bagi listeye girmez.
 */
function oncekiBaglariEkle(items, gocler) {
  const baglar = new Map();
  const ekle = (id, s, t) => {
    const sn = Number(s);
    const tn = Number(t);
    if (!(sn >= 0) || !(tn > 0)) return;
    if (!baglar.has(id)) baglar.set(id, []);
    const l = baglar.get(id);
    if (!l.some((b) => b.awxServerId === sn && b.awxTemplateId === tn)) l.push({ awxServerId: sn, awxTemplateId: tn });
  };
  for (const g of Array.isArray(gocler) ? gocler : []) {
    if (!g || g.item_id == null) continue;
    const id = String(g.item_id);
    if (g.status === 'TASINDI' || g.status === 'GERI_ALINDI') ekle(id, g.from_server, g.from_template);
    if (g.status === 'GERI_ALINDI') ekle(id, g.to_server, g.to_template);
  }
  return (Array.isArray(items) ? items : []).map((i) => {
    const l = (baglar.get(String(i.id)) || []).filter(
      (b) => !(b.awxServerId === Number(i.awxServerId) && b.awxTemplateId === Number(i.awxTemplateId)),
    );
    return l.length ? { ...i, oncekiBaglar: l } : i;
  });
}

module.exports = {
  oncekiBaglariEkle,
  istemciKaydi,
  kartBagIhlalleri,
  ayniSunucu,
  parolaHazirla,
  CIP_ONCELIK,
  ESLESME_NEDENI,
  ENGELLER,
  SUREN_IS_SQL,
  PLAYBOOK_KAYDI_SQL,
  TASIMA_SQL,
  GERI_AL_SQL,
  kararliJson,
  sha,
  veriHash,
  eslestir,
  surveyNormalize,
  surveyFarki,
  surveyHash,
  surveyModu,
  surveyKarari,
  templateKarsilastir,
  gomuluKimlikTara,
  ozellestirmeUyumu,
  engelleriSay,
  durumBelirle,
  planHash,
  parolaTemizle,
  surveyYaz,
  surveyKapat,
  tasimaHatasi,
  kayitSatiri,
  alanFarki,
};
