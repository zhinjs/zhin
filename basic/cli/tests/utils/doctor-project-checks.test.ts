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
  probeOrigin,
  probePortHealth,
} from '../../src/utils/doctor-project-checks.js';
import { legacyServiceFileNames, serviceProjectNameOf } from '../../src/utils/service-definition.js';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-doctor-checks-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('legacy service files', () => {
  const write = (name: string, text = 'x') => fs.writeFileSync(path.join(root, name), text);

  it('lists only the file names older scaffolds wrote, without touching them', () => {
    write('package.json', JSON.stringify({ name: 'bot' }));
    for (const name of ['bot.service', 'com.zhinjs.bot.plist', 'install-service.ps1', 'bot-task.xml', 'ecosystem.config.cjs']) write(name);
    // Same suffixes, other names: not the scaffold's, even when they mention zhin.
    write('other.service', 'ExecStart=npx zhin start');
    write('com.example.zhin.plist', '<string>zhin</string>');
    const files = findLegacyServiceFiles(root);
    expect(files).toEqual({ service: ['bot-task.xml', 'bot.service', 'com.zhinjs.bot.plist', 'install-service.ps1'], pm2: ['ecosystem.config.cjs'] });
    const check = legacyServiceFilesCheck(files)!;
    expect(check.status).toBe('info');
    expect(check.message).toContain('zhin service install');
    expect(check.message).toContain('PM2 配置');
    expect(fs.existsSync(path.join(root, 'bot.service'))).toBe(true);
    expect(legacyServiceFilesCheck(findLegacyServiceFiles(path.join(root, 'none')))).toBeUndefined();
  });

  it('uses the same names as zhin service install (scope removed)', () => {
    write('package.json', JSON.stringify({ name: '@acme/bot' }));
    const names = legacyServiceFileNames(serviceProjectNameOf('@acme/bot'));
    expect(names).toEqual(['bot.service', 'com.zhinjs.bot.plist', 'install-service.ps1', 'bot-task.xml']);
    for (const name of names) write(name);
    expect(findLegacyServiceFiles(root).service).toEqual([...names].sort());
    expect(serviceProjectNameOf('bad name')).toBeUndefined();
    expect(legacyServiceFileNames(undefined)).toEqual(['install-service.ps1']);
  });

  it('leaves ecosystem.config.* alone while the project uses PM2', () => {
    write('ecosystem.config.cjs');
    write('package.json', JSON.stringify({ name: 'bot', devDependencies: { pm2: '^6.0.0' } }));
    expect(findLegacyServiceFiles(root).pm2).toEqual([]);
    write('package.json', JSON.stringify({ name: 'bot', scripts: { 'pm2:start': 'pm2 start ecosystem.config.cjs' } }));
    expect(findLegacyServiceFiles(root).pm2).toEqual([]);
    write('package.json', JSON.stringify({ name: 'bot' }));
    expect(findLegacyServiceFiles(root).pm2).toEqual(['ecosystem.config.cjs']);
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
    expect((await describePortOwner(1, root, as('<html>nginx</html>'))).message).toContain('不是 Zhin 网关');
    // Refused, a self-signed certificate, a timeout: nothing is known about the occupant.
    const refused = { fetch: (async () => { throw new TypeError('fetch failed', { cause: new Error('self-signed certificate') }); }) as unknown as typeof fetch };
    const unknown = await describePortOwner(1, root, { ...refused, tls: true });
    expect(unknown.message).toContain('无法确认占用者');
    expect(unknown.message).toContain('https://127.0.0.1:1/pub/health');
    expect(unknown.message).not.toContain('不是 Zhin 网关');
  });

  it('probes the configured host, with wildcards on loopback', () => {
    expect(probeOrigin(8068)).toBe('http://127.0.0.1:8068');
    expect(probeOrigin(8068, { host: '0.0.0.0', tls: true })).toBe('https://127.0.0.1:8068');
    expect(probeOrigin(8068, { host: '::' })).toBe('http://[::1]:8068');
    expect(probeOrigin(8068, { host: '[::]' })).toBe('http://[::1]:8068');
    expect(probeOrigin(8068, { host: '192.168.1.5' })).toBe('http://192.168.1.5:8068');
    expect(probeOrigin(8068, { host: 'fe80::1' })).toBe('http://[fe80::1]:8068');
  });
});
