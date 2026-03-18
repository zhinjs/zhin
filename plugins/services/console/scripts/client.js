
import { appendFile } from 'fs/promises'
import { resolve } from 'path'
import { createRequire } from 'module'
import * as vite from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite"
import { esmExternalRequirePlugin } from 'rolldown/plugins'

const require = createRequire(import.meta.url)
function findModulePath(id) {
  const path = require.resolve(id).replace(/\\/g, '/')
  const keyword = `/node_modules/${id}/`
  return path.slice(0, path.indexOf(keyword)) + keyword.slice(0, -1)
}

const cwd = resolve(import.meta.dirname, '../../../..')
console.log('cwd',cwd)
const dist = cwd + '/plugins/services/console/dist'

const externalBare = [
  'react', 'react-dom', 'react-dom/client', 'react-router', 'react/jsx-runtime', 'react/jsx-dev-runtime',
  'lucide-react', 'radix-ui', 'class-variance-authority', '@zhin.js/client',
]
const externalRelative = [
  './react.js', './react-dom.js', './react-dom-client.js', './react-router.js',
  './react-jsx-runtime.js', './react-jsx-dev-runtime.js', './lucide-react.js', './radix-ui.js', './cva.js', './client.js',
]

export async function build(root, config = {}) {
  const { rollupOptions = {} } = config.build || {}
  const isConsoleClient = root.includes('console/client')
  console.log('Building console client...', root)
  const buildConfig = {
    outDir: cwd + '/plugins/services/console/dist',
    emptyOutDir: isConsoleClient,
    cssCodeSplit: false,
    ...config.build,
    rollupOptions: {
      ...rollupOptions,
      makeAbsoluteExternalsRelative: true,
      external: isConsoleClient
        ? [
            root + '/react.js',
            root + '/react-dom.js',
            root + '/react-router.js',
            root + '/react-jsx-runtime.js',
            root + '/react-dom-client.js',
            root + '/react-jsx-dev-runtime.js',
            root + '/radix-ui.js',
            root + '/lucide-react.js',
            root + '/cva.js',
            root + '/client.js',
          ]
        : rollupOptions.external,
      output: {
        format: 'module',
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
        ...rollupOptions.output,
      },
    },
  }
  if (isConsoleClient) {
    buildConfig.rolldownOptions = {
      ...config.build?.rolldownOptions,
      plugins: [
        esmExternalRequirePlugin({
          external: [...externalBare, ...externalRelative],
          skipDuplicateCheck: true,
        }),
        ...(config.build?.rolldownOptions?.plugins || []),
      ],
    }
  }
  return await vite.build({
    root,
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      ...config.define,
    },
    build: buildConfig,
    plugins: [
      react(),
      ...(isConsoleClient ? [tailwindcss()] : []),
      ...(config.plugins || []),
    ],
    ...(isConsoleClient && {
      resolve: {
        alias: {
          "react/jsx-runtime": root + '/react-jsx-runtime.js',
          "react/jsx-dev-runtime": root + '/react-jsx-dev-runtime.js',
          'react': root + '/react.js',
          'react-router': root + '/react-router.js',
          'react-dom/client': root + '/react-dom-client.js',
          'react-dom': root + '/react-dom.js',
          'lucide-react': root + '/lucide-react.js',
          'radix-ui': root + '/radix-ui.js',
          'class-variance-authority': root + '/cva.js',
          '@zhin.js/client': root + '/client.js'
        },
      },
    }),
  })
}

 async function main () {
  // build for console main
  const { output } = await build(cwd + '/plugins/services/console/client', {
    plugins: [
      tailwindcss(),
    ],
  })

  const wrapperDir = cwd + '/plugins/services/console/scripts/wrappers'

  await Promise.all([
    vite.build({
      root: wrapperDir,
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
      build: {
        outDir: dist,
        emptyOutDir: false,
        lib: {
          entry: {
            'react': wrapperDir + '/react.js',
            'react-jsx-runtime': wrapperDir + '/react-jsx-runtime.js',
            'react-jsx-dev-runtime': wrapperDir + '/react-jsx-dev-runtime.js',
          },
          formats: ['es'],
        },
        rollupOptions: {
          output: {
            preserveModules: false,
            entryFileNames: '[name].js',
          },
        },
      },
      plugins: [react()],
    }),
    vite.build({
      root: findModulePath('radix-ui'),
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
      build: {
        outDir: dist,
        emptyOutDir: false,
        rollupOptions: {
          external: ['react', 'react-router', 'react-dom'],
          output: {
            preserveModules: false,
            entryFileNames: '[name].js',
            paths: {
              'react': './react.js',
              'react-dom': './react-dom.js',
              'react-router': './react-router.js',
            },
          },
        },
        rolldownOptions: {
          plugins: [
            esmExternalRequirePlugin({
              external: ['react', 'react-dom', 'react-router', './react.js', './react-dom.js', './react-router.js'],
              skipDuplicateCheck: true,
            }),
          ],
        },
        lib: {
          formats: ['es'],
          entry: {
            'radix-ui': findModulePath('radix-ui') + '/dist/index.mjs',
          },
        },
      },
    }),
    // Build class-variance-authority wrapper
    vite.build({
      root: wrapperDir,
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
      build: {
        outDir: dist,
        emptyOutDir: false,
        lib: {
          entry: {
            'cva': wrapperDir + '/cva.js',
          },
          formats: ['es'],
        },
        rollupOptions: {
          output: {
            preserveModules: false,
            entryFileNames: '[name].js',
          },
        },
      },
    }),
    vite.build({
      root: wrapperDir,
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
      build: {
        outDir: dist,
        emptyOutDir: false,
        lib: {
          entry: {
            'react-dom': wrapperDir + '/react-dom.js',
          },
          formats: ['es'],
        },
        rollupOptions: {
          external: ['react'],
          output: {
            preserveModules: false,
            entryFileNames: '[name].js',
            paths: { 'react': './react.js' },
          },
        },
        rolldownOptions: {
          plugins: [
            esmExternalRequirePlugin({ external: ['react'], skipDuplicateCheck: true }),
          ],
        },
      },
      plugins: [react()],
    }),
    vite.build({
      root: wrapperDir,
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
      build: {
        outDir: dist,
        emptyOutDir: false,
        lib: {
          entry: {
            'react-dom-client': wrapperDir + '/react-dom-client.js',
          },
          formats: ['es'],
        },
        rollupOptions: {
          external: ['react', 'react-dom'],
          output: {
            preserveModules: false,
            entryFileNames: '[name].js',
            paths: {
              'react': './react.js',
              'react-dom': './react-dom.js',
            },
          },
        },
        rolldownOptions: {
          plugins: [
            esmExternalRequirePlugin({ external: ['react', 'react-dom'], skipDuplicateCheck: true }),
          ],
        },
      },
      plugins: [react()],
    }),
    vite.build({
      root: findModulePath('react-router'),
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
      build: {
        outDir: dist,
        emptyOutDir: false,
        lib: {
          entry: {
            'react-router': findModulePath('react-router') + '/dist/production/index.mjs',
          },
          formats: ['es'],
        },
        rollupOptions: {
          external: ['react'],
          output: {
            preserveModules: false,
            entryFileNames: '[name].js',
            paths: {
              'react': './react.js',
            },
          },
        },
      },
      plugins: [react()],
    }),
    vite.build({
      root: wrapperDir,
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
      build: {
        outDir: dist,
        emptyOutDir: false,
        lib: {
          entry: {
            'lucide-react': wrapperDir + '/lucide-react.js',
          },
          formats: ['es'],
        },
        rollupOptions: {
          external: ['react'],
          output: {
            preserveModules: false,
            entryFileNames: '[name].js',
            paths: {
              'react': './react.js',
            },
          },
        },
      },
      plugins: [react()],
    }),
  ])

  // Rolldown esmExternalRequirePlugin 产出 "react"/"react-dom"，改为相对路径供浏览器加载
  const { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync, statSync } = await import('fs')
  const toProcess = ['react-dom.js', 'react-dom-client.js', 'radix-ui.js']
  const prebundled = new Set(['react.js', 'react-dom.js', 'react-dom-client.js', 'react-router.js', 'react-jsx-runtime.js', 'react-jsx-dev-runtime.js', 'radix-ui.js', 'lucide-react.js', 'cva.js'])
  function rewriteBareToRelative(code) {
    return code
      .replace(/from\s+["']react["']/g, 'from "./react.js"')
      .replace(/from\s+["']react-dom["']/g, 'from "./react-dom.js"')
      .replace(/from\s+["']react-router["']/g, 'from "./react-router.js"')
  }
  for (const name of toProcess) {
    let filePath = dist + '/' + name
    if (!existsSync(filePath) && name === 'radix-ui.js') {
      const mjsPath = dist + '/radix-ui.mjs'
      if (existsSync(mjsPath)) filePath = mjsPath
    }
    if (!existsSync(filePath)) continue
    let code = readFileSync(filePath, 'utf8')
    code = rewriteBareToRelative(code)
    const outPath = dist + '/' + name
    writeFileSync(outPath, code)
    if (filePath !== outPath && filePath.endsWith('.mjs')) unlinkSync(filePath)
  }
  // 主构建产出在 dist 或 dist/assets/*.js，替换其中的裸说明符
  function processDir(dir) {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const full = dir + '/' + name
      if (existsSync(full) && statSync(full).isDirectory()) {
        processDir(full)
        continue
      }
      if (!name.endsWith('.js') || prebundled.has(name)) continue
      let code = readFileSync(full, 'utf8')
      if (!/from\s+["'](react|react-dom|react-router)["']/.test(code)) continue
      writeFileSync(full, rewriteBareToRelative(code))
    }
  }
  processDir(dist)

  const clientEntry = cwd + '/packages/client/client/index.ts'
  await build(cwd + '/packages/client/client', {
    build: {
      outDir: dist,
      emptyOutDir: false,
      lib: {
        entry: { client: clientEntry },
        formats: ['es'],
      },
      rollupOptions: {
        external: ['react', 'react-dom', 'react-dom/client', 'react-router', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'lucide-react', 'radix-ui', 'class-variance-authority'],
        output: {
          entryFileNames: '[name].js',
          paths: {
            'react': './react.js',
            'react-dom': './react-dom.js',
            'react-dom/client': './react-dom-client.js',
            'react-router': './react-router.js',
            'react/jsx-runtime': './react-jsx-runtime.js',
            'react/jsx-dev-runtime': './react-jsx-dev-runtime.js',
            'radix-ui': './radix-ui.js',
            'class-variance-authority': './cva.js',
            'lucide-react': './lucide-react.js',
          },
        },
        preserveEntrySignatures: 'strict',
      },
      rolldownOptions: {
        plugins: [
          esmExternalRequirePlugin({
            external: [
              'react', 'react-dom', 'react-dom/client', 'react-router', 'react/jsx-runtime', 'react/jsx-dev-runtime',
              'lucide-react', 'radix-ui', 'class-variance-authority',
              './react.js', './react-dom.js', './react-dom-client.js', './react-router.js',
              './react-jsx-runtime.js', './react-jsx-dev-runtime.js', './lucide-react.js', './radix-ui.js', './cva.js',
            ],
            skipDuplicateCheck: true,
          }),
        ],
      },
    },
  })

  for (const file of output) {
    if (file.type === 'asset' && file.name === 'style.css') {
      await appendFile(dist + '/style.css', file.source)
    }
  }
}

main().catch(console.error)
