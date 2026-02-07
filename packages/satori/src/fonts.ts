/**
 * Built-in font utilities
 * 
 * Note: This package does not include built-in fonts by default.
 * Users should provide their own fonts via the FontOptions.
 */

import type { FontOptions, Weight, FontStyle } from './font.js'

export interface BuiltinFont {
  name: string
  data: FontOptions['data']
  weight?: Weight
  style?: FontStyle
}

/**
 * Helper to signal that this build does not ship with bundled fonts.
 *
 * All "get*Font" helpers intentionally throw instead of returning `null`/`[]`
 * to avoid silent missing-glyph rendering when consumers assume fonts exist.
 */
function throwNoBuiltinFontsError(apiName: string): never {
  throw new Error(
    `[satori/fonts] ${apiName} is not available: this package does not include built-in fonts. ` +
      'Please provide your own fonts via the FontOptions configuration.',
  )
}

/**
 * Get Roboto Regular font.
 *
 * @throws Error Always throws because no built-in fonts are bundled in this package.
 */
export function getRobotoRegular(): BuiltinFont | null {
  return throwNoBuiltinFontsError('getRobotoRegular')
}

/**
 * Get Roboto Bold font.
 *
 * @throws Error Always throws because no built-in fonts are bundled in this package.
 */
export function getRobotoBold(): BuiltinFont | null {
  return throwNoBuiltinFontsError('getRobotoBold')
}

/**
 * Get Noto Sans CJK font.
 *
 * @throws Error Always throws because no built-in fonts are bundled in this package.
 */
export function getNotoSansCJK(): BuiltinFont | null {
  return throwNoBuiltinFontsError('getNotoSansCJK')
}

/**
 * Get Noto Sans JP font.
 *
 * @throws Error Always throws because no built-in fonts are bundled in this package.
 */
export function getNotoSansJP(): BuiltinFont | null {
  return throwNoBuiltinFontsError('getNotoSansJP')
}

/**
 * Get Noto Sans KR font.
 *
 * @throws Error Always throws because no built-in fonts are bundled in this package.
 */
export function getNotoSansKR(): BuiltinFont | null {
  return throwNoBuiltinFontsError('getNotoSansKR')
}

/**
 * Get all built-in fonts.
 *
 * @throws Error Always throws because no built-in fonts are bundled in this package.
 */
export function getAllBuiltinFonts(): BuiltinFont[] {
  return throwNoBuiltinFontsError('getAllBuiltinFonts')
}

/**
 * Get default fonts.
 *
 * @throws Error Always throws because no built-in fonts are bundled in this package.
 */
export function getDefaultFonts(): BuiltinFont[] {
  return throwNoBuiltinFontsError('getDefaultFonts')
}
