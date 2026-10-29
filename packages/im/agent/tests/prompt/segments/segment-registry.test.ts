import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, SECTION_SEP } from '../../../src/config/index.js';
import {
  PromptSegmentRegistry,
  type PromptSegment,
  type SegmentInput,
  type TextSegmentKind,
} from '../../../src/prompt/segments/index.js';
import { PromptAssemblyRegistry } from '../../../src/prompt/prompt-assembly-registry.js';
import {
  buildRichSystemPrompt,
  buildRichSystemPromptParts,
  createBuiltinPromptSegments,
  describePromptSectionsForDebug,
  type RichSystemPromptContext,
} from '../../../src/prompt/system-prompt.js';
import { collectPromptSegments } from '../../../src/plugin-runtime/capability-ingress.js';
import { promptSegmentToken } from '../../../src/prompt/tokens.js';

const input: SegmentInput = { history: [], runtime: {}, session: { sessionKey: 's' } };
const text = (id: string, kind: TextSegmentKind, weight: number, content: string, extra: Partial<PromptSegment> = {}): PromptSegment =>
  ({ id, kind, weight, inject: () => content, ...extra }) as PromptSegment;

const baseContext = {
  config: DEFAULT_CONFIG,
  skillRegistry: null,
  skillsSummaryXML: '',
  activeSkillsContext: '',
  bootstrapContext: '## SOUL.md\nBe kind.',
} satisfies RichSystemPromptContext;
const imTurn = {
  origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'group', sceneId: 'g' },
  principal: { subjectId: '1', roles: [] }, session: { key: 's' },
} as RichSystemPromptContext['turn'];

describe('PromptSegmentRegistry text kinds', () => {
  it('orders by kind first, then descending weight', () => {
    const registry = new PromptSegmentRegistry()
      .registerAll([
        text('scene', 'scene', 999, 'SCENE'),
        text('plat', 'platform', 1, 'PLAT'),
        text('rules-low', 'role_rules', 1, 'RULES-LOW'),
        text('rules-high', 'role_rules', 50, 'RULES-HIGH'),
        text('env', 'environment', 5, 'ENV'),
        text('sys-low', 'system', 1, 'SYS-LOW'),
        text('sys-high', 'system', 9, 'SYS-HIGH'),
      ]);
    expect(registry.buildSystemPrompt(input, 0)).toBe(
      ['SYS-HIGH', 'SYS-LOW', 'ENV', 'RULES-HIGH', 'RULES-LOW', 'PLAT', 'SCENE'].join(SECTION_SEP),
    );
  });

  it('rejects duplicate ids and supports unregistering', () => {
    const registry = new PromptSegmentRegistry();
    const off = registry.register(text('a', 'system', 1, 'A'));
    expect(() => registry.register(text('a', 'platform', 1, 'A2'))).toThrow(/Duplicate Prompt Segment: a/);
    off();
    expect(registry.has('a')).toBe(false);
    registry.register(text('a', 'platform', 1, 'A2'));
    expect(registry.unregister('a')).toBe(true);
    expect(() => registry.register(text('', 'system', 1, 'x'))).toThrow(/non-empty id/);
    expect(() => registry.register(text('bad', 'nope' as never, 1, 'x'))).toThrow(/unknown kind/);
  });

  it('trims preferred segments for the budget but keeps required ones, and reports it', () => {
    const registry = new PromptSegmentRegistry().registerAll([
      text('required', 'system', 10, 'R'.repeat(60), { retention: 'required' }),
      text('preferred', 'platform', 5, 'P'.repeat(200), { retention: 'preferred' }),
      text('optional', 'platform', 1, 'O'.repeat(40), { retention: 'opportunistic' }),
    ]);
    const parts = registry.buildSystemPromptParts(input, 150);
    expect(parts.text.length).toBeLessThanOrEqual(150);
    expect(parts.text).toContain('R'.repeat(60));
    expect(parts.text).not.toContain('O');
    const byId = Object.fromEntries(parts.segments.map(segment => [segment.id, segment]));
    expect(byId.required).toMatchObject({ kind: 'system', weight: 10, chars: 60, trimmed: false });
    expect(byId.preferred!.trimmed).toBe(true);
    expect(byId.optional).toMatchObject({ chars: 0, trimmed: true });
    expect(() => registry.buildSystemPrompt(input, 40)).toThrow(/exceed the 40 character budget/);
  });

  it('skips blank output and keeps scene after the cache breakpoint', () => {
    const registry = new PromptSegmentRegistry().registerAll([
      text('sys', 'system', 1, 'STABLE'),
      text('blank', 'platform', 1, '   '),
      { id: 'null', kind: 'platform', weight: 1, inject: () => null } as PromptSegment,
      text('scene', 'scene', 1, 'SCENE'),
    ]);
    const parts = registry.buildSystemPromptParts(input, 0);
    expect(parts.stable).toBe('STABLE');
    expect(parts.scene).toBe('SCENE');
    expect(parts.text.slice(parts.cacheBreakpoint)).toBe('SCENE');
    expect(parts.segments.map(segment => segment.id)).toEqual(['sys', 'scene']);
    expect(new PromptSegmentRegistry().register(text('x', 'system', 1, 'X'))).toBeTypeOf('function');
    expect(new PromptSegmentRegistry().buildSystemPromptParts(input, 0).cacheBreakpoint).toBe(-1);
  });
});

describe('built-in segment mapping (ADR 0041 §3)', () => {
  it('maps each default section onto a kind', () => {
    const mapping = (turn?: RichSystemPromptContext['turn']) => createBuiltinPromptSegments({ ...baseContext, turn, gitStatus: 'main (clean)' })
      .map(segment => `${segment.id} -> ${segment.kind} @${segment.weight} ${segment.retention}`);
    expect(mapping(imTurn)).toMatchInlineSnapshot(`
      [
        "§1_persona -> role_rules @160 required",
        "§1_runtime -> environment @160 required",
        "§1b_critical_rules -> system @150 required",
        "§1c_workflow -> role_rules @140 required",
        "§1d_model_style -> role_rules @130 required",
        "§3_tools -> platform @120 required",
        "§4_security -> system @110 required",
        "§5_error_handling -> role_rules @90 preferred",
        "§5b_editing -> role_rules @80 preferred",
        "§5c_task_completion -> role_rules @70 preferred",
        "§5d_code_references -> role_rules @60 preferred",
        "§5e_memory_instructions -> role_rules @50 preferred",
        "§5f_context_mode -> environment @40 preferred",
        "§8_skills -> platform @30 preferred",
        "§10_global -> role_rules @20 preferred",
        "§11_bootstrap -> role_rules @155 preferred",
        "§12_git_status -> scene @5 preferred",
      ]
    `);
  });

  it('renders the stable kinds in order with the clock-free environment', () => {
    const sections = describePromptSectionsForDebug({ ...baseContext, turn: imTurn, gitStatus: 'main (clean)' });
    expect(sections.map(section => `${section.kind}:${section.id}`)).toEqual([
      'system:§1b_critical_rules',
      'system:§4_security',
      'environment:§1_runtime',
      'role_rules:§1_persona',
      'role_rules:§11_bootstrap',
      'role_rules:§1c_workflow',
      'role_rules:§1d_model_style',
      'platform:§3_tools',
      'scene:§12_git_status',
    ]);
    expect(sections.every(section => section.trimmed === false && section.chars > 0)).toBe(true);
  });

  it('has no wall clock in the environment segment', () => {
    const prompt = buildRichSystemPrompt({ ...baseContext, turn: imTurn, modelId: 'm', providerAlias: 'p', modelSdk: 'openai' });
    const runtime = prompt.split(SECTION_SEP).find(part => part.startsWith('# Runtime'))!;
    expect(runtime).toContain('Timezone:');
    expect(runtime).not.toMatch(/\d{1,2}:\d{2}(:\d{2})?/);
    expect(runtime).not.toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
    expect(runtime).not.toMatch(/current (time|date)|\bnow\b/i);
  });

  it('keeps the stable prefix byte-identical across turns and moves only the scene', async () => {
    const build = (gitStatus: string, sceneText: string) => buildRichSystemPromptParts({
      ...baseContext, turn: imTurn, modelId: 'm', providerAlias: 'p', modelSdk: 'openai', gitStatus, sceneText,
    });
    const first = build('main (clean)', '[scene_id:g;scene_name:旧群名]');
    await new Promise(resolve => setTimeout(resolve, 5));
    const second = build('main (dirty)', '[scene_id:g;scene_name:新群名]');
    expect(second.stable).toBe(first.stable);
    expect(second.text.startsWith(first.stable)).toBe(true);
    expect(second.scene).not.toBe(first.scene);
    expect(first.text.slice(0, first.cacheBreakpoint)).toBe(`${first.stable}${SECTION_SEP}`);
    expect(first.text.slice(first.cacheBreakpoint)).toBe(first.scene);
    expect(first.scene).toContain('旧群名');
    expect(first.scene).toContain('main (clean)');
  });
});

describe('plugin contributions', () => {
  it('places a plugin platform segment in the platform kind, before the scene', () => {
    const parts = buildRichSystemPromptParts({
      ...baseContext,
      turn: imTurn,
      gitStatus: 'main',
      segments: [text('plugin:hint', 'platform', 1, '# Plugin hint\nBe brief.')],
    });
    const at = (needle: string) => parts.text.indexOf(needle);
    expect(at('# Plugin hint')).toBeGreaterThan(at('# Chat style'));
    expect(at('# Plugin hint')).toBeLessThan(at('# Git'));
    expect(parts.segments.find(segment => segment.id === 'plugin:hint')).toMatchObject({ kind: 'platform', weight: 1 });
  });

  it('throws on an id clash with a built-in', () => {
    expect(() => buildRichSystemPrompt({
      ...baseContext, segments: [text('§4_security', 'system', 1, 'dup')],
    })).toThrow(/Duplicate Prompt Segment/);
  });

  it('collects segments from the generation scopes and drops them with the generation', () => {
    const segment = text('plugin:hint', 'platform', 1, 'Plugin guidance');
    const second = text('other:hint', 'scene', 1, 'Other');
    const generation = (...entries: Array<[string, unknown]>) => ({
      resources: new Map(entries.map(([plugin, value]) => [plugin, new Map([[promptSegmentToken.id, value]])])),
    }) as never;
    const live = collectPromptSegments(generation(['owner', segment], ['other', [second]]), 'owner' as never);
    expect(live.map(item => item.id)).toEqual(['plugin:hint', 'other:hint']);
    // Third-party text is labelled; the owner's own segment is not.
    expect(live[0]!.inject(input)).toBe('Plugin guidance');
    expect(live[1]!.inject(input)).toMatch(/^\[external_content source="plugin:other"[^\]]*\]\nOther$/);
    // The next generation no longer provides the token.
    expect(collectPromptSegments(generation(['owner', undefined]), 'owner' as never)).toEqual([]);
  });

  it('adapts the deprecated PromptAssemblyRegistry onto text segments', () => {
    const legacy = new PromptAssemblyRegistry();
    legacy.register('legacy:safe', { layer: 'safety', title: 'Safe', content: 'SAFE', order: 5, retention: 'preferred' });
    legacy.register('legacy:tail', { layer: 'tools', title: 'Tail', content: 'TAIL', order: 900, placement: 'tail', retention: 'preferred' });
    legacy.register('legacy:tools', { layer: 'tools', title: 'Tools', content: 'TOOLS', order: 1, retention: 'preferred' });
    const segments = legacy.toSegments();
    expect(segments.map(segment => [segment.id, segment.kind])).toEqual([
      ['legacy:safe', 'system'], ['legacy:tail', 'platform'], ['legacy:tools', 'platform'],
    ]);
    expect(legacy.build(0)).toBe(['SAFE', 'TOOLS', 'TAIL'].join(SECTION_SEP));
  });
});
