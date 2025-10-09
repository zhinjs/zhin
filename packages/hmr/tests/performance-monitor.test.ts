import { describe, it, expect, beforeEach } from 'vitest'
import { PerformanceMonitor } from '../src/performance'

describe('PerformanceMonitor', () => {
    let performanceMonitor: PerformanceMonitor

    beforeEach(() => {
        performanceMonitor = new PerformanceMonitor()
    })

    describe('Timer Management', () => {
        it('should create and stop timer', () => {
            const timer = performanceMonitor.createTimer()
            const duration = timer.stop()
            expect(duration).toBeGreaterThanOrEqual(0)
        })

        it('should record reload time', () => {
            performanceMonitor.recordReloadTime(100)
            const stats = performanceMonitor.stats

            expect(stats.reloadCount).toBe(1)
            expect(stats.totalReloadTime).toBe(100)
            expect(performanceMonitor.getAverageReloadTime()).toBe(100)
        })

        it('should calculate average reload time correctly', () => {
            performanceMonitor.recordReloadTime(100)
            performanceMonitor.recordReloadTime(200)
            performanceMonitor.recordReloadTime(300)

            const stats = performanceMonitor.stats
            expect(stats.reloadCount).toBe(3)
            expect(stats.totalReloadTime).toBe(600)
            expect(performanceMonitor.getAverageReloadTime()).toBe(200)
        })

        it('should track minimum and maximum reload times', () => {
            performanceMonitor.recordReloadTime(100)
            performanceMonitor.recordReloadTime(50)
            performanceMonitor.recordReloadTime(200)

            const stats = performanceMonitor.stats
            expect(stats.lastReloadTime).toBe(200)
            expect(stats.totalReloadTime).toBe(350)
        })
    })

    describe('Error Tracking', () => {
        it('should record errors', () => {
            performanceMonitor.recordError()
            performanceMonitor.recordError()

            const stats = performanceMonitor.stats
            expect(stats.errors).toBe(2)
        })

        it('should calculate error rate', () => {
            // Record 2 reloads and 1 error
            performanceMonitor.recordReloadTime(100)
            performanceMonitor.recordReloadTime(200)
            performanceMonitor.recordError()

            const stats = performanceMonitor.stats
            expect(stats.errors / stats.reloadCount).toBe(0.5) // 1 error / 2 reloads = 0.5
        })
    })

    describe('Performance Report', () => {
        it('should generate report with no activity', () => {
            const report = performanceMonitor.getReport()
            expect(report).toContain('Performance Report')
            expect(report).toContain('Reload Count: 0')
            expect(report).toContain('Errors: 0')
        })

        it('should generate report with activity', () => {
            performanceMonitor.recordReloadTime(100)
            performanceMonitor.recordReloadTime(200)
            performanceMonitor.recordError()

            const report = performanceMonitor.getReport()
            expect(report).toContain('Performance Report')
            expect(report).toContain('Reload Count: 2')
            expect(report).toContain('Errors: 1')
            expect(report).toContain('Average Reload Time: 150.00ms')
            expect(report).toContain('Last Reload: 200ms')
        })

        it('should format times correctly in report', () => {
            performanceMonitor.recordReloadTime(1234)

            const report = performanceMonitor.getReport()
            expect(report).toContain('1234ms') // Should show milliseconds
        })
    })

    describe('Stats Calculation', () => {
        it('should handle zero reloads correctly', () => {
            const stats = performanceMonitor.stats
            expect(performanceMonitor.getAverageReloadTime()).toBe(0)
            expect(stats.errors).toBe(0)
        })

        it('should handle zero errors correctly', () => {
            performanceMonitor.recordReloadTime(100)
            const stats = performanceMonitor.stats
            expect(stats.errors).toBe(0)
        })

        it('should calculate percentages correctly', () => {
            // Record 4 reloads and 1 error
            performanceMonitor.recordReloadTime(100)
            performanceMonitor.recordReloadTime(100)
            performanceMonitor.recordReloadTime(100)
            performanceMonitor.recordReloadTime(100)
            performanceMonitor.recordError()

            const stats = performanceMonitor.stats
            expect(stats.errors / stats.reloadCount).toBe(0.25) // 1 error / 4 reloads = 0.25
        })
    })

    describe('Edge Cases', () => {
        it('should handle negative reload times', () => {
            performanceMonitor.recordReloadTime(-100)
            const stats = performanceMonitor.stats
            expect(stats.totalReloadTime).toBe(-100)
            expect(performanceMonitor.getAverageReloadTime()).toBe(-100)
        })

        it('should handle very large numbers', () => {
            const largeTime = Number.MAX_SAFE_INTEGER
            performanceMonitor.recordReloadTime(largeTime)
            const stats = performanceMonitor.stats
            expect(stats.totalReloadTime).toBe(largeTime)
            expect(stats.lastReloadTime).toBe(largeTime)
        })

        it('should handle floating point reload times', () => {
            performanceMonitor.recordReloadTime(100.5)
            performanceMonitor.recordReloadTime(200.7)
            
            const stats = performanceMonitor.stats
            expect(stats.totalReloadTime).toBeCloseTo(301.2)
            expect(performanceMonitor.getAverageReloadTime()).toBeCloseTo(150.6)
        })
    })
})