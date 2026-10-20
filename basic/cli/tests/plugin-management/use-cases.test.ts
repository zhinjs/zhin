import { formatPluginUseCases, pluginUseCases } from '../../src/plugin-management/use-cases.js';

it('makes useful tasks discoverable without loading plugins or making mutations', () => {
  expect(formatPluginUseCases()).toContain('reminder');
  expect(formatPluginUseCases()).toContain('本命令不安装');
  expect(new Set(pluginUseCases.map(item => item.id)).size).toBe(pluginUseCases.length);
  expect(formatPluginUseCases('reminder')).toContain('--dry-run');
});

it('does not promise unavailable scope or impersonate a chat sender', () => {
  expect(formatPluginUseCases('group-welcome')).toContain('welcomeConversations');
  expect(formatPluginUseCases('group-welcome')).toContain('空列表不欢迎任何会话');
  expect(formatPluginUseCases('group-welcome')).toContain('不是通配');
  expect(formatPluginUseCases('keyword-reply')).toContain('不伪造平台用户');
  expect(() => formatPluginUseCases('missing')).toThrow('未知用途');
});

it('keeps personal chat guidance separate from administrator task creation', () => {
  expect(pluginUseCases.find(item => item.id === 'personal-reminder')?.mode).toBe('conversation-command');
  expect(pluginUseCases.find(item => item.id === 'reminder')?.mode).toBe('administrator-task');
  const personal = formatPluginUseCases('personal-reminder');
  expect(personal).toContain('remind create');
  expect(personal).toContain('默认 UTC');
  expect(personal).toContain('确认');
  expect(personal).toContain('Console 不代为执行');
});
