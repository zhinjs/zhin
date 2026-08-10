import { describe, it, expect } from 'vitest';
import {
  resolveSubagentActivityTag,
  withSubagentActivityPrefix,
  applySubagentActivityPrefixToConfig,
  resolveActivityFeedbackSessionId,
} from '../../src/activity-feedback/subagent-prefix.js';
import { toActivityFeedbackEventContext } from '../../src/activity-feedback/event-context.js';
import type { AIEventPayload } from '../../src/ai-event-subscriber.js';

describe('subagent activity prefix', () => {
  it('resolves short agentId tags for subagent payloads', () => {
    expect(resolveSubagentActivityTag({ source: 'subagent', agentId: 'researcher' })).toBe('researcher');
    expect(resolveSubagentActivityTag({ source: 'zhin-agent', agentId: 'researcher' })).toBeUndefined();
    expect(resolveSubagentActivityTag({ source: 'subagent', agentId: '很长的中文任务标签不应该当 tag' })).toBe('subagent');
  });

  it('prefixes thinking/processing messages', () => {
    expect(withSubagentActivityPrefix('思考中...', {
      source: 'subagent',
      agentId: 'researcher',
    })).toBe('[researcher] 思考中...');
    expect(withSubagentActivityPrefix('正在处理中...', {
      source: 'subagent',
      agentId: 'executor',
    })).toBe('[executor] 正在处理中...');
    expect(withSubagentActivityPrefix('[researcher] 思考中...', {
      source: 'subagent',
      agentId: 'researcher',
    })).toBe('[researcher] 思考中...');
    expect(withSubagentActivityPrefix('思考中...', {
      source: 'zhin-agent',
    })).toBe('思考中...');
  });

  it('prefixes message-type phase configs only', () => {
    expect(applySubagentActivityPrefixToConfig(
      { type: 'message', message: '思考中...', autoRemove: true },
      { source: 'subagent', agentId: 'researcher' },
    ).message).toBe('[researcher] 思考中...');
    expect(applySubagentActivityPrefixToConfig(
      { type: 'reaction', emoji: '60', autoRemove: true },
      { source: 'subagent', agentId: 'researcher' },
    ).type).toBe('reaction');
  });

  it('isolates subagent activity session ids', () => {
    const id = resolveActivityFeedbackSessionId({
      source: 'subagent',
      agentId: 'researcher',
      sessionId: 'qq:知音:private:abc',
      taskId: '91a68419-ffff',
    });
    expect(id).toBe('qq:知音:private:abc::agent:researcher:91a68419-fff');
    expect(resolveActivityFeedbackSessionId({
      source: 'zhin-agent',
      sessionId: 'qq:知音:private:abc',
    })).toBe('qq:知音:private:abc');
  });

  it('toActivityFeedbackEventContext namespaces subagent session options', () => {
    const ctx = toActivityFeedbackEventContext({
      source: 'subagent',
      agentId: 'researcher',
      taskId: '91a68419',
      platform: 'qq',
      endpointId: '知音',
      sessionId: 'qq:知音:private:477561',
      sceneId: '477561',
      userId: '477561',
      scope: 'private',
    } as AIEventPayload);
    expect(ctx?.sessionId).toContain('::agent:researcher:91a68419');
    expect(ctx?.options.sessionId).toBe(ctx?.sessionId);
    expect(ctx?.groupId).toBe('477561');
  });
});
