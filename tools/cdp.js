'use strict';
/**
 * 最小 CDP 客户端 —— 零依赖，Node 22+ 自带的全局 WebSocket 就够用。
 *
 * 用途：连到以 --remote-debugging-port 启动的 Chromium 内核浏览器，
 * 读它暴露的调试协议。只做「读」，不注入、不点击、不修改页面。
 */

const DEFAULT_PORT = 9222;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(port, path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

/** 轮询等待浏览器调试端口起来 */
async function waitForBrowser(port = DEFAULT_PORT, timeoutMs = 90000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    try {
      return await httpJson(port, '/json/version');
    } catch (e) {
      last = e;
      await sleep(1000);
    }
  }
  throw new Error(
    `连不上 127.0.0.1:${port} —— 浏览器是否用 --remote-debugging-port 启动？(${last?.message})`
  );
}

/** 列出所有可调试的页面 */
async function listPages(port = DEFAULT_PORT) {
  const targets = await httpJson(port, '/json/list');
  return targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
}

class Session {
  constructor(wsUrl, label = '') {
    this.wsUrl = wsUrl;
    this.label = label;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
    this.ws = null;
  }

  async connect(timeoutMs = 15000) {
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket 连接超时')), timeoutMs);
      ws.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
      ws.addEventListener(
        'error',
        (e) => {
          clearTimeout(timer);
          reject(new Error(`WebSocket 错误：${e?.message || 'unknown'}`));
        },
        { once: true }
      );
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
        return;
      }
      if (!msg.method) return;
      const fns = this.listeners.get(msg.method);
      if (fns) {
        for (const fn of fns) {
          try {
            fn(msg.params);
          } catch (e) {
            console.error('[cdp] handler 出错', msg.method, e.message);
          }
        }
      }
    });

    ws.addEventListener('close', () => {
      this.closed = true;
      for (const { reject } of this.pending.values()) reject(new Error('会话已关闭'));
      this.pending.clear();
    });

    return this;
  }

  /** 订阅一个 CDP 事件 */
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
    return this;
  }

  send(method, params = {}) {
    if (this.closed || !this.ws) return Promise.reject(new Error('会话已关闭'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 在页面的主世界执行一段表达式，返回值序列化成 JSON */
  async evaluate(expression, { awaitPromise = true, timeout = 15000 } = {}) {
    const raw = await Promise.race([
      this.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise,
        userGesture: true,
      }),
      sleep(timeout).then(() => {
        throw new Error('Runtime.evaluate 超时');
      }),
    ]);
    if (raw.exceptionDetails) {
      const d = raw.exceptionDetails;
      const text = d.exception?.description || d.text || '未知异常';
      throw new Error(`页面内异常：${text.split('\n')[0]}`);
    }
    return raw.result?.value;
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

/** 把 URL / 请求体里的凭据抹掉，避免落到磁盘上 */
function redact(input, maxLen = 6000) {
  if (input === null || input === undefined) return input;
  let s = String(input);
  s = s.replace(
    /([?&;](?:x-cas-token|cookie|token|ticket|password|passwd|pwd|sessionid|sid)=)[^&;\s"']+/gi,
    '$1<REDACTED>'
  );
  s = s.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '<JWT>');
  s = s.replace(/\bS1_rman_sid=[^;\s"']+/gi, 'S1_rman_sid=<REDACTED>');
  return s.length > maxLen ? `${s.slice(0, maxLen)}…(${s.length} 字符)` : s;
}

module.exports = { DEFAULT_PORT, sleep, httpJson, waitForBrowser, listPages, Session, redact };
