/**
 * minimal-qbot — Queue Beta 黄金路径
 * 演示 enqueueOutgoing → claimOutgoing → executeOutbound（无 IM MessageDispatcher）
 */
import { createMemoryStoragePort } from '@zhin.js/storage-port';
import { runQueueBot } from '@zhin.js/queue-runtime';
import { loadQBotConfig } from './load-qbot-config.ts';

const config = loadQBotConfig();
const storage = createMemoryStoragePort();
const runtime = await runQueueBot(storage, {
  botId: config.botId,
  namespace: config.namespace,
});

const incoming = await runtime.handleIncoming({
  kind: 'event',
  type: 'message',
  detail: { text: 'hello from minimal-qbot' },
});
console.log('[incoming]', incoming.type, incoming.detail);

const out = await runtime.enqueueOutgoing(config.botId, {
  context: 'queue',
  bot: config.botId,
  channelId: 'demo',
  channelType: 'private',
  content: 'pong',
});
console.log('[enqueue]', out.id, out.status);

const claimed = await runtime.claimOutgoing('worker-1');
if (!claimed) {
  console.error('claim failed');
  process.exit(1);
}
console.log('[claim]', claimed.id);

const result = await runtime.executeOutbound(claimed.id, async (detail) => {
  console.log('[execute]', JSON.stringify(detail));
});
console.log('[done]', result.record.status);
if (result.record.status !== 'done') process.exit(1);

console.log('\nminimal-qbot OK — queue-runtime Beta smoke finished.');
