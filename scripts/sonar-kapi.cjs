// scripts/sonar-kapi.cjs — SonarQube kalite kapisi (kalite kapisi K13; docs/KALITE-KAPILARI.md).
//   npm run kapi:sonar                  calisan bir SonarQube'a (SONAR_HOST_URL) tarar, kapiyi bekler
//   node scripts/sonar-kapi.cjs --docker   sunucu yoksa yerelde konteyner baslatir (Docker gerekir)
//   node scripts/sonar-kapi.cjs --ci       CI: taze konteyner (admin/admin) -> parola + jeton uretir
//   ... --kurumsal                          ek olarak KURUMSAL TAKLIT (K15): kurumun siniflandirmasi ve
//                                           kural profiliyle (kalite/kurumsal-sonar.json) ayri projeye
//                                           tarar; kapi K13 ile ayni, inceleme kaydi uygulanmaz ve
//                                           inceleme bekleyen hotspot mutlak 0
//
// KURUMSAL TAKLIT (2026-11-18, kurumsal is #49): kurumun scanOnSonar adimi sources / tests /
// test.inclusions / exclusions anahtarlarini komut satirindan verip bizim siniflandirmamizi ezer.
// Is #49'da Node testleri (.test.cjs) uretim kodu sayildi: kapsam %50, testteki sahte parolalar
// guvenlik bulgusu. Taklit kurumun gorecegini her PR'da gosterir; kapsam raporu kurumun yukledigi
// gibi kaynak dosyalariyla suzulur (scripts/kapsam-yayinla.cjs lcovSuz). SCM acik: kurumdaki gibi
// .gitignore uygulanir.
// KURUM PROFILI (2026-11-20, is #52): kurumun "GT way" profili disa aktarilamiyor; K15 her dilde
// "Portal Kurumsal" profilini kalite/kurumsal-sonar.json `profil`den her kosuda sifirdan kurar (yerlesik
// varsayilan profilin bug / zafiyet / hotspot kurallari + kurumun bulgu verdigi kurallar, parametreleriyle). Kurum yerel
// hotspot incelemelerimizi gormez: K15 kayitlari uygulamaz, kapisi hotspot'ta da mutlak.
//
// Kimlik: SONAR_TOKEN (yonetici yetkili kullanici jetonu) ya da SONAR_ADMIN_PASSWORD. --ci'de ikisi
// de gerekmez. Kapi kosullari kalite/esikler.json `sonar.kosullar` (tek kaynak): betik "Portal Kati"
// kapisini her kosuda bu listeye ESITLER ve projeye baglar. Taramadan sonra kalite/sonar-inceleme.json
// kayitlarini (gerekceli hotspot incelemeleri) uygular, kapinin son durumunu okur.
// Kurumsal SonarQube'un kapisi ayridir ve daha gevsektir; bu kapi kurumda kirmizi cikmamanin
// yerel garantisidir.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { aracYolu } = require('./arac-yolu.cjs');
const { KURUMA_GITMEYEN } = require('./teslim.cjs');

const KOK = path.join(__dirname, '..');
const IMAJ = 'sonarqube:26.11.0.134175-community';
const TARAYICI = '@sonar/scan@5.0.2';
const KONTEYNER = 'portal-sonar-kapi';

const KURUMSAL_PROJE = 'bmw-portal-kurumsal';
const KURUMSAL_LCOV = 'coverage/kurumsal-lcov.info';
const KURUMSAL_PROFIL = 'Portal Kurumsal';

const esikler = () => JSON.parse(fs.readFileSync(path.join(KOK, 'kalite', 'esikler.json'), 'utf8'));
const incelemeler = () =>
  JSON.parse(fs.readFileSync(path.join(KOK, 'kalite', 'sonar-inceleme.json'), 'utf8')).incelemeler;

/** Hotspot + satirin metni -> eslesen inceleme kaydi ya da null. Saf islev. */
function incelemeBul(hotspot, satirMetni, liste) {
  const dosya = String(hotspot.component || '')
    .split(':')
    .slice(1)
    .join(':');
  const kural = hotspot.ruleKey || hotspot.rule;
  return (
    liste.find(
      (k) => k.kural === kural && k.dosya === dosya && String(satirMetni || '').includes(k.icerik),
    ) || null
  );
}

/**
 * Kurumsal depoda BULUNMAYAN dizinler (scripts/teslim.cjs KURUMA_GITMEYEN; aktarimda silinir, CI provasi
 * kurum agacini boyle kurar). Taklit kurumun tarayacagi agaci tarar: bu dizinler kurumda yoktur, bu
 * yuzden taramada da yoktur. Kurumun desenleri gevsetilmez; liste teslim listesinin aynisidir (KK12).
 */
const KURUM_AGACINDA_YOK = KURUMA_GITMEYEN.map((d) => `${d}**`);

/** kalite/kurumsal-sonar.json -> kurumun komut satiri anahtarlari (-D...). Saf islev. */
function kurumsalArgumanlar(k, lcov = KURUMSAL_LCOV) {
  return [
    `-Dsonar.sources=${k.sources}`,
    `-Dsonar.tests=${k.tests}`,
    `-Dsonar.test.inclusions=${k.testInclusions.join(',')}`,
    `-Dsonar.exclusions=${[...k.exclusions, ...KURUM_AGACINDA_YOK].join(',')}`,
    `-Dsonar.coverage.exclusions=${k.coverageExclusions.join(',')}`,
    `-Dsonar.javascript.lcov.reportPaths=${lcov}`,
  ];
}

/** esikler.json -> kapi kosullari [{ metric, op, error }]. Saf islev. */
function kosullar(e) {
  return e.sonar.kosullar.map((k) => ({ metric: k.metrik, op: k.op, error: String(k.esik) }));
}

/** kalite/kurumsal-sonar.json `profil` -> [{ dil, kural, params }] (params: 'a=1;b=2'). Saf islev. */
function profilKurallari(k) {
  return Object.entries(k.profil.kurallar).flatMap(([dil, liste]) =>
    liste.map((g) => {
      const { kural, parametreler = {} } = typeof g === 'string' ? { kural: g } : g;
      const params = Object.entries(parametreler)
        .map(([ad, deger]) => `${ad}=${deger}`)
        .join(';');
      return { dil, kural, params };
    }),
  );
}

/**
 * K15 profili: her dilde "Portal Kurumsal" sifirdan kurulur ve projeye baglanir. Yerel sunucuda dili
 * ya da kurali olmayan girdi hata olur (kapi sessizce zayiflamaz).
 */
async function kurumProfiliKur(api, k, proje) {
  const kurallar = profilKurallari(k);
  const diller = new Set(((await api('/api/languages/list')).languages || []).map((l) => l.key));
  const eksik = [];
  let etkin = 0;
  for (const dil of new Set(kurallar.map((r) => r.dil))) {
    if (!diller.has(dil)) {
      eksik.push(`${dil}: dil yerel sunucuda yok`);
      continue;
    }
    const profiller = (await api('/api/qualityprofiles/search', { language: dil })).profiles || [];
    if (profiller.some((p) => p.name === KURUMSAL_PROFIL))
      await api(
        '/api/qualityprofiles/delete',
        { language: dil, qualityProfile: KURUMSAL_PROFIL },
        'POST',
      );
    const yeni = await api(
      '/api/qualityprofiles/create',
      { language: dil, name: KURUMSAL_PROFIL },
      'POST',
    );
    const anahtar = yeni.profile.key;
    // K13'un kullandigi yerlesik varsayilan profil (26.x'te adi "Sonar way core").
    const yerlesik = profiller.find((p) => p.isBuiltIn && p.isDefault);
    if (!yerlesik) eksik.push(`${dil}: yerlesik varsayilan profil yok`);
    else
      await api(
        '/api/qualityprofiles/activate_rules',
        {
          targetKey: anahtar,
          qprofile: yerlesik.key,
          activation: 'true',
          types: 'BUG,VULNERABILITY,SECURITY_HOTSPOT',
        },
        'POST',
      );
    for (const r of kurallar.filter((x) => x.dil === dil)) {
      try {
        await api(
          '/api/qualityprofiles/activate_rule',
          { key: anahtar, rule: r.kural, ...(r.params ? { params: r.params } : {}) },
          'POST',
        );
        etkin += 1;
      } catch (err) {
        eksik.push(`${r.kural}: ${err.message}`);
      }
    }
    await api(
      '/api/qualityprofiles/add_project',
      { language: dil, qualityProfile: KURUMSAL_PROFIL, project: proje },
      'POST',
    );
  }
  if (eksik.length) throw new Error(`kurum profili kurulamadi:\n  ${eksik.join('\n  ')}`);
  return etkin;
}

/** project_status yaniti -> { tamam, satirlar[] }. Saf islev. */
function durumOzeti(ps) {
  const p = ps?.projectStatus || {};
  const satirlar = (p.conditions || []).map(
    (c) =>
      `  ${c.status === 'OK' ? 'TAMAM  ' : 'KIRMIZI'} ${c.metricKey} = ${c.actualValue ?? '-'} (esik ${c.comparator} ${c.errorThreshold})`,
  );
  return { tamam: p.status === 'OK', satirlar };
}

const bekle = (ms) => new Promise((res) => setTimeout(res, ms));

function istemci(host, yetki) {
  return async function api(yol, params, yontem = 'GET') {
    const govde = params ? new URLSearchParams(params).toString() : '';
    const url = yontem === 'GET' && govde ? `${host}${yol}?${govde}` : `${host}${yol}`;
    const istek = () =>
      fetch(url, {
        method: yontem,
        headers: {
          ...(yetki ? { Authorization: yetki } : {}),
          ...(yontem === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body: yontem === 'POST' ? govde : undefined,
      });
    // Sunucu bosta kalan baglantiyi kapatir; havuzdan gelen kapanmis sokette istek sunucuya hic
    // ulasmadan duser (UND_ERR_SOCKET). Yalniz bu sinif icin yeni baglantiyla bir kez daha denenir.
    let r;
    try {
      r = await istek();
    } catch (e) {
      if (!['UND_ERR_SOCKET', 'ECONNRESET', 'UND_ERR_CLOSED'].includes(e?.cause?.code)) throw e;
      await bekle(500);
      r = await istek();
    }
    const metin = await r.text();
    if (!r.ok) throw new Error(`${yontem} ${yol} -> ${r.status} ${metin.slice(0, 200)}`);
    return metin ? JSON.parse(metin) : {};
  };
}

async function ayaktaBekle(host, sureSn) {
  const son = Date.now() + sureSn * 1000;
  for (;;) {
    try {
      const d = await istemci(host)('/api/system/status');
      if (d.status === 'UP') return;
    } catch {
      /* sunucu henuz dinlemiyor */
    }
    if (Date.now() > son) throw new Error(`SonarQube ${sureSn} sn icinde ayaga kalkmadi (${host})`);
    await bekle(5000);
  }
}

function dockerBaslat() {
  const var_ = spawnSync(
    aracYolu('docker'),
    ['ps', '-a', '--filter', `name=^${KONTEYNER}$`, '--format', '{{.Status}}'],
    { encoding: 'utf8' },
  );
  if (var_.error) throw new Error('docker bulunamadi (--docker icin Docker gerekir)');
  if (String(var_.stdout).trim()) {
    spawnSync(aracYolu('docker'), ['start', KONTEYNER], { stdio: 'inherit' });
    return;
  }
  const r = spawnSync(
    aracYolu('docker'),
    [
      'run',
      '-d',
      '--name',
      KONTEYNER,
      '-p',
      '9000:9000',
      '-e',
      'SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true',
      IMAJ,
    ],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) throw new Error('SonarQube konteyneri baslatilamadi');
}

/** Yonetici yetkisi -> { yetki (provizyon), jeton (tarayici) }. */
async function kimlik(host, ci) {
  if (process.env.SONAR_TOKEN)
    return { yetki: `Bearer ${process.env.SONAR_TOKEN}`, jeton: process.env.SONAR_TOKEN };
  let parola = process.env.SONAR_ADMIN_PASSWORD;
  if (!parola && ci) {
    // Taze konteyner: varsayilan parola tek kullanimlik; kosu boyunca rastgele bir parolaya cevrilir.
    parola = `K${crypto.randomBytes(18).toString('base64url')}9!`;
    await istemci(host, `Basic ${Buffer.from('admin:admin').toString('base64')}`)(
      '/api/users/change_password',
      { login: 'admin', previousPassword: 'admin', password: parola },
      'POST',
    );
  }
  if (!parola) throw new Error('SONAR_TOKEN ya da SONAR_ADMIN_PASSWORD gerekli (CI disinda)');
  const yetki = `Basic ${Buffer.from('admin:' + parola).toString('base64')}`;
  const t = await istemci(host, yetki)(
    '/api/user_tokens/generate',
    { name: `kapi-${Date.now()}` },
    'POST',
  );
  return { yetki, jeton: t.token };
}

async function kapiyiEsitle(api, ad, hedef, projeAnahtari) {
  const liste = await api('/api/qualitygates/list');
  if (!(liste.qualitygates || []).some((g) => g.name === ad))
    await api('/api/qualitygates/create', { name: ad }, 'POST');
  const mevcut = await api('/api/qualitygates/show', { name: ad });
  for (const c of mevcut.conditions || [])
    await api('/api/qualitygates/delete_condition', { id: c.id }, 'POST');
  for (const k of hedef)
    await api('/api/qualitygates/create_condition', { gateName: ad, ...k }, 'POST');
  const proje = await api('/api/projects/search', { projects: projeAnahtari });
  if (!(proje.components || []).length)
    await api('/api/projects/create', { project: projeAnahtari, name: projeAnahtari }, 'POST');
  await api('/api/qualitygates/select', { gateName: ad, projectKey: projeAnahtari }, 'POST');
}

/** Tarayicinin birakti gorev kimligi -> sunucu analizi bitirene kadar bekler. */
async function analizBekle(api) {
  const rapor = fs.readFileSync(path.join(KOK, '.scannerwork', 'report-task.txt'), 'utf8');
  const id = (/^ceTaskId=(.+)$/m.exec(rapor) || [])[1];
  if (!id) throw new Error('report-task.txt icinde ceTaskId yok');
  const son = Date.now() + 30 * 60 * 1000;
  for (;;) {
    const { task } = await api('/api/ce/task', { id });
    if (task.status === 'SUCCESS') return;
    if (task.status === 'FAILED' || task.status === 'CANCELED')
      throw new Error(`sunucu analizi ${task.status}: ${task.errorMessage || ''}`);
    if (Date.now() > son) throw new Error('sunucu analizi 30 dk icinde bitmedi');
    await bekle(5000);
  }
}

/** Dosyanin `satir`inci satiri (1 tabanli); okunamazsa ''. */
function satirOku(dosya, satir) {
  try {
    return fs.readFileSync(path.join(KOK, dosya), 'utf8').split('\n')[(satir || 1) - 1] || '';
  } catch {
    return ''; // dosya yerelde yok: eslesmez, kalan sayilir
  }
}

/** K15: inceleme kaydi uygulanmaz; bekleyen hotspot'lari listeler, sayisini dondurur. */
async function hotspotlariYaz(api, proje) {
  const hs = await api('/api/hotspots/search', { project: proje, status: 'TO_REVIEW', ps: '500' });
  for (const h of hs.hotspots || [])
    console.error(
      `  - hotspot ${h.ruleKey} ${String(h.component).split(':').slice(1).join(':')}:${h.line ?? ''} ${h.message}`,
    );
  return hs.paging?.total ?? (hs.hotspots || []).length;
}

/**
 * Repodaki gerekceli kararlari uygular: inceleme bekleyen hotspot -> "Reviewed - Safe"; ayni kurala
 * sunucu surumu hotspot yerine SORUN acmissa (orn. 26.x'te S5443) -> "Accepted". Kaydi olmayanlar
 * oldugu gibi kalir ve kapiyi kirmizi tutar.
 */
async function incelemeleriUygula(api, proje) {
  const liste = incelemeler();
  const not = (k) => `kalite/sonar-inceleme.json: ${k.gerekce}`;
  const hs = await api('/api/hotspots/search', { project: proje, status: 'TO_REVIEW', ps: '500' });
  const kalan = [];
  let uygulanan = 0;
  for (const h of hs.hotspots || []) {
    const dosya = String(h.component).split(':').slice(1).join(':');
    const k = incelemeBul(h, satirOku(dosya, h.line), liste);
    if (!k) {
      kalan.push(`  - ${h.ruleKey} ${dosya}:${h.line ?? ''} ${h.message}`);
      continue;
    }
    await api(
      '/api/hotspots/change_status',
      { hotspot: h.key, status: 'REVIEWED', resolution: 'SAFE', comment: not(k) },
      'POST',
    );
    uygulanan += 1;
  }
  const kurallar = [...new Set(liste.map((k) => k.kural))].join(',');
  const is = kurallar
    ? await api('/api/issues/search', {
        componentKeys: proje,
        rules: kurallar,
        issueStatuses: 'OPEN,CONFIRMED',
        ps: '500',
      })
    : { issues: [] };
  for (const i of is.issues || []) {
    const dosya = String(i.component).split(':').slice(1).join(':');
    const k = incelemeBul(
      { component: i.component, ruleKey: i.rule },
      satirOku(dosya, i.line),
      liste,
    );
    if (!k) continue; // kayitsiz sorun kapida zaten sayilir
    await api('/api/issues/add_comment', { issue: i.key, text: not(k) }, 'POST');
    await api('/api/issues/do_transition', { issue: i.key, transition: 'accept' }, 'POST');
    uygulanan += 1;
  }
  if (kalan.length) {
    console.error(
      "[sonar-kapi] inceleme bekleyen hotspot (kodu duzelt ya da kalite/sonar-inceleme.json'a gerekcesiyle ekle):",
    );
    for (const s of kalan) console.error(s);
  }
  if (uygulanan) {
    console.log(
      `[sonar-kapi] ${uygulanan} kayitli inceleme uygulandi (kalite/sonar-inceleme.json).`,
    );
    await bekle(5000); // olcumler ve kapi canli guncellenir
  }
}

async function main(argv) {
  const ci = argv.includes('--ci');
  const host = (process.env.SONAR_HOST_URL || 'http://127.0.0.1:9000').replace(/\/$/, '');
  const proje = process.env.SONAR_PROJE || 'bmw-portal-kapi';
  const e = esikler();
  if (argv.includes('--docker')) {
    try {
      await ayaktaBekle(host, 1);
    } catch {
      dockerBaslat();
    }
  }
  await ayaktaBekle(host, ci ? 600 : 300);
  console.log(`[sonar-kapi] sunucu hazir: ${host}`);
  const { yetki, jeton } = await kimlik(host, ci);
  const api = istemci(host, yetki);
  await kapiyiEsitle(api, e.sonar.kapiAdi, kosullar(e), proje);
  console.log(
    `[sonar-kapi] "${e.sonar.kapiAdi}" kapisi ${kosullar(e).length} kosulla esitlendi, proje ${proje}.`,
  );

  const lcov = fs.existsSync(path.join(KOK, 'coverage', 'lcov.info'))
    ? 'coverage/lcov.info'
    : 'kalite/kapsam/lcov.info';
  const tamam = await tara(api, host, jeton, e, {
    proje,
    lcov,
    argumanlar: [`-Dsonar.javascript.lcov.reportPaths=${lcov}`, '-Dsonar.scm.disabled=true'],
  });
  if (!argv.includes('--kurumsal')) return tamam ? 0 : 1;

  // K15: kurumun siniflandirmasi. Kapsam raporu kurumun yukledigi gibi: yalniz kaynak dosyalari.
  const { lcovSuz } = require('./kapsam-yayinla.cjs');
  fs.mkdirSync(path.join(KOK, 'coverage'), { recursive: true });
  fs.writeFileSync(
    path.join(KOK, KURUMSAL_LCOV),
    lcovSuz(fs.readFileSync(path.join(KOK, lcov), 'utf8')).metin,
  );
  await kapiyiEsitle(api, e.sonar.kapiAdi, kosullar(e), KURUMSAL_PROJE);
  const k = JSON.parse(fs.readFileSync(path.join(KOK, 'kalite', 'kurumsal-sonar.json'), 'utf8'));
  const etkin = await kurumProfiliKur(api, k, KURUMSAL_PROJE);
  console.log(`[sonar-kapi] "${KURUMSAL_PROFIL}" profili kuruldu (${etkin} kurum kurali).`);
  const kurumsal = await tara(api, host, jeton, e, {
    proje: KURUMSAL_PROJE,
    lcov: KURUMSAL_LCOV,
    argumanlar: kurumsalArgumanlar(k),
    inceleme: false,
  });
  return tamam && kurumsal ? 0 : 1;
}

/** Bir tarama + kapi sonucu. true = yesil. */
async function tara(api, host, jeton, e, { proje, lcov, argumanlar, inceleme = true }) {
  const tarama = spawnSync(
    aracYolu('npx'),
    [
      '--yes',
      TARAYICI,
      `-Dsonar.host.url=${host}`,
      `-Dsonar.projectKey=${proje}`,
      `-Dsonar.projectName=${proje}`,
      ...argumanlar,
      '-Dsonar.javascript.node.maxspace=8192',
    ],
    { cwd: KOK, stdio: 'inherit', env: { ...process.env, SONAR_TOKEN: jeton } },
  );
  if (tarama.status !== 0) throw new Error(`tarayici basarisiz (cikis ${tarama.status})`);
  await analizBekle(api);
  // K15: kayit uygulanmaz; inceleme bekleyen hotspot mutlak 0 (SonarQube `security_hotspots`
  // metrigini kapi kosulu olarak kabul etmez, sayi burada denetlenir).
  let bekleyenHotspot = 0;
  if (inceleme) await incelemeleriUygula(api, proje);
  else bekleyenHotspot = await hotspotlariYaz(api, proje);
  const ps = await api('/api/qualitygates/project_status', { projectKey: proje });
  const { tamam, satirlar } = durumOzeti(ps);
  if (!inceleme)
    satirlar.push(
      `  ${bekleyenHotspot ? 'KIRMIZI' : 'TAMAM  '} inceleme bekleyen hotspot = ${bekleyenHotspot} (mutlak 0)`,
    );
  console.log(`\n[sonar-kapi] ${e.sonar.kapiAdi} (${proje}, kapsam raporu ${lcov}):`);
  for (const s of satirlar) console.log(s);
  if (!tamam || bekleyenHotspot) {
    // Notu dusuren bulgular: bug / zafiyet ve MQR guvenilirlik / guvenlik etkisi olan kokular
    // (yalniz bug listelemek MQR notu kirmiziyken ekrani bos birakiyordu).
    // Kod kokusu kapisi mutlak: listede bakim (MAINTAINABILITY) bulgulari da gorunur.
    const d = await api('/api/issues/search', {
      componentKeys: proje,
      issueStatuses: 'OPEN,CONFIRMED',
      ps: '50',
    });
    console.error(`[sonar-kapi] acik bulgu: ${d.total ?? (d.issues || []).length}`);
    for (const i of d.issues || [])
      console.error(
        `  - ${i.rule} ${String(i.component).split(':').slice(1).join(':')}:${i.line ?? ''} ${i.message}`,
      );
    console.error(
      `[sonar-kapi] KIRMIZI. Ayrinti: ${host}/dashboard?id=${encodeURIComponent(proje)}`,
    );
    return false;
  }
  console.log(`[sonar-kapi] ${proje}: kapi yesil.`);
  return true;
}

if (require.main === module)
  main(process.argv.slice(2)).then(
    (rc) => {
      process.exitCode = rc;
    },
    (err) => {
      const neden = err?.cause ? ` (${err.cause.code || err.cause.message})` : '';
      console.error(`[sonar-kapi] HATA: ${err?.message}${neden}`);
      process.exitCode = 1;
    },
  );

module.exports = {
  kosullar,
  profilKurallari,
  durumOzeti,
  incelemeBul,
  incelemeler,
  kurumsalArgumanlar,
  KURUM_AGACINDA_YOK,
  IMAJ,
  KURUMSAL_PROJE,
  KURUMSAL_LCOV,
  KURUMSAL_PROFIL,
};
