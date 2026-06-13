import { describe, it, expect } from 'vitest'
import {
  isDangerousCommand,
  stripEnvVarPrefix,
  stripSafeWrappers,
  splitCompoundCommand,
  extractCommandName,
} from '../../src/security/exec-policy.js'

describe('exec-policy — isDangerousCommand', () => {
  it('sudo is dangerous', () => {
    expect(isDangerousCommand('sudo')).toBe(true)
  })

  it('eval is dangerous', () => {
    expect(isDangerousCommand('eval')).toBe(true)
  })

  it('dd is dangerous', () => {
    expect(isDangerousCommand('dd')).toBe(true)
  })

  it('gdb is dangerous', () => {
    expect(isDangerousCommand('gdb')).toBe(true)
  })

  it('cat is not dangerous', () => {
    expect(isDangerousCommand('cat')).toBe(false)
  })

  it('ls is not dangerous', () => {
    expect(isDangerousCommand('ls')).toBe(false)
  })

  it('grep is not dangerous', () => {
    expect(isDangerousCommand('grep')).toBe(false)
  })
})

describe('exec-policy — stripEnvVarPrefix', () => {
  it('strips single env var', () => {
    expect(stripEnvVarPrefix('FOO=bar ls -la')).toBe('ls -la')
  })

  it('strips multiple env vars', () => {
    expect(stripEnvVarPrefix('A=1 B=2 C=3 curl http://example.com')).toBe('curl http://example.com')
  })

  it('returns command unchanged when no env prefix', () => {
    expect(stripEnvVarPrefix('ls -la')).toBe('ls -la')
  })

  it('handles quoted values', () => {
    expect(stripEnvVarPrefix('FOO="hello world" ls')).toBe('ls')
  })

  it('handles empty value', () => {
    expect(stripEnvVarPrefix('FOO= ls')).toBe('ls')
  })

  it('does not strip if key has special chars', () => {
    // Only valid env var names should be stripped
    expect(stripEnvVarPrefix('123=foo ls')).toBe('123=foo ls')
  })
})

describe('exec-policy — stripSafeWrappers', () => {
  it('strips timeout wrapper', () => {
    expect(stripSafeWrappers('timeout 10 ls -la')).toBe('ls -la')
  })

  it('strips timeout with duration suffix', () => {
    expect(stripSafeWrappers('timeout 30s curl http://example.com')).toBe('curl http://example.com')
  })

  it('strips nice wrapper', () => {
    expect(stripSafeWrappers('nice -n 5 cat file.txt')).toBe('cat file.txt')
  })

  it('strips nohup wrapper', () => {
    expect(stripSafeWrappers('nohup node server.js')).toBe('node server.js')
  })

  it('returns command unchanged when no wrapper', () => {
    expect(stripSafeWrappers('ls -la')).toBe('ls -la')
  })

  it('strips nested wrappers', () => {
    expect(stripSafeWrappers('timeout 10 nice -n 5 cat file')).toBe('cat file')
  })
})

describe('exec-policy — splitCompoundCommand', () => {
  it('splits on &&', () => {
    const parts = splitCompoundCommand('ls && cat file')
    expect(parts).toEqual(['ls', 'cat file'])
  })

  it('splits on ||', () => {
    const parts = splitCompoundCommand('ls || echo "not found"')
    expect(parts).toEqual(['ls', 'echo "not found"'])
  })

  it('splits on ;', () => {
    const parts = splitCompoundCommand('ls; cat file')
    expect(parts).toEqual(['ls', 'cat file'])
  })

  it('returns single command unchanged', () => {
    const parts = splitCompoundCommand('ls -la /tmp')
    expect(parts).toEqual(['ls -la /tmp'])
  })

  it('handles multiple separators', () => {
    const parts = splitCompoundCommand('a && b ; c || d')
    expect(parts).toHaveLength(4)
  })

  it('does NOT split on pipe', () => {
    const parts = splitCompoundCommand('cat file | grep pattern')
    expect(parts).toEqual(['cat file | grep pattern'])
  })
})

describe('exec-policy — extractCommandName', () => {
  it('extracts simple command', () => {
    expect(extractCommandName('ls -la /tmp')).toBe('ls')
  })

  it('extracts command with path', () => {
    // extractCommandName returns the first token as-is (including path)
    expect(extractCommandName('/usr/bin/python3 script.py')).toBe('/usr/bin/python3')
  })

  it('returns empty for empty string', () => {
    expect(extractCommandName('')).toBe('')
  })

  it('returns empty for whitespace', () => {
    expect(extractCommandName('   ')).toBe('')
  })

  it('extracts first token', () => {
    expect(extractCommandName('git status --short')).toBe('git')
  })
})
