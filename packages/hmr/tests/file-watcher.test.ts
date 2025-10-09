import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {getLogger, Logger} from "@zhin.js/logger";
import { FileWatcher } from '../src/file-watcher'
import * as path from 'path'
import * as fs from 'fs'

describe('FileWatcher', () => {
    let watcher: FileWatcher
    let testDir: string
    let logger: Logger

    beforeEach(() => {
        testDir = path.join(process.cwd(), 'test-workspace')
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true })
        }
        logger = getLogger('test')
        fs.writeFileSync(path.join(testDir, 'test.ts'), '// console.log 已替换为注释')
        fs.writeFileSync(path.join(testDir, 'test.js'), '// console.log 已替换为注释')
        watcher = new FileWatcher([testDir], new Set(['.ts', '.js']), logger)
    })

    afterEach(() => {
        watcher.dispose()
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true })
        }
    })

    describe('Directory Management', () => {
        it('should add watch directory', () => {
            const newDir = path.join(testDir, 'newDir')
            fs.mkdirSync(newDir)
            
            const result = watcher.addWatchDir(newDir)
            expect(result).toBe(true)
            expect(watcher.getWatchDirs()).toContain(newDir)
        })

        it('should not add non-existent directory', () => {
            const nonExistentDir = path.join(testDir, 'nonexistent')
            const result = watcher.addWatchDir(nonExistentDir)
            expect(result).toBe(false)
        })

        it('should remove watch directory', () => {
            const newDir = path.join(testDir, 'newDir')
            fs.mkdirSync(newDir)
            watcher.addWatchDir(newDir)

            const result = watcher.removeWatchDir(newDir)
            expect(result).toBe(true)
            expect(watcher.getWatchDirs()).not.toContain(newDir)
        })

        it('should get watch directories', () => {
            const dirs = watcher.getWatchDirs()
            expect(dirs).toContain(testDir)
        })
    })

    describe('File Resolution', () => {
        it('should resolve relative paths', () => {
            const relativePath = './test.ts'
            const resolved = watcher.resolve(relativePath)
            expect(resolved).toBe(path.resolve(testDir, relativePath))
        })

    })


    describe('Cleanup', () => {
        it('should clean up watchers on dispose', () => {
            const testFile = path.join(testDir, 'test.ts')
            const changeCallback = vi.fn()
            watcher.watching(testFile, changeCallback)

            watcher.dispose()
            expect(watcher.getWatchDirs()).toHaveLength(0)
        })

        it('should remove all listeners on dispose', () => {
            const listener = vi.fn()
            watcher.on('file-change', listener)

            watcher.dispose()
            expect(watcher.listenerCount('file-change')).toBe(0)
        })
    })
})