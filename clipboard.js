// 剪贴板历史 —— 渲染进程
const listEl = document.getElementById('list');
const searchEl = document.getElementById('search');
const clearBtn = document.getElementById('clear-btn');
const closeBtn = document.getElementById('close-btn');

let items = [];
let query = '';
let menuEl = null;

function fmtTime(ts) {
  const d = new Date(ts);
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const DD = String(d.getDate()).padStart(2, '0');
  const HH = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return MM + '-' + DD + ' ' + HH + ':' + mm;
}

function sorted() {
  const q = query.trim().toLowerCase();
  let list = items;
  if (q) {
    list = items.filter((it) => {
      if (it.type === 'text') return (it.content || '').toLowerCase().includes(q);
      return (it.imageFile || '').toLowerCase().includes(q);
    });
  }
  return list.slice().sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return b.time - a.time;
  });
}

async function render() {
  listEl.innerHTML = '';
  const list = sorted();
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '还没有剪贴记录';
    listEl.appendChild(empty);
    return;
  }
  for (const it of list) {
    const el = document.createElement('div');
    el.className = 'clip-item' + (it.pinned ? ' pinned' : '');
    el.dataset.id = String(it.id);

    const content = document.createElement('div');
    if (it.type === 'text') {
      content.className = 'clip-content text';
      content.textContent = it.content || '';
    } else {
      content.className = 'clip-content image';
      const img = document.createElement('img');
      img.className = 'clip-thumb';
      img.alt = it.imageFile || '';
      try {
        const res = await window.clipboardHistoryAPI.readImage(it.imageFile);
        if (res && res.ok) img.src = res.dataUrl;
      } catch (e) {}
      content.appendChild(img);
    }

    const time = document.createElement('div');
    time.className = 'clip-time';
    time.textContent = fmtTime(it.time);

    const actions = document.createElement('div');
    actions.className = 'clip-actions';
    const copyBtn = document.createElement('button');
    copyBtn.dataset.act = 'copy';
    copyBtn.textContent = '复制';
    copyBtn.title = '复制';
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const res = await window.clipboardHistoryAPI.copyOnly(it.id);
      if (res && res.ok) {
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = '复制'; }, 800);
      }
    });
    const pinBtn = document.createElement('button');
    pinBtn.dataset.act = 'pin';
    pinBtn.textContent = '置顶';
    pinBtn.title = it.pinned ? '取消置顶' : '置顶';
    if (it.pinned) pinBtn.classList.add('on');
    pinBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.clipboardHistoryAPI.togglePin(it.id);
      await load();
    });
    const delBtn = document.createElement('button');
    delBtn.dataset.act = 'delete';
    delBtn.textContent = '删除';
    delBtn.title = '删除';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.clipboardHistoryAPI.del(it.id);
      await load();
    });
    actions.appendChild(copyBtn);
    actions.appendChild(pinBtn);
    actions.appendChild(delBtn);

    el.appendChild(content);
    el.appendChild(time);
    el.appendChild(actions);

    el.addEventListener('click', () => window.clipboardHistoryAPI.paste(it.id));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, it);
    });

    listEl.appendChild(el);
  }
}

async function load() {
  try {
    const res = await window.clipboardHistoryAPI.list();
    items = (res && res.items) || [];
  } catch (e) {
    items = [];
  }
  await render();
}

function hideMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
}
function showMenu(x, y, item) {
  hideMenu();
  menuEl = document.createElement('div');
  menuEl.className = 'ctx-menu';
  const mk = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => { hideMenu(); fn(); });
    menuEl.appendChild(b);
  };
  mk('回贴', () => window.clipboardHistoryAPI.paste(item.id));
  mk(item.pinned ? '取消置顶' : '置顶', async () => { await window.clipboardHistoryAPI.togglePin(item.id); await load(); });
  mk('删除', async () => { await window.clipboardHistoryAPI.del(item.id); await load(); });
  document.body.appendChild(menuEl);
  menuEl.style.left = Math.max(4, Math.min(x, window.innerWidth - 120)) + 'px';
  menuEl.style.top = Math.max(4, Math.min(y, window.innerHeight - 120)) + 'px';
}

searchEl.addEventListener('input', () => {
  query = searchEl.value;
  render();
});

clearBtn.addEventListener('click', async () => {
  if (!confirm('清空所有未置顶的剪贴记录？')) return;
  await window.clipboardHistoryAPI.clearAll();
  await load();
});

closeBtn.addEventListener('click', () => window.clipboardHistoryAPI.close());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.clipboardHistoryAPI.close();
});

document.addEventListener('click', (e) => {
  if (menuEl && !menuEl.contains(e.target)) hideMenu();
});

load();

(async () => {
  try {
    const key = await window.roleAPI.getCurrent();
    if (key) document.body.dataset.role = key;
  } catch (e) {}
})();
if (window.roleAPI) {
  window.roleAPI.onRoleChange((key) => {
    if (key) document.body.dataset.role = key;
  });
}

(() => {
  const pinBtn = document.getElementById('pin');
  if (!pinBtn || !window.windowAPI) return;
  const KEY = 'clipboard';
  let on = false;
  (async () => {
    try { on = await window.windowAPI.getAlwaysOnTop(KEY); } catch (e) {}
    pinBtn.classList.toggle('active', !!on);
  })();
  pinBtn.addEventListener('click', async () => {
    on = !on;
    await window.windowAPI.setAlwaysOnTop(KEY, on);
    pinBtn.classList.toggle('active', on);
  });
})();

window.ScrollWidget && window.ScrollWidget.attach(document.getElementById('list'));
