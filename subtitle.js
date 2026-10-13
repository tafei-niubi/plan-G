const api = window.subtitleAPI;
const bar = document.getElementById('subtitle-bar');
const textEl = document.getElementById('subtitle-text');

let dissolveTimers = [];

function clearTimers() {
  dissolveTimers.forEach(t => clearTimeout(t));
  dissolveTimers = [];
}

function play(text, stayMs) {
  clearTimers();

  const chars = Array.from(String(text));
  textEl.innerHTML = chars.map(c => {
    const safe = c.replace(/[<>&]/g, m => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[m]));
    return '<span class="subtitle-char">' + safe + '</span>';
  }).join('');

  bar.classList.remove('show');
  void bar.offsetWidth;
  bar.classList.add('show');

  const spans = textEl.querySelectorAll('.subtitle-char');
  const CHAR_INTERVAL = 55;
  const CHAR_DURATION = 320;

  spans.forEach((sp, i) => {
    const t = setTimeout(() => sp.classList.add('visible'), i * CHAR_INTERVAL);
    dissolveTimers.push(t);
  });

  const appearTotalMs = spans.length * CHAR_INTERVAL + CHAR_DURATION;

  const startDissolve = () => {
    spans.forEach((sp, i) => {
      const t = setTimeout(() => {
        sp.classList.remove('visible');
        sp.classList.add('dissolve');
      }, i * CHAR_INTERVAL);
      dissolveTimers.push(t);
    });
    const disappearTotalMs = spans.length * CHAR_INTERVAL + CHAR_DURATION;
    const t2 = setTimeout(() => {
      bar.classList.remove('show');
      setTimeout(() => { textEl.innerHTML = ''; }, 400);
    }, disappearTotalMs);
    dissolveTimers.push(t2);
  };

  const t = setTimeout(startDissolve, appearTotalMs + stayMs);
  dissolveTimers.push(t);
}

if (api && api.onPlay) {
  api.onPlay((data) => {
    if (!data) return;
    play(data.text || '', data.stayMs || 5000);
  });
}
// ===== 角色同步 =====
if (api && api.getRole) {
  api.getRole().then((key) => {
    if (key) document.body.dataset.role = key;
  }).catch(() => {});
}
if (api && api.onRole) {
  api.onRole((key) => {
    if (key) document.body.dataset.role = key;
    // 切换角色时，立刻清空旧台词
    clearTimers();
    textEl.innerHTML = '';
    bar.classList.remove('show');
  });
}