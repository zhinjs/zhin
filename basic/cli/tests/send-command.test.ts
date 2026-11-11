import { describe, expect, it } from 'vitest';
import { resolveSendTarget } from '../src/commands/send.js';

const rows = [
  { name: 'qq-offline', adapter: 'icqq', status: 'offline' as const },
  { name: 'qq-online', adapter: 'icqq', status: 'online' as const },
];

describe('resolveSendTarget', () => {
  it('defaults to the only configured adapter and its first online endpoint', () => {
    expect(resolveSendTarget(rows)).toEqual({ ok: true, adapter: 'icqq', endpoint: 'qq-online' });
  });

  it('requires --adapter when several adapters are configured', () => {
    const result = resolveSendTarget([...rows, { name: 'dc', adapter: 'discord', status: 'online' }]);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? '' : result.error).toContain('--adapter');
  });

  it('infers the adapter from an explicit endpoint', () => {
    expect(resolveSendTarget([...rows, { name: 'dc', adapter: 'discord', status: 'online' }], undefined, 'dc'))
      .toEqual({ ok: true, adapter: 'discord', endpoint: 'dc' });
  });

  it('falls back to an offline endpoint and reports a missing adapter', () => {
    expect(resolveSendTarget([rows[0]!], 'icqq')).toEqual({ ok: true, adapter: 'icqq', endpoint: 'qq-offline' });
    expect(resolveSendTarget(rows, 'process')).toMatchObject({ ok: false });
    expect(resolveSendTarget([])).toMatchObject({ ok: false });
  });
});
