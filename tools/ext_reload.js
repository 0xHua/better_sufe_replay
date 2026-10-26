'use strict';
/**
 * ext_reload.js —— 重新加载已解压扩展（改了 background.js 之后必须来一下）。
 * 用法: node tools/ext_reload.js
 */
const http = require('node:http');
const get = (u) => new Promise((res, rej) => {
  http.get(u, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
});

(async () => {
  const list = await get('http://127.0.0.1:9222/json/list');
  let sw = list.find((p) => p.type === 'service_worker' && /chrome-extension:/.test(p.url));
  const id = sw && sw.url.split('/')[2];

  if (!sw) {
    console.error('[!] 没有运行中的 service worker，先把扩展页面打开一次再重试');
    process.exit(1);
  }

  const ws = new WebSocket(sw.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'chrome.runtime.reload()' } }));
  await new Promise((r) => setTimeout(r, 1500));
  ws.close();
  console.log('[ok] 已请求重载扩展 ' + id + '（页面刷新后生效）');
})().catch((e) => { console.error('[!] ' + e.message); process.exit(1); });
