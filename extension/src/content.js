/* 上财空中课堂 · 回放增强 —— 内容脚本 (ISOLATED world)
 *
 * 职责：
 *   1. 读取本机登录态 token（localStorage['x-cas-token-app']），交给扩展后台，
 *      让扩展可以「复用用户已登录的会话」而不是去代填密码。
 *   2. 嗅探视频直链：performance 资源时间线 + DOM <video> 双路采集。
 *   3. 采集接口路径，供诊断导出（不含任何凭据）。
 *   4. 响应 popup 的快照请求。
 *
 * 隐私：token 只在 content script 与扩展后台之间传递，不出本机、不发网络。
 */
(() => {
  if (window.__SUFE_REPLAY_CS__) return;
  window.__SUFE_REPLAY_CS__ = true;

  const MEDIA_RE = /\.(mp4|m3u8|flv|webm)(\?|#|$)/i;
  const API_RE = /videoreview|\/unifiedplatform\/|\/learn\/(?!static\/)[a-z]/i;
  const ASSET_RE = /\.(js|css|png|jpe?g|gif|svg|ico|woff2?|ttf|map)(\?|#|$)/i;

  const MEDIA_MAX = 300;
  const API_MAX = 300;
  const media = new Map();
  const api = new Map();
  let lastToken = null;
  let sentToken = false;

  /* ---------- 工具 ---------- */

  function redact(u) {
    return String(u).replace(/(x-cas-token|cookie|token|ticket|session|sid)=[^&#]*/gi, '$1=<hidden>');
  }

  function send(msg) {
    try {
      chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError);
    } catch (_) {
      /* 扩展被重载后 context 失效，忽略 */
    }
  }

  function pushMedia(url, via) {
    if (!url || typeof url !== 'string') return;
    const key = url.split('#')[0];
    if (media.has(key)) return;
    if (media.size >= MEDIA_MAX) return;
    media.set(key, { url: key, display: redact(key), via, at: Date.now() });
    send({ type: 'MEDIA', items: [{ url: key, page: location.href }] });
  }

  function pushApi(url, method) {
    const key = String(url).split('#')[0];
    if (api.has(key) || api.size >= API_MAX) return;
    api.set(key, { url: key, display: redact(key), method: method || null, at: Date.now() });
    send({ type: 'API', items: [{ url: key, page: location.href }] });
  }

  /* ---------- 采集 ---------- */

  function scanResources() {
    let entries;
    try {
      entries = performance.getEntriesByType('resource');
    } catch (_) {
      return;
    }
    for (const e of entries) {
      const u = e && e.name;
      if (!u) continue;
      if (MEDIA_RE.test(u)) pushMedia(u, 'performance');
      else if (API_RE.test(u) && !ASSET_RE.test(u)) pushApi(u, (e.renderBlockingStatus && null) || null);
    }
  }

  function scanDom() {
    try {
      for (const v of document.querySelectorAll('video')) {
        const src = v.currentSrc || v.src || '';
        if (src) pushMedia(src, 'video.currentSrc');
        const s = v.querySelector('source');
        if (s && s.src) pushMedia(s.src, 'video.source');
        const d = v.getAttribute('data-src') || v.getAttribute('data-url');
        if (d) pushMedia(d, 'video.data-attr');
      }
    } catch (_) { /* noop */ }
  }

  function scan() {
    scanResources();
    scanDom();
  }

  function syncToken() {
    let t = null;
    try {
      t = localStorage.getItem('x-cas-token-app');
    } catch (_) { /* 无存储权限的沙箱 */ }
    if (!t || t === lastToken) return;
    lastToken = t;
    sentToken = true;
    send({ type: 'TOKEN', token: t, origin: location.origin });
  }

  /* ---------- DOM 结构摘要（帮我在看不到页面时推断改造点） ---------- */

  function outline(el, depth) {
    if (!el || depth > 4) return null;
    const kids = [];
    if (depth < 4) {
      let n = 0;
      for (const c of el.children) {
        if (n >= 8) { kids.push({ t: '…', more: true }); break; }
        const o = outline(c, depth + 1);
        if (o) { kids.push(o); n++; }
      }
    }
    const node = { t: el.tagName ? el.tagName.toLowerCase() : String(el.nodeName) };
    if (el.id) node.i = el.id;
    const cls = typeof el.className === 'string' ? el.className.trim() : '';
    if (cls) node.c = cls.slice(0, 80);
    if (el.shadowRoot) node.shadow = true;
    if (kids.length) node.k = kids;
    return node;
  }

  /* ---------- 快照 ---------- */

  function snapshot() {
    let token = null;
    try {
      token = localStorage.getItem('x-cas-token-app');
    } catch (_) { /* noop */ }
    const videos = [];
    try {
      for (const v of document.querySelectorAll('video')) {
        videos.push({
          src: redact(v.currentSrc || v.src || ''),
          w: v.videoWidth,
          h: v.videoHeight,
          duration: Number.isFinite(v.duration) ? Math.round(v.duration) : null,
          paused: v.paused,
          controls: v.controls,
          crossOrigin: v.crossOrigin || null
        });
      }
    } catch (_) { /* noop */ }

    const frames = [];
    try {
      for (const f of document.querySelectorAll('iframe')) frames.push(redact(f.src || ''));
    } catch (_) { /* noop */ }

    let lsKeys = [];
    try { lsKeys = Object.keys(localStorage); } catch (_) { /* noop */ }

    return {
      ok: true,
      top: window.top === window,
      href: redact(location.href),
      origin: location.origin,
      title: document.title,
      readyState: document.readyState,
      token: token
        ? { present: true, len: token.length, head: token.slice(0, 8) + '…' }
        : { present: false },
      prefix: typeof window.prefix === 'string' ? window.prefix : null,
      videos,
      iframes: frames,
      media: [...media.values()].slice(-40),
      api: [...api.values()].slice(-80),
      lsKeys,
      dom: outline(document.body, 0)
    };
  }

  /* ---------- 消息 ---------- */

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.type === 'SUFE_SNAPSHOT') {
      scan();
      syncToken();
      reply(snapshot());
      return false;
    }
    if (msg.type === 'SUFE_RESCAN') {
      scan();
      reply({ ok: true, media: media.size, api: api.size });
      return false;
    }
    return false;
  });

  /* ---------- 启动 ---------- */

  function boot() {
    syncToken();
    scan();
    // 前 60 秒密集轮询（页面初始化时会偷偷发一堆请求），之后降频
    let ticks = 0;
    const timer = setInterval(() => {
      syncToken();
      scan();
      if (++ticks > 40) { clearInterval(timer); setInterval(() => { syncToken(); scan(); }, 10000); }
    }, 1500);

    try {
      new MutationObserver(() => scanDom())
        .observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) { /* noop */ }

    window.addEventListener('load', () => { scan(); syncToken(); }, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
    // document_start 阶段就先把 token 拿走，不等 DOM
    syncToken();
  } else {
    boot();
  }
})();
