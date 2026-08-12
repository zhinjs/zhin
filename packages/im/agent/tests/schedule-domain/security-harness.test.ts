import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config/index.js';
import {
  createScheduleSecurityContext,
  demoteScheduleCreator,
  hardenSchedulePolicyInput,
  secureScheduleTools,
} from '../../src/schedule-domain/security-harness.js';
import { runToolPolicies } from '../../src/security/policy-facade.js';

describe('schedule security harness', () => {
  it('demotes creator roles by one level', () => {
    expect(demoteScheduleCreator({ userId: 'u1', roles: ['master'] }).roles).toEqual(['trusted']);
    expect(demoteScheduleCreator({ userId: 'u2', roles: ['trusted'] }).roles).toEqual(['user']);
    expect(demoteScheduleCreator({ userId: 'u3', roles: ['user'] }).roles).toEqual([]);
  });

  it('rejects bash network commands without a verifiable absolute HTTPS URL', async () => {
    const execute = vi.fn();
    const [tool] = secureScheduleTools({
      tools: [{ name: 'bash', description: '', parameters: { type: 'object', properties: {} }, execute }],
      message: {} as never,
      config: DEFAULT_CONFIG,
      context: createScheduleSecurityContext('network', ['api.example.com']),
    });
    expect(String(await tool.execute({ command: 'curl example.com' }))).toContain('绝对 HTTPS URL');
    expect(String(await tool.execute({ command: 'ping example.com' }))).toContain('绝对 HTTPS URL');
    expect(execute).not.toHaveBeenCalled();
  });

  it('forces readonly execution and denies owner approval', () => {
    const context = createScheduleSecurityContext();
    const hardened = hardenSchedulePolicyInput({
      toolName: 'bash',
      command: 'curl https://example.com',
      config: { ...DEFAULT_CONFIG, execPreset: 'development', execApprovalMode: 'ask' },
    }, context);

    expect(hardened.config?.execPreset).toBe('readonly');
    expect(hardened.config?.execApprovalMode).toBe('deny');
  });

  it('routes schedule HTTPS and domain allowlist checks through the policy facade', () => {
    const networkPolicy = { httpsOnly: true, allowedDomains: ['api.example.com'] };
    expect(runToolPolicies({
      toolName: 'web_fetch',
      networkUrl: 'http://api.example.com/report',
      networkPolicy,
    })).toMatchObject({ allowed: false, deniedBy: 'network-access' });
    expect(runToolPolicies({
      toolName: 'web_fetch',
      networkUrl: 'https://other.example/report',
      networkPolicy,
    })).toMatchObject({ allowed: false, deniedBy: 'network-access' });
    expect(runToolPolicies({
      toolName: 'web_fetch',
      networkUrl: 'https://api.example.com/report',
      networkPolicy,
    }).allowed).toBe(true);
  });
});
