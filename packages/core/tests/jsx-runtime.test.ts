import { describe, it, expect } from 'vitest'
import * as jsxRuntime from '../src/jsx-runtime'
import * as jsxDevRuntime from '../src/jsx-dev-runtime'

describe('JSX Runtime', () => {
  it('should export jsx function', () => {
    expect(typeof jsxRuntime.jsx).toBe('function')
  })

  it('should export jsxs function', () => {
    expect(typeof jsxRuntime.jsxs).toBe('function')
  })

  it('should export Fragment', () => {
    expect(jsxRuntime.Fragment).toBeDefined()
  })

  it('should export renderJSX function', () => {
    expect(typeof jsxRuntime.renderJSX).toBe('function')
  })

  it('should have default export', () => {
    expect(jsxRuntime.default).toBeDefined()
    expect(typeof jsxRuntime.default.jsx).toBe('function')
    expect(typeof jsxRuntime.default.jsxs).toBe('function')
  })
})

describe('JSX Dev Runtime', () => {
  it('should export jsx function', () => {
    expect(typeof jsxDevRuntime.jsx).toBe('function')
  })

  it('should export jsxDEV function', () => {
    expect(typeof jsxDevRuntime.jsxDEV).toBe('function')
  })

  it('should export Fragment', () => {
    expect(jsxDevRuntime.Fragment).toBeDefined()
  })

  it('should export renderJSX function', () => {
    expect(typeof jsxDevRuntime.renderJSX).toBe('function')
  })
})
