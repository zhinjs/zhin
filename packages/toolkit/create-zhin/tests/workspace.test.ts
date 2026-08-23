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
    const page = await fs.readFile(path.join(projectPath, 'pages', 'index.tsx'), 'utf8')
    const navigation = await fs.readFile(path.join(projectPath, 'pages', '$nav.tsx'), 'utf8')
    const footer = await fs.readFile(path.join(projectPath, 'pages', '$footer.tsx'), 'utf8')
    const schema = await fs.readJson(path.join(projectPath, 'schema.json'))
    const rootTsconfig = await fs.readJson(path.join(projectPath, 'tsconfig.json'))

    // scripts：新 runtime 启动命令
    expect(pkg.scripts.dev).toBe('zhin runtime start')
    expect(pkg.scripts.start).toBe('zhin runtime start --mode production --no-watch')

    // 依赖：用户面只直列 zhin.js + 适配器 +（卡片示例）satori；无 legacy host
    expect(pkg.dependencies['zhin.js']).toBe('latest')
    expect(pkg.dependencies['@zhin.js/adapter-sandbox']).toBe('latest')
    expect(pkg.dependencies['@zhin.js/satori']).toBe('latest')
    expect(pkg.dependencies['@zhin.js/console-contract']).toBe('latest')
    expect(pkg.dependencies['@zhin.js/page']).toBe('latest')
    expect(pkg.dependencies['@zhin.js/layout']).toBe('latest')
    expect(pkg.dependencies).not.toHaveProperty('@zhin.js/agent')
    expect(pkg.dependencies).not.toHaveProperty('@zhin.js/client')
    expect(pkg.dependencies).not.toHaveProperty('@zhin.js/pagemanager')
    expect(pkg.dependencies).not.toHaveProperty('esbuild')
    expect(pkg.dependencies).not.toHaveProperty('react')
    expect(pkg.dependencies).not.toHaveProperty('vite')
    expect(pkg.dependencies).not.toHaveProperty('@zhin.js/plugin-runtime')
    expect(pkg.dependencies).not.toHaveProperty('@zhin.js/runtime')
    expect(pkg.dependencies).not.toHaveProperty('@zhin.js/command')
    expect(pkg.dependencies).not.toHaveProperty('@zhin.js/host-api')
    expect(pkg.dependencies).not.toHaveProperty('@zhin.js/host-router')
    expect(pkg.devDependencies['@zhin.js/cli']).toBe('latest')
    expect(pkg.engines.node).toBe('>=22.6.0')

    // zhin 清单：Stable Features 随 zhin.js 默认挂载；Console Feature 显式声明
    expect(pkg.zhin.protocol).toBe(1)
    expect(pkg.zhin.type).toBe('plugin')
    expect(pkg.zhin.entry).toBe('./plugin.ts')
    expect(pkg.zhin.features).toEqual([
      { package: '@zhin.js/page', api: '^1.0.0' },
      { package: '@zhin.js/layout', api: '^1.0.0' },
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

    // 骨架文件：创作面 import 走 zhin.js 便利入口
    expect(pluginEntry).toContain("from 'zhin.js'")
    expect(pluginEntry).toContain('definePlugin(')
    expect(helloCommand).toContain("from 'zhin.js/command'")
    expect(cardCommand).toContain("from 'zhin.js/core/runtime'")
    expect(statusCard).toContain("from 'zhin.js/component'")
    expect(statusCard).toContain("from '@zhin.js/satori'")
    expect(page).toContain("from '@zhin.js/console-contract'")
    expect(page).toContain('definePage(')
    expect(navigation).toContain('NavSlotProps')
    expect(footer).toContain('FooterSlotProps')
    expect(schema).toMatchObject({ type: 'object', properties: {} })
    expect(rootTsconfig.compilerOptions.noEmit).toBe(true)
    expect(rootTsconfig.include).toContain('plugin.ts')
    expect(rootTsconfig.include).toContain('commands/**/*.ts')
    expect(rootTsconfig.include).toContain('pages/**/*.tsx')
    expect(await fs.pathExists(path.join(projectPath, '.env.example'))).toBe(true)
    expect(readme).toContain('zhin.config.yml')
    expect(readme).toContain('zhin runtime start')
    expect(readme).toContain('Remote Console')
  })

  it('creates the complete convention tree without enabling optional AI or browser tooling', async () => {
    const projectPath = await makeProject({ ai: { enabled: false } })
    const expected = [
      'schema.json',
      'commands/hello.ts',
      'components/status-card.ts',
      'middlewares/.gitkeep',
      'tools/.gitkeep',
      'skills/skill-creator/SKILL.md',
      'agents/.gitkeep',
      'pages/index.tsx',
      'pages/$nav.tsx',
      'pages/$footer.tsx',
      'plugins/.gitkeep',
      'packages/.gitkeep',
    ]
    for (const relativePath of expected) {
      await expect(fs.pathExists(path.join(projectPath, relativePath))).resolves.toBe(true)
    }

    const workspace = await fs.readFile(path.join(projectPath, 'pnpm-workspace.yaml'), 'utf8')
    expect(workspace).toContain("- 'plugins/*'")
    expect(workspace).toContain("- 'packages/*'")
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

  it('generates Windows scripts with matching encoding and interpolation-safe quoting', async () => {
    const projectPath = await makeProject()

    // Task Scheduler XML 以 UTF-8 写入，声明必须一致（否则 Windows 拒绝导入）
    const taskXml = await fs.readFile(path.join(projectPath, 'bot-task.xml'), 'utf8')
    expect(taskXml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(taskXml).not.toContain('UTF-16')

    // NSSM PowerShell 脚本：单引号防止项目名/路径中的 $ 被 PowerShell 插值
    const ps1 = await fs.readFile(path.join(projectPath, 'install-service.ps1'), 'utf8')
    expect(ps1).toContain("$ServiceName = 'bot'")
    expect(ps1).toContain(`$ProjectPath = '${path.resolve(projectPath)}'`)
    expect(ps1).not.toContain('$ServiceName = "')
    expect(ps1).not.toContain('$ProjectPath = "')
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
    expect(pkg.dependencies).not.toHaveProperty('@modelcontextprotocol/sdk')
    expect(pkg.dependencies['@ai-sdk/openai-compatible']).toBe('latest')
    expect(pkg.dependencies['@zhin.js/tool']).toBe('latest')
    expect(pkg.dependencies['@zhin.js/prompt-section']).toBe('latest')
    expect(pkg.dependencies.zod).toBe('latest')
    expect(pkg.dependencies.ai).toBe('latest')
    expect(pkg.zhin.features).toEqual([
      { package: '@zhin.js/page', api: '^1.0.0' },
      { package: '@zhin.js/layout', api: '^1.0.0' },
      { package: '@zhin.js/tool', api: '^1.0.0' },
      { package: '@zhin.js/prompt-section', api: '^1.0.0' },
    ])
    expect(await fs.pathExists(path.join(projectPath, 'tools', 'echo.ts'))).toBe(true)
    expect(await fs.pathExists(path.join(projectPath, 'SOUL.md'))).toBe(true)
    const config = await fs.readFile(path.join(projectPath, 'zhin.config.yml'), 'utf8')
    expect(config).toContain('ai:')
    expect(config).toContain('provider: ollama')
  })
})
