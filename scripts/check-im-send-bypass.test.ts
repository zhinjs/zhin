import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script
import { isAdapterImplementationPath, run, SCAN_ROOTS } from './check-im-send-bypass.mjs';
// @ts-expect-error plain .mjs script
import { findSendBypasses, SEND_BYPASS_PATTERNS } from './lib/send-bypass-rules.mjs';
import { checkSelfChangeFiles, SELF_CHANGE_SEND_BYPASS_PATTERNS } from '../packages/im/agent/src/self-change/trial.js';

const BYPASSES = [
  'await bot.$sendMessage({ content })',
  'await this.$sendMessage(options)',
  'await endpoint.send(request)',
  'await context.endpoint.send({ ...request })',
  'await lease.send(request)',
  'transport.send(frame)',
  'await this.client.sendMessage(chatId, text)',
  'await context.$client.sendGroupMsg(groupId, text)',
  'await client?.sendPhoto(chatId, url)',
  'await sdk.postMessage({ channel, text })',
  'await adapterIndex.send(id, request)',
  'await adapters.sendTarget(target, content)',
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
  '// never call bot.$sendMessage( here',
  '/** endpoint.send(request) is the adapter implementation */',
];

describe('send bypass rules', () => {
  it.each(BYPASSES)('flags %s', (line) => {
    expect(findSendBypasses(line)).toHaveLength(1);
  });

  it.each(LEGAL)('allows %s', (line) => {
    expect(findSendBypasses(line)).toEqual([]);
  });

  it('reports line numbers and rule ids', () => {
    expect(findSendBypasses('const a = 1;\nawait endpoint.send(x);\nawait adapterIndex.send(id, x);')).toEqual([
      { id: 'endpoint_send', line: 2, text: 'await endpoint.send(x);' },
      { id: 'adapter_index_send', line: 3, text: 'await adapterIndex.send(id, x);' },
    ]);
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

  it('self-change trial agrees with the script on every sample', async () => {
    const command = "import { defineCommand } from 'zhin.js/command';\nexport default defineCommand({});\n";
    const samples = [...BYPASSES, ...LEGAL];
    const checks = await checkSelfChangeFiles(samples.map((line, index) => ({
      path: `commands/sample-${index}.ts`,
      content: `${command}export async function run(bot: any, endpoint: any) {\n${line}\n}\n`,
    })));
    samples.forEach((line, index) => {
      const failed = checks.some(check => check.path === `commands/sample-${index}.ts` && check.check === 'forbidden_import' && check.status === 'failed');
      expect([line, failed]).toEqual([line, findSendBypasses(line).length > 0]);
    });
  });

  it('passes on the repository', () => {
    expect(run()).toBe(0);
  });
});
