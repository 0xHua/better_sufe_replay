'use strict';
/**
 * cdp_shot.js —— 开一个新标签页打开指定 URL，截图，然后关掉这个标签页。
 * 不动用户已有的页面。
 *
 *   node tools/cdp_shot.js --url "file:///E:/dsh_Workspace/web_replay_sufe/app/index.html" \
 *        --out probe/shots/app.png --width 1440 --height 900 --wait 600
 */

const fs = require('node:fs');
const path = require('node:path');
const { waitForBrowser, Session } = require('./cdp');

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);

const PORT = Number(arg('port', 9222));
const URL_ = arg('url', null);
const OUT = arg('out', 'probe/shots/shot.png');
const W = Number(arg('width', 1440));
const H = Number(arg('height', 900));
const WAIT = Number(arg('wait', 600));
const DPR = Number(arg('dpr', 1));
const JSFILE = arg('js', null);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(new Date().toISOString().slice(11, 23), ...a);

async function newTarget(port, url) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`新建标签页失败 HTTP ${res.status}`);
  return res.json();
}

async function closeTarget(port, id) {
  await fetch(`http://127.0.0.1:${port}/json/close/${id}`, { signal: AbortSignal.timeout(4000) }).catch(() => {});
}

async function main() {
  if (!URL_) throw new Error('缺少 --url');

  await waitForBrowser(PORT, 15000);
  const target = await newTarget(PORT, 'about:blank');
  log('新标签页', target.id);

  const s = await new Session(target.webSocketDebuggerUrl).connect();
  try {
    await s.send('Page.enable');
    await s.send('Runtime.enable');

    const loaded = new Promise((resolve) => {
      const to = setTimeout(() => resolve('timeout'), 15000);
      s.on('Page.loadEventFired', () => { clearTimeout(to); resolve('load'); });
    });

    await s.send('Emulation.setDeviceMetricsOverride', {
      width: W, height: H, deviceScaleFactor: DPR, mobile: false,
    });
    await s.send('Page.navigate', { url: URL_ });
    const how = await loaded;
    log('加载', how);
    await sleep(WAIT);

    if (JSFILE) {
      const code = fs.readFileSync(path.resolve(JSFILE), 'utf8');
      const v = await s.evaluate(code);
      log('eval', JSON.stringify(v === undefined ? null : v).slice(0, 240));
      await sleep(350);
    }

    const { data } = await s.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: flag('full'),
      fromSurface: true,
    });

    const abs = path.resolve(OUT);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from(data, 'base64'));

    const buf = fs.readFileSync(abs);
    log(`已保存 ${abs}  ${(buf.length / 1024).toFixed(1)} KB`);

    if (flag('keep')) log('保留标签页', target.id);
  } finally {
    s.close();
    if (!flag('keep')) await closeTarget(PORT, target.id);
  }
  process.exit(0);
}

main().catch((e) => { log('[!] ' + e.message); process.exit(1); });
