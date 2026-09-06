// server/filex/filex-parse.cjs — filex_list_files.yml'in HAM metin ciktisini (meta_raw +
// sha_raw) yapilandirilmis dosya listesine cevirir.
//
// NEDEN PORTALDA: playbook v1'de her dosya icin ayri bir `ansible.builtin.stat` cagrisi
// yapiyordu (dosya basina SSH round-trip) — kalabalik .ear dizinlerinde kullanilamayacak
// kadar yavasti. v2, host basina TEK `find -printf` + TEK `find -exec sha512sum {} +`
// calistirir ve ham metni oldugu gibi artifact'e koyar; ayristirma burada, portalda yapilir.
// Bu, LogX'in OCP obje kesfinde (server/logx/v2/ocp-app-parse.cjs) zaten kullanilan AYNI
// desendir — buyuk fan-out'ta Ansible/Jinja tarafinda JSON uretmek pahalidir.
'use strict';

// GNU find `-printf '%m|%u|%g|%s|%T@|%p\n'` ciktisi: mod|sahip|grup|boyut|mtime|yol.
// Yol SON alan ve icinde '|' gecebilir (nadir ama mumkun) — bu yuzden ilk 5 '|' ile
// bolunur, kalan her sey yol olarak alinir.
function parseMetaLine(line) {
  const parts = line.split('|');
  if (parts.length < 6) return null;
  const [mode, owner, group, sizeStr, mtimeStr] = parts;
  const path = parts.slice(5).join('|');
  const size = Number(sizeStr);
  const mtime = Number(mtimeStr);
  if (!path || !Number.isFinite(size) || !Number.isFinite(mtime)) return null;
  return {
    path,
    // GNU find'in %m'i onde sifir olmadan doner (or. "644") — stat modulunun "0644" tarzi
    // ciktisiyla gorsel tutarlilik icin 4 haneye tamamlanir.
    mode: mode.length < 4 ? mode.padStart(4, '0') : mode,
    owner,
    group,
    size,
    mtime,
  };
}

// sha512sum ciktisi: "<128-hex-hash> <mod-karakteri><yol>" — mod karakteri metin modunda
// bosluk, ikili modda '*'. Toplamda hash ile yol arasinda IKI karakter (bosluk + mod) var.
const SHA_LINE = /^([0-9a-f]{128}) [ *](.+)$/;

function parseShaLine(line) {
  const m = SHA_LINE.exec(line);
  if (!m) return null;
  return { path: m[2], sha512: m[1] };
}

// Bir host'un meta_raw + sha_raw ciktisini birlestirip nihai dosya listesini uretir.
// meta_raw KAYNAK listedir (tam ozellik seti); sha_raw'da eslesmeyen (checksum basarisiz
// olmus tek bir dosya gibi) satirlar icin sha512 bos string doner — TUM host'u dusurmez.
function parseHostFiles(metaRaw, shaRaw) {
  const shaByPath = new Map();
  for (const line of String(shaRaw || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = parseShaLine(trimmed);
    if (parsed) shaByPath.set(parsed.path, parsed.sha512);
  }

  const files = [];
  for (const line of String(metaRaw || '').split('\n')) {
    if (!line.trim()) continue;
    const meta = parseMetaLine(line);
    if (!meta) continue;
    files.push({ ...meta, sha512: shaByPath.get(meta.path) || '' });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

// filex_result.hosts[] icindeki her host icin meta_raw/sha_raw'i files[]'e cevirir —
// server/filex/index.cjs bunu, artifact'i frontend'e gondermeden hemen once cagirir.
function parseFilexResult(rawResult) {
  if (!rawResult || !Array.isArray(rawResult.hosts)) return rawResult;
  return {
    ...rawResult,
    hosts: rawResult.hosts.map((h) => ({
      host: h.host,
      status: h.status,
      error: h.error || '',
      ear_dirs: h.ear_dirs || [],
      files: h.status === 'ok' ? parseHostFiles(h.meta_raw, h.sha_raw) : [],
    })),
  };
}

module.exports = { parseMetaLine, parseShaLine, parseHostFiles, parseFilexResult };
