// G计划 —— 日记与天气模块（事件采集、天气获取、日记生成、开场/收尾）
const fs = require('fs');
const path = require('path');

function initDiaryModule(deps) {
  const {
    getWin, cfg, getClaude, saveConfig, currentRoleKey,
    enqueueBackgroundAi, safeCreate,
    eventsPath, diaryFileFor, todayDateStr, todayTimeStr,
    getWeatherCache, setWeatherCache,
  } = deps;

  // ---- 日记实时追加的去抖控制（同一标签隔 15/30/60 分钟才触发一次） ----
  const DEBOUNCE_MAP = {
    '长谈': 15 * 60 * 1000,
    '复制': 15 * 60 * 1000,
    '窗口': 30 * 60 * 1000,
    '警戒': 30 * 60 * 1000,
    '深夜': 60 * 60 * 1000,
    '查阅': 30 * 60 * 1000,
  };

  const lastDiaryTrigger = {
    '长谈': 0,
    '复制': 0,
    '窗口': 0,
    '警戒': 0,
    '深夜': 0,
    '查阅': 0,
  };

  function canTriggerDiary(tag) {
    const wait = DEBOUNCE_MAP[tag];
    if (!wait) return true;
    const now = Date.now();
    if (now - (lastDiaryTrigger[tag] || 0) < wait) return false;
    lastDiaryTrigger[tag] = now;
    return true;
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
    const cache = getWeatherCache();
    console.log('[天气] 启动刷新，consent=' + c.locationConsent + '，缓存的updatedAt=' + (cache.updatedAt || 0));
    // 若用户拒绝定位，直接跳过
    if (c.locationConsent !== true) return;

    // 若有缓存的坐标，直接用
    let lat = cache.lat;
    let lon = cache.lon;
    let city = cache.city;

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

    const newCache = {
      city: city,
      temp: w.temp,
      condition: w.condition,
      lat: lat,
      lon: lon,
      updatedAt: Date.now()
    };
    setWeatherCache(newCache);
    // 持久化到 config
    saveConfig(Object.assign({}, cfg(), { weatherCache: newCache }));
    console.log('[天气]', city, w.temp + '°C', w.condition);
  }

  // ---- 日记：实时追加（活记录，非事后总结） ----
  let diaryWriting = false;

  function appendDiaryEntry(tag, eventDesc, extra) {
    return enqueueBackgroundAi(async () => {
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
        const wc = getWeatherCache();
        if (wc && wc.city && wc.temp != null) {
          weatherHint = '\n\n【天气信息】' + wc.city + '，' + wc.condition + '，' + wc.temp + '℃';
        }
        const now = new Date();
        const hour = now.getHours();
        let timePhrase = '深夜';
        if (hour >= 5 && hour < 9) timePhrase = '清晨';
        else if (hour >= 9 && hour < 12) timePhrase = '上午';
        else if (hour >= 12 && hour < 14) timePhrase = '中午';
        else if (hour >= 14 && hour < 18) timePhrase = '下午';
        else if (hour >= 18 && hour < 22) timePhrase = '晚上';
        const timeHint = '\n\n【当前时间】' + timePhrase + '（约 ' + hour + ' 点）。'
          + '写开场白时，要让语气贴合这个时间点（凌晨说这么晚/晚上说晚安/上午说开工）。';

        const userPrompt = '刚发生的事件（标签：' + tag + '）' + tagHint + '：\n'
          + eventDesc + weatherHint + timeHint;

        const client = getClaude();
        const resp = await safeCreate(client, {
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
        const cap = getLine('舰长：') || '……';
        const md  = getLine('女仆：') || '……';
        const gd  = getLine('守卫：') || '……';
        if (!cap && !md && !gd) {
          console.log('[日记] 解析完全失败，跳过：', text.slice(0, 200));
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

        // 所有日记朗读（进队列，不抢）
        if (cfg().ttsEnabled !== false) {
          const roleKey = currentRoleKey();
          const roleText = roleKey === 'captain' ? cap : (roleKey === 'maid' ? md : gd);
          const win = getWin();
          if (roleText && win && !win.isDestroyed()) {
            // 延迟 6 秒，让角色开场白先播
            setTimeout(() => {
              const win2 = getWin();
              if (win2 && !win2.isDestroyed()) {
                win2.webContents.send('diary:speak', { role: roleKey, text: roleText });
              }
            }, 6000);
          }
        }

        console.log('[日记] 追加', tag);
      } catch (err) {
        console.log('[日记] 异常：', (err && err.message) || err);
      } finally {
        diaryWriting = false;
      }
      await new Promise(r => setTimeout(r, 500)); // 给并发一点喘息时间
    });
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

  async function triggerOpening() {
    // 结合当前时间
    const now = new Date();
    const hour = now.getHours();
    let period = '深夜';
    if (hour >= 5 && hour < 9) period = '清晨';
    else if (hour >= 9 && hour < 12) period = '上午';
    else if (hour >= 12 && hour < 14) period = '中午';
    else if (hour >= 14 && hour < 18) period = '下午';
    else if (hour >= 18 && hour < 22) period = '晚上';

    const pad2 = (n) => String(n).padStart(2, '0');
    const timeStr = pad2(hour) + ':' + pad2(now.getMinutes());

    await appendDiaryEntry('上线', '用户上线了（' + period + ' ' + timeStr + '）');
  }

  function appendClosing() {
    const f = diaryFileFor(todayDateStr());
    if (fs.existsSync(f)) {
      const content = fs.readFileSync(f, 'utf8');
      const lines = content.trim().split('\n');
      const lastLines = lines.slice(-10).join('\n');
      if (lastLines.includes('[下线]') || lastLines.includes('[收尾]')) return;
    }

    const now = new Date();
    const hour = now.getHours();
    let cap = '指挥官，期待下次指令。', md = '主人，早点回来哦。', gd = '长官，保持警戒。';

    if (hour >= 22 || hour < 5) {
      cap = '指挥官，系统待机。明天见。'; md = '主人晚安，好好休息~'; gd = '长官，夜间无事。';
    } else if (hour >= 11 && hour < 14) {
      cap = '指挥官，用餐愉快。'; md = '主人快去吃饭吧，别饿着~'; gd = '长官，离席期间我会盯紧。';
    }

    const t = todayTimeStr();
    const entry =
      t + '  [下线]    舰长：' + cap + '\n' +
      t + '  [下线]    女仆：' + md + '\n' +
      t + '  [下线]    守卫：' + gd + '\n\n';
    fs.appendFileSync(diaryFileFor(todayDateStr()), entry, 'utf8');
    // 兜底也要发声
    const currentWin = getWin();
    if (currentWin && !currentWin.isDestroyed()) {
      const role = currentRoleKey();
      const roleText = role === 'captain' ? cap : (role === 'maid' ? md : gd);
      currentWin.webContents.send('diary:speak', { role: role, text: roleText });
    }
    console.log('[日记] 追加 下线（兜底）');
  }

  async function appendClosingDynamic() {
    // 先查重：当天最后 10 行已有 [下线]/[收尾] 就跳过（防止双击退出写两次）
    const f = diaryFileFor(todayDateStr());
    if (fs.existsSync(f)) {
      const content = fs.readFileSync(f, 'utf8');
      const lines = content.trim().split('\n');
      const lastLines = lines.slice(-10).join('\n');
      if (lastLines.includes('[下线]') || lastLines.includes('[收尾]')) return;
    }

    try {
      const client = getClaude();
      const now = new Date();
      const hour = now.getHours();

      let period = '深夜';
      if (hour >= 5 && hour < 9) period = '清晨';
      else if (hour >= 9 && hour < 12) period = '上午';
      else if (hour >= 12 && hour < 14) period = '中午';
      else if (hour >= 14 && hour < 18) period = '下午';
      else if (hour >= 18 && hour < 22) period = '晚上';

      const prompt = '现在是' + period + '（' + hour + '点），用户关闭了软件。\n' +
        '请让舰长、女仆、守卫各说一句告别语。\n' +
        '如果是中午，可能是去吃饭；如果是下午，可能是去开会/下班；如果是深夜，才是晚安。\n' +
        '要求：贴合各自人设，简短（不超过15字），直接输出格式：\n' +
        '舰长：...\n女仆：...\n守卫：...';

      // 8 秒超时：AI 没回来就抛错，走固定兜底
      const resp = await Promise.race([
        safeCreate(client, {
          model: 'deepseek-v4-flash',
          max_tokens: 150,
          system: '你现在是 G计划 桌宠的三个角色，正在和用户暂别。',
          messages: [{ role: 'user', content: prompt }],
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('生成超时')), 8000)),
      ]);

      const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
      if (!text || !text.includes('舰长')) throw new Error('生成失败');

      const aiLines = text.split('\n').map(s => s.trim()).filter(Boolean);
      const getLine = (prefix) => {
        const l = aiLines.find(s => s.startsWith(prefix));
        return l ? l.replace(prefix, '').trim() : '';
      };
      const cap = getLine('舰长：') || '收到。';
      const md = getLine('女仆：') || '早点回来哦。';
      const gd = getLine('守卫：') || '安全。';

      const t = todayTimeStr();
      const entry =
        t + '  [下线]    舰长：' + cap + '\n' +
        t + '  [下线]    女仆：' + md + '\n' +
        t + '  [下线]    守卫：' + gd + '\n\n';
      fs.appendFileSync(diaryFileFor(todayDateStr()), entry, 'utf8');
      console.log('[日记] 追加 下线（AI）');

      const currentWin = getWin();
      if (currentWin && !currentWin.isDestroyed()) {
        const role = currentRoleKey();
        const roleText = role === 'captain' ? cap : (role === 'maid' ? md : gd);
        currentWin.webContents.send('diary:speak', { role: role, text: roleText });
      }
    } catch (err) {
      console.log('[日记] 下线生成失败，用固定兜底：', (err && err.message) || err);
      appendClosing();
    }
  }

  function tryClosingOnExit() {
    try {
      appendClosing();
    } catch (e) {
      console.log('[日记] 收尾失败：', (e && e.message) || e);
    }
  }

  // ---- 定时器 ----
  // 每 8 小时刷新一次天气
  setInterval(() => {
    refreshWeather().catch(e => {});
  }, 8 * 60 * 60 * 1000);

  // 深夜提醒：每 10 分钟检查一次
  setInterval(() => {
    const h = new Date().getHours();
    if (h >= 22 && canTriggerDiary('深夜')) {
      appendDiaryEntry('深夜', '用户深夜仍在电脑前工作').catch(()=>{});
    }
  }, 10 * 60 * 1000);

  return {
    recordEvent,
    appendDiaryEntry,
    canTriggerDiary,
    describeEventForDiary,
    refreshWeather,
    triggerOpening,
    appendClosing,
    tryClosingOnExit,
    appendClosingDynamic,
  };
}

module.exports = { initDiaryModule };
