import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  BrandMark,
  Button,
  CONSOLE_ICON_SIZE,
  CONSOLE_ICON_STROKE_WIDTH,
  CodeText,
  DateField,
  DateTimeField,
  EMPTY_ILLUSTRATIONS,
  EmptyIllustration,
  InlineCode,
  Input,
  SearchableSelectField,
  SelectTrigger,
  Select,
  Textarea,
  addMonths,
  calendarMonth,
  formatDateTimeValue,
  parseDateTimeValue,
  parseDateValue,
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

  it('primary is the solid black / white pill (soft cards D39), not the brand colour', () => {
    const primary = classes('primary');
    for (const name of ['bg-primary', 'text-primary-foreground', 'hover:bg-primary-hover', 'console-button']) expect(primary.has(name), name).toBe(true);
    expect(primary.has('bg-brand')).toBe(false);
    const html = renderToStaticMarkup(h(Button, { variant: 'primary' }, '保存'));
    expect(html).toContain('data-variant="primary"');
    expect(html).toContain('data-size="default"');
  });

  it('soft is the default variant and looks like secondary (sunken); the `default` alias was removed in ADR 0063 P4', () => {
    expect(classes(undefined)).toEqual(classes('soft'));
    expect(classes('soft')).toEqual(classes('secondary'));
    expect(classes('default' as never).has('bg-sunken')).toBe(false);
    expect(classes('soft').has('bg-sunken')).toBe(true);
    expect(classes('white').has('shadow-e1')).toBe(true);
    for (const variant of ['text', 'link'] as const) expect(classes(variant).has('bg-transparent'), variant).toBe(true);
  });

  it('sizes: 48 default, 36 sm; old size names still render', () => {
    const size = (value: 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm') => new Set(cn(buttonVariants({ size: value })).split(' '));
    expect(size('default').has('h-control')).toBe(true);
    expect(size('lg').has('h-control')).toBe(true);
    expect(size('sm').has('h-control-compact')).toBe(true);
    expect(size('icon').has('size-control')).toBe(true);
    expect(size('icon-sm').has('size-control-compact')).toBe(true);
  });

  it('loading keeps the label (and width), shows a spinner and marks the button busy', () => {
    const html = renderToStaticMarkup(h(Button, { loading: true }, '保存'));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('console-button-spinner');
    expect(html).toContain('保存');
    expect(html).not.toContain('disabled=""');
    expect(renderToStaticMarkup(h(Button, null, '保存'))).not.toContain('aria-busy');
  });

  it('destructive and danger-text are red text without a fill; the solid red is destructive-solid (alias danger)', () => {
    for (const variant of ['destructive', 'danger-text'] as const) {
      const ghost = classes(variant);
      expect(ghost.has('text-danger'), variant).toBe(true);
      expect(ghost.has('bg-danger-solid'), variant).toBe(false);
    }
    const solid = classes('destructive-solid');
    for (const name of ['bg-danger-solid', 'text-on-danger-solid']) expect(solid.has(name), name).toBe(true);
    expect(classes('danger')).toEqual(solid);
  });

  it('solid red appears only in ConfirmDialog; PageAction tone primary is the primary button', () => {
    const users = files(join(clientRoot, 'components'), /\.tsx$/u)
      .filter((file) => !file.endsWith('button.tsx') && /'destructive-solid'|variant=["']danger["']|variant: ["']danger["']/u.test(readFileSync(file, 'utf8')))
      .map((file) => relative(clientRoot, file));
    expect(users).toEqual(['components/confirm-dialog.tsx']);
    expect(readFileSync(join(clientRoot, 'components/confirm-dialog.tsx'), 'utf8')).toContain("variant === 'destructive' ? 'destructive-solid' : 'primary'");
    const header = renderToStaticMarkup(h(PageActions, { actions: [{ label: '新建', tone: 'primary', onSelect: () => undefined }, { label: '导入', onSelect: () => undefined }] }));
    expect(header.match(/data-variant="primary"/gu)).toHaveLength(1);
    expect(header.match(/data-variant="secondary"/gu)).toHaveLength(1);
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
    expect(isZeroValue(' 0 % ')).toBe(true);
    expect(isZeroValue('0' + '\t'.repeat(50_000) + 'x')).toBe(false);
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
    expect(createConsoleUiI18n().t('empty.noData')).toBe('这里还没有内容');
  });

  it('renders zh-CN without a provider and the host locale inside one', () => {
    expect(renderToStaticMarkup(h(EmptyState, { compact: true }))).toContain('这里还没有内容');
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

  it('maps the shadcn names onto the soft-card palette on every theme root; the deprecated aliases are gone (ADR 0063 P4)', () => {
    expect(tokens).toContain(':root, .light, .dark, [data-theme="light"], [data-theme="dark"], [data-theme="system"] {\n    --background: var(--console-bg);');
    expect(tokens).toMatch(/\.dark, \[data-theme="dark"\] \{\n {4}color-scheme: dark;[\s\S]*--console-surface: 15 7\.69% 10\.2%;/u);
    // Without any theme the page is light (as before 1.3.0); following the system is opt-in (D38).
    expect(tokens).toMatch(/@media \(prefers-color-scheme: dark\) \{\n {4}\[data-theme="system"\] \{\n {6}color-scheme: dark;/u);
    expect(tokens).not.toContain(':root:not(');
    for (const block of tokens.matchAll(/@media \(prefers-color-scheme: dark\) \{\n {4}([^{]+) \{/gu)) expect(block[1]).toBe('[data-theme="system"]');
    expect(tokens).not.toContain('data-palette="');
    for (const alias of ['--console-radius-md', '--console-shadow-sm', '--console-shadow-ring', '--console-space-card', '--console-space-page-x', '--console-control-height-sm', '--console-duration-fast', '--radius']) {
      expect(defined.has(alias), alias).toBe(false);
    }
    expect(tokens).toContain('--console-content-max: var(--console-content-data);');
  });
});

describe('EmptyState (ADR 0063 D28)', () => {
  it('draws seven 64px line-art illustrations: one 1.5px stroke, currentColor, no fill', () => {
    expect([...EMPTY_ILLUSTRATIONS]).toEqual(['messages', 'tasks', 'logs', 'table', 'record', 'not-found', 'generic']);
    for (const name of EMPTY_ILLUSTRATIONS) {
      const svg = renderToStaticMarkup(h(EmptyIllustration, { name }));
      expect(svg).toContain('viewBox="0 0 64 64"');
      expect(svg).toContain('stroke="currentColor"');
      expect(svg).toContain('stroke-width="1.5"');
      expect(svg).toContain('fill="none"');
      expect(svg).toContain('aria-hidden="true"');
      expect(svg, name).not.toMatch(/fill="(?!none)/u);
      expect(svg, name).not.toMatch(/stroke="(?!currentColor)/u);
    }
  });

  it('illustration + its default sentence + one soft or primary action; no isolated 「暂无数据」', () => {
    const html = renderToStaticMarkup(h(EmptyState, { illustration: 'tasks', action: { label: '新建定时任务', variant: 'primary' } }));
    expect(html).toContain('data-illustration="tasks"');
    expect(html).toContain('还没有任务');
    expect(html).toContain('data-variant="primary"');
    expect(html).toContain('新建定时任务');
    expect(renderToStaticMarkup(h(EmptyState, { illustration: 'not-found', action: { label: '返回首页', href: '/' } }))).toMatch(/<a [^>]*href="\/"[^>]*>返回首页<\/a>/u);
    expect(renderToStaticMarkup(h(EmptyState, { action: { label: '刷新' } }))).toContain('data-variant="soft"');
    const titled = renderToStaticMarkup(h(EmptyState, { title: '没有记录' }));
    expect(titled).toContain('没有记录');
    expect(titled).not.toContain('这里还没有内容');
    expect(renderToStaticMarkup(h(ConsoleUiI18nProvider, { locale: 'en' }, h(EmptyState, { illustration: 'messages' })))).toContain('No messages yet');
  });

  it('without an illustration puts the icon in a 48 tile (soft cards D41); presets render below the action', () => {
    const Icon = (props: Record<string, unknown>) => h('svg', { ...props, 'data-icon': '' });
    const html = renderToStaticMarkup(h(EmptyState, { icon: Icon as never, title: '没有日志' }));
    expect(html).toContain('console-empty-tile');
    expect(html).toContain('console-empty-icon');
    expect(html).not.toContain('opacity-30');
    const presets = renderToStaticMarkup(h(EmptyState, { title: '没有任务', action: { label: '新建' }, presets: h('span', null, '每日天气') }));
    expect(presets).toMatch(/console-empty-action[\s\S]*console-empty-presets[^>]*><span>每日天气/u);
  });
});

describe('ghost controls (ADR 0063 D29)', () => {
  it('Input, Textarea, SelectTrigger and SearchableSelectField take variant="ghost"', () => {
    // The look lives in the console-field class (48 tall, radius 14, control border); ghost is data-variant.
    const input = renderToStaticMarkup(h(Input, { variant: 'ghost', 'aria-label': 'x' }));
    expect(input).toContain('data-variant="ghost"');
    expect(input).toContain('console-field');
    expect(input).toContain('h-control');
    const plain = renderToStaticMarkup(h(Input, { 'aria-label': 'x' }));
    expect(plain).toContain('console-field');
    expect(plain).not.toContain('data-variant');
    expect(renderToStaticMarkup(h(Textarea, { variant: 'ghost' }))).toContain('data-variant="ghost"');
    expect(renderToStaticMarkup(h(Select, null, h(SelectTrigger, { variant: 'ghost' }, 'x')))).toMatch(/data-variant="ghost"[^>]*console-field|console-field[^>]*data-variant="ghost"/u);
    const css = readFileSync(join(clientRoot, 'styles/components.css'), 'utf8');
    expect(css).toMatch(/\.console-field\[data-variant="ghost"\] \{ border-color: transparent; background: transparent; \}/u);
    expect(css).toMatch(/\.console-field\[aria-invalid="true"\]/u);
    expect(renderToStaticMarkup(h(Input, { 'aria-invalid': true, 'aria-label': 'x' }))).toContain('aria-invalid="true"');
    expect(renderToStaticMarkup(h(SearchableSelectField, { variant: 'ghost', options: [], value: '', onValueChange: () => undefined }))).toContain('data-variant="ghost"');
  });
});

describe('DateField / DateTimeField (ADR 0063 D29)', () => {
  it('parses and formats ISO values in local time', () => {
    expect(parseDateValue('2026-02-29')).toBeNull();
    expect(parseDateValue('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
    expect(parseDateValue('2026-11-16T09:30')).toEqual({ year: 2026, month: 11, day: 16 });
    expect(parseDateValue('')).toBeNull();
    expect(parseDateValue('16/11/2026')).toBeNull();
    expect(parseDateTimeValue('2026-11-16T24:00')).toBeNull();
    expect(parseDateTimeValue('2026-11-16')).toMatchObject({ hour: 0, minute: 0 });
    expect(parseDateTimeValue('2026-11-16T09:30:15.250')).toMatchObject({ day: 16, hour: 9, minute: 30 });
    const zoned = new Date('2026-11-16T01:30:00Z');
    expect(parseDateTimeValue('2026-11-16T01:30:00Z')).toMatchObject({ hour: zoned.getHours(), minute: zoned.getMinutes() });
    expect(formatDateTimeValue({ year: 2026, month: 1, day: 5, hour: 7, minute: 3 })).toBe('2026-01-05T07:03');
    expect(parseDateValue(`2026-11-16${' '.repeat(50000)}x`)).toBeNull();
  });

  it('builds six-week months and clamps month steps', () => {
    const weeks = calendarMonth(2026, 11, 1);
    expect(weeks).toHaveLength(6);
    expect(weeks[0][0]).toEqual({ year: 2026, month: 10, day: 26 });
    expect(calendarMonth(2026, 11, 0)[0][0]).toEqual({ year: 2026, month: 11, day: 1 });
    expect(addMonths({ year: 2026, month: 1, day: 31 }, 1)).toEqual({ year: 2026, month: 2, day: 28 });
    expect(addMonths({ year: 2026, month: 1, day: 15 }, -13)).toEqual({ year: 2024, month: 12, day: 15 });
  });

  it('renders a trigger with the value, a clear button and the placeholder when empty', () => {
    const filled = renderToStaticMarkup(h(DateTimeField, { 'aria-label': '开始时间', value: '2026-11-16T09:30', onValueChange: () => undefined }));
    expect(filled).toContain('2026-11-16 09:30');
    expect(filled).toContain('aria-label="清除"');
    const empty = renderToStaticMarkup(h(DateField, { 'aria-label': '日期', value: '', onValueChange: () => undefined, variant: 'ghost' }));
    expect(empty).toContain('选择日期');
    expect(empty).toContain('data-variant="ghost"');
    expect(empty).not.toContain('aria-label="清除"');
  });
});

describe('icons and short identifiers (ADR 0063 D30, D31)', () => {
  it('every lucide icon in the library uses strokeWidth 1.75', () => {
    expect(CONSOLE_ICON_STROKE_WIDTH).toBe(1.75);
    expect(CONSOLE_ICON_SIZE).toEqual({ control: 16, nav: 18 });
    let checked = 0;
    for (const file of files(clientRoot, /\.tsx$/u)) {
      const source = readFileSync(file, 'utf8');
      const icons = [...source.matchAll(/import \{([^}]+)\} from ['"]lucide-react['"]/gu)]
        .flatMap((match) => match[1].split(',').map((name) => name.trim()).filter((name) => name && !name.startsWith('type ')));
      for (const name of [...icons, 'Icon']) {
        for (const tag of source.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gu'))) {
          checked += 1;
          expect(tag[0], relative(packageRoot, file)).toMatch(/strokeWidth=\{(?:CONSOLE_ICON_STROKE_WIDTH|1\.5)\}/u);
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('InlineCode and CodeText: monospace class, light fill or none, no border', () => {
    expect(renderToStaticMarkup(h(InlineCode, null, 'rss.status'))).toBe('<code data-slot="code" class="console-code">rss.status</code>');
    expect(renderToStaticMarkup(h(InlineCode, { tone: 'plain' }, 'id'))).toContain('data-tone="plain"');
    expect(renderToStaticMarkup(h(CodeText, null, 'x'))).toContain('console-code console-code-text');
    const css = readFileSync(join(clientRoot, 'styles/components.css'), 'utf8');
    const rule = /\.console-code \{([^}]*)\}/u.exec(css)?.[1] ?? '';
    expect(rule).toContain('var(--console-font-mono)');
    expect(rule).not.toMatch(/\bborder:/u);
  });
});
