import { describe, expect, it } from 'vitest';
import {
  MANAGEMENT_COMMAND_DENIED,
  rejectUnlessManagementOperator,
  resolveManagementCommandRoles,
} from '../../src/init/management-command-guard.js';

function fakeMessage(senderId: string, adapter = 'kook', bot = 'main') {
  return {
    $adapter: adapter,
    $bot: bot,
    $sender: { id: senderId },
    $channel: { type: 'private', id: senderId },
  } as any;
}

function fakeRoot(botMaster?: string, trusted: string[] = []) {
  return {
    inject(name: string) {
      if (name === 'kook') {
        return {
          bots: new Map([
            ['main', { $config: { master: botMaster, trusted } }],
          ]),
        };
      }
      return undefined;
    },
  } as any;
}

describe('management-command-guard', () => {
  it('master 可通过', () => {
    const msg = fakeMessage('1001');
    const root = fakeRoot('1001');
    expect(rejectUnlessManagementOperator(msg, root)).toBeNull();
    expect(resolveManagementCommandRoles(msg, root)).toContain('master');
  });

  it('trusted 可通过', () => {
    const msg = fakeMessage('2002');
    const root = fakeRoot('1001', ['2002']);
    expect(rejectUnlessManagementOperator(msg, root)).toBeNull();
  });

  it('普通 user 拒绝', () => {
    const msg = fakeMessage('9999');
    const root = fakeRoot('1001');
    expect(rejectUnlessManagementOperator(msg, root)).toBe(MANAGEMENT_COMMAND_DENIED);
  });

  it('全局 masters 配置生效', () => {
    const msg = fakeMessage('7777');
    const root = fakeRoot(undefined);
    expect(
      rejectUnlessManagementOperator(msg, root, { masters: ['7777'] }),
    ).toBeNull();
  });
});
