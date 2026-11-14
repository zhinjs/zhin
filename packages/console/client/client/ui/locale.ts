import { useMemo, useSyncExternalStore } from 'react';

export type PluginUiLocale = 'zh-CN' | 'en';

/** 内置组件文案；键是中文原文，英文只做界面翻译。 */
const KIT_EN: Readonly<Record<string, string>> = {
  '加载中…': 'Loading…',
  '重试': 'Retry',
  '重试中…': 'Retrying…',
  '关闭': 'Dismiss',
  '取消': 'Cancel',
  '技术详情': 'Technical details',
  '加载失败': 'Failed to load',
  '暂无数据': 'Nothing here yet',
  '处理中…': 'Working…',
  '数据可能已过期，上次成功 {0}': 'Data may be out of date. Last updated {0}.',
  '数据可能已过期': 'Data may be out of date.',
  '最近一次刷新失败：{0}': 'The latest refresh failed: {0}',
  '确认：{0}': 'Confirm: {0}',
  '刷新': 'Refresh',
  '操作': 'Actions',
  '复制': 'Copy',
  '不能为空': 'is required',
  '已完成': 'Completed',
  '操作失败': 'Action failed',
  '没有操作权限': 'Permission denied',
  '点击暂停自动轮询': 'Click to pause polling',
  '点击恢复自动轮询': 'Click to resume polling',
  '已复制': 'Copied',
  '清空': 'Clear',
  '展开': 'Expand',
  '收起': 'Collapse',
  '搜索…': 'Search…',
  '请选择…': 'Select…',
  '上一页': 'Prev',
  '下一页': 'Next',
  '共 {0} 条': '{0} items',
  '升序排列': 'Sort ascending',
  '降序排列': 'Sort descending',
  '点击排序': 'Click to sort',
  '是': 'Yes',
  '否': 'No',
  '移除 {0}': 'Remove {0}',
  '已选 {0} 项': '{0} selected',
  '清空选择': 'Clear selection',
  '全选当前页': 'Select current page',
  '取消全选': 'Deselect all',
  '选择行': 'Select row',
  '展开详情': 'Expand details',
  '收起详情': 'Collapse details',
  '批量操作': 'Batch actions',
  // Conversation picker / label (#1250)
  '已选择': 'Selected',
  '清除': 'Clear',
  '搜索群名、昵称、ID 或账号': 'Search by group, nickname, ID or account',
  '搜索会话': 'Search conversations',
  '无法读取账号与最近会话（需要「查看账号」权限 endpoint.view），可手动填写。': 'Accounts and recent conversations are unavailable (needs the “view accounts” permission, endpoint.view); enter the conversation manually.',
  '无法读取最近会话，仅列出账号；可手动填写会话 ID。': 'Recent conversations are unavailable; only accounts are listed. Enter the conversation ID manually.',
  '最近会话': 'Recent conversations',
  '没有匹配的最近会话': 'No matching recent conversation',
  '暂无最近会话': 'No recent conversations yet',
  '手动填写（高级）': 'Enter manually (advanced)',
  '收起手动填写': 'Hide manual entry',
  '机器人账号': 'Bot account',
  '选择机器人账号': 'Choose a bot account',
  '未列出机器人账号（读取账号列表需要「查看账号」权限 endpoint.view），请手动填写适配器与账号 ID。': 'No bot account is listed (listing accounts needs the “view accounts” permission, endpoint.view); enter the adapter and account ID manually.',
  '适配器': 'Adapter',
  '适配器名称': 'Adapter name',
  '账号 ID': 'Account ID',
  '账号的规范 endpoint ID': 'Canonical endpoint ID of the account',
  '会话类型': 'Conversation type',
  '会话 ID': 'Conversation ID',
  '群号 / 用户 ID / 频道 ID': 'Group / user / channel ID',
  '使用该会话': 'Use this conversation',
  '未启用': 'Disabled',
};

/**
 * 跟随 Console：Console 把用户选的界面语言写在 `<html lang>` 上，优先读它；
 * 没有时才看 `navigator.languages`；无 DOM 时默认中文。
 */
export function detectLocale(): PluginUiLocale {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : '';
  if (lang) return lang.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
  if (typeof navigator === 'undefined') return 'zh-CN';
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return languages.some((language) => language?.toLowerCase().startsWith('zh')) ? 'zh-CN' : 'en';
}

/** 在 Console 里切换语言时 `<html lang>` 会变，页面随之重新渲染。 */
function subscribeLocale(onChange: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  return () => observer.disconnect();
}

/** 以中文原文为键翻译，`{0}` `{1}` 为位置占位符；缺失翻译时回退原文。 */
export function translate(
  locale: PluginUiLocale,
  dictionary: Readonly<Record<string, string>> | undefined,
  zh: string,
  ...values: readonly (string | number)[]
): string {
  const template = locale === 'en' ? (dictionary?.[zh] ?? KIT_EN[zh] ?? zh) : zh;
  return template.replace(/\{(\d+)\}/g, (match, index) => {
    const value = values[Number(index)];
    return value === undefined ? match : String(value);
  });
}

export interface PluginUiText {
  readonly locale: PluginUiLocale;
  readonly t: (zh: string, ...values: readonly (string | number)[]) => string;
}

/**
 * 页面语言与翻译函数。`dictionary` 是页面自己的 `中文 → English` 表（内置组件文案已自带）。
 * 取代各页面重复的 `detectLocale` + `text` 辅助函数。
 */
export function useLocale(dictionary?: Readonly<Record<string, string>>): PluginUiText {
  const locale = useSyncExternalStore(subscribeLocale, detectLocale, () => 'zh-CN' as PluginUiLocale);
  return useMemo(() => ({
    locale,
    t: (zh: string, ...values: readonly (string | number)[]) => translate(locale, dictionary, zh, ...values),
  }), [locale, dictionary]);
}

/** `HH:mm`（本地时区）。 */
export function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
