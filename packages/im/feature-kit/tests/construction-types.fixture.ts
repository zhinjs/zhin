import type { ConstructionContext, CapabilityContext } from '@zhin.js/feature-kit';
import { featureId, createToken } from '@zhin.js/plugin-runtime';
import { defineAdapter } from '@zhin.js/adapter';
import { defineMcp } from '@zhin.js/mcp-feature';

const feature = featureId('fixture.operation');
const token = createToken<string>('fixture.transport');
declare const construction: ConstructionContext<{ account: string }>;
const account: string = construction.config.account;
const resource: string = construction.use(token);
// @ts-expect-error transport creation cannot capture operation Feature projections
construction.project(feature);
declare const operation: CapabilityContext;
operation.project(feature);

defineAdapter<{ account: string }>({ capabilities: ['outbound'], create(context) {
  const account: string = context.config.account;
  context.use(token);
  // @ts-expect-error Adapter construction only exposes owner-lifetime resources
  context.project(feature);
  return { client: { account }, send: () => 'sent' };
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
