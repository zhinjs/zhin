import { describe, expect, it } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { SkillDescriptor } from '@zhin.js/skill';
import { buildCapabilityContext } from '../../src/plugin-runtime/full-agent-turn-engine.js';
import {
  PUBLIC_SKILL_HINT_MAX,
  primeAgentSkillForIntent,
  suggestPublicSkillsForIntent,
} from '../../src/plugin-runtime/deferred-capability-plan.js';
import { SKILL_HINT_HEADING } from '../../src/plugin-runtime/turn-engine-helpers.js';

const owner = rootPluginId();
const skill = (name: string, keywords: readonly string[], extra: Record<string, unknown> = {}) => ({
  $feature: 'zhin.skill/1', owner, name, qualifiedName: name, description: `${name} things`,
  instructions: `${name} instructions`, source: 'test', keywords, ...extra,
}) as unknown as SkillDescriptor;

const github = skill('github', ['github', 'issue', 'pull request', 'pr', 'PR 描述', '写 issue']);
const summarize = skill('summarize', ['summarize', '总结', '复盘']);

describe('public Skill hint (#1250 b27)', () => {
  it('suggests the public Skill whose keywords best match the message', () => {
    expect(suggestPublicSkillsForIntent([github, summarize], '帮我写一个 PR 描述').map(entry => entry.name)).toEqual(['github']);
    expect(suggestPublicSkillsForIntent([github, summarize], '帮我写PR描述').map(entry => entry.name)).toEqual(['github']);
    expect(suggestPublicSkillsForIntent([github, summarize], '把今天的讨论总结一下').map(entry => entry.name)).toEqual(['summarize']);
  });

  it('matches ASCII keywords as whole words only', () => {
    expect(suggestPublicSkillsForIntent([github], 'improve this prompt')).toEqual([]);
    expect(suggestPublicSkillsForIntent([github], 'open a PR, please').map(entry => entry.name)).toEqual(['github']);
  });

  it('skips Agent-private, keyword-less and already loaded Skills', () => {
    const privateSkill = skill('icqq-admin', ['pr'], { agentName: 'icqq' });
    const bare = skill('bare', []);
    expect(suggestPublicSkillsForIntent([privateSkill, bare], 'pr')).toEqual([]);
    expect(suggestPublicSkillsForIntent([github], 'pr', ['github'])).toEqual([]);
    expect(suggestPublicSkillsForIntent([github], '   ')).toEqual([]);
  });

  it('names at most the tied best Skills', () => {
    const skills = ['a', 'b', 'c'].map(name => skill(name, ['deploy']));
    expect(suggestPublicSkillsForIntent(skills, 'deploy now').map(entry => entry.name))
      .toEqual(['a', 'b'].slice(0, PUBLIC_SKILL_HINT_MAX));
  });

  it('only hints: the Skill is not activated and the cached catalog is unchanged', () => {
    const plain = buildCapabilityContext([], [github, summarize]);
    const hinted = buildCapabilityContext([], [github, summarize], undefined, [], { text: '帮我写一个 PR 描述' });
    expect(hinted.stable).toBe(plain.stable);
    expect(plain.tail).toBe('');
    expect(hinted.tail).toContain(SKILL_HINT_HEADING);
    expect(hinted.tail).toContain('load_skill("github")');
    expect(hinted.tail).toContain('not loaded automatically');
    expect(hinted.tail).not.toContain('github instructions');
    expect(hinted.tail).not.toContain('summarize');
    // Keyword priming still activates Agent-private Skills only.
    const primed = primeAgentSkillForIntent({
      capabilities: { tools: [], skills: [github] } as never,
      sessionSnapshot: { loadedTools: {}, loadedSkills: [] },
      intent: '帮我写一个 PR 描述',
      config: { deferredTools: {} },
    });
    expect(primed.skill).toBeUndefined();
    expect(primed.snapshot.loadedSkills).toEqual([]);
  });

  it('adds no hint once the Skill is loaded or nothing matches', () => {
    expect(buildCapabilityContext([], [github], undefined, [], { text: 'PR', loadedSkills: ['github'] }).tail).toBe('');
    expect(buildCapabilityContext([], [github], undefined, [], { text: '今天天气怎么样' }).tail).toBe('');
  });
});
