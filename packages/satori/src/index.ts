/**
 * @zhin.js/satori — HTML/CSS to SVG via official satori
 *
 * - Directly depends on the official "satori" package; no internal reimplementation.
 * - Supports HTML input via html-react-parser (depends on react, same as html-react-parser).
 * - Provides built-in font files (Noto Sans SC/JP/KR, etc.) from the fonts/ directory.
 */

export { default as satori, default } from 'satori';
export { htmlToSvg, sanitizeHtml } from './html-to-svg.js';
export type { HtmlToSvgOptions } from './html-to-svg.js';

export type { BuiltinFont, Weight, FontStyle } from './fonts.js';
export {
  getPoppinsRegular,
  getPoppinsBold,
  getNotoSansCJK,
  getNotoSansSC,
  getNotoSansJP,
  getNotoSansKR,
  getNotoColorEmoji,
  getAllBuiltinFonts,
  getDefaultFonts,
  getExtendedFonts,
  getCJKFonts,
  getCompleteFonts,
} from './fonts.js';
