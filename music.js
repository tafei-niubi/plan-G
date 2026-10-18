// G计划 —— 音乐模块（目录获取、歌名清洗、播放/曲库/导入 IPC）
const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');

function initMusicModule() {
  const musicDir = () => {
    // 固定读取桌面路径
    const dir = path.join(app.getPath('desktop'), 'G计划-音乐舱');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  function cleanSongName(filename) {
    let name = filename.replace(/\.mp3$/i, '');

    // 判断是否是 UUID 或纯哈希乱码（如 14a3b591-5558... 这种）
    const isUuid = /^[0-9a-fA-F-]{30,}$/.test(name) || /^[0-9a-zA-Z-]{25,}$/.test(name);

    if (isUuid) {
      // 用原文件名的前 4 位作为标识，避免完全一样
      return '神秘曲目-' + name.substring(0, 4).toUpperCase();
    }

    // 普通文件名：去除前缀数字、方括号等
    name = name
      .replace(/^[0-9]+[\s_-]+/, '') // 去除开头的数字序号
      .replace(/\[.*?\]|\(.*?\)|【.*?】/g, '') // 去除括号内容
      .replace(/[_-]/g, ' ') // 下划线换空格
      .replace(/\s+/g, ' ') // 连续空格合并
      .trim();

    return name || '未知曲目';
  }

  ipcMain.handle('music:import', (e, paths) => {
    try {
      if (!Array.isArray(paths)) return { ok: false, message: '无文件' };
      const dir = musicDir();
      let count = 0;
      for (const p of paths) {
        if (!fs.existsSync(p)) continue;
        const filename = path.basename(p);
        const dest = path.join(dir, filename);
        let finalDest = dest;
        let idx = 1;
        while (fs.existsSync(finalDest)) {
          const ext = path.extname(filename);
          const base = path.basename(filename, ext);
          finalDest = path.join(dir, base + '_' + idx + ext);
          idx++;
        }
        fs.copyFileSync(p, finalDest);
        count++;
      }
      return { ok: true, count };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });

  ipcMain.handle('music:play-random', async (e, keyword) => {
    try {
      const dir = musicDir();
      let files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.mp3'));
      console.log('[Music] 扫描到的文件列表:', files);

      if (!files.length) return { ok: false, message: '音乐舱是空的，拖几首歌进桌面文件夹吧' };

      // 关键词过滤
      if (keyword && keyword.trim() && keyword !== '热门推荐' && keyword !== '随便') {
        const kw = keyword.toLowerCase().replace(/\s+/g, '');
        const matched = files.filter(f => f.toLowerCase().replace(/\s+/g, '').includes(kw));
        if (matched.length) files = matched;
      }

      // 随机选一首
      const picked = files[Math.floor(Math.random() * files.length)];
      const filePath = path.join(dir, picked);

      // 核心：拼接 file:/// 路径。把 Windows 的 \ 换成 /，并转义空格
      let fileUrl = 'file:///' + filePath.replace(/\\/g, '/');
      // 处理路径中的中文或空格
      fileUrl = encodeURI(fileUrl);

      console.log('[Music] 返回播放路径:', fileUrl);
      return { ok: true, filename: picked, cleanName: cleanSongName(picked), fileUrl: fileUrl };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });

  ipcMain.handle('music:list', async () => {
    try {
      const dir = musicDir();
      const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.mp3'));
      // 返回清洗后的名字，同时保留原始文件名以便后续操作
      const cleanFiles = files.map(f => ({ original: f, display: cleanSongName(f) }));
      return { ok: true, files: cleanFiles };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });
}

module.exports = { initMusicModule };
