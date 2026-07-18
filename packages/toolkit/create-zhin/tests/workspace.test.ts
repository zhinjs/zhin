import fs from 'fs-extra'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BASE_SKILL_NAMES, DEV_SKILL_NAMES, createWorkspace } from '../src/workspace'
import type { InitOptions } from '../src/types'

const tmpRoots: string[] = []

async function makeProject(options: Partial<InitOptions> = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-zhin-test-'))
  tmpRoots.push(root)
  const projectPath = path.join(root, 'bot')
  const initOptions: InitOptions = {
    config: 'yaml',
    runtime: 'node',
    httpToken: 'test-token',
    yes: true,
    database: {
      dialect: 'sqlite',
      filename: './data/bot.db',
      mode: 'wal',
    },
    adapters: {
      packages: ['@zhin.js/adapter-sandbox'],
      plugins: ['@zhin.js/adapter-sandbox'],
      instances: [{
        package: '@zhin.js/adapter-sandbox',
        instanceKey: 'sandbox',
        config: { endpoints: [{ context: 'sandbox', name: 'sandbox-bot', owner: 'sandbox-user' }] },
      }],
      envVars: {},
    },
    ai: { enabled: false },
    devSkills: true,
    installGlobalCli: false,
    ...options,
  }

  await createWorkspace(projectPath, 'bot', initOptions)
  return projectPath
}

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map(root => fs.remove(root)))
})

describe('createWorkspace', () => {
  it('copies every advertised built-in and development skill', async () => {
    const projectPath = await makeProject()
    const skillNames = [...BASE_SKILL_NAMES, ...DEV_SKILL_NAMES]

    for (const skillName of skillNames) {
      await expect(fs.pathExists(path.join(projectPath, 'skills', skillName, 'SKILL.md'))).resolves.toBe(true)
    }
  })

  it('generates a Plugin Runtime project aligned with minimal-bot conventions', async () => {
    const projectPath = await makeProject()
    const pkg = await fs.readJson(path.join(projectPath, 'package.json'))
    const config = await fs.readFile(path.join(projectPath, 'zhin.config.yml'), 'utf8')
    const readme = await fs.readFile(path.join(projectPath, 'README.md'), 'utf8')
    const pluginEntry = await fs.readFile(path.join(projectPath, 'plugin.ts'), 'utf8')
    const helloCommand = await fs.readFile(path.join(projectPath, 'commands', 'hello.ts'), 'utf8')
    const cardCommand = await fs.readFile(path.join(projectPath, 'commands', 'card.ts'), 'utf8')
    const statusCard = await fs.readFile(path.join(projectPath, 'components', 'status-card.ts'), 'utf8')
    const schema = await fs.readJson(path.join(projectPath, 'schema.json'))
    const rootTsconfig = await fs.readJson(path.join(projectPath, 'tsconfig.json'))

    // scripts：新 runtime 启动命令
    expect(pkg.scripts.dev).toBe('zhin runtime start')
    expect(pkg.scripts.start).toBe('zhin runtime start --mode production --no-watch')

    // 依赖：新栈，无 legacy host 插件
    expect(pkg.dependencies['zhin.js']).toBe('latest')
    expect(pkg.dependencies['@zhin.js/plugin-runtime']).toBe('latest')
    expect(pkg.dependencies['@zhin.js/runtime']).toBe('latest')
    expect(pkg.dependencies['@zhin.js/adapter']).toBe('latest')
    expect(pkg.dependencies['@zhin.js/command']).toBe('latest')
    expect(pkg.dependencies['@zhin.js/component']).toBe('latest')
    expect(pkg.dependencies['@zhin.js/satori']).toBe('latest')
    expect(pkg.dependencies['@zhin.js/adapter-sandbox']).toBe('latest')
    expect(pkg.dependencies).not.toHaveProperty('@zhin.js/host-api')
    expect(pkg.dependencies).not.toHaveProperty('@zhin.js/host-router')
    expect(pkg.devDependencies['@zhin.js/cli']).toBe('latest')
    expect(pkg.engines.node).toBe('>=22.6.0')

    // zhin 清单：protocol 1 + features + plugins
    expect(pkg.zhin.protocol).toBe(1)
    expect(pkg.zhin.type).toBe('plugin')
    expect(pkg.zhin.entry).toBe('./plugin.ts')
    expect(pkg.zhin.features).toEqual([
      { package: '@zhin.js/adapter', api: '^1.0.0' },
      { package: '@zhin.js/command', api: '^1.0.0' },
      { package: '@zhin.js/component', api: '^1.0.0' },
    ])
    expect(pkg.zhin.plugins).toEqual([
      { package: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox' },
    ])

    // 配置：新 runtime 格式
    expect(config).toContain('http:')
    expect(config).toContain('corsOrigins:')
    expect(config).toContain('https://console.zhin.dev')
    expect(config).toContain('plugins:')
    expect(config).toContain('sandbox:')
    expect(config).toContain('database:')
    expect(config).not.toMatch(/^endpoints:/m)
    expect(config).not.toContain('inbox:')

    // 骨架文件
    expect(pluginEntry).toContain("from '@zhin.js/plugin-runtime'")
    expect(pluginEntry).toContain('definePlugin(')
    expect(helloCommand).toContain("from '@zhin.js/command'")
    expect(cardCommand).toContain("from '@zhin.js/core/runtime'")
    expect(statusCard).toContain("from '@zhin.js/component'")
    expect(statusCard).toContain("from '@zhin.js/satori'")
    expect(schema).toMatchObject({ type: 'object', properties: {} })
    expect(rootTsconfig.compilerOptions.noEmit).toBe(true)
    expect(rootTsconfig.include).toContain('plugin.ts')
    expect(rootTsconfig.include).toContain('commands/**/*.ts')
    expect(await fs.pathExists(path.join(projectPath, '.env.example'))).toBe(true)
    expect(readme).toContain('zhin.config.yml')
    expect(readme).toContain('zhin runtime start')
    expect(readme).toContain('Remote Console')
  })

  it('uses the real generated config filename for JSON projects', async () => {
    const projectPath = await makeProject({ config: 'json' })
    const readme = await fs.readFile(path.join(projectPath, 'README.md'), 'utf8')

    expect(await fs.pathExists(path.join(projectPath, 'zhin.config.json'))).toBe(true)
    expect(readme).toContain('zhin.config.json')
    const parsed = await fs.readJson(path.join(projectPath, 'zhin.config.json'))
    expect(parsed.plugins.sandbox).toBeDefined()
    expect(parsed.http.token).toBe('${HTTP_TOKEN}')
  })

  it('writes AI stack dependencies and tool feature when AI is enabled', async () => {
    const projectPath = await makeProject({
      ai: {
        enabled: true,
        agentProvider: 'ollama',
        providers: { ollama: { host: 'http://127.0.0.1:11434' } },
      },
    })
    const pkg = await fs.readJson(path.join(projectPath, 'package.json'))
    expect(pkg.dependencies['@zhin.js/agent']).toBe('latest')
    expect(pkg.dependencies['@modelcontextprotocol/sdk']).toBe('latest')
    expect(pkg.dependencies['@ai-sdk/openai-compatible']).toBe('latest')
    expect(pkg.dependencies['@zhin.js/tool']).toBe('latest')
    expect(pkg.dependencies.zod).toBe('latest')
    expect(pkg.dependencies.ai).toBe('latest')
    expect(pkg.zhin.features).toContainEqual({ package: '@zhin.js/tool', api: '^1.0.0' })
    expect(await fs.pathExists(path.join(projectPath, 'tools', 'echo.ts'))).toBe(true)
    expect(await fs.pathExists(path.join(projectPath, 'SOUL.md'))).toBe(true)
    const config = await fs.readFile(path.join(projectPath, 'zhin.config.yml'), 'utf8')
    expect(config).toContain('ai:')
    expect(config).toContain('provider: ollama')
  })
})
