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
    // Once nobody is asked any more, a bystander's stale press is just expired as before.
    const bob = message('bob', '', [{ type: 'action', data: { payload: token } }]);
    expect(await coordinator.dispatch(bob.msg)).toBe(true);
    expect(bob.reply).toHaveBeenCalledTimes(1);
  });
});
