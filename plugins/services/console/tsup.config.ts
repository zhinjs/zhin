import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'bin': 'src/bin.ts',
    'build': 'src/build.ts',
    'dev': 'src/dev.ts',
    'websocket': 'src/websocket.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  treeshake: true,
  splitting: false,
  sourcemap: false,
  // 外部依赖 - 这些不会被打包
  external: [
    // 开发时依赖 - 生产环境不需要
    'vite',
    '@vitejs/plugin-react',
    '@tailwindcss/vite',
    'koa-connect',
    // Runtime 依赖 - 由用户安装
    '@zhin.js/core',
    '@zhin.js/http',
    '@zhin.js/types',
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
  ],
  // 不打包 node_modules，保持为 require/import
  noExternal: [],
  // 输出配置
  outDir: 'lib',
  // TypeScript 配置
  tsconfig: './tsconfig.json',
})

