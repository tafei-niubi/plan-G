// 翻译窗口 —— 渲染进程
const api = window.translateAPI;
const $ = (s) => document.querySelector(s);
const src = $('#src');
const out = $('#out');
const goBtn = $('#go');

function setOut(text, placeholder) {
  if (text == null || text === '') {
    out.textContent = placeholder || '译文会显示在这里';
    out.classList.add('placeholder');
  } else {
    out.textContent = text;
    out.classList.remove('placeholder');
  }
}

async function go() {
  const text = src.value.trim();
  if (!text) { setOut('请输入要翻译的内容'); return; }
  goBtn.disabled = true;
  goBtn.textContent = '翻译中…';
  setOut('……');
  const res = await api.send(text, $('#target').value);
  goBtn.disabled = false;
  goBtn.textContent = '翻译';
  if (res && res.ok) setOut(res.text);
  else setOut((res && res.message) || '翻译失败');
}

$('#go').addEventListener('click', go);
src.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); }
});
$('#close').addEventListener('click', () => api.close());
$('#paste').addEventListener('click', async () => {
  const t = await api.readClipboard();
  if (t) { src.value = t; src.focus(); }
});
$('#copy').addEventListener('click', async () => {
  const t = out.textContent;
  if (!t || out.classList.contains('placeholder')) return;
  await api.writeClipboard(t);
  $('#copy').textContent = '已复制';
  setTimeout(() => { $('#copy').textContent = '复制'; }, 1200);
});

src.focus();

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
  const KEY = 'translate';
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
