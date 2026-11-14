import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

const nodeRequire = createRequire(import.meta.url);

export type ElementNode = { type?: string | { name?: string }; props?: Record<string, unknown> };

/** 把元素树里的文字（children 以及常见的文字属性）拼起来。 */
export function textOf(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object') {
    const element = node as ElementNode;
    if (element.type === 'style') return '';
    const props = element.props ?? {};
    const own = ['title', 'label', 'message', 'description', 'hint', 'error'].map(key => typeof props[key] === 'string' ? props[key] : '').join('');
    const slots = Object.entries(props).filter(([key, value]) => key !== 'children' && isElementish(value)).map(([, value]) => textOf(value)).join('');
    return own + textOf(props.children) + slots;
  }
  return String(node);
}

const isElement = (value: unknown): boolean => !!value && typeof value === 'object' && 'props' in (value as object) && 'type' in (value as object);
const isElementish = (value: unknown): boolean => isElement(value) || (Array.isArray(value) && value.some(isElementish));

/** 元素本身，加上 children 与其他承载元素的 props（如 `actions`）里的所有子元素。 */
export function allNodes(node: unknown): ElementNode[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(allNodes);
  const props = (node as ElementNode).props ?? {};
  const slots = Object.entries(props).filter(([key, value]) => key === 'children' || isElementish(value)).map(([, value]) => value);
  return [node as ElementNode, ...slots.flatMap(allNodes)];
}

export const isComponent = (node: ElementNode, name: string): boolean => typeof node.type === 'function' && node.type.name === name;

/**
 * 最小 React hooks 运行时：把 TS/TSX 源文件（及其相对导入）转译后用假 hooks 执行，
 * 这样可以在 node 环境里驱动真实的 hook 与事件处理函数，HTTP 边界仍是真实的 remoteApi。
 */
export function createHookEnv() {
  const slots: unknown[] = [];
  let cursor = 0;
  let dirty = false;
  let render!: () => unknown;
  let value: unknown;
  let effects: (() => void)[] = [];
  const same = (a: unknown[], b: unknown[]) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial: unknown) {
      const at = cursor++;
      if (!(at in slots)) slots[at] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [slots[at], (next: unknown) => {
        const v = typeof next === 'function' ? (next as (p: unknown) => unknown)(slots[at]) : next;
        if (!Object.is(v, slots[at])) { slots[at] = v; dirty = true; }
      }];
    },
    /** No providers are mounted by the harness: a context reads its default value. */
    useContext(context: { _currentValue?: unknown }) { return context._currentValue; },
    useRef(initial: unknown) { const at = cursor++; return slots[at] ?? (slots[at] = { current: initial }); },
    useId() { const at = cursor++; return slots[at] ?? (slots[at] = `zk-id-${at}`); },
    useMemo(fn: () => unknown, deps: unknown[]) {
      const at = cursor++;
      const old = slots[at] as { deps: unknown[]; value: unknown } | undefined;
      if (!old || !same(old.deps, deps)) slots[at] = { deps, value: fn() };
      return (slots[at] as { value: unknown }).value;
    },
    useCallback(fn: () => unknown, deps: unknown[]) { return hooks.useMemo(() => fn, deps); },
    useSyncExternalStore(subscribe: (onChange: () => void) => () => void, getSnapshot: () => unknown) {
      const at = cursor++;
      if (!(at in slots)) slots[at] = subscribe(() => { dirty = true; });
      return getSnapshot();
    },
    useEffect(fn: () => (() => void) | void, deps: unknown[]) {
      const at = cursor++;
      const old = slots[at] as { deps: unknown[]; cleanup?: () => void } | undefined;
      if (!old || !same(old.deps, deps)) {
        const slot: { deps: unknown[]; cleanup?: () => void } = { deps, cleanup: old?.cleanup };
        slots[at] = slot;
        effects.push(() => { old?.cleanup?.(); slot.cleanup = fn() || undefined; });
      }
    },
  };

  const cache = new Map<string, Record<string, unknown>>();
  function load(file: string, extraExports: readonly string[] = []): Record<string, (...args: unknown[]) => unknown> {
    const key = `${file}|${extraExports.join(',')}`;
    const hit = cache.get(key);
    if (hit) return hit as Record<string, (...args: unknown[]) => unknown>;
    const module = { exports: {} as Record<string, unknown> };
    cache.set(key, module.exports);
    const source = readFileSync(file, 'utf8') + (extraExports.length ? `\nexport { ${extraExports.join(', ')} };` : '');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const req = (name: string): unknown => {
      if (name === 'react') return { ...nodeRequire('react'), ...hooks };
      if (name.startsWith('.')) {
        const base = resolve(dirname(file), name.replace(/\.js$/u, ''));
        for (const ext of ['.ts', '.tsx']) if (existsSync(base + ext)) return load(base + ext);
        throw new Error(`cannot resolve ${name} from ${file}`);
      }
      return nodeRequire(name);
    };
    new Function('require', 'module', 'exports', compiled)(req, module, module.exports);
    cache.set(key, module.exports);
    return module.exports as Record<string, (...args: unknown[]) => unknown>;
  }

  const flush = () => {
    for (let i = 0; i < 50; i++) {
      dirty = false; cursor = 0; value = render();
      const pending = effects; effects = [];
      pending.forEach(fn => fn());
      if (!dirty) break;
    }
    return value;
  };
  return {
    load,
    mount(fn: () => unknown) { render = fn; return flush(); },
    rerender() { return flush(); },
    async settle() { for (let i = 0; i < 30; i++) { await Promise.resolve(); if (dirty || effects.length) flush(); } return value; },
    tree: () => value,
    unmount() { for (const slot of slots) (slot as { cleanup?: () => void })?.cleanup?.(); },
  };
}
