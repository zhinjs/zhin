import { describe, expect, it } from 'vitest';
import type { LocalGatewayInfoResult } from '@zhin.js/gateway/local';
import { consoleSetupToken, renderStatus } from '../src/utils/gateway.js';

function status(consoleInitialized: boolean): LocalGatewayInfoResult {
  return {
    gateway: {
      pid: 42, ports: [8068], origins: ['http://127.0.0.1:8068'], socket: '/p/.zhin/gateway.sock',
      startedAt: 0, version: '1.0.0', mode: 'daemon', args: ['--mode', 'production'],
    },
    instance: { state: 'running' } as LocalGatewayInfoResult['instance'],
    consoleInitialized,
  };
}

describe('Console setup link after zhin start (#1250 start-bg-no-setup-link)', () => {
  it('prints one link carrying the bootstrap token before the first owner exists', () => {
    const lines = renderStatus(status(false), 0, { setupToken: 'boot+strap' });
    expect(lines).toContain('  Console 尚未初始化，打开此链接完成初始化：https://console.zhin.dev/?apiBaseUrl=http%3A%2F%2F127.0.0.1%3A8068#token=boot%2Bstrap');
    const consoleLinks = lines.flatMap((line) => line.match(/https:\/\/\S+/gu) ?? [])
      .filter((href) => new URL(href).origin === 'https://console.zhin.dev');
    expect(consoleLinks).toHaveLength(1);
    expect(lines.join('\n')).not.toContain('HTTP_TOKEN');
  });

  it('falls back to the login hint without a token, and to the plain link once initialised', () => {
    const pending = renderStatus(status(false), 0);
    expect(pending).toContain('  Console：https://console.zhin.dev/?apiBaseUrl=http%3A%2F%2F127.0.0.1%3A8068');
    expect(pending.join('\n')).toContain('.env 的 HTTP_TOKEN');
    const done = renderStatus(status(true), 0, { setupToken: 'ignored' });
    expect(done.join('\n')).not.toMatch(/#token=|尚未初始化/u);
  });

  it('reads the token only for an interactive terminal and an uninitialised Console', async () => {
    const reads: string[] = [];
    const readToken = async (_root: string, environment: string) => { reads.push(environment); return 'secret'; };
    expect(await consoleSetupToken('/p', status(false), 'production', { interactive: true, readToken })).toBe('secret');
    expect(reads).toEqual(['production']);
    expect(await consoleSetupToken('/p', status(false), 'production', { interactive: false, readToken })).toBeUndefined();
    expect(await consoleSetupToken('/p', status(true), 'production', { interactive: true, readToken })).toBeUndefined();
    expect(await consoleSetupToken('/p', status(false), 'production', { interactive: true, readToken: async () => { throw new Error('bad config'); } })).toBeUndefined();
    expect(await consoleSetupToken('/p', status(false), 'production', { interactive: true, readToken: async () => '  ' })).toBeUndefined();
  });
});
