import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config/index.js';
import { buildRichSystemPromptParts, type RichSystemPromptContext } from '../../src/prompt/system-prompt.js';
import { appendScene, appendStable, joinSystemPrompt } from '../../src/prompt/assembly.js';
import { sceneLineForTurn } from '../../src/context/turn-envelope.js';
import { structuredReplyInstruction } from '../../src/outbound/structured-reply.js';
import { estimatePromptTokens } from '../../src/prompt/estimate-tokens.js';
import { buildCapabilityContext } from '../../src/plugin-runtime/full-agent-turn-engine.js';
import { PromptAssemblyRegistry } from '../../src/prompt/prompt-assembly-registry.js';
import { BOOTSTRAP_PROMPT_ORDER } from '../../src/prompt/system-prompt.js';
import { rootPluginId } from '@zhin.js/plugin-runtime';

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

  it('is byte-identical for master and member in the same group although their capabilities differ', () => {
    const owner = rootPluginId();
    const skill = (name: string, extra: Record<string, unknown> = {}) => ({
      $feature: 'zhin.skill/1', owner, name, qualifiedName: name, description: `${name} things`, instructions: name, source: 'test', ...extra,
    }) as never;
    const agent = (name: string, extra: Record<string, unknown> = {}) => ({
      $feature: 'zhin.agent/1', owner, name, qualifiedName: name, description: `${name} agent`, instructions: name, source: 'test',
      displayName: name, version: '1', triggerRules: {}, entryPoints: [], workflows: [], knowledge: [], ...extra,
    }) as never;
    // What CapabilityIngress hands each sender: the member's projection lacks the gated entries.
    const master = buildCapabilityContext([agent('helper'), agent('ops', { permissions: ['master'] })],
      [skill('weather'), skill('deploy', { permissions: ['master'] })]);
    const member = buildCapabilityContext([agent('helper')], [skill('weather')]);
    expect(master.stable).toBe(member.stable);
    expect(master.stable).toContain('weather');
    expect(master.stable).not.toMatch(/deploy|ops/);
    expect(master.tail).toMatch(/deploy/);
    expect(master.tail).toMatch(/ops/);
    expect(member.tail).toBe('');

    const systemFor = (turn: Turn, stable: string) => {
      const registry = new PromptAssemblyRegistry();
      registry.register('§11_capabilities', {
        layer: 'system', kind: 'platform', title: 'Turn capabilities', content: stable,
        order: BOOTSTRAP_PROMPT_ORDER.task - 1, budgetOrder: BOOTSTRAP_PROMPT_ORDER.chat, retention: 'preferred',
      });
      // The core run no longer puts the scene line in the system prompt (it is in the message tail).
      return joinSystemPrompt(buildRichSystemPromptParts({
        config: DEFAULT_CONFIG, skillRegistry: null, skillsSummaryXML: '', activeSkillsContext: '',
        bootstrapContext: '## SOUL.md\nBe kind.', orchestratorSdk: 'openai-compatible', modelId: 'm', providerAlias: 'p',
        modelSdk: 'openai-compatible', timeZone: 'UTC', turn, registry,
      })).text;
    };
    const masterTurn = imTurn('group', 'group-a', 'icqq:group:a', ['master'], '1');
    const memberTurn = imTurn('group', 'group-a', 'icqq:group:a', ['user'], '2');
    expect(systemFor(masterTurn, master.stable)).toBe(systemFor(memberTurn, member.stable));
    expect(systemFor(masterTurn, master.stable)).toContain('weather');
    expect(systemFor(masterTurn, master.stable)).not.toContain('scene_id:');
  });

  it('renders set-valued scene fields in a stable order', () => {
    const withAdmins = (adminIds: string[]) => sceneLineForTurn({
      ...imTurn('group', 'group-a', 'icqq:group:a', ['user'], '1'),
      input: { contextState: { conversation: { adminIds, memberCount: 5 } } },
    } as unknown as Turn);
    expect(withAdmins(['30', '10', '20', '10'])).toBe(withAdmins(['10', '20', '30']));
    expect(withAdmins(['30', '10', '20'])).toContain('admins:10,20,30');
  });

  it('reports the stable prefix size', () => {
    const { text, cacheBreakpoint } = promptFor(turns.groupA);
    const tokens = estimatePromptTokens(text.slice(0, cacheBreakpoint!));
    // Regression budget: the cached prefix stays compact (token estimate, not provider billing).
    expect(tokens).toBeGreaterThan(300);
    expect(tokens).toBeLessThanOrEqual(1500);
  });
});
