/**
 * workspace 依赖图推导（install-size 类门禁共用）。
 *
 * 此前各门禁脚本手维护包清单/依赖边，新增 workspace 依赖时门禁自身先过期
 * （im-contract 事故）。现统一从 pnpm-workspace.yaml + 各包 package.json 推导，
 * 脚本永不需要随依赖图演进手动同步。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** pnpm-workspace.yaml 的 packages: 行（'- xxx' 形式） */
function workspaceGlobs() {
  const yaml = fs.readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
  const packagesSection = /^packages:\s*$/m.exec(yaml);
  if (!packagesSection) throw new Error('pnpm-workspace.yaml missing packages: section');
  const tail = yaml.slice(packagesSection.index + packagesSection[0].length);
  const globs = [];
  for (const line of tail.split('\n')) {
    if (!line.trim()) continue;
    const match = /^\s+-\s+'([^']+)'/.exec(line);
    if (!match) break;
    globs.push(match[1]);
  }
  return globs;
}

/** 花括号展开：`dir/{a,b}/*` → ['dir/a/*', 'dir/b/*']（支持嵌套） */
function expandBrace(glob) {
  const match = /\{([^}]+)\}/u.exec(glob);
  if (!match) return [glob];
  const [whole, body] = match;
  return body.split(',').flatMap((alt) =>
    expandBrace(glob.slice(0, match.index) + alt.trim() + glob.slice(match.index + whole.length)));
}

/** 展开一层 glob：`dir/*`（以及 `dir/{a,b}/*` 花括号）→ 含 package.json 的目录 */
function expandGlob(glob) {
  const dirs = [];
  for (const pattern of expandBrace(glob)) {
    const starAt = pattern.indexOf('*');
    if (starAt === -1) {
      if (fs.existsSync(path.join(repoRoot, pattern, 'package.json'))) dirs.push(pattern);
      continue;
    }
    const parent = pattern.slice(0, starAt).replace(/\/$/u, '');
    const absParent = path.join(repoRoot, parent);
    if (!fs.existsSync(absParent)) continue;
    for (const entry of fs.readdirSync(absParent, { withFileTypes: true })) {
      if (entry.isDirectory() && fs.existsSync(path.join(absParent, entry.name, 'package.json'))) {
        dirs.push(`${parent}/${entry.name}`);
      }
    }
  }
  return dirs;
}

/** 全部 workspace 包：name → { name, dir, dependencies(限 workspace 名) } */
export function readWorkspaceGraph() {
  const byName = new Map();
  for (const glob of workspaceGlobs()) {
    for (const dir of expandGlob(glob)) {
      const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, dir, 'package.json'), 'utf8'));
      if (!pkg.name) continue;
      const dependencies = new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.optionalDependencies ?? {}),
      ]);
      byName.set(pkg.name, { name: pkg.name, dir, dependencies });
    }
  }
  // 仅保留指向 workspace 内部的边
  for (const node of byName.values()) {
    node.dependencies = [...node.dependencies].filter((name) => byName.has(name)).sort();
  }
  return byName;
}

/**
 * 从 rootName 出发的依赖闭包（bottom-up 拓扑序，root 在最后）。
 * 只走 dependencies / optionalDependencies（不含 dev/peer）。
 */
export function dependencyClosure(rootName) {
  const graph = readWorkspaceGraph();
  if (!graph.has(rootName)) throw new Error(`Unknown workspace package: ${rootName}`);
  const visited = new Set();
  const ordered = [];
  const visit = (name) => {
    if (visited.has(name)) return;
    visited.add(name);
    const node = graph.get(name);
    if (!node) return; // 外部依赖（非 workspace）不打包
    for (const dependency of node.dependencies) visit(dependency);
    ordered.push(node);
  };
  visit(rootName);
  return ordered.map((node) => ({ dir: node.dir, name: node.name }));
}
