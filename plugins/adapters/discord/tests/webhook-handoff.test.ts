import { generateKeyPairSync, sign } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createEndpointHarness, createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import { webhookRequest } from '../../test-utils/http.js';
import { DiscordInteractionsEndpoint } from '../src/endpoint.js';
import { handleDiscordInteractionRequest } from '../src/webhook.js';
import { resolveDiscordConfig, type ResolvedDiscordInteractionsConfig } from '../src/protocol.js';

const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const config = resolveDiscordConfig({ id: 'fixture', token: 'fixture', connection: 'interactions', applicationId: 'fixture-app', publicKey }) as ResolvedDiscordInteractionsConfig;

function signed(interaction: Record<string, unknown>): Request {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ application_id: config.applicationId, channel_id: 'room', user: { id: 'sender', username: 'Alice' }, ...interaction });
  const signature = sign(null, Buffer.from(timestamp + body), keys.privateKey).toString('hex');
  return webhookRequest(body, { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp });
}

// #1250 adapter-inbound-deadlock: the response is Discord's interaction ACK (due within 3 s). It must not
// wait for the dispatch it started — an Agent turn that may itself wait for the next button press.
it.each([
  ['button press', { id: 'press', type: 3, data: { component_type: 2, custom_id: 'confirm:yes' }, message: { id: 'card' } }, 6],
  ['slash command', { id: 'command', type: 2, data: { name: 'ask' } }, 4],
] as const)('acknowledges a %s while its dispatch still runs', async (_kind, interaction, type) => {
  let release!: () => void;
  const turn = new Promise<void>(resolve => { release = resolve; });
  const receive = vi.fn(async () => { await turn; });
  const h = await createEndpointHarness(() => new DiscordInteractionsEndpoint({ id: 'discord-protocol' as never, config,
    http: { route: () => () => undefined } as never }), { capabilities: ['inbound', 'outbound'], operations: ['recall'],
    gateway: createTestEndpointEventGateway({ receive: async (event) => event.name === 'message.receive' ? receive() : undefined,
      resolveLocale: async () => 'en' }) });
  await h.start(); h.open();
  try {
    const answering = handleDiscordInteractionRequest(signed(interaction), h.endpoint);
    const response = await Promise.race([answering, new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 1_000))]);
    expect(response?.status).toBe(200);
    expect(JSON.parse(await response!.text())).toMatchObject({ type });
    await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce());
  } finally { release(); await h.stop(); }
});
