import { describe, it, expect, vi } from 'vitest';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
import * as core from '@zhin.js/core';
import {
  buildContextHint,
  resolvePromptFileRole,
  buildRichSystemPrompt,
} from '../../src/prompt/system-prompt.js';
import {
  formatSessionContextLine,
  buildTurnContextEnvelope,
} from '../../src/context/turn-envelope.js';
import { buildSenderRolesFilePermissionsPrompt } from '../../src/security/file-role-policy.js';
import type { Message } from '@zhin.js/core';
import type { ZhinAgentConfig } from '../../src/config/index.js';

const minimalConfig = {
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
  chatModel: '',
  visionModel: '',
  contextTokens: 4096,
  maxHistoryShare: 0.5,
  disabledTools: [],
  allowedTools: [],
  execSecurity: 'deny',
  execPreset: 'custom',
  execAllowlist: [],
  execApprovalMode: 'deny',
  subagentExecApprovalMode: 'deny',
  workerExecApprovalMode: 'deny',
  taskExecApprovalMode: 'deny',
  maxSubagentIterations: 15,
  subagentTools: [],
  modelSizeHint: '',
  skillInstructionMaxChars: 0,
} as Required<ZhinAgentConfig>;

describe('formatSessionContextLine', () => {
  it('生成 Session 行（非重复 Context: 尾注）', () => {
    const line = formatSessionContextLine(mockCommMessage({
      adapter: 'icqq',
      endpoint: '8596238',
      scope: 'group',
      sceneId: '201193925',
    }));
    expect(line).toBe('Session: platform:icqq | endpoint:8596238 | group_id:201193925');
  });

  it('同群不同用户 Session 行相同', () => {
    const base = mockCommMessage({ adapter: 'icqq', endpoint: 'b', scope: 'group', sceneId: 'g1' });
    expect(formatSessionContextLine(base))
      .toBe(formatSessionContextLine({ ...base, $sender: { id: 'u2' } }));
  });
});

describe('buildContextHint', () => {
  it('不再追加尾部 Context 行', () => {
    expect(buildContextHint(mockCommMessage({ adapter: 'icqq' }), 'hi')).toBe('');
  });
});

describe('buildRichSystemPrompt', () => {
  it('Session 不在可缓存 system；见 [Turn context]', () => {
    const commMessage = mockCommMessage({
      adapter: 'icqq',
      endpoint: '8596238',
      scope: 'group',
      sceneId: '201193925',
      senderId: '1659488338',
    });
    const prompt = buildRichSystemPrompt({
      config: minimalConfig,
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: '',
      commMessage,
    });
    expect(prompt).toContain('# Runtime');
    expect(prompt).toContain('CWD:');
    expect(prompt).not.toContain('Session: platform:icqq');

    const envelope = buildTurnContextEnvelope({ commMessage });
    expect(envelope).toContain('Session: platform:icqq | endpoint:8596238 | group_id:201193925');
  });

  it('File Permissions 为各 SenderRole 静态说明，非当前用户档位', () => {
    const prompt = buildRichSystemPrompt({
      config: minimalConfig,
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: '',
      commMessage: mockCommMessage(),
    });
    expect(prompt).toContain('# Security');
    expect(prompt).toContain('**master**');
    expect(prompt).toContain('**trusted**');
    expect(prompt).not.toContain('当前用户角色');
    expect(prompt).not.toContain('Owner（拥有者）');
  });

  it('SOUL.md 存在时用 nickname 而非硬编码 Zhin', () => {
    const prompt = buildRichSystemPrompt({
      config: minimalConfig,
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: '## SOUL.md\n# Soul\nAction-oriented assistant.',
      agentNickname: '小智',
    });
    expect(prompt).toContain('You are 小智.');
    expect(prompt).toContain('see SOUL.md');
    expect(prompt).not.toMatch(/You are Zhin\b/);
  });

  it('SOUL.md 且无 nickname 时不注入 Zhin 品牌名', () => {
    const prompt = buildRichSystemPrompt({
      config: minimalConfig,
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: '## SOUL.md\n# Soul\n',
    });
    expect(prompt).toContain('Persona, identity, and tone: see SOUL.md');
    expect(prompt).not.toMatch(/You are Zhin\b/);
  });
});

describe('resolvePromptFileRole', () => {
  it('master → owner 文件档位（运行时策略仍用）', () => {
    const message = {
      $adapter: 'qq',
      $endpoint: 'b1',
      $sender: { id: 'u1', isMaster: true },
      $channel: { type: 'private' },
    } as any;
    expect(resolvePromptFileRole(message)).toBe('owner');
  });
});

describe('buildSenderRolesFilePermissionsPrompt', () => {
  it('声明多角色权限矩阵', () => {
    const text = buildSenderRolesFilePermissionsPrompt();
    expect(text).toContain('trusted');
    expect(text).toContain('Platform group admin');
    expect(text).toContain('internal speaker label');
    expect(text).toContain('server-side');
    expect(text).toContain('never explain that label format to users');
  });
});
