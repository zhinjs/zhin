import fs from 'fs-extra'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BASE_SKILL_NAMES, DEV_SKILL_NAMES, createWorkspace } from '../src/workspace'
import { MCP_SDK_VERSION } from '@zhin.js/scaffold-wizard'
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
      endpoints: [],
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

  it('generates a default Host workspace with config, env, README, and package dependencies aligned', async () => {
    const projectPath = await makeProject()
    const pkg = await fs.readJson(path.join(projectPath, 'package.json'))
    const config = await fs.readFile(path.join(projectPath, 'zhin.config.yml'), 'utf8')
    const readme = await fs.readFile(path.join(projectPath, 'README.md'), 'utf8')
    const clientTsconfig = await fs.readJson(path.join(projectPath, 'client', 'tsconfig.json'))
    const examplePlugin = await fs.readFile(path.join(projectPath, 'src', 'plugins', 'example.ts'), 'utf8')

    expect(pkg.dependencies).toHaveProperty('@zhin.js/host-api')
    expect(pkg.dependencies).toHaveProperty('@zhin.js/host-router')
    expect(pkg.engines.node).toBe('^20.19.0 || >=22.12.0')
    expect(config).toContain('corsOrigins:')
    expect(config).toContain('https://console.zhin.dev')
    expect(config).toContain('inbox:')
    expect(config).toContain('enabled: true')
    expect(await fs.pathExists(path.join(projectPath, '.env.example'))).toBe(true)
    expect(readme).toContain('zhin.config.yml')
    expect(readme).toContain('Remote Console')
    expect(clientTsconfig.compilerOptions).not.toHaveProperty('jsxImportSource')
    expect(examplePlugin).toContain('type MessageElement')
  })

  it('uses the real generated config filename for JSON projects', async () => {
    const projectPath = await makeProject({ config: 'json' })
    const readme = await fs.readFile(path.join(projectPath, 'README.md'), 'utf8')
    const client = await fs.readFile(path.join(projectPath, 'client', 'index.tsx'), 'utf8')

    expect(await fs.pathExists(path.join(projectPath, 'zhin.config.json'))).toBe(true)
    expect(readme).toContain('zhin.config.json')
    expect(client).toContain('zhin.config.json')
  })

  it('writes MCP SDK into package.json when AI is enabled', async () => {
    const projectPath = await makeProject({
      ai: {
        enabled: true,
        defaultProvider: 'ollama',
        providers: { ollama: { host: 'http://127.0.0.1:11434' } },
      },
    })
    const pkg = await fs.readJson(path.join(projectPath, 'package.json'))
    expect(pkg.dependencies['@modelcontextprotocol/sdk']).toBe(MCP_SDK_VERSION)
  })
})
