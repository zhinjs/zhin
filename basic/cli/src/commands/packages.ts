import { Command } from 'commander';
import {
  installZhinPackage,
  listZhinPackageSkillRoots,
  readLock,
  removeZhinPackage,
  resolvePackagesRoot,
} from '../utils/zhin-packages.js';

const packagesCommand = new Command('packages')
  .description('管理 zhin-package 技能/扩展包（ADR 0010）');

packagesCommand
  .command('install <source>')
  .description('安装包（npm:pkg 或 git:url）')
  .option('-l, --local', '安装到项目 .zhin/packages/')
  .action((source: string, opts: { local?: boolean }) => {
    const target = installZhinPackage(source, { local: opts.local });
    console.log(`✅ 已安装到 ${target}`);
    const roots = listZhinPackageSkillRoots();
    if (roots.length > 0) {
      console.log('技能目录:');
      for (const r of roots) console.log(`  - ${r}`);
    }
  });

packagesCommand
  .command('remove <name>')
  .description('移除已安装包')
  .option('-l, --local', '从项目 .zhin/packages/ 移除')
  .action((name: string, opts: { local?: boolean }) => {
    const ok = removeZhinPackage(name, { local: opts.local });
    console.log(ok ? `✅ 已移除 ${name}` : `ℹ️ 未找到 ${name}`);
  });

packagesCommand
  .command('list')
  .description('列出已安装包')
  .option('-l, --local', '仅项目本地')
  .action((opts: { local?: boolean }) => {
    const roots = opts.local
      ? [resolvePackagesRoot(true)]
      : [resolvePackagesRoot(false), resolvePackagesRoot(true)];
    const seen = new Set<string>();
    for (const root of roots) {
      const lock = readLock(root);
      for (const pkg of lock.packages) {
        if (seen.has(pkg.name)) continue;
        seen.add(pkg.name);
        console.log(`${pkg.name}  ←  ${pkg.source}  (${pkg.local ? 'local' : 'global'})`);
      }
    }
    if (seen.size === 0) console.log('（无已安装 zhin-package）');
  });

packagesCommand
  .command('update [source]')
  .description('更新包（重新 install）')
  .option('-l, --local', '项目本地')
  .action((source: string | undefined, opts: { local?: boolean }) => {
    const root = resolvePackagesRoot(!!opts.local);
    const lock = readLock(root);
    const targets = source
      ? lock.packages.filter(p => p.name === source || p.source === source)
      : lock.packages;
    if (targets.length === 0) {
      console.log('ℹ️ 无匹配包');
      return;
    }
    for (const pkg of targets) {
      removeZhinPackage(pkg.name, { local: pkg.local });
      installZhinPackage(pkg.source, { local: pkg.local });
      console.log(`✅ 已更新 ${pkg.name}`);
    }
  });

export { packagesCommand };
