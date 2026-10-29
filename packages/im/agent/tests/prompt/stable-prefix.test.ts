import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config/index.js';
import { buildRichSystemPromptParts, type RichSystemPromptContext } from '../../src/prompt/system-prompt.js';
import { appendScene, appendStable, joinSystemPrompt } from '../../src/prompt/assembly.js';
import { sceneLineForTurn } from '../../src/context/turn-envelope.js';
import { structuredReplyInstruction } from '../../src/outbound/structured-reply.js';
import { estimatePromptTokens } from '../../src/prompt/estimate-tokens.js';

type Turn = NonNullable<RichSystemPromptContext['turn']>;

function imTurn(scope: 'group' | 'private', sceneId: string, sessionKey: string, roles: string[], sender: string): Turn {
  return {
    origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope, sceneId },
    principal: { subjectId: sender, displayName: `user-${sender}`, roles },
    session: { key: sessionKey },
    input: { commandPrefix: scope === 'group' ? '/' : '!', locale: scope === 'group' ? 'zh-CN' : 'en-US' },
  } as unknown as Turn;
}

function promptFor(turn: Turn, extra: Partial<RichSystemPromptContext> = {}) {
  const parts = buildRichSystemPromptParts({
    config: DEFAULT_CONFIG,
    skillRegistry: null,
    skillsSummaryXML: '',
    activeSkillsContext: '',
    bootstrapContext: '## SOUL.md\nBe kind.',
    orchestratorSdk: 'openai-compatible',
    modelId: 'm',
    providerAlias: 'p',
    modelSdk: 'openai-compatible',
    timeZone: 'UTC',
    turn,
    sceneText: sceneLineForTurn(turn),
    ...extra,
  });
  // Mirrors agent-core-run: per-platform reply instruction is stable, scene facts are the tail.
  return joinSystemPrompt(appendStable({ stable: parts.stable, scene: parts.scene }, structuredReplyInstruction()));
}

describe('stable system prompt prefix (ADR 0042 §1)', () => {
  beforeEach(() => { vi.spyOn(process, 'cwd').mockReturnValue('/srv/zhin'); });
  afterEach(() => { vi.restoreAllMocks(); });

  const turns = {
    groupA: imTurn('group', 'group-a', 'icqq:group:a', ['user'], '1'),
    groupB: imTurn('group', 'group-b', 'icqq:group:b', ['master', 'trusted'], '2'),
    privateChat: imTurn('private', 'friend-3', 'icqq:private:3', ['user'], '3'),
    adminInGroup: imTurn('group', 'group-a', 'icqq:group:a:thread', ['group_admin'], '4'),
  };

  it('is byte-identical across groups, private chat and sender roles', () => {
    const [first, ...rest] = Object.values(turns).map(turn => joinSystemPrompt({
      ...buildRichSystemPromptParts({
        config: DEFAULT_CONFIG, skillRegistry: null, skillsSummaryXML: '', activeSkillsContext: '',
        bootstrapContext: '## SOUL.md\nBe kind.', orchestratorSdk: 'openai-compatible', modelId: 'm', providerAlias: 'p',
        modelSdk: 'openai-compatible', timeZone: 'UTC', turn, sceneText: sceneLineForTurn(turn),
      }),
    }));
    expect(first!.cacheBreakpoint).toBeGreaterThan(0);
    const stableOf = (prompt: ReturnType<typeof joinSystemPrompt>) => prompt.text.slice(0, prompt.cacheBreakpoint! - '\n\n---\n\n'.length);
    for (const other of rest) expect(stableOf(other)).toBe(stableOf(first!));
  });

  it('keeps the stable part equal and the scene tail different per conversation', () => {
    const results = Object.values(turns).map(turn => promptFor(turn));
    const stable = (p: ReturnType<typeof promptFor>) => p.text.slice(0, p.cacheBreakpoint! - '\n\n---\n\n'.length);
    const scene = (p: ReturnType<typeof promptFor>) => p.text.slice(p.cacheBreakpoint!);
    for (const result of results) expect(stable(result)).toBe(stable(results[0]!));
    expect(new Set(results.map(scene)).size).toBeGreaterThan(1);
    expect(scene(results[0]!)).toContain('scene_id:group-a');
    expect(scene(results[2]!)).toContain('scene_id:friend-3');
    for (const result of results) {
      expect(stable(result)).not.toMatch(/group-[ab]|friend-3|icqq:(group|private)|user-\d/);
    }
  });

  it('keeps session rules, memory paths, command prefix and sender out of the system prompt', () => {
    for (const turn of Object.values(turns)) {
      const { text } = promptFor(turn);
      expect(text).not.toMatch(/Session rules[ (:]|Memory paths:|Chat command prefix:|Sender: id=|Reply language fallback:/);
    }
  });

  it('moves per-turn tail additions after the breakpoint', () => {
    const base = promptFor(turns.groupA);
    const plain = { stable: base.text.slice(0, base.cacheBreakpoint! - 7), scene: base.text.slice(base.cacheBreakpoint!) };
    const tail = joinSystemPrompt(appendScene(plain, 'Pre-fetched data:\nX'));
    expect(tail.text.startsWith(plain.stable)).toBe(true);
    expect(tail.text.slice(tail.cacheBreakpoint!)).toContain('Pre-fetched data:');
    expect(tail.cacheBreakpoint).toBe(base.cacheBreakpoint);
  });

  it('reports the stable prefix size', () => {
    const { text, cacheBreakpoint } = promptFor(turns.groupA);
    const tokens = estimatePromptTokens(text.slice(0, cacheBreakpoint!));
    // Regression budget: the cached prefix stays compact (token estimate, not provider billing).
    expect(tokens).toBeGreaterThan(300);
    expect(tokens).toBeLessThanOrEqual(1500);
  });
});
