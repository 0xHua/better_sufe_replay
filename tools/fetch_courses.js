'use strict';
/**
 * fetch_courses.js —— 通过 CDP 连到你已登录的浏览器，调课程列表接口，
 * 把原始响应写进 app/data/courses.json。
 *
 *   node tools/fetch_courses.js
 *   node tools/fetch_courses.js --semester 秋季 --year 2026-2027 --size 60
 *   node tools/fetch_courses.js --out app/data/courses.json
 *
 * 前置：Edge 由 tools\start-edge-debug.cmd 启动，并且已经登录、打开过回放页。
 */

const fs = require('node:fs');
const path = require('node:path');
const { waitForBrowser, listPages, Session, redact } = require('./cdp');

const ROOT = path.resolve(__dirname, '..');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const YEAR = arg('year', '2026-2027');
const SEMESTER = arg('semester', '秋季');
const SIZE = arg('size', '60');
const OUT = path.resolve(ROOT, arg('out', path.join('app', 'data', 'courses.json')));

(async () => {
  await waitForBrowser({ timeoutMs: 15000 });
  const pages = await listPages();
  const page = pages.find((p) => /\/learn\/videoreview/.test(p.url)) ||
    pages.find((p) => /dm\.sufe\.edu\.cn/.test(p.url));
  if (!page) {
    console.error('[!] 没有找到 dm.sufe.edu.cn 的页面。先用 tools\\start-edge-debug.cmd 打开浏览器并登录。');
    process.exit(1);
  }
  console.log('[*] 目标页面：' + page.url);

  const sess = new Session(page.webSocketDebuggerUrl);
  await sess.connect();
  await sess.send('Runtime.enable');

  const qs = [
    'type=-1', 'courseName=', 'teacherName=', 'campus=', 'academicBuilding=', 'classroom=',
    'orderBy=join_time', 'isDesc=true', 'page=1', 'size=' + SIZE,
    'schoolYear=' + encodeURIComponent(YEAR), 'semester=' + encodeURIComponent(SEMESTER),
  ].join('&');

  const expr = `(async () => {
    const r = await fetch('/learn/v1/course/video/review/-1?${qs}', { credentials: 'include', cache: 'no-store' });
    return { status: r.status, text: await r.text() };
  })()`;

  const res = await sess.evaluate(expr, { awaitPromise: true, timeoutMs: 30000 });
  sess.close();

  const out = res && res.result && res.result.value;
  if (!out) {
    console.error('[!] 没拿到返回值：' + JSON.stringify(redact(res)).slice(0, 400));
    process.exit(1);
  }
  if (out.status !== 200) {
    console.error('[!] HTTP ' + out.status + '：' + String(out.text).slice(0, 300));
    process.exit(1);
  }

  let json;
  try {
    json = JSON.parse(out.text);
  } catch (e) {
    console.error('[!] 返回的不是 JSON：' + String(out.text).slice(0, 300));
    process.exit(1);
  }

  const total = json && json.data && json.data.total;
  const n = json && json.data && json.data.results ? json.data.results.length : 0;
  if (!n) {
    console.error('[!] 返回了 ' + n + ' 条课程（total=' + total + '）。多半是没登录 —— Cookie 没带上。');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  // 原样保存服务器返回的 JSON，不打散结构
  fs.writeFileSync(OUT, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log('[ok] total=' + total + '，写入 ' + n + ' 门课程 → ' + path.relative(ROOT, OUT));
  console.log('     文件大小 ' + fs.statSync(OUT).size + ' 字节');
})().catch((e) => {
  console.error('[!] ' + (e && e.message ? e.message : e));
  process.exit(1);
});
