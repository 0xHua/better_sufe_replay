'use strict';
/**
 * probe_pip.js —— 小窗：哪一路进小窗 + 拖动位置 + 记住位置。
 *   node tools/probe_pip.js
 * 注意：不要用 Page.reload 验证「记住」，大 MP4 在播时它会让会话卡死；改成新开一个标签页。
 */

const fs = require('node:fs');
const path = require('node:path');
const { waitForBrowser, Session } = require('./cdp');

const PORT = Number(process.env.CDP_PORT || 9222);
const EXT = process.env.EXT_URL || 'chrome-extension://mnkhdbfkagnopdhcgdcjdkmpjohpffop/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(new Date().toISOString().slice(11, 23), ...a);

async function openTab(url) {
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const s = await new Session(t.webSocketDebuggerUrl).connect();
  await s.send('Page.enable');
  await s.send('Runtime.enable');
  const loaded = new Promise((res) => {
    const to = setTimeout(() => res('timeout'), 15000);
    s.on('Page.loadEventFired', () => { clearTimeout(to); res('load'); });
  });
  await s.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await s.send('Page.navigate', { url });
  await loaded;
  await sleep(3500);
  return { t, s };
}

async function shot(s, file) {
  const { data } = await s.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const abs = path.resolve(file);
  fs.writeFileSync(abs, Buffer.from(data, 'base64'));
  log('截图 ' + file, (fs.statSync(abs).size / 1024).toFixed(0) + ' KB');
}

async function main() {
  await waitForBrowser(PORT, 15000);
  const dual = JSON.parse(fs.readFileSync('probe/eval/dual.json', 'utf8'));
  const playerURL = new URL(dual.dualLink.href, EXT).href;
  const out = {};
  const save = () => fs.writeFileSync('probe/eval/pip.json', JSON.stringify(out, null, 2));

  /* ---- 第一程：切双屏 + 小窗、换目标、拖动 ---- */
  const a = await openTab(playerURL);
  try {
    out.default = await a.s.evaluate(`(function(){
      document.querySelector('#segCount [data-count="2"]').click();
      document.querySelector('#segMode [data-mode="pip"]').click();
      var c1 = document.getElementById('cell1'), c2 = document.getElementById('cell2');
      return {
        pipShown: !document.getElementById('segPip').hidden,
        hintShown: !document.getElementById('pipHint').hidden,
        cell1pip: c1.classList.contains('pip-on'),
        cell2pip: c2.classList.contains('pip-on'),
        c1: { l: Math.round(c1.getBoundingClientRect().left), t: Math.round(c1.getBoundingClientRect().top), w: Math.round(c1.getBoundingClientRect().width) },
        c2: { l: Math.round(c2.getBoundingClientRect().left), t: Math.round(c2.getBoundingClientRect().top), w: Math.round(c2.getBoundingClientRect().width) },
        vw: document.getElementById('vwrap').clientWidth, vh: document.getElementById('vwrap').clientHeight
      };
    })()`);
    save();
    await sleep(600);

    out.swapTo1 = await a.s.evaluate(`(function(){
      document.querySelector('#segPip [data-pip="1"]').click();
      var c1 = document.getElementById('cell1'), c2 = document.getElementById('cell2');
      return {
        cell1pip: c1.classList.contains('pip-on'),
        cell2pip: c2.classList.contains('pip-on'),
        c1w: Math.round(c1.getBoundingClientRect().width),
        c2w: Math.round(c2.getBoundingClientRect().width),
        pipSel: (document.querySelector('#segPip .on') || {}).textContent
      };
    })()`);
    save();
    await sleep(600);

    out.drag = await a.s.evaluate(`(function(){
      var c1 = document.getElementById('cell1');
      var v = c1.querySelector('video');
      var b = c1.getBoundingClientRect();
      var sx = b.left + b.width / 2, sy = b.top + b.height / 2;
      var before = { l: Math.round(b.left), t: Math.round(b.top) };
      function fire(type, x, y){
        v.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, isPrimary: true }));
      }
      fire('pointerdown', sx, sy);
      fire('pointermove', sx + 260, sy + 120);
      fire('pointerup', sx + 260, sy + 120);
      var nb = c1.getBoundingClientRect();
      var p = JSON.parse(localStorage.getItem('sufe.player.prefs') || '{}');
      return { before: before, after: { l: Math.round(nb.left), t: Math.round(nb.top) },
               prefs: { pipTarget: p.pipTarget, pipX: p.pipX, pipY: p.pipY } };
    })()`);
    save();
    await sleep(500);
    await shot(a.s, 'probe/shots/pip-drag.png');
  } finally {
    a.s.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${a.t.id}`).catch(() => {});
  }

  /* ---- 第二程：新标签页再开一次，看是否记住 ---- */
  const pipURL = new URL(playerURL);
  pipURL.searchParams.set('mode', 'pip');
  const b = await openTab(pipURL.href);
  try {
    out.afterReopen = await b.s.evaluate(`(function(){
      var w = document.getElementById('vwrap');
      var c1 = document.getElementById('cell1');
      var b1 = c1.getBoundingClientRect();
      return {
        mode: w.dataset.mode, count: w.dataset.count,
        cell1pip: c1.classList.contains('pip-on'),
        c1: { l: Math.round(b1.left), t: Math.round(b1.top), w: Math.round(b1.width) },
        pipSel: (document.querySelector('#segPip .on') || {}).textContent
      };
    })()`);
    save();
    await sleep(400);
    await shot(b.s, 'probe/shots/pip-reopen.png');
  } finally {
    b.s.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${b.t.id}`).catch(() => {});
  }

  log('结果\n' + JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((e) => { log('[!] ' + e.message); process.exit(1); });
