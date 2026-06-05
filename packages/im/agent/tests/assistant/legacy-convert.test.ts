import { describe, it, expect } from 'vitest';
import {
  cronRecordToAssistant,
  assistantToCronRecord,
  toolContextToImNotify,
} from '../../src/assistant/legacy-convert.js';

describe('legacy-convert', () => {
  it('cron ↔ assistant 往返保持 prompt 与 notify', () => {
    const record = {
      id: 'cron_abc',
      cronExpression: '0 8 * * 1-5',
      prompt: '工作日早报',
      enabled: true,
      notify: {
        channel: 'im' as const,
        platform: 'icqq',
        botId: '8596238',
        sceneId: '123',
        scope: 'private' as const,
      },
      createdAt: 2000,
    };

    const assistant = cronRecordToAssistant(record);
    expect(assistant.schedule).toEqual({ kind: 'cron', expr: '0 8 * * 1-5' });
    expect(assistant.action).toEqual({ kind: 'agent', prompt: '工作日早报' });
    expect(assistant.notify.channel).toBe('im');

    const back = assistantToCronRecord(assistant);
    expect(back?.cronExpression).toBe('0 8 * * 1-5');
    expect(back?.notify?.botId).toBe('8596238');
  });

  it('toolContextToImNotify 从会话上下文构建 im notify', () => {
    expect(toolContextToImNotify({})).toEqual({ channel: 'silent' });
    expect(toolContextToImNotify({ botId: '1', sceneId: '2' }).channel).toBe('im');
  });
});
