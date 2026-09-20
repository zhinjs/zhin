import type { LoginAssist, PendingLoginTask } from '@zhin.js/core';
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('login-assist');

/**
 * Interactive TTY consumer for LoginAssist — mirrors the classic icqq stdin flow.
 * Non-TTY (daemon / CI) skips; Console RPC `login.submit` remains the other consumer.
 */
export function bindLoginAssistStdin(assist: LoginAssist): () => void {
  if (!process.stdin.isTTY) return () => {};

  const queue: PendingLoginTask[] = [];
  let closed = false;
  const promptNext = () => {
    if (!closed && queue.length > 0) promptTask(queue[0]);
  };
  const remove = (id: string): boolean => {
    const index = queue.findIndex((task) => task.id === id);
    if (index < 0) return false;
    const wasHead = index === 0;
    queue.splice(index, 1);
    if (wasHead) promptNext();
    return true;
  };
  const onData = (chunk: Buffer | string) => {
    const task = queue.shift();
    if (!task) return;
    const line = chunk.toString().trim();
    const value = task.type === 'qrcode' || task.type === 'auth' ? line || 'ok' : line;
    if (!assist.submit(task.id, value)) {
      logger.debug(formatCompact({
        op: 'login_assist_stdin_miss',
        id: task.id,
        hint: 'task already resolved (Console submit?)',
      }));
    }
    promptNext();
  };
  process.stdin.on('data', onData);

  const unsubPending = assist.subscribe('endpoint.login.pending', (task) => {
    const wasEmpty = queue.length === 0;
    queue.push(task);
    if (wasEmpty) promptNext();
  });

  const unsubExpired = assist.subscribe('endpoint.login.expired', (task) => {
    remove(task.id);
    logger.warn(formatCompact({
      op: 'login_assist_expired',
      id: task.id,
      adapter: task.adapter,
      endpoint: task.endpointKey,
      type: task.type,
    }));
  });
  const unsubResolved = assist.subscribe('endpoint.login.resolved', (task) => {
    remove(task.id);
  });

  return () => {
    closed = true;
    queue.length = 0;
    process.stdin.off('data', onData);
    unsubPending();
    unsubExpired();
    unsubResolved();
  };
}

function promptTask(task: PendingLoginTask): void {
  const message = typeof task.payload.message === 'string' && task.payload.message
    ? task.payload.message
    : `登录辅助：${task.type}`;
  const url = typeof task.payload.url === 'string' ? task.payload.url : undefined;
  logger.info(formatCompact({
    op: 'login_assist_stdin',
    id: task.id,
    adapter: task.adapter,
    endpoint: task.endpointKey,
    type: task.type,
    message,
    ...(url ? { url } : {}),
    ...(task.payload.image ? { image: '[qrcode]' } : {}),
  }));
  if (url) {
    process.stderr.write(`${message}\n${url}\n> `);
  } else {
    process.stderr.write(`${message}\n> `);
  }
}
