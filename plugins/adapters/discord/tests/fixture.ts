import { Client, ClientUser, Status } from 'discord.js';
import { vi } from 'vitest';
import { createAdapterHarness, createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { DiscordGatewayEndpoint, DiscordInteractionsEndpoint } from '../src/endpoint.js';
import { defineAdapter, type EndpointCreationContext } from 'zhin.js/adapter';
import { DiscordAdapter } from '../src/adapter.js';
import definition from '../adapters/discord/index.js';
import type { DiscordEndpointConfig } from '../src/protocol.js';
import { MemoryDesiredRepository } from '../../test-utils/desired-repository.js';

const nativeDestroy = Client.prototype.destroy;
const destruction = new WeakMap<Client, () => unknown>();
function bindDestruction() {
  if (vi.isMockFunction(Client.prototype.destroy)) return;
  vi.spyOn(Client.prototype, 'destroy').mockImplementation(async function (this: Client) {
    await destruction.get(this)?.(); await nativeDestroy.call(this);
  });
}

/** The SDK constructor is protected; keep an actual ClientUser through its supported subclass seam. */
class FixtureClientUser extends ClientUser {
  constructor(client: Client<true>, id: string) {
    super(client, { id, username: 'TestBot', discriminator: '0001', bot: true, avatar: null });
  }
}

function configureGatewayEndpoint(endpoint: DiscordGatewayEndpoint, methods: object): void {
  endpoint.rest.options.makeRequest = async () => { throw new Error('Unexpected unmocked Discord transport'); };
  destruction.set(endpoint, () => Reflect.get(methods, 'destroy')?.());
  const user = Reflect.get(methods, 'user');
  vi.spyOn(endpoint, 'login').mockImplementation(async token => {
    const result = await Reflect.get(methods, 'login')?.(token);
    endpoint.ws.status = Status.Ready;
    // isReady is the SDK's public proof of both readiness and non-destruction.
    if (endpoint.isReady()) {
      const nativeUser = new FixtureClientUser(endpoint, user?.id ?? '100000000000000001');
      endpoint.user = nativeUser;
      if (user?.setActivity) vi.spyOn(nativeUser, 'setActivity').mockImplementation(user.setActivity);
      endpoint.emit('clientReady', endpoint);
    }
    return typeof result === 'string' ? result : 'synthetic';
  });
  for (const manager of ['channels', 'guilds', 'users'] as const) {
    const supplied = Reflect.get(methods, manager);
    if (!supplied) continue;
    if (supplied.fetch) vi.spyOn(endpoint[manager], 'fetch').mockImplementation(supplied.fetch);
    if (supplied.cache?.values) for (const value of supplied.cache.values()) endpoint[manager].cache.set(value.id, value);
  }
}

function configureDiscordEndpoint<E extends DiscordGatewayEndpoint | DiscordInteractionsEndpoint>(factory: () => E, api: (() => object) | undefined): E {
  bindDestruction();
  const endpoint = factory();
  if (endpoint instanceof DiscordGatewayEndpoint) configureGatewayEndpoint(endpoint, api!());
  return endpoint;
}

export async function discordFixture(factory: () => DiscordGatewayEndpoint | DiscordInteractionsEndpoint,
  api: (() => object) | undefined, gateway?: Parameters<typeof createTestEventGateway>[0],
  sideEvents?: Parameters<typeof createTestEventGateway>[1]) {
  const fixture = await createEndpointHarness(() => configureDiscordEndpoint(factory, api), { name: 'discord', capabilities: ['inbound', 'outbound'],
    operations: api ? ['recall', 'reaction'] : ['recall'], gateway: createTestEventGateway(gateway, sideEvents) });
  return { ...fixture,
    get management() { return fixture.index.management(fixture.canonicalId)!; },
    get control() { return fixture.index.control(fixture.canonicalId, 'recall')!; },
    get transportState() { return fixture.index.connection('discord', fixture.canonicalId)?.transportState; },
  };
}

/** Actual platform Adapter with fake external IO, so concurrent child operations exercise real ownership. */
export async function managedDiscordFixture(config: DiscordEndpointConfig, api: () => object) {
  class FakeIODiscordAdapter extends DiscordAdapter {
    protected override async createEndpoint(input: DiscordEndpointConfig, execution: EndpointCreationContext) {
      const endpoint = await super.createEndpoint(input, execution);
      return configureDiscordEndpoint(() => endpoint, api);
    }
  }
  const repository = new MemoryDesiredRepository();
  const deploymentConfig = { ...config, endpoints: [] };
  const fixture = await createAdapterHarness(defineAdapter({ ...definition,
    createAdapter: context => new FakeIODiscordAdapter(context) }), deploymentConfig, { name: 'discord', repository });
  await fixture.start(); fixture.open();
  const saved = await fixture.adapter.add(fixture.adapter.revision, { endpointId: config.id, config: { ...config } });
  return { fixture, account: saved.endpoints[0]! };
}
