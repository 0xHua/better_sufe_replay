'use strict';
/**
 * probe_dist.js —— 把 dist 里那份「发给别人」的包真的装一次，看能不能跑起来。
 *
 *   node tools/probe_dist.js            # 装 → 打开 → 查状态 → 截图 → 卸掉
 *   node tools/probe_dist.js --keep     # 装完不卸（自己留着看）
 */

const fs = require('node:fs');
const path = require('node:path');
const { waitForBrowser } = require('./cdp');

const PORT = Number(process.env.CDP_PORT || 9222);
const KEEP = process.argv.includes('--keep');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(new Date().toISOString().slice(11, 23), ...a);

function distDir() {
  const dist = path.resolve('dist');
  const dirs = fs.readdirSync(dist).filter((d) => fs.statSync(path.join(dist, d)).isDirectory());
  if (!dirs.length) throw new Error('dist 里没有目录，先跑 node tools/make_dist.js');
  return path.resolve(dist, dirs.sort().pop(), 'extension');
}

class Session {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.handlers = new Map(); this.id = 0; }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => res(this);
      this.ws.onerror = () => rej(new Error('CDP 连不上'));
      this.ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id && this.handlers.has(m.id)) { this.handlers.get(m.id)(m); this.handlers.delete(m.id); return; }
        if (m.method) { const f = this.handlers.get(m.method); if (f) f(m.params); }
      };
    });
  }
  on(evt, fn) { this.handlers.set(evt, fn); }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res) => { this.handlers.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.error) throw new Error(r.error.message);
    const d = r.result || {};
    if (d.exceptionDetails) throw new Error(d.exceptionDetails.exception ? d.exceptionDetails.exception.description : d.exceptionDetails.text);
    return d.result ? d.result.value : undefined;
  }
  close() { try { this.ws.close(); } catch {} }
}

(async () => {
  await waitForBrowser(PORT, 15000);
  const dir = distDir();
  log('包目录 ' + dir);

  const ver = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

  // 1) 用 browser target 装
  const b = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const bs = await new Session(b.webSocketDebuggerUrl).connect();
  const load = await bs.send('Extensions.loadUnpacked', { path: dir });
  if (load.error) { log('[!] 装载失败 ' + JSON.stringify(load.error)); process.exit(1); }
  const extId = load.result.id;
  log('装载成功 id=' + extId + ' 版本 ' + ver.version);
  bs.close();
  await sleep(1500);

  // 2) 打开首页，看它自己会不会取数
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const s = await new Session(t.webSocketDebuggerUrl).connect();
  const out = { id: extId, version: ver.version };
  try {
    await s.send('Page.enable');
    await s.send('Runtime.enable');
    await s.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 760, deviceScaleFactor: 1, mobile: false });
    await s.send('Page.navigate', { url: `chrome-extension://${extId}/index.html` });
    await sleep(6500);

    out.page = await s.evaluate(`(function(){
      var rows = document.querySelectorAll('.row').length;
      var ask = document.getElementById('askLogin');
      var stat = document.getElementById('stat');
      return {
        title: document.title,
        rows: rows,
        src: (document.getElementById('srcText')||{}).textContent || '',
        stat: stat ? stat.textContent.trim() : '',
        askVisible: ask ? !ask.hidden : null,
        askText: ask ? (ask.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40) : '',
        hasBridge: !!(window.SUFEBridge && window.SUFEBridge.available),
        icon: (document.querySelector('link[rel="icon"]')||{}).getAttribute ? document.querySelector('link[rel="icon"]').getAttribute('href') : '',
      };
    })()`);

    // 图标能不能取到（证明 icon-*.png 都在包里）
    out.icons = await s.evaluate(`Promise.all(['icon-16.png','icon-32.png','icon-48.png','icon-128.png'].map(function(n){
      return fetch(n).then(function(r){ return n+'='+r.status; }).catch(function(){ return n+'=ERR'; });
    }))`);
    out.assetProbe = await s.evaluate(`Promise.all(['app.js','ext/bridge.js','player/player.js','player/side.js','player/player.css','data/courses.json'].map(function(n){
      return fetch(n).then(function(r){ return n+'='+r.status; }).catch(function(){ return n+'=ERR'; });
    }))`);

    await s.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then(({ result }) => {
      fs.writeFileSync(path.resolve('probe/shots/dist-boot.png'), Buffer.from(result.data, 'base64'));
    });

    log('结果\n' + JSON.stringify(out, null, 2));
    fs.writeFileSync('probe/eval/dist.json', JSON.stringify(out, null, 2));
  } finally {
    s.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => {});
  }

  // 3) 卸掉，别在你的浏览器里留一份重复的
  if (!KEEP) {
    const b2 = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    const bs2 = await new Session(b2.webSocketDebuggerUrl).connect();
    const un = await bs2.send('Extensions.uninstall', { id: extId });
    bs2.close();
    log(un.error ? '卸载失败（手动删也行）：' + JSON.stringify(un.error) : '已卸载 ' + extId);
  }
  process.exit(0);
})().catch((e) => { log('[!] ' + e.message); process.exit(1); });
