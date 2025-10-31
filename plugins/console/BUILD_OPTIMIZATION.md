# Console 与插件客户端构建优化

## 概述

本文档说明了 Console 插件和其他插件客户端代码的构建优化策略，实现公共依赖的复用，减少重复打包。

## 架构设计

### 两种构建模式

1. **Console Client (SPA 模式)** - `buildConsoleClient()`
   - 完整的单页应用，包含 `index.html`
   - 将公共 npm 模块分割成独立的 vendor chunks
   - 作为依赖提供方，供其他插件复用

2. **Plugin Client (库模式)** - `buildPluginClient()`
   - 单文件入口（`client/index.tsx`）
   - 将公共依赖标记为 external
   - 运行时从 Console 的 vendor chunks 中加载依赖

## 公共依赖分割策略

Console 客户端构建时，使用 Vite 的 `manualChunks` 将依赖分组：

### Vendor Chunks 分组

| Chunk 名称 | 包含的模块 | 用途 |
|-----------|----------|------|
| `vendor-react` | react, react-dom | React 核心库 (~190KB) |
| `vendor-react-ecosystem` | react-router, react-redux, @remix-run/* | React 生态系统 (~70KB) |
| `vendor-redux` | @reduxjs/toolkit, redux, redux-persist | 状态管理 (~23KB) |
| `vendor-ui` | @radix-ui/*, lucide-react | UI 组件库 (~250KB) |
| `vendor-utils` | clsx, tailwind-merge, class-variance-authority | 工具库 (~25KB) |
| `vendor` | 其他 node_modules | 其他依赖 (~56KB) |

### 总体收益

- **首次加载**: 约 614KB 的公共代码（gzip 后约 177KB）
- **插件加载**: 仅加载业务代码（通常 < 30KB）
- **缓存效率**: 公共代码可跨插件复用，无需重复下载

## 插件构建配置

### External 配置

插件客户端构建时，以下依赖被标记为 external：

```typescript
external: [
  // React 核心
  "react",
  "react-dom",
  "react/jsx-runtime",
  /^react\//,
  /^react-dom\//,
  
  // React 生态系统
  "react-router",
  "react-redux",
  /^react-router/,
  /^@remix-run/,
  
  // Redux
  "@reduxjs/toolkit",
  "redux",
  "redux-persist",
  /^redux/,
  
  // UI 组件库
  "@zhin.js/client",
  "@radix-ui/themes",
  "lucide-react",
  /^@radix-ui\//,
  
  // 工具库
  "clsx",
  "tailwind-merge",
  "class-variance-authority",
]
```

## 运行时加载机制

### 开发模式

通过 Vite 开发服务器，所有模块自动共享：

```
Console Vite Server (http://localhost:8086/vite/)
  ├── node_modules/react (共享)
  ├── node_modules/@radix-ui/themes (共享)
  └── /vite/@fs/path/to/plugin/client/index.tsx
      └── import from 'react' → 复用 Vite 缓存
```

### 生产模式

Console 加载插件时，浏览器自动解析 ES 模块导入：

```
index.html
  ├── vendor-react.js (浏览器缓存)
  ├── vendor-ui.js (浏览器缓存)
  └── 动态加载插件:
      └── plugin-xxx/dist/index.js
          └── import from 'react' → 复用已加载的 vendor-react.js
```

## 构建命令

### 构建 Console 客户端

```bash
cd plugins/console
pnpm build:client
# 或
node lib/bin.js build:console
```

输出示例：
```
../dist/assets/vendor-react-Bhn8EZ2l.js            190.19 kB │ gzip: 59.34 kB
../dist/assets/vendor-ui-XuvtAjow.js               250.21 kB │ gzip: 65.91 kB
../dist/assets/vendor-redux-C1P1C07T.js             23.44 kB │ gzip:  8.22 kB
...
```

### 构建插件客户端

```bash
cd adapters/process
node ../../plugins/console/lib/bin.js build
# 或在插件目录
pnpm zhin-client build
```

输出示例：
```
../dist/index.js  29.12 kB │ gzip: 7.21 kB
✅ Plugin client code built successfully
📦 External dependencies will be loaded from console vendor chunks
```

## 最佳实践

### 1. 避免重复依赖

**❌ 错误**: 在插件中安装并打包公共依赖
```json
{
  "dependencies": {
    "react": "^18.3.1",
    "@radix-ui/themes": "^3.1.7"
  }
}
```

**✅ 正确**: 使用 peerDependencies 或 devDependencies
```json
{
  "peerDependencies": {
    "react": "^18.3.1",
    "@radix-ui/themes": "^3.1.7"
  },
  "devDependencies": {
    "react": "^18.3.1",
    "@radix-ui/themes": "^3.1.7"
  }
}
```

### 2. 自定义依赖

如果插件需要 Console 未包含的依赖：

```typescript
// 在插件构建配置中不标记为 external
await build({
  build: {
    rollupOptions: {
      external: [
        'react', // 外部化
        'react-dom', // 外部化
        // 'my-special-lib' 不外部化，直接打包
      ]
    }
  }
})
```

### 3. 验证构建产物

检查生成的 `dist/index.js`，确保：
- 文件大小合理（通常 < 50KB）
- import 语句指向正确的模块名
- 没有打包重复的 vendor 代码

```bash
# 检查文件大小
ls -lh dist/index.js

# 查看导入语句
head -20 dist/index.js
```

### 4. 测试加载

在开发环境中测试插件加载：

```bash
cd test-bot
pnpm dev
# 访问 http://localhost:8086/vite/
# 检查 Network 面板，确认 vendor chunks 只加载一次
```

## 性能对比

### 优化前（每个插件独立打包）

```
process-plugin: 650KB (包含 react, @radix-ui 等)
icqq-plugin: 680KB (包含 react, @radix-ui 等)
总计: 1330KB (重复打包公共代码)
```

### 优化后（共享 vendor chunks）

```
console: 614KB (公共 vendor chunks)
process-plugin: 29KB (仅业务代码)
icqq-plugin: 35KB (仅业务代码)
总计: 678KB (节省 ~49%)
```

## 故障排查

### 问题：插件加载时报 "Cannot find module 'react'"

**原因**: 插件依赖未正确外部化或 Console vendor chunks 未加载

**解决方案**:
1. 检查 `buildPluginClient` 的 `external` 配置
2. 确保 Console 已构建并包含对应的 vendor chunk
3. 检查浏览器控制台，确认 vendor chunks 加载成功

### 问题：插件体积过大

**原因**: 某些依赖未被外部化

**解决方案**:
1. 查看 `dist/index.js`，找出被打包的大型依赖
2. 在 `external` 配置中添加对应的模块名或正则表达式
3. 如果是必需的依赖，考虑在 Console 的 `manualChunks` 中添加分组

### 问题：版本不兼容

**原因**: Console 和插件使用了不同版本的依赖

**解决方案**:
1. 统一 workspace 中所有包的依赖版本
2. 使用 pnpm 的 `catalog` 功能管理版本
3. 在根 `package.json` 中使用 `pnpm.overrides` 强制版本

## 参考

- [Vite - Build Options](https://vite.dev/config/build-options.html)
- [Rollup - manualChunks](https://rollupjs.org/configuration-options/#output-manualchunks)
- [ES Modules 加载机制](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)

---

最后更新: 2025-10-26
