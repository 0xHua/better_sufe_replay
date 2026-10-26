// 匿名连取两次，看内容是否逐字节一致 + 时延（判断「存储」还是「现算」）
const BASE = 'https://dm.sufe.edu.cn';
const paths = [
  ['summary(屏幕)', '/rman/v1/intelligent/select/knowledge/summary?contentId=951c1a6f167d468ca565cd76c4289b1f'],
  ['summary(教师)', '/rman/v1/intelligent/select/knowledge/summary?contentId=86c7b4cb76924b409e1b96c23dce8434'],
  ['keyword(屏幕)', '/learn/v1/homepage/course/keywordAndAbstract?videoId=951c1a6f167d468ca565cd76c4289b1f'],
  ['point/list', '/learn/online/classroom/knowledge/point/list'],
];

import { createHash } from 'node:crypto';

for (const [name, p] of paths) {
  for (let round = 1; round <= 3; round++) {
    const t0 = performance.now();
    let txt = '', code = 0;
    try {
      const r = await fetch(BASE + p, { headers: { 'user-agent': 'Mozilla/5.0' } });
      code = r.status;
      txt = await r.text();
    } catch (e) {
      txt = 'ERR ' + e.message;
    }
    const ms = Math.round(performance.now() - t0);
    console.log(`${name.padEnd(14)} #${round} ${code} ${String(txt.length).padStart(6)}B ${String(ms).padStart(5)}ms sha=${createHash('sha1').update(txt).digest('hex').slice(0, 12)}`);
  }
}
