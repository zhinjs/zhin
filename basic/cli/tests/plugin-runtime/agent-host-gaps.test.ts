import { describe, expect, it } from 'vitest';
import { Message } from '@zhin.js/core/runtime';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import type { AITriggerConfig } from '@zhin.js/core';
import type { ImTranscriptWriteInput } from '@zhin.js/agent';
import {
  bridgeRuntimeMessage,
  recordRuntimeTranscript,
  recordPassiveGroupContext,
  resolveRuntimeSenderRoles,
  resolveTriggerTimeoutMs,
  renderTriggerError,
  withTriggerTimeout,
} from '../../src/plugin-runtime/agent-host-installer.js';
import { createEndpointRoleResolver } from '../../src/plugin-runtime/start-command.js';

const adapter = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'icqq');

function makeMessage(input: {
  content: string;
  target?: string;
  sender?: string;
  metadata?: Record<string, unknown>;
}): Message {
  return new Message(
    adapter,
    input.target ?? 'group:100',
    input.content,
    1,
    async () => undefined,
    'm1',
    input.sender ?? 'user-1',
    Object.freeze(input.metadata ?? {}),
  );
}

function groupMessage(content: string, metadata?: Record<string, unknown>, sender?: string): Message {
  return makeMessage({
    content,
    sender,
    target: 'group:100',
    metadata: { channelType: 'group', endpoint: '10001', ...metadata },
  });
}

function privateMessage(content: string, metadata?: Record<string, unknown>): Message {
  return makeMessage({
    content,
    target: 'private:user-1',
    metadata: { channelType: 'private', endpoint: '10001', ...metadata },
  });
}

function makeAgentStub() {
  const transcripts: ImTranscriptWriteInput[] = [];
  const passive: { rawText: string }[] = [];
  return {
    transcripts,
    passive,
    async recordImTranscript(input: ImTranscriptWriteInput) {
      transcripts.push(input);
    },
    async recordPassiveGroupMessage(_message: unknown, rawText: string) {
      passive.push({ rawText });
    },
  };
}

describe('缺口 1：im_transcripts 流水写入（recordRuntimeTranscript）', () => {
  it('入站：scene 字段与 chat_history 查询 SSOT 对齐（group）', () => {
    const agent = makeAgentStub();
    const message = groupMessage('在吗');
    const commMessage = bridgeRuntimeMessage(message, undefined, { isMaster: false, isTrusted: false });
    recordRuntimeTranscript(agent, commMessage, {
      direction: 'inbound',
      body: message.content,
      messageId: message.id,
      senderId: message.sender ?? '',
      senderName: message.sender ?? '',
      senderRole: 'user',
    });
    expect(agent.transcripts).toHaveLength(1);
    expect(agent.transcripts[0]).toMatchObject({
      message_id: 'm1',
      platform: 'icqq',
      endpoint_id: '10001',
      scene_id: '100',
      scene_type: 'group',
      sender_id: 'user-1',
      sender_name: 'user-1',
      sender_role: 'user',
      direction: 'inbound',
      body: '在吗',
    });
  });

  it('入站：私聊 scene_id 取 senderId（与 resolveSceneFieldsFromMessage 一致）', () => {
    const agent = makeAgentStub();
    const message = privateMessage('你好');
    const commMessage = bridgeRuntimeMessage(message, undefined, { isMaster: false, isTrusted: false });
    recordRuntimeTranscript(agent, commMessage, {
      direction: 'inbound',
      body: message.content,
      senderId: 'user-1',
      senderRole: 'user',
    });
    expect(agent.transcripts[0]).toMatchObject({
      scene_id: 'user-1',
      scene_type: 'private',
      direction: 'inbound',
    });
  });

  it('出站：assistant 角色，sender_id 回退为 endpointId', () => {
    const agent = makeAgentStub();
    const message = groupMessage('在吗');
    const commMessage = bridgeRuntimeMessage(message, undefined, { isMaster: false, isTrusted: false });
    recordRuntimeTranscript(agent, commMessage, {
      direction: 'outbound',
      body: 'AI 回复',
      senderRole: 'assistant',
    });
    expect(agent.transcripts[0]).toMatchObject({
      platform: 'icqq',
      endpoint_id: '10001',
      scene_id: '100',
      sender_id: '10001',
      sender_role: 'assistant',
      direction: 'outbound',
      body: 'AI 回复',
    });
  });

  it('空 body 不落库', () => {
    const agent = makeAgentStub();
    const message = groupMessage('x');
    const commMessage = bridgeRuntimeMessage(message, undefined, { isMaster: false, isTrusted: false });
    recordRuntimeTranscript(agent, commMessage, { direction: 'inbound', body: '   ' });
    expect(agent.transcripts).toHaveLength(0);
  });

  it('record 抛错时仅降级 debug，不向调用方抛出', async () => {
    const failing = {
      async recordImTranscript() {
        throw new Error('db down');
      },
    };
    const message = groupMessage('在吗');
    const commMessage = bridgeRuntimeMessage(message, undefined, { isMaster: false, isTrusted: false });
    expect(() => recordRuntimeTranscript(failing, commMessage, {
      direction: 'inbound',
      body: '在吗',
      senderId: 'user-1',
    })).not.toThrow();
  });
});

describe('缺口 2：群聊旁听（recordPassiveGroupContext）', () => {
  it('群聊未触发消息写入 Passive Group Context', async () => {
    const agent = makeAgentStub();
    const message = groupMessage('大家今晚吃什么');
    const commMessage = bridgeRuntimeMessage(message, undefined, { isMaster: false, isTrusted: false });
    await recordPassiveGroupContext(agent, message, commMessage);
    expect(agent.passive).toEqual([{ rawText: '大家今晚吃什么' }]);
  });

  it('频道（channel）同样旁听', async () => {
    const agent = makeAgentStub();
    const message = makeMessage({
      content: '频道消息',
      target: 'channel:ch-1',
      metadata: { channelType: 'channel', endpoint: '10001' },
    });
    const commMessage = bridgeRuntimeMessage(message, undefined, { isMaster: false, isTrusted: false });
    await recordPassiveGroupContext(agent, message, commMessage);
    expect(agent.passive).toEqual([{ rawText: '频道消息' }]);
  });

  it('私聊不旁听（sandbox/私聊无噪音）', async () => {
    const agent = makeAgentStub();
    const message = privateMessage('私聊消息');
    const commMessage = bridgeRuntimeMessage(message, undefined, { isMaster: false, isTrusted: false });
    await recordPassiveGroupContext(agent, message, commMessage);
    expect(agent.passive).toHaveLength(0);
  });

  it('机器人自身消息不旁听', async () => {
    const agent = makeAgentStub();
    const message = groupMessage('机器人自己说的', undefined, '10001');
    const commMessage = bridgeRuntimeMessage(message, undefined, { isMaster: false, isTrusted: false });
    await recordPassiveGroupContext(agent, message, commMessage);
    expect(agent.passive).toHaveLength(0);
  });

  it('空白内容不旁听', async () => {
    const agent = makeAgentStub();
    const message = groupMessage('   ');
    const commMessage = bridgeRuntimeMessage(message, undefined, { isMaster: false, isTrusted: false });
    await recordPassiveGroupContext(agent, message, commMessage);
    expect(agent.passive).toHaveLength(0);
  });
});

describe('缺口 3：ai.trigger timeout / errorTemplate', () => {
  it('timeout 默认 60000，配置生效，非法值回退默认', () => {
    expect(resolveTriggerTimeoutMs(undefined)).toBe(60_000);
    expect(resolveTriggerTimeoutMs({ timeout: 5_000 })).toBe(5_000);
    expect(resolveTriggerTimeoutMs({ timeout: 0 })).toBe(60_000);
    expect(resolveTriggerTimeoutMs({ timeout: Number.NaN })).toBe(60_000);
  });

  it('errorTemplate 默认 ❌ 模板并插值 {error}', () => {
    expect(renderTriggerError(undefined, 'boom')).toBe('❌ AI 处理失败: boom');
  });

  it('errorTemplate 自定义模板插值 {error}', () => {
    expect(renderTriggerError({ errorTemplate: 'ERR {error}' }, 'boom')).toBe('ERR boom');
    // 空白模板回退默认
    expect(renderTriggerError({ errorTemplate: '  ' }, 'boom')).toBe('❌ AI 处理失败: boom');
  });

  it('withTriggerTimeout：限时内完成则正常返回', async () => {
    const result = await withTriggerTimeout(Promise.resolve('ok'), 50);
    expect(result).toBe('ok');
  });

  it('withTriggerTimeout：超时 reject，迟到的 settle 不影响结果', async () => {
    const slow = new Promise<string>((resolve) => {
      setTimeout(() => resolve('late'), 100);
    });
    await expect(withTriggerTimeout(slow, 20)).rejects.toThrow('AI 处理超时（20ms）');
    // 等待迟到 settle，确保不产生 unhandledRejection / 二次 settle 异常
    await expect(slow).resolves.toBe('late');
  });
});

describe('缺口 3：masters / trusted 角色解析', () => {
  it('endpoint owner 命中 → master', () => {
    const roles = resolveRuntimeSenderRoles(groupMessage('hi'), 'user-1', [], undefined);
    expect(roles).toEqual({ isMaster: true, isTrusted: false });
  });

  it('trigger.masters 命中 → master（无 endpoint owner 时）', () => {
    const trigger: AITriggerConfig = { masters: ['user-1'] };
    const roles = resolveRuntimeSenderRoles(groupMessage('hi'), undefined, [], trigger);
    expect(roles).toEqual({ isMaster: true, isTrusted: false });
  });

  it('endpoint trusted 命中 → trusted', () => {
    const roles = resolveRuntimeSenderRoles(groupMessage('hi'), undefined, ['user-1'], undefined);
    expect(roles).toEqual({ isMaster: false, isTrusted: true });
  });

  it('trigger.trusted 命中 → trusted', () => {
    const trigger: AITriggerConfig = { trusted: ['user-1'] };
    const roles = resolveRuntimeSenderRoles(groupMessage('hi'), undefined, [], trigger);
    expect(roles).toEqual({ isMaster: false, isTrusted: true });
  });

  it('master 优先于 trusted（对齐 legacy resolveSenderRoles）', () => {
    const trigger: AITriggerConfig = { masters: ['user-1'], trusted: ['user-1'] };
    const roles = resolveRuntimeSenderRoles(groupMessage('hi'), undefined, ['user-1'], trigger);
    expect(roles).toEqual({ isMaster: true, isTrusted: false });
  });

  it('普通用户无角色', () => {
    const roles = resolveRuntimeSenderRoles(groupMessage('hi'), 'owner-x', ['trusted-y'], undefined);
    expect(roles).toEqual({ isMaster: false, isTrusted: false });
  });

  it('bridgeRuntimeMessage 将角色快照写入 $sender.isMaster/isTrusted', () => {
    const message = groupMessage('hi');
    const comm = bridgeRuntimeMessage(message, 'user-1', { isMaster: true, isTrusted: false });
    expect(comm.$sender.isMaster).toBe(true);
    expect(comm.$sender.isTrusted).toBe(false);
    expect((comm as { extra?: Record<string, unknown> }).extra?.endpointMaster).toBe('user-1');
  });
});

describe('缺口 3：createEndpointRoleResolver（plugins.<key>.trusted）', () => {
  it('master + trusted 数组解析，name 别名键可查', async () => {
    const resolver = await createEndpointRoleResolver({
      plugins: {
        icqq: { master: 'u-owner', name: 'bot1', trusted: ['t1', 't2'] },
      },
    } as never);
    expect(resolver.resolveOwner('icqq', 'x')).toBe('u-owner');
    expect(resolver.resolveOwner('bot1', 'y')).toBe('u-owner');
    expect(resolver.resolveTrusted('icqq', 'x')).toEqual(['t1', 't2']);
    expect(resolver.resolveTrusted('bot1', 'y')).toEqual(['t1', 't2']);
  });

  it('endpoints[].owner / endpoints[].trusted 解析', async () => {
    const resolver = await createEndpointRoleResolver({
      plugins: {
        icqq: {
          endpoints: [{ name: '10001', owner: 'u-ep-owner', trusted: 't3 t4' }],
        },
      },
    } as never);
    expect(resolver.resolveOwner('icqq', 'x')).toBe('u-ep-owner');
    expect(resolver.resolveOwner('10001', '10001')).toBe('u-ep-owner');
    expect(resolver.resolveTrusted('icqq', 'x')).toEqual(['t3', 't4']);
  });

  it('无 plugins 配置时返回空解析', async () => {
    const resolver = await createEndpointRoleResolver({} as never);
    expect(resolver.resolveOwner('icqq', 'x')).toBeUndefined();
    expect(resolver.resolveTrusted('icqq', 'x')).toEqual([]);
  });
});
