'use strict';
/**
 * content.js —— 跑在 dm.sufe.edu.cn 页面里的小代理。
 *
 * 它存在的唯一理由：会话 Cookie（S1_rman_sid）是 HttpOnly + SameSite=Lax，
 * 只有「学校页面自己发的请求」才会带上它。所以让后台开一个后台标签页，
 * 由这里替我们发同源 fetch，再把结果送回扩展。
 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === 'SUFE_PING') {
    sendResponse({ ok: true, href: location.href });
    return;
  }

  if (msg.type !== 'SUFE_FETCH') return;

  fetch(msg.path, { credentials: 'include', cache: 'no-store' })
    .then(async (r) => {
      sendResponse({ ok: true, status: r.status, text: await r.text() });
    })
    .catch((e) => {
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
    });

  return true; // 异步返回
});
