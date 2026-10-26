/* 上财空中课堂 · 回放增强 —— popup 逻辑 */
(() => {
  const $ = (s) => document.querySelector(s);
  const state = { tab: null, snap: null, selected: null };

  /* ---------- 消息封装 ---------- */

  function sendTab(tabId, msg) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, msg, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { ok: false, error: '空响应' });
          }
        });
      } catch (e) {
        resolve({ ok: false, error: String(e && e.message || e) });
      }
    });
  }

  function sendBg(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => resolve(res || {}));
      } catch (e) {
        resolve({ ok: false, error: String(e && e.message || e) });
      }
    });
  }

  /* ---------- 渲染 ---------- */

  function setPill(text, cls) {
    const el = $('#tokenPill');
    el.textContent = text;
    el.className = 'pill' + (cls ? ' ' + cls : '');
  }

  function row(v) {
    const d = document.createElement('div');
    d.textContent = v || '—';
    return d;
  }

  function renderMedia(list) {
    const box = $('#mediaList');
    box.textContent = '';
    if (!list.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = '尚未嗅到。请在回放页点一下播放，再回来。';
      box.appendChild(e);
      return;
    }
    list.forEach((m) => {
      const it = document.createElement('div');
      it.className = 'item';

      const u = document.createElement('div');
      u.className = 'u';
      u.textContent = m.display || m.url;
      u.title = m.display || m.url;

      const play = document.createElement('button');
      play.className = 'btn';
      play.textContent = '播放';
      play.addEventListener('click', () => open(m));

      const copy = document.createElement('button');
      copy.className = 'btn';
      copy.textContent = '复制';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(m.url);
          copy.textContent = '已复制';
          setTimeout(() => { copy.textContent = '复制'; }, 1200);
        } catch (_) {
          copy.textContent = '失败';
        }
      });

      it.append(u, play, copy);
      it.addEventListener('click', (ev) => {
        if (ev.target === play || ev.target === copy) return;
        state.selected = m;
        document.querySelectorAll('.item').forEach((n) => { n.style.background = ''; });
        it.style.background = '#232936';
      });
      box.appendChild(it);
    });
  }

  function renderApi(list) {
    $('#apiCount').textContent = String(list.length);
    const box = $('#apiList');
    box.textContent = '';
    if (!list.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = '还没有采集到业务接口。';
      box.appendChild(e);
      return;
    }
    const pre = document.createElement('pre');
    pre.textContent = list.map((a) => a.display || a.url).join('\n');
    box.appendChild(pre);
  }

  function render() {
    const s = state.snap;
    $('#pgTitle').textContent = s.title || '—';
    $('#pgHref').textContent = s.href || '—';

    const v = s.videos || [];
    $('#pgVideo').textContent = v.length
      ? `${v.length} 个 <video>　${v[0].w}×${v[0].h}　时长 ${v[0].duration == null ? '未知' : v[0].duration + 's'}`
      : '未找到 <video> 元素（可能在 iframe 内或用了自定义渲染）';

    setPill(
      s.token && s.token.present ? `已登录 · token ${s.token.len}B` : '未登录 · 无 token',
      s.token && s.token.present ? 'ok' : 'warn'
    );

    const media = (s.media || []).slice().reverse();
    renderMedia(media);
    renderApi(s.api || []);

    $('#openBtn').disabled = media.length === 0;
  }

  function showNoPage(reason) {
    setPill('不在回放页', 'bad');
    $('#pgTitle').textContent = '—';
    $('#pgHref').textContent = reason || '当前标签页不是 dm.sufe.edu.cn 的页面';
    $('#pgVideo').textContent = '—';
    renderMedia([]);
    renderApi([]);
    $('#openBtn').disabled = true;
  }

  /* ---------- 动作 ---------- */

  async function open(m) {
    const item = m || state.selected;
    if (!item) return;
    await sendBg({ type: 'OPEN_PLAYER', src: item.url, title: state.snap && state.snap.title });
    window.close();
  }

  async function refresh() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tab = tab || null;
    if (!tab || !tab.id) return showNoPage();

    const res = await sendTab(tab.id, { type: 'SUFE_SNAPSHOT' });
    if (!res || !res.ok) {
      return showNoPage('无法连接内容脚本：请确认当前页是 dm.sufe.edu.cn，并刷新一次页面。');
    }
    state.snap = res;
    render();
  }

  /* ---------- 事件 ---------- */

  $('#openBtn').addEventListener('click', () => open());
  $('#rescanBtn').addEventListener('click', async () => {
    if (state.tab && state.tab.id) await sendTab(state.tab.id, { type: 'SUFE_RESCAN' });
    await refresh();
  });

  $('#diagBtn').addEventListener('click', () => {
    const s = state.snap || {};
    const payload = {
      exportedAt: new Date().toISOString(),
      extVersion: chrome.runtime.getManifest().version,
      top: s.top,
      href: s.href,
      title: s.title,
      token: s.token,
      prefix: s.prefix,
      videos: s.videos,
      iframes: s.iframes,
      lsKeys: s.lsKeys,
      media: (s.media || []).map((m) => ({ url: m.display, via: m.via })),
      api: (s.api || []).map((a) => a.display),
      dom: s.dom
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sufe-replay-diag-' + Date.now() + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });

  refresh();
})();
