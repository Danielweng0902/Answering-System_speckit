import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Repository root. Both `server/src/paths.ts` (tsx, tests) and
 * `server/dist/paths.js` (npm start) are two levels below it.
 * `npm start` runs with `server/` as the working directory, so `.env` and a
 * relative DATA_DIR must be resolved from here, not from `process.cwd()`.
 */
export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(
  /[\\/]$/,
  '',
);

export function resolveFromRepositoryRoot(path: string): string {
  return isAbsolute(path) ? path : resolve(repositoryRoot, path);
}
