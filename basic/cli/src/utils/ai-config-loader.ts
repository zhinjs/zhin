import { createRequire } from 'node:module';
import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type AiConfigUtils = {
  normalizeAiRoutingConfig: (ai: unknown) => Record<string, unknown>;
  validateAiRoutingConfig: (cfg: unknown) => string[];
  applyAiConfigFixes: (
    ai: unknown,
  ) => { ai: Record<string, unknown> | undefined; fixes: string[] };
};

const MODULE_ID = '@zhin.js/agent/config';
const requireFromCli = createRequire(import.meta.url);

function loadFromAgentPackageJson(agentPkgJson: string): AiConfigUtils | null {
  const agentDir = path.dirname(agentPkgJson);
  const libPath = path.join(agentDir, 'lib/config/index.js');
  if (!fs.existsSync(libPath)) return null;
  try {
    return requireFromCli(libPath) as AiConfigUtils;
  } catch {
    return null;
  }
}

function findAgentPackageJson(dir: string): string | null {
  const candidates = [
    path.join(dir, 'node_modules/@zhin.js/agent/package.json'),
    path.join(dir, 'node_modules/zhin.js/node_modules/@zhin.js/agent/package.json'),
    path.join(dir, 'packages/im/agent/package.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function tryRequireFromProject(pkgJson: string): AiConfigUtils | null {
  try {
    const req = createRequire(pkgJson);
    return req(MODULE_ID) as AiConfigUtils;
  } catch {
    const dir = path.dirname(pkgJson);
    const agentPkg = findAgentPackageJson(dir);
    if (agentPkg) return loadFromAgentPackageJson(agentPkg);
    return null;
  }
}

function walkUpForAgentConfig(startDir: string, maxDepth = 14): AiConfigUtils | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < maxDepth; i++) {
    const pkgJson = path.join(dir, 'package.json');
    if (fs.existsSync(pkgJson)) {
      const loaded = tryRequireFromProject(pkgJson);
      if (loaded) return loaded;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function loadMonorepoDevUtils(): Promise<AiConfigUtils | null> {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, '../../../../');
    const srcPath = path.join(repoRoot, 'packages/im/agent/src/config/index.ts');
    if (!fs.existsSync(srcPath)) return null;
    return (await import(pathToFileURL(srcPath).href)) as AiConfigUtils;
  } catch {
    return null;
  }
}

/** Vitest 下 createRequire 会因 development 条件解析到 .ts；用 ESM import 预热 monorepo 源码。 */
const monorepoDevUtils = await loadMonorepoDevUtils();

/** 从项目 cwd 向上解析；monorepo 开发时回退到仓库根与源码 import。 */
export function loadAiConfigUtils(cwd: string): AiConfigUtils | null {
  const fromProject = walkUpForAgentConfig(cwd);
  if (fromProject) return fromProject;

  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, '../../../../');
    const fromRepo = walkUpForAgentConfig(repoRoot, 6);
    if (fromRepo) return fromRepo;
  } catch {
    /* ignore */
  }

  return monorepoDevUtils;
}
