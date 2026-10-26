'use strict';
/**
 * probe_media.js —— 摸清「课时 → 画面 → 直链」这条链路的真实字段。
 * 在扩展的 service worker 里跑，不打扰用户正在看的标签页。
 */
const http = require('node:http');

const get = (u) => new Promise((res, rej) => {
  http.get(u, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
});

const COURSE = {
  courseId: 'a958f29815aa40b3806c2be5fda5a79c',
  id: 3644,
  schoolYear: '2026-2027',
  semester: '秋季',
};

const EXPR = `(async () => {
  const B = 'https://dm.sufe.edu.cn';
  const q = new URLSearchParams({
    courseId: ${JSON.stringify(COURSE.courseId)},
    id: '${COURSE.id}',
    schoolYear: ${JSON.stringify(COURSE.schoolYear)},
    semester: ${JSON.stringify(COURSE.semester)},
  });
  const infoRes = await fetch(B + '/learn/v1/course/recording/video/info?' + q, { credentials: 'include' });
  const info = await infoRes.json();
  const out = { infoStatus: infoRes.status, dataKeys: Object.keys(info.data || {}) };

  const shows = (info.data && info.data.recordingVideoInfoShows) || [];
  out.shows = shows.length;
  const first = shows[0] || {};
  out.showKeys = Object.keys(first);
  out.showSample = { id: first.id, title: first.title, week: first.week };

  const details = first.recordInfoDetailList || [];
  out.details = details.length;
  out.detailKeys = Object.keys(details[0] || {});
  out.detailSample = details[0] ? {
    id: details[0].id, sectionName: details[0].sectionName, classroomNumber: details[0].classroomNumber,
    startTime: details[0].startTime, endTime: details[0].endTime, weekDay: details[0].weekDay,
  } : null;

  const vids = (details[0] && details[0].videoInfoList) || [];
  out.videos = vids.length;
  out.videoSample = vids.map(v => {
    const o = {};
    for (const k of Object.keys(v)) {
      const val = v[k];
      o[k] = (typeof val === 'string' && val.length > 60) ? val.slice(0, 60) + '…' : val;
    }
    return o;
  });

  // 试着把 id 当 contentId 去查直链
  const ids = vids.map(v => v.videoId || v.contentId || v.id).filter(Boolean);
  out.tryIds = ids;
  if (ids.length) {
    const fr = await fetch(B + '/rman/v1/entity/download/fileinfo', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ids),
    });
    const fj = await fr.json();
    out.fileStatus = fr.status;
    const arr = fj.data || [];
    out.fileCount = arr.length;
    out.fileSample = arr.slice(0, 3).map(d => ({
      keys: Object.keys(d),
      id: d.id, name: d.name, seat: d.seat,
      downloadAddress: d.downloadAddress,
      sizes: (d.fileGroups || []).map(g => (g.files || []).map(f => f.fileSize)),
    }));
  }
  return out;
})()`;

(async () => {
  const list = await get('http://127.0.0.1:9222/json/list');
  const sw = list.find((p) => p.type === 'service_worker' && /chrome-extension:/.test(p.url));
  if (!sw) { console.error('[!] 没有 service worker'); process.exit(1); }

  const ws = new WebSocket(sw.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 1;
  const send = (method, params) => new Promise((res) => {
    const mid = id++;
    const h = (e) => { const m = JSON.parse(e.data); if (m.id === mid) { ws.removeEventListener('message', h); res(m); } };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await send('Runtime.enable', {});
  const r = await send('Runtime.evaluate', { expression: EXPR, awaitPromise: true, returnByValue: true });
  const val = r.result && r.result.value;
  console.log(JSON.stringify(val || r, null, 2));
  ws.close();
})().catch((e) => { console.error('[!] ' + e.message); process.exit(1); });
