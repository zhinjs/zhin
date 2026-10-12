import { createDeliveryTarget, type PluginDatabaseHost, type OutboundHost } from '../../src/index.js';

declare const message: Parameters<typeof createDeliveryTarget>[0];
declare const database: PluginDatabaseHost;
declare const outbound: OutboundHost;

const target = createDeliveryTarget(message);
void database.state.forConversation(target).set('target', target);
void database.state.forUser(target.endpoint, 'alice').update<number>('count', (current) => (current ?? 0) + 1);
void database.state.get<typeof target>('target').then((saved) => {
  if (saved) void outbound.sendTarget?.(saved, [{ type: 'text', data: { text: 'reminder' } }]);
});

// @ts-expect-error Persisted state cannot retain an event callback.
void database.state.set('callback', () => undefined);
// @ts-expect-error Persisted state cannot retain a runtime client.
void database.state.set('client', { send: () => undefined });
