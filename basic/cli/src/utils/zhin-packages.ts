import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface ZhinPackageManifest {
  name: string;
  source: string;
  installedAt: number;
  local?: boolean;
}

export interface ZhinPackagesLock {
  packages: ZhinPackageManifest[];
}

export function globalPackagesRoot(): string {
  return path.join(os.homedir(), '.zhin', 'packages');
}

export function projectPackagesRoot(cwd = process.cwd()): string {
  return path.join(cwd, '.zhin', 'packages');
}

export function resolvePackagesRoot(local: boolean, cwd = process.cwd()): string {
  return local ? projectPackagesRoot(cwd) : globalPackagesRoot();
}

export function lockFilePath(root: string): string {
  return path.join(root, 'lock.json');
}

export function readLock(root: string): ZhinPackagesLock {
  const file = lockFilePath(root);
  if (!fs.existsSync(file)) return { packages: [] };
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as ZhinPackagesLock;
  } catch {
    return { packages: [] };
  }
}

export function writeLock(root: string, lock: ZhinPackagesLock): void {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(lockFilePath(root), JSON.stringify(lock, null, 2));
}

export function normalizePackageName(source: string): string {
  const s = source.trim();
  if (s.startsWith('npm:')) return s.slice(4).split('@')[0].replace(/^@/, '').replace(/\//g, '-');
  if (s.startsWith('git:')) return path.basename(s.replace(/\.git$/, '')).replace(/@.*/, '');
  return s.replace(/[^a-zA-Z0-9._-]/g, '-');
}

export function installZhinPackage(source: string, options: { local?: boolean; cwd?: string }): string {
  const root = resolvePackagesRoot(!!options.local, options.cwd);
  const name = normalizePackageName(source);
  const target = path.join(root, name);
  fs.mkdirSync(target, { recursive: true });

  const spec = source.startsWith('npm:') ? source.slice(4) : source;
  if (source.startsWith('npm:') || !source.includes('://') && !source.startsWith('git:')) {
    const pkgSpec = source.startsWith('npm:') ? source.slice(4) : spec;
    execFileSync('npm', ['install', '--omit=dev', '--prefix', target, pkgSpec], {
      cwd: options.cwd ?? process.cwd(),
      stdio: 'inherit',
    });
  } else {
    const gitUrl = source.startsWith('git:') ? source.slice(4) : source;
    execFileSync('git', ['clone', '--depth', '1', gitUrl, path.join(target, 'repo')], {
      cwd: options.cwd ?? process.cwd(),
      stdio: 'inherit',
    });
  }

  const lock = readLock(root);
  const entry: ZhinPackageManifest = {
    name,
    source,
    installedAt: Date.now(),
    local: !!options.local,
  };
  const idx = lock.packages.findIndex(p => p.name === name);
  if (idx >= 0) lock.packages[idx] = entry;
  else lock.packages.push(entry);
  writeLock(root, lock);
  return target;
}

export function removeZhinPackage(name: string, options: { local?: boolean; cwd?: string }): boolean {
  const root = resolvePackagesRoot(!!options.local, options.cwd);
  const target = path.join(root, name);
  if (!fs.existsSync(target)) return false;
  fs.rmSync(target, { recursive: true, force: true });
  const lock = readLock(root);
  lock.packages = lock.packages.filter(p => p.name !== name);
  writeLock(root, lock);
  return true;
}

export function listZhinPackageSkillRoots(cwd = process.cwd()): string[] {
  const roots: string[] = [];
  for (const base of [globalPackagesRoot(), projectPackagesRoot(cwd)]) {
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue;
      const skills = path.join(base, entry.name, 'skills');
      const repoSkills = path.join(base, entry.name, 'repo', 'skills');
      const npmSkills = path.join(base, entry.name, 'node_modules');
      if (fs.existsSync(skills)) roots.push(skills);
      if (fs.existsSync(repoSkills)) roots.push(repoSkills);
      if (fs.existsSync(npmSkills)) {
        for (const pkg of fs.readdirSync(npmSkills, { withFileTypes: true })) {
          if (pkg.isDirectory()) {
            const pSkills = path.join(npmSkills, pkg.name, 'skills');
            if (fs.existsSync(pSkills)) roots.push(pSkills);
          }
        }
      }
    }
  }
  return roots;
}
