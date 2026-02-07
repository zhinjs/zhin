/**
 * Built-in font utilities
 * 
 * Note: This package does not include built-in fonts by default.
 * Users should provide their own fonts via the FontOptions.
 */

export interface BuiltinFont {
  name: string
  data: ArrayBuffer
  weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900
  style: 'normal' | 'italic'
}

/**
 * Get Roboto Regular font
 * @returns null - No built-in fonts available
 */
export function getRobotoRegular(): BuiltinFont | null {
  return null
}

/**
 * Get Roboto Bold font
 * @returns null - No built-in fonts available
 */
export function getRobotoBold(): BuiltinFont | null {
  return null
}

/**
 * Get Noto Sans CJK font
 * @returns null - No built-in fonts available
 */
export function getNotoSansCJK(): BuiltinFont | null {
  return null
}

/**
 * Get Noto Sans JP font
 * @returns null - No built-in fonts available
 */
export function getNotoSansJP(): BuiltinFont | null {
  return null
}

/**
 * Get Noto Sans KR font
 * @returns null - No built-in fonts available
 */
export function getNotoSansKR(): BuiltinFont | null {
  return null
}

/**
 * Get all built-in fonts
 * @returns Empty array - No built-in fonts available
 */
export function getAllBuiltinFonts(): BuiltinFont[] {
  return []
}

/**
 * Get default fonts
 * @returns Empty array - No built-in fonts available
 */
export function getDefaultFonts(): BuiltinFont[] {
  return []
}
