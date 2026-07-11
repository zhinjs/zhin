import { describe, expect, it } from 'vitest';
import {
  createMemoryContextRepository,
  type AgentMessage,
} from '@zhin.js/ai';
import { appendPassiveGroupMessageToContext } from '../src/session/passive-group-session.js';
import {
  drainPassiveGroupBuffer,
  formatPassiveGroupContextBlock,
  peekPassiveGroupBuffer,
  pushPassiveGroupLine,
} from '../src/session/passive-group-buffer.js';
import { buildTurnUserMessages } from '../src/context/turn-user-message.js';
import { CURRENT_MESSAGE_MARKER, DEFAULT_CONFIG } from '../src/config/index.js';
import type { ZhinAgentPrivate } from '../src/internal/agent-host.js';

function groupMessage(text: string, senderId = 'u-peer') {
  return {
    $adapter: 'icqq',
    $endpoint: 'bot1',
    $channel: { type: 'group' as const, id: 'g1' },
    $sender: { id: senderId, name: 'Peer' },
    $content: text,
  };
}

const SESSION_KEY = 'icqq:bot1:group:g1';

describe('passive group buffer', () => {
  it('formatPassiveGroupContextBlock 为空时返回 null', () => {
    expect(formatPassiveGroupContextBlock([])).toBeNull();
  });

  it('@ 时合并旁听并标记当前消息', () => {
    pushPassiveGroupLine(SESSION_KEY, {
      senderId: 'u1',
      senderName: 'Alice',
      text: '怎么可能，数据不会串的',
      at: Date.now(),
    });
    const passiveBlock = formatPassiveGroupContextBlock(drainPassiveGroupBuffer(SESSION_KEY));
    const { promptMessages } = buildTurnUserMessages(
      groupMessage('@bot 我有哪些定时任务呀', 'master') as never,
      '我有哪些定时任务呀',
      passiveBlock,
    );
    const text = promptMessages[0]?.content.find((b) => b.type === 'text')?.text ?? '';
    expect(text).toContain('数据不会串的');
    expect(text).toContain(CURRENT_MESSAGE_MARKER);
    expect(text).toContain('我有哪些定时任务呀');
    expect(text.indexOf('我有哪些定时任务呀')).toBeGreaterThan(text.indexOf(CURRENT_MESSAGE_MARKER));
  });
});

describe('appendPassiveGroupMessageToContext', () => {
  it('旁听消息写入内存缓冲，不直接进入 loadContext', async () => {
    const { repository, sessionStore: agentSessionStore } = createMemoryContextRepository();
    const agent = {
      config: DEFAULT_CONFIG,
      agentSessionStore,
      contextRepository: repository,
    } as unknown as ZhinAgentPrivate;

    const msg = groupMessage('上面有人说好慢');
    await appendPassiveGroupMessageToContext(agent, msg as never, '上面有人说好慢');

    const active = await agentSessionStore.findActive(SESSION_KEY);
    expect(active).toBeTruthy();

    const ctx = await repository.loadContext(active!.session_id);
    expect(ctx.messages).toHaveLength(0);
    expect(peekPassiveGroupBuffer(SESSION_KEY)).toHaveLength(1);
    expect(peekPassiveGroupBuffer(SESSION_KEY)[0]?.text).toContain('好慢');
  });
});
