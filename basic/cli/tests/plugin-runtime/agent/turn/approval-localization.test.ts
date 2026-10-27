import { RuntimeInteractionCoordinator } from '../../../../../../packages/im/core/src/plugin-runtime/im/interaction-runtime.js';
import { createRuntimeApprovalPort } from '../../../../src/plugin-runtime/agent/turn/request.js';
import type { Locale } from '@zhin.js/plugin-runtime';
import { parseUserInteractionAnswer, projectUserInteraction, renderUserInteraction } from '../../../../../../packages/im/core/src/built/user-interaction.js';
import { resolveKeyboardSegments } from '../../../../../../packages/im/core/src/built/interactive-segments/resolve.js';

it.each(['zh-CN', 'en'] as const)('renders approval options once on text-only platforms (%s)', async locale => {
  let rendered = '';
  const port = createRuntimeApprovalPort({ isMaster: false, locale, interaction: {
    async ask(request) {
      const payload = resolveKeyboardSegments(renderUserInteraction(projectUserInteraction(request, undefined, locale), undefined, locale), 'text');
      rendered = JSON.stringify(payload);
      if (request.type !== 'select') throw new Error('Expected a choice');
      expect(request.options.map(option => option.value)).toEqual(['reject', 'approve-once', 'approve-session', 'approve-always']);
      for (const option of request.options) {
        expect(rendered.split(option.label).length - 1).toBe(1);
      }
      expect(parseUserInteractionAnswer(request, locale === 'en' ? 'Always allow' : '始终允许', locale))
        .toEqual({ ok: true, value: 'approve-always' });
      expect(parseUserInteractionAnswer(request, '3', locale)).toEqual({ ok: true, value: 'approve-session' });
      return 'approve-once' as never;
    },
    async sequence() { return {} as never; },
  } });
  expect(await port.requestApprovalOutcome({ requestId: 'compact', conversationScope: 'group', question: '修改群设置\n群：100', timeoutMs: 1000 }))
    .toMatchObject({ status: 'approved', decision: 'approve-once' });
  expect(rendered).toContain(locale === 'en' ? 'everyone' : '所有人');
  expect(rendered).toContain(locale === 'en' ? 'this conversation and sender' : '本会话、仅此人');
  expect(rendered).toContain('群：100');
});

it('pins approval language across replies and isolates concurrent senders and endpoints', async () => {
  const coordinator = new RuntimeInteractionCoordinator();
  function flow(locale: Locale, senderId: string) {
    const conversation = { endpoint: { adapter: 'fixture', id: 'bot' }, kind: 'group' as const, id: 'room', threadId: 'topic' };
    const prompts: unknown[] = [];
    const source = { locale, conversation, generation: 1, sender: { id: senderId }, $reply: async (content: unknown) => {
      prompts.push(content);
      return { status: 'sent' as const };
    } };
    const port = createRuntimeApprovalPort({ isMaster: false, locale, interaction: coordinator.create(source) });
    let settled = false;
    const outcome = port.requestApprovalOutcome({ requestId: senderId, question: '用户原文 / custom question', humanOnly: true, timeoutMs: 1000 })
      .then(value => { settled = true; return value; });
    return { source, prompts, outcome, settled: () => settled };
  }
  const en = flow('en', 'alice');
  const zh = flow('zh-CN', 'bob');
  await vi.waitFor(() => expect(en.prompts).toHaveLength(1));
  expect(JSON.stringify(en.prompts[0])).toContain('Confirm operation');
  expect(JSON.stringify(en.prompts[0])).not.toContain('操作确认');
  expect(JSON.stringify(zh.prompts[0])).toContain('操作确认');
  expect(JSON.stringify(en.prompts[0])).toContain('用户原文 / custom question');
  const answer = (source: typeof en.source, content: string) => ({ ...source, content, segments: [] }) as never;
  expect(coordinator.resolveClaim(answer({ ...en.source, conversation: { ...en.source.conversation, endpoint: { adapter: 'fixture', id: 'other' } } }, 'yes'))).toBe(false);
  expect(coordinator.resolveClaim(answer({ ...en.source, conversation: { ...en.source.conversation, threadId: 'other' } }, 'yes'))).toBe(false);
  expect(coordinator.resolveClaim(answer(en.source, '同意'))).toBe(true);
  expect(coordinator.resolveClaim(answer(zh.source, 'yes'))).toBe(true);
  await vi.waitFor(() => {
    expect(en.prompts).toHaveLength(2);
    expect(zh.prompts).toHaveLength(2);
  });
  expect(en.settled()).toBe(false);
  expect(zh.settled()).toBe(false);
  // A later message's preference cannot change a pending flow's accepted input.
  expect(coordinator.resolveClaim(answer({ ...en.source, locale: 'zh-CN' }, 'yes'))).toBe(true);
  expect(coordinator.resolveClaim(answer({ ...zh.source, locale: 'en' }, '拒绝'))).toBe(true);
  await expect(en.outcome).resolves.toMatchObject({ status: 'approved' });
  await expect(zh.outcome).resolves.toMatchObject({ status: 'denied', by: 'user' });
  expect(coordinator.resolveClaim(answer(en.source, 'yes'))).toBe(false);
});
