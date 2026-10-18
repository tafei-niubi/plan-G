// 守卫 · 加密密码库 —— 渲染进程（第5步：字段结构 + 回车提交）
const modal = document.querySelector('#password-modal');
const passwordInput = document.querySelector('#password-input');
const passwordSubmit = document.querySelector('#password-submit');
const passwordError = document.querySelector('#password-error');
const modalTitle = document.querySelector('#modal-title');
const modalSub = document.querySelector('#modal-sub');
const listEl = document.querySelector('#list');
const addBtn = document.querySelector('#add-btn');

const entryModal = document.querySelector('#entry-modal');
const entryTitle = document.querySelector('#entry-title');
const entrySite = document.querySelector('#entry-site');
const entryUser = document.querySelector('#entry-user');
const entryNick = document.querySelector('#entry-nick');
const entryPass = document.querySelector('#entry-pass');
const entryNote = document.querySelector('#entry-note');
const entryCancel = document.querySelector('#entry-cancel');
const entrySave = document.querySelector('#entry-save');
const entryError = document.querySelector('#entry-error');

let currentEntries = [];
let copyTimer = null;
let activeCopyBtn = null;
let pendingPrefill = null;
let isUnlocked = false;
let editingId = null;

function renderList() {
  listEl.innerHTML = '';
  if (!currentEntries || currentEntries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '还没有保存任何条目';
    listEl.appendChild(empty);
    return;
  }
  currentEntries.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'vault-item';

    const left = document.createElement('div');
    left.className = 'vault-left';
    const site = document.createElement('div');
    site.className = 'vault-site';
    site.textContent = entry.site || '';
    const user = document.createElement('div');
    user.className = 'vault-user';
    user.textContent = (entry.user || '') + (entry.nick ? ' · ' + entry.nick : '');
    left.appendChild(site);
    left.appendChild(user);

    const mid = document.createElement('div');
    mid.className = 'vault-mid';
    mid.textContent = '••••••••';

    const right = document.createElement('div');
    right.className = 'vault-right';
    const edit = document.createElement('button');
    edit.className = 'btn-edit';
    edit.textContent = '编辑';
    edit.addEventListener('click', () => {
      editingId = entry.id;
      entryTitle.textContent = '编辑条目';
      entrySite.value = entry.site || '';
      entryUser.value = entry.user || '';
      entryNick.value = entry.nick || '';
      entryPass.value = entry.pass || '';
      entryNote.value = entry.note || '';
      entrySave.textContent = '更新';
      entryError.textContent = '';
      entryModal.style.display = 'flex';
    });
    const copy = document.createElement('button');
    copy.className = 'btn-copy';
    copy.textContent = '复制';
    copy.addEventListener('click', async () => {
      const res = await window.vaultAPI.copy(entry.pass);
      if (!res || !res.ok) return;
      // 只保留最新一个倒计时：先清掉旧的
      if (copyTimer) { clearInterval(copyTimer); copyTimer = null; }
      if (activeCopyBtn && activeCopyBtn !== copy) {
        activeCopyBtn.disabled = false;
        activeCopyBtn.textContent = '复制';
      }
      activeCopyBtn = copy;
      let secs = 30;
      copy.disabled = true;
      copy.textContent = '已复制 ' + secs + 's';
      copyTimer = setInterval(() => {
        secs -= 1;
        if (secs <= 0) {
          clearInterval(copyTimer);
          copyTimer = null;
          activeCopyBtn = null;
          copy.disabled = false;
          copy.textContent = '复制';
        } else {
          copy.textContent = '已复制 ' + secs + 's';
        }
      }, 1000);
    });
    const del = document.createElement('button');
    del.className = 'btn-del';
    del.textContent = '删除';
    del.addEventListener('click', async () => {
      if (!confirm('确定删除这条吗？')) return;
      currentEntries = currentEntries.filter((e) => e.id !== entry.id);
      await window.vaultAPI.save(currentEntries);
      renderList();
    });
    right.appendChild(edit);
    right.appendChild(copy);
    right.appendChild(del);

    item.appendChild(left);
    item.appendChild(mid);
    item.appendChild(right);
    listEl.appendChild(item);
  });
}

window.vaultAPI.onInit((hasVault) => {
  if (hasVault) {
    modalTitle.textContent = '解锁';
    modalSub.textContent = '请输入主密码解锁';
  } else {
    modalTitle.textContent = '设置主密码';
    modalSub.textContent = '首次使用，请设置主密码';
  }
});

passwordSubmit.addEventListener('click', async () => {
  const pwd = passwordInput.value;
  const res = await window.vaultAPI.unlock(pwd);
  if (res && res.ok) {
    isUnlocked = true;
    currentEntries = res.entries || [];
    modal.style.display = 'none';
    renderList();
    if (pendingPrefill) {
      fillEntryModal(pendingPrefill);
      pendingPrefill = null;
    }
  } else {
    passwordError.textContent = (res && res.message) || '解锁失败';
  }
});

document.getElementById('password-cancel').onclick = () => {
  window.vaultAPI.close();
};

document.addEventListener('keydown', (e) => {
  const modal = document.getElementById('password-modal');
  if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
    window.vaultAPI.close();
  }
});

passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); passwordSubmit.click(); }
});

[entrySite, entryUser, entryNick, entryPass, entryNote].forEach((el) => {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); entrySave.click(); }
  });
});

addBtn.addEventListener('click', () => {
  editingId = null;
  entryTitle.textContent = '添加新条目';
  entrySave.textContent = '保存';
  entrySite.value = '';
  entryUser.value = '';
  entryNick.value = '';
  entryPass.value = '';
  entryNote.value = '';
  entryError.textContent = '';
  entryModal.style.display = 'flex';
});

entryCancel.addEventListener('click', () => {
  entryModal.style.display = 'none';
});

entrySave.addEventListener('click', async () => {
  const site = (document.getElementById('entry-site').value || '').trim();
  const user = (document.getElementById('entry-user').value || '').trim();
  const nick = (document.getElementById('entry-nick').value || '').trim();
  const pass = document.getElementById('entry-pass').value || '';
  const note = (document.getElementById('entry-note').value || '').trim();
  const errEl = document.getElementById('entry-error');
  if (!site || !pass) { if (errEl) errEl.textContent = '网站和密码不能为空'; return; }
  if (editingId) {
    const idx = currentEntries.findIndex(en => en.id === editingId);
    if (idx >= 0) currentEntries[idx] = Object.assign({}, currentEntries[idx], { site, user, nick, pass, note });
  } else {
    currentEntries.push({ id: Date.now() + Math.random(), site, user, nick, pass, note });
  }
  const res = await window.vaultAPI.save(currentEntries);
  if (res && res.ok) {
    editingId = null;
    document.getElementById('entry-modal').style.display = 'none';
    renderList();
  } else {
    if (errEl) errEl.textContent = (res && res.message) || '保存失败';
  }
});

document.querySelector('#close-btn').addEventListener('click', () => {
  window.vaultAPI.close();
});

document.querySelector('#lock-btn').addEventListener('click', () => {
  alert('锁定功能开发中');
});

if (window.vaultAPI.onPrefillPassword) {
  window.vaultAPI.onPrefillPassword((payload) => {
    if (isUnlocked) {
      fillEntryModal(payload);
    } else {
      pendingPrefill = payload;
    }
  });
}

function fillEntryModal(payload) {
  const em = document.getElementById('entry-modal');
  const eSite = document.getElementById('entry-site');
  const eUser = document.getElementById('entry-user');
  const ePass = document.getElementById('entry-pass');
  if (em) em.style.display = 'flex';
  if (eSite && payload && payload.site) eSite.value = payload.site;
  if (eUser && payload && payload.user) eUser.value = payload.user;
  if (ePass && payload && payload.pass) ePass.value = payload.pass;
}

const helpBtn = document.getElementById('help-btn');
const helpModal = document.getElementById('help-modal');
const helpClose = document.getElementById('help-close');
const copyPathBtn = document.getElementById('copy-path');
const extPathInput = document.getElementById('ext-path');

console.log('[help] 按钮存在吗：', !!helpBtn, '弹窗存在吗：', !!helpModal);

if (helpBtn && helpModal) {
  helpBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[help] 帮助按钮被点击');
    try {
      const p = await window.vaultAPI.getExtPath();
      console.log('[help] 拿到路径：', p);
      if (extPathInput) extPathInput.value = p || '';
    } catch (err) {
      console.error('[help] 获取路径失败', err);
    }
    helpModal.style.display = 'flex';
  });
}
if (helpClose && helpModal) {
  helpClose.addEventListener('click', () => { helpModal.style.display = 'none'; });
}
if (copyPathBtn && extPathInput) {
  copyPathBtn.addEventListener('click', async () => {
    const p = extPathInput.value;
    if (!p) return;
    await window.vaultAPI.copy(p);
    copyPathBtn.textContent = '已复制';
    setTimeout(() => copyPathBtn.textContent = '复制路径', 1500);
  });
}

window.ScrollWidget && window.ScrollWidget.attach(document.getElementById('list'));
