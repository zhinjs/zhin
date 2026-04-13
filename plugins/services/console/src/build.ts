import { existsSync, promises as fs } from 'fs'
import {join} from 'path'

async function loadViteDeps() {
  try {
    const [vite, { default: react }, { default: tailwindcss }] = await Promise.all([
      import('vite'),
      import('@vitejs/plugin-react'),
      import('@tailwindcss/vite'),
    ]);
    return { vite, react, tailwindcss };
  } catch (e) {
    throw new Error(
      `缺少构建依赖，请先安装: pnpm add -D vite @vitejs/plugin-react @tailwindcss/vite\n` +
      `原始错误: ${(e as Error).message}`
    );
  }
}

export async function build(root: string, config: Record<string, any> = {}) {
  if (!existsSync(root + '/client')) return

  const outDir = root + '/dist'
  if (existsSync(outDir)) {
    await fs.rm(outDir, { recursive: true })
  }
  const maybeFiles=[
    join(root, 'client', 'index.tsx'),
    join(root, 'client', 'index.ts'),
    join(root, 'client', 'index.js'),
    join(root, 'client', 'index.jsx'),
  ]
  const entry = maybeFiles.find(file => existsSync(file))
  if (!entry) {
    throw new Error('No entry file found')
  }
  await fs.mkdir(root + '/dist', { recursive: true })

  const { vite, react, tailwindcss } = await loadViteDeps();

  const results = await vite.build(vite.mergeConfig({
    root,
    build: {
      write: false,
      outDir: 'dist',
      assetsDir: '',
      minify: true,
      emptyOutDir: true,
      commonjsOptions: {
        strictRequires: true,
      },
      lib: {
        entry,
        fileName: 'index',
        formats: ['es'],
      },
      rollupOptions: {
        makeAbsoluteExternalsRelative: true,
        external: [
          'react',
          'react-dom',
          'react/jsx-runtime',
          'react/jsx-dev-runtime',
          'radix-ui',
          'class-variance-authority',
          'lucide-react',
          "@zhin.js/client",
        ],
        resolve: {
          alias: {
            'react/jsx-runtime': root + '/react-jsx-runtime.js',
            'react/jsx-dev-runtime': root + '/react-jsx-dev-runtime.js',
            'react': root + '/react.js',
            'react-dom': root + '/react-dom.js',
            'radix-ui': root + '/radix-ui.js',
            'class-variance-authority': root + '/cva.js',
          },
        },
        output: {
          format: 'iife',
        },
      },
    },
    plugins: [
      react(),
      tailwindcss(),
    ],
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  } as any, config)) as any[]

  for (const item of results[0].output) {
    if (item.fileName === 'index.mjs') item.fileName = 'index.js'
    const dest = root + '/dist/' + item.fileName
    if (item.type === 'asset') {
      await fs.writeFile(dest, item.source)
    } else {
      const result = await vite.transformWithEsbuild(item.code, dest, {
        minifyWhitespace: true,
        charset: 'utf8',
      })
      await fs.writeFile(dest, result.code)
    }
  }
}