import { wizardText } from '../src/messages.js';

describe('life-assistant knowledge/faq.md (#1250)', () => {
  it.each(['zh-CN', 'en'] as const)('names both model entry points and the real precedence (%s)', (locale) => {
    const faq = wizardText(locale, 'templates.knowledgeFaq');
    expect(faq).toContain('/features/ai');
    expect(faq).toContain('ai.plan.yml');
    expect(faq).toContain('zhin migrate inference');
    // The legacy field is only mentioned as no longer deciding the model.
    expect(faq).toMatch(locale === 'en' ? /`ai\.agents\.zhin\.model`[^\n]*no longer selects/ : /`ai\.agents\.zhin\.model` 已不再决定模型/);
    expect(faq).not.toMatch(/(修改|Edit) `zhin\.config\.yml` 中? ?`?ai\.agents\.zhin\.model/);
    expect(faq).toMatch(locale === 'en'
      ? /personal Session choice > scene > account \(Endpoint\) > adapter > the deployment-wide `chat` purpose/
      : /个人 Session 的明确选择 > 场景 > 账号（Endpoint）> 适配器 > 部署默认的 `chat` 用途/);
    expect(faq).toContain(locale === 'en' ? 'the database (Console) wins' : '以**数据库（Console）为准**');
  });
});

describe('generated BOT.md reminders section (#1250 b96)', () => {
  it.each(['zh-CN', 'en'] as const)('names the real reminder / schedule tools, never cron_add (%s)', (locale) => {
    const bot = wizardText(locale, 'templates.agentInstructions');
    expect(bot).not.toContain('cron_add');
    expect(bot).toContain('`reminder_create`');
    expect(bot).toContain('`schedule_add`');
    expect(bot).toContain('`schedule_update`');
    expect(bot).toContain('Do NOT just write reminders to memory files');
  });
});
