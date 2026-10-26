'use strict';
/**
 * serve.js —— 这台机器上的最小静态服务器，只服务本仓库目录。
 *
 *   node tools/serve.js            起服务并自动打开浏览器
 *   node tools/serve.js --no-open  只起服务
 *   PORT=8800 node tools/serve.js  换端口
 *
 * 为什么需要它：app/index.html 启动时要用 fetch 读 data/courses.json，
 * 而 file:// 下浏览器禁止网页读本地文件（CORS: origin null）。
 * 走 http://127.0.0.1 就一切正常，顺便还能把文件的 Last-Modified 当「读取时刻」。
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8730);
const OPEN = !process.argv.includes('--no-open');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.vtt': 'text/vtt; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  } catch {
    res.writeHead(400).end('bad url');
    return;
  }
  if (pathname === '/' || pathname === '') pathname = '/app/';
  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = path.resolve(ROOT, '.' + pathname);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('403 只允许本目录');
    return;
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + pathname);
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': st.size,
      'last-modified': st.mtime.toUTCString(),
      'cache-control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[!] 端口 ${PORT} 已被占用。换个端口：set PORT=8800 && node tools/serve.js`);
  } else {
    console.error('[!]', e.message);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/app/`;
  console.log('');
  console.log('  上财空中课堂 · 回放（重构版）');
  console.log('  ' + url);
  console.log('');
  console.log('  数据目录：' + path.join(ROOT, 'app', 'data'));
  console.log('  Ctrl+C 停止');
  console.log('');
  if (OPEN) {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
});
