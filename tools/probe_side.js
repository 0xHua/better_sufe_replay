'use strict';
/**
 * probe_side.js —— 播放器侧栏：四个标签能不能读到数据、点了能不能跳。
 *   node tools/probe_side.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { waitForBrowser, Session } = require('./cdp');

const PORT = Number(process.env.CDP_PORT || 9222);
const EXTROOT = 'chrome-extension://mnkhdbfkagnopdhcgdcjdkmpjohpffop/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(new Date().toISOString().slice(11, 23), ...a);

async function main() {
  await waitForBrowser(PORT, 15000);
  const dual = JSON.parse(fs.readFileSync('probe/eval/dual.json', 'utf8'));
  const u = new URL(EXTROOT + dual.dualLink.href);
  u.searchParams.set('count', '1');
  u.searchParams.set('mode', 'side');
  // 屏幕那一路（c1）是摘要/字幕/知识点挂的那一路
  u.searchParams.set('c1', 'cb49c6ceb5f242de9cfbd065059f7467');
  u.searchParams.set('c2', 'dcdaedafad3d43bd9a243275abfc24e1');

  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const s = await new Session(t.webSocketDebuggerUrl).connect();
  const out = {};
  try {
    await s.send('Page.enable');
    await s.send('Runtime.enable');
    const loaded = new Promise((res) => {
      const to = setTimeout(() => res('timeout'), 15000);
      s.on('Page.loadEventFired', () => { clearTimeout(to); res('load'); });
    });
    await s.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
    await s.send('Page.navigate', { url: u.href });
    await loaded;
    await sleep(3000);

    out.boot = await s.evaluate(`(function(){
      return {
        sideOpen: !document.getElementById('side').hidden,
        count: document.getElementById('vwrap').dataset.count,
        sideWidth: Math.round(document.getElementById('side').getBoundingClientRect().width),
        stageWidth: Math.round(document.getElementById('stage').getBoundingClientRect().width),
        tab: (document.querySelector('#tabs .on') || {}).textContent
      };
    })()`);

    /* 概要 */
    await s.evaluate(`document.querySelector('#tabs [data-tab="sum"]').click()`);
    await sleep(2200);
    out.sum = await s.evaluate(`(function(){
      var p = document.getElementById('pane');
      return { html: p.innerHTML.length, desc: (p.querySelector('.sumtxt')||{}).textContent?.slice(0,50) || '',
               kw: p.querySelectorAll('.kw span').length, err: (p.querySelector('.perr')||{}).textContent || '' };
    })()`);
    await s.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then(({ data }) => {
      fs.writeFileSync(path.resolve('probe/shots/side-sum.png'), Buffer.from(data, 'base64'));
    });

    /* 知识要点 */
    await s.evaluate(`document.querySelector('#tabs [data-tab="points"]').click()`);
    await sleep(2500);
    out.points = await s.evaluate(`(function(){
      var p = document.getElementById('pane');
      return { ch: p.querySelectorAll('.ch').length, kp: p.querySelectorAll('.kp').length,
               first: (p.querySelector('.cht')||{}).textContent || '', err: (p.querySelector('.perr')||{}).textContent || '' };
    })()`);

    /* 点第三个知识点，看是否跳 */
    out.jump = await s.evaluate(`(function(){
      var kps = document.querySelectorAll('#pane .kp');
      var el = kps[2] || kps[0];
      if (!el) return { err: '没有知识点可点', n: kps.length };
      var want = parseFloat(el.dataset.t);
      el.click();
      return { want: want, got: Math.round(document.getElementById('v1').currentTime * 100) / 100,
               text: el.textContent.trim().slice(0, 30) };
    })()`);
    await sleep(600);
    await s.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then(({ data }) => {
      fs.writeFileSync(path.resolve('probe/shots/side-points.png'), Buffer.from(data, 'base64'));
    });

    /* PPT */
    await s.evaluate(`document.querySelector('#tabs [data-tab="ppt"]').click()`);
    await sleep(2500);
    out.ppt = await s.evaluate(`(function(){
      var p = document.getElementById('pane');
      var imgs = p.querySelectorAll('.pitem img');
      return { items: p.querySelectorAll('.pitem').length, firstSrc: imgs[0] ? imgs[0].getAttribute('src') : '',
               natural: imgs[0] ? imgs[0].naturalWidth : 0, err: (p.querySelector('.perr')||{}).textContent || '' };
    })()`);
    await sleep(1200);
    await s.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then(({ data }) => {
      fs.writeFileSync(path.resolve('probe/shots/side-ppt.png'), Buffer.from(data, 'base64'));
    });

    /* 字幕 */
    await s.evaluate(`document.querySelector('#tabs [data-tab="sub"]').click()`);
    await sleep(2500);
    out.sub = await s.evaluate(`(function(){
      var p = document.getElementById('pane');
      var c = p.querySelectorAll('.cue');
      return { cues: c.length, firstT: c[0] ? c[0].dataset.t : '', firstTxt: c[0] ? c[0].textContent.trim().slice(0,40) : '',
               err: (p.querySelector('.perr')||{}).textContent || '' };
    })()`);
    await s.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then(({ data }) => {
      fs.writeFileSync(path.resolve('probe/shots/side-sub.png'), Buffer.from(data, 'base64'));
    });

    /* 点第一句字幕，看是否跳 */
    out.subJump = await s.evaluate(`(function(){
      var c = document.querySelectorAll('#pane .cue')[0];
      var want = parseFloat(c.dataset.t);
      c.click();
      return { want: want, got: Math.round(document.getElementById('v1').currentTime * 100) / 100 };
    })()`);

    /* 双屏时侧栏应该自动收起 */
    out.dualCollapse = await s.evaluate(`(function(){
      document.querySelector('#segCount [data-count="2"]').click();
      return { sideHidden: document.getElementById('side').hidden, count: document.getElementById('vwrap').dataset.count };
    })()`);
    await sleep(800);
    await s.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then(({ data }) => {
      fs.writeFileSync(path.resolve('probe/shots/side-dual-off.png'), Buffer.from(data, 'base64'));
    });

    /* 手动打开应该保留 */
    out.manualOpen = await s.evaluate(`(function(){
      document.getElementById('sideBtn').click();
      return { sideHidden: document.getElementById('side').hidden };
    })()`);

    out.dl = await s.evaluate(`(function(){
      var b1 = document.getElementById('dlBtn1'), b2 = document.getElementById('dlBtn2');
      return { dl1: !b1.hidden, dl2: !b2.hidden, dl1txt: b1.textContent.trim(), dl2txt: b2.textContent.trim() };
    })()`);

    log('结果\n' + JSON.stringify(out, null, 2));
    fs.writeFileSync('probe/eval/side.json', JSON.stringify(out, null, 2));
  } finally {
    s.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => {});
  }
  process.exit(0);
}

main().catch((e) => { log('[!] ' + e.message); process.exit(1); });
