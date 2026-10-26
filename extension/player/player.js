(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const video = $('#video');
  const stage = $('#stage');
  const seek = $('#seek');
  const curEl = $('#cur');
  const durEl = $('#dur');
  const metaEl = $('#meta');
  const urlInput = $('#url');
  const titleInput = $('#title');
  const splash = $('#splash');
  const toastEl = $('#toast');
  const speedBtn = $('#speedBtn');
  const speedMenu = $('#speedMenu');
  const volEl = $('#vol');

  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const ls = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem('sufe.' + k)); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('sufe.' + k, JSON.stringify(v)); } catch {} },
  };

  const fmt = (t) => {
    if (!isFinite(t) || t < 0) t = 0;
    const s = Math.floor(t % 60), m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
    const p = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
  };

  const hash = (str) => {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  };
  const norm = (u) => u.split('#')[0].split('?')[0];
  let key = '';

  /* ---------- 提示 ---------- */
  let toastTimer = 0;
  function toast(msg, ms = 1800) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  /* ---------- 加载 ---------- */
  let corsRetried = false;
  function load(url, opts = {}) {
    url = (url || '').trim();
    if (!url) return toast('先粘贴一个视频直链');
    if (!/^https?:|^blob:|^\//.test(url)) return toast('链接格式不对，需要 http(s) 开头');
    corsRetried = false;
    urlInput.value = url;
    key = hash(norm(url));
    titleInput.value = ls.get('title.' + key, '');
    video.crossOrigin = 'anonymous';
    video.src = url;
    video.load();
    splash.classList.add('hidden');
    renderMarks();
    renderNotes();
    try { history.replaceState(null, '', '?src=' + encodeURIComponent(url)); } catch {}
    if (opts.autoplay) video.play().catch(() => {});
  }

  video.addEventListener('error', () => {
    if (video.crossOrigin && !corsRetried) {
      corsRetried = true;
      toast('跨域受限，已切换为普通模式（截图可能不可用）');
      video.crossOrigin = null;
      video.src = urlInput.value;
      video.load();
      return;
    }
    if (video.error) toast('加载失败：' + (video.error.message || '网络或链接已失效'));
  });

  /* ---------- 元信息与进度 ---------- */
  let lastSave = 0;
  function persist() {
    if (!key || !isFinite(video.duration) || video.duration <= 0) return;
    ls.set('pos.' + key, { t: video.currentTime, d: video.duration, at: Date.now() });
    ls.set('rate.' + key, video.playbackRate);
  }

  video.addEventListener('loadedmetadata', () => {
    durEl.textContent = fmt(video.duration);
    metaEl.textContent = [
      fmt(video.duration),
      video.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : '',
      video.playbackRate !== 1 ? `${video.playbackRate}×` : '',
    ].filter(Boolean).join(' · ');

    const saved = ls.get('pos.' + key, null);
    const rate = ls.get('rate.' + key, 1);
    if (rate && rate !== 1 && SPEEDS.includes(rate)) setRate(rate, false);
    if (saved && saved.d > 0 && Math.abs(saved.d - video.duration) < 30 && saved.t > 8 && saved.t < video.duration - 15) {
      video.currentTime = saved.t;
      toast(`已续播到 ${fmt(saved.t)}`);
    }
    paint();
  });

  video.addEventListener('timeupdate', () => {
    paint();
    if (Date.now() - lastSave > 3000) { lastSave = Date.now(); persist(); }
  });
  video.addEventListener('progress', paint);
  video.addEventListener('play', () => { $('#play').textContent = '⏸'; });
  video.addEventListener('pause', () => { $('#play').textContent = '▶'; persist(); });

  function paint() {
    const d = video.duration || 0;
    const c = video.currentTime || 0;
    const p = d ? (c / d) * 100 : 0;
    let buffered = 0;
    if (video.buffered && video.buffered.length) {
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= c + 0.25) buffered = Math.max(buffered, video.buffered.end(i));
      }
    }
    const b = d ? (buffered / d) * 100 : 0;
    seek.style.setProperty('--p', p + '%');
    seek.style.setProperty('--b', Math.max(b, p) + '%');
    if (!seeking) seek.value = Math.round(p * 10);
    curEl.textContent = fmt(c);
    durEl.textContent = d ? fmt(d) : '00:00';
  }

  let seeking = false;
  seek.addEventListener('input', () => {
    seeking = true;
    if (isFinite(video.duration) && video.duration > 0) {
      curEl.textContent = fmt((seek.value / 1000) * video.duration);
    }
  });
  seek.addEventListener('change', () => {
    if (isFinite(video.duration) && video.duration > 0) {
      video.currentTime = (seek.value / 1000) * video.duration;
    }
    seeking = false;
  });

  /* ---------- 播放控制 ---------- */
  const toggle = () => { if (video.paused) video.play().catch(() => toast('浏览器阻止了自动播放，点一下画面')); else video.pause(); };
  $('#play').addEventListener('click', toggle);
  stage.addEventListener('click', (e) => {
    if (e.target.closest('.controls') || e.target.closest('.menu')) return;
    toggle();
  });
  stage.addEventListener('dblclick', (e) => {
    if (e.target.closest('.controls')) return;
    toggleFs();
  });

  function setRate(r, notify = true) {
    video.playbackRate = r;
    speedBtn.textContent = (Number.isInteger(r) ? String(r) : String(r)) + '×';
    speedMenu.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.r) === r));
    if (key) ls.set('rate.' + key, r);
    if (notify) toast(`${r}× 速度`);
  }

  SPEEDS.forEach((r) => {
    const b = document.createElement('button');
    b.dataset.r = r;
    b.innerHTML = `<span>${r}×</span><span>${r === 1 ? '正常' : ''}</span>`;
    b.addEventListener('click', () => { setRate(r); speedMenu.classList.remove('open'); });
    speedMenu.appendChild(b);
  });

  speedBtn.addEventListener('click', (e) => { e.stopPropagation(); speedMenu.classList.toggle('open'); });
  document.addEventListener('click', () => speedMenu.classList.remove('open'));

  function toggleMute() {
    video.muted = !video.muted;
    $('#volBtn').textContent = video.muted || video.volume === 0 ? '🔇' : '🔊';
    toast(video.muted ? '静音' : '取消静音');
  }
  $('#volBtn').addEventListener('click', toggleMute);
  volEl.addEventListener('input', () => { video.volume = volEl.value / 100; video.muted = false; $('#volBtn').textContent = '🔊'; });

  function toggleFs() {
    if (document.fullscreenElement) document.exitFullscreen();
    else stage.requestFullscreen().catch(() => toast('当前浏览器不允许全屏'));
  }
  $('#fs').addEventListener('click', toggleFs);
  document.addEventListener('fullscreenchange', () => { $('#fs').textContent = document.fullscreenElement ? '⤢' : '⛶'; });

  $('#pip').addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch { toast('画中画不可用'); }
  });

  async function shot() {
    if (!video.videoWidth) return toast('视频还没加载');
    try {
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      const a = document.createElement('a');
      a.href = c.toDataURL('image/png');
      a.download = `frame-${fmt(video.currentTime).replace(/:/g, '-')}.png`;
      a.click();
      toast('已截图');
    } catch { toast('截图失败：视频源不允许跨域读取'); }
  }
  $('#shot').addEventListener('click', shot);

  $('#copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(urlInput.value); toast('直链已复制'); }
    catch { toast('复制失败，请手动选中'); }
  });

  /* ---------- 书签 ---------- */
  function marks() { return ls.get('marks.' + key, []); }
  function saveMarks(list) { ls.set('marks.' + key, list); renderMarks(); }

  function renderMarks() {
    const ul = $('#marks');
    const list = key ? marks() : [];
    ul.innerHTML = '';
    $('#marksEmpty').style.display = list.length ? 'none' : '';
    list.forEach((m, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="t">${fmt(m.t)}</span><span class="l"></span><button class="x" title="删除">✕</button>`;
      li.querySelector('.l').textContent = m.label || fmt(m.t);
      li.addEventListener('click', (e) => {
        if (e.target.classList.contains('x')) return;
        video.currentTime = m.t; video.play().catch(() => {});
      });
      li.querySelector('.x').addEventListener('click', (e) => {
        e.stopPropagation();
        const l2 = marks(); l2.splice(i, 1); saveMarks(l2);
      });
      ul.appendChild(li);
    });
  }

  function addMark() {
    if (!key) return toast('先加载视频');
    const list = marks();
    const t = video.currentTime;
    list.push({ t, label: fmt(t) });
    list.sort((a, b) => a.t - b.t);
    saveMarks(list);
    toast(`书签 ${fmt(t)}`);
  }
  $('#addMark').addEventListener('click', addMark);

  /* ---------- 笔记 ---------- */
  function notes() { return ls.get('notes.' + key, []); }
  function saveNotes(list) { ls.set('notes.' + key, list); renderNotes(); }

  let editingAt = 0;
  function openEditor() {
    if (!key) return toast('先加载视频');
    editingAt = video.currentTime;
    $('#noteAt').textContent = '记于 ' + fmt(editingAt);
    $('#editor').classList.add('on');
    $('#noteText').focus();
  }
  $('#addNote').addEventListener('click', openEditor);
  $('#saveNote').addEventListener('click', () => {
    const text = $('#noteText').value.trim();
    if (!text) return toast('内容为空');
    const list = notes();
    list.push({ t: editingAt, text, at: Date.now() });
    list.sort((a, b) => a.t - b.t);
    saveNotes(list);
    $('#noteText').value = '';
    $('#editor').classList.remove('on');
    toast('笔记已保存');
  });

  function renderNotes() {
    const ul = $('#notes');
    const list = key ? notes() : [];
    ul.innerHTML = '';
    $('#notesEmpty').style.display = list.length ? 'none' : '';
    list.forEach((n, i) => {
      const li = document.createElement('li');
      li.style.alignItems = 'flex-start';
      li.innerHTML = `<span class="t">${fmt(n.t)}</span><span class="l"></span><button class="x" title="删除">✕</button>`;
      const l = li.querySelector('.l');
      l.textContent = n.text;
      l.style.whiteSpace = 'normal';
      li.addEventListener('click', (e) => {
        if (e.target.classList.contains('x')) return;
        video.currentTime = n.t; video.play().catch(() => {});
      });
      li.querySelector('.x').addEventListener('click', (e) => {
        e.stopPropagation();
        const l2 = notes(); l2.splice(i, 1); saveNotes(l2);
      });
      ul.appendChild(li);
    });
  }

  /* ---------- 标题 ---------- */
  titleInput.addEventListener('input', () => { if (key) ls.set('title.' + key, titleInput.value); });

  /* ---------- 快捷键 ---------- */
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const step = e.shiftKey ? 30 : 5;
    switch (e.key) {
      case ' ': e.preventDefault(); toggle(); break;
      case 'ArrowLeft': e.preventDefault(); video.currentTime = Math.max(0, video.currentTime - step); toast(`-${step}s`); break;
      case 'ArrowRight': e.preventDefault(); video.currentTime = Math.min(video.duration || 0, video.currentTime + step); toast(`+${step}s`); break;
      case 'j': case 'J': video.currentTime = Math.max(0, video.currentTime - 10); toast('-10s'); break;
      case 'l': case 'L': video.currentTime = Math.min(video.duration || 0, video.currentTime + 10); toast('+10s'); break;
      case 'ArrowUp': e.preventDefault(); video.volume = Math.min(1, video.volume + 0.05); volEl.value = video.volume * 100; toast(`音量 ${Math.round(video.volume * 100)}%`); break;
      case 'ArrowDown': e.preventDefault(); video.volume = Math.max(0, video.volume - 0.05); volEl.value = video.volume * 100; toast(`音量 ${Math.round(video.volume * 100)}%`); break;
      case 'm': case 'M': toggleMute(); break;
      case 'f': case 'F': toggleFs(); break;
      case 'p': case 'P': $('#pip').click(); break;
      case 's': case 'S': shot(); break;
      case 'b': case 'B': addMark(); break;
      case 'n': case 'N': openEditor(); break;
      case '[': {
        const i = SPEEDS.indexOf(video.playbackRate);
        setRate(SPEEDS[Math.max(0, (i < 0 ? SPEEDS.indexOf(1) : i) - 1)]); break;
      }
      case ']': {
        const i = SPEEDS.indexOf(video.playbackRate);
        setRate(SPEEDS[Math.min(SPEEDS.length - 1, (i < 0 ? SPEEDS.indexOf(1) : i) + 1)]); break;
      }
      case '?': toast('Space 播放 · ←→ 5s · J/L 10s · ↑↓ 音量 · [ ] 倍速 · S 截图 · B 书签 · N 笔记 · F 全屏 · P 画中画', 5000); break;
      default: break;
    }
  });

  /* ---------- 控件自动隐藏 ---------- */
  let idleTimer = 0;
  function wake() {
    stage.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!video.paused) stage.classList.add('idle'); }, 2600);
  }
  stage.addEventListener('mousemove', wake);
  stage.addEventListener('mouseleave', () => { if (!video.paused) stage.classList.add('idle'); });

  /* ---------- 启动 ---------- */
  const params = new URLSearchParams(location.search);
  const src = params.get('src');
  if (src) load(src);
  else {
    const last = ls.get('lastUrl', '');
    if (last) {
      urlInput.value = last;
      urlInput.addEventListener('focus', () => urlInput.select(), { once: true });
    }
  }
  urlInput.addEventListener('change', () => ls.set('lastUrl', urlInput.value.trim()));
  $('#load').addEventListener('click', () => load(urlInput.value, { autoplay: true }));
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); load(urlInput.value, { autoplay: true }); } });

  window.addEventListener('beforeunload', persist);
  setInterval(() => { if (!video.paused) persist(); }, 5000);
})();