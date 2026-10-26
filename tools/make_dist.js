'use strict';
/**
 * make_dist.js —— 打一个可以直接发给别人的试用包。
 *
 *   node tools/make_dist.js
 *
 * 产出：
 *   dist/空中课堂-回放-v0.5.0/
 *     安装说明.txt
 *     extension/          ← 让别人「加载解压缩的扩展」选这个文件夹
 *
 * 特别注意：app/data/courses.json 是「我自己的课表」，绝对不进包。
 * 只拷白名单里的文件，不整目录复制，避免把 probe / docs / 个人数据带出去。
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app');
const VERSION = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8')).version;
const NAME = '空中课堂-回放-v' + VERSION;
const OUT = path.join(ROOT, 'dist', NAME);
const EXT = path.join(OUT, 'extension');

// 只拷这些（相对 app/ 的路径）
const FILES = [
  'manifest.json',
  'index.html',
  'app.js',
  'icon-16.png',
  'icon-32.png',
  'icon-48.png',
  'icon-128.png',
  'ext/background.js',
  'ext/content.js',
  'ext/bridge.js',
  'player/index.html',
  'player/player.css',
  'player/player.js',
  'player/side.js',
];

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function main() {
  rmrf(OUT);
  fs.mkdirSync(EXT, { recursive: true });

  const missing = [];
  let bytes = 0;
  for (const rel of FILES) {
    const from = path.join(SRC, rel);
    if (!fs.existsSync(from)) { missing.push(rel); continue; }
    const to = path.join(EXT, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    bytes += fs.statSync(to).size;
  }
  if (missing.length) {
    console.error('[!] 缺文件：' + missing.join(', '));
    process.exit(1);
  }

  // 说明书
  const doc = path.join(ROOT, 'packaging', '安装说明.txt');
  if (!fs.existsSync(doc)) {
    console.error('[!] 缺 packaging/安装说明.txt');
    process.exit(1);
  }
  fs.copyFileSync(doc, path.join(OUT, '安装说明.txt'));

  // 包里绝不能出现个人数据 / 开发产物 / 绝对路径
  const bad = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const rel = path.relative(OUT, p);
      if (/courses\.json$/.test(rel)) bad.push(rel + '（个人课表）');
      if (/\.(cmd|ps1|mjs|log)$/.test(rel)) bad.push(rel + '（脚本不该进包）');
      if (/E:\\\\dsh_Workspace/i.test(fs.readFileSync(p, 'utf8').slice(0, 20000))) bad.push(rel + '（写死了本机路径）');
    }
  })(OUT);

  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const perms = (manifest.permissions || []).join(',');
  const hosts = (manifest.host_permissions || []).join(',');

  console.log('[ok] ' + path.relative(ROOT, OUT));
  console.log('     版本 ' + VERSION + ' · ' + FILES.length + ' 个文件 · ' + (bytes / 1024).toFixed(1) + ' KB');
  console.log('     权限 permissions=' + perms + '  host_permissions=' + hosts);
  console.log('     扩展名 ' + manifest.name + ' · 图标 ' + Object.keys(manifest.icons || {}).join('/'));
  if (bad.length) {
    console.error('[!] 包里混进了不该有的东西：\n     ' + bad.join('\n     '));
    process.exit(1);
  }
  console.log('     检查：无个人课表、无脚本、无本机绝对路径');
}

main();
