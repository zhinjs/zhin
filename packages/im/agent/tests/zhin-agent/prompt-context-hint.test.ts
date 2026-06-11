import { describe, it, expect, vi } from 'vitest';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
import * as core from '@zhin.js/core';
import {
  buildContextHint,
  formatSessionContextLine,
  resolvePromptFileRole,
  buildRichSystemPrompt,
} from '../../src/zhin-agent/prompt.js';
import { buildSenderRolesFilePermissionsPrompt } from '../../src/security/file-role-policy.js';
import type { Message } from '@zhin.js/core';
import type { ZhinAgentConfig } from '../../src/zhin-agent/config.js';

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
  it('Session 并入 # Runtime，无尾部 Context:', () => {
    const prompt = buildRichSystemPrompt({
      config: minimalConfig,
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: '',
      commMessage: mockCommMessage({
        adapter: 'icqq',
        endpoint: '8596238',
        scope: 'group',
        sceneId: '201193925',
        senderId: '1659488338',
      }),
    });
    expect(prompt).toContain('# Runtime');
    expect(prompt).toContain('Session: platform:icqq | endpoint:8596238 | group_id:201193925');
    expect(prompt).not.toMatch(/\nContext: platform:/);
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
