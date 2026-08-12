import { describe, it, expect, vi } from 'vitest';
import {
  parseCollaborationReplyJson,
} from '../../src/collaboration/collaboration-outbound.js';

describe('parseCollaborationReplyJson', () => {
  it('parses bare JSON with mentions', () => {
    const raw = '{"mentions":["researcher","210723495"],"text":"请同步当前调研进展"}';
    expect(parseCollaborationReplyJson(raw)).toEqual({
      mentions: ['researcher', '210723495'],
      text: '请同步当前调研进展',
    });
  });

  it('parses fenced JSON', () => {
    const raw = '```json\n{"mentions":["planner"],"text":"你好"}\n```';
    expect(parseCollaborationReplyJson(raw)).toEqual({
      mentions: ['planner'],
      text: '你好',
    });
  });

  it('returns null for plain markdown', () => {
    expect(parseCollaborationReplyJson('@researcher 你好')).toBeNull();
  });

  it('returns null when text missing', () => {
    expect(parseCollaborationReplyJson('{"mentions":["a"]}')).toBeNull();
  });
});

describe('collaboration outbound harness helpers', () => {
  const cell = {
    id: 'room',
    adapter: 'icqq',
    sceneId: '1',
    members: [
      { endpointKey: '8596238', primary: 'planner', pipelineRole: 'planner' as const },
      { endpointKey: '210723495', primary: 'researcher', pipelineRole: 'researcher' as const },
    ],
  };

  it('stripPlannerPublicMentionsFromSegments removes self @', async () => {
    const { stripPlannerPublicMentionsFromSegments } = await import('../../src/collaboration/collaboration-outbound.js');
    const adapter = {
      endpoints: new Map([['8596238', { $platformUserId: '8596238' }]]),
    };
    const out = stripPlannerPublicMentionsFromSegments(
      [{ type: 'text', data: { text: ' @8596238 大家好' } }],
      cell,
      '8596238',
      adapter as never,
    );
    expect(out).toEqual([{ type: 'text', data: { text: ' 大家好' } }]);
  });

  it('isCollaborationNoOpReasoningOutbound detects meta silence', async () => {
    const { isCollaborationNoOpReasoningOutbound } = await import('../../src/collaboration/collaboration-outbound.js');
    expect(isCollaborationNoOpReasoningOutbound([
      [{ type: 'text', data: { text: "This is a reply to another agent, not to me. I'll stay silent." } }],
    ])).toBe(true);
    expect(isCollaborationNoOpReasoningOutbound([
      [{ type: 'at', data: { id: '8596238' } }, { type: 'text', data: { text: ' 已完成' } }],
    ])).toBe(false);
  });
});
