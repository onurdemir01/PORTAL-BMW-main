// server/nginx-console/dump-parse.cjs — nginx_console_dump.sh ciktisini ayristirir (SAF).
//
// Bolumler: @@HOST/@@TIME/@@PREFIX, @@NGINX_T ok|fail ... @@END, @@TREE ... @@END,
// @@FILE <yol> <sha> <size> ... @@END, @@CERTUSE conf\tserver_name\tcrt\tkey\tkeystate,
// @@CERT <yol> key=value... @@END. Sozlesme betigin basinda; degisirse ikisi birlikte.
'use strict';

function parseDump(text) {
  const out = {
    host: null,
    time: null,
    prefix: '/usr/nginx',
    nginxT: { status: 'unknown', output: '' },
    tree: [], // {path, size, mtime, sha256}
    files: new Map(), // path -> {sha256, size, content}
    certUses: [], // {conf, serverName, cert, key, keyState}
    certs: new Map(), // path -> {exists, ...fields}
  };
  const lines = String(text || '').split('\n');
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i].replace(/\r$/, '');
    if (line.startsWith('@@HOST ')) out.host = line.slice(7).trim();
    else if (line.startsWith('@@TIME ')) out.time = line.slice(7).trim();
    else if (line.startsWith('@@PREFIX ')) out.prefix = line.slice(9).trim() || '/usr/nginx';
    else if (line.startsWith('@@NGINX_T ')) {
      out.nginxT.status = line.slice(10).trim() === 'ok' ? 'ok' : 'fail';
      const buf = [];
      i++;
      while (i < n && lines[i].replace(/\r$/, '') !== '@@END') buf.push(lines[i]), i++;
      out.nginxT.output = buf.join('\n');
    } else if (line === '@@TREE') {
      i++;
      while (i < n && lines[i].replace(/\r$/, '') !== '@@END') {
        const f = lines[i].replace(/\r$/, '').split('\t');
        // 5 alan (2026-09-19, sahip eklendi) ya da eski 4 alan; yol her zaman SON alan
        if (f.length >= 5) out.tree.push({ size: Number(f[0]) || 0, mtime: f[1], sha256: f[2], owner: f[3] === '?' ? null : f[3], path: f.slice(4).join('\t') });
        else if (f.length === 4) out.tree.push({ size: Number(f[0]) || 0, mtime: f[1], sha256: f[2], owner: null, path: f[3] });
        i++;
      }
    } else if (line.startsWith('@@FILE ')) {
      // "@@FILE <yol> <sha> <size>" — yol bosluk icerebilir: sondan iki alan sabittir.
      const parts = line.slice(7).trim().split(' ');
      const size = Number(parts.pop()) || 0;
      const sha256 = parts.pop() || '';
      const p = parts.join(' ');
      const buf = [];
      i++;
      while (i < n && lines[i].replace(/\r$/, '') !== '@@END') buf.push(lines[i]), i++;
      out.files.set(p, { sha256, size, content: buf.join('\n') });
    } else if (line.startsWith('@@CERTUSE ')) {
      const f = line.slice(10).split('\t');
      out.certUses.push({ conf: f[0] || '', serverName: f[1] || '', cert: f[2] || '', key: f[3] || '', keyState: f[4] || '' });
    } else if (line.startsWith('@@CERT ')) {
      const p = line.slice(7).trim();
      const rec = { path: p, exists: false };
      i++;
      while (i < n && lines[i].replace(/\r$/, '') !== '@@END') {
        const l = lines[i].replace(/\r$/, '');
        const eq = l.indexOf('=');
        if (eq > 0) rec[l.slice(0, eq).trim()] = l.slice(eq + 1).trim();
        i++;
      }
      rec.exists = rec.exists === '1' || rec.exists === true;
      out.certs.set(p, normalizeCert(rec));
    }
    i++;
  }
  return out;
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
    const usesByCert = new Map();
    for (const u of d.certUses) {
      if (!usesByCert.has(u.cert)) usesByCert.set(u.cert, []);
      usesByCert.get(u.cert).push({ conf: u.conf, serverName: u.serverName, key: u.key, keyState: u.keyState });
    }
    for (const [p, c] of d.certs) {
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
  }));
  // Once suresi en yakin dolacak olan
  list.sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9) || String(a.cn).localeCompare(String(b.cn)));
  return list;
}

module.exports = { parseDump, buildTree, aggregateCerts, daysLeft, cnOf, parseOpensslDate };
