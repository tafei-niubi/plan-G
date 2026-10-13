const api = window.notebookAPI;

let db = { inspiration: [], excerpt: [], todo: [], trash: [] };
let currentTab = 'inspiration';
let currentView = 'normal'; // 'normal' | 'trash'
const imageCache = {};

const TAB_CONFIG = {
  inspiration: { placeholder: '记录一条灵感...（Ctrl+Enter 快速提交）', button: '记录', empty: '还没有灵感，试试在上面写一条吧' },
  excerpt:     { placeholder: '粘贴或输入要摘录的内容...（Ctrl+Enter 快速提交）', button: '摘录', empty: '还没有摘录，试试选中文字后按 Shift+Alt+S' },
  todo:        { placeholder: '添加一个待办...（Ctrl+Enter 快速提交）', button: '添加', empty: '还没有待办，先想想最近要做什么吧' },
  trash:       { placeholder: '', button: '', empty: '回收站是空的' },
};

const listEls = {
  inspiration: document.querySelector('.nb-panel[data-panel="inspiration"]'),
  excerpt: document.querySelector('.nb-panel[data-panel="excerpt"]'),
  todo: document.querySelector('.nb-panel[data-panel="todo"]'),
  trash: document.querySelector('.nb-panel[data-panel="trash"]'),
};

function showConfirm(msg) {
  return new Promise((resolve) => {
    const modal = document.getElementById('nb-confirm');
    const msgEl = document.getElementById('nb-confirm-msg');
    if (!modal) { resolve(window.confirm(msg)); return; }
    msgEl.textContent = msg;
    modal.classList.remove('nb-confirm-hidden');
    const okBtn = document.getElementById('nb-confirm-ok');
    const cancelBtn = document.getElementById('nb-confirm-cancel');
    const cleanup = (result) => {
      modal.classList.add('nb-confirm-hidden');
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(false);
      if (e.key === 'Enter') cleanup(true);
    };
    document.addEventListener('keydown', onKey);
  });
}

document.getElementById('nb-close').onclick = () => api.close();

// 图片预览关闭
document.getElementById('nb-preview').onclick = () => {
  document.getElementById('nb-preview').classList.add('nb-preview-hidden');
  document.getElementById('nb-preview-img').src = '';
};
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('nb-preview').classList.add('nb-preview-hidden');
  }
});

// 标签切换
document.querySelectorAll('.nb-tab').forEach(tab => {
  tab.onclick = () => {
    // 退出回收站视图
    if (currentView === 'trash') {
      currentView = 'normal';
      document.getElementById('nb-trash-btn').classList.remove('active');
      document.getElementById('nb-input-area').classList.remove('hidden');
    }
    document.querySelectorAll('.nb-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;

    const cfg = TAB_CONFIG[currentTab];
    if (cfg) {
      document.getElementById('nb-input').placeholder = cfg.placeholder;
      document.getElementById('nb-add').textContent = cfg.button;
    }

    document.querySelectorAll('.nb-panel').forEach(p => p.classList.remove('active'));
    listEls[currentTab].classList.add('active');
    render();
    triggerScan();
  };
});

// 回收站按钮
document.getElementById('nb-trash-btn').onclick = () => {
  const btn = document.getElementById('nb-trash-btn');
  const inputArea = document.getElementById('nb-input-area');
  if (currentView === 'trash') {
    currentView = 'normal';
    btn.classList.remove('active');
    inputArea.classList.remove('hidden');
    document.querySelectorAll('.nb-panel').forEach(p => p.classList.remove('active'));
    listEls[currentTab].classList.add('active');
    render();
  } else {
    currentView = 'trash';
    btn.classList.add('active');
    inputArea.classList.add('hidden');
    document.querySelectorAll('.nb-panel').forEach(p => p.classList.remove('active'));
    listEls.trash.classList.add('active');
    renderTrash();
  }
  triggerScan();
};

function triggerScan() {
  const listEl = document.getElementById('nb-list');
  if (!listEl) return;
  listEl.classList.remove('scanning');
  void listEl.offsetWidth;
  listEl.classList.add('scanning');
  setTimeout(() => listEl.classList.remove('scanning'), 700);
}

function fmtTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function resolveImage(filename) {
  if (imageCache[filename]) return imageCache[filename];
  const res = await api.readImage(filename);
  if (res.ok) { imageCache[filename] = res.dataUrl; return res.dataUrl; }
  return '';
}

function render() {
  if (currentView === 'trash') { renderTrash(); return; }
  // 按时间倒序（最新的在最上面）
  const list = (db[currentTab] || []).slice().sort((a, b) => (b.time || 0) - (a.time || 0));
  const el = listEls[currentTab];
  if (!list.length) {
    el.innerHTML = '<div class="nb-empty">' + (TAB_CONFIG[currentTab] ? TAB_CONFIG[currentTab].empty : '还没有记录') + '</div>';
    return;
  }
  el.innerHTML = list.map(item => {
    const isEditing = item.__editing;
    const textHTML = isEditing
      ? '<textarea class="nb-edit-area" data-id="' + item.id + '">' + esc(item.text) + '</textarea>'
      : '<div class="nb-item-text">' + esc(item.text) + '</div>';
    const imagesHTML = (item.images && item.images.length)
      ? '<div class="nb-images">' + item.images.map(fn =>
          '<img class="nb-thumb" data-file="' + fn + '" src="' + (imageCache[fn] || '') + '" alt="" />'
        ).join('') + '</div>'
      : '';
    const commentHTML = item.comment
      ? '<div class="nb-item-comment">' + esc(item.comment) + '</div>'
      : (item.__commenting ? '<div class="nb-item-comment loading"></div>' : '');
    const actions = isEditing
      ? '<button data-act="save" data-id="' + item.id + '">保存</button>' +
        '<button data-act="cancel" data-id="' + item.id + '">取消</button>'
      : '<button data-act="comment" data-id="' + item.id + '">✨ 舰长点评</button>' +
        '<button data-act="edit" data-id="' + item.id + '">✏️ 编辑</button>' +
        '<button class="danger" data-act="delete" data-id="' + item.id + '">🗑 删除</button>';
    return '<div class="nb-item" data-id="' + item.id + '">'
      + textHTML
      + imagesHTML
      + commentHTML
      + '<div class="nb-item-time">' + fmtTime(item.time) + '</div>'
      + '<div class="nb-item-actions">' + actions + '</div>'
      + '</div>';
  }).join('');

  el.querySelectorAll('.nb-thumb').forEach(async (img) => {
    const fn = img.dataset.file;
    if (!fn) return;
    const url = await resolveImage(fn);
    if (url) img.src = url;
  });
}

function renderTrash() {
  const el = listEls.trash;
  const list = (db.trash || []).slice().sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  if (!list.length) {
    el.innerHTML = '<div class="nb-empty">回收站是空的</div>';
    return;
  }
  el.innerHTML = list.map(item => {
    const typeLabel = { inspiration: '灵感', excerpt: '摘录', todo: '待办' }[item.type] || '未知';
    return '<div class="nb-trash-item" data-id="' + item.id + '">'
      + '<span class="nb-trash-type">' + typeLabel + '</span>'
      + '<div class="nb-trash-text">' + esc(item.text) + '</div>'
      + '<div class="nb-trash-time">删除于 ' + fmtTime(item.deletedAt || item.time) + '</div>'
      + '<div class="nb-item-actions">'
      +   '<button data-act="restore" data-id="' + item.id + '">♻️ 恢复</button>'
      +   '<button class="danger" data-act="purge" data-id="' + item.id + '">🔥 彻底删除</button>'
      + '</div>'
      + '</div>';
  }).join('');
}

// 普通面板事件
['inspiration', 'excerpt', 'todo'].forEach(k => {
  listEls[k].addEventListener('click', async (e) => {
    const thumb = e.target.closest('.nb-thumb');
    if (thumb) {
      const fn = thumb.dataset.file;
      const url = await resolveImage(fn);
      if (url) {
        const pv = document.getElementById('nb-preview');
        const pvImg = document.getElementById('nb-preview-img');
        pvImg.src = url;
        pv.classList.remove('nb-preview-hidden');
      }
      return;
    }

    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    const list = db[currentTab];
    const idx = list.findIndex(x => String(x.id) === String(id));
    if (idx < 0) return;

    if (act === 'delete') {
      if (!(await showConfirm('确定删除这条吗？'))) return;
      const item = list[idx];
      list.splice(idx, 1);
      if (!Array.isArray(db.trash)) db.trash = [];
      db.trash.unshift({
        id: item.id,
        text: item.text,
        time: item.time,
        comment: item.comment,
        type: currentTab,
        deletedAt: Date.now(),
      });
      if (db.trash.length > 20) db.trash = db.trash.slice(0, 20);
      await saveDb();
      render();
    } else if (act === 'edit') {
      list[idx].__editing = true;
      render();
    } else if (act === 'cancel') {
      list[idx].__editing = false;
      render();
    } else if (act === 'save') {
      const ta = listEls[k].querySelector('textarea[data-id="' + id + '"]');
      if (ta) list[idx].text = ta.value.trim();
      list[idx].__editing = false;
      await saveDb();
      render();
    } else if (act === 'comment') {
      list[idx].__commenting = true;
      render();
      const res = await api.comment(list[idx].text);
      list[idx].__commenting = false;
      if (res.ok) {
        list[idx].comment = res.text;
      } else {
        list[idx].comment = '(点评失败：' + (res.message || '未知错误') + ')';
      }
      await saveDb();
      render();
    }
  });
});

// 回收站面板事件
listEls.trash.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;
  const idx = (db.trash || []).findIndex(x => String(x.id) === String(id));
  if (idx < 0) return;

  if (act === 'restore') {
    const item = db.trash[idx];
    const type = item.type || 'inspiration';
    if (!Array.isArray(db[type])) db[type] = [];
    db[type].push({
      id: item.id,
      text: item.text,
      time: item.time,
      comment: item.comment,
    });
    db.trash.splice(idx, 1);
    await saveDb();
    renderTrash();
  } else if (act === 'purge') {
    if (!(await showConfirm('彻底删除？此操作不可恢复。'))) return;
    db.trash.splice(idx, 1);
    await saveDb();
    renderTrash();
  }
});

async function saveDb() {
  const clean = { inspiration: [], excerpt: [], todo: [], trash: [] };
  for (const k of ['inspiration', 'excerpt', 'todo', 'trash']) {
    clean[k] = (db[k] || []).map(it => {
      const { __editing, __commenting, ...rest } = it;
      return rest;
    });
  }
  await api.save(clean);
}

document.getElementById('nb-shot').onclick = async () => {
  const res = await api.pickImage();
  if (!res.ok) {
    if (!res.canceled) bubble && bubble('图片上传失败：' + (res.message || ''), 3000);
    return;
  }
  const ta = document.getElementById('nb-input');
  const text = ta.value.trim();
  const item = {
    id: Date.now() + Math.random(),
    text: text || '(图片笔记)',
    time: Date.now(),
    images: [res.filename],
  };
  db[currentTab].push(item);
  ta.value = '';
  await saveDb();
  render();
  if (autoComment && text) {
    // 只有有文字时才自动点评
    const newIdx = db[currentTab].length - 1;
    db[currentTab][newIdx].__commenting = true;
    render();
    const r = await api.comment(item.text);
    db[currentTab][newIdx].__commenting = false;
    if (r.ok) db[currentTab][newIdx].comment = r.text;
    await saveDb();
    render();
  }
};

document.getElementById('nb-add').onclick = async () => {
  const ta = document.getElementById('nb-input');
  const text = ta.value.trim();
  if (!text) return;
  const item = { id: Date.now() + Math.random(), text, time: Date.now() };
  db[currentTab].push(item);
  ta.value = '';
  await saveDb();

  if (autoComment) {
    const newIdx = db[currentTab].length - 1;
    db[currentTab][newIdx].__commenting = true;
    render();
    const res = await api.comment(item.text);
    db[currentTab][newIdx].__commenting = false;
    if (res.ok) db[currentTab][newIdx].comment = res.text;
    await saveDb();
  }
  render();
};

document.getElementById('nb-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    document.getElementById('nb-add').click();
  }
});

let autoComment = true;

// 启动
(async () => {
  db = await api.load();
  if (!db.inspiration) db.inspiration = [];
  if (!db.excerpt) db.excerpt = [];
  if (!db.todo) db.todo = [];
  if (!db.trash) db.trash = [];
  const settings = await api.getSettings();
  autoComment = !!settings.autoComment;
  const btn = document.getElementById('nb-auto-comment');
  if (btn) {
    btn.textContent = '✨ 自动点评: ' + (autoComment ? '开' : '关');
    btn.classList.toggle('on', autoComment);
  }
  render();
  document.getElementById('nb-input').focus();
  document.getElementById('nb-input').placeholder = TAB_CONFIG[currentTab].placeholder;
  document.getElementById('nb-add').textContent = TAB_CONFIG[currentTab].button;
})();

document.getElementById('nb-auto-comment').onclick = async () => {
  autoComment = !autoComment;
  const btn = document.getElementById('nb-auto-comment');
  btn.textContent = '✨ 自动点评: ' + (autoComment ? '开' : '关');
  btn.classList.toggle('on', autoComment);
  await api.setAutoComment(autoComment);
};

if (window.notebookAPI.onRefresh) {
  window.notebookAPI.onRefresh(async () => {
    try {
      const fresh = await api.load();
      db.inspiration = Array.isArray(fresh.inspiration) ? fresh.inspiration : [];
      db.excerpt = Array.isArray(fresh.excerpt) ? fresh.excerpt : [];
      db.todo = Array.isArray(fresh.todo) ? fresh.todo : [];
      db.trash = Array.isArray(fresh.trash) ? fresh.trash : [];
      // 退出回收站视图
      currentView = 'normal';
      document.getElementById('nb-trash-btn').classList.remove('active');
      document.getElementById('nb-input-area').classList.remove('hidden');
      // 切到摘录标签
      currentTab = 'excerpt';
      document.querySelectorAll('.nb-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === 'excerpt');
      });
      document.querySelectorAll('.nb-panel').forEach(p => p.classList.remove('active'));
      listEls.excerpt.classList.add('active');
      document.getElementById('nb-input').placeholder = TAB_CONFIG.excerpt.placeholder;
      document.getElementById('nb-add').textContent = TAB_CONFIG.excerpt.button;
      render();
      triggerScan();
    } catch (e) {
      console.error('[notebook refresh]', e);
    }
  });
}

// 全局粘贴监听（Ctrl+V 粘贴剪贴板图片）
document.addEventListener('paste', async (e) => {
  if (currentView === 'trash') { showPasteHint('回收站里不能粘贴哦'); e.preventDefault(); return; }

  // 如果焦点在输入框里，让输入框先处理文本粘贴
  const active = document.activeElement;
  const isTyping = active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT');

  // 检查剪贴板里有没有图片
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  let hasImage = false;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type && items[i].type.indexOf('image') === 0) { hasImage = true; break; }
  }
  if (!hasImage) return; // 没有图片，走默认粘贴逻辑（文本）

  // 如果正在输入框里打字，且剪贴板既有图片又有文本，以文本优先
  // （浏览器默认行为已处理，这里只在纯图片时接管）
  if (isTyping && !e.clipboardData.getData('text/plain')) {
    // 输入框里粘图片 → 拦截，存入笔记本
  }
  e.preventDefault();

  const res = await window.notebookAPI.pasteImage();
  if (!res.ok) {
    showPasteHint('✗ ' + (res.message || '粘贴失败'));
    return;
  }
  const ta = document.getElementById('nb-input');
  const text = ta.value.trim();
  const item = {
    id: Date.now() + Math.random(),
    text: text || '(剪贴板图片)',
    time: Date.now(),
    images: [res.filename],
  };
  db[currentTab].push(item);
  ta.value = '';
  await saveDb();
  render();
  showPasteHint('✓ 已从剪贴板粘贴图片');
  if (autoComment && text) {
    const newIdx = db[currentTab].length - 1;
    db[currentTab][newIdx].__commenting = true;
    render();
    const r = await api.comment(item.text);
    db[currentTab][newIdx].__commenting = false;
    if (r.ok) db[currentTab][newIdx].comment = r.text;
    await saveDb();
    render();
  }
});

function showPasteHint(msg) {
  const hint = document.getElementById('nb-paste-hint');
  if (!hint) return;
  hint.textContent = msg;
  hint.classList.add('show');
  clearTimeout(hint.__timer);
  hint.__timer = setTimeout(() => hint.classList.remove('show'), 2200);
}
