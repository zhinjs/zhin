import * as path from "path";
import * as fs from "fs";
import {
  AdapterMessage,
  Dict,
  MessageElement,
  MessageMiddleware,
  RegisteredAdapter,
  SendContent,
} from "./types";
import { Message } from "./message.js";

export function getValueWithRuntime(template: string, ctx: Dict) {
  const result = evaluate(template, ctx);
  if (result === `return(${template})`) return undefined;
  return result;
}
export const evaluate = <S, T = any>(exp: string, context: S) => {
  const result = execute<S, T>(`return(${exp})`, context);
  // 如果结果是原始表达式，说明访问被阻止，返回 undefined
  if (result === `return(${exp})`) return undefined;
  return result;
};
/**
 * 组合中间件,洋葱模型
 * 灵感来源于 zhinjs/next 的 Hooks.compose
 *
 * @param middlewares 中间件列表
 * @returns 中间件处理函数
 *
 * @example
 * ```typescript
 * const composed = compose([middleware1, middleware2]);
 * await composed(message);
 * ```
 */
export function compose<P extends RegisteredAdapter=RegisteredAdapter>(
  middlewares: MessageMiddleware<P>[]
) {
  // 性能优化：空数组直接返回空函数
  if (middlewares.length === 0) {
    return () => Promise.resolve();
  }

  // 性能优化：单个中间件直接返回
  if (middlewares.length === 1) {
    return (message: Message<AdapterMessage<P>>, next: () => Promise<void> = () => Promise.resolve()) => {
      return middlewares[0](message, next);
    };
  }

  return function (
    message: Message<AdapterMessage<P>>,
    next: () => Promise<void>
  ) {
    let index = -1;
    const dispatch = async (i: number = 0): Promise<void> => {
      // 防止 next() 被多次调用
      if (i <= index) {
        return Promise.reject(new Error("next() called multiple times"));
      }
      index = i;
      let fn = middlewares[i];
      if (i === middlewares.length) fn = next;
      if (!fn) return;
      try {
        return await fn(message, () => dispatch(i + 1));
      } catch (error) {
        // 中间件异常应该被记录但不中断整个流程
        console.error("Middleware error:", error);
        throw error;
      }
    };
    return dispatch(0);
  };
}
// 使用 LRU 缓存限制大小，防止内存泄漏
const MAX_EVAL_CACHE_SIZE = 1000;
const evalCache: Record<string, Function> = Object.create(null);
const evalCacheKeys: string[] = [];

export const execute = <S, T = any>(exp: string, context: S): T => {
  let fn = evalCache[exp];
  
  if (!fn) {
    // 如果缓存已满，删除最旧的条目（LRU）
    if (evalCacheKeys.length >= MAX_EVAL_CACHE_SIZE) {
      const oldest = evalCacheKeys.shift()!;
      delete evalCache[oldest];
    }
    
    fn = evalCache[exp] = toFunction(exp);
    evalCacheKeys.push(exp);
  }
  context = {
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
    Bun: "你想干嘛",
    global: undefined,
    Buffer: undefined,
    crypto: undefined,
  };
  try {
    return fn.apply(context, [context]);
  } catch {
    return exp as T;
  }
};

const toFunction = (exp: string): Function => {
  try {
    return new Function(`$data`, `with($data){${exp}}`);
  } catch {
    return () => { };
  }
};

// 清理 evalCache（用于内存调试）
export function clearEvalCache(): void {
  Object.keys(evalCache).forEach(key => {
    delete evalCache[key];
  });
  evalCacheKeys.length = 0;
}

// 获取 evalCache 统计信息（用于内存调试）
export function getEvalCacheStats(): { size: number; maxSize: number } {
  return {
    size: evalCacheKeys.length,
    maxSize: MAX_EVAL_CACHE_SIZE
  };
}
export function compiler(template: string, ctx: Dict) {
  const matched = [...template.matchAll(/\${([^}]*?)}/g)];
  for (const item of matched) {
    const tpl = item[1];
    let value = getValueWithRuntime(tpl, ctx);
    if (value === tpl) continue;
    if (typeof value !== "string") value = JSON.stringify(value, null, 2);
    template = template.replace(`\${${item[1]}}`, value);
  }
  return template;
}
export function segment<T extends object>(type: string, data: T) {
  return {
    type,
    data,
  };
}
export namespace segment {
  export function escape<T>(text: T): T {
    if (typeof text !== "string") return text;
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;") as T;
  }
  export function unescape<T>(text: T): T {
    if (typeof text !== "string") return text;
    return text
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&") as T;
  }
  export function text(text: string) {
    return segment("text", { text });
  }
  export function face(id: string, text?: string) {
    return segment("face", { id, text });
  }
  export function from(content: SendContent): SendContent {
    if (!Array.isArray(content)) content = [content];
    const toString = (template: string | MessageElement) => {
      if (typeof template !== "string") return [template];
      
      // 安全检查：限制输入长度，防止 ReDoS 攻击
      const MAX_TEMPLATE_LENGTH = 100000; // 100KB
      if (template.length > MAX_TEMPLATE_LENGTH) {
        throw new Error(`Template too large: ${template.length} > ${MAX_TEMPLATE_LENGTH}`);
      }
      
      template = unescape(template);
      const result: MessageElement[] = [];
      // 修复 ReDoS 漏洞：使用更安全的正则表达式
      // 原: /<(\S+)(\s[^>]+)?\/>/  可能导致回溯
      const closingReg = /<(\w+)(?:\s+[^>]*?)?\/>/;
      // 原: /<(\S+)(\s[^>]+)?>([\s\S]*?)<\/\1>/  可能导致回溯
      const twinningReg = /<(\w+)(?:\s+[^>]*?)?>([^]*?)<\/\1>/;
      
      let iterations = 0;
      const MAX_ITERATIONS = 1000; // 防止无限循环
      
      while (template.length && iterations++ < MAX_ITERATIONS) {
        const [_, type, attrStr = "", child = ""] =
          template.match(twinningReg) || template.match(closingReg) || [];
        if (!type) break;
        const isClosing = closingReg.test(template);
        const matched = isClosing
          ? `<${type}${attrStr}/>`
          : `<${type}${attrStr}>${child}</${type}>`;
        const index = template.indexOf(matched);
        const prevText = template.slice(0, index);
        if (prevText)
          result.push({
            type: "text",
            data: {
              text: unescape(prevText),
            },
          });
        template = template.slice(index + matched.length);
        // 修复 ReDoS 漏洞：使用更简单的正则表达式
        // 原: /\s([^=]+)(?=(?=="([^"]+)")|(?=='([^']+)'))/g  嵌套前瞻断言
        const attrArr = [
          ...attrStr.matchAll(/\s+([^=\s]+)=(?:"([^"]*)"|'([^']*)')/g),
        ];
        const data = Object.fromEntries(
          attrArr.map(([source, key, v1, v2]) => {
            const value = v1 || v2;
            try {
              return [key, JSON.parse(unescape(value))];
            } catch {
              return [key, unescape(value)];
            }
          })
        );
        if (child) {
          data.message = toString(child).map(({ type, data }) => ({
            type,
            ...data,
          }));
        }
        result.push({
          type: type,
          data,
        });
      }
      if (template.length) {
        result.push({
          type: "text",
          data: {
            text: unescape(template),
          },
        });
      }
      return result;
    };
    return content.reduce((result, item) => {
      result.push(...toString(item));
      return result;
    }, [] as MessageElement[]);
  }
  export function raw(content: SendContent) {
    if (!Array.isArray(content)) content = [content];
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        const { type, data } = item;
        if (type === "text") return data.text;
        return data.text ? `{${type}}(${data.text})` : `{${type}}`;
      })
      .join("");
  }
  export function toString(content: SendContent) {
    if (!Array.isArray(content)) content = [content];
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        let { type, data } = item;
        if (typeof type === "function") type = type.name;
        if (type === "text") return data.text;
        return `<${type} ${Object.keys(data)
          .map((key) => `${key}='${escape(JSON.stringify(data[key]))}'`)
          .join(" ")}/>`;
      })
      .join("");
  }
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
    if (parsed) {
      date = (Date.now() + parsed) as any;
    } else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) {
      date = `${new Date().toLocaleDateString()}-${date}`;
    } else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) {
      date = `${new Date().getFullYear()}-${date}`;
    }
    return date ? new Date(date) : new Date();
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
