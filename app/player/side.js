'use strict';
/**
 * side.js —— 播放器右侧栏：概要 / 知识要点 / PPT 帧 / 字幕。
 *
 * 四个标签都只读「入库时算好」的数据（不是实时生成）：
 *   概要      GET /learn/v1/homepage/course/keywordAndAbstract?videoId=
 *   知识要点  GET /rman/v1/intelligent/select/knowledge/summary?contentId=
 *   PPT 帧    GET /rman/v1/entity/file/screenshot?contentId=
 *   字幕      GET /rman/v1/search/webvtt?contentId=
 *
 * 数据一律走 background（内存缓存 30 分钟，不落盘），本页再做一层内存缓存。
 */

(function () {
  var $ = function (id) { return document.getElementById(id); };
  var P = window.PLAYER;
  var B = window.SUFEBridge;
  var EXT = !!(B && B.available);
  var SITE = 'https://dm.sufe.edu.cn';

  var side = $('side'), tabs = $('tabs'), pane = $('pane'), sideBtn = $('sideBtn');
  var TAB = 'sum';
  var OPEN = false;
  var MANUAL = false;          // 用户手动开过关过，就不再自动跟着单/双屏走
  var LOADED = {};             // tab -> 'loading' | 'ok' | 'fail'
  var DATA = {};               // tab -> 原始结果
  var CUES = [];               // 字幕 [{t, text, el}]
  var CUE_STARTS = [];         // 二分用的起播时间
  var CHAPS = [];              // 知识要点 [{el, s, e}]
  var follow = true;
  var curCue = -1;
  var timer = null;

  /* ---------------- 小工具 ---------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var mm = h ? String(m).padStart(2, '0') : String(m);
    return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
  }

  var toastEl = document.createElement('div');
  toastEl.className = 'toast';
  document.body.appendChild(toastEl);
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 2800);
  }

  /* ---------------- 开关 ---------------- */

  function setOpen(v) {
    OPEN = !!v;
    side.hidden = !OPEN;
    sideBtn.classList.toggle('on', OPEN);
    if (OPEN) {
      load(TAB);
      if (P && P.relayout) P.relayout();
    }
  }

  function auto(count) {
    if (MANUAL) return;
    setOpen(count === 1);
  }

  sideBtn.addEventListener('click', function () {
    MANUAL = true;
    setOpen(!OPEN);
  });

  /* ---------------- 标签 ---------------- */

  [].forEach.call(tabs.children, function (b) {
    b.addEventListener('click', function () {
      TAB = b.dataset.tab;
      [].forEach.call(tabs.children, function (x) { x.classList.toggle('on', x === b); });
      if (OPEN) load(TAB);
    });
  });

  function pickId(tab) {
    if (!P) return '';
    // 屏幕画面那一路才有摘要/字幕/知识点；单路时就用当前这一路
    return P.cid1 || P.cid2 || '';
  }

  function load(tab) {
    if (LOADED[tab] === 'ok') { render(tab); return; }
    if (LOADED[tab] === 'loading') return;
    if (!EXT) {
      pane.innerHTML = '<div class="perr">侧栏数据要靠扩展读取：请用扩展打开（点扩展图标）而不是直接双击文件。</div>';
      LOADED[tab] = 'fail';
      return;
    }
    var id = pickId(tab);
    if (!id) {
      pane.innerHTML = '<div class="perr">这个链接里没有 contentId，读不到概要。请从课程列表点「播放 / 双屏看」进来。</div>';
      LOADED[tab] = 'fail';
      return;
    }
    LOADED[tab] = 'loading';
    pane.innerHTML = '<div class="ph">正在读取' + tabName(tab) + '…</div>';

    var kind = KIND[tab] || tab;
    B.rich(kind, id).then(function (r) {
      if (TAB !== tab) return;                 // 中途切走了
      if (!r || !r.ok) {
        LOADED[tab] = 'fail';
        pane.innerHTML = '<div class="perr">没读到：' + esc((r && (r.error || r.message)) || '未知原因') + '</div>';
        return;
      }
      DATA[tab] = r;
      LOADED[tab] = 'ok';
      render(tab);
    });
  }

  function tabName(t) {
    return { sum: '本节概要', points: '知识要点', ppt: 'PPT 帧', sub: '字幕' }[t] || t;
  }

  // 标签 → 后台的 rich kind
  var KIND = { sum: 'keyword', points: 'summary', ppt: 'shots', sub: 'vtt' };

  /* ---------------- 渲染 ---------------- */

  function render(tab) {
    if (tab === 'sum') return renderSum(DATA.sum);
    if (tab === 'points') return renderPoints(DATA.points);
    if (tab === 'ppt') return renderPpt(DATA.ppt);
    if (tab === 'sub') return renderSub(DATA.sub);
  }

  function renderSum(r) {
    var d = (r.data && r.data.data) || {};
    var desc = d.description || '';
    var kw = d.keyword || [];
    if (!desc && !kw.length) {
      pane.innerHTML = '<div class="ph">这节课没有概要（教师画面那一路通常没有语音转写）。</div>';
      return;
    }
    var h = '';
    if (desc) h += '<div class="sec">本节概要</div><p class="sumtxt">' + esc(desc) + '</p>';
    if (kw.length) {
      h += '<div class="sec">关键词</div><div class="kw">' +
        kw.map(function (k) { return '<span>' + esc(k) + '</span>'; }).join('') + '</div>';
    }
    h += '<div class="sec">来源</div><div class="ph">keywordAndAbstract · ' + fmtBytes(r.bytes) +
      ' · ' + esc((r.at || '').slice(11, 19) + ' (UTC)') + (r.cached ? ' · 内存缓存' : '') + '</div>';
    pane.innerHTML = h;
  }

  function renderPoints(r) {
    var arr = (r.data && r.data.data) || [];
    if (!arr.length) {
      pane.innerHTML = '<div class="ph">这节课没有知识要点。</div>';
      return;
    }
    CHAPS = [];
    var h = arr.map(function (c) {
      var s = ticks(c.inPoint), e = ticks(c.outPoint);
      var kps = (c.knowledgePoints || []).map(function (k) {
        var ks = ticks(k.inPoint);
        return '<div class="kp" data-t="' + ks + '">' +
          '<span class="tmm">' + fmt(ks) + '</span>' +
          '<span class="kt">' + esc(k.title) + '</span></div>';
      }).join('');
      return '<div class="ch">' +
        '<div class="chh" data-t="' + s + '">' +
          '<span class="tmm">' + fmt(s) + '</span>' +
          '<span class="cht">' + esc(c.chapterTitle || '（未命名）') + '</span>' +
        '</div>' +
        (c.chapterContent ? '<div class="chc">' + esc(c.chapterContent) + '</div>' : '') +
        kps +
      '</div>';
    }).join('');
    pane.innerHTML = h;
    [].forEach.call(pane.querySelectorAll('.ch'), function (el, i) {
      CHAPS.push({ el: el, s: ticks(arr[i].inPoint), e: ticks(arr[i].outPoint) });
    });
  }

  function renderPpt(r) {
    var box = (r.data && r.data.data) || {};
    var arr = box.data || [];
    if (!arr.length) {
      pane.innerHTML = '<div class="ph">这节课没有抽到 PPT 帧。</div>';
      return;
    }
    var h = '<div class="sec">共 ' + (box.recordTotal || arr.length) + ' 帧 · 点一下就跳过去</div><div class="pgrid">' +
      arr.map(function (f) {
        var t = ticks(f.nextInPoint);
        return '<div class="pitem" data-t="' + t + '">' +
          '<img loading="lazy" src="' + SITE + esc(f.filePath || '') + '" alt="">' +
          '<div class="pt">' + fmt(t) + '</div></div>';
      }).join('') + '</div>';
    pane.innerHTML = h;
  }

  function renderSub(r) {
    var text = r.text || '';
    var cues = parseVtt(text);
    if (!cues.length) {
      pane.innerHTML = '<div class="ph">这节课没有字幕。</div>';
      return;
    }
    CUES = [];
    CUE_STARTS = [];
    curCue = -1;
    var h = '<div class="subbar">' +
      '<label><input type="checkbox" id="followChk" checked> 跟着播放走</label>' +
      '<span class="ph" style="padding:0">共 ' + cues.length + ' 句</span>' +
      '</div>' +
      cues.map(function (c, i) {
        return '<div class="cue" data-i="' + i + '" data-t="' + c.t + '">' +
          '<span class="ct">' + fmt(c.t) + '</span>' +
          '<span class="cx">' + esc(c.text) + '</span></div>';
      }).join('');
    pane.innerHTML = h;

    var els = pane.querySelectorAll('.cue');
    for (var i = 0; i < cues.length; i++) {
      CUES.push({ t: cues[i].t, el: els[i] });
      CUE_STARTS.push(cues[i].t);
    }
    var chk = $('followChk');
    if (chk) { chk.checked = follow; chk.onchange = function () { follow = chk.checked; }; }
  }

  function parseVtt(text) {
    var out = [];
    var blocks = String(text).replace(/\r/g, '').split('\n\n');
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i].trim();
      if (!b || b.indexOf('WEBVTT') === 0) continue;
      var lines = b.split('\n');
      var ti = -1;
      for (var j = 0; j < lines.length; j++) { if (lines[j].indexOf('-->') > 0) { ti = j; break; } }
      if (ti < 0) continue;
      var m = lines[ti].match(/(\d+):(\d{2}):(\d{2})\.(\d{3})/);
      if (!m) continue;
      var t = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
      var txt = lines.slice(ti + 1).join(' ').replace(/<[^>]+>/g, '').trim();
      if (!txt) continue;
      out.push({ t: t, text: txt });
    }
    return out;
  }

  function ticks(v) { return Math.max(0, (Number(v) || 0) / 1e7); }

  function fmtBytes(n) {
    n = Number(n) || 0;
    return n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';
  }

  /* ---------------- 点击跳转 ---------------- */

  pane.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-t]') : null;
    if (!el) return;
    var t = parseFloat(el.dataset.t);
    if (!isFinite(t)) return;
    if (P && P.seek) P.seek(t);
    var i = parseInt(el.dataset.i, 10);
    if (isFinite(i)) { highlightCue(i, true); }
  });

  /* ---------------- 跟随播放 ---------------- */

  function nowT() { return P && P.now ? P.now() : 0; }

  function lowerBound(arr, t) {
    var lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (arr[mid] <= t) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return ans;
  }

  function highlightCue(i, scroll) {
    if (i === curCue) {
      if (scroll && CUES[i] && CUES[i].el) CUES[i].el.scrollIntoView({ block: 'center' });
      return;
    }
    if (CUES[curCue] && CUES[curCue].el) CUES[curCue].el.classList.remove('on');
    curCue = i;
    if (CUES[i] && CUES[i].el) {
      CUES[i].el.classList.add('on');
      if (scroll) CUES[i].el.scrollIntoView({ block: 'center' });
    }
  }

  function tick() {
    if (!OPEN || !P) return;
    var t = nowT();
    if (TAB === 'sub' && CUE_STARTS.length) {
      var i = lowerBound(CUE_STARTS, t + 0.05);
      if (i !== curCue) highlightCue(i, follow);
    } else if (TAB === 'points' && CHAPS.length) {
      for (var k = 0; k < CHAPS.length; k++) {
        var c = CHAPS[k];
        c.el.classList.toggle('on', t >= c.s && t < c.e);
      }
    }
  }
  timer = setInterval(tick, 300);

  /* ---------------- 下载 ---------------- */

  function safeName(s) {
    return String(s || '回放').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 80);
  }

  function download(which) {
    var url = which === 1 ? (P && P.src1) : (P && P.src2);
    if (!url) { toast('这一路没有地址'); return; }
    var name = safeName(P.title) + '_' + (which === 1 ? '①' : '②') + '.mp4';
    if (EXT && B.download) {
      B.download(url, name).then(function (r) {
        toast(r && r.ok ? '已开始下载：' + name : '下载没起来：' + ((r && r.error) || '未知原因'));
      });
    } else {
      window.open(url, '_blank');
    }
  }

  $('dlBtn1').addEventListener('click', function () { download(1); });
  $('dlBtn2').addEventListener('click', function () { download(2); });
  if (P && P.dual && P.dual()) $('dlBtn2').hidden = false;

  /* ---------------- 对外 ---------------- */

  window.SIDE = { auto: auto, open: setOpen, load: load };

  // 播放器初始化时可能在 SIDE 出现前就调过 auto，这里补一次
  var w = $('vwrap');
  auto(w && w.dataset.count === '2' ? 2 : 1);
})();
