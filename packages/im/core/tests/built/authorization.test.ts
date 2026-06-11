import { describe, it, expect } from 'vitest';
import { resolveSubjectRoles } from '../../src/built/authorization.js';
import { mergeAITriggerConfig, resolveSenderRoles } from '../../src/built/ai-trigger.js';

function mockMessage(senderId: string, permissions: string[] = []) {
  return {
    $adapter: 'icqq',
    $endpoint: '8596238',
    $sender: { id: senderId, permissions },
    $channel: { type: 'group', id: 'g1' },
  } as any;
}

function mockPlugin(config: { ai?: { trigger?: { masters?: string[]; trusted?: string[] } }; endpoints?: Array<{ context: string; name: string; master?: number; trusted?: number[] }> }) {
  return {
    root: {
      inject: (name: string) => {
        if (name === 'config') {
          return { getPrimary: () => config };
        }
        if (name === 'ai') {
          return { getTriggerConfig: () => config.ai?.trigger ?? {} };
        }
        return undefined;
      },
    },
  } as any;
}

describe('resolveSubjectRoles', () => {
  it('从 yaml endpoints[] 匹配 master', () => {
    const plugin = mockPlugin({
      endpoints: [{ context: 'icqq', name: '8596238', master: 1659488338 }],
    });
    const result = resolveSubjectRoles(plugin, mockMessage('1659488338'));
    expect(result.roles).toContain('master');
  });

  it('与 resolveSenderRoles 在相同输入下一致', () => {
    const plugin = mockPlugin({
      ai: { trigger: { trusted: ['t1'] } },
      endpoints: [{ context: 'icqq', name: '8596238', trusted: [999] }],
    });
    const message = mockMessage('t1');
    const fromAuth = resolveSubjectRoles(plugin, message);
    const fromDirect = resolveSenderRoles(
      message,
      mergeAITriggerConfig({ trusted: ['t1'] }),
      { trusted: [999] },
    );
    expect(fromAuth.roles).toEqual(fromDirect.roles);
    expect(fromAuth.scope).toBe(fromDirect.scope);
  });
});
