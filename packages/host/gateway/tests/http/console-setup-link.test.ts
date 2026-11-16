import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { consoleSetupLink } from '../../src/http/run-gateway.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function project(config: string, env = ''): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-setup-link-'));
  dirs.push(root);
  await writeFile(join(root, 'zhin.config.yml'), config);
  if (env) await writeFile(join(root, '.env'), env);
  return root;
}

describe('consoleSetupLink (#1250 start-bg-no-setup-link)', () => {
  it('puts the resolved bootstrap token after # in the Console link', async () => {
    const root = await project('configVersion: 2\nplugins: {}\nhttp:\n  token: ${HTTP_TOKEN}\n  port: 8068\n', 'HTTP_TOKEN=boot+strap/1\n');
    const link = await consoleSetupLink(root, 'http://127.0.0.1:8068', 'development');
    expect(link).toBe('https://console.zhin.dev/?apiBaseUrl=http%3A%2F%2F127.0.0.1%3A8068#token=boot%2Bstrap%2F1');
  });

  it('is undefined without a bootstrap token', async () => {
    const root = await project('configVersion: 2\nplugins: {}\nhttp:\n  port: 8068\n');
    expect(await consoleSetupLink(root, 'http://127.0.0.1:8068', 'development')).toBeUndefined();
  });
});
