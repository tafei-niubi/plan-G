const api = window.pwdConfirmAPI;

// 缓存最近一次完整 payload，避免点「加入密码库」时数据丢失
let lastPayload = null;

if (api && api.onShow) {
  api.onShow((payload) => {
    if (!payload) return;
    lastPayload = payload;

    if (payload.type === 'password') {
      document.getElementById('pwd-panel').style.display = 'block';
      document.getElementById('sensitive-panel').style.display = 'none';
      const d = payload.data || {};
      const siteEl = document.getElementById('pwd-site');
      const passEl = document.getElementById('pwd-pass');
      let hint = '来自：' + (d.site || '未知网站');
      if (d.user) hint += ' · ' + d.user;
      siteEl.textContent = hint;
      const text = d.pass || '';
      passEl.textContent = text.length > 6 ? text.slice(0, 3) + '••••••' + text.slice(-2) : '••••••';
    } else if (payload.type === 'sensitive') {
      document.getElementById('pwd-panel').style.display = 'none';
      document.getElementById('sensitive-panel').style.display = 'block';
      const d = payload.data || {};
      document.getElementById('sensitive-type').textContent = '检测到疑似' + (d.type || '敏感信息');
      const s = String(d.text || '');
      document.getElementById('sensitive-preview').textContent =
        s.length > 8 ? s.slice(0, 4) + '••••••' + s.slice(-4) : '••••••';
      document.getElementById('sensitive-advice').textContent = d.advice ? '💡 ' + d.advice : '';
    } else if (payload.type === 'suspicious') {
      document.getElementById('pwd-panel').style.display = 'none';
      document.getElementById('sensitive-panel').style.display = 'block';
      const d = payload.data || {};
      document.getElementById('sensitive-type').textContent = '检测到可疑连接';
      document.getElementById('sensitive-preview').textContent = '[' + (d.ip || '') + ':' + (d.port || '') + ']';
      document.getElementById('sensitive-advice').textContent = '';
    }
  });
}

function closeWin() {
  if (api && api.close) api.close();
}

document.getElementById('pwd-yes').onclick = () => {
  const data = lastPayload && lastPayload.type === 'password' ? lastPayload.data : null;
  if (api && api.accept) api.accept(data);
  closeWin();
};
document.getElementById('pwd-no').onclick = () => closeWin();

document.querySelectorAll('.panel-close').forEach((btn) => {
  btn.onclick = () => closeWin();
});
