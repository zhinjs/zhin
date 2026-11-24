import { describe, expect, it, vi } from 'vitest';
import { rootPluginId, type Locale } from '@zhin.js/plugin-runtime';
import { markdownToPlainText, projectUserInteraction, renderUserInteraction, type UserInteractionRequest } from '@zhin.js/core';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { approvalCardMarkdown, createRuntimeApprovalPort } from '../../src/plugin-runtime/ingress/request-ports.js';
import { TurnProvenance } from '../../src/security/provenance.js';
import { codeDisplayName, describeProvenanceChain } from '../../src/security/high-risk-explain.js';
import { formatHardGateQuestion } from '../../src/security/tool-hard-gate.js';
import { describeApprovalAction, markdownLiteral, markdownLiteralLines } from '../../src/tool/approval-presentation.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';

/** #1250 b102: upstream and model-chosen text on an approval card is shown literally, never as Markdown. */

/** Markdown an attacker would write into an MCP description or a tool argument. */
const PAYLOADS = [
  '[点我](https://evil.example/x)',
  '![](https://evil.example/pixel.png)',
  '<img src=x onerror=alert(1)>',
  '<a href="https://evil.example">x</a>',
  '<https://evil.example/auto>',
  'open `unclosed',
  'run ``` fence `` and ` ticks',
  '**bold** *em* _em_ __strong__ ~~del~~',
  '# heading',
  '> quote',
  '| a | b |',
  '- item',
  '1. item',
];

/** Single-backtick code spans of one line (the only kind the card writes), as CommonMark reads them. */
function codeSpans(line: string): string[] {
  return [...line.matchAll(/`([^`]+)`/gu)].map((match) => match[1]!);
}

/** The text of a line outside its code spans: what a Markdown renderer would interpret. */
function outsideCode(line: string): string {
  return line.replace(/`[^`]+`/gu, '');
}

/** True when the line's backticks all pair into code spans (no stray backtick to pair with another line). */
function balanced(line: string): boolean {
  return (outsideCode(line).match(/`/gu) ?? []).length === 0;
}

/** What a renderer without inline code support would still read as a link, image or HTML tag. */
const ACTIVE = /\]\(|!\[|<[A-Za-z/!?]/u;

describe('markdownLiteral (#1250 b102)', () => {
  it.each(PAYLOADS)('keeps %j inside one code span that no renderer can leave', (payload) => {
    const literal = markdownLiteral(payload);
    expect(literal).toMatch(/^`[^`\n]+`$/u);
    expect(codeSpans(literal)).toHaveLength(1);
    expect(outsideCode(literal)).toBe('');
    // Without inline code support a renderer still finds no link, image or tag (an invisible word joiner breaks them).
    expect(literal).not.toMatch(ACTIVE);
  });

  it('shows the text itself in the plain-text fallback: no backslash, no backtick', () => {
    for (const payload of PAYLOADS) {
      const plain = markdownToPlainText(`标签：${markdownLiteral(payload)}`).replace(/⁠/gu, '');
      expect(plain).toBe(`标签：${payload.replace(/`/gu, '｀')}`);
      expect(plain).not.toContain('\\');
      expect(plain).not.toContain('`');
    }
  });

  it('turns line breaks into spaces, and keeps lines with markdownLiteralLines', () => {
    expect(markdownLiteral('a\nb\r\nc d')).toBe('`a b c d`');
    expect(markdownLiteralLines('ls\ncat <x')).toBe('`ls`\n`cat <⁠x`');
    expect(markdownLiteral('')).toBe('');
  });

  it('folds every line terminator and replaces private-use code points (renderer placeholder markers)', () => {
    expect(markdownLiteral('a\vb\fc\u0085d e f\rg')).toBe('`a b c d e f g`');
    // Telegram's converter swaps code spans back through private-use markers; a planted marker must not survive.
    const literal = markdownLiteral('0 1 \u{f0000}2');
    expect(literal).toBe('`�0 �1 �2`');
    expect(literal).not.toMatch(/\p{Co}/u);
  });

  it('breaks platform mentions such as <@id>, <@&role> and <#channel>', () => {
    expect(markdownLiteral('<@123> <@&9> <#5>')).toBe('`<⁠@123> <⁠@&9> <⁠#5>`');
  });

  it('writes names as code spans, so underscores never pair into emphasis across a line', () => {
    expect(codeDisplayName('web_fetch')).toBe('`web_fetch`');
    expect(codeDisplayName('_x_')).toBe('`_x_`');
    expect(codeDisplayName('a*b')).toBe('`a_b`');
    const chain = describeProvenanceChain([{ kind: 'tool_result', toolName: 'web_fetch' }], 'owner', 'send_message');
    expect(chain).toBe('主人的消息 → 工具 `web_fetch` 的结果 → 本次调用 `send_message`');
    expect(outsideCode(chain)).not.toContain('_');
  });
});

describe('approval card Markdown (#1250 b102)', () => {
  it.each<[Locale, string]>([
    ['zh-CN', '规则：`docs__notify` 被当成向其他会话发消息'],
    ['en', 'Rule: `docs__notify` counts as messaging another conversation'],
  ])('keeps every payload of an MCP description and of the arguments inert, and the Rule line whole (locale %s)', async (locale, rule) => {
    for (const payload of PAYLOADS) {
      const { question, markdown } = await provenanceCard(`Reads a page ${payload} then stops`, { text: payload }, locale);
      const lines = markdown.split('\n');
      // Title, blank line, then the question: action first, the Rule line intact on a line of its own.
      const first = lines[2]!;
      expect(first.startsWith(locale === 'en' ? 'Upstream description (from MCP server `docs`, unverified): `' : '上游描述（MCP 服务 `docs` 提供，未经核实）：`')).toBe(true);
      const ruleLine = lines.find((line) => line.startsWith(rule.slice(0, 5)))!;
      expect(ruleLine.startsWith(rule)).toBe(true);
      expect(codeSpans(ruleLine)[0]).toBe('docs__notify');
      for (const line of lines) {
        expect(balanced(line), line).toBe(true);
        expect(outsideCode(line), line).not.toMatch(ACTIVE);
        expect(outsideCode(line), line).not.toContain('evil.example');
      }
      // The question itself keeps one line per field; the card ends each of them in a hard line break.
      expect(question.split('\n')[0]).toBe(first.trimEnd());
      expect(first.endsWith('  ')).toBe(true);
    }
  });

  it('degrades to plain text without backslashes or code backticks', async () => {
    const { markdown } = await provenanceCard('Reads [点我](https://evil.example/x) `open', { text: '![](https://evil.example/p.png)' });
    const plain = markdownToPlainText(markdown).replace(/⁠/gu, '');
    expect(plain).toContain('上游描述（MCP 服务 docs 提供，未经核实）：Reads [点我](https://evil.example/x) ｀open');
    expect(plain).toContain('本次参数：{"text":"![](https://evil.example/p.png)"}');
    expect(plain).toContain('规则：docs__notify 被当成向其他会话发消息');
    expect(plain).not.toContain('\\');
    expect(plain).not.toContain('`');
  });

  it('labels the dangerous-tool prompt the same way', () => {
    const question = formatHardGateQuestion('docs__drop', null, { sql: '![](https://evil.example/p.png)' }, undefined,
      { mcpServer: 'docs', description: '[safe](https://evil.example) `x' });
    for (const line of approvalCardMarkdown(question).split('\n')) {
      expect(balanced(line), line).toBe(true);
      expect(outsideCode(line), line).not.toMatch(ACTIVE);
    }
    expect(question.split('\n')[1]).toBe('本次参数：`{"sql":"!⁠[]⁠(https://evil.example/p.png)"}`');
  });

  it('ends every line but the last in a hard line break, so CommonMark keeps them apart', () => {
    expect(approvalCardMarkdown('a\nb\n\nc')).toBe('a  \nb  \n\nc');
    expect(approvalCardMarkdown('one line')).toBe('one line');
  });

  it('keeps the first line of a first-party or plugin tool as before', () => {
    expect(describeApprovalAction({ name: 'notify_team', description: '通知**团队**\n第二行' })).toBe('通知**团队**');
  });

  it('shows the command and working directory literally, one code span per command line', async () => {
    const asked: UserInteractionRequest[] = [];
    const port = createRuntimeApprovalPort({
      isMaster: false,
      interaction: { ask: vi.fn(async (request: UserInteractionRequest) => { asked.push(request); return 'reject' as never; }), sequence: async () => ({}) as never } as never,
    });
    const runtime = new TurnToolRuntime(turn(port), [{
      ...capability('run_it', async () => 'ok'), requiresApproval: 'always',
    }]);
    await runtime.execute('run_it', { command: 'echo `id` > out\n![](https://evil.example/p.png)', cwd: '/tmp/[x](y)' }, 'c1');
    expect(asked).toHaveLength(1);
    const description = asked[0]!.description!;
    expect(description).toContain('命令：`echo ｀id｀ > out`  \n`!⁠[]⁠(https://evil.example/p.png)`');
    expect(description).toContain('工作目录：`/tmp/[x]⁠(y)`');
    for (const line of description.split('\n')) {
      expect(balanced(line), line).toBe(true);
      expect(outsideCode(line), line).not.toMatch(ACTIVE);
    }
  });
});

/** Runs a provenance card for an MCP tool through the IM approval port and Core's interaction renderer. */
async function provenanceCard(description: string, input: Record<string, unknown>, locale?: Locale) {
  const asked: UserInteractionRequest[] = [];
  const questions: string[] = [];
  const port = createRuntimeApprovalPort({
    ...(locale ? { locale } : {}),
    isMaster: false,
    interaction: {
      ask: vi.fn(async (request: UserInteractionRequest) => { asked.push(request); return 'reject' as never; }),
      sequence: async () => ({}) as never,
    } as never,
  });
  const provenance = new TurnProvenance();
  provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
  const runtime = new TurnToolRuntime(turn({
    ...port,
    requestApprovalOutcome: async (request) => { questions.push(request.question); return port.requestApprovalOutcome(request); },
  }, locale), [{
    ...capability('docs__notify', async () => 'ok'),
    description,
    mcpServer: 'docs',
    mcpDescriptionFromUpstream: true,
    tags: ['outbound'],
  }], { provenance });
  await runtime.execute('docs__notify', input, 'c1');
  expect(asked).toHaveLength(1);
  const [segment] = renderUserInteraction(projectUserInteraction(asked[0]!), undefined, locale);
  return { question: questions[0]!, markdown: (segment as { data: { content: string } }).data.content };
}

function turn(approval: Parameters<typeof createTurnIngress>[0]['ports']['approval'], locale?: Locale) {
  return createTurnIngress({
    intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'http', sessionId: 'http-session' },
    principal: { subjectId: 'owner', roles: ['owner'] },
    input: { text: 'run', ...(locale ? { locale } : {}) },
    session: { key: 'http:http-session' },
    policy: { permissions: ['owner'], unattended: false },
    capabilities: { tools: [], skills: [] },
    signal: new AbortController().signal,
    ports: { journal: { append: () => undefined }, approval },
  });
}

function capability(name: string, execute: ToolCapability['execute']): ToolCapability {
  return { owner: rootPluginId(), name, qualifiedName: name, description: name, requiresApproval: 'never', source: `/tools/${name}.ts`, execute };
}
