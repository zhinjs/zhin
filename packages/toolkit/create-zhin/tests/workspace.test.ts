import fs from 'fs-extra'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { BASE_SKILL_NAMES, DEV_SKILL_NAMES, createWorkspace } from '../src/workspace'
import type { InitOptions } from '../src/types'
import { scaffoldDependencyRange } from '@zhin.js/scaffold-wizard'
import { definePage } from '../../../console/plugin-contract/src/index.js'
import { extractPageMetadata } from '../../../console/pagemanager/src/client-build/index.js'
import {
  definePlugin,
  definePluginConsoleRpc,
  pluginConsoleRpcToken,
  type PluginConsoleRpc,
} from '../../../im/plugin-runtime/src/index.js'
import { reviewAIPlan } from '../../../../tests/helpers/review-ai-plan.js'

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
        config: { endpoints: [{ id: 'sandbox-bot', owner: 'sandbox-user' }] },
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
  it.each([
    ['default', 'zh-CN'],
    ['default', 'en'],
    ['life-assistant', 'zh-CN'],
    ['life-assistant', 'en'],
  ] as const)('writes %s persona and agent instructions with distinct voices in %s', async (template, locale) => {
    const projectPath = await makeProject({
      template,
      locale,
      ai: {
        enabled: true,
        agentProvider: 'ollama',
        providers: { ollama: { host: 'http://127.0.0.1:11434', models: ['explicit-local-model'], capabilities: { input: ['text'], toolCalling: true } } },
      },
    })
    const soul = await fs.readFile(path.join(projectPath, 'SOUL.md'), 'utf8')
    const instructions = await fs.readFile(path.join(projectPath, 'AGENTS.md'), 'utf8')
    const tools = await fs.readFile(path.join(projectPath, 'TOOLS.md'), 'utf8')
    const routines = parse(await fs.readFile(path.join(projectPath, 'assistant.profile.yml.example'), 'utf8'))

    expect(soul).toMatch(/(?:我是一个|I am an? )/u)
    expect(soul).not.toMatch(/\bYou (?:are|must|should)\b|你(?:是|不|应)|\{\{nickname\}\}/u)
    expect(instructions).toContain('You are a helpful AI assistant.')
    expect(instructions).toContain('*(You can append here via write_file / write_memory.)*')
    expect(instructions).not.toContain("Briefly state what you're doing before acting")
    expect(tools).toContain('Workspace-specific notes')
    expect(tools).not.toContain('call its declared tools immediately')
    expect(tools).not.toContain('Base answers on actual tool results')
    expect(tools).not.toContain('try alternatives')
    expect(routines.routines.morningBrief.prompt).toMatch(locale === 'zh-CN' ? /^汇总/ : /^Summarize/)
  })

  it.each(['zh-CN', 'en'] as const)('writes the localized life-assistant persona in first person in %s', async (locale) => {
    const projectPath = await makeProject({ template: 'life-assistant', locale })
    const soul = await fs.readFile(path.join(projectPath, 'SOUL.md'), 'utf8')
    expect(soul).toContain(locale === 'zh-CN' ? '我是一个生活助手' : 'I am a life assistant.')
    expect(soul).toContain(locale === 'zh-CN' ? '不执行危险的 bash 命令' : 'Do not run dangerous bash commands')
    expect(soul).not.toMatch(/\bYou (?:are|must|should)\b|你(?:是|不|应)|\{\{nickname\}\}/u)
  })

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
    const helloCommand = await fs.readFile(path.join(projectPath, 'commands', 'hello', 'index.ts'), 'utf8')
    const cardCommand = await fs.readFile(path.join(projectPath, 'commands', 'card', 'index.ts'), 'utf8')
    const statusCard = await fs.readFile(path.join(projectPath, 'components', 'status-card', 'index.tsx'), 'utf8')
    const page = await fs.readFile(path.join(projectPath, 'pages', 'index', 'index.tsx'), 'utf8')
    const navigation = await fs.readFile(path.join(projectPath, 'pages', 'nav', 'index.tsx'), 'utf8')
    const footer = await fs.readFile(path.join(projectPath, 'pages', 'footer', 'index.tsx'), 'utf8')
    const gitignore = await fs.readFile(path.join(projectPath, '.gitignore'), 'utf8')
    expect(gitignore.split('\n')).toContain('.zhin/')
    const schema = await fs.readJson(path.join(projectPath, 'schema.json'))
    const rootTsconfig = await fs.readJson(path.join(projectPath, 'tsconfig.json'))

    // scripts：新 runtime 启动命令
    expect(pkg.scripts.dev).toBe('zhin runtime start --watch source config')
    expect(pkg.scripts.start).toBe('zhin runtime start --mode production --no-watch')

    // 依赖：用户面只直列 zhin.js + 适配器 +（卡片示例）components；无 legacy host
    expect(pkg.dependencies['zhin.js']).toBe(scaffoldDependencyRange('zhin.js'))
    // Real release ranges, never `latest` (#857)
    expect(pkg.dependencies['zhin.js']).toMatch(/^\^\d+\.\d+\.\d+/u)
    expect(JSON.stringify({ ...pkg.dependencies, ...pkg.devDependencies })).not.toContain('"latest"')
    expect(pkg.dependencies['@zhin.js/adapter-sandbox']).toBe(scaffoldDependencyRange('@zhin.js/adapter-sandbox'))
    expect(pkg.dependencies['@zhin.js/components']).toBe(scaffoldDependencyRange('@zhin.js/components'))
    expect(pkg.dependencies['@zhin.js/console-contract']).toBe(scaffoldDependencyRange('@zhin.js/console-contract'))
    expect(pkg.dependencies['@zhin.js/page']).toBe(scaffoldDependencyRange('@zhin.js/page'))
    expect(pkg.dependencies['@zhin.js/layout']).toBe(scaffoldDependencyRange('@zhin.js/layout'))
    expect(pkg.dependencies['@zhin.js/skill']).toBe(scaffoldDependencyRange('@zhin.js/skill'))
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
    expect(pkg.devDependencies['@zhin.js/cli']).toBe(scaffoldDependencyRange('@zhin.js/cli'))
    expect(pkg.engines.node).toBe('>=22.19.0')

    // zhin 清单：Stable Features 随 zhin.js 默认挂载；Console Feature 显式声明
    expect(pkg.zhin.protocol).toBe(1)
    expect(pkg.zhin.type).toBe('plugin')
    expect(pkg.zhin.entry).toBe('./plugin.ts')
    expect(pkg.zhin.features).toEqual([
      { package: '@zhin.js/page', api: '^1.0.0' },
      { package: '@zhin.js/layout', api: '^1.0.0' },
      { package: '@zhin.js/skill', api: '^1.0.0' },
    ])
    expect(pkg.zhin.plugins).toEqual([])

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
    expect(pluginEntry).toContain('pluginConsoleRpcToken')
    expect(pluginEntry).toContain('definePluginConsoleRpc({')
    expect(pluginEntry).toContain("page: 'index'")
    expect(pluginEntry).toContain('handler: async () =>')
    expect(helloCommand).toContain("from 'zhin.js/command'")
    expect(cardCommand).toContain("from 'zhin.js/component'")
    expect(cardCommand).toContain("{ label: 'Uptime', value: `${Math.round(process.uptime())}s` }")
    expect(statusCard).toContain("from 'zhin.js/component'")
    expect(statusCard).toContain("from '@zhin.js/components'")
    expect(page).toContain("from '@zhin.js/console-contract'")
    expect(page).toContain('definePage(')
    expect(page).toContain('ConsolePageBlueprint')
    expect(page).toContain("kind: 'zhin.console.page-blueprint'")
    expect(page).toContain("id: 'runtime-stats'")
    expect(page).toContain("id: 'quick-actions'")
    expect(page).toContain("id: 'getting-started'")
    expect(navigation).toContain('NavSlotProps')
    expect(footer).toContain('FooterSlotProps')
    expect(schema).toMatchObject({ type: 'object', properties: {} })
    expect(rootTsconfig.compilerOptions.noEmit).toBe(true)
    expect(rootTsconfig.compilerOptions.jsx).toBe('react-jsx')
    expect(rootTsconfig.compilerOptions.jsxImportSource).toBe('zhin.js')
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
      'commands/hello/index.ts',
      'components/status-card/index.tsx',
      'middlewares/.gitkeep',
      'tools/.gitkeep',
      'skills/skill-creator/SKILL.md',
      'agents/.gitkeep',
      'pages/index/index.tsx',
      'pages/nav/index.tsx',
      'pages/footer/index.tsx',
      'plugins/.gitkeep',
      'packages/.gitkeep',
    ]
    for (const relativePath of expected) {
      await expect(fs.pathExists(path.join(projectPath, relativePath))).resolves.toBe(true)
    }

    const workspace = parse(await fs.readFile(path.join(projectPath, 'pnpm-workspace.yaml'), 'utf8'))
    expect(workspace.packages).toEqual(['.', 'plugins/*', 'packages/*'])
    expect(workspace.allowBuilds).toEqual({ esbuild: true })
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

  it('documents external database variables in the generated project', async () => {
    const projectPath = await makeProject({
      database: {
        dialect: 'pg',
        host: 'db.internal',
        port: 15432,
        user: 'private-user',
        password: 'secret-password',
        database: 'private-db',
      },
    })
    const envExample = await fs.readFile(path.join(projectPath, '.env.example'), 'utf8')
    const readme = await fs.readFile(path.join(projectPath, 'README.md'), 'utf8')
    const pkg = await fs.readJson(path.join(projectPath, 'package.json'))

    expect(envExample).toContain('DB_HOST=127.0.0.1')
    expect(envExample).toContain('DB_PORT=5432')
    expect(envExample).toContain('DB_PASSWORD=change-me')
    expect(envExample).not.toContain('secret-password')
    expect(pkg.dependencies.pg).toBe('^8.22.0')
    expect(readme).toContain('npx zhin config check')
    expect(readme).toContain('PostgreSQL 的方言名固定为 `pg`')
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
        providers: { ollama: { host: 'http://127.0.0.1:11434', models: ['explicit-local-model'], capabilities: { input: ['text'], toolCalling: true } } },
      },
    })
    const pkg = await fs.readJson(path.join(projectPath, 'package.json'))
    expect(pkg.dependencies['@zhin.js/agent']).toBe(scaffoldDependencyRange('@zhin.js/agent'))
    expect(pkg.dependencies).not.toHaveProperty('@modelcontextprotocol/sdk')
    expect(pkg.dependencies['@ai-sdk/openai-compatible']).toBe(scaffoldDependencyRange('@ai-sdk/openai-compatible'))
    expect(pkg.dependencies['@zhin.js/tool']).toBe(scaffoldDependencyRange('@zhin.js/tool'))
    expect(pkg.dependencies['@zhin.js/prompt-section']).toBe(scaffoldDependencyRange('@zhin.js/prompt-section'))
    expect(pkg.dependencies.zod).toBe(scaffoldDependencyRange('zod'))
    expect(pkg.dependencies.ai).toBe(scaffoldDependencyRange('ai'))
    expect(pkg.zhin.features).toEqual([
      { package: '@zhin.js/page', api: '^1.0.0' },
      { package: '@zhin.js/layout', api: '^1.0.0' },
      { package: '@zhin.js/skill', api: '^1.0.0' },
      { package: '@zhin.js/tool', api: '^1.1.0' },
      { package: '@zhin.js/prompt-section', api: '^1.0.0' },
    ])
    expect(await fs.pathExists(path.join(projectPath, 'tools', 'echo', 'index.ts'))).toBe(true)
    expect(await fs.pathExists(path.join(projectPath, 'SOUL.md'))).toBe(true)
    const config = await fs.readFile(path.join(projectPath, 'zhin.config.yml'), 'utf8')
    expect(config).toContain('ai:')
    expect(parse(config).ai).not.toHaveProperty('providers')
    expect(parse(config).ai).not.toHaveProperty('plan')
    const plan = parse(await fs.readFile(path.join(projectPath, 'ai.plan.yml'), 'utf8'))
    const reviewed = await reviewAIPlan(plan)
    const selected = reviewed.graph.profiles[reviewed.graph.purposes.defaults.chat!]
    expect(selected.model).toBe('explicit-local-model')
    expect(reviewed.graph.services[reviewed.bindings.services.ollama].models[selected.model].toolCalling).toBe(true)
  })
})

it('generates English project guidance and examples while retaining config values and dynamic command prefixes', async () => {
  const projectPath = await makeProject({ locale: 'en', ai: {enabled:true,providers:{openai:{apiKey:'${OPENAI_API_KEY}',models:['explicit-model']}},agentProvider:'openai'} });
  const config=parse(await fs.readFile(path.join(projectPath,'zhin.config.yml'),'utf8'));
  expect(config.locale).toBe('en');
  expect(config.database).toEqual({dialect:'sqlite',filename:'./data/bot.db',mode:'wal'});
  expect(config).not.toHaveProperty('timezone');
  expect(config.ai).not.toHaveProperty('providers');
  const plan = parse(await fs.readFile(path.join(projectPath, 'ai.plan.yml'), 'utf8'));
  expect(plan.accounts.openai.auth).toEqual({ method: 'api-key', source: 'env://OPENAI_API_KEY' });
  expect((await reviewAIPlan(plan)).graph.purposes.defaults.chat).toBeTruthy();
  const readme=await fs.readFile(path.join(projectPath,'README.md'),'utf8');
  expect(readme).toContain('## 🚀 Quick start'); expect(readme).not.toMatch(/[\u3400-\u9fff]/u);
  const instructions=await fs.readFile(path.join(projectPath,'AGENTS.md'),'utf8');
  expect(instructions).toContain('Language: English');
  const hello=await fs.readFile(path.join(projectPath,'commands/hello/index.ts'),'utf8');
  expect(hello).toContain("context.formatCommand('card')"); expect(hello).not.toContain('Try /card');
  const pluginEntryEn = await fs.readFile(path.join(projectPath, 'plugin.ts'), 'utf8');
  expect(pluginEntryEn).toContain('pluginConsoleRpcToken');
  expect(pluginEntryEn).toContain('definePluginConsoleRpc({');
  expect(pluginEntryEn).toContain('handler: async () =>');
  expect(pluginEntryEn).not.toMatch(/[\u3400-\u9fff]/u);
  const cardCommandEn = await fs.readFile(path.join(projectPath, 'commands/card/index.ts'), 'utf8');
  expect(cardCommandEn).toContain("{ label: 'Uptime', value: `${Math.round(process.uptime())}s` }");
  expect(cardCommandEn).not.toMatch(/[\u3400-\u9fff]/u);
  const homePageEn = await fs.readFile(path.join(projectPath, 'pages/index/index.tsx'), 'utf8');
  expect(homePageEn).toContain("kind: 'zhin.console.page-blueprint'");
  expect(homePageEn).toContain("id: 'runtime-stats'");
  expect(homePageEn).toContain("id: 'quick-actions'");
  expect(homePageEn).toContain("id: 'getting-started'");
  expect(homePageEn).not.toMatch(/[\u3400-\u9fff]/u);
  expect(extractPageMetadata(homePageEn, 'pages/index/index.tsx')).toEqual({
    title: 'bot',
    icon: 'Bot',
    order: 10,
  });
  const ts=await import('typescript'); const module={exports:{} as any};
  const code=ts.transpileModule(hello,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  Function('require','module','exports',code)(()=>({defineCommand:(definition:unknown)=>definition}),module,module.exports);
  const execute=module.exports.default.execute;
  expect(execute({formatCommand:()=> '!card'})).toContain('Try !card');
  expect(execute({formatCommand:()=>undefined})).not.toContain('card');
  const pageModule = { exports: {} as any };
  const pageCode = ts.transpileModule(homePageEn, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  Function('require', 'module', 'exports', pageCode)(() => ({ definePage }), pageModule, pageModule.exports);
  expect(pageModule.exports.meta).toMatchObject({ title: 'bot', icon: 'Bot', order: 10 });
  const blueprint = pageModule.exports.default();
  expect(blueprint).toMatchObject({
    kind: 'zhin.console.page-blueprint',
    version: 1,
    title: 'bot',
    dataSource: { action: 'status' },
  });
  expect(blueprint.sections.map((section: { id: string }) => section.id)).toEqual([
    'runtime-stats',
    'quick-actions',
    'getting-started',
  ]);
  const pluginModule = { exports: {} as any };
  const pluginCode = ts.transpileModule(pluginEntryEn, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  Function('require', 'module', 'exports', pluginCode)(
    () => ({ definePlugin, definePluginConsoleRpc, pluginConsoleRpcToken }),
    pluginModule,
    pluginModule.exports,
  );
  let providedToken: unknown;
  let providedRpc: PluginConsoleRpc | undefined;
  pluginModule.exports.default.setup({
    resources: {
      provide: (token: unknown, res: PluginConsoleRpc) => {
        providedToken = token;
        providedRpc = res;
      },
    },
  });
  expect(providedToken).toBe(pluginConsoleRpcToken);
  expect(providedRpc).toBeDefined();
  const callContext = { signal: new AbortController().signal };
  const statusMethod = providedRpc!.methods.get('status');
  expect(statusMethod).toMatchObject({ page: 'index', demo: true, readOnly: true });
  await expect(statusMethod!.handler({}, callContext)).resolves.toMatchObject({
    plugin: 'bot',
    nodeVersion: process.version,
    rssMb: expect.any(Number),
    heapMb: expect.any(Number),
    uptimeSec: expect.any(Number),
  });
  const pingMethod = providedRpc!.methods.get('ping');
  expect(pingMethod).toMatchObject({ page: 'index', readOnly: false });
  await expect(pingMethod!.handler({}, callContext)).resolves.toMatchObject({
    ok: true,
    message: 'pong',
  });
});
