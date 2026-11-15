import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  CONSOLE_UI_MESSAGES,
  DEFAULT_CONSOLE_UI_LOCALE,
  formatConsoleUiMessage,
  resolveConsoleUiLocale,
  type ConsoleUiLocale,
  type ConsoleUiMessageKey,
  type ConsoleUiMessages,
} from './messages.js';

export {
  CONSOLE_UI_LOCALES,
  CONSOLE_UI_MESSAGES,
  DEFAULT_CONSOLE_UI_LOCALE,
  formatConsoleUiMessage,
  resolveConsoleUiLocale,
  type ConsoleUiLocale,
  type ConsoleUiMessageKey,
  type ConsoleUiMessages,
} from './messages.js';

export interface ConsoleUiI18n {
  readonly locale: ConsoleUiLocale;
  /** Built-in copy for `key` in the current locale (host overrides first), with `{n}` filled from `values`. */
  t(key: ConsoleUiMessageKey, values?: readonly unknown[]): string;
}

export function createConsoleUiI18n(
  locale?: string | null,
  messages?: Partial<ConsoleUiMessages>,
): ConsoleUiI18n {
  const resolved = resolveConsoleUiLocale(locale);
  const table = CONSOLE_UI_MESSAGES[resolved];
  return Object.freeze({
    locale: resolved,
    t(key: ConsoleUiMessageKey, values?: readonly unknown[]) {
      const override = messages?.[key];
      const template = typeof override === 'string' ? override : (table[key] ?? key);
      return formatConsoleUiMessage(template, values);
    },
  });
}

const ConsoleUiI18nContext = createContext<ConsoleUiI18n>(createConsoleUiI18n(DEFAULT_CONSOLE_UI_LOCALE));

export interface ConsoleUiI18nProviderProps {
  /** Current host locale (any BCP 47 tag; `zh*` → zh-CN, `en*` → en, otherwise zh-CN). */
  readonly locale?: string | null;
  /** Host overrides for the current locale; missing keys fall back to the built-in copy. */
  readonly messages?: Partial<ConsoleUiMessages>;
  readonly children?: ReactNode;
}

/**
 * Language and copy for every `@zhin.js/console-ui` component. Components never read the host's
 * own i18n; without a provider they render the zh-CN defaults.
 */
export function ConsoleUiI18nProvider({ locale, messages, children }: ConsoleUiI18nProviderProps) {
  const value = useMemo(() => createConsoleUiI18n(locale, messages), [locale, messages]);
  return <ConsoleUiI18nContext.Provider value={value}>{children}</ConsoleUiI18nContext.Provider>;
}

export function useConsoleUiI18n(): ConsoleUiI18n {
  return useContext(ConsoleUiI18nContext);
}

/** Renders one built-in message; for places that cannot call the hook (e.g. inside forwardRef bodies shared with class components). */
export function ConsoleUiText({ id, values }: { readonly id: ConsoleUiMessageKey; readonly values?: readonly unknown[] }) {
  const { t } = useConsoleUiI18n();
  return <>{t(id, values)}</>;
}
