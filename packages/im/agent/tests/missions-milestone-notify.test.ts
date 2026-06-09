/**
 * Mission milestone notify helpers.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  parseOrchestrationSessionKey,
  formatMissionMilestoneMessage,
  deliverMissionMilestoneIm,
} from '../src/orchestrator/mission-milestone-notify.js';

describe('mission-milestone-notify', () => {
  it('parses platform:bot:scope:sceneId session keys', () => {
    expect(parseOrchestrationSessionKey('sandbox:bot1:private:user1')).toEqual({
      platform: 'sandbox',
      botId: 'bot1',
      scope: 'private',
      sceneId: 'user1',
    });
  });

  it('formats milestone message', () => {
    const text = formatMissionMilestoneMessage('mission_complete', 'abc123', '可合并');
    expect(text).toContain('Mission 完成');
    expect(text).toContain('abc123');
  });

  it('delivers IM via send callback', async () => {
    const send = vi.fn().mockResolvedValue('msg-id');
    const ok = await deliverMissionMilestoneIm(
      'sandbox:bot1:private:user1',
      'mission_complete',
      'run1',
      'done',
      send,
    );
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      context: 'sandbox',
      bot: 'bot1',
      id: 'user1',
      type: 'private',
    }));
  });
});
