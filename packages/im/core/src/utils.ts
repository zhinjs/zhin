/**
 * @zhin.js/core utilities.
 *
 * Generic utilities are re-exported from @zhin.js/kernel.
 * IM-specific utilities (segment) remain here.
 */

// ── Re-export generic utils from kernel ──
export { Time, sleep } from '@zhin.js/kernel';

// ── IM-specific utilities ──
import type { MessageElement } from "./types.js";
import { formatSegmentPreview } from "./built/segment-contract/preview.js";
import { KeyboardSegment } from "./built/interactive-segments/keyboard-segment.js";
import { ButtonSpec, normalizeKeyboardRows, type KeyboardRowInput } from "./built/interactive-segments/button-spec.js";
import type { ButtonData, KeyboardFallback, KeyboardSegmentData } from "./built/interactive-segments/types.js";
import type { MediaRef } from "./built/segment-contract/types.js";

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
  export function image(media: MediaRef, alt?: string) {
    return segment("image", alt ? { media, alt } : { media });
  }
  export function face(id: string, text?: string) {
    return segment("face", { id, text });
  }

  /** 出站 HTML 卡片段（统一出站链路决定渲染或文本降级）。 */
  export function htmlCard(options: {
    html: string;
    text?: string;
    width?: number;
    backgroundColor?: string;
    fileName?: string;
  }) {
    return segment("html", options);
  }

  /** Short alias for {@link htmlCard}. */
  export const html = htmlCard;

  /** 出站 Markdown 段。 */
  export function markdown(content: string, options: {
    width?: number;
    backgroundColor?: string;
    fileName?: string;
  } = {}) {
    return segment("markdown", { content, ...options });
  }

  /** 二维码出站段。 */
  export function qrcode(
    text: string,
    options: {
      width?: number;
      margin?: number;
      errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
      small?: boolean;
    } = {},
  ) {
    return segment("qrcode", { text, ...options });
  }

  /** TTS 出站段。 */
  export function tts(options: {
    text: string;
    voice?: string;
    provider?: string;
  }) {
    return segment("tts", options);
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

  export function raw(content: string | MessageElement | readonly (string | MessageElement)[]) {
    const items: readonly (string | MessageElement)[] = Array.isArray(content) ? content : [content as string | MessageElement];
    return items
      .map((item) => {
        if (typeof item === "string") return item;
        const { type, data } = item;
        return formatSegmentPreview({ type, data: data ?? {} });
      })
      .join("");
  }
}
