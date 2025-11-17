# Zhin Bot Framework Plugins

Zhin框架的插件生态系统，包含平台适配器、功能服务、游戏娱乐和工具类插件。

## 插件分类

### adapters/ - 平台适配器

连接不同平台的机器人协议，使 Zhin 能够在多个平台上运行。

### services/ - 功能服务插件

提供特定功能的服务插件，如API集成、数据处理等。

### games/ - 游戏娱乐插件

提供游戏和娱乐功能的插件。

### utils/ - 工具类插件

提供通用工具和辅助功能的插件。

---

## 可用平台适配器

### @zhin.js/adapter-icqq

ICQQ协议适配器，用于连接QQ机器人。

```bash
pnpm add @zhin.js/adapter-icqq
```

### @zhin.js/adapter-onebot11

OneBot v11协议适配器，支持多种机器人平台。

```bash
pnpm add @zhin.js/adapter-onebot11
```

### @zhin.js/adapter-process

进程管理适配器，用于管理和监控机器人进程。

```bash
pnpm add @zhin.js/adapter-process
```

## 开发新插件

### 创建平台适配器

1. 创建适配器目录：
```bash
mkdir plugins/adapters/my-adapter
cd plugins/adapters/my-adapter
```

2. 初始化package.json：
```json
{
  "name": "@zhin.js/adapter-my-adapter",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "files": [
    "lib"
  ],
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@zhin.js/core": "workspace:*"
  }
}
```

3. 实现适配器：
```typescript
import { Adapter, Bot } from '@zhin.js/core'

class MyBot implements Bot {
  constructor(public config: any) {}
  
  async connect() {
    // 实现连接逻辑
  }
  
  async disconnect() {
    // 实现断开逻辑
  }
  
  async sendMessage(options: any) {
    // 实现消息发送
  }
}

export class MyAdapter extends Adapter {
  constructor() {
    super('my-adapter', (plugin, config) => new MyBot(config))
  }
}
```

4. 注册适配器：
```typescript
import { registerAdapter } from '@zhin.js/core'
import { MyAdapter } from './adapter'

registerAdapter(new MyAdapter())
```

### 创建其他类型插件

#### 功能服务插件
```bash
mkdir plugins/services/my-service
cd plugins/services/my-service
```

#### 游戏娱乐插件
```bash
mkdir plugins/games/my-game
cd plugins/games/my-game
```

#### 工具类插件
```bash
mkdir plugins/utils/my-util
cd plugins/utils/my-util
```

## 插件开发规范

1. **命名规范**
   - 适配器：`@zhin.js/adapter-<name>`
   - 功能插件：`@zhin.js/plugin-<name>`
   - 工具插件：`@zhin.js/util-<name>`

2. **目录结构**
   ```
   my-plugin/
   ├── src/           # 源代码
   ├── lib/           # 编译输出
   ├── package.json
   ├── tsconfig.json
   └── README.md
   ```

3. **依赖管理**
   - 核心依赖使用 `workspace:*`
   - 避免重复依赖
   - 使用 peerDependencies 声明框架依赖

## 许可证

MIT License
