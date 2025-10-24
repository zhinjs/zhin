import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';
import { execSync } from 'node:child_process';

interface NewPluginOptions {
  skipInstall?: boolean;
}

export const newCommand = new Command('new')
  .description('创建插件包模板')
  .argument('[plugin-name]', '插件名称（如: my-plugin）')
  .option('--skip-install', '跳过依赖安装', false)
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

      logger.info(`正在创建插件包 ${name}...`);
      
      // 创建插件包结构
      await createPluginPackage(pluginDir, name, options);
      
      // 自动添加到 app/package.json
      await addPluginToApp(name);
      
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
      logger.error(`创建插件失败: ${error}`);
      process.exit(1);
    }
  });

async function createPluginPackage(pluginDir: string, pluginName: string, options: NewPluginOptions) {
  const capitalizedName = pluginName.charAt(0).toUpperCase() + pluginName.slice(1).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const packageName = `@zhin.js/${pluginName}`;
  
  // 创建目录结构
  await fs.ensureDir(pluginDir);
  await fs.ensureDir(path.join(pluginDir, 'app'));
  await fs.ensureDir(path.join(pluginDir, 'client'));
  await fs.ensureDir(path.join(pluginDir, 'lib'));
  await fs.ensureDir(path.join(pluginDir, 'dist'));
  
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
      'app',
      'dist',
      'client',
      'README.md',
      'CHANGELOG.md'
    ],
    scripts: {
      build: 'pnpm build:app && pnpm build:client',
      'build:app': 'tsc --project tsconfig.app.json',
      'build:client': 'tsc --project tsconfig.client.json',
      dev: 'tsc --project tsconfig.app.json --watch',
      clean: 'rm -rf lib dist',
      prepublishOnly: 'pnpm build'
    },
    keywords: [
      'zhin',
      'zhin-plugin',
      pluginName
    ],
    author: '',
    license: 'MIT',
    peerDependencies: {
      'zhin.js': 'workspace:*'
    },
    dependencies: {
      '@zhin.js/client': 'workspace:*'
    },
    devDependencies: {
      '@zhin.js/types': 'workspace:*',
      '@types/node': 'latest',
      '@types/react': 'latest',
      'typescript': 'latest',
      'react': 'latest',
      'react-dom': 'latest',
      'lucide-react': 'latest'
    }
  };
  
  await fs.writeJson(path.join(pluginDir, 'package.json'), packageJson, { spaces: 2 });
  
  // 创建 tsconfig.app.json (插件代码)
  const tsConfigApp = {
    extends: '../../tsconfig.json',
    compilerOptions: {
      rootDir: './app',
      outDir: './lib',
      declaration: true,
      noEmit: false
    },
    include: ['app/**/*'],
    exclude: ['node_modules', 'lib', 'dist']
  };
  
  await fs.writeJson(path.join(pluginDir, 'tsconfig.app.json'), tsConfigApp, { spaces: 2 });
  
  // 创建 tsconfig.client.json (客户端代码)
  const tsConfigClient = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      rootDir: './client',
      outDir: './dist',
      declaration: false,
      jsx: 'react-jsx',
      baseUrl: '.',
      skipLibCheck: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true
    },
    include: ['client/**/*'],
    exclude: ['node_modules', 'lib', 'dist']
  };
  
  await fs.writeJson(path.join(pluginDir, 'tsconfig.client.json'), tsConfigClient, { spaces: 2 });
  
  // 创建 tsconfig.json (编辑器支持)
  const tsConfig = {
    extends: '../../tsconfig.json',
    include: ['app/**/*', 'client/**/*'],
    exclude: ['node_modules', 'lib', 'dist']
  };
  
  await fs.writeJson(path.join(pluginDir, 'tsconfig.json'), tsConfig, { spaces: 2 });
  
  // 创建插件主入口文件 app/index.ts
  const appContent = `import {
  useLogger,
  useContext,
  onDispose,
} from 'zhin.js';
import path from 'node:path';

const logger = useLogger();

// 注册客户端入口（如果有客户端代码）
useContext('web', (web) => {
  const dispose = web.addEntry(
    path.resolve(import.meta.dirname, '../client/index.tsx')
  );
  return dispose;
});

// 插件销毁时的清理
onDispose(() => {
  logger.info('${capitalizedName} 插件已销毁');
});

logger.info('${capitalizedName} 插件已加载');
`;
  
  await fs.writeFile(path.join(pluginDir, 'app', 'index.ts'), appContent);
  
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

async function addPluginToApp(pluginName: string) {
  try {
    const rootPackageJsonPath = path.resolve(process.cwd(), 'package.json');
    
    // 检查根 package.json 是否存在
    if (!fs.existsSync(rootPackageJsonPath)) {
      logger.warn('⚠ 未找到根目录 package.json，跳过依赖添加');
      return;
    }
    
    const packageJson = await fs.readJson(rootPackageJsonPath);
    const packageName = `@zhin.js/${pluginName}`;
    
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
    logger.warn(`⚠ 添加到 package.json 失败: ${error}`);
  }
}
