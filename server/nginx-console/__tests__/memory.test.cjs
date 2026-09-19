// server/nginx-console/__tests__/memory.test.cjs — URETIM OOM'U (2026-09-20):
// "FATAL ERROR: Reached heap limit ... Runtime_StringSplit". Ilk surum 311 host'un TAM
// ayristirilmis dokumunu (icerikler dahil) bellekte tutuyor, /hosts + /certs + gecmis
// taramasi hepsini birden yukluyordu. Bu test 120 sentetik host x ~2 MB dokumla /hosts
// benzeri "hepsini ozetle" akisini kosturur ve heap artisinin SINIRLI kalmasini ister.
// Eski davranisla (tam dokum onbellegi) bu test ~240 MB+ artis gosterirdi; ozet katmaniyla
// artis onlarca MB'yi gecmez.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('MEM1 120 host x ~2 MB dokum: ozet katmani heap\'i sinirli tutar, icerik yalniz LRU\'da', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-mem-'));
  process.env.NGINX_CONSOLE_DIR = dir;
  fs.mkdirSync(path.join(dir, 'raw'), { recursive: true });
  // ~2 MB dokum: 400 dosya x ~5 KB icerik
  const body = 'server {\n' + '  location /x { proxy_pass http://upstream; }\n'.repeat(110) + '}\n';
  const files = [];
  for (let i = 0; i < 400; i++) {
    const p = `/usr/nginx/conf.d/application-confs/app-${i}.conf`;
    files.push(`@@FILE ${p} ${String(i).padStart(64, '0')} ${body.length}\n${body}@@END`);
  }
  const tree = files.map((_, i) => `${body.length}\t2026-09-20 00:00:00\t${String(i).padStart(64, '0')}\twww\t/usr/nginx/conf.d/application-confs/app-${i}.conf`).join('\n');
  const dumpText = `@@HOST HOSTX\n@@TIME 2026-09-20T00:00:00Z\n@@PREFIX /usr/nginx\n@@NGINX_T ok\nok\n@@END\n@@TREE\n${tree}\n@@END\n${files.join('\n')}\n`;
  const HOSTS = 120;
  for (let h = 0; h < HOSTS; h++) fs.writeFileSync(path.join(dir, 'raw', `GBNGX${String(h).padStart(3, '0')}.txt`), dumpText.replace('HOSTX', `GBNGX${String(h).padStart(3, '0')}`));
  assert.ok(dumpText.length > 1_500_000, `dokum yeterince buyuk olmali: ${dumpText.length}`);

  // gecmis ingest DB ister; testte devre disi (ingestDump null doner)
  const history = require('../history.cjs');
  history.ingestDump = async () => null;
  const idx = require('../index.cjs');

  if (global.gc) global.gc();
  const before = process.memoryUsage().heapUsed;
  const hosts = fs.readdirSync(path.join(dir, 'raw')).filter((f) => f.endsWith('.txt')).map((f) => f.slice(0, -4));
  for (const h of hosts) {
    const sm = idx._loadSummaryForTest(h);
    assert.equal(sm.fileCount, 400);
    assert.equal(sm.certs.length, 0);
    assert.ok(!('files' in sm), 'ozet icerik tasimamali');
  }
  // yan dosyalar yazildi mi
  assert.ok(fs.existsSync(path.join(dir, 'raw', 'GBNGX000.summary.json')));
  // tam icerik: LRU en fazla 4
  for (let h = 0; h < 10; h++) {
    const full = idx._loadFullForTest(`GBNGX${String(h).padStart(3, '0')}`);
    assert.equal(full.files.size, 400);
  }
  if (global.gc) global.gc();
  const after = process.memoryUsage().heapUsed;
  const growthMb = (after - before) / 1048576;
  // 120 host x 2 MB = 240 MB ham; eski davranis en az bu kadar tutardi. Ozet+LRU(4) ile < 80 MB.
  console.log(`[MEM1] heap artisi ${growthMb.toFixed(1)} MB`);
  assert.ok(growthMb < 80, `heap artisi ${growthMb.toFixed(1)} MB — tam dokumlar bellekte tutuluyor olabilir`);
  fs.rmSync(dir, { recursive: true, force: true });
});
