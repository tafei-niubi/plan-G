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
  globalShortcut.register('Shift+Alt+A', () => { quickAssist('auto', true); });
  globalShortcut.register('Shift+Alt+S', () => { captureSelectionToNotebook(); });
  globalShortcut.register('Control+Shift+1', () => switchRole('captain'));
  globalShortcut.register('Control+Shift+2', () => switchRole('maid'));
  globalShortcut.register('Control+Shift+3', () => switchRole('guard'));
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());

}
const ttsCacheDir = () => {
  const dir = path.join(app.getPath('userData'), 'tts-cache');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

// 窗口基准尺寸(与动画素材 640×500 一致,16:9)
const W = 640;
const H = 700;

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
const DEFAULT_ROLE = 'captain';
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
let clipboardWatcher = null;
let extServer = null;
let guardWin = null;
let lastSuspiciousAlert = 0;
let autoSwitchTimer = null;
let roleBeforeAutoSwitch = null;
let exerciseWin = null;
let notebookWin = null;
let splashWin = null;
let lastSystemStatus = null;
let ttsManifest = null;

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

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); }
  catch (e) { return {}; }
}
function saveConfig(c) {
  try { fs.writeFileSync(configPath(), JSON.stringify(c, null, 2)); }
  catch (e) {}
}
function cfg() { return Object.assign({ scale: DEFAULT_SCALE, notebookAutoComment: true }, loadConfig()); }
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

function openChat() {
  if (chatWin && !chatWin.isDestroyed()) { chatWin.show(); chatWin.focus(); return; }
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
    frame: false, resizable: true, alwaysOnTop: true, skipTaskbar: false,
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

function openTranslate() {
  if (translateWin && !translateWin.isDestroyed()) { translateWin.show(); translateWin.focus(); return; }
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
    frame: false, resizable: true, alwaysOnTop: true, skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  translateWin.loadFile('translate.html');
  translateWin.on('closed', () => { translateWin = null; });
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
  qaWin.on('closed', () => { qaWin = null; });
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
  if (autoCopy) {
    await simulateCopy();
    await delay(180); // 等剪贴板更新
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
      const cur = clipboard.readText();
      if (cur === lastClipboardText) return;
      lastClipboardText = cur;
      const s = String(cur || '').trim();
      if (!s || s.length < 6 || s.length > 200) return;

      // ===== 敏感信息检测（优先级高于密码） =====
      let sensitive = null;
      if (/^\d{17}[\dXx]$/.test(s)) sensitive = { type: '身份证号', level: 'high', advice: '请勿轻易发给他人，谨慎上传证件照。' };
      else if (/^\d{16,19}$/.test(s)) sensitive = { type: '银行卡号', level: 'high', advice: '注意核对收款方，谨防诈骗转账。' };
      else if (/^1[3-9]\d{9}$/.test(s)) sensitive = { type: '手机号', level: 'low', advice: '警惕验证码诈骗，不要转告陌生人。' };
      else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length < 60) sensitive = { type: '邮箱地址', level: 'low', advice: '警惕钓鱼邮件，陌生链接不要点。' };
      else if (/^(sk-|ghp_|gho_|AKIA)[A-Za-z0-9_\-]{16,}$/.test(s)) sensitive = { type: 'API 密钥', level: 'high', advice: '若已泄露，请立即到对应平台吊销并重新生成。' };

      if (sensitive && win && !win.isDestroyed()) {
        win.webContents.send('sensitive-detected', { type: sensitive.type, level: sensitive.level, text: s, advice: sensitive.advice });
        return;
      }

      // ===== 密码特征（保持原有逻辑） =====
      if (s.length < 6 || s.length > 64) return;
      if (/\s/.test(s)) return;
      if (!/[a-zA-Z]/.test(s) || !/[0-9]/.test(s)) return;
      if (/^https?:\/\//i.test(s)) return;
      if (/@/.test(s) && /\./.test(s)) return;
      if (/^\d{11}$/.test(s)) return;
      if (win && !win.isDestroyed()) {
        win.webContents.send('password-detected', s);
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
        if (win && !win.isDestroyed() && data && data.pass) {
          win.webContents.send('password-detected', data);
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

function switchRole(key) {
  console.log('[切角色]', key, '\n来源:', new Error().stack);   // ← 加这行
  if (autoSwitchTimer && !roleBeforeAutoSwitch) { clearTimeout(autoSwitchTimer); autoSwitchTimer = null; }
  if (!ROLES[key]) return;
  saveConfig(Object.assign({}, cfg(), { role: key }));
  const r = ROLES[key];
  send('role-filter', r.filter);
  send('role-key', key);
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
    { type: 'separator' },
    { label: '对话 💬  Ctrl+Shift+C', click: () => openChat() },
    { label: '划词助手 ✨  Shift+Alt+A', click: () => quickAssist('auto') },
    { label: '翻译 🌐  Ctrl+Shift+T', click: () => openTranslate() },
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
    { label: '穿透点击(让鼠标点到桌面) Ctrl+Shift+G', type: 'checkbox', checked: clickThrough, click: () => toggleClickThrough() },
    { label: '大小', submenu: sizeOptions },
    { type: 'separator' },
    { label: '隐藏到托盘  Ctrl+Shift+F', click: () => win && win.hide() },
    { label: '退出', click: () => app.quit() },
  ]);
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

ipcMain.handle('system:status', async () => await getSystemStatus());

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
ipcMain.on('vault:open-with-password', (e, payload) => {
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
      if (bad && win && !win.isDestroyed()) {
        lastSuspiciousAlert = now;
        win.webContents.send('guard:suspicious', { ip: bad.peerAddress, port: bad.peerPort });
      }
    } catch (e) {} finally {
      busy = false;
    }
  }, 5 * 60 * 1000);
}

