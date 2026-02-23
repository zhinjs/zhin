# 游戏插件 (Games)

> 此模块为计划中的功能，尚未实现。

游戏插件目录预留用于放置基于 Zhin.js 的交互式游戏插件（如猜数字、21 点、成语接龙等）。

## 贡献

欢迎提交 PR 添加新的游戏插件。插件应遵循 Zhin.js 的标准插件开发模式：

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand } = usePlugin()

addCommand(new MessageCommand('game-name')
  .description('游戏描述')
  .action(async (message, result) => {
    // 游戏逻辑
  })
)
```

详见 [插件开发文档](../../docs/essentials/plugins.md)。
