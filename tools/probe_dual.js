'use strict';
/**
 * probe_dual.js —— 双屏播放器的端到端验证：
 * 从课程列表点开第一门课 → 拿「双屏看」链接 → 打开播放器 → 检布局/同步/独立音量/快捷键。
 *
 *   node tools/probe_dual.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { waitForBrowser, Session } = require('./cdp');

const PORT = Number(process.env.CDP_PORT || 9222);
const EXT = process.env.EXT_URL || 'chrome-extension://mnkhdbfkagnopdhcgdcjdkmpjohpffop/index.html';
const OUT = 'probe/shots';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(new Date().toISOString().slice(11, 23), ...a);

async function newTarget(url) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`新建标签页失败 HTTP ${res.status}`);
  return res.json();
}
async function closeTarget(id) {
  await fetch(`http://127.0.0.1:${PORT}/json/close/${id}`, { signal: AbortSignal.timeout(4000) }).catch(() => {});
}

function waitLoad(s, ms = 15000) {
  return new Promise((resolve) => {
    const to = setTimeout(() => resolve('timeout'), ms);
    s.on('Page.loadEventFired', () => { clearTimeout(to); resolve('load'); });
  });
}

/** 轮询直到表达式为真（最多 ms 毫秒） */
async function until(s, expr, ms = 25000, step = 400) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await s.evaluate(expr).catch(() => null);
    if (v) return v;
    await sleep(step);
  }
  return null;
}

async function shot(s, name, w, h) {
  await s.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const { data } = await s.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const abs = path.resolve(OUT, name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from(data, 'base64'));
  log('截图', name, (fs.statSync(abs).size / 1024).toFixed(0) + ' KB');
}

async function main() {
  await waitForBrowser(PORT, 15000);
  const t = await newTarget('about:blank');
  const s = await new Session(t.webSocketDebuggerUrl).connect();
  const out = {};
  try {
    await s.send('Page.enable');
    await s.send('Runtime.enable');

    /* 1. 课程列表 → 展开第一行 → 等「双屏看」链接 */
    let loaded = waitLoad(s);
    await s.send('Page.navigate', { url: EXT + '?debug=1' });
    await loaded;
    await sleep(2600);

    const href = await s.evaluate(`(function(){
      var rows = document.querySelectorAll('.row');
      if (!rows.length) return { err: 'no rows' };
      rows[0].click();
      return new Promise(function(res){
        var n = 0;
        var iv = setInterval(function(){
          var a = document.querySelector('.dlink');
          if (a) { clearInterval(iv); res({ href: a.getAttribute('href'), rows: rows.length }); }
          else if (++n > 40) { clearInterval(iv); res({ err: 'no dual link', rows: rows.length }); }
        }, 250);
      });
    })()`);
    out.dualLink = href;
    if (!href || !href.href) throw new Error('拿不到双屏链接：' + JSON.stringify(href));

    /* 2. 打开播放器 */
    const playerURL = new URL(href.href, EXT).href;
    loaded = waitLoad(s);
    await s.send('Page.navigate', { url: playerURL });
    await loaded;
    const ready = await until(s, `(function(){
      var a = document.getElementById('v1'), b = document.getElementById('v2');
      return a.readyState >= 2 && b.readyState >= 2;
    })()`, 30000);
    log('两路就绪', !!ready);

    out.init = await s.evaluate(`(function(){
      var q = new URLSearchParams(location.search);
      return {
        hasSrc2: !!q.get('src2'),
        count: document.getElementById('vwrap').dataset.count,
        mode: document.getElementById('vwrap').dataset.mode,
        c2hidden: document.getElementById('cell2').hidden,
        d1: +(document.getElementById('v1').duration || 0).toFixed(2),
        d2: +(document.getElementById('v2').duration || 0).toFixed(2),
        optsH: Math.round(document.getElementById('opts').getBoundingClientRect().height)
      };
    })()`);

    /* 3. 切到双屏 + 播放 */
    out.two = await s.evaluate(`(function(){
      document.querySelector('#segCount [data-count="2"]').click();
      document.getElementById('playBtn').click();
      return { count: document.getElementById('vwrap').dataset.count,
               c2hidden: document.getElementById('cell2').hidden,
               posShown: !document.getElementById('posGrp').hidden,
               syncShown: !document.getElementById('syncGrp').hidden };
    })()`);
    await until(s, `document.getElementById('v1').currentTime > 2.5`, 20000);

    /* 4. 同步情况 + 独立音量 + 快捷键移除 */
    out.state = await s.evaluate(`(function(){
      var v1 = document.getElementById('v1'), v2 = document.getElementById('v2');
      var before = { vol1: v1.volume, vol2: v2.volume, m1: v1.muted, m2: v2.muted };
      var r2 = document.getElementById('vol2');
      r2.value = '0.35';
      r2.dispatchEvent(new Event('input', { bubbles: true }));
      var afterVol2 = { vol1: v1.volume, vol2: v2.volume, m1: v1.muted, m2: v2.muted };
      document.getElementById('mute1').click();
      var afterMute1 = { vol1: v1.volume, vol2: v2.volume, m1: v1.muted, m2: v2.muted };
      document.getElementById('mute1').click();
      var vBefore = v1.volume;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      var vAfter = v1.volume;
      return {
        playing: { p1: !v1.paused, p2: !v2.paused },
        t1: +v1.currentTime.toFixed(2), t2: +v2.currentTime.toFixed(2),
        drift: +(v2.currentTime - v1.currentTime).toFixed(2),
        before: before, afterVol2: afterVol2, afterMute1: afterMute1,
        arrowUpChangedVolume: vBefore !== vAfter,
        w1: v1.videoWidth, w2: v2.videoWidth
      };
    })()`);

    /* 5. 时间差 +1.2s，两路应保持这个差值 */
    out.offset = await s.evaluate(`(function(){
      var v1 = document.getElementById('v1'), v2 = document.getElementById('v2');
      for (var i = 0; i < 12; i++) document.getElementById('offP').click();
      return { label: document.getElementById('offv').textContent,
               t1: +v1.currentTime.toFixed(2), t2: +v2.currentTime.toFixed(2) };
    })()`);
    await sleep(2200);
    out.offsetAfter = await s.evaluate(`(function(){
      var v1 = document.getElementById('v1'), v2 = document.getElementById('v2');
      return { label: document.getElementById('offv').textContent,
               drift: +(v2.currentTime - v1.currentTime).toFixed(2) };
    })()`);

    /* 6. 三种布局截图 */
    await s.evaluate(`document.getElementById('off0').click()`);
    await s.evaluate(`document.querySelector('#segMode [data-mode="side"]').click()`);
    await sleep(1400);
    await shot(s, 'dual-side.png', 1600, 900);

    await s.evaluate(`document.querySelector('#segMode [data-mode="stack"]').click()`);
    await sleep(1400);
    await shot(s, 'dual-stack.png', 1600, 900);

    await s.evaluate(`document.querySelector('#segMode [data-mode="pip"]').click()`);
    await sleep(1400);
    await shot(s, 'dual-pip.png', 1600, 900);

    /* 7. 回到单屏 */
    out.back1 = await s.evaluate(`(function(){
      document.querySelector('#segCount [data-count="1"]').click();
      return { count: document.getElementById('vwrap').dataset.count,
               c2hidden: document.getElementById('cell2').hidden,
               a2hidden: document.getElementById('ach2').hidden };
    })()`);

    log('结果', JSON.stringify(out, null, 2));
    fs.mkdirSync('probe/eval', { recursive: true });
    fs.writeFileSync(path.resolve('probe/eval/dual.json'), JSON.stringify(out, null, 2));
  } finally {
    s.close();
    await closeTarget(t.id);
  }
  process.exit(0);
}

main().catch((e) => { log('[!] ' + e.message); process.exit(1); });
