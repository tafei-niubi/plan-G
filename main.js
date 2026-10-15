// G计划 —— 主进程
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, globalShortcut, nativeImage, clipboard, dialog } = require('electron');
const { exec, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const os = require('os');
const si = require('systeminformation');
const yaml = require('js-yaml');
const Anthropic = require('@anthropic-ai/sdk');
const dns = require('dns').promises;
const AnthropicClient = Anthropic.default || Anthropic;
const xfyunTts = require('./xfyun-tts');
// ===== 单实例锁：防止多个进程同时抢角色/配置 =====
// ===== 单实例锁：防止多个进程同时抢角色/配置 =====
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // 已经有一个实例在跑 → 自己立刻退出
 app.exit(0)
} else {
  // 第二个实例启动时，把已存在的那个窗口拉出来
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  app.whenReady().then(async () => {
  await openSplash();
  createWindow();
  // 首次启动询问定位权限
  if (cfg().locationConsent === undefined) {
    const result = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['允许', '暂不'],
      defaultId: 0,
      cancelId: 1,
      title: '天气功能',
      message: '允许 G计划 自动定位，以在日记中显示当地天气？',
      detail: '定位信息仅保存在本地，不会上传到任何服务器。你可以随时在右键菜单里更改。'
    });
    saveConfig(Object.assign({}, cfg(), {
      locationConsent: result.response === 0
    }));
    if (tray) tray.setContextMenu(buildMenu());
  }

  // 从 config 恢复天气缓存
  if (cfg().weatherCache) weatherCache = cfg().weatherCache;

  // 每次启动强制刷新一次（延迟 3 秒，不阻塞启动）
  setTimeout(() => {
    refreshWeather().catch(e => console.log('[天气] 失败：', e.message));
  }, 3000);

  // 每 8 小时刷新一次
  if (weatherRefreshTimer) clearInterval(weatherRefreshTimer);
  weatherRefreshTimer = setInterval(() => {
    refreshWeather().catch(e => {});
  }, 8 * 60 * 60 * 1000);

  recordEvent('app_start');
  triggerOpening().catch(()=>{});
  openSubtitleWindow();
  startClipboardWatcher();
  startExtServer();
  startSuspiciousWatcher();
  let statusChecking = false;
  setInterval(async () => {
    if (statusChecking) return;
    if (!win || win.isDestroyed()) return;
    statusChecking = true;
    try {
      const status = await getSystemStatus();
      const statusKey = JSON.stringify(status);
      if (statusKey !== lastSystemStatus) {
        lastSystemStatus = statusKey;
        if (status.battery === 'low' && Date.now() - lastAlertRecorded.battery_low > 30 * 60 * 1000) {
          recordEvent('system_alert', { kind: 'battery_low' });
          lastAlertRecorded.battery_low = Date.now();
          if (canTriggerDiary('警戒')) {
            appendDiaryEntry('警戒', describeEventForDiary({ type: 'system_alert', kind: 'battery_low' }), '电量低').catch(()=>{});
          }
        }
        if (status.net === 'off' && Date.now() - lastAlertRecorded.net_off > 30 * 60 * 1000) {
          recordEvent('system_alert', { kind: 'net_off' });
          lastAlertRecorded.net_off = Date.now();
          if (canTriggerDiary('警戒')) {
            appendDiaryEntry('警戒', describeEventForDiary({ type: 'system_alert', kind: 'net_off' }), '网络断').catch(()=>{});
          }
        }
        win.webContents.send('system:status-changed', status);
      }
    } catch (e) {} finally {
      statusChecking = false;
    }
  }, 5000);
  globalShortcut.register('Control+Shift+G', toggleClickThrough);
  globalShortcut.register('Control+Shift+F', () => {
    if (win && win.isVisible()) win.hide(); else showWin();
  });
  globalShortcut.register('Control+Shift+C', () => { showWin(); openChat(); });
  globalShortcut.register('Control+Shift+T', () => { openTranslate(); });
  globalShortcut.register('Control+Shift+V', () => { openClipboardHistory(); });
  globalShortcut.register('Shift+Alt+A', () => { quickAssist('auto', true); });
  globalShortcut.register('Shift+Alt+S', () => { captureSelectionToNotebook(); });
  globalShortcut.register('Control+Shift+1', () => switchRole('captain'));
  globalShortcut.register('Control+Shift+2', () => switchRole('maid'));
  globalShortcut.register('Control+Shift+3', () => switchRole('guard'));

  // 深夜提醒：每 10 分钟检查一次
  setInterval(() => {
    const h = new Date().getHours();
    if (h >= 22 && canTriggerDiary('深夜')) {
      appendDiaryEntry('深夜', '用户深夜仍在电脑前工作').catch(()=>{});
    }
  }, 10 * 60 * 1000);
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', (e) => {
  globalShortcut.unregisterAll();
  recordEvent('app_quit');
  appendClosing();
});

process.on('SIGINT', () => {
  tryClosingOnExit();
  setTimeout(() => process.exit(0), 200);
});

process.on('SIGTERM', () => {
  tryClosingOnExit();
  setTimeout(() => process.exit(0), 200);
});

process.on('beforeExit', () => {
  tryClosingOnExit();
});

}
const ttsCacheDir = () => {
  const dir = path.join(app.getPath('userData'), 'tts-cache');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

// 窗口基准尺寸(与动画素材 640×500 一致,16:9)
const W = 1280;
const H = 1400;

const DEFAULT_SCALE = 0.6;
const DEFAULT_PERSONA = '你是G-计划，指挥官专属的AI管家。你的风格像钢铁侠的贾维斯：专业、可靠、冷静，但内心关心指挥官。你称呼用户为“指挥官”。回答要简洁、有条理，不说废话。如果涉及操作，分点列出。你可以偶尔使用温和的幽默，但不要轻浮。你的职责是让指挥官的生活更顺畅，而不是让指挥官感觉到你在“服务”。';
const ROLES = {
  captain: {
    name: 'G-舰长',
    avatar: '◈',
    persona: '你是G-舰长，指挥官专属的AI管家。你的风格像钢铁侠的贾维斯：专业、可靠、冷静，但内心关心指挥官。你称呼用户为"指挥官"。回答要简洁、有条理，不说废话。如果涉及操作，分点列出。你可以偶尔使用温和的幽默，但不要轻浮。',
    filter: 'none',
  },
  maid: {
    name: '女仆',
    avatar: '❀',
    persona: '你是女仆，主人专属的贴心助手。你的性格温暖、俏皮、会照顾人。你称呼用户为"主人"。说话亲切自然，偶尔卖萌，但很有分寸。你会主动关心主人的身体和心情，比如提醒喝水、休息。回答简短温柔，不说废话。',
    filter: 'sepia(0.25) hue-rotate(-15deg) saturate(1.1)',
  },
  guard: {
    name: '守卫',
    avatar: '⛨',
    persona: '你是守卫，主人专属的网络安全守护者。你的性格严谨、警觉、略带吐槽感。你称呼用户为"主人"。你负责监控主人的电脑安全，对任何可疑迹象都会及时预警。说话干脆利落，像作战简报。你是网络安全专业出身，回答技术问题时尽量专业。偶尔调侃主人"这个操作有点危险"。',
    filter: 'hue-rotate(160deg) saturate(1.3)',
  },
};
const DEFAULT_ROLE = 'maid';
function currentRoleKey() { return cfg().role || DEFAULT_ROLE; }
function currentRole() { return ROLES[currentRoleKey()] || ROLES[DEFAULT_ROLE]; }

// 划词助手的模式与各自的 system 提示词
const QA_MODES = {
  auto: {
    label: '智能',
    system: '你是桌面划词助手。用户选中并复制了一段文字交给你。请判断他最可能需要什么,然后只做那件最有价值的事,直接给出结果,不要询问、不要解释你的判断过程、不要客套。判断规则:外文(英/日/韩等)先翻译成中文;中文病句、口语化、想表达更专业就润色改写;长文或大段内容就提炼要点总结;报错信息、代码、专业术语、概念就解释或修复;明确是个问题就直接回答。若不确定,选最可能对工作有帮助的一种。输出要精炼,能用列表就用列表。',
  },
  translate: { label: '翻译', system: '把用户提供的文本翻译成中文(若原文已是中文则译成英文),只输出译文本身,不要解释、不要加引号。' },
  explain: { label: '解释', system: '用通俗易懂的中文解释用户选中的内容(概念、名词、报错、代码或术语),简明扼要,可适当举例,不要长篇大论。' },
  summary: { label: '总结', system: '把用户选中的内容概括成要点,分条列出,保留关键信息,语言简洁。' },
  polish: { label: '润色', system: '润色用户选中的中文文本:改通顺、更专业、更得体,保留原意,直接输出改写后的文本,不要解释。' },
};

let win = null;
let chatWin = null;
let translateWin = null;
let qaWin = null;
let pendingQA = null;
let tray = null;
let clickThrough = false;
let subtitleWin = null;
let subtitleTimer = null;
let vaultWin = null;
let vaultKey = null; // 存在内存中，绝不写盘
let lastClipboardText = '';
let lastClipboardImageHash = '';
let clipboardWatcher = null;
let extServer = null;
let guardWin = null;
let pwdConfirmWin = null;
const sessionDetectedKeys = new Set(); // 会话内密码/敏感信息去重
let lastSuspiciousAlert = 0;
let autoSwitchTimer = null;
let roleBeforeAutoSwitch = null;
let exerciseWin = null;
let notebookWin = null;
let clipWin = null;
let diaryWin = null;
let splashWin = null;
let lastSystemStatus = null;
let lastAlertRecorded = { battery_low: 0, net_off: 0 };
let weatherCache = { city: '', temp: null, condition: '', lat: null, lon: null, updatedAt: 0 };
let weatherRefreshTimer = null;
let ttsManifest = null;
let lastNotebookIds = new Set(); // 上次已记入事件的笔记条目 id，用于只记新增

// ---- 日记实时追加的去抖控制（同一标签隔 15/30/60 分钟才触发一次） ----
const lastDiaryTrigger = {
  '长谈': 0,
  '复制': 0,
  '窗口': 0,
  '警戒': 0,
  '深夜': 0,
  '查阅': 0,
};

const DEBOUNCE_MAP = {
  '长谈': 15 * 60 * 1000,
  '复制': 15 * 60 * 1000,
  '窗口': 30 * 60 * 1000,
  '警戒': 30 * 60 * 1000,
  '深夜': 60 * 60 * 1000,
  '查阅': 30 * 60 * 1000,
};

function canTriggerDiary(tag) {
  const wait = DEBOUNCE_MAP[tag];
  if (!wait) return true;
  const now = Date.now();
  if (now - (lastDiaryTrigger[tag] || 0) < wait) return false;
  lastDiaryTrigger[tag] = now;
  return true;
}

const TTS_VOICES = {
  captain: 'zh-CN-YunxiNeural',
  maid:    'zh-CN-XiaoxiaoNeural',
  guard:   'zh-CN-XiaomoNeural',
};

const configPath = () => path.join(app.getPath('userData'), 'config.json');
const memoryPath = () => path.join(app.getPath('userData'), 'chat-memory.json');
const notebookPath = () => path.join(app.getPath('userData'), 'notebook.json');
const notebookAssetsDir = () => {
  const dir = path.join(app.getPath('userData'), 'notebook-assets');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const memoryDir = () => {
  const dir = path.join(app.getPath('userData'), 'memory');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const eventsPath = () => path.join(memoryDir(), 'events.jsonl');

const diaryRootDir = () => {
  const dir = path.join(app.getPath('userData'), 'diary');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const todayDateStr = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
};

const todayTimeStr = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
};

const diaryFileFor = (dateStr) => path.join(diaryRootDir(), dateStr + '.md');

const clipboardHistoryPath = () => path.join(app.getPath('userData'), 'clipboard-history.json');
const clipboardImagesDir = () => {
  const dir = path.join(app.getPath('userData'), 'clipboard-images');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

function readClipHistory() {
  try { return JSON.parse(fs.readFileSync(clipboardHistoryPath(), 'utf8')); }
  catch (e) { return { items: [] }; }
}
function writeClipHistory(data) {
  try { fs.writeFileSync(clipboardHistoryPath(), JSON.stringify(data, null, 2)); }
  catch (e) {}
}

function pushClipText(text) {
  const s = String(text || '');
  if (!s || s.length > 10000) return;
  const data = readClipHistory();
  if (!Array.isArray(data.items)) data.items = [];
  const idx = data.items.findIndex(it => it.type === 'text' && it.content === s);
  if (idx >= 0) {
    const [item] = data.items.splice(idx, 1);
    item.time = Date.now();
    data.items.unshift(item);
  } else {
    data.items.unshift({
      id: Date.now() + Math.random(),
      type: 'text',
      content: s,
      time: Date.now(),
      pinned: false,
    });
  }
  const pinned = data.items.filter(it => it.pinned);
  const unpinned = data.items.filter(it => !it.pinned);
  data.items = pinned.concat(unpinned.slice(0, 100));
  writeClipHistory(data);
}

function pushClipImage(input) {
  let png;
  if (Buffer.isBuffer(input)) {
    png = input;
  } else if (input && typeof input.isEmpty === 'function' && !input.isEmpty()) {
    png = input.toPNG();
  } else {
    return;
  }
  if (!png || png.length === 0) return;
  if (png.length > 5 * 1024 * 1024) return;
  const filename = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.png';
  const dest = path.join(clipboardImagesDir(), filename);
  try { fs.writeFileSync(dest, png); } catch (e) { return; }
  const data = readClipHistory();
  if (!Array.isArray(data.items)) data.items = [];
  data.items.unshift({
    id: Date.now() + Math.random(),
    type: 'image',
    imageFile: filename,
    time: Date.now(),
    pinned: false,
  });
  const pinned = data.items.filter(it => it.pinned);
  const unpinned = data.items.filter(it => !it.pinned);
  data.items = pinned.concat(unpinned.slice(0, 120));
  writeClipHistory(data);
}

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); }
  catch (e) { return {}; }
}
function saveConfig(c) {
  try { fs.writeFileSync(configPath(), JSON.stringify(c, null, 2)); }
  catch (e) {}
}

// ---- 记忆事件采集（只记"发生什么"，不记内容，静默追加写入） ----
function recordEvent(type, data) {
  try {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const t = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
      + 'T' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds())
      + (function () {
        const o = -now.getTimezoneOffset();
        const sign = o >= 0 ? '+' : '-';
        const hh = pad(Math.floor(Math.abs(o) / 60));
        const mm = pad(Math.abs(o) % 60);
        return sign + hh + ':' + mm;
      })();
    const evt = { t, type };
    if (data && typeof data === 'object') Object.assign(evt, data);
    fs.appendFileSync(eventsPath(), JSON.stringify(evt) + '\n');
  } catch (e) {}
}

// ---- 天气：IP 定位 + Open-Meteo（无 Key，静默失败） ----
const WEATHER_CODE_MAP = {
  0: '晴', 1: '晴间多云', 2: '多云', 3: '阴',
  45: '雾', 48: '雾凇',
  51: '毛毛雨', 53: '小雨', 55: '中雨',
  56: '冻雨', 57: '冻雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  66: '冻雨', 67: '冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '阵雨', 81: '阵雨', 82: '暴雨',
  85: '阵雪', 86: '阵雪',
  95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '雷暴'
};

async function fetchLocation() {
    console.log('[天气] 查询天气...');
  // 主 API：ip-api.com（免费、无 key、国内可访问）
  try {
    console.log('[天气] 尝试定位...');
    const res = await fetch('http://ip-api.com/json/?fields=status,city,lat,lon', {
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const d = await res.json();
      if (d.status === 'success' && d.city && d.lat && d.lon) {
        console.log('[天气] 定位成功：', d.city);
        return { city: d.city, lat: d.lat, lon: d.lon };
      }
    }
  } catch (e) {
    console.log('[天气] ip-api 失败：', e.message);
  }
  // 备用：ipapi.co
  try {
    const res = await fetch('https://ipapi.co/json/', {
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const d = await res.json();
      if (d.city && d.latitude && d.longitude) {
        console.log('[天气] 定位成功(备用)：', d.city);
        return { city: d.city, lat: d.latitude, lon: d.longitude };
      }
    }
  } catch (e) {
    console.log('[天气] ipapi 失败：', e.message);
  }
  console.log('[天气] 所有定位 API 都失败');
  return null;
}

async function fetchWeather(lat, lon) {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&current=temperature_2m,weather_code';
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.current) return null;
    return {
      temp: Math.round(d.current.temperature_2m),
      condition: WEATHER_CODE_MAP[d.current.weather_code] || '未知'
    };
  } catch (e) {
    return null;
  }
}

async function refreshWeather() {
  const c = cfg();
  console.log('[天气] 启动刷新，consent=' + c.locationConsent + '，缓存的updatedAt=' + (weatherCache.updatedAt || 0));
  // 若用户拒绝定位，直接跳过
  if (c.locationConsent !== true) return;

  // 若有缓存的坐标，直接用
  let lat = weatherCache.lat;
  let lon = weatherCache.lon;
  let city = weatherCache.city;

  // 若 config 里手动填了城市坐标，优先用（可选，暂不实现）

  // 没有坐标，先定位
  if (lat == null || lon == null) {
    const loc = await fetchLocation();
    if (!loc) return;
    lat = loc.lat;
    lon = loc.lon;
    city = loc.city;
  }

  const w = await fetchWeather(lat, lon);
  if (!w) return;

  weatherCache = {
    city: city,
    temp: w.temp,
    condition: w.condition,
    lat: lat,
    lon: lon,
    updatedAt: Date.now()
  };
  // 持久化到 config
  saveConfig(Object.assign({}, cfg(), { weatherCache: weatherCache }));
  console.log('[天气]', city, w.temp + '°C', w.condition);
}

function snippetOf(text, len) {
  const s = String(text || '');
  if (!s) return '';
  const max = len || 20;
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function cfg() {
  return Object.assign({
    scale: DEFAULT_SCALE,
    notebookAutoComment: true,
    memoryLevel: 'snippet' // 记忆粒度：anonymous | snippet | detail
  }, loadConfig());
}
function scaledSize() {
  const s = cfg().scale || DEFAULT_SCALE;
  return { w: Math.round(W * s), h: Math.round(H * s) };
}

// ---- 记忆(聊天记忆,全存不删) ----
function readMemory() {
  try { return JSON.parse(fs.readFileSync(memoryPath(), 'utf8')); }
  catch (e) { return { messages: [] }; }
}
function writeMemory(m) {
  try { fs.writeFileSync(memoryPath(), JSON.stringify(m, null, 2)); }
  catch (e) {}
}

// ---- 密钥 ----
function deepseekKey() {
  const c = cfg();
  if (c.deepseekApiKey) return c.deepseekApiKey;
  try {
    const credPath = path.join(os.homedir(), '.dsh', '.credentials.yaml');
    const doc = yaml.load(fs.readFileSync(credPath, 'utf8'));
    const key = doc && doc.refs && doc.refs.DEEPSEEK_API_KEY;
    if (key) {
      saveConfig(Object.assign({}, c, { deepseekApiKey: key }));
      return key;
    }
  } catch (e) {}
  return '';
}

function getClaude() {
  // 优先读取你 config.json 里的 DeepSeek Key
  const deepseekKey = cfg().deepseekApiKey;
  if (deepseekKey) {
    return new AnthropicClient({
      apiKey: deepseekKey,
      baseURL: 'https://api.deepseek.com/anthropic' // 接入 DeepSeek 大脑
    });
  }
  // 如果没填 DeepSeek Key，再退回去找原来的 Claude Key
  const apiKey = process.env.ANTHROPIC_API_KEY || cfg().anthropicApiKey || undefined;
  return new AnthropicClient(apiKey ? { apiKey } : {});
}

// ---- 日记：实时追加（活记录，非事后总结） ----
let diaryWriting = false;

async function appendDiaryEntry(tag, eventDesc, extra) {
  if (diaryWriting) return; // 防并发，上一个还没写完就跳过
  diaryWriting = true;
  try {
    // 读三份风格说明书
    const styleDir = path.join(__dirname, 'styles');
    const captain = fs.existsSync(path.join(styleDir, 'captain.md')) ? fs.readFileSync(path.join(styleDir, 'captain.md'), 'utf8') : '';
    const maid    = fs.existsSync(path.join(styleDir, 'maid.md'))    ? fs.readFileSync(path.join(styleDir, 'maid.md'), 'utf8')    : '';
    const guard   = fs.existsSync(path.join(styleDir, 'guard.md'))   ? fs.readFileSync(path.join(styleDir, 'guard.md'), 'utf8')   : '';

    let extraStructure = '';
    if (tag === '开场') {
      extraStructure =
        '\n\n【开场的特殊结构（必须严格遵守）】\n' +
        '这次的标签是"开场"，是用户当天第一次打开程序。\n' +
        '每个角色写 3 句话，用"。"分隔或分 3 小句，每句都不超过 15 字。\n' +
        '\n' +
        '第 1 句：欢迎（打招呼，贴合时间——早上说早，晚上说晚上，深夜说这么晚）\n' +
        '第 2 句：天气（只有【天气信息】里给了天气时才写；用天气数据做引子，但不要复述数字，' +
        '比如"今天挺暖和"、"外面在下雨"；没给天气就跳过这句）\n' +
        '第 3 句：角色专属——\n' +
        '  - 舰长：跟工作有关的（今天从哪开始 / 需要我做什么 / 方向由你定）\n' +
        '  - 女仆：跟关心有关的（好好照顾自己 / 慢慢来 / 累了就说）\n' +
        '  - 守卫：跟安全有关的（系统正常 / 我盯着 / 有事喊我）\n' +
        '\n' +
        '参考（不要照抄，按这个调子写）：\n' +
        '舰长：指挥官，晚上好。夜里风凉。今天从哪件事开始。\n' +
        '女仆：主人，晚上好。外面挺冷的，记得加件衣服。慢慢来，不着急。\n' +
        '守卫：长官，晚上好。系统正常，我盯着。有事喊我。\n' +
        '\n' +
        '注意：\n' +
        '- 3 句话加起来不超过 40 字\n' +
        '- 第 2 句只有在【天气信息】存在时才写\n' +
        '- 禁止编造任何具体事实\n' +
        '- 禁止"很久不见""好想你"这类夸张表达\n' +
        '【开场例外（以下明确覆盖上面 systemPrompt 的通用禁忌）】\n' +
        '- 允许出现打招呼时间词：早上、中午、下午、晚上、深夜、夜深——这些 OK\n' +
        '- 仍然禁止叙述时间词：今天、昨天、明天、现在、刚才\n' +
        '- 允许出现"你"字（开场是直接对用户说话）\n' +
        '- 允许每角色 3 句话、总长不超过 40 字（覆盖"每人一句 20 字"）\n' +
        '- 其余通用禁忌仍然有效：禁感叹号、禁身体动作、禁编造、禁夸张\n';
    }

    const systemPrompt =
      '你是 G计划 桌宠的三个角色，现在要一起在同一个日记里写下对一件事的即时反应。\n\n' +
      '==== 舰长 =====\n' + captain + '\n\n' +
      '==== 女仆 =====\n' + maid + '\n\n' +
      '==== 守卫 =====\n' + guard + '\n\n' +
      '==== 输出要求（必须严格遵守）====\n' +
      '1. 三个角色各写一句，最多 20 字\n' +
      '2. 三句话的语气必须明显不同——如果三句风格相似，视为失败\n' +
      '3. 严格遵循各自风格说明书的"说话方式"和"禁忌"\n' +
      '4. 不用感叹号\n' +
      '5. 不要解释，不要前缀，不要 markdown\n' +
      '6. 严格用下面格式输出，一字不差：\n\n' +
      '舰长：xxx\n女仆：xxx\n守卫：xxx\n\n' +
      '【称呼规则】\n' +
      '- 舰长称呼用户为"指挥官"\n' +
      '- 女仆称呼用户为"主人"\n' +
      '- 守卫称呼用户为"长官"\n' +
      '- 不要用"他"字——一律用上述称呼\n\n' +
      '【禁忌（违反即失败）】\n' +
      '- 禁止出现："今天""昨天""明天""早上""晚上""现在"等时间词\n' +
      '- 禁止感叹号\n' +
      '- 禁止"你"字\n' +
      '- 禁止任何身体动作（倒水/泡茶/开灯/推椅子一律不许）\n' +
      '- 如果是【开场】标签，不能说"很久""又来了""还是"——这是当天第一次\n' +
      '【关于天气】\n' +
      '- 允许三个角色在台词里自然引用天气（如"外面在下雨"、"今天真冷"）\n' +
      '- 不强制，不堆砌，不是每条都要提\n' +
      '- 引用时要贴合角色（舰长提战略环境、女仆提身体感受、守卫提风险）' +
      extraStructure;

    let tagHint = '';
    if (tag === '开场') tagHint = '（这是今天第一次打开程序，不要提"很久""又来了"这类有历史感的词）';
    else if (tag === '收尾') tagHint = '（今天要结束了）';
    let weatherHint = '';
    if (weatherCache && weatherCache.city && weatherCache.temp != null) {
      weatherHint = '\n\n【天气信息】' + weatherCache.city + '，' + weatherCache.condition + '，' + weatherCache.temp + '℃';
    }
    const userPrompt = '刚发生的事件（标签：' + tag + '）' + tagHint + '：\n' + eventDesc + weatherHint;

    const client = getClaude();
    const resp = await client.messages.create({
      model: 'deepseek-v4-flash',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = (resp.content || [])
      .filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (!text) {
      console.log('[日记] AI 返回空，跳过', tag);
      return;
    }

    // 解析三行
    const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
    const getLine = (prefix) => {
      const l = lines.find(s => s.startsWith(prefix) || s.startsWith('**' + prefix) || s.startsWith('*' + prefix));
      if (!l) return '';
      // 去掉前缀和可能的 markdown 符号
      return l.replace(/^\*+/, '').replace(prefix, '').replace(/\*+$/, '').trim();
    };
    const cap = getLine('舰长：');
    const md  = getLine('女仆：');
    const gd  = getLine('守卫：');
    if (!cap || !md || !gd) {
      console.log('[日记] 解析失败，原始文本：', text.slice(0, 200));
      return;
    }

    // 组装写入
    const tagDisplay = extra ? tag + '·' + extra : tag;
    const t = todayTimeStr();
    const pad = '    '; // 时间后对齐
    const entry =
      t + '  [' + tagDisplay + ']' + pad + '舰长：' + cap + '\n' +
      t + '  [' + tagDisplay + ']' + pad + '女仆：' + md + '\n' +
      t + '  [' + tagDisplay + ']' + pad + '守卫：' + gd + '\n\n';

    fs.appendFileSync(diaryFileFor(todayDateStr()), entry, 'utf8');

    // 朗读当前角色的那句
    if (cfg().ttsEnabled !== false) {
      const roleKey = currentRoleKey();
      const roleText = roleKey === 'captain' ? cap : (roleKey === 'maid' ? md : gd);
      if (roleText && win && !win.isDestroyed()) {
        win.webContents.send('diary:speak', { role: roleKey, text: roleText });
      }
    }

    console.log('[日记] 追加', tag);
  } catch (err) {
    console.log('[日记] 异常：', (err && err.message) || err);
  } finally {
    diaryWriting = false;
  }
}

function describeEventForDiary(event) {
  switch (event.type) {
    case 'app_start':
      return '用户启动了程序';
    case 'chat_sent': {
      const s = event.preview || event.content || '';
      return '用户发了一条 ' + event.len + ' 字的消息' + (s ? '："' + s + '"' : '');
    }
    case 'clipboard_copy': {
      if (event.kind === 'image') return '用户复制了一张图片';
      const s = event.preview || event.content || '';
      return '用户复制了 ' + event.len + ' 字的内容' + (s ? '："' + s + '"' : '');
    }
    case 'window_open': {
      const nameMap = { chat: '对话', translate: '翻译', notebook: '笔记本', clipboard: '剪贴板', vault: '密码库', guard: '控制台', exercise: '运动' };
      return '用户打开了' + (nameMap[event.window] || event.window) + '窗口';
    }
    case 'role_switch':
      return '用户从 ' + event.from + ' 切换到了 ' + event.to;
    case 'quick_action':
      return '用户点击了快捷盘上的 ' + event.action;
    case 'note_added': {
      const s = event.preview || event.content || '';
      return '用户在笔记本里记了一条' + (s ? '："' + s + '"' : '');
    }
    case 'system_alert':
      return event.kind === 'battery_low' ? '系统电量低' : '系统网络断开';
    default:
      return '事件：' + event.type;
  }
}

function shouldDoOpening() {
  const f = diaryFileFor(todayDateStr());
  if (!fs.existsSync(f)) return true;
  // 文件存在但里面没有 [开场]
  const content = fs.readFileSync(f, 'utf8');
  return !content.includes('[开场]');
}

async function triggerOpening() {
  if (!shouldDoOpening()) return;
  await appendDiaryEntry('开场', '新的一天开始了，用户第一次打开程序');
}

function appendClosing() {
  const f = diaryFileFor(todayDateStr());
  if (fs.existsSync(f)) {
    const content = fs.readFileSync(f, 'utf8');
    if (content.includes('[收尾]')) return; // 今天已收尾
  }
  const t = todayTimeStr();
  const entry =
    t + '  [收尾]    舰长：今天到此。明天见。\n' +
    t + '  [收尾]    女仆：主人晚安，好好休息~\n' +
    t + '  [收尾]    守卫：日志到此。夜间无事。\n\n';
  fs.appendFileSync(diaryFileFor(todayDateStr()), entry, 'utf8');
  console.log('[日记] 追加 收尾');
}

function tryClosingOnExit() {
  try {
    appendClosing();
  } catch (e) {
    console.log('[日记] 收尾失败：', (e && e.message) || e);
  }
}

let statusCacheForNet = { netCheckedAt: 0, lastNetOk: true, lastLoggedNet: null};
let statusBusy = false;

// ===== 真实在线检测：DNS 解析 + 超时兜底 =====
// ===== 真实在线检测：HTTP HEAD 请求（绕过 DNS 缓存） =====
async function checkOnline() {
  try {
    const res = await fetch('http://www.baidu.com/favicon.ico', {
      method: 'HEAD',
      signal: AbortSignal.timeout(2000),
    });
    return !!res;
  } catch (e) {
    return false;
  }
}
async function getSystemStatus() {
  // 如果上一次检测还没完成，直接返回空（避免请求堆积）
  if (statusBusy) return {};
  statusBusy = true;
  try {
    const status = {};
    const [battery, cpu, mem] = await Promise.all([
      si.battery().catch(() => null),
      si.currentLoad().catch(() => null),
      si.mem().catch(() => null),
    ]);
    if (battery && battery.hasBattery) {
      if (!battery.isCharging && battery.percent < 20) status.battery = 'low';
      else if (battery.isCharging && battery.percent >= 95) status.battery = 'full';
      else if (battery.isCharging) status.battery = 'charging';
      else status.battery = 'ok';
    }
    if (cpu && cpu.currentLoad > 80) status.cpu = 'high';
    if (mem && mem.active / mem.total > 0.85) status.mem = 'high';
    // 网络：改为 30 秒缓存一次（不在每次 getSystemStatus 时都调 networkInterfaces）
    // 网络：DNS 探测 + 10 秒缓存
const now = Date.now();
if (now - statusCacheForNet.netCheckedAt > 3000) {
  try {
    statusCacheForNet.lastNetOk = await checkOnline();
  } catch (e) {
    statusCacheForNet.lastNetOk = false;
  }
  statusCacheForNet.netCheckedAt = now;
}
if (!statusCacheForNet.lastNetOk) status.net = 'off';

// 只在网络状态变化时打日志，不刷屏
const prevNet = statusCacheForNet.lastLoggedNet;
const curNet = statusCacheForNet.lastNetOk;
if (prevNet !== curNet) {
  console.log('[网络]', curNet ? '在线' : '离线');
  statusCacheForNet.lastLoggedNet = curNet;
}

return status;
  } catch (e) {
    console.error('[状态] 获取系统状态失败:', e.message);
    return {};
  } finally {
    statusBusy = false;
  }
}

async function generateTTSFile(text, voice, filePath) {
  const { EdgeTTS } = require('@duyquangnvx/edge-tts-universal');
  const VOICE_OPTS = {
    'zh-CN-YunxiNeural':    { rate: '+5%',  pitch: '-5Hz'  },
    'zh-CN-XiaoxiaoNeural': { rate: '+10%', pitch: '+0Hz'  },
    'zh-CN-XiaomoNeural':   { rate: '+20%', pitch: '-10Hz' },
  };
  const opts = VOICE_OPTS[voice] || { rate: '+10%', pitch: '+0Hz' };
  try {
    const tts = new EdgeTTS(text, voice, opts);
    const { audio } = await tts.synthesize();
    const buf = Buffer.from(await audio.arrayBuffer());
    await fs.promises.writeFile(filePath, buf);
  } catch (err) {
    console.error('[TTS] 生成失败:', err && err.message ? err.message : err);
    throw err;
  }
}

async function getOrCreateTTSFile(text, voice) {
  const crypto = require('crypto');
  const hash = crypto.createHash('md5').update(voice + '|' + text + '|v1').digest('hex').slice(0, 16);
  const filePath = path.join(ttsCacheDir(), hash + '.mp3');
  if (fs.existsSync(filePath)) return filePath;
  await generateTTSFile(text, voice, filePath);
  return filePath;
}

function toggleTTS() {
  const cur = cfg().ttsEnabled !== false;
  saveConfig(Object.assign({}, cfg(), { ttsEnabled: !cur }));
  if (win && !win.isDestroyed()) win.webContents.send('tts:enabled-changed', !cur);
  if (tray) tray.setContextMenu(buildMenu());
}
function toggleWallBounce() {
  const cur = cfg().wallBounce !== false;
  saveConfig(Object.assign({}, cfg(), { wallBounce: !cur }));
  if (win && !win.isDestroyed()) win.webContents.send('wall-bounce-changed', !cur);
  if (tray) tray.setContextMenu(buildMenu());
}
function toggleMaidReminders() {
  const cur = cfg().maidRemindersEnabled !== false;
  saveConfig(Object.assign({}, cfg(), { maidRemindersEnabled: !cur }));
  if (win && !win.isDestroyed()) win.webContents.send('maid-reminders-changed', !cur);
  if (tray) tray.setContextMenu(buildMenu());
}

function loadTTSManifest() {
  try {
    const p = path.join(__dirname, 'assets', 'voices', 'manifest.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('[TTS] manifest 加载失败:', e.message);
    return null;
  }
}

function classifyError(err) {
  if (err instanceof Anthropic.AuthenticationError)
    return 'Claude 没登录或 Key 无效:请在配置里填 anthropicApiKey,或运行 ant auth login';
  if (err instanceof Anthropic.RateLimitError) return '被限流啦,稍等一会儿再试~';
  if (err instanceof Anthropic.APIError) return 'Claude 出错了: ' + (err.message || err.status);
  return '网络错误: ' + ((err && err.message) || err);
}

// ---- 余额 ----
function pricingTier(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', weekday: 'short', hour: '2-digit', hour12: false,
  }).formatToParts(now);
  const weekday = (parts.find((p) => p.type === 'weekday') || {}).value;
  const hour = parseInt((parts.find((p) => p.type === 'hour') || {}).value, 10);
  if (weekday === 'Sat' || weekday === 'Sun') return 'idle';
  if ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)) return 'peak';
  return 'idle';
}

async function fetchDeepseekBalance(key) {
  const res = await fetch('https://api.deepseek.com/user/balance', {
    headers: { Authorization: 'Bearer ' + key, 'User-Agent': 'plan-g' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const info = data && data.balance_infos && data.balance_infos[0];
  if (!info) throw new Error('响应里没有 balance_infos');
  return {
    currency: info.currency || 'CNY',
    total: Number(info.total_balance || 0),
    granted: Number(info.granted_balance || 0),
    toppedUp: Number(info.topped_up_balance || 0),
    tier: pricingTier(),
  };
}

// ---- 窗口 ----
function openSplash() {
  return new Promise((resolve) => {
    const SW = 180, SH = 240;
    const wa = screen.getPrimaryDisplay().workArea;
    const x = Math.round(wa.x + (wa.width - SW) / 2);
    const y = Math.round(wa.y + (wa.height - SH) / 2);
    splashWin = new BrowserWindow({
      width: SW,
      height: SH,
      x, y,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      show: false,                 // ← 关键：创建时不显示
      backgroundColor: '#00000000', // ← 关键：完全透明背景
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    splashWin.loadFile('splash.html');

    splashWin.once('ready-to-show', () => {
      if (!splashWin || splashWin.isDestroyed()) return;
      splashWin.setOpacity(0);
      splashWin.show();
      let op = 0;
      const fadeInTimer = setInterval(() => {
        if (!splashWin || splashWin.isDestroyed()) { clearInterval(fadeInTimer); return; }
        op += 0.023;
        if (op >= 1) {
          splashWin.setOpacity(1);
          clearInterval(fadeInTimer);
        } else {
          splashWin.setOpacity(op);
        }
      }, 16);
    });

    splashWin.on('closed', () => { splashWin = null; });

    // 2.4 秒触发 CSS 渐隐，2.8 秒窗口级淡出
    setTimeout(() => {
      if (splashWin && !splashWin.isDestroyed()) {
        splashWin.webContents.send('splash:fadeout');
      }
    }, 2400);
    setTimeout(() => {
      if (!splashWin || splashWin.isDestroyed()) return resolve();
      let op2 = 1;
      const fadeOutTimer = setInterval(() => {
        if (!splashWin || splashWin.isDestroyed()) { clearInterval(fadeOutTimer); return resolve(); }
        op2 -= 0.023;
        if (op2 <= 0) {
          clearInterval(fadeOutTimer);
          splashWin.close();
          resolve();
        } else {
          splashWin.setOpacity(op2);
        }
      }, 16);
    }, 2800);
  });
}

function createWindow() {
  const size = scaledSize();
  const wa = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: size.w,
    height: size.h,
    x: wa.x + wa.width - size.w - 60,
    y: wa.y + wa.height - size.h - 4,
    transparent: true,
    frame: false,
    thickFrame: false, // 关掉 Win11 无边框窗口的隐形外框,避免 150% DPI 下移动时宽高被反复取整累积变大
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', () => {
    const r = currentRole();
    send('role-filter', r.filter);
    send('role-key', currentRoleKey());
  });
  win.on('closed', () => { win = null; });
}

function showWin() {
  if (win && !win.isDestroyed()) { win.show(); win.focus(); }
}
function openSubtitleWindow() {
  if (subtitleWin && !subtitleWin.isDestroyed()) return;
  const cfgData = cfg();
  const SW = 500, SH = 30;
  const wa = screen.getPrimaryDisplay().workArea;
  const savedX = typeof cfgData.subtitleX === 'number' ? cfgData.subtitleX : Math.round(wa.x + (wa.width - SW) / 2);
  const savedY = typeof cfgData.subtitleY === 'number' ? cfgData.subtitleY : Math.round(wa.y + wa.height - SH - 80);
  subtitleWin = new BrowserWindow({
    width: SW, height: SH,
    x: Math.max(wa.x, Math.min(savedX, wa.x + wa.width - SW)),
    y: Math.max(wa.y, Math.min(savedY, wa.y + wa.height - SH)),
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  subtitleWin.loadFile('subtitle.html');
    subtitleWin.webContents.on('did-finish-load', () => {
    if (subtitleWin && !subtitleWin.isDestroyed()) {
      subtitleWin.webContents.send('subtitle:role', currentRoleKey());
    }
  });
  subtitleWin.on('closed', () => { subtitleWin = null; });
  subtitleWin.on('moved', () => {
    if (!subtitleWin || subtitleWin.isDestroyed()) return;
    const b = subtitleWin.getBounds();
    saveConfig(Object.assign({}, cfg(), { subtitleX: b.x, subtitleY: b.y }));
  });
}

// ===== 密码/敏感信息弹窗（独立窗口，屏幕左下角） =====
function shouldSkipPassword(p) {
  const site = p.site || '';
  const user = p.user || '';
  const pass = p.pass || '';
  // 会话内去重：用 网站+用户名 做 key（没有 site/user 就退化到密码本身）
  const key = (site && user) ? (site + '|' + user) : ('pass|' + pass);
  if (sessionDetectedKeys.has(key)) return true;
  // 密码库去重：已解锁时检查是否存在相同条目
  try {
    if (vaultKey) {
      const fileObj = JSON.parse(fs.readFileSync(VAULT_FILE(), 'utf8'));
      const data = decryptVault(fileObj, vaultKey);
      const entries = data.entries || [];
      const exists = entries.some((en) => {
        if (site && user && en.site === site && en.user === user) return true;
        if (!site && !user && en.pass === pass) return true;
        return false;
      });
      if (exists) { sessionDetectedKeys.add(key); return true; }
    }
  } catch (e) {}
  sessionDetectedKeys.add(key);
  return false;
}

function openPwdConfirmWindow(payload) {
  if (pwdConfirmWin && !pwdConfirmWin.isDestroyed()) {
    pwdConfirmWin.close();
  }
  const W = 340, H = 200;
  const wa = screen.getPrimaryDisplay().workArea;
  const x = wa.x + 20;
  const y = wa.y + wa.height - H - 20; // 屏幕左下角
  const winRef = new BrowserWindow({
    width: W, height: H, x, y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  pwdConfirmWin = winRef;
  winRef.setAlwaysOnTop(true, 'screen-saver');
  winRef.loadFile('pwd-confirm.html');
  winRef.once('ready-to-show', () => {
    if (winRef && !winRef.isDestroyed()) {
      winRef.showInactive();
      winRef.webContents.send('pwd-confirm:show', payload);
    }
  });
  // 15 秒自动关
  const timer = setTimeout(() => {
    if (winRef && !winRef.isDestroyed()) winRef.close();
  }, 15000);
  winRef.on('closed', () => {
    clearTimeout(timer);
    if (pwdConfirmWin === winRef) pwdConfirmWin = null;
  });
}

function openChat() {
  if (chatWin && !chatWin.isDestroyed()) { chatWin.show(); chatWin.focus(); return; }
  recordEvent('window_open', { window: 'chat' });
  if (canTriggerDiary('窗口')) {
    appendDiaryEntry('窗口', describeEventForDiary({ type: 'window_open', window: 'chat' }), '对话').catch(()=>{});
  }
  const CHW = 360, CHH = 480;
  let x, y;
  if (win) {
    const b = win.getBounds();
    const wa = screen.getPrimaryDisplay().workArea;
    x = b.x - CHW - 12;
    if (x < wa.x) x = b.x + b.width + 12;
    y = b.y + b.height - CHH;
    x = Math.max(wa.x, Math.min(x, wa.x + wa.width - CHW));
    y = Math.max(wa.y, Math.min(y, wa.y + wa.height - CHH));
  }
  chatWin = new BrowserWindow({
    width: CHW, height: CHH, x, y,
    frame: false, resizable: true, alwaysOnTop: false, skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  chatWin.loadFile('chat.html');
  chatWin.webContents.on('did-finish-load', () => {
    const r = currentRole();
    chatWin.webContents.send('role-info', { key: currentRoleKey(), name: r.name, avatar: r.avatar });
  });
  chatWin.on('closed', () => { chatWin = null; });
}

function openVault() {
  if (vaultWin && !vaultWin.isDestroyed()) { vaultWin.show(); vaultWin.focus(); return; }
  recordEvent('window_open', { window: 'vault' });
  if (canTriggerDiary('窗口')) {
    appendDiaryEntry('窗口', describeEventForDiary({ type: 'window_open', window: 'vault' }), '密码库').catch(()=>{});
  }
  const VW = 420, VH = 520;
  let x, y;
  if (win) {
    const b = win.getBounds();
    const wa = screen.getPrimaryDisplay().workArea;
    x = b.x - VW - 12;
    if (x < wa.x) x = b.x + b.width + 12;
    y = b.y + b.height - VH;
    x = Math.max(wa.x, Math.min(x, wa.x + wa.width - VW));
    y = Math.max(wa.y, Math.min(y, wa.y + wa.height - VH));
  }
  vaultWin = new BrowserWindow({
    width: VW, height: VH, x, y,
    frame: false, resizable: true, alwaysOnTop: true, skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  vaultWin.loadFile('vault.html');
  vaultWin.webContents.on('did-finish-load', () => {
    const vaultPath = path.join(app.getPath('userData'), 'vault.enc');
    vaultWin.webContents.send('vault:init', fs.existsSync(vaultPath));
  });
  vaultWin.on('closed', () => {
    vaultWin = null;
    vaultKey = null;
    console.log('[vault] 已锁定，密钥已清空');
  });
}

function openGuard() {
  if (guardWin && !guardWin.isDestroyed()) { guardWin.show(); guardWin.focus(); return; }
  recordEvent('window_open', { window: 'guard' });
  if (canTriggerDiary('窗口')) {
    appendDiaryEntry('窗口', describeEventForDiary({ type: 'window_open', window: 'guard' }), '控制台').catch(()=>{});
  }
  const GW = 480, GH = 560;
  let x, y;
  if (win) {
    const b = win.getBounds();
    const wa = screen.getPrimaryDisplay().workArea;
    x = b.x - GW - 12;
    if (x < wa.x) x = b.x + b.width + 12;
    y = b.y + b.height - GH;
    x = Math.max(wa.x, Math.min(x, wa.x + wa.width - GW));
    y = Math.max(wa.y, Math.min(y, wa.y + wa.height - GH));
  }
  guardWin = new BrowserWindow({
    width: GW, height: GH, x, y,
    frame: false, resizable: true, alwaysOnTop: true, skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  guardWin.loadFile('guard.html');
  guardWin.on('closed', () => { guardWin = null; });
}

function openExerciseWindow() {
  if (exerciseWin && !exerciseWin.isDestroyed()) { exerciseWin.show(); exerciseWin.focus(); return; }
  recordEvent('window_open', { window: 'exercise' });
  if (canTriggerDiary('窗口')) {
    appendDiaryEntry('窗口', describeEventForDiary({ type: 'window_open', window: 'exercise' }), '运动').catch(()=>{});
  }
  const EW = 360, EH = 500;
  let x, y;
  if (win) {
    const b = win.getBounds();
    const wa = screen.getPrimaryDisplay().workArea;
    x = b.x + b.width + 8;
    if (x + EW > wa.x + wa.width) x = b.x - EW - 8;
    y = b.y + Math.round(b.height / 2) - Math.round(EH / 2);
    x = Math.max(wa.x, Math.min(x, wa.x + wa.width - EW));
    y = Math.max(wa.y, Math.min(y, wa.y + wa.height - EH));
  } else {
    x = 100; y = 100;
  }
  exerciseWin = new BrowserWindow({
    width: EW, height: EH, x, y,
    frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: false,
    transparent: true, hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  exerciseWin.loadFile('exercise.html');
  exerciseWin.on('closed', () => { exerciseWin = null; });
}

function openNotebook() {
  if (notebookWin && !notebookWin.isDestroyed()) { notebookWin.show(); notebookWin.focus(); return; }
  recordEvent('window_open', { window: 'notebook' });
  if (canTriggerDiary('窗口')) {
    appendDiaryEntry('窗口', describeEventForDiary({ type: 'window_open', window: 'notebook' }), '笔记本').catch(()=>{});
  }
  const NW = 460, NH = 580;
  let x, y;
  if (win) {
    const b = win.getBounds();
    const wa = screen.getPrimaryDisplay().workArea;
    x = b.x - NW - 12;
    if (x < wa.x) x = b.x + b.width + 12;
    y = b.y + b.height - NH;
    x = Math.max(wa.x, Math.min(x, wa.x + wa.width - NW));
    y = Math.max(wa.y, Math.min(y, wa.y + wa.height - NH));
  }
  notebookWin = new BrowserWindow({
    width: NW, height: NH, x, y,
    frame: false, resizable: true, alwaysOnTop: true, skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  notebookWin.loadFile('notebook.html');
  notebookWin.on('closed', () => { notebookWin = null; });
}

function openDiary() {
  if (diaryWin && !diaryWin.isDestroyed()) { diaryWin.show(); diaryWin.focus(); return; }
  const DW = 520, DH = 640;
  let x, y;
  if (win) {
    const b = win.getBounds();
    const wa = screen.getPrimaryDisplay().workArea;
    x = b.x - DW - 12;
    if (x < wa.x) x = b.x + b.width + 12;
    y = b.y + b.height - DH;
    x = Math.max(wa.x, Math.min(x, wa.x + wa.width - DW));
    y = Math.max(wa.y, Math.min(y, wa.y + wa.height - DH));
  }
  diaryWin = new BrowserWindow({
    width: DW, height: DH, x, y,
    frame: false, resizable: true, alwaysOnTop: true, skipTaskbar: false,
    transparent: true, hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  diaryWin.loadFile('diary.html');
  diaryWin.on('closed', () => { diaryWin = null; });
  recordEvent('window_open', { window: 'diary' });
  if (canTriggerDiary('查阅')) {
    appendDiaryEntry('查阅', '用户打开了日记窗口').catch(()=>{});
  }
}

function openClipboardHistory() {
  if (clipWin && !clipWin.isDestroyed()) { clipWin.show(); clipWin.focus(); return; }
  recordEvent('window_open', { window: 'clipboard' });
  if (canTriggerDiary('窗口')) {
    appendDiaryEntry('窗口', describeEventForDiary({ type: 'window_open', window: 'clipboard' }), '剪贴板').catch(()=>{});
  }
  const CW = 480, CH = 560;
  let x, y;
  if (win) {
    const b = win.getBounds();
    const wa = screen.getPrimaryDisplay().workArea;
    x = b.x - CW - 12;
    if (x < wa.x) x = b.x + b.width + 12;
    y = b.y + b.height - CH;
    x = Math.max(wa.x, Math.min(x, wa.x + wa.width - CW));
    y = Math.max(wa.y, Math.min(y, wa.y + wa.height - CH));
  }
  clipWin = new BrowserWindow({
    width: CW, height: CH, x, y,
    frame: false, resizable: true, alwaysOnTop: false, skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  clipWin.loadFile('clipboard.html');
  clipWin.on('blur', () => { if (clipWin && !clipWin.isDestroyed()) clipWin.hide(); });
  clipWin.on('closed', () => { clipWin = null; });
}

function openTranslate() {
  if (translateWin && !translateWin.isDestroyed()) { translateWin.show(); translateWin.focus(); return; }
  recordEvent('window_open', { window: 'translate' });
  if (canTriggerDiary('窗口')) {
    appendDiaryEntry('窗口', describeEventForDiary({ type: 'window_open', window: 'translate' }), '翻译').catch(()=>{});
  }
  const TW = 360, TH = 460;
  let x, y;
  if (win) {
    const b = win.getBounds();
    const wa = screen.getPrimaryDisplay().workArea;
    x = b.x - TW - 12;
    if (x < wa.x) x = b.x + b.width + 12;
    y = b.y + b.height - TH;
    x = Math.max(wa.x, Math.min(x, wa.x + wa.width - TW));
    y = Math.max(wa.y, Math.min(y, wa.y + wa.height - TH));
  }
  translateWin = new BrowserWindow({
    width: TW, height: TH, x, y,
    frame: false, resizable: true, alwaysOnTop: false, skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  translateWin.loadFile('translate.html');
  translateWin.on('closed', () => { translateWin = null; });
}

const ROLE_WINDOWS = () => ({ qa: qaWin, chat: chatWin, translate: translateWin, clipboard: clipWin });
function getWinByKey(key) {
  const w = ROLE_WINDOWS()[key];
  return (w && !w.isDestroyed()) ? w : null;
}

function openQuickAssist(mode, text) {
  pendingQA = { mode: mode || 'auto', text: String(text || '') };
  if (qaWin && !qaWin.isDestroyed()) {
    qaWin.show();
    qaWin.focus();
    qaWin.webContents.send('qa:start', pendingQA);
    return;
  }
  const QW = 400, QH = 380;
  const cp = screen.getCursorScreenPoint();
  const wa = screen.getPrimaryDisplay().workArea;
  let x = cp.x + 16, y = cp.y + 16;
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - QW));
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - QH));
  qaWin = new BrowserWindow({
    width: QW, height: QH, x, y,
    frame: false, resizable: true, alwaysOnTop: true, skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  qaWin.loadFile('quickassist.html');
    qaWin.on('closed', () => {
    console.log('[qa] 窗口关闭，调用栈：', new Error().stack);
    qaWin = null;
  });
}

// 向当前前台窗口发送 Ctrl+C,自动抓取选中的文字(免手动复制)
function simulateCopy() {
  return new Promise((resolve) => {
    execFile('powershell', [
      '-NoProfile', '-WindowStyle', 'Hidden', '-Command',
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')",
    ], { windowsHide: true, timeout: 3000 }, () => resolve());
  });
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// 全局划词:抓取选中文字 → 智能处理
async function quickAssist(mode, autoCopy) {
  recordEvent('quick_action', { action: 'assist' });
  if (autoCopy) {
    // 先隐藏划词助手，让 Ctrl+C 发给真正的目标窗口
    if (qaWin && !qaWin.isDestroyed() && qaWin.isVisible()) {
      qaWin.hide();
      await delay(120);
    }
    const before = clipboard.readText();
    await simulateCopy();
    // 轮询等待剪贴板变化，最多 800ms
    for (let i = 0; i < 40; i++) {
      await delay(20);
      const cur = clipboard.readText();
      if (cur !== before && cur.trim()) break;
    }
  }
  const text = clipboard.readText().trim();
  if (!text) {
    showWin();
    send('action', 'clipboard-hint');
    return;
  }
  openQuickAssist(mode || 'auto', text);
}

async function captureSelectionToNotebook() {
  // 抓取当前选中的文字（发送 Ctrl+C）
  await simulateCopy();
  await delay(180);
  const text = clipboard.readText().trim();
  if (!text) {
    if (win && !win.isDestroyed()) win.webContents.send('notebook:toast', { ok: false, msg: '没有选中任何文字' });
    return;
  }
  // 追加到 notebook.json 的 excerpt 数组
  try {
    const p = notebookPath();
    let data = { inspiration: [], excerpt: [], todo: [] };
    if (fs.existsSync(p)) {
      data = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!Array.isArray(data.excerpt)) data.excerpt = [];
      if (!Array.isArray(data.inspiration)) data.inspiration = [];
      if (!Array.isArray(data.todo)) data.todo = [];
    }
    data.excerpt.unshift({ id: Date.now() + Math.random(), text, time: Date.now() });
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
    if (win && !win.isDestroyed()) win.webContents.send('notebook:toast', { ok: true, msg: '已记到笔记本 · 摘录' });
    // 如果笔记本窗口开着，通知它刷新
    if (notebookWin && !notebookWin.isDestroyed()) {
      notebookWin.webContents.send('notebook:refresh');
    }
  } catch (e) {
    if (win && !win.isDestroyed()) win.webContents.send('notebook:toast', { ok: false, msg: '记录失败：' + e.message });
  }
}

function send(name, value) {
  if (win) win.webContents.send('action', name, value);
}


// ---- 系统指令(安全版):右键菜单触发,固定白名单,不含关机/截屏 ----
const SYSTEM_COMMANDS = {
  lock: 'rundll32.exe user32.dll,LockWorkStation',
  open_notepad: 'start notepad',
  open_browser: 'start msedge',
};

function runSystemCommand(action) {
  const cmd = SYSTEM_COMMANDS[action];
  if (!cmd) return;
  exec(cmd, { windowsHide: true }, (err) => {
    if (err) console.error('[系统指令] 执行失败:', action, err.message);
  });
}

function startClipboardWatcher() {
  if (clipboardWatcher) return;
  clipboardWatcher = setInterval(() => {
    try {
      // ===== 图片检测（独立，MD5 去重）=====
      const imgBuf = clipboard.readBuffer('image/png');
      if (imgBuf && imgBuf.length > 0) {
        const hash = crypto.createHash('md5').update(imgBuf).digest('hex');
        if (hash !== lastClipboardImageHash) {
          lastClipboardImageHash = hash;
          pushClipImage(imgBuf);
          recordEvent('clipboard_copy', { kind: 'image' });
        }
        return;
      }

      // ===== 文本检测 =====
      const cur = clipboard.readText();
      if (cur === lastClipboardText) return;
      lastClipboardText = cur;
      const s = String(cur || '').trim();
      if (!s) return;

      // ===== 先无条件采集到历史（这才是剪贴板历史该干的）=====
      pushClipText(s);

      // ===== 敏感信息检测（只负责弹窗提示；敏感内容不记任何事件）=====
      let sensitive = null;
      if (s.length >= 6 && s.length <= 200) {
        if (/^\d{17}[\dXx]$/.test(s)) sensitive = { type: '身份证号', level: 'high', advice: '请勿轻易发给他人，谨慎上传证件照。' };
        else if (/^\d{16,19}$/.test(s)) sensitive = { type: '银行卡号', level: 'high', advice: '注意核对收款方，谨防诈骗转账。' };
        else if (/^1[3-9]\d{9}$/.test(s)) sensitive = { type: '手机号', level: 'low', advice: '警惕验证码诈骗，不要转告陌生人。' };
        else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length < 60) sensitive = { type: '邮箱地址', level: 'low', advice: '警惕钓鱼邮件，陌生链接不要点。' };
        else if (/^(sk-|ghp_|gho_|AKIA)[A-Za-z0-9_\-]{16,}$/.test(s)) sensitive = { type: 'API 密钥', level: 'high', advice: '若已泄露，请立即到对应平台吊销并重新生成。' };
      }

      if (sensitive) {
        openPwdConfirmWindow({ type: 'sensitive', data: { type: sensitive.type, level: sensitive.level, text: s, advice: sensitive.advice } });
        return;
      }

      // 非敏感文本：按记忆粒度记录复制事件
      const level = cfg().memoryLevel || 'snippet';
      const evt = { kind: 'text', len: s.length };
      if (level === 'snippet') evt.preview = snippetOf(s, 20);
      else if (level === 'detail') evt.content = s;
      recordEvent('clipboard_copy', evt);
      if (evt.len > 50 && canTriggerDiary('复制')) {
        appendDiaryEntry('复制', describeEventForDiary({ type: 'clipboard_copy', kind: 'text', len: evt.len, preview: evt.preview, content: evt.content }), evt.len + '字').catch(()=>{});
      }

      // ===== 密码特征（保持原有行为）=====
      if (s.length < 6 || s.length > 64) return;
      if (/\s/.test(s)) return;
      if (!/[a-zA-Z]/.test(s) || !/[0-9]/.test(s)) return;
      if (/^https?:\/\//i.test(s)) return;
      if (/@/.test(s) && /\./.test(s)) return;
      if (/^\d{11}$/.test(s)) return;
      const pwdData = { site: '', user: '', pass: s };
      if (!shouldSkipPassword(pwdData)) {
        openPwdConfirmWindow({ type: 'password', data: pwdData });
      }
    } catch (e) {}
  }, 1000);
}

function startExtServer() {
  if (extServer) return;
  extServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method !== 'POST' || req.url !== '/password') {
      res.writeHead(404); res.end(); return;
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data && data.pass) {
          const pwdData = { site: data.site || '', user: data.user || '', pass: data.pass };
          if (!shouldSkipPassword(pwdData)) {
            openPwdConfirmWindow({ type: 'password', data: pwdData });
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400); res.end();
      }
    });
  });
  extServer.listen(27888, '127.0.0.1', () => console.log('[ext] 浏览器扩展通道已开启：127.0.0.1:27888'));
}

function broadcastRole(key) {
  [chatWin, translateWin, qaWin, clipWin].forEach(w => {
    if (w && !w.isDestroyed()) w.webContents.send('role-key', key);
  });
}

function switchRole(key) {
  
  if (autoSwitchTimer && !roleBeforeAutoSwitch) { clearTimeout(autoSwitchTimer); autoSwitchTimer = null; }
  if (!ROLES[key]) return;
  const previousKey = currentRoleKey();
  saveConfig(Object.assign({}, cfg(), { role: key }));
  recordEvent('role_switch', { from: previousKey, to: key });
  const r = ROLES[key];
  send('role-filter', r.filter);
  send('role-key', key);
  broadcastRole(key);
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.webContents.send('role-info', { key, name: r.name, avatar: r.avatar });
  }
  if (tray) tray.setContextMenu(buildMenu());
    if (subtitleWin && !subtitleWin.isDestroyed()) {
    subtitleWin.webContents.send('subtitle:role', key);
  }
}

function switchRoleTemporary(key, durationMs) {
  console.log('[临时切]', key, durationMs, '\n来源:', new Error().stack);   // ← 加这行
  const cur = currentRoleKey();
  if (cur === key) return; // 已经是该角色，不做切换
  if (autoSwitchTimer) { clearTimeout(autoSwitchTimer); autoSwitchTimer = null; }
  if (!roleBeforeAutoSwitch) {
  roleBeforeAutoSwitch = cur;
  console.log('[记录原角色]', cur, '（临时切到', key, '，', durationMs, 'ms 后恢复）');
}
  switchRole(key);
  autoSwitchTimer = setTimeout(() => {
   if (roleBeforeAutoSwitch) {
  console.log('[恢复原角色]', roleBeforeAutoSwitch);
  switchRole(roleBeforeAutoSwitch);
  roleBeforeAutoSwitch = null;
}
    autoSwitchTimer = null;
  }, durationMs);
}

function cycleRole() {
  const order = ['captain', 'maid', 'guard'];
  const i = order.indexOf(currentRoleKey());
  switchRole(order[(i + 1) % order.length]);
}

function buildMenu() {
  const sizeOptions = [0.4, 0.6, 0.8, 1, 1.25].map((k) => ({
    label: Math.round(k * 100) + '%',
    type: 'checkbox',
    checked: (cfg().scale || DEFAULT_SCALE) === k,
    click: () => setScale(k),
  }));
  return Menu.buildFromTemplate([
    { label: '角色切换 🎭', submenu: Object.entries(ROLES).map(([key, r]) => ({
    label: r.name + '  ' + ({ captain: 'Ctrl+Shift+1', maid: 'Ctrl+Shift+2', guard: 'Ctrl+Shift+3' }[key] || ''),
    type: 'radio',
    checked: currentRoleKey() === key,
    click: () => switchRole(key),
})) },
    { label: '◈ 舰长', submenu: [
      { label: '打开笔记本 🗒', click: () => openNotebook() },
      { label: '记下选中文字 ⌨ Shift+Alt+S', click: () => captureSelectionToNotebook() },
    ] },
    { label: '日记 ✎', click: () => openDiary() },
    { type: 'separator' },
    { label: '对话 💬  Ctrl+Shift+C', click: () => openChat() },
    { label: '划词助手 ✨  Shift+Alt+A', click: () => quickAssist('auto') },
    { label: '翻译 🌐  Ctrl+Shift+T', click: () => openTranslate() },
    { label: '剪贴板历史 📋  Ctrl+Shift+V', click: () => openClipboardHistory() },
    { label: '碎碎念', click: () => send('whisper') },
    { label: '查看余额 💰', click: () => send('balance') },
    { type: 'separator' },
    { label: '系统 🖥', submenu: [
      { label: '锁定屏幕 🔒', click: () => runSystemCommand('lock') },
      { label: '打开记事本 📝', click: () => runSystemCommand('open_notepad') },
      { label: '打开浏览器 🌐', click: () => runSystemCommand('open_browser') },
    ] },
    { label: '⛨ 守卫', submenu: [
      { label: '密码库 🔐', click: () => openVault() },
      { label: '控制台 🖥', click: () => openGuard() },
    ] },
    { type: 'separator' },
    { label: '语音播报', type: 'checkbox', checked: cfg().ttsEnabled !== false, click: () => toggleTTS() },
    { label: '女仆提醒', type: 'checkbox', checked: cfg().maidRemindersEnabled !== false, click: () => toggleMaidReminders() },
    { label: '天气显示', type: 'checkbox', checked: cfg().locationConsent === true, click: () => toggleWeather() },
    { label: '记忆粒度', submenu: [
      { label: '匿名（只记统计）', type: 'radio', checked: (cfg().memoryLevel || 'snippet') === 'anonymous', click: () => setMemoryLevel('anonymous') },
      { label: '片段（记前 20 字）', type: 'radio', checked: (cfg().memoryLevel || 'snippet') === 'snippet', click: () => setMemoryLevel('snippet') },
      { label: '详细（记完整内容）', type: 'radio', checked: (cfg().memoryLevel || 'snippet') === 'detail', click: () => setMemoryLevel('detail') },
    ] },
    { label: '撞墙反弹', type: 'checkbox', checked: cfg().wallBounce !== false, click: () => toggleWallBounce() },
    { label: '穿透点击(让鼠标点到桌面) Ctrl+Shift+G', type: 'checkbox', checked: clickThrough, click: () => toggleClickThrough() },
    { label: '大小', submenu: sizeOptions },
    { type: 'separator' },
    { label: '隐藏到托盘  Ctrl+Shift+F', click: () => win && win.hide() },
    { label: '退出', click: () => app.quit() },
  ]);
}

function toggleWeather() {
  const cur = cfg().locationConsent === true;
  saveConfig(Object.assign({}, cfg(), { locationConsent: !cur }));
  if (tray) tray.setContextMenu(buildMenu());
  if (!cur) {
    // 刚打开 → 立刻拉一次
    refreshWeather().catch(() => {});
  }
}

function toggleClickThrough() {
  clickThrough = !clickThrough;
  if (win) win.setIgnoreMouseEvents(clickThrough, { forward: true });
  send('clickthrough', clickThrough);
  if (tray) tray.setContextMenu(buildMenu());
}

function clampScale(k) { return Math.max(0.25, Math.min(2, k)); }

function applyScale(k) {
  k = clampScale(k);
  const b = win.getBounds();
  const size = { w: Math.round(W * k), h: Math.round(H * k) };
  const wa = screen.getPrimaryDisplay().workArea;
  const cx = b.x + b.width / 2;
  const bottom = b.y + b.height;
  const x = Math.max(wa.x, Math.min(Math.round(cx - size.w / 2), wa.x + wa.width - size.w));
  const y = Math.max(wa.y, Math.min(Math.round(bottom - size.h), wa.y + wa.height - size.h));
  win.setBounds({ x, y, width: size.w, height: size.h });
  saveConfig(Object.assign({}, cfg(), { scale: k }));
  send('scale', k);
  if (tray) tray.setContextMenu(buildMenu());
  return k;
}

function setScale(k) { applyScale(k); }

function setMemoryLevel(level) {
  if (!['anonymous', 'snippet', 'detail'].includes(level)) return;
  saveConfig(Object.assign({}, cfg(), { memoryLevel: level }));
  if (tray) tray.setContextMenu(buildMenu());
  if (win && !win.isDestroyed()) {
    win.webContents.send('memory-level-changed', level);
  }
}

function createTray(iconDataUrl) {
  let icon = nativeImage.createEmpty();
  if (iconDataUrl) {
    const ni = nativeImage.createFromDataURL(iconDataUrl);
    if (!ni.isEmpty()) icon = ni;
  }
  tray = new Tray(icon);
  tray.setToolTip('G计划 · 数据方舟');
  tray.setContextMenu(buildMenu());
  tray.on('click', () => { win.isVisible() ? win.hide() : win.show(); });
}

// ---- IPC ----
ipcMain.handle('get-config', () => cfg());
ipcMain.handle('save-config', (e, c) => saveConfig(Object.assign({}, cfg(), c)));
ipcMain.handle('get-workarea', () => screen.getPrimaryDisplay().workArea);
ipcMain.handle('get-position', () => {
  const b = win.getBounds();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
});
ipcMain.on('set-position', (e, x, y) => {
  if (!win) return;
  // 移动时用 setBounds 并回写「规范尺寸」(由 scale 算出,不读 getBounds):
  // 150% DPI 下读回 getBounds() 的尺寸已被取整带大,再喂回去会 1~2px 地越滚越大(鱼越动越大)。
  const size = scaledSize();
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: size.w, height: size.h });
});
ipcMain.on('show-context-menu', () => buildMenu().popup({ window: win }));
ipcMain.on('set-tray-icon', (e, d) => { if (!tray) createTray(d); });
ipcMain.on('role:temp-switch', (e, key, durationMs) => {
  switchRoleTemporary(key, durationMs || 15000);
});
ipcMain.handle('get-cursor', () => screen.getCursorScreenPoint());
ipcMain.handle('set-click-through', (e, b) => { clickThrough = b; win.setIgnoreMouseEvents(b, { forward: true }); });
ipcMain.handle('resize', (e, dir) => {
  const cur = cfg().scale || DEFAULT_SCALE;
  const step = dir >= 0 ? 0.05 : -0.05;
  return applyScale(Math.round((cur + step) * 100) / 100);
});

ipcMain.handle('get-balance', async () => {
  const key = deepseekKey();
  if (!key) return { ok: false, reason: 'credential-missing', message: '没找到 DeepSeek Key,请在配置里填 deepseekApiKey' };
  try {
    const data = await fetchDeepseekBalance(key);
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, reason: 'fetch-error', message: '查余额失败: ' + ((err && err.message) || err) };
  }
});
ipcMain.on('set-mouse-passthrough', (e, pass) => {
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(!!pass, { forward: true });
  }
});
ipcMain.handle('system:status', async () => await getSystemStatus());
ipcMain.handle('get-current-role', () => currentRoleKey());

ipcMain.on('pet:quick-action', (e, action) => {
  switch (action) {
    case 'chat': recordEvent('quick_action', { action: 'chat' }); openChat(); break;
    case 'clipboard': recordEvent('quick_action', { action: 'clipboard' }); openClipboardHistory(); break;
    case 'assist': quickAssist('auto', true); break;
    case 'translate': recordEvent('quick_action', { action: 'translate' }); openTranslate(); break;
    case 'notebook': recordEvent('quick_action', { action: 'notebook' }); openNotebook(); break;
    case 'vault': recordEvent('quick_action', { action: 'vault' }); openVault(); break;
    case 'console': recordEvent('quick_action', { action: 'console' }); openGuard(); break;
    case 'exercise': recordEvent('quick_action', { action: 'exercise' }); openExerciseWindow(); break;
    case 'role': recordEvent('quick_action', { action: 'role' }); cycleRole(); break;
    case 'diary':
      openDiary();
      break;
  }
});

ipcMain.handle('tts:play-by-text', async (e, text) => {
  const t = String(text || '').trim();
  if (!t) return { ok: false, reason: 'empty' };
  if (!ttsManifest) ttsManifest = loadTTSManifest();
  if (!ttsManifest) return { ok: false, reason: 'no-manifest' };

  const role = currentRoleKey();
  const group = ttsManifest[role] || {};
  const filename = group[t];
  if (!filename) return { ok: false, reason: 'no-match' };

  const filePath = path.join(__dirname, 'assets', 'voices', role, filename);
  if (!fs.existsSync(filePath)) return { ok: false, reason: 'file-missing' };

  try {
    const buf = fs.readFileSync(filePath);
    const dataUrl = 'data:audio/mp3;base64,' + buf.toString('base64');
    return { ok: true, dataUrl };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});

ipcMain.handle('tts:get-enabled', () => cfg().ttsEnabled !== false);

const ttsLiveCacheDir = () => {
  const dir = path.join(app.getPath('userData'), 'tts-live-cache');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

function ttsLiveCacheKey(text, role) {
  return crypto.createHash('md5')
    .update(role + '|' + text + '|v1')
    .digest('hex')
    .slice(0, 20) + '.mp3';
}

async function synthesizeRealtime(text, role) {
  const t = String(text || '').trim();
  if (!t) throw new Error('空文本');
  if (t.length > 200) throw new Error('文本过长（>200字）');
  const key = ttsLiveCacheKey(t, role);
  const cachePath = path.join(ttsLiveCacheDir(), key);
  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath);
  }
  const credPath = path.join(__dirname, 'xfyun-credentials.json');
  const buf = await xfyunTts.synthesize(t, role, credPath);
  try { fs.writeFileSync(cachePath, buf); } catch (e) {}
  return buf;
}

ipcMain.handle('tts:synth-realtime', async (e, text, role) => {
  try {
    const useRole = ['captain', 'maid', 'guard'].includes(role) ? role : currentRoleKey();
    const buf = await synthesizeRealtime(text, useRole);
    const dataUrl = 'data:audio/mp3;base64,' + buf.toString('base64');
    return { ok: true, dataUrl };
  } catch (err) {
    console.error('[TTS-实时]', err.message);
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('tts:clear-live-cache', () => {
  try {
    const dir = ttsLiveCacheDir();
    const files = fs.readdirSync(dir);
    files.forEach(f => { try { fs.unlinkSync(path.join(dir, f)); } catch (e) {} });
    return { ok: true, count: files.length };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

ipcMain.handle('maid-reminders-enabled', () => cfg().maidRemindersEnabled !== false);
ipcMain.handle('wall-bounce-enabled', () => cfg().wallBounce !== false);

ipcMain.handle('clipboard-history:list', () => readClipHistory());
ipcMain.handle('clipboard-history:paste', (e, id) => {
  const data = readClipHistory();
  const item = (data.items || []).find(it => String(it.id) === String(id));
  if (!item) return { ok: false };
  if (item.type === 'text') {
    clipboard.writeText(item.content);
  } else if (item.type === 'image') {
    const p = path.join(clipboardImagesDir(), item.imageFile);
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      clipboard.writeImage(img);
    }
  }
  if (clipWin && !clipWin.isDestroyed()) clipWin.hide();
  return { ok: true };
});
ipcMain.handle('clipboard-history:copy-only', (e, id) => {
  const data = readClipHistory();
  const item = (data.items || []).find(it => String(it.id) === String(id));
  if (!item) return { ok: false };
  if (item.type === 'text') {
    clipboard.writeText(item.content);
  } else if (item.type === 'image') {
    const p = path.join(clipboardImagesDir(), item.imageFile);
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      clipboard.writeImage(img);
    }
  }
  return { ok: true };
});
ipcMain.handle('clipboard-history:delete', (e, id) => {
  const data = readClipHistory();
  if (!Array.isArray(data.items)) data.items = [];
  const idx = data.items.findIndex(it => String(it.id) === String(id));
  if (idx >= 0) {
    const item = data.items[idx];
    if (item.type === 'image' && item.imageFile) {
      try { fs.unlinkSync(path.join(clipboardImagesDir(), item.imageFile)); } catch (e) {}
    }
    data.items.splice(idx, 1);
    writeClipHistory(data);
  }
  return { ok: true };
});
ipcMain.handle('clipboard-history:toggle-pin', (e, id) => {
  const data = readClipHistory();
  if (!Array.isArray(data.items)) data.items = [];
  const item = data.items.find(it => String(it.id) === String(id));
  if (item) { item.pinned = !item.pinned; writeClipHistory(data); }
  return { ok: true, pinned: item ? item.pinned : false };
});
ipcMain.handle('clipboard-history:clear-all', () => {
  const data = readClipHistory();
  const pinned = (data.items || []).filter(it => it.pinned);
  (data.items || []).forEach(it => {
    if (!it.pinned && it.type === 'image' && it.imageFile) {
      try { fs.unlinkSync(path.join(clipboardImagesDir(), it.imageFile)); } catch (e) {}
    }
  });
  writeClipHistory({ items: pinned });
  return { ok: true };
});
ipcMain.handle('clipboard-history:read-image', (e, filename) => {
  try {
    const safe = path.basename(String(filename || ''));
    const full = path.join(clipboardImagesDir(), safe);
    if (!fs.existsSync(full)) return { ok: false };
    const buf = fs.readFileSync(full);
    return { ok: true, dataUrl: 'data:image/png;base64,' + buf.toString('base64') };
  } catch (e) { return { ok: false }; }
});
ipcMain.on('clipboard-history:close', () => { if (clipWin) clipWin.close(); });

ipcMain.handle('whisper', async () => {
  try {
    const client = getClaude();
    const resp = await client.messages.create({
      model: 'deepseek-v4-flash',
      max_tokens: 512,
      system: currentRole().persona,
      
      messages: [{ role: 'user', content: '随便说一句日常碎碎念,一句就好,20字以内。' }],
    });
    const text = (resp.content || [])
      .filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return { ok: true, text: text || '……(今天不想说话)' };
  } catch (err) {
    return { ok: false, message: classifyError(err) };
  }
});

ipcMain.handle('chat:load', () => {
  const rounds = Number(cfg().chatMemoryRounds || 3);
  return readMemory().messages.slice(-(rounds * 2));
});

ipcMain.handle('chat:clear', () => { writeMemory({ messages: [] }); return true; });

ipcMain.handle('chat:send', async (e, text) => {
  const mem = readMemory();
  const rounds = Number(cfg().chatMemoryRounds || 3);
  const history = mem.messages.slice(-(rounds * 2));
  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: String(text || '') },
  ];
  const level = cfg().memoryLevel || 'snippet';
  const t = String(text || '');
  const evt = { len: t.length };
  if (level === 'snippet') evt.preview = snippetOf(t, 20);
  else if (level === 'detail') evt.content = t;
  recordEvent('chat_sent', evt);
  if (evt.len > 20 && canTriggerDiary('长谈')) {
    appendDiaryEntry('聊天', describeEventForDiary({ type: 'chat_sent', len: evt.len, preview: evt.preview, content: evt.content }), evt.len + '字').catch(()=>{});
  }
  try {
    const client = getClaude();
    const stream = client.messages.stream({
      model: 'deepseek-v4-flash',
      max_tokens: 1024,
      system: currentRole().persona,
      messages,
    });
    let full = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta && event.delta.type === 'text_delta') {
        full += event.delta.text;
        e.sender.send('chat:chunk', { text: event.delta.text });
      }
    }
    mem.messages.push({ role: 'user', content: String(text) });
    mem.messages.push({ role: 'assistant', content: full });
    writeMemory(mem);
    e.sender.send('chat:done', { text: full });
    return { ok: true };
  } catch (err) {
    const msg = classifyError(err);
    e.sender.send('chat:error', { message: msg });
    return { ok: false, message: msg };
  }
});

ipcMain.on('chat:close', () => { if (chatWin) chatWin.close(); });
ipcMain.on('vault:close', () => { if (vaultWin) vaultWin.close(); });
ipcMain.handle('subtitle:get-role', () => currentRoleKey());
ipcMain.on('subtitle:show', (e, text) => {
  if (!text) return;
  if (!subtitleWin || subtitleWin.isDestroyed()) openSubtitleWindow();
  if (subtitleTimer) { clearTimeout(subtitleTimer); subtitleTimer = null; }
  const showIt = () => {
    if (!subtitleWin || subtitleWin.isDestroyed()) return;
    const len = String(text).length;
    const stayMs = len > 30 ? 6500 : 3500;
    const charInterval = 55;
    const appearMs = len * charInterval + 320;
    const disappearMs = len * charInterval + 320;
    const totalMs = appearMs + stayMs + disappearMs + 500;
    subtitleWin.showInactive();
    subtitleWin.webContents.send('subtitle:play', { text, stayMs });
    subtitleTimer = setTimeout(() => {
      if (subtitleWin && !subtitleWin.isDestroyed()) subtitleWin.hide();
      subtitleTimer = null;
    }, totalMs);
  };
  if (subtitleWin.webContents.isLoading()) {
    subtitleWin.webContents.once('did-finish-load', showIt);
  } else {
    showIt();
  }
});

ipcMain.on('subtitle:close', () => {
  if (subtitleWin && !subtitleWin.isDestroyed()) subtitleWin.close();
});
function openVaultWithPassword(payload) {
  const sendPrefill = () => {
    if (vaultWin && !vaultWin.isDestroyed()) {
      vaultWin.webContents.send('vault:prefill-password', payload);
    }
  };
  if (vaultWin && !vaultWin.isDestroyed()) {
    vaultWin.show();
    vaultWin.focus();
    sendPrefill();
    return;
  }
  openVault();
  if (vaultWin) {
    vaultWin.webContents.once('did-finish-load', sendPrefill);
  }
}

ipcMain.on('vault:open-with-password', (e, payload) => openVaultWithPassword(payload));

// ===== 密码/敏感弹窗：跳过关闭 / 加入密码库 =====
ipcMain.on('pwd-confirm:close', () => {
  if (pwdConfirmWin && !pwdConfirmWin.isDestroyed()) pwdConfirmWin.close();
});

ipcMain.on('pwd-confirm:accept', (e, payload) => {
  if (payload) openVaultWithPassword(payload);
  if (pwdConfirmWin && !pwdConfirmWin.isDestroyed()) pwdConfirmWin.close();
});
ipcMain.handle('vault:check', () => {
  const vaultPath = path.join(app.getPath('userData'), 'vault.enc');
  return fs.existsSync(vaultPath);
});

const VAULT_FILE = () => path.join(app.getPath('userData'), 'vault.enc');

function encryptVault(data, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = cipher.update(JSON.stringify(data), 'utf8', 'hex') + cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return { iv: iv.toString('hex'), authTag: authTag.toString('hex'), ciphertext: ct };
}

function decryptVault(fileObj, key) {
  const iv = Buffer.from(fileObj.iv, 'hex');
  const authTag = Buffer.from(fileObj.authTag, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const json = decipher.update(fileObj.ciphertext, 'hex', 'utf8') + decipher.final('utf8');
  return JSON.parse(json);
}

ipcMain.handle('vault:unlock', (e, password) => {
  if (!password || password.length < 8) return { ok: false, message: '主密码至少 8 位' };
  const vf = VAULT_FILE();
  try {
    if (fs.existsSync(vf)) {
      const fileObj = JSON.parse(fs.readFileSync(vf, 'utf8'));
      const salt = Buffer.from(fileObj.salt, 'hex');
      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      const data = decryptVault(fileObj, key);
      vaultKey = key;
      return { ok: true, entries: data.entries || [] };
    } else {
      const salt = crypto.randomBytes(16);
      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      const enc = encryptVault({ entries: [] }, key);
      fs.writeFileSync(vf, JSON.stringify(Object.assign({ salt: salt.toString('hex') }, enc)));
      vaultKey = key;
      return { ok: true, entries: [] };
    }
  } catch (err) {
    return { ok: false, message: '主密码错误或文件损坏' };
  }
});

ipcMain.handle('vault:save', (e, entries) => {
  if (!vaultKey) return { ok: false, message: '未解锁' };
  try {
    const vf = VAULT_FILE();
    const fileObj = JSON.parse(fs.readFileSync(vf, 'utf8'));
    const enc = encryptVault({ entries }, vaultKey);
    fs.writeFileSync(vf, JSON.stringify(Object.assign({ salt: fileObj.salt }, enc)));
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('vault:list', () => {
  if (!vaultKey) return { ok: false, message: '未解锁' };
  try {
    const vf = VAULT_FILE();
    const fileObj = JSON.parse(fs.readFileSync(vf, 'utf8'));
    const data = decryptVault(fileObj, vaultKey);
    return { ok: true, entries: data.entries || [] };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('vault:get-ext-path', () => path.join(__dirname, 'browser-extension'));

ipcMain.handle('styles:load', (e, role) => {
  try {
    const p = path.join(__dirname, 'styles', role + '.md');
    if (!fs.existsSync(p)) return { ok: false, message: '风格文件不存在' };
    return { ok: true, text: fs.readFileSync(p, 'utf8') };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('memory:stats', () => {
  try {
    if (!fs.existsSync(eventsPath())) return { ok: true, count: 0 };
    const lines = fs.readFileSync(eventsPath(), 'utf8').split('\n').filter(Boolean);
    return { ok: true, count: lines.length, path: eventsPath() };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

ipcMain.handle('diary:read', (e, dateStr) => {
  try {
    const p = diaryFileFor(dateStr || todayDateStr());
    if (!fs.existsSync(p)) return { ok: false, message: '不存在' };
    return { ok: true, text: fs.readFileSync(p, 'utf8') };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('diary:list', () => {
  try {
    const dir = diaryRootDir();
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    return { ok: true, files: files.map(f => f.replace('.md', '')).sort().reverse() };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.on('diary:close', () => { if (diaryWin) diaryWin.close(); });

ipcMain.handle('diary:get-weather', () => weatherCache);

let guardConnBusy = false;
ipcMain.handle('guard:connections', async () => {
  if (guardConnBusy) return { ok: false, list: [], message: '正在检查中，请稍候' };
  guardConnBusy = true;
  try {
    const list = await si.networkConnections();
    const filtered = list
      .filter(c => c.state === 'ESTABLISHED' || c.state === 'LISTENING')
      .map(c => ({
        protocol: c.protocol || 'tcp',
        local: (c.localAddress || '') + ':' + (c.localPort || ''),
        remote: c.peerAddress ? (c.peerAddress + ':' + c.peerPort) : '(监听中)',
        state: c.state,
        pid: c.pid || 0,
      }))
      .slice(0, 50);
    return { ok: true, list: filtered, total: filtered.length };
  } catch (e) {
    return { ok: false, list: [], message: e.message };
  } finally {
    guardConnBusy = false;
  }
});

ipcMain.handle('guard:sysinfo', async () => {
  try {
    const [cpu, mem, disk] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
    ]);
    return {
      ok: true,
      cpu: Number(cpu.currentLoad.toFixed(1)),
      memUsed: Number(((mem.active || mem.used) / 1024 / 1024 / 1024).toFixed(2)),
      memTotal: Number((mem.total / 1024 / 1024 / 1024).toFixed(2)),
      disk: (disk || []).slice(0, 4).map(d => ({
        fs: d.fs,
        size: Number((d.size / 1024 / 1024 / 1024).toFixed(1)),
        used: Number((d.used / 1024 / 1024 / 1024).toFixed(1)),
        use: Number((d.use || 0).toFixed(1)),
      })),
    };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

ipcMain.on('guard:close', () => { if (guardWin) guardWin.close(); });

ipcMain.on('exercise:close', () => { if (exerciseWin) exerciseWin.close(); });
ipcMain.on('exercise:open', () => { openExerciseWindow(); });
ipcMain.on('exercise:notify-maid', (e, msg) => {
  if (win && !win.isDestroyed()) win.webContents.send('maid-bubble', msg || '');
});
ipcMain.handle('exercise:get-list', () => {
  return [
    { name: '眼保健操', duration: '3 分钟', benefits: '缓解眼睛疲劳，保护视力。', steps: ['揉天应穴（20 次）', '挤按睛明穴（20 次）', '揉四白穴（20 次）', '按太阳穴（20 次）'], tip: '💡 手指干净，力度轻柔，别揉眼球哦~' },
    { name: '颈椎操', duration: '2 分钟', benefits: '缓解颈椎僵硬，改善肩颈酸胀。', steps: ['前俯 5 秒', '后仰 5 秒', '左转 5 秒', '右转 5 秒', '缓慢绕环 3 圈'], tip: '💡 动作要慢，别猛甩头。' },
    { name: '手腕拉伸', duration: '1 分钟', benefits: '缓解鼠标手和键盘手。', steps: ['右手掌向上，左手下压 15 秒', '换手 15 秒', '双手甩动放松 10 秒'], tip: '💡 感到微酸即可，不要压到痛。' },
    { name: '肩颈放松', duration: '2 分钟', benefits: '舒缓肩颈肌肉，改善含胸驼背。', steps: ['吸气耸肩，呼气放下，重复 5 次', '双肩向后绕 10 圈', '双手扩胸 5 次'], tip: '💡 呼吸配合动作，吸气耸肩效果更好。' },
    { name: '站立拉伸', duration: '2 分钟', benefits: '拉伸腰背，缓解久坐僵硬。', steps: ['双脚与肩同宽站好', '双手上举，十指交叉', '向左侧弯 15 秒', '向右侧弯 15 秒', '放松放下'], tip: '💡 站稳再弯，别过度。' },
    { name: '扩胸运动', duration: '1 分钟', benefits: '打开胸腔，改善含胸。', steps: ['双臂前后大幅摆动 20 次', '双手交叉抱头后仰 10 秒', '深呼吸 3 次'], tip: '💡 打开胸腔深呼吸效果更明显。' },
    { name: '深呼吸放松', duration: '1 分钟', benefits: '平复情绪，缓解焦虑。', steps: ['吸气 4 秒', '屏息 4 秒', '呼气 6 秒', '重复 4 轮'], tip: '💡 用腹式呼吸，感受腹部起伏。' },
  ];
});

ipcMain.on('notebook:close', () => { if (notebookWin) notebookWin.close(); });
ipcMain.on('notebook:refresh-done', () => {});

ipcMain.handle('notebook:load', () => {
  try {
    const p = notebookPath();
    if (!fs.existsSync(p)) return { inspiration: [], excerpt: [], todo: [], trash: [] };
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      inspiration: Array.isArray(data.inspiration) ? data.inspiration : [],
      excerpt: Array.isArray(data.excerpt) ? data.excerpt : [],
      todo: Array.isArray(data.todo) ? data.todo : [],
      trash: Array.isArray(data.trash) ? data.trash : [],
    };
  } catch (e) {
    return { inspiration: [], excerpt: [], todo: [], trash: [] };
  }
});

ipcMain.handle('notebook:save', (e, data) => {
  try {
    fs.writeFileSync(notebookPath(), JSON.stringify(data, null, 2));
    const d = data || {};
    const count = (d.inspiration || []).length + (d.excerpt || []).length + (d.todo || []).length;
    recordEvent('notebook_save', { count });

    // 按记忆粒度记录"新增"条目（一次最多记 5 条，避免刷屏）
    const all = [...(d.inspiration || []), ...(d.excerpt || []), ...(d.todo || [])];
    const newItems = all.filter(it => !lastNotebookIds.has(String(it.id)));
    lastNotebookIds = new Set(all.map(it => String(it.id)));

    const level = cfg().memoryLevel || 'snippet';
    for (const item of newItems.slice(0, 5)) {
      const txt = String(item.text || '');
      const evt = { len: txt.length };
      if (level === 'snippet') evt.preview = snippetOf(txt, 20);
      else if (level === 'detail') evt.content = txt;
      recordEvent('note_added', evt);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('notebook:comment', async (e, text) => {
  if (!text || !String(text).trim()) return { ok: false, message: '内容为空' };
  try {
    const client = getClaude();
    const resp = await client.messages.create({
      model: 'deepseek-v4-flash',
      max_tokens: 600,
      system: '你是G-舰长，指挥官专属的AI管家。风格像钢铁侠的贾维斯：专业、可靠、冷静、务实。称呼用户为"指挥官"。现在指挥官记录了一条笔记/灵感/摘录，请用1~2句话简短点评：可以补充思路、指出风险、或给出建议。不要客套，不要复述原内容，直接给出你的看法。控制在60字以内。即使内容重复或较简单，也要给出不同角度的回应，绝对不要返回空内容。',
      messages: [{ role: 'user', content: String(text) }],
    });
    const out = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    return { ok: true, text: out || '(指挥官，这条我暂时没什么好说的，你再补充点细节？)' };
  } catch (err) {
    return { ok: false, message: classifyError(err) };
  }
});

ipcMain.handle('notebook:get-settings', () => {
  return { autoComment: cfg().notebookAutoComment !== false };
});
ipcMain.handle('notebook:set-auto-comment', (e, on) => {
  saveConfig(Object.assign({}, cfg(), { notebookAutoComment: !!on }));
  return { ok: true };
});

ipcMain.handle('notebook:pick-image', async () => {
  try {
    const res = await dialog.showOpenDialog(notebookWin, {
      title: '选择一张图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    const src = res.filePaths[0];
    const ext = path.extname(src).toLowerCase() || '.png';
    const filename = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext;
    const dest = path.join(notebookAssetsDir(), filename);
    fs.copyFileSync(src, dest);
    return { ok: true, filename };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

ipcMain.handle('notebook:read-image', async (e, filename) => {
  try {
    const safe = path.basename(String(filename || ''));
    if (!safe) return { ok: false };
    const full = path.join(notebookAssetsDir(), safe);
    if (!fs.existsSync(full)) return { ok: false, message: '文件不存在' };
    const buf = fs.readFileSync(full);
    const ext = path.extname(safe).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'image/jpeg' : ('image/' + ext);
    return { ok: true, dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64') };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

ipcMain.handle('notebook:delete-image', async (e, filename) => {
  try {
    const safe = path.basename(String(filename || ''));
    if (!safe) return { ok: false };
    const full = path.join(notebookAssetsDir(), safe);
    if (fs.existsSync(full)) fs.unlinkSync(full);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

ipcMain.handle('notebook:paste-image', async () => {
  try {
    const img = clipboard.readImage();
    if (!img || img.isEmpty()) return { ok: false, message: '剪贴板里没有图片' };
    const filename = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.png';
    const dest = path.join(notebookAssetsDir(), filename);
    fs.writeFileSync(dest, img.toPNG());
    return { ok: true, filename };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

ipcMain.handle('guard:get-whitelist', () => {
  const c = cfg();
  return Array.isArray(c.guardWhitelist) ? c.guardWhitelist : [];
});
ipcMain.handle('guard:add-whitelist', (e, ip) => {
  if (!ip) return { ok: false };
  const c = cfg();
  const list = Array.isArray(c.guardWhitelist) ? c.guardWhitelist : [];
  if (!list.includes(ip)) list.push(ip);
  saveConfig(Object.assign({}, c, { guardWhitelist: list }));
  return { ok: true, list };
});
ipcMain.handle('guard:remove-whitelist', (e, ip) => {
  const c = cfg();
  const list = (Array.isArray(c.guardWhitelist) ? c.guardWhitelist : []).filter(x => x !== ip);
  saveConfig(Object.assign({}, c, { guardWhitelist: list }));
  return { ok: true, list };
});

ipcMain.handle('vault:copy', (e, text) => {
  if (!text) return { ok: false };
  clipboard.writeText(String(text));
  // 30秒后自动清空剪贴板（只清空一次，避免误清用户后续复制的内容）
  setTimeout(() => {
    try { if (clipboard.readText() === String(text)) clipboard.clear(); } catch (e) {}
  }, 5000);
  return { ok: true };
});

ipcMain.handle('translate:send', async (e, text, target) => {
  const t = String(text || '').trim();
  if (!t) return { ok: false, message: '请输入要翻译的内容' };
  const LANGS = { zh2en: '英文', en2zh: '简体中文', zh2ja: '日文', zh2ko: '韩文', auto2zh: '简体中文' };
  const lang = LANGS[target] || '英文';
  try {
    const client = getClaude();
    const resp = await client.messages.create({
      model: 'deepseek-v4-flash',
      max_tokens: 2048,
      system: '你是专业的翻译助手。把用户提供的文本翻译成目标语言,要求准确、自然、保留原意与语气。只输出译文本身,不要任何解释、注释、引号或前缀。',
      messages: [{ role: 'user', content: '目标语言:' + lang + '\n\n待翻译文本:\n' + t }],
    });
    const out = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return { ok: true, text: out || '(空)' };
  } catch (err) {
    return { ok: false, message: classifyError(err) };
  }
});

ipcMain.on('translate:close', () => { if (translateWin) translateWin.close(); });
ipcMain.handle('clipboard:read', () => clipboard.readText());
ipcMain.handle('clipboard:write', (e, t) => { clipboard.writeText(String(t)); return true; });
ipcMain.handle('qa:get-always-on-top', () => {
  return qaWin && !qaWin.isDestroyed() ? qaWin.isAlwaysOnTop() : false;
});

ipcMain.handle('qa:set-always-on-top', (e, on) => {
  if (qaWin && !qaWin.isDestroyed()) {
    qaWin.setAlwaysOnTop(!!on, 'screen-saver');
  }
  return { ok: true };
});

ipcMain.handle('window:get-always-on-top', (e, key) => {
  const w = getWinByKey(key);
  return w ? w.isAlwaysOnTop() : false;
});

ipcMain.handle('window:set-always-on-top', (e, key, on) => {
  const w = getWinByKey(key);
  if (w) w.setAlwaysOnTop(!!on, 'screen-saver');
  return { ok: true };
});
ipcMain.handle('qa:init', () => pendingQA || { mode: 'auto', text: '' });
ipcMain.handle('qa:run', async (e, payload) => {
  const t = String((payload && payload.text) || '').trim();
  if (!t) return { ok: false, message: '没有内容' };
  const mode = QA_MODES[(payload && payload.mode) || 'auto'] || QA_MODES.auto;
  const reqId = (payload && payload.reqId) || 0;
  try {
    const client = getClaude();
    const stream = client.messages.stream({
      model: 'deepseek-v4-flash',
      max_tokens: 2048,
      system: mode.system,
      messages: [{ role: 'user', content: t }],
    });
    let full = '';
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
        full += ev.delta.text;
        e.sender.send('qa:chunk', { reqId, text: ev.delta.text });
      }
    }
    e.sender.send('qa:done', { reqId, text: full });
    return { ok: true, text: full };
  } catch (err) {
    const msg = classifyError(err);
    e.sender.send('qa:error', { reqId, message: msg });
    return { ok: false, message: msg };
  }
});

function runLocalTool(tool, text) {
  switch (tool) {
    case 'json': {
      const obj = JSON.parse(text);
      return JSON.stringify(obj, null, 2);
    }
    case 'b64-encode':
      return Buffer.from(text, 'utf8').toString('base64');
    case 'b64-decode':
      return Buffer.from(text.trim(), 'base64').toString('utf8');
    case 'url-encode':
      return encodeURIComponent(text);
    case 'url-decode':
      return decodeURIComponent(text);
    case 'ts-to-date': {
      const n = Number(text.trim());
      if (!isFinite(n)) throw new Error('不是有效的时间戳数字');
      const ms = String(text.trim()).length <= 10 ? n * 1000 : n;
      const d = new Date(ms);
      if (isNaN(d.getTime())) throw new Error('时间戳超出范围');
      const pad = (x) => String(x).padStart(2, '0');
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
        + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }
    case 'date-to-ts': {
      const d = new Date(text.trim().replace(/\//g, '-'));
      if (isNaN(d.getTime())) throw new Error('无法识别的日期格式，试试 2024-01-01 12:00:00');
      return '秒：' + Math.floor(d.getTime() / 1000)
        + '\n毫秒：' + d.getTime()
        + '\nISO：' + d.toISOString();
    }
    case 'naming': {
      const words = text
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[-_\s]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(w => w.toLowerCase());
      if (!words.length) throw new Error('没有有效单词');
      const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
      return 'camelCase:    ' + (words[0] + words.slice(1).map(cap).join(''))
        + '\nPascalCase:   ' + words.map(cap).join('')
        + '\nsnake_case:   ' + words.join('_')
        + '\nkebab-case:   ' + words.join('-')
        + '\nCONSTANT:     ' + words.join('_').toUpperCase();
    }
    case 'hash': {
      const crypto = require('crypto');
      const md5 = crypto.createHash('md5').update(text, 'utf8').digest('hex');
      const sha1 = crypto.createHash('sha1').update(text, 'utf8').digest('hex');
      const sha256 = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
      return 'MD5:     ' + md5 + '\nSHA-1:   ' + sha1 + '\nSHA-256: ' + sha256;
    }
    default:
      throw new Error('未知工具：' + tool);
  }
}

ipcMain.handle('qa:tool', (e, payload) => {
  const text = String((payload && payload.text) || '');
  const tool = String((payload && payload.tool) || '');
  if (!text) return { ok: false, message: '没有内容' };
  try {
    return { ok: true, text: runLocalTool(tool, text) };
  } catch (err) {
    return { ok: false, message: (err && err.message) || String(err) };
  }
});

ipcMain.on('qa:close', () => { if (qaWin) qaWin.close(); });

ipcMain.on('splash:close', () => {
  if (splashWin && !splashWin.isDestroyed()) splashWin.close();
});

function startSuspiciousWatcher() {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const now = Date.now();
      if (now - lastSuspiciousAlert < 5 * 60 * 1000) { busy = false; return; }
      const list = await si.networkConnections();
      const SUSPICIOUS_PORTS = [23, 445, 135, 139, 1433, 3389, 5900, 6667, 12345, 3000, 4444, 8080];
      const wl = Array.isArray(cfg().guardWhitelist) ? cfg().guardWhitelist : [];
      const bad = list.find(c => {
        if (c.state !== 'ESTABLISHED') return false;
        const ip = c.peerAddress || '';
        if (!ip || wl.includes(ip)) return false;
        return SUSPICIOUS_PORTS.includes(c.peerPort);
      });
      if (bad) {
        lastSuspiciousAlert = now;
        openPwdConfirmWindow({ type: 'suspicious', data: { ip: bad.peerAddress, port: bad.peerPort } });
      }
    } catch (e) {} finally {
      busy = false;
    }
  }, 5 * 60 * 1000);
}

