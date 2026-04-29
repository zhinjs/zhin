import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs-extra'
import * as path from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'

describe('CLI new command integration', () => {
  let testDir: string
  const cliPath = path.resolve(__dirname, '../lib/cli.js')

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `zhin-cli-integration-${Date.now()}`)
    await fs.ensureDir(testDir)
  })

  afterEach(async () => {
    try {
      await fs.remove(testDir)
    } catch (error) {
      // Ignore cleanup errors
    }
  })

  it('should create normal plugin with all files', async () => {
    const pluginName = 'test-normal-plugin'
    
    try {
      execSync(
        `node "${cliPath}" new ${pluginName} --type normal --skip-install`,
        {
          cwd: testDir,
          stdio: 'ignore',
          timeout: 10000
        }
      )
    } catch (error: any) {
      // Command might exit with code 1 due to missing package.json, but files should be created
    }

    const pluginDir = path.join(testDir, 'plugins', pluginName)
    
    // Check directory structure
    expect(await fs.pathExists(pluginDir)).toBe(true)
    expect(await fs.pathExists(path.join(pluginDir, 'src'))).toBe(true)
    expect(await fs.pathExists(path.join(pluginDir, 'tests'))).toBe(true)
    expect(await fs.pathExists(path.join(pluginDir, 'client'))).toBe(true)
    expect(await fs.pathExists(path.join(pluginDir, 'lib'))).toBe(true)
    expect(await fs.pathExists(path.join(pluginDir, 'dist'))).toBe(true)
    expect(await fs.pathExists(path.join(pluginDir, 'skills', pluginName))).toBe(true)

    // Check package.json
    const packageJsonPath = path.join(pluginDir, 'package.json')
    expect(await fs.pathExists(packageJsonPath)).toBe(true)
    const packageJson = await fs.readJson(packageJsonPath)
    expect(packageJson.name).toBe(`zhin.js-${pluginName}`)
    expect(packageJson.scripts.test).toBe('vitest run')
    expect(packageJson.scripts['test:watch']).toBe('vitest')
    expect(packageJson.scripts['test:coverage']).toBe('vitest run --coverage')
    expect(packageJson.devDependencies.vitest).toBe('latest')
    expect(packageJson.devDependencies['@vitest/coverage-v8']).toBe('latest')

    // Check tsconfig.json
    const tsconfigPath = path.join(pluginDir, 'tsconfig.json')
    expect(await fs.pathExists(tsconfigPath)).toBe(true)
    const tsconfig = await fs.readJson(tsconfigPath)
    expect(tsconfig.compilerOptions.target).toBe('ES2022')
    expect(tsconfig.compilerOptions.module).toBe('ESNext')

    // Check src/index.ts
    const srcIndexPath = path.join(pluginDir, 'src', 'index.ts')
    expect(await fs.pathExists(srcIndexPath)).toBe(true)
    const srcIndex = await fs.readFile(srcIndexPath, 'utf-8')
    expect(srcIndex).toContain('usePlugin')
    expect(srcIndex).toContain('useContext')

    // Check tests/index.test.ts
    const testFilePath = path.join(pluginDir, 'tests', 'index.test.ts')
    expect(await fs.pathExists(testFilePath)).toBe(true)
    const testFile = await fs.readFile(testFilePath, 'utf-8')
    expect(testFile).toContain('describe')
    expect(testFile).toContain('Plugin Instance')
    expect(testFile).toContain('Plugin Lifecycle')
    expect(testFile).toContain('Plugin Features')
    expect(testFile).toContain('Custom Tests')
    expect(testFile).toContain('zhin.js')

    // Check README.md
    const readmePath = path.join(pluginDir, 'README.md')
    expect(await fs.pathExists(readmePath)).toBe(true)
    const readme = await fs.readFile(readmePath, 'utf-8')
    expect(readme).toContain(pluginName)

    // Check .gitignore
    const gitignorePath = path.join(pluginDir, '.gitignore')
    expect(await fs.pathExists(gitignorePath)).toBe(true)
    const gitignore = await fs.readFile(gitignorePath, 'utf-8')
    expect(gitignore).toContain('node_modules/')
    expect(gitignore).toContain('lib/')
    expect(gitignore).toContain('dist/')

    // Check CHANGELOG.md
    const changelogPath = path.join(pluginDir, 'CHANGELOG.md')
    expect(await fs.pathExists(changelogPath)).toBe(true)

    // Check SKILL.md
    const skillPath = path.join(pluginDir, 'skills', pluginName, 'SKILL.md')
    expect(await fs.pathExists(skillPath)).toBe(true)
    const skillMd = await fs.readFile(skillPath, 'utf-8')
    expect(skillMd).toContain(`name: ${pluginName}`)
    expect(skillMd).toContain('description:')

    // Check client files
    const clientIndexPath = path.join(pluginDir, 'client', 'index.tsx')
    expect(await fs.pathExists(clientIndexPath)).toBe(true)
    const clientIndex = await fs.readFile(clientIndexPath, 'utf-8')
    expect(clientIndex).toContain('addRoute')
    expect(clientIndex).toContain('@zhin.js/console-types')

    const clientTsconfigPath = path.join(pluginDir, 'client', 'tsconfig.json')
    expect(await fs.pathExists(clientTsconfigPath)).toBe(true)
  }, 30000)

  it('should create service plugin with service test template', async () => {
    const serviceName = 'test-service'
    
    try {
      execSync(
        `node "${cliPath}" new ${serviceName} --type service --skip-install`,
        {
          cwd: testDir,
          stdio: 'ignore',
          timeout: 10000
        }
      )
    } catch (error: any) {
      // Ignore exit code
    }

    const pluginDir = path.join(testDir, 'plugins', serviceName)
    const testFilePath = path.join(pluginDir, 'tests', 'index.test.ts')
    
    expect(await fs.pathExists(testFilePath)).toBe(true)
    const testFile = await fs.readFile(testFilePath, 'utf-8')
    
    // Service test：工厂 + ping（不依赖 Bot 运行时）
    expect(testFile).toContain('createTestServiceService')
    expect(testFile).toContain('ping returns pong')
    expect(testFile).toContain('TestService service')
    expect(testFile).toContain("../src/service.js")
  }, 30000)

  it('should create adapter plugin with adapter test template', async () => {
    const adapterName = 'test-adapter'
    
    try {
      execSync(
        `node "${cliPath}" new ${adapterName} --type adapter --skip-install`,
        {
          cwd: testDir,
          stdio: 'ignore',
          timeout: 10000
        }
      )
    } catch (error: any) {
      // Ignore exit code
    }

    const pluginDir = path.join(testDir, 'plugins', adapterName)
    const testFilePath = path.join(pluginDir, 'tests', 'index.test.ts')
    
    expect(await fs.pathExists(testFilePath)).toBe(true)
    const testFile = await fs.readFile(testFilePath, 'utf-8')
    
    // Adapter test：真实 Adapter/Bot 构造与 createBot
    expect(testFile).toContain('TestAdapterAdapter')
    expect(testFile).toContain('TestAdapterBot')
    expect(testFile).toContain('TestAdapter adapter')
    expect(testFile).toContain('constructs with empty config')
    expect(testFile).toContain('createBot wires')
    expect(testFile).toContain('unit-test-bot')
  }, 30000)

  it('should create official plugin with @zhin.js scope', async () => {
    const pluginName = 'official-plugin'
    
    try {
      execSync(
        `node "${cliPath}" new ${pluginName} --type normal --is-official --skip-install`,
        {
          cwd: testDir,
          stdio: 'ignore',
          timeout: 10000
        }
      )
    } catch (error: any) {
      // Ignore exit code
    }

    const pluginDir = path.join(testDir, 'plugins', pluginName)
    const packageJsonPath = path.join(pluginDir, 'package.json')
    
    expect(await fs.pathExists(packageJsonPath)).toBe(true)
    const packageJson = await fs.readJson(packageJsonPath)
    expect(packageJson.name).toBe(`@zhin.js/${pluginName}`)
  }, 30000)

  it('should handle plugin name with hyphens', async () => {
    const pluginName = 'my-awesome-plugin'
    
    try {
      execSync(
        `node "${cliPath}" new ${pluginName} --type normal --skip-install`,
        {
          cwd: testDir,
          stdio: 'ignore',
          timeout: 10000
        }
      )
    } catch (error: any) {
      // Ignore exit code
    }

    const pluginDir = path.join(testDir, 'plugins', pluginName)
    const srcIndexPath = path.join(pluginDir, 'src', 'index.ts')
    
    expect(await fs.pathExists(srcIndexPath)).toBe(true)
    const srcIndex = await fs.readFile(srcIndexPath, 'utf-8')
    
    // Should convert to PascalCase: MyAwesomePlugin
    expect(srcIndex).toContain('MyAwesomePlugin')
  }, 30000)
})
