/**
 * Built-in UI copy of `@zhin.js/console-ui` (ADR 0063 决策 1 第 5 条).
 * Keys are stable ids; values use `{0}`, `{1}` … placeholders.
 * The zh-CN / en strings are the ones the Console used before the components moved here.
 */
export const CONSOLE_UI_LOCALES = Object.freeze(['zh-CN', 'en'] as const);

export type ConsoleUiLocale = (typeof CONSOLE_UI_LOCALES)[number];

export const DEFAULT_CONSOLE_UI_LOCALE: ConsoleUiLocale = 'zh-CN';

const zhCN = {
  'dialog.close': '关闭',
  'confirm.cancel': '取消',
  'confirm.confirm': '确认',
  'confirm.processing': '处理中...',
  'confirm.failed': '操作失败，请重试或取消。',
  'confirm.notCompleted': '操作未完成：{0}',
  'confirm.typeToConfirm': '请输入 {0} 以确认：',
  'empty.noData': '暂无数据',
  'error.retry': '重试',
  'error.technicalDetail': '技术详情',
  'select.searchPlaceholder': '搜索…',
  'select.noMatch': '没有匹配的选项',
  'refresh.updatedAt': '更新于 {0}',
  'refresh.notYet': '尚未更新',
  'refresh.refresh': '刷新',
  'refresh.refreshing': '刷新中…',
  'refresh.interval': '自动刷新间隔',
  'refresh.manual': '手动刷新',
  'refresh.auto': '{0}s 自动',
} as const;

export type ConsoleUiMessageKey = keyof typeof zhCN;

export type ConsoleUiMessages = Readonly<Record<ConsoleUiMessageKey, string>>;

const en: ConsoleUiMessages = {
  'dialog.close': 'Close',
  'confirm.cancel': 'Cancel',
  'confirm.confirm': 'Confirm',
  'confirm.processing': 'Processing…',
  'confirm.failed': 'The action failed. Try again or cancel.',
  'confirm.notCompleted': 'Not completed: {0}',
  'confirm.typeToConfirm': 'Type {0} to confirm:',
  'empty.noData': 'No data',
  'error.retry': 'Retry',
  'error.technicalDetail': 'Technical details',
  'select.searchPlaceholder': 'Search…',
  'select.noMatch': 'No matching options',
  'refresh.updatedAt': 'Updated {0}',
  'refresh.notYet': 'Not updated yet',
  'refresh.refresh': 'Refresh',
  'refresh.refreshing': 'Refreshing…',
  'refresh.interval': 'Auto refresh interval',
  'refresh.manual': 'Manual refresh',
  'refresh.auto': '{0}s auto',
};

export const CONSOLE_UI_MESSAGES: Readonly<Record<ConsoleUiLocale, ConsoleUiMessages>> = Object.freeze({
  'zh-CN': Object.freeze({ ...zhCN }),
  en: Object.freeze({ ...en }),
});

/** Maps any BCP 47 tag onto a built-in locale: `zh*` → zh-CN, `en*` → en, otherwise the default. */
export function resolveConsoleUiLocale(locale: string | undefined | null): ConsoleUiLocale {
  if (!locale) return DEFAULT_CONSOLE_UI_LOCALE;
  const lower = locale.toLowerCase();
  if (lower.startsWith('zh')) return 'zh-CN';
  if (lower.startsWith('en')) return 'en';
  return DEFAULT_CONSOLE_UI_LOCALE;
}

export function formatConsoleUiMessage(template: string, values?: readonly unknown[]): string {
  if (!values || values.length === 0) return template;
  return template.replace(/\{(\d+)\}/gu, (match, index: string) => {
    const value = values[Number(index)];
    return value === undefined ? match : String(value);
  });
}
