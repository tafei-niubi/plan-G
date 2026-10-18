// 划词助手 —— 渲染进程
const api = window.qaAPI;
const $ = (s) => document.querySelector(s);
const result = $('#result');
const srcEl = $('#src');
const label = $('#mode-label');
const copyBtn = $('#copy');

const MODE_LABELS = { auto: '✨ 智能', translate: '🌐 翻译', explain: '💡 解释', summary: '📋 总结', polish: '✍️ 润色' };

let sourceText = '';
let currentMode = 'auto';
let raw = '';
const tabState = {
  ai: { raw: '', html: '' },
  tools: { raw: '', html: '' },
};
let currentTab = 'ai';
let busy = false;
let reqId = 0;

// ---- 简易 Markdown 渲染(与 chat.js 一致) ----
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function renderMd(text) {
  let src = escapeHtml(text);
  const codeBlocks = [];
  src = src.replace(/```([\w+-]*)\n?([\s\S]*?)(```|$)/g, (m, lang, code) => {
    codeBlocks.push('<pre><code>' + code.replace(/\n$/, '') + '</code></pre>');
    return '\u0000' + (codeBlocks.length - 1) + '\u0000';
  });
  src = src.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  src = src.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  src = src.split('\n').map((line) => {
    if (/^###\s+/.test(line)) return '<h4>' + line.replace(/^###\s+/, '') + '</h4>';
    if (/^##\s+/.test(line)) return '<h3>' + line.replace(/^##\s+/, '') + '</h3>';
    if (/^#\s+/.test(line)) return '<h2>' + line.replace(/^#\s+/, '') + '</h2>';
    if (/^\s*[-*]\s+/.test(line)) return '<li>' + line.replace(/^\s*[-*]\s+/, '') + '</li>';
    return line;
  }).join('\n');
  src = src.replace(/\n/g, '<br>');
  src = src.replace(/\u0000(\d+)\u0000/g, (m, i) => codeBlocks[+i]);
  return src;
}

function setMode(mode) {
  currentMode = mode;
  label.textContent = MODE_LABELS[mode] || MODE_LABELS.auto;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.mode === mode));
}

function setBusy(b) {
  busy = b;
  document.querySelectorAll('.chip').forEach((c) => { c.disabled = b; });
  document.querySelectorAll('.tool-btn').forEach((btn) => { btn.disabled = b; });
}

function startRun(mode, text) {
  if (text != null && text !== '') sourceText = text;
  setMode(mode);
  srcEl.textContent = sourceText;
  srcEl.classList.remove('placeholder');
  result.classList.remove('placeholder');
  result.innerHTML = '<span class="placeholder">正在思考…</span>';
  raw = '';
  copyBtn.textContent = '复制';
  reqId += 1;
  setBusy(true);
  api.run({ mode, text: sourceText, reqId });
}

api.onStart((d) => { if (d && d.text) startRun(d.mode || 'auto', d.text); });
api.onChunk((d) => {
  if (d.reqId !== reqId) return; // 丢弃过期请求的残留片段
  raw += d.text;
  const html = renderMd(raw);
  tabState.ai.raw = raw;
  tabState.ai.html = html;
  if (currentTab === 'ai') {
    result.innerHTML = html;
    result.scrollTop = result.scrollHeight;
  }
});
api.onDone((d) => {
  if (d.reqId !== reqId) return;
  setBusy(false);
  if (!raw.trim() && d.text) raw = d.text;
  if (!raw.trim()) raw = '(没有结果)';
  const html = renderMd(raw);
  tabState.ai.raw = raw;
  tabState.ai.html = html;
  if (currentTab === 'ai') {
    result.innerHTML = html;
  }
});
api.onError((d) => {
  if (d.reqId !== reqId) return;
  setBusy(false);
  const html = renderMd(d.message || '出错了');
  raw = '';
  tabState.ai.raw = '';
  tabState.ai.html = html;
  if (currentTab === 'ai') {
    result.innerHTML = html;
  }
});

document.querySelectorAll('.chip').forEach((c) => {
  c.addEventListener('click', () => { if (!busy) startRun(c.dataset.mode, sourceText); });
});

copyBtn.addEventListener('click', () => {
  if (raw.trim()) api.writeClipboard(raw);
  copyBtn.textContent = '已复制';
  setTimeout(() => { copyBtn.textContent = '复制'; }, 1200);
});
$('#close').addEventListener('click', () => api.close());

// 首次加载拉取待处理内容
api.init().then((d) => { if (d && d.text) startRun(d.mode || 'auto', d.text); });

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

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    if (target === currentTab) return;

    // 保存当前 tab 的结果
    tabState[currentTab].raw = raw;
    tabState[currentTab].html = result.innerHTML;

    // 切换 active 状态
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === target));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === target));

    // 载入目标 tab 的结果
    currentTab = target;
    raw = tabState[target].raw;
    if (tabState[target].html) {
      result.innerHTML = tabState[target].html;
      result.classList.remove('placeholder');
    } else {
      result.innerHTML = '<span class="placeholder">选中文字后按 Shift+Alt+A 使用</span>';
      result.classList.add('placeholder');
    }
    copyBtn.textContent = '复制';
  });
});

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (busy) return;
    if (!sourceText) {
      result.classList.add('placeholder');
      result.textContent = '没有源文本，先选中一段文字打开我';
      return;
    }
    const tool = btn.dataset.tool;
    setBusy(true);
    result.classList.remove('placeholder');
    result.innerHTML = '<span class="placeholder">处理中…</span>';
    const res = await api.tool({ tool, text: sourceText });
    setBusy(false);
    const html = res.ok
      ? '<pre>' + escapeHtml(res.text) + '</pre>'
      : '<span class="placeholder">✗ ' + escapeHtml((res && res.message) || '处理失败') + '</span>';
    raw = res.ok ? res.text : '';
    tabState.tools.raw = raw;
    tabState.tools.html = html;
    if (currentTab === 'tools') {
      result.innerHTML = html;
    }
  });
});
const pinBtn = document.getElementById('pin');
let alwaysOnTop = false;

(async () => {
  if (!pinBtn) return;
  try {
    alwaysOnTop = await api.getAlwaysOnTop();
  } catch (e) {}
  pinBtn.classList.toggle('active', !!alwaysOnTop);

  pinBtn.addEventListener('click', async () => {
    alwaysOnTop = !alwaysOnTop;
    await api.setAlwaysOnTop(alwaysOnTop);
    pinBtn.classList.toggle('active', alwaysOnTop);
  });
})();
window.ScrollWidget && window.ScrollWidget.attach(document.getElementById('result'));
