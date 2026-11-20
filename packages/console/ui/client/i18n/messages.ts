/**
 * Built-in UI copy of `@zhin.js/console-ui` (ADR 0063 决策 1 第 5 条).
 * Keys are stable ids; values use `{0}`, `{1}` … placeholders.
 * The zh-CN / en strings are the ones the Console used before the components moved here.
 */
export const CONSOLE_UI_LOCALES = Object.freeze(['zh-CN', 'en'] as const);

/**
 * Declared here, not re-exported from `@zhin.js/console-protocol`: this component library has no
 * `@zhin.js/*` dependency (ADR 0063). `tests/contracts/locale-types.test.ts` keeps it equal to
 * `ConsoleLocale` and to `Locale` of `@zhin.js/plugin-runtime`.
 */
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
  'empty.noData': '这里还没有内容',
  'empty.messages': '还没有消息',
  'empty.tasks': '还没有任务',
  'empty.logs': '还没有日志',
  'empty.table': '在左侧选择一个数据表',
  'empty.record': '选择一条记录查看详情',
  'empty.notFound': '找不到这个页面',
  'date.placeholder': '选择日期',
  'date.placeholderDateTime': '选择日期和时间',
  'date.clear': '清除',
  'date.prevMonth': '上个月',
  'date.nextMonth': '下个月',
  'date.today': '今天',
  'date.now': '现在',
  'date.time': '时间',
  'date.hour': '时',
  'date.minute': '分',
  'date.done': '完成',
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
  'actions.more': '更多',
  'listDetail.detail': '详情',
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
  'empty.noData': 'Nothing here yet',
  'empty.messages': 'No messages yet',
  'empty.tasks': 'No tasks yet',
  'empty.logs': 'No logs yet',
  'empty.table': 'Select a table on the left',
  'empty.record': 'Select a record to see its details',
  'empty.notFound': 'Page not found',
  'date.placeholder': 'Pick a date',
  'date.placeholderDateTime': 'Pick a date and time',
  'date.clear': 'Clear',
  'date.prevMonth': 'Previous month',
  'date.nextMonth': 'Next month',
  'date.today': 'Today',
  'date.now': 'Now',
  'date.time': 'Time',
  'date.hour': 'Hour',
  'date.minute': 'Minute',
  'date.done': 'Done',
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
  'actions.more': 'More',
  'listDetail.detail': 'Details',
};

export const CONSOLE_UI_MESSAGES: Readonly<Record<ConsoleUiLocale, ConsoleUiMessages>> = Object.freeze({
  'zh-CN': Object.freeze({ ...zhCN }),
  en: Object.freeze({ ...en }),
});

/**
 * Maps any BCP 47 tag onto a built-in locale: `zh*` → zh-CN, `en*` → en, otherwise the default.
 *
 * Deliberately lenient, unlike `resolveLocale()` of `@zhin.js/plugin-runtime`: the input is the
 * host's display language, and hosts outside Zhin pass browser tags such as `navigator.language`
 * (`en-US`, `zh-TW`) straight to `ConsoleUiI18nProvider`, whose documented contract accepts any tag.
 */
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
