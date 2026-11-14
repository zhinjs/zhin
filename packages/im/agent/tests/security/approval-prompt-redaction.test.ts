/**
 * #1250 security review G2: approval prompts may be shown in a chat. Policy reasons, hard-gate prompts and
 * token-shaped text are masked; execution, fingerprints and scope keys keep the exact arguments.
 */
import { rootPluginId } from '@zhin.js/plugin-runtime';
import { redactApprovalDisplay, redactSecretText } from '../../src/decision-events.js';
import { formatHardGateQuestion } from '../../src/security/tool-hard-gate.js';
import { registerSensitiveExecCommand } from '../../src/security/sensitive-exec-commands.js';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import type { ApprovalOutcomePort, ApprovalRequestInput } from '../../src/session/approval-port.js';

describe('redactSecretText', () => {
  it.each([
    ['env assignment', 'FOO_TOKEN=abc123secretvalue ls', 'abc123secretvalue'],
    ['exported env', 'export API_KEY="k-0123456789"', 'k-0123456789'],
    ['config assignment', 'DB_PASSWORD=hunter2', 'hunter2'],
    ['authorization token scheme', 'curl -H "Authorization: token gho0123456789abcdef"', 'gho0123456789abcdef'],
    ['authorization bearer', 'Authorization: Bearer abcdefgh12345678', 'abcdefgh12345678'],
    ['x-api-key header', 'curl -H "X-Api-Key: live_0123456789"', 'live_0123456789'],
    ['--password=', 'mysql --password=s3cr3t-pass', 's3cr3t-pass'],
    ['--token value', 'deploy --token tok_0123456789 --env prod', 'tok_0123456789'],
    ['url userinfo', 'git clone https://alice:pa55word@example.com/repo.git', 'pa55word'],
    ['jwt', 'cookie eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0'],
    ['aws access key id', 'aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
    ['google api key', 'key AIzaSyA-1234567890abcdefghijklmnopqrstu', 'AIzaSyA-1234567890abcdefghijklmnopqrstu'],
  ])('masks %s', (_name, text, secret) => {
    const masked = redactSecretText(text);
    expect(masked).not.toContain(secret);
    expect(masked).toContain('[redacted]');
  });

  it('keeps the rest of the text readable', () => {
    expect(redactSecretText('git clone https://alice:pa55word@example.com/repo.git'))
      .toBe('git clone https://alice:[redacted]@example.com/repo.git');
    expect(redactSecretText('export API_KEY=abc && npm test')).toBe('export API_KEY=[redacted] && npm test');
    expect(redactSecretText('ls -la src')).toBe('ls -la src');
  });
});

describe('hard-gate prompt', () => {
  it('masks secret-named fields and token-shaped values but leaves the input untouched', () => {
    const input = { group: '123', password: 'hunter2', note: 'Bearer abcdefgh12345678' };
    const question = formatHardGateQuestion('set_group_admin', 'member', input);
    expect(question).toContain('"password":"[redacted]"');
    expect(question).not.toContain('hunter2');
    expect(question).not.toContain('abcdefgh12345678');
    expect(question).toContain('"group":"123"');
    expect(input.password).toBe('hunter2');
    expect(redactApprovalDisplay(input)).not.toBe(input);
  });
});

describe('approval prompt risk line', () => {
  it('masks a policy reason that quotes the raw command, while the scope key keeps the exact command', async () => {
    const unregister = registerSensitiveExecCommand({ command: 'deploycli', sensitive: [/^deploycli\s+push\b/u] });
    try {
      const requests: ApprovalRequestInput[] = [];
      const approval: ApprovalOutcomePort = {
        available: true,
        requestApproval: async () => false,
        requestApprovalOutcome: async (input) => { requests.push(input); return { status: 'denied', by: 'user' }; },
      };
      const turn = createTurnIngress({
        intent: { kind: 'new' },
        identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' },
        origin: { kind: 'http', sessionId: 's' },
        principal: { subjectId: 'owner', roles: ['owner'] },
        input: { text: 'deploy' },
        session: { key: 'http:s' },
        policy: {
          permissions: ['owner'],
          unattended: false,
          filesystem: { workspaceRoot: process.cwd(), workingDirectory: process.cwd(), access: 'workspace-write' },
          shell: { security: 'allowlist', execPreset: 'development', approvalMode: 'ask' },
        },
        capabilities: { tools: ['bash'], skills: [] },
        signal: new AbortController().signal,
        ports: { journal: { append: () => undefined }, approval },
      });
      const bash: ToolCapability = {
        owner: rootPluginId(), name: 'bash', qualifiedName: 'bash', description: 'bash', requiresApproval: 'on-risk',
        source: '/tools/bash.ts', execute: vi.fn(async () => 'ok'),
      };
      const command = 'deploycli push --token=sk-live-abcdefghijklmnop';
      await new TurnToolRuntime(turn, [bash]).execute('bash', { command }, 'b1');
      expect(requests).toHaveLength(1);
      const question = requests[0]!.question;
      expect(question).toContain('风险：');
      expect(question).not.toContain('sk-live-abcdefghijklmnop');
      expect(requests[0]!.scopeKey).toContain('sk-live-abcdefghijklmnop');
    } finally {
      unregister();
    }
  });
});
