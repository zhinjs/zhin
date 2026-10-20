import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import command from '../../scripts/platform-acceptance/probe-command.js';

describe('whitelisted high order acceptance probes', () => {
  const directories: string[] = [];
  afterEach(async () => { vi.useRealTimers(); vi.unstubAllEnvs(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
  async function setup(action: string, policyOverride = {}, platform = 'telegram') {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-high-order-')); directories.push(directory);
    const eventsPath = join(directory, 'events.jsonl'); const policyPath = join(directory, 'policy.json');
    await writeFile(policyPath, JSON.stringify({ version: 1, platform, actions: [action], minIntervalMs: 1000, maxSends: 20, eventsPath, targets: [{ alias: 'bot-a', adapter: platform, endpoint: 'bot', kind: 'private', id: 'chat' }] }));
    vi.stubEnv('ZHIN_ACCEPTANCE_POLICY', policyPath);
    let handler: ((message: any) => boolean) | undefined;
    const release = vi.fn();
    const conversation = { endpoint: { id: 'endpoint', adapter: platform }, kind: 'private', id: 'chat' };
    const reply = vi.fn(async () => ({ status: 'sent', message: { id: 'sent-id', conversation } }));
    const input = { conversation, content: `/acceptance probe:highorder0001 action:${action}`, sender: { id: 'user' }, id: 'incoming', $reply: reply };
    const index = { connection: () => ({ transportState: 'open' }), resolve: () => 'endpoint', clientAdapter: () => platform, segmentPolicy: () => ({ interactive: 'native', markdown: 'native', ...policyOverride }), describe: () => [{ id: 'endpoint', admitted: true }] };
    const context: any = { input, endpoint: 'bot', generation: 1, project: () => index, use: () => ({ registerInteractiveHandler: (_prefix: string, callback: typeof handler) => { handler = callback; return release; } }) };
    return { context, reply, release, get handler() { return handler; }, events: async () => (await readFile(eventsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line)) };
  }
  it('sends markdown with bold, code, link and HTML special characters', async () => {
    const test = await setup('reply-markdown');
    await command.execute(test.context);
    expect(test.reply.mock.calls[0]![0][0]).toMatchObject({ type: 'markdown', data: { content: expect.stringContaining('Escaping: & < >') } });
    expect(test.reply.mock.calls[0]![0][0].data.content).toContain('**acceptance:');
    expect((await test.events()).at(-1).result).toBe('confirmed');
  });
  it('sends the public share with title and description', async () => {
    const test = await setup('reply-share'); await command.execute(test.context);
    expect(test.reply.mock.calls[0]![0][1]).toMatchObject({ type: 'share', data: { url: 'https://zhin.dev', title: 'Zhin 适配器验收', description: expect.any(String) } });
  });
  it('requires matching real action, sender, conversation and source message before confirming a button', async () => {
    const test = await setup('reply-button');
    const running = command.execute(test.context);
    await vi.waitFor(() => expect(test.reply).toHaveBeenCalled());
    const payload = test.reply.mock.calls[0]![0][1].data.rows[0][0].payload;
    const message = { conversation: test.context.input.conversation, sender: { id: 'user' }, metadata: { sourceMessageId: 'sent-id' }, segments: [{ type: 'action', data: { payload } }] };
    expect(test.handler!({ ...message, segments: [] })).toBe(false);
    expect(test.handler!({ ...message, conversation: { ...message.conversation, endpoint: { ...message.conversation.endpoint, adapter: 'discord' } } })).toBe(false);
    expect(test.handler!({ ...message, metadata: {} })).toBe(false);
    expect(test.handler!({ ...message, sender: { id: 'other' } })).toBe(false);
    expect(test.handler!({ ...message, metadata: { sourceMessageId: 'another' } })).toBe(false);
    await running; // Polling must be released before the next inbound callback.
    expect((await test.events()).at(-1).phase).toBe('attempt');
    expect(test.handler!(message)).toBe(true);
    await vi.waitFor(async () => expect((await test.events()).at(-1)).toMatchObject({ result: 'confirmed', callbackObserved: true }));
    expect(test.release).toHaveBeenCalledTimes(1);
    expect(test.handler!(message)).toBe(false);
  });
  it('unregisters callbacks after send failure and never confirms timeout', async () => {
    const failed = await setup('reply-button');
    failed.reply.mockRejectedValue(new Error('network reset'));
    await command.execute(failed.context);
    expect(failed.release).toHaveBeenCalledTimes(1);
    expect((await failed.events()).at(-1).result).toBe('unknown');
    const timeout = await setup('reply-button');
    vi.useFakeTimers();
    const running = command.execute(timeout.context);
    await vi.waitFor(() => expect(timeout.reply).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(60_000);
    await running;
    expect(timeout.release).toHaveBeenCalledTimes(1);
    await vi.waitFor(async () => expect((await timeout.events()).at(-1)).toMatchObject({ phase: 'result', result: 'unknown', callbackObserved: false }));
  });
  it('records QQ private click association honestly without fabricating source ID', async () => {
    const test = await setup('reply-button', {}, 'qq'); await command.execute(test.context);
    const payload = test.reply.mock.calls[0]![0][1].data.rows[0][0].payload;
    const message = { conversation: test.context.input.conversation, sender: { id: 'user' }, segments: [{ type: 'action', data: { payload } }], metadata: { eventType: 'INTERACTION_CREATE', sourceMessageIdAvailable: false } };
    expect(test.handler!({ ...message, metadata: {} })).toBe(false);
    expect(test.handler!({ ...message, sender: { id: 'other' } })).toBe(false);
    expect(test.handler!(message)).toBe(true);
    await vi.waitFor(async () => expect((await test.events()).at(-1)).toMatchObject({ result: 'confirmed', callbackObserved: true, callbackAssociation: 'payload-conversation-actor' }));
  });
  it('does not send text-only share when adapter explicitly excludes sharing', async () => {
    const test = await setup('reply-share', { supported: ['text', 'markdown', 'keyboard'] }, 'qq');
    await command.execute(test.context);
    expect(test.reply).not.toHaveBeenCalled();
    expect((await test.events()).at(-1).result).toBe('unsupported');
  });
  it('does not emit a placeholder button on text fallback endpoints', async () => {
    const test = await setup('reply-button', { interactive: 'text' }); await command.execute(test.context);
    expect(test.reply).not.toHaveBeenCalled();
    expect((await test.events()).at(-1)).toMatchObject({ result: 'unsupported', callbackObserved: false });
  });
});
