import { describe, expect, it, vi } from 'vitest';
import { RuntimeMessage, type SendContent, type Segment } from '../../src/plugin-runtime/im/contracts.js';
import { RuntimeInteractionCoordinator } from '../../src/plugin-runtime/im/interaction-runtime.js';

/**
 * zhinjs/zhin#1250: a prompt (confirmation, choice) belongs to the sender it was asked of. Someone else
 * answering it in a group is not told anything — neither by text (never taken) nor by pressing its
 * buttons (refused silently, recorded as `permission_denied`).
 */
const group = { endpoint: { id: 'endpoint', adapter: 'memory' }, kind: 'group' as const, id: 'room' };

function message(sender: string, content: string, segments?: readonly Segment[]) {
  const reply = vi.fn(async (_content: SendContent) => ({ status: 'sent' as const }));
  const outcomes: unknown[] = [];
  const sink = { report: (candidate: unknown) => { outcomes.push(candidate); return true; }, enter() {} };
  const msg = new RuntimeMessage(
    { conversation: group, content, sender: { id: sender }, metadata: {}, segments },
    { generation: 1, reply, outcomes: sink },
  );
  return { msg, reply, outcomes };
}

function actionToken(content: SendContent, index = 0): string {
  const keyboard = (content as Segment[]).find(segment => segment.type === 'keyboard')!;
  return (keyboard.data.rows as { payload: string }[][])[0]![index]!.payload;
}

async function askAlice() {
  const coordinator = new RuntimeInteractionCoordinator();
  const prompts: SendContent[] = [];
  const answer = coordinator.create({ conversation: group, generation: 1, sender: { id: 'alice' }, $reply: async content => {
    prompts.push(content);
    return { status: 'sent' };
  } }).ask({ type: 'confirm', title: '确认删除？' });
  await Promise.resolve();
  return { coordinator, answer, token: actionToken(prompts[0]!), prompts };
}

describe('a prompt answered by someone it was not asked of (#1250)', () => {
  it('stays silent when a bystander presses the prompt buttons in a group', async () => {
    const { coordinator, answer, token } = await askAlice();
    const bob = message('bob', '', [{ type: 'action', data: { payload: token } }]);
    expect(coordinator.resolveClaim(bob.msg)).toBe(false);
    expect(await coordinator.dispatch(bob.msg)).toBe(true);
    expect(bob.reply).not.toHaveBeenCalled();
    expect(bob.outcomes).toEqual([{ outcome: 'permission_denied', reason: 'interaction_not_own', stage: 'interaction', reply: 'no' }]);
    // The prompt is still alice's: her own press answers it.
    expect(coordinator.resolveClaim(message('alice', '', [{ type: 'action', data: { payload: token } }]).msg)).toBe(true);
    await expect(answer).resolves.toBe(true);
  });

  it('never takes nor answers a bystander typing an answer', async () => {
    const { coordinator, answer, token } = await askAlice();
    for (const text of ['1', '确认', '是']) {
      const bob = message('bob', text);
      expect(coordinator.resolveClaim(bob.msg)).toBe(false);
      expect(await coordinator.dispatch(bob.msg)).toBe(false);
      expect(bob.reply).not.toHaveBeenCalled();
    }
    expect(coordinator.resolveClaim(message('alice', '', [{ type: 'action', data: { payload: token } }]).msg)).toBe(true);
    await expect(answer).resolves.toBe(true);
  });

  it('still tells the asked sender that an old prompt expired', async () => {
    const { coordinator, answer, token } = await askAlice();
    expect(coordinator.resolveClaim(message('alice', '', [{ type: 'action', data: { payload: token } }]).msg)).toBe(true);
    await answer;
    const again = message('alice', '', [{ type: 'action', data: { payload: token } }]);
    expect(coordinator.resolveClaim(again.msg)).toBe(false);
    expect(await coordinator.dispatch(again.msg)).toBe(true);
    expect(again.reply).toHaveBeenCalledTimes(1);
    expect(String(again.reply.mock.calls[0]![0])).toContain('过期');
    // Changed in #1250 (batch 75 review): the ended prompt's buttons are still remembered as alice's
    // for a while, so a bystander pressing them in a group gets no "expired" reply (it could be
    // pressed again and again to flood the group). Before, this press was answered as expired.
    for (let press = 0; press < 3; press += 1) {
      const bob = message('bob', '', [{ type: 'action', data: { payload: token } }]);
      expect(await coordinator.dispatch(bob.msg)).toBe(true);
      expect(bob.reply).not.toHaveBeenCalled();
      expect(bob.outcomes).toEqual([{ outcome: 'permission_denied', reason: 'interaction_not_own', stage: 'interaction', reply: 'no' }]);
    }
  });

  it('remembers who an ended prompt was asked of for a limited time only', async () => {
    vi.useFakeTimers();
    try {
      const { coordinator, answer, token } = await askAlice();
      expect(coordinator.resolveClaim(message('alice', '', [{ type: 'action', data: { payload: token } }]).msg)).toBe(true);
      await answer;
      vi.advanceTimersByTime(9 * 60_000);
      const early = message('bob', '', [{ type: 'action', data: { payload: token } }]);
      expect(await coordinator.dispatch(early.msg)).toBe(true);
      expect(early.reply).not.toHaveBeenCalled();
      // After the record ends, the owner is unknown again: a stale press is just expired, as before.
      vi.advanceTimersByTime(2 * 60_000);
      const late = message('bob', '', [{ type: 'action', data: { payload: token } }]);
      expect(await coordinator.dispatch(late.msg)).toBe(true);
      expect(late.reply).toHaveBeenCalledTimes(1);
      expect(String(late.reply.mock.calls[0]![0])).toContain('过期');
    } finally { vi.useRealTimers(); }
  });

  it('keeps a bounded number of ended prompt records (oldest dropped first)', async () => {
    const coordinator = new RuntimeInteractionCoordinator();
    const tokens: string[] = [];
    const source = (sender: string) => ({ conversation: group, generation: 1, sender: { id: sender }, $reply: async (content: SendContent) => {
      tokens.push(actionToken(content));
      return { status: 'sent' as const };
    } });
    // Each confirm prompt has two actions: 300 ended prompts are 600 records, over the bound.
    for (let index = 0; index < 300; index += 1) {
      const asked = coordinator.create(source(`u${index}`)).ask({ type: 'confirm', title: '确认？' });
      await Promise.resolve();
      expect(coordinator.resolveClaim(message(`u${index}`, '', [{ type: 'action', data: { payload: tokens.at(-1)! } }]).msg)).toBe(true);
      await asked;
    }
    const oldest = message('bob', '', [{ type: 'action', data: { payload: tokens[0]! } }]);
    expect(await coordinator.dispatch(oldest.msg)).toBe(true);
    expect(oldest.reply).toHaveBeenCalledTimes(1);
    const newest = message('bob', '', [{ type: 'action', data: { payload: tokens.at(-1)! } }]);
    expect(await coordinator.dispatch(newest.msg)).toBe(true);
    expect(newest.reply).not.toHaveBeenCalled();
  });

  it('still answers a stale press in a private chat', async () => {
    const coordinator = new RuntimeInteractionCoordinator();
    const dm = { ...group, kind: 'private' as const, id: 'alice' };
    const prompts: SendContent[] = [];
    const asked = coordinator.create({ conversation: dm, generation: 1, sender: { id: 'alice' }, $reply: async content => {
      prompts.push(content); return { status: 'sent' };
    } }).ask({ type: 'confirm', title: '确认删除？' });
    await Promise.resolve();
    const token = actionToken(prompts[0]!);
    const press = (sender: string) => {
      const reply = vi.fn(async (_content: SendContent) => ({ status: 'sent' as const }));
      return { reply, msg: new RuntimeMessage({ conversation: dm, content: '', sender: { id: sender }, metadata: {},
        segments: [{ type: 'action', data: { payload: token } }] }, { generation: 1, reply }) };
    };
    expect(coordinator.resolveClaim(press('alice').msg)).toBe(true);
    await asked;
    const stale = press('mallory');
    expect(await coordinator.dispatch(stale.msg)).toBe(true);
    expect(stale.reply).toHaveBeenCalledTimes(1);
  });
});
