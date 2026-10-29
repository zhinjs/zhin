import { describe, expect, it, vi } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import { MessageAliasTable, createUserMessage, type AssistantMessage, EMPTY_TOKEN_USAGE } from '@zhin.js/ai';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress, type TurnPolicyContext } from '../../src/turn/turn-ingress.js';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';

const POLICY: TurnPolicyContext = {
  permissions: ['master'],
  unattended: false,
  shell: { security: 'allowlist', execPreset: 'development', approvalMode: 'auto', isolation: 'required' },
  filesystem: { workspaceRoot: '/ws', workingDirectory: '/ws', access: 'workspace-write' },
};

function tool(name: string, execute: (input: unknown) => unknown): ToolCapability {
  return {
    owner: rootPluginId(), name, qualifiedName: name, description: name, requiresApproval: 'never',
    source: `/tools/${name}.ts`, execute: vi.fn(async (input: unknown) => execute(input)) as never,
  };
}

function turn(tools: string[]) {
  return createTurnIngress({
    intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 1, traceId: 't', turnId: 'turn' },
    origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'group', sceneId: 'g1', messageId: 'native-3' },
    principal: { subjectId: 'owner', roles: ['master'] },
    input: { text: 'hi' },
    session: { key: 'im:icqq:bot:group:g1' },
    policy: POLICY,
    capabilities: { tools, skills: [] },
    signal: new AbortController().signal,
    ports: { journal: { append: () => undefined } },
  });
}

const bot = (messageId: string, timestamp: number): AssistantMessage => ({
  role: 'assistant', content: [{ type: 'text', text: 'ok' }], api: 'a', provider: 'p', model: 'm',
  usage: EMPTY_TOKEN_USAGE, stopReason: 'stop', timestamp, messageId,
});

describe('message aliases in tool arguments (ADR 0043 §5)', () => {
  it('rewrites m<n> to the platform id before the tool runs and accepts platform ids as before', async () => {
    const seen: unknown[] = [];
    const quoteReply = tool('read_message', (input) => { seen.push(input); return 'sent'; });
    const forward = tool('read_messages', (input) => { seen.push(input); return 'sent'; });
    const aliases = new MessageAliasTable();
    aliases.index([
      { ...createUserMessage('hi', undefined, 1), messageId: 'native-1' },
      bot('native-2', 2),
      { ...createUserMessage('now', undefined, 3), messageId: 'native-3' },
    ]);
    const runtime = new TurnToolRuntime(turn(['read_message', 'read_messages']), [quoteReply, forward], { messageAliases: aliases });

    await runtime.execute('read_message', { message_id: 'm2', text: 'm1' }, 'u1');
    await runtime.execute('read_message', { message_id: 'native-1', text: 'x' }, 'u2');
    await runtime.execute('read_messages', { message_ids: ['m1', 'm3', 'native-2'] }, 'u3');

    expect(seen).toEqual([
      { message_id: 'native-2', text: 'm1' },
      { message_id: 'native-1', text: 'x' },
      { message_ids: ['native-1', 'native-3', 'native-2'] },
    ]);
  });

  it('leaves arguments alone without an alias table', async () => {
    const seen: unknown[] = [];
    const runtime = new TurnToolRuntime(turn(['read_message']), [tool('read_message', (input) => { seen.push(input); return 'sent'; })]);
    await runtime.execute('read_message', { message_id: 'm2' }, 'u1');
    expect(seen).toEqual([{ message_id: 'm2' }]);
  });
});
