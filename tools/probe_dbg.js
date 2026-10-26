'use strict';
/* 打开一个 URL，抓运行时异常与 video 诊断信息 */
const fs = require('node:fs');
const { waitForBrowser, Session } = require('./cdp');
const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(new Date().toISOString().slice(11, 23), ...a);

async function main() {
  const url = process.argv[2];
  if (!url) throw new Error('用法: node tools/probe_dbg.js <url> [waitMs]');
  const waitMs = Number(process.argv[3] || 6000);

  await waitForBrowser(PORT, 15000);
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
  const t = await res.json();
  const s = await new Session(t.webSocketDebuggerUrl).connect();
  const errors = [];
  try {
    await s.send('Page.enable');
    await s.send('Runtime.enable');
    s.on('Runtime.exceptionThrown', (p) => {
      errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text);
    });
    s.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error' || p.type === 'warning') {
        errors.push('[console.' + p.type + '] ' + p.args.map((a) => a.value || a.description).join(' '));
      }
    });
    await s.send('Page.navigate', { url });
    await sleep(waitMs);

    const info = await s.evaluate(`(function(){
      var v1 = document.getElementById('v1'), v2 = document.getElementById('v2');
      function d(v){ return v ? {
        src: (v.currentSrc||'').slice(0,110),
        ready: v.readyState, net: v.networkState,
        err: v.error ? v.error.code + ':' + v.error.message : null,
        dur: v.duration, w: v.videoWidth, paused: v.paused, t: v.currentTime
      } : null; }
      return {
        ovtext: (document.getElementById('ovtext1')||{}).textContent,
        ovtext2: (document.getElementById('ovtext2')||{}).textContent,
        ov1hidden: document.getElementById('ov1').classList.contains('hide'),
        v1: d(v1), v2: d(v2)
      };
    })()`);
    log('诊断', JSON.stringify(info, null, 2));
    log('异常', JSON.stringify(errors, null, 2));
    fs.writeFileSync('probe/eval/dbg.json', JSON.stringify({ info, errors }, null, 2));
  } finally {
    s.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => {});
  }
  process.exit(0);
}
main().catch((e) => { log('[!] ' + e.message); process.exit(1); });
