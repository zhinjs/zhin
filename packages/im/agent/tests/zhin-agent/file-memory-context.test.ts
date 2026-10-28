import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  agentMessageRowToLlm, createUserMessage, estimateAgentMessagesTokens,
  normalizeUserMessageForStorage, projectPromptContext, serializeAgentMessage,
  type AgentMessage,
} from '@zhin.js/ai';
import * as memoryLayers from '../../src/memory-layers.js';
import { buildTurnContextBlocks, type TurnContextView } from '../../src/context/turn-envelope.js';
import { prependTurnContextBlocks } from '../../src/context/turn-user-message.js';

const snapshot = ('## Session\nFILE-MEMORY-FACT: ' + 'Use the agreed publishing process. '.repeat(80)).trim();

function turn(): TurnContextView {
  return {
    origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'group', sceneId: 'group', conversation: {
      endpoint: { adapter: 'icqq', id: 'bot' }, kind: 'group', id: 'group',
      parent: { kind: 'channel', id: 'parent' }, threadId: 'topic',
    } },
    principal: { subjectId: 'alice', roles: ['user'] },
    session: { key: 'icqq:bot:group:group' },
    input: { text: 'continue', locale: 'en' },
  };
}

function message(context = turn(), extra: Parameters<typeof buildTurnContextBlocks>[0] = {}): AgentMessage {
  return prependTurnContextBlocks([createUserMessage('continue', undefined, 1, {
    subjectId: context.principal.subjectId, roles: context.principal.roles, scope: 'group',
  })], buildTurnContextBlocks({ turn: context, ...extra }))[0]!;
}

function text(message: AgentMessage): string {
  return message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
}

describe('file-memory context projection', () => {
  beforeEach(() => {
    vi.spyOn(memoryLayers, 'getFileMemoryContext').mockReturnValue(snapshot);
  });
  afterEach(() => vi.restoreAllMocks());

  it('references an unchanged snapshot in actual projected messages while keeping fresh turn facts', () => {
    const first = message();
    const updated = { ...turn(), principal: { subjectId: 'alice', roles: ['admin'] } };
    const second = message(updated, { modelLine: 'provider/new-model' });
    const projected = projectPromptContext([first, second]);

    expect(text(projected[0]!)).toContain(snapshot);
    expect(text(projected[1]!)).not.toContain('FILE-MEMORY-FACT');
    expect(text(projected[1]!)).toContain('[Unchanged context: file-memory:');
    expect(text(projected[1]!)).toContain('Sender: id=alice roles=admin');
    expect(text(projected[1]!)).toContain('Model: provider/new-model');
    expect(text(projected[1]!)).toContain('Time:');
    expect(projected[0]).toBe(first);
    expect(text(second)).toContain(snapshot);
  });

  it('emits changed and restored versions, including a missing snapshot between identical versions', () => {
    const first = message();
    vi.mocked(memoryLayers.getFileMemoryContext).mockReturnValue('## Session\nUpdated fact');
    const changed = message();
    vi.mocked(memoryLayers.getFileMemoryContext).mockReturnValue('');
    const empty = message();
    vi.mocked(memoryLayers.getFileMemoryContext).mockReturnValue(snapshot);
    const restored = message();
    const projected = projectPromptContext([first, changed, empty, restored]);

    expect(text(projected[1]!)).toContain('Updated fact');
    expect(text(projected[2]!)).toContain('Memory snapshot: not supplied for this turn.');
    expect(text(projected[3]!)).toContain(snapshot);
    expect(projected.every(item => !text(item).includes('[Unchanged context: file-memory:'))).toBe(true);
  });

  it.each(['principal', 'session', 'platform', 'endpoint', 'scene', 'parent', 'thread', 'canonical-endpoint', 'canonical-scene'] as const)(
    'does not reuse a snapshot across a changed %s scope', field => {
      const original = turn();
      if (original.origin.kind !== 'im' || !original.origin.conversation) throw new Error('fixture requires canonical IM');
      const conversation = original.origin.conversation;
      const different: TurnContextView = {
        ...original,
        principal: field === 'principal' ? { subjectId: 'bob', roles: ['user'] } : original.principal,
        session: field === 'session' ? { key: 'another-model-session' } : original.session,
        origin: {
          ...original.origin,
          platform: field === 'platform' ? 'qq' : original.origin.platform,
          endpoint: field === 'endpoint' ? 'another-bot' : original.origin.endpoint,
          sceneId: field === 'scene' ? 'another-group' : original.origin.sceneId,
          conversation: {
            ...conversation,
            endpoint: { ...conversation.endpoint, id: field === 'canonical-endpoint' ? 'another-canonical-bot' : conversation.endpoint.id },
            id: field === 'canonical-scene' ? 'another-canonical-group' : conversation.id,
            parent: field === 'parent' ? { kind: 'channel', id: 'another-parent' } : conversation.parent,
            threadId: field === 'thread' ? 'another-topic' : conversation.threadId,
          },
        },
      };
      const projected = projectPromptContext([message(original), message(different)]);
      expect(text(projected[1]!)).toContain(snapshot);
    },
  );

  it('retains full persisted snapshots and restores their bodies after tail, branch and compaction loads', () => {
    const raw = [message(), message(), message()];
    const stored = raw.map(item => normalizeUserMessageForStorage(item).message);
    const restored = stored.map(item => agentMessageRowToLlm(serializeAgentMessage(item))!);
    expect(restored.every(item => text(item).includes(snapshot))).toBe(true);
    expect(text(projectPromptContext(restored.slice(1))[0]!)).toContain(snapshot);
    expect(text(projectPromptContext([restored[2]!])[0]!)).toContain(snapshot);
    expect(text(projectPromptContext([createUserMessage('earlier summary'), restored[2]!])[1]!)).toContain(snapshot);
    expect(projectPromptContext(restored).slice(0, 2)).toEqual(projectPromptContext(restored.slice(0, 2)));
  });

  it('keeps query-specific recalled memory and the session ledger explicit in each turn', () => {
    const extra = { relevantMemory: 'Relevant memory: current query result', toldLedger: '[Already told the user]\nA commitment' };
    const projected = projectPromptContext([message(turn(), extra), message(turn(), extra)]);
    expect(text(projected[1]!)).toContain(extra.relevantMemory);
    expect(text(projected[1]!)).toContain(extra.toldLedger);
  });

  it('does not read or mark IM file memory for other turn origins', () => {
    const context: TurnContextView = { ...turn(), origin: { kind: 'http', sessionId: 'http' } };
    expect(text(message(context))).not.toContain('Memory snapshot:');
    expect(memoryLayers.getFileMemoryContext).not.toHaveBeenCalled();
  });

  it('represents a snapshot not supplied for this turn and references its unchanged version', () => {
    vi.mocked(memoryLayers.getFileMemoryContext).mockReturnValue('');
    const raw = [message(), message()];
    const projected = projectPromptContext(raw);
    expect(text(projected[0]!)).toContain('Memory snapshot: not supplied for this turn.');
    expect(text(projected[1]!)).toContain('[Unchanged context: file-memory:');
    expect(text(projected[1]!)).not.toContain('Memory snapshot: not supplied for this turn.');
    expect(text(raw[1]!)).toContain('Memory snapshot: not supplied for this turn.');
  });

  it('reduces estimated repeated-snapshot tokens without mutating the stored input', () => {
    const raw = Array.from({ length: 5 }, () => message());
    const projected = projectPromptContext(raw);
    expect(estimateAgentMessagesTokens(projected)).toBeLessThan(estimateAgentMessagesTokens(raw));
    expect(raw.every(item => text(item).includes(snapshot))).toBe(true);
    expect(projected.filter(item => text(item).includes(snapshot))).toHaveLength(1);
  });
});

it('does not assert empty memory after an actual file read failure and emits restored content', () => {
  const cwd = process.cwd();
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-memory-read-failure-'));
  try {
    process.chdir(fixture);
    const memoryFile = path.join(fixture, 'data', 'memory', 'global', 'MEMORY.md');
    fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
    fs.writeFileSync(memoryFile, 'Restorable file-memory fact');
    const first = message();

    fs.unlinkSync(memoryFile);
    fs.mkdirSync(memoryFile);
    expect(() => fs.readFileSync(memoryFile, 'utf-8')).toThrow(expect.objectContaining({ code: 'EISDIR' }));
    expect(memoryLayers.getFileMemoryContext()).toBe('');
    const failedRead = message();
    expect(text(failedRead)).toContain('Memory snapshot: not supplied for this turn.');
    expect(text(failedRead)).not.toContain('(empty)');

    fs.rmdirSync(memoryFile);
    fs.writeFileSync(memoryFile, 'Restorable file-memory fact');
    const restored = message();
    const projected = projectPromptContext([first, failedRead, restored]);
    expect(text(projected[2]!)).toContain('Restorable file-memory fact');
    expect(text(projected[2]!)).not.toContain('[Unchanged context: file-memory:');
  } finally {
    process.chdir(cwd);
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
