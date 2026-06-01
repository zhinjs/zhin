/**
 * file-role-policy 单测 — 文件操作角色权限策略
 */
import { describe, it, expect } from 'vitest';
import {
  type FileRole,
  type FileOperation,
  type FilePermissionResult,
  checkFilePermission,
  isDangerousFileOperation,
  inferFileRole,
  classifyBashFileOperation,
  checkBashFilePermission,
  formatFilePermissionMessage,
  buildFileRolePrompt,
} from '../../src/security/file-role-policy.js';

describe('checkFilePermission', () => {
  it('owner 允许所有操作', () => {
    const ops: FileOperation[] = ['create', 'read', 'update', 'delete'];
    for (const op of ops) {
      const result = checkFilePermission('owner', op);
      expect(result.allowed).toBe(true);
      expect(result.role).toBe('owner');
      expect(result.operation).toBe(op);
    }
  });

  it('admin 允许 create/read/update，不允许 delete', () => {
    expect(checkFilePermission('admin', 'create').allowed).toBe(true);
    expect(checkFilePermission('admin', 'read').allowed).toBe(true);
    expect(checkFilePermission('admin', 'update').allowed).toBe(true);
    expect(checkFilePermission('admin', 'delete').allowed).toBe(false);
    expect(checkFilePermission('admin', 'delete').reason).toContain('管理员');
    expect(checkFilePermission('admin', 'delete').reason).toContain('删除');
  });

  it('user 只允许 read，不允许 create/update/delete', () => {
    expect(checkFilePermission('user', 'read').allowed).toBe(true);
    expect(checkFilePermission('user', 'create').allowed).toBe(false);
    expect(checkFilePermission('user', 'update').allowed).toBe(false);
    expect(checkFilePermission('user', 'delete').allowed).toBe(false);
    for (const op of ['create', 'update', 'delete'] as FileOperation[]) {
      const result = checkFilePermission('user', op);
      expect(result.reason).toContain('普通用户');
    }
  });

  it('owner 对敏感路径的 create/update 需要 needsConfirmation', () => {
    const result = checkFilePermission('owner', 'update', '/project/.env');
    expect(result.allowed).toBe(true);
    expect(result.needsConfirmation).toBe(true);
    expect(result.reason).toContain('敏感路径');
  });

  it('admin 对敏感路径的 create/update 需要 needsOwnerConfirmation', () => {
    const result = checkFilePermission('admin', 'update', '/project/.env');
    expect(result.allowed).toBe(true);
    expect(result.needsOwnerConfirmation).toBe(true);
    expect(result.reason).toContain('Owner');
  });

  it('owner 对普通路径不需要确认', () => {
    const result = checkFilePermission('owner', 'update', '/project/src/main.ts');
    expect(result.allowed).toBe(true);
    expect(result.needsConfirmation).toBeUndefined();
    expect(result.needsOwnerConfirmation).toBeUndefined();
  });

  it('delete 操作始终对 owner 视为危险', () => {
    const result = checkFilePermission('owner', 'delete', '/tmp/test.txt');
    expect(result.allowed).toBe(true);
    expect(result.needsConfirmation).toBe(true);
  });
});

describe('isDangerousFileOperation', () => {
  it('delete 操作始终危险', () => {
    expect(isDangerousFileOperation('delete', '/tmp/test.txt')).toBe(true);
  });

  it('read 操作不危险', () => {
    expect(isDangerousFileOperation('read', '/project/.env')).toBe(false);
  });

  it('create/update 对敏感路径危险', () => {
    expect(isDangerousFileOperation('update', '/project/.env')).toBe(true);
    expect(isDangerousFileOperation('create', '/project/.ssh/config')).toBe(true);
  });

  it('create/update 对普通路径不危险', () => {
    expect(isDangerousFileOperation('update', '/project/src/main.ts')).toBe(false);
    expect(isDangerousFileOperation('create', '/project/new-file.txt')).toBe(false);
  });
});

describe('inferFileRole', () => {
  it('isOwner → owner', () => {
    expect(inferFileRole({ isOwner: true })).toBe('owner');
  });

  it('senderPermissionLevel=owner → owner', () => {
    expect(inferFileRole({ senderPermissionLevel: 'owner' })).toBe('owner');
  });

  it('senderPermissionLevel=bot_admin → admin', () => {
    expect(inferFileRole({ senderPermissionLevel: 'bot_admin' })).toBe('admin');
  });

  it('senderPermissionLevel=group_owner → admin', () => {
    expect(inferFileRole({ senderPermissionLevel: 'group_owner' })).toBe('admin');
  });

  it('senderPermissionLevel=group_admin → admin', () => {
    expect(inferFileRole({ senderPermissionLevel: 'group_admin' })).toBe('admin');
  });

  it('isBotAdmin → admin', () => {
    expect(inferFileRole({ isBotAdmin: true })).toBe('admin');
  });

  it('isGroupOwner → admin', () => {
    expect(inferFileRole({ isGroupOwner: true })).toBe('admin');
  });

  it('isGroupAdmin → admin', () => {
    expect(inferFileRole({ isGroupAdmin: true })).toBe('admin');
  });

  it('无权限标志 → user', () => {
    expect(inferFileRole({})).toBe('user');
  });

  it('senderPermissionLevel=user → user', () => {
    expect(inferFileRole({ senderPermissionLevel: 'user' })).toBe('user');
  });
});

describe('classifyBashFileOperation', () => {
  it('删除类命令 → delete', () => {
    expect(classifyBashFileOperation('rm -rf /tmp/test')).toBe('delete');
    expect(classifyBashFileOperation('rmdir old_dir')).toBe('delete');
  });

  it('读取类命令 → read', () => {
    expect(classifyBashFileOperation('cat file.txt')).toBe('read');
    expect(classifyBashFileOperation('ls -la')).toBe('read');
    expect(classifyBashFileOperation('grep pattern file.txt')).toBe('read');
  });

  it('写入类命令 → update', () => {
    expect(classifyBashFileOperation('echo hello > file.txt')).toBe('update');
  });

  it('创建类命令 → create', () => {
    expect(classifyBashFileOperation('mkdir new_dir')).toBe('create');
    expect(classifyBashFileOperation('touch new_file.txt')).toBe('create');
  });

  it('无文件操作 → null', () => {
    expect(classifyBashFileOperation('date')).toBeNull();
    expect(classifyBashFileOperation('whoami')).toBeNull();
  });
});

describe('checkBashFilePermission', () => {
  it('owner 可以执行删除命令（需确认）', () => {
    const result = checkBashFilePermission('owner', 'rm -rf /tmp/test');
    expect(result.allowed).toBe(true);
    expect(result.fileOperation).toBe('delete');
    expect(result.needsConfirmation).toBe(true);
  });

  it('admin 不能执行删除命令', () => {
    const result = checkBashFilePermission('admin', 'rm -rf /tmp/test');
    expect(result.allowed).toBe(false);
    expect(result.fileOperation).toBe('delete');
  });

  it('user 不能执行创建命令', () => {
    const result = checkBashFilePermission('user', 'mkdir new_dir');
    expect(result.allowed).toBe(false);
  });

  it('owner 可以执行普通写入命令', () => {
    const result = checkBashFilePermission('owner', 'echo hello > /tmp/test.txt');
    expect(result.allowed).toBe(true);
  });
});

describe('formatFilePermissionMessage', () => {
  it('!allowed → Error 前缀消息', () => {
    const result = checkFilePermission('user', 'create');
    const msg = formatFilePermissionMessage(result, 'write_file');
    expect(msg).toMatch(/^Error:/);
    expect(msg).toContain('普通用户');
  });

  it('needsOwnerConfirmation → ZHIN_NEEDS_OWNER 信号', () => {
    const result = checkFilePermission('admin', 'update', '/project/.env');
    const msg = formatFilePermissionMessage(result, 'edit_file');
    expect(msg).toMatch(/^ZHIN_NEEDS_OWNER:/);
    expect(msg).toContain('Owner');
  });

  it('needsConfirmation → ZHIN_NEEDS_OWNER 信号（owner 二次确认）', () => {
    const result = checkFilePermission('owner', 'delete', '/tmp/test.txt');
    const msg = formatFilePermissionMessage(result, 'write_file');
    expect(msg).toMatch(/^ZHIN_NEEDS_OWNER:/);
    expect(msg).toContain('二次确认');
  });

  it('allowed without confirmation → 空消息', () => {
    const result = checkFilePermission('owner', 'read');
    const msg = formatFilePermissionMessage(result, 'read_file');
    expect(msg).toBe('');
  });
});

describe('buildFileRolePrompt', () => {
  it('owner 角色提示词包含完整权限说明', () => {
    const prompt = buildFileRolePrompt('owner');
    expect(prompt).toContain('Owner');
    expect(prompt).toContain('创建');
    expect(prompt).toContain('二次确认');
  });

  it('admin 角色提示词包含限制说明', () => {
    const prompt = buildFileRolePrompt('admin');
    expect(prompt).toContain('Admin');
    expect(prompt).toContain('删除');
    expect(prompt).toContain('Owner');
  });

  it('user 角色提示词包含只读说明', () => {
    const prompt = buildFileRolePrompt('user');
    expect(prompt).toContain('User');
    expect(prompt).toContain('读取');
  });
});