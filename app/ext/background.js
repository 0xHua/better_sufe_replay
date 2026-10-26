'use strict';
/**
 * background.js —— 数据的中转站。
 *
 * 目标：在扩展页面（chrome-extension://…/index.html）刷新时，自动拿到课程列表。
 *
 * 取数策略（按顺序）：
 *   1. 直接 fetch：扩展有 host_permissions，多数情况下 Cookie 会带上；
 *   2. 直连拿不到（返回 200 但 total=0，说明 Cookie 没带上）→ 开一个后台标签页，
 *      让 content.js 在学校页面里做同源 fetch；用完立刻关掉；
 *   3. 两者都空 → 判定为「没登录」，返回 needLogin，由页面引导去登录。
 *
 * 同一份内容只记一次读取（按结果哈希去重），所以反复刷新不会让「第 N 次读取」虚增。
 */

const BASE = 'https://dm.sufe.edu.cn';
const STORE_KEY = 'sufe.bridge.v1';
const LIST_ENTRY = BASE + '/learn/videoreview';

/** 统一认证入口：打开它会 302 到 login.sufe.edu.cn 的登录页 */
function loginUrl() {
  return BASE + '/unifiedlogin/v1/loginmanage/login/direction?redirect_url=' +
    encodeURIComponent(LIST_ENTRY);
}

/* ---------------- 学期 ---------------- */

function termCandidates(year, semester) {
  if (year && semester) return [{ year: year, sem: semester }];

  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const autumnStart = m >= 8 ? y : y - 1; // 8 月起算秋季学期
  const autumnYear = autumnStart + '-' + (autumnStart + 1);

  if (m >= 8) {
    return [
      { year: autumnYear, sem: '秋季' },
      { year: autumnYear, sem: '春季' },
      { year: (autumnStart + 1) + '-' + (autumnStart + 2), sem: '秋季' },
    ];
  }
  if (m === 1) {
    return [
      { year: autumnYear, sem: '秋季' },
      { year: autumnYear, sem: '春季' },
    ];
  }
  return [
    { year: autumnYear, sem: '春季' },
    { year: autumnYear, sem: '秋季' },
  ];
}

function listPath(t) {
  const q = new URLSearchParams({
    type: '-1',
    courseName: '',
    teacherName: '',
    campus: '',
    academicBuilding: '',
    classroom: '',
    orderBy: 'join_time',
    isDesc: 'true',
    page: '1',
    size: '60',
    schoolYear: t.year,
    semester: t.sem,
  });
  return '/learn/v1/course/video/review/-1?' + q.toString();
}

/* ---------------- 取数 ---------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parse(text) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  const body = j && j.data ? j.data : j;
  const results = (body && body.results) || [];
  return {
    raw: j,
    total: (body && body.total) || 0,
    courses: results,
    hash: hashOf(results),
  };
}

function hashOf(results) {
  const s = JSON.stringify(results);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16) + ':' + s.length;
}

async function directFetch(path) {
  try {
    const r = await fetch(BASE + path, { credentials: 'include', cache: 'no-store' });
    return { ok: true, status: r.status, text: await r.text() };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

/** 开一个后台标签页，在里面做同源 fetch；全部尝试结束后关闭 */
async function withProxyTab(paths) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url: LIST_ENTRY, active: false });
  } catch (e) {
    return paths.map(() => ({ ok: false, error: 'cannot-open-tab: ' + e.message }));
  }

  const out = [];
  try {
    let ready = false;
    for (let i = 0; i < 14 && !ready; i++) {
      await sleep(350);
      try {
        // 先 ping 一下，content script 注入后才能收消息
        const pong = await chrome.tabs.sendMessage(tab.id, { type: 'SUFE_PING' });
        if (pong && pong.ok) ready = true;
      } catch {
        /* 还没注入，继续等 */
      }
    }
    if (!ready) {
      return paths.map(() => ({ ok: false, error: 'no-content-script（多半是没登录，页面被重定向到了统一认证）' }));
    }
    for (const p of paths) {
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { type: 'SUFE_FETCH', path: p });
        out.push(res || { ok: false, error: 'empty-response' });
      } catch (e) {
        out.push({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    }
    return out;
  } finally {
    if (tab && tab.id != null) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {
        /* 页面可能已经关了 */
      }
    }
  }
}

/* ---------------- 画面与直链 ---------------- */

const SEAT_ORDER = { '屏幕画面': 0, '教师画面': 1, '学生画面': 2 };

const mediaCache = new Map(); // courseId -> { at, data }

function sessionInfo(prefix, fallback) {
  const segs = String(prefix || '').split('_');
  const pick = (re) => segs.find((s) => re.test(s)) || '';
  const week = pick(/^第.+周$/);
  const day = pick(/^周[一二三四五六日]$/);
  const sec = pick(/^\d+-\d+节$/);
  const stamp = pick(/^\d{12}$/);
  return {
    label: [week, day, sec].filter(Boolean).join(' ') || fallback || prefix,
    date: stamp ? stamp.slice(0, 4) + '-' + stamp.slice(4, 6) + '-' + stamp.slice(6, 8) : '',
    time: stamp ? stamp.slice(8, 10) + ':' + stamp.slice(10, 12) : '',
    stamp: stamp || '',
  };
}

async function getMedia(opts) {
  const ck = String(opts.courseId || '') + '|' + String(opts.id || '');
  const hit = mediaCache.get(ck);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;

  const q = new URLSearchParams({
    courseId: opts.courseId || '',
    id: String(opts.id || ''),
    schoolYear: opts.schoolYear || '',
    semester: opts.semester || '',
  });

  const r = await directFetch('/learn/v1/course/recording/video/info?' + q);
  if (!r.ok) return { ok: false, error: r.error };

  let j;
  try {
    j = JSON.parse(r.text);
  } catch {
    return { ok: false, error: 'info 不是 JSON（可能没登录）', status: r.status };
  }
  if (r.status === 401 || (j && j.status === 401)) {
    return { ok: false, needLogin: true, message: '还没登录学校账号' };
  }

  const shows = (j.data && j.data.recordingVideoInfoShows) || [];
  const byPrefix = new Map();

  shows.forEach((show) => {
    (show.recordInfoDetailList || []).forEach((det) => {
      (det.videoInfoList || []).forEach((v) => {
        const parts = String(v.videoName || '').split('_');
        const seat = parts.length > 1 ? parts[parts.length - 1] : '';
        const prefix = parts.slice(0, -1).join('_') || 'session';
        if (!byPrefix.has(prefix)) {
          byPrefix.set(prefix, Object.assign({ key: prefix, videos: [] }, sessionInfo(prefix, det.sectionName)));
        }
        byPrefix.get(prefix).videos.push({ videoId: v.videoId, seat: seat });
      });
    });
  });

  const sessions = Array.from(byPrefix.values());
  if (!sessions.length) return { ok: true, sessions: [], count: 0 };

  const ids = [];
  sessions.forEach((s) => s.videos.forEach((v) => { if (v.videoId && ids.indexOf(v.videoId) < 0) ids.push(v.videoId); }));

  let files = [];
  let fileInfoBytes = 0;
  let fileInfoStatus = 0;
  if (ids.length) {
    try {
      const fr = await fetch(BASE + '/rman/v1/entity/download/fileinfo', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids),
      });
      const ft = await fr.text();
      fileInfoBytes = ft.length;
      fileInfoStatus = fr.status;
      const fj = JSON.parse(ft);
      files = (fj && fj.data) || [];
    } catch {
      return { ok: false, needLogin: true, message: '换直链失败（多半是登录态过期）' };
    }
  }

  const byId = new Map();
  files.forEach((d, i) => {
    if (d.contentId) byId.set(d.contentId, d);
    if (ids[i]) byId.set(ids[i], d);
  });

  const out = sessions.map((s) => {
    const media = s.videos
      .map((v) => {
        const f = byId.get(v.videoId);
        if (!f) return null;
        const addr = (f.downloadAddress || [])[0] || '';
        const size = ((f.fileGroups || [])[0] || {}).files;
        return {
          seat: v.seat || f.seat || '',
          cid: f.contentId || v.videoId || '',
          url: addr ? BASE + addr : '',
          size: (size && size[0] && size[0].fileSize) || '',
        };
      })
      .filter((x) => x && x.url)
      .sort((a, b) => (SEAT_ORDER[a.seat] ?? 9) - (SEAT_ORDER[b.seat] ?? 9));

    return { key: s.key, label: s.label, date: s.date, time: s.time, stamp: s.stamp, media: media };
  }).filter((s) => s.media.length);

  out.sort((a, b) => (a.stamp || '').localeCompare(b.stamp || ''));

  const data = {
    ok: true,
    sessions: out,
    count: out.length,
    // 只记来源信息（接口、状态、字节数、contentId），不存任何画面地址正文以外的东西
    meta: {
      endpoints: [
        { path: '/learn/v1/course/recording/video/info', method: 'GET', status: r.status, bytes: r.text.length },
        { path: '/rman/v1/entity/download/fileinfo', method: 'POST', status: fileInfoStatus, bytes: fileInfoBytes },
      ],
      contentIds: ids.slice(0, 40),
      at: new Date().toISOString(),
    },
  };
  mediaCache.set(ck, { at: Date.now(), data: data });
  return data;
}

/* ---------------- 存储 ---------------- */

async function readStore() {
  try {
    const o = await chrome.storage.local.get(STORE_KEY);
    return o[STORE_KEY] || null;
  } catch {
    return null;
  }
}

async function writeStore(v) {
  try {
    await chrome.storage.local.set({ [STORE_KEY]: v });
  } catch {
    /* 忽略 */
  }
}

/* ---------------- 主流程 ---------------- */

let inflight = null;

async function getCourses(opts) {
  const terms = termCandidates(opts.year, opts.semester);
  const prev = await readStore();
  const trail = [];
  const allowProxy = opts.allowProxy !== false;

  // 1) 直连
  for (const t of terms) {
    const r = await directFetch(listPath(t));
    if (!r.ok) {
      trail.push({ term: t, step: 'direct', error: r.error });
      continue;
    }
    const p = parse(r.text);
    if (p && p.courses.length) return finish(p, t, 'direct', prev, trail, r.text.length, r.status);
    trail.push({ term: t, step: 'direct', total: p ? p.total : -1 });
  }

  // 2) 借学校页面同源请求 —— 只在明确允许时做，避免没登录时反复开标签页
  if (allowProxy) {
    const paths = terms.map(listPath);
    const results = await withProxyTab(paths);
    for (let i = 0; i < terms.length; i++) {
      const r = results[i];
      if (!r || !r.ok) {
        trail.push({ term: terms[i], step: 'tab', error: (r && r.error) || 'unknown' });
        continue;
      }
      const p = parse(r.text);
      if (p && p.courses.length) return finish(p, terms[i], 'tab', prev, trail, r.text.length, r.status);
      trail.push({ term: terms[i], step: 'tab', total: p ? p.total : -1 });
    }
  }

  return {
    ok: false,
    needLogin: true,
    loginUrl: loginUrl(),
    trail: trail,
    message: '没有读到课程数据。' + (allowProxy
      ? (trail.some((x) => /no-content-script/.test(x.error || ''))
        ? '看起来还没有登录学校账号。'
        : '')
      : '多半是还没有登录学校账号。'),
  };
}

function finish(p, term, via, prev, trail, bytes, status) {
  const same = prev && prev.hash === p.hash;
  return {
    ok: true,
    raw: p.raw,
    hash: p.hash,
    count: p.courses.length,
    total: p.total,
    term: term,
    via: via,
    at: same ? prev.fetchedAt : new Date().toISOString(),
    changed: !same,
    trail: trail,
    // 只记来源：接口、方式、状态、字节数、条数、内容 sha；不含任何正文
    meta: {
      endpoints: [{ path: listPath(term), method: 'GET', status: status || 200, bytes: bytes || 0 }],
      sha: p.hash,
      count: p.courses.length,
    },
  };
}

async function getCoursesCached(opts) {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await getCourses(opts);
      if (res.ok) {
        await writeStore({
          hash: res.hash,
          fetchedAt: res.at,
          term: res.term,
          via: res.via,
          savedAt: new Date().toISOString(),
          count: res.count,
        });
      }
      return res;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/* ---------------- 课程富数据（只读，内存缓存，不落盘） ---------------- */

const RICH_TTL = 30 * 60 * 1000;
const richCache = new Map();

const RICH_PATH = {
  // 章节 / 知识点大纲
  summary: (o) => '/rman/v1/intelligent/select/knowledge/summary?contentId=' + encodeURIComponent(o.id || ''),
  // 本节概要正文 + 关键词
  keyword: (o) => '/learn/v1/homepage/course/keywordAndAbstract?videoId=' + encodeURIComponent(o.vid || o.id || ''),
  // PPT 帧
  shots: (o) => '/rman/v1/entity/file/screenshot?page=1&size=100&contentId=' + encodeURIComponent(o.id || ''),
  // 字幕（vtt 原文）
  vtt: (o) => '/rman/v1/search/webvtt?contentId=' + encodeURIComponent(o.id || '') + '&voice=true&isSysAuth=true&lang=source',
};

async function getRich(msg) {
  const kind = msg.kind;
  const make = RICH_PATH[kind];
  if (!make) return { ok: false, error: '未知类型：' + kind };
  const id = msg.id || '';
  if (!id) return { ok: false, error: '缺少 contentId' };

  const ck = kind + '|' + id + '|' + (msg.vid || '');
  const hit = richCache.get(ck);
  if (hit && Date.now() - hit.at < RICH_TTL) {
    return Object.assign({}, hit.data, { cached: true, age: Date.now() - hit.at });
  }

  const path = make(msg);
  let text = '';
  let status = 0;
  try {
    const r = await fetch(BASE + path, { credentials: 'include', cache: 'no-store' });
    status = r.status;
    text = await r.text();
  } catch (e) {
    return { ok: false, error: '取不到：' + String(e && e.message ? e.message : e) };
  }

  if (!status || status >= 400) {
    return { ok: false, status: status, error: 'HTTP ' + status, sample: text.slice(0, 200) };
  }

  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }

  const out = {
    ok: true, kind: kind, id: id, status: status, bytes: text.length,
    data: data, at: new Date().toISOString(),
  };
  // 字幕接口返回的是 vtt 原文，解析不了就当文本留着
  if (kind === 'vtt') out.text = text;

  richCache.set(ck, { at: Date.now(), data: out });
  return out;
}

/* ---------------- 消息 ---------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === 'SUFE_PING') {
    sendResponse({ ok: true, from: 'content' });
    return;
  }

  if (msg.type === 'GET_RICH') {
    getRich(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true;
  }

  if (msg.type === 'DOWNLOAD') {
    const url = msg.url || '';
    if (!url) { sendResponse({ ok: false, error: '没有地址' }); return; }
    chrome.downloads
      .download({ url: url, filename: msg.name || undefined, conflictAction: 'uniquify', saveAs: false })
      .then((id) => sendResponse({ ok: true, id: id }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true;
  }

  if (msg.type === 'GET_COURSES') {
    getCoursesCached(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true;
  }

  if (msg.type === 'GET_MEDIA') {
    getMedia(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true;
  }

  if (msg.type === 'OPEN_LOGIN') {
    chrome.tabs.create({ url: msg.url || loginUrl() }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'OPEN_APP') {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') }).then(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});

// 首次安装时直接把界面打开，省得用户找
chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  }
});
