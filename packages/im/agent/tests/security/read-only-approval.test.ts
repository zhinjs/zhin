/**
 * #1250 b33: a plugin tool declared `readOnly: true` needs no declarative approval under the default
 * `on-risk`, but the declaration relaxes nothing else and never applies to built-in write / exec / send tools.
 */
import { describe, expect, it, vi } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress, type TurnPolicyContext } from '../../src/turn/turn-ingress.js';
import { readOnlyDeclarationApplies, unattendedApprovalNeed } from '../../src/security/policy-facade.js';
import { applyTurnTrust } from '../../src/security/trust-level.js';
import type { ApprovalPort } from '../../src/session/approval-port.js';

function tool(name: string, overrides: Partial<ToolCapability> = {}, execute: ToolCapability['execute'] = async () => 'ok'): ToolCapability {
  return {
    owner: rootPluginId(),
    name,
    qualifiedName: name,
    description: name,
    requiresApproval: 'on-risk',
    source: `/tools/${name}.ts`,
    execute,
    ...overrides,
  };
}

function turnWith(options: { approval?: ApprovalPort; unattended?: boolean; policy?: Partial<TurnPolicyContext>; roles?: string[] } = {}) {
  return createTurnIngress({
    intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'http', sessionId: 's' },
    principal: { subjectId: 'owner-1', roles: options.roles ?? ['owner'] },
    input: { text: 'run' },
    session: { key: 'http:s' },
    policy: { permissions: [], unattended: options.unattended ?? false, ...options.policy },
    capabilities: { tools: [], skills: [] },
    signal: new AbortController().signal,
    ports: { journal: { append: () => undefined }, ...(options.approval ? { approval: options.approval } : {}) },
  });
}

describe('readOnly declaration (#1250 b33)', () => {
  it('lets an on-risk plugin tool declared read-only run without asking, unattended included', async () => {
    const requestApproval = vi.fn(async () => false);
    const attended = new TurnToolRuntime(turnWith({ approval: { requestApproval } }), [tool('weather', { readOnly: true })]);
    await expect(attended.execute('weather', {}, 'a')).resolves.toMatchObject({ status: 'completed' });
    expect(requestApproval).not.toHaveBeenCalled();
    const unattended = new TurnToolRuntime(turnWith({ unattended: true }), [tool('weather', { readOnly: true })]);
    await expect(unattended.execute('weather', {}, 'b')).resolves.toMatchObject({ status: 'completed' });
  });

  it('still asks for an undeclared on-risk tool', async () => {
    const requestApproval = vi.fn(async () => false);
    const runtime = new TurnToolRuntime(turnWith({ approval: { requestApproval } }), [tool('weather')]);
    await expect(runtime.execute('weather', {}, 'c')).resolves.toMatchObject({ status: 'denied', policy: 'approval' });
    expect(requestApproval).toHaveBeenCalledOnce();
  });

  it.each(['always', 'once', 'human'] as const)('keeps an explicit requiresApproval: %s above readOnly', async (requiresApproval) => {
    const requestApproval = vi.fn(async () => false);
    const runtime = new TurnToolRuntime(turnWith({ approval: { requestApproval } }),
      [tool('weather', { readOnly: true, requiresApproval })]);
    await expect(runtime.execute('weather', {}, 'd')).resolves.toMatchObject({ status: 'denied' });
    expect(requestApproval).toHaveBeenCalledOnce();
    expect(unattendedApprovalNeed(tool('weather', { readOnly: true, requiresApproval })))
      .toBe(requiresApproval === 'human' ? 'human' : 'approval');
  });

  it.each([
    'write_file', 'edit_file', 'delete_file', 'apply_patch', 'bash', 'send_message', 'forward_message',
    'memory_upsert', 'change_draft', 'plugin_a__write_file', 'plugin_a__send_group_notice',
  ])('ignores readOnly on the built-in side-effect tool %s', (name) => {
    expect(readOnlyDeclarationApplies(tool(name, { readOnly: true }))).toBe(false);
  });

  // b33 review: spelling variants of a side-effect name must not earn the relaxation either.
  it.each([
    'Write_File', 'WRITE_FILE', 'write-file', 'writeFile', 'plugin.write_file', 'plugin:bash', 'BASH',
    'sendMessage', 'Send-Group-Notice', 'plugin_a__sendGroupMsg', 'memoryUpsert', 'setConfig', 'addReminder',
    '\uff57rite_file', 'wr\u0456te_file',
  ])('ignores readOnly on the spelling variant %s', (name) => {
    expect(readOnlyDeclarationApplies(tool(name, { readOnly: true }))).toBe(false);
  });

  it('still honours readOnly on ordinary read tools in any spelling', () => {
    for (const name of ['weather', 'getWeather', 'plugin_a__list-members', 'get_config']) {
      expect(readOnlyDeclarationApplies(tool(name, { readOnly: true }))).toBe(true);
    }
  });

  it.each(['member', 'publish', 'funds', 'identity'] as const)('ignores readOnly on a tool with riskCategory %s', (riskCategory) => {
    expect(readOnlyDeclarationApplies(tool('lookup', { readOnly: true, riskCategory }))).toBe(false);
  });

  it.each([
    ['shell tag', { tags: ['shell'] }],
    ['outbound tag', { tags: ['outbound'] }],
    ['config tag', { tags: ['config'] }],
    ['schedule tag', { tags: ['schedule'] }],
    ['dangerous risk', { risk: 'dangerous' as const }],
  ])('ignores readOnly on a high-risk tool (%s)', (_label, overrides) => {
    const declared = tool('lookup', { readOnly: true, ...overrides });
    expect(readOnlyDeclarationApplies(declared)).toBe(false);
    expect(unattendedApprovalNeed(declared)).not.toBe('none');
  });

  it('does not let a read-only send tool skip approval when its author marks it read-only', async () => {
    const requestApproval = vi.fn(async () => false);
    const execute = vi.fn(async () => 'sent');
    const runtime = new TurnToolRuntime(turnWith({ approval: { requestApproval } }),
      [tool('send_message', { readOnly: true }, execute)]);
    await expect(runtime.execute('send_message', { text: 'x' }, 'e')).resolves.toMatchObject({ status: 'denied' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not bypass the network policy', async () => {
    const execute = vi.fn(async () => 'page');
    const runtime = new TurnToolRuntime(turnWith({ unattended: true }), [tool('web_fetch', { readOnly: true }, execute)]);
    await expect(runtime.execute('web_fetch', { url: 'https://example.com' }, 'f'))
      .resolves.toMatchObject({ status: 'denied', policy: 'network-access' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not bypass the unattended exec preset for a read-only declared bash', async () => {
    const execute = vi.fn(async () => 'ran');
    const runtime = new TurnToolRuntime(turnWith({ unattended: true, policy: { shell: { preset: 'readonly' },
      filesystem: { workspaceRoot: process.cwd() } } }), [tool('bash', { readOnly: true, requiresApproval: 'never' }, execute)]);
    await expect(runtime.execute('bash', { command: 'git status' }, 'g'))
      .resolves.toMatchObject({ status: 'denied', policy: 'exec-policy' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not bypass the dangerous-tool hard gate in an unattended turn', async () => {
    const execute = vi.fn(async () => 'kicked');
    const runtime = new TurnToolRuntime(turnWith({ unattended: true }),
      [tool('member_tool', { readOnly: true, risk: 'dangerous', requiresApproval: 'never' }, execute)]);
    await expect(runtime.execute('member_tool', {}, 'h')).resolves.toMatchObject({ status: 'denied' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not lift the trust-level filter: a read-only declared send tool is still withheld from a group member', () => {
    const decision = applyTurnTrust({ origin: { kind: 'im', scope: 'group' }, principal: { roles: [] },
      policy: { permissions: [], unattended: false } }, [tool('send_message', { readOnly: true }), tool('weather', { readOnly: true })]);
    expect(decision.tools.map(t => t.name)).toEqual(['weather']);
  });
});
