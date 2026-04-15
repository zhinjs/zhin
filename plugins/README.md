# Zhin.js Plugins

Zhin.js 插件生态仓库，包含适配器、服务、工具等插件。

## 独立开发

```bash
pnpm install
pnpm build
pnpm test
```

## 作为 submodule 使用

此仓库通常作为 [zhin](https://github.com/zhinjs/zhin) 主仓库的 submodule 使用：

```bash
git clone --recurse-submodules https://github.com/zhinjs/zhin.git
```

## 目录结构

- `adapters/` - 平台适配器 (icqq, kook, discord, qq, onebot11, ...)
- `services/` - 功能服务 (http, console, mcp)
- `features/` - 特性插件
- `utils/` - 工具插件 (music, sensitive-filter, ...)
- `games/` - 游戏插件
