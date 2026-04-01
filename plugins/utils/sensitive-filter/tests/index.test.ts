import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('Content moderation plugin for Zhin.js - filters sensitive words', () => {
  const entryPath = path.resolve(__dirname, '../src/index.ts')

  it('should have entry file', () => {
    expect(fs.existsSync(entryPath)).toBe(true)
  })

  it('entry file should not be empty', () => {
    const content = fs.readFileSync(entryPath, 'utf8')
    expect(content.length).toBeGreaterThan(0)
  })

  it('package.json should have correct exports', () => {
    const pkgPath = path.resolve(__dirname, '../package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    expect(pkg.exports).toBeDefined()
    expect(pkg.exports['.']).toBeDefined()
    expect(pkg.exports['.'].development).toBe('./src/index.ts')
  })
})
