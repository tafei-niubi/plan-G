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
  onSystemStatusChanged: (cb) => ipcRenderer.on('system:status-changed', (e, s) => cb(s)),
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