import { wizardText } from '@zhin.js/scaffold-wizard';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { stringify } from 'yaml';
import {
  DATABASE_PACKAGES,
  DATABASE_DRIVER_VERSIONS,
  ZHIN_STACK_VERSIONS,
  formatEnvValue,
  generateAdapterEnvVars,
  generateAIEnvVars,
  generateDatabaseEnvExample,
  getAdapterDependencies,
  getAIDependencies,
  getCreateBotBaseDependencies,
  CREATE_BOT_PACKAGE_MANAGER,
  getCreateBotPnpmWorkspaceConfig,
  withScaffoldVersionRanges,
  type AdapterSetupResult,
  type DatabaseConfig,
  type InitOptions,
} from '@zhin.js/scaffold-wizard';
import { createConfigFile, generateDatabaseEnvVars } from './config.js';
import { CREATE_NODE_REQUIREMENT } from './node-requirement.js';
import { SOUL_MD_TEMPLATE, TOOLS_MD_TEMPLATE } from './templates/bootstrap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const BASE_SKILL_NAMES = ['skill-creator', 'summarize', 'github'] as const;
export const DEV_SKILL_NAMES = ['plugin-init', 'plugin-develop', 'plugin-test', 'plugin-quality', 'plugin-publish'] as const;

async function copySkillTemplate(projectPath: string, skillName: string): Promise<void> {
  const skillDir = path.join(projectPath, 'skills', skillName);
  const skillSrcPath = path.join(__dirname, '../template/skills', skillName, 'SKILL.md');
  if (!fs.existsSync(skillSrcPath)) {
    throw new Error(`Missing create-zhin skill template: ${skillName}`);
  }
  await fs.ensureDir(skillDir);
  await fs.copy(skillSrcPath, path.join(skillDir, 'SKILL.md'));
}

function getConfigFilename(format: InitOptions['config']): string {
  switch (format) {
    case 'json':
      return 'zhin.config.json';
    case 'yaml':
    default:
      return 'zhin.config.yml';
  }
}

function renderDatabaseReadme(database: DatabaseConfig | undefined, configFilename: string, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
  if (!database) return '';
  if (database.dialect === 'sqlite') {
    return wizardText(locale, "templates.databaseSqlite", [configFilename]);
  }
  if (database.dialect === 'memory') {
    return wizardText(locale, "templates.databaseMemory");
  }
  return wizardText(locale, "templates.databaseNetwork", [database.dialect, configFilename]);
}

/** 未显式配置适配器时默认挂载 Sandbox（对齐 examples/test-bot 的 sandbox 实例） */
function resolveAdapterResult(options: InitOptions): AdapterSetupResult {
  if (options.adapters) return options.adapters;
  return {
    packages: ['@zhin.js/adapter-sandbox'],
    plugins: ['@zhin.js/adapter-sandbox'],
    instances: [{
      package: '@zhin.js/adapter-sandbox',
      instanceKey: 'sandbox',
      // 对齐 examples/minimal-bot 的 Stable 黄金路径：命令保留 / 前缀（/hello）
      config: {
        commandPrefix: '/',
        endpoints: [{ id: 'sandbox-bot', owner: 'sandbox-user' }],
      },
    }],
    envVars: {},
  };
}

export async function createWorkspace(projectPath: string, projectName: string, options: InitOptions): Promise<void> {
  const locale = options.locale;
  const configFilename = getConfigFilename(options.config);
  const adapters = resolveAdapterResult(options);
  const aiEnabled = options.ai?.enabled === true;

  await fs.ensureDir(projectPath);

  await fs.writeFile(
    path.join(projectPath, 'pnpm-workspace.yaml'),
    stringify(getCreateBotPnpmWorkspaceConfig()),
  );

  // 根据数据库类型添加相应依赖
  const databaseDeps: Record<string, string> = {};
  if (options.database) {
    const dbPackage = DATABASE_PACKAGES[options.database.dialect];
    if (dbPackage) {
      databaseDeps[dbPackage] = DATABASE_DRIVER_VERSIONS[dbPackage];
    }
    databaseDeps['@zhin.js/database'] = 'latest';
  }

  // 根据适配器选择添加依赖
  const adapterDeps: Record<string, string> = { ...getAdapterDependencies(adapters) };
  if (!adapterDeps['@zhin.js/adapter-sandbox']) {
    adapterDeps['@zhin.js/adapter-sandbox'] = 'latest';
  }

  // AI 依赖（agent 栈 + 所选 @ai-sdk/*）及 AI authoring Features
  const aiDeps: Record<string, string> = { ...getAIDependencies(options.ai) };
  if (aiEnabled) {
    aiDeps['@zhin.js/tool'] = ZHIN_STACK_VERSIONS['@zhin.js/tool'];
    aiDeps['@zhin.js/prompt-section'] = ZHIN_STACK_VERSIONS['@zhin.js/prompt-section'];
  }
  // 脚手架默认生成统一 JSX 卡片组件示例
  const cardDeps = {
    '@zhin.js/components': ZHIN_STACK_VERSIONS['@zhin.js/components'],
  };
  // Page/Layout Features only discover client modules. Their compiler remains
  // owned by the optional Console Host, so the IM project itself adds no
  // browser compiler or UI runtime dependency.
  const consoleFeatureDeps = {
    '@zhin.js/console-contract': ZHIN_STACK_VERSIONS['@zhin.js/console-contract'],
    '@zhin.js/layout': ZHIN_STACK_VERSIONS['@zhin.js/layout'],
    '@zhin.js/page': ZHIN_STACK_VERSIONS['@zhin.js/page'],
  };

  // package.json：zhin 清单是 Plugin Runtime 拓扑 SSOT（features + plugins）
  await fs.writeJson(path.join(projectPath, 'package.json'), {
    name: projectName,
    private: true,
    version: '0.1.0',
    packageManager: CREATE_BOT_PACKAGE_MANAGER,
    type: 'module',
    description: `${projectName} - Zhin.js Bot`,
    scripts: {
      dev: 'zhin runtime start',
      start: 'zhin runtime start --mode production --no-watch',
      build: 'tsc --noEmit',
      'pm2:start': 'pm2 start ecosystem.config.cjs',
      'pm2:stop': 'pm2 stop ecosystem.config.cjs',
      'pm2:restart': 'pm2 restart ecosystem.config.cjs',
      'pm2:delete': 'pm2 delete ecosystem.config.cjs',
      'pm2:logs': 'pm2 logs',
      'pm2:monit': 'pm2 monit'
    },
    // Zhin packages get the caret range of the release this scaffold ships with, not `latest`.
    dependencies: withScaffoldVersionRanges({
      ...getCreateBotBaseDependencies(),
      ...adapterDeps,
      ...databaseDeps,
      ...aiDeps,
      ...cardDeps,
      ...consoleFeatureDeps,
    }),
    devDependencies: withScaffoldVersionRanges({
      '@zhin.js/cli': ZHIN_STACK_VERSIONS['@zhin.js/cli'],
      '@types/node': '^25.0.0',
      'typescript': '^6.0.0',
      'pm2': '^6.0.0'
    }),
    engines: {
      node: CREATE_NODE_REQUIREMENT
    },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      engine: '^1.0.0',
      runtime: 'trusted',
      // Stable Features（adapter/command/component/middleware）由 @zhin.js/core 的 package.json#zhin.features 继承
      features: [
        { package: '@zhin.js/page', api: '^1.0.0' },
        { package: '@zhin.js/layout', api: '^1.0.0' },
        { package: '@zhin.js/skill', api: '^1.0.0' },
        ...(aiEnabled ? [{ package: '@zhin.js/tool', api: '^1.0.0' }] : []),
        ...(aiEnabled ? [{ package: '@zhin.js/prompt-section', api: '^1.0.0' }] : []),
      ],
      plugins: [],
    }
  }, { spaces: 2 });

  // Plugin Runtime 项目骨架（对齐 examples/minimal-bot）
  await createRuntimeProjectFiles(projectPath, projectName, { ...options, adapters });

  // AI 引导文件（人格 / 工具约定 / 记忆），仅启用 AI 时生成
  if (aiEnabled) {
    await fs.writeFile(path.join(projectPath, 'SOUL.md'), SOUL_MD_TEMPLATE);
    await fs.writeFile(path.join(projectPath, 'TOOLS.md'), TOOLS_MD_TEMPLATE);
    await fs.writeFile(path.join(projectPath, 'AGENTS.md'), wizardText(locale, 'templates.agentInstructions'));
    await fs.writeFile(path.join(projectPath, 'assistant.profile.yml.example'), wizardText(locale, 'templates.assistantProfile'));
  }

  // 创建内置技能
  for (const skillName of BASE_SKILL_NAMES) {
    await copySkillTemplate(projectPath, skillName);
  }

  // 创建插件开发技能（可选）
  if (options.devSkills) {
    for (const skillName of DEV_SKILL_NAMES) {
      await copySkillTemplate(projectPath, skillName);
    }
  }

  // 创建 systemd service 配置（Linux）：当前目录用 npx 启动，不写死 nvm/node 路径
  await fs.writeFile(path.join(projectPath, `${projectName}.service`),
wizardText(locale, "templates.systemd", [projectName, path.resolve(projectPath), projectName, path.resolve(projectPath, '.env')]));

  // 创建 launchd plist 配置（macOS）：当前目录用 npx 启动，不写死 nvm/node 路径
  await fs.writeFile(path.join(projectPath, `com.zhinjs.${projectName}.plist`),
`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.zhinjs.${projectName}</string>

    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/env</string>
        <string>npx</string>
        <string>zhin</string>
        <string>runtime</string>
        <string>start</string>
        <string>--mode</string>
        <string>production</string>
        <string>--no-watch</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${path.resolve(projectPath)}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${path.resolve(projectPath, 'logs/launchd-stdout.log')}</string>

    <key>StandardErrorPath</key>
    <string>${path.resolve(projectPath, 'logs/launchd-stderr.log')}</string>

    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>
`);

  // 创建 Windows NSSM 安装脚本（PowerShell）
  await fs.writeFile(path.join(projectPath, 'install-service.ps1'),
wizardText(locale, "templates.windowsService", [projectName, path.resolve(projectPath)]));

  // 创建 Windows Task Scheduler XML（备选方案）
  await fs.writeFile(path.join(projectPath, `${projectName}-task.xml`),
`<?xml version="1.0" encoding="UTF-8"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Zhin.js Endpoint - ${projectName}</Description>
    <URI>\\${projectName}</URI>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>npx</Command>
      <Arguments>zhin runtime start --mode production --no-watch</Arguments>
      <WorkingDirectory>${path.resolve(projectPath).replace(/\\/g, '\\\\')}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`);

  // 创建 PM2 配置文件
  await fs.writeFile(path.join(projectPath, 'ecosystem.config.cjs'),
`module.exports = {
  apps: [
    {
      name: '${projectName}',
      script: 'node_modules/.bin/zhin',
      args: 'runtime start --mode production --no-watch',
      cwd: './',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
    },
  ],
};
`);

  // 创建 .gitignore
  await fs.writeFile(path.join(projectPath, '.gitignore'),
`node_modules/
dist/
lib/
*.log
logs/
.env
.env.*
!.env.development
!.env.production
!.env.example
.DS_Store
data/
.pm2/
.zhin/
`);

  // 创建 README.md
  await fs.writeFile(path.join(projectPath, 'README.md'),
wizardText(locale, "templates.projectReadme", [projectName, projectName, configFilename, configFilename, renderDatabaseReadme(options.database, configFilename, locale), configFilename]));
}

async function createRuntimeProjectFiles(projectPath: string, projectName: string, options: InitOptions): Promise<void> {
  const locale = options.locale;
  const aiEnabled = options.ai?.enabled === true;

  await Promise.all([
    fs.ensureDir(path.join(projectPath, 'commands')),
    fs.ensureDir(path.join(projectPath, 'components')),
    fs.ensureDir(path.join(projectPath, 'pages')),
    fs.ensureDir(path.join(projectPath, 'skills')),
    fs.ensureDir(path.join(projectPath, 'data')),
    ...['agents', 'hooks', 'middlewares', 'plugins', 'packages', 'prompt-sections', 'tools'].map(async (directory) => {
      await fs.outputFile(path.join(projectPath, directory, '.gitkeep'), '');
    }),
  ]);

  // 创建 .env 文件（使用简单的变量名）
  const databaseEnvVars = options.database ? generateDatabaseEnvVars(options.database, locale) : '';
  const databaseEnvExample = options.database ? generateDatabaseEnvExample(options.database, locale) : '';
  const adapterEnvVars = options.adapters ? generateAdapterEnvVars(options.adapters, locale) : '';
  const aiEnvVars = options.ai ? generateAIEnvVars(options.ai, locale) : '';
  await fs.writeFile(path.join(projectPath, '.env'),
wizardText(locale, "templates.environment", [formatEnvValue(options.httpToken), databaseEnvVars, adapterEnvVars, aiEnvVars]));
  await fs.writeFile(path.join(projectPath, '.env.development'),
wizardText(locale, "templates.environmentDevelopment"));
  await fs.writeFile(path.join(projectPath, '.env.production'),
wizardText(locale, "templates.environmentProduction"));
  await fs.writeFile(path.join(projectPath, '.env.example'),
wizardText(locale, "templates.environmentExample", [databaseEnvExample]));

  // tsconfig.json（独立项目，对齐 examples/minimal-bot 的编译选项）
  await fs.writeJson(path.join(projectPath, 'tsconfig.json'), {
    "compilerOptions": {
      "target": "ES2022",
      "module": "ESNext",
      "moduleResolution": "bundler",
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "forceConsistentCasingInFileNames": true,
      "resolveJsonModule": true,
      "isolatedModules": true,
      "jsx": "react-jsx",
      "jsxImportSource": "zhin.js",
      "noEmit": true,
      "types": ["node"]
    },
    "include": [
      "plugin.ts",
      "commands/**/*.ts",
      "commands/**/*.tsx",
      "components/**/*.ts",
      "components/**/*.tsx",
      "middlewares/**/*.ts",
      "middlewares/**/*.tsx",
      "tools/**/*.ts",
      "tools/**/*.tsx",
      "hooks/**/*.ts",
      "agents/**/*.ts",
      "skills/**/*.ts",
      "pages/**/*.ts",
      "pages/**/*.tsx"
    ],
    "exclude": [
      "node_modules"
    ]
  }, { spaces: 2 });

  // plugin.ts（根插件入口）
  await fs.writeFile(path.join(projectPath, 'plugin.ts'),
`import { definePlugin } from 'zhin.js';

export default definePlugin({
  name: '${projectName}',
  metadata: {
    displayName: '${projectName}',
  },
});
`);

  // schema.json（根插件配置契约，暂无可配置项）
  await fs.writeJson(path.join(projectPath, 'schema.json'), {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }, { spaces: 2 });

  // pages/ follows the Feature conventions. These components deliberately
  // return text, keeping the initial IM project free of a browser UI runtime.
  await fs.outputFile(path.join(projectPath, 'pages', 'index', 'index.tsx'),
`import { definePage } from '@zhin.js/console-contract';

export const meta = definePage({
  title: '${projectName}',
  order: 10,
});

export default function HomePage() {
  return 'Zhin Console is ready. Add pages in pages/ to extend this plugin.';
}
`);
  await fs.outputFile(path.join(projectPath, 'pages', 'nav', 'index.tsx'),
`import type { NavSlotProps } from '@zhin.js/console-contract';

export default function ProjectNavigation({ current }: NavSlotProps) {
  return current ? \`Current page: \${current}\` : '${projectName}';
}
`);
  await fs.outputFile(path.join(projectPath, 'pages', 'footer', 'index.tsx'),
`import type { FooterSlotProps } from '@zhin.js/console-contract';

export default function ProjectFooter({ owner }: FooterSlotProps) {
  return \`Plugin: \${owner}\`;
}
`);

  // commands/hello/index.ts
  await fs.outputFile(path.join(projectPath, 'commands', 'hello', 'index.ts'),
wizardText(locale, "templates.helloCommand"));

  // commands/card/index.ts（组件渲染示例，对齐 examples/minimal-bot）
  await fs.outputFile(path.join(projectPath, 'commands', 'card', 'index.ts'),
wizardText(locale, "templates.cardCommand", [projectName]));

  // components/status-card/index.tsx
  await fs.outputFile(path.join(projectPath, 'components', 'status-card', 'index.tsx'),
wizardText(locale, "templates.statusCard", [projectName]));

  // tools/echo/index.ts（AI 启用时生成，defineAgentTool 约定目录）
  if (aiEnabled) {
    await fs.ensureDir(path.join(projectPath, 'tools', 'echo'));
    await fs.writeFile(path.join(projectPath, 'tools', 'echo', 'index.ts'),
wizardText(locale, "templates.echoTool"));
  }

  // 生活助手模板额外文件
  if (options.template === 'life-assistant') {
    // knowledge 目录
    await fs.ensureDir(path.join(projectPath, 'knowledge'));
    await fs.writeFile(path.join(projectPath, 'knowledge', 'faq.md'),
wizardText(locale, "templates.knowledgeFaq"));

    // 三层记忆目录骨架
    await fs.ensureDir(path.join(projectPath, 'data', 'memory', 'global'));
    await fs.ensureDir(path.join(projectPath, 'data', 'memory', 'platforms'));
    await fs.ensureDir(path.join(projectPath, 'data', 'memory', 'sessions'));

    // 覆盖 SOUL.md 为生活助手人设
    await fs.writeFile(path.join(projectPath, 'SOUL.md'),
wizardText(locale, "templates.lifeAssistantSoul"));

    // 生活助手命令与工具（工具需 AI 启用才挂载 @zhin.js/tool feature）
    await fs.outputFile(path.join(projectPath, 'commands', 'remind', 'index.ts'),
wizardText(locale, "templates.reminderCommand"));

    if (aiEnabled) {
      await fs.ensureDir(path.join(projectPath, 'tools', 'get_current_time'));
      await fs.writeFile(path.join(projectPath, 'tools', 'get_current_time', 'index.ts'),
wizardText(locale, "templates.currentTimeTool"));
    }
  }

  // 创建配置文件（新 Plugin Runtime 格式）
  await createConfigFile(projectPath, options.config!, options);
}
