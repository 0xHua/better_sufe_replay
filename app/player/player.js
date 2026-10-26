(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage'), vwrap = $('vwrap'), wmEl = $('wm');
  var v1 = $('v1'), v2 = $('v2'), cell2 = $('cell2');
  var seek = $('seek'), fill = $('fill'), buf = $('buf'), knob = $('knob');
  var playBtn = $('playBtn'), curEl = $('cur'), durEl = $('dur');
  var rateSel = $('rate'), fsBtn = $('fsBtn');

  var Q = new URLSearchParams(location.search);
  var SRC1 = Q.get('src') || '';
  var SRC2 = Q.get('src2') || '';
  var TITLE = Q.get('title') || '回放';
  var SUB = Q.get('sub') || '';
  var START = parseFloat(Q.get('t') || '0') || 0;
  var WM = Q.get('wm') || '';
  var C1 = Q.get('c1') || '';
  var C2 = Q.get('c2') || '';
  var DUAL = !!SRC2;

  var PREF_KEY = 'sufe.player.prefs';
  var prefs = {
    rate: 1, theme: 'light',
    count: 1, mode: 'side', sync: true, off: 0,
    vol1: 1, vol2: 0, mute1: false, mute2: true,
    pipTarget: 2, pipX: 1, pipY: 1
  };
  try {
    var raw = localStorage.getItem(PREF_KEY);
    if (raw) prefs = Object.assign(prefs, JSON.parse(raw));
  } catch (e) {}
  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  /* 地址参数优先 */
  if (Q.get('mode')) prefs.mode = Q.get('mode');
  if (Q.get('count')) prefs.count = parseInt(Q.get('count'), 10) === 2 ? 2 : 1;
  if (Q.get('sync') === '0') prefs.sync = false;
  if (Q.get('sync') === '1') prefs.sync = true;
  if (Q.get('off')) prefs.off = parseFloat(Q.get('off')) || 0;

  var COUNT = DUAL && prefs.count === 2 ? 2 : 1;
  var MODE = prefs.mode || 'side';
  var SYNC = !!prefs.sync;
  var OFF = Math.max(-20, Math.min(20, Number(prefs.off) || 0));
  var vol = { 1: clamp01(prefs.vol1), 2: clamp01(prefs.vol2) };
  var mute = { 1: !!prefs.mute1, 2: DUAL ? !!prefs.mute2 : true };
  var PIP = {
    target: prefs.pipTarget === 1 ? 1 : 2,
    x: Math.max(0, Math.min(1, Number(prefs.pipX))),
    y: Math.max(0, Math.min(1, Number(prefs.pipY)))
  };
  if (!isFinite(PIP.x)) PIP.x = 1;
  if (!isFinite(PIP.y)) PIP.y = 1;

  function clamp01(x) { x = Number(x); return isFinite(x) ? Math.max(0, Math.min(1, x)) : 1; }

  /* ---------------- 顶栏 ---------------- */
  $('title').textContent = TITLE;
  $('subtitle').textContent = SUB;
  document.title = TITLE + ' · 回放';

  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    $('themeBtn').textContent = t === 'dark' ? '浅色' : '深色';
    prefs.theme = t;
    savePrefs();
  }
  applyTheme(prefs.theme);
  $('themeBtn').onclick = function () {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  };

  /* ---------------- 时间 ---------------- */
  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    t = Math.floor(t);
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    var mm = h ? ('0' + m).slice(-2) : String(m);
    return (h ? h + ':' : '') + mm + ':' + ('0' + s).slice(-2);
  }
  function dur() { return isFinite(v1.duration) ? v1.duration : 0; }

  /* ---------------- 进度条（认第一路为主时钟） ---------------- */
  function paint() {
    var d = dur();
    var p = d ? (v1.currentTime / d) * 100 : 0;
    fill.style.width = p + '%';
    knob.style.left = p + '%';
    curEl.textContent = fmt(v1.currentTime);
    durEl.textContent = d ? fmt(d) : '0:00';
    if (v1.buffered && v1.buffered.length) {
      var end = 0;
      for (var i = 0; i < v1.buffered.length; i++) {
        if (v1.buffered.start(i) <= v1.currentTime + 0.5) end = Math.max(end, v1.buffered.end(i));
      }
      if (!end) end = v1.buffered.end(v1.buffered.length - 1);
      buf.style.width = d ? (end / d) * 100 + '%' : '0%';
    }
  }

  var dragging = false;
  function seekTo(clientX) {
    var r = seek.getBoundingClientRect();
    var x = Math.max(0, Math.min(clientX - r.left, r.width));
    var d = dur();
    if (!d) return;
    setTime((x / r.width) * d);
    paint();
  }
  function setTime(t) {
    v1.currentTime = t;
    if (DUAL && COUNT === 2 && SYNC) v2.currentTime = Math.max(0, t + OFF);
  }
  seek.addEventListener('pointerdown', function (e) {
    dragging = true;
    seek.setPointerCapture(e.pointerId);
    seekTo(e.clientX);
  });
  seek.addEventListener('pointermove', function (e) { if (dragging) seekTo(e.clientX); });
  seek.addEventListener('pointerup', function (e) {
    dragging = false;
    try { seek.releasePointerCapture(e.pointerId); } catch (x) {}
  });
  seek.addEventListener('pointercancel', function () { dragging = false; });

  /* ---------------- 播放/暂停（第一路带队） ---------------- */
  function setPlayIcon() {
    playBtn.textContent = v1.paused ? '▶' : '❚❚';
    playBtn.title = v1.paused ? '播放（空格）' : '暂停（空格）';
  }
  function playAll() {
    var p = v1.play();
    if (p && p.catch) p.catch(function () {});
    if (DUAL && COUNT === 2) {
      if (SYNC) v2.currentTime = Math.max(0, v1.currentTime + OFF);
      var p2 = v2.play();
      if (p2 && p2.catch) p2.catch(function () {});
    }
  }
  function pauseAll() {
    v1.pause();
    if (DUAL) v2.pause();
  }
  function toggle() {
    if (v1.paused) playAll(); else pauseAll();
  }
  playBtn.onclick = toggle;
  vwrap.addEventListener('click', function (e) {
    if (Date.now() - dragEndAt < 350) return;      // 刚拖过小窗，别把这一下当点击
    var cell = e.target && e.target.closest ? e.target.closest('.cell') : null;
    if (cell) toggle();
  });
  v1.addEventListener('play', setPlayIcon);
  v1.addEventListener('pause', setPlayIcon);
  v1.addEventListener('play', function () { if (DUAL && COUNT === 2) { var p = v2.play(); if (p && p.catch) p.catch(function () {}); } });

  /* ---------------- 同步：每帧纠正第二路 ---------------- */
  function loop() {
    if (DUAL && COUNT === 2 && SYNC && !v1.paused && !v2.paused) {
      var target = v1.currentTime + OFF;
      if (Math.abs(v2.currentTime - target) > 0.25) {
        try { v2.currentTime = Math.max(0, target); } catch (e) {}
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /* ---------------- 倍速（两路同速） ---------------- */
  function applyRate(r) {
    v1.playbackRate = r;
    if (DUAL) v2.playbackRate = r;
    var s = String(r);
    var ok = false;
    for (var i = 0; i < rateSel.options.length; i++) {
      if (rateSel.options[i].value === s) ok = true;
    }
    if (!ok) {
      var o = document.createElement('option');
      o.value = s; o.textContent = s + '×';
      rateSel.appendChild(o);
    }
    rateSel.value = s;
    prefs.rate = r;
    savePrefs();
  }
  rateSel.addEventListener('change', function () { applyRate(parseFloat(rateSel.value) || 1); });

  /* ---------------- 音量（每一路独立） ---------------- */
  function volIcon(i) {
    if (mute[i] || vol[i] === 0) return '🔇';
    return vol[i] < 0.5 ? '🔉' : '🔊';
  }
  function syncAudio(i, fromUser) {
    var vv = i === 1 ? v1 : v2;
    vv.volume = vol[i];
    vv.muted = !!mute[i];
    var btn = $(i === 1 ? 'mute1' : 'mute2');
    var rng = $(i === 1 ? 'vol1' : 'vol2');
    if (btn) { btn.textContent = volIcon(i); btn.title = (mute[i] ? '取消静音' : '静音') + '第' + i + '路'; }
    if (rng) rng.value = String(vol[i]);
    if (fromUser) {
      prefs['vol' + i] = vol[i];
      prefs['mute' + i] = mute[i];
      savePrefs();
    }
  }
  [1, 2].forEach(function (i) {
    var rng = $(i === 1 ? 'vol1' : 'vol2');
    var btn = $(i === 1 ? 'mute1' : 'mute2');
    if (rng) rng.addEventListener('input', function () {
      vol[i] = clamp01(rng.value);
      if (vol[i] > 0) mute[i] = false;
      syncAudio(i, true);
    });
    if (btn) btn.onclick = function () {
      mute[i] = !mute[i];
      if (!mute[i] && vol[i] === 0) vol[i] = 0.5;
      syncAudio(i, true);
    };
  });

  /* ---------------- 屏幕数量 / 位置 / 小窗 ---------------- */
  function pipCell() { return PIP.target === 1 ? $('cell1') : cell2; }
  function otherCell() { return PIP.target === 1 ? cell2 : $('cell1'); }

  function applyPip() {
    var on = MODE === 'pip' && COUNT === 2;
    $('segPip').hidden = !on;
    $('pipHint').hidden = !on;
    [$('cell1'), cell2].forEach(function (c) {
      c.classList.remove('pip-on');
      c.style.left = '';
      c.style.top = '';
    });
    if (on) pipCell().classList.add('pip-on');
    [].forEach.call($('segPip').children, function (b) {
      b.classList.toggle('on', parseInt(b.dataset.pip, 10) === PIP.target);
    });
    if (on) requestAnimationFrame(applyPipPos);
  }

  function applyPipPos() {
    if (MODE !== 'pip' || COUNT !== 2) return;
    var el = pipCell();
    if (!el) return;
    var maxL = Math.max(0, vwrap.clientWidth - el.offsetWidth);
    var maxT = Math.max(0, vwrap.clientHeight - el.offsetHeight);
    el.style.left = Math.round(PIP.x * maxL) + 'px';
    el.style.top = Math.round(PIP.y * maxT) + 'px';
  }

  function setPipTarget(n) {
    PIP.target = n === 1 ? 1 : 2;
    prefs.pipTarget = PIP.target;
    savePrefs();
    applyPip();
  }
  [].forEach.call($('segPip').children, function (b) {
    b.onclick = function () { setPipTarget(parseInt(b.dataset.pip, 10)); };
  });

  /* 拖动小窗：按在画面上拖即可；没拖动算一次点击 = 播放/暂停 */
  var dragPip = null, dragEndAt = 0;
  vwrap.addEventListener('pointerdown', function (e) {
    if (MODE !== 'pip' || COUNT !== 2) return;
    var cell = e.target && e.target.closest ? e.target.closest('.cell') : null;
    if (!cell || !cell.classList.contains('pip-on')) return;
    dragPip = { id: e.pointerId, x: e.clientX, y: e.clientY, left: cell.offsetLeft, top: cell.offsetTop, moved: false, el: cell };
    try { cell.setPointerCapture(e.pointerId); } catch (x) {}
  });
  vwrap.addEventListener('pointermove', function (e) {
    if (!dragPip || e.pointerId !== dragPip.id) return;
    var dx = e.clientX - dragPip.x, dy = e.clientY - dragPip.y;
    if (!dragPip.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    dragPip.moved = true;
    var el = dragPip.el;
    var maxL = Math.max(0, vwrap.clientWidth - el.offsetWidth);
    var maxT = Math.max(0, vwrap.clientHeight - el.offsetHeight);
    el.style.left = Math.max(0, Math.min(maxL, dragPip.left + dx)) + 'px';
    el.style.top = Math.max(0, Math.min(maxT, dragPip.top + dy)) + 'px';
    e.preventDefault();
  });
  function endPipDrag(e) {
    if (!dragPip || (e && e.pointerId !== dragPip.id)) return;
    var el = dragPip.el, moved = dragPip.moved;
    try { el.releasePointerCapture(dragPip.id); } catch (x) {}
    dragPip = null;
    if (moved) {
      dragEndAt = Date.now();
      var maxL = Math.max(1, vwrap.clientWidth - el.offsetWidth);
      var maxT = Math.max(1, vwrap.clientHeight - el.offsetHeight);
      PIP.x = Math.max(0, Math.min(1, el.offsetLeft / maxL));
      PIP.y = Math.max(0, Math.min(1, el.offsetTop / maxT));
      prefs.pipX = +PIP.x.toFixed(3);
      prefs.pipY = +PIP.y.toFixed(3);
      savePrefs();
    }
  }
  vwrap.addEventListener('pointerup', endPipDrag);
  vwrap.addEventListener('pointercancel', endPipDrag);
  window.addEventListener('resize', applyPipPos);

  function setCount(n) {
    COUNT = DUAL && n === 2 ? 2 : 1;
    vwrap.dataset.count = String(COUNT);
    cell2.hidden = COUNT !== 2;
    $('ach2').hidden = COUNT !== 2;
    $('posGrp').hidden = COUNT !== 2;
    $('syncGrp').hidden = COUNT !== 2;
    [].forEach.call($('segCount').children, function (b) {
      b.classList.toggle('on', parseInt(b.dataset.count, 10) === COUNT);
    });
    prefs.count = COUNT;
    savePrefs();
    if (window.SIDE && window.SIDE.auto) window.SIDE.auto(COUNT);
    if (COUNT === 2 && !v1.paused) {
      if (SYNC) v2.currentTime = Math.max(0, v1.currentTime + OFF);
      var p = v2.play(); if (p && p.catch) p.catch(function () {});
    } else {
      v2.pause();
    }
    applyPip();
  }
  function setMode(m) {
    MODE = m;
    vwrap.dataset.mode = m;
    [].forEach.call($('segMode').children, function (b) {
      b.classList.toggle('on', b.dataset.mode === m);
    });
    prefs.mode = m;
    savePrefs();
    applyPip();
  }
  [].forEach.call($('segCount').children, function (b) {
    if (parseInt(b.dataset.count, 10) === 2 && !DUAL) {
      b.disabled = true;
      b.title = '这个链接只有一路画面';
    }
    b.onclick = function () { if (!b.disabled) setCount(parseInt(b.dataset.count, 10)); };
  });
  [].forEach.call($('segMode').children, function (b) {
    b.onclick = function () { setMode(b.dataset.mode); };
  });

  /* ---------------- 时轴同步 + 时间差 ---------------- */
  function shiftSecond() {
    if (DUAL && COUNT === 2 && SYNC) v2.currentTime = Math.max(0, v1.currentTime + OFF);
  }
  function setOff(x, fromUser, shift) {
    OFF = Math.round(Math.max(-20, Math.min(20, x)) * 10) / 10;
    $('off').value = String(OFF);
    $('offv').textContent = (OFF > 0 ? '+' : '') + OFF.toFixed(1) + 's';
    if (fromUser) { prefs.off = OFF; savePrefs(); }
    if (shift) shiftSecond();
  }
  $('syncOn').checked = SYNC;
  $('syncOn').onchange = function () {
    SYNC = $('syncOn').checked;
    prefs.sync = SYNC;
    savePrefs();
    shiftSecond();
  };
  // 拖动时只更新数字，松手才真正 seek（2GB 的片子连续 seek 会卡）
  $('off').addEventListener('input', function () { setOff(parseFloat($('off').value), true, false); });
  $('off').addEventListener('change', function () { setOff(parseFloat($('off').value), true, true); });
  $('offM').onclick = function () { setOff(OFF - 0.1, true, true); };
  $('offP').onclick = function () { setOff(OFF + 0.1, true, true); };
  $('off0').onclick = function () { setOff(0, true, true); };

  /* ---------------- 全屏 ---------------- */
  function isFs() { return document.fullscreenElement === stage; }
  function toggleFs() {
    if (isFs()) document.exitFullscreen();
    else if (stage.requestFullscreen) stage.requestFullscreen().catch(function () {});
  }
  fsBtn.onclick = toggleFs;
  document.addEventListener('fullscreenchange', function () {
    fsBtn.textContent = isFs() ? '⤢' : '⛶';
  });

  /* ---------------- 水印（有 ?wm= 才画） ---------------- */
  function drawWatermark() {
    if (!WM) return;
    wmEl.innerHTML = '';
    for (var r = 0; r < 4; r++) {
      for (var c = 0; c < 3; c++) {
        var s = document.createElement('span');
        s.textContent = WM;
        s.style.left = (c * 34 + 6) + '%';
        s.style.top = (r * 25 + 6) + '%';
        s.style.transform = 'rotate(-18deg)';
        wmEl.appendChild(s);
      }
    }
  }
  drawWatermark();

  /* ---------------- 快捷键：只留三个 ---------------- */
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    var tag = t && t.tagName ? t.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

    var k = e.key;
    if (k === ' ' || k === 'Spacebar' || e.code === 'Space') {
      e.preventDefault();
      toggle();
      return;
    }
    if (k === 'ArrowLeft') { e.preventDefault(); setTime(Math.max(0, v1.currentTime - 5)); paint(); return; }
    if (k === 'ArrowRight') { e.preventDefault(); setTime(Math.min(dur() || 1e9, v1.currentTime + 5)); paint(); return; }
  });

  /* ---------------- 事件 ---------------- */
  function bindCell(v, ov, ovtext, idx) {
    v.addEventListener('loadedmetadata', function () {
      ov.classList.add('hide');
      if (idx === 1) {
        paint();
        if (START > 0 && START < dur()) setTime(START);
        applyRate(prefs.rate || 1);
        setPlayIcon();
      }
    });
    v.addEventListener('waiting', function () {
      if (v.paused) return;
      ovtext.textContent = '缓冲中…';
      ov.classList.remove('hide');
      ov.classList.remove('err');
    });
    v.addEventListener('playing', function () { ov.classList.add('hide'); });
    v.addEventListener('canplay', function () { if (v.readyState >= 2) ov.classList.add('hide'); });
    v.addEventListener('pause', function () {
      if (v.readyState >= 2 && !ov.classList.contains('err')) ov.classList.add('hide');
    });
    v.addEventListener('seeking', function () { ovtext.textContent = '定位中…'; });
    v.addEventListener('error', function () {
      ov.classList.remove('hide');
      ov.classList.add('err');
      var c = v.error ? v.error.code : 0;
      ovtext.textContent = c === 4
        ? '这个地址播不了（可能没登录、或链接已过期）。回到课程列表重新打开一次。'
        : '读取失败（错误码 ' + c + '）';
    });
  }
  bindCell(v1, $('ov1'), $('ovtext1'), 1);
  bindCell(v2, $('ov2'), $('ovtext2'), 2);
  v1.addEventListener('timeupdate', paint);
  v1.addEventListener('progress', paint);
  v1.addEventListener('durationchange', paint);

  /* ---------------- 初始化 ---------------- */
  if (!SRC1) {
    $('ov1').classList.add('err');
    $('ovtext1').textContent = '没有拿到播放地址。请从课程列表里点「播放」。';
    $('opts').hidden = true;
    return;
  }

  if (!DUAL) {
    $('tag2').hidden = true;
    $('segCount').children[1].disabled = true;
    $('segCount').children[1].title = '这个链接只有一路画面';
  }
  $('tag1').textContent = DUAL ? '① 屏幕' : '画面';
  $('tag2').textContent = '② 教师';

  setMode(MODE);
  setCount(COUNT);
  setOff(OFF);
  applyRate(prefs.rate || 1);
  syncAudio(1);
  syncAudio(2);

  v1.src = SRC1;
  if (DUAL) v2.src = SRC2;
  setPlayIcon();
  paint();

  /* ---------------- 给侧栏（side.js）用的接口 ---------------- */
  window.PLAYER = {
    seek: function (t) { setTime(Math.max(0, Number(t) || 0)); paint(); },
    now: function () { return v1.currentTime; },
    total: dur,
    paused: function () { return v1.paused; },
    play: playAll,
    dual: function () { return DUAL; },
    src1: SRC1,
    src2: SRC2,
    cid1: C1,
    cid2: C2,
    title: TITLE,
    sub: SUB,
    relayout: function () { applyPipPos(); paint(); },
  };
  if (window.SIDE && window.SIDE.auto) window.SIDE.auto(COUNT);
})();
