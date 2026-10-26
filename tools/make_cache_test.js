'use strict';
/**
 * make_cache_test.js —— 造两份「假快照」页面，用来验证本地缓存的合并逻辑。
 *
 * 真实数据在十几分钟内不会变化，所以真实回放页演示不出「变化 / 历史留存」。
 * 这里把数据通过 window.__SEED__ 注入测试副本，人为制造差异，
 * 并且用 ?store=test 让缓存写到独立的 localStorage 分区，不污染真实缓存。
 *
 *   node tools/make_cache_test.js
 *   → probe/test/cache-a.html   （第一次读取）
 *   → probe/test/cache-b.html   （第二次读取：4041 回放 +5、4520 消失、3644 教室变了）
 *
 * 打开方式（注意 ?store=test）：
 *   file:///E:/dsh_Workspace/web_replay_sufe/probe/test/cache-a.html?store=test
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const DATA = path.join(ROOT, 'app', 'data', 'courses.json');
const OUT = path.join(ROOT, 'probe', 'test');

const KEEP = [
  'id', 'courseId', 'courseName', 'courseNumber', 'teacherNames', 'collegeNames',
  'campus', 'jxlShowName', 'classroomNumber', 'courseTimeData', 'playbackCount',
  'showSemester', 'schoolYear', 'semester', 'hasVideo', 'collect', 'siteCode',
];

function payload(fetchedAt, mutate) {
  const raw = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const body = raw.data || raw;
  let courses = (body.results || []).map((c) => {
    const o = {};
    KEEP.forEach((k) => { if (c[k] !== undefined) o[k] = c[k]; });
    return o;
  });
  if (mutate) courses = mutate(courses) || courses;
  return { fetchedAt, courses, source: 'test-seed' };
}

function page(snap) {
  const html = fs.readFileSync(SRC, 'utf8');
  const tag = '<script>window.__SEED__=' +
    JSON.stringify(snap).replace(/</g, '\\u003c') + ';<\/script>';
  // 插在页面自己的脚本之前，保证 boot 时就能读到
  const at = html.lastIndexOf('<script>');
  if (at < 0) throw new Error('app/index.html 里找不到 <script>');
  return html.slice(0, at) + tag + '\n' + html.slice(at);
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const a = payload('2026-10-26T02:49:00.000Z');
  const b = payload('2026-10-26T03:00:00.000Z', (courses) => {
    const kept = courses.filter((c) => String(c.id) !== '4520');
    kept.forEach((c) => {
      if (String(c.id) === '4041') c.playbackCount = Number(c.playbackCount) + 5;
      if (String(c.id) === '3644') c.classroomNumber = '三教502 换教室了';
    });
    return kept;
  });

  fs.writeFileSync(path.join(OUT, 'cache-a.html'), page(a), 'utf8');
  fs.writeFileSync(path.join(OUT, 'cache-b.html'), page(b), 'utf8');
  console.log('[ok] probe/test/cache-a.html 与 cache-b.html 已生成（数据经 __SEED__ 注入，用 ?store=test 隔离）');
}

main();
