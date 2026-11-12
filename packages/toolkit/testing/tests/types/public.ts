import { PluginTestKit, type TestDelivery, type TestReloadResult } from '../../src/index.js';

declare const kit: PluginTestKit;
const received = kit.receive({ endpoint: 'test', content: 'checkin',
  conversation: { kind: 'group', id: 'g1' }, sender: { id: 'u1', platform: { standing: 'admin' } } });
void received;
// @ts-expect-error Adapters report the platform standing; framework roles are never adapter input (ADR 0056 §1).
void kit.receive({ content: 'x', conversation: { kind: 'group', id: 'g1' }, sender: { id: 'u1', roles: ['master'] } });
void kit.send({ conversation: { kind: 'private', id: 'u1' }, content: 'hello' });
void kit.patchConfig([{ op: 'set', path: ['plugin', 'enabled'], value: true }]);
const captures: readonly TestDelivery[] = kit.deliveries;
void captures;
// @ts-expect-error Captures cannot be appended by test consumers.
kit.deliveries.push({});
// @ts-expect-error Endpoint input requires an actual sender id, never a guessed unknown/system sender.
void kit.receive({ content: 'hi', conversation: { kind: 'group', id: 'g1' }, sender: { id: {} } });
// @ts-expect-error Runtime internals are deliberately not part of the public fixture API.
void kit.runtime;
// @ts-expect-error Consumers cannot mutate recorded destination identities.
kit.deliveries[0]!.conversation.endpoint.id = 'another';
declare const outcome: TestReloadResult;
if (outcome.status === 'failed') void outcome.error;
if (outcome.status === 'restart-required') { const reasons: readonly string[] = outcome.reasons; void reasons; }
