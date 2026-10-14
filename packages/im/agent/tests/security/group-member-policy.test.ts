import { describe, expect, it, vi } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import {
  GROUP_MEMBER_RESTRICTION_REASON,
  isGroupMemberRestrictedTool,
  isGroupMemberTurn,
  tightenGroupMemberPolicy,
} from '../../src/security/group-member-policy.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress, type TurnPolicyContext } from '../../src/turn/turn-ingress.js';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';

const POLICY: TurnPolicyContext = {
  permissions: ['user'],
  unattended: false,
  shell: { security: 'allowlist', execPreset: 'development', approvalMode: 'auto', isolation: 'required' },
  filesystem: { workspaceRoot: '/ws', workingDirectory: '/ws', access: 'workspace-write' },
};

function view(scope: string, roles: string[]) {
  return { origin: { kind: 'im', scope }, principal: { roles } };
}

function capability(name: string, tags?: string[]): ToolCapability {
  return {
    owner: rootPluginId(),
    name,
    qualifiedName: name,
    description: name,
    requiresApproval: 'never',
    source: `/tools/${name}.ts`,
    ...(tags ? { tags } : {}),
    execute: vi.fn(async () => 'ran') as never,
  };
}

function groupTurn(roles: string[], scope: 'group' | 'private' = 'group', tools: string[] = []) {
  return createTurnIngress({
    intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 1, traceId: 't', turnId: 'turn' },
    origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope, sceneId: 'g1', messageId: 'm' },
    principal: { subjectId: 'member', roles },
    input: { text: 'hi' },
    session: { key: `im:icqq:bot:${scope}:g1` },
    policy: POLICY,
    capabilities: { tools, skills: [] },
    signal: new AbortController().signal,
    ports: { journal: { append: () => undefined } },
  });
}

describe('group member turn restriction (#719)', () => {
  it('applies only to ordinary members in group or channel chats', () => {
    expect(isGroupMemberTurn(view('group', ['user']))).toBe(true);
    expect(isGroupMemberTurn(view('channel', ['user', 'admin']))).toBe(true);
    expect(isGroupMemberTurn(view('group', ['user', 'master']))).toBe(false);
    expect(isGroupMemberTurn(view('group', ['user', 'trusted']))).toBe(false);
    expect(isGroupMemberTurn(view('private', ['user']))).toBe(false);
    expect(isGroupMemberTurn({ origin: { kind: 'http' }, principal: { roles: [] } })).toBe(false);
  });

  it('restricts shell, file writes and outbound tools only', () => {
    for (const name of ['bash', 'write_file', 'edit_file', 'send_group_message', 'plugin__forward_msg', 'email_send']) {
      expect(isGroupMemberRestrictedTool({ name }), name).toBe(true);
    }
    expect(isGroupMemberRestrictedTool({ name: 'x', tags: ['outbound'] })).toBe(true);
    for (const name of ['read_file', 'grep', 'web_search', 'weather__lookup', 'sender_info']) {
      expect(isGroupMemberRestrictedTool({ name }), name).toBe(false);
    }
  });

  it('only narrows the policy', () => {
    const tightened = tightenGroupMemberPolicy(POLICY);
    expect(tightened.shell).toBeUndefined();
    expect(tightened.filesystem?.access).toBe('read-only');
    expect(tightened.permissions).toEqual(['user']);
    expect(tightenGroupMemberPolicy({ permissions: [], unattended: false })).toEqual({ permissions: [], unattended: false });
  });

  it('denies restricted tools at execution with a friendly typed reason, even if a tool slipped in', async () => {
    const bash = capability('bash');
    const send = capability('plugin__send_private_message');
    const runtime = new TurnToolRuntime(groupTurn(['user'], 'group', ['bash', 'plugin__send_private_message']), [bash, send]);
    for (const name of ['bash', 'plugin__send_private_message']) {
      await expect(runtime.execute(name, { command: 'ls' }, `c-${name}`)).resolves.toEqual({
        status: 'denied',
        policy: 'group-member-restriction',
        reason: GROUP_MEMBER_RESTRICTION_REASON,
      });
    }
    expect(bash.execute).not.toHaveBeenCalled();
    expect(send.execute).not.toHaveBeenCalled();
  });

  it('leaves master and trusted turns unchanged', async () => {
    for (const roles of [['user', 'master'], ['user', 'trusted']]) {
      const send = capability('plugin__send_private_message');
      const runtime = new TurnToolRuntime(groupTurn(roles, 'group', [send.name]), [send]);
      await expect(runtime.execute(send.name, {}, 'c')).resolves.toMatchObject({ status: 'completed' });
    }
  });
});
