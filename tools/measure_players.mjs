// 量一下几个播放器库的真实体积（CDN 上取 Range 0-0，读 content-range）
const targets = [
  ['plyr js', 'https://cdn.jsdelivr.net/npm/plyr@3.8.5/dist/plyr.min.js'],
  ['plyr css', 'https://cdn.jsdelivr.net/npm/plyr@3.8.5/dist/plyr.css'],
  ['artplayer js', 'https://cdn.jsdelivr.net/npm/artplayer@5/dist/artplayer.js'],
  ['xgplayer js', 'https://cdn.jsdelivr.net/npm/xgplayer@3/dist/index.min.js'],
  ['nplayer js', 'https://cdn.jsdelivr.net/npm/nplayer@1/dist/index.js'],
  ['dplayer js', 'https://cdn.jsdelivr.net/npm/dplayer@1/dist/DPlayer.min.js'],
  ['media-chrome', 'https://cdn.jsdelivr.net/npm/media-chrome@4/dist/media-chrome.js'],
  ['vidstack', 'https://cdn.jsdelivr.net/npm/vidstack@1/dist/vidstack.js'],
  ['videojs', 'https://cdn.jsdelivr.net/npm/video.js@8/dist/video.min.js'],
];

const out = [];
for (const [name, url] of targets) {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    const cr = r.headers.get('content-range'); // bytes 0-0/12345
    const total = cr ? Number(cr.split('/')[1]) : null;
    out.push({ name, status: r.status, bytes: total, kb: total ? Math.round(total / 1024) : null });
  } catch (e) {
    out.push({ name, status: 'err', error: String(e.message || e).slice(0, 80) });
  }
}
console.table(out);
