/**
 * Harness：入站后工具/策略边界（下游反压）的最小 fixture。
 * 模拟「Agent 侧将执行的危险命令 / 敏感读路径」在出工具前被策略拦截。
 */
import { describe, it, expect } from 'vitest';
import { checkExecPolicy } from '../src/zhin-agent/exec-policy.js';
import type { ZhinAgentConfig } from '../src/zhin-agent/config.js';
import { DEFAULT_CONFIG } from '../src/zhin-agent/config.js';
import { checkFileAccess, isBlockedDevicePath } from '../src/file-policy.js';
import { describePromptSectionsForDebug } from '../src/zhin-agent/prompt.js';
import type { RichSystemPromptContext } from '../src/zhin-agent/prompt.js';

function makeConfig(overrides: Partial<ZhinAgentConfig> = {}): Required<ZhinAgentConfig> {
  return {
    persona: '',
    maxIterations: 5,
    timeout: 60000,
    preExecTimeout: 10000,
    maxSkills: 3,
    maxTools: 8,
    minTopicRounds: 5,
    slidingWindowSize: 5,
    topicChangeThreshold: 0.15,
    rateLimit: {},
    toneAwareness: true,
    visionModel: '',
    contextTokens: 4096,
    maxHistoryShare: 0.5,
    disabledTools: [],
    allowedTools: [],
    execSecurity: 'allowlist',
    execPreset: 'custom',
    execAllowlist: ['ls', 'cat', 'echo'],
    execAsk: false,
    maxSubagentIterations: 15,
    subagentTools: [],
    modelSizeHint: '',
    skillInstructionMaxChars: 0,
    ...overrides,
  } as Required<ZhinAgentConfig>;
}

describe('Harness inbound → tool/policy boundary', () => {
  it('exec-policy：拒绝典型危险 one-shot shell（等价于错误入站意图）', () => {
    const cfg = makeConfig();
    const r = checkExecPolicy('sudo rm -rf /', cfg);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBeDefined();
  });

  it('exec-policy：白名单外命令在 allowlist 模式下拒绝', () => {
    const cfg = makeConfig({ execAllowlist: ['ls'] });
    const r = checkExecPolicy('curl https://evil', cfg);
    expect(r.allowed).toBe(false);
  });

  it('file-policy：阻止敏感环境文件读取路径', () => {
    const r = checkFileAccess('/app/.env');
    expect(r.allowed).toBe(false);
  });

  it('file-policy：read_file 链使用的设备路径拦截（与 builtin-tools 一致）', () => {
    expect(isBlockedDevicePath('/dev/zero')).toBe(true);
    expect(isBlockedDevicePath('/dev/null')).toBe(false);
  });

  it('describePromptSectionsForDebug：与各 § 段一致的非空元数据', () => {
    const ctx: RichSystemPromptContext = {
      config: DEFAULT_CONFIG,
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: '',
    };
    const d = describePromptSectionsForDebug(ctx);
    expect(d.length).toBeGreaterThan(0);
    expect(d[0]?.id).toBe('§1_identity_environment');
    expect(d.every((x) => x.approxChars > 0)).toBe(true);
  });
});
