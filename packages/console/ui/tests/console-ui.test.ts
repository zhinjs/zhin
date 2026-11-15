import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Button,
  CONSOLE_SHARED_MODULE_VERSIONS_KEY,
  CONSOLE_UI_LOCALES,
  CONSOLE_UI_MESSAGES,
  CONSOLE_UI_MODULE_ID,
  CONSOLE_UI_VERSION,
  ConsoleUiI18nProvider,
  EmptyState,
  ErrorAlert,
  PageChromeActions,
  RefreshControl,
  buttonVariants,
  canSubmitConfirm,
  cn,
  confirmErrorMessage,
  createConsoleUiI18n,
  createPageChromeStore,
  formatRefreshTime,
  groupSelectOptions,
  navigableValues,
  refreshIntervalOptions,
  registerConsoleUiSharedModule,
  resolveConsoleUiLocale,
  usePageChrome,
} from '../client/index.js';
import { cn as cnSubpath } from '../client/cn.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const clientRoot = join(packageRoot, 'client');

function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path, pattern);
    return pattern.test(entry.name) ? [path] : [];
  });
}

describe('cn', () => {
  it('joins classes and lets later Tailwind classes win; the ./cn subpath is the same function', () => {
    expect(cn('px-2', false, ['text-sm', { hidden: false, block: true }], 'px-4')).toBe('text-sm block px-4');
    expect(cnSubpath).toBe(cn);
  });
});

describe('Button', () => {
  it('destructive-outline equals the Console outline button with text-destructive (ADR 0063 决策 5)', () => {
    const outlinePlusDestructive = cn(buttonVariants({ variant: 'outline', className: 'text-destructive' }));
    const variant = cn(buttonVariants({ variant: 'destructive-outline' }));
    expect(new Set(variant.split(' '))).toEqual(new Set(outlinePlusDestructive.split(' ')));
  });

  it('keeps the solid destructive variant for confirmation steps', () => {
    expect(buttonVariants({ variant: 'destructive' })).toContain('bg-destructive');
    expect(renderToStaticMarkup(h(Button, { variant: 'destructive-outline' }, '删除'))).toContain('text-destructive');
  });
});

describe('ConsoleUiI18nProvider', () => {
  it('ships zh-CN and en copy for the same keys', () => {
    expect(CONSOLE_UI_LOCALES).toEqual(['zh-CN', 'en']);
    expect(Object.keys(CONSOLE_UI_MESSAGES.en).sort()).toEqual(Object.keys(CONSOLE_UI_MESSAGES['zh-CN']).sort());
    for (const locale of CONSOLE_UI_LOCALES) {
      for (const value of Object.values(CONSOLE_UI_MESSAGES[locale])) expect(value.trim()).not.toBe('');
    }
  });

  it('maps host locales, fills placeholders and applies host overrides', () => {
    expect(resolveConsoleUiLocale('en-US')).toBe('en');
    expect(resolveConsoleUiLocale('zh-TW')).toBe('zh-CN');
    expect(resolveConsoleUiLocale('fr')).toBe('zh-CN');
    expect(resolveConsoleUiLocale(undefined)).toBe('zh-CN');
    const en = createConsoleUiI18n('en', { 'error.retry': 'Try again' });
    expect(en.t('confirm.typeToConfirm', ['db'])).toBe('Type db to confirm:');
    expect(en.t('error.retry')).toBe('Try again');
    expect(createConsoleUiI18n().t('empty.noData')).toBe('暂无数据');
  });

  it('renders zh-CN without a provider and the host locale inside one', () => {
    expect(renderToStaticMarkup(h(EmptyState, { compact: true }))).toContain('暂无数据');
    const english = renderToStaticMarkup(h(ConsoleUiI18nProvider, { locale: 'en' }, h(ErrorAlert, { error: 'x', onRetry: () => undefined, technicalDetail: 'y' })));
    expect(english).toContain('Retry');
    expect(english).toContain('Technical details');
  });

  it('components never read a host i18n or @zhin.js/client', () => {
    for (const file of files(clientRoot, /\.(?:ts|tsx)$/u)) {
      const source = readFileSync(file, 'utf8');
      const where = relative(packageRoot, file);
      expect(source, where).not.toMatch(/from\s+['"]@zhin\.js\/client/u);
      expect(source, where).not.toMatch(/\buseI18n\b|\buseLocale\b|LocalizedText/u);
    }
  });
});

describe('RefreshControl', () => {
  it('formats 「更新于 hh:mm:ss」 and offers manual / 5s / 15s / 30s', () => {
    expect(formatRefreshTime(new Date(2026, 10, 15, 9, 5, 7))).toBe('09:05:07');
    expect(formatRefreshTime(undefined)).toBeNull();
    expect(formatRefreshTime('not a date')).toBeNull();
    expect(refreshIntervalOptions(0)).toEqual([0, 5_000, 15_000, 30_000]);
    expect(refreshIntervalOptions(60_000)).toEqual([0, 5_000, 15_000, 30_000, 60_000]);
    const html = renderToStaticMarkup(h(RefreshControl, { onRefresh: () => undefined, updatedAt: new Date(2026, 10, 15, 9, 30, 15) }));
    expect(html).toContain('更新于 09:30:15');
    expect(html).toContain('手动刷新');
    expect(html).toContain('aria-label="自动刷新间隔"');
    expect(html).toContain('刷新');
  });
});

describe('usePageChrome', () => {
  function Page({ chrome, onHosted }: { chrome: Parameters<typeof usePageChrome>[0]; onHosted: (hosted: boolean) => void }): ReactNode {
    onHosted(usePageChrome(chrome));
    return null;
  }

  it('reports whether a shell is listening', () => {
    let hosted: boolean | undefined;
    renderToStaticMarkup(h(Page, { chrome: {}, onHosted: (value) => { hosted = value; } }));
    expect(hosted).toBe(false);
  });

  it('store keeps the latest chrome and only the latest registration clears it', () => {
    const store = createPageChromeStore();
    const seen: number[] = [];
    store.subscribe(() => seen.push(1));
    const releaseFirst = store.set({ actions: 'a' });
    const releaseSecond = store.set({ actions: 'b' });
    releaseFirst();
    expect(store.get()?.actions).toBe('b');
    releaseSecond();
    expect(store.get()).toBeUndefined();
    expect(seen).toHaveLength(3);
  });

  it('PageChromeActions renders the registered refresh control and actions', () => {
    const store = createPageChromeStore();
    expect(renderToStaticMarkup(h(PageChromeActions, { store }))).toBe('');
    store.set({ actions: h(Button, { variant: 'destructive-outline' }, '移除订阅'), refresh: { onRefresh: () => undefined } });
    const html = renderToStaticMarkup(h(PageChromeActions, { store }));
    expect(html).toContain('移除订阅');
    expect(html).toContain('尚未更新');
  });
});

describe('models moved from the Console', () => {
  it('searchable select groups and navigates options', () => {
    const grouped = groupSelectOptions([
      { value: '', label: '未设置' },
      { value: 'a', label: 'Alpha', group: 'G1' },
      { value: 'b', label: 'Beta', group: 'G2', disabled: true },
    ], 'alp');
    expect(grouped).toEqual([
      { group: null, options: [{ value: '', label: '未设置' }] },
      { group: 'G1', options: [{ value: 'a', label: 'Alpha', group: 'G1' }] },
    ]);
    expect(navigableValues(grouped)).toEqual(['', 'a']);
  });

  it('confirm dialog requires the exact typed name', () => {
    expect(canSubmitConfirm({ loading: false, typed: ' users ', confirmText: 'users' })).toBe(true);
    expect(canSubmitConfirm({ loading: false, typed: 'Users', confirmText: 'users' })).toBe(false);
    expect(canSubmitConfirm({ loading: true, typed: '', confirmText: undefined })).toBe(false);
    expect(confirmErrorMessage(new Error(' boom '))).toBe('boom');
    expect(confirmErrorMessage(42)).toBeNull();
  });
});

describe('shared module registration', () => {
  it('registers the namespace and its version for pagemanager proxies', () => {
    const shared = new Map<string, unknown>();
    const target: Record<string, unknown> = {};
    const namespace = { Button };
    registerConsoleUiSharedModule(namespace, shared, target);
    expect(shared.get(CONSOLE_UI_MODULE_ID)).toBe(namespace);
    const versions = target[CONSOLE_SHARED_MODULE_VERSIONS_KEY] as Map<string, string>;
    expect(versions.get(CONSOLE_UI_MODULE_ID)).toBe(CONSOLE_UI_VERSION);
    registerConsoleUiSharedModule(namespace, shared, target);
    expect(target[CONSOLE_SHARED_MODULE_VERSIONS_KEY]).toBe(versions);
  });
});

describe('styles', () => {
  const tokens = readFileSync(join(clientRoot, 'styles/tokens.css'), 'utf8');
  const defined = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/gu)].map((match) => match[1]));

  it('defines every token the components and component styles read', () => {
    const sources = [
      ...files(join(clientRoot, 'components'), /\.tsx?$/u),
      join(clientRoot, 'styles/components.css'),
      join(clientRoot, 'styles/searchable-select.css'),
      join(clientRoot, 'styles/base.css'),
      join(clientRoot, 'styles/tailwind.config.js'),
    ];
    const missing = new Set<string>();
    for (const file of sources) {
      for (const [, name] of readFileSync(file, 'utf8').matchAll(/var\((--[a-z0-9-]+)/gu)) {
        // Radix sets --radix-*; Tailwind owns --tw-*.
        if (name.startsWith('--radix-') || name.startsWith('--tw-')) continue;
        if (!defined.has(name)) missing.add(`${relative(packageRoot, file)}: ${name}`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('tokens.css keeps the Console values (P1a: no value changes)', () => {
    expect(tokens).toContain('--console-content-max: 90rem;');
    expect(tokens).toContain('--console-control-height: 2.25rem;');
    expect(tokens).toContain('--console-radius-md: 0.625rem;');
    expect(tokens).toMatch(/\.dark \{[\s\S]*--background: var\(--palette-hue\) var\(--surface-chroma\) 5%;/u);
  });
});
