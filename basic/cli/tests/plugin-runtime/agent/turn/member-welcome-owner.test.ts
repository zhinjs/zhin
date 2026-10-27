// #1012 A9 方案②：插件旧欢迎经 memberWelcomeOwnerToken 询问归属；只读配置，不发送、不写审计。
import { describe, expect, it, vi } from 'vitest';
import { AiSessionOps, DecisionEventLog } from '@zhin.js/agent';
import type { ConversationRef } from '@zhin.js/im-contract';
import { MemberLifecycle } from '../../../../src/plugin-runtime/agent/turn/member-lifecycle.js';

const endpoint = Object.freeze({ id: 'root/qq\0zhin.adapter\0icqq~main', adapter: 'icqq' });
const group = Object.freeze({ endpoint, kind: 'group' as const, id: 'g1' }) as unknown as ConversationRef;

async function lifecycle(enabled?: boolean) {
  const ops = new AiSessionOps();
  if (enabled !== undefined) {
    await ops.set({ expectedRevision: 0, actorId: 'console', sessions: [{ platform: 'icqq', sceneId: 'group:g1', welcome: { enabled } }] });
  }
  const log = new DecisionEventLog();
  const send = vi.fn(async () => ({ status: 'sent' as const, messageId: 'out' }));
  const subject = new MemberLifecycle({ sessionOps: () => ops, sessions: () => undefined, reader: () => undefined, decisionEvents: () => log, send });
  return { subject, send, log };
}

describe('MemberLifecycle.ownsWelcome (A9 option 2)', () => {
  it('owns the welcome only when session-ops welcome.enabled is on for that group', async () => {
    expect((await lifecycle()).subject.ownsWelcome(group)).toBe(false);
    expect((await lifecycle(false)).subject.ownsWelcome(group)).toBe(false);
    const on = await lifecycle(true);
    expect(on.subject.ownsWelcome(group)).toBe(true);
    expect(on.subject.ownsWelcome({ ...group, id: 'g2' } as ConversationRef)).toBe(false);
    expect(on.subject.ownsWelcome({ ...group, kind: 'private' } as ConversationRef)).toBe(false);
  });

  it('is read-only: no send and no audit row', async () => {
    const on = await lifecycle(true);
    on.subject.ownsWelcome(group);
    await on.log.idle();
    expect(on.send).not.toHaveBeenCalled();
    expect(on.log.recent()).toEqual([]);
  });

  it('without session-ops nothing is owned, so plugins keep their own welcome', () => {
    const subject = new MemberLifecycle({ sessionOps: () => undefined, sessions: () => undefined, reader: () => undefined, send: vi.fn() });
    expect(subject.ownsWelcome(group)).toBe(false);
  });
});
