import type { AssistantMessage } from '@zhin.js/ai';
import type { LanguageRequest } from '@zhin.js/ai/provider';
import { assistant, context, graphFixture, runtimeFixture } from '../../../../../ai/tests/provider/fixtures.js';
import type { AgentTurnIngressRouteOptions } from '@zhin.js/agent/runtime';

/** Real operation scopes for ingress consumer tests; synthetic Driver only, no network. */
export function ingressInferenceFixture(options: Readonly<{
  respond?: (request: LanguageRequest) => AssistantMessage | Promise<AssistantMessage>;
}> = {}) {
  const requests: LanguageRequest[] = [];
  const generations: object[] = [];
  let closed = 0;
  const withInferenceScope: NonNullable<AgentTurnIngressRouteOptions['withInferenceScope']> = async (input, run) => {
    const graph = { ...graphFixture(), purposes: { defaults: { chat: 'text' } } };
    const generate = async ({ request }: { request: LanguageRequest }) => {
      requests.push(request);
      return options.respond ? options.respond(request) : assistant();
    };
    const fixture = runtimeFixture({ graph, generationIdentity: input.lease.value, execution: { language: {
      generate,
      stream: async input => (async function* () { yield { type: 'done' as const, message: await generate(input) }; })(),
    } } });
    const scope = await fixture.runtime.openScope({ context: { ...context,
      operationId: input.operationId ?? 'ingress-fixture', sessionKey: input.sessionKey }, signal: input.signal });
    generations.push(input.lease.value);
    try { return await run(scope); }
    finally { await scope.close(); fixture.runtime.retire(); closed++; }
  };
  return { withInferenceScope, requests, generations, get closed() { return closed; } };
}
