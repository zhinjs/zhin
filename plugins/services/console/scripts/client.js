import { execSync } from 'node:child_process'
import { rm } from 'fs/promises'
import { resolve, join as pathJoin } from 'path'
import { createRequire } from 'module'
import * as esbuild from 'esbuild'

const require = createRequire(import.meta.url)
function findModulePath(id) {
  const path = require.resolve(id).replace(/\\/g, '/')
  const keyword = `/node_modules/${id}/`
  return path.slice(0, path.indexOf(keyword)) + keyword.slice(0, -1)
}

/**
 * Rolldown 在 pnpm 下常把依赖解析成 .../node_modules/.pnpm/.../node_modules/react/... 的绝对路径，
 * 仅用 external: ['react'] 不会命中，React 会被打进 radix-ui.js → 与页面 ./react.js 双实例 → useRef null。
 */
function isReactFamilyExternal(id) {
  if (
    id === 'react' ||
    id === 'react-dom' ||
    id === 'react-router' ||
    id === 'react/jsx-runtime' ||
    id === 'react/jsx-dev-runtime' ||
    id === 'react-dom/client'
  ) {
    return true
  }
  const n = id.split('\\').join('/')
  if (/\/node_modules\/react(?:\/|$)/.test(n)) return true
  if (/\/node_modules\/react-dom(?:\/|$)/.test(n)) return true
  return false
}

/**
 * 仅外置 npm「react」包（pnpm 绝对路径），与 dist/react.js 对齐。
 * 勿用 react-dom 的目录匹配去外置 react-dom-client 图内子路径，否则会误把整个包标成 external。
 */
function isReactPeerExternal(id) {
  if (id === 'react' || id === 'react/jsx-runtime' || id === 'react/jsx-dev-runtime') return true
  const n = id.split('\\').join('/')
  if (/\/node_modules\/react(?:\/|$)/.test(n)) return true
  return false
}

const peerReactBinding = '__zhinConsolePeerReact'
const peerReactDomBinding = '__zhinConsolePeerReactDom'

/**
 * Rolldown 对部分 CJS 互操作会生成 p("./react.js")（运行时 require）；浏览器 ESM 无 require。
 * 在文件头注入静态 import，并把 p(...) 替换为该绑定。
 */
function patchPrebundlePeerReactRequire(code) {
  if (!/\bp\(["']\.\/react(?:-dom)?\.js["']\)/.test(code)) return code
  if (code.includes(peerReactBinding)) return code

  const lines = code.split('\n')
  let afterLastImport = 0
  for (let j = 0; j < lines.length; j++) {
    const t = lines[j].trimStart()
    if (t.startsWith('import ')) {
      afterLastImport = j + 1
      continue
    }
    break
  }
  const extra = []
  if (/\bp\(["']\.\/react\.js["']\)/.test(code)) {
    extra.push(`import * as ${peerReactBinding} from "./react.js";`)
  }
  if (/\bp\(["']\.\/react-dom\.js["']\)/.test(code)) {
    extra.push(`import * as ${peerReactDomBinding} from "./react-dom.js";`)
  }
  if (extra.length === 0) return code
  lines.splice(afterLastImport, 0, ...extra)
  let out = lines.join('\n')
  out = out.replace(/\bp\("\.\/react\.js"\)/g, peerReactBinding)
  out = out.replace(/\bp\('\.\/react\.js'\)/g, peerReactBinding)
  out = out.replace(/\bp\("\.\/react-dom\.js"\)/g, peerReactDomBinding)
  out = out.replace(/\bp\('\.\/react-dom\.js'\)/g, peerReactDomBinding)
  return out
}

const distPeerRequirePatches = [
  { file: 'react.js', binding: '__zhinConsoleDistReactMod', importPath: './react.js' },
  { file: 'react-dom.js', binding: '__zhinConsoleDistReactDomMod', importPath: './react-dom.js' },
]

/**
 * Rolldown 外置 peer 后可能留下 l("/abs/.../dist/react.js") 等，浏览器无 require；改为静态 import。
 */
function patchRollupExternalRequireDistPeers(code) {
  const needed = distPeerRequirePatches.filter(({ file }) =>
    code.includes(resolve(dist, file).replace(/\\/g, '/')),
  )
  if (needed.length === 0) return code

  const lines = code.split('\n')
  let afterLastImport = 0
  for (let j = 0; j < lines.length; j++) {
    const t = lines[j].trimStart()
    if (t.startsWith('import ')) {
      afterLastImport = j + 1
      continue
    }
    break
  }
  const inject = []
  for (const { binding, importPath } of needed) {
    if (!code.includes(`import ${binding} from`)) {
      inject.push(`import ${binding} from "${importPath}";`)
    }
  }
  if (inject.length > 0) lines.splice(afterLastImport, 0, ...inject)
  let out = lines.join('\n')
  for (const { file, binding } of needed) {
    const abs = resolve(dist, file).replace(/\\/g, '/')
    const esc = abs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Rolldown 曾用 l/n/p；esbuild 压缩后为任意标识符（如 N、zi）包装 __require("…/dist/react.js")
    const pattern = new RegExp(`\\b[a-zA-Z_$][\\w$]*\\(\\s*["']${esc}["']\\s*\\)`, 'g')
    out = out.replace(pattern, binding)
  }
  return out
}

/** 将 `from "/…/plugins/services/console/dist/foo.js"` 改为相对 `./foo.js`（Farm 产物在浏览器不可用绝对路径）。 */
function rewriteConsoleDistAbsoluteFromImports(code) {
  const norm = dist.replace(/\\/g, '/').replace(/\/$/, '')
  if (!code.includes(norm)) return code
  const esc = norm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // esbuild minify 常生成 `from"/abs/...`（无空格），故用 \\s*；双引号与单引号均处理。
  return code.replace(
    new RegExp(`from\\s*["']${esc}/([a-z0-9._-]+\\.js)["']`, 'gi'),
    'from "./$1"',
  )
}

/**
 * Farm externalModules 对 `window['react']` 等做 CJS 兼容：若存在 `default` 且命名空间无 `__esModule`，
 * 会用 `{...namespace}` 拷贝；对 ESM 真实模块会破坏与静态 import 的同一实例语义，lucide 等内 `useContext` 可读到 w.H=null。
 * 在最终 `export {` 前注入 `export const __esModule = true`，使 Farm 走「原始 namespace」分支。
 */
function patchFarmExternalInteropEsModuleFlag(code) {
  if (/\bexport\s+const\s+__esModule\s*=\s*true\b/.test(code)) return code
  const brace = code.lastIndexOf('export {')
  const star = code.lastIndexOf('export * from')
  const insertAt = brace >= 0 && (star < 0 || brace >= star) ? brace : star >= 0 ? star : -1
  if (insertAt < 0) return code
  const before = code.slice(Math.max(0, insertAt - 160), insertAt)
  if (before.includes('export const __esModule')) return code
  return code.slice(0, insertAt) + 'export const __esModule = true;\n' + code.slice(insertAt)
}

const cwd = resolve(import.meta.dirname, '../../../..')
const dist = cwd + '/plugins/services/console/dist'

/** 与 dist 中已写出的 react*.js 对齐（alias 到绝对路径后 Rolldown 的 external id）。 */
function isDistPeerReactExternal(id) {
  try {
    const n = resolve(id)
    return (
      n === resolve(dist, 'react.js') ||
      n === resolve(dist, 'react-jsx-runtime.js') ||
      n === resolve(dist, 'react-jsx-dev-runtime.js') ||
      n === resolve(dist, 'react-redux.js')
    )
  } catch {
    return false
  }
}

function externalReactPeerAndPnpm(id) {
  return isReactPeerExternal(id) || isDistPeerReactExternal(id)
}

/**
 * 将 dist 中已预构建的 peer 固定为 external 并指向 plugins/services/console/dist/*.js（esbuild 版，替代原 Rolldown resolveId）。
 * @param {{ omitReactRedux?: boolean, clientLibPeers?: boolean }} [opts]
 */
function createConsoleDistPeerEsbuildPlugin(opts = {}) {
  const omitReactRedux = opts.omitReactRedux === true
  const clientLibPeers = opts.clientLibPeers === true
  const abs = {
    react: resolve(dist, 'react.js'),
    jsx: resolve(dist, 'react-jsx-runtime.js'),
    jsxDev: resolve(dist, 'react-jsx-dev-runtime.js'),
    reactRedux: resolve(dist, 'react-redux.js'),
    reactDom: resolve(dist, 'react-dom.js'),
    reactDomClient: resolve(dist, 'react-dom-client.js'),
    reactRouter: resolve(dist, 'react-router.js'),
  }
  function resolvedPeer(id, targetAbs) {
    try {
      return resolve(id.split('?')[0]) === resolve(targetAbs)
    } catch {
      return false
    }
  }
  const mark = (p) => ({ path: p, external: true })
  return {
    name: 'zhin-console-dist-peers',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') return undefined
        const id = args.path
        if (id === 'react') return mark(abs.react)
        if (id === 'react/jsx-runtime') return mark(abs.jsx)
        if (id === 'react/jsx-dev-runtime') return mark(abs.jsxDev)
        if (id === 'react-redux' && !omitReactRedux) return mark(abs.reactRedux)
        if (clientLibPeers) {
          if (id === 'react-dom') return mark(abs.reactDom)
          if (id === 'react-dom/client') return mark(abs.reactDomClient)
          if (id === 'react-router' || id.startsWith('react-router/')) return mark(abs.reactRouter)
        }
        if (resolvedPeer(id, abs.react)) return mark(abs.react)
        if (resolvedPeer(id, abs.jsx)) return mark(abs.jsx)
        if (resolvedPeer(id, abs.jsxDev)) return mark(abs.jsxDev)
        if (!omitReactRedux && resolvedPeer(id, abs.reactRedux)) return mark(abs.reactRedux)
        if (clientLibPeers) {
          if (resolvedPeer(id, abs.reactDom)) return mark(abs.reactDom)
          if (resolvedPeer(id, abs.reactDomClient)) return mark(abs.reactDomClient)
          if (resolvedPeer(id, abs.reactRouter)) return mark(abs.reactRouter)
        }
        const n = id.split('\\').join('/')
        if (/\/node_modules\/react\//.test(n) || /\/node_modules\/react$/.test(n)) {
          if (n.includes('jsx-dev-runtime')) return mark(abs.jsxDev)
          if (n.includes('jsx-runtime')) return mark(abs.jsx)
          return mark(abs.react)
        }
        if (clientLibPeers) {
          if (/\/node_modules\/react-dom\/client(\/|$)/.test(n)) return mark(abs.reactDomClient)
          if (/\/node_modules\/react-dom\//.test(n) || /\/node_modules\/react-dom$/.test(n))
            return mark(abs.reactDom)
          if (/\/node_modules\/react-router\//.test(n) || /\/node_modules\/react-router$/.test(n))
            return mark(abs.reactRouter)
        }
        return undefined
      })
    },
  }
}

/** radix-ui 预包：整族 react / react-dom 外置到 dist，避免打进 radix-ui.js */
function createReactFamilyExternalEsbuildPlugin() {
  return {
    name: 'zhin-external-react-family',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') return undefined
        if (isReactFamilyExternal(args.path)) return { path: args.path, external: true }
        const n = args.path.split('\\').join('/')
        if (/\/node_modules\/react(?:\/|$)/.test(n) && !/\/node_modules\/react-dom/.test(n)) {
          if (n.includes('jsx-dev-runtime')) return { path: args.path, external: true }
          if (n.includes('jsx-runtime')) return { path: args.path, external: true }
          return { path: args.path, external: true }
        }
        if (/\/node_modules\/react-dom(?:\/|$)/.test(n)) return { path: args.path, external: true }
        return undefined
      })
    },
  }
}

/** react-router 预包：仅外置 react / jsx-runtime 等到 dist */
function createReactPeerOnlyExternalEsbuildPlugin() {
  return {
    name: 'zhin-react-peer-only',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') return undefined
        if (isReactPeerExternal(args.path)) return { path: args.path, external: true }
        const n = args.path.split('\\').join('/')
        if (/\/node_modules\/react\//.test(n) || /\/node_modules\/react$/.test(n)) {
          if (n.includes('jsx-dev-runtime')) return { path: args.path, external: true }
          if (n.includes('jsx-runtime')) return { path: args.path, external: true }
          return { path: args.path, external: true }
        }
        return undefined
      })
    },
  }
}

/** react-dom / react-redux 等：外置 react 族 + pnpm 绝对路径 peer */
function createExternalReactPeerAndPnpmEsbuildPlugin() {
  return {
    name: 'zhin-external-react-peer-pnpm',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') return undefined
        if (externalReactPeerAndPnpm(args.path)) return { path: args.path, external: true }
        return undefined
      })
    },
  }
}

/** packages/client 打包：裸 peer 与 import map 对齐到 dist/*.js；console-core 打进包体 */
function createConsoleClientImportAliasPlugin() {
  const peerMap = new Map([
    ['react/jsx-runtime', resolve(dist, 'react-jsx-runtime.js')],
    ['react/jsx-dev-runtime', resolve(dist, 'react-jsx-dev-runtime.js')],
    ['react', resolve(dist, 'react.js')],
    ['react-router', resolve(dist, 'react-router.js')],
    ['react-dom/client', resolve(dist, 'react-dom-client.js')],
    ['react-dom', resolve(dist, 'react-dom.js')],
    ['react-redux', resolve(dist, 'react-redux.js')],
    ['radix-ui', resolve(dist, 'radix-ui.js')],
    ['class-variance-authority', resolve(dist, 'cva.js')],
    ['lucide-react', resolve(dist, 'lucide-react.js')],
  ])
  const coreBrowser = resolve(cwd, 'packages/console-core/dist/browser/index.js')
  return {
    name: 'zhin-console-client-alias',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path === '@zhin.js/console-core/browser')
          return { path: coreBrowser }
        const hit = peerMap.get(args.path)
        if (hit) return { path: hit, external: true }
        return undefined
      })
    },
  }
}

const esbuildBase = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'warning',
  minify: true,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
}

export async function build(root, config = {}) {
  if (!root.includes('packages/client/client')) {
    throw new Error(
      '[console] build(root) 仅支持 packages/client/client；预构建已改为 esbuild，其它入口请走 build:client。',
    )
  }
  const nodeEnv =
    config.define?.['process.env.NODE_ENV'] !== undefined
      ? config.define['process.env.NODE_ENV']
      : JSON.stringify('production')
  console.log('Building console client...', root)
  await esbuild.build({
    ...esbuildBase,
    define: { 'process.env.NODE_ENV': nodeEnv },
    absWorkingDir: root,
    entryPoints: { client: pathJoin(root, 'index.ts') },
    outdir: dist,
    entryNames: '[name]',
    jsx: 'automatic',
    plugins: [createConsoleClientImportAliasPlugin(), createConsoleDistPeerEsbuildPlugin({ clientLibPeers: true })],
  })
}

async function main() {
  execSync('pnpm --filter @zhin.js/console-types build', {
    cwd,
    stdio: 'inherit',
  })
  execSync('pnpm --filter @zhin.js/console-core build', {
    cwd,
    stdio: 'inherit',
  })

  await rm(dist, { recursive: true, force: true })

  console.log('[console] Farm: building console SPA (plugins/services/console/client)…')
  execSync('pnpm exec farm build', {
    cwd: resolve(cwd, 'packages/console-app'),
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  })

  const wrapperDir = cwd + '/plugins/services/console/scripts/wrappers'
  const clientClientDir = cwd + '/packages/client/client'

  // 先产出 dist/react*.js，供 react-dom / radix / lucide 等外置到同一份 React。
  await esbuild.build({
    ...esbuildBase,
    absWorkingDir: wrapperDir,
    entryPoints: {
      react: 'react.js',
      'react-jsx-runtime': 'react-jsx-runtime.js',
      'react-jsx-dev-runtime': 'react-jsx-dev-runtime.js',
    },
    outdir: dist,
    entryNames: '[name]',
  })

  const peerDistPlugin = () => createConsoleDistPeerEsbuildPlugin({})
  const peerDistOmitRrPlugin = () => createConsoleDistPeerEsbuildPlugin({ omitReactRedux: true })

  await Promise.all([
    esbuild.build({
      ...esbuildBase,
      absWorkingDir: wrapperDir,
      entryPoints: { 'radix-ui': 'radix-ui.js' },
      outdir: dist,
      entryNames: '[name]',
      plugins: [createReactFamilyExternalEsbuildPlugin()],
    }),
    esbuild.build({
      ...esbuildBase,
      absWorkingDir: wrapperDir,
      entryPoints: { cva: 'cva.js' },
      outdir: dist,
      entryNames: '[name]',
    }),
    esbuild.build({
      ...esbuildBase,
      absWorkingDir: wrapperDir,
      entryPoints: { 'react-dom': 'react-dom.js' },
      outdir: dist,
      entryNames: '[name]',
      plugins: [peerDistPlugin(), createExternalReactPeerAndPnpmEsbuildPlugin()],
    }),
    esbuild.build({
      ...esbuildBase,
      absWorkingDir: wrapperDir,
      entryPoints: { 'react-dom-client': 'react-dom-client.js' },
      outdir: dist,
      entryNames: '[name]',
      plugins: [peerDistPlugin(), createExternalReactPeerAndPnpmEsbuildPlugin()],
    }),
    esbuild.build({
      ...esbuildBase,
      absWorkingDir: findModulePath('react-router'),
      entryPoints: { 'react-router': 'dist/production/index.mjs' },
      outdir: dist,
      entryNames: '[name]',
      plugins: [createReactPeerOnlyExternalEsbuildPlugin()],
    }),
    esbuild.build({
      ...esbuildBase,
      absWorkingDir: clientClientDir,
      entryPoints: { 'lucide-react': 'lucide-react-public.ts' },
      outdir: dist,
      entryNames: '[name]',
      plugins: [peerDistOmitRrPlugin(), createExternalReactPeerAndPnpmEsbuildPlugin()],
    }),
    esbuild.build({
      ...esbuildBase,
      absWorkingDir: wrapperDir,
      entryPoints: { 'react-redux': 'react-redux.js' },
      outdir: dist,
      entryNames: '[name]',
      plugins: [
        peerDistOmitRrPlugin(),
        createReactFamilyExternalEsbuildPlugin(),
        createExternalReactPeerAndPnpmEsbuildPlugin(),
      ],
    }),
  ])

  // Rolldown esmExternalRequirePlugin 产出 "react"/"react-dom"，改为相对路径供浏览器加载
  const { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync, statSync } = await import('fs')
  const toProcess = [
    'react-dom.js',
    'react-dom-client.js',
    'radix-ui.js',
    'react-redux.js',
    'lucide-react.js',
    'react-router.js',
    'client.js',
  ]
  const prebundled = new Set([
    'react.js', 'react-dom.js', 'react-dom-client.js', 'react-router.js', 'react-jsx-runtime.js',
    'react-jsx-dev-runtime.js', 'radix-ui.js', 'lucide-react.js', 'cva.js', 'react-redux.js', 'client.js',
    'farm-peer-shim.mjs',
  ])
  function rewriteBareToRelative(code) {
    return code
      .replace(/from\s+["']react["']/g, 'from "./react.js"')
      .replace(/from\s+["']react-dom["']/g, 'from "./react-dom.js"')
      .replace(/from\s+["']react-router["']/g, 'from "./react-router.js"')
      .replace(/from\s+["']react\/jsx-runtime["']/g, 'from "./react-jsx-runtime.js"')
      .replace(/from\s+["']react\/jsx-dev-runtime["']/g, 'from "./react-jsx-dev-runtime.js"')
      .replace(/from\s+["']react-redux["']/g, 'from "./react-redux.js"')
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
      if (!/from\s+["'](react|react-dom|react-router|react-redux|react\/jsx-runtime|react\/jsx-dev-runtime)["']/.test(code)) continue
      writeFileSync(full, rewriteBareToRelative(code))
    }
  }

  await build(cwd + '/packages/client/client')

  // 必须在 packages/client 写出 client.js 之后再跑：此前 toProcess 会跳过不存在的文件，
  // 随后 build 覆盖 dist/client.js → 绝对路径 import 与 require 包装未被替换 → 浏览器加载第二份 React → useContext null。
  for (const name of toProcess) {
    let filePath = dist + '/' + name
    if (!existsSync(filePath) && name === 'radix-ui.js') {
      const mjsPath = dist + '/radix-ui.mjs'
      if (existsSync(mjsPath)) filePath = mjsPath
    }
    if (!existsSync(filePath)) continue
    let code = readFileSync(filePath, 'utf8')
    if (['radix-ui.js', 'react-dom.js', 'react-dom-client.js', 'client.js'].includes(name)) {
      code = patchPrebundlePeerReactRequire(code)
    }
    if (
      name === 'react-dom.js' ||
      name === 'react-dom-client.js' ||
      name === 'react-redux.js' ||
      name === 'lucide-react.js' ||
      name === 'client.js'
    ) {
      code = patchRollupExternalRequireDistPeers(code)
    }
    code = rewriteConsoleDistAbsoluteFromImports(code)
    code = rewriteBareToRelative(code)
    const outPath = dist + '/' + name
    writeFileSync(outPath, code)
    if (filePath !== outPath && filePath.endsWith('.mjs')) unlinkSync(filePath)
  }
  processDir(dist)

  const farmPeerInteropTargets = [
    'react.js',
    'react-jsx-runtime.js',
    'react-jsx-dev-runtime.js',
    'chunk-efA98nb6.js',
    'react-dom.js',
    'react-dom-client.js',
    'react-router.js',
    'react-redux.js',
    'lucide-react.js',
    'radix-ui.js',
    'client.js',
    'cva.js',
  ]
  for (const name of farmPeerInteropTargets) {
    const p = dist + '/' + name
    if (!existsSync(p)) continue
    const c = readFileSync(p, 'utf8')
    const next = patchFarmExternalInteropEsModuleFlag(c)
    if (next !== c) writeFileSync(p, next)
  }

  assertReactReduxPrebundleUsesDistReact(readFileSync, existsSync)
  assertLucideReactPrebundleUsesDistReact(readFileSync, existsSync)
  assertConsoleClientJsUsesPeerReact(readFileSync, existsSync)

  await patchFarmConsoleHtmlForPeerExternals(dist)
}

/** dist/client.js 不得内联 react / react-jsx-runtime / react-router，否则与 react-dom-client 双实例 → useCallback null。 */
function assertConsoleClientJsUsesPeerReact(readFileSync, existsSync) {
  const p = dist + '/client.js'
  if (!existsSync(p)) return
  const code = readFileSync(p, 'utf8')
  const head = code.slice(0, 4000)
  if (!head.includes('from "./react.js"')) {
    throw new Error(
      '[@zhin.js/console] dist/client.js must import ./react.js (forceExternal clientLibPeers + no plugin-react on packages/client build).',
    )
  }
  if (head.includes('//#region dist/react-jsx-runtime.js') || head.includes('w.H.useCallback')) {
    throw new Error(
      '[@zhin.js/console] dist/client.js incorrectly inlines React; check forceExternalConsoleDistPeersPlugin({ clientLibPeers: true }).',
    )
  }
}

/** lucide 预包须从 ./react.js 取 hooks，且不得内联 react.production（否则与 react-dom 调度器不一致）。 */
function assertLucideReactPrebundleUsesDistReact(readFileSync, existsSync) {
  const p = dist + '/lucide-react.js'
  if (!existsSync(p)) return
  const code = readFileSync(p, 'utf8')
  const head = code.slice(0, 4000)
  if (!head.includes('from "./react.js"') && !head.includes("from './react.js'")) {
    throw new Error(
      '[@zhin.js/console] dist/lucide-react.js must import ./react.js first. Use forceExternal omitReactRedux + no plugin-react on lucide prebundle.',
    )
  }
  if (
    head.includes('Symbol.for("react.transitional.element")') ||
    head.includes("Symbol.for('react.transitional.element')")
  ) {
    throw new Error(
      '[@zhin.js/console] dist/lucide-react.js incorrectly inlines React; remove plugin-react from lucide prebundle.',
    )
  }
}

/** 防止回归：旧产物自引用或内联整包 React 时，浏览器报 useMemo/useContext null；堆栈行号与当前短文件也对不上。 */
function assertReactReduxPrebundleUsesDistReact(readFileSync, existsSync) {
  const p = dist + '/react-redux.js'
  if (!existsSync(p)) return
  const rr = readFileSync(p, 'utf8')
  if (/export\s*\*\s*from\s*["']\.\/react-redux\.js["']/.test(rr)) {
    throw new Error(
      '[@zhin.js/console] dist/react-redux.js is self-referential. Check forceExternalConsoleDistPeersPlugin (omitReactRedux when prebundling react-redux).',
    )
  }
  const head = rr.slice(0, 2500)
  if (!/\bfrom\s*["']\.\/react\.js["']/.test(head)) {
    throw new Error(
      '[@zhin.js/console] dist/react-redux.js must import ./react.js near the top (single React instance with react-dom-client).',
    )
  }
  if (
    head.includes('Symbol.for("react.transitional.element")') ||
    head.includes("Symbol.for('react.transitional.element')")
  ) {
    throw new Error(
      '[@zhin.js/console] dist/react-redux.js incorrectly bundles React; use forceExternalConsoleDistPeersPlugin({ omitReactRedux: true }) and do not use plugin-react on that prebundle.',
    )
  }
}

/**
 * Farm 将 react 等标记为 external 时，运行时从 window['react'] 等读取；HTML 中原先只有 importmap，
 * 未在加载 chunk 前填充 window，导致 forwardRef 等全部为 undefined。
 * 在写完 client.js 后注入 farm-peer-shim.mjs：先 dynamic import 各 peer 挂到 window，再按序 import 各 Farm chunk，最后执行原内联启动脚本。
 */
async function patchFarmConsoleHtmlForPeerExternals(distDir) {
  const { readFileSync, writeFileSync, readdirSync } = await import('fs')
  const names = readdirSync(distDir)
  const htmlFiles = names.filter((n) => n.endsWith('.html') && n.startsWith('index_'))
  if (htmlFiles.length === 0) return

  for (const name of htmlFiles) {
    const htmlPath = distDir + '/' + name
    let html = readFileSync(htmlPath, 'utf8')
    if (!html.includes('__farm_module_system__')) continue

    const chunkNames = []
    const chunkRe = /<script src=\/vite\/(index_[^>]+\.js)[^>]*><\/script>/gi
    let m
    while ((m = chunkRe.exec(html)) !== null) chunkNames.push(m[1])
    if (chunkNames.length === 0) continue

    // Farm 产出可能是 window.f081… 或 window['f081…']
    const tailStart = Math.max(html.lastIndexOf('<script>window.'), html.lastIndexOf("<script>window['"))
    if (tailStart === -1) {
      console.warn('[console] farm HTML: no inline tail script, skip peer shim:', name)
      continue
    }
    const tailEnd = html.indexOf('</script>', tailStart)
    if (tailEnd === -1) continue
    const inlineBody = html.slice(tailStart + '<script>'.length, tailEnd).trim()

    let newHtml = html.slice(0, tailStart) + html.slice(tailEnd + '</script>'.length)
    newHtml = newHtml.replace(/<script src=\/vite\/index_[^>]+\.js[^>]*><\/script>/gi, '')

    const shimPath = distDir + '/farm-peer-shim.mjs'
    const shim = `// Auto-generated by scripts/client.js — fills window for Farm externalModules before chunks run.
const __base = new URL('./', import.meta.url).href
async function __w(k, f) { window[k] = await import(new URL(f, __base).href) }
// 必须顺序加载：lucide-react 静态依赖 ./react.js；与 react-dom/client 并行 Promise.all 时，
// 偶发出现 lucide 内 useContext 读到 React 调度器尚未挂载（w.H 为 null）。先挂好 react 全家桶再挂 lucide。
await __w('react', 'react.js')
await __w('react/jsx-runtime', 'react-jsx-runtime.js')
await __w('react/jsx-dev-runtime', 'react-jsx-dev-runtime.js')
await __w('react-dom', 'react-dom.js')
await __w('react-dom/client', 'react-dom-client.js')
await __w('react-router', 'react-router.js')
await __w('react-redux', 'react-redux.js')
await __w('lucide-react', 'lucide-react.js')
await __w('radix-ui', 'radix-ui.js')
await __w('class-variance-authority', 'cva.js')
await __w('@zhin.js/client', 'client.js')
for (const c of ${JSON.stringify(chunkNames)}) await import(new URL(c, __base).href)
${inlineBody}
`
    writeFileSync(shimPath, shim)

    const tag = '<script type="module" src="/vite/farm-peer-shim.mjs"></script>'
    if (newHtml.includes('</body>')) newHtml = newHtml.replace('</body>', `${tag}</body>`)
    else newHtml += tag

    writeFileSync(htmlPath, newHtml)
    console.log('[console] Farm peer shim applied:', name, `(${chunkNames.length} chunks)`)
  }
}

/** 仅对已有 Farm 产物注入 / 更新 farm-peer-shim（供 packages/console-app 的 farm build 后调用） */
async function applyFarmShimOnly() {
  await patchFarmConsoleHtmlForPeerExternals(dist)
  console.log('[console] apply-farm-shim-only: done')
}

const argvCmd = process.argv[2]
if (argvCmd === 'apply-farm-shim-only') {
  applyFarmShimOnly().catch((e) => {
    console.error(e)
    process.exit(1)
  })
} else {
  main().catch(console.error)
}
