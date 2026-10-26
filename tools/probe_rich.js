'use strict';
/**
 * probe_rich.js —— 看一眼四个富数据接口的返回「壳」长什么样（匿名也能读）。
 *   node tools/probe_rich.js
 */

const fs = require('node:fs');

const BASE = 'https://dm.sufe.edu.cn';

function cidFromUrl(u) {
  const m = u && u.match(/\/([0-9a-f]{32})\.mp4/i);
  return m ? m[1] : '';
}

async function get(path) {
  const t0 = Date.now();
  const r = await fetch(BASE + path, { cache: 'no-store' });
  const text = await r.text();
  return { status: r.status, ms: Date.now() - t0, bytes: text.length, text: text };
}

function shape(v, depth) {
  depth = depth || 0;
  if (v === null) return 'null';
  if (Array.isArray(v)) return depth > 2 ? 'array(' + v.length + ')' : 'array(' + v.length + ') of ' + (v.length ? shape(v[0], depth + 1) : '?');
  if (typeof v === 'object') {
    if (depth > 2) return 'object';
    const o = {};
    Object.keys(v).forEach((k) => { o[k] = shape(v[k], depth + 1); });
    return o;
  }
  if (typeof v === 'string') return 'string(' + (v.length > 40 ? v.slice(0, 40) + '…' : v) + ')';
  return typeof v;
}

(async () => {
  const dual = JSON.parse(fs.readFileSync('probe/eval/dual.json', 'utf8'));
  const href = dual.dualLink.href;
  const q = new URL('http://x/' + href).searchParams;
  const c1 = cidFromUrl(q.get('src'));
  const c2 = cidFromUrl(q.get('src2'));
  console.log('contentId 屏幕 =', c1, '\ncontentId 教师 =', c2);

  const jobs = [
    ['summary 知识要点', '/rman/v1/intelligent/select/knowledge/summary?contentId=' + c1],
    ['keyword 概要+关键词', '/learn/v1/homepage/course/keywordAndAbstract?videoId=' + c1],
    ['keyword 用教师 id 试', '/learn/v1/homepage/course/keywordAndAbstract?videoId=' + c2],
    ['shots PPT 帧', '/rman/v1/entity/file/screenshot?page=1&size=4&contentId=' + c1],
    ['vtt 字幕', '/rman/v1/search/webvtt?contentId=' + c1 + '&voice=true&isSysAuth=true&lang=source'],
  ];

  const out = {};
  for (const [name, path] of jobs) {
    try {
      const r = await get(path);
      let j = null;
      try { j = JSON.parse(r.text); } catch { j = null; }
      const rec = { status: r.status, ms: r.ms, bytes: r.bytes, json: j ? shape(j) : 'NOT-JSON' };
      if (name.startsWith('vtt')) {
        rec.vttHead = r.text.slice(0, 220);
        rec.vttLines = r.text.split('\n').length;
      }
      out[name] = rec;
      console.log('\n=== ' + name + ' ===');
      console.log(JSON.stringify(rec, null, 2));
    } catch (e) {
      console.log('\n=== ' + name + ' === ERR ' + e.message);
    }
  }
  fs.writeFileSync('probe/eval/rich-shape.json', JSON.stringify(out, null, 2));
})().catch((e) => { console.error('[!]', e.message); process.exit(1); });
