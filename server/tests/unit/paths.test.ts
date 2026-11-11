import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repositoryRoot, resolveFromRepositoryRoot } from '../../src/paths.js';

describe('repository-relative paths', () => {
  it('repositoryRoot 指向含根 package.json 與 .env.example 的目錄', () => {
    expect(existsSync(join(repositoryRoot, '.env.example'))).toBe(true);
    expect(existsSync(join(repositoryRoot, 'server', 'package.json'))).toBe(true);
  });

  it('相對路徑（例如 DATA_DIR=./data）以 repo 根目錄為基準，不受工作目錄影響', () => {
    expect(resolveFromRepositoryRoot('./data')).toBe(join(repositoryRoot, 'data'));
  });

  it('絕對路徑維持不變', () => {
    expect(resolveFromRepositoryRoot('/tmp/x')).toBe('/tmp/x');
  });
});
