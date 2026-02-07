/**
 * Built-in font utilities
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
 * Get Roboto Regular font (400 weight)
 * @returns BuiltinFont or null if not available
 */
export function getRobotoRegular(): BuiltinFont | null {
  return loadFont('Roboto-Regular.ttf', 'Roboto', 400, 'normal')
}

/**
 * Get Roboto Bold font (700 weight)
 * @returns BuiltinFont or null if not available
 */
export function getRobotoBold(): BuiltinFont | null {
  return loadFont('Roboto-Bold.ttf', 'Roboto', 700, 'normal')
}

/**
 * Get Noto Sans CJK Simplified Chinese font
 * @returns BuiltinFont or null if not available
 */
export function getNotoSansCJK(): BuiltinFont | null {
  return loadFont('NotoSansSC-Regular.otf', 'Noto Sans SC', 400, 'normal')
}

/**
 * Get Noto Sans Japanese font
 * @returns BuiltinFont or null if not available
 */
export function getNotoSansJP(): BuiltinFont | null {
  return loadFont('NotoSansJP-Regular.otf', 'Noto Sans JP', 400, 'normal')
}

/**
 * Get Noto Sans Korean font
 * @returns BuiltinFont or null if not available
 */
export function getNotoSansKR(): BuiltinFont | null {
  return loadFont('NotoSansKR-Regular.otf', 'Noto Sans KR', 400, 'normal')
}

/**
 * Get all available built-in fonts
 * @returns Array of available BuiltinFont objects
 */
export function getAllBuiltinFonts(): BuiltinFont[] {
  const fonts = [
    getRobotoRegular(),
    getRobotoBold(),
    getNotoSansCJK(),
    getNotoSansJP(),
    getNotoSansKR(),
  ]
  
  return fonts.filter((font): font is BuiltinFont => font !== null)
}

/**
 * Get default fonts (Roboto Regular and Bold)
 * Falls back to empty array if fonts are not available
 * @returns Array of default BuiltinFont objects
 */
export function getDefaultFonts(): BuiltinFont[] {
  const fonts = [getRobotoRegular(), getRobotoBold()]
  
  return fonts.filter((font): font is BuiltinFont => font !== null)
}
