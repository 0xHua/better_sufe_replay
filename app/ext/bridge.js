'use strict';
/**
 * bridge.js —— 页面和扩展之间的那一层。
 *
 * 在扩展页面里（chrome-extension://…/index.html）它会接管取数：
 * 让 background 去学校接口拿最新课程列表，再交给 page。
 *
 * 不在扩展里时（file:// 或者 127.0.0.1），它什么也不做，
 * 页面会退回原来的方式：fetch data/courses.json。
 */

(function () {
  var hasExt = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
  if (!hasExt) return;

  function send(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (res) {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { ok: false, error: 'no-response' });
          }
        });
      } catch (e) {
        resolve({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    });
  }

  window.SUFEBridge = {
    available: true,
    /** 让扩展去取一次课程列表（force=true 时后台也会重新取） */
    getCourses: function (opts) {
      return send(Object.assign({ type: 'GET_COURSES' }, opts || {}));
    },
    /** 拿某门课每节课的画面直链 */
    getMedia: function (opts) {
      return send(Object.assign({ type: 'GET_MEDIA' }, opts || {}));
    },
    openLogin: function (url) {
      return send({ type: 'OPEN_LOGIN', url: url });
    },
    openApp: function () {
      return send({ type: 'OPEN_APP' });
    },
    /**
     * 课程富数据（只读，后台内存缓存 30 分钟，不落盘）
     * kind: summary | keyword | shots | vtt
     */
    rich: function (kind, id, vid) {
      return send({ type: 'GET_RICH', kind: kind, id: id, vid: vid });
    },
    /** 让浏览器真正下载（扩展 downloads 权限），失败返回 ok:false */
    download: function (url, name) {
      return send({ type: 'DOWNLOAD', url: url, name: name });
    },
  };
})();
