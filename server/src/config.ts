export type ServerConfig = {
  teacherPassword: string | undefined;
  port: number;
  /**
   * 綁定的 host；undefined 表示維持 Node 預設（所有介面，課堂的 LAN 存取需要）。
   * 2026-11-21 資安審計：服務預設對整個 LAN 開放，需要時可設成 127.0.0.1。
   */
  host: string | undefined;
  dataDir: string;
  /** 006：Google 服務帳號信箱；與私鑰同時存在才啟用線上寫回。 */
  googleServiceAccountEmail: string | undefined;
  /** 006：服務帳號 RSA 私鑰（PEM）；只放環境變數，不進版控。 */
  googleServiceAccountPrivateKey: string | undefined;
  /**
   * 進場請求的瞬間額度（每個來源）。
   *
   * 2026-11-21 資安審計 D2-3：`/api/student/join` 原本無任何節流，
   * 實測 1000 次 join 在 0.6 秒內全部成功。burst 必須容得下「整班學生
   * 在上課瞬間同時進場」（50 組班級、壓測工具的滿房情境都是 200 人），
   * 因此預設 600；持續灌水則由 perMinute 壓住。
   */
  joinRateLimitBurst: number;
  /** 進場請求的持續速率（每個來源每分鐘）；預設 30。0 = 不限制。 */
  joinRateLimitPerMinute: number;
  /**
   * 同時在線的 Socket.IO 連線數上限；0 = 不限制。
   *
   * 2026-11-21 資安審計 C3：連線數原本只受 OS 限制。課堂的合法規模是
   * 50 組 × 每組數人 ≈ 200–300 條連線（含老師端與投影），所以預設 500，
   * 有 1.6 倍餘裕；超過時新連線被拒（403），客戶端會自動退避重連。
   */
  maxConnections: number;
};

function parsePort(value: string | undefined): number {
  if (value === undefined || value === '') {
    return 3000;
  }
  const port = Number(value);
  if (!/^\d+$/.test(value) || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }
  return port;
}

/**
 * 解析非負整數的環境變數。
 *
 * 0 是有意義的值（例如 maxConnections=0 代表不限制），因此不能把 0 當成
 * 「未設定」；未設定時才用預設值。
 */
function parseCount(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value === '') {
    return fallback;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return Number(value);
}

/** Read deployment settings without emitting their values. */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  return {
    teacherPassword: env.TEACHER_PASSWORD,
    port: parsePort(env.PORT),
    host: env.HOST,
    dataDir: env.DATA_DIR || './data',
    googleServiceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL || undefined,
    googleServiceAccountPrivateKey:
      env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || undefined,
    joinRateLimitBurst: parseCount(
      env.JOIN_RATE_LIMIT_BURST,
      600,
      'JOIN_RATE_LIMIT_BURST',
    ),
    joinRateLimitPerMinute: parseCount(
      env.JOIN_RATE_LIMIT_PER_MINUTE,
      30,
      'JOIN_RATE_LIMIT_PER_MINUTE',
    ),
    maxConnections: parseCount(env.MAX_CONNECTIONS, 500, 'MAX_CONNECTIONS'),
  };
}
