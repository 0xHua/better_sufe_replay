import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';

function kb(n) { return (n / 1024).toFixed(1) + ' KB'; }

async function remote(label, url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) return { label, status: r.status };
      const buf = Buffer.from(await r.arrayBuffer());
      return { label, raw: kb(buf.length), gzip: kb(gzipSync(buf, { level: 9 }).length) };
    } catch (e) {
      if (i === 2) return { label, status: 'err ' + String(e.message || e).slice(0, 40) };
      await new Promise(r => setTimeout(r, 700));
    }
  }
}

const rows = [];
rows.push(await remote('plyr.min.js', 'https://cdn.jsdelivr.net/npm/plyr@3.8.5/dist/plyr.min.js'));
rows.push(await remote('plyr.css', 'https://cdn.jsdelivr.net/npm/plyr@3.8.5/dist/plyr.css'));
rows.push(await remote('artplayer.js', 'https://cdn.jsdelivr.net/npm/artplayer@5.2.3/dist/artplayer.js'));
rows.push(await remote('xgplayer(min)', 'https://cdn.jsdelivr.net/npm/xgplayer@3/dist/index.min.js'));
rows.push(await remote('media-chrome +esm', 'https://cdn.jsdelivr.net/npm/media-chrome@4.10.0/+esm'));

for (const [label, p] of [
  ['本机 player/player.js', 'player/player.js'],
  ['本机 player/player.css', 'player/player.css'],
]) {
  if (existsSync(p)) {
    const buf = readFileSync(p);
    rows.push({ label, raw: kb(buf.length), gzip: kb(gzipSync(buf, { level: 9 }).length) });
  }
}
console.table(rows);
