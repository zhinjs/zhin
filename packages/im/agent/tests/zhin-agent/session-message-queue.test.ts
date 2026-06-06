import { describe, it, expect } from 'vitest';
import { createUserMessage } from '@zhin.js/ai';
import { SessionMessageQueue } from '../../src/zhin-agent/session-message-queue.js';

describe('SessionMessageQueue', () => {
  const msg = (text: string) => createUserMessage(text);

  it('drains steering one-at-a-time', () => {
    const queue = new SessionMessageQueue('one-at-a-time', 'one-at-a-time');
    queue.pushSteering([msg('a'), msg('b')]);
    expect(queue.drainSteering()).toHaveLength(1);
    expect(queue.drainSteering()[0]?.content[0]).toMatchObject({ type: 'text', text: 'b' });
    expect(queue.drainSteering()).toHaveLength(0);
  });

  it('drains followUp all at once', () => {
    const queue = new SessionMessageQueue('one-at-a-time', 'all');
    queue.pushFollowUp([msg('x'), msg('y')]);
    expect(queue.drainFollowUp()).toHaveLength(2);
    expect(queue.hasFollowUp()).toBe(false);
  });

  it('clear resets queues', () => {
    const queue = new SessionMessageQueue('all', 'all');
    queue.pushSteering(msg('s'));
    queue.pushFollowUp(msg('f'));
    queue.clearSteering();
    queue.clearFollowUp();
    expect(queue.steeringDepth()).toBe(0);
    expect(queue.followUpDepth()).toBe(0);
  });
});
