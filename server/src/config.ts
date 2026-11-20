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
  };
}
