export type ServerConfig = {
  teacherPassword: string | undefined;
  port: number;
  dataDir: string;
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
    dataDir: env.DATA_DIR || './data',
  };
}
