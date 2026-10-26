'use strict';
/**
 * capture_report.js —— 把 cdp_capture.js 录到的 JSONL 整理成人能看的东西
 *
 *   node tools/capture_report.js                      # 列出所有抓到的响应体
 *   node tools/capture_report.js --dump video/info    # 把匹配的响应体导出为 JSON
 *   node tools/capture_report.js --dump all --out probe/extract
 */

const fs = require('node:fs');
const path = require('node:path');

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};
const has = (n) => argv.includes(`--${n}`);

const CAP = path.resolve(arg('dir', path.join(__dirname, '..', 'probe', 'capture')));
const OUT = path.resolve(arg('out', path.join(__dirname, '..', 'probe', 'extract')));
const DUMP = arg('dump', null);
const SKIP = /notify\/unread|notify\/self|message\/notify|UserStatistic|browse\/record|app\/module\/parameter/i;

function load() {
  if (!fs.existsSync(CAP)) {
    console.error(`没有采集目录：${CAP}`);
    process.exit(1);
  }
  const files = fs.readdirSync(CAP).filter((f) => f.endsWith('.jsonl'));
  const bodies = new Map();
  for (const f of files) {
    const lines = fs.readFileSync(path.join(CAP, f), 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (rec.t !== 'body') continue;
      const url = rec.url || rec.url2 || '';
      if (SKIP.test(url)) continue;
      const key = `${rec.status}|${url}`;
      const prev = bodies.get(key);
      if (!prev || (prev.len || 0) < (rec.len || 0)) bodies.set(key, rec);
    }
  }
  return { files, bodies };
}

const { files, bodies } = load();

if (!DUMP) {
  console.log(`采集文件 ${files.length} 个，响应体 ${bodies.size} 条\n`);
  const rows = [...bodies.values()].sort((a, b) => (b.len || 0) - (a.len || 0));
  for (const r of rows) {
    const u = (r.url || '').replace(/^https?:\/\/[^/]+/, '');
    console.log(`${String(r.status).padStart(3)}  ${String(r.len).padStart(7)}B  ${u.slice(0, 150)}`);
  }
  console.log('\n用 --dump <URL 片段> 导出具体内容。');
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
const needle = DUMP === 'all' ? '' : DUMP;
let n = 0;
for (const r of bodies.values()) {
  const url = r.url || '';
  if (needle && !url.includes(needle)) continue;
  n += 1;
  const slug = url
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/[?&=]/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(0, 90);
  let content = r.body || '';
  let ext = 'txt';
  try {
    content = JSON.stringify(JSON.parse(content), null, 2);
    ext = 'json';
  } catch {
    /* keep raw */
  }
  const file = path.join(OUT, `${String(n).padStart(2, '0')}-${slug}.${ext}`);
  fs.writeFileSync(file, content, 'utf8');
  console.log(`${file}  (${r.status}, ${r.len}B)`);
}
console.log(`\n共导出 ${n} 个文件到 ${OUT}`);
