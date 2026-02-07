import { it, describe, expect } from 'vitest'
import {
  BuiltinFont,
  getRobotoRegular,
  getRobotoBold,
  getNotoSansCJK,
  getNotoSansJP,
  getNotoSansKR,
  getAllBuiltinFonts,
  getDefaultFonts,
} from '../src/index.js'

describe('Built-in Font Utilities', () => {
  describe('Exports', () => {
    it('should export BuiltinFont type', () => {
      // Type check - this will fail at compile time if the type is not exported
      const font: BuiltinFont = {
        name: 'Test Font',
        data: new ArrayBuffer(0),
        weight: 400,
        style: 'normal',
      }
      
      expect(font.name).toBe('Test Font')
    })

    it('should export font getter functions', () => {
      expect(typeof getRobotoRegular).toBe('function')
      expect(typeof getRobotoBold).toBe('function')
      expect(typeof getNotoSansCJK).toBe('function')
      expect(typeof getNotoSansJP).toBe('function')
      expect(typeof getNotoSansKR).toBe('function')
      expect(typeof getAllBuiltinFonts).toBe('function')
      expect(typeof getDefaultFonts).toBe('function')
    })
  })

  describe('Font Getters Behavior', () => {
    it('getRobotoRegular should throw error', () => {
      expect(() => getRobotoRegular()).toThrow(
        '[satori/fonts] getRobotoRegular is not available: this package does not include built-in fonts'
      )
    })

    it('getRobotoBold should throw error', () => {
      expect(() => getRobotoBold()).toThrow(
        '[satori/fonts] getRobotoBold is not available: this package does not include built-in fonts'
      )
    })

    it('getNotoSansCJK should throw error', () => {
      expect(() => getNotoSansCJK()).toThrow(
        '[satori/fonts] getNotoSansCJK is not available: this package does not include built-in fonts'
      )
    })

    it('getNotoSansJP should throw error', () => {
      expect(() => getNotoSansJP()).toThrow(
        '[satori/fonts] getNotoSansJP is not available: this package does not include built-in fonts'
      )
    })

    it('getNotoSansKR should throw error', () => {
      expect(() => getNotoSansKR()).toThrow(
        '[satori/fonts] getNotoSansKR is not available: this package does not include built-in fonts'
      )
    })

    it('getAllBuiltinFonts should throw error', () => {
      expect(() => getAllBuiltinFonts()).toThrow(
        '[satori/fonts] getAllBuiltinFonts is not available: this package does not include built-in fonts'
      )
    })

    it('getDefaultFonts should throw error', () => {
      expect(() => getDefaultFonts()).toThrow(
        '[satori/fonts] getDefaultFonts is not available: this package does not include built-in fonts'
      )
    })

    it('error messages should guide users to provide their own fonts', () => {
      expect(() => getRobotoRegular()).toThrow(
        'Please provide your own fonts via the FontOptions configuration'
      )
    })
  })

  describe('Type Compatibility', () => {
    it('BuiltinFont should be compatible with FontOptions', () => {
      // This test verifies that BuiltinFont uses the same types as FontOptions
      const builtinFont: BuiltinFont = {
        name: 'Test Font',
        data: Buffer.from([]), // Should accept Buffer (from FontOptions['data'])
        weight: 400,
        style: 'normal',
      }
      
      expect(builtinFont.data).toBeInstanceOf(Buffer)
    })

    it('BuiltinFont should accept ArrayBuffer', () => {
      const builtinFont: BuiltinFont = {
        name: 'Test Font',
        data: new ArrayBuffer(0), // Should also accept ArrayBuffer
        weight: 700,
        style: 'italic',
      }
      
      expect(builtinFont.data).toBeInstanceOf(ArrayBuffer)
    })

    it('BuiltinFont weight and style should be optional', () => {
      const builtinFont: BuiltinFont = {
        name: 'Test Font',
        data: new ArrayBuffer(0),
        // weight and style are optional
      }
      
      expect(builtinFont.weight).toBeUndefined()
      expect(builtinFont.style).toBeUndefined()
    })
  })
})
