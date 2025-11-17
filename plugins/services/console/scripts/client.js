
import { appendFile } from 'fs/promises'
import { resolve } from 'path'
import { createRequire } from 'module'
import * as vite from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite";
const require=createRequire(import.meta.url)
function findModulePath(id) {
  const path = require.resolve(id).replace(/\\/g, '/')
  const keyword = `/node_modules/${id}/`
  return path.slice(0, path.indexOf(keyword)) + keyword.slice(0, -1)
}

const cwd = resolve(import.meta.dirname, '../../../..')
console.log('cwd',cwd)
const dist = cwd + '/plugins/services/console/dist'

export async function build(root, config = {}) {
  const { rollupOptions = {} } = config.build || {}
  console.log('Building console client...',root)
  return await vite.build({
    root,
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      ...config.define,
    },
    build: {
      outDir: cwd + '/plugins/services/console/dist',
      emptyOutDir: true,
      cssCodeSplit: false,
      ...config.build,
      rollupOptions: {
        ...rollupOptions,
        makeAbsoluteExternalsRelative: true,
        external: [
          root + '/react.js',
          root + '/react-dom.js',
          root + '/react-router.js',
          root + '/react-jsx-runtime.js',
          root + '/react-dom-client.js',
          root + '/react-jsx-dev-runtime.js',
          root + '/radix-ui.js',
          root + '/radix-ui-themes.js',
          root + '/lucide-react.js',
          root + '/client.js',
        ],
        output: {
          format: 'module',
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js',
          assetFileNames: '[name].[ext]',
          ...rollupOptions.output,
        },
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      ...config.plugins || [],
    ],
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
        '@radix-ui/themes/styles.css': findModulePath('@radix-ui/themes') + '/styles.css',
        '@radix-ui/themes/tokens.css': findModulePath('@radix-ui/themes') + '/tokens.css',
        '@radix-ui/themes/utilities.css': findModulePath('@radix-ui/themes') + '/utilities.css',
        '@radix-ui/themes': root + '/radix-ui-themes.js',
        '@zhin.js/client': root + '/client.js'
      },
    },
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
        rollupOptions:{
          external: ['react','react-router','react-dom',],
          output: {
            preserveModules: false,
            entryFileNames: '[name].js',
          },
        },
        lib: {
          formats: ['es'],
          entry: {
            'radix-ui': findModulePath('radix-ui') + '/dist/index.mjs',
          },
        },
      },
    }),
    vite.build({
      root: findModulePath('@radix-ui/themes'),
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
      build: {
        outDir: dist,
        emptyOutDir: false,
        rollupOptions:{
          external: ['react','react-router','react-dom',],
          output: {
            entryFileNames: '[name].js',
          },
        },
        lib: {
          formats: ['es'],
          entry: {
            'radix-ui-themes': findModulePath('@radix-ui/themes') + '/dist/esm/index.js',
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

  await build(cwd + '/packages/client/client', {
    build: {
      outDir: dist,
      emptyOutDir: false,
      rollupOptions: {
        input: {
          'client': cwd + '/packages/client/client/index.ts',
        },
        external: ['react', 'react-dom', 'react-dom/client', 'react-router', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'lucide-react', 'radix-ui', '@radix-ui/themes'],
        output: {
          paths: {
            'react': './react.js',
            'react-dom': './react-dom.js',
            'react-dom/client': './react-dom-client.js',
            'react-router': './react-router.js',
            'react/jsx-runtime': './react-jsx-runtime.js',
            'react/jsx-dev-runtime': './react-jsx-dev-runtime.js',
            'radix-ui': './radix-ui.js',
            '@radix-ui/themes': './radix-ui-themes.js',
            'lucide-react': './lucide-react.js',
          },
        },
        preserveEntrySignatures: 'strict',
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