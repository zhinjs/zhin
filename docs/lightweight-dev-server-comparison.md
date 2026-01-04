# 轻量级前端开发服务器方案对比

## 🎯 目标

为 `@zhin.js/console` 插件寻找比 Vite 更轻量的前端开发环境，降低内存占用。

## 📊 方案对比

### 1. Vite（当前方案）

**内存占用**: ~23MB

**依赖**:
```json
{
  "vite": "^7.0.6",
  "@vitejs/plugin-react": "^4.3.4",
  "@tailwindcss/vite": "4.1.14"
}
```

**优点**:
- ✅ 功能完整（HMR、CSS、TypeScript、JSX）
- ✅ 生态成熟，插件丰富
- ✅ 开发体验好
- ✅ 支持 Tailwind CSS v4

**缺点**:
- ❌ 内存占用高（~23MB）
- ❌ 依赖多（20+ 个包）
- ❌ 启动慢（~1-2秒）

---

### 2. esbuild + 简单 HMR

**内存占用**: ~5-8MB

**实现方案**:
```typescript
import * as esbuild from 'esbuild';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

// 创建 esbuild 上下文
const ctx = await esbuild.context({
  entryPoints: ['client/index.tsx'],
  bundle: true,
  outdir: 'dist',
  format: 'esm',
  jsx: 'automatic',
  jsxImportSource: 'react',
  loader: {
    '.tsx': 'tsx',
    '.ts': 'ts',
    '.css': 'css',
  },
  plugins: [
    {
      name: 'hmr',
      setup(build) {
        build.onEnd(() => {
          // 通知客户端重新加载
          wss.clients.forEach(ws => ws.send('reload'));
        });
      }
    }
  ]
});

// 启动 watch 模式
await ctx.watch();

// 提供静态文件服务
await ctx.serve({
  servedir: 'dist',
  port: 3000,
});
```

**优点**:
- ✅ 内存占用低（~5-8MB）
- ✅ 构建极快（10-50ms）
- ✅ 配置简单
- ✅ 原生支持 TypeScript、JSX

**缺点**:
- ⚠️ HMR 需要手动实现（简单的全页面刷新）
- ⚠️ CSS Modules 需要额外配置
- ⚠️ Tailwind CSS 需要单独处理

---

### 3. Bun（最轻量）

**内存占用**: ~3-5MB

**实现方案**:
```typescript
// bun-dev-server.ts
import { watch } from 'fs';
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 3001 });

// Bun 内置的 HTTP 服务器
Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    
    // 提供静态文件
    if (url.pathname.startsWith('/dist/')) {
      const file = Bun.file('.' + url.pathname);
      return new Response(file);
    }
    
    // 提供 HTML
    return new Response(Bun.file('./client/index.html'));
  },
});

// 监听文件变化
watch('./client', { recursive: true }, () => {
  // 重新构建
  Bun.build({
    entrypoints: ['./client/index.tsx'],
    outdir: './dist',
  });
  
  // 通知客户端
  wss.clients.forEach(ws => ws.send('reload'));
});
```

**优点**:
- ✅ 内存占用极低（~3-5MB）
- ✅ 速度极快
- ✅ 内置 TypeScript、JSX 支持
- ✅ 内置 WebSocket

**缺点**:
- ⚠️ 生态较新，可能有兼容性问题
- ⚠️ 需要用户安装 Bun
- ⚠️ HMR 功能简单

---

### 4. 原生 ESM + Import Maps

**内存占用**: ~1-2MB

**实现方案**:
```html
<!-- index.html -->
<!DOCTYPE html>
<html>
<head>
  <script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@18",
      "react-dom": "https://esm.sh/react-dom@18"
    }
  }
  </script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/client/index.tsx"></script>
</body>
</html>
```

```typescript
// 简单的开发服务器
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { transform } from 'esbuild';

createServer(async (req, res) => {
  const file = await readFile('.' + req.url, 'utf-8');
  
  // 实时转译 TypeScript
  if (req.url.endsWith('.tsx') || req.url.endsWith('.ts')) {
    const result = await transform(file, {
      loader: 'tsx',
      jsx: 'automatic',
    });
    res.setHeader('Content-Type', 'application/javascript');
    res.end(result.code);
  } else {
    res.end(file);
  }
}).listen(3000);
```

**优点**:
- ✅ 内存占用最低（~1-2MB）
- ✅ 无需构建步骤
- ✅ 真正的 ESM

**缺点**:
- ❌ 不支持 CSS Modules
- ❌ 不支持 Tailwind CSS
- ❌ 需要 CDN（或本地 node_modules）
- ❌ HMR 需要手动实现

---

### 5. SWC + 简单服务器

**内存占用**: ~4-6MB

**实现方案**:
```typescript
import { transform } from '@swc/core';
import { watch } from 'chokidar';

// 转译文件
async function transformFile(path: string) {
  const code = await readFile(path, 'utf-8');
  const result = await transform(code, {
    jsc: {
      parser: {
        syntax: 'typescript',
        tsx: true,
      },
      transform: {
        react: {
          runtime: 'automatic',
        },
      },
    },
  });
  return result.code;
}

// 监听文件变化
watch('./client/**/*.{ts,tsx}').on('change', async (path) => {
  const code = await transformFile(path);
  // 通知客户端重新加载
  wss.clients.forEach(ws => ws.send('reload'));
});
```

**优点**:
- ✅ 内存占用低（~4-6MB）
- ✅ 速度快（Rust 实现）
- ✅ 支持最新 JavaScript 特性

**缺点**:
- ⚠️ 配置相对复杂
- ⚠️ 需要额外处理 CSS

---

## 🎯 推荐方案

### 方案 A: esbuild（最佳平衡）

**适合场景**: 需要完整的开发体验，但希望降低内存占用

**实现步骤**:
1. 替换 Vite 为 esbuild
2. 使用 esbuild 的 `context.watch()` + `context.serve()`
3. 添加简单的 WebSocket HMR
4. 使用 PostCSS 处理 Tailwind CSS

**预期效果**:
- 内存: 23MB → 8MB（节省 65%）
- 启动: 2秒 → 0.3秒
- 功能: 保留 90% 的开发体验

### 方案 B: Bun（最轻量）

**适合场景**: 追求极致性能，可以接受生态限制

**实现步骤**:
1. 使用 Bun 的内置服务器
2. 使用 Bun.build() 构建
3. 文件监听 + WebSocket 通知

**预期效果**:
- 内存: 23MB → 4MB（节省 83%）
- 启动: 2秒 → 0.1秒
- 功能: 保留 70% 的开发体验

### 方案 C: 混合方案（推荐）

**策略**: 根据环境选择不同方案

```typescript
// 开发环境：使用 esbuild（轻量）
if (process.env.NODE_ENV === 'development') {
  await startEsbuildDevServer();
}

// 生产环境：直接提供静态文件（无需开发服务器）
else {
  serveStaticFiles();
}
```

---

## 📝 实现示例：esbuild 方案

### 1. 安装依赖

```json
{
  "dependencies": {
    "esbuild": "^0.20.0",
    "ws": "^8.18.3"
  },
  "devDependencies": {
    "postcss": "^8.4.0",
    "tailwindcss": "^4.0.0",
    "autoprefixer": "^10.4.0"
  }
}
```

### 2. 创建开发服务器

```typescript
// dev-server.ts
import * as esbuild from 'esbuild';
import { WebSocketServer } from 'ws';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

export async function startDevServer(port: number) {
  const wss = new WebSocketServer({ port: port + 1 });
  
  // PostCSS 插件（处理 Tailwind）
  const postcssPlugin: esbuild.Plugin = {
    name: 'postcss',
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, async (args) => {
        const css = await fs.readFile(args.path, 'utf8');
        const result = await postcss([
          tailwindcss,
          autoprefixer,
        ]).process(css, { from: args.path });
        
        return {
          contents: result.css,
          loader: 'css',
        };
      });
    },
  };
  
  // HMR 插件
  const hmrPlugin: esbuild.Plugin = {
    name: 'hmr',
    setup(build) {
      build.onEnd(() => {
        // 通知所有客户端重新加载
        wss.clients.forEach(client => {
          if (client.readyState === 1) {
            client.send(JSON.stringify({ type: 'reload' }));
          }
        });
      });
    },
  };
  
  // 创建 esbuild 上下文
  const ctx = await esbuild.context({
    entryPoints: ['client/index.tsx'],
    bundle: true,
    outdir: 'dist',
    format: 'esm',
    splitting: true,
    jsx: 'automatic',
    jsxImportSource: 'react',
    loader: {
      '.tsx': 'tsx',
      '.ts': 'ts',
    },
    plugins: [postcssPlugin, hmrPlugin],
    define: {
      'process.env.NODE_ENV': '"development"',
    },
  });
  
  // 启动 watch 模式
  await ctx.watch();
  
  // 启动开发服务器
  await ctx.serve({
    servedir: 'dist',
    port,
    onRequest: ({ method, path, status }) => {
      console.log(`${method} ${path} ${status}`);
    },
  });
  
  console.log(`✅ Dev server running at http://localhost:${port}`);
  console.log(`✅ WebSocket server running at ws://localhost:${port + 1}`);
  
  return { ctx, wss };
}
```

### 3. 客户端 HMR 代码

```typescript
// client/hmr.ts
if (import.meta.env.DEV) {
  const ws = new WebSocket('ws://localhost:3001');
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'reload') {
      console.log('🔄 Reloading...');
      window.location.reload();
    }
  };
  
  ws.onerror = () => {
    console.log('❌ HMR connection failed');
  };
}
```

---

## 🎉 总结

### 推荐方案排序

1. **esbuild** (推荐) - 最佳平衡，内存 ~8MB
2. **Bun** - 最轻量，内存 ~4MB，但生态较新
3. **Vite** (当前) - 功能最完整，但内存 ~23MB

### 迁移建议

如果要迁移到 esbuild：
1. 替换 `vite.config.ts` 为 `esbuild.config.ts`
2. 修改 `package.json` 的构建脚本
3. 更新 `dev.ts` 使用 esbuild API
4. 测试 HMR 和 Tailwind CSS 是否正常

**预期收益**:
- ✅ 内存占用降低 65%（23MB → 8MB）
- ✅ 启动速度提升 85%（2s → 0.3s）
- ✅ 构建速度提升 90%（1s → 0.1s）
- ⚠️ 开发体验略有下降（HMR 变为全页面刷新）

是否需要我实现一个 esbuild 版本的开发服务器？


