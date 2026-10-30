import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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

  it('keeps schema.json as the only config source in every template', async () => {
    for (const type of ['normal', 'service', 'adapter']) {
      const pluginName = `config-source-${type}`
      try {
        execSync(
          `node "${cliPath}" new ${pluginName} --type ${type} --skip-install`,
          { cwd: testDir, stdio: 'ignore', timeout: 10000 }
        )
      } catch {
        // Files are still created when the command exits non-zero outside a bot project.
      }
      const pluginDir = path.join(testDir, 'plugins', pluginName)
      const pluginTs = await fs.readFile(path.join(pluginDir, 'plugin.ts'), 'utf8')
      const readme = await fs.readFile(path.join(pluginDir, 'README.md'), 'utf8')

      expect(await fs.pathExists(path.join(pluginDir, 'schema.json'))).toBe(true)
      expect(pluginTs).not.toMatch(/^\s*config\s*:/mu)
      expect(pluginTs).toContain('请先删除 schema.json，两者同时存在会拒绝启动')
      expect(readme).toContain('也是本插件唯一的配置声明')
      expect(readme).toContain('两者同时存在会拒绝启动')
    }
  })

  it('should create normal plugin with convention-based structure', async () => {
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

    // Check directory structure（约定式：无 client/dist/lib/src/index.ts）
    expect(await fs.pathExists(pluginDir)).toBe(true)
    expect(await fs.pathExists(path.join(pluginDir, 'plugin.ts'))).toBe(true)
    expect(await fs.pathExists(path.join(pluginDir, 'schema.json'))).toBe(true)
    expect(await fs.pathExists(path.join(pluginDir, 'commands', pluginName, 'index.ts'))).toBe(true)
    expect(await fs.pathExists(path.join(pluginDir, 'commands', `${pluginName}.ts`))).toBe(false)
    expect(
      await fs.pathExists(path.join(pluginDir, 'commands', `${pluginName}-echo`, '[text]', 'index.ts'))
    ).toBe(true)
    expect(await fs.pathExists(path.join(pluginDir, 'tests'))).toBe(true)
    expect(await fs.pathExists(path.join(pluginDir, 'skills', pluginName, 'SKILL.md'))).toBe(true)
    expect(await fs.pathExists(path.join(pluginDir, 'agent', 'skills'))).toBe(false)
    expect(await fs.pathExists(path.join(pluginDir, 'client'))).toBe(false)
    expect(await fs.pathExists(path.join(pluginDir, 'src', 'index.ts'))).toBe(true)
    expect(await fs.pathExists(path.join(pluginDir, 'scripts', 'build-runtime-entries.mjs'))).toBe(true)

    // Check package.json（zhin 清单 + 约定 files/scripts）
    const packageJsonPath = path.join(pluginDir, 'package.json')
    expect(await fs.pathExists(packageJsonPath)).toBe(true)
    const packageJson = await fs.readJson(packageJsonPath)
    expect(packageJson.name).toBe(`zhin.js-${pluginName}`)
    expect(packageJson.scripts.build).toBe('tsc -p tsconfig.build.json')
    expect(packageJson.scripts.typecheck).toBe('tsc --noEmit')
    expect(packageJson.scripts.test).toBe('vitest run')
    expect(packageJson.scripts.prepack).toBe('pnpm run build && node scripts/build-runtime-entries.mjs')
    expect(packageJson.scripts.postpack).toBe('node scripts/build-runtime-entries.mjs --clean')
    expect(packageJson.files).toContain('lib')
    expect(packageJson.files).toContain('plugin.js')
    expect(packageJson.files).not.toContain('plugin.ts')
    expect(packageJson.files).not.toContain('src')
    expect(packageJson.files).toContain('schema.json')
    expect(packageJson.files).toContain('commands/**/*.js')
    expect(packageJson.files).toContain('skills')
    expect(packageJson.exports['.']).toEqual({ types: './lib/index.d.ts', import: './lib/index.js' })
    expect(packageJson.types).toBe('./lib/index.d.ts')
    expect(packageJson.zhin).toMatchObject({
      protocol: 1,
      type: 'plugin',
      entry: './plugin.js',
      engine: '^1.0.0',
      runtime: 'trusted',
    })
    expect(packageJson.zhin.features).toEqual([
      { package: '@zhin.js/skill', api: '^1.0.0' },
      { package: '@zhin.js/command', api: '^1.0.0' },
    ])
    expect(packageJson.dependencies).toBeUndefined()
    expect(packageJson.peerDependencies?.['@zhin.js/skill']).toBeDefined()
    expect(packageJson.peerDependenciesMeta?.['@zhin.js/skill']?.optional).toBe(true)
    expect(packageJson.peerDependencies?.['zhin.js']).toMatch(/^\^\d+\.\d+\.\d+$/)
    expect(JSON.stringify(packageJson)).not.toContain('"latest"')
    expect(packageJson.peerDependencies?.['@zhin.js/command']).toBeDefined()
    expect(packageJson.peerDependenciesMeta?.['@zhin.js/command']?.optional).toBe(true)
    expect(packageJson.devDependencies?.['@zhin.js/command']).toBe(packageJson.peerDependencies['@zhin.js/command'])

    // Check tsconfig.json（include 覆盖 plugin.ts 与约定目录）
    const tsconfigPath = path.join(pluginDir, 'tsconfig.json')
    expect(await fs.pathExists(tsconfigPath)).toBe(true)
    const tsconfig = await fs.readJson(tsconfigPath)
    expect(tsconfig.compilerOptions.target).toBe('ES2022')
    expect(tsconfig.include).toContain('plugin.ts')
    expect(tsconfig.include).toContain('src/**/*')
    expect(tsconfig.include).toContain('commands/**/*')
    expect(tsconfig.include).toContain('tests/**/*')
    const buildTsconfig = await fs.readJson(path.join(pluginDir, 'tsconfig.build.json'))
    expect(buildTsconfig.compilerOptions.noEmit).toBe(false)
    expect(buildTsconfig.compilerOptions.outDir).toBe('./lib')
    expect(buildTsconfig.compilerOptions.rootDir).toBe('./src')
    expect(buildTsconfig.compilerOptions.declaration).toBe(true)
    expect(buildTsconfig.include).toEqual(['src/**/*'])

    // Check plugin.ts（definePlugin 裸定义）
    const pluginTs = await fs.readFile(path.join(pluginDir, 'plugin.ts'), 'utf-8')
    expect(pluginTs).toContain('definePlugin')
    expect(pluginTs).toContain('zhin.js')
    expect(pluginTs).toContain(`name: '${pluginName}'`)
    expect(pluginTs).not.toContain('usePlugin')

    // Check commands（defineCommand + 动态段示例）
    const commandTs = await fs.readFile(
      path.join(pluginDir, 'commands', pluginName, 'index.ts'),
      'utf-8'
    )
    expect(commandTs).toContain('defineCommand')
    expect(commandTs).toContain('zhin.js/command')
    const echoTs = await fs.readFile(
      path.join(pluginDir, 'commands', `${pluginName}-echo`, '[text]', 'index.ts'),
      'utf-8'
    )
    expect(echoTs).toContain('params.text')
    expect(echoTs).toContain("from '../../../src/index.js'")
    expect(echoTs).toContain("text: { type: 'string', description: '要回显的文本' }")
    // Typed config without losing params inference (#857)
    expect(echoTs).toContain(`defineCommand.withConfig<TestNormalPluginConfig>()({`)
    expect(echoTs).toContain('config.echoPrefix')
    const libraryTs = await fs.readFile(path.join(pluginDir, 'src', 'index.ts'), 'utf-8')
    expect(libraryTs).toContain(`export interface TestNormalPluginConfig`)

    // Check schema.json（与 src/index.ts 的 Config 一致）
    const schema = await fs.readJson(path.join(pluginDir, 'schema.json'))
    expect(schema.type).toBe('object')
    expect(Object.keys(schema.properties)).toEqual(['echoPrefix'])
    expect(schema.properties.echoPrefix).toMatchObject({ type: 'string', default: '你说：' })

    // Check tests/<name>-runtime.test.ts（repeater 形态的契约测试）
    const testFilePath = path.join(pluginDir, 'tests', `${pluginName}-runtime.test.ts`)
    expect(await fs.pathExists(testFilePath)).toBe(true)
    const testFile = await fs.readFile(testFilePath, 'utf-8')
    expect(testFile).toContain('parseCommandDefinition')
    expect(testFile).toContain('../plugin.ts')
    expect(testFile).toContain(`source: echoSource`)
    expect(testFile).toContain(`new URL('../commands/${pluginName}-echo/[text]/index.ts', import.meta.url)`)

    // Check README.md（新挂载方式提示）
    const readmePath = path.join(pluginDir, 'README.md')
    expect(await fs.pathExists(readmePath)).toBe(true)
    const readme = await fs.readFile(readmePath, 'utf-8')
    expect(readme).toContain(pluginName)
    expect(readme).toContain('configVersion: 2')
    expect(readme).toContain('instanceKey')

    // Check .gitignore / CHANGELOG.md / agent skill
    const gitignore = await fs.readFile(path.join(pluginDir, '.gitignore'), 'utf-8')
    expect(gitignore).toContain('node_modules/')
    expect(gitignore).toContain('lib/')
    expect(gitignore).toContain('.zhin/')
    expect(gitignore).toContain('plugin.js')
    expect(gitignore).toContain('commands/**/*.js')
    expect(await fs.pathExists(path.join(pluginDir, 'CHANGELOG.md'))).toBe(true)

    const skillPath = path.join(pluginDir, 'skills', pluginName, 'SKILL.md')
    const skillMd = await fs.readFile(skillPath, 'utf-8')
    expect(skillMd).toContain(`name: ${pluginName}`)
    expect(skillMd).toContain('description:')
  }, 30000)

  it('should create service plugin with setup lifecycle template', async () => {
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

    // plugin.ts：setup(context) + databaseHostToken 资源提示 + lifecycle dispose
    const pluginTs = await fs.readFile(path.join(pluginDir, 'plugin.ts'), 'utf-8')
    expect(pluginTs).toContain('definePlugin')
    expect(pluginTs).toContain('setup(context)')
    expect(pluginTs).toContain('databaseHostToken')
    expect(pluginTs).toContain('context.lifecycle.add')

    // 服务类型不生成 commands/adapters 约定目录
    expect(await fs.pathExists(path.join(pluginDir, 'commands'))).toBe(false)
    expect(await fs.pathExists(path.join(pluginDir, 'adapters'))).toBe(false)

    const testFilePath = path.join(pluginDir, 'tests', `${serviceName}-runtime.test.ts`)
    expect(await fs.pathExists(testFilePath)).toBe(true)
    const testFile = await fs.readFile(testFilePath, 'utf-8')
    expect(testFile).toContain("from '@zhin.js/testing'")
    expect(testFile).toContain('runPluginSetup(plugin)')
    expect(testFile).toContain('fake.dispose()')
    expect(testFile).not.toContain('as never')

    const packageJson = await fs.readJson(path.join(pluginDir, 'package.json'))
    expect(packageJson.zhin.features).toEqual([
      { package: '@zhin.js/skill', api: '^1.0.0' },
    ])
  }, 30000)

  it('should create adapter plugin with defineAdapter skeleton', async () => {
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

    // Native Client inheritance, Adapter ownership and framework-namespaced ingress.
    const adapterTs = await fs.readFile(
      path.join(pluginDir, 'adapters', adapterName, 'index.ts'),
      'utf-8'
    )
    expect(await fs.pathExists(path.join(pluginDir, 'adapters', `${adapterName}.ts`))).toBe(false)
    expect(adapterTs).toContain('defineAdapter')
    expect(adapterTs).toContain('zhin.js/adapter')
    const publicAdapterTs = await fs.readFile(path.join(pluginDir, 'src', 'adapter.ts'), 'utf8')
    const publicIndexTs = await fs.readFile(path.join(pluginDir, 'src', 'index.ts'), 'utf8')
    expect(publicIndexTs).toContain("export * from './adapter.js'")
    expect(publicAdapterTs).toContain('extends TestAdapterClient implements Endpoint')
    expect(publicAdapterTs).toContain('extends Adapter<TestAdapterEndpoint, TestAdapterAdapterConfig>')
    expect(publicAdapterTs).toContain('events.run(() => events.message(message))')
    expect(publicAdapterTs).toContain("declare module 'zhin.js/adapter'")
    expect(publicAdapterTs).not.toContain('extends Endpoint<')
    expect(publicAdapterTs).toContain('async connect(')
    expect(publicAdapterTs).toContain('async disconnect()')
    expect(publicAdapterTs).toContain('async send(')
    expect(adapterTs).toContain("from '../../src/adapter.js'")
    expect(adapterTs).toContain('createAdapter:')
    expect(adapterTs).toContain("capabilities: ['inbound', 'outbound']")
    expect(adapterTs).not.toContain('export class ')
    expect(adapterTs).not.toContain('interface AdapterRegistry')

    // schema.json 使用 endpoint 的稳定 id 字段
    const schema = await fs.readJson(path.join(pluginDir, 'schema.json'))
    expect(schema.properties.id).toBeDefined()
    expect(schema.properties.name).toBeUndefined()

    // package.json：adapter feature + adapter/core 依赖
    const packageJson = await fs.readJson(path.join(pluginDir, 'package.json'))
    expect(packageJson.zhin.features).toEqual([
      { package: '@zhin.js/skill', api: '^1.0.0' },
      { package: '@zhin.js/adapter', api: '^1.0.0' },
    ])
    expect(packageJson.dependencies).toBeUndefined()
    expect(packageJson.peerDependencies['@zhin.js/adapter']).toBeDefined()
    expect(packageJson.peerDependenciesMeta['@zhin.js/adapter']).toEqual({ optional: true })
    expect(packageJson.peerDependencies['@zhin.js/core']).toBeUndefined()
    expect(packageJson.files).toContain('adapters/**/*.js')

    const testFilePath = path.join(pluginDir, 'tests', `${adapterName}-runtime.test.ts`)
    expect(await fs.pathExists(testFilePath)).toBe(true)
    const testFile = await fs.readFile(testFilePath, 'utf-8')
    expect(testFile).toContain('parseAdapterDefinition')
    expect(testFile).toContain("from '../src/index.js'")
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
    const libraryTs = await fs.readFile(path.join(pluginDir, 'src', 'index.ts'), 'utf-8')

    // Should convert to PascalCase: MyAwesomePlugin (displayName lives in src/, imported by plugin.ts)
    expect(libraryTs).toContain('MyAwesomePlugin')
    const pluginTs = await fs.readFile(path.join(pluginDir, 'plugin.ts'), 'utf-8')
    expect(pluginTs).toContain("import { displayName } from './src/index.js'")
    expect(pluginTs).toContain(`name: '${pluginName}'`)
  }, 30000)

  it('--standalone creates ./<name>/ without touching any app', async () => {
    const pluginName = 'standalone-demo'
    // 一个与插件无关的宿主 package.json：standalone 不应修改它
    const hostManifest = { name: 'unrelated-host', version: '1.0.0' }
    await fs.writeJson(path.join(testDir, 'package.json'), hostManifest)

    execSync(
      `node "${cliPath}" new ${pluginName} --standalone --type normal --skip-install`,
      { cwd: testDir, stdio: 'ignore', timeout: 10000 }
    )

    const pluginDir = path.join(testDir, pluginName)
    expect(await fs.pathExists(path.join(testDir, 'plugins'))).toBe(false)
    expect(await fs.readJson(path.join(testDir, 'package.json'))).toEqual(hostManifest)

    // Plugin Runtime 契约：清单 + definePlugin + 约定目录 + 测试 + README
    const pkg = await fs.readJson(path.join(pluginDir, 'package.json'))
    expect(pkg.name).toBe(`zhin.js-${pluginName}`)
    expect(pkg.zhin).toMatchObject({ protocol: 1, type: 'plugin', entry: './plugin.js' })
    expect(pkg.files).toContain('plugin.js')
    expect(pkg.scripts.prepack).toBe('pnpm run build && node scripts/build-runtime-entries.mjs')
    expect(pkg.scripts.test).toBe('vitest run')
    const pluginTs = await fs.readFile(path.join(pluginDir, 'plugin.ts'), 'utf-8')
    expect(pluginTs).toContain('export default definePlugin(')
    expect(await fs.pathExists(path.join(pluginDir, 'commands', pluginName, 'index.ts'))).toBe(true)
    expect(await fs.pathExists(path.join(pluginDir, 'tests', `${pluginName}-runtime.test.ts`))).toBe(true)
    const readme = await fs.readFile(path.join(pluginDir, 'README.md'), 'utf-8')
    expect(readme).toContain('configVersion: 2')
    expect(readme).not.toContain(`pnpm add ../${pluginName}`)
    expect(readme).toContain('local-dev#dev-link-plugin')
    expect(readme).toContain(`zhin dev link`)
    expect(readme).toContain('npx @zhin.js/cli pub --dry-run')
  }, 30000)

  it('fails fast instead of prompting when stdin is not a TTY', async () => {
    let failure: { status?: number; stderr?: Buffer; stdout?: Buffer } | undefined
    try {
      execSync(`node "${cliPath}" new no-type-demo --standalone --skip-install`, {
        cwd: testDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10000,
      })
    } catch (error) {
      failure = error as typeof failure
    }
    expect(failure?.status).toBe(1)
    expect(`${failure?.stdout ?? ''}${failure?.stderr ?? ''}`).toContain('--type')
    expect(await fs.pathExists(path.join(testDir, 'no-type-demo'))).toBe(false)
  }, 30000)

  it('should reject invalid plugin identity names', async () => {
    const pluginName = 'My_Plugin'

    let failed = false
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
      failed = true
    }

    expect(failed).toBe(true)
    expect(await fs.pathExists(path.join(testDir, 'plugins', pluginName))).toBe(false)
  }, 30000)
})
