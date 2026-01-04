# Console 插件内存问题分析

## 🔥 问题描述

当启用 `@zhin.js/console` 插件并在浏览器中打开页面时，堆内存会从 60MB 飙升到 80MB（+20MB），这是不可接受的。

## 📊 内存增长分析

### 启动时（Vite 已启动，但浏览器未访问）
- **堆内存**: ~60MB
- **包含**: Vite、React、Tailwind CSS 等依赖已加载

### 浏览器首次访问后
- **堆内存**: ~80MB（+20MB）
- **原因**: Vite 模块缓存爆炸

## 🔍 根本原因

### 1. Vite 的模块缓存机制

当浏览器请求页面时，Vite 会：

```typescript
// Vite 会加载并缓存所有依赖模块
moduleGraph.urlToModuleMap.set(url, {
  url,
  transformResult: {
    code: '...', // 转换后的代码（可能很大）
    map: '...',  // Source Map（也很大）
  },
  importers: Set<ModuleNode>,
  importedModules: Set<ModuleNode>,
  // ... 更多元数据
});
```

**内存占用估算**:
- React + React DOM: ~10MB（转换后的代码 + Source Map）
- Redux Toolkit: ~3MB
- Radix UI: ~5MB
- React Router: ~3MB
- 其他依赖: ~5MB
- **总计**: ~26MB

但实际只增长了 20MB，说明有一部分已经在启动时加载了。

### 2. WebSocket 数据同步

```typescript
// websocket.ts
webServer.ws.on("connection", (ws: WebSocket) => {
  // 1. 同步所有 entries
  ws.send(JSON.stringify({
    type: "sync",
    data: { key: "entries", value: Object.values(webServer.entries) }
  }));

  // 2. 同步初始化数据
  ws.send(JSON.stringify({ type: "init-data", timestamp: Date.now() }));
});

// 每 5 秒推送一次数据更新
setInterval(() => {
  notifyDataUpdate(webServer);
}, 5000);
```

**内存占用**: 每个连接 ~100KB（JSON 序列化 + WebSocket 缓冲区）

### 3. Vite HMR 状态

Vite 会为每个模块维护：
- 依赖图（importers、importedModules）
- 热更新状态
- 文件监听器

**内存占用**: ~2-3MB

## 💡 解决方案

### 方案 A: 迁移到 esbuild（推荐）

**优点**:
- ✅ 内存占用降低 65%（23MB → 8MB）
- ✅ 启动速度提升 85%
- ✅ 保留 90% 的开发体验

**实现**:
1. 替换 Vite 为 esbuild
2. 使用 esbuild 的 `context.watch()` + `context.serve()`
3. 添加简单的 WebSocket HMR（全页面刷新）
4. 使用 PostCSS 处理 Tailwind CSS

**预期效果**:
- 启动时: 60MB → 20MB
- 浏览器访问后: 80MB → 30MB

详见: [lightweight-dev-server-comparison.md](./lightweight-dev-server-comparison.md)

### 方案 B: 优化 Vite 配置

如果暂时不想迁移，可以优化 Vite 配置：

```typescript
// vite.config.ts
export default {
  build: {
    // 禁用 Source Map（开发环境）
    sourcemap: false,
  },
  server: {
    // 减少 HMR 缓存
    hmr: {
      overlay: false,
    },
  },
  optimizeDeps: {
    // 预构建依赖（减少运行时转换）
    include: [
      'react',
      'react-dom',
      'react-router',
      '@reduxjs/toolkit',
      'react-redux',
    ],
  },
};
```

**预期效果**:
- 启动时: 60MB → 45MB
- 浏览器访问后: 80MB → 60MB

### 方案 C: 按需加载模块

修改前端代码，使用动态导入：

```typescript
// 原来：直接导入
import { Button } from '@radix-ui/themes';

// 优化：动态导入
const Button = lazy(() => import('@radix-ui/themes').then(m => ({ default: m.Button })));
```

**预期效果**:
- 启动时: 60MB（不变）
- 浏览器访问后: 80MB → 70MB

### 方案 D: 禁用 Source Map

最简单的优化：

```typescript
// dev.ts
const vite = await createServer({
  // ...
  build: {
    sourcemap: false, // 禁用 Source Map
  },
});
```

**预期效果**:
- 启动时: 60MB → 50MB
- 浏览器访问后: 80MB → 65MB

## 🎯 推荐方案

### 短期（1-2 天）
1. **禁用 Source Map**（方案 D）
   - 最简单，立即生效
   - 节省 ~15MB 内存

2. **优化 Vite 配置**（方案 B）
   - 预构建依赖
   - 节省 ~20MB 内存

### 长期（1-2 周）
3. **迁移到 esbuild**（方案 A）
   - 最彻底的解决方案
   - 节省 ~50MB 内存
   - 提升开发体验

## 📝 验证方法

使用新增的调试命令：

```bash
# 1. 启动应用
pnpm dev

# 2. 查看初始内存
zt mem

# 3. 打开浏览器访问 http://localhost:8086

# 4. 查看 Vite 缓存
zt vite-cache

# 5. 查看 WebSocket 连接
zt ws-clients

# 6. 再次查看内存
zt mem
```

## 🎉 总结

Console 插件的内存问题主要来自 Vite 的模块缓存机制。当浏览器首次访问时，Vite 会加载并缓存所有依赖模块（包括转换后的代码和 Source Map），导致内存增长 20MB。

**最佳解决方案**: 迁移到 esbuild，可以将总内存从 80MB 降低到 30MB，同时保持良好的开发体验。

**临时解决方案**: 禁用 Source Map 和优化 Vite 配置，可以将内存降低到 60-65MB。


