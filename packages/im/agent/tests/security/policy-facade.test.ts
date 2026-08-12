/**
 * policy-facade — 统一工具安全策略门面单测
 *
 * 覆盖：层顺序、deny 短路、deniedBy、各层 applies 条件、
 * 以及 edit_file 全链与迁移前手写链行为等价的对照用例。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Plugin } from '@zhin.js/core';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
import {
  runToolPolicies,
  toolPolicyResultToMessage,
} from '../../src/security/policy-facade.js';
import type { ZhinAgentConfig } from '../../src/config/index.js';
import { EditFileBuiltinTool } from '../../src/builtin/edit-file-tool.js';
import { WriteFileBuiltinTool } from '../../src/builtin/write-file-tool.js';

function makeExecConfig(overrides: Partial<ZhinAgentConfig> = {}): Required<ZhinAgentConfig> {
  return {
    execSecurity: 'allowlist',
    execPreset: 'custom',
    execAllowlist: [],
    execApprovalMode: 'deny',
    ...overrides,
  } as unknown as Required<ZhinAgentConfig>;
}

describe('policy-facade', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-policy-facade-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function mockPlugin(master = 'owner1', trusted: string[] = ['admin1'], execAllowlist: string[] = []) {
    const plugin = {
      inject: (name: string) => {
        if (name === 'icqq') {
          return { endpoints: new Map([['bot1', { $config: { master, trusted } }]]) };
        }
        if (name === 'ai') {
          return { getAgentConfig: () => ({ execAllowlist }) };
        }
        return undefined;
      },
    } as unknown as Plugin;
    (plugin as unknown as { root: Plugin }).root = plugin;
    return plugin;
  }

  describe('层顺序与 applies 条件', () => {
    it('edit_file 全链 7 层按序执行且全部通过', () => {
      const fp = path.join(tmpDir, 'ok.txt');
      const result = runToolPolicies({ toolName: 'edit_file', filePath: fp, rawFilePath: fp });
      expect(result.allowed).toBe(true);
      expect(result.deniedBy).toBeUndefined();
      expect(result.decisions.map((d) => d.policy)).toEqual([
        'role-gate',
        'dangerous-tool-approval',
        'file-permission-matrix',
        'memory-write-path',
        'sensitive-path',
        'blocked-device-path',
        'workspace-access',
      ]);
      expect(toolPolicyResultToMessage(result, 'edit_file')).toBeNull();
    });

    it('write_file 全链 7 层（fileOperation 推导为 create）', () => {
      const fp = path.join(tmpDir, 'new.txt');
      const result = runToolPolicies({ toolName: 'write_file', filePath: fp, rawFilePath: fp });
      expect(result.allowed).toBe(true);
      expect(result.decisions.map((d) => d.policy)).toEqual([
        'role-gate',
        'dangerous-tool-approval',
        'file-permission-matrix',
        'memory-write-path',
        'sensitive-path',
        'blocked-device-path',
        'workspace-access',
      ]);
    });

    it('glob 仅执行 role-gate + sensitive-path（无写类层）', () => {
      const result = runToolPolicies({ toolName: 'glob', filePath: tmpDir });
      expect(result.allowed).toBe(true);
      expect(result.decisions.map((d) => d.policy)).toEqual(['role-gate', 'sensitive-path']);
    });

    it('list_dir 仅执行 role-gate + sensitive-path', () => {
      const result = runToolPolicies({ toolName: 'list_dir', filePath: tmpDir });
      expect(result.allowed).toBe(true);
      expect(result.decisions.map((d) => d.policy)).toEqual(['role-gate', 'sensitive-path']);
    });

    it('analyze_media 等价链（read_file 身份 + read 操作）：无 dangerous/memory/device/workspace 层', () => {
      const fp = path.join(tmpDir, 'a.png');
      const result = runToolPolicies({
        toolName: 'read_file',
        filePath: fp,
        rawFilePath: fp,
        fileOperation: 'read',
      });
      expect(result.allowed).toBe(true);
      expect(result.decisions.map((d) => d.policy)).toEqual([
        'role-gate',
        'file-permission-matrix',
        'sensitive-path',
      ]);
    });

    it('exec-policy 仅在 command 与 config 同时给定时生效', () => {
      const withConfig = runToolPolicies({
        toolName: 'bash',
        command: 'ls -la',
        config: makeExecConfig({ execAllowlist: ['ls'] }),
      });
      // bash + command 还会先走 bash 三层；exec-policy 殿后
      expect(withConfig.decisions.map((d) => d.policy)).toEqual([
        'bash-command-safety',
        'bash-sensitive-read',
        'bash-file-permission',
        'exec-policy',
      ]);
      expect(withConfig.allowed).toBe(true);

      // 无 config：exec-policy 不激活；'bash' 以外的 toolName 不走 bash 三层
      const noConfig = runToolPolicies({ toolName: 'exec', command: 'ls -la' });
      expect(noConfig.decisions).toEqual([]);
      expect(noConfig.allowed).toBe(true);
    });

    it('exec-policy deny：execSecurity=deny 短路并映射文案', () => {
      const result = runToolPolicies({
        toolName: 'bash',
        command: 'ls -la',
        config: makeExecConfig({ execSecurity: 'deny' }),
      });
      expect(result.allowed).toBe(false);
      expect(result.deniedBy).toBe('exec-policy');
      expect(toolPolicyResultToMessage(result, 'bash')).toBe(
        'Error: 当前配置禁止执行 Shell 命令（execSecurity=deny）。如需开放请在配置中设置 ai.agent.execSecurity。',
      );
    });

    it('exec-policy ask：未在白名单映射为 ZHIN_NEEDS_OWNER', () => {
      // 用非文件操作命令（classifyBashFileOperation=null），保证穿过 bash 三层到达 exec-policy
      const result = runToolPolicies({
        toolName: 'bash',
        command: 'somecustomcmd --flag',
        config: makeExecConfig({ execApprovalMode: 'ask', execAllowlist: [] }),
      });
      expect(result.allowed).toBe(false);
      expect(result.needsOwnerApproval).toBe(true);
      expect(result.deniedBy).toBe('exec-policy');
      expect(toolPolicyResultToMessage(result, 'bash')).toBe(
        'ZHIN_NEEDS_OWNER:\n命令「somecustomcmd」不在允许列表中，需要用户确认后执行。',
      );
    });
  });

  describe('deny 短路与 deniedBy', () => {
    it('普通用户 edit_file 在 role-gate 短路，后续层不执行', () => {
      mockPlugin();
      const ctx = mockCommMessage({ adapter: 'icqq', endpoint: 'bot1', senderId: 'user1', sender_roles: ['user'] });
      const fp = path.join(tmpDir, 'a.txt');
      const result = runToolPolicies({ toolName: 'edit_file', filePath: fp, rawFilePath: fp, commMessage: ctx });
      expect(result.allowed).toBe(false);
      expect(result.deniedBy).toBe('role-gate');
      expect(result.decisions.map((d) => d.policy)).toEqual(['role-gate']);
      expect(toolPolicyResultToMessage(result, 'edit_file')).toBe(
        'Error: 权限不足：当前策略不允许执行「edit_file」。',
      );
    });

    it('trusted 未在 execAllowlist 时在 dangerous-tool-approval 短路（ZHIN_NEEDS_OWNER）', () => {
      mockPlugin('owner1', ['admin1'], []);
      const ctx = mockCommMessage({ adapter: 'icqq', endpoint: 'bot1', senderId: 'admin1', sender_roles: ['trusted'] });
      const fp = path.join(tmpDir, 'a.txt');
      const result = runToolPolicies({ toolName: 'edit_file', filePath: fp, rawFilePath: fp, commMessage: ctx });
      expect(result.allowed).toBe(false);
      expect(result.needsOwnerApproval).toBe(true);
      expect(result.deniedBy).toBe('dangerous-tool-approval');
      expect(result.decisions.map((d) => d.policy)).toEqual(['role-gate', 'dangerous-tool-approval']);
      expect(toolPolicyResultToMessage(result, 'edit_file')).toBe(
        'ZHIN_NEEDS_OWNER:\n权限不足：执行「edit_file」需要 Owner 确认。',
      );
    });

    it('trusted 在 execAllowlist 中则全链通过', () => {
      const ctx = mockCommMessage({
        adapter: 'icqq',
        endpoint: 'bot1',
        senderId: 'admin1',
        sender_roles: ['trusted'],
        extra: { execAllowlist: ['edit_file'] },
      });
      const fp = path.join(tmpDir, 'a.txt');
      const result = runToolPolicies({ toolName: 'edit_file', filePath: fp, rawFilePath: fp, commMessage: ctx });
      expect(result.allowed).toBe(true);
      expect(result.decisions).toHaveLength(7);
    });

    it('owner 编辑敏感路径在 file-permission-matrix 产生二次确认 gate', () => {
      const fp = path.join(tmpDir, '.env');
      const result = runToolPolicies({ toolName: 'edit_file', filePath: fp, rawFilePath: fp });
      expect(result.allowed).toBe(true);
      expect(result.needsOwnerApproval).toBe(true);
      expect(result.deniedBy).toBe('file-permission-matrix');
      expect(result.decisions.map((d) => d.policy)).toEqual([
        'role-gate',
        'dangerous-tool-approval',
        'file-permission-matrix',
      ]);
      expect(toolPolicyResultToMessage(result, 'edit_file')).toBe(
        `ZHIN_NEEDS_OWNER:\n对敏感路径「${fp}」执行「update」操作需要二次确认。\n\n（Owner 对敏感路径执行操作需二次确认；请确认继续或拒绝。）`,
      );
    });

    it('master 访问敏感路径在 sensitive-path 产生 gate（list_dir，无权限矩阵层）', () => {
      mockPlugin();
      const ctx = mockCommMessage({ adapter: 'icqq', endpoint: 'bot1', senderId: 'owner1', sender_roles: ['master'] });
      const fp = path.join(tmpDir, '.env');
      const result = runToolPolicies({ toolName: 'list_dir', filePath: fp, commMessage: ctx });
      expect(result.allowed).toBe(false);
      expect(result.needsOwnerApproval).toBe(true);
      expect(result.deniedBy).toBe('sensitive-path');
      expect(result.decisions.map((d) => d.policy)).toEqual(['role-gate', 'sensitive-path']);
      expect(toolPolicyResultToMessage(result, 'list_dir')).toBe(
        'ZHIN_NEEDS_OWNER:\n工具「list_dir」访问敏感路径需二次确认：拒绝访问敏感文件: .env 可能包含密钥或凭据',
      );
    });

    it('无身份上下文访问敏感路径直接 Error（sensitive-path）', () => {
      const fp = path.join(tmpDir, '.env');
      const result = runToolPolicies({ toolName: 'list_dir', filePath: fp });
      expect(result.allowed).toBe(false);
      expect(result.deniedBy).toBe('sensitive-path');
      expect(toolPolicyResultToMessage(result, 'list_dir')).toBe(
        'Error: 拒绝访问敏感文件: .env 可能包含密钥或凭据',
      );
    });

    it('设备路径在 blocked-device-path 短路', () => {
      const result = runToolPolicies({ toolName: 'edit_file', filePath: '/dev/zero', rawFilePath: '/dev/zero' });
      expect(result.allowed).toBe(false);
      expect(result.deniedBy).toBe('blocked-device-path');
      expect(toolPolicyResultToMessage(result, 'edit_file')).toBe('Error: 禁止访问设备路径: /dev/zero');
      expect(result.decisions.map((d) => d.policy)).toEqual([
        'role-gate',
        'dangerous-tool-approval',
        'file-permission-matrix',
        'memory-write-path',
        'sensitive-path',
        'blocked-device-path',
      ]);
    });
  });

  describe('edit_file 全链（门面侧验证；工具不再自行检查策略）', () => {
    it('trusted 未 allowlist：门面返回 ZHIN_NEEDS_OWNER', async () => {
      mockPlugin('owner1', ['admin1'], []);
      const ctx = mockCommMessage({ adapter: 'icqq', endpoint: 'bot1', senderId: 'admin1', sender_roles: ['trusted'] });
      const fp = path.join(tmpDir, 'eq.txt');
      fs.writeFileSync(fp, 'before', 'utf-8');

      const facadeMsg = toolPolicyResultToMessage(
        runToolPolicies({ toolName: 'edit_file', filePath: fp, rawFilePath: fp, commMessage: ctx }),
        'edit_file',
      );
      expect(facadeMsg).toBe('ZHIN_NEEDS_OWNER:\n权限不足：执行「edit_file」需要 Owner 确认。');
    });

    it('普通用户：门面返回 Error', async () => {
      mockPlugin();
      const ctx = mockCommMessage({ adapter: 'icqq', endpoint: 'bot1', senderId: 'user1', sender_roles: ['user'] });
      const fp = path.join(tmpDir, 'eq2.txt');
      fs.writeFileSync(fp, 'before', 'utf-8');

      const facadeMsg = toolPolicyResultToMessage(
        runToolPolicies({ toolName: 'edit_file', filePath: fp, rawFilePath: fp, commMessage: ctx }),
        'edit_file',
      );
      expect(facadeMsg).toBe('Error: 权限不足：当前策略不允许执行「edit_file」。');
    });

    it('master 全链通过后工具正常写入（edit_file / write_file）', async () => {
      const fp = path.join(tmpDir, 'eq3.txt');
      fs.writeFileSync(fp, 'one two', 'utf-8');
      const editOut = String(
        await new EditFileBuiltinTool().run({ file_path: fp, old_string: 'two', new_string: 'three' }),
      );
      expect(editOut).toContain('✅ Edited');
      expect(fs.readFileSync(fp, 'utf-8')).toBe('one three');

      const wp = path.join(tmpDir, 'eq4.txt');
      const writeOut = String(await new WriteFileBuiltinTool().run({ file_path: wp, content: 'hello' }));
      expect(writeOut).toBe(`✅ Wrote 5 bytes to ${wp}`);
    });
  });

  describe('read_file 迁移等价', () => {
    it('read_file 链：role-gate → file-permission-matrix → sensitive-path → blocked-device-path', () => {
      const fp = path.join(tmpDir, 'ok.txt');
      const result = runToolPolicies({
        toolName: 'read_file',
        filePath: fp,
        rawFilePath: fp,
        fileOperation: 'read',
        devicePathGuard: true,
      });
      expect(result.allowed).toBe(true);
      expect(result.decisions.map((d) => d.policy)).toEqual([
        'role-gate',
        'file-permission-matrix',
        'sensitive-path',
        'blocked-device-path',
      ]);
    });

    it('设备路径拒绝文案为读类措辞（devicePathGuard）', () => {
      const result = runToolPolicies({
        toolName: 'read_file',
        filePath: '/dev/zero',
        rawFilePath: '/dev/zero',
        fileOperation: 'read',
        devicePathGuard: true,
      });
      expect(result.allowed).toBe(false);
      expect(result.deniedBy).toBe('blocked-device-path');
      expect(toolPolicyResultToMessage(result, 'read_file')).toBe(
        'Error: 禁止读取设备文件 /dev/zero（会导致进程挂起或注入攻击）',
      );
    });

    it('analyze_media 等价输入（无 devicePathGuard）不触发设备路径层', () => {
      const result = runToolPolicies({
        toolName: 'read_file',
        filePath: '/dev/zero',
        rawFilePath: '/dev/zero',
        fileOperation: 'read',
      });
      expect(result.allowed).toBe(true);
      expect(result.decisions.map((d) => d.policy)).toEqual([
        'role-gate',
        'file-permission-matrix',
        'sensitive-path',
      ]);
    });

    it('普通用户写会话 MEMORY.md 全链放行（对齐 checkMemoryWritePath session）', () => {
      const ctx = mockCommMessage({
        adapter: 'qq',
        endpoint: '知音',
        senderId: 'user1',
        sender_roles: ['user'],
        scope: 'private',
      });
      const fp = path.join(tmpDir, 'data', 'memory', 'sessions', 'qq_private_user1', 'MEMORY.md');
      const result = runToolPolicies({
        toolName: 'write_file',
        filePath: fp,
        rawFilePath: fp,
        commMessage: ctx,
      });
      expect(result.allowed).toBe(true);
      expect(result.needsOwnerApproval).toBeFalsy();
      expect(toolPolicyResultToMessage(result, 'write_file')).toBeNull();
    });

    it('普通用户读敏感路径在 file-permission-matrix 拒绝（门面侧验证）', async () => {
      mockPlugin();
      const ctx = mockCommMessage({ adapter: 'icqq', endpoint: 'bot1', senderId: 'user1', sender_roles: ['user'] });
      const fp = path.join(tmpDir, '.env');

      const facadeMsg = toolPolicyResultToMessage(
        runToolPolicies({ toolName: 'read_file', filePath: fp, rawFilePath: fp, fileOperation: 'read', devicePathGuard: true, commMessage: ctx }),
        'read_file',
      );
      expect(facadeMsg).toBe(`Error: 当前角色为「普通用户」，禁止访问敏感路径「${fp}」。`);
    });

    it('trusted 读敏感路径为 needsOwnerConfirmation gate（门面侧验证）', async () => {
      mockPlugin('owner1', ['admin1'], []);
      const ctx = mockCommMessage({ adapter: 'icqq', endpoint: 'bot1', senderId: 'admin1', sender_roles: ['trusted'] });
      const fp = path.join(tmpDir, '.env');

      const facadeMsg = toolPolicyResultToMessage(
        runToolPolicies({ toolName: 'read_file', filePath: fp, rawFilePath: fp, fileOperation: 'read', devicePathGuard: true, commMessage: ctx }),
        'read_file',
      );
      expect(facadeMsg).toBe(
        `ZHIN_NEEDS_OWNER:\n管理员对敏感路径「${fp}」执行「read」操作需要 Owner 确认。\n\n（管理员执行敏感文件操作需 Owner 确认；请 Owner 回复确认或拒绝。）`,
      );
    });
  });

  describe('grep 迁移等价', () => {
    it('grep 链：role-gate → sensitive-path', () => {
      const result = runToolPolicies({ toolName: 'grep', filePath: tmpDir });
      expect(result.allowed).toBe(true);
      expect(result.decisions.map((d) => d.policy)).toEqual(['role-gate', 'sensitive-path']);
    });

    it('master 搜索敏感目录在 sensitive-path gate（门面侧验证）', async () => {
      mockPlugin();
      const ctx = mockCommMessage({ adapter: 'icqq', endpoint: 'bot1', senderId: 'owner1', sender_roles: ['master'] });
      const fp = path.join(tmpDir, '.ssh');

      const facadeMsg = toolPolicyResultToMessage(
        runToolPolicies({ toolName: 'grep', filePath: fp, commMessage: ctx }),
        'grep',
      );
      expect(facadeMsg).toBe('ZHIN_NEEDS_OWNER:\n工具「grep」访问敏感路径需二次确认：拒绝访问敏感目录: .ssh');
    });
  });

  describe('web_fetch 迁移等价', () => {
    it('仅执行 dangerous-tool-approval 一层', () => {
      const result = runToolPolicies({ toolName: 'web_fetch' });
      expect(result.allowed).toBe(true);
      expect(result.decisions.map((d) => d.policy)).toEqual(['dangerous-tool-approval']);
    });

    it('trusted 未 allowlist 时 gate（门面侧验证）', async () => {
      mockPlugin('owner1', ['admin1'], []);
      const ctx = mockCommMessage({ adapter: 'icqq', endpoint: 'bot1', senderId: 'admin1', sender_roles: ['trusted'] });

      const facadeMsg = toolPolicyResultToMessage(
        runToolPolicies({ toolName: 'web_fetch', commMessage: ctx }),
        'web_fetch',
      );
      expect(facadeMsg).toBe('ZHIN_NEEDS_OWNER:\n权限不足：执行「web_fetch」需要 Owner 确认。');
    });
  });

  describe('bash 迁移等价（exec-policy 不激活）', () => {
    it('bash 链：bash-command-safety → bash-sensitive-read → bash-file-permission，无 exec-policy', () => {
      const result = runToolPolicies({ toolName: 'bash', command: 'ls -la' });
      expect(result.allowed).toBe(true);
      expect(result.decisions.map((d) => d.policy)).toEqual([
        'bash-command-safety',
        'bash-sensitive-read',
        'bash-file-permission',
      ]);
    });

    it('环境变量导出命令在 bash-command-safety 短路（门面侧验证）', async () => {
      const facadeMsg = toolPolicyResultToMessage(
        runToolPolicies({ toolName: 'bash', command: 'printenv' }),
        'bash',
      );
      expect(facadeMsg).toBe('Error: 禁止执行环境变量导出命令（env/printenv/export/set），可能泄漏密钥');
    });

    it('普通用户删除命令在 bash-file-permission 拒绝（门面侧验证）', async () => {
      const plugin = mockPlugin();
      const ctx = mockCommMessage({ adapter: 'icqq', endpoint: 'bot1', senderId: 'user1', sender_roles: ['user'] });
      const cmd = `rm -rf ${path.join(tmpDir, 'x')}`;

      const facadeMsg = toolPolicyResultToMessage(
        runToolPolicies({ toolName: 'bash', command: cmd, commMessage: ctx, hostPlugin: plugin }),
        'bash',
      );
      expect(facadeMsg).toBe('Error: 当前角色为「普通用户」，仅允许读取文件；请求的操作「delete」被拒绝。');
    });
  });
});
