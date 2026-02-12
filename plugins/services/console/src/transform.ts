/**
 * esbuild 按需转译模块
 *
 * 在生产模式下，对请求的 .ts/.tsx/.jsx 文件进行实时转译：
 *   1. 读取源文件
 *   2. esbuild.transform() 转为 ESM JS（React 17+ automatic JSX）
 *   3. 重写相对 import 路径（补全扩展名，移除 CSS import）
 *   4. 以 mtime 为校验的内存缓存
 */

import { transform } from "esbuild";
import * as fs from "fs";
import * as path from "path";

// ── 缓存 ──────────────────────────────────────────────────────────────────────

interface CacheEntry {
  mtime: number;
  code: string;
}

const cache = new Map<string, CacheEntry>();

// ── 扩展名探测 ────────────────────────────────────────────────────────────────

/** 需要转译的扩展名 */
const TRANSFORMABLE_EXTS = [".ts", ".tsx", ".jsx"];

/** 解析无扩展名的 import 路径，按优先级探测 */
const RESOLVE_EXTS = [".tsx", ".ts", ".jsx", ".js"];

/**
 * 判断文件是否需要转译
 */
export function isTransformable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return TRANSFORMABLE_EXTS.includes(ext);
}

// ── import 路径重写 ───────────────────────────────────────────────────────────

/**
 * 匹配 import/export 语句中的路径：
 *   - import X from './Foo'
 *   - import { X } from '../utils'
 *   - export { X } from './bar'
 *   - import('./Foo')
 *   - import X from "./Foo"
 */
const IMPORT_RE =
  /(?:import|export)\s+.*?\s+from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * 匹配 CSS import（用于移除）：
 *   - import './style.css'
 *   - import "../theme.css"
 */
const CSS_IMPORT_RE =
  /import\s+['"][^'"]+\.css['"]\s*;?\n?/g;

/**
 * 判断是否为相对路径（./ 或 ../）
 */
function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

/**
 * 判断路径是否已有文件扩展名
 */
function hasExtension(specifier: string): boolean {
  const base = path.basename(specifier);
  return base.includes(".") && !base.startsWith(".");
}

/**
 * 探测并补全相对 import 的扩展名
 *
 * ./Foo → 探测 Foo.tsx > Foo.ts > Foo.jsx > Foo.js > Foo/index.tsx > ...
 */
function resolveRelativeImport(
  specifier: string,
  fromFile: string,
): string {
  if (!isRelative(specifier)) return specifier;
  if (hasExtension(specifier)) return specifier;

  const dir = path.dirname(fromFile);
  const target = path.resolve(dir, specifier);

  // 1. 直接探测文件
  for (const ext of RESOLVE_EXTS) {
    if (fs.existsSync(target + ext)) {
      return specifier + ext;
    }
  }

  // 2. 探测目录下的 index 文件
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    for (const ext of RESOLVE_EXTS) {
      if (fs.existsSync(path.join(target, `index${ext}`))) {
        return specifier + `/index${ext}`;
      }
    }
  }

  // 无法解析，原样返回
  return specifier;
}

/**
 * 重写转译后代码中的 import 路径：
 *   - 移除 CSS import
 *   - 补全相对 import 的扩展名
 */
function rewriteImports(code: string, fromFile: string): string {
  // 1. 移除 CSS import
  code = code.replace(CSS_IMPORT_RE, "");

  // 2. 补全相对 import 的扩展名
  code = code.replace(IMPORT_RE, (match, fromSpecifier, dynamicSpecifier) => {
    const specifier = fromSpecifier || dynamicSpecifier;
    if (!specifier || !isRelative(specifier)) return match;
    if (hasExtension(specifier)) return match;

    const resolved = resolveRelativeImport(specifier, fromFile);
    if (resolved === specifier) return match;

    return match.replace(specifier, resolved);
  });

  return code;
}

// ── 核心转译函数 ──────────────────────────────────────────────────────────────

/**
 * 转译单个 TS/TSX/JSX 文件为 ESM JavaScript
 *
 * @param filePath 文件绝对路径
 * @returns 转译后的 JS 代码
 */
export async function transformFile(filePath: string): Promise<string> {
  // 检查缓存
  const stat = fs.statSync(filePath);
  const cached = cache.get(filePath);
  if (cached && cached.mtime === stat.mtimeMs) {
    return cached.code;
  }

  const source = fs.readFileSync(filePath, "utf-8");
  const ext = path.extname(filePath).toLowerCase();

  const loader =
    ext === ".tsx" ? "tsx" : ext === ".ts" ? "ts" : ext === ".jsx" ? "jsx" : "js";

  const result = await transform(source, {
    loader,
    jsx: "automatic",
    jsxImportSource: "react",
    format: "esm",
    sourcemap: "inline",
    target: "es2022",
  });

  // 重写 import 路径
  const code = rewriteImports(result.code, filePath);

  // 写入缓存
  cache.set(filePath, { mtime: stat.mtimeMs, code });

  return code;
}

/**
 * 清空转译缓存
 */
export function clearTransformCache(): void {
  cache.clear();
}
