'use strict';
/**
 * cdp_capture.js —— 被动采集器
 *
 * 连到已用 --remote-debugging-port 启动的 Edge/Chrome，记录：
 *   · 每个请求的 URL / 方法 / 类型 / 状态码 / 响应头
 *   · JSON 与 HTML 响应体（截断到 --maxbody）
 *   · console 输出与未捕获异常
 *   · 页面快照（video/iframe/存储键/window 相关变量）
 *
 * 只读：不注入脚本、不点击、不修改页面。
 *
 * 用法：
 *   node tools/cdp_capture.js                       # 采所有页面，直到 Ctrl+C
 *   node tools/cdp_capture.js --match videoreview    # 只采 URL 含 videoreview 的页面
 *   node tools/cdp_capture.js --duration 120         # 采 120 秒后自动收尾
 */

const fs = require('node:fs');
const path = require('node:path');
const { waitForBrowser, listPages, sleep, Session, redact } = require('./cdp');

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def;
};
const has = (name) => argv.includes(`--${name}`);
const PORT = Number(arg('port', 9222));
const OUT = path.resolve(arg('out', path.join(__dirname, '..', 'probe', 'capture')));
const MATCH = arg('match', '');
const MAX_BODY = Number(arg('maxbody', 300000));
const DURATION = Number(arg('duration', 0));

fs.mkdirSync(OUT, { recursive: true });

const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const stamp = () => new Date().toISOString().slice(11, 23);
const log = (...a) => console.log(stamp(), ...a);

const STATIC_EXT = /\.(js|mjs|css|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|map|webp|mp4|flv|m3u8|ts)(\?|$)/i;
const isStatic = (url) => STATIC_EXT.test(url);

const SNAPSHOT = `(() => {
  const pick = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v.length > 400 ? v.slice(0, 400) + '…(' + v.length + ')' : v;
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (v instanceof Element) return '<' + v.tagName.toLowerCase() + ' id=' + v.id + '>';
    try { return JSON.parse(JSON.stringify(v)); } catch (_) { return String(v); }
  };
  const out = { url: location.href, title: document.title, readyState: document.readyState };
  out.videos = [...document.querySelectorAll('video,audio')].map(v => ({
    tag: v.tagName, src: v.currentSrc || v.src || v.getAttribute('src') || '', paused: v.paused,
    duration: Number.isFinite(v.duration) ? Math.round(v.duration) : null,
    size: v.videoWidth + 'x' + v.videoHeight, hasSource: !!v.querySelector('source'),
  }));
  out.iframes = [...document.querySelectorAll('iframe')].map(f => ({
    src: f.src, id: f.id, cls: String(f.className || '').slice(0, 60),
  }));
  try { out.localStorage = Object.fromEntries(Object.keys(localStorage).map(k => [k, pick(localStorage.getItem(k))])); } catch (e) { out.localStorageErr = String(e); }
  try { out.sessionStorageKeys = Object.keys(sessionStorage); } catch (e) { out.sessionStorageErr = String(e); }
  out.windowVars = {};
  for (const k of Object.keys(window)) {
    if (!/course|video|review|player|urls|token|setting|prefix|userinfo|sysModule/i.test(k)) continue;
    try { out.windowVars[k] = pick(window[k]); } catch (_) {}
  }
  out.scripts = [...document.scripts].map(s => s.src).filter(Boolean).slice(0, 60);
  return out;
})()`;

// ---------- 采集 ----------
const attached = new Map(); // wsUrl -> {file, stream, session, pages}

function slugFor(page) {
  let base = '';
  try {
    const u = new URL(page.url);
    base = `${u.hostname}${u.pathname}`.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60);
  } catch {
    base = `page_${page.id}`;
  }
  return `${STAMP}__${base || page.id}.jsonl`;
}

function writeRecord(ctx, rec) {
  ctx.stream.write(`${JSON.stringify(rec)}\n`);
}

async function attach(page) {
  if (attached.has(page.webSocketDebuggerUrl)) return;
  const skip = /^(devtools:|edge:|chrome:|about:blank|chrome-extension:)/i.test(page.url);
  if (skip) return;
  if (MATCH && !page.url.includes(MATCH)) return;

  const file = path.join(OUT, slugFor(page));
  const stream = fs.createWriteStream(file, { flags: 'a' });
  const session = new Session(page.webSocketDebuggerUrl, page.url);
  const ctx = { file, stream, session, page, requests: new Map(), bodiesWanted: new Set() };
  attached.set(page.webSocketDebuggerUrl, ctx);

  try {
    await session.connect();
  } catch (e) {
    log(`[!] 连不上页面 ${page.url} —— ${e.message}（可能已开着 DevTools）`);
    stream.end();
    attached.delete(page.webSocketDebuggerUrl);
    return;
  }

  stream.write(`${JSON.stringify({ t: 'page', ts: new Date().toISOString(), url: page.url, id: page.id })}\n`);
  log(`[+] 已接管：${page.url.slice(0, 110)}`);

  await session.send('Network.enable', {
    maxTotalBufferSize: 200 * 1024 * 1024,
    maxResourceBufferSize: 40 * 1024 * 1024,
    maxPostDataSize: 65536,
  });
  await session.send('Runtime.enable').catch(() => {});
  await session.send('Page.enable').catch(() => {});

  session.on('Network.requestWillBeSent', (p) => {
    const url = p.request?.url || '';
    const rec = {
      t: 'req',
      ts: new Date().toISOString(),
      id: p.requestId,
      method: p.request?.method,
      url: redact(url),
      type: p.type,
      postData: p.request?.postData ? redact(p.request.postData) : undefined,
    };
    ctx.requests.set(p.requestId, rec);
    writeRecord(ctx, rec);
    if (p.request?.method && p.request.method !== 'GET' || !isStatic(url)) {
      if (rec.type === 'XHR' || rec.type === 'Fetch' || rec.type === 'Document') {
        log(`[→] ${rec.method} ${url.replace(/^https?:\/\/[^/]+/, '').slice(0, 120)}`);
      }
    }
  });

  session.on('Network.responseReceived', (p) => {
    const req = ctx.requests.get(p.requestId);
    if (!req) return;
    const res = p.response || {};
    const mime = res.mimeType || '';
    req.status = res.status;
    req.mime = mime;
    req.resUrl = redact(res.url);
    req.fromCache = !!res.fromDiskCache || !!res.fromServiceWorker;
    writeRecord(ctx, { t: 'res', ts: new Date().toISOString(), id: p.requestId, status: res.status, mime, url: req.url });

    const wantBody =
      /json|javascript|text\/html|text\/plain|xml|vtt/i.test(mime) &&
      (req.type === 'XHR' || req.type === 'Fetch' || req.type === 'Document' || req.type === 'Other');
    if (wantBody) ctx.bodiesWanted.add(p.requestId);
  });

  session.on('Network.loadingFinished', (p) => {
    if (!ctx.bodiesWanted.has(p.requestId)) return;
    ctx.bodiesWanted.delete(p.requestId);
    const req = ctx.requests.get(p.requestId) || {};
    session
      .send('Network.getResponseBody', { requestId: p.requestId })
      .then((r) => {
        let body = r?.body ?? '';
        if (r?.base64Encoded) {
          try {
            body = Buffer.from(body, 'base64').toString('utf8');
          } catch {
            body = '<base64>';
          }
        }
        const text = redact(body, MAX_BODY);
        writeRecord(ctx, {
          t: 'body',
          ts: new Date().toISOString(),
          id: p.requestId,
          url: req.url,
          url2: req.resUrl,
          status: req.status,
          mime: req.mime,
          len: body.length,
          body: text,
        });
        if (req.type !== 'Document' && !isStatic(req.url || '')) {
          log(`[←] ${req.status} ${(req.url || '').replace(/^https?:\/\/[^/]+/, '').slice(0, 90)}  ${body.length}B`);
        }
      })
      .catch((e) => {
        writeRecord(ctx, { t: 'bodyError', id: p.requestId, url: req.url, error: e.message });
      });
  });

  session.on('Network.webSocketCreated', (p) => {
    writeRecord(ctx, { t: 'ws', ts: new Date().toISOString(), url: redact(p.url), id: p.requestId });
    log(`[ws] ${String(p.url).slice(0, 100)}`);
  });

  session.on('Runtime.consoleAPICalled', (p) => {
    const args = (p.args || []).map((a) => redact(a.value ?? a.description ?? a.type, 800));
    writeRecord(ctx, { t: 'console', ts: new Date().toISOString(), level: p.type, args });
    if (p.type === 'error' || p.type === 'warning') log(`[console.${p.type}] ${args.join(' ').slice(0, 200)}`);
  });

  session.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    writeRecord(ctx, {
      t: 'error',
      ts: new Date().toISOString(),
      text: redact(d.text, 500),
      desc: redact(d.exception?.description, 2000),
    });
    log(`[!] 页面异常：${String(d.exception?.description || d.text).slice(0, 160)}`);
  });

  let lastSnapshot = 0;
  const takeSnapshot = (why) => {
    const now = Date.now();
    if (now - lastSnapshot < 3000) return;
    lastSnapshot = now;
    session
      .evaluate(SNAPSHOT, { timeout: 8000 })
      .then((snap) => {
        writeRecord(ctx, { t: 'snapshot', ts: new Date().toISOString(), why, data: snap });
        const vids = (snap?.videos || []).filter((v) => v.src);
        if (vids.length) log(`[snap] 发现 ${vids.length} 个媒体元素`);
      })
      .catch(() => {});
  };

  session.on('Page.frameNavigated', (p) => {
    if (p.frame?.parentId) return;
    log(`[nav] ${String(p.frame?.url || '').slice(0, 110)}`);
    takeSnapshot('navigate');
  });

  takeSnapshot('attach');

  // --reload：attach 之后主动刷新一次页面，把首屏请求也录进来
  if (has('reload')) {
    setTimeout(() => {
      log(`[reload] 刷新：${page.url.slice(0, 100)}`);
      session.send('Page.reload', { ignoreCache: false }).catch(() => {});
    }, 1200);
  }

  return ctx;
}

async function discover() {
  let pages = [];
  try {
    pages = await listPages(PORT);
  } catch (e) {
    return pages;
  }
  for (const p of pages) {
    if (!attached.has(p.webSocketDebuggerUrl)) {
      await attach(p).catch((e) => log(`[!] attach 失败：${e.message}`));
    }
  }
  return pages;
}

function shutdown(reason) {
  log(`\n[停止] ${reason} —— 共接管 ${attached.size} 个页面`);
  const index = [];
  for (const [wsUrl, ctx] of attached) {
    index.push({ url: ctx.page.url, file: path.basename(ctx.file), requests: ctx.requests.size });
    try {
      ctx.stream.end();
    } catch {
      /* ignore */
    }
    ctx.session.close();
  }
  fs.writeFileSync(
    path.join(OUT, `${STAMP}__index.json`),
    JSON.stringify({ startedAt: STAMP, reason, pages: index }, null, 2)
  );
  log(`[完成] 输出目录：${OUT}`);
  process.exit(0);
}

(async () => {
  const version = await waitForBrowser(PORT);
  log(`浏览器：${version.Browser}`);
  log(`收录到：${OUT}`);
  if (MATCH) log(`过滤：URL 含 "${MATCH}"`);

  await discover();
  if (!attached.size) {
    log('[i] 还没有已打开的匹配页面 —— 请在浏览器里打开回放页，我会自动接管。');
  }

  const timer = setInterval(() => {
    discover().catch(() => {});
  }, 2500);

  if (DURATION > 0) setTimeout(() => shutdown(`到达 ${DURATION}s`), DURATION * 1000);
  process.on('SIGINT', () => shutdown('Ctrl+C'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (e) => log(`[!] ${e.message}`));
})();
