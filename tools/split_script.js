'use strict';
/**
 * split_script.js —— 一次性工具：把 app/index.html 里的内联 <script> 抽成 app/app.js。
 * MV3 扩展页的 CSP 是 script-src 'self'，内联脚本会被直接拒绝执行（白屏）。
 */
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.resolve(__dirname, '..', 'app', 'index.html');
const OUT = path.resolve(__dirname, '..', 'app', 'app.js');

let html = fs.readFileSync(FILE, 'utf8');
const OPEN = '<script>\n(function () {';
const at = html.indexOf(OPEN);
if (at < 0) {
  console.error('[!] 找不到内联脚本起点');
  process.exit(1);
}
const endTag = html.indexOf('</script>', at);
if (endTag < 0) {
  console.error('[!] 找不到 </script>');
  process.exit(1);
}
const body = html.slice(at + '<script>\n'.length, endTag);
fs.writeFileSync(OUT, body, 'utf8');
html = html.slice(0, at) + '<script src="app.js"></script>' + html.slice(endTag + '</script>'.length);
fs.writeFileSync(FILE, html, 'utf8');
console.log('[ok] app/app.js ' + body.length + ' 字节；index.html 现在 ' + html.length + ' 字节');
