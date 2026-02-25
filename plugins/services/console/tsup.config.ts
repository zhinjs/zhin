import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'bin': 'src/bin.ts',
    'build': 'src/build.ts',
    'websocket': 'src/websocket.ts',
    'transform': 'src/transform.ts',
    // dev.ts 不再需要打包（Vite 仅作为构建工具在 build.ts 中使用，运行时不加载）
  },
  format: ['esm'],
  dts: true,
  clean: true,
  treeshake: true,
  splitting: false,
  sourcemap: false,
  // 构建产物统一为生产模式：
  // process.env.NODE_ENV 替换为 "production"，isDev=false，
  // 文件监听等 dev 分支会被 treeshake 剪除。
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  // 外部依赖 - 这些不会被打包
  external: [
    // Vite 相关（仅在 build.ts 中使用，index.ts 运行时不需要）
    'vite',
    '@vitejs/plugin-react',
    '@tailwindcss/vite',
    // Runtime 依赖 - 由用户安装
    '@zhin.js/core',
    '@zhin.js/http',
    '@zhin.js/client',
    // Node.js 内置模块
    'fs',
    'path',
    'url',
    'child_process',
    // 其他运行时依赖
    'react',
    'react-dom',
    'ws',
    'mime',
    // esbuild 用于运行时按需转译 TSX/TS，保持 external
    'esbuild',
  ],
  // 不打包 node_modules，保持为 require/import
  noExternal: [],
  // 输出配置
  outDir: 'lib',
  // TypeScript 配置
  tsconfig: './tsconfig.json',
})
