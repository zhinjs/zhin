import { defineConfig } from 'vite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const fromClient = createRequire(new URL('../../packages/console/client/package.json', import.meta.url));
const path = (value: string) => fileURLToPath(new URL(value, import.meta.url));

export default defineConfig({
  root: path('./'),
  resolve: {
    alias: [
      { find: /^@zhin\.js\/console-contract$/, replacement: path('../../packages/console/plugin-contract/src/index.ts') },
      { find: /^@zhin\.js\/client\/ui$/, replacement: path('../../packages/console/client/client/ui/index.ts') },
      { find: /^@zhin\.js\/client$/, replacement: path('../../packages/console/client/client/index.ts') },
      { find: /^react-dom\/client$/, replacement: fromClient.resolve('react-dom/client') },
      { find: /^react$/, replacement: fromClient.resolve('react') },
      { find: /^react\/jsx-runtime$/, replacement: fromClient.resolve('react/jsx-runtime') },
      { find: /^react\/jsx-dev-runtime$/, replacement: fromClient.resolve('react/jsx-dev-runtime') },
    ],
    dedupe: ['react', 'react-dom'],
  },
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  server: { host: '127.0.0.1', port: 4174, strictPort: true },
});
