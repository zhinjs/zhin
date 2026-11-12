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
  it('honors owner-private sections in CRLF workspace files', () => {
    const content = '# Owner notes\r\n<!-- scope: master-private -->\r\nowner-only\r\n## TOOLS.md\r\nstill-private\r\n';
    const result = scopeBootstrapText('', GROUP, { contextFiles: [{ path: 'AGENTS.md', content }] });
    expect(result.text).not.toContain('owner-only');
    expect(result.text).not.toContain('still-private');
    expect(result.skipped).toContain('Owner notes');
    expect(scopeBootstrapText('', MASTER_PRIVATE, { contextFiles: [{ path: 'AGENTS.md', content }] }).text)
      .toContain('owner-only');
  });

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

  it.each([
    ['## Heading \t###\t ', 'Heading'],
    ['## ###\t', '#'],
    ['##  ', ''],
  ])('preserves title and closing-hash parsing for %j', (heading, title) => {
    const text = `${heading}\n<!-- scope: master -->\nprivate\n## Public\nkept`;
    expect(scopeBootstrapText(text, GROUP)).toEqual({ text: '## Public\nkept', skipped: [title] });
  });

  it('does not scope an empty one-space heading or an embedded line terminator', () => {
    for (const heading of ['## ', '## Heading\u2028suffix', '####### Heading']) {
      const text = `${heading}\n<!-- scope: master -->\nkept`;
      expect(scopeBootstrapText(text, GROUP)).toEqual({ text, skipped: [] });
    }
  });

  it('preserves case-insensitive annotations, Unicode whitespace and empty scope comments', () => {
    const text = '## A\n\u00a0<!-- \tSCOPE \t: group \t-->\u00a0\na\n## B\n<!-- scope: -->\nb';
    expect(scopeBootstrapText(text, GROUP)).toEqual({ text: '## A\na\n## B\nb', skipped: [] });
    const invalid = '## A\n<!-- scope: group > -->\nkept';
    expect(scopeBootstrapText(invalid, GROUP)).toEqual({ text: invalid, skipped: [] });
  });

  it('handles long whitespace followed by nonmatching heading, comment and trim suffixes', () => {
    // No wall-clock assertion: these exercise the former backtracking inputs at the public boundary.
    const tabs = '\t'.repeat(65_536);
    const badHeading = `## ${tabs}\r!`;
    expect(scopeBootstrapText(`## A\n<!-- scope: group -->\na\n${badHeading}`, GROUP))
      .toEqual({ text: `## A\na\n${badHeading}`, skipped: [] });
    const badAnnotation = `## A\n<!-- scope:${tabs}group --!`;
    expect(scopeBootstrapText(badAnnotation, GROUP)).toEqual({ text: badAnnotation, skipped: [] });
    expect(scopeBootstrapText(`## A\n<!-- scope: group -->\na${tabs}!`, GROUP))
      .toEqual({ text: `## A\na${tabs}!`, skipped: [] });
    expect(scopeBootstrapText(`## A\n<!-- scope: group -->\na${tabs}\u00a0\n`, GROUP))
      .toEqual({ text: '## A\na\n', skipped: [] });
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
    const im = { origin: { kind: 'im', scope: 'group' }, principal: { roles: ['owner'] } };
    expect(bootstrapSceneFromTurn(im)).toEqual({ kind: 'group', master: true });
    expect(bootstrapSceneFromTurn({ origin: { kind: 'http' }, principal: { roles: [] } })).toEqual({ kind: 'other', master: false });
    expect(bootstrapSceneFromTurn(undefined)).toEqual({ kind: 'other', master: false });
  });
});

it('uses captured file identities instead of document headings when scoping or omitting SOUL', () => {
  const contextFiles = [
    { path: 'SOUL.md', content: 'Omit the parent persona.' },
    { path: 'AGENTS.md', content: '# Public rules\n## SOUL.md\nKeep public instructions.\n# Private\n<!-- scope: master-private -->\nsecret\n## TOOLS.md\nNested secret.' },
    { path: 'TOOLS.md', content: 'Keep real tool guidance.' },
  ];
  const result = scopeBootstrapText('Unused flattened fallback.', GROUP, { contextFiles, excludeFiles: ['SOUL.md'] });
  expect(result.text).toContain('## SOUL.md\nKeep public instructions.');
  expect(result.text).toContain('Keep real tool guidance.');
  expect(result.text).not.toMatch(/Omit the parent|Nested secret|\nsecret/);
  expect(result.skipped).toEqual(['SOUL.md', 'Private']);
  expect(scopeBootstrapText('Latest unrelated fallback.', GROUP, { contextFiles: [] })).toEqual({ text: '', skipped: [] });
});

describe('injection', () => {
  const file = (name: BootstrapFile['name'], content: string): BootstrapFile => ({ name, path: name, content, missing: false });

  it('buildStableBootstrapSection injects only matching sections', () => {
    const files = [file('SOUL.md', DOC)];
    expect(buildStableBootstrapSection(files, { scene: GROUP })).not.toContain('ssh prod');
    expect(buildStableBootstrapSection(files, { scene: MASTER_PRIVATE })).toContain('ssh prod');
    expect(buildStableBootstrapSection(files)).toContain('ssh prod');
  });

  it('treats nested file-name headings in a known source as document headings', () => {
    const content = '# Private\n<!-- scope: master-private -->\nsecret\n## TOOLS.md\nNested secret.\n# Public\nkept';
    const section = buildStableBootstrapSection([file('SOUL.md', content)], { scene: GROUP });
    expect(section).toContain('# Public\nkept');
    expect(section).not.toMatch(/Nested secret|\nsecret/);
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
    expect(group).toContain('## Group etiquette\nbe brief');
    const masterPrivate = buildRichSystemPrompt({ ...base, turn: turn('private', ['owner']) });
    expect(masterPrivate).toContain('ssh prod');
    expect(masterPrivate).not.toContain('## Group etiquette\nbe brief');
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

it('excludes a persona file at existing wrapper boundaries while preserving fenced examples and scene constraints', () => {
  const text = [
    '# Workspace', '## SOUL.md', 'Parent persona.', '# Nested persona heading', 'Parent-only style.',
    '## TOOLS.md', 'Follow the tool workflow.', '```md', '## SOUL.md', 'Example, not a file boundary.', '```',
    '### Private operations', '<!-- scope: master-private -->', 'Private secret note.',
    '## AGENTS.md', 'Keep the original task boundaries.',
  ].join('\n');
  const filtered = scopeBootstrapText(text, GROUP, { excludeFiles: ['SOUL.md'] });
  expect(filtered.text).not.toContain('Parent persona.');
  expect(filtered.text).not.toContain('Parent-only style.');
  expect(filtered.text).not.toContain('Private secret note.');
  expect(filtered.text).toContain('```md\n## SOUL.md\nExample, not a file boundary.\n```');
  expect(filtered.text).toContain('Follow the tool workflow.');
  expect(filtered.text).toContain('Keep the original task boundaries.');
  expect(filtered.skipped).toEqual(['SOUL.md', 'Private operations']);
});
