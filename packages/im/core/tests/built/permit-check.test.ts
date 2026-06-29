import { describe, it, expect } from 'vitest';
import { checkBuiltinPermit, checkBuiltinPermitList } from '../../src/built/permit-check.js';
import { parsePermitName } from '../../src/built/permit-parse.js';

function mockMessage(overrides: {
  adapter?: string;
  channelType?: string;
  channelId?: string;
  senderId?: string;
} = {}) {
  return {
    $adapter: overrides.adapter ?? 'icqq',
    $endpoint: 'bot1',
    $sender: { id: overrides.senderId ?? 'u1' },
    $channel: {
      type: overrides.channelType ?? 'group',
      id: overrides.channelId ?? 'g1',
    },
  } as any;
}

describe('parsePermitName', () => {
  it('解析逗号 OR 列表', () => {
    expect(parsePermitName('adapter(icqq,qq)')).toEqual({
      kind: 'adapter',
      values: ['icqq', 'qq'],
    });
    expect(parsePermitName('role(master,trusted)')).toEqual({
      kind: 'role',
      values: ['master', 'trusted'],
    });
  });
});

describe('checkBuiltinPermit', () => {
  it('adapter OR 匹配', () => {
    const msg = mockMessage({ adapter: 'qq' });
    expect(checkBuiltinPermit('adapter(icqq,qq)', msg, ['user'])).toBe(true);
    expect(checkBuiltinPermit('adapter(icqq)', msg, ['user'])).toBe(false);
  });

  it('group(*) 通配', () => {
    const msg = mockMessage({ channelType: 'group', channelId: '123' });
    expect(checkBuiltinPermit('group(*)', msg, ['user'])).toBe(true);
    expect(checkBuiltinPermit('group(123)', msg, ['user'])).toBe(true);
    expect(checkBuiltinPermit('group(999)', msg, ['user'])).toBe(false);
  });

  it('role(master,trusted) OR 匹配', () => {
    const msg = mockMessage();
    expect(checkBuiltinPermit('role(master,trusted)', msg, ['user'])).toBe(false);
    expect(checkBuiltinPermit('role(master,trusted)', msg, ['trusted'])).toBe(true);
    expect(checkBuiltinPermit('role(master,trusted)', msg, ['master'])).toBe(true);
  });

  it('role OR + master 升格 trusted', () => {
    const msg = mockMessage();
    expect(checkBuiltinPermit('role(trusted)', msg, ['master'])).toBe(true);
    expect(checkBuiltinPermit('role(master)', msg, ['trusted'])).toBe(false);
    expect(checkBuiltinPermit('role(trusted)', msg, ['master'])).toBe(true);
  });

  it('user(id) 匹配发送者', () => {
    const msg = mockMessage({ senderId: '42' });
    expect(checkBuiltinPermit('user(42)', msg, ['user'])).toBe(true);
    expect(checkBuiltinPermit('user(99)', msg, ['user'])).toBe(false);
  });
});

describe('checkBuiltinPermitList', () => {
  it('链式 AND：全部 permit 必须通过', () => {
    const msg = mockMessage({ adapter: 'icqq', channelType: 'group' });
    expect(checkBuiltinPermitList(
      ['adapter(icqq)', 'group(*)'],
      msg,
      ['user'],
    )).toBe(true);
    expect(checkBuiltinPermitList(
      ['adapter(qq)', 'group(*)'],
      msg,
      ['user'],
    )).toBe(false);
  });
});
