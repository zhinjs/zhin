import * as path from "path";
import * as fs from "fs";
import * as vm from "vm";

export type Dict<T = any> = Record<string, T>;

export function getValueWithRuntime(template: string, ctx: Dict) {
  return evaluate(template, ctx);
}

/**
 * Property names that enable prototype-chain escapes.
 * Blocked at the Proxy level so that no form of access (dot notation,
 * bracket notation, computed property, string concatenation) can bypass it.
 */
const BLOCKED_PROTO_PROPS: ReadonlySet<string | symbol> = new Set([
  'constructor',
  '__proto__',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
]);

const proxyCache = new WeakMap<object, object>();

/**
 * Wrap a host value in a Proxy that structurally prevents prototype-chain access.
 * Intercepts ALL property-access vectors: dot/bracket notation, string concatenation,
 * Reflect.get, Reflect.getOwnPropertyDescriptor, Object.getOwnPropertyDescriptor,
 * Object.getPrototypeOf, etc.
 */
function createSafeProxy<T>(value: T): T {
  if (value === null || value === undefined) return value;
  const type = typeof value;
  if (type !== 'object' && type !== 'function') return value;

  const obj = value as object;
  const cached = proxyCache.get(obj);
  if (cached) return cached as T;

  const handler: ProxyHandler<any> = {
    get(target, prop) {
      if (BLOCKED_PROTO_PROPS.has(prop)) return undefined;
      return createSafeProxy(Reflect.get(target, prop));
    },
    has(target, prop) {
      if (BLOCKED_PROTO_PROPS.has(prop)) return false;
      return Reflect.has(target, prop);
    },
    getPrototypeOf() {
      return null;
    },
    setPrototypeOf() {
      return false;
    },
    getOwnPropertyDescriptor(target, prop) {
      const desc = Reflect.getOwnPropertyDescriptor(target, prop);
      if (!desc) return desc;
      if (BLOCKED_PROTO_PROPS.has(prop)) {
        // Non-configurable own properties must still be reported (Proxy invariant),
        // but we neutralize their values to prevent escape.
        if ('value' in desc) desc.value = undefined;
        if (desc.get) desc.get = () => undefined;
        return desc;
      }
      // Wrap descriptor values so leaked references are also proxied.
      if ('value' in desc) desc.value = createSafeProxy(desc.value);
      if (desc.get) {
        const originalGet = desc.get;
        desc.get = function(this: any) { return createSafeProxy(originalGet.call(target)); };
      }
      return desc;
    },
    ownKeys(target) {
      // Don't filter: non-configurable own props (e.g. Function.prototype)
      // MUST appear per Proxy invariant. The get/getOwnPropertyDescriptor traps
      // already neutralize blocked property values.
      return Reflect.ownKeys(target);
    },
    defineProperty(_target, prop) {
      // Prevent defining/redefining blocked properties on the proxy.
      if (BLOCKED_PROTO_PROPS.has(prop)) return false;
      return false; // Read-only proxy: disallow all mutations.
    },
  };

  if (type === 'function') {
    handler.apply = (target, thisArg, args) => Reflect.apply(target, thisArg, args);
  }

  const proxy = new Proxy(obj, handler) as T;
  proxyCache.set(obj, proxy as object);
  return proxy;
}

/**
 * Evaluate a single expression in a sandboxed vm context.
 * Unlike `execute`, does NOT wrap in IIFE — the expression value is returned directly.
 * Host objects are wrapped in Proxy to structurally prevent prototype-chain escapes.
 */
export const evaluate = <S extends Record<string, unknown>, T = unknown>(exp: string, context: S): T | undefined => {
  const script = getOrCompileScript(exp);
  if (!script) return undefined;

  try {
    return script.runInNewContext(buildSandbox(context), { timeout: 200 }) as T;
  } catch {
    return undefined;
  }
};

const MAX_EVAL_CACHE_SIZE = 1000;
const scriptCache = new Map<string, vm.Script>();

function getOrCompileScript(code: string): vm.Script | null {
  let script = scriptCache.get(code);
  if (script) return script;
  try {
    script = new vm.Script(code);
  } catch {
    return null;
  }
  if (scriptCache.size >= MAX_EVAL_CACHE_SIZE) {
    const oldest = scriptCache.keys().next().value;
    if (oldest !== undefined) scriptCache.delete(oldest);
  }
  scriptCache.set(code, script);
  return script;
}

/**
 * Build a prototype-less sandbox for vm.runInNewContext.
 * Uses Object.create(null) for the sandbox itself (blocks `this.constructor`),
 * and wraps all host context values in Proxy (blocks `obj.constructor`,
 * `obj['__proto__']`, `Object.getPrototypeOf(obj)`, etc.).
 */
function buildSandbox<S extends Record<string, unknown>>(context: S): Record<string, unknown> {
  const sandbox: Record<string, unknown> = Object.create(null);

  for (const [key, value] of Object.entries(context)) {
    sandbox[key] = createSafeProxy(value);
  }

  const safeProcess: Record<string, unknown> = Object.create(null);
  safeProcess.version = process.version;
  safeProcess.platform = process.platform;
  safeProcess.arch = process.arch;
  safeProcess.pid = process.pid;
  safeProcess.ppid = process.ppid;

  const safeVersions: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(process.versions)) {
    safeVersions[k] = v;
  }
  safeProcess.versions = safeVersions;

  sandbox.process = safeProcess;
  sandbox.global = undefined;
  sandbox.globalThis = undefined;
  sandbox.Buffer = undefined;
  sandbox.crypto = undefined;
  sandbox.require = undefined;
  sandbox.import = undefined;
  sandbox.__dirname = undefined;
  sandbox.__filename = undefined;
  sandbox.Bun = undefined;
  sandbox.Deno = undefined;

  return sandbox;
}

/**
 * Execute a code block in a sandboxed vm context.
 * Supports `return` statements by wrapping in an IIFE.
 * Host objects are wrapped in Proxy to structurally prevent prototype-chain escapes.
 * Throws on compilation or runtime errors.
 */
export const execute = <S extends Record<string, unknown>, T = unknown>(code: string, context: S): T => {
  const wrapped = `(function(){${code}})()`;
  const script = getOrCompileScript(wrapped);
  if (!script) throw new SyntaxError(`Failed to compile: ${code.slice(0, 80)}`);

  return script.runInNewContext(buildSandbox(context), { timeout: 200 }) as T;
};

export function clearEvalCache(): void {
  scriptCache.clear();
}

export function getEvalCacheStats(): { size: number; maxSize: number } {
  return {
    size: scriptCache.size,
    maxSize: MAX_EVAL_CACHE_SIZE,
  };
}
export function compiler(template: string, ctx: Dict) {
  const matched = [...template.matchAll(/\${([^}]*?)}/g)];
  for (const item of matched) {
    const tpl = item[1];
    const raw = getValueWithRuntime(tpl, ctx);
    const value = typeof raw === 'string' ? raw : (raw == null ? 'undefined' : JSON.stringify(raw, null, 2));
    template = template.replace(`\${${item[1]}}`, value);
  }
  return template;
}

export function remove<T>(list: T[], fn: (item: T) => boolean): void;
export function remove<T>(list: T[], item: T): void;
export function remove<T>(list: T[], arg: T | ((item: T) => boolean)) {
  const index =
    typeof arg === "function" &&
      !list.every((item) => typeof item === "function")
      ? list.findIndex(arg as (item: T) => boolean)
      : list.indexOf(arg as T);
  if (index !== -1) list.splice(index, 1);
}
export function isEmpty<T>(item: T) {
  if (Array.isArray(item)) return item.length === 0;
  if (typeof item === "object") {
    if (!item) return true;
    return Reflect.ownKeys(item).length === 0;
  }
  return false;
}

export namespace Time {
  export const millisecond = 1;
  export const second = 1000;
  export const minute = second * 60;
  export const hour = minute * 60;
  export const day = hour * 24;
  export const week = day * 7;

  let timezoneOffset = new Date().getTimezoneOffset();

  export function setTimezoneOffset(offset: number) {
    timezoneOffset = offset;
  }

  export function getTimezoneOffset() {
    return timezoneOffset;
  }

  export function getDateNumber(
    date: number | Date = new Date(),
    offset?: number
  ) {
    if (typeof date === "number") date = new Date(date);
    if (offset === undefined) offset = timezoneOffset;
    return Math.floor((date.valueOf() / minute - offset) / 1440);
  }

  export function fromDateNumber(value: number, offset?: number) {
    const date = new Date(value * day);
    if (offset === undefined) offset = timezoneOffset;
    return new Date(+date + offset * minute);
  }

  const numeric = /\d+(?:\.\d+)?/.source;
  const timeRegExp = new RegExp(
    `^${[
      "w(?:eek(?:s)?)?",
      "d(?:ay(?:s)?)?",
      "h(?:our(?:s)?)?",
      "m(?:in(?:ute)?(?:s)?)?",
      "s(?:ec(?:ond)?(?:s)?)?",
    ]
      .map((unit) => `(${numeric}${unit})?`)
      .join("")}$`
  );

  export function parseTime(source: string) {
    const capture = timeRegExp.exec(source);
    if (!capture) return 0;
    return (
      (parseFloat(capture[1]) * week || 0) +
      (parseFloat(capture[2]) * day || 0) +
      (parseFloat(capture[3]) * hour || 0) +
      (parseFloat(capture[4]) * minute || 0) +
      (parseFloat(capture[5]) * second || 0)
    );
  }

  export function parseDate(date: string) {
    const parsed = parseTime(date);
    let dateInput: string | number = date;
    if (parsed) {
      dateInput = Date.now() + parsed;
    } else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) {
      dateInput = `${new Date().toLocaleDateString()}-${date}`;
    } else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) {
      dateInput = `${new Date().getFullYear()}-${date}`;
    }
    return dateInput ? new Date(dateInput) : new Date();
  }

  export function formatTimeShort(ms: number) {
    const abs = Math.abs(ms);
    if (abs >= day - hour / 2) {
      return Math.round(ms / day) + "d";
    } else if (abs >= hour - minute / 2) {
      return Math.round(ms / hour) + "h";
    } else if (abs >= minute - second / 2) {
      return Math.round(ms / minute) + "m";
    } else if (abs >= second) {
      return Math.round(ms / second) + "s";
    }
    return ms + "ms";
  }

  export function formatTime(ms: number) {
    let result: string;
    if (ms >= day - hour / 2) {
      ms += hour / 2;
      result = Math.floor(ms / day) + " 天";
      if (ms % day > hour) {
        result += ` ${Math.floor((ms % day) / hour)} 小时`;
      }
    } else if (ms >= hour - minute / 2) {
      ms += minute / 2;
      result = Math.floor(ms / hour) + " 小时";
      if (ms % hour > minute) {
        result += ` ${Math.floor((ms % hour) / minute)} 分钟`;
      }
    } else if (ms >= minute - second / 2) {
      ms += second / 2;
      result = Math.floor(ms / minute) + " 分钟";
      if (ms % minute > second) {
        result += ` ${Math.floor((ms % minute) / second)} 秒`;
      }
    } else {
      result = Math.round(ms / second) + " 秒";
    }
    return result;
  }

  const dayMap = ["日", "一", "二", "三", "四", "五", "六"];

  function toDigits(source: number, length = 2) {
    return source.toString().padStart(length, "0");
  }

  export function template(template: string, time = new Date()) {
    return template
      .replace("yyyy", time.getFullYear().toString())
      .replace("yy", time.getFullYear().toString().slice(2))
      .replace("MM", toDigits(time.getMonth() + 1))
      .replace("dd", toDigits(time.getDate()))
      .replace("hh", toDigits(time.getHours()))
      .replace("mm", toDigits(time.getMinutes()))
      .replace("ss", toDigits(time.getSeconds()))
      .replace("SSS", toDigits(time.getMilliseconds(), 3));
  }

  function toHourMinute(time: Date) {
    return `${toDigits(time.getHours())}:${toDigits(time.getMinutes())}`;
  }

  export function formatTimeInterval(time: Date, interval?: number) {
    if (!interval) {
      return template("yyyy-MM-dd hh:mm:ss", time);
    } else if (interval === day) {
      return `每天 ${toHourMinute(time)}`;
    } else if (interval === week) {
      return `每周${dayMap[time.getDay()]} ${toHourMinute(time)}`;
    } else {
      return `${template("yyyy-MM-dd hh:mm:ss", time)} 起每隔 ${formatTime(
        interval
      )}`;
    }
  }
}
export const supportedPluginExtensions = [
  ".js",
  ".ts",
  ".mjs",
  ".cjs",
  ".jsx",
  ".tsx",
  "",
];

/** 与 Node 行为对齐：从 NODE_OPTIONS / process.execArgv 收集 `--conditions`（如 development）。 */
function collectNodeExportConditions(): string[] {
  const out: string[] = [];
  const pushCsv = (s: string) => {
    for (const part of s.split(',')) {
      const t = part.trim();
      if (t) out.push(t);
    }
  };
  const scanTokens = (tokens: string[]) => {
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === '--conditions' || t === '-C') {
        const v = tokens[i + 1];
        if (v) pushCsv(v);
        i++;
      } else if (t.startsWith('--conditions=')) {
        pushCsv(t.slice('--conditions='.length));
      }
    }
  };
  scanTokens(process.execArgv);
  const no = process.env.NODE_OPTIONS;
  if (no) scanTokens(no.split(/\s+/).filter(Boolean));
  return [...new Set(out)];
}

const EXPORT_KEYS_SKIP_RUNTIME = new Set(['types', 'typings']);

/**
 * 在 package.json `exports["."]` 的条件对象中选一个可执行入口（相对包根的路径）。
 * 优先匹配 Node 传入的 custom conditions，再按 import/require 等与 type 字段选择。
 */
function pickConditionalExportTarget(
  cond: Record<string, unknown>,
  pkgType?: string,
): string | undefined {
  const custom = collectNodeExportConditions();
  for (const key of custom) {
    const v = cond[key];
    if (typeof v === 'string' && (v.startsWith('./') || v.startsWith('../'))) return v;
  }
  const preferImportFirst = pkgType === 'module';
  const chain = preferImportFirst
    ? (['import', 'module', 'require', 'node', 'default'] as const)
    : (['require', 'import', 'module', 'node', 'default'] as const);
  for (const key of chain) {
    const v = cond[key];
    if (typeof v === 'string' && (v.startsWith('./') || v.startsWith('../'))) return v;
  }
  for (const [k, v] of Object.entries(cond)) {
    if (EXPORT_KEYS_SKIP_RUNTIME.has(k)) continue;
    if (typeof v === 'string' && (v.startsWith('./') || v.startsWith('../'))) return v;
  }
  return undefined;
}

/** 将 exports 字段的某个值（字符串或条件表，或一层嵌套条件表）解析为相对包根的子路径。 */
function exportSurfaceToRelativePath(surface: unknown, pkgType?: string): string | undefined {
  if (typeof surface === 'string' && (surface.startsWith('./') || surface.startsWith('../'))) {
    return surface;
  }
  if (!surface || typeof surface !== 'object' || Array.isArray(surface)) return undefined;
  const table = surface as Record<string, unknown>;
  const direct = pickConditionalExportTarget(table, pkgType);
  if (direct) return direct;
  // 一层嵌套：如 { "node": { "import": "./x.js" } }
  for (const val of Object.values(table)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const inner = pickConditionalExportTarget(val as Record<string, unknown>, pkgType);
      if (inner) return inner;
    }
  }
  return undefined;
}

/**
 * 根据 package.json 的 `exports` / `main` 得到包入口的绝对路径（再交给 resolveEntry 做扩展名解析）。
 */
function resolvePackageJsonEntryFile(packageDir: string, pkgJson: Record<string, unknown>): string {
  const main =
    (typeof pkgJson.main === 'string' && pkgJson.main.length > 0 ? pkgJson.main : null) ?? 'index.js';
  const exp = pkgJson.exports;
  if (exp == null) {
    return path.resolve(packageDir, main);
  }
  let surface: unknown;
  if (typeof exp === 'string') {
    surface = exp;
  } else if (typeof exp === 'object' && !Array.isArray(exp)) {
    const map = exp as Record<string, unknown>;
    surface = map['.'];
    if (surface === undefined && typeof map['./'] === 'string') {
      surface = map['./'];
    }
  } else {
    return path.resolve(packageDir, main);
  }
  const rel = exportSurfaceToRelativePath(surface, pkgJson.type as string | undefined);
  if (!rel) {
    return path.resolve(packageDir, main);
  }
  return path.resolve(packageDir, rel);
}

export function resolveEntry(entry: string) {
  const entryPath=path.resolve(process.cwd(), entry);
  if (fs.existsSync(entryPath)) {
    const stat = fs.statSync(entryPath);
    if (stat.isFile()) return entryPath;
    if (stat.isSymbolicLink()) return resolveEntry(fs.realpathSync(entryPath));
    if (stat.isDirectory()) {
      const packageJsonPath = path.resolve(entryPath, 'package.json');
      if (!fs.existsSync(packageJsonPath)) return resolveEntry(path.join(entryPath, 'index'));
      const pkgJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>;
      return resolveEntry(resolvePackageJsonEntryFile(entryPath, pkgJson));
    }
  } else {
    for (const ext of supportedPluginExtensions) {
      const fullPath = path.resolve(entryPath + ext);
      if (fs.existsSync(fullPath)) return resolveEntry(fullPath);
    }
  }
}
export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
