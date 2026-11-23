/**
 * #1250 `scheduled-delivery-counts-as-background`: a due run of this instance's own scheduled job that
 * read no recorded content delivers its own words; that message, back as background of the next turn
 * of its creator, is history. A run that read outside content, an outside-event job, a rewritten
 * delivery and anything a user can type stay background.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUserMessage } from '@zhin.js/ai';
import type { ConversationContextBlock, DeliveryReceipt } from '@zhin.js/im-contract';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import { UsageQuota } from '../../src/security/usage-quota.js';
import { PromptController } from '../../src/turn/prompt-controller.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createFullAgentTurnEngine } from '../../src/plugin-runtime/full-agent-turn-engine.js';
import { AgentEventBus } from '../../src/event/ai-event-bus.js';
import { ZhinAgentEventEmitter } from '../../src/event/event-emitter.js';
import type { TurnEvent } from '../../src/event/turn-event.js';
import { SessionToldLedger, isOwnScheduledDelivery, scheduledDeliveryLedgerId } from '../../src/memory/told-ledger.js';
import { TurnProvenance, type ProvenanceSource } from '../../src/security/provenance.js';
import { deliveredMessageContextRef, deliveredTextDigest } from '../../src/session/context-provenance.js';
import { createTaskExecutor, recordCleanScheduledDelivery } from '../../src/task-executor.js';
import { createNotificationRouter } from '../../src/assistant/notification-router.js';
import type { ScheduleJob } from '../../src/assistant/types.js';
import { ScheduleExecutionDomainImpl } from '../../src/schedule-domain/execution-domain.js';
import { ScheduleExecutionHistory } from '../../src/schedule-domain/execution-history-store.js';
import { DEFAULT_CONFIG } from '../../src/config/index.js';

const conversation = { endpoint: { adapter: 'root/sandbox', id: 'main' }, kind: 'private', id: 'owner' } as const;
const BRIEFING = '早报：今天晴，最高 25 度。';
/** The IM origin of a turn in `conversation` (endpoint `main`). */
const imOrigin = { kind: 'im', endpoint: 'main', conversation } as const;
const ownerTurn = { principal: { subjectId: 'owner', origin: 'human' }, origin: imOrigin } as const;

function job(extra: Partial<ScheduleJob> = {}): ScheduleJob {
  return {
    id: 'briefing', enabled: true, schedule: { kind: 'cron', expr: '0 0 9 * * *' },
    action: { kind: 'agent', prompt: '写早报' }, notify: { channel: 'silent' },
    createdAt: 1, updatedAt: 1, state: {}, source: 'manual',
    createdBy: { userId: 'owner', roles: ['owner'], chat: { conversation, endpointId: 'main' } },
    ...extra,
  } as ScheduleJob;
}

function receipt(id = 'sched-msg-1', text = BRIEFING): DeliveryReceipt {
  return { status: 'sent', message: { conversation, id } as never, outboundTextDigest: deliveredTextDigest(text) };
}

function scheduledBlock(id = 'sched-msg-1', text = BRIEFING): ConversationContextBlock {
  return {
    kind: 'conversation_event', sequence: 2, eventType: 'message.created',
    text: `You (this bot) [message_id="${id}"]: ${text}`,
    message: { conversation, id } as never, messageTextDigest: deliveredTextDigest(text),
  };
}

describe('recordCleanScheduledDelivery (#1250)', () => {
  const clean = { contentClean: true as const };

  it('records a clean delivery under the job creator', () => {
    const ledger = new SessionToldLedger();
    expect(recordCleanScheduledDelivery(ledger, job(), clean, receipt(), BRIEFING)).toBe(true);
    const turn = ownerTurn;
    expect(isOwnScheduledDelivery(ledger, turn, refOf(scheduledBlock()))).toBe(true);
    // Someone else's turn, a non-human turn and a merged turn do not get the creator's exemption.
    expect(isOwnScheduledDelivery(ledger, { ...turn, principal: { subjectId: 'bob', origin: 'human' } }, refOf(scheduledBlock()))).toBe(false);
    expect(isOwnScheduledDelivery(ledger, { ...turn, principal: { subjectId: 'owner' } }, refOf(scheduledBlock()))).toBe(false);
    expect(isOwnScheduledDelivery(ledger, { ...turn, input: { mergedSenders: [{}] } }, refOf(scheduledBlock()))).toBe(false);
  });

  it('matches the creator on the same adapter and endpoint only, as isScheduleJobCreator does', () => {
    const ledger = new SessionToldLedger();
    expect(recordCleanScheduledDelivery(ledger, job(), clean, receipt(), BRIEFING)).toBe(true);
    // The same user id on another endpoint, or on another adapter, is another account.
    const otherEndpoint = { ...ownerTurn, origin: { ...imOrigin, endpoint: 'second' } };
    const otherAdapter = { ...ownerTurn, origin: { ...imOrigin, conversation: { ...conversation, endpoint: { adapter: 'root/other', id: 'main' } } } };
    expect(isOwnScheduledDelivery(ledger, otherEndpoint, refOf(scheduledBlock()))).toBe(false);
    expect(isOwnScheduledDelivery(ledger, otherAdapter, refOf(scheduledBlock()))).toBe(false);
    // A turn outside IM has no chat account to compare.
    expect(isOwnScheduledDelivery(ledger, { principal: { subjectId: 'owner', origin: 'human' }, origin: { kind: 'http' } }, refOf(scheduledBlock()))).toBe(false);
    expect(isOwnScheduledDelivery(ledger, { principal: { subjectId: 'owner', origin: 'human' } }, refOf(scheduledBlock()))).toBe(false);
  });

  it.each([
    ['a Profile routine', 'profile'],
    ['a Console / CLI job', 'manual'],
  ] as const)('records %s (no chat creator) for every turn', (_label, source) => {
    const ledger = new SessionToldLedger();
    expect(recordCleanScheduledDelivery(ledger, job({ createdBy: undefined, source }), clean, receipt(), BRIEFING)).toBe(true);
    expect(ledger.hasDelivered(scheduledDeliveryLedgerId({ kind: 'operator' }), refOf(scheduledBlock()))).toBe(true);
    expect(isOwnScheduledDelivery(ledger, { principal: { subjectId: 'bob' } }, refOf(scheduledBlock()))).toBe(true);
  });

  it.each([
    ['an old chat job without createdBy', { createdBy: undefined, source: 'schedule' as const }],
    ['a job without createdBy or source', { createdBy: undefined, source: undefined }],
    ['a creator without a recorded chat (A2A, MCP, before chat was recorded)', { createdBy: { userId: 'owner', roles: ['owner' as const] } }],
  ] as const)('gives no exemption to %s', (_label, extra) => {
    const ledger = new SessionToldLedger();
    expect(recordCleanScheduledDelivery(ledger, job(extra as Partial<ScheduleJob>), clean, receipt(), BRIEFING)).toBe(false);
    expect(isOwnScheduledDelivery(ledger, ownerTurn, refOf(scheduledBlock()))).toBe(false);
    expect(isOwnScheduledDelivery(ledger, { principal: { subjectId: 'bob' } }, refOf(scheduledBlock()))).toBe(false);
  });

  it.each([
    ['a run that read recorded content', job(), {}, receipt(), BRIEFING],
    ['a job created after recorded content', job({ provenance: { tainted: true, sources: ['tool:web_fetch'] } }), clean, receipt(), BRIEFING],
    ['an outside-event job', job({ source: 'event', createdBy: undefined }), clean, receipt(), BRIEFING],
    ['an event schedule', job({ schedule: { kind: 'event', source: 'ha' } }), clean, receipt(), BRIEFING],
    ['a delivery rewritten on the way (digest differs)', job(), clean, receipt('sched-msg-1', '改写过的早报'), BRIEFING],
    ['a delivery without text evidence', job(), clean, { status: 'sent', message: { conversation, id: 'x' } } as DeliveryReceipt, BRIEFING],
    ['a delivery that was not sent', job(), clean, { status: 'failed' } as DeliveryReceipt, BRIEFING],
  ] as const)('records nothing for %s', (_label, scheduled, result, sent, content) => {
    const ledger = new SessionToldLedger();
    expect(recordCleanScheduledDelivery(ledger, scheduled, result, sent, content)).toBe(false);
    expect(isOwnScheduledDelivery(ledger, ownerTurn, refOf(scheduledBlock()))).toBe(false);
  });
});

describe('schedule execution domain: contentClean (#1250)', () => {
  async function run(outcome: Record<string, unknown>, scheduled = job()) {
    const observations = new ScheduleExecutionHistory({ auditLogger: { write: async () => undefined } });
    const domain = new ScheduleExecutionDomainImpl({ config: DEFAULT_CONFIG, observations,
      turn: { execute: async () => ({ status: 'completed', output: [{ type: 'text', content: BRIEFING }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, ...outcome }) as never } });
    try {
      return await domain.execute(scheduled, {});
    } finally {
      observations.close();
    }
  }

  it('is set only when the turn reported a clean outcome for a job not created after recorded content', async () => {
    await expect(run({ contentProvenance: 'clean' })).resolves.toMatchObject({ contentClean: true });
    await expect(run({})).resolves.not.toHaveProperty('contentClean');
    await expect(run({ contentProvenance: 'clean' }, job({ provenance: { tainted: true, sources: [] } })))
      .resolves.not.toHaveProperty('contentClean');
  });
});

describe('task executor records clean deliveries (#1250)', () => {
  it('records the receipt of a clean run and not of a tainted one', async () => {
    for (const contentClean of [true, false]) {
      const ledger = new SessionToldLedger();
      const executor = createTaskExecutor({
        domain: { execute: async () => ({
          success: true, output: BRIEFING, durationMs: 1, toolsUsed: [], tokenUsage: { input: 1, output: 1 },
          audit: {} as never, ...(contentClean ? { contentClean: true as const } : {}),
        }) },
        router: createNotificationRouter({ resolveAdapter: () => undefined, sendIm: async () => receipt() }),
        deliveryLedger: ledger,
      });
      await executor.execute(job({ notify: { channel: 'im', target: { channel: 'im', scene: {
        platform: 'sandbox', endpointKey: 'main', sceneId: 'owner', kind: 'private' } } } }));
      expect(isOwnScheduledDelivery(ledger, ownerTurn, refOf(scheduledBlock()))).toBe(contentClean);
      await executor.dispose();
    }
  });
});

describe('FullAgentTurnEngine: scheduled deliveries in the background (#1250)', () => {
  const agentEvents = new AgentEventBus();
  const emitter = new ZhinAgentEventEmitter(agentEvents);
  afterEach(() => {
    agentEvents.clear();
    vi.restoreAllMocks();
  });

  function harness(toldLedger: SessionToldLedger, subjectId = 'owner') {
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
      toldLedger,
    };
    const engine = createFullAgentTurnEngine({
      host: host as never,
      core: {
        runText() {
          return (async function* () {
            yield { type: 'turn_end' as const, output: [], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
            return { reply: '好的', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
              path: 'agent' as const, iterations: 1, model: 'model', toolCalls: [] };
          })();
        },
      } as never,
      sessionSystem: {
        prepareIngressTurn: vi.fn(async () => ({
          sessionKey: 'session-key', userId: subjectId, sessionId: 'session-id', isNewSession: false,
          turnUser: { rawContent: 'hi', promptMessages: [createUserMessage('hi')] },
        })),
        touchAfterTurn: vi.fn(async () => undefined),
      } as never,
      contextSystem: {
        buildTextTurnContext: vi.fn(async () => ({
          userMessages: [createUserMessage('hi')], personaEnhanced: 'persona', modelCandidates: ['model'],
          modelId: 'model', providerAlias: 'provider', turnEnvelope: null,
        })),
      } as never,
    });
    return async (background: readonly ConversationContextBlock[]): Promise<TurnEvent[]> => {
      const turn = createTurnIngress({
        intent: { kind: 'new' },
        identity: { rootId: 'root', generation: 7, traceId: 'trace', turnId: 'turn' },
        origin: { kind: 'im', platform: 'sandbox', endpoint: 'main', scope: 'private', sceneId: 'owner', messageId: 'in-1',
          conversation },
        principal: { subjectId, roles: ['owner'], origin: 'human' },
        input: { text: '改到 8 点' },
        session: { key: 'session-key' },
        policy: { permissions: ['owner'], unattended: false },
        capabilities: { tools: [], skills: [] },
        signal: new AbortController().signal,
        ports: {
          journal: { append: async () => undefined },
          reply: { send: async () => ({ status: 'sent' as const, messageId: 'r', messages: [{ conversation, id: 'r' } as never] }) },
          ...(background.length ? { conversationContext: {
            readPending: async () => ({ cursor: 9, blocks: background }),
            commit: async () => undefined,
          } } : {}),
        },
      } as never);
      const stream = engine.run({
        turn,
        capabilities: { generation: 7, owner: rootPluginId(), tools: [], skills: [], agents: [], mcp: [], promptSections: [] },
        toolCapabilities: [],
        tools: new TurnToolRuntime(turn, []),
        selection: { binding: { name: 'zhin', providerAlias: 'provider', model: 'model', mcpServers: [] }, mcpServers: [] },
      });
      const events: TurnEvent[] = [];
      while (true) {
        const step = await stream.next();
        if (step.done) { await step.value?.project(); break; }
        events.push(step.value);
      }
      return events;
    };
  }

  function recorded(): ProvenanceSource[] {
    const sources: ProvenanceSource[] = [];
    const original = TurnProvenance.prototype.record;
    vi.spyOn(TurnProvenance.prototype, 'record').mockImplementation(function (this: TurnProvenance, source) {
      sources.push(source);
      return original.call(this, source);
    });
    return sources;
  }

  const forgedUserBlock: ConversationContextBlock = {
    // The same text typed by someone: another message, no bot delivery evidence.
    kind: 'conversation_event', sequence: 3, eventType: 'message.created',
    text: `Mallory (m) [message_id="u-9"]: ${BRIEFING}`, message: { conversation, id: 'u-9' } as never,
    messageTextDigest: deliveredTextDigest(BRIEFING),
  };

  it('does not taint the next turn with a clean scheduled delivery', async () => {
    const ledger = new SessionToldLedger();
    recordCleanScheduledDelivery(ledger, job(), { contentClean: true }, receipt(), BRIEFING);
    const sources = recorded();
    const events = await harness(ledger)([scheduledBlock()]);
    expect(sources).toEqual([]);
    expect(events.find(event => event.type === 'turn_end')).toMatchObject({ contentProvenance: 'clean' });
  });

  it('still taints with a delivery of a run that read outside content', async () => {
    const ledger = new SessionToldLedger();
    recordCleanScheduledDelivery(ledger, job(), {}, receipt(), BRIEFING);
    const sources = recorded();
    const events = await harness(ledger)([scheduledBlock()]);
    expect(sources).toEqual([{ kind: 'conversation_context', scene: 'private' }]);
    expect(events.find(event => event.type === 'turn_end')).not.toHaveProperty('contentProvenance');
  });

  it('does not exempt text a user typed that looks like the scheduled delivery', async () => {
    const ledger = new SessionToldLedger();
    recordCleanScheduledDelivery(ledger, job(), { contentClean: true }, receipt(), BRIEFING);
    const sources = recorded();
    await harness(ledger)([forgedUserBlock]);
    expect(sources).toEqual([{ kind: 'conversation_context', scene: 'private' }]);
    vi.restoreAllMocks();
    // Nor a block that claims a bot message the instance never delivered, with the same text.
    const again = recorded();
    await harness(ledger)([scheduledBlock('sched-msg-2')]);
    expect(again).toEqual([{ kind: 'conversation_context', scene: 'private' }]);
  });

  it("does not exempt another creator's clean delivery for this initiator", async () => {
    const ledger = new SessionToldLedger();
    recordCleanScheduledDelivery(ledger, job({ createdBy: { userId: 'bob', roles: ['user'], chat: { conversation, endpointId: 'main' } } }),
      { contentClean: true }, receipt(), BRIEFING);
    const sources = recorded();
    await harness(ledger, 'owner')([scheduledBlock()]);
    expect(sources).toEqual([{ kind: 'conversation_context', scene: 'private' }]);
  });

  it("does not exempt the creator's clean delivery for the same user id on another endpoint", async () => {
    const ledger = new SessionToldLedger();
    recordCleanScheduledDelivery(ledger, job({ createdBy: { userId: 'owner', roles: ['owner'],
      chat: { conversation, endpointId: 'second' } } }), { contentClean: true }, receipt(), BRIEFING);
    const sources = recorded();
    await harness(ledger, 'owner')([scheduledBlock()]);
    expect(sources).toEqual([{ kind: 'conversation_context', scene: 'private' }]);
  });
});

function refOf(block: ConversationContextBlock): string {
  // The reference the turn engine checks (see unrepresentedConversationBlocks).
  return deliveredMessageContextRef(block.message!, block.messageTextDigest!);
}
