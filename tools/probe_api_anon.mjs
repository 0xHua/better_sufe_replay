// 匿名可达性 + CORS 探测：不带任何 Cookie 请求关键接口
const BASE = 'https://dm.sufe.edu.cn';
const WEEK = { courseId: 'a958f29815aa40b3806c2be5fda5a79c', id: 3644, schoolYear: '2026-2027', semester: '秋季' };

const q = (o) => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');

const targets = [
  { name: '① 课程列表', method: 'GET', path: '/learn/v1/course/video/review/-1?' + q({
      type: -1, courseName: '', teacherName: '', campus: '', academicBuilding: '', classroom: '',
      orderBy: 'join_time', isDesc: 'true', page: 1, size: 12, schoolYear: WEEK.schoolYear, semester: WEEK.semester }) },
  { name: '② 课时结构', method: 'GET', path: '/learn/v1/course/recording/video/info?' + q({
      courseId: WEEK.courseId, id: WEEK.id, schoolYear: WEEK.schoolYear, semester: WEEK.semester }) },
  { name: '③ 直链', method: 'POST', path: '/rman/v1/entity/download/fileinfo',
    body: JSON.stringify(['86c7b4cb76924b409e1b96c23dce8434']) },
  { name: '④ 字幕', method: 'GET', path: '/rman/v1/search/webvtt?' + q({
      contentId: '86c7b4cb76924b409e1b96c23dce8434', voice: 'true', isSysAuth: 'true', lang: 'source' }) },
  { name: '⑤ PPT帧', method: 'GET', path: '/rman/v1/entity/file/screenshot?' + q({
      page: 1, size: 5, contentId: '951c1a6f167d468ca565cd76c4289b1f' }) },
  { name: '⑥ 知识点', method: 'POST', path: '/learn/online/classroom/knowledge/point/list',
    body: JSON.stringify({ courseId: WEEK.courseId }) },
  { name: '⑦ 水印配置', method: 'GET', path: '/unifiedplatform/v1/setting/watermark' },
  { name: '⑧ 观看时长', method: 'GET', path: '/learn/online/classroom/watch/duration?' + q({
      courseId: WEEK.courseId, sectionId: '7:Monday:3-5' }) },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0';
const ORIGIN = 'https://local.test';

function pick(h, k) { return h.get(k) || '-'; }

const rows = [];
for (const t of targets) {
  const opt = { method: t.method, headers: { 'User-Agent': UA, Origin: ORIGIN, Accept: 'application/json, text/plain, */*' }, redirect: 'manual' };
  if (t.body) { opt.headers['Content-Type'] = 'application/json'; opt.body = t.body; }
  let status = 'ERR', ct = '-', acao = '-', acac = '-', len = 0, snippet = '';
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + t.path, opt);
    status = r.status;
    ct = pick(r.headers, 'content-type');
    acao = pick(r.headers, 'access-control-allow-origin');
    acac = pick(r.headers, 'access-control-allow-credentials');
    const buf = Buffer.from(await r.arrayBuffer());
    len = buf.length;
    let text = buf.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    snippet = text.replace(/\s+/g, ' ').slice(0, 160);
  } catch (e) {
    snippet = 'FETCH_ERROR: ' + e.message;
  }
  rows.push({ name: t.name, method: t.method, status, ms: Date.now() - t0, ct, acao, acac, len, snippet });
  console.log(`\n=== ${t.name}  ${t.method} ${t.path.slice(0, 90)}`);
  console.log(`    status=${status}  ${rows[rows.length - 1].ms}ms  len=${len}  ct=${ct}`);
  console.log(`    ACAO=${acao}   ACAC=${acac}`);
  console.log(`    body: ${snippet}`);
}

// 预检
console.log('\n=== ⑨ OPTIONS 预检（模拟本地页面发起 POST）');
try {
  const r = await fetch(BASE + '/rman/v1/entity/download/fileinfo', {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
      'User-Agent': UA,
    },
  });
  console.log(`    status=${r.status} ACAO=${pick(r.headers, 'access-control-allow-origin')} ` +
    `ACAM=${pick(r.headers, 'access-control-allow-methods')} ACAH=${pick(r.headers, 'access-control-allow-headers')} ` +
    `ACAC=${pick(r.headers, 'access-control-allow-credentials')}`);
} catch (e) {
  console.log('    ERROR ' + e.message);
}
