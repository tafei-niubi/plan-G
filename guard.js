// 守卫 · 控制台 —— 渲染进程（第3步：颜色标记 + 白名单）
const $ = (s) => document.querySelector(s);

const tabNet = $('#tab-net');
const tabSys = $('#tab-sys');
const panelNet = $('#panel-net');
const panelSys = $('#panel-sys');

let whiteList = [];

function switchTab(name) {
  const isNet = name === 'net';
  tabNet.classList.toggle('active', isNet);
  tabSys.classList.toggle('active', !isNet);
  panelNet.style.display = isNet ? 'flex' : 'none';
  panelSys.style.display = isNet ? 'none' : 'flex';
}

tabNet.addEventListener('click', () => switchTab('net'));
tabSys.addEventListener('click', () => switchTab('sys'));

$('#close-btn').addEventListener('click', () => {
  window.guardAPI.close();
});

async function loadWhitelist() {
  try {
    const list = await window.guardAPI.getWhitelist();
    whiteList = Array.isArray(list) ? list : [];
  } catch (e) {
    whiteList = [];
  }
}

const SUSPICIOUS_PORTS = [23, 445, 135, 139, 1433, 3389, 5900, 6667, 12345, 3000, 4444, 8080];

async function refreshConnections() {
  const res = await window.guardAPI.getConnections();
  const listEl = document.querySelector('#conn-list') || document.querySelector('[data-panel="conn"] .list');
  if (!listEl) return;
  if (!res.ok) { listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#a8888d;">获取失败：' + (res.message||'') + '</div>'; return; }
  if (!res.list.length) { listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#a8888d;">暂无活动连接</div>'; return; }
  listEl.innerHTML = res.list.map(c => {
    const rport = parseInt((c.remote.split(':')[1] || '0'), 10);
    const rip = c.remote.split(':')[0];
    let level = 'normal';
    if (whiteList.includes(rip)) level = 'safe';
    else if (SUSPICIOUS_PORTS.includes(rport)) level = 'danger';
    else if (/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(rip)) level = 'private';
    else if (rip === '127.0.0.1' || rip === '::1' || rip === 'localhost') level = 'private';
    else if (!rip || rip === '(监听中)') level = 'normal';
    const colorMap = { danger: '#ff2d55', private: '#00e5ff', normal: '#f5e8ea', safe: '#4d9966' };
    const color = colorMap[level] || '#f5e8ea';
    const badge = level === 'danger' ? ' ⚠️' : '';
    const isRealIp = rip && rip !== '(监听中)';
    const btn = isRealIp
      ? (whiteList.includes(rip)
          ? '<button class="wl-btn" data-ip="' + rip + '" data-action="remove">移除白名单</button>'
          : '<button class="wl-btn" data-ip="' + rip + '" data-action="add">+白名单</button>')
      : '';
    return '<div class="conn-row" style="color:' + color + '; padding:6px 10px; border-bottom:1px solid rgba(255,45,85,0.1); font-family:Consolas,monospace; font-size:12px;">'
      + '<span class="dot dot-' + level + '"></span>'
      + '<span style="opacity:0.6;">[' + c.protocol.toUpperCase() + ']</span> '
      + c.remote + ' <span style="opacity:0.5;">' + c.state + '</span>' + badge
      + '<span style="float:right;">' + btn + '</span>'
      + '</div>';
  }).join('');
  listEl.querySelectorAll('.wl-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ip = btn.getAttribute('data-ip');
      const action = btn.getAttribute('data-action');
      if (action === 'add') await window.guardAPI.addWhitelist(ip);
      else await window.guardAPI.removeWhitelist(ip);
      await loadWhitelist();
      refreshConnections();
    });
  });
}

async function refreshSysInfo() {
  const res = await window.guardAPI.getSysInfo();
  if (!res || !res.ok) return;
  const cpuEl = $('#sys-cpu');
  const memEl = $('#sys-mem');
  const diskEl = $('#sys-disk');
  if (cpuEl) {
    cpuEl.textContent = (res.cpu != null ? res.cpu : 0) + '%';
    cpuEl.style.color = res.cpu > 80 ? '#ff2d55' : '#ff9d00';
  }
  if (memEl) {
    const used = res.memUsed != null ? res.memUsed : 0;
    const total = res.memTotal != null ? res.memTotal : 0;
    const pct = total > 0 ? ((used / total) * 100).toFixed(1) : '0.0';
    memEl.textContent = '已用 ' + used + ' GB / 总共 ' + total + ' GB (' + pct + '%)';
  }
  if (diskEl) {
    const disks = Array.isArray(res.disk) ? res.disk : [];
    if (!disks.length) {
      diskEl.textContent = '无数据';
    } else {
      diskEl.innerHTML = disks.map(d => {
        const red = d.use > 90;
        return '<div style="margin-bottom:3px;' + (red ? 'color:#ff2d55;' : '') + '">'
          + d.fs + ' ' + d.used + '/' + d.size + ' GB (' + d.use + '%)'
          + '</div>';
      }).join('');
    }
  }
}

$('#refresh-btn').addEventListener('click', refreshConnections);

(async () => {
  await loadWhitelist();
  refreshConnections();
  refreshSysInfo();
})();

window.ScrollWidget && window.ScrollWidget.attach(document.getElementById('conn-list'));
