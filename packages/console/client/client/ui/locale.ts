import { useMemo } from 'react';

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
};

/** `navigator.languages` 里有 zh 就用中文，否则英文；无 DOM 时默认中文。 */
export function detectLocale(): PluginUiLocale {
  if (typeof navigator === 'undefined') return 'zh-CN';
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return languages.some((language) => language?.toLowerCase().startsWith('zh')) ? 'zh-CN' : 'en';
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
  const locale = useMemo(detectLocale, []);
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
