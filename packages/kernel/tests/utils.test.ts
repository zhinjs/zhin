import { describe, it, expect, beforeEach } from 'vitest'
import {
  compiler,
  evaluate,
  execute,
  remove,
  isEmpty,
  Time,
  clearEvalCache,
  getEvalCacheStats,
  getValueWithRuntime,
  sleep
} from '../src/utils'

describe('Template Security', () => {
  it('should prevent access to process.env', () => {
    const result = compiler('Node env: ${process.env.NODE_ENV}', {})
    expect(result).toBe('Node env: undefined')
  })

  it('should prevent access to global object', () => {
    const result = compiler('Global: ${global}', {})
    expect(result).toBe('Global: undefined')
  })

  it('should prevent access to require function', () => {
    const result = compiler('Require: ${require}', {})
    expect(result).toBe('Require: undefined')
  })

  it('should allow access to provided context variables', () => {
    const result = compiler('Hello ${name}!', { name: 'World' })
    expect(result).toBe('Hello World!')
  })

  it('should allow complex expressions with safe context', () => {
    const result = compiler('Result: ${Math.max(1, 2, 3)}', {})
    expect(result).toBe('Result: 3')
  })

  it('should handle nested object access safely', () => {
    const result = compiler('User: ${user.name} (${user.age})', { user: { name: 'Alice', age: 25 } })
    expect(result).toBe('User: Alice (25)')
  })

  it('should allow safe Math expressions', () => {
    const result = evaluate('Math.PI', {})
    expect(result).toBeCloseTo(3.14159)
  })

  it('should block Buffer access', () => {
    expect(evaluate('Buffer', {})).toBeUndefined()
  })
})

describe('Sandbox Escape Prevention (Proxy-based)', () => {
  it('should return safe process even through VM constructor chain (no exit/kill)', () => {
    // this.constructor.constructor leads to VM's Function (not host Function),
    // so the created function accesses VM globals which only has our safe process
    const result = evaluate("this.constructor.constructor('return process')()", {})
    expect(result).toBeDefined()
    expect(evaluate("typeof this.constructor.constructor('return process')().exit", {})).toBe('undefined')
    expect(evaluate("typeof this.constructor.constructor('return process')().kill", {})).toBe('undefined')
  })

  it('should block constructor access in templates', () => {
    const result = compiler("${this.constructor.constructor('return process')().exit(1)}", {})
    expect(result).toBe('undefined')
  })

  it('should block constructor access on HOST objects via Proxy', () => {
    // Math is a host object — Proxy blocks .constructor to prevent host Function escape
    expect(evaluate('Math.constructor', { Math })).toBeUndefined()
    expect(evaluate('Math.prototype', { Math })).toBeUndefined()
    expect(evaluate('Math.__proto__', { Math })).toBeUndefined()
  })

  it('should block string-concatenation bypass on host objects', () => {
    // This bypasses regex-based blocklists, but Proxy catches it at engine level
    expect(evaluate("var a='constr',b='uctor';Math[a+b]", { Math })).toBeUndefined()
    expect(evaluate("Math['const'+'ructor']", { Math })).toBeUndefined()
    expect(evaluate("var p='__proto__';Math[p]", { Math })).toBeUndefined()
  })

  it('should block bracket notation access on host objects', () => {
    expect(evaluate("Math['constructor']", { Math })).toBeUndefined()
    expect(evaluate("Math['__proto__']", { Math })).toBeUndefined()
    expect(evaluate("Math['prototype']", { Math })).toBeUndefined()
  })

  it('should block chained constructor escape through host objects', () => {
    // Math.constructor.constructor gives host Function — must be blocked by Proxy
    expect(evaluate("Math.constructor.constructor('return process')()", { Math })).toBeUndefined()
  })

  it('should block Object.getPrototypeOf on proxied host objects', () => {
    // getPrototypeOf trap returns null for proxied objects
    expect(evaluate('Object.getPrototypeOf(obj)', { obj: { a: 1 } })).toBeNull()
  })

  it('should still allow normal host object methods', () => {
    expect(evaluate('Math.sqrt(16)', { Math })).toBe(4)
    expect(evaluate('Math.max(1, 2, 3)', { Math })).toBe(3)
    expect(evaluate('Math.PI', { Math })).toBeCloseTo(3.14159)
    expect(evaluate('JSON.stringify({a:1})', { JSON })).toBe('{"a":1}')
  })

  it('should still allow normal property access', () => {
    expect(evaluate('name', { name: 'test' })).toBe('test')
    expect(evaluate('user.age', { user: { age: 25 } })).toBe(25)
    expect(evaluate('1 + 2', {})).toBe(3)
  })

  it('should not leak real process.exit through sandbox', () => {
    const result = evaluate('typeof process.exit', {})
    expect(result).toBe('undefined')
  })

  it('should not have process.kill in sandbox', () => {
    expect(evaluate('process.kill', {})).toBeUndefined()
  })

  it('should expose safe process properties', () => {
    expect(evaluate('process.platform', {})).toBe(process.platform)
    expect(evaluate('process.version', {})).toBe(process.version)
    expect(evaluate('process.pid', {})).toBe(process.pid)
  })

  it('should block escape through nested proxied objects', () => {
    const obj = { inner: { deep: { value: 42 } } }
    expect(evaluate('obj.inner.deep.value', { obj })).toBe(42)
    expect(evaluate('obj.constructor', { obj })).toBeUndefined()
    expect(evaluate('obj.inner.constructor', { obj })).toBeUndefined()
    expect(evaluate('obj.inner.deep.constructor', { obj })).toBeUndefined()
  })

  it('should block Function constructor access via host function objects', () => {
    const fn = () => 42
    expect(evaluate('fn()', { fn })).toBe(42)
    expect(evaluate('fn.constructor', { fn })).toBeUndefined()
    expect(evaluate('fn.prototype', { fn })).toBeUndefined()
  })

  it('should block Reflect.getOwnPropertyDescriptor escape', () => {
    // Without getOwnPropertyDescriptor trap, this leaks host references
    const fn = function test() {}
    expect(evaluate(
      "var d = Reflect.getOwnPropertyDescriptor(fn, 'prototype'); d && d.value && d.value.constructor",
      { fn }
    )).toBeUndefined()
  })

  it('should block Object.getOwnPropertyDescriptor escape', () => {
    const fn = function test() {}
    expect(evaluate(
      "var d = Object.getOwnPropertyDescriptor(fn, 'prototype'); d && d.value && d.value.constructor",
      { fn }
    )).toBeUndefined()
  })

  it('should block Reflect.getOwnPropertyDescriptor on constructor prop', () => {
    const obj = { a: 1 }
    // constructor is inherited not own, but verify it returns undefined
    expect(evaluate(
      "Reflect.getOwnPropertyDescriptor(obj, 'constructor')",
      { obj }
    )).toBeUndefined()
  })

  it('should proxy values inside descriptors for normal properties', () => {
    const obj = { inner: { secret: 42 } }
    // Access normal prop through descriptor — value should be proxied
    expect(evaluate(
      "var d = Object.getOwnPropertyDescriptor(obj, 'inner'); d.value.secret",
      { obj }
    )).toBe(42)
    // But constructor should still be blocked on the proxied value
    expect(evaluate(
      "var d = Object.getOwnPropertyDescriptor(obj, 'inner'); d.value.constructor",
      { obj }
    )).toBeUndefined()
  })

  it('should block Reflect.get on blocked props (same as dot access)', () => {
    // Reflect.get on a Proxy triggers the get trap
    expect(evaluate("Reflect.get(Math, 'constructor')", { Math, Reflect })).toBeUndefined()
    expect(evaluate("Reflect.get(Math, '__proto__')", { Math, Reflect })).toBeUndefined()
  })

  it('should neutralize blocked keys in ownKeys/getOwnPropertyDescriptor', () => {
    const fn = function namedFn() {}
    // prototype appears in ownKeys (non-configurable, Proxy invariant), but its
    // value is neutralized by getOwnPropertyDescriptor trap
    expect(evaluate(
      "var d = Object.getOwnPropertyDescriptor(fn, 'prototype'); d ? d.value : 'missing'",
      { fn }
    )).toBeUndefined()
    // Normal props still work
    expect(evaluate("fn.name", { fn })).toBe('namedFn')
  })
})

describe('Template Functionality', () => {
  it('should handle multiple template variables', () => {
    const result = compiler('Hello ${name}, you are ${age} years old!', { name: 'Bob', age: 30 })
    expect(result).toBe('Hello Bob, you are 30 years old!')
  })

  it('should handle JSON objects in templates', () => {
    const config = { debug: true, port: 3000 }
    const result = compiler('Config: ${config}', { config })
    expect(result).toBe(`Config: ${JSON.stringify(config, null, 2)}`)
  })

  it('should handle templates without variables', () => {
    expect(compiler('Hello World!', {})).toBe('Hello World!')
  })

  it('should handle empty template', () => {
    expect(compiler('', {})).toBe('')
  })
})

describe('evaluate and execute', () => {
  beforeEach(() => {
    clearEvalCache()
  })

  it('should evaluate simple expressions', () => {
    expect(evaluate('1 + 1', {})).toBe(2)
    expect(evaluate('2 * 3', {})).toBe(6)
  })

  it('should return undefined for blocked access', () => {
    expect(evaluate('global.something', {})).toBeUndefined()
  })

  it('should use cache for repeated expressions', () => {
    const expr = '1 + 1'
    execute(expr, {})
    execute(expr, {})
    expect(getEvalCacheStats().size).toBe(1)
  })

  it('should limit cache size', () => {
    clearEvalCache()
    for (let i = 0; i < 150; i++) {
      execute(`1 + ${i}`, {})
    }
    const stats = getEvalCacheStats()
    expect(stats.size).toBeLessThanOrEqual(stats.maxSize)
  })

  it('should handle invalid expressions gracefully', () => {
    expect(() => execute('invalid syntax here !!!', {})).toThrow()
  })

  it('should provide safe process context', () => {
    const result = execute('return process.platform', {})
    expect(result).toBe(process.platform)
  })
})

describe('getValueWithRuntime', () => {
  it('should return value from context', () => {
    expect(getValueWithRuntime('name', { name: 'Alice' })).toBe('Alice')
  })

  it('should return undefined for blocked access', () => {
    expect(getValueWithRuntime('global', {})).toBeUndefined()
  })

  it('should handle complex expressions', () => {
    expect(getValueWithRuntime('user.name', { user: { name: 'Bob' } })).toBe('Bob')
  })
})

describe('remove utility', () => {
  it('should remove item by value', () => {
    const list = [1, 2, 3, 4]
    remove(list, 3)
    expect(list).toEqual([1, 2, 4])
  })

  it('should remove item by predicate', () => {
    const list = [1, 2, 3, 4]
    remove(list, (x) => x > 2)
    expect(list).toEqual([1, 2, 4])
  })

  it('should do nothing if item not found', () => {
    const list = [1, 2, 3]
    remove(list, 5)
    expect(list).toEqual([1, 2, 3])
  })
})

describe('isEmpty utility', () => {
  it('should return true for empty array', () => expect(isEmpty([])).toBe(true))
  it('should return false for non-empty array', () => expect(isEmpty([1, 2])).toBe(false))
  it('should return true for empty object', () => expect(isEmpty({})).toBe(true))
  it('should return false for non-empty object', () => expect(isEmpty({ a: 1 })).toBe(false))
  it('should return true for null', () => expect(isEmpty(null)).toBe(true))
  it('should return false for non-empty values', () => {
    expect(isEmpty('string')).toBe(false)
    expect(isEmpty(123)).toBe(false)
  })
})

describe('Time utilities', () => {
  describe('constants', () => {
    it('should have correct time constants', () => {
      expect(Time.second).toBe(1000)
      expect(Time.minute).toBe(60000)
      expect(Time.hour).toBe(3600000)
      expect(Time.day).toBe(86400000)
      expect(Time.week).toBe(604800000)
    })
  })

  describe('timezone', () => {
    it('should get and set timezone offset', () => {
      const original = Time.getTimezoneOffset()
      Time.setTimezoneOffset(480)
      expect(Time.getTimezoneOffset()).toBe(480)
      Time.setTimezoneOffset(original)
    })
  })

  describe('parseTime', () => {
    it('should parse time strings', () => {
      expect(Time.parseTime('1d')).toBe(Time.day)
      expect(Time.parseTime('2h')).toBe(Time.hour * 2)
      expect(Time.parseTime('30m')).toBe(Time.minute * 30)
      expect(Time.parseTime('45s')).toBe(Time.second * 45)
    })

    it('should parse combined time strings', () => {
      expect(Time.parseTime('1d2h')).toBe(Time.day + Time.hour * 2)
    })

    it('should return 0 for invalid strings', () => {
      expect(Time.parseTime('invalid')).toBe(0)
      expect(Time.parseTime('')).toBe(0)
    })
  })

  describe('formatTimeShort', () => {
    it('should format days', () => expect(Time.formatTimeShort(Time.day * 2)).toBe('2d'))
    it('should format hours', () => expect(Time.formatTimeShort(Time.hour * 3)).toBe('3h'))
    it('should format minutes', () => expect(Time.formatTimeShort(Time.minute * 45)).toBe('45m'))
    it('should format seconds', () => expect(Time.formatTimeShort(Time.second * 30)).toBe('30s'))
    it('should format milliseconds', () => expect(Time.formatTimeShort(500)).toBe('500ms'))
  })

  describe('formatTime', () => {
    it('should format days with hours', () => {
      const result = Time.formatTime(Time.day + Time.hour * 3)
      expect(result).toContain('天')
      expect(result).toContain('小时')
    })

    it('should format seconds only', () => {
      const result = Time.formatTime(Time.second * 30)
      expect(result).toContain('秒')
    })
  })

  describe('template', () => {
    it('should format date template', () => {
      const date = new Date('2024-01-15T14:30:45.123')
      const result = Time.template('yyyy-MM-dd hh:mm:ss', date)
      expect(result).toBe('2024-01-15 14:30:45')
    })
  })
})

describe('sleep utility', () => {
  it('should sleep for specified time', async () => {
    const start = Date.now()
    await sleep(100)
    expect(Date.now() - start).toBeGreaterThanOrEqual(90)
  })
})
