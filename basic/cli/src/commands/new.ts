import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';
import { execSync } from 'node:child_process';

interface NewPluginOptions {
  skipInstall?: boolean;
  isOfficial?: boolean;
  type?: 'normal' | 'service' | 'adapter';
}

export const newCommand = new Command('new')
  .description('创建插件包模板')
  .argument('[plugin-name]', '插件名称（如: my-plugin）')
  .option('--is-official', '是否为官方插件', false)
  .option('--skip-install', '跳过依赖安装', false)
  .option('--type <type>', '插件类型 (normal|service|adapter)', 'normal')
  .action(async (pluginName: string, options: NewPluginOptions) => {
    try {
      let name = pluginName;
      if (!name) {
        const { pluginName: inputName } = await inquirer.prompt([
          {
            type: 'input',
            name: 'pluginName',
            message: '请输入插件名称:',
            default: 'my-plugin',
            validate: (input: string) => {
              if (!input.trim()) {
                return '插件名称不能为空';
              }
              if (!/^[a-zA-Z0-9-_]+$/.test(input)) {
                return '插件名称只能包含字母、数字、横线和下划线';
              }
              return true;
            }
          }
        ]);
        name = inputName;
      }

      // 确定插件目录
      const pluginDir = path.resolve(process.cwd(), 'plugins', name);
      
      // 检查目录是否已存在
      if (fs.existsSync(pluginDir)) {
        logger.error(`插件目录已存在: ${pluginDir}`);
        process.exit(1);
      }

      // 询问插件类型（如果未指定）
      if (!options.type) {
        const { type } = await inquirer.prompt([
          {
            type: 'list',
            name: 'type',
            message: '请选择插件类型:',
            choices: [
              { name: '普通插件 (Normal)', value: 'normal' },
              { name: '服务 (Service)', value: 'service' },
              { name: '适配器 (Adapter)', value: 'adapter' }
            ],
            default: 'normal'
          }
        ]);
        options.type = type;
      }

      logger.info(`正在创建${options.type === 'service' ? '服务' : options.type === 'adapter' ? '适配器' : '插件'}包 ${name}...`);
      
      // 创建插件包结构
      await createPluginPackage(pluginDir, name, options);
      
      // 自动添加到 app/package.json
      await addPluginToApp(name, options.isOfficial);
      
      logger.success(`✓ 插件包 ${name} 创建成功！`);
      logger.log('');
      logger.log('📝 下一步操作：');
      logger.log(`  cd plugins/${name}`);
      if (options.skipInstall) {
        logger.log(`  pnpm install`);
      }
      logger.log(`  pnpm build`);
      logger.log(`  pnpm dev # 开发模式（监听文件变化）`);
      logger.log('');
      logger.log('📦 发布到 npm：');
      logger.log(`  pnpm publish`);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      logger.error(`创建插件失败: ${errorMessage}`);
      if (errorStack && process.env.DEBUG) {
        logger.error(errorStack);
      }
      process.exit(1);
    }
  });

async function createPluginPackage(pluginDir: string, pluginName: string, options: NewPluginOptions) {
  const capitalizedName = pluginName.charAt(0).toUpperCase() + pluginName.slice(1).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const packageName = options.isOfficial ? `@zhin.js/${pluginName}` : `zhin.js-${pluginName}`;
  
  // 创建目录结构
  await fs.ensureDir(pluginDir);
  await fs.ensureDir(path.join(pluginDir, 'src'));
  await fs.ensureDir(path.join(pluginDir, 'client'));
  await fs.ensureDir(path.join(pluginDir, 'lib'));
  await fs.ensureDir(path.join(pluginDir, 'dist'));
  await fs.ensureDir(path.join(pluginDir, 'tests'));
  
  // 创建 package.json
  const packageJson = {
    name: packageName,
    version: '0.1.0',
    description: `Zhin.js ${capitalizedName} 插件`,
    type: 'module',
    main: './lib/index.js',
    types: './lib/index.d.ts',
    exports: {
      '.': {
        types: './lib/index.d.ts',
        import: './lib/index.js'
      },
      './client': {
        import: './dist/index.js'
      }
    },
    files: [
      'lib',
      'src',
      'dist',
      'client',
      'README.md',
      'CHANGELOG.md'
    ],
    scripts: {
      build: 'pnpm build:node && pnpm build:client',
      'build:node': 'tsc',
      'build:client': 'zhin-console build',
      dev: 'tsc --watch',
      clean: 'rimraf lib dist',
      test: 'vitest run',
      'test:watch': 'vitest',
      'test:coverage': 'vitest run --coverage',
      prepublishOnly: 'pnpm build'
    },
    keywords: [
      'zhin.js',
      'plugin',
      pluginName
    ],
    author: '',
    license: 'MIT',
    peerDependencies: {
      'zhin.js': 'workspace:*',
      '@zhin.js/client': 'workspace:*'
    },
    devDependencies: {
      '@zhin.js/types': 'workspace:*',
      '@types/node': 'latest',
      '@types/react': 'latest',
      '@types/react-dom': 'latest',
      'typescript': 'latest',
      'react': 'latest',
      'react-dom': 'latest',
      "@zhin.js/client":"workspace:*",
      'lucide-react': 'latest',
      'radix-ui': 'latest',
      'class-variance-authority': 'latest',
      'vitest': 'latest',
      '@vitest/coverage-v8': 'latest',
      'rimraf': 'latest'
    }
  };
  
  await fs.writeJson(path.join(pluginDir, 'package.json'), packageJson, { spaces: 2 });
  
  // 创建 tsconfig.json (服务端主配置)
  const tsConfig = {
    "compilerOptions": {
      "target": "ES2022",
      "module": "ESNext",
      "moduleResolution": "bundler",
      "outDir": "./lib",
      "rootDir": "./src",
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "forceConsistentCasingInFileNames": true,
      "resolveJsonModule": true,
      "isolatedModules": true,
      "allowSyntheticDefaultImports": true,
      "experimentalDecorators": true,
      "emitDecoratorMetadata": true,
      "declaration": true,
      "declarationMap": true,
      "sourceMap": true,
      "verbatimModuleSyntax": false,
      "types": [
        "@zhin.js/http"
      ]
    },
    "include": ["src/**/*"],
    "exclude": ["lib", "node_modules", "client"]
  } 
  ;
  
  await fs.writeJson(path.join(pluginDir, 'tsconfig.json'), tsConfig, { spaces: 2 });
  
  
  // 创建 client/tsconfig.json (客户端主配置)
  const clientTsConfig = {
    "compilerOptions": {
      "outDir": "../dist",
      "baseUrl": ".",
      "declaration": true,
      "module": "ESNext",
      "moduleResolution": "bundler",
      "target": "ES2022",
      "jsx":"react-jsx",
      "declarationMap": true,
      "sourceMap": true,
      "skipLibCheck": true,
      "noEmit": false
    },
    "include": [
      "./**/*"
    ]
  }
  ;
  
  await fs.writeJson(path.join(pluginDir, 'client', 'tsconfig.json'), clientTsConfig, { spaces: 2 });
  
  // 创建服务端入口文件 src/index.ts
  const indexContent = `import {
  useLogger,
  useContext,
  onDispose,
  ZhinTool,
  type Message,
} from 'zhin.js';
import path from 'node:path';

const logger = useLogger();

// ============================================================================
// 工具定义示例 (使用 ZhinTool)
// ============================================================================

// 示例工具：问候
const greetTool = new ZhinTool('${pluginName}.greet')
  .desc('发送问候消息')
  .tag('${pluginName}')
  .param('name', { type: 'string', description: '要问候的名字' })
  .execute(async ({ name }) => {
    const greeting = name ? \`你好，\${name}！\` : '你好！';
    return { success: true, message: greeting };
  })
  .action(async (message: Message, result: any) => {
    const name = result.params?.name;
    return name ? \`👋 你好，\${name}！\` : '👋 你好！';
  });

// 注册工具
useContext('tool', (toolService) => {
  if (!toolService) return;
  
  const disposers = [
    toolService.addTool(greetTool, '${pluginName}'),
  ];
  
  logger.debug('${capitalizedName} 工具已注册');
  
  return () => disposers.forEach(d => d());
});

// 注册客户端入口（如果有客户端代码）
useContext('web', (web) => {
  // 开发环境使用 tsx 文件，生产环境使用编译后的 js 文件
  const isDev = process.env.NODE_ENV === 'development';
  const clientEntry = isDev 
    ? path.resolve(import.meta.dirname, '../client/index.tsx')
    : path.resolve(import.meta.dirname, '../dist/index.js');
  const dispose = web.addEntry(clientEntry);
  return dispose;
});

// 插件销毁时的清理
onDispose(() => {
  logger.info('${capitalizedName} 插件已销毁');
});

logger.info('${capitalizedName} 插件已加载');
`;
  
  await fs.writeFile(path.join(pluginDir, 'src', 'index.ts'), indexContent);
  
  // 创建客户端入口文件 client/index.tsx
  const clientContent = `import { addPage } from '@zhin.js/client';
import { Component } from 'lucide-react';
import ${capitalizedName}Page from './pages/${capitalizedName}Page';

addPage({
  key: '${pluginName}-page',
  path: '/plugins/${pluginName}',
  title: '${capitalizedName}',
  icon: <Component className="w-5 h-5" />,
  element: <${capitalizedName}Page />
});

export { ${capitalizedName}Page };
`;
  
  await fs.writeFile(path.join(pluginDir, 'client', 'index.tsx'), clientContent);

  // 创建客户端页面组件
  await fs.ensureDir(path.join(pluginDir, 'client', 'pages'));
  const pageContent = `import { useEffect } from 'react';

export default function ${capitalizedName}Page() {

  useEffect(() => {
    console.log('${capitalizedName} 页面已挂载');
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">${capitalizedName}</h1>
    </div>
  );
}
`;
  
  await fs.writeFile(path.join(pluginDir, 'client', 'pages', `${capitalizedName}Page.tsx`), pageContent);
  
  // 创建 README.md
  const readmeContent = `# ${packageName}

${capitalizedName} 插件 for Zhin.js

## 安装

\`\`\`bash
pnpm add ${packageName}
\`\`\`

## 使用

在 \`zhin.config.ts\` 中添加插件：

\`\`\`typescript
export default defineConfig({
  plugins: [
    '${pluginName}'
  ]
});
\`\`\`

## 开发

\`\`\`bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 开发模式
pnpm dev
\`\`\`

## 许可证

MIT
`;
  
  await fs.writeFile(path.join(pluginDir, 'README.md'), readmeContent);
  
  // 创建 CHANGELOG.md
  const changelogContent = `# ${packageName}

## 0.1.0

### Features

- 初始版本
`;
  
  await fs.writeFile(path.join(pluginDir, 'CHANGELOG.md'), changelogContent);
  
  // 创建 .gitignore
  const gitignoreContent = `node_modules/
lib/
dist/
*.log
.DS_Store
`;
  
  await fs.writeFile(path.join(pluginDir, '.gitignore'), gitignoreContent);
  
  // 生成测试文件
  await generateTestFiles(pluginDir, pluginName, capitalizedName, options);
  
  // 安装依赖
  if (!options.skipInstall) {
    logger.info('正在安装依赖...');
    try {
      execSync('pnpm install', {
        cwd: pluginDir,
        stdio: 'inherit'
      });
      logger.success('✓ 依赖安装成功');
    } catch (error) {
      logger.warn('⚠ 依赖安装失败，请手动执行 pnpm install');
    }
  }
}

/**
 * 生成测试文件
 */
async function generateTestFiles(
  pluginDir: string,
  pluginName: string,
  capitalizedName: string,
  options: NewPluginOptions
) {
  const testsDir = path.join(pluginDir, 'tests');
  const pluginType = options.type || 'plugin';
  
  // 根据插件类型生成不同的测试文件
  if (pluginType === 'service') {
    await generateServiceTest(testsDir, pluginName, capitalizedName);
  } else if (pluginType === 'adapter') {
    await generateAdapterTest(testsDir, pluginName, capitalizedName);
  } else {
    await generatePluginTest(testsDir, pluginName, capitalizedName);
  }
  
  logger.success('✓ 测试文件已生成');
}

/**
 * 生成普通插件测试
 */
async function generatePluginTest(testsDir: string, pluginName: string, capitalizedName: string) {
  const testContent = `import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Plugin } from '@zhin.js/core'

describe('${capitalizedName} Plugin', () => {
  let plugin: Plugin
  let rootPlugin: Plugin

  beforeEach(async () => {
    rootPlugin = new Plugin('/test/root-plugin.ts')
    plugin = new Plugin('/plugins/${pluginName}/src/index.ts', rootPlugin)
  })

  afterEach(async () => {
    if (plugin && plugin.started) {
      await plugin.stop()
    }
  })

  describe('Plugin Instance', () => {
    it('should create plugin instance', () => {
      expect(plugin).toBeDefined()
      expect(plugin).toBeInstanceOf(Plugin)
    })

    it('should have correct name', () => {
      expect(plugin.name).toBe('${pluginName}')
    })

    it('should have parent plugin', () => {
      expect(plugin.parent).toBe(rootPlugin)
    })

    it('should have logger', () => {
      expect(plugin.logger).toBeDefined()
      expect(typeof plugin.logger.info).toBe('function')
    })
  })

  describe('Plugin Lifecycle', () => {
    it('should start successfully', async () => {
      await expect(plugin.start()).resolves.not.toThrow()
      expect(plugin.started).toBe(true)
    })

    it('should stop successfully', async () => {
      await plugin.start()
      await expect(plugin.stop()).resolves.not.toThrow()
      expect(plugin.started).toBe(false)
    })

    it('should emit mounted event on start', async () => {
      const mountedSpy = vi.fn()
      plugin.on('mounted', mountedSpy)
      
      await plugin.start()
      
      expect(mountedSpy).toHaveBeenCalled()
    })

    it('should emit dispose event on stop', async () => {
      const disposeSpy = vi.fn()
      plugin.on('dispose', disposeSpy)
      
      await plugin.start()
      await plugin.stop()
      
      expect(disposeSpy).toHaveBeenCalled()
    })
  })

  describe('Plugin Features', () => {
    it('should register middleware', () => {
      plugin.addMiddleware(async (event, next) => {
        return next()
      })
      
      expect(plugin.middlewares.length).toBeGreaterThan(0)
    })

    it('should execute middleware', async () => {
      const executionOrder: number[] = []
      
      plugin.addMiddleware(async (event, next) => {
        executionOrder.push(1)
        await next()
      })
      
      plugin.addMiddleware(async (event, next) => {
        executionOrder.push(2)
        await next()
      })

      const mockEvent = {
        $adapter: 'test',
        $bot: 'test-bot',
        $content: [],
        $raw: 'test'
      } as any

      await plugin.middleware(mockEvent, async () => {})
      
      expect(executionOrder).toEqual([1, 2])
    })
  })

  describe('Custom Tests', () => {
    // 在这里添加你的自定义测试
    it('should pass custom test', () => {
      expect(true).toBe(true)
    })
  })
})
`;
  
  await fs.writeFile(path.join(testsDir, 'index.test.ts'), testContent);
}

/**
 * 生成服务测试
 */
async function generateServiceTest(testsDir: string, pluginName: string, capitalizedName: string) {
  const testContent = `import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Plugin } from '@zhin.js/core'

describe('${capitalizedName} Service', () => {
  let plugin: Plugin
  let service: any

  beforeEach(async () => {
    plugin = new Plugin('/test/service-plugin.ts')
    // TODO: 初始化你的服务实例
    // service = await createYourService(plugin)
  })

  afterEach(() => {
    if (plugin && typeof (plugin as any).stop === 'function') {
      (plugin as any).stop()
    }
  })

  describe('Service Instance', () => {
    it('should create service instance', () => {
      // TODO: 取消注释并实现
      // expect(service).toBeDefined()
      // expect(service).not.toBeNull()
      expect(true).toBe(true)
    })

    it('should have correct type', () => {
      // TODO: 取消注释并实现
      // expect(typeof service).toBe('object')
      expect(true).toBe(true)
    })
  })

  describe('Service Methods', () => {
    it('should have required methods', () => {
      // TODO: 添加你的服务方法测试
      // expect(service).toHaveProperty('methodName')
      // expect(typeof service.methodName).toBe('function')
      expect(true).toBe(true)
    })

    it('should execute methods correctly', async () => {
      // TODO: 测试方法执行
      // const result = await service.methodName()
      // expect(result).toBeDefined()
      expect(true).toBe(true)
    })
  })

  describe('Service Lifecycle', () => {
    it('should handle initialization', async () => {
      // TODO: 测试初始化
      expect(true).toBe(true)
    })

    it('should handle cleanup on dispose', async () => {
      // TODO: 测试清理逻辑
      expect(true).toBe(true)
    })
  })

  describe('Service Dependencies', () => {
    it('should inject required dependencies', () => {
      // TODO: 测试依赖注入
      // plugin.provide({ name: 'dep', value: mockDep })
      // const dep = plugin.inject('dep')
      // expect(dep).toBeDefined()
      expect(true).toBe(true)
    })
  })

  describe('Custom Tests', () => {
    // 在这里添加你的自定义测试
    it('should pass custom test', () => {
      expect(true).toBe(true)
    })
  })
})
`;
  
  await fs.writeFile(path.join(testsDir, 'index.test.ts'), testContent);
}

/**
 * 生成适配器测试
 */
async function generateAdapterTest(testsDir: string, pluginName: string, capitalizedName: string) {
  const testContent = `import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Plugin, Adapter, Bot } from '@zhin.js/core'
import { EventEmitter } from 'events'

// TODO: 导入你的适配器和 Bot 类
// import { ${capitalizedName}Adapter, ${capitalizedName}Bot } from '../src/index'

// Mock Bot 类（用于测试）
class Mock${capitalizedName}Bot extends EventEmitter implements Bot {
  adapter: string
  unique: string
  self_id: string
  quote_self: boolean
  forward_length: number
  $connected: boolean = false
  
  constructor(adapter: any, config: any) {
    super()
    this.adapter = '${pluginName}'
    this.unique = config.name || 'mock-bot'
    this.self_id = config.self_id || 'mock-bot-id'
    this.quote_self = config.quote_self ?? true
    this.forward_length = config.forward_length ?? 3
  }

  async connect() {
    this.$connected = true
    this.emit('online')
    return true
  }

  async disconnect() {
    this.$connected = false
    this.emit('offline')
    return true
  }

  async sendMessage(channel_id: string, content: any) {
    return 'mock-message-id'
  }

  async recallMessage(message_id: string) {
    return true
  }
}

// Mock Adapter 类（用于测试）
class Mock${capitalizedName}Adapter extends Adapter<any, any> {
  constructor(plugin: Plugin, name: string, config: any[]) {
    super(plugin, name)
    config.forEach(cfg => {
      const bot = this.createBot(cfg)
      this.bots.set(bot.unique, bot)
    })
  }

  createBot(config: any): Bot {
    return new Mock${capitalizedName}Bot(this, config)
  }
}

describe('${capitalizedName} Adapter', () => {
  let plugin: Plugin
  let adapter: Mock${capitalizedName}Adapter

  beforeEach(() => {
    plugin = new Plugin('/test/adapter-plugin.ts')
    adapter = new Mock${capitalizedName}Adapter(plugin, '${pluginName}', [
      { name: 'test-bot', token: 'test-token' }
    ])
  })

  afterEach(async () => {
    if (adapter) {
      await adapter.stop()
    }
  })

  describe('Adapter Instance', () => {
    it('should create adapter instance', () => {
      expect(adapter).toBeDefined()
      expect(adapter).toBeInstanceOf(Adapter)
    })

    it('should have correct name', () => {
      expect(adapter.name).toBe('${pluginName}')
    })

    it('should have plugin reference', () => {
      expect(adapter.plugin).toBe(plugin)
    })

    it('should have logger', () => {
      expect(adapter.logger).toBeDefined()
      expect(typeof adapter.logger.info).toBe('function')
    })

    it('should initialize with bots', () => {
      expect(adapter.bots).toBeInstanceOf(Map)
      expect(adapter.bots.size).toBeGreaterThan(0)
    })
  })

  describe('Bot Management', () => {
    it('should create bots from config', () => {
      expect(adapter.bots.size).toBe(1)
      const bot = adapter.bots.values().next().value
      expect(bot).toBeDefined()
      expect(bot.adapter).toBe('${pluginName}')
    })

    it('should have createBot method', () => {
      expect(typeof adapter.createBot).toBe('function')
    })

    it('should create bot with correct properties', () => {
      const bot = adapter.bots.values().next().value
      expect(bot.unique).toBeDefined()
      expect(bot.self_id).toBeDefined()
    })
  })

  describe('Adapter Lifecycle', () => {
    it('should have start method', () => {
      expect(typeof adapter.start).toBe('function')
    })

    it('should have stop method', () => {
      expect(typeof adapter.stop).toBe('function')
    })

    it('should start successfully', async () => {
      await expect(adapter.start()).resolves.not.toThrow()
    })

    it('should stop successfully', async () => {
      await adapter.start()
      await expect(adapter.stop()).resolves.not.toThrow()
    })

    it('should add to plugin adapters on start', async () => {
      await adapter.start()
      expect(plugin.adapters).toContain(adapter)
    })

    it('should remove from plugin adapters on stop', async () => {
      await adapter.start()
      await adapter.stop()
      expect(plugin.adapters).not.toContain(adapter)
    })

    it('should clear bots on stop', async () => {
      await adapter.start()
      await adapter.stop()
      expect(adapter.bots.size).toBe(0)
    })
  })

  describe('Event Handling', () => {
    it('should listen to call.recallMessage event', () => {
      const listeners = adapter.listeners('call.recallMessage')
      expect(listeners.length).toBeGreaterThan(0)
    })

    it('should listen to message.receive event', () => {
      const listeners = adapter.listeners('message.receive')
      expect(listeners.length).toBeGreaterThan(0)
    })

    it('should remove all listeners on stop', async () => {
      await adapter.start()
      await adapter.stop()
      
      expect(adapter.listenerCount('call.recallMessage')).toBe(0)
      expect(adapter.listenerCount('message.receive')).toBe(0)
    })
  })

  describe('Message Sending', () => {
    it('should handle sendMessage event', async () => {
      const bot = adapter.bots.values().next().value
      const sendSpy = vi.spyOn(bot, 'sendMessage')
      
      await adapter.sendMessage(bot.unique, {
        context: 'test',
        bot: bot.unique,
        content: 'test message',
        id: 'test-channel',
        type: 'text' as const
      })
      
      expect(sendSpy).toHaveBeenCalled()
    })

    it('should throw error when bot not found for sending', async () => {
      await expect(
        adapter.sendMessage('non-existent-bot', {
          context: 'test',
          bot: 'non-existent-bot',
          content: 'test message',
          id: 'test-channel',
          type: 'text' as const
        })
      ).rejects.toThrow()
    })
  })

  describe('Message Receiving', () => {
    it('should process received messages through middleware', async () => {
      const bot = adapter.bots.values().next().value
      
      const middlewareSpy = vi.fn()
      plugin.addMiddleware(async (event, next) => {
        middlewareSpy(event)
        return next()
      })

      const mockMessage = {
        $adapter: '${pluginName}',
        $bot: bot.unique,
        $channel: { id: 'test-channel', type: 'text' },
        $sender: { id: 'test-user' },
        $content: 'test message',
        $timestamp: Date.now()
      }

      await adapter.sendMessage(bot.unique, mockMessage)
    })
  })
  describe('Bot Methods', () => {
    let bot: Mock${capitalizedName}Bot
    beforeEach(() => {
      bot = adapter.bots.values().next().value as Mock${capitalizedName}Bot
    })
    it('should have connect method', () => {
      expect(typeof bot.connect).toBe('function')
    })

    it('should have disconnect method', () => {
      expect(typeof bot.disconnect).toBe('function')
    })

    it('should have sendMessage method', () => {
      expect(typeof bot.sendMessage).toBe('function')
    })

    it('should have recallMessage method', () => {
      expect(typeof bot.recallMessage).toBe('function')
    })

    it('should connect successfully', async () => {
      await bot.connect()
      expect(bot.$connected).toBe(true)
    })

    it('should disconnect successfully', async () => {
      await bot.connect()
      await bot.disconnect()
      expect(bot.$connected).toBe(false)
    })
  })

  describe('Custom Tests', () => {
    // 在这里添加你的自定义测试
    it('should pass custom test', () => {
      expect(true).toBe(true)
    })
  })
})
`;
  
  await fs.writeFile(path.join(testsDir, 'index.test.ts'), testContent);
}

async function addPluginToApp(pluginName: string, isOfficial?: boolean) {
  try {
    const rootPackageJsonPath = path.resolve(process.cwd(), 'package.json');
    
    // 检查根 package.json 是否存在
    if (!fs.existsSync(rootPackageJsonPath)) {
      logger.warn('⚠ 未找到根目录 package.json，跳过依赖添加');
      return;
    }
    
    const packageJson = await fs.readJson(rootPackageJsonPath);
    const packageName = isOfficial ? `@zhin.js/${pluginName}` : `zhin.js-${pluginName}`;
    
    // 初始化 dependencies
    if (!packageJson.dependencies) {
      packageJson.dependencies = {};
    }
    
    // 添加 workspace 依赖
    packageJson.dependencies[packageName] = 'workspace:*';
    
    // 写回文件
    await fs.writeJson(rootPackageJsonPath, packageJson, { spaces: 2 });
    
    logger.success(`✓ 已将 ${packageName} 添加到 package.json`);
    
    // 重新安装依赖
    logger.info('正在更新依赖...');
    try {
      execSync('pnpm install', {
        cwd: process.cwd(),
        stdio: 'inherit'
      });
      logger.success('✓ 依赖更新成功');
    } catch (error) {
      logger.warn('⚠ 依赖更新失败，请手动执行 pnpm install');
    }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`⚠ 添加到 package.json 失败: ${errorMessage}`);
    }
}
