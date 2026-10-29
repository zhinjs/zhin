import { describe, expect, it } from 'vitest';
import {
  bootstrapSceneFromTurn, parseScopeList, scopeBootstrapText, sceneMatches, type BootstrapScene,
} from '../src/bootstrap-scope.js';
import { buildStableBootstrapSection, type BootstrapFile } from '../src/bootstrap.js';
import { buildRichSystemPrompt } from '../src/prompt/system-prompt.js';
import { DEFAULT_CONFIG } from '../src/config/index.js';
import { buildContextBudgetReport } from '../src/trace/context-budget.js';
import type { TurnContextView } from '../src/context/turn-envelope.js';

const GROUP: BootstrapScene = { kind: 'group', master: false };
const PRIVATE: BootstrapScene = { kind: 'private', master: false };
const MASTER_PRIVATE: BootstrapScene = { kind: 'private', master: true };
const MASTER_GROUP: BootstrapScene = { kind: 'group', master: true };

const DOC = [
  '# Notes',
  'intro',
  '',
  '## Deploy',
  '<!-- scope: master-private -->',
  'ssh prod',
  '',
  '### Secrets',
  'nested deploy detail',
  '',
  '## Group etiquette',
  '',
  '<!-- scope: group -->',
  'be brief',
  '',
  '## Everyone',
  'always',
  '',
  '## Weird',
  '<!-- scope: nonsense, ??? -->',
  'kept',
].join('\n');

describe('scopeBootstrapText', () => {
  it('returns unannotated text untouched', () => {
    const text = '# A\nbody\n\n## B\nmore\n';
    expect(scopeBootstrapText(text, GROUP)).toEqual({ text, skipped: [] });
  });

  it('skips a section and its nested headings for a non-matching scene', () => {
    const r = scopeBootstrapText(DOC, GROUP);
    expect(r.skipped).toEqual(['Deploy']);
    expect(r.text).not.toContain('ssh prod');
    expect(r.text).not.toContain('nested deploy detail');
    expect(r.text).toContain('be brief');
    expect(r.text).toContain('always');
    expect(r.text).not.toContain('scope:');
  });

  it('matches per scene', () => {
    expect(scopeBootstrapText(DOC, MASTER_PRIVATE).text).toContain('ssh prod');
    expect(scopeBootstrapText(DOC, MASTER_PRIVATE).skipped).toEqual(['Group etiquette']);
    expect(scopeBootstrapText(DOC, MASTER_GROUP).skipped).toEqual(['Deploy']);
    expect(scopeBootstrapText(DOC, PRIVATE).skipped).toEqual(['Deploy', 'Group etiquette']);
  });

  it('treats an annotation with only unknown values as absent (section stays)', () => {
    const r = scopeBootstrapText(DOC, GROUP);
    expect(r.text).toContain('kept');
    expect(r.skipped).not.toContain('Weird');
  });

  it('supports lists and a single-part master scope', () => {
    const text = '## A\n<!-- scope: group, master-private -->\nx\n## B\n<!-- scope: master -->\ny';
    expect(scopeBootstrapText(text, GROUP).skipped).toEqual(['B']);
    expect(scopeBootstrapText(text, MASTER_PRIVATE).skipped).toEqual([]);
    expect(scopeBootstrapText(text, PRIVATE).skipped).toEqual(['A', 'B']);
  });

  it('ends a skipped section at a heading of the same or higher level only', () => {
    const text = '## A\n<!-- scope: group -->\na\n### A1\na1\n## B\nb\n';
    const r = scopeBootstrapText(text, PRIVATE);
    expect(r.text).toContain('## B');
    expect(r.text).not.toContain('a1');
  });

  it('lets a nested annotation narrow a kept parent', () => {
    const text = '## P\np\n### C\n<!-- scope: master -->\nc\n### D\nd';
    const r = scopeBootstrapText(text, GROUP);
    expect(r.text).toContain('p');
    expect(r.text).toContain('### D');
    expect(r.text).not.toContain('\nc');
    expect(r.skipped).toEqual(['C']);
  });

  it('ignores headings and annotations inside code fences', () => {
    const text = '## A\n```\n## B\n<!-- scope: master -->\n```\nafter';
    expect(scopeBootstrapText(text, GROUP)).toEqual({ text, skipped: [] });
  });

  it('does not let a level-1 section swallow the next file wrapper', () => {
    const text = '## SOUL.md\n# S\n<!-- scope: master -->\nsoul\n\n## AGENTS.md\nagents';
    const r = scopeBootstrapText(text, GROUP);
    expect(r.text).toContain('## AGENTS.md');
    expect(r.text).toContain('agents');
    expect(r.text).not.toContain('soul');
  });

  it('is byte-stable per scene', () => {
    expect(scopeBootstrapText(DOC, GROUP).text).toBe(scopeBootstrapText(DOC, { ...GROUP }).text);
  });
});

describe('scope parsing', () => {
  it('parses lists and drops unknown items', () => {
    expect(parseScopeList('group, Master-Private, bogus')).toEqual([['group'], ['master', 'private']]);
    expect(parseScopeList('bogus')).toBeNull();
    expect(sceneMatches([['master', 'private']], MASTER_PRIVATE)).toBe(true);
    expect(sceneMatches([['master', 'private']], PRIVATE)).toBe(false);
  });

  it('derives scene facts from a turn', () => {
    const im = { origin: { kind: 'im', scope: 'group' }, principal: { roles: ['master'] } };
    expect(bootstrapSceneFromTurn(im)).toEqual({ kind: 'group', master: true });
    expect(bootstrapSceneFromTurn({ origin: { kind: 'http' }, principal: { roles: [] } })).toEqual({ kind: 'other', master: false });
    expect(bootstrapSceneFromTurn(undefined)).toEqual({ kind: 'other', master: false });
  });
});

describe('injection', () => {
  const file = (name: BootstrapFile['name'], content: string): BootstrapFile => ({ name, path: name, content, missing: false });

  it('buildStableBootstrapSection injects only matching sections', () => {
    const files = [file('SOUL.md', DOC)];
    expect(buildStableBootstrapSection(files, { scene: GROUP })).not.toContain('ssh prod');
    expect(buildStableBootstrapSection(files, { scene: MASTER_PRIVATE })).toContain('ssh prod');
    expect(buildStableBootstrapSection(files)).toContain('ssh prod');
  });

  const turn = (scope: 'group' | 'private', roles: string[], key = 'k', subjectId = '1'): TurnContextView => ({
    origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope, sceneId: 's' },
    principal: { subjectId, roles }, session: { key },
  } as TurnContextView);
  const base = {
    config: DEFAULT_CONFIG, skillRegistry: null, skillsSummaryXML: '', activeSkillsContext: '',
    bootstrapContext: `## SOUL.md\n${DOC}`,
  } as const;

  it('§11_bootstrap follows the turn scene and is byte-stable across senders of the same kind', () => {
    const group = buildRichSystemPrompt({ ...base, turn: turn('group', []) });
    expect(group).not.toContain('ssh prod');
    expect(group).toContain('be brief');
    const masterPrivate = buildRichSystemPrompt({ ...base, turn: turn('private', ['master']) });
    expect(masterPrivate).toContain('ssh prod');
    expect(masterPrivate).not.toContain('be brief');
    expect(buildRichSystemPrompt({ ...base, turn: turn('group', [], 'other', '99') })).toBe(group);
  });

  it('lists skipped titles (titles only) in the context budget report', () => {
    const skipped = scopeBootstrapText(base.bootstrapContext, GROUP).skipped;
    const report = buildContextBudgetReport({
      systemPrompt: 'x', bootstrapSkipped: skipped, loadedTools: [], deferredToolCount: 0,
      historyMessages: [], userMessages: [],
    });
    expect(report.bootstrap_skipped).toEqual(['Deploy']);
    expect(JSON.stringify(report)).not.toContain('ssh prod');
    expect(buildContextBudgetReport({
      systemPrompt: 'x', loadedTools: [], deferredToolCount: 0, historyMessages: [], userMessages: [],
    }).bootstrap_skipped).toBeUndefined();
  });
});
