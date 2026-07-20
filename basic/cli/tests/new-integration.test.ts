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
    expect(await fs.pathExists(path.join(pluginDir, 'commands', `${pluginName}.ts`))).toBe(true)
    expect(
      await fs.pathExists(path.join(pluginDir, 'commands', `${pluginName}-echo`, '[text:string].ts'))
    ).toBe(true)
    expect(await fs.pathExists(path.join(pluginDir, 'tests'))).toBe(true)
    expect(await fs.pathExists(path.join(pluginDir, 'agent', 'skills', `${pluginName}.md`))).toBe(true)
    expect(await fs.pathExists(path.join(pluginDir, 'client'))).toBe(false)
    expect(await fs.pathExists(path.join(pluginDir, 'src', 'index.ts'))).toBe(false)

    // Check package.json（zhin 清单 + 约定 files/scripts）
    const packageJsonPath = path.join(pluginDir, 'package.json')
    expect(await fs.pathExists(packageJsonPath)).toBe(true)
    const packageJson = await fs.readJson(packageJsonPath)
    expect(packageJson.name).toBe(`zhin.js-${pluginName}`)
    expect(packageJson.scripts.build).toBe('tsc')
    expect(packageJson.scripts.test).toBe('vitest run')
    expect(packageJson.scripts.prepublishOnly).toBe('pnpm run build')
    expect(packageJson.files).toContain('plugin.ts')
    expect(packageJson.files).toContain('schema.json')
    expect(packageJson.files).toContain('commands')
    expect(packageJson.files).toContain('agent')
    expect(packageJson.zhin).toMatchObject({
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      engine: '^1.0.0',
      runtime: 'trusted',
    })
    expect(packageJson.zhin.features).toEqual([
      { package: '@zhin.js/command', api: '^1.0.0' },
    ])
    expect(packageJson.dependencies['@zhin.js/plugin-runtime']).toBeDefined()
    expect(packageJson.dependencies['@zhin.js/command']).toBeDefined()

    // Check tsconfig.json（include 覆盖 plugin.ts 与约定目录）
    const tsconfigPath = path.join(pluginDir, 'tsconfig.json')
    expect(await fs.pathExists(tsconfigPath)).toBe(true)
    const tsconfig = await fs.readJson(tsconfigPath)
    expect(tsconfig.compilerOptions.target).toBe('ES2022')
    expect(tsconfig.include).toContain('plugin.ts')
    expect(tsconfig.include).toContain('src/**/*')
    expect(tsconfig.include).toContain('commands/**/*')

    // Check plugin.ts（definePlugin 裸定义）
    const pluginTs = await fs.readFile(path.join(pluginDir, 'plugin.ts'), 'utf-8')
    expect(pluginTs).toContain('definePlugin')
    expect(pluginTs).toContain('@zhin.js/plugin-runtime')
    expect(pluginTs).toContain(`name: '${pluginName}'`)
    expect(pluginTs).not.toContain('usePlugin')

    // Check commands（defineCommand + 动态段示例）
    const commandTs = await fs.readFile(
      path.join(pluginDir, 'commands', `${pluginName}.ts`),
      'utf-8'
    )
    expect(commandTs).toContain('defineCommand')
    expect(commandTs).toContain('@zhin.js/command')
    const echoTs = await fs.readFile(
      path.join(pluginDir, 'commands', `${pluginName}-echo`, '[text:string].ts'),
      'utf-8'
    )
    expect(echoTs).toContain('params.text')

    // Check schema.json（空对象 schema）
    const schema = await fs.readJson(path.join(pluginDir, 'schema.json'))
    expect(schema.type).toBe('object')
    expect(schema.properties).toEqual({})

    // Check tests/<name>-runtime.test.ts（repeater 形态的契约测试）
    const testFilePath = path.join(pluginDir, 'tests', `${pluginName}-runtime.test.ts`)
    expect(await fs.pathExists(testFilePath)).toBe(true)
    const testFile = await fs.readFile(testFilePath, 'utf-8')
    expect(testFile).toContain('parseCommandDefinition')
    expect(testFile).toContain('../plugin.ts')

    // Check README.md（新挂载方式提示）
    const readmePath = path.join(pluginDir, 'README.md')
    expect(await fs.pathExists(readmePath)).toBe(true)
    const readme = await fs.readFile(readmePath, 'utf-8')
    expect(readme).toContain(pluginName)
    expect(readme).toContain('zhin.plugins')
    expect(readme).toContain('instanceKey')

    // Check .gitignore / CHANGELOG.md / agent skill
    const gitignore = await fs.readFile(path.join(pluginDir, '.gitignore'), 'utf-8')
    expect(gitignore).toContain('node_modules/')
    expect(gitignore).toContain('lib/')
    expect(await fs.pathExists(path.join(pluginDir, 'CHANGELOG.md'))).toBe(true)

    const skillPath = path.join(pluginDir, 'agent', 'skills', `${pluginName}.md`)
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
    expect(testFile).toContain('lifecycle')
    expect(testFile).toContain('plugin.setup')

    const packageJson = await fs.readJson(path.join(pluginDir, 'package.json'))
    expect(packageJson.zhin.features).toEqual([])
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

    // adapters/<name>.ts：defineAdapter 骨架，入站经 messageGatewayToken
    const adapterTs = await fs.readFile(
      path.join(pluginDir, 'adapters', `${adapterName}.ts`),
      'utf-8'
    )
    expect(adapterTs).toContain('defineAdapter')
    expect(adapterTs).toContain('@zhin.js/adapter')
    expect(adapterTs).toContain('messageGatewayToken')
    expect(adapterTs).toContain("capabilities: ['inbound', 'outbound']")
    expect(adapterTs).toContain('async start()')
    expect(adapterTs).toContain('async stop()')
    expect(adapterTs).toContain('async send(')

    // schema.json 带 name 字段
    const schema = await fs.readJson(path.join(pluginDir, 'schema.json'))
    expect(schema.properties.name).toBeDefined()

    // package.json：adapter feature + adapter/core 依赖
    const packageJson = await fs.readJson(path.join(pluginDir, 'package.json'))
    expect(packageJson.zhin.features).toEqual([
      { package: '@zhin.js/adapter', api: '^1.0.0' },
    ])
    expect(packageJson.dependencies['@zhin.js/adapter']).toBeDefined()
    expect(packageJson.dependencies['@zhin.js/core']).toBeDefined()
    expect(packageJson.files).toContain('adapters')

    const testFilePath = path.join(pluginDir, 'tests', `${adapterName}-runtime.test.ts`)
    expect(await fs.pathExists(testFilePath)).toBe(true)
    const testFile = await fs.readFile(testFilePath, 'utf-8')
    expect(testFile).toContain('parseAdapterDefinition')
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
    const pluginTs = await fs.readFile(path.join(pluginDir, 'plugin.ts'), 'utf-8')

    // Should convert to PascalCase: MyAwesomePlugin
    expect(pluginTs).toContain('MyAwesomePlugin')
    expect(pluginTs).toContain(`name: '${pluginName}'`)
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
