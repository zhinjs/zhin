# Zhin Bot Framework Adapters

Zhin框架的适配器集合，用于支持不同平台的机器人功能。

## 可用适配器

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

## 开发新适配器

1. 创建适配器目录：
```bash
mkdir adapters/my-adapter
cd adapters/my-adapter
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

## 许可证

MIT License
