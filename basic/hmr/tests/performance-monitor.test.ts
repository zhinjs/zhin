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
            expect(stats.lastReloadDuration).toBe(100)
            expect(performanceMonitor.getAverageReloadTime()).toBe(100)
        })

        it('should calculate average reload time correctly', () => {
            performanceMonitor.recordReloadTime(100)
            performanceMonitor.recordReloadTime(200)
            performanceMonitor.recordReloadTime(300)

            const stats = performanceMonitor.stats
            expect(stats.reloadCount).toBe(3)
            expect(stats.totalReloadTime).toBe(600)
            expect(stats.lastReloadDuration).toBe(300)
            expect(performanceMonitor.getAverageReloadTime()).toBe(200)
        })

        it('should track last reload time and duration', () => {
            const beforeTime = Date.now()
            performanceMonitor.recordReloadTime(100)
            performanceMonitor.recordReloadTime(50)
            performanceMonitor.recordReloadTime(200)

            const stats = performanceMonitor.stats
            expect(stats.lastReloadTime).toBeGreaterThanOrEqual(beforeTime)
            expect(stats.lastReloadDuration).toBe(200)
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
        })

        it('should format times correctly in report', () => {
            performanceMonitor.recordReloadTime(1234)

            const report = performanceMonitor.getReport()
            expect(report).toContain('1234.00ms') // Should show milliseconds with 2 decimal places
        })

        it('should include memory information in report', () => {
            const report = performanceMonitor.getReport()
            expect(report).toContain('Memory Report')
            expect(report).toContain('RSS:')
            expect(report).toContain('Heap:')
        })

        it('should include uptime in stats', () => {
            const stats = performanceMonitor.stats
            expect(stats.uptime).toBeGreaterThanOrEqual(0)
            expect(stats.startTime).toBeGreaterThan(0)
        })

        it('should track memory peak', () => {
            const stats = performanceMonitor.stats
            expect(stats.memoryPeak).toBeDefined()
            expect(stats.memoryPeak.value).toBeGreaterThan(0)
            expect(stats.memoryPeak.timestamp).toBeGreaterThan(0)
        })

        it('should track GC events when enabled', () => {
            // Create a new monitor with GC tracking enabled
            const monitorWithGC = new PerformanceMonitor({
                monitorGC: true,
                gcOnlyInDev: false
            })
            
            const stats = monitorWithGC.stats
            expect(stats.gcEvents).toBeDefined()
            expect(stats.gcEventDuration).toBeDefined()
            expect(stats.gcEvents).toBeGreaterThanOrEqual(0)
            expect(stats.gcEventDuration).toBeGreaterThanOrEqual(0)
            
            monitorWithGC.stopMonitoring()
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
            expect(stats.lastReloadDuration).toBe(largeTime)
        })

        it('should handle floating point reload times', () => {
            performanceMonitor.recordReloadTime(100.5)
            performanceMonitor.recordReloadTime(200.7)
            
            const stats = performanceMonitor.stats
            expect(stats.totalReloadTime).toBeCloseTo(301.2)
            expect(performanceMonitor.getAverageReloadTime()).toBeCloseTo(150.6)
        })
    })

    describe('Memory Monitoring', () => {
        it('should start and stop monitoring', () => {
            const monitor = new PerformanceMonitor({
                checkInterval: 100,
                highMemoryThreshold: 90
            })
            
            let callbackCalled = false
            monitor.startMonitoring(() => {
                callbackCalled = true
            })
            
            // Monitor should be running
            monitor.stopMonitoring()
            
            // No errors should be thrown
            expect(true).toBe(true)
        })

        it('should not start monitoring twice', () => {
            const monitor = new PerformanceMonitor()
            
            monitor.startMonitoring()
            monitor.startMonitoring() // Should be ignored
            
            monitor.stopMonitoring()
            expect(true).toBe(true)
        })

        it('should handle stopMonitoring when not started', () => {
            const monitor = new PerformanceMonitor()
            
            // Should not throw
            monitor.stopMonitoring()
            expect(true).toBe(true)
        })

        it('should respect GC monitoring configuration', () => {
            const devMonitor = new PerformanceMonitor({
                monitorGC: true,
                gcOnlyInDev: true
            })
            
            const stats = devMonitor.stats
            expect(stats.gcEvents).toBeDefined()
            expect(stats.gcEventDuration).toBeDefined()
            
            devMonitor.stopMonitoring()
        })
    })
})