import type { ConstructionContext, CapabilityContext } from '@zhin.js/feature-kit';
import { featureId, createToken } from '@zhin.js/plugin-runtime';
import { Adapter, createEndpointSpecification, endpointSpec, defineAdapter } from '@zhin.js/adapter';
import { defineMcp } from '@zhin.js/mcp-feature';
import { defineCommand } from '@zhin.js/command';

const feature = featureId('fixture.operation');
const token = createToken<string>('fixture.transport');
declare const construction: ConstructionContext<{ account: string }>;
const account: string = construction.config.account;
const resource: string = construction.use(token);
// @ts-expect-error transport creation cannot capture operation Feature projections
construction.project(feature);
declare const operation: CapabilityContext;
operation.project(feature);

class FixtureEndpoint {
  readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close() {}, stop() {}, send: () => 'sent' });
}
class FixtureAdapter extends Adapter<FixtureEndpoint> {
  protected createEndpoint(): FixtureEndpoint { return new FixtureEndpoint(); }
}
declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { 'construction-fixture': FixtureAdapter }
}
defineCommand({ adapter: 'construction-fixture', execute({ session }) {
  if (!session) return;
  const adapter: FixtureAdapter = session.adapter;
  const endpoint: FixtureEndpoint = session.endpoint;
  // @ts-expect-error literal adapter inference preserves the real Endpoint methods
  session.endpoint.missingSdkMethod();
  void adapter; void endpoint;
} });
defineAdapter<{ account: string }>({ capabilities: ['outbound'], createAdapter(context) {
  const account: string = context.config.account;
  context.use(token);
  // @ts-expect-error Adapter construction only exposes owner-lifetime resources
  context.project(feature);
  void account;
  return new FixtureAdapter();
} });
defineMcp<{ account: string }>({ create(context) {
  const account: string = context.config.account;
  context.use(token);
  // @ts-expect-error MCP construction only exposes owner-lifetime resources
  context.project(feature);
  return { listTools: () => [], callTool: () => account };
} });
// #877: has() is optional, so hand-written contexts without it stay valid.
const handWritten: ConstructionContext = {
  signal: new AbortController().signal,
  owner: construction.owner,
  generation: 1,
  config: {},
  use: <T>(): T => { throw new Error('missing'); },
};
const present: boolean | undefined = handWritten.has?.(token);
void account; void resource; void present;
