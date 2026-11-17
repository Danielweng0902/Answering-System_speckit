/**
 * 服務帳號取 OAuth access token（006 US1）。
 *
 * 以服務帳號的 RSA 私鑰簽一個短效 JWT（RS256），向 Google 的 token 端點
 * 換取 access token，並在到期前快取重取。私鑰只從環境變數進來，永遠
 * 不寫進 log、不進資料庫（憲法原則 IV）。
 */
import { createSign } from 'node:crypto';

const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_LIFETIME_SECONDS = 3600;
/** 到期前多少秒就重新換，避免用到剛好過期的 token。 */
const REFRESH_MARGIN_SECONDS = 60;

export type ServiceAccountCredentials = {
  /** 服務帳號信箱，例如 `name@project.iam.gserviceaccount.com`。 */
  clientEmail: string;
  /** PEM 私鑰；環境變數裡的 `\n` 要先還原成真的換行。 */
  privateKey: string;
};

export type ServiceAccountTokenProviderOptions = {
  credentials: ServiceAccountCredentials;
  fetchImpl?: typeof fetch | undefined;
  tokenUrl?: string | undefined;
  now?: (() => number) | undefined;
  timeoutMs?: number | undefined;
};

export type AccessTokenProvider = () => Promise<string>;

function base64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** 環境變數常見的是換行被寫成 `\n`，這裡還原成真的換行。 */
export function normalizePrivateKey(privateKey: string): string {
  return privateKey.replace(/\\n/g, '\n');
}

/** 簽出 JWT；簽名本身不外洩，只交給 token 端點。 */
export function signServiceAccountJwt(
  credentials: ServiceAccountCredentials,
  tokenUrl: string,
  nowSeconds: number,
): string {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(
    JSON.stringify({
      iss: credentials.clientEmail,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: tokenUrl,
      iat: nowSeconds,
      exp: nowSeconds + TOKEN_LIFETIME_SECONDS,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const signature = createSign('RSA-SHA256')
    .update(unsigned)
    .sign(normalizePrivateKey(credentials.privateKey), 'base64url');
  return `${unsigned}.${signature}`;
}

/** 建立會快取 token 的存取權杖提供者。 */
export function createServiceAccountTokenProvider(
  options: ServiceAccountTokenProviderOptions,
): AccessTokenProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenUrl = options.tokenUrl ?? DEFAULT_TOKEN_URL;
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.timeoutMs ?? 10_000;

  let cached: { token: string; expiresAt: number } | null = null;

  return async function accessToken(): Promise<string> {
    const nowMs = now();
    if (cached !== null && cached.expiresAt - REFRESH_MARGIN_SECONDS > nowMs) {
      return cached.token;
    }

    const assertion = signServiceAccountJwt(
      options.credentials,
      tokenUrl,
      Math.floor(nowMs / 1000),
    );
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);

    try {
      const response = await fetchImpl(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }).toString(),
        signal: abortController.signal,
      });
      if (!response.ok) {
        throw new Error('Service account token request failed');
      }
      const payload = (await response.json()) as { access_token?: unknown };
      if (typeof payload.access_token !== 'string' || payload.access_token === '') {
        throw new Error('Service account token response is invalid');
      }
      cached = {
        token: payload.access_token,
        expiresAt: nowMs + TOKEN_LIFETIME_SECONDS * 1000,
      };
      return cached.token;
    } finally {
      clearTimeout(timeout);
    }
  };
}
