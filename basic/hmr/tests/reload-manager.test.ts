import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ReloadManager } from '../src/reload-manager'
import {getLogger, Logger} from "@zhin.js/logger";

describe('ReloadManager', () => {
    let reloadManager: ReloadManager
    let logger: Logger

    beforeEach(() => {
        logger = getLogger('test')
        reloadManager = new ReloadManager(logger, 100) // 100ms debounce
    })

    afterEach(() => {
        reloadManager.dispose()
    })

    describe('Reload Queue Management', () => {
        it('should schedule file reload with debounce', async () => {
            const reloadListener = vi.fn()
            reloadManager.on('reload-file', reloadListener)

            reloadManager.scheduleReload('test.ts')
            
            // Wait for debounce
            await new Promise(resolve => setTimeout(resolve, 150))
            
            expect(reloadListener).toHaveBeenCalledWith('test.ts')
            expect(reloadListener).toHaveBeenCalledTimes(1)
        })

        it('should debounce multiple rapid reload requests', async () => {
            const reloadListener = vi.fn()
            reloadManager.on('reload-file', reloadListener)

            // Schedule multiple reloads rapidly
            reloadManager.scheduleReload('test1.ts')
            reloadManager.scheduleReload('test2.ts')
            reloadManager.scheduleReload('test3.ts')
            
            // Wait for debounce
            await new Promise(resolve => setTimeout(resolve, 150))
            
            // Should process all files but only after debounce
            expect(reloadListener).toHaveBeenCalledTimes(3)
            expect(reloadListener).toHaveBeenCalledWith('test1.ts')
            expect(reloadListener).toHaveBeenCalledWith('test2.ts')
            expect(reloadListener).toHaveBeenCalledWith('test3.ts')
        })

        it('should maintain reload order', async () => {
            const reloadedFiles: string[] = []
            reloadManager.on('reload-file', (file) => {
                reloadedFiles.push(file)
            })

            reloadManager.scheduleReload('test1.ts')
            reloadManager.scheduleReload('test2.ts')
            reloadManager.scheduleReload('test3.ts')
            
            // Wait for debounce
            await new Promise(resolve => setTimeout(resolve, 150))
            
            expect(reloadedFiles).toEqual(['test1.ts', 'test2.ts', 'test3.ts'])
        })

        it('should not reload the same file multiple times in rapid succession', async () => {
            const reloadListener = vi.fn()
            reloadManager.on('reload-file', reloadListener)

            // Schedule same file multiple times
            reloadManager.scheduleReload('test.ts')
            reloadManager.scheduleReload('test.ts')
            reloadManager.scheduleReload('test.ts')
            
            // Wait for debounce
            await new Promise(resolve => setTimeout(resolve, 150))
            
            expect(reloadListener).toHaveBeenCalledTimes(1)
            expect(reloadListener).toHaveBeenCalledWith('test.ts')
        })
    })

    describe('Status Reporting', () => {
        it('should report queue status', async () => {
            reloadManager.scheduleReload('test1.ts')
            reloadManager.scheduleReload('test2.ts')

            // Wait for files to be queued
            await new Promise(resolve => setTimeout(resolve, 50))

            // Get status before files are processed
            const status = reloadManager.getStatus()
            expect(status.pending).toBe(2)
            expect(status.processing).toBe(false)

            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 150))

            const finalStatus = reloadManager.getStatus()
            expect(finalStatus.queued).toBe(0)
            expect(finalStatus.processing).toBe(false)
        })
    })

    describe('Cleanup', () => {
        it('should clean up resources on dispose', async () => {
            const reloadListener = vi.fn()
            reloadManager.on('reload-file', reloadListener)

            reloadManager.scheduleReload('test.ts')
            reloadManager.dispose()

            // Wait for would-be debounce
            await new Promise(resolve => setTimeout(resolve, 150))
            
            // Should not process after dispose
            expect(reloadListener).not.toHaveBeenCalled()
            expect(reloadManager.listenerCount('reload-file')).toBe(0)
        })

        it('should clear queue on dispose', () => {
            reloadManager.scheduleReload('test1.ts')
            reloadManager.scheduleReload('test2.ts')
            
            reloadManager.dispose()
            
            const status = reloadManager.getStatus()
            expect(status.queued).toBe(0)
            expect(status.processing).toBe(false)
        })
    })
})