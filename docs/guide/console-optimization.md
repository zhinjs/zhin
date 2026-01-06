# Console 插件内存优化指南

## 🎯 优化目标

将 Console 插件从启动时占用 **44MB** 优化到 **17MB**，节省 **27MB**（61% 优化）。

## 📊 优化效果

### 开发环境

| 场景 | 堆内存 | 说明 |
|------|--------|------|
| **优化前** | 44.39MB | Vite 依赖被提前加载 |
| **优化后（延迟加载）** | **17.23MB** ✅ | 真正的按需加载 |
| **访问控制台后** | ~42MB | Vite 启动时才加载 |

### 生产环境

| 场景 | 运行时内存 | 磁盘占用 | 依赖数量 |
|------|-----------|---------|---------|
| **使用预构建静态文件** | **17MB** ✅ | **~2MB** ✅ | 仅 2 个 (`mime`, `ws`) |
| **禁用 console** | 0MB | 0MB | 0 |

**关键优势**：
- ✅ 生产环境不需要安装 React、Vite 等依赖
- ✅ 前端代码已在构建时打包到 `dist/` 目录
- ✅ 运行时直接读取静态文件

## 🔍 问题分析

### 问题 1: 静态 Import 导致提前加载

**错误示范**：
```typescript
// dev.ts
import react from "@vitejs/plugin-react";      // ❌ 立即加载 ~10-15MB
import tailwindcss from "@tailwindcss/vite";   // ❌ 立即加载 ~5-10MB
```

**即使使用了动态 import**：
```typescript
// index.ts
const devModule = await import("./dev.js");  // ✅ 动态导入
```

但 `dev.js` 内部的静态 import 还是会在模块加载时立即执行！

### 问题 2: 所有依赖都在 dependencies

生产环境不需要 Vite，但还是会安装和加载这些依赖。

## ✅ 解决方案

### 1. 彻底的动态 Import

将所有 Vite 相关依赖改为动态加载：

```typescript
// dev.ts - 优化后
export async function createViteDevServer(options: DevServerOptions) {
  try {
    // 动态导入所有 Vite 相关依赖（避免提前加载）
    const [
      { createServer, searchForWorkspaceRoot },
      { default: react },
      { default: tailwindcss }
    ] = await Promise.all([
      import('vite'),
      import('@vitejs/plugin-react'),
      import('@tailwindcss/vite')
    ]);
    
    const plugins = [react()];
    if (enableTailwind) {
      plugins.push(tailwindcss());
    }
    // ... rest of the code
  } catch (error) {
    throw new Error('Failed to load Vite dependencies');
  }
}
```

### 2. 正确的依赖分类

**关键发现**：生产环境根本不需要 React！

- **构建时**：使用 Vite 将 React 代码打包成 `dist/` 静态文件
- **运行时**：只需要读取静态文件，不需要 React

```json
{
  "dependencies": {
    "mime": "^4.1.0",      // 文件类型识别（必需）
    "ws": "^8.18.3"        // WebSocket 服务器（必需）
  },
  "devDependencies": {
    "vite": "^7.0.6",      // 构建工具（仅开发/构建时）
    "react": "19.2.0",     // 前端框架（仅构建时）
    // ... 其他前端依赖
  },
  "optionalDependencies": {
    "koa-connect": "^2.1.0"  // Vite 中间件（仅开发模式 HMR）
  }
}
```

### 3. 延迟初始化 WebSocket

```typescript
// 使用 getter 延迟创建 WebSocket
Object.defineProperty(webServer, 'ws', {
  get() {
    if (!this._ws) {
      this._ws = router.ws("/server");
      logger.debug("WebSocket 服务器已初始化");
    }
    return this._ws;
  }
});
```

## 🚀 使用指南

### 开发环境

```bash
# 安装所有依赖（包括可选依赖）
pnpm install

# 启动开发模式（Vite HMR）
pnpm dev
```

配置：
```yaml
console:
  enabled: true
  lazyLoad: true  # 延迟加载（默认）
```

### 生产环境

#### 选项 1: 不安装可选依赖（推荐）

```bash
# 跳过可选依赖
pnpm add @zhin.js/console --no-optional

# 节省效果：
# - 磁盘空间: ~200MB
# - 运行时内存: ~25MB
```

#### 选项 2: 禁用 Console 插件

```yaml
plugins:
  # console 插件已禁用
  # - "@zhin.js/console"
```

#### 选项 3: 使用静态模式

```bash
# 1. 构建前端（开发环境）
pnpm --filter @zhin.js/console build:client

# 2. 部署时只需要 dist 目录
# 3. 生产环境启动（自动使用静态文件）
NODE_ENV=production pnpm start
```

## 📝 配置选项

### lazyLoad（延迟加载）

```yaml
console:
  lazyLoad: true  # 默认值
```

- ✅ 启动时内存: **17MB**
- ⚠️ 首次访问: 需要 1-2 秒启动 Vite
- 💡 适合: 不常访问控制台的场景

### 立即加载

```yaml
console:
  lazyLoad: false
```

- ⚠️ 启动时内存: **42MB**
- ✅ 访问控制台: 无延迟
- 💡 适合: 频繁使用控制台的开发环境

## 🎓 经验总结

### 1. 动态 Import 需要彻底

❌ **不够彻底**：
```typescript
// index.ts
const devModule = await import("./dev.js");

// dev.ts
import react from "@vitejs/plugin-react";  // 还是会立即加载！
```

✅ **彻底的动态 Import**：
```typescript
// dev.ts
const { default: react } = await import('@vitejs/plugin-react');
```

### 2. 静态 Import 会立即加载整个依赖树

- `import react from "react"` 会立即加载 React 及其所有依赖
- 即使函数没有被调用，import 也会执行
- 使用 `await import()` 才能真正延迟加载

### 3. optionalDependencies 的好处

- 开发环境: `pnpm install` 会安装所有依赖
- 生产环境: `pnpm install --no-optional` 跳过可选依赖
- CI/CD: 可以根据环境自动选择

### 4. 内存优化的层次

1. **不加载**（禁用插件）: 0MB
2. **延迟加载**（按需）: 17MB → 42MB
3. **立即加载**（传统）: 42MB

## 🔧 故障排查

### 问题 1: 生产环境启动失败

**错误**: `Cannot find module 'vite'`

**原因**: 使用了 `--no-optional` 但尝试启动 Vite

**解决**:
```yaml
# 方案 1: 禁用 console
plugins:
  console:
    enabled: false

# 方案 2: 使用静态模式
NODE_ENV=production pnpm start
```

### 问题 2: 内存还是很高

**检查**:
1. 确认 `lazyLoad: true`
2. 确认没有访问过 `/vite/` 路径
3. 运行 `mem-debug` 命令查看详情

### 问题 3: 首次访问很慢

**原因**: Vite 正在启动（延迟加载）

**正常现象**: 首次访问需要 1-2 秒

**优化**: 如果需要立即响应，设置 `lazyLoad: false`

## 📚 相关文档

- [Console 插件源码](https://github.com/zhinjs/zhin/tree/main/plugins/services/console)
- [Vite 官方文档](https://vitejs.dev/)
- [动态 Import 指南](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import)

## 🎉 总结

通过这次优化，我们学到了：

1. ✅ **动态 Import 要彻底**：包括所有依赖
2. ✅ **optionalDependencies**：区分开发和生产依赖
3. ✅ **延迟初始化**：WebSocket 等资源也可以延迟
4. ✅ **配置灵活**：让用户根据场景选择

最终效果：
- 启动内存: **44MB → 17MB**（节省 61%）
- 生产部署: 可选择不安装 Vite（节省 ~200MB 磁盘）
- 功能完整: 保持所有功能可用

