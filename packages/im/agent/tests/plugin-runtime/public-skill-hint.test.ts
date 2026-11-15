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
    const api = skill('api-docs', ['api', 'openapi']);
    expect(suggestPublicSkillsForIntent([api], 'a rapid fix')).toEqual([]);
    expect(suggestPublicSkillsForIntent([api], '写api文档').map(entry => entry.name)).toEqual(['api-docs']);
    expect(suggestPublicSkillsForIntent([github], 'please open a pull request').map(entry => entry.name)).toEqual(['github']);
  });

  describe('keyword stuffing', () => {
    const stuffer = skill('stuffer', [
      '你', '好', '我', '帮', '的', '一', '你好', '请问', '帮我', '一下', '这个', '怎么', '可以',
      'a', 'pr', 'is', 'please', 'open', 'hello', 'help', 'the', 'and', 'you', 'what',
    ]);

    it('single characters and stopwords never earn a hint, even in small talk', () => {
      for (const text of ['你好', '你好呀，请问一下', 'hello, can you help me', 'please open a PR']) {
        expect(suggestPublicSkillsForIntent([stuffer], text), text).toEqual([]);
      }
    });

    it('a stuffed Skill does not outrank a legitimate one', () => {
      for (const text of ['你好，帮我写一个 PR 描述', '帮我写PR描述可以吗', 'please open a pull request']) {
        expect(suggestPublicSkillsForIntent([stuffer, github], text).map(entry => entry.name), text).toEqual(['github']);
      }
    });

    it('scores only the longest matching keyword, without summing many matches', () => {
      const many = skill('many', ['deploy', 'docker', 'server', 'build', 'release']);
      const precise = skill('precise', ['docker deploy']);
      // `many` matches five keywords but scores only its longest one, so it ranks below `precise`.
      expect(suggestPublicSkillsForIntent([many, precise], 'docker deploy to the server, then build a release').map(entry => entry.name))
        .toEqual(['precise', 'many']);
    });

    it('only the first keywords count, and over-long keywords are ignored', () => {
      const late = skill('late', [...Array.from({ length: 12 }, (_, index) => `filler-${index}`), 'deploy']);
      expect(suggestPublicSkillsForIntent([late], 'deploy now')).toEqual([]);
      const long = skill('long', ['x'.repeat(40)]);
      expect(suggestPublicSkillsForIntent([long], `${'x'.repeat(40)} please`)).toEqual([]);
    });
  });

  describe('adversarial keywords (#1292 review)', () => {
    const legit = skill('legit', ['翻译', 'translate']);
    const evil = (keywords: readonly string[]) => skill('evil', keywords);
    const names = (skills: readonly SkillDescriptor[]) => skills.map(entry => entry.name);

    it('spaces inside a CJK keyword do not inflate its score', () => {
      expect(names(suggestPublicSkillsForIntent([evil(['我 的']), legit], '帮我翻译我的文章'))).toEqual(['legit']);
      expect(names(suggestPublicSkillsForIntent([evil(['帮 我 翻']), legit], '帮我翻译'))).toEqual(['legit']);
      // `部 署` scores like `部署` (2), so the name order decides and `a-plain` comes first.
      const spaced = skill('z-spaced', ['部 署']);
      const plain = skill('a-plain', ['部署']);
      expect(names(suggestPublicSkillsForIntent([spaced, plain], '帮我部署服务'))).toEqual(['a-plain', 'z-spaced']);
    });

    const hijacks = [
      '能不能帮我', '帮我看看', '你好啊', '可以吗', '谢谢你', '我的', '的话', '了吗',
      '???', '。。。', '123', '😀😀😀', 'hi!', "what's",
    ];
    for (const keyword of hijacks) {
      it(`"${keyword}" cannot push the legitimate Skill out of the hint`, () => {
        for (const text of [`${keyword}帮我翻译我的文章`, `帮我翻译我的文章${keyword}`, `${keyword} translate this, ${keyword}`]) {
          const suggested = names(suggestPublicSkillsForIntent([evil([keyword]), legit], text));
          expect(suggested, text).toContain('legit');
          expect(suggested, text).not.toContain('evil');
        }
      });

      it(`"${keyword}" never triggers a hint in small talk`, () => {
        for (const text of ['你好', '谢谢', keyword, `你好${keyword}`, `${keyword} 谢谢`, `hi ${keyword}`]) {
          expect(suggestPublicSkillsForIntent([evil([keyword]), legit], text), text).toEqual([]);
        }
      });
    }

    it('a higher-scoring Skill does not push a matching one out of the hint', () => {
      const broad = skill('broad', ['翻译这篇文章']);
      expect(names(suggestPublicSkillsForIntent([broad, legit], '帮我翻译这篇文章'))).toEqual(['broad', 'legit']);
    });
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
    expect(buildCapabilityContext([], [github], undefined, [], { text: 'PR 描述', loadedSkills: ['github'] }).tail).toBe('');
    expect(buildCapabilityContext([], [github], undefined, [], { text: '今天天气怎么样' }).tail).toBe('');
  });
});
