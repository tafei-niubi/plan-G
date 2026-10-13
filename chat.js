// 聊天窗口 —— 渲染进程
const api = window.chatAPI;
const $ = (s) => document.querySelector(s);
const messages = $('#messages');
const empty = $('#empty');
const input = $('#input');
const sendBtn = $('#send');

// ---- 简易 Markdown 渲染(代码块 / 行内代码 / 加粗 / 标题 / 列表) ----
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMd(text) {
  let src = escapeHtml(text);
  const codeBlocks = [];
  // 抽取围栏代码块,临时占位,避免后续换行替换污染代码
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

function scroll() { messages.scrollTop = messages.scrollHeight; }
function hideEmpty() { empty.classList.add('hidden'); }
function showEmpty() { empty.classList.remove('hidden'); }

function addMsg(role, text) {
  hideEmpty();
  const row = document.createElement('div');
  row.className = 'msg ' + role;
  if (role === 'assistant') {
    const av = document.createElement('div');
    av.className = 'avatar';
    av.textContent = 'V';
    row.appendChild(av);
  }
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const content = document.createElement('div');
  content.className = 'content';
  bubble.appendChild(content);
  row.appendChild(bubble);
  if (text != null && text !== '') content.innerHTML = renderMd(text);
  messages.appendChild(row);
  scroll();
  return content;
}

let currentAssistant = null;
let assistantRaw = '';

function setAssistant(text) {
  assistantRaw = text;
  currentAssistant.innerHTML = renderMd(text);
  scroll();
}

function setBusy(busy) {
  sendBtn.disabled = busy;
}

function send() {
  const text = input.value.trim();
  if (!text || currentAssistant) return; // 回复进行中不重复发送
  addMsg('user', text);
  input.value = '';
  autoGrow();
  assistantRaw = '';
  currentAssistant = addMsg('assistant', '');
  setBusy(true);
  api.send(text);
}

api.onChunk((d) => {
  if (currentAssistant) setAssistant(assistantRaw + d.text);
});
api.onDone((d) => {
  if (currentAssistant) {
    if (!assistantRaw.trim()) setAssistant(d.text || '(没有回复)');
    currentAssistant = null;
    setBusy(false);
    scroll();
  }
});
api.onError((d) => {
  if (currentAssistant) {
    setAssistant(d.message || '出错了');
    currentAssistant = null;
    setBusy(false);
  }
});

// 输入框自适应高度
function autoGrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
}

$('#send').addEventListener('click', send);
input.addEventListener('input', autoGrow);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
$('#close').addEventListener('click', () => api.close());
$('#clear').addEventListener('click', () => {
  api.clear();
  messages.querySelectorAll('.msg').forEach((m) => m.remove());
  showEmpty();
});

// 加载最近历史
api.load().then((history) => {
  if (history && history.length) {
    history.forEach((m) => addMsg(m.role, m.content));
  }
});

api.onRoleInfo((d) => {
  if (d && d.name) document.getElementById('title').textContent = d.name;
  const av = document.querySelector('.brand .avatar');
  if (av && d && d.avatar) av.textContent = d.avatar;
});

input.focus();
