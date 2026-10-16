const fs = require('fs');
const crypto = require('crypto');
const WebSocket = require('ws');

const HOST = 'iat-api.xfyun.cn';
const API_PATH = '/v2/iat';

function buildAuthUrl(apikey, apisecret) {
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

class XfyunIatSession {
  constructor(credPath, onResult, onError, onEnd) {
    this.onResult = onResult;
    this.onError = onError;
    this.onEnd = onEnd;

    this.creds = null;
    try {
      const raw = fs.readFileSync(credPath, 'utf8');
      const c = JSON.parse(raw);
      if (c.appid && c.apikey && c.apisecret) this.creds = c;
    } catch (e) {}

    this.ws = null;
    this.settled = false;
    this.started = false;
    this.partialText = '';
  }

  start() {
    if (!this.creds) {
      if (this.onError) this.onError(new Error('凭据文件缺失或格式错误'));
      return;
    }
    const url = buildAuthUrl(this.creds.apikey, this.creds.apisecret);
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {});

    this.ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let resp;
      try { resp = JSON.parse(data.toString()); } catch (e) { return; }
      if (resp.code !== 0) {
        this._fail(new Error('讯飞错误 code=' + resp.code + '：' + (resp.message || '')));
        return;
      }
      this._handleResult(resp);
    });

    this.ws.on('error', (err) => {
      this._fail(new Error('WebSocket 错误：' + (err.message || err)));
    });

    this.ws.on('close', () => {
      if (!this.settled) this._end();
    });
  }

  sendAudio(pcmBuffer, isLast) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.settled) return;
    let status = 1;
    let first = false;
    if (!this.started) { status = 0; this.started = true; first = true; }
    if (isLast) status = 2;

    const audio = pcmBuffer ? pcmBuffer.toString('base64') : '';

    const frame = {
      data: {
        status: status,
        format: 'audio/L16;rate=16000',
        encoding: 'raw',
        audio: audio,
      },
    };
    if (first) {
      frame.common = { app_id: this.creds.appid };
      frame.business = {
        language: 'zh_cn',
        domain: 'iat',
        accent: 'mandarin',
        vad_eos: 2000,
        dwa: '',
      };
    }
    this.ws.send(JSON.stringify(frame));
  }

  _handleResult(resp) {
    if (!resp || !resp.data) return;
    const data = resp.data;
    const ws = data.result && data.result.ws;
    if (!ws) {
      if (data.status === 2) this._end();
      return;
    }

    // 直接拼接当前片段的最佳候选字（只取 cw[0]，不取备选字，避免重复）
    let text = '';
    ws.forEach(w => {
      if (w.cw && w.cw[0] && w.cw[0].w) text += w.cw[0].w;
    });
    if (!text) {
      if (data.status === 2) this._end();
      return;
    }

    // 保留原有的累积逻辑：每次追加到 this.partialText
    this.partialText = (this.partialText || '') + text;

    if (this.onResult) this.onResult(this.partialText, data.status === 2);

    if (data.status === 2) {
      this._end();
    }
  }

  _end() {
    if (this.settled) return;
    this.settled = true;
    if (this.onEnd) this.onEnd();
    this.close();
  }

  _fail(err) {
    if (this.settled) return;
    this.settled = true;
    if (this.onError) this.onError(err);
    this.close();
  }

  close() {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close();
    } catch (e) {}
    this.ws = null;
  }
}

module.exports = { XfyunIatSession };
