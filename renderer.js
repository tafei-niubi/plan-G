// G计划 —— 渲染进程:视频动画 + 加权行为 + 交互 + 养成 + 余额/碎碎念
const api = window.petAPI;
const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const petWrap = $('#pet-wrapper');

let ttsEnabled = true;
let currentAudio = null;


const STATUS_DIALOGUES = {
  captain: {
    batteryLow:  ['电量告急，请立即充电。', '电量低于安全线，建议处理。', '指挥官，电力储备不足。'],
    batteryFull: ['电量已满，可断开电源。', '充电完成。', '电池容量达上限。'],
    batteryCharging: ['正在充电，状态正常。', '充电中，请稍候。'],
    cpuHigh:     ['处理器负载偏高，建议查看任务管理器。', 'CPU 占用超 80%。', '系统负载异常升高。'],
    memHigh:     ['内存占用过高，建议关闭多余程序。', '内存压力持续上升。', '建议清理后台进程。'],
    diskFull:    ['磁盘空间不足，请清理。', '存储空间告急。', '建议归档旧文件。'],
    netOff:      ['网络连接中断。', '无法连接到外部网络。', '请检查网络配置。'],
    normal:      ['系统运行正常。', '一切如常，指挥官。', '状态良好。'],
  },
  maid: {
    batteryLow:  ['主人，电脑快没电啦，记得插上充电器哦~', '电量不多啦，要记得充电呀~', '主人主人，电量告急啦！'],
    batteryFull: ['电充满啦，主人可以拔掉充电器了~', '电池已经满啦，不用继续充了哦~', '充电完成咯！'],
    batteryCharging: ['充电中~ 主人不用着急啦！', '正在充电呢，主人放心用吧~'],
    cpuHigh:     ['主人，电脑好像有点热呢，要不要休息一下？', '处理器在努力工作呢，主人也休息一下吧~', 'CPU 占用好高哦，主人看看有什么程序在忙~'],
    memHigh:     ['主人，电脑好像有点累啦~', '内存用得有点多，要不要关掉一些窗口？', '主人，清理一下内存会让电脑更轻松哦~'],
    diskFull:    ['主人，硬盘快满啦，要不要整理一下？', '存储空间不够了呢~', '主人，磁盘需要清理一下啦！'],
    netOff:      ['主人，网络好像断掉了呢~', '咦，连不上网啦~', '主人检查一下网络好吗？'],
    normal:      ['一切都很正常哦~', '电脑状态棒棒的！', '主人安心使用吧~'],
  },
  guard: {
    batteryLow:  ['警告：电量低于安全阈值。', '电力储备不足，请充电。', '电量告急，长官。'],
    batteryFull: ['充电完成，可断开电源。', '电量已达上限。', '建议拔除充电器。'],
    batteryCharging: ['充电中，状态正常。', '电力回充中。'],
    cpuHigh:     ['CPU 占用超 80%，建议排查。', '处理器过载，请检查进程。', '警告：CPU 负载异常。'],
    memHigh:     ['内存占用超阈值，建议清理。', '内存告警，长官。', '建议关闭冗余程序。'],
    diskFull:    ['磁盘占用超 90%，建议清理。', '存储空间告警。', '请归档旧数据。'],
    netOff:      ['网络中断，请检查连接。', '通信链路断开。', '网络异常，长官。'],
    normal:      ['系统状态：良好。', '一切正常，长官。', '无异常。'],
  },
};

function pickStatusLine(status) {
  const role = (document.body.dataset.role) || 'captain';
  const pool = STATUS_DIALOGUES[role] || STATUS_DIALOGUES.captain;
  // 按优先级：batteryLow > netOff > cpuHigh > memHigh > diskFull > batteryFull > normal
  const priority = ['batteryLow', 'netOff', 'cpuHigh', 'memHigh', 'diskFull', 'batteryFull', 'batteryCharging', 'normal'];
  for (const key of priority) {
    // 从 status 对象中判断
    if (key === 'normal') break;
    if (key === 'batteryLow' && status.battery === 'low') return pick(pool[key]);
    if (key === 'batteryFull' && status.battery === 'full') return pick(pool[key]);
    if (key === 'batteryCharging' && status.battery === 'charging') return pick(pool[key]);
    if (key === 'cpuHigh' && status.cpu === 'high') return pick(pool[key]);
    if (key === 'memHigh' && status.mem === 'high') return pick(pool[key]);
    if (key === 'diskFull' && status.disk === 'full') return pick(pool[key]);
    if (key === 'netOff' && status.net === 'off') return pick(pool[key]);
  }
  return pick(pool.normal);
}

let lastPickedByPool = new WeakMap();
function pick(arr) {
  if (!arr || !arr.length) return '';
  if (arr.length === 1) return arr[0];
  const last = lastPickedByPool.get(arr);
  let choice;
  let tries = 0;
  do {
    choice = arr[Math.floor(Math.random() * arr.length)];
    tries++;
  } while (choice === last && tries < 10);
  lastPickedByPool.set(arr, choice);
  return choice;
}

const WALL_LINES = ['哎哟!撞墙啦', 'Duang~ 这墙好硬', '痛痛痛,本舰撞到了!', '哼,敢挡本舰的路!', '哦吼,弹回去~','我要出去!!!'];

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 全局状态 ----
const S = {
  facing: -1,
  x: 0, y: 0, w: 640, h: 360,
  wa: { x: 0, y: 0, width: 0, height: 0 },
  hunger: 80, fun: 80, energy: 90,
  busy: false,
  sleeping: false,
  pending: null,
  dragging: false,
};

let actionToken = 0; // 动作代数:每次点播/自动换动作 +1,旧动作据此自我中止



function setFacing(d) {
  if (S.facing !== d) {
    S.facing = d;
    petWrap.classList.toggle('facing-right', d === 1);
  }
}
function setPos(x, y) {
  // 始终把窗口夹在工作区内,不越出屏幕边缘
  const minX = S.wa.x;
  const maxX = S.wa.x + S.wa.width - S.w;
  const minY = S.wa.y;
  const maxY = S.wa.y + S.wa.height - S.h;
  x = Math.max(minX, Math.min(x, maxX));
  y = Math.max(minY, Math.min(y, maxY));
  S.x = x; S.y = y;
  api.setPosition(Math.round(x), Math.round(y));
}

// ---- 气泡 / 特效 ----
let bubbleTimer = null;
function bubble(text, ms = 2600) {
  if (!text) return;
  if (window.petAPI && window.petAPI.showSubtitle) {
    window.petAPI.showSubtitle(String(text));
  }
  // 说话动效：立绘轻微缩放，时长跟着文本长度走
  const petImg = document.getElementById('pet-image');
  if (petImg) {
    petImg.classList.add('speaking');
    const len = String(text).length;
    const speakMs = Math.max(1800, Math.min(7500, len * 200 + 1200));
    clearTimeout(petImg.__speakTimer);
    petImg.__speakTimer = setTimeout(() => {
      petImg.classList.remove('speaking');
    }, speakMs);
  }
  speakAndPlay(String(text));
}

// ===== TTS + 电音效果 =====
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function makeDistortionCurve(amount) {
  const n = 256;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

function makeReverbImpulse(ctx, durationSec) {
  const rate = ctx.sampleRate;
  const len = rate * durationSec;
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
  }
  return buf;
}

const VOICE_FX = {
  captain: { lowCut: 300, highCut: 4000, drive: 0.2, reverb: 0.15, gain: 1.0 },
  maid:    { lowCut: 200, highCut: 5000, drive: 0.08, reverb: 0,    gain: 1.0 },
  guard:   { lowCut: 400, highCut: 3000, drive: 0.35, reverb: 0.25, gain: 1.05 },
};

let currentAudioNodes = null;

async function speakAndPlay(text) {
  if (!ttsEnabled) return;
  const t = String(text || '').trim();
  if (!t || t.length > 200) return;
  try {
    // 停掉上一段
    if (currentAudioNodes) {
      try { currentAudioNodes.stop(); } catch (e) {}
      currentAudioNodes = null;
    }
    const res = await window.petAPI.playByText(t);
    if (!res || !res.ok) return; // 无匹配 → 静默

    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') await ctx.resume();

    const base64 = res.dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const audioBuf = await ctx.decodeAudioData(bytes.buffer);

    const role = document.body.dataset.role || 'captain';
    const fx = VOICE_FX[role] || VOICE_FX.captain;

    const src = ctx.createBufferSource();
    src.buffer = audioBuf;

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = fx.lowCut;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = fx.highCut;

    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDistortionCurve(fx.drive * 100);
    shaper.oversample = '2x';

    const gainNode = ctx.createGain();
    gainNode.gain.value = fx.gain;

    src.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(shaper);
    shaper.connect(gainNode);
    gainNode.connect(ctx.destination);

    if (fx.reverb > 0) {
      const convolver = ctx.createConvolver();
      convolver.buffer = makeReverbImpulse(ctx, fx.reverb);
      const wet = ctx.createGain();
      wet.gain.value = 0.25;
      gainNode.connect(convolver);
      convolver.connect(wet);
      wet.connect(ctx.destination);
    }

    src.start(0);
    currentAudioNodes = src;
    src.onended = () => { if (currentAudioNodes === src) currentAudioNodes = null; };
  } catch (e) {
    console.error('[TTS]', e);
  }
}

function spawnFx(inner, cls, x, y) {
  const el = document.createElement('div');
  el.className = 'fx ' + cls;
  el.innerHTML = inner;
  el.style.left = x;
  el.style.top = y;
  $('#fx').appendChild(el);
  setTimeout(() => el.remove(), 2100);
}


// ---- 行为 ----
let lastWallBounce = 0;
function wallSquash() {
  const el = document.getElementById('pet-image');
  if (!el) return;
  el.classList.remove('squash');
  void el.offsetWidth; // 强制重排,重启动画
  el.classList.add('squash');
  setTimeout(() => el.classList.remove('squash'), 320);
}
function onWallBounce() {
  wallSquash();
  spawnFx('💥', 'wallbump', S.facing === -1 ? '16%' : '84%', '42%');
  if (Date.now() - lastWallBounce > 6000) {
    lastWallBounce = Date.now();
    bubble(rand(WALL_LINES), 1600);
  }
}


// 被甩出去后的乒乓碰撞:带重力下坠 + 四面弹墙 + 摩擦减速到停下
async function doFling(vx, vy) {
  actionToken++;
  const token = actionToken;
  S.pending = null;
  setFacing(vx < 0 ? -1 : 1);
  const GRAVITY = 0.0008;   // px/ms²,让鱼下坠、砸到底部更有力
  const RESTITUTION = 0.7;  // 撞墙后保留的能量
  const FRICTION = 1;    // 水平摩擦
  const minX = S.wa.x, maxX = S.wa.x + S.wa.width - S.w;
  const minY = S.wa.y, maxY = S.wa.y + S.wa.height - S.h;
  let last = performance.now();
  const t0 = last;
  let restFrames = 0;
  while (restFrames < 25 && performance.now() - t0 < 10000) {
    if (token !== actionToken) return; // 被打断
    const now = performance.now();
    const dt = Math.min(now - last, 40);
    last = now;
    vy += GRAVITY * dt; // 重力下坠
    let nx = S.x + vx * dt;
    let ny = S.y + vy * dt;
    if (nx < minX) { nx = minX; if (vx < -0.2) { vx = -vx * RESTITUTION; setFacing(1); onWallBounce(); } else vx = 0; }
    else if (nx > maxX) { nx = maxX; if (vx > 0.2) { vx = -vx * RESTITUTION; setFacing(-1); onWallBounce(); } else vx = 0; }
    if (ny < minY) { ny = minY; if (vy < -0.2) { vy = -vy * RESTITUTION; onWallBounce(); } else vy = 0; }
    else if (ny > maxY) { ny = maxY; if (vy > 0.2) { vy = -vy * RESTITUTION; onWallBounce(); } else vy = 0; }
    setPos(nx, ny);
    vx *= FRICTION;
    // 贴着下边界且速度很小 → 趋于静止
    if (ny >= maxY - 0.5 && Math.abs(vx) < 0.15 && Math.abs(vy) < 0.3) restFrames++;
    else restFrames = 0;
    await sleep(16);
  }
}


let lastHealthReminder = Date.now();
let lastLunchReminder = 0;
let lastDinnerReminder = 0;
let lastNightWarn = 0;
let lastSleepReminder = 0;
let lastMoodCare = Date.now();
let appStartTime = Date.now();
let lastExerciseReminder = Date.now();
async function loop() {
  while (true) {
      // === 女仆健康提醒 ===
      if (!S.sleeping && !S.dragging) {
        const now = Date.now();
        const date = new Date();
        const hour = date.getHours();
        const minute = date.getMinutes();

        // ===== 晨间问候（启动后 5 秒一次）=====
        if (!window.__morningGreeted && now - appStartTime > 5000) {
          window.__morningGreeted = true;
          if (hour >= 5 && hour < 12) {
            api.tempSwitchRole && api.tempSwitchRole('maid', 15000);
            bubble('早上好呀，主人~ 今天也要元气满满哦！', 6000);
          }
        }

        // ===== 综合健康提醒（每 50 分钟，9:00-22:00）=====
        const HEALTH_INTERVAL = 50 * 60 * 1000;
        if (hour >= 9 && hour < 22 && now - lastHealthReminder > HEALTH_INTERVAL) {
          const HEALTH_LINES = [
            '主人~ 该喝口水啦，顺便站起来活动一下，看看窗外的远处~',
            '已经 50 分钟啦，主人喝点水，起身走两步，再眺望一下远方吧~',
            '主人，辛苦了！喝口水、伸个懒腰、看看远处，让眼睛和身体都休息一下~',
            '主人~ 你的身体需要照顾啦：喝水 + 起身 + 眺望远方，三件事一起做吧！',
          ];
          api.tempSwitchRole && api.tempSwitchRole('maid', 15000);
          bubble(HEALTH_LINES[Math.floor(Math.random() * HEALTH_LINES.length)], 7000);
          lastHealthReminder = now;
        }

        // ===== 运动小助手（每 90 分钟，9:00-21:00）=====
        const EX_INTERVAL = 90 * 60 * 1000;
        if (hour >= 9 && hour < 21 && now - lastExerciseReminder > EX_INTERVAL) {
          lastExerciseReminder = now;
          api.tempSwitchRole && api.tempSwitchRole('maid', 15000);
          bubble('主人，想不想做个小运动放松一下呀？', 5000);
          setTimeout(() => {
            if (window.petAPI && window.petAPI.openExercise) window.petAPI.openExercise();
          }, 1000);
        }

        // ===== 午餐提醒（11:30-12:30 一次）=====
        if (hour === 11 && minute >= 30 || hour === 12 && minute <= 30) {
          if (!lastLunchReminder || (now - lastLunchReminder > 20 * 60 * 60 * 1000)) {
            const LUNCH_LINES = [
              '主人，到饭点啦~ 记得好好吃饭，别饿着自己哦！',
              '午餐时间到了，主人去吃点东西吧，我在这等你回来~',
            ];
            api.tempSwitchRole && api.tempSwitchRole('maid', 15000);
            bubble(LUNCH_LINES[Math.floor(Math.random() * LUNCH_LINES.length)], 6000);
            lastLunchReminder = now;
          }
        }

        // ===== 晚餐提醒（17:30-18:30 一次）=====
        if (hour === 17 && minute >= 30 || hour === 18 && minute <= 30) {
          if (!lastDinnerReminder || (now - lastDinnerReminder > 20 * 60 * 60 * 1000)) {
            const DINNER_LINES = [
              '主人，该吃晚饭啦~ 今天想吃点什么呢？',
              '晚餐时间到~ 主人别忘了好好吃饭哦！',
            ];
            api.tempSwitchRole && api.tempSwitchRole('maid', 15000);
            bubble(DINNER_LINES[Math.floor(Math.random() * DINNER_LINES.length)], 6000);
            lastDinnerReminder = now;
          }
        }

        // ===== 心情关怀（连续使用 2 小时）=====
        if (now - lastMoodCare > 2 * 60 * 60 * 1000) {
          const MOOD_LINES = [
            '主人，已经工作两个小时啦~ 累不累？要不要休息一下？',
            '主人辛苦啦，做点喜欢的事放松一下吧~',
            '连续工作好久啦，主人记得善待自己哦~',
          ];
          api.tempSwitchRole && api.tempSwitchRole('maid', 15000);
          bubble(MOOD_LINES[Math.floor(Math.random() * MOOD_LINES.length)], 6000);
          lastMoodCare = now;
        }

        // ===== 深夜警告（22:00-6:00 每小时一次）=====
        const isNight = (hour >= 22 || hour < 6);
        if (isNight && now - lastNightWarn > 60 * 60 * 1000) {
          const NIGHT_LINES = [
            '主人，已经这么晚啦，早点休息对身体好哦~',
            '夜深了，主人该睡觉啦，我明天再陪你~',
            '主人，熬夜会变丑的哦，快去休息吧~',
          ];
          api.tempSwitchRole && api.tempSwitchRole('maid', 15000);
          bubble(NIGHT_LINES[Math.floor(Math.random() * NIGHT_LINES.length)], 6000);
          lastNightWarn = now;
        }

        // ===== 睡前提醒（22:30-23:00 一次）=====
        if (hour === 22 && minute >= 30 || hour === 23 && minute === 0) {
          if (!lastSleepReminder || (now - lastSleepReminder > 20 * 60 * 60 * 1000)) {
            const SLEEP_LINES = [
              '主人，该准备睡觉啦~ 记得刷牙洗脸哦！',
              '晚安时间快到啦，主人早点睡，做个好梦~',
            ];
            api.tempSwitchRole && api.tempSwitchRole('maid', 15000);
            bubble(SLEEP_LINES[Math.floor(Math.random() * SLEEP_LINES.length)], 6000);
            lastSleepReminder = now;
          }
        }
      }
      // === 女仆健康提醒结束 ===
    await sleep(120);
  }
}

// ---- 交互 ----
let dragging = false, downX = 0, downY = 0, moved = 0, downT = 0, startWin = null;
let velX = 0, velY = 0, lastX = 0, lastY = 0, lastT = 0;
let wheelPressed = false; // 自己记录中键(滚轮键)按下状态,避免依赖 wheel.buttons 的误报

stage.addEventListener('mousedown', async (e) => {
  if (e.button === 1) { wheelPressed = true; e.preventDefault(); return; } // 中键进入缩放模式
  if (e.button === 2) return;
  actionToken++;        // 打断正在进行的移动 / 甩飞
  S.pending = null;
  wheelPressed = false;
  downT = Date.now(); moved = 0;
  downX = e.screenX; downY = e.screenY;
  velX = 0; velY = 0; lastX = e.screenX; lastY = e.screenY; lastT = performance.now();
  dragging = true;      // ← 挪到 await 前面
  e.preventDefault();
  startWin = await api.getPosition();
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - downX, dy = e.screenY - downY;
  moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
  if (moved > 4) {
    S.dragging = true;
    setPos(startWin.x + dx, startWin.y + dy);
    const now = performance.now();
    const dt = now - lastT;
    if (dt > 0) { velX = (e.screenX - lastX) / dt; velY = (e.screenY - lastY) / dt; }
    lastX = e.screenX; lastY = e.screenY; lastT = now;
  }
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 1) { wheelPressed = false; return; } // 松开中键退出缩放
  if (!dragging) return;
  dragging = false;
  const wasDrag = S.dragging;
  S.dragging = false;
  const dt = Date.now() - downT;
  if (!wasDrag && dt < 350) { onTap(); return; }
  // 甩出:松手前若已停顿超 100ms 视为放下;否则按最后位移速度弹飞
  const stale = performance.now() - lastT > 100;
  const vx = stale ? 0 : velX;
  const vy = stale ? 0 : velY;
  const spd = Math.hypot(vx, vy);
  if (spd > 0.6) {
    const k = Math.min(1, 1 / spd);
    doFling(vx * k, vy * k);
  }
});
stage.addEventListener('contextmenu', (e) => { e.preventDefault(); api.showContextMenu(); });
stage.addEventListener('dblclick', pat);

// 滚轮缩放(0.25x – 2x):按住中键 + 滚动才触发
let lastWheel = 0;
// 防止 wheelPressed 卡住:光标离开窗口 / 窗口失焦时强制复位
window.addEventListener('blur', () => { wheelPressed = false; });
document.addEventListener('mouseleave', () => { wheelPressed = false; });
window.addEventListener('wheel', (e) => {
  if (dragging || !wheelPressed) return; // 左键拖拽中禁止缩放;只有按住中键滚动才缩放
  e.preventDefault();
  const now = Date.now();
  if (now - lastWheel < 90) return;
  lastWheel = now;
  const dir = e.deltaY < 0 ? 1 : -1;
  api.resize(dir).then((k) => bubble('缩放 ' + Math.round(k * 100) + '%', 1100));
}, { passive: false });

let cachedStatus = { battery: 'ok', cpu: 'ok', mem: 'ok' };

async function onTap() {
  // 先立刻用缓存的状态说一句（不等待检测）
  if (typeof bubble === 'function' && typeof pickStatusLine === 'function') {
    bubble(pickStatusLine(cachedStatus), 3500);
  }
  // 后台异步刷新状态，供下次点击使用
  if (window.petAPI && window.petAPI.getSystemStatus) {
    try {
      const fresh = await window.petAPI.getSystemStatus();
      if (fresh) cachedStatus = fresh;
    } catch (e) {}
  }
}
function pat() {
  const PATTED = {
    captain: ['收到，指挥官。', '指令已确认。', '系统响应正常。'],
    maid: ['嘿嘿~ 好舒服！', '主人的手好温柔~', '嘻嘻，再摸一下嘛~'],
    guard: ['警戒状态正常。', '收到，长官。', '系统待命中。'],
  };
  const role = document.body.dataset.role || 'captain';
  const pool = PATTED[role] || PATTED.captain;
  bubble(pool[Math.floor(Math.random() * pool.length)], 3000); 
}

// ---- 余额 / 碎碎念 ----
async function doBalance() {
  bubble('正在查余额…', 2000);
  const res = await api.getBalance();
  if (res && res.ok) {
    const t = res.total.toFixed(2);
    const tier = res.tier === 'peak' ? '峰' : '谷';
    bubble('余额（' + tier + '）¥' + t, 6000);
  } else {
    bubble((res && res.message) || '查余额失败~', 4000);
  }
}
async function doWhisper(silent) {
  const res = await api.whisper();
  if (res && res.ok && res.text) {
    bubble(res.text, 4500);
  } else if (!silent) {
    bubble((res && res.message) || '碎碎念失败~', 3000);
  }
}

// ---- 托盘 / 菜单动作 ----
api.onAction((name, value) => {
  switch (name) {
    case 'clickthrough': setClickThroughVisual(value); break;
    case 'scale': refreshSize(); break;
    case 'role-key': {
        const r = String(value || 'captain');
        document.body.dataset.role = r;
        const HUD_COLORS = {
          captain: { primary: '#00e5ff', secondary: '#ff2d95', glow: '0, 229, 255' },
          maid:    { primary: '#ffb347', secondary: '#ff8fa3', glow: '255, 179, 71' },
          guard:   { primary: '#ff2d55', secondary: '#ff9d00', glow: '255, 45, 85' }
        };
        const c = HUD_COLORS[r] || HUD_COLORS.captain;
        const hud = document.getElementById('hud-ring');
        if (hud) {
          hud.style.color = c.primary;
          hud.style.setProperty('--hud-primary', c.primary);
          hud.style.setProperty('--hud-secondary', c.secondary);
          hud.style.setProperty('--hud-glow-rgb', c.glow);
        }
        const petImg = document.getElementById('pet-image');
        if (petImg) {
          petImg.src = `assets/characters/${r}.png`;
          petImg.classList.remove('role-switching');
          void petImg.offsetWidth;
          petImg.classList.add('role-switching');
          setTimeout(() => petImg.classList.remove('role-switching'), 600);
        }
                const ROLE_GREET = {
          captain: ['舰长模式已就绪，指挥官。', '指挥权已交接。'],
          maid: ['主人~ 我来啦！', '嘻嘻，轮到我了~'],
          guard: ['警戒模式已启动，长官。', '守卫上线。'],
        };
        const greetPool = ROLE_GREET[r] || ROLE_GREET.captain;
        setTimeout(() => {
          bubble(greetPool[Math.floor(Math.random() * greetPool.length)], 2500);
        }, 700);
        break;
      }
    case 'whisper': doWhisper(false); break;
    case 'balance': doBalance(); break;
    case 'clipboard-hint': bubble('先选中文字,再按 Alt+Shift+A', 3200); break;
  }
});

const sessionDetectedKeys = new Set();

if (window.petAPI.onPasswordDetected) {
  window.petAPI.onPasswordDetected(async (data) => {
    const text = typeof data === 'string' ? data : (data && data.pass) || '';
    if (!text) return;
    const site = (data && data.site) || '';
    const user = (data && data.user) || '';
    // 会话内去重：用 网站+用户名 做 key（如果没有 user 就退化到密码）
    const key = (site && user) ? (site + '|' + user) : ('pass|' + text);
    if (sessionDetectedKeys.has(key)) return;
    // 密码库去重：检查是否已存在 网站+用户名 相同 或（无 site/user 时）密码相同 的条目
    try {
      if (window.vaultAPI && window.vaultAPI.list) {
        const res = await window.vaultAPI.list();
        if (res && res.ok && Array.isArray(res.entries)) {
          const exists = res.entries.some(en => {
            if (site && user && en.site === site && en.user === user) return true;
            if (!site && !user && en.pass === text) return true;
            return false;
          });
          if (exists) { sessionDetectedKeys.add(key); return; }
        }
      }
    } catch (e) {}
    sessionDetectedKeys.add(key);
    const modal = document.getElementById('pwd-confirm');
    const siteEl = document.getElementById('pwd-confirm-site');
    const passEl = document.getElementById('pwd-confirm-pass');
    if (!modal) return;
    let hint = '来自：' + (site || '未知网站');
    if (user) hint += ' · ' + user;
    siteEl.textContent = hint;
    passEl.textContent = text.length > 6 ? text.slice(0, 3) + '••••••' + text.slice(-2) : '••••••';
    modal.classList.remove('sensitive-hidden');
    modal.style.animation = 'none';
    void modal.offsetWidth;
    modal.style.animation = '';
    const cleanup = () => {
      modal.classList.add('sensitive-hidden');
      document.getElementById('pwd-confirm-yes').onclick = null;
      document.getElementById('pwd-confirm-no').onclick = null;
      clearTimeout(modal.__autoHide);
    };
    document.getElementById('pwd-confirm-yes').onclick = () => {
      cleanup();
      if (window.petAPI.openWithPassword) {
        window.petAPI.openWithPassword({ pass: text, site: site, user: user });
      }
    };
    document.getElementById('pwd-confirm-no').onclick = cleanup;
    modal.__autoHide = setTimeout(cleanup, 15000);
  });
}

if (window.petAPI.onSensitiveDetected) {
  window.petAPI.onSensitiveDetected((data) => {
    if (!data) return;
    const modal = document.getElementById('sensitive-confirm');
    if (!modal) return;
    const t = document.getElementById('sensitive-type');
    const p = document.getElementById('sensitive-preview');
    if (t) t.textContent = '检测到疑似' + (data.type || '敏感信息');
    if (p) {
      const s = String(data.text || '');
      p.textContent = s.length > 8 ? s.slice(0, 4) + '••••••' + s.slice(-4) : '••••••';
    }
    const adv = document.getElementById('sensitive-advice');
    if (adv) adv.textContent = data.advice ? '💡 ' + data.advice : '';
    modal.classList.remove('sensitive-hidden');
    // 每次重新触发，重新播放动画
    modal.style.animation = 'none';
    void modal.offsetWidth;
    modal.style.animation = '';
    clearTimeout(modal.__hideTimer);
    modal.__hideTimer = setTimeout(() => {
      modal.classList.add('sensitive-hidden');
    }, 6000);
  });
}

if (window.petAPI.onSuspicious) {
  window.petAPI.onSuspicious((data) => {
    if (!data) return;
    const modal = document.getElementById('sensitive-confirm');
    if (!modal) return;
    const t = document.getElementById('sensitive-type');
    const p = document.getElementById('sensitive-preview');
    const adv = document.getElementById('sensitive-advice');
    if (t) t.textContent = '⛨ 检测到可疑连接';
    if (p) p.textContent = '[' + (data.ip || '') + ':' + (data.port || '') + ']，是否需要查看？';
    if (adv) adv.textContent = '';
    modal.classList.remove('sensitive-hidden');
    modal.style.animation = 'none';
    void modal.offsetWidth;
    modal.style.animation = '';
    clearTimeout(modal.__hideTimer);
    modal.__hideTimer = setTimeout(() => {
      modal.classList.add('sensitive-hidden');
    }, 8000);
  });
}

function setClickThroughVisual(on) {
  document.body.classList.toggle('ghost', on);
  if (on) bubble('穿透模式:按 Ctrl+Shift+G 或右键托盘图标恢复', 0); // 0 = 常驻,不自动消失
  else bubble('恢复啦~', 1500);
}

async function refreshSize() {
  const p = await api.getPosition();
  S.w = p.w; S.h = p.h; S.x = p.x; S.y = p.y;
}

// ---- 养成数值衰减与存档 ----
function decay() {
  if (S.sleeping) return;
  S.hunger = Math.max(0, S.hunger - 2);
  S.fun = Math.max(0, S.fun - 1.5);
  S.energy = Math.max(0, S.energy - 2);
}
function save() { api.saveConfig({ hunger: S.hunger, fun: S.fun, energy: S.energy }); }

function sendTrayIcon() {
  try {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 48; c.height = 48;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 48, 48);
      api.setTrayIcon(c.toDataURL('image/png'));
    };
    img.src = document.getElementById('pet-image')?.src || '';
  } catch (e) {}
}

// ---- 启动 ----
async function init() {
  const cfg = await api.getConfig();
  if (window.petAPI && window.petAPI.getTTSEnabled) {
    window.petAPI.getTTSEnabled().then(on => { ttsEnabled = !!on; }).catch(() => {});
  }
  if (cfg.hunger != null) S.hunger = cfg.hunger;
  if (cfg.fun != null) S.fun = cfg.fun;
  if (cfg.energy != null) S.energy = cfg.energy;
  S.wa = await api.getWorkArea();
  await refreshSize();
    // 初始化警戒状态（开局就读一次系统状态）
  if (window.petAPI && window.petAPI.getSystemStatus) {
    try {
      const s = await window.petAPI.getSystemStatus();
      applySystemAlert(s);
    } catch (e) {}
  }
  sendTrayIcon();
  setInterval(decay, 30000);
  setInterval(save, 60000);
  window.addEventListener('beforeunload', save);
  if (cfg.whisperEnabled !== false) {
    setInterval(() => { if (!S.sleeping) doWhisper(true); }, 1800000);
  }
  loop();
}
init();

if (window.petAPI.onMaidBubble) {
  window.petAPI.onMaidBubble((msg) => { if (msg) bubble(msg, 5000); });
}

if (window.petAPI.onNotebookToast) {
  window.petAPI.onNotebookToast((d) => {
    if (!d) return;
    if (d.ok) {
      bubble('记好了，指挥官 ✓ ' + (d.msg || ''), 4000);
    } else {
      bubble((d.msg || '记录失败'), 4000);
    }
  });
}

  // 初始化警戒状态（开局就读一次系统状态）
  function applySystemAlert(status) {
  const alert = !!(status && (status.battery === 'low' || status.net === 'off'));
  document.body.classList.toggle('alert', alert);
}

if (window.petAPI && window.petAPI.onSystemStatusChanged) {
  window.petAPI.onSystemStatusChanged((status) => {
    applySystemAlert(status);
    // 只在有明显异常时才主动说，正常状态不打扰
    if (status.battery === 'low' || status.net === 'off') {
      bubble(pickStatusLine(status), 5000);
    }
  });
}
if (window.petAPI && window.petAPI.onTTSEnabledChanged) {
  window.petAPI.onTTSEnabledChanged((on) => { ttsEnabled = !!on; });
}
