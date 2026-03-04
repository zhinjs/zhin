import * as path from "path";
import * as fs from "fs";
import * as vm from "vm";

export type Dict<T = any> = Record<string, T>;

export function getValueWithRuntime(template: string, ctx: Dict) {
  return evaluate(template, ctx);
}
/**
 * Evaluate a single expression in a sandboxed vm context.
 * Unlike `execute`, does NOT wrap in IIFE — the expression value is returned directly.
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

function buildSandbox<S extends Record<string, unknown>>(context: S): Record<string, unknown> {
  return {
    ...context,
    process: {
      version: process.version,
      versions: process.versions,
      platform: process.platform,
      arch: process.arch,
      release: process.release,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      pid: process.pid,
      ppid: process.ppid,
    },
    global: undefined,
    globalThis: undefined,
    Buffer: undefined,
    crypto: undefined,
    require: undefined,
    import: undefined,
    __dirname: undefined,
    __filename: undefined,
    Bun: undefined,
    Deno: undefined,
  };
}

/**
 * Execute a code block in a sandboxed vm context.
 * Supports `return` statements by wrapping in an IIFE.
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

export function resolveEntry(entry: string) {
  if (fs.existsSync(entry)) {
    const stat = fs.statSync(entry);
    if (stat.isFile()) return entry;
    if (stat.isSymbolicLink()) return resolveEntry(fs.realpathSync(entry));
    if (stat.isDirectory()) {
      const packageJsonPath = path.resolve(entry, 'package.json');
      if (!fs.existsSync(packageJsonPath)) return resolveEntry(path.join(entry, 'index'));
      const pkgJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      return resolveEntry(path.resolve(entry, pkgJson.main || 'index.js'));
    }
  } else {
    for (const ext of supportedPluginExtensions) {
      const fullPath = path.resolve(entry + ext);
      if (fs.existsSync(fullPath)) return resolveEntry(fullPath);
    }
  }
}
export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
