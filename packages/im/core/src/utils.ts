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
import { htmlToFallbackText } from "./built/html-to-text.js";
import { HtmlSegment } from "./built/rich-segments/html-segment.js";
import { MarkdownSegment } from "./built/rich-segments/markdown-segment.js";
import { QrcodeSegment } from "./built/rich-segments/qrcode-segment.js";
import { TtsSegment } from "./built/rich-segments/tts-segment.js";
import { KeyboardSegment } from "./built/interactive-segments/keyboard-segment.js";
import { ButtonSpec, normalizeKeyboardRows, type KeyboardRowInput } from "./built/interactive-segments/button-spec.js";
import type { ButtonData, KeyboardFallback, KeyboardSegmentData } from "./built/interactive-segments/types.js";

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
  export function mention(target: string, name?: string) {
    return segment("mention", name ? { target, name } : { target });
  }
  export function face(id: string, text?: string) {
    return segment("face", { id, text });
  }

  /** 出站 HTML 卡片段（Adapter policy 决定 image/text/origin） */
  export function htmlCard(options: {
    html: string;
    text?: string;
    width?: number;
    backgroundColor?: string;
    fileName?: string;
  }) {
    return new HtmlSegment(options);
  }

  /** @alias htmlCard */
  export const html = htmlCard;

  /** 出站 Markdown 段（Adapter policy 决定 image/text/origin） */
  export function markdown(content: string, options: Omit<MarkdownSegment['data'], 'content'> = {}) {
    return new MarkdownSegment({ content, ...options });
  }

  /** 二维码出站段（Adapter policy 决定 image/text/origin） */
  export function qrcode(
    text: string,
    options: {
      width?: number;
      margin?: number;
      errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
      small?: boolean;
    } = {},
  ) {
    return new QrcodeSegment({ text, ...options });
  }

  /** TTS 出站段（Adapter policy 决定 audio/text/origin） */
  export function tts(options: {
    text: string;
    voice?: string;
    provider?: string;
  }) {
    return new TtsSegment(options);
  }

  /** 键盘按钮单元（与 {@link keyboard} 组合布局） */
  export function button(data: ButtonData): ButtonSpec {
    return new ButtonSpec(data);
  }

  /** 键盘布局出站段（Adapter interactivePolicy 决定 native/text） */
  export function keyboard(
    rows: KeyboardRowInput[],
    options?: { fallback?: KeyboardFallback },
  ): KeyboardSegment {
    return new KeyboardSegment({
      rows: normalizeKeyboardRows(rows),
      fallback: options?.fallback,
    });
  }

  /**
   * @deprecated 使用 {@link keyboard} + {@link button}；文本请用 `segment.text` 单独发送
   */
  export function interactive(data: KeyboardSegmentData & { text?: SendContent }) {
    const { text: _text, rows, fallback } = data;
    return keyboard(rows, { fallback });
  }

  export function from(content: SendContent): SendContent {
    if (!Array.isArray(content)) content = [content];
    const toString = (template: string | MessageElement) => {
      if (typeof template !== "string") return [template];

      /** ReDoS 防护：仅约束 segment.from 的字符串模板解析，不是附件大小上限；MessageElement[] 出站应走 renderComponents 快路径避免往返 */
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
        if (typeof type === "function") {
          return `{${type.name || "Component"}}`;
        }
        if (type === "text") return data.text;
        if (type === "at") return `@${data.user_id || data.qq || data.id || data.name || ""}`;
        if (type === "html") {
          if (typeof data.text === "string" && data.text) {
            return data.text.slice(0, 80);
          }
          if (typeof data.html === "string") {
            const stripped = htmlToFallbackText(data.html);
            return stripped ? `[html-card] ${stripped.slice(0, 80)}` : "[html-card]";
          }
          return "[html-card]";
        }
        if (type === "qrcode") {
          const t = typeof data.text === "string" ? data.text : "";
          return t ? `[qrcode] ${t.slice(0, 80)}` : "[qrcode]";
        }
        if (type === "markdown") {
          const t = typeof data.content === "string" ? data.content : typeof data.text === "string" ? data.text : "";
          return t ? `[markdown] ${t.slice(0, 80)}` : "[markdown]";
        }
        return data.text ? `{${type}}(${data.text})` : `{${type}}`;
      })
      .join("");
  }
  export function toString(content: SendContent) {
    if (!Array.isArray(content)) content = [content];
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        let { type } = item;
        const { data } = item;
        if (typeof type === "function") type = type.name;
        if (type === "text") return data.text;
        const keys = Object.keys(data).filter((key) => {
          if (key === "url" && typeof data.url === "string" && data.url.startsWith("data:") && data.base64) {
            return false;
          }
          return true;
        });
        return `<${type} ${keys
          .map((key) => `${key}='${escape(JSON.stringify(data[key]))}'`)
          .join(" ")}/>`;
      })
      .join("");
  }
}
