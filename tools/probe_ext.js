'use strict';
/**
 * probe_ext.js —— 直接连到扩展的 service worker，验证「扩展直连学校接口能否带上 Cookie」。
 */
const http = require('node:http');

const get = (u) => new Promise((res, rej) => {
  http.get(u, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
});

const Q = new URLSearchParams({
  type: '-1', courseName: '', teacherName: '', campus: '', academicBuilding: '', classroom: '',
  orderBy: 'join_time', isDesc: 'true', page: '1', size: '60',
  schoolYear: '2026-2027', semester: '秋季',
}).toString();

const EXPR = `(async () => {
  const u = 'https://dm.sufe.edu.cn/learn/v1/course/video/review/-1?${Q}';
  try {
    const r = await fetch(u, { credentials: 'include', cache: 'no-store' });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch (e) {}
    return { status: r.status, total: j && j.data && j.data.total, n: (j && j.data && j.data.results || []).length, head: t.slice(0, 120) };
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) };
  }
})()`;

(async () => {
  const list = await get('http://127.0.0.1:9222/json/list');
  const sw = list.find((p) => p.type === 'service_worker' && /chrome-extension:/.test(p.url));
  if (!sw) {
    console.error('[!] 没找到扩展的 service worker，扩展可能没加载或已休眠');
    process.exit(1);
  }
  console.log('[*] service worker: ' + sw.url);

  const ws = new WebSocket(sw.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));

  let id = 1;
  const send = (method, params) => new Promise((res) => {
    const mid = id++;
    const h = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === mid) { ws.removeEventListener('message', h); res(m); }
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await send('Runtime.enable', {});
  const r = await send('Runtime.evaluate', { expression: EXPR, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result && r.result.value ? r.result.value : r, null, 2));
  ws.close();
})().catch((e) => { console.error('[!] ' + e.message); process.exit(1); });
