# CLI 和 Create-Zhin-App 验证报告

## 🔍 验证范围

基于 test-bot 的实际使用情况，验证 CLI 和 create-zhin-app 的代码生成是否正确。

## ❌ 发现的问题

### 1. 插件示例代码中的属性访问错误

**位置：** `packages/cli/src/commands/init.ts:280`

**问题：**
```typescript
// ❌ 错误的代码
logger.info('Hello command called by:', message.sender.name);

// ✅ 应该是
logger.info('Hello command called by:', message.$sender.name);
```

**说明：** Message 对象使用 `$sender` 而不是 `sender`

---

### 2. 插件示例代码中的错误属性访问

**位置：** `packages/cli/src/commands/init.ts:300, 307`

**问题：**
```typescript
// ❌ 错误的代码
logger.info(`收到消息: ${message.raw}`);
if (message.raw.includes('帮助')) {
  await message.reply('...');
}

// ✅ 应该是
logger.info(`收到消息: ${message.$raw}`);
if (message.$raw.includes('帮助')) {
  await message.$reply('...');
}
```

**说明：** Message 对象的属性和方法都使用 `$` 前缀

---

### 3. 配置文件中 plugin_dirs 的路径问题

**位置：** `packages/cli/src/commands/init.ts:661-665, 809-813`

**问题：**
```typescript
// ❌ 生成的代码
plugin_dirs: [
  env.PLUGIN_DIR || './src/plugins',
  'node_modules',
  'node_modules/@zhin.js'  // 字符串路径
],

// ✅ test-bot 的实际代码
plugin_dirs: [
  env.PLUGIN_DIR || './src/plugins',
  'node_modules',
  path.join('node_modules', '@zhin.js')  // 使用 path.join
],
```

**说明：** test-bot 使用 `path.join()` 确保跨平台兼容性

---

### 4. 缺少 database 配置

**位置：** 生成的配置文件

**问题：** CLI 生成的配置文件缺少数据库配置

**test-bot 的实际配置：**
```typescript
export default defineConfig(async (env) => {
  return {
    // 数据库配置
    database: {
      dialect: 'sqlite',
      filename: './data/test.db'
    },
    
    // 其他配置...
  }
})
```

**建议：** 添加默认的数据库配置

---

### 5. 环境变量示例不完整

**位置：** `packages/cli/src/commands/init.ts:559`

**问题：** .env.example 缺少一些 test-bot 使用的环境变量

**test-bot 使用的环境变量：**
```bash
# QQ 官方机器人（test-bot 实际使用）
QQ_APPID=102073979
ZHIN_SECRET=your_secret
ZHIN2_SECRET=your_secret

# ICQQ（test-bot 实际使用）
ICQQ_SCAN_UIN=your-qq-number
ICQQ_LOGIN_UIN=your-qq-number
ICQQ_PASSWORD=your_password
ICQQ_SIGN_ADDR=http://localhost:8080

# KOOK（test-bot 实际使用）
KOOK_TOKEN=your-kook-token
```

---

### 6. CLI README 中的配置示例不准确

**位置：** `packages/cli/README.md:188-226`

**问题：** README 中的配置示例与实际生成的代码不一致

**README 中的示例：**
```typescript
databases: [  // ❌ 实际不会生成
  {
    name: 'main',
    type: 'sqlite',
    database: './data/bot.db'
  }
],
```

**实际生成的配置：** 没有 database 配置

---

### 7. 插件目录配置不一致

**test-bot 实际配置：**
```typescript
plugin_dirs: [
  env.PLUGIN_DIR || './src/plugins',
  'node_modules',
  path.join('node_modules', '@zhin.js'),  // 使用 path.join 并导入 path
],
```

**CLI 生成的配置：**
- 没有导入 `path` 模块
- 直接使用字符串 `'node_modules/@zhin.js'`

---

### 8. 缺少导入声明

**位置：** 生成的配置文件（ts/js 格式）

**问题：** 配置文件使用了 `process.pid` 但在 ts 格式应该导入类型

**建议：**
```typescript
import { defineConfig } from 'zhin.js';
import path from 'node:path';  // 添加这行

export default defineConfig(async (env) => {
  // ...
})
```

---

## ✅ 正确的部分

### 1. 项目结构

```
✅ src/
✅ src/plugins/
✅ dist/
✅ data/
✅ package.json
✅ tsconfig.json
✅ .gitignore
✅ README.md
✅ .env.example
```

### 2. package.json 依赖

```json
✅ "zhin.js"
✅ "@zhin.js/adapter-process"
✅ "@zhin.js/http"
✅ "@zhin.js/console"
✅ "@zhin.js/cli"
✅ "@zhin.js/types"
```

### 3. tsconfig.json 配置

```json
✅ jsx: 'react-jsx'
✅ jsxImportSource: 'zhin.js'
✅ types: ['@types/node', '@zhin.js/types', 'zhin.js']
```

### 4. 脚本配置

```json
✅ "dev": "zhin dev"
✅ "start": "zhin start"
✅ "daemon": "zhin start --daemon"
✅ "build": "zhin build"
✅ "stop": "zhin stop"
```

---

## 🔧 修复建议

### 修复 1: 更新插件示例代码

```typescript
// packages/cli/src/commands/init.ts

const pluginContent = `import {
  useLogger,
  onMessage,
  addCommand,
  addMiddleware,
  MessageCommand,
  useContext,
  onDispose,
} from 'zhin.js';

const logger = useLogger();

// 添加命令
addCommand(new MessageCommand('hello')
  .action(async (message) => {
    logger.info('Hello command called by:', message.$sender.name);  // 修复：$sender
    return '你好！欢迎使用 Zhin 机器人框架！';
  })
);

addCommand(new MessageCommand('status')
  .action(() => {
    const uptime = process.uptime() * 1000;
    const memory = process.memoryUsage();
    return [
      '🤖 机器人状态',
      \`⏱️ 运行时间: \${formatTime(uptime)}\`,
      \`📊 内存使用: \${(memory.rss / 1024 / 1024).toFixed(2)}MB\`,
      \`🔧 Node.js: \${process.version}\`
    ].join('\\n');
  })
);

// 添加中间件
addMiddleware(async (message, next) => {
  logger.info(\`收到消息: \${message.$raw}\`);  // 修复：$raw
  await next();
});

// 监听消息
onMessage(async (message) => {
  if (message.$raw.includes('帮助')) {  // 修复：$raw
    await message.$reply('可用命令：hello, status\\n输入命令即可使用！');  // 修复：$reply
  }
});

// 使用 process 上下文
useContext('process', () => {
  logger.info('Process 适配器已就绪，可以在控制台输入消息进行测试');
});

// 插件销毁时的清理
onDispose(() => {
  logger.info('测试插件已销毁');
});

// 工具函数
function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return \`\${days}天 \${hours % 24}小时\`;
  if (hours > 0) return \`\${hours}小时 \${minutes % 60}分钟\`;
  if (minutes > 0) return \`\${minutes}分钟 \${seconds % 60}秒\`;
  return \`\${seconds}秒\`;
}

logger.info('测试插件已加载');
`;
```

### 修复 2: 更新配置文件生成

```typescript
// packages/cli/src/commands/init.ts

case 'ts':
case 'js':
  return `import { defineConfig } from 'zhin.js';
import path from 'node:path';  // 添加 path 导入

export default defineConfig(async (env) => {
  return {
    // 数据库配置（添加）
    database: {
      dialect: 'sqlite',
      filename: './data/bot.db'
    },
    
    // 机器人配置
    bots: [
      {
        name: \`\${process.pid}\`,
        context: 'process'
      }
    ],
    
    // 插件目录
    plugin_dirs: [
      env.PLUGIN_DIR || './src/plugins',
      'node_modules',
      path.join('node_modules', '@zhin.js')  // 使用 path.join
    ],
    
    // 要加载的插件列表
    plugins: [
      'http',               // 注意：http 应该在 adapter-process 之前
      'adapter-process',
      'console',
      'test-plugin'
    ],

    // 调试模式
    debug: env.DEBUG === 'true'
  };
});
`;
```

### 修复 3: 更新 .env.example

```typescript
// packages/cli/src/commands/init.ts

const envExampleContent = `# Zhin Bot 环境变量配置示例
# 复制为 .env 文件并根据需要修改

# 调试模式
DEBUG=true

# 插件目录 (可选)
# PLUGIN_DIR=./src/plugins

# QQ 官方机器人配置（如果使用 QQ 适配器）
# QQ_APPID=your-app-id
# QQ_SECRET=your-secret

# KOOK 机器人配置（如果使用 KOOK 适配器）
# KOOK_TOKEN=your-kook-token

# ICQQ 机器人配置（如果使用 ICQQ 适配器）
# ICQQ_SCAN_UIN=your-qq-number
# ICQQ_LOGIN_UIN=your-qq-number
# ICQQ_PASSWORD=your-password
# ICQQ_SIGN_ADDR=http://localhost:8080

# OneBot 机器人配置（如果使用 OneBot 适配器）
# ONEBOT_NAME=my-bot
# ONEBOT_TOKEN=your-access-token
# ONEBOT_URL=ws://localhost:8080
`;
```

### 修复 4: 更新 CLI README

移除或修正 README 中不准确的配置示例，改为与实际生成的代码一致。

---

## 📊 验证总结

| 项目 | 状态 | 说明 |
|------|------|------|
| 项目结构 | ✅ 正确 | 目录结构符合预期 |
| package.json | ✅ 正确 | 依赖配置正确 |
| tsconfig.json | ✅ 正确 | TypeScript 配置正确 |
| 插件示例代码 | ❌ 错误 | 使用了错误的属性名 |
| 配置文件 | ⚠️ 部分正确 | 缺少 database 配置，path 使用不一致 |
| .env.example | ⚠️ 不完整 | 缺少部分环境变量 |
| CLI README | ❌ 不准确 | 示例与实际不符 |

---

## 🎯 优先级

### 高优先级（必须修复）
1. ❌ 插件示例代码中的属性访问错误
2. ❌ 配置文件缺少 path 导入

### 中优先级（建议修复）
3. ⚠️ 添加数据库配置
4. ⚠️ 使用 path.join 而不是字符串拼接
5. ⚠️ 完善 .env.example

### 低优先级（可选）
6. 📝 更新 CLI README 中的示例
7. 📝 添加更多注释和说明

---

## ✅ 建议的测试流程

1. **修复所有代码问题**
2. **运行 CLI init 命令创建测试项目**
   ```bash
   npm create zhin-app test-verify
   ```
3. **验证生成的文件**
   - 检查 Message 属性是否使用 `$` 前缀
   - 检查配置文件是否导入 path
   - 检查插件能否正常运行
4. **测试热重载**
   ```bash
   cd test-verify
   pnpm install
   pnpm dev
   ```
5. **对比 test-bot**
   - 功能是否一致
   - 配置是否兼容
   - 插件是否正常加载

---

## 📝 文档更新建议

### 1. 快速开始文档

需要确保文档中的示例代码与 CLI 生成的代码一致。

### 2. 配置文档

需要添加数据库配置的说明。

### 3. 插件开发文档

需要明确说明 Message 对象的属性都使用 `$` 前缀。

---

## 🔗 相关文件

- `packages/cli/src/commands/init.ts` - CLI init 命令实现
- `packages/create-zhin/src/index.ts` - create-zhin-app 实现
- `packages/cli/README.md` - CLI 文档
- `test-bot/zhin.config.ts` - test-bot 实际配置
- `test-bot/src/plugins/test-plugin.ts` - test-bot 实际插件

---

**结论：** CLI 和 create-zhin-app 的基础功能正确，但生成的代码存在一些与实际使用不一致的问题，需要修复以确保新用户能够获得正确的代码示例。

