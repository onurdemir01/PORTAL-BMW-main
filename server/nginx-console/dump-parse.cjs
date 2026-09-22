// server/nginx-console/dump-parse.cjs — nginx_console_dump.sh ciktisini ayristirir (SAF).
//
// Bolumler: @@HOST/@@TIME/@@PREFIX, @@NGINX_T ok|fail ... @@END, @@TREE ... @@END,
// @@FILE <yol> <sha> <size> ... @@END, @@CERTUSE conf\tserver_name\tcrt\tkey\tkeystate,
// @@CERT <yol> key=value... @@END. Sozlesme betigin basinda; degisirse ikisi birlikte.
'use strict';

const fs = require('node:fs');
const { StringDecoder } = require('node:string_decoder');

/**
 * Ayristirici SATIR CEKER (readLine() -> string | null). Boylece ayni kod hem
 * bellekteki metin icin (parseDump) hem de dosyayi parca parca okuyan akis icin
 * (parseDumpFileSync) kullanilabiliyor — 30 MB'lik dokumu bellege almadan ozet
 * cikarmanin tek yolu bu (2026-09-22: 8 reverse-proxy dokumu tavani asiyordu).
 *
 * opts.skipFileContent: @@FILE bloklarinin ICERIGI saklanmaz (yalniz sha/size).
 * Ozet ekranlarinin (host listesi, sertifika, tutarlilik) icerige ihtiyaci yok.
 */
function parseDumpFrom(readLine, opts = {}) {
  const skipContent = !!opts.skipFileContent;
  const out = {
    host: null,
    time: null,
    prefix: '/usr/nginx',
    nginxT: { status: 'unknown', output: '' },
    tree: [], // {path, size, mtime, sha256}
    files: new Map(), // path -> {sha256, size, content}
    certUses: [], // {conf, serverName, cert, key, keyState}
    certs: new Map(), // path -> {exists, ...fields}
    // 2026-09-22: nginx -T'nin yukledigi dosyalar (null = dokumda bolum yok, eski dokum) ve ssl/ dizini
    loaded: null, // string[] | null
    sslFiles: [], // {path, size, mtime}
  };
  let raw;
  while ((raw = readLine()) !== null) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('@@HOST ')) out.host = line.slice(7).trim();
    else if (line.startsWith('@@TIME ')) out.time = line.slice(7).trim();
    else if (line.startsWith('@@PREFIX ')) out.prefix = line.slice(9).trim() || '/usr/nginx';
    else if (line.startsWith('@@NGINX_T ')) {
      out.nginxT.status = line.slice(10).trim() === 'ok' ? 'ok' : 'fail';
      const buf = [];
      let l;
      while ((l = readLine()) !== null && l.replace(/\r$/, '') !== '@@END') buf.push(l);
      out.nginxT.output = buf.join('\n');
    } else if (line === '@@LOADED') {
      out.loaded = [];
      let l;
      while ((l = readLine()) !== null && l.replace(/\r$/, '') !== '@@END') { const v = l.replace(/\r$/, '').trim(); if (v) out.loaded.push(v); }
    } else if (line === '@@SSLDIR') {
      let l;
      while ((l = readLine()) !== null && l.replace(/\r$/, '') !== '@@END') {
        const f = l.replace(/\r$/, '').split('\t');
        if (f.length >= 3) out.sslFiles.push({ size: Number(f[0]) || 0, mtime: f[1], path: f.slice(2).join('\t') });
      }
    } else if (line === '@@TREE') {
      let l;
      while ((l = readLine()) !== null && l.replace(/\r$/, '') !== '@@END') {
        const f = l.replace(/\r$/, '').split('\t');
        // 5 alan (2026-09-19, sahip eklendi) ya da eski 4 alan; yol her zaman SON alan
        if (f.length >= 5) out.tree.push({ size: Number(f[0]) || 0, mtime: f[1], sha256: f[2], owner: f[3] === '?' ? null : f[3], path: f.slice(4).join('\t') });
        else if (f.length === 4) out.tree.push({ size: Number(f[0]) || 0, mtime: f[1], sha256: f[2], owner: null, path: f[3] });
      }
    } else if (line.startsWith('@@FILE ')) {
      // "@@FILE <yol> <sha> <size>" — yol bosluk icerebilir: sondan iki alan sabittir.
      const parts = line.slice(7).trim().split(' ');
      const size = Number(parts.pop()) || 0;
      const sha256 = parts.pop() || '';
      const p = parts.join(' ');
      const buf = [];
      let l;
      while ((l = readLine()) !== null && l.replace(/\r$/, '') !== '@@END') { if (!skipContent) buf.push(l); }
      if (!skipContent) out.files.set(p, { sha256, size, content: buf.join('\n') });
    } else if (line.startsWith('@@CERTUSE ')) {
      const f = line.slice(10).split('\t');
      out.certUses.push({ conf: f[0] || '', serverName: f[1] || '', cert: f[2] || '', key: f[3] || '', keyState: f[4] || '' });
    } else if (line.startsWith('@@CERT ')) {
      const p = line.slice(7).trim();
      const rec = { path: p, exists: false };
      let l;
      while ((l = readLine()) !== null && l.replace(/\r$/, '') !== '@@END') {
        const v = l.replace(/\r$/, '');
        const eq = v.indexOf('=');
        if (eq > 0) rec[v.slice(0, eq).trim()] = v.slice(eq + 1).trim();
      }
      rec.exists = rec.exists === '1' || rec.exists === true;
      out.certs.set(p, normalizeCert(rec));
    }
  }
  return out;
}

/** Bellekteki metni ayristirir (eski davranis). */
function parseDump(text, opts = {}) {
  const lines = String(text || '').split('\n');
  let i = 0;
  return parseDumpFrom(() => (i < lines.length ? lines[i++] : null), opts);
}

/**
 * Dokumu DISKTEN PARCA PARCA okuyarak ayristirir: dosyanin tamami hicbir zaman
 * bellekte tutulmaz. `skipFileContent` ile 30 MB'lik bir dokumden bile birkac MB
 * ozet cikar. Cok baytli karakterler parca sinirinda bolunmesin diye StringDecoder.
 */
function parseDumpFileSync(filePath, opts = {}) {
  const fd = fs.openSync(filePath, 'r');
  const CHUNK = 1 << 20;
  const buf = Buffer.allocUnsafe(CHUNK);
  const decoder = new StringDecoder('utf8');
  let queue = [];
  let qi = 0;
  let tail = '';
  let eof = false;
  const readLine = () => {
    for (;;) {
      if (qi < queue.length) return queue[qi++];
      if (eof) {
        if (tail !== '') { const son = tail; tail = ''; return son; }
        return null;
      }
      const n = fs.readSync(fd, buf, 0, CHUNK, null);
      if (n === 0) { eof = true; tail += decoder.end(); continue; }
      const parcalar = (tail + decoder.write(buf.subarray(0, n))).split('\n');
      tail = parcalar.pop();
      queue = parcalar;
      qi = 0;
    }
  };
  try {
    return parseDumpFrom(readLine, opts);
  } finally {
    fs.closeSync(fd);
  }
}

// openssl tarih bicimi: "Sep 19 18:46:18 2026 GMT"
function parseOpensslDate(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(' GMT', ' UTC'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeCert(rec) {
  const notAfter = parseOpensslDate(rec.notAfter);
  const notBefore = parseOpensslDate(rec.notBefore);
  const chain = Number(rec.chain) || 0;
  const chainSubjects = [];
  for (let k = 2; k <= 5; k++) if (rec['chain' + k]) chainSubjects.push(rec['chain' + k]);
  return {
    path: rec.path,
    exists: !!rec.exists,
    sha256: rec.sha256 || null,
    size: Number(rec.size) || 0,
    mtime: rec.mtime || null,
    subject: rec.subject || null,
    cn: cnOf(rec.subject),
    issuer: rec.issuer || null,
    issuerCn: cnOf(rec.issuer),
    serial: rec.serial || null,
    notBefore,
    notAfter,
    fingerprint: rec.fingerprint || null,
    sigalg: rec.sigalg || null,
    keybits: Number(rec.keybits) || null,
    san: rec.san ? String(rec.san).split(',').map((x) => x.trim()).filter(Boolean) : [],
    chain,
    chainSubjects,
    selfSigned: !!(rec.subject && rec.issuer && rec.subject === rec.issuer),
  };
}

function cnOf(dn) {
  const m = /(?:^|,\s*)CN\s*=\s*([^,]+)/.exec(String(dn || ''));
  return m ? m[1].trim() : null;
}

// Kalan gun: negatif = suresi dolmus. now: test icin.
function daysLeft(notAfterIso, now = Date.now()) {
  if (!notAfterIso) return null;
  return Math.floor((new Date(notAfterIso).getTime() - now) / 86400000);
}

/** Agac: duz yol listesinden ic ice dizin yapisi (Portal agaci). */
function buildTree(entries, prefix) {
  const root = { name: prefix, path: prefix, dirs: new Map(), files: [] };
  for (const e of entries) {
    if (!e.path.startsWith(prefix + '/')) continue;
    const rel = e.path.slice(prefix.length + 1).split('/');
    let node = root;
    for (let k = 0; k < rel.length - 1; k++) {
      const seg = rel[k];
      if (!node.dirs.has(seg)) node.dirs.set(seg, { name: seg, path: node.path + '/' + seg, dirs: new Map(), files: [] });
      node = node.dirs.get(seg);
    }
    node.files.push({ name: rel[rel.length - 1], path: e.path, size: e.size, mtime: e.mtime, sha256: e.sha256 });
  }
  const toJson = (nd) => ({
    name: nd.name,
    path: nd.path,
    dirs: [...nd.dirs.values()].sort((a, b) => a.name.localeCompare(b.name)).map(toJson),
    files: nd.files.sort((a, b) => a.name.localeCompare(b.name)),
  });
  return toJson(root);
}

/**
 * Sertifika envanteri: birden fazla host dokumunu birlestirir. Ayni sertifika = ayni
 * fingerprint (dosya yolu farkli olabilir). Sonuc: [{fingerprint, cn, issuer, notAfter,
 * daysLeft, san, hosts:[{host, path, uses:[{conf, serverName, keyState}]}], hostCount, useCount}]
 */
function aggregateCerts(dumps, now = Date.now()) {
  const byFp = new Map();
  for (const d of dumps) {
    // loaded: nginx -T'nin yukledigi dosyalar; eski dokumda yok (null) -> her kullanim "yuklu" sayilir (bilinmiyor)
    const loadedSet = Array.isArray(d.loaded) ? new Set(d.loaded) : null;
    const usesByCert = new Map();
    for (const u of Array.isArray(d.certUses) ? d.certUses : []) {
      if (!usesByCert.has(u.cert)) usesByCert.set(u.cert, []);
      usesByCert.get(u.cert).push({ conf: u.conf, serverName: u.serverName, key: u.key, keyState: u.keyState, loaded: loadedSet ? loadedSet.has(u.conf) : null });
    }
    for (const [p, c] of d.certs instanceof Map ? d.certs : new Map()) {
      const fp = c.exists && c.fingerprint ? c.fingerprint : `missing:${d.host}:${p}`;
      if (!byFp.has(fp)) {
        byFp.set(fp, {
          fingerprint: c.fingerprint || null,
          exists: c.exists,
          cn: c.cn,
          subject: c.subject,
          issuer: c.issuer,
          issuerCn: c.issuerCn,
          serial: c.serial,
          notBefore: c.notBefore,
          notAfter: c.notAfter,
          daysLeft: daysLeft(c.notAfter, now),
          sigalg: c.sigalg,
          keybits: c.keybits,
          san: c.san,
          chain: c.chain,
          chainSubjects: c.chainSubjects,
          selfSigned: c.selfSigned,
          hosts: [],
        });
      }
      const rec = byFp.get(fp);
      rec.hosts.push({ host: d.host, path: p, sha256: c.sha256, uses: usesByCert.get(p) || [] });
    }
  }
  const list = [...byFp.values()].map((r) => ({
    ...r,
    hosts: r.hosts.sort((a, b) => a.host.localeCompare(b.host)),
    hostCount: new Set(r.hosts.map((h) => h.host)).size,
    useCount: r.hosts.reduce((a, h) => a + h.uses.length, 0),
    // yalniz nginx'in YUKLEDIGI conf'lardaki kullanim (loaded bilinmiyorsa = useCount)
    loadedUseCount: r.hosts.reduce((a, h) => a + h.uses.filter((u) => u.loaded !== false).length, 0),
  }));
  // Once suresi en yakin dolacak olan
  list.sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9) || String(a.cn).localeCompare(String(b.cn)));
  return list;
}

/** Yedek/eski kopya kalibi: deployment yedegi <conf>_<job_no>, .bak/.old/.orig/~, .console_backup/ */
const BACKUP_RE = /(\/\.console_backup\/|_[0-9]{2,}$|\.(bak|old|orig|save|backup|disabled|off)(\.[0-9]+)?$|~$|\.rpm(new|save)$)/i;

/**
 * "Kullanilmayan" (2026-09-22): kullanici "sertifika hicbir konfigurasyonda kullanilmiyor ama
 * listede" dedi - cunku dokum conf.d/conf altindaki HER dosyayi alir, nginx'in yukledigine bakmaz.
 * Tek sunucu ozeti + nginx -T yuklenen listesinden: yuklenmeyen conf dosyalari (yedek kalibi ayri),
 * yalniz yuklenmeyen dosyada gecen sertifikalar, ssl/ altinda hic referanssiz dosyalar.
 * summary: { host, tree, certUses, certs[], loaded, sslFiles, nginxT }
 */
function orphansOf(summary, now = Date.now()) {
  const loaded = Array.isArray(summary.loaded) ? new Set(summary.loaded) : null;
  const known = !!loaded && (summary.nginxT?.status !== 'fail' || loaded.size > 0);
  const out = { host: summary.host, known, reason: known ? null : (Array.isArray(summary.loaded) ? 'nginx -T basarisiz (yuklenen liste alinamadi)' : 'eski dokum: yuklenen dosya listesi yok - "Yenile" ile yeni dokum alin'), unloaded: [], backups: [], certs: [], ssl: [] };
  if (!known) return out;
  const isKey = (p) => /(\.key$|private)/i.test(p);
  for (const f of summary.tree || []) {
    // Yalniz *.conf: yedek/eski kopyalar dokuma zaten girmiyor (2026-09-22), eski dokumlarda da
    // listelenmez - kullanici "cikti sisiyor" dedi. Yedek sayaci bilgi olarak kalir.
    if (loaded.has(f.path) || isKey(f.path) || !/\.conf$/i.test(String(f.path || ''))) continue;
    const rec = { path: f.path, size: f.size, mtime: f.mtime, owner: f.owner || null };
    (BACKUP_RE.test(f.path) ? out.backups : out.unloaded).push(rec);
  }
  // sertifika: her kullanimi yuklenmeyen dosyada (ya da hic kullanim yok)
  const usesByCert = new Map();
  for (const u of summary.certUses || []) { if (!usesByCert.has(u.cert)) usesByCert.set(u.cert, []); usesByCert.get(u.cert).push(u); }
  const referenced = new Set();
  for (const c of summary.certs || []) {
    const uses = usesByCert.get(c.path) || [];
    const loadedUses = uses.filter((u) => loaded.has(u.conf));
    for (const u of uses) { referenced.add(u.cert); if (u.key && u.key !== '?') referenced.add(u.key); }
    if (loadedUses.length > 0) continue;
    out.certs.push({ path: c.path, exists: c.exists, cn: c.cn, issuerCn: c.issuerCn, notAfter: c.notAfter, daysLeft: daysLeft(c.notAfter, now), usedBy: uses.map((u) => u.conf) });
  }
  for (const f of summary.sslFiles || []) {
    if (referenced.has(f.path)) continue;
    out.ssl.push({ path: f.path, size: f.size, mtime: f.mtime, isKey: isKey(f.path) });
  }
  return out;
}

module.exports = { parseDump, parseDumpFileSync, buildTree, aggregateCerts, daysLeft, cnOf, parseOpensslDate, orphansOf, BACKUP_RE };
