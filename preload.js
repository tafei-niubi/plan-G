// 安全的 IPC 桥接
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (c) => ipcRenderer.invoke('save-config', c),
  getWorkArea: () => ipcRenderer.invoke('get-workarea'),
  getPosition: () => ipcRenderer.invoke('get-position'),
  setPosition: (x, y) => ipcRenderer.send('set-position', x, y),
  getCursor: () => ipcRenderer.invoke('get-cursor'),
  showContextMenu: () => ipcRenderer.send('show-context-menu'),
  setTrayIcon: (d) => ipcRenderer.send('set-tray-icon', d),
  onAction: (cb) => ipcRenderer.on('action', (e, name, value) => cb(name, value)),
  getBalance: () => ipcRenderer.invoke('get-balance'),
  whisper: () => ipcRenderer.invoke('whisper'),
  resize: (dir) => ipcRenderer.invoke('resize', dir),
  onPasswordDetected: (cb) => ipcRenderer.on('password-detected', (e, text) => cb(text)),
  onSensitiveDetected: (cb) => ipcRenderer.on('sensitive-detected', (e, data) => cb(data)),
  onSuspicious: (cb) => ipcRenderer.on('guard:suspicious', (e, data) => cb(data)),
  tempSwitchRole: (key, duration) => ipcRenderer.send('role:temp-switch', key, duration),
  openWithPassword: (payload) => ipcRenderer.send('vault:open-with-password', payload),
  openExercise: () => ipcRenderer.send('exercise:open'),
  onMaidBubble: (cb) => ipcRenderer.on('maid-bubble', (e, msg) => cb(msg)),
  onNotebookToast: (cb) => ipcRenderer.on('notebook:toast', (e, d) => cb(d)),
  showSubtitle: (text) => ipcRenderer.send('subtitle:show', text),
  getSystemStatus: () => ipcRenderer.invoke('system:status'),
    setMousePassthrough: (pass) => ipcRenderer.send('set-mouse-passthrough', pass),
  onSystemStatusChanged: (cb) => ipcRenderer.on('system:status-changed', (e, s) => cb(s)),
  playByText: (text) => ipcRenderer.invoke('tts:play-by-text', text),
  onTTSEnabledChanged: (cb) => ipcRenderer.on('tts:enabled-changed', (e, on) => cb(on)),
  getTTSEnabled: () => ipcRenderer.invoke('tts:get-enabled'),
  getMaidRemindersEnabled: () => ipcRenderer.invoke('maid-reminders-enabled'),
    getWallBounceEnabled: () => ipcRenderer.invoke('wall-bounce-enabled'),
  onWallBounceChanged: (cb) => ipcRenderer.on('wall-bounce-changed', (e, on) => cb(on)),
  onMaidRemindersChanged: (cb) => ipcRenderer.on('maid-reminders-changed', (e, on) => cb(on)),
  quickAction: (action) => ipcRenderer.send('pet:quick-action', action),
  onMemoryLevelChanged: (cb) => ipcRenderer.on('memory-level-changed', (e, level) => cb(level)),
  synthRealtime: (text, role) => ipcRenderer.invoke('tts:synth-realtime', text, role),
  clearLiveCache: () => ipcRenderer.invoke('tts:clear-live-cache'),
  onDiarySpeak: (cb) => ipcRenderer.on('diary:speak', (e, d) => cb(d)),
  asrStart: () => ipcRenderer.invoke('asr:start'),
  asrSendAudio: (base64, isLast) => ipcRenderer.send('asr:audio', base64, isLast),
  asrStop: () => ipcRenderer.send('asr:stop'),
  onAsrResult: (cb) => ipcRenderer.on('asr:result', (e, d) => cb(d)),
  onAsrError: (cb) => ipcRenderer.on('asr:error', (e, d) => cb(d)),
  onAsrEnd: (cb) => ipcRenderer.on('asr:end', (e) => cb()),
  voiceSend: (text) => ipcRenderer.send('voice:send', text),
});

contextBridge.exposeInMainWorld('translateAPI', {
  send: (text, target) => ipcRenderer.invoke('translate:send', text, target),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (t) => ipcRenderer.invoke('clipboard:write', t),
  close: () => ipcRenderer.send('translate:close'),
});

contextBridge.exposeInMainWorld('qaAPI', {
  init: () => ipcRenderer.invoke('qa:init'),
  run: (payload) => ipcRenderer.invoke('qa:run', payload),
  tool: (payload) => ipcRenderer.invoke('qa:tool', payload),
  getAlwaysOnTop: () => ipcRenderer.invoke('qa:get-always-on-top'),
  setAlwaysOnTop: (on) => ipcRenderer.invoke('qa:set-always-on-top', on),
  writeClipboard: (t) => ipcRenderer.invoke('clipboard:write', t),
  close: () => ipcRenderer.send('qa:close'),
  onStart: (cb) => ipcRenderer.on('qa:start', (e, d) => cb(d)),
  onChunk: (cb) => ipcRenderer.on('qa:chunk', (e, d) => cb(d)),
  onDone: (cb) => ipcRenderer.on('qa:done', (e, d) => cb(d)),
  onError: (cb) => ipcRenderer.on('qa:error', (e, d) => cb(d)),
});

contextBridge.exposeInMainWorld('chatAPI', {
  send: (text) => ipcRenderer.invoke('chat:send', text),
  load: () => ipcRenderer.invoke('chat:load'),
  clear: () => ipcRenderer.invoke('chat:clear'),
  close: () => ipcRenderer.send('chat:close'),
  onChunk: (cb) => ipcRenderer.on('chat:chunk', (e, d) => cb(d)),
  onDone: (cb) => ipcRenderer.on('chat:done', (e, d) => cb(d)),
  onError: (cb) => ipcRenderer.on('chat:error', (e, d) => cb(d)),
  onRoleInfo: (cb) => ipcRenderer.on('role-info', (e, d) => cb(d)),
  onVoiceInject: (cb) => ipcRenderer.on('voice:inject', (e, text) => cb(text)),
});

contextBridge.exposeInMainWorld('vaultAPI', {
  close: () => ipcRenderer.send('vault:close'),
  unlock: (pwd) => ipcRenderer.invoke('vault:unlock', pwd),
  list: () => ipcRenderer.invoke('vault:list'),
  save: (entries) => ipcRenderer.invoke('vault:save', entries),
  copy: (text) => ipcRenderer.invoke('vault:copy', text),
  getExtPath: () => ipcRenderer.invoke('vault:get-ext-path'),
  onInit: (cb) => ipcRenderer.on('vault:init', (e, hasVault) => cb(hasVault)),
  openWithPassword: (pwd) => ipcRenderer.send('vault:open-with-password', pwd),
  onPrefillPassword: (cb) => ipcRenderer.on('vault:prefill-password', (e, pwd) => cb(pwd)),
});

contextBridge.exposeInMainWorld('guardAPI', {
  close: () => ipcRenderer.send('guard:close'),
  getConnections: () => ipcRenderer.invoke('guard:connections'),
  getSysInfo: () => ipcRenderer.invoke('guard:sysinfo'),
  getWhitelist: () => ipcRenderer.invoke('guard:get-whitelist'),
  addWhitelist: (ip) => ipcRenderer.invoke('guard:add-whitelist', ip),
  removeWhitelist: (ip) => ipcRenderer.invoke('guard:remove-whitelist', ip),
});

contextBridge.exposeInMainWorld('exerciseAPI', {
  close: () => ipcRenderer.send('exercise:close'),
  getList: () => ipcRenderer.invoke('exercise:get-list'),
  notifyMaid: (msg) => ipcRenderer.send('exercise:notify-maid', msg),
});

contextBridge.exposeInMainWorld('notebookAPI', {
  close: () => ipcRenderer.send('notebook:close'),
  load: () => ipcRenderer.invoke('notebook:load'),
  save: (data) => ipcRenderer.invoke('notebook:save', data),
  onRefresh: (cb) => ipcRenderer.on('notebook:refresh', () => cb()),
  comment: (text) => ipcRenderer.invoke('notebook:comment', text),
  getSettings: () => ipcRenderer.invoke('notebook:get-settings'),
  setAutoComment: (on) => ipcRenderer.invoke('notebook:set-auto-comment', on),
  pickImage: () => ipcRenderer.invoke('notebook:pick-image'),
  readImage: (filename) => ipcRenderer.invoke('notebook:read-image', filename),
  deleteImage: (filename) => ipcRenderer.invoke('notebook:delete-image', filename),
  pasteImage: () => ipcRenderer.invoke('notebook:paste-image'),
});

contextBridge.exposeInMainWorld('splashAPI', {
  close: () => ipcRenderer.send('splash:close'),
   onFadeOut: (cb) => ipcRenderer.on('splash:fadeout', () => cb()),
});
contextBridge.exposeInMainWorld('subtitleAPI', {
  onPlay: (cb) => ipcRenderer.on('subtitle:play', (e, d) => cb(d)),
  onRole: (cb) => ipcRenderer.on('subtitle:role', (e, key) => cb(key)),
  getRole: () => ipcRenderer.invoke('subtitle:get-role'),
});

contextBridge.exposeInMainWorld('clipboardHistoryAPI', {
  list: () => ipcRenderer.invoke('clipboard-history:list'),
  paste: (id) => ipcRenderer.invoke('clipboard-history:paste', id),
  copyOnly: (id) => ipcRenderer.invoke('clipboard-history:copy-only', id),
  del: (id) => ipcRenderer.invoke('clipboard-history:delete', id),
  togglePin: (id) => ipcRenderer.invoke('clipboard-history:toggle-pin', id),
  clearAll: () => ipcRenderer.invoke('clipboard-history:clear-all'),
  readImage: (fn) => ipcRenderer.invoke('clipboard-history:read-image', fn),
  close: () => ipcRenderer.send('clipboard-history:close'),
});

contextBridge.exposeInMainWorld('roleAPI', {
  getCurrent: () => ipcRenderer.invoke('get-current-role'),
  onRoleChange: (cb) => ipcRenderer.on('role-key', (e, key) => cb(key)),
});

contextBridge.exposeInMainWorld('windowAPI', {
  getAlwaysOnTop: (key) => ipcRenderer.invoke('window:get-always-on-top', key),
  setAlwaysOnTop: (key, on) => ipcRenderer.invoke('window:set-always-on-top', key, on),
});

contextBridge.exposeInMainWorld('pwdConfirmAPI', {
  onShow: (cb) => ipcRenderer.on('pwd-confirm:show', (e, payload) => cb(payload)),
  close: () => ipcRenderer.send('pwd-confirm:close'),
  accept: (payload) => ipcRenderer.send('pwd-confirm:accept', payload),
});

contextBridge.exposeInMainWorld('stylesAPI', {
  load: (role) => ipcRenderer.invoke('styles:load', role),
});

contextBridge.exposeInMainWorld('diaryAPI', {
  read: (dateStr) => ipcRenderer.invoke('diary:read', dateStr),
  list: () => ipcRenderer.invoke('diary:list'),
  close: () => ipcRenderer.send('diary:close'),
  getWeather: () => ipcRenderer.invoke('diary:get-weather'),
});