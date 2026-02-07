/**
 * Built-in font utilities
 * 
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * 
 * This module provides utilities to load fonts for use with Satori.
 * Fonts can be loaded from the fonts directory if available.
 */

import type { FontOptions, Weight, FontStyle } from './font.js'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export interface BuiltinFont {
  name: string
  data: FontOptions['data']
  weight?: Weight
  style?: FontStyle
}

// Cache for loaded fonts
const fontCache = new Map<string, BuiltinFont | null>()

/**
 * Load a font file from the fonts directory
 * @param filename Font file name
 * @param name Font name
 * @param weight Font weight
 * @param style Font style
 * @returns BuiltinFont or null if file doesn't exist
 */
function loadFont(
  filename: string,
  name: string,
  weight?: Weight,
  style?: FontStyle
): BuiltinFont | null {
  const cacheKey = `${filename}_${name}_${weight}_${style}`
  
  if (fontCache.has(cacheKey)) {
    return fontCache.get(cacheKey)!
  }

  try {
    // Font directory is at ../fonts/ relative to both src/ and dist/
    // This works consistently in both development and production
    const fontPath = join(__dirname, '..', 'fonts', filename)
    const buffer = readFileSync(fontPath)
    
    const font: BuiltinFont = {
      name,
      data: buffer,
      weight,
      style,
    }
    fontCache.set(cacheKey, font)
    return font
  } catch (error) {
    // Font file not found, cache null to avoid repeated attempts
    fontCache.set(cacheKey, null)
    return null
  }
}

/**
 * Get Noto Sans Simplified Chinese font
 * @returns BuiltinFont or null if not available
 */
export function getNotoSansCJK(): BuiltinFont | null {
  return loadFont('NotoSansSC-Regular.ttf', 'Noto Sans SC', 400, 'normal')
}

/**
 * Alias for getNotoSansCJK
 * @returns BuiltinFont or null if not available
 */
export function getNotoSansSC(): BuiltinFont | null {
  return getNotoSansCJK()
}

/**
 * Get Noto Sans Japanese font
 * @returns BuiltinFont or null if not available
 */
export function getNotoSansJP(): BuiltinFont | null {
  return loadFont('NotoSansJP-Regular.ttf', 'Noto Sans JP', 400, 'normal')
}

/**
 * Get Noto Sans Korean font
 * @returns BuiltinFont or null if not available
 */
export function getNotoSansKR(): BuiltinFont | null {
  return loadFont('NotoSansKR-Regular.ttf', 'Noto Sans KR', 400, 'normal')
}

/**
 * Get Noto Color Emoji font
 * @returns BuiltinFont or null if not available
 */
export function getNotoColorEmoji(): BuiltinFont | null {
  return loadFont('NotoColorEmoji.ttf', 'Noto Color Emoji', 400, 'normal')
}

/**
 * Get Poppins Regular font
 * @returns BuiltinFont or null if not available
 */
export function getPoppinsRegular(): BuiltinFont | null {
  return loadFont('Poppins-Regular.ttf', 'Poppins', 400, 'normal')
}

/**
 * Get Poppins Bold font
 * @returns BuiltinFont or null if not available
 */
export function getPoppinsBold(): BuiltinFont | null {
  return loadFont('Poppins-Bold.ttf', 'Poppins', 700, 'normal')
}

/**
 * Get all available built-in fonts
 * @returns Array of available BuiltinFont objects
 */
export function getAllBuiltinFonts(): BuiltinFont[] {
  const fonts = [
    getPoppinsRegular(),
    getPoppinsBold(),
    getNotoSansCJK(),
    getNotoSansJP(),
    getNotoSansKR(),
    getNotoColorEmoji(),
  ]
  
  return fonts.filter((font): font is BuiltinFont => font !== null)
}

/**
 * Get default fonts (Poppins Regular and Bold)
 * Falls back to empty array if fonts are not available
 * @returns Array of default BuiltinFont objects
 */
export function getDefaultFonts(): BuiltinFont[] {
  const fonts = [getPoppinsRegular(), getPoppinsBold()]
  
  return fonts.filter((font): font is BuiltinFont => font !== null)
}

/**
 * Get extended default fonts (includes Poppins and Noto Sans SC)
 * @returns Array of default BuiltinFont objects with extended coverage
 */
export function getExtendedFonts(): BuiltinFont[] {
  const fonts = [
    getPoppinsRegular(),
    getPoppinsBold(),
    getNotoSansSC(),
  ]
  
  return fonts.filter((font): font is BuiltinFont => font !== null)
}

/**
 * Get CJK fonts (Chinese, Japanese, Korean)
 * @returns Array of CJK BuiltinFont objects
 */
export function getCJKFonts(): BuiltinFont[] {
  const fonts = [
    getNotoSansSC(),
    getNotoSansJP(),
    getNotoSansKR(),
  ]
  
  return fonts.filter((font): font is BuiltinFont => font !== null)
}

/**
 * Get complete font set (Latin + CJK + Emoji)
 * Recommended for maximum language and emoji support
 * @returns Array of all recommended BuiltinFont objects
 */
export function getCompleteFonts(): BuiltinFont[] {
  const fonts = [
    getPoppinsRegular(),
    getPoppinsBold(),
    getNotoSansSC(),
    getNotoSansJP(),
    getNotoSansKR(),
    getNotoColorEmoji(),
  ]
  
  return fonts.filter((font): font is BuiltinFont => font !== null)
}
