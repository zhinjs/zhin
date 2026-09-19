import { RichSegmentRegistry } from './registry.js';
import { wrapQrcodeSegment } from './qrcode-segment.js';
import { wrapHtmlSegment } from './html-segment.js';
import { wrapMarkdownSegment } from './markdown-segment.js';
import { wrapTtsSegment } from './tts-segment.js';
import { BUILTIN_RICH_SEGMENT_KINDS, RICH_SEGMENT_MODE } from './types.js';

export const richSegmentRegistry = new RichSegmentRegistry([
  {
    kind: BUILTIN_RICH_SEGMENT_KINDS.QRCODE,
    defaultMode: RICH_SEGMENT_MODE.IMAGE,
    modes: [RICH_SEGMENT_MODE.IMAGE, RICH_SEGMENT_MODE.TEXT, RICH_SEGMENT_MODE.ORIGIN],
    wrap: wrapQrcodeSegment,
  },

  {
    kind: BUILTIN_RICH_SEGMENT_KINDS.HTML,
    defaultMode: RICH_SEGMENT_MODE.TEXT,
    modes: [RICH_SEGMENT_MODE.IMAGE, RICH_SEGMENT_MODE.TEXT, RICH_SEGMENT_MODE.ORIGIN],
    wrap: wrapHtmlSegment,
  },

  {
    kind: BUILTIN_RICH_SEGMENT_KINDS.MARKDOWN,
    defaultMode: RICH_SEGMENT_MODE.TEXT,
    modes: [RICH_SEGMENT_MODE.IMAGE, RICH_SEGMENT_MODE.TEXT, RICH_SEGMENT_MODE.ORIGIN],
    wrap: wrapMarkdownSegment,
  },

  {
    kind: BUILTIN_RICH_SEGMENT_KINDS.TTS,
    defaultMode: RICH_SEGMENT_MODE.AUDIO,
    modes: [RICH_SEGMENT_MODE.ORIGIN, RICH_SEGMENT_MODE.AUDIO, RICH_SEGMENT_MODE.TEXT],
    wrap: wrapTtsSegment,
  },
]);

/** 内置 kind 的默认出站 policy（由 registry 生成，增 kind 时自动包含） */
export const DEFAULT_OUTBOUND_RICH_SEGMENT_POLICY = richSegmentRegistry.buildDefaultPolicy();
