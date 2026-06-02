/**
 * @zhin.js/core utilities.
 *
 * Generic utilities are re-exported from @zhin.js/kernel.
 * IM-specific utilities (compose, segment) remain here.
 */

// ── Re-export generic utils from kernel ──
export {
  evaluate,
  execute,
  clearEvalCache,
  getEvalCacheStats,
  getValueWithRuntime,
  compiler,
  remove,
  isEmpty,
  Time,
  supportedPluginExtensions,
  resolveEntry,
  sleep,
} from '@zhin.js/kernel';

// ── IM-specific utilities ──
import {
  AdapterMessage,
  MessageElement,
  MessageMiddleware,
  RegisteredAdapter,
  SendContent,
} from "./types.js";
import { Message } from "./message.js";

/**
 * 组合中间件,洋葱模型
 */
export function compose<P extends RegisteredAdapter=RegisteredAdapter>(
  middlewares: MessageMiddleware<P>[]
) {
  if (middlewares.length === 0) {
    return () => Promise.resolve();
  }

  return function (
    message: Message<AdapterMessage<P>>,
    next: () => Promise<void> = () => Promise.resolve()
  ) {
    let index = -1;
    const dispatch = async (i: number = 0): Promise<void> => {
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
        console.error("Middleware error:", error);
        throw error;
      }
    };
    return dispatch(0);
  };
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

      const MAX_TEMPLATE_LENGTH = 400000;
      if (template.length > MAX_TEMPLATE_LENGTH) {
        throw new Error(`Template too large: ${template.length} > ${MAX_TEMPLATE_LENGTH}`);
      }

      template = unescape(template);
      const result: MessageElement[] = [];
      const closingReg = /<(\w+)(\s+[^>]*?)?\/>/;
      const twinningReg = /<(\w+)(\s+[^>]*?)?>([^]*?)<\/\1>/;

      let iterations = 0;
      const MAX_ITERATIONS = 1000;

      while (template.length && iterations++ < MAX_ITERATIONS) {
        const twinMatch = template.match(twinningReg);
        const closeMatch = template.match(closingReg);

        let match: RegExpMatchArray | null = null;
        let isClosing = false;

        if (twinMatch && closeMatch) {
          const twinIndex = template.indexOf(twinMatch[0]);
          const closeIndex = template.indexOf(closeMatch[0]);
          if (closeIndex <= twinIndex) {
            match = closeMatch;
            isClosing = true;
          } else {
            match = twinMatch;
          }
        } else if (closeMatch) {
          match = closeMatch;
          isClosing = true;
        } else if (twinMatch) {
          match = twinMatch;
        }

        if (!match) break;

        const [fullMatch, type, attrStr = "", child = ""] = isClosing
          ? [match[0], match[1], match[2] || ""]
          : [match[0], match[1], match[2] || "", match[3] || ""];
        const index = template.indexOf(fullMatch);
        if (index === -1) break;
        const prevText = template.slice(0, index);
        if (prevText)
          result.push({
            type: "text",
            data: {
              text: unescape(prevText),
            },
          });
        template = template.slice(index + fullMatch.length);
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
        if (type === "at") return `@${data.user_id||data.qq}`;
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
