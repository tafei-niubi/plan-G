const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const { URL } = require('url');

const HOST = 'tts-api.xfyun.cn';
const API_PATH = '/v2/tts';

const VOICE_MAP = {
  captain: { vcn: 'x4_lingbosong', speed: 53, pitch: 45 },
  maid:    { vcn: 'x4_lingxiaolu_en', speed: 58, pitch: 50 },
  guard:   { vcn: 'x4_qianxue', speed: 63, pitch: 40 },
};

let credentials = null;

function loadCredentials(credPath) {
  if (credentials) return credentials;
  try {
    const raw = fs.readFileSync(credPath, 'utf8');
    const c = JSON.parse(raw);
    if (!c.appid || !c.apikey || !c.apisecret) return null;
    credentials = c;
    return c;
  } catch (e) {
    return null;
  }
}

function buildAuthUrl(apikey, apisecret) {
  // 生成 RFC1123 格式日期
  const date = new Date().toUTCString();
  const signatureOrigin =
    'host: ' + HOST + '\n' +
    'date: ' + date + '\n' +
    'GET ' + API_PATH + ' HTTP/1.1';
  const signatureSha = crypto
    .createHmac('sha256', apisecret)
    .update(signatureOrigin)
    .digest('base64');
  const authorizationOrigin =
    'api_key="' + apikey + '", algorithm="hmac-sha256", ' +
    'headers="host date request-line", signature="' + signatureSha + '"';
  const authorization = Buffer.from(authorizationOrigin).toString('base64');
  const params = new URLSearchParams({
    authorization: authorization,
    date: date,
    host: HOST,
  });
  return 'wss://' + HOST + API_PATH + '?' + params.toString();
}

function synthesize(text, role, credPath) {
  return new Promise((resolve, reject) => {
    const creds = loadCredentials(credPath);
    if (!creds) {
      return reject(new Error('凭据文件缺失或格式错误'));
    }
    const voice = VOICE_MAP[role] || VOICE_MAP.captain;
    const url = buildAuthUrl(creds.apikey, creds.apisecret);

    const ws = new WebSocket(url);
    const chunks = [];
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch (e) {}
      reject(new Error('合成超时'));
    }, 15000);

    ws.on('open', () => {
      const textB64 = Buffer.from(text, 'utf8').toString('base64');
      const req = {
        common: { app_id: creds.appid },
        business: {
          aue: 'lame',
          sfl: 1,
          vcn: voice.vcn,
          speed: voice.speed,
          volume: 50,
          pitch: voice.pitch,
          tte: 'UTF8',
        },
        data: {
          status: 2,
          text: textB64,
        },
      };
      ws.send(JSON.stringify(req));
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        chunks.push(data);
        return;
      }
      let resp;
      try { resp = JSON.parse(data.toString()); } catch (e) { return; }
      if (resp.code !== 0) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { ws.close(); } catch (e) {}
        return reject(new Error('讯飞错误 code=' + resp.code + '：' + (resp.message || '')));
      }
      if (resp.data && resp.data.audio) {
        chunks.push(Buffer.from(resp.data.audio, 'base64'));
      }
      if (resp.data && resp.data.status === 2) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { ws.close(); } catch (e) {}
        const buf = Buffer.concat(chunks);
        if (!buf.length) return reject(new Error('未收到音频数据'));
        resolve(buf);
      }
    });

    ws.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error('WebSocket 错误：' + (err.message || err)));
    });

    ws.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (chunks.length) resolve(Buffer.concat(chunks));
      else reject(new Error('连接关闭但无数据'));
    });
  });
}

module.exports = { synthesize };
