import { describe, expect, it, vi } from 'vitest';
import { Message, type ImRuntime } from '@zhin.js/core/runtime';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import type { AITriggerConfig } from '@zhin.js/core';
import { turnIntentResolverToken } from '@zhin.js/agent/runtime';
import {
  createDeterministicApprovalPort,
  createRuntimeApprovalPort,
  createRuntimeQuestionPort,
  createRuntimeTurnAccess,
  createRuntimeTurnRequest,
  deliveryOutcomeFromReceipt,
  resolveProductTurnIntent,
  resolveRuntimeSenderRoles,
  resolveRuntimeTurnIntent,
  resolveSnapshotTurnIntentResolver,
  runtimeApprovalPolicy,
} from '../../../../src/plugin-runtime/agent/turn/request.js';
import {
  renderTriggerError,
  resolveTriggerTimeoutMs,
  restrictWorkroomAgentCapabilities,
  routeSpecialistAgent,
  withTriggerTimeout,
  workroomOrchestratorSessionKey,
} from '../../../../src/plugin-runtime/agent/turn/trigger.js';
import { resolveWorkroomOrchestratorConversation } from '../../../../src/plugin-runtime/agent/workroom-port.js';
import {
  createEndpointRoleResolver,
  readConfiguredEndpointKeys,
} from '../../../../src/plugin-runtime/start-command.js';

const adapter = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'icqq');

describe('Workroom Orchestrator turn routing', () => {
  const support = {
    $feature: 'zhin.agent/1' as const,
    name: 'support',
    qualifiedName: 'root/support',
    description: 'support',
    instructions: 'help',
    owner: rootPluginId(),
    source: '/agents/support.md',
  };

  const icqq = {
    ...support,
    name: 'icqq',
    qualifiedName: 'adapter-icqq__icqq',
    platforms: ['icqq'],
  };

  it('pins a Workroom continuation to the catalog Orchestrator', () => {
    expect(routeSpecialistAgent('处理这个问题', { agents: [support] }, 'support', 'zhin'))
      .toEqual({ userText: '处理这个问题', agent: support });
  });

  it('uses the default binding when it is the catalog Orchestrator', () => {
    expect(routeSpecialistAgent('处理这个问题', { agents: [support] }, 'zhin', 'zhin'))
      .toEqual({ userText: '处理这个问题' });
  });

  it('selects the sole specialist for the ingress platform', () => {
    expect(routeSpecialistAgent('查询群列表', { agents: [support, icqq] }, undefined, 'zhin', 'icqq'))
      .toEqual({ userText: '查询群列表', agent: icqq });
  });

  it('keeps an explicit specialist mention ahead of platform routing', () => {
    expect(routeSpecialistAgent('@support 处理这个问题', { agents: [support, icqq] }, undefined, 'zhin', 'icqq'))
      .toEqual({ userText: '处理这个问题', agent: support });
  });

  it('rejects ambiguous specialists for one platform', () => {
    expect(() => routeSpecialistAgent('查询群列表', {
      agents: [icqq, { ...icqq, name: 'qq-admin', qualifiedName: 'adapter-icqq__qq-admin' }],
    }, undefined, 'zhin', 'icqq')).toThrow('Multiple specialist Agents target platform icqq');
  });

  it('isolates the Project session and removes classic subagent delegation', () => {
    expect(workroomOrchestratorSessionKey({
      projectId: 'project:zhin', agentDefinitionId: 'software.orchestrator',
    })).toBe('workroom:project%3Azhin:orchestrator:software.orchestrator');
    const spawn = { name: 'spawn_task' };
    const work = { name: 'workroom_orchestrator_plan_propose' };
    const capabilities = {
      generation: 1, owner: rootPluginId(), tools: [spawn, work],
      skills: [], agents: [], mcp: [], promptSections: [],
    } as never;
    expect(restrictWorkroomAgentCapabilities(capabilities, true).tools).toEqual([work]);
    expect(restrictWorkroomAgentCapabilities(capabilities, false)).toBe(capabilities);
    const conversation = {
      endpoint: { id: 'orchestrator-capability', adapter: 'root/orchestrator' },
      kind: 'group' as const, id: 'shared-room',
    };
    expect(resolveWorkroomOrchestratorConversation({
      zhin: { conversation },
    }, { projectId: 'zhin', space: 'workroom' })).toBe(conversation);
  });
});

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

describe('runtime reply delivery outcome bridge', () => {
  it('preserves non-sent receipts instead of coercing them to sent', () => {
    expect(deliveryOutcomeFromReceipt({ status: 'suppressed' })).toEqual({ status: 'suppressed' });
    expect(deliveryOutcomeFromReceipt({
      status: 'rejected',
      failure: { code: 'outbound_payload_rejected', message: 'bad payload' },
    })).toEqual({ status: 'rejected', code: 'outbound_payload_rejected' });
    expect(deliveryOutcomeFromReceipt({
      status: 'failed',
      failure: { code: 'endpoint_send_failed', message: 'transport closed', retryable: true },
    })).toEqual({ status: 'failed', code: 'endpoint_send_failed', retryable: true });
  });

  it('maps successful receipts to sent with message id when available', () => {
    expect(deliveryOutcomeFromReceipt({
      status: 'sent',
      message: {
        conversation: {
          endpoint: { id: 'sandbox~main', adapter: 'sandbox' },
          kind: 'private',
          id: 'user-1',
        },
        id: 'message-1',
      },
    })).toEqual({ status: 'sent', messageId: 'message-1' });
  });
});

describe('canonical IM TurnRequest ingress', () => {
  it('defaults shared-session overlap to supersede and permits an explicit FIFO policy', () => {
    const message = makeMessage({
      content: 'next', sender: { id: 'u' }, metadata: { endpoint: 'bot' },
    });

    expect(resolveRuntimeTurnIntent(message)).toEqual({ kind: 'supersede' });
    expect(resolveRuntimeTurnIntent(message, 'fifo')).toEqual({ kind: 'new' });
    expect(resolveRuntimeTurnIntent(makeMessage({
      content: 'private next',
      target: 'private:u',
      sender: { id: 'u' },
      metadata: { endpoint: 'bot' },
    }), 'fifo')).toEqual({ kind: 'supersede' });
  });

  it('rejects product-policy authorization asserted by message metadata', () => {
    const message = makeMessage({
      content: 'steer',
      sender: { id: 'u' },
      metadata: {
        endpoint: 'bot',
        turnIntent: { kind: 'steer', targetTurnId: 'active', authorizedBy: 'product_policy' },
      },
    });

    expect(() => resolveRuntimeTurnIntent(message)).toThrow('trusted product policy');
  });

  it('accepts cross-participant authorization only from the trusted host resolver', async () => {
    const message = makeMessage({
      content: 'steer', sender: { id: 'bob' }, metadata: { endpoint: 'bot' },
    });
    const resolver = vi.fn(async ({ defaultIntent }) => ({
      ...defaultIntent,
      kind: 'steer' as const,
      targetTurnId: 'turn-alice',
      authorizedBy: 'product_policy' as const,
    }));

    await expect(resolveProductTurnIntent(
      message,
      { isMaster: false, isTrusted: true },
      'supersede',
      resolver,
    )).resolves.toEqual({
      kind: 'steer', targetTurnId: 'turn-alice', authorizedBy: 'product_policy',
    });
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({
      senderRoles: { isMaster: false, isTrusted: true },
      defaultIntent: { kind: 'supersede' },
    }));
  });

  it('loads the endpoint-owning plugin intent policy from the fixed snapshot', () => {
    const requester = rootPluginId();
    const resolver = vi.fn(() => ({ kind: 'observe' as const }));
    const snapshot = {
      resources: new Map([[requester, new Map([
        [turnIntentResolverToken.id, resolver],
      ])]]),
    };

    expect(resolveSnapshotTurnIntentResolver(snapshot, requester)).toBe(resolver);
  });

  it('maps runtime identity, scene, media, policy, and session without classic Message fields', async () => {
    const message = makeMessage({
      content: 'look',
      target: 'group:100',
      sender: { id: 'user-1', name: 'Alice' },
      metadata: { endpoint: '10001' },
      replyTo: { id: 'quoted-1' },
      segments: [
        { type: 'image', data: { media: { kind: 'url', value: 'https://example.com/a.png', mime_type: 'image/png' } } },
        { type: 'forward', data: { forward_id: 'forward-1' } },
      ],
    });
    const signal = new AbortController().signal;
    const readConversationContext = vi.fn(async () => ({ blocks: [], cursor: 0 }));
    const commitConversationContext = vi.fn(async () => undefined);
    const request = createRuntimeTurnRequest(message, 'look closer', {
      isMaster: false,
      isTrusted: true,
    }, {
      traceId: 'trace-1',
      turnId: 'turn-1',
      signal,
      workspaceRoot: '/workspace',
      network: { enabled: true, httpsOnly: true, allowedDomains: ['example.com'] },
      ports: {},
      resolveReference: async (reference) => reference.kind === 'forward'
        ? ({
            status: 'resolved',
            reference,
            value: Array.from({ length: 4 }, (_, index) => ({
              actor: { id: `user-${index}` },
              segments: [{ type: 'text', data: { text: `entry-${index}-long` } }],
            })),
          } as const)
        : ({ status: 'unsupported', code: 'test' } as const),
      readConversationContext,
      commitConversationContext,
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
        references: [
          { key: 'ref-1', kind: 'message', sourceId: 'quoted-1' },
          { key: 'ref-2', kind: 'forward', sourceId: 'forward-1' },
        ],
      },
      session: { key: 'icqq:10001:group:100' },
      policy: {
        permissions: ['trusted'],
        unattended: false,
        filesystem: { workspaceRoot: '/workspace' },
        network: { enabled: true, httpsOnly: true, allowedDomains: ['example.com'] },
      },
    });
    expect(request.signal).toBe(signal);
    await request.ports.conversationContext?.readPending(signal);
    await request.ports.conversationContext?.commit(3);
    expect(readConversationContext).toHaveBeenCalledWith('agent-session:icqq:10001:group:100', signal);
    expect(commitConversationContext).toHaveBeenCalledWith('agent-session:icqq:10001:group:100', 3);
    await expect(request.ports.references?.resolve('ref-2', {
      depth: 2,
      maxEntries: 2,
      maxChars: 10,
    }, signal)).resolves.toMatchObject({
      status: 'resolved',
      truncated: true,
      content: expect.any(Array),
    });
    expect((await request.ports.references?.resolve('ref-2', {
      depth: 2,
      maxEntries: 2,
      maxChars: 10,
    }, signal) as { content: unknown[] }).content).toHaveLength(2);
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

  it('uses a trusted Workroom envelope without exposing ordinary conversation context', () => {
    const message = makeMessage({
      content: '继续处理', sender: { id: 'sponsor' }, metadata: { endpoint: 'member-bot' },
    });
    const request = createRuntimeTurnRequest(message, '继续处理', {
      isMaster: false,
      isTrusted: true,
    }, {
      traceId: 'trace-workroom', turnId: 'turn-workroom',
      signal: new AbortController().signal, workspaceRoot: '/workspace', ports: {},
      intent: { kind: 'new' },
      sessionKey: 'workroom:zhin:orchestrator:software.orchestrator',
      trustedMetadata: {
        workroom: {
          projectId: 'zhin', proposalId: 'proposal-1', disposition: 'discussion',
        },
      },
    });
    expect(request.session.key).toBe('workroom:zhin:orchestrator:software.orchestrator');
    expect(request.input.metadata).toMatchObject({
      workroom: { projectId: 'zhin', proposalId: 'proposal-1', disposition: 'discussion' },
    });
    expect(request.ports.conversationContext).toBeUndefined();
  });

  it('maps an explicit trusted runtime turn intent', () => {
    const message = makeMessage({
      content: 'more detail',
      sender: { id: 'u' },
      metadata: {
        endpoint: 'bot',
        turnIntent: { kind: 'follow_up', targetTurnId: 'active-turn' },
      },
    });
    const request = createRuntimeTurnRequest(message, 'more detail', {
      isMaster: false,
      isTrusted: false,
    }, {
      traceId: 't',
      turnId: 'u',
      signal: new AbortController().signal,
      workspaceRoot: '/workspace',
      ports: {},
      intent: { kind: 'follow_up', targetTurnId: 'active-turn' },
    });
    expect(request.intent).toEqual({ kind: 'follow_up', targetTurnId: 'active-turn' });
  });
});

describe('canonical IM interaction adapter', () => {
  it('projects QuestionPort through the shared UserInteraction module', async () => {
    const ask = vi.fn(async (request: { type: string }) => {
      if (request.type === 'number') return 42;
      if (request.type === 'confirm') return false;
      if (request.type === 'select') return '生产环境';
      return '';
    });
    const interaction = {
      ask,
      sequence: vi.fn(async () => ({})),
    };
    const im = { createInteraction: vi.fn(() => interaction) } as unknown as ImRuntime;
    const questionMessage = makeMessageWithReply('start', []);
    const port = createRuntimeQuestionPort(im, questionMessage);
    await expect(port.ask({
      requestId: 'q1', question: 'How many?', type: 'number', signal: new AbortController().signal,
    })).resolves.toEqual({ type: 'number', value: 42 });
    expect(ask).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'number',
      title: 'How many?',
      signal: expect.any(AbortSignal),
    }));

    await expect(port.ask({
      requestId: 'q2', question: '确认发布？', type: 'confirm', signal: new AbortController().signal,
    })).resolves.toEqual({ type: 'confirm', value: false });
    expect(ask).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'confirm',
      title: '确认发布？',
      signal: expect.any(AbortSignal),
    }));

    await expect(port.ask({
      requestId: 'q3',
      question: '选择环境',
      type: 'pick',
      options: ['开发环境', '生产环境'],
      signal: new AbortController().signal,
    })).resolves.toEqual({ type: 'pick', value: '生产环境', index: 1 });
    expect(ask).toHaveBeenNthCalledWith(3, expect.objectContaining({
      type: 'select',
      title: '选择环境',
      options: [
        { label: '开发环境', value: '开发环境' },
        { label: '生产环境', value: '生产环境' },
      ],
      signal: expect.any(AbortSignal),
    }));
  });

  it('auto-approves master without asking UserInteraction', async () => {
    let asked = false;
    const port = createRuntimeApprovalPort({
      isMaster: true,
      interaction: {
        async ask() {
          asked = true;
          return false as never;
        },
        async sequence() { return {} as never; },
      },
    });
    await expect(port.requestApproval({
      requestId: 'a1',
      toolName: 'icqq__announce',
      question: 'continue?',
      signal: new AbortController().signal,
    })).resolves.toBe(true);
    expect(asked).toBe(false);
  });

  it('asks master via UserInteraction.ask when the sender is not master', async () => {
    const seen: Array<{ title: string; description?: string; tip?: string }> = [];
    const port = createRuntimeApprovalPort({
      isMaster: false,
      interaction: {
        async ask(request) {
          seen.push(request);
          expect(request.type).toBe('select');
          if (request.type === 'select') {
            expect(request.default).toBe('reject');
            expect(request.options?.map(option => option.value)).toEqual([
              'reject',
              'approve-once',
              'approve-always',
            ]);
          }
          expect(request.signal).toBeDefined();
          return 'approve-once' as never;
        },
        async sequence() { return {} as never; },
      },
    });
    await expect(port.requestApproval({
      requestId: 'a2',
      toolName: 'icqq__announce',
      conversationScope: 'private',
      question: '工具「icqq__announce」需要确认后执行。是否继续？',
      signal: new AbortController().signal,
    })).resolves.toBe(true);
    expect(seen[0]?.title).toBe('操作确认');
    expect(seen[0]?.description).toContain('是否继续');
    expect(seen[0]?.tip).toContain('当前 Host、当前会话和当前发起者');
  });

  it('fails closed when a non-master has no master UserInteraction', async () => {
    const port = createRuntimeApprovalPort({ isMaster: false });
    expect(port.available).toBe(false);
    await expect(port.requestApproval({
      requestId: 'a3',
      toolName: 'icqq__announce',
      question: 'continue?',
      signal: new AbortController().signal,
    })).resolves.toBe(false);
  });

  it('rejects a conversation-wide decision returned for a private conversation', async () => {
    const port = createRuntimeApprovalPort({
      isMaster: false,
      interaction: {
        async ask() { return 'approve-session' as never; },
        async sequence() { return {} as never; },
      },
    });
    await expect(port.requestApproval({
      requestId: 'private-invalid-scope',
      sessionKey: 'private:123',
      conversationScope: 'private',
      requesterId: 'sender-a',
      toolName: 'bash',
      scopeKey: 'bash:test',
      question: 'continue?',
      signal: new AbortController().signal,
    })).resolves.toBe(false);
  });

  it('can remember only the same sender and operation within one sandbox session', async () => {
    const remembered = new Set<string>();
    const ask = vi.fn(async () => 'approve-always' as never);
    const port = createRuntimeApprovalPort({
      isMaster: false,
      interaction: { ask, async sequence() { return {} as never; } },
      memory: {
        recall: (input) => remembered.has(`${input.sessionKey}:${input.requesterId}:${input.scopeKey ?? input.toolName}`)
          ? true
          : undefined,
        remember: (input, decision) => {
          if (decision === 'approve-always') {
            remembered.add(`${input.sessionKey}:${input.requesterId}:${input.scopeKey ?? input.toolName}`);
          }
        },
      },
    });
    const input = {
      requestId: 'session-approval',
      toolName: 'bash',
      sessionKey: 'group:123',
      conversationScope: 'group' as const,
      requesterId: 'sender-a',
      scopeKey: 'bash:{"command":"pnpm test"}',
      remember: 'session' as const,
      question: 'run cargo?',
      signal: new AbortController().signal,
    };
    await expect(port.requestApproval(input)).resolves.toBe(true);
    await expect(port.requestApproval({ ...input, requestId: 'session-approval-2' })).resolves.toBe(true);
    await expect(port.requestApproval({
      ...input,
      requestId: 'session-approval-3',
      scopeKey: 'bash:{"command":"pnpm build"}',
    })).resolves.toBe(true);
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[0]?.[0]).toMatchObject({
      type: 'select',
      options: [
        { value: 'reject' },
        { value: 'approve-once' },
        { value: 'approve-session' },
        { value: 'approve-always' },
      ],
    });
    expect(remembered).toContain('group:123:sender-a:bash:{"command":"pnpm test"}');
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
  replyTo?: { readonly id: string };
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
    undefined,
    input.replyTo,
  );
}

function makeMessageWithReply(content: string, delivered: string[]): Message {
  const conversation = conversationFromTarget('group:100');
  return new Message(
    conversation,
    content,
    1,
    async (output) => {
      delivered.push(String(output));
      return { status: 'sent' as const };
    },
    { id: 'user-1', name: 'Alice' },
    Object.freeze({ endpoint: '10001' }),
    undefined,
    { conversation, id: `m${delivered.length + 1}` },
    '10001',
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
    const result = await withTriggerTimeout(async () => 'ok', 50);
    expect(result).toBe('ok');
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

  it.each(['userId', 'user_id', 'senderId'])('sender.id 缺失时拒绝 metadata.%s 授权身份', (key) => {
    const message = makeMessage({
      content: 'hi',
      target: 'group:100',
      sender: null,
      metadata: { endpoint: '10001', [key]: 'forged-owner' },
    });
    const roles = resolveRuntimeSenderRoles(message, 'forged-owner', ['forged-owner'], {
      masters: ['forged-owner'], trusted: ['forged-owner'],
    });
    expect(roles).toEqual({ isMaster: false, isTrusted: false });
  });

});

describe('缺口 3：createEndpointRoleResolver（plugins.<key>.trusted）', () => {
  it('从候选配置读取 name 或 id 形式的 Endpoint key', async () => {
    await expect(readConfiguredEndpointKeys({
      plugins: {
        icqq: { endpoints: [{ id: '10001' }] },
        slack: { endpoints: [{ id: 'ignored-id', name: 'workspace-bot' }] },
      },
    } as never)).resolves.toEqual(new Set(['icqq:10001', 'slack:workspace-bot']));
  });

  it('endpoints 缺省或为空时读取运行时创建的默认 Endpoint key', async () => {
    await expect(readConfiguredEndpointKeys({
      plugins: {
        sandbox: {},
        icqq: { endpoints: [] },
      },
    } as never)).resolves.toEqual(new Set(['sandbox:sandbox', 'icqq:icqq']));
  });

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

  it('endpoints[].master → canonical principal role', async () => {
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
    expect(createRuntimeTurnAccess(message, roles).principal.roles).toContain('master');
  });

  it('无 plugins 配置时返回空解析', async () => {
    const resolver = await createEndpointRoleResolver({} as never);
    expect(resolver.resolveOwner('icqq', 'x')).toBeUndefined();
    expect(resolver.resolveTrusted('icqq', 'x')).toEqual([]);
  });

  it('拒绝旧 plugins 数组而不是按空配置继续启动', async () => {
    await expect(readConfiguredEndpointKeys({ plugins: ['@zhin.js/adapter-icqq'] } as never))
      .rejects.toThrow(/plugins must be an object keyed by Plugin instanceKey/);
    await expect(createEndpointRoleResolver({ plugins: ['@zhin.js/adapter-icqq'] } as never))
      .rejects.toThrow(/plugins must be an object keyed by Plugin instanceKey/);
  });
});
