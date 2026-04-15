import * as vite from 'vite'
import { existsSync, promises as fs } from 'fs'
import {join} from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite";
export async function build(root: string, config: vite.UserConfig = {}) {
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
  } as vite.InlineConfig, config)) as vite.Rollup.RollupOutput[]

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