'use strict';
/**
 * ext_load.js —— 通过 CDP 的 Extensions.loadUnpacked 重新加载扩展（等于在 edge://extensions 点「重新加载」）。
 *
 * 用法： node tools\ext_load.js [扩展目录]
 * 说明： Edge 156 直接支持，不需要 --enable-unsafe-extension-debugging。
 */
const path = require('node:path');
const http = require('node:http');

const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'app'));

const getJson = (u) => new Promise((res, rej) => {
  http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

(async () => {
  const ver = await getJson('http://127.0.0.1:9222/json/version');
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r);
    ws.addEventListener('error', () => j(new Error('连不上 9222，浏览器没开调试端口？')));
  });

  let id = 1;
  const send = (method, params) => new Promise((res) => {
    const mid = id++;
    const h = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === mid) { ws.removeEventListener('message', h); res(m); }
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  const r = await send('Extensions.loadUnpacked', { path: dir });
  if (r.error) {
    console.error('[!] 加载失败：' + JSON.stringify(r.error));
    process.exitCode = 1;
  } else {
    console.log('[ok] 扩展已重新加载 id=' + (r.result && r.result.id));
    console.log('     目录：' + dir);
  }
  ws.close();
})().catch((e) => { console.error('[!] ' + e.message); process.exit(1); });
