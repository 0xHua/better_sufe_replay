const targets = [
  ['plyr js', 'https://cdn.jsdelivr.net/npm/plyr@3.8.5/dist/plyr.min.js'],
  ['plyr css', 'https://cdn.jsdelivr.net/npm/plyr@3.8.5/dist/plyr.css'],
  ['artplayer', 'https://cdn.jsdelivr.net/npm/artplayer@5.2.3/dist/artplayer.js'],
  ['media-chrome', 'https://cdn.jsdelivr.net/npm/media-chrome@4.10.0/dist/index.js'],
  ['videojs', 'https://cdn.jsdelivr.net/npm/video.js@8.21.0/dist/video.min.js'],
  ['vidstack', 'https://cdn.jsdelivr.net/npm/@vidstack/cdn@1/dist/player.js'],
];

async function once(name, url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { Range: 'bytes=0-0' }, redirect: 'follow' });
      const cr = r.headers.get('content-range');
      const total = cr ? Number(cr.split('/')[1]) : null;
      if (r.status === 404 || r.status === 403) return { name, url, status: r.status };
      return { name, url, status: r.status, kb: total ? Math.round(total / 1024) : '?' };
    } catch (e) {
      if (i === 2) return { name, url, status: 'err', error: String(e.message || e).slice(0, 60) };
      await new Promise(r => setTimeout(r, 800));
    }
  }
}

const out = [];
for (const [n, u] of targets) out.push(await once(n, u));
console.table(out);
