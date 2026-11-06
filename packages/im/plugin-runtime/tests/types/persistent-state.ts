import { createDeliveryTarget, type PluginDatabaseHost, type OutboundHost, type Scope } from '../../src/index.js';

declare const message: Parameters<typeof createDeliveryTarget>[0];
declare const database: PluginDatabaseHost;
declare const outbound: OutboundHost;
declare const resources: Scope;

// @ts-expect-error Plugin resources cannot escape to their parent Scope's process ports.
void resources.parent;

const target = createDeliveryTarget(message);
void database.state.forConversation(target).set('target', target);
void database.state.forUser(target.endpoint, 'alice').update<number>('count', (current) => (current ?? 0) + 1);
void database.state.get<typeof target>('target').then((saved) => {
  if (saved) void outbound.sendTarget?.(saved, [{ type: 'text', data: { text: 'reminder' } }]);
});

interface SampleStoredInterface {
  readonly id: string;
  readonly count?: number;
}
const sampleRecord: SampleStoredInterface = { id: 'item-1', count: 2 };
void database.state.set('sample', sampleRecord);
void database.state.update<SampleStoredInterface>('sample', (current) =>
  current ? { ...current, count: (current.count ?? 0) + 1 } : sampleRecord,
);
void database.state.get<SampleStoredInterface>('sample');

// @ts-expect-error Persisted state cannot retain an event callback.
void database.state.set('callback', () => undefined);
// @ts-expect-error Persisted state cannot retain a runtime client.
void database.state.set('client', { send: () => undefined });
