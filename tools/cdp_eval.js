'use strict';
/**
 * cdp_eval.js —— 在一个已打开的页面里执行一小段只读 JS，把结果打回来。
 *
 * 用法：
 *   node tools/cdp_eval.js --list
 *   node tools/cdp_eval.js --match videoreview --expr "document.title"
 *   node tools/cdp_eval.js --match videoreview --file probe/expr/dom.js
 *   node tools/cdp_eval.js --match videoreview --expr "window.courseBackInfo" --out probe/course.json
 *
 * 注意：表达式在页面主世界执行，能拿到 Vue 实例、window 变量、DOM。
 * 只做读取，不要在表达式里改页面状态。
 */

const fs = require('node:fs');
const path = require('node:path');
const { waitForBrowser, listPages, Session } = require('./cdp');

const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def;
};

const PORT = Number(arg('port', 9222));
const MATCH = arg('match', '');
const IDX = arg('index', null);
const EXPR = arg('expr', null);
const FILE = arg('file', null);
const OUT = arg('out', null);
const MAX = Number(arg('max', 120000));

const stamp = () => new Date().toISOString().slice(11, 23);
const log = (...a) => console.error(stamp(), ...a);

async function main() {
  const version = await waitForBrowser(PORT, 15000);
  const pages = await listPages(PORT);

  if (has('list') || (!EXPR && !FILE)) {
    console.log(`浏览器：${version.Browser}\n共 ${pages.length} 个页面：`);
    pages.forEach((p, i) => {
      console.log(`  [${i}] ${p.title || '(无标题)'}`);
      console.log(`      ${p.url}`);
    });
    if (!EXPR && !FILE) {
      console.log('\n用 --match <URL 片段> 或 --index <n> 选中页面，再用 --expr / --file 执行表达式。');
    }
    return;
  }

  let target;
  if (IDX !== null) target = pages[Number(IDX)];
  else if (MATCH) target = pages.find((p) => p.url.includes(MATCH));
  else target = pages[0];

  if (!target) {
    log(`[!] 没找到页面（match="${MATCH}" index=${IDX}）`);
    process.exit(2);
  }
  log(`目标：${target.url}`);

  const expression = FILE
    ? fs.readFileSync(path.resolve(FILE), 'utf8')
    : EXPR;

  const session = await new Session(target.webSocketDebuggerUrl).connect();
  await session.send('Runtime.enable').catch(() => {});

  let value;
  try {
    value = await session.evaluate(expression, { awaitPromise: true, timeout: 30000 });
  } catch (e) {
    log(`[!] ${e.message}`);
    session.close();
    process.exit(3);
  } finally {
    setTimeout(() => session.close(), 200);
  }

  let text;
  if (value === undefined) text = '<undefined>';
  else if (typeof value === 'string') text = value;
  else text = JSON.stringify(value, null, 2);

  if (text.length > MAX) {
    console.log(`${text.slice(0, MAX)}\n… (截断，原长 ${text.length})`);
  } else {
    console.log(text);
  }

  if (OUT) {
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(path.resolve(OUT), text, 'utf8');
    log(`已写入 ${path.resolve(OUT)}`);
  }

  process.exit(0);
}

main().catch((e) => {
  log(`[fatal] ${e.message}`);
  process.exit(1);
});
