/**
 * Built-in font utilities for @zhin.js/satori.
 * Loads font files from the package fonts/ directory; compatible with official satori fonts option.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type Weight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
export type FontStyle = 'normal' | 'italic';

export interface BuiltinFont {
  name: string;
  data: ArrayBuffer | Buffer;
  weight?: Weight;
  style?: FontStyle;
}

const fontCache = new Map<string, BuiltinFont | null>();

function loadFont(
  filename: string,
  name: string,
  weight?: Weight,
  style?: FontStyle
): BuiltinFont | null {
  const cacheKey = `${filename}_${name}_${weight}_${style}`;
  if (fontCache.has(cacheKey)) {
    return fontCache.get(cacheKey)!;
  }
  try {
    const fontPath = join(__dirname, '..', 'fonts', filename);
    const buffer = readFileSync(fontPath);
    const font: BuiltinFont = { name, data: buffer, weight, style };
    fontCache.set(cacheKey, font);
    return font;
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') {
      fontCache.set(cacheKey, null);
      return null;
    }
    throw err;
  }
}

export function getNotoSansCJK(): BuiltinFont | null {
  /** SubsetOTF（静态），Satori 内置 opentype 对 Google 可变 TTF 的 fvar 解析会报错 */
  return loadFont('NotoSansSC-Regular.otf', 'Noto Sans SC', 400, 'normal');
}

export function getNotoSansSC(): BuiltinFont | null {
  return getNotoSansCJK();
}

export function getNotoSansJP(): BuiltinFont | null {
  return loadFont('NotoSansJP-Regular.otf', 'Noto Sans JP', 400, 'normal');
}

export function getNotoSansKR(): BuiltinFont | null {
  return loadFont('NotoSansKR-Regular.otf', 'Noto Sans KR', 400, 'normal');
}

/**
 * 彩色 Emoji TTF（CBDT 位图），**不要**放进 Satori `fonts`：opentype 需要轮廓字体会报错。
 * Emoji 请用 `loadAdditionalAsset` / `graphemeImages`（如 Twemoji）由 Satori 拉图片渲染。
 */
export function getNotoColorEmoji(): BuiltinFont | null {
  return loadFont('NotoColorEmoji.ttf', 'Noto Color Emoji', 400, 'normal');
}

export function getPoppinsRegular(): BuiltinFont | null {
  return loadFont('Poppins-Regular.ttf', 'Poppins', 400, 'normal');
}

export function getPoppinsBold(): BuiltinFont | null {
  return loadFont('Poppins-Bold.ttf', 'Poppins', 700, 'normal');
}

/** 供 Satori 使用的内置轮廓字体（含拉丁 + CJK）；不含 Noto Color Emoji（与 Satori 不兼容） */
export function getAllBuiltinFonts(): BuiltinFont[] {
  const fonts = [
    getPoppinsRegular(),
    getPoppinsBold(),
    getNotoSansCJK(),
    getNotoSansJP(),
    getNotoSansKR(),
  ];
  return fonts.filter((f): f is BuiltinFont => f !== null);
}

export function getDefaultFonts(): BuiltinFont[] {
  return [getPoppinsRegular(), getPoppinsBold()].filter((f): f is BuiltinFont => f !== null);
}

export function getExtendedFonts(): BuiltinFont[] {
  return [
    getPoppinsRegular(),
    getPoppinsBold(),
    getNotoSansSC(),
  ].filter((f): f is BuiltinFont => f !== null);
}

export function getCJKFonts(): BuiltinFont[] {
  return [getNotoSansSC(), getNotoSansJP(), getNotoSansKR()].filter((f): f is BuiltinFont => f !== null);
}

/** 拉丁 + 全 CJK；Emoji 仍应通过 Satori 的 asset 回调，勿把 `getNotoColorEmoji()` 塞进 `fonts` */
export function getCompleteFonts(): BuiltinFont[] {
  return [
    getPoppinsRegular(),
    getPoppinsBold(),
    getNotoSansSC(),
    getNotoSansJP(),
    getNotoSansKR(),
  ].filter((f): f is BuiltinFont => f !== null);
}
