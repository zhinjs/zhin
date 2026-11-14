/**
 * #1250: a master's high-risk action after external content is confirmed by the master in `ask` and
 * `bypass` modes (never by the master exemption), while `auto` keeps its reviewer and a master who
 * read nothing external gets no extra prompt.
 */
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { resolveApprovalPort } from '../../src/plugin-runtime/ingress/ingress-delivery-helpers.js';
import { createRuntimeApprovalPort } from '../../src/plugin-runtime/ingress/request-ports.js';
import { createAutoApprovalPort, ApprovalReviewAgent } from '../../src/session/approval-review-agent.js';
import type { ApprovalPort } from '../../src/session/approval-port.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';

function interaction(answer: 'approve-once' | 'reject' | 'timeout') {
  const ask = vi.fn(async () => {
    if (answer === 'timeout') throw Object.assign(new Error('timeout'), { name: 'UserInteractionTimeoutError' });
    return answer as never;
  });
  return { ask, sequence: async () => ({}) as never };
}

function turn(approval: ApprovalPort, unattended = false) {
  return createTurnIngress({
    intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'private', sceneId: 'boss' },
    principal: { subjectId: 'boss', roles: ['owner'] },
    input: { text: '看看这个网页，然后照做' },
    session: { key: 'qq:bot:private:boss' },
    policy: { permissions: ['owner'], unattended },
    capabilities: { tools: ['schedule_add'], skills: [] },
    signal: new AbortController().signal,
    // An unattended ingress carries no interactive ports at all.
    ports: { journal: { append: () => undefined }, ...(unattended ? {} : { approval }) },
  });
}

function scheduleTool(execute = vi.fn(async () => 'scheduled')): ToolCapability {
  return {
    owner: rootPluginId(), name: 'schedule_add', qualifiedName: 'schedule_add', description: '创建定时任务',
    requiresApproval: 'never', source: '/tools/schedule.ts', execute,
  };
}

function masterPort(mode: 'ask' | 'bypass', answer: Parameters<typeof interaction>[0], masterPresent = true) {
  const im = interaction(answer);
  const ask = createRuntimeApprovalPort({ isMaster: true, interaction: im, masterPresent });
  const port = resolveApprovalPort({ mode, ask, auto: ask, masterInitiator: true });
  return { port, im };
}

describe.each(['ask', 'bypass'] as const)('master in %s mode', (mode) => {
  it('runs a high-risk action after external content only once the master confirms', async () => {
    const { port, im } = masterPort(mode, 'approve-once');
    const execute = vi.fn(async () => 'scheduled');
    const runtime = new TurnToolRuntime(turn(port), [scheduleTool(execute)]);
    runtime.provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
    await expect(runtime.execute('schedule_add', { cron: '0 9 * * *' }, 'c1')).resolves.toMatchObject({ status: 'completed' });
    expect(im.ask).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each(['reject', 'timeout'] as const)('refuses it when the master answers %s', async (answer) => {
    const { port } = masterPort(mode, answer);
    const execute = vi.fn(async () => 'scheduled');
    const runtime = new TurnToolRuntime(turn(port), [scheduleTool(execute)]);
    runtime.provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
    await expect(runtime.execute('schedule_add', {}, 'c1')).resolves.toMatchObject({ status: 'denied', policy: 'external-content-confirmation' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses it without asking when the master is not present (merged turn)', async () => {
    const { port, im } = masterPort(mode, 'approve-once', false);
    const execute = vi.fn(async () => 'scheduled');
    const runtime = new TurnToolRuntime(turn(port), [scheduleTool(execute)]);
    runtime.provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
    const outcome = await runtime.execute('schedule_add', {}, 'c1');
    expect(outcome).toMatchObject({ status: 'denied', policy: 'external-content-confirmation' });
    expect((outcome as { reason: string }).reason).toContain('运维 → 定时任务');
    expect(im.ask).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses it in an unattended master turn', async () => {
    const { port, im } = masterPort(mode, 'approve-once');
    const runtime = new TurnToolRuntime(turn(port, true), [scheduleTool()]);
    runtime.provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
    await expect(runtime.execute('schedule_add', {}, 'c1')).resolves.toMatchObject({ status: 'denied' });
    expect(im.ask).not.toHaveBeenCalled();
  });

  it('adds no prompt when no external content was read', async () => {
    const { port, im } = masterPort(mode, 'reject');
    const execute = vi.fn(async () => 'scheduled');
    await expect(new TurnToolRuntime(turn(port), [scheduleTool(execute)]).execute('schedule_add', {}, 'c1'))
      .resolves.toMatchObject({ status: 'completed' });
    expect(im.ask).not.toHaveBeenCalled();
  });
});

describe('master in auto mode', () => {
  it('still lets the reviewer decide the confirmation (unchanged)', async () => {
    const im = interaction('reject');
    const escalated = createRuntimeApprovalPort({ isMaster: false, interaction: im });
    const reviewer = new ApprovalReviewAgent({ judgment: { judge: async () => ({ decision: 'approve', reason: 'ok' }) } as never });
    const review = vi.spyOn(reviewer, 'review').mockResolvedValue('approve');
    const auto = createAutoApprovalPort(reviewer, escalated);
    const port = resolveApprovalPort({ mode: 'auto', ask: createRuntimeApprovalPort({ isMaster: true, interaction: im }), auto, masterInitiator: true });
    const execute = vi.fn(async () => 'scheduled');
    const runtime = new TurnToolRuntime(turn(port), [scheduleTool(execute)]);
    runtime.provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
    await expect(runtime.execute('schedule_add', {}, 'c1')).resolves.toMatchObject({ status: 'completed' });
    expect(review).toHaveBeenCalledTimes(1);
    expect(im.ask).not.toHaveBeenCalled();
  });
});

describe('bypass for a non-master initiator', () => {
  it('is unchanged: intent confirmations are approved by bypass', async () => {
    const im = interaction('reject');
    const ask = createRuntimeApprovalPort({ isMaster: false, interaction: im });
    const port = resolveApprovalPort({ mode: 'bypass', ask, auto: ask });
    const runtime = new TurnToolRuntime(turn(port), [scheduleTool()]);
    runtime.provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
    await expect(runtime.execute('schedule_add', {}, 'c1')).resolves.toMatchObject({ status: 'completed' });
    expect(im.ask).not.toHaveBeenCalled();
  });
});
