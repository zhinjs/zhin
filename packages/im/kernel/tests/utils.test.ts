import { describe, it, expect } from 'vitest'
import { Time, sleep } from '../src/utils'

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
