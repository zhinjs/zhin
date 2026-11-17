/**
 * ADR 0065 P1: MCP tools are filtered by the turn sender's chat role when the tool pool is built,
 * and re-checked with the sender's current role before every call.
 */
import { describe, expect, it } from 'vitest';
import {
  SnapshotStore,
  childPluginId,
  createCapabilitySlot,
  createSnapshotView,
  rootPluginId,
  type SnapshotState,
} from '@zhin.js/plugin-runtime';
import { McpIndex, defineMcp, mcpFeatureId, type McpToolDescriptor } from '@zhin.js/mcp-feature';
import { PermissionHost, permissionHostToken, type PermissionSenderRoles } from '@zhin.js/permission';
import {
  AgentRuntime,
  AgentTurnCoordinator,
  agentTurnEngineToken,
  turnJournalStoreToken,
  type AgentTurnExecutionContext,
} from '../../src/plugin-runtime/index.js';
import { createDeferredCapabilityPlan } from '../../src/plugin-runtime/deferred-capability-plan.js';
import { McpPermitDeniedError } from '../../src/tool/mcp-permit-denial.js';
import { demoteScheduleCreator } from '../../src/schedule-domain/security-harness.js';
import { parseMcpToolPermit, type McpBindingPermits } from '../../src/plugin-runtime/mcp-tool-permit.js';
import type { TurnOutcome, TurnPrincipal } from '../../src/turn/turn-ingress.js';
import type { TurnToolOutcome } from '../../src/tool/turn-tool-runtime.js';

const GLOBAL_OWNER: TurnPrincipal = { subjectId: 'master', roles: ['owner'] };
const MEMBER: TurnPrincipal = { subjectId: 'member', roles: ['user'] };
const SESSION_OWNER: TurnPrincipal = {
  subjectId: 'room-owner', roles: ['trusted'], chatRole: 'owner',
  chatRoleLevels: { owner: 'conversation', admin: 'conversation', trusted: 'conversation' },
};

const UPSTREAM_TOOLS: readonly McpToolDescriptor[] = [
  { name: 'list_issues', description: 'List issues', hints: { readOnly: true } },
  { name: 'create_issue', description: 'Create an issue' },
  { name: 'wipe_repo', description: 'Contradictory annotation', hints: { readOnly: true, destructive: true } },
  { name: 'send_notice', description: 'Read-only but looks outbound', hints: { readOnly: true } },
];

interface Observed {
  readonly pool: readonly string[];
  readonly executable: readonly string[];
  readonly context: AgentTurnExecutionContext;
  readonly outcomes: Readonly<Record<string, TurnToolOutcome>>;
}

async function createRuntime(options: {
  readonly run?: (context: AgentTurnExecutionContext) => Promise<Record<string, TurnToolOutcome>>;
  readonly roles?: () => PermissionSenderRoles | undefined;
} = {}) {
  const root = rootPluginId();
  const child = childPluginId(root, 'child');
  const calls: string[] = [];
  const events: Array<Record<string, unknown>> = [];
  const observed: Observed[] = [];
  const host = new PermissionHost();
  if (options.roles) host.setSenderRoleResolver(() => options.roles!());
  const mcpSlot = createCapabilitySlot({
    owner: root, feature: mcpFeatureId, localName: 'github', source: '/config/mcp/github',
    definition: defineMcp({ create: () => ({
      listTools: () => UPSTREAM_TOOLS,
      callTool: (name, input) => { calls.push(name); return { ok: name, input }; },
    }) }),
  });
  const engine = {
    async *run(context: AgentTurnExecutionContext) {
      const outcomes = await options.run?.(context) ?? {};
      observed.push({
        pool: context.capabilities.tools.map((tool) => tool.name),
        executable: context.toolCapabilities.map((tool) => tool.name),
        context,
        outcomes,
      });
      yield { type: 'turn_end' as const, output: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
    },
  };
  const journal = {
    append: (event: Record<string, unknown>) => { events.push(event); },
    replay: async () => [],
    listRuns: async () => [],
  };
  const base: SnapshotState = {
    root,
    tree: new Map([
      [root, { id: root, instanceKey: 'root', packageName: '@test/root', packageRoot: '/project', children: [child] }],
      [child, { id: child, instanceKey: 'child', packageName: '@test/child', packageRoot: '/project/plugins/child', parent: root, children: [] }],
    ]),
    config: new Map([[root, {}], [child, {}]]),
    resources: new Map([[root, new Map<string, unknown>([
      [permissionHostToken.id, host],
      [turnJournalStoreToken.id, journal],
      [agentTurnEngineToken.id, engine],
    ])], [child, new Map()]]),
    capabilities: new Map([[mcpSlot.id, mcpSlot]]),
    projections: new Map(),
  };
  const view = createSnapshotView(1, base);
  const mcp = await McpIndex.create([mcpSlot], view, new AbortController().signal);
  await mcp.start(new AbortController().signal);
  const store = new SnapshotStore({ ...base, projections: new Map([[mcpFeatureId, mcp]]) });
  const runtime = new AgentRuntime({ coordinator: new AgentTurnCoordinator() });
  runtime.attach(store);
  return {
    calls, events, observed, host,
    async execute(principal: TurnPrincipal, permits?: McpBindingPermits, request: Partial<Parameters<AgentRuntime['execute']>[1]> = {}): Promise<TurnOutcome> {
      return runtime.execute(root, { ...imRequest(principal), ...request }, {
        binding: { name: 'zhin', mcpServers: ['github'], ...(permits ? { mcpPermits: permits } : {}) },
        mcpServers: ['github'],
      });
    },
    async stop() { await mcp.stop(); },
  };
}

let sequence = 0;
function imRequest(principal: TurnPrincipal, scope: 'group' | 'private' = 'group') {
  sequence += 1;
  return {
    identity: { traceId: `trace-${sequence}`, turnId: `turn-${sequence}` },
    origin: {
      kind: 'im' as const, platform: 'icqq', endpoint: 'bot', scope, sceneId: '100',
      conversation: { endpoint: { adapter: 'icqq', id: 'bot' }, kind: scope, id: '100' },
    },
    intent: { kind: 'new' as const },
    principal,
    input: { text: 'issues' },
    session: { key: `im:icqq:bot:${scope}:100` },
    policy: { permissions: [...principal.roles], unattended: false },
    signal: new AbortController().signal,
    ports: { approval: { requestApproval: async () => true } },
  };
}

function scheduleRequest(principal: TurnPrincipal) {
  sequence += 1;
  return {
    identity: { traceId: `schedule-${sequence}`, turnId: `schedule-${sequence}` },
    origin: { kind: 'schedule' as const, jobId: 'job' },
    intent: { kind: 'new' as const },
    principal,
    input: { text: 'daily issue report' },
    session: { key: 'schedule:job' },
    policy: { permissions: [], unattended: true,
      network: { enabled: true, httpsOnly: true, allowedDomains: [] }, shell: { preset: 'readonly' as const },
      filesystem: { workspaceRoot: process.cwd() } },
    execution: { kind: 'schedule' as const, security: { execPreset: 'readonly' as const, allowedDomains: [] } },
    signal: new AbortController().signal,
    ports: {},
  };
}

const server = (raw: unknown) => parseMcpToolPermit(raw, 'ai.mcpServers[0].permit')!;
const agent = (raw: unknown) => parseMcpToolPermit(raw, 'ai.agents.zhin.mcpServers[0].permit')!;

describe('per-turn MCP tool filtering (ADR 0065 D4)', () => {
  it('shows a member only declared read-only tools and the global owner every tool', async () => {
    const fixture = await createRuntime();
    try {
      expect((await fixture.execute(MEMBER)).status).toBe('completed');
      expect((await fixture.execute(GLOBAL_OWNER)).status).toBe('completed');
      // send_notice passes its permit but the group-member trust ceiling still removes it afterwards.
      expect(fixture.observed[0]!.pool).toEqual(['github__list_issues']);
      expect(fixture.observed[1]!.pool).toEqual([
        'github__list_issues', 'github__create_issue', 'github__wipe_repo', 'github__send_notice',
      ]);
      expect(fixture.observed[1]!.context.toolCapabilities.find((tool) => tool.name === 'github__create_issue')).toMatchObject({
        permissions: ['owner@global'], requiresApproval: 'on-risk',
      });
      const listIssues = fixture.observed[1]!.context.toolCapabilities.find((tool) => tool.name === 'github__list_issues')!;
      // Upstream hints decide the tier only; they never become the plugin `readOnly` declaration.
      expect(listIssues.mcpHints).toEqual({ readOnly: true });
      expect(listIssues.readOnly).toBeUndefined();
      expect(listIssues.permissions).toBeUndefined();
    } finally { await fixture.stop(); }
  });

  it('counts a conversation-level owner as below owner@global', async () => {
    const fixture = await createRuntime();
    try {
      await fixture.execute(SESSION_OWNER);
      expect(fixture.observed[0]!.pool).toEqual(['github__list_issues', 'github__send_notice']);
    } finally { await fixture.stop(); }
  });

  it('keeps hidden tools out of discover, load_tool and alwaysLoaded', async () => {
    const fixture = await createRuntime({
      run: async (context) => {
        const plan = createDeferredCapabilityPlan({
          capabilities: { ...context.capabilities, tools: context.toolCapabilities },
          sessionSnapshot: { loadedTools: {}, loadedSkills: [] },
          config: { deferredTools: {
            alwaysLoadedTools: ['github__create_issue', 'github__list_issues'],
            mcpServers: { github: { alwaysLoaded: ['create_issue'] } },
          } },
          persistSnapshot: async () => undefined,
        });
        expect(plan.catalog.map((item) => item.name)).not.toContain('github__create_issue');
        expect(plan.capabilities.map((tool) => tool.name)).not.toContain('github__create_issue');
        expect(plan.capabilities.map((tool) => tool.name)).toContain('github__list_issues');
        expect(await plan.controller.load('github__create_issue')).toBe(false);
        const discover = plan.capabilities.find((tool) => tool.name === 'discover');
        expect(discover).toBeDefined();
        {
          const found = await discover!.execute({ query: 'create issue' }, {
            signal: new AbortController().signal, traceId: 't', turnId: 't', sessionKey: 's',
            origin: { kind: 'internal', source: 'test' }, principal: { subjectId: 'member', roles: ['user'] },
            policy: { permissions: [], unattended: false, network: { enabled: false } },
          } as never);
          expect(JSON.stringify(found)).not.toContain('create_issue');
        }
        return {};
      },
    });
    try {
      expect((await fixture.execute(MEMBER)).status).toBe('completed');
      expect(fixture.observed).toHaveLength(1);
    } finally { await fixture.stop(); }
  });

  it('denies a replayed call to a withheld tool with mcp-permit', async () => {
    const fixture = await createRuntime({
      run: async (context) => ({ replay: await context.tools.execute('github__create_issue', { title: 'x' }, 'replay-1') }),
    });
    try {
      await fixture.execute(MEMBER);
      expect(fixture.observed[0]!.outcomes.replay).toMatchObject({
        status: 'denied', policy: 'mcp-permit', reason: '这个 MCP 工具只对主人开放。',
      });
      expect(fixture.calls).toEqual([]);
      // The journal records the `tool_denied` turn event as a denied action result.
      expect(fixture.events).toContainEqual(expect.objectContaining({
        type: 'action.result',
        data: expect.objectContaining({ status: 'denied', toolName: 'github__create_issue', policy: 'mcp-permit' }),
      }));
    } finally { await fixture.stop(); }
  });

  it('re-checks the current role before the call: a role revoked mid-turn is denied', async () => {
    let roles: PermissionSenderRoles = { chatRole: 'owner', chatRoleLevels: { owner: 'global', admin: 'global', trusted: 'global' } };
    const fixture = await createRuntime({
      roles: () => roles,
      run: async (context) => {
        const first = await context.tools.execute('github__create_issue', { title: 'a' }, 'call-1');
        roles = {};
        const second = await context.tools.execute('github__create_issue', { title: 'b' }, 'call-2');
        // A read-only tool open to everyone stays callable.
        const read = await context.tools.execute('github__list_issues', {}, 'call-3');
        return { first, second, read };
      },
    });
    try {
      await fixture.execute(GLOBAL_OWNER);
      const outcomes = fixture.observed[0]!.outcomes;
      expect(outcomes.first).toMatchObject({ status: 'completed' });
      expect(outcomes.second).toMatchObject({ status: 'denied', policy: 'mcp-permit' });
      expect(outcomes.read).toMatchObject({ status: 'completed' });
      expect(fixture.calls).toEqual(['create_issue', 'list_issues']);
      expect(fixture.events).toContainEqual(expect.objectContaining({
        type: 'action.result', data: expect.objectContaining({ status: 'denied', callId: 'call-2', policy: 'mcp-permit' }),
      }));
    } finally { await fixture.stop(); }
  });

  it('re-checks capabilities a delegated turn kept from its parent', async () => {
    let roles: PermissionSenderRoles = { chatRole: 'owner', chatRoleLevels: { owner: 'global', admin: 'global', trusted: 'global' } };
    const fixture = await createRuntime({ roles: () => roles });
    try {
      await fixture.execute(GLOBAL_OWNER);
      const kept = fixture.observed[0]!.context.toolCapabilities.find((tool) => tool.name === 'github__create_issue')!;
      roles = { chatRole: 'trusted', chatRoleLevels: { trusted: 'global' } };
      await expect(kept.execute({ title: 'x' }, {} as never)).rejects.toBeInstanceOf(McpPermitDeniedError);
      expect(fixture.calls).toEqual([]);
    } finally { await fixture.stop(); }
  });

  it('lets the Agent layer narrow but never widen the server layer', async () => {
    const fixture = await createRuntime();
    try {
      await fixture.execute(MEMBER, { github: { agent: agent({ default: 'everyone', tools: { create_issue: 'everyone' } }) } });
      expect(fixture.observed[0]!.pool).toEqual(['github__list_issues']);
      await fixture.execute(GLOBAL_OWNER, { github: { agent: agent({ tools: { list_issues: 'deny' }, default: 'deny' }) } });
      expect(fixture.observed[1]!.pool).toEqual(['github__send_notice']);
    } finally { await fixture.stop(); }
  });

  it('applies server rules: create_* deny hides the tool even from the global owner', async () => {
    const fixture = await createRuntime({
      run: async (context) => ({ replay: await context.tools.execute('github__create_issue', {}, 'r') }),
    });
    try {
      await fixture.execute(GLOBAL_OWNER, { github: { server: server({ tools: { 'create_*': 'deny', wipe_repo: 'everyone' } }) } });
      expect(fixture.observed[0]!.pool).toEqual(['github__list_issues', 'github__wipe_repo', 'github__send_notice']);
      // A deny tier is never expanded, so the call is simply unknown.
      expect(fixture.observed[0]!.outcomes.replay).toMatchObject({ status: 'denied', policy: 'capability' });
    } finally { await fixture.stop(); }
  });

  it('lets an administrator take back a tool the server marked read-only', async () => {
    const fixture = await createRuntime();
    try {
      await fixture.execute(MEMBER, { github: { server: server({ tools: { list_issues: 'owner@global' } }) } });
      expect(fixture.observed[0]!.pool).toEqual([]);
      await fixture.execute(MEMBER, { github: { server: server({ readOnly: 'owner@global' }) } });
      expect(fixture.observed[1]!.pool).toEqual([]);
    } finally { await fixture.stop(); }
  });
});

describe('scheduled turns run as the demoted creator (ADR 0065 D6)', () => {
  const principal = (roles: readonly ('owner' | 'trusted' | 'user')[]): TurnPrincipal => {
    const creator = demoteScheduleCreator({ userId: 'creator', roles });
    return { subjectId: creator.userId, roles: [...creator.roles] };
  };

  it('keeps owner-only MCP tools from a job the global owner created', async () => {
    const fixture = await createRuntime();
    try {
      expect(principal(['owner']).roles).toEqual(['trusted']);
      expect((await fixture.execute(principal(['owner']), undefined, scheduleRequest(principal(['owner'])))).status).toBe('completed');
      expect(fixture.observed[0]!.pool).toEqual(['github__list_issues', 'github__send_notice']);
    } finally { await fixture.stop(); }
  });

  it('allows a tool relaxed to trusted for the owner-created job, not for a member-created job', async () => {
    const fixture = await createRuntime();
    const relaxed = { github: { server: server({ tools: { create_issue: 'trusted' } }) } };
    try {
      await fixture.execute(principal(['owner']), relaxed, scheduleRequest(principal(['owner'])));
      expect(fixture.observed[0]!.pool).toContain('github__create_issue');
      await fixture.execute(principal(['trusted']), relaxed, scheduleRequest(principal(['trusted'])));
      expect(fixture.observed[1]!.pool).not.toContain('github__create_issue');
      expect(fixture.observed[1]!.pool).toContain('github__list_issues');
    } finally { await fixture.stop(); }
  });
});
