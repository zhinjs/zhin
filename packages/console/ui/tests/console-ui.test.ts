import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  BrandMark,
  Button,
  CONSOLE_PRODUCT_NAME,
  CONSOLE_SHARED_MODULE_VERSIONS_KEY,
  CONSOLE_UI_LOCALES,
  CONSOLE_UI_MESSAGES,
  CONSOLE_UI_MODULE_ID,
  CONSOLE_UI_VERSION,
  ConsoleUiI18nProvider,
  EmptyState,
  ErrorAlert,
  PageActions,
  PageChromeActions,
  RefreshControl,
  StatCard,
  buttonVariants,
  canSubmitConfirm,
  cn,
  confirmErrorMessage,
  createConsoleUiI18n,
  createPageChromeStore,
  formatRefreshTime,
  isZeroValue,
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

  const classes = (variant?: Parameters<typeof buttonVariants>[0] extends infer P ? P extends { variant?: infer V } ? V : never : never) =>
    new Set(cn(buttonVariants(variant === undefined ? {} : { variant })).split(' '));

  it('primary is the solid brand button with brand-foreground text (zhinjs/console#125)', () => {
    const primary = classes('primary');
    for (const name of ['bg-brand', 'text-brand-foreground']) expect(primary.has(name), name).toBe(true);
    expect(renderToStaticMarkup(h(Button, { variant: 'primary' }, '保存'))).toContain('bg-brand');
  });

  it('soft is the former default; default stays as its alias and is still the default variant', () => {
    expect(classes('default')).toEqual(classes('soft'));
    expect(classes(undefined)).toEqual(classes('soft'));
    expect(classes('soft').has('bg-primary-action')).toBe(true);
  });

  it('destructive is a ghost (red text, no fill); the solid red is destructive-solid', () => {
    const ghost = classes('destructive');
    expect(ghost.has('text-destructive')).toBe(true);
    expect(ghost.has('bg-destructive')).toBe(false);
    const solid = classes('destructive-solid');
    for (const name of ['bg-destructive', 'text-destructive-foreground']) expect(solid.has(name), name).toBe(true);
  });

  it('solid red appears only in ConfirmDialog; PageAction tone primary is the primary button', () => {
    const users = files(join(clientRoot, 'components'), /\.tsx$/u)
      .filter((file) => !file.endsWith('button.tsx') && readFileSync(file, 'utf8').includes("'destructive-solid'"))
      .map((file) => relative(clientRoot, file));
    expect(users).toEqual(['components/confirm-dialog.tsx']);
    expect(readFileSync(join(clientRoot, 'components/confirm-dialog.tsx'), 'utf8')).toContain("variant === 'destructive' ? 'destructive-solid' : 'primary'");
    const header = renderToStaticMarkup(h(PageActions, { actions: [{ label: '新建', tone: 'primary', onSelect: () => undefined }, { label: '导入', onSelect: () => undefined }] }));
    expect(header.match(/text-brand-foreground/gu)).toHaveLength(1);
  });
});

describe('BrandMark', () => {
  it('renders the favicon shape in brand colors, independent of the palette', () => {
    const mark = renderToStaticMarkup(h(BrandMark, null));
    expect(mark).toContain('role="img"');
    expect(mark).toContain(`aria-label="${CONSOLE_PRODUCT_NAME}"`);
    expect(mark).toContain('fill="hsl(var(--console-brand, 160 78% 69.8%))"');
    expect(mark).toContain('fill="hsl(var(--console-brand-foreground, 160 80% 10%))"');
    expect(mark).not.toMatch(/--primary|--palette/u);
    expect(mark).toContain('data-size="md"');
  });

  it('optionally shows 「Zhin Console」 and takes preset or pixel sizes', () => {
    const named = renderToStaticMarkup(h(BrandMark, { withText: true, size: 'lg' }));
    expect(named).toContain('>Zhin Console</span>');
    expect(named).toContain('aria-hidden="true"');
    expect(named).toContain('data-size="lg"');
    expect(renderToStaticMarkup(h(BrandMark, { size: 48 }))).toContain('style="width:48px;height:48px"');
  });
});

describe('StatCard signal tones', () => {
  it('colors abnormal values only; 0 is a steady state', () => {
    expect(renderToStaticMarkup(h(StatCard, { label: '失败', value: 3, tone: 'danger' }))).toContain('is-danger');
    expect(renderToStaticMarkup(h(StatCard, { label: '失败', value: 0, tone: 'danger' }))).not.toContain('is-danger');
    expect(renderToStaticMarkup(h(StatCard, { label: '待处理', value: '0', tone: 'warning' }))).not.toContain('is-warning');
    expect(isZeroValue('0.0')).toBe(true);
    expect(isZeroValue('0%')).toBe(true);
    expect(isZeroValue('10')).toBe(false);
    expect(isZeroValue(null)).toBe(false);
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
  const tokens = readFileSync(join(clientRoot, 'styles/generated/tokens.css'), 'utf8');
  const defined = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/gu)].map((match) => match[1]));

  it('defines every token the components and component styles read', () => {
    const sources = [
      ...files(join(clientRoot, 'components'), /\.tsx?$/u),
      join(clientRoot, 'styles/components.css'),
      join(clientRoot, 'styles/searchable-select.css'),
      join(clientRoot, 'styles/base.css'),
      join(clientRoot, 'styles/shell.css'),
      join(clientRoot, 'styles/generated/theme.css'),
    ];
    const missing = new Set<string>();
    for (const file of sources) {
      for (const [, name] of readFileSync(file, 'utf8').matchAll(/var\((--[a-z0-9-]+)/gu)) {
        // Radix sets --radix-*; Tailwind owns --tw-*; --grid-min is the Grid component's parameter.
        if (name.startsWith('--radix-') || name.startsWith('--tw-') || name === '--grid-min') continue;
        if (!defined.has(name)) missing.add(`${relative(packageRoot, file)}: ${name}`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('keeps the colors and the deprecated aliases until P4', () => {
    expect(tokens).toMatch(/\.dark \{[\s\S]*--background: var\(--palette-hue\) var\(--surface-chroma\) 5%;/u);
    for (const alias of ['--console-radius-md', '--console-shadow-sm', '--console-space-card', '--console-space-page-x', '--console-control-height-sm', '--radius']) {
      expect(defined.has(alias), alias).toBe(true);
    }
    expect(tokens).toContain('--console-content-max: var(--console-content-data);');
  });
});
