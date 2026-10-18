const api = window.diaryAPI;

let currentDate = '';
let allDates = [];
let currentRole = 'captain';

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

async function loadDate(dateStr) {
  currentDate = dateStr;
  document.getElementById('date-label').textContent = dateStr;
  const body = document.getElementById('body');

  if (currentRole === 'user') {
    body.innerHTML = '<div class="user-empty">还没有写过日记<br><span style="font-size:12px;opacity:0.6">手写功能即将上线</span></div>';
    return;
  }

  const res = await api.read(dateStr);
  if (!res || !res.ok) {
    body.innerHTML = '<div class="empty">这一天空白</div>';
    return;
  }
  body.innerHTML = renderDiary(res.text, currentRole);
}

function renderDiary(text, role) {
  if (!text || !text.trim()) return '<div class="empty">这一天空白</div>';
  const roleNameMap = { captain: '舰长', maid: '女仆', guard: '守卫' };
  const targetName = roleNameMap[role];
  if (!targetName) return '<div class="empty">这一天空白</div>';

  const lines = text.split('\n');
  const groups = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { cur = null; continue; }
    const m = line.match(/^(\d{1,2}:\d{2})\s+\[([^\]]+)\]\s+(舰长|女仆|守卫)：(.+)$/);
    if (!m) continue;
    const time = m[1], tag = m[2], speaker = m[3], content = m[4];
    if (speaker !== targetName) continue; // 只保留该角色的行
    if (cur && cur.time === time && cur.tag === tag) {
      cur.lines.push({ speaker, content });
    } else {
      cur = { time, tag, lines: [{ speaker, content }] };
      groups.push(cur);
    }
  }
  if (!groups.length) return '<div class="empty">这一天没有记录</div>';

  return groups.map(g => {
    const linesHtml = g.lines.map(l =>
      '<div class="line">' +
        '<span class="text">' + escapeHtml(l.content) + '</span>' +
      '</div>'
    ).join('');
    return '<div class="entry">' +
      '<div class="line">' +
        '<span class="time">' + g.time + '</span>' +
        '<span class="tag">' + escapeHtml(g.tag) + '</span>' +
      '</div>' +
      linesHtml +
    '</div>';
  }).join('');
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function loadList() {
  const res = await api.list();
  if (res && res.ok) allDates = res.files || [];
}

async function loadWeather() {
  const cfg = await api.getWeather();
  const el = document.getElementById('weather-label');
  if (!el) return;
  if (cfg && cfg.city && cfg.temp != null) {
    el.textContent = '· ' + cfg.condition + ' ' + cfg.temp + '℃';
  }
}

function shiftDay(delta) {
  const d = new Date(currentDate + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  const pad = (n) => String(n).padStart(2, '0');
  const next = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  loadDate(next);
}

document.getElementById('prev-day').onclick = () => shiftDay(-1);
document.getElementById('next-day').onclick = () => shiftDay(1);
document.getElementById('today-btn').onclick = () => loadDate(todayStr());
document.getElementById('close-btn').onclick = () => api.close();

document.querySelectorAll('#tabs .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('#tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentRole = tab.dataset.role;
    document.body.dataset.role = currentRole;
    loadDate(currentDate || todayStr());
  });
});

(async () => {
  await loadList();
  loadDate(todayStr());
  loadWeather();
})();

window.ScrollWidget && window.ScrollWidget.attach(document.getElementById('body'));
