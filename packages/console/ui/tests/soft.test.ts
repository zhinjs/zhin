/**
 * Soft-card components (ADR 0063 D39–D41): markup, accessibility attributes and the pure toast queue.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ActionBar,
  Aurora,
  Banner,
  Button,
  ChangedDot,
  Checkbox,
  Chip,
  ConsoleUiI18nProvider,
  HeroCard,
  IconButton,
  ListCaption,
  ListGroup,
  ListRow,
  NavIcon,
  NavPill,
  RadioGroup,
  RadioGroupItem,
  Segmented,
  StatusDot,
  Stepper,
  Switch,
  TabBar,
  TabBarItem,
  Tabs,
  TabsList,
  TabsTrigger,
  Tile,
  Toast,
  Toaster,
  TOAST_DURATION_MS,
  TOAST_UNDO_DURATION_MS,
  createToastStore,
  toastDuration,
  statusTone,
  useToast,
} from '../client/index.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const render = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const noop = () => undefined;

describe('Tile', () => {
  it('is a decorative round block; tone 1–5 or neutral; sizes 32 / 40 / 48', () => {
    expect(render(h(Tile, null, 'z'))).toBe('<span data-slot="tile" aria-hidden="true" class="console-tile">z</span>');
    const tinted = render(h(Tile, { tone: 2, size: 'lg' }));
    expect(tinted).toContain('data-tone="2"');
    expect(tinted).toContain('data-size="lg"');
    expect(render(h(Tile, { size: 'sm', text: true }, 'T'))).toContain('data-text=""');
    // A labelled tile is not hidden.
    expect(render(h(Tile, { 'aria-label': '插件', role: 'img' }))).not.toContain('aria-hidden');
    const css = readFileSync(join(packageRoot, 'client/styles/soft.css'), 'utf8');
    for (let tone = 1; tone <= 5; tone += 1) {
      expect(css).toContain(`.console-tile[data-tone="${tone}"] { background: hsl(var(--console-tint-${tone})); color: hsl(var(--console-accent-${tone})); }`);
    }
  });
});

describe('Chip', () => {
  it('uses aria-pressed when it toggles; plain chips have none; optional tint', () => {
    expect(render(h(Chip, { pressed: true }, '全部 25'))).toContain('aria-pressed="true"');
    expect(render(h(Chip, { pressed: false, tone: 4 }, '会话'))).toMatch(/data-tone="4"[^>]*aria-pressed="false"/u);
    const plain = render(h(Chip, null, '+ 选会话'));
    expect(plain).not.toContain('aria-pressed');
    expect(plain).toContain('type="button"');
    expect(plain).toContain('console-chip');
  });
});

describe('Segmented', () => {
  it('is a tablist with one selected tab in the tab order', () => {
    const html = render(h(Segmented, { 'aria-label': '时间范围', value: '7d', onValueChange: noop, options: [{ value: 'today', label: '今天' }, { value: '7d', label: '7 天' }, { value: '30d', label: '30 天', disabled: true }] }));
    expect(html).toMatch(/^<div role="tablist" data-slot="segmented" class="console-segmented" aria-label="时间范围">/u);
    expect(html.match(/role="tab"/gu)).toHaveLength(3);
    expect(html).toMatch(/aria-selected="true" tabindex="0"[^>]*>7 天/u);
    expect(html.match(/tabindex="-1"/gu)).toHaveLength(2);
    expect(html).toContain('disabled=""');
  });

  it('a value outside the options leaves the first enabled option focusable', () => {
    const html = render(h(Segmented, { 'aria-label': '范围', value: 'none', onValueChange: noop, options: [{ value: 'a', label: 'A', disabled: true }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }] }));
    expect(html.match(/tabindex="0"/gu)).toHaveLength(1);
    expect(html).toMatch(/tabindex="0"[^>]*>B</u);
    expect(html).not.toContain('aria-selected="true"');
  });

  it('role="radiogroup" for a plain filter: radios with aria-checked, same keys and look', () => {
    const html = render(h(Segmented, { 'aria-label': '筛选', role: 'radiogroup', value: 'b', onValueChange: noop, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }));
    expect(html).toMatch(/^<div role="radiogroup" data-slot="segmented"/u);
    expect(html.match(/role="radio"/gu)).toHaveLength(2);
    expect(html).toMatch(/aria-checked="true" tabindex="0"[^>]*>B/u);
    expect(html).not.toContain('aria-selected');
    expect(readFileSync(join(packageRoot, 'client/styles/soft.css'), 'utf8')).toContain('.console-segment[aria-checked="true"] {');
  });

  it("merges the caller's onKeyDown with the arrow-key handler (the caller runs first and can keep the key)", () => {
    type Key = { key: string; defaultPrevented: boolean; preventDefault: () => void; currentTarget: { querySelectorAll: () => { focus: () => void }[] } };
    const key = (name: string): Key => ({ key: name, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, currentTarget: { querySelectorAll: () => [] } });
    const options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }];
    const changes: string[] = [];
    const seen: string[] = [];
    // Segmented has no hooks: calling it returns its element, whose props are the handlers.
    const element = (Segmented as unknown as (props: object) => { props: { onKeyDown: (event: Key) => void } })({
      'aria-label': 'x', value: 'a', options, onValueChange: (value: string) => changes.push(value),
      onKeyDown: (event: Key) => { seen.push(event.key); if (event.key === 'End') event.preventDefault(); },
    });
    element.props.onKeyDown(key('ArrowRight'));
    element.props.onKeyDown(key('End'));
    expect(seen).toEqual(['ArrowRight', 'End']);
    expect(changes).toEqual(['b']);
    // Outside the options, ArrowLeft starts from the end and ArrowRight from the start.
    const outside = (Segmented as unknown as (props: object) => { props: { onKeyDown: (event: Key) => void } })({ 'aria-label': 'x', value: 'none', options, onValueChange: (value: string) => changes.push(value) });
    outside.props.onKeyDown(key('ArrowLeft'));
    outside.props.onKeyDown(key('ArrowRight'));
    expect(changes).toEqual(['b', 'c', 'a']);
  });

  it('Tabs render the same segmented look (sunken pill, primary selection)', () => {
    const html = render(h(Tabs, { defaultValue: 'a' }, h(TabsList, null, h(TabsTrigger, { value: 'a' }, 'A'), h(TabsTrigger, { value: 'b' }, 'B'))));
    expect(html).toContain('console-segmented');
    expect(html).toContain('console-segment ');
    expect(html).toContain('data-[state=active]:bg-primary');
  });

  it('Tabs keep their natural width; only <Tabs fill> stretches the list and shares it equally', () => {
    const plain = render(h(Tabs, { defaultValue: 'a' }, h(TabsList, null, h(TabsTrigger, { value: 'a' }, 'A'))));
    expect(plain).not.toContain('flex-1');
    expect(plain).not.toMatch(/(?<![\w-])w-full/u);
    expect(plain).not.toContain('data-fill');
    expect(plain).toContain('inline-flex max-w-full');
    const fill = render(h(Tabs, { defaultValue: 'a', fill: true }, h(TabsList, null, h(TabsTrigger, { value: 'a' }, 'A'), h(TabsTrigger, { value: 'b' }, 'B'))));
    expect(fill).toContain('data-fill=""');
    expect(fill.match(/flex-1/gu)).toHaveLength(2);
    expect(fill).toMatch(/role="tablist"[^>]*class="[^"]*(?<![\w-])flex w-full\b/u);
    expect(fill).not.toMatch(/role="tablist"[^>]*class="[^"]*inline-flex/u);
  });
});

describe('Stepper', () => {
  it('two labelled buttons around an output that carries the unit; limits disable the buttons', () => {
    const html = render(h(Stepper, { label: '每人每天上限', value: 20, unit: '次', min: 0, max: 20, onValueChange: noop }));
    expect(html).toContain('role="group" aria-label="每人每天上限"');
    expect(html).toContain('aria-label="减少"');
    expect(html).toContain('aria-label="增加"');
    expect(html).toMatch(/<output id="[^"]+" class="console-stepper-value" aria-live="polite">20 次<\/output>/u);
    // At the limit the button is aria-disabled, not disabled: it keeps the keyboard focus.
    expect(html).toMatch(/aria-label="增加" aria-controls="[^"]+" aria-disabled="true">/u);
    expect(html).not.toContain('disabled=""');
    expect(html).toMatch(/aria-label="减少" aria-controls="[^"]+">/u);
    // The whole stepper off: both buttons disabled (no aria-disabled on top).
    const off = render(h(Stepper, { label: 'x', value: 20, max: 20, disabled: true, onValueChange: noop }));
    expect(off.match(/ disabled=""/gu)).toHaveLength(2);
    expect(off).not.toContain('aria-disabled');
    const css = readFileSync(join(packageRoot, 'client/styles/soft.css'), 'utf8');
    expect(css).toContain('.console-stepper-button[aria-disabled="true"] { opacity: 0.4; cursor: not-allowed; }');
    expect(render(h(ConsoleUiI18nProvider, { locale: 'en' }, h(Stepper, { label: 'x', value: 1, onValueChange: noop })))).toContain('aria-label="Decrease"');
    expect(render(h(Stepper, { label: 'x', value: 60, format: (value: number) => `${value} 秒内`, onValueChange: noop }))).toContain('>60 秒内</output>');
  });
});

describe('StatusDot', () => {
  it('is the StatusBadge: a dot and a word in five tones', () => {
    for (const tone of ['ok', 'warn', 'danger', 'neutral', 'progress'] as const) {
      expect(render(h(StatusDot, { tone }, '在线'))).toBe(`<span class="console-status" data-slot="status" data-status="${tone}" data-tone="${tone}">在线</span>`);
    }
    expect(statusTone('error')).toBe('danger');
    expect(statusTone('pending')).toBe('progress');
    const shell = readFileSync(join(packageRoot, 'client/styles/shell.css'), 'utf8');
    // The progress dot breathes, only without a reduced-motion preference.
    expect(shell).toMatch(/prefers-reduced-motion: no-preference\) \{[\s\S]*\.console-status\[data-tone="progress"\]::before \{ animation: console-pulse/u);
  });
});

describe('Banner', () => {
  it('one state and one action; danger is an alert, the rest a status', () => {
    const warn = render(h(Banner, { tone: 'warn', action: h(Button, { variant: 'white', size: 'sm' }, '去登录') }, 'QQ 主号待登录'));
    expect(warn).toMatch(/^<div role="status" data-slot="banner" data-tone="warn" class="console-banner"><span class="console-banner-text">QQ 主号待登录<\/span><button/u);
    expect(warn).toContain('data-variant="white"');
    expect(render(h(Banner, { tone: 'danger' }, 'rss 加载失败'))).toContain('role="alert"');
    expect(render(h(Banner, null, '有新版本'))).not.toContain('data-tone');
  });
});

describe('Toast', () => {
  it('role="status", one sentence, optional 「撤销」', () => {
    expect(render(h(Toast, null, '已保存'))).toBe('<div role="status" aria-live="polite" data-slot="toast" class="console-toast"><span>已保存</span></div>');
    const undo = render(h(Toast, { onUndo: noop }, '已停用 rss'));
    expect(undo).toContain('>撤销</button>');
    expect(render(h(ConsoleUiI18nProvider, { locale: 'en' }, h(Toast, { onUndo: noop }, 'x')))).toContain('>Undo</button>');
  });

  it('the queue removes a toast after 2.5 s, on dismiss, and keeps the order', () => {
    const timers: { run: () => void; ms: number; cancelled: boolean }[] = [];
    const store = createToastStore((run, ms) => {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return timer;
    }, (handle) => { (handle as { cancelled: boolean }).cancelled = true; });
    const seen: number[] = [];
    store.subscribe((entries) => seen.push(entries.length));
    const first = store.show('已保存');
    const second = store.show('已停用 rss', { onUndo: noop, duration: 6000 });
    expect(TOAST_DURATION_MS).toBe(2500);
    expect(timers.map((timer) => timer.ms)).toEqual([2500, 6000]);
    expect(store.get().map((entry) => entry.message)).toEqual(['已保存', '已停用 rss']);
    timers[0].run();
    expect(store.get().map((entry) => entry.id)).toEqual([second]);
    store.dismiss(second);
    expect(timers[1].cancelled).toBe(true);
    expect(store.get()).toEqual([]);
    store.dismiss(first);
    expect(seen).toEqual([1, 2, 1, 0]);
  });

  it('a toast with 「撤销」 stays at least 5 s', () => {
    expect(TOAST_UNDO_DURATION_MS).toBe(5000);
    expect(toastDuration()).toBe(2500);
    expect(toastDuration({ duration: 1000 })).toBe(1000);
    expect(toastDuration({ onUndo: noop })).toBe(5000);
    expect(toastDuration({ onUndo: noop, duration: 2000 })).toBe(5000);
    expect(toastDuration({ onUndo: noop, duration: 8000 })).toBe(8000);
    const timers: number[] = [];
    const store = createToastStore((_run, ms) => { timers.push(ms); return ms; }, noop);
    store.show('已停用 rss', { onUndo: noop });
    expect(timers).toEqual([5000]);
  });

  it('pause() stops every timer, resume() continues with the time left; toasts shown while paused wait', () => {
    let clock = 0;
    const timers: { run: () => void; ms: number; cancelled: boolean }[] = [];
    const store = createToastStore((run, ms) => {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return timer;
    }, (handle) => { (handle as { cancelled: boolean }).cancelled = true; }, () => clock);
    store.show('已保存');
    clock = 1000;
    store.pause();
    expect(store.isPaused()).toBe(true);
    expect(timers[0].cancelled).toBe(true);
    store.show('已停用 rss', { onUndo: noop });
    expect(timers).toHaveLength(1);
    clock = 60_000;
    expect(store.get()).toHaveLength(2);
    store.resume();
    expect(timers.slice(1).map((timer) => timer.ms)).toEqual([1500, 5000]);
    // Pausing again keeps what is left of each.
    clock = 60_500;
    store.pause();
    store.resume();
    expect(timers.slice(3).map((timer) => timer.ms)).toEqual([1000, 4500]);
    timers[3].run();
    expect(store.get().map((entry) => entry.message)).toEqual(['已停用 rss']);
    store.resume();
    expect(timers).toHaveLength(5);
  });

  it('Toaster hosts the one polite live region; useToast outside one shows nothing and warns once', () => {
    expect(render(h(Toaster, null, 'app'))).toBe('app<div class="console-toaster" data-slot="toaster" aria-live="polite" aria-relevant="additions"></div>');
    const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
    try {
      const ids: number[] = [];
      function Probe() {
        const { toast } = useToast();
        ids.push(toast('x'), toast('y'));
        return null;
      }
      render(h(Probe));
      expect(ids).toEqual([-1, -1]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('outside a <Toaster>');
    } finally {
      warn.mockRestore();
    }
    const source = readFileSync(join(packageRoot, 'client/components/ui/toast.tsx'), 'utf8');
    // A toast inside the toaster has no role of its own (the toaster announces it).
    expect(source).toContain('role={inToaster ? undefined : "status"}');
    expect(source).toMatch(/onPointerEnter=\{[^}]*pointer = true; sync\(\) \}\}/u);
  });
});

describe('HeroCard', () => {
  it('two gradients, ink title, one per page', () => {
    expect(render(h(HeroCard, { title: '运行中', description: '这一页最重要的一件事' }))).toBe('<section data-slot="hero" data-variant="hero" class="console-hero"><h2 class="console-hero-title">运行中</h2><p class="console-hero-description">这一页最重要的一件事</p></section>');
    expect(render(h(HeroCard, { variant: 'hero-2' }))).toContain('data-variant="hero-2"');
    const css = readFileSync(join(packageRoot, 'client/styles/soft.css'), 'utf8');
    expect(css).toContain('background: var(--console-gradient-hero);');
    expect(css).toContain('.console-hero[data-variant="hero-2"] { background: var(--console-gradient-hero-2); }');
  });
});

describe('lists', () => {
  it('ListRow: tile → title + one line → one thing on the right; link, button or static', () => {
    const link = render(h(ListRow, { href: '#t', icon: h(Tile, { tone: 1 }), title: 'Telegram', description: '在线 3 天', end: h(StatusDot, { tone: 'ok' }, '在线'), selected: true }));
    expect(link).toMatch(/^<a data-slot="list-row" data-selected="" aria-current="page" href="#t" class="console-list-row">/u);
    expect(link).toContain('<span class="console-list-row-title">Telegram</span>');
    expect(link).toContain('<span class="console-list-row-description">在线 3 天</span>');
    expect(link).toContain('<span class="console-list-row-end">');
    const button = render(h(ListRow, { title: '更多', plain: true, onClick: noop }));
    expect(button).toMatch(/^<button data-slot="list-row" data-plain="" type="button" class="console-list-row">/u);
    // A selectable button row says whether it is selected; a row given its own aria-current keeps only that.
    expect(render(h(ListRow, { title: 'A', onClick: noop, selected: true }))).toMatch(/^<button data-slot="list-row" data-selected="" aria-pressed="true" type="button"/u);
    expect(render(h(ListRow, { title: 'A', onClick: noop, selected: false }))).toContain('aria-pressed="false"');
    const current = render(h(ListRow, { title: 'A', onClick: noop, selected: true, 'aria-current': 'true' }));
    expect(current).toContain('aria-current="true"');
    expect(current).not.toContain('aria-pressed');
    // A disabled link row does not navigate: no href, aria-disabled, no click handler.
    const disabled = render(h(ListRow, { href: '#t', title: 'Telegram', disabled: true, onClick: noop }));
    expect(disabled).toMatch(/^<a data-slot="list-row" aria-disabled="true" class="console-list-row">/u);
    expect(disabled).not.toContain('href');
    const css = readFileSync(join(packageRoot, 'client/styles/soft.css'), 'utf8');
    expect(css).toContain('a.console-list-row[href]:hover,');
    expect(css).toContain('.console-list-row[aria-current]:not([aria-current="false"]) {');
    const changed = render(h(ListRow, { title: '每步限时', description: '默认 60 秒', changed: true }));
    expect(changed).toMatch(/^<div data-slot="list-row"/u);
    expect(changed).toContain('<span aria-hidden="true" data-slot="changed" class="console-changed"></span>每步限时');
    expect(render(h(ChangedDot))).toBe('<span aria-hidden="true" data-slot="changed" class="console-changed"></span>');
  });

  it('ListGroup and ListCaption; dividers start at the text (68 after a tile, 16 when plain)', () => {
    expect(render(h(ListCaption, null, '已停用 · 2'))).toBe('<h3 data-slot="list-caption" class="console-list-caption">已停用 · 2</h3>');
    expect(render(h(ListCaption, { level: 2 }, 'x'))).toMatch(/^<h2/u);
    expect(render(h(ListGroup, { plain: true }))).toBe('<div data-slot="list-group" data-plain="" class="console-list-group"></div>');
    const css = readFileSync(join(packageRoot, 'client/styles/soft.css'), 'utf8');
    expect(css).toMatch(/\.console-list-row \+ \.console-list-row::before,[\s\S]*?left: 4\.25rem;/u);
    expect(css).toMatch(/\.console-list-group\[data-plain\] \.console-list-row::before,[\s\S]*?\{ left: 1rem; \}/u);
  });
});

describe('navigation', () => {
  it('NavPill is the current page; NavIcon needs a label; TabBar items mark the current page', () => {
    expect(render(h(NavPill, { href: '/plugins' }, '插件'))).toBe('<a data-slot="nav-pill" aria-current="page" class="console-control console-nav-pill" href="/plugins">插件</a>');
    expect(render(h(NavIcon, { href: '/', label: '概览', icon: h('svg') }))).toBe('<a data-slot="nav-icon" aria-label="概览" title="概览" class="console-control console-nav-icon" href="/"><svg></svg></a>');
    const bar = render(h(TabBar, { 'aria-label': '主导航', floating: true }, h(TabBarItem, { href: '/', icon: h('svg'), current: true }, '概览'), h(TabBarItem, { href: '/chat', icon: h('svg') }, '会话')));
    expect(bar).toMatch(/^<nav data-slot="tabbar" data-floating="" class="console-tabbar" aria-label="主导航">/u);
    expect(bar.match(/aria-current="page"/gu)).toHaveLength(1);
  });

  it('IconButton: 44 white round button with a required label; flat and soft variants', () => {
    expect(render(h(IconButton, { 'aria-label': '搜索' }))).toBe('<button type="button" data-slot="icon-button" class="console-control console-icon-button" aria-label="搜索"></button>');
    expect(render(h(IconButton, { 'aria-label': '更多', variant: 'flat' }))).toContain('data-variant="flat"');
  });
});

describe('Aurora and ActionBar', () => {
  it('Aurora is decorative; ActionBar puts the primary button last', () => {
    expect(render(h(Aurora))).toBe('<div aria-hidden="true" data-slot="aurora" class="console-aurora"></div>');
    const bar = render(h(ActionBar, { start: h(Button, { variant: 'text' }, '还原默认'), primary: h(Button, { variant: 'primary' }, '保存') }));
    expect(bar).toMatch(/^<div role="group" data-slot="action-bar" data-floating="" class="console-action-bar console-cq">/u);
    expect(bar.indexOf('还原默认')).toBeLessThan(bar.indexOf('console-action-bar-primary'));
    expect(render(h(ActionBar, { floating: false }))).not.toContain('data-floating');
  });
});

describe('selection controls (CForms)', () => {
  it('Switch 46 × 28 with a primary on-track; Checkbox and Radio use the 22px soft controls', () => {
    const toggle = render(h(Switch, { 'aria-label': '私聊自动回复', checked: true }));
    expect(toggle).toContain('role="switch"');
    expect(toggle).toContain('aria-checked="true"');
    expect(toggle).toContain('console-switch');
    expect(toggle).toContain('data-[state=checked]:bg-primary');
    expect(render(h(Checkbox, { 'aria-label': '文字消息' }))).toContain('console-check');
    expect(render(h(RadioGroup, { defaultValue: 'a' }, h(RadioGroupItem, { value: 'a', 'aria-label': '所有群' })))).toContain('console-radio');
    const css = readFileSync(join(packageRoot, 'client/styles/soft.css'), 'utf8');
    expect(css).toMatch(/\.console-switch \{[\s\S]*?width: var\(--console-size-switch-width\);[\s\S]*?height: var\(--console-size-switch-height\);/u);
  });
});
