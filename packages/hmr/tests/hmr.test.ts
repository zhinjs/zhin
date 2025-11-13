import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { HMR } from '../src/hmr'
import { Dependency } from '../src/dependency'
import * as path from 'path'
import * as fs from 'fs'

// Create a concrete implementation of HMR for testing
class TestHMR extends HMR {
    constructor(options: any = {}) {
        super(options)
    }
    
    createDependency(name: string, filePath: string): Dependency {
        return new Dependency(this, name, filePath)
    }
    
    // Expose protected members for testing
    get testFileWatcher() {
        return this.fileWatcher
    }
}

describe('HMR', () => {
    let hmr: TestHMR
    let testDir: string

    beforeEach(() => {
        testDir = path.join(process.cwd(), 'test-workspace')
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true })
        }
        hmr = new TestHMR({
            dirs: [testDir],
            debug: false
        })
    })

    afterEach(() => {
        hmr.dispose()
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true })
        }
    })

    describe('Static Utilities', () => {
        it('should manage HMR stack', () => {
            expect(HMR.hmrStack).toContain(hmr)
            expect(HMR.currentHMR).toBe(hmr)
        })

        it('should manage dependency stack', () => {
            expect(HMR.dependencyStack).toContain(hmr)
            expect(HMR.currentDependency).toBe(hmr)
        })

        it('should get current file', () => {
            const currentFile = HMR.getCurrentFile()
            expect(currentFile).toBeTruthy()
            expect(typeof currentFile).toBe('string')
        })

        it('should get current stack', () => {
            const stack = HMR.getCurrentStack()
            expect(Array.isArray(stack)).toBe(true)
            expect(stack.length).toBeGreaterThan(0)
        })
    })

    describe('Directory Management', () => {
        it('should manage directory list', () => {
            const newDir = path.join(testDir, 'newDir')
            fs.mkdirSync(newDir)

            hmr.dirs = [...hmr.dirs, newDir]
            expect(hmr.dirs).toContain(newDir)
        })

        it('should clear and set new directories', () => {
            const newDir = path.join(testDir, 'newDir')
            fs.mkdirSync(newDir)

            hmr.dirs = [newDir]
            expect(hmr.dirs).toHaveLength(1)
            expect(hmr.dirs).toContain(newDir)
        })
    })

    describe('File Resolution', () => {
        it('should resolve relative paths', () => {
            const relativePath = './test.ts'
            const resolved = hmr.resolve(relativePath)
            expect(resolved).toBe(path.resolve(testDir, relativePath))
        })

        it('should resolve files without extension', () => {
            const withoutExt = './test'
            const resolved = hmr.resolve(withoutExt)
            expect(resolved).toMatch(/test\.(ts|js)$/)
        })

        it('should resolve package.json main entry', () => {
            const pkgDir = path.join(testDir, 'package-dir')
            fs.mkdirSync(pkgDir)
            fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ main: 'index.js' }))
            fs.writeFileSync(path.join(pkgDir, 'index.js'), '// package entry')
            
            hmr.dirs = [...hmr.dirs, pkgDir]
            const resolved = hmr.resolve('package-dir')
            expect(resolved).toContain('index.js')
        })

        it('should throw for non-existent files', () => {
            expect(() => {
                hmr.resolve('nonexistent-file')
            }).toThrow('File not found')
        })
    })
    describe('On-Demand File Watching', () => {
        it('should watch file when plugin loads', async () => {
            const testFile = path.join(testDir, 'test-plugin.ts')
            fs.writeFileSync(testFile, `
                import { Dependency } from '${path.resolve(__dirname, '../src/dependency').replace(/\\/g, '/')}'
                export default class TestPlugin extends Dependency {
                    constructor() {
                        super(null, 'test', '${testFile.replace(/\\/g, '/')}')
                    }
                }
            `)

            const cleanup = hmr.watchFile(testFile)
            expect(typeof cleanup).toBe('function')
            
            cleanup()
        })

        it('should unwatch file when plugin unloads', async () => {
            const testFile = path.join(testDir, 'test-plugin.ts')
            fs.writeFileSync(testFile, `
                import { Dependency } from '${path.resolve(__dirname, '../src/dependency').replace(/\\/g, '/')}'
                export default class TestPlugin extends Dependency {
                    constructor() {
                        super(null, 'test', '${testFile.replace(/\\/g, '/')}')
                    }
                }
            `)

            hmr.watchFile(testFile)
            hmr.unwatchFile(testFile)
            // Should not throw
        })
    })

    describe('Plugin Management', () => {
        it('should import plugin', async () => {
            const testFile = path.join(testDir, 'test-plugin.ts')
            fs.writeFileSync(testFile, `
                import { Dependency } from '${path.resolve(__dirname, '../src/dependency').replace(/\\/g, '/')}'
                export default class TestPlugin extends Dependency {
                    constructor() {
                        super(null, 'test', '${testFile.replace(/\\/g, '/')}')
                    }
                }
            `)

            const plugin = await hmr.import('test', testFile)
            expect(plugin).toBeTruthy()
            expect(plugin.name).toBe('test')
        })

        it('should find plugin by name', async () => {
            // 确保目录存在
            if (!fs.existsSync(testDir)) {
                fs.mkdirSync(testDir, { recursive: true })
            }
            
            const testFile = path.join(testDir, 'test-plugin.ts')
            fs.writeFileSync(testFile, `
                import { Dependency } from '${path.resolve(__dirname, '../src/dependency').replace(/\\/g, '/')}'
                export default class TestPlugin extends Dependency {
                    constructor() {
                        super(null, 'test', '${testFile.replace(/\\/g, '/')}')
                    }
                }
            `)

            await hmr.import('test', testFile)
            const found = hmr.findPluginByName('test')
            expect(found).toBeTruthy()
            expect(found?.name).toBe('test')
        })
    })

    describe('Performance Monitoring', () => {
        it('should get performance stats', async () => {
            const testFile = path.join(testDir, 'test-plugin.ts')
            fs.writeFileSync(testFile, `
                import { Dependency } from '${path.resolve(__dirname, '../src/dependency').replace(/\\/g, '/')}'
                export default class TestPlugin extends Dependency {
                    constructor() {
                        super(null, 'test', '${testFile.replace(/\\/g, '/')}')
                    }
                }
            `)

            await hmr.import('test', testFile)
            const stats = hmr.getPerformanceStats()
            
            expect(stats).toBeDefined()
            expect(typeof stats.reloadCount).toBe('number')
            expect(typeof stats.errors).toBe('number')
        })

        it('should get performance report', () => {
            const report = hmr.getPerformanceReport()
            expect(typeof report).toBe('string')
            expect(report).toContain('Performance Report')
        })
    })

    describe('Reload Management', () => {
        it('should get reload status', () => {
            const status = hmr.getReloadStatus()
            expect(status).toBeDefined()
            expect(typeof status.queued).toBe('number')
            expect(typeof status.processing).toBe('boolean')
        })
    })

    describe('Options Management', () => {
        it('should update options', () => {
            const newOptions = {
                debug: true,
                max_listeners: 20
            }

            hmr.updateOptions(newOptions)
            expect(hmr.options.debug).toBe(true)
            expect(hmr.options.max_listeners).toBe(20)
        })

        it('should set debug mode', () => {
            hmr.setDebugMode(true)
            expect(hmr.options.debug).toBe(true)
        })
    })

    describe('Cleanup', () => {
        it('should clean up resources on dispose', () => {
            const testInterface = hmr.getTestInterface()
            const fileWatcherDisposeSpy = vi.spyOn(testInterface.fileWatcher, 'dispose')
            const moduleLoaderDisposeSpy = vi.spyOn(testInterface.moduleLoader, 'dispose')
            const reloadManagerDisposeSpy = vi.spyOn(testInterface.reloadManager, 'dispose')

            hmr.dispose()

            expect(fileWatcherDisposeSpy).toHaveBeenCalled()
            expect(moduleLoaderDisposeSpy).toHaveBeenCalled()
            expect(reloadManagerDisposeSpy).toHaveBeenCalled()
            expect(HMR.hmrStack).not.toContain(hmr)
            expect(HMR.dependencyStack).not.toContain(hmr)
        })
    })
})