/* 上财空中课堂 · 回放增强 —— 后台 service worker
 *
 * 只做本地存取与开页，不向任何第三方发起网络请求。
 */

const KEY = {
  token: 'sufe_token',
  media: 'sufe_media',
  api: 'sufe_api'
};

const MEDIA_CAP = 200;
const API_CAP = 300;

/* ---------- 存储 ---------- */

async function get(key, fallback) {
  const o = await chrome.storage.local.get(key);
  return o && o[key] !== undefined ? o[key] : fallback;
}

async function set(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

/* ---------- token ---------- */

async function saveToken(token, origin) {
  if (!token || typeof token !== 'string') return;
  const prev = await get(KEY.token, null);
  if (prev && prev.token === token) return;
  await set(KEY.token, {
    token,
    origin: origin || 'https://dm.sufe.edu.cn',
    savedAt: Date.now()
  });
}

/* ---------- 直链 / 接口 ---------- */

async function addItems(key, items, cap, keyOf) {
  if (!Array.isArray(items) || !items.length) return;
  const list = await get(key, []);
  const map = new Map(list.map((x) => [keyOf(x), x]));
  for (const it of items) {
    const k = keyOf(it);
    if (!k) continue;
    map.set(k, { ...it, at: Date.now() });
  }
  const next = [...map.values()].slice(-cap);
  await set(key, next);
  await refreshBadge();
}

function mediaKey(x) { return typeof x === 'string' ? x : x && x.url; }

async function refreshBadge() {
  const media = await get(KEY.media, []);
  const n = media.length;
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#2f6feb' });
    await chrome.action.setBadgeText({ text: n ? String(n) : '' });
  } catch (_) { /* noop */ }
}

/* ---------- 打开增强播放器 ---------- */

async function openPlayer(src, title) {
  if (!src) return { ok: false, error: '缺少视频地址' };
  let url = chrome.runtime.getURL('player/index.html') + '?src=' + encodeURIComponent(src);
  if (title) url += '&title=' + encodeURIComponent(title);
  const tab = await chrome.tabs.create({ url });
  return { ok: true, tabId: tab.id };
}

/* ---------- 消息 ---------- */

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg || typeof msg !== 'object') return false;

  switch (msg.type) {
    case 'TOKEN':
      saveToken(msg.token, msg.origin);
      reply({ ok: true });
      return false;

    case 'MEDIA':
      addItems(KEY.media, msg.items, MEDIA_CAP, mediaKey);
      reply({ ok: true });
      return false;

    case 'API':
      addItems(KEY.api, msg.items, API_CAP, mediaKey);
      reply({ ok: true });
      return false;

    case 'OPEN_PLAYER':
      openPlayer(msg.src, msg.title)
        .then(reply)
        .catch((e) => reply({ ok: false, error: String(e && e.message || e) }));
      return true;

    case 'GET_STATE':
      Promise.all([get(KEY.token, null), get(KEY.media, []), get(KEY.api, [])])
        .then(([token, media, api]) => reply({ ok: true, token, media, api }))
        .catch((e) => reply({ ok: false, error: String(e) }));
      return true;

    case 'CLEAR':
      chrome.storage.local.remove(msg.keys || Object.values(KEY))
        .then(() => { refreshBadge(); reply({ ok: true }); })
        .catch((e) => reply({ ok: false, error: String(e) }));
      return true;

    default:
      return false;
  }
});

chrome.runtime.onInstalled.addListener(() => { refreshBadge(); });
chrome.runtime.onStartup.addListener(() => { refreshBadge(); });
