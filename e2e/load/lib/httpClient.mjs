/**
 * 負載測試共用的 HTTP 發送器（只用 node:http，無第三方相依）。
 *
 * timedRequest 以單調時鐘（performance.now()）記錄每個請求的延遲，逾時採
 * 「整體 deadline」而非 socket 閒置時間：送出後 timeoutMs 內沒有完整收到
 * 回應就算逾時，並主動 destroy 請求。
 */
import { Buffer } from 'node:buffer';
import { request } from 'node:http';
import { performance } from 'node:perf_hooks';
import { clearTimeout, setTimeout } from 'node:timers';
import { URL } from 'node:url';

const MAX_BODY_BYTES = 1 << 20;

/**
 * 發送一次請求並記錄樣本。永遠 resolve（不 throw），結果包含：
 * - sample：{ scheduledAt, completedAt, status }，可直接交給 summarizeSamples。
 * - statusCode：HTTP 狀態碼；逾時或連線失敗時為 null。
 * - error：null | 'timeout' | 'network'。
 * - body：回應內容（最多 1 MiB），僅在非錯誤時保留。
 */
export function timedRequest({ url, method = 'GET', headers = {}, body, agent, timeoutMs = 5000 }) {
  return new Promise((resolve) => {
    const scheduledAt = performance.now();
    let settled = false;

    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      resolve(result);
    };

    const req = request(url, { method, headers, agent }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        if (size < MAX_BODY_BYTES) {
          chunks.push(chunk);
        }
        size += chunk.length;
      });
      response.on('end', () => {
        settle({
          sample: { scheduledAt, completedAt: performance.now(), status: 'ok' },
          statusCode: response.statusCode ?? null,
          error: null,
          body: Buffer.concat(chunks),
        });
      });
      response.on('error', () => {
        settle({
          sample: { scheduledAt, completedAt: performance.now(), status: 'ok' },
          statusCode: response.statusCode ?? null,
          error: 'network',
          body: null,
        });
      });
    });

    req.on('error', () => {
      // 逾時 destroy 引發的 error 會被 settled 旗標擋掉，不會重複結算。
      settle({
        sample: { scheduledAt, completedAt: performance.now(), status: 'ok' },
        statusCode: null,
        error: 'network',
        body: null,
      });
    });

    const deadline = setTimeout(() => {
      settle({
        sample: { scheduledAt, completedAt: null, status: 'timeout' },
        statusCode: null,
        error: 'timeout',
        body: null,
      });
      req.destroy();
    }, timeoutMs);

    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

const JSON_HEADERS = { 'content-type': 'application/json' };

/** 設定用（非量測）的 JSON 請求；失敗時 throw，錯誤訊息不含密碼或 token。 */
export async function requestJson({
  url,
  method = 'GET',
  payload,
  headers = {},
  timeoutMs = 8000,
  expectedStatus = 200,
}) {
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  const result = await timedRequest({
    url,
    method,
    headers: payload === undefined ? headers : { ...JSON_HEADERS, ...headers },
    body,
    agent: false,
    timeoutMs,
  });

  const path = new URL(url).pathname;
  if (result.error !== null) {
    throw new Error(
      `${method} ${path} 失敗（${result.error === 'timeout' ? '逾時' : '連線錯誤'}）`,
    );
  }
  if (result.statusCode !== expectedStatus) {
    throw new Error(`${method} ${path} 回應 ${result.statusCode}，預期 ${expectedStatus}`);
  }
  return JSON.parse((result.body ?? Buffer.alloc(0)).toString('utf8'));
}

export async function getJson(url, options = {}) {
  return requestJson({ url, method: 'GET', ...options });
}

export async function postJson(url, payload, options = {}) {
  return requestJson({ url, method: 'POST', payload, ...options });
}
