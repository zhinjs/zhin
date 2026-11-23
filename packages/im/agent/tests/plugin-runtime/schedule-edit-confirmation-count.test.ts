/**
 * #1250 第 91 批（integration）: the bot owner, in their private chat, asks the Agent to change a scheduled
 * task. Earlier the chat received a clean delivery of the owner's own job (created in this chat). The turn
 * runs through the full turn engine with the Host's real `schedule_*` tools and the real IM approval port;
 * every card the owner is shown is counted.
 *
 * The owner's private chat has two approval setups: the default (no master shell: the master shortcut
 * settles declarative approvals without a card) and master shell with `masterShellApprovalMode: ask`
 * (the default mode once master shell is on: the owner is asked for declarative approvals too).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUserMessage } from '@zhin.js/ai';
import type { ConversationContextBlock, DeliveryReceipt } from '@zhin.js/im-contract';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { ToolExecutionContext } from '@zhin.js/tool';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { createFullAgentTurnEngine } from '../../src/plugin-runtime/full-agent-turn-engine.js';
import { createRuntimeApprovalPort } from '../../src/plugin-runtime/ingress/request-ports.js';
import { UsageQuota } from '../../src/security/usage-quota.js';
import { PromptController } from '../../src/turn/prompt-controller.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { AgentEventBus } from '../../src/event/ai-event-bus.js';
import { ZhinAgentEventEmitter } from '../../src/event/event-emitter.js';
import { SessionToldLedger } from '../../src/memory/told-ledger.js';
import { deliveredTextDigest } from '../../src/session/context-provenance.js';
import { recordCleanScheduledDelivery } from '../../src/task-executor.js';
import { TimerScheduler } from '../../src/assistant/timer-scheduler.js';
import { ScheduleJobStore } from '../../src/assistant/job-store.js';
import { createNotificationRouter } from '../../src/assistant/notification-router.js';
import type { ScheduleJob } from '../../src/assistant/types.js';
import { createScheduleTools, type ScheduleManager } from '../../src/schedule-manager.js';
import type { ApprovalOutcomePort } from '../../src/session/approval-port.js';

const conversation = { endpoint: { adapter: 'root/sandbox', id: 'main' }, kind: 'private', id: 'owner' } as const;
const BRIEFING = '早报：今天晴，最高 25 度。';
const OWNER_ROLES = ['owner', 'admin', 'trusted'];
const imTarget = (sceneId: string) => ({ channel: 'im' as const, target: { channel: 'im' as const,
  scene: { platform: 'sandbox', endpointKey: 'main', sceneId, kind: 'private' as const } } });

type Call = Readonly<{ name: string; input: Record<string, unknown> }>;
type Setup = 'default' | 'master-shell-ask';

/** A registration of the Host's schedule tools as the Plugin Runtime binds it (ToolIndex descriptor). */
function capability(entry: ReturnType<typeof createScheduleTools>[number]): ToolCapability {
  const definition = entry.definition;
  return Object.freeze({
    owner: rootPluginId(),
    name: entry.name,
    qualifiedName: entry.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    requiresApproval: definition.requiresApproval,
    ...(definition.tags ? { tags: definition.tags } : {}),
    ...(definition.readOnly === true ? { readOnly: true } : {}),
    source: `host:${entry.name}`,
    execute: async <TInput, TResult>(input: TInput, invocation: unknown) =>
      await definition.execute(input as Record<string, unknown>, invocation as ToolExecutionContext) as TResult,
  });
}

describe('editing a scheduled task in the owner\'s private chat: cards shown (#1250 b91)', () => {
  const agentEvents = new AgentEventBus();
  const emitter = new ZhinAgentEventEmitter(agentEvents);
  let dataDir: string;
  let store: ScheduleJobStore;
  let engine: TimerScheduler;
  let manager: ScheduleManager;
  let job: ScheduleJob;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'zhin-schedule-edit-cards-'));
    store = new ScheduleJobStore({ dataDir });
    engine = new TimerScheduler({ store, due: { run: vi.fn() } as never, router: createNotificationRouter({ resolveAdapter: () => undefined }) });
    manager = { scheduleFeature: { getStatus: () => [] }, engine, agents: () => ['zhin'] };
    // The owner created this job in this private chat; it delivers here.
    job = await engine.addJob({
      id: 'job-1', label: '早报', enabled: true, source: 'schedule',
      schedule: { kind: 'solar', cron: '0 0 9 * * *' },
      action: { kind: 'agent', prompt: '整理今天的早报' },
      notify: imTarget('owner'),
      createdBy: { userId: 'owner', roles: ['owner'], chat: { conversation, endpointId: 'main' } },
    });
    // Someone else's job: visible to the owner, not to that user's neighbours.
    await engine.addJob({
      id: 'job-bob', enabled: true, source: 'schedule', schedule: { kind: 'solar', cron: '0 0 10 * * *' },
      action: { kind: 'agent', prompt: 'bob 的提醒' }, notify: imTarget('bob'),
      createdBy: { userId: 'bob', roles: ['user'], chat: { conversation: { ...conversation, id: 'bob' }, endpointId: 'main' } },
    });
  });

  afterEach(async () => {
    agentEvents.clear();
    vi.restoreAllMocks();
    engine.unload();
    await engine.stop();
    await rm(dataDir, { recursive: true, force: true });
  });

  /** The clean 09:00 delivery of job-1, as the platform confirmed it and as it comes back as background. */
  function cleanDelivery(ledger: SessionToldLedger): ConversationContextBlock {
    const receipt: DeliveryReceipt = { status: 'sent', message: { conversation, id: 'sched-msg-1' } as never,
      outboundTextDigest: deliveredTextDigest(BRIEFING) };
    expect(recordCleanScheduledDelivery(ledger, job, { contentClean: true }, receipt, BRIEFING)).toBe(true);
    return {
      kind: 'conversation_event', sequence: 2, eventType: 'message.created',
      text: `You (this bot) [message_id="sched-msg-1"]: ${BRIEFING}`,
      message: { conversation, id: 'sched-msg-1' } as never, messageTextDigest: deliveredTextDigest(BRIEFING),
    };
  }

  /** The owner's IM approval port (ingress-turn-runner), answering every card "allow once". */
  function ownerApproval(setup: Setup) {
    const cards: string[] = [];
    let asks = 0;
    const interaction = {
      ask: vi.fn(async () => { asks += 1; return 'approve-once' as never; }),
      sequence: async () => ({}) as never,
    };
    const inner = createRuntimeApprovalPort({
      interaction,
      selfApproval: false,
      // `isMaster: hostRole === 'owner' && turnPolicy.shell?.approvalMode !== 'ask'`
      isMaster: setup === 'default',
      masterPresent: true,
    });
    const port: ApprovalOutcomePort = {
      available: inner.available,
      ...(inner.intentAvailable !== undefined ? { intentAvailable: inner.intentAvailable } : {}),
      requestApproval: inner.requestApproval,
      requestApprovalOutcome: async (request) => {
        const before = asks;
        const outcome = await inner.requestApprovalOutcome(request);
        if (asks > before) cards.push(`${request.toolName}:${request.purpose ?? 'authorization'}`);
        return outcome;
      },
    };
    return { port, cards };
  }

  async function runTurn(setup: Setup, calls: readonly Call[]) {
    const ledger = new SessionToldLedger();
    const background = cleanDelivery(ledger);
    const { port, cards } = ownerApproval(setup);
    const tools = createScheduleTools(manager).map(capability);
    const outcomes: unknown[] = [];
    const host = {
      emitter,
      config: { deferredTools: {} },
      rateLimiter: { check: () => ({ allowed: true }) },
      usageQuota: new UsageQuota(),
      contextRepository: {
        getDeferredToolSnapshot: async () => ({ loadedTools: {}, loadedSkills: [] }),
        setDeferredToolSnapshot: async () => undefined,
      },
      promptController: new PromptController('one-at-a-time', 'one-at-a-time'),
      activeBinding: { providerAlias: 'provider', model: 'model', nickname: 'bot' },
      finalizeActiveTurn: vi.fn(async () => undefined),
      toldLedger: ledger,
    };
    const turnEngine = createFullAgentTurnEngine({
      host: host as never,
      core: {
        runText(options: { toolExecution: { execute(tool: { name: string }, input: Record<string, unknown>, id: string): Promise<unknown> } }) {
          return (async function* () {
            // The model's tool calls of this turn, one after another.
            for (const [index, call] of calls.entries()) {
              outcomes.push(await options.toolExecution.execute({ name: call.name }, call.input, `call-${index}`));
            }
            yield { type: 'turn_end' as const, output: [], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
            return { reply: '早报改到 8 点了', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
              path: 'agent' as const, iterations: 1, model: 'model', toolCalls: [] };
          })();
        },
      } as never,
      sessionSystem: {
        prepareIngressTurn: vi.fn(async () => ({
          sessionKey: 'session-key', userId: 'owner', sessionId: 'session-id', isNewSession: false,
          turnUser: { rawContent: '把早报改到早上 8 点', promptMessages: [createUserMessage('把早报改到早上 8 点')] },
        })),
        touchAfterTurn: vi.fn(async () => undefined),
      } as never,
      contextSystem: {
        buildTextTurnContext: vi.fn(async () => ({
          userMessages: [createUserMessage('把早报改到早上 8 点')], personaEnhanced: 'persona', modelCandidates: ['model'],
          modelId: 'model', providerAlias: 'provider', turnEnvelope: null,
        })),
      } as never,
    });
    const turn = createTurnIngress({
      intent: { kind: 'new' },
      identity: { rootId: 'root', generation: 7, traceId: 'trace', turnId: 'turn' },
      origin: { kind: 'im', platform: 'sandbox', endpoint: 'main', scope: 'private', sceneId: 'owner', messageId: 'in-1', conversation },
      principal: { subjectId: 'owner', roles: OWNER_ROLES, origin: 'human' },
      input: { text: '把早报改到早上 8 点' },
      session: { key: 'session-key' },
      policy: { permissions: OWNER_ROLES, unattended: false },
      capabilities: { tools: tools.map(tool => tool.name), skills: [] },
      signal: new AbortController().signal,
      ports: {
        journal: { append: async () => undefined },
        approval: port,
        reply: { send: async () => ({ status: 'sent' as const, messageId: 'r', messages: [{ conversation, id: 'r' } as never] }) },
        conversationContext: { readPending: async () => ({ cursor: 9, blocks: [background] }), commit: async () => undefined },
      },
    } as never);
    const stream = turnEngine.run({
      turn,
      capabilities: { generation: 7, owner: rootPluginId(), tools, skills: [], agents: [], mcp: [], promptSections: [] },
      toolCapabilities: tools,
      tools: new TurnToolRuntime(turn, tools),
      selection: { binding: { name: 'zhin', providerAlias: 'provider', model: 'model', mcpServers: [] }, mcpServers: [] },
    });
    while (true) {
      const step = await stream.next();
      if (step.done) { await step.value?.project(); break; }
    }
    return { cards, outcomes };
  }

  const list: Call = { name: 'schedule_list', input: {} };
  const updateCron: Call = { name: 'schedule_update', input: { id: 'job-1', cron: '0 0 8 * * *' } };
  const updateLabel: Call = { name: 'schedule_update', input: { id: 'job-1', label: '每日早报' } };

  it.each(['default', 'master-shell-ask'] as const)(
    '[%s] schedule_list + schedule_update(cron) + schedule_update(label): one card', async (setup) => {
      const { cards, outcomes } = await runTurn(setup, [list, updateCron, updateLabel]);
      expect(outcomes).toEqual([
        expect.objectContaining({ status: 'completed' }),
        expect.objectContaining({ status: 'completed' }),
        expect.objectContaining({ status: 'completed' }),
      ]);
      // The lookup asks nothing. #1250 b98: the first update's result is harness output (no label it did not
      // set, no prompt), not a new source, so the first answer covers the second update of the same job
      // (b91 asked twice here).
      expect(cards).toEqual(['schedule_update:intent']);
      const after = await store.getJob('job-1');
      expect(after).toMatchObject({ label: '每日早报', schedule: { kind: 'solar', cron: '0 0 8 * * *' } });
    });

  it.each(['default', 'master-shell-ask'] as const)(
    '[%s] schedule_list + schedule_update(cron): one card', async (setup) => {
      const { cards, outcomes } = await runTurn(setup, [list, updateCron]);
      expect(outcomes).toEqual([
        expect.objectContaining({ status: 'completed' }),
        expect.objectContaining({ status: 'completed' }),
      ]);
      expect(cards).toEqual(['schedule_update:intent']);
      expect((await store.getJob('job-1'))?.schedule).toEqual({ kind: 'solar', cron: '0 0 8 * * *' });
    });

  it.each(['default', 'master-shell-ask'] as const)(
    '[%s] a failed schedule_update counts as external content: the next update asks again', async (setup) => {
      // An invalid cron: the error text reaches the model, so it is recorded like any outside text (b98).
      const invalid: Call = { name: 'schedule_update', input: { id: 'job-1', cron: '0 0 99 * * *' } };
      const { cards, outcomes } = await runTurn(setup, [list, updateCron, invalid, updateLabel]);
      expect(outcomes).toEqual([
        expect.objectContaining({ status: 'completed' }),
        expect.objectContaining({ status: 'completed' }),
        expect.objectContaining({ status: 'failed' }),
        expect.objectContaining({ status: 'completed' }),
      ]);
      expect(cards).toEqual(['schedule_update:intent', 'schedule_update:intent']);
    });

  it('keeps the visibility filter of schedule_list: a member sees only their own jobs, with no card', async () => {
    // A member's private chat: nobody with authority can be asked (no admin self-approval); the member may
    // only confirm their own intent (ingress-turn-runner `intentInteraction`).
    const cards: string[] = [];
    const intentInteraction = {
      ask: vi.fn(async (request: { title?: string }) => { cards.push(String(request.title)); return 'approve-once' as never; }),
      sequence: async () => ({}) as never,
    };
    const port = createRuntimeApprovalPort({ isMaster: false, selfApproval: false, intentInteraction,
      unavailableReason: 'no approver in this conversation' });
    const bob = createTurnIngress({
      intent: { kind: 'new' },
      identity: { rootId: 'root', generation: 7, traceId: 'trace-bob', turnId: 'turn-bob' },
      origin: { kind: 'im', platform: 'sandbox', endpoint: 'main', scope: 'private', sceneId: 'bob', messageId: 'in-2',
        conversation: { ...conversation, id: 'bob' } },
      principal: { subjectId: 'bob', roles: ['user'], origin: 'human' },
      input: { text: '我有哪些定时任务' },
      session: { key: 'session-bob' },
      policy: { permissions: ['user'], unattended: false },
      capabilities: { tools: ['schedule_list'], skills: [] },
      signal: new AbortController().signal,
      ports: { journal: { append: async () => undefined }, approval: port },
    } as never);
    const tools = createScheduleTools(manager).map(capability);
    const outcome = await new TurnToolRuntime(bob, tools).execute('schedule_list', {}, 'bob-list');
    expect(outcome).toMatchObject({ status: 'completed' });
    const listed = (outcome as { output: { persistent: { id: string }[] } }).output.persistent.map(entry => entry.id);
    expect(listed).toEqual(['job-bob']);
    expect(cards).toEqual([]);
  });
});
