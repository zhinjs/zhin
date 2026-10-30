import { describe, expect, it, vi } from 'vitest';
import { createCapabilitySlot, createSnapshotView, SnapshotStore, rootPluginId,
  type CapabilityId, type CapabilitySlot, type FeatureId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { AdapterIndex, adapterFeatureId, defineAdapter, endpointEventGatewayToken } from '@zhin.js/adapter';
import { ToolIndex, defineAgentTool, toolFeatureId } from '../../../../../../packages/im/tool/src/index.js';
import { MemoryConversationEventStore, type MessageRef, type Segment } from '@zhin.js/im-contract';
import { ImRuntime } from '@zhin.js/core/runtime';
import { ZhinAgent, renderAgentOutput, type AgentOutputElement } from '@zhin.js/agent';
import { CapabilityIngress, createFullAgentTurnEngine } from '@zhin.js/agent/runtime';
import { createTurnIngress } from '@zhin.js/agent/turn';
import { AgentCore } from '../../../../../../packages/im/agent/src/core/agent-core.js';
import { DEFAULT_AGENT_CORE_CONFIG, createDefaultAgentCoreDeps } from '../../../../../../packages/im/agent/src/core/compose-deps.js';
import { asPrivate } from '../../../../../../packages/im/agent/src/internal/as-private.js';
import { TurnToolRuntime } from '../../../../../../packages/im/agent/src/tool/turn-tool-runtime.js';
import { executeAgentTurn } from '../../../../../../packages/im/agent/src/turn/execute-agent-turn.js';
import { assistantTextReply, assistantToolCallReply, wireMockLlmApi } from '../../../../../../packages/im/agent/tests/helpers/mock-llm-api.js';
import { deliveryOutcomeFromReceipt } from '../../../../src/plugin-runtime/agent/turn/request.js';
import { sendOutputMessages } from '../../../../src/plugin-runtime/agent/turn/reply-messages.js';

function segments(output: readonly AgentOutputElement[]): Segment[] {
  return output.flatMap(element => element.type === 'message' ? element.segments
    : element.type === 'text' ? [{ type: 'text' as const, data: { text: element.content } }] : []);
}

describe('physical reply aliases through Core, CLI and Agent', () => {
  it('recalls only the second delivered bubble through an actual next-turn m2.2 tool invocation', async () => {
    const root = rootPluginId();
    const events = new MemoryConversationEventStore();
    const im = new ImRuntime({ conversationEvents: events });
    const nativeRecall = vi.fn(async (_message: MessageRef) => undefined);
    const nativeSends: unknown[] = [];
    const adapter = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'sandbox',
      source: '/project/adapters/sandbox/index.ts', definition: defineAdapter({
        capabilities: ['outbound'], operations: ['recall'],
        create: () => ({ client: {}, control: { recall: nativeRecall },
          send: request => {
            nativeSends.push(request.payload);
            return { parts: [{ messageId: ['native-one', 'native-two', 'native-confirmation'][nativeSends.length - 1]!, sourceIndices: [0] }] };
          },
        }),
      }) });
    const conversation = { endpoint: { adapter: 'sandbox', id: String(adapter.id) }, kind: 'private' as const, id: 'owner' };
    const toolInputs: string[] = [];
    const recall = createCapabilitySlot({ owner: root, feature: toolFeatureId, localName: 'recall_own_message',
      source: '/project/tools/recall_own_message/index.ts', definition: defineAgentTool<{ message_id: string }>({
        description: 'Recall one own message in this conversation.', requiresApproval: 'never',
        inputSchema: { type: 'object', properties: { message_id: { type: 'string' } }, required: ['message_id'] },
        execute: async ({ message_id }) => {
          toolInputs.push(message_id);
          await im.endpoints.recall({ adapter: 'sandbox', endpointKey: 'sandbox', message: { conversation, id: message_id } });
          return { recalled: message_id };
        },
      }) });
    const state: SnapshotState = {
      root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: '@test/root', packageRoot: '/project', children: [] }]]),
      config: new Map([[root, {}]]), resources: new Map([[root, new Map([[endpointEventGatewayToken.id, im.endpointEvents]])]]),
      capabilities: new Map<CapabilityId, CapabilitySlot>([[adapter.id, adapter], [recall.id, recall]]), projections: new Map(),
    };
    const view = createSnapshotView(0, state);
    const adapters = await AdapterIndex.create([adapter], view, new AbortController().signal);
    const store = new SnapshotStore({ ...state, projections: new Map<FeatureId, unknown>([
      [adapterFeatureId, adapters], [toolFeatureId, new ToolIndex([recall], view)],
    ]) });
    im.attach(store);
    await adapters.start();
    adapters.open();
    const llm = wireMockLlmApi();
    const agent = new ZhinAgent(llm.provider, { maxIterations: 3, toolExecution: 'sequential',
      deferredTools: { alwaysLoadedTools: ['recall_own_message'] } }, undefined, llm.runtime);
    agent.activeBinding = { name: 'zhin', providerAlias: 'mock', model: 'mock-model', mcpServers: [] };
    agent.markMemoryPersistenceReady();
    const host = asPrivate(agent);
    const engine = createFullAgentTurnEngine({ host,
      core: new AgentCore(DEFAULT_AGENT_CORE_CONFIG, createDefaultAgentCoreDeps()),
      sessionSystem: host.sessionSystem, contextSystem: host.contextSystem,
    });
    const sessionKey = 'im:sandbox:sandbox:private:owner';
    const send = (output: readonly AgentOutputElement[]) => sendOutputMessages(output, {
      render: renderAgentOutput, pause: async () => undefined,
      send: async message => deliveryOutcomeFromReceipt(await im.send({ requester: root, conversation, content: segments(message) }), renderAgentOutput(message)),
    });
    const run = async (index: number, text: string) => {
      const turn = createTurnIngress({ identity: { rootId: 'root', generation: 0, turnId: `turn-${index}`, traceId: `trace-${index}` },
        origin: { kind: 'im', platform: 'sandbox', endpoint: 'sandbox', scope: 'private', sceneId: 'owner',
          messageId: `native-user-${index}`, conversation },
        principal: { subjectId: 'owner', roles: ['master'] }, intent: { kind: 'new' }, input: { text },
        session: { key: sessionKey }, policy: { permissions: ['master'], unattended: false },
        capabilities: { tools: ['recall_own_message'], skills: [] }, signal: new AbortController().signal,
        ports: { journal: { append: async () => undefined }, reply: { segments: { types: ['text'] }, send } },
      });
      const capabilities = await new CapabilityIngress().read(store.current, root, () => true, turn);
      const context = { turn, capabilities, toolCapabilities: capabilities.tools, tools: new TurnToolRuntime(turn, capabilities.tools),
        selection: { binding: agent.activeBinding!, mcpServers: [] },
      };
      return executeAgentTurn(turn, () => engine.run(context));
    };
    try {
      llm.respondText(JSON.stringify({ messages: [
        { segments: [{ type: 'text', data: { text: 'First bubble' } }] },
        { segments: [{ type: 'text', data: { text: 'Second bubble' } }] },
      ] }));
      await run(1, 'Please send two messages.');
      expect(nativeSends).toHaveLength(2);
      expect(await events.getMessage({ conversation, id: 'native-two' })).toMatchObject({
        segments: [{ type: 'text', data: { text: 'Second bubble' } }],
      });
      const session = await host.agentSessionStore.findActive(sessionKey);
      expect(session).toBeDefined();
      const stored = await host.contextRepository.loadContext(session!.session_id);
      let request = 0;
      llm.respondWith(() => request++ === 0
        ? assistantToolCallReply([{ id: 'recall-second', name: 'recall_own_message', arguments: { message_id: 'm2.2' } }])
        : assistantTextReply(JSON.stringify({ messages: [{ segments: [{ type: 'text', data: { text: 'Recalled second bubble.' } }] }] })));
      await run(2, 'Recall your second message.');
      expect(toolInputs).toEqual(['native-two']);
      expect(nativeRecall).toHaveBeenCalledExactlyOnceWith({ conversation, id: 'native-two' });
      expect(stored.messages.find(message => message.role === 'assistant')).toMatchObject({
        messageId: 'native-one', messageIds: ['native-one', 'native-two'],
      });
      expect(JSON.stringify(llm.calls[1]?.context.messages)).toContain('m2.2');
      expect(nativeSends).toHaveLength(3);
    } finally {
      await agent.dispose();
      await adapters.stop();
      await store.close();
    }
  });
});
