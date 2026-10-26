(function () {
  'use strict';

  /* ============================================================
     数据不是写死在页面里的。
     启动顺序：localStorage 里上次的 payload → 立刻渲染
               → 再 fetch data/courses.json（更新则替换并记一次读取）
               → 都没有就显示空状态，让用户起服务或手动导入。
     ============================================================ */

  var SUFFIX = (function () {
    try {
      var s = new URLSearchParams(location.search).get('store');
      return s ? '.' + s.replace(/[^a-z0-9_-]/gi, '') : '';
    } catch (e) { return ''; }
  })();
  var PAYLOAD_KEY = 'sufe.replay.payload.v1' + SUFFIX;
  var DATA_URL = 'data/courses.json';
  var KEEP = [
    'id', 'courseId', 'courseName', 'courseNumber', 'teacherNames', 'collegeNames',
    'campus', 'jxlShowName', 'classroomNumber', 'courseTimeData', 'playbackCount',
    'showSemester', 'schoolYear', 'semester', 'hasVideo', 'collect', 'siteCode'
  ];

  var SNAP = null;
  var COURSES = [];
  var SNAP_AT = '';
  var DATA_SRC = '';
  var LOAD_ERR = '';

  /** 接口原始响应 / 导出文件 / 旧快照，统一成 { fetchedAt, courses, source } */
  function normalize(raw, fallbackAt, src) {
    var body = raw && raw.data ? raw.data : raw;
    var list = (body && body.results) || (raw && raw.courses) || [];
    var courses = list.map(function (c) {
      var o = {};
      KEEP.forEach(function (k) { if (c[k] !== undefined) o[k] = c[k]; });
      return o;
    });
    return {
      fetchedAt: (raw && (raw.fetchedAt || raw.at)) || fallbackAt || new Date().toISOString(),
      courses: courses,
      source: src || DATA_SRC || '未知来源'
    };
  }

  var $ = function (id) { return document.getElementById(id); };
  var rowsEl = $('rows'), emptyEl = $('empty');

  /* ================= 本地缓存 ================= */

  var STORE_KEY = 'sufe.replay.cache.v2' + SUFFIX;
  var storeOk = true;

  function emptyStore() {
    return {
      version: 2, createdAt: null, updatedAt: null, lastSnapshotAt: null, reads: [], courses: {},
      // 数据来源台账：只记「哪个接口、什么时候、多大、sha、几条」，不记任何正文
      sources: {}, sourceLog: []
    };
  }

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return emptyStore();
      var s = JSON.parse(raw);
      if (!s || s.version !== 2) return emptyStore();
      s.reads = s.reads || [];
      s.courses = s.courses || {};
      s.sources = s.sources || {};
      s.sourceLog = s.sourceLog || [];
      return s;
    } catch (e) {
      storeOk = false;
      return emptyStore();
    }
  }

  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(STORE));
      storeOk = true;
      return true;
    } catch (e) {
      storeOk = false;
      return false;
    }
  }

  function keyOf(c) { return String(c.courseId || c.id); }

  var STORE = loadStore();

  /**
   * 把一次快照合并进缓存。
   * 同一次读取（fetchedAt 相同）不重复记账，刷新页面不会让「记录次数」虚增。
   */
  function mergeSnapshot(snap) {
    var at = snap.fetchedAt || new Date().toISOString();
    if (STORE.lastSnapshotAt === at) return false;
    if (!STORE.createdAt) STORE.createdAt = at;

    var seen = {};
    var fresh = snap.courses || [];

    fresh.forEach(function (c) {
      var k = keyOf(c);
      seen[k] = 1;
      var p = STORE.courses[k];

      if (!p) {
        var o = {};
        for (var f in c) if (Object.prototype.hasOwnProperty.call(c, f)) o[f] = c[f];
        o.firstSeen = at;
        o.lastSeen = at;
        o.reads = 1;
        o.viewsFirst = c.playbackCount;
        o.viewsLast = c.playbackCount;
        o.viewsDelta = 0;
        o.missing = false;
        o.changes = [];
        STORE.courses[k] = o;
        return;
      }

      var changed = [];
      for (var g in c) {
        if (!Object.prototype.hasOwnProperty.call(c, g)) continue;
        if (g === 'playbackCount') continue;
        if (JSON.stringify(p[g]) !== JSON.stringify(c[g])) changed.push(g);
        p[g] = c[g];
      }
      if (p.viewsLast !== c.playbackCount) {
        p.viewsDelta = (p.viewsDelta || 0) + ((c.playbackCount || 0) - (p.viewsLast || 0));
        changed.push('playbackCount');
      }
      p.viewsLast = c.playbackCount;
      p.playbackCount = c.playbackCount;
      p.lastSeen = at;
      p.reads = (p.reads || 1) + 1;
      p.missing = false;
      if (changed.length) {
        p.changes = (p.changes || []).concat([{ at: at, fields: changed }]).slice(-5);
      }
    });

    Object.keys(STORE.courses).forEach(function (k) {
      if (!seen[k]) STORE.courses[k].missing = true;
    });

    STORE.lastSnapshotAt = at;
    STORE.updatedAt = new Date().toISOString();
    STORE.reads = (STORE.reads || []).concat([{ at: at, count: fresh.length }]).slice(-30);

    saveStore();
    return true;
  }

  var CACHED = [];
  function refreshCached() {
    CACHED = Object.keys(STORE.courses).map(function (k) { return STORE.courses[k]; });
  }
  refreshCached();

  /* ================= 数据来源台账 =================
   * 只存「来源元信息」：接口路径、方法、状态码、字节数、sha、条数、时间。
   * 摘要正文 / 字幕 / 关键词 / 知识点文字一律不落盘。
   */

  function fmtBytes(n) {
    if (!n || n < 0) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }

  function recSource(entry) {
    if (!entry || !entry.kind) return;
    var k = entry.kind + '|' + (entry.key || '');
    var prev = STORE.sources[k] || null;
    var at = entry.at || new Date().toISOString();
    STORE.sources[k] = {
      kind: entry.kind,
      key: entry.key || '',
      label: entry.label || '',
      endpoint: entry.endpoint || '',
      method: entry.method || 'GET',
      status: entry.status || 200,
      bytes: entry.bytes || 0,
      sha: entry.sha || '',
      count: (typeof entry.count === 'number') ? entry.count : null,
      via: entry.via || '',
      at: at,
      firstAt: prev ? prev.firstAt : at,
      hits: prev ? (prev.hits || 1) + 1 : 1,
      lastSha: prev ? prev.sha : '',
      changed: !!(prev && entry.sha && prev.sha && prev.sha !== entry.sha)
    };
    STORE.sourceLog = (STORE.sourceLog || []).concat([{
      at: at, kind: entry.kind, key: entry.key || '', bytes: entry.bytes || 0,
      sha: entry.sha || '', count: (typeof entry.count === 'number') ? entry.count : null
    }]).slice(-60);
    saveStore();
  }

  /** 尚未接入、但已经探明可用性的富数据来源（只登记接口，不取内容） */
  var RICH_SOURCES = [
    { kind: 'summary', name: '分章摘要 / 知识要点', method: 'GET', endpoint: '/rman/v1/intelligent/select/knowledge/summary?contentId=', note: '按 contentId，只有「屏幕画面」那路有' },
    { kind: 'keyword', name: '关键词 + 本节概要', method: 'GET', endpoint: '/learn/v1/homepage/course/keywordAndAbstract?videoId=', note: '10 个关键词 + 一段摘要' },
    { kind: 'shots', name: 'PPT 帧', method: 'GET', endpoint: '/rman/v1/entity/file/screenshot?contentId=', note: '带 nextInPoint，可跳帧' },
    { kind: 'vtt', name: '字幕', method: 'GET', endpoint: '/rman/v1/search/webvtt?contentId=', note: 'VTT，教师画面那路没有' },
    { kind: 'points', name: '知识点清单', method: 'POST', endpoint: '/learn/online/classroom/knowledge/point/list', note: '需登录，带观看统计' },
    { kind: 'relation', name: '索贝元数据', method: 'POST', endpoint: '/rman/v1/search/new/relation/videos', note: '标签 / 自动摘要 / 关键帧' }
  ];

  function cachedCount() { return CACHED.length; }
  function missingList() { return CACHED.filter(function (c) { return c.missing; }); }
  function changedList() {
    return CACHED.filter(function (c) {
      return (c.viewsDelta && c.viewsDelta !== 0) || (c.changes && c.changes.length);
    });
  }

  /* ================= 视图状态 ================= */

  var state = { scope: 'current', sem: 'all', college: 'all', teacher: 'all', q: '', sort: 'default', sel: null };

  /** 当前「视图」包含哪些课程 */
  function viewRows() {
    if (state.scope === 'cache') return CACHED;
    if (state.scope === 'missing') return missingList();
    if (state.scope === 'changed') return changedList();
    // current：以本次快照为准，但显示缓存里的完整记录（含首次/最近看到）
    return COURSES.map(function (c) { return STORE.courses[keyOf(c)] || c; });
  }

  function uniq(list, key) {
    var seen = {}, out = [];
    list.forEach(function (c) {
      var v = c[key];
      if (v && !seen[v]) { seen[v] = 1; out.push(v); }
    });
    return out;
  }

  function countOf(list, key) {
    var m = {};
    list.forEach(function (c) {
      var v = c[key];
      if (!v) return;
      String(v).split(',').forEach(function (t) {
        t = t.trim();
        if (t) m[t] = (m[t] || 0) + 1;
      });
    });
    return m;
  }

  function splitNames(s) {
    return String(s == null ? '' : s).split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function teacherStats(list) {
    var counts = {}, order = [];
    list.forEach(function (c) {
      splitNames(c.teacherNames).forEach(function (t) {
        if (counts[t] === undefined) { counts[t] = 0; order.push(t); }
        counts[t] += 1;
      });
    });
    return { list: order, counts: counts };
  }

  function buildNav(el, items, counts, key, total) {
    el.innerHTML = '';
    var all = document.createElement('li');
    all.className = state[key] === 'all' ? 'cur' : '';
    all.innerHTML = '<span>全部</span><span class="n">' + (total == null ? 0 : total) + '</span>';
    all.onclick = function () { state[key] = 'all'; state.sel = null; render(); };
    el.appendChild(all);

    items.forEach(function (it) {
      var li = document.createElement('li');
      li.className = state[key] === it ? 'on' : '';
      li.innerHTML = '<span>' + esc(it) + '</span><span class="n">' + (counts[it] || 0) + '</span>';
      li.onclick = function () { state[key] = it; state.sel = null; render(); };
      el.appendChild(li);
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function shortCampus(c) { return String(c.campus || '').replace(/校区$/, ''); }

  function classroomText(c) {
    var cp = shortCampus(c);
    var room = String(c.classroomNumber || '');
    if (cp && room.indexOf(cp) === 0) room = room.slice(cp.length).trim();
    return (cp ? cp + ' ' : '') + room;
  }

  function addrText(c) {
    var cp = shortCampus(c);
    var b = String(c.jxlShowName || '');
    var r = String(c.classroomNumber || '');
    var bb = (cp && b.indexOf(cp) === 0) ? b.slice(cp.length).trim() : b;
    var parts = [];
    if (c.campus) parts.push(c.campus);
    if (bb && r.indexOf(b) < 0 && r.indexOf(bb) < 0) parts.push(bb);
    if (r) parts.push(r);
    return parts.join(' · ');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function match(c) {
    if (state.sem !== 'all' && c.showSemester !== state.sem) return false;
    if (state.college !== 'all' && String(c.collegeNames || '').indexOf(state.college) < 0) return false;
    if (state.teacher !== 'all' && splitNames(c.teacherNames).indexOf(state.teacher) < 0) return false;
    if (state.q) {
      var hay = [c.courseName, c.teacherNames, c.collegeNames, c.classroomNumber,
                 c.jxlShowName, c.campus, (c.courseTimeData || []).join(' ')].join(' ').toLowerCase();
      if (hay.indexOf(state.q.toLowerCase()) < 0) return false;
    }
    return true;
  }

  function sorted(list) {
    var a = list.slice();
    if (state.sort === 'views') a.sort(function (x, y) { return (y.playbackCount || 0) - (x.playbackCount || 0); });
    else if (state.sort === 'name') a.sort(function (x, y) { return String(x.courseName).localeCompare(String(y.courseName), 'zh'); });
    return a;
  }

  function cell(k, v, cls) {
    return '<div><div class="k">' + esc(k) + '</div><div class="v ' + (cls || '') + '">' +
      esc(v == null || v === '' ? '—' : v) + '</div></div>';
  }

  function srcRow(name, ep, method, s) {
    var status = s ? String(s.status || '—') : '未取';
    var size = s ? fmtBytes(s.bytes) : '—';
    var sha = s && s.sha ? String(s.sha).slice(0, 8) : '—';
    var when = s ? fmtDate(s.at) : '—';
    var hits = s && s.hits > 1 ? ' ×' + s.hits : '';
    var cnt = s && s.count != null ? '（' + s.count + ' 条）' : '';
    return '<tr><td>' + esc(name) + cnt + '</td><td class="mono">' + esc(method + ' ' + ep) + '</td>' +
      '<td>' + esc(status) + hits + '</td><td class="mono">' + esc(size) + '</td>' +
      '<td class="mono">' + esc(sha) + '</td><td class="mono">' + esc(when) + '</td></tr>';
  }

  function sourceTableHtml(c) {
    var ck = keyOf(c);
    var term = (c.schoolYear || '') + ' ' + (c.semester || '');
    var rows = srcRow('课程列表', '/learn/v1/course/video/review/-1', 'GET',
      STORE.sources['courses|' + term] || null);
    rows += srcRow('回放直链',
      '/learn/v1/course/recording/video/info ＋ /rman/v1/entity/download/fileinfo', 'GET+POST',
      STORE.sources['media|' + ck] || null);
    RICH_SOURCES.forEach(function (r) {
      rows += srcRow(r.name, r.endpoint, r.method, STORE.sources[r.kind + '|' + ck] || null);
    });
    return '<table class="srct"><thead><tr><th>内容</th><th>接口</th><th>状态</th><th>大小</th><th>sha</th><th>时间</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  function sourceBlockHtml(c) {
    return '<div class="src" data-src="' + esc(keyOf(c)) + '">' +
      '<div class="k">数据来源 <span class="muted">只记接口、状态、大小、sha、时间；摘要 / 字幕 / 知识点正文不入库</span></div>' +
      '<div class="sbody">' + sourceTableHtml(c) + '</div></div>';
  }

  function detailHtml(c) {
    var added = (c.playbackCount || 0) - (c.viewsFirst || 0);
    var addedTxt = added > 0 ? '+' + added : String(added);
    return '<div class="detail">' +
      cell('课程 ID（详情页主键）', c.id, 'mono') +
      cell('courseId', c.courseId, 'mono') +
      cell('课程编号', c.courseNumber, 'mono') +
      cell('开课学期', c.showSemester) +
      cell('教师', c.teacherNames) +
      cell('学院', c.collegeNames) +
      '<div class="wide"><div class="k">校区 / 楼 / 教室</div><div class="v">' + esc(addrText(c)) + '</div></div>' +
      cell('上课时间', (c.courseTimeData || []).join('　')) +
      cell('回放次数', c.playbackCount == null ? '—'
        : (added === 0 ? String(c.playbackCount) : c.playbackCount + '　（自首次记录 ' + addedTxt + '）')) +
      cell('有录像', c.hasVideo ? '是' : '否') +
      '<div class="cacheline">' +
        (c.firstSeen
          ? '首次记录 ' + fmtDate(c.firstSeen) +
            '　·　最近记录 ' + fmtDate(c.lastSeen) +
            '　·　已记录 ' + (c.reads || 1) + ' 次' +
            (c.missing ? '　·　<span style="color:var(--accent-ink)">本次列表中已不存在</span>' : '')
          : '未记入本地缓存（缓存已清空，或这是一条未入库的记录）') +
      '</div>' +
      '<div class="media" data-mkey="' + esc(keyOf(c)) + '">' +
        '<div class="k">回放画面</div>' +
        '<div class="mb"><span class="muted">正在读取画面链接…</span></div>' +
      '</div>' +
      sourceBlockHtml(c) +
      '</div>';
  }

  /* ================= 回放画面 ================= */

  var MEDIA = new Map();   // courseKey -> 后台返回结果
  var MEDIA_SEL = new Map(); // courseKey -> 选中的节次下标
  var MEDIA_COURSE = new Map(); // courseKey -> 课程对象（重试用）
  var mediaToken = 0;

  function seatLabel(seat) {
    if (seat === '屏幕画面') return 'PPT / 屏幕';
    if (seat === '教师画面') return '教师画面';
    if (seat === '学生画面') return '学生画面';
    return seat || '画面';
  }

  function mediaBoxHtml(res, courseKey) {
    if (!res) return '';
    if (!res.ok) {
      return '<div class="mb"><span class="warn">' + esc(res.message || res.error || '读取失败') +
        '</span> <button class="btn mini" data-mretry="' + esc(courseKey) + '">重试</button></div>';
    }
    if (!res.sessions || !res.sessions.length) {
      return '<div class="mb muted">这门课还没有可用的录像。</div>';
    }

    var idx = MEDIA_SEL.has(courseKey) ? MEDIA_SEL.get(courseKey) : res.sessions.length - 1;
    idx = Math.max(0, Math.min(idx, res.sessions.length - 1));
    MEDIA_SEL.set(courseKey, idx);
    var s = res.sessions[idx];

    var chips = '';
    if (res.sessions.length > 1) {
      chips = '<div class="mchips">' + res.sessions.map(function (x, i) {
        var t = x.label + (x.date ? ' · ' + x.date.slice(5) : '');
        return '<span class="mchip' + (i === idx ? ' on' : '') + '" data-msel="' + esc(courseKey) +
          '" data-idx="' + i + '">' + esc(t) + '</span>';
      }).join('') + '</div>';
    }

    var want = s.media.filter(function (m) { return m.seat !== '学生画面'; });
    if (!want.length) want = s.media;

    var co = MEDIA_COURSE.get(courseKey) || {};
    var qbase = new URLSearchParams();
    var titleTxt = (co.courseName || '回放') + ' · ' + (s.label || '');
    var subTxt = [s.date, s.time].filter(Boolean).join(' ');

    var links = want.map(function (m) {
      var q = new URLSearchParams();
      q.set('src', m.url);
      q.set('title', titleTxt);
      if (subTxt) q.set('sub', subTxt);
      if (m.cid) q.set('c1', m.cid);
      var href = 'player/index.html?' + q.toString();
      return '<div class="mline">' +
        '<a class="mlink" href="' + esc(href) + '" target="_blank" rel="noopener">' +
          '<span class="mtag">' + esc(seatLabel(m.seat)) + '</span>' +
          '<span class="msize">' + esc(m.size || '') + '</span>' +
          '<span class="mgo">播放 →</span>' +
        '</a>' +
        '<a class="mraw" href="' + esc(m.url) + '" target="_blank" rel="noopener" title="用浏览器自带播放器打开原始 MP4">原片</a>' +
      '</div>';
    }).join('');

    var bySeat = {};
    want.forEach(function (m) { bySeat[m.seat] = m; });
    var dual = '';
    if (bySeat['屏幕画面'] && bySeat['教师画面']) {
      qbase.set('src', bySeat['屏幕画面'].url);
      qbase.set('src2', bySeat['教师画面'].url);
      qbase.set('title', titleTxt);
      if (subTxt) qbase.set('sub', subTxt);
      if (bySeat['屏幕画面'].cid) qbase.set('c1', bySeat['屏幕画面'].cid);
      if (bySeat['教师画面'].cid) qbase.set('c2', bySeat['教师画面'].cid);
      qbase.set('mode', 'side');
      dual = '<div class="mdual">' +
        '<a class="dlink" href="player/index.html?' + esc(qbase.toString()) + '" target="_blank" rel="noopener">' +
        '双屏看（屏幕 + 教师）→</a>' +
        '<span class="muted">两路同放，可切左右 / 上下 / 小窗，能调时间差</span>' +
      '</div>';
    }

    return chips + dual + '<div class="media-links">' + links + '</div>' +
      '<div class="mhint">共 ' + res.sessions.length + ' 节课；「双屏看」一次给两路，「播放」单路，「原片」直接开 MP4。</div>';
  }

  function shortHash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  function noteMedia(key, res) {
    if (!res || !res.ok || !res.meta) return;
    var eps = res.meta.endpoints || [];
    var main = eps[0] || { path: '/learn/v1/course/recording/video/info', method: 'GET', status: 200, bytes: 0 };
    var bytes = 0;
    eps.forEach(function (e) { bytes += (e.bytes || 0); });
    var ids = res.meta.contentIds || [];
    recSource({
      kind: 'media', key: key, label: '回放直链',
      endpoint: main.path + (eps[1] ? ' + ' + eps[1].path : ''),
      method: eps[1] ? 'GET + POST' : 'GET',
      status: main.status,
      bytes: bytes,
      sha: ids.length ? shortHash(ids.join('|')) + ':' + ids.length : '',
      count: res.count,
      at: res.meta.at
    });
  }

  function fillMedia(c, rowEl) {
    var key = keyOf(c);
    var box = rowEl.querySelector('[data-mkey]');
    if (!box) return;
    MEDIA_COURSE.set(key, c);

    var mb = box.querySelector('.mb');
    if (!mb) return;

    if (!window.SUFEBridge || !window.SUFEBridge.getMedia) {
      mb.innerHTML = '<span class="muted">装扩展并登录后，这里会直接给出画面链接。</span>';
      return;
    }

    var cached = MEDIA.get(key);
    if (cached) {
      mb.innerHTML = mediaBoxHtml(cached, key);
      return;
    }

    var token = ++mediaToken;
    window.SUFEBridge.getMedia({
      courseId: c.courseId, id: c.id, schoolYear: c.schoolYear, semester: c.semester
    }).then(function (res) {
      if (token !== mediaToken) return;
      MEDIA.set(key, res || { ok: false, error: 'empty' });
      noteMedia(key, res);
      var b = rowEl.querySelector('[data-mkey]');
      if (!b) return;
      b.querySelector('.mb').innerHTML = mediaBoxHtml(res, key);
      var sb = rowEl.querySelector('.sbody');
      if (sb) sb.innerHTML = sourceTableHtml(c);
    }).catch(function (e) {
      if (token !== mediaToken) return;
      var b = rowEl.querySelector('[data-mkey]');
      if (b) b.querySelector('.mb').innerHTML =
        mediaBoxHtml({ ok: false, error: e && e.message ? e.message : String(e) }, key);
    });
  }

  // 节次切换 / 重试（事件委托，避免每次重渲染都重绑）
  document.addEventListener('click', function (ev) {
    var chip = ev.target.closest && ev.target.closest('[data-msel]');
    if (chip) {
      var k1 = chip.getAttribute('data-msel');
      MEDIA_SEL.set(k1, parseInt(chip.getAttribute('data-idx'), 10) || 0);
      var res1 = MEDIA.get(k1);
      var mb1 = chip.closest('[data-mkey]').querySelector('.mb');
      if (res1 && mb1) mb1.innerHTML = mediaBoxHtml(res1, k1);
      return;
    }

    var retry = ev.target.closest && ev.target.closest('[data-mretry]');
    if (retry) {
      var k2 = retry.getAttribute('data-mretry');
      var cur = MEDIA_COURSE.get(k2);
      var mb2 = retry.closest('[data-mkey]').querySelector('.mb');
      if (!mb2) return;
      if (!cur) {
        mb2.innerHTML = '<span class="warn">找不到这门课的数据，刷新一下页面。</span>';
        return;
      }
      MEDIA.delete(k2);
      mb2.innerHTML = '<span class="muted">正在读取画面链接…</span>';
      window.SUFEBridge.getMedia({
        courseId: cur.courseId, id: cur.id, schoolYear: cur.schoolYear, semester: cur.semester
      }).then(function (res) {
        MEDIA.set(k2, res || { ok: false, error: 'empty' });
        noteMedia(k2, res);
        mb2.innerHTML = mediaBoxHtml(res, k2);
      }).catch(function (e) {
        mb2.innerHTML = mediaBoxHtml({ ok: false, error: String(e && e.message ? e.message : e) }, k2);
      });
    }
  });

  /* ================= 渲染 ================= */

  function renderScopeNav() {
    var items = [
      { k: 'current', label: '本次列表', n: COURSES.length },
      { k: 'cache', label: '全部缓存', n: cachedCount() },
      { k: 'missing', label: '历史留存', n: missingList().length },
      { k: 'changed', label: '有变化', n: changedList().length }
    ];
    var el = $('scopeNav');
    el.innerHTML = '';
    items.forEach(function (it) {
      var li = document.createElement('li');
      li.className = state.scope === it.k ? 'on' : '';
      li.innerHTML = '<span>' + it.label + '</span><span class="n">' + it.n + '</span>';
      li.onclick = function () { state.scope = it.k; state.sel = null; render(); };
      el.appendChild(li);
    });
  }

  function render() {
    refreshCached();
    renderScopeNav();

    var pool = viewRows();
    var ts = teacherStats(pool);
    buildNav($('semNav'), uniq(pool, 'showSemester'), countOf(pool, 'showSemester'), 'sem', pool.length);
    buildNav($('collegeNav'), uniq(pool, 'collegeNames'), countOf(pool, 'collegeNames'), 'college', pool.length);
    buildNav($('teacherNav'), ts.list, ts.counts, 'teacher', pool.length);

    var list = sorted(pool.filter(match));
    rowsEl.innerHTML = '';
    emptyEl.hidden = list.length > 0 || COURSES.length === 0;

    list.forEach(function (c) {
      var li = document.createElement('li');
      li.className = 'row' + (state.sel === keyOf(c) ? ' on' : '') + (c.missing ? ' gone' : '');
      var badges = '';
      if (c.missing) badges += '<span class="badge gone">历史</span>';
      if (c.viewsDelta > 0) badges += '<span class="badge hot">+' + c.viewsDelta + '</span>';
      else if (c.viewsDelta < 0) badges += '<span class="badge">' + c.viewsDelta + '</span>';

      li.innerHTML =
        '<span><span class="name">' + esc(c.courseName) + '</span>' + badges +
          (c.collect ? '<span class="tag">收藏</span>' : '') +
          '<div class="sub">' + esc(c.courseNumber) + '</div></span>' +
        '<span class="t">' + esc(c.teacherNames) + '</span>' +
        '<span class="t">' + esc(c.collegeNames) + '</span>' +
        '<span class="t">' + esc((c.courseTimeData || []).join('　')) + '</span>' +
        '<span class="t" title="' + esc(addrText(c)) + '">' + esc(classroomText(c)) + '</span>' +
        '<span class="r views">' + esc(c.playbackCount) + '</span>';

      li.onclick = function () {
        state.sel = state.sel === keyOf(c) ? null : keyOf(c);
        render();
      };
      rowsEl.appendChild(li);

      if (state.sel === keyOf(c)) {
        var d = document.createElement('li');
        d.innerHTML = detailHtml(c);
        rowsEl.appendChild(d);
        fillMedia(c, d);
      }
    });

    $('stat').textContent = COURSES.length ? ('本次 ' + COURSES.length + ' 门') : '';
    document.querySelector('.statsep').hidden = !COURSES.length;
    $('cacheStat').textContent = cachedCount()
      ? '缓存 ' + cachedCount() + ' 门' +
        (STORE.reads.length > 1 ? '（第 ' + STORE.reads.length + ' 次读取）' : '')
      : '缓存 0 门';

    $('loader').hidden = (COURSES.length + cachedCount()) > 0;

    $('footCount').textContent = String(COURSES.length);
    $('footSrc').textContent = DATA_SRC || '—';
    $('footAt').textContent = SNAP_AT ? fmtDate(SNAP_AT) : '—';
    $('srcText').textContent = !COURSES.length ? '无数据'
      : (DATA_SRC.indexOf('data/') === 0 ? '实时读取' : DATA_SRC);
    $('srcDot').classList.toggle('live', COURSES.length > 0);
  }

  /* ================= 交互 ================= */

  $('q').addEventListener('input', function (e) { state.q = e.target.value.trim(); state.sel = null; render(); });

  $('sortSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-sort]');
    if (!b) return;
    state.sort = b.dataset.sort;
    Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
    render();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== $('q')) { e.preventDefault(); $('q').focus(); }
    if (e.key === 'Escape') { $('q').value = ''; state.q = ''; state.sel = null; render(); }
  });

  var toastTimer = null;
  function toast(msg, ms) {
    var el = $('toast');
    el.innerHTML = msg;
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 4200);
  }

  $('exportBtn').onclick = function () {
    if (!cachedCount()) { toast('缓存是空的，没有可导出的内容。'); return; }
    var payload = {
      exportedAt: new Date().toISOString(),
      note: '上财空中课堂 · 回放缓存（本地导出）',
      store: STORE
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    var d = new Date();
    var stamp = d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) +
      '-' + ('0' + d.getHours()).slice(-2) + ('0' + d.getMinutes()).slice(-2);
    var name = 'sufe-replay-cache-' + stamp + '.json';
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('已导出 <b>' + esc(name) + '</b>　（' + cachedCount() + ' 门课程）');
  };

  /* 清空做成「点两次」而不是 confirm()：
     file:// 页面里原生弹窗可能被浏览器抑制，点了没反应；两步确认哪儿都能用。
     语义：清空 = 连「本次列表」一起丢掉，然后重新向学校要一次最新数据，
     所以清完看到的是「全新的第一次读取」，而不是「数据还在、只是计数没了」。 */
  var armed = false, armTimer = null;
  var clearBtn = $('clearBtn');
  function disarmClear() {
    armed = false;
    clearBtn.textContent = '清空缓存';
    clearBtn.classList.remove('armed');
    if (armTimer) { clearTimeout(armTimer); armTimer = null; }
  }

  function resetEverything() {
    STORE = emptyStore();
    STORE.clearedAt = new Date().toISOString();
    STORE.lastSnapshotAt = null;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(STORE)); } catch (e) {}
    try { localStorage.removeItem(PAYLOAD_KEY); } catch (e) {}
    SNAP = null;
    COURSES = [];
    SNAP_AT = '';
    DATA_SRC = '';
    MEDIA.clear(); MEDIA_SEL.clear(); MEDIA_COURSE.clear();
    state.scope = 'current';
    state.sel = null;
    refreshCached();
    render();
  }

  function setLoaderMode(text) {
    var h = $('loaderH'), b = $('loaderBody');
    if (!h || !b) return;
    if (text) {
      h.textContent = text;
      b.hidden = true;
    } else {
      h.textContent = '还没有课程数据';
      b.hidden = false;
    }
  }

  clearBtn.onclick = function () {
    if (!armed) {
      if (!cachedCount() && !COURSES.length) { toast('缓存已经是空的。'); return; }
      armed = true;
      clearBtn.textContent = '再点一次确认';
      clearBtn.classList.add('armed');
      armTimer = setTimeout(disarmClear, 4000);
      return;
    }
    disarmClear();
    var n = cachedCount();
    resetEverything();
    setLoaderMode('正在重新读取最新课程…');
    toast('已重置：丢掉 <b>' + n + '</b> 门记录，正在向学校重新要一次最新数据…');
    reloadLatest(function (ok, msg) {
      setLoaderMode('');
      if (ok) {
        toast('重置完成：已重新读取 <b>' + COURSES.length + '</b> 门课程，记录从这次开始重新计数。');
      } else {
        toast('重置完成，但这次没读到数据：' + esc(msg || '未知原因'));
      }
    });
  };

  /** 重新取一次最新数据（扩展在就用扩展，否则回落到 JSON 文件） */
  function reloadLatest(done) {
    if (window.SUFEBridge && window.SUFEBridge.available) {
      return window.SUFEBridge.getCourses({ force: true }).then(function (res) {
        if (applyBridgeResult(res)) { if (done) done(true); return res; }
        if (res && res.needLogin) showNeedLogin(res);
        if (done) done(false, (res && (res.message || res.error)) || '没读到数据');
        return res;
      }).catch(function (e) {
        if (done) done(false, e && e.message ? e.message : String(e));
        return null;
      });
    }
    tryFetch(done);
  }

  /* ---------------- 数据加载 ---------------- */

  function setSnapshot(snap, persist) {
    SNAP = snap;
    COURSES = snap.courses || [];
    SNAP_AT = snap.fetchedAt || '';
    DATA_SRC = snap.source || '';
    if (persist) {
      try { localStorage.setItem(PAYLOAD_KEY, JSON.stringify(snap)); } catch (e) {}
    }
    var added = mergeSnapshot(snap);
    refreshCached();
    render();
    return added;
  }

  function loadFromText(text, fallbackAt, src, manual) {
    var raw;
    try { raw = JSON.parse(text); }
    catch (e) { toast('这个文件不是有效的 JSON：' + esc(e.message)); return false; }
    var snap = normalize(raw, fallbackAt, src);
    if (!snap.courses.length) {
      toast('文件读出来了，但里面没有课程（<code>results</code> 或 <code>courses</code> 是空的）。');
      return false;
    }
    var changed = setSnapshot(snap, true);
    recSource({
      kind: 'file', key: src, label: manual ? '本地导入' : '本地数据文件',
      endpoint: src, method: 'GET', status: 200,
      bytes: (text || '').length, count: snap.courses.length,
      at: snap.fetchedAt
    });
    if (manual) {
      toast('已加载 <b>' + snap.courses.length + '</b> 门课程　来源 ' + esc(src) +
        (changed ? '　（记为新的一次读取）' : '　（与上次相同，未重复记录）'));
    }
    return true;
  }

  function tryFetch(done) {
    function finish(ok, msg) { if (done) done(ok, msg); }
    if (!window.fetch) { finish(false, '这个环境不支持 fetch'); return; }
    fetch(DATA_URL, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var lm = r.headers.get('last-modified');
      return r.text().then(function (t) { return { t: t, lm: lm }; });
    }).then(function (o) {
      LOAD_ERR = '';
      var ok = loadFromText(o.t, o.lm, DATA_URL);
      finish(!!ok, ok ? '' : '文件里没有课程');
    }).catch(function (e) {
      LOAD_ERR = e.message || String(e);
      // file:// 下 fetch 必然失败（浏览器禁止读本地文件），已有数据时静默
      if (!COURSES.length) {
        $('footSrc').textContent = '读取失败：' + LOAD_ERR;
      }
      finish(false, LOAD_ERR);
    });
  }

  $('fileInput').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var at = new Date(f.lastModified || Date.now()).toISOString();
    f.text().then(function (t) { loadFromText(t, at, f.name, true); });
    e.target.value = '';
  });
  function pickFile() { $('fileInput').click(); }
  $('pickBtn').addEventListener('click', pickFile);
  $('pickBtn2').addEventListener('click', pickFile);

  // 允许把 JSON 直接拖到窗口里
  ['dragover', 'drop'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      e.preventDefault();
      if (ev === 'drop' && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        var f = e.dataTransfer.files[0];
        var at = new Date(f.lastModified || Date.now()).toISOString();
        f.text().then(function (t) { loadFromText(t, at, f.name, true); });
      }
    });
  });

  var themeBtn = $('themeBtn');
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    themeBtn.textContent = t === 'dark' ? '浅色' : '深色';
    try { localStorage.setItem('sufe_theme', t); } catch (e) {}
  }
  themeBtn.onclick = function () {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  };
  var saved = null;
  try { saved = localStorage.getItem('sufe_theme'); } catch (e) {}
  applyTheme(saved === 'dark' ? 'dark' : 'light');

  if (!storeOk) {
    $('cacheStat').textContent = '缓存不可用';
  }

  /* ---------------- 通过扩展取数 ---------------- */

  var loginWired = false;

  function hideAskLogin() {
    var el = $('askLogin');
    if (el) el.hidden = true;
  }

  function applyBridgeResult(r) {
    if (!r || !r.ok || !r.raw) return false;
    var where = r.term ? r.term.year + ' ' + r.term.sem : '';
    var how = r.via === 'tab' ? '扩展 · 同源代理' : '扩展 · 直连';
    var snap = normalize(r.raw, r.at, how + (where ? '（' + where + '）' : ''));
    snap.fetchedAt = r.at || snap.fetchedAt;
    hideAskLogin();
    var before = COURSES.length;
    setSnapshot(snap, true);
    var ep = (r.meta && r.meta.endpoints && r.meta.endpoints[0]) || null;
    recSource({
      kind: 'courses', key: where || 'default', label: '课程列表',
      endpoint: ep ? ep.path : '/learn/v1/course/video/review/-1',
      method: ep ? ep.method : 'GET',
      status: ep ? ep.status : 200,
      bytes: ep ? ep.bytes : 0,
      sha: String(r.hash || '').slice(0, 16),
      count: r.count,
      via: how,
      at: r.at
    });
    if (!before) toast('已从学校接口读到 <b>' + snap.courses.length + '</b> 门课程');
    return true;
  }

  /** 只读检查一次（不打开任何标签页）；allowProxy 时才允许开后台页兜底 */
  function recheck(opts) {
    var o = Object.assign({ force: true }, opts || {});
    o.allowProxy = !!o.allowProxy;
    return window.SUFEBridge.getCourses(o).then(function (res) {
      if (applyBridgeResult(res)) return res;
      if (res && res.needLogin) showNeedLogin(res);
      return res;
    });
  }

  function showNeedLogin(r) {
    var el = $('askLogin');
    if (!el) return;
    el.hidden = false;

    if (!loginWired) {
      loginWired = true;

      $('loginBtn').onclick = function () {
        // 直接跳统一认证登录页（会 302 到 login.sufe.edu.cn），不是回放列表
        var url = (r && r.loginUrl) || 'https://dm.sufe.edu.cn/unifiedlogin/v1/loginmanage/login/direction';
        if (window.SUFEBridge && window.SUFEBridge.openLogin) window.SUFEBridge.openLogin(url);
        else window.open(url, '_blank', 'noopener');
      };

      $('recheckBtn').onclick = function () {
        $('recheckBtn').disabled = true;
        $('recheckBtn').textContent = '检查中…';
        recheck({ allowProxy: true }).then(function () {
          $('recheckBtn').disabled = false;
          $('recheckBtn').textContent = '重新检查';
        }).catch(function () {
          $('recheckBtn').disabled = false;
          $('recheckBtn').textContent = '重新检查';
        });
      };

      // 登录完切回这个标签页 → 只做一次直连检查（不开标签页，不打扰）
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        if (el.hidden) return;
        recheck({ allowProxy: false }).catch(function () {});
      });

      window.addEventListener('focus', function () {
        if (el.hidden) return;
        recheck({ allowProxy: false }).catch(function () {});
      });
    }
  }

  function bootWithBridge(stored) {
    if (stored && stored.courses && stored.courses.length) setSnapshot(stored, false);
    else render();
    if (stored && stored.courses && stored.courses.length) {
      $('srcText').textContent = '正在读取…';
    }
    function settle(res, err) {
      // 顶栏不要一直挂着「正在读取…」
      var ok = res && res.ok && res.raw;
      if (!ok) $('srcText').textContent = DATA_SRC || (err ? '读取失败' : '未登录');
    }
    recheck({ allowProxy: false }).then(function (res) {
      settle(res, null);
      if (res && res.ok && res.raw) return;
      if (res && res.needLogin) {
        toast('还没读到数据：' + esc(res.message || '需要先登录学校账号'));
      } else {
        toast('读取失败：' + esc((res && (res.error || res.message)) || '未知原因'));
        if (!COURSES.length) tryFetch();
      }
    }).catch(function (e) {
      settle(null, true);
      toast('读取失败：' + esc(e && e.message ? e.message : e));
      if (!COURSES.length) tryFetch();
    });
  }

  /* 启动：先用上次的 payload 渲染，再去读最新的 */
  if (/[?&]debug=1/.test(location.search)) {
    window.__SUFE_APP__ = {
      reload: reloadLatest,
      reset: resetEverything,
      setSnapshot: setSnapshot,
      store: function () { return STORE; },
      courses: function () { return COURSES; },
    };
  }

  (function boot() {
    var stored = null;
    try {
      var raw = localStorage.getItem(PAYLOAD_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch (e) {}
    // 另一种注入方式：扩展 / 测试页可以直接把数据挂在 window.__SEED__ 上
    if (!stored && window.__SEED__) stored = window.__SEED__;

    if (window.SUFEBridge && window.SUFEBridge.available) {
      bootWithBridge(stored);
      return;
    }
    if (stored && stored.courses && stored.courses.length) setSnapshot(stored, false);
    else render();
    tryFetch();
  })();
})();
