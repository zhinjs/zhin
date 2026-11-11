import { wizardText } from '@zhin.js/scaffold-wizard';

export type CreateLocale = 'zh-CN' | 'en';

/**
 * Strings owned by create-zhin (ADR 0053 onboarding flow). Shared wizard
 * strings stay in @zhin.js/scaffold-wizard and are reached through the fallback.
 */
const CREATE_MESSAGES = {
  'create.prompt.projectName': { 'zh-CN': '项目名称:', en: 'Project name:' },
  'create.prompt.bootstrapToken': {
    'zh-CN': '初始化令牌（首次登录 Console 用，回车使用随机值）:',
    en: 'Bootstrap token (first Console login; press Enter for a random one):',
  },
  'create.error.tokenEmpty': { 'zh-CN': '初始化令牌不能为空', en: 'The bootstrap token cannot be empty' },
  'create.error.unknownOption': { 'zh-CN': '未知参数：{v0}', en: 'Unknown option: {v0}' },
  'create.error.optionValue': {
    'zh-CN': '{v0} 的取值必须是 {v1}',
    en: '{v0} must be one of {v1}',
  },
  'create.error.optionRepeated': { 'zh-CN': '请勿重复 {v0}', en: 'Specify {v0} only once' },
  'create.error.extraName': {
    'zh-CN': '只能指定一个项目名称（收到 {v0} 与 {v1}）',
    en: 'Specify a single project name (got {v0} and {v1})',
  },
  'create.done.created': { 'zh-CN': '✔ 项目已创建：{v0}', en: '✔ Project created: {v0}' },
  'create.done.start': { 'zh-CN': '  启动：{v0}', en: '  Start: {v0}' },
  'create.done.openConsole': {
    'zh-CN': '  然后打开 Console 完成初始化：',
    en: '  Then open the Console to finish setup:',
  },
  'create.done.tokenHidden': {
    'zh-CN': '  （输出不是终端，链接里省略了令牌；完整值见 .env 的 HTTP_TOKEN，在 Console 登录页填写）',
    en: '  (Output is not a terminal, so the token is left out of the link; use HTTP_TOKEN from .env on the Console login page)',
  },
  'create.done.tokenNote': {
    'zh-CN': '  初始化令牌只用于创建第一个所有者账号，之后失效；它保存在 .env 的 HTTP_TOKEN。',
    en: '  The bootstrap token only creates the first owner account and stops working afterwards; it is stored as HTTP_TOKEN in .env.',
  },
  'create.done.consoleSteps': {
    'zh-CN': '  Console 引导会带你完成：数据库 → 所有者账号 → AI → 适配器（每一步都可以跳过）。',
    en: '  The Console walks you through: database → owner account → AI → adapters (each step can be skipped).',
  },
  'create.done.doctor': {
    'zh-CN': '  连不上？运行 {v0}',
    en: '  Cannot connect? Run {v0}',
  },
  'create.done.docs': { 'zh-CN': '  文档：{v0}', en: '  Docs: {v0}' },
} as const satisfies Record<string, Record<CreateLocale, string>>;

export type CreateMessageKey = keyof typeof CREATE_MESSAGES;

/** Localize a create-zhin string; unknown keys fall back to the shared wizard catalog. */
export function createText(locale: CreateLocale | undefined, key: CreateMessageKey | string, values: readonly unknown[] = []): string {
  if (!Object.hasOwn(CREATE_MESSAGES, key)) return wizardText(locale, key, values);
  const template = CREATE_MESSAGES[key as CreateMessageKey][locale === 'en' ? 'en' : 'zh-CN'];
  return template.replace(/\{v(\d+)\}/gu, (match, index: string) => {
    const value = values[Number(index)];
    return value === undefined ? match : String(value);
  });
}
