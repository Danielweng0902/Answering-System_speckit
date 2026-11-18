import { generateKeyPairSync, createVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createServiceAccountTokenProvider,
  normalizePrivateKey,
  signServiceAccountJwt,
} from '../../src/infra/sheets/serviceAccountToken.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const EMAIL = 'quiz-bot@classroom.iam.gserviceaccount.com';
const NOW_MS = Date.parse('2026-11-17T09:00:00.000Z');

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(segment, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
}

describe('服務帳號取 token（006 US1）', () => {
  it('簽出的 JWT 內容正確，且簽章可以用公鑰驗證', () => {
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const jwt = signServiceAccountJwt(
      { clientEmail: EMAIL, privateKey: PEM },
      tokenUrl,
      Math.floor(NOW_MS / 1000),
    );
    const [header, claims, signature] = jwt.split('.');

    expect(decodeSegment(header!)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decodeSegment(claims!)).toEqual({
      iss: EMAIL,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: tokenUrl,
      iat: Math.floor(NOW_MS / 1000),
      exp: Math.floor(NOW_MS / 1000) + 3600,
    });

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header!}.${claims!}`);
    expect(verifier.verify(publicKey, signature!, 'base64url')).toBe(true);
  });

  it('環境變數裡的 \\n 會還原成真的換行', () => {
    expect(normalizePrivateKey('-----BEGIN-----\\nABC\\n-----END-----')).toBe(
      '-----BEGIN-----\nABC\n-----END-----',
    );
  });

  it('用 JWT bearer 換 token，並在到期前快取不再重複請求', async () => {
    const requests: { url: string; body: string }[] = [];
    let nowMs = NOW_MS;
    const provider = createServiceAccountTokenProvider({
      credentials: { clientEmail: EMAIL, privateKey: PEM },
      tokenUrl: 'https://oauth2.test/token',
      now: () => nowMs,
      fetchImpl: (async (url: string, init: RequestInit) => {
        requests.push({ url: String(url), body: String(init.body) });
        return new Response(JSON.stringify({ access_token: 'access-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as unknown as typeof fetch,
    });

    expect(await provider()).toBe('access-1');
    expect(await provider()).toBe('access-1');
    expect(requests).toHaveLength(1);

    const body = new URLSearchParams(requests[0]!.body);
    expect(body.get('grant_type')).toBe(
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
    );
    expect(body.get('assertion')?.split('.')).toHaveLength(3);

    // 過期前重新取得新 token。
    nowMs += 3600 * 1000;
    expect(await provider()).toBe('access-1');
    expect(requests).toHaveLength(2);
  });

  it('token 端點回應失敗時拋錯，不回傳空字串', async () => {
    const provider = createServiceAccountTokenProvider({
      credentials: { clientEmail: EMAIL, privateKey: PEM },
      tokenUrl: 'https://oauth2.test/token',
      now: () => NOW_MS,
      fetchImpl: (async () =>
        new Response('{}', { status: 401 })) as unknown as typeof fetch,
    });

    await expect(provider()).rejects.toThrow();
  });
});
