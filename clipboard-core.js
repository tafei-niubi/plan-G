// G计划 —— 剪贴板模块（历史记录、图片采集、敏感/密码检测、剪贴板历史 IPC）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, ipcMain, clipboard, nativeImage } = require('electron');

function initClipboardModule(deps) {
  const {
    cfg, snippetOf, shouldSkipPassword, openPwdConfirmWindow,
    recordEvent, canTriggerDiary, appendDiaryEntry, describeEventForDiary,
    getClipWin,
  } = deps;

  let lastClipboardText = '';
  let lastClipboardImageHash = '';
  let clipboardWatcher = null;

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
    const clipWin = getClipWin();
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

  return { startClipboardWatcher };
}

module.exports = { initClipboardModule };
