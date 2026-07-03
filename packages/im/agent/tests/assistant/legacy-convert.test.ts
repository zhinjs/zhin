import { describe, it, expect } from 'vitest';
import {
  cronRecordToAssistant,
  assistantToCronRecord,
  messageToIMDeliveryTarget,
} from '../../src/assistant/legacy-convert.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

describe('legacy-convert', () => {
  it('cron ↔ assistant 往返保持 prompt 与 notify', () => {
    const record = {
      id: 'cron_abc',
      cronExpression: '0 8 * * 1-5',
      prompt: '工作日早报',
      enabled: true,
      notify: {
        channel: 'im' as const,
        target: {
          channel: 'im' as const,
          scene: {
            platform: 'icqq',
            endpointId: '8596238',
            sceneId: '123',
            kind: 'private' as const,
          },
        },
      },
      createdAt: 2000,
    };

    const assistant = cronRecordToAssistant(record);
    expect(assistant.schedule).toEqual({ kind: 'cron', expr: '0 8 * * 1-5' });
    expect(assistant.action).toEqual({ kind: 'agent', prompt: '工作日早报' });
    expect(assistant.notify.channel).toBe('im');

    const back = assistantToCronRecord(assistant);
    expect(back?.cronExpression).toBe('0 8 * * 1-5');
    expect(back?.notify?.channel).toBe('im');
    expect(back?.notify?.channel === 'im' ? back.notify.target.scene.endpointId : undefined).toBe('8596238');
  });

  it('messageToIMDeliveryTarget 从 Message 通讯上下文构建 IM target', () => {
    expect(messageToIMDeliveryTarget({} as import('@zhin.js/core').Message<any>)).toBeUndefined();
    expect(messageToIMDeliveryTarget(mockCommMessage({ endpoint: '1', senderId: '2' }))).toEqual({
      channel: 'im',
      scene: {
        platform: 'qq',
        endpointId: '1',
        sceneId: '2',
        kind: 'private',
        senderId: '2',
      },
    });
  });
});
