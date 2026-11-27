import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script
import { allowlistCovers, isAdapterImplementationPath, run, SCAN_ROOTS } from './check-im-send-bypass.mjs';
// @ts-expect-error plain .mjs script
import { findSendBypasses, SEND_BYPASS_PATTERNS, stripComments } from './lib/send-bypass-rules.mjs';
import { checkSelfChangeFiles, SELF_CHANGE_SEND_BYPASS_PATTERNS, stripCommentsForRules } from '../packages/im/agent/src/self-change/trial.js';

/** A whole-repository scan, measured at a few seconds locally and slower under CI coverage. */
const REPO_SCAN_TIMEOUT_MS = 60_000;

const BYPASSES = [
  'await bot.$sendMessage({ content })',
  'await this.$sendMessage(options)',
  'await endpoint.send(request)',
  'await context.endpoint.send({ ...request })',
  'await lease.send(request)',
  'await transport.sendMessage(frame)',
  'await this.client.sendMessage(chatId, text)',
  'await context.$client.sendGroupMsg(groupId, text)',
  'await client?.sendPhoto(chatId, url)',
  'await sdk.postMessage({ channel, text })',
  'await adapterIndex.send(id, request)',
  'await adapters.sendTarget(target, content)',
  // #1250 review M2: non-null, cast, optional call and bracket forms
  'await endpoint!.send(request)',
  'await (endpoint as Endpoint).send(request)',
  'await endpoint?.send?.(request)',
  "await endpoint['send'](request)",
  'await bot["$sendMessage"](request)',
  'await this.$sendMessage?.(options)',
  'await client!.sendMessage(chatId, text)',
  'await adapterIndex?.send?.(id, request)',
  // #1250 review M1: a comment marker inside a string does not hide the rest of the line
  "const u = 'a//'; await endpoint.send(req);",
  'const a = "/*"; await endpoint.send(req); const b = "*/";',
  '/* note */ await endpoint.send(req);',
];

const LEGAL = [
  'await message.$reply(content)',
  'await message.$sendTo(conversation, content)',
  'await context.use(outboundMessageToken).send({ requester, conversation, content })',
  'await outbound.send({ requester, target, content })',
  'await captured.send(content)',
  'await im.endpoints.send({ adapter, endpointKey, conversation, content })',
  'await context.$client.sendLike(userId, 10)',
  'await client.sendPoke(userId)',
  'const sendMessage = () => {}',
  // #1250 review M4: SDK / WebSocket / MCP send() on client / transport / sdk is not an IM send
  'await client.send(new PutObjectCommand({ Bucket, Key, Body }))',
  'transport.send(frame)',
  'await sdk.send(command)',
  'socket.send(JSON.stringify(frame))',
];

/** Comment-only mentions: the script ignores them; the self-change trial also checks the raw text and fails them. */
const COMMENT_ONLY = [
  '// never call bot.$sendMessage( here',
  '/** endpoint.send(request) is the adapter implementation */',
];

/** Samples that span lines or whose comment cannot be judged from the line start (#1250 review M2). */
const MULTILINE_BYPASSES: Array<[source: string, line: number]> = [
  ['await endpoint\n  .send(request);', 2],
  ['await this.client\n  ?.sendMessage(chatId, text);', 2],
  // used to be skipped as a "comment line" because it starts with `*`
  ['const total = base\n  * (await endpoint.send(request));', 3],
  ['await adapterIndex\n  .send(id, request);', 2],
];
const MULTILINE_LEGAL = [
  '/*\n * await endpoint.send(request)\n */\nconst x = 1;',
  'const doc = `\n  example: endpoint\n`;\n// .send(request)',
];

describe('send bypass rules', () => {
  it.each(BYPASSES)('flags %s', (line) => {
    expect(findSendBypasses(line)).toHaveLength(1);
  });

  it.each([...LEGAL, ...COMMENT_ONLY])('allows %s', (line) => {
    expect(findSendBypasses(line)).toEqual([]);
  });

  it('reports line numbers and rule ids', () => {
    expect(findSendBypasses('const a = 1;\nawait endpoint.send(x);\nawait adapterIndex.send(id, x);')).toEqual([
      { id: 'endpoint_send', line: 2, text: 'await endpoint.send(x);' },
      { id: 'adapter_index_send', line: 3, text: 'await adapterIndex.send(id, x);' },
    ]);
  });

  it.each(MULTILINE_BYPASSES)('flags the multi-line form %j on the line where the call starts', (source, line) => {
    expect(findSendBypasses(`const a = 1;\n${source}`)).toEqual([expect.objectContaining({ line })]);
  });

  it.each(MULTILINE_LEGAL)('allows the multi-line sample %j', (source) => {
    expect(findSendBypasses(source)).toEqual([]);
  });

  it('scans plugin code outside adapters, including games and services', () => {
    expect(SCAN_ROOTS).toEqual(expect.arrayContaining(['plugins', 'examples']));
    for (const rel of [
      'plugins/games/dice-duel/commands/roll/index.ts',
      'plugins/services/activity-feedback/plugin.ts',
      'plugins/utils/rss/plugin.ts',
      'plugins/adapters/qq/commands/qq/index.ts',
    ]) expect(isAdapterImplementationPath(rel)).toBe(false);
  });

  it('leaves the adapter Endpoint implementation alone', () => {
    for (const rel of [
      'plugins/adapters/telegram/src/endpoint.ts',
      'plugins/adapters/telegram/adapters/telegram/index.ts',
      'plugins/adapters/napcat/agents/napcat/skills/x/tools/y/index.ts',
      'plugins/adapters/test-utils/endpoint.ts',
    ]) expect(isAdapterImplementationPath(rel)).toBe(true);
  });

  it('self-change trial uses exactly the same patterns as check:harness-paths', () => {
    expect(SELF_CHANGE_SEND_BYPASS_PATTERNS.map(({ id, source }) => ({ id, source })))
      .toEqual(SEND_BYPASS_PATTERNS.map(({ id, source }: { id: string; source: string }) => ({ id, source })));
  });

  it('self-change trial agrees with the script on every code sample, multi-line ones included', async () => {
    const command = "import { defineCommand } from 'zhin.js/command';\nexport default defineCommand({});\n";
    const samples = [...BYPASSES, ...LEGAL, ...MULTILINE_BYPASSES.map(([source]) => source), ...MULTILINE_LEGAL.filter(sample => !sample.includes('//') && !sample.includes('/*'))];
    const checks = await checkSelfChangeFiles(samples.map((line, index) => ({
      path: `commands/sample-${index}.ts`,
      content: `${command}export async function run(bot: any, endpoint: any) {\n${line}\n}\n`,
    })));
    samples.forEach((line, index) => {
      const failed = checks.some(check => check.path === `commands/sample-${index}.ts` && check.check === 'forbidden_import' && check.status === 'failed');
      expect([line, failed]).toEqual([line, findSendBypasses(line).length > 0]);
    });
  });

  it('self-change trial fails closed on comment-only mentions (it also checks the raw text)', async () => {
    const command = "import { defineCommand } from 'zhin.js/command';\nexport default defineCommand({});\n";
    const comments = [...COMMENT_ONLY, MULTILINE_LEGAL[0]!];
    const checks = await checkSelfChangeFiles(comments.map((line, index) => ({ path: `commands/comment-${index}.ts`, content: `${command}${line}\n` })));
    expect(checks.filter(check => check.check === 'forbidden_import' && check.status === 'failed').map(check => check.path))
      .toEqual(comments.map((_line, index) => `commands/comment-${index}.ts`));
  });

  const STRIP_SAMPLES = [
    "const u = 'a//'; endpoint.send(x); // tail",
    'const a = "/*"; x(); const b = "*/"; /* real */ y();',
    'const t = `a ${b /* c */ + `d ${e} // f`} g`; // h',
    'const r = /\\/\\/[/*]/u.test(s); /* c */ z = a / b / c; // d',
    'if (x) return /\\//.test(y);\n/** doc\n * more\n */\nlet q = 1;',
    "unterminated = 'abc\n// comment\nnext();",
    'open = 1; /* never closed\nendpoint.send(x);',
    'emoji = "\u{1F600}"; // \u{1F600} comment\nx();',
    'const s = `${`${`//`}`}`; // nested',
    'a = b\n/c/g.exec(d);',
  ];

  it.each(STRIP_SAMPLES)('strips comments length-preservingly and identically on both sides: %j', (source) => {
    const stripped = stripComments(source);
    expect(stripped).toHaveLength(source.length);
    expect(stripped.split('\n')).toHaveLength(source.split('\n').length);
    expect(stripCommentsForRules(source)).toBe(stripped);
  });

  it('keeps strings, templates and regexes and blanks only comments', () => {
    expect(stripComments("const u = 'a//'; endpoint.send(x); // tail")).toBe("const u = 'a//'; endpoint.send(x);        ");
    expect(stripComments('const t = `a ${b /* c */ + 1}`; // h')).toBe('const t = `a ${b         + 1}`;     ');
    expect(stripComments('const r = /\\/\\//u; z();')).toBe('const r = /\\/\\//u; z();');
    expect(stripComments('open(); /* never closed\nendpoint.send(x);')).toBe('open(); /* never closed\nendpoint.send(x);');
  });

  it('allowlist entries can be narrowed to a text fragment (#1250 review L2)', () => {
    const entry = { file: 'a.ts', rule: 'platform_client_send', text: 'transport.sendMessage', reason: 'x' };
    expect(allowlistCovers(entry, { file: 'a.ts', rule: 'platform_client_send', text: 'await transport.sendMessage(req)' })).toBe(true);
    expect(allowlistCovers(entry, { file: 'a.ts', rule: 'platform_client_send', text: 'await client.sendMessage(req)' })).toBe(false);
    expect(allowlistCovers(entry, { file: 'a.ts', rule: 'endpoint_send', text: 'transport.sendMessage' })).toBe(false);
    expect(allowlistCovers({ file: 'b.ts', call: 'sendWorkNotice', reason: 'x' }, { file: 'b.ts', call: 'sendWorkNotice', text: 'any' })).toBe(true);
  });

  it('keeps host allowlist entries narrowed to a text fragment', async () => {
    const { readFileSync } = await import('node:fs');
    const entries = JSON.parse(readFileSync(new URL('./agent-send-bypass-allowlist.json', import.meta.url), 'utf8')) as Array<{ rule?: string; text?: string }>;
    for (const entry of entries.filter(item => item.rule)) expect(entry.text, JSON.stringify(entry)).toBeTruthy();
  });

  // Whole-repo scan: sized for coverage-instrumented CI runners, not the 10s unit-test default.
  it('passes on the repository', () => {
    expect(run()).toBe(0);
  }, REPO_SCAN_TIMEOUT_MS);
});
