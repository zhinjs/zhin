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
        fs.writeFileSync(path.join(testDir, 'test.ts'), '// test file')
        fs.writeFileSync(path.join(testDir, 'test.js'), '// test file')
        watcher = new FileWatcher(logger)
        watcher.dirs = [testDir]
    })

    afterEach(() => {
        watcher.dispose()
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true })
        }
    })

    describe('On-Demand File Watching', () => {
        it('should watch a single file', () => {
            const testFile = path.join(testDir, 'test.ts')
            const cleanup = watcher.watchFile(testFile)
            
            expect(typeof cleanup).toBe('function')
        })

        it('should not watch non-existent file', () => {
            const nonExistentFile = path.join(testDir, 'nonexistent.ts')
            const cleanup = watcher.watchFile(nonExistentFile)
            
            expect(typeof cleanup).toBe('function')
            // Cleanup should be no-op
            cleanup()
        })

        it('should stop watching file', () => {
            const testFile = path.join(testDir, 'test.ts')
            watcher.watchFile(testFile)
            
            watcher.unwatchFile(testFile)
            // Should not throw
        })

        it('should emit file-change event when file changes', async () => {
            const testFile = path.join(testDir, 'test.ts')
            
            // 确保目录和文件存在
            if (!fs.existsSync(testDir)) {
                fs.mkdirSync(testDir, { recursive: true })
            }
            if (!fs.existsSync(testFile)) {
                fs.writeFileSync(testFile, '// test file')
            }
            
            const changePromise = new Promise<void>((resolve) => {
                watcher.once('file-change', (filePath, eventType) => {
                    expect(filePath).toBe(testFile)
                    expect(['change', 'rename']).toContain(eventType)
                    resolve()
                })
            })
            
            watcher.watchFile(testFile)
            
            // Modify the file - 确保文件仍然存在再修改
            await new Promise(resolve => setTimeout(resolve, 100))
            if (fs.existsSync(testFile)) {
                fs.writeFileSync(testFile, '// modified')
            }
            
            await changePromise
        })

        it('should return no-op cleanup for already watched file', () => {
            const testFile = path.join(testDir, 'test.ts')
            watcher.watchFile(testFile)
            
            const cleanup = watcher.watchFile(testFile)
            expect(typeof cleanup).toBe('function')
            cleanup() // Should not throw
        })
    })

    describe('File Resolution', () => {
        it('should resolve relative paths', () => {
            const relativePath = './test.ts'
            const resolved = watcher.resolve(relativePath)
            expect(resolved).toBe(path.resolve(testDir, relativePath))
        })

        it('should resolve files without extension', () => {
            const withoutExt = './test'
            const resolved = watcher.resolve(withoutExt)
            expect(resolved).toMatch(/test\.(ts|js)$/)
        })

        it('should resolve package.json main entry', () => {
            const pkgDir = path.join(testDir, 'package-dir')
            fs.mkdirSync(pkgDir)
            fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ main: 'index.js' }))
            fs.writeFileSync(path.join(pkgDir, 'index.js'), '// package entry')
            
            watcher.dirs = [...watcher.dirs, pkgDir]
            const resolved = watcher.resolve('package-dir')
            expect(resolved).toContain('index.js')
        })

        it('should throw for non-existent files', () => {
            expect(() => {
                watcher.resolve('nonexistent-file')
            }).toThrow('File not found')
        })
    })

    describe('Directory Management', () => {
        it('should manage directory list', () => {
            const newDir = path.join(testDir, 'newDir')
            fs.mkdirSync(newDir)
            
            watcher.dirs = [...watcher.dirs, newDir]
            expect(watcher.dirs).toContain(newDir)
        })

        it('should clear and set new directories', () => {
            const newDir = path.join(testDir, 'newDir')
            fs.mkdirSync(newDir)
            
            watcher.dirs = [newDir]
            expect(watcher.dirs).toHaveLength(1)
            expect(watcher.dirs).toContain(newDir)
        })
    })

    describe('Cleanup', () => {
        it('should clean up all file watchers on dispose', () => {
            const testFile1 = path.join(testDir, 'test.ts')
            const testFile2 = path.join(testDir, 'test.js')
            
            watcher.watchFile(testFile1)
            watcher.watchFile(testFile2)
            
            watcher.dispose()
            // Should not throw
        })

        it('should remove all listeners on dispose', () => {
            const listener = vi.fn()
            watcher.on('file-change', listener)

            watcher.dispose()
            expect(watcher.listenerCount('file-change')).toBe(0)
        })
    })

    describe('Legacy watching method', () => {
        it('should support watching with callback', () => {
            const testFile = path.join(testDir, 'test.ts')
            const callback = vi.fn()
            
            const cleanup = watcher.watching(testFile, callback)
            expect(typeof cleanup).toBe('function')
            
            cleanup()
        })
    })
})