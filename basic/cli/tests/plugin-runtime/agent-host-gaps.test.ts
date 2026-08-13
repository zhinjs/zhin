import { describe, expect, it } from 'vitest';
import { Message } from '@zhin.js/core/runtime';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { resolveIMSessionIdFromMessage, type AITriggerConfig } from '@zhin.js/core';
import type { ImTranscriptWriteInput } from '@zhin.js/agent';
import {
  bridgeRuntimeMessage,
  createRuntimeTurnRequest,
  recordRuntimeTranscript,
  recordPassiveGroupContext,
  resolveRuntimeSenderRoles,
  resolveTriggerTimeoutMs,
  renderTriggerError,
  createDeterministicApprovalPort,
  runtimeApprovalPolicy,
  withTriggerTimeout,
} from '../../src/plugin-runtime/agent-host-installer.js';
import { createEndpointRoleResolver } from '../../src/plugin-runtime/start-command.js';

const adapter = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'icqq');

describe('Plugin Runtime Tool policy bridge', () => {
  it('preserves never/on-risk/always for the Agent approval gate', () => {
    expect(runtimeApprovalPolicy('never')).toBe('never');
    expect(runtimeApprovalPolicy('on-risk')).toBe('on-risk');
    expect(runtimeApprovalPolicy('always')).toBe('always');
  });

  it('provides deterministic CLI approval ports with deny as the default', async () => {
    const input = {
      requestId: 'r1', toolName: 'danger', question: 'continue?', signal: new AbortController().signal,
    };
    await expect(createDeterministicApprovalPort().requestApproval(input)).resolves.toBe(false);
    await expect(createDeterministicApprovalPort('approve').requestApproval(input)).resolves.toBe(true);
  });
});

describe('canonical IM TurnRequest ingress', () => {
  it('maps runtime identity, scene, media, policy, and session without classic Message fields', () => {
    const message = makeMessage({
      content: 'look',
      target: 'group:100',
      sender: { id: 'user-1', name: 'Alice' },
      metadata: { endpoint: '10001', quote_id: 'quoted-1', quote_text: 'quoted body' },
      segments: [{
        type: 'image',
        data: { media: { kind: 'url', value: 'https://example.com/a.png', mime_type: 'image/png' } },
      }],
    });
    const signal = new AbortController().signal;
    const request = createRuntimeTurnRequest(message, 'look closer', {
      isMaster: false,
      isTrusted: true,
    }, {
      traceId: 'trace-1',
      turnId: 'turn-1',
      signal,
      workspaceRoot: '/workspace',
      ports: {},
    });

    expect(request).toMatchObject({
      identity: { traceId: 'trace-1', turnId: 'turn-1' },
      origin: {
        kind: 'im',
        platform: 'icqq',
        endpoint: '10001',
        scope: 'group',
        sceneId: '100',
        messageId: 'm1',
      },
      principal: { subjectId: 'user-1', displayName: 'Alice', roles: ['trusted'] },
      input: {
        text: 'look closer',
        media: [{
          kind: 'image',
          source: { kind: 'url', value: 'https://example.com/a.png' },
          mimeType: 'image/png',
        }],
        quote: { messageId: 'quoted-1', text: 'quoted body' },
      },
      session: { key: 'icqq:10001:group:100' },
      policy: { permissions: ['trusted'], unattended: false, filesystem: { workspaceRoot: '/workspace' } },
    });
    expect(request.signal).toBe(signal);
  });

  it('fails closed when authenticated sender or endpoint identity is absent', () => {
    const signal = new AbortController().signal;
    const options = { traceId: 't', turnId: 'u', signal, workspaceRoot: '/workspace', ports: {} } as const;
    expect(() => createRuntimeTurnRequest(makeMessage({
      content: 'x', sender: null, metadata: { endpoint: 'bot' },
    }), 'x', { isMaster: false, isTrusted: false }, options)).toThrow('sender identity');
    expect(() => createRuntimeTurnRequest(makeMessage({
      content: 'x', sender: 'u', metadata: {},
    }), 'x', { isMaster: false, isTrusted: false }, options)).toThrow('endpoint identity');
  });

  it('preserves platform roles alongside framework trust roles', () => {
    const message = makeMessage({
      content: 'x', sender: { id: 'u', roles: ['owner', 'admin'] }, metadata: { endpoint: 'bot' },
    });
    const request = createRuntimeTurnRequest(message, 'x', {
      isMaster: false,
      isTrusted: true,
    }, { traceId: 't', turnId: 'u', signal: new AbortController().signal, workspaceRoot: '/workspace', ports: {} });
    expect(request.principal.roles).toEqual(['owner', 'admin', 'trusted']);
    expect(request.policy.permissions).toEqual(['owner', 'admin', 'trusted']);
  });
});

/** 测试便利：legacy `kind:id` 串 → ConversationRef（仅测试侧组帧用）。 */
function conversationFromTarget(target: string) {
  const match = /^(private|group|channel):(.+)$/.exec(target);
  return {
    endpoint: { id: String(adapter), adapter: String(adapter).split('\0')[0]! },
    kind: (match?.[1] ?? 'private') as 'private' | 'group' | 'channel',
    id: match?.[2] ?? target,
  };
}

function makeMessage(input: {
  content: string;
  target?: string;
  sender?: string | { id: string; name?: string; roles?: readonly string[] } | null;
  metadata?: Record<string, unknown>;
  segments?: ConstructorParameters<typeof Message>[6];
}): Message {
  const conversation = conversationFromTarget(input.target ?? 'group:100');
  const senderRef = input.sender === null
    ? undefined
    : typeof input.sender === 'object'
      ? input.sender
      : { id: input.sender ?? 'user-1', name: input.sender };
  return new Message(
    conversation,
    input.content,
    1,
    async () => ({ status: 'sent' as const }),
    senderRef,
    Object.freeze(input.metadata ?? {}),
    input.segments,
    { conversation, id: 'm1' },
    typeof input.metadata?.endpoint === 'string' ? input.metadata.endpoint : undefined,
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
  const passive: Array<{
    sessionKey: string;
    senderId: string;
    senderName: string;
    text: string;
  }> = [];
  return {
    transcripts,
    passive,
    async recordImTranscript(input: ImTranscriptWriteInput) {
      transcripts.push(input);
    },
    async recordPassiveGroupObservation(observation: typeof passive[number]) {
      passive.push(observation);
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
      senderId: message.sender?.id ?? '',
      senderName: message.sender?.name ?? message.sender?.id ?? '',
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

  it('出站：assistant 角色，sender_id 回退为 endpointKey', () => {
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
    expect(agent.passive).toEqual([expect.objectContaining({
      sessionKey: expect.stringContaining('group:100'),
      senderId: 'user-1',
      text: '大家今晚吃什么',
    })]);
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
    expect(agent.passive).toEqual([expect.objectContaining({
      sessionKey: expect.stringContaining('channel:ch-1'),
      text: '频道消息',
    })]);
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

  it('withTriggerTimeout：signal-aware turn 会在超时后收到取消信号', async () => {
    let observedSignal: AbortSignal | undefined;
    await expect(withTriggerTimeout(
      (signal) => new Promise((_resolve, reject) => {
        observedSignal = signal;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
      20,
    )).rejects.toThrow('AI 处理超时（20ms）');
    expect(observedSignal?.aborted).toBe(true);
  });
});

describe('缺口 3：masters / trusted 角色解析', () => {
  it('endpoint owner 命中 → master', () => {
    const roles = resolveRuntimeSenderRoles(groupMessage('hi', { userId: 'user-1' }), 'user-1', [], undefined);
    expect(roles).toEqual({ isMaster: true, isTrusted: false });
  });

  it('trigger.masters 命中 → master（无 endpoint owner 时）', () => {
    const trigger: AITriggerConfig = { masters: ['user-1'] };
    const roles = resolveRuntimeSenderRoles(groupMessage('hi', { userId: 'user-1' }), undefined, [], trigger);
    expect(roles).toEqual({ isMaster: true, isTrusted: false });
  });

  it('endpoint trusted 命中 → trusted', () => {
    const roles = resolveRuntimeSenderRoles(groupMessage('hi', { userId: 'user-1' }), undefined, ['user-1'], undefined);
    expect(roles).toEqual({ isMaster: false, isTrusted: true });
  });

  it('trigger.trusted 命中 → trusted', () => {
    const trigger: AITriggerConfig = { trusted: ['user-1'] };
    const roles = resolveRuntimeSenderRoles(groupMessage('hi', { userId: 'user-1' }), undefined, [], trigger);
    expect(roles).toEqual({ isMaster: false, isTrusted: true });
  });

  it('master 优先于 trusted（对齐 legacy resolveSenderRoles）', () => {
    const trigger: AITriggerConfig = { masters: ['user-1'], trusted: ['user-1'] };
    const roles = resolveRuntimeSenderRoles(groupMessage('hi', { userId: 'user-1' }), undefined, ['user-1'], trigger);
    expect(roles).toEqual({ isMaster: true, isTrusted: false });
  });

  it('普通用户无角色', () => {
    const roles = resolveRuntimeSenderRoles(groupMessage('hi'), 'owner-x', ['trusted-y'], undefined);
    expect(roles).toEqual({ isMaster: false, isTrusted: false });
  });

  it('sender.id 不匹配 master 时不授权', () => {
    const message = groupMessage('hi', { userId: 'attacker-id' }, 'attacker-id');
    const roles = resolveRuntimeSenderRoles(message, 'owner-x', ['owner-x'], {
      masters: ['owner-x'],
      trusted: ['owner-x'],
    });
    expect(roles).toEqual({ isMaster: false, isTrusted: false });
  });

  it('sender.id 匹配 master 时授权（无需 metadata）', () => {
    const message = makeMessage({
      content: 'hi',
      target: 'group:100',
      sender: { id: 'owner-x', name: '昵称' },
      metadata: { endpoint: '10001' },
    });
    const roles = resolveRuntimeSenderRoles(message, 'owner-x', [], {
      masters: ['owner-x'],
    });
    expect(roles).toEqual({ isMaster: true, isTrusted: false });
  });

  it.each([
    ['user_id', 'legacy-user'],
    ['senderId', 'runtime-user'],
  ])('sender.id 缺失时 fallback metadata.%s 作为授权身份', (key, id) => {
    const message = makeMessage({
      content: 'hi',
      target: 'group:100',
      sender: null,
      metadata: { endpoint: '10001', [key]: id },
    });
    const roles = resolveRuntimeSenderRoles(message, id, [], undefined);
    expect(roles).toEqual({ isMaster: true, isTrusted: false });
  });

  it('bridgeRuntimeMessage 将角色快照写入 $sender.isMaster/isTrusted', () => {
    const message = groupMessage('hi');
    const comm = bridgeRuntimeMessage(message, 'user-1', { isMaster: true, isTrusted: false });
    expect(comm.$sender.isMaster).toBe(true);
    expect(comm.$sender.isTrusted).toBe(false);
    expect((comm as { extra?: Record<string, unknown> }).extra?.endpointMaster).toBe('user-1');
  });
});

describe('稳定 senderId：sender.id 是一等字段（SSOT）', () => {
  it('sender.id 直接作为 $sender.id，name 保留供 prompt 展示', () => {
    const message = makeMessage({
      content: '你好',
      sender: { id: 'OPENID_A', name: 'Cc' },
      target: 'private:OPENID_A',
      metadata: { endpoint: 'zhin' },
    });
    const comm = bridgeRuntimeMessage(message, undefined, { isMaster: false, isTrusted: false });
    expect(comm.$sender.id).toBe('OPENID_A');
    expect(comm.$sender.name).toBe('Cc');
    expect(resolveIMSessionIdFromMessage(comm)).toBe('icqq:zhin:private:OPENID_A');
  });

  it('昵称变化不影响私聊 session key（sender.id 稳定）', () => {
    const before = bridgeRuntimeMessage(makeMessage({
      content: 'hi', sender: { id: 'OPENID_A', name: 'Cc' }, target: 'private:OPENID_A',
      metadata: { endpoint: 'zhin' },
    }), undefined, { isMaster: false, isTrusted: false });
    const after = bridgeRuntimeMessage(makeMessage({
      content: 'hi', sender: { id: 'OPENID_A', name: 'Cc(新昵称)' }, target: 'private:OPENID_A',
      metadata: { endpoint: 'zhin' },
    }), undefined, { isMaster: false, isTrusted: false });
    expect(resolveIMSessionIdFromMessage(after)).toBe(resolveIMSessionIdFromMessage(before));
  });

  it('sender.id 直接使用（OneBot/ICQQ sender 本身即 ID）', () => {
    const message = privateMessage('你好');
    const comm = bridgeRuntimeMessage(message, undefined, { isMaster: false, isTrusted: false });
    expect(comm.$sender.id).toBe('user-1');
    expect(resolveIMSessionIdFromMessage(comm)).toBe('icqq:10001:private:user-1');
  });

  it('sender.id 缺失时 fallback metadata.userId', () => {
    const message = makeMessage({
      content: '你好',
      target: 'private:user-1',
      sender: null,
      metadata: { endpoint: '10001', userId: 'stable-id' },
    });
    const comm = bridgeRuntimeMessage(message, undefined, { isMaster: false, isTrusted: false });
    expect(comm.$sender.id).toBe('stable-id');
  });

  it.each([
    ['userId', 'user-id'],
    ['user_id', 'user-id'],
    ['senderId', 'user-id'],
  ] as const)('sender.id 缺失时 fallback metadata.%s', (field, expectedId) => {
    const message = makeMessage({
      content: '你好',
      sender: null,
      target: 'private:user-id',
      metadata: { endpoint: '10001', [field]: expectedId },
    });
    const comm = bridgeRuntimeMessage(message, undefined, { isMaster: false, isTrusted: false });
    expect(comm.$sender.id).toBe(expectedId);
  });
});

describe('conversation.kind 场景映射', () => {
  it.each([
    ['private', 'private'],
    ['group', 'group'],
    ['channel', 'channel'],
  ] as const)('conversation.kind=%s → synthetic channel type=%s', (kind, expectedType) => {
    const message = makeMessage({
      content: '消息',
      sender: { id: 'telegram-user-1' },
      target: `${kind}:telegram-chat-1`,
      metadata: { endpoint: 'telegram-bot' },
    });
    const comm = bridgeRuntimeMessage(message, undefined, { isMaster: false, isTrusted: false });
    expect(comm.$channel.type).toBe(expectedType);
  });

  it('group 消息进入 Passive Group Context', async () => {
    const agent = makeAgentStub();
    const message = makeMessage({
      content: 'Telegram 群聊消息',
      sender: { id: 'telegram-user-1', name: 'Alice' },
      target: 'group:-100123',
      metadata: { endpoint: 'telegram-bot' },
    });
    const comm = bridgeRuntimeMessage(message, undefined, { isMaster: false, isTrusted: false });
    await recordPassiveGroupContext(agent, message, comm);
    expect(agent.passive).toEqual([expect.objectContaining({
      sessionKey: expect.stringContaining('group:-100123'),
      senderId: 'telegram-user-1',
      senderName: 'Alice',
      text: 'Telegram 群聊消息',
    })]);
  });
});

describe('入站段契约：bridgeRuntimeMessage 透传 segments 与媒体引用', () => {
  const extraOf = (comm: unknown) =>
    (comm as { extra?: Record<string, unknown> }).extra ?? {};

  it('image/audio/video/file 段的 MediaRef 写入 extra.media，segments 原样挂载', () => {
    const segments = [
      { type: 'text', data: { text: '看这个' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://cdn.example/a.jpg' } } },
      { type: 'audio', data: { url: 'https://cdn.example/a.mp3' } },
      { type: 'file', data: { file: '/tmp/a.zip' } },
    ] as const;
    const message = makeMessage({
      content: '看这个[image][audio][file]',
      segments,
    });
    const comm = bridgeRuntimeMessage(message, undefined, { isMaster: false, isTrusted: false });
    const extra = extraOf(comm);
    expect(extra.segments).toEqual(segments);
    expect(extra.media).toEqual([
      { type: 'image', media: { kind: 'url', value: 'https://cdn.example/a.jpg' } },
      { type: 'audio', media: { kind: 'url', value: 'https://cdn.example/a.mp3' } },
      { type: 'file', media: { kind: 'path', value: '/tmp/a.zip' } },
    ]);
  });

  it('纯文本段消息不写 media / segments 键（零侵入旧路径）', () => {
    const message = groupMessage('在吗');
    const comm = bridgeRuntimeMessage(message, undefined, { isMaster: false, isTrusted: false });
    const extra = extraOf(comm);
    expect('media' in extra).toBe(false);
    expect('segments' in extra).toBe(false);
    // metadata 原有字段不受影响
    expect(extra.channelType).toBe('group');
  });

  it('仅有非媒体段的 segments 挂 segments 但不写 media', () => {
    const segments = [
      { type: 'text', data: { text: 'hi' } },
      { type: 'mention', data: { target: '10001', name: 'bot' } },
    ] as const;
    const message = makeMessage({ content: 'hi @bot', segments });
    const comm = bridgeRuntimeMessage(message, undefined, { isMaster: false, isTrusted: false });
    const extra = extraOf(comm);
    expect(extra.segments).toEqual(segments);
    expect('media' in extra).toBe(false);
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

  it('endpoints[].master / endpoints[].trusted 解析', async () => {
    const resolver = await createEndpointRoleResolver({
      plugins: {
        icqq: {
          endpoints: [{ name: '10001', master: 'u-ep-master', trusted: 't3 t4' }],
        },
      },
    } as never);
    expect(resolver.resolveOwner('icqq', '10001')).toBe('u-ep-master');
    expect(resolver.resolveOwner('10001', '10001')).toBe('u-ep-master');
    // 不挂到插件键，避免污染同适配器其它 endpoint
    expect(resolver.resolveOwner('icqq', 'other')).toBeUndefined();
    expect(resolver.resolveTrusted('icqq', '10001')).toEqual(['t3', 't4']);
  });

  it('endpoints[].owner 不作为框架 master（owner/admin 是群身份）', async () => {
    const resolver = await createEndpointRoleResolver({
      plugins: {
        qq: {
          endpoints: [{ name: '知音', owner: 'should-not-be-master', master: 'real-master' }],
        },
      },
    } as never);
    expect(resolver.resolveOwner('qq', '知音')).toBe('real-master');
    expect(resolver.resolveOwner('知音', '知音')).toBe('real-master');
  });

  it('多 endpoint 各自 master 互不覆盖', async () => {
    const resolver = await createEndpointRoleResolver({
      plugins: {
        qq: {
          endpoints: [
            { name: 'zhin', master: 'master-a' },
            { name: '知音', master: 'master-b' },
          ],
        },
      },
    } as never);
    expect(resolver.resolveOwner('qq', 'zhin')).toBe('master-a');
    expect(resolver.resolveOwner('qq', '知音')).toBe('master-b');
  });

  it('endpoints[].master → bridge isMaster → edit_file / 文件策略认 master', async () => {
    const { checkFileToolAccess } = await import(
      '../../../../packages/im/agent/src/security/dangerous-tool-policy.js'
    );
    const { runToolPolicies } = await import(
      '../../../../packages/im/agent/src/security/policy-facade.js'
    );
    const masterId = '477561AD3A89AFCDABB6AFCB71FF54DF';
    const resolver = await createEndpointRoleResolver({
      plugins: {
        qq: {
          endpoints: [{ name: '知音', master: masterId }],
        },
      },
    } as never);
    const endpointMaster = resolver.resolveOwner('qq', '知音');
    expect(endpointMaster).toBe(masterId);

    const message = makeMessage({
      content: 'edit please',
      target: `private:${masterId}`,
      sender: { id: masterId, name: '昵称可变' },
      metadata: {
        endpoint: '知音',
      },
    });
    const roles = resolveRuntimeSenderRoles(message, endpointMaster, [], undefined);
    expect(roles).toEqual({ isMaster: true, isTrusted: false });

    const comm = bridgeRuntimeMessage(message, endpointMaster, roles);
    expect(comm.$sender.isMaster).toBe(true);
    expect(comm.$sender.id).toBe(masterId);

    const access = checkFileToolAccess('edit_file', comm);
    expect(access).toMatchObject({ allowed: true, role: 'master' });

    const result = runToolPolicies({
      toolName: 'edit_file',
      filePath: '/tmp/zhin-master-edit-ok.txt',
      rawFilePath: '/tmp/zhin-master-edit-ok.txt',
      commMessage: comm,
    });
    expect(result.allowed).toBe(true);
    expect(result.needsOwnerApproval).toBeFalsy();
    expect(result.decisions.find((d) => d.policy === 'role-gate')?.decision.role).toBe('master');
  });

  it('无 plugins 配置时返回空解析', async () => {
    const resolver = await createEndpointRoleResolver({} as never);
    expect(resolver.resolveOwner('icqq', 'x')).toBeUndefined();
    expect(resolver.resolveTrusted('icqq', 'x')).toEqual([]);
  });
});
