import { describe, expect, it } from 'vitest'
import { BridgeFrameError } from './errors.js'
import { parseNdjsonLine } from './framing.js'

describe('parseNdjsonLine', () => {
  it('rejects invalid JSON', () => {
    expect(() => parseNdjsonLine('not-json')).toThrow(BridgeFrameError)
  })
})
