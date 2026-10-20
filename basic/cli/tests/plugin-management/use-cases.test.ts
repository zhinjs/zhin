import { formatPluginUseCases, pluginUseCases } from '../../src/plugin-management/use-cases.js';
import { useCasesCommand } from '../../src/commands/use-cases.js';

it('makes useful tasks discoverable without loading plugins or making mutations', () => {
  expect(formatPluginUseCases()).toContain('reminder');
  expect(formatPluginUseCases()).toContain('本命令不安装');
  expect(new Set(pluginUseCases.map(item => item.id)).size).toBe(pluginUseCases.length);
  expect(formatPluginUseCases('reminder')).toContain('--dry-run');
});

it('does not promise unavailable scope or impersonate a chat sender', () => {
  expect(formatPluginUseCases('group-welcome')).toContain('所有群');
  expect(formatPluginUseCases('group-welcome')).toContain('尚未提供精确范围');
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

it('discovers the RSS administrator path with precise targets and honest baseline/delivery boundaries', async () => {
  const entry = pluginUseCases.find(item => item.id === 'rss-subscription');
  expect(entry).toMatchObject({ mode: 'administrator-task', packageName: '@zhin.js/plugin-rss' });
  const output = formatPluginUseCases('rss-subscription');
  expect(output).toContain('zhin install @zhin.js/plugin-rss --dry-run');
  expect(output).toContain('父容器和线程'); expect(output).toContain('基线'); expect(output).toContain('不补发历史');
  expect(output).toContain('不自动重试'); expect(output).toContain('聊天订阅独立');
  expect(useCasesCommand.helpInformation()).toContain('rss-subscription');
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await useCasesCommand.parseAsync(['rss-subscription'], { from: 'user' });
    expect(log).toHaveBeenCalledExactlyOnceWith(output);
  } finally { log.mockRestore(); }
});
