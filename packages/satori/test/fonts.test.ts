import { describe, it, expect } from 'vitest'
import {
  getPoppinsRegular,
  getPoppinsBold,
  getNotoSansCJK,
  getNotoSansJP,
  getNotoSansKR,
  getAllBuiltinFonts,
  getDefaultFonts,
  type BuiltinFont,
} from '../src/fonts.js'

describe('Font Loading', () => {
  describe('Individual Font Functions', () => {
    it('getPoppinsRegular should return BuiltinFont or null', () => {
      const font = getPoppinsRegular()
      if (font !== null) {
        expect(font).toHaveProperty('name')
        expect(font).toHaveProperty('data')
        expect(font.name).toBe('Poppins')
        expect(font.weight).toBe(400)
        expect(font.style).toBe('normal')
      }
    })

    it('getPoppinsBold should return BuiltinFont or null', () => {
      const font = getPoppinsBold()
      if (font !== null) {
        expect(font).toHaveProperty('name')
        expect(font).toHaveProperty('data')
        expect(font.name).toBe('Poppins')
        expect(font.weight).toBe(700)
        expect(font.style).toBe('normal')
      }
    })

    it('getNotoSansCJK should return BuiltinFont or null', () => {
      const font = getNotoSansCJK()
      if (font !== null) {
        expect(font).toHaveProperty('name')
        expect(font).toHaveProperty('data')
        expect(font.name).toBe('Noto Sans SC')
      }
    })

    it('getNotoSansJP should return BuiltinFont or null', () => {
      const font = getNotoSansJP()
      if (font !== null) {
        expect(font).toHaveProperty('name')
        expect(font).toHaveProperty('data')
        expect(font.name).toBe('Noto Sans JP')
      }
    })

    it('getNotoSansKR should return BuiltinFont or null', () => {
      const font = getNotoSansKR()
      if (font !== null) {
        expect(font).toHaveProperty('name')
        expect(font).toHaveProperty('data')
        expect(font.name).toBe('Noto Sans KR')
      }
    })
  })

  describe('Collection Functions', () => {
    it('getAllBuiltinFonts should return an array', () => {
      const fonts = getAllBuiltinFonts()
      expect(Array.isArray(fonts)).toBe(true)
      fonts.forEach((font) => {
        expect(font).toHaveProperty('name')
        expect(font).toHaveProperty('data')
      })
    })

    it('getDefaultFonts should return an array', () => {
      const fonts = getDefaultFonts()
      expect(Array.isArray(fonts)).toBe(true)
      fonts.forEach((font) => {
        expect(font).toHaveProperty('name')
        expect(font).toHaveProperty('data')
        expect(font.name).toBe('Poppins')
      })
    })

    it('getDefaultFonts should be a subset of getAllBuiltinFonts', () => {
      const defaultFonts = getDefaultFonts()
      const allFonts = getAllBuiltinFonts()
      
      defaultFonts.forEach((defaultFont) => {
        const found = allFonts.some(
          (font) =>
            font.name === defaultFont.name &&
            font.weight === defaultFont.weight &&
            font.style === defaultFont.style
        )
        expect(found).toBe(true)
      })
    })
  })

  describe('Caching', () => {
    it('should return the same instance when called multiple times', () => {
      const font1 = getPoppinsRegular()
      const font2 = getPoppinsRegular()
      
      if (font1 !== null && font2 !== null) {
        // Should be the same cached instance
        expect(font1).toBe(font2)
      }
    })

    it('should cache null results', () => {
      // Call multiple times - should not throw even if file doesn't exist
      const font1 = getNotoSansCJK()
      const font2 = getNotoSansCJK()
      
      // Both should return the same result (either both null or both valid)
      expect(font1).toBe(font2)
    })
  })

  describe('Type Safety', () => {
    it('should have correct TypeScript types', () => {
      const font = getPoppinsRegular()
      
      if (font !== null) {
        // TypeScript should infer these types correctly
        const name: string = font.name
        const data: ArrayBuffer | Buffer = font.data
        const weight: number | undefined = font.weight
        const style: 'normal' | 'italic' | undefined = font.style
        
        expect(typeof name).toBe('string')
        expect(data).toBeDefined()
      }
    })
  })
})
