/**
 * #1250 doctor: leftover service files of older scaffolds, and who holds the HTTP port.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectIdentity } from '@zhin.js/gateway/project';
import {
  describePortOwner,
  findLegacyServiceFiles,
  legacyServiceFilesCheck,
  probePortHealth,
} from '../../src/utils/doctor-project-checks.js';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-doctor-checks-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('legacy service files', () => {
  it('lists Zhin service files in the project root without touching them', () => {
    for (const [name, text] of [
      ['bot.service', 'ExecStart=npx zhin start'],
      ['com.zhinjs.bot.plist', '<string>zhin</string>'],
      ['install-service.ps1', 'nssm install bot npx zhin start'],
      ['bot-task.xml', '<Description>Zhin.js Endpoint</Description>'],
      ['ecosystem.config.cjs', "script: 'node_modules/.bin/zhin'"],
      ['other.service', 'ExecStart=/usr/bin/nginx'],
    ]) fs.writeFileSync(path.join(root, name!), text!);
    const files = findLegacyServiceFiles(root);
    expect(files).toEqual({ service: ['bot-task.xml', 'bot.service', 'com.zhinjs.bot.plist', 'install-service.ps1'], pm2: ['ecosystem.config.cjs'] });
    const check = legacyServiceFilesCheck(files)!;
    expect(check.status).toBe('info');
    expect(check.message).toContain('zhin service install');
    expect(check.message).toContain('只在用 PM2 托管时需要');
    expect(fs.existsSync(path.join(root, 'bot.service'))).toBe(true);
    expect(legacyServiceFilesCheck(findLegacyServiceFiles(path.join(root, 'none')))).toBeUndefined();
  });
});

describe('port owner', () => {
  const health = (body: unknown) => vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify(body)));
  const gatewayBody = (id?: string) => ({ success: true, status: 'ok', timestamp: 'now', instance: { state: 'running', ready: true }, ...(id ? { project: { id } } : {}) });

  it('sends only an unauthenticated GET to /pub/health', async () => {
    const fetchImpl = health(gatewayBody('x'));
    await probePortHealth('http://127.0.0.1:8068', fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8068/pub/health');
    expect(init.headers).toBeUndefined();
    expect(init.credentials).toBe('omit');
  });

  it('names the other project whose gateway holds the port', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-other-project-'));
    try {
      const check = await describePortOwner(8068, root, {
        fetch: health(gatewayBody(projectIdentity(other))) as unknown as typeof fetch,
        pids: async () => [111, 222],
        cwdOf: async (pid) => (pid === 222 ? other : '/somewhere'),
      });
      expect(check.message).toBe(`已被另一个项目的 Zhin 网关占用：${other}（pid 222）`);
      expect(check.fix).toContain(`在 ${other} 运行 zhin stop`);
    } finally { fs.rmSync(other, { recursive: true, force: true }); }
  });

  it('tells this project, unknown projects, plain instances and other programs apart', async () => {
    const as = (body: unknown) => ({ fetch: health(body) as unknown as typeof fetch, pids: async () => [], cwdOf: async () => undefined });
    expect((await describePortOwner(1, root, as(gatewayBody(projectIdentity(root))))).message).toContain('本项目的另一个网关');
    expect((await describePortOwner(1, root, as(gatewayBody('f'.repeat(32))))).message).toBe('已被另一个项目的 Zhin 网关占用（无法确定是哪个项目）');
    expect((await describePortOwner(1, root, as(gatewayBody()))).message).toContain('旧版，未报告项目标识');
    expect((await describePortOwner(1, root, as({ success: true, status: 'ok', timestamp: 'now' }))).message).toContain('Zhin 实例');
    const refused = { fetch: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch };
    expect((await describePortOwner(1, root, refused)).message).toContain('不是 Zhin 网关');
  });
});
