import { describe, it, expect, beforeEach } from 'vitest'
import {
  compiler,
  evaluate,
  execute,
  isExpressionSafe,
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

describe('Sandbox Escape Prevention', () => {
  it('should block this.constructor.constructor escape (CVE-like prototype chain)', () => {
    // This is the exact attack vector: this.constructor.constructor('return process')().exit(1)
    const result = evaluate("this.constructor.constructor('return process')()", {})
    expect(result).toBeUndefined()
  })

  it('should block constructor access in templates', () => {
    const result = compiler("${this.constructor.constructor('return process')().exit(1)}", {})
    // Blocked expression evaluates to undefined, so compiler replaces with 'undefined'
    expect(result).toBe('undefined')
  })

  it('should block __proto__ access', () => {
    expect(evaluate('this.__proto__', {})).toBeUndefined()
    expect(isExpressionSafe('this.__proto__')).toBe(false)
  })

  it('should block prototype access', () => {
    expect(evaluate('Object.prototype', {})).toBeUndefined()
    expect(isExpressionSafe('Object.prototype')).toBe(false)
  })

  it('should block Function constructor', () => {
    expect(evaluate("Function('return process')()", {})).toBeUndefined()
    expect(isExpressionSafe("Function('return process')()")).toBe(false)
  })

  it('should block eval calls', () => {
    expect(evaluate("eval('process.exit(1)')", {})).toBeUndefined()
    expect(isExpressionSafe("eval('process.exit(1)')")).toBe(false)
  })

  it('should block constructor in execute()', () => {
    expect(() => execute("return this.constructor.constructor('return process')()", {})).toThrow('Expression contains blocked patterns')
  })

  it('should still allow normal property access', () => {
    expect(evaluate('name', { name: 'test' })).toBe('test')
    expect(evaluate('user.age', { user: { age: 25 } })).toBe(25)
    expect(evaluate('1 + 2', {})).toBe(3)
  })

  it('should not leak real process.exit through sandbox', () => {
    // Even if expression validation is somehow bypassed,
    // the sandbox should use Object.create(null) preventing prototype traversal
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
})

describe('isExpressionSafe', () => {
  it('should allow safe expressions', () => {
    expect(isExpressionSafe('name')).toBe(true)
    expect(isExpressionSafe('user.age')).toBe(true)
    expect(isExpressionSafe('Math.max(1, 2)')).toBe(true)
    expect(isExpressionSafe('1 + 2')).toBe(true)
    expect(isExpressionSafe('a > b ? "yes" : "no"')).toBe(true)
  })

  it('should block dangerous expressions', () => {
    expect(isExpressionSafe('constructor')).toBe(false)
    expect(isExpressionSafe('this.constructor')).toBe(false)
    expect(isExpressionSafe('__proto__')).toBe(false)
    expect(isExpressionSafe('prototype')).toBe(false)
    expect(isExpressionSafe("Function('code')")).toBe(false)
    expect(isExpressionSafe("eval('code')")).toBe(false)
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
