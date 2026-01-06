#!/usr/bin/env node

/**
 * 列出所有需要配置可信发布的包
 * 用于在 npmjs.com 上批量配置
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const workspaces = [
  'packages',
  'basic',
  'plugins/adapters',
  'plugins/services',
  'plugins/utils',
  'plugins/games',
];

const packages = [];

for (const workspace of workspaces) {
  const workspaceDir = join(rootDir, workspace);
  
  try {
    const dirs = readdirSync(workspaceDir);
    
    for (const dir of dirs) {
      const pkgPath = join(workspaceDir, dir, 'package.json');
      
      try {
        const stat = statSync(pkgPath);
        if (stat.isFile()) {
          const pkgContent = readFileSync(pkgPath, 'utf-8');
          const pkg = JSON.parse(pkgContent);
          
          // 跳过私有包
          if (pkg.private) {
            continue;
          }
          
          packages.push({
            name: pkg.name,
            version: pkg.version,
            path: workspace + '/' + dir,
          });
        }
      } catch (err) {
        // 跳过没有 package.json 的目录
      }
    }
  } catch (err) {
    // 跳过不存在的 workspace
  }
}

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║  Zhin.js - npm 可信发布配置包列表                              ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

console.log(`📦 共找到 ${packages.length} 个需要配置的包\n`);

// 标记未发布的包（通常是 0.x 版本或特定包名）
const unpublishedPackages = [
  '@zhin.js/adapter-sandbox',
  // 可以根据需要添加其他未发布的包
];

const hasUnpublished = packages.some(p => unpublishedPackages.includes(p.name));
if (hasUnpublished) {
  console.log('⚠️  注意：以下包可能未发布到 npm，需要先发布才能配置可信发布者：');
  console.log('─'.repeat(60));
  packages
    .filter(p => unpublishedPackages.includes(p.name))
    .forEach(p => console.log(`  ⚠️  ${p.name.padEnd(40)} v${p.version}`));
  console.log('\n💡 解决方案：');
  console.log('   1. 本地发布：npm login && cd <path> && npm publish --access public');
  console.log('   2. 或使用 GitHub Actions "First Publish" 工作流');
  console.log('   3. 发布后立即配置可信发布者\n');
}

// 按类别分组
const groups = {
  '核心包': packages.filter(p => p.path.startsWith('packages/')),
  '基础包': packages.filter(p => p.path.startsWith('basic/')),
  '适配器': packages.filter(p => p.path.startsWith('plugins/adapters/')),
  '服务插件': packages.filter(p => p.path.startsWith('plugins/services/')),
  '工具插件': packages.filter(p => p.path.startsWith('plugins/utils/')),
  '游戏插件': packages.filter(p => p.path.startsWith('plugins/games/')),
};

for (const [groupName, groupPackages] of Object.entries(groups)) {
  if (groupPackages.length === 0) continue;
  
  console.log(`\n${groupName} (${groupPackages.length} 个):`);
  console.log('─'.repeat(60));
  
  for (const pkg of groupPackages) {
    console.log(`  ✓ ${pkg.name.padEnd(40)} v${pkg.version}`);
  }
}

console.log('\n\n📋 配置步骤：');
console.log('─'.repeat(60));
console.log('1. 访问 https://www.npmjs.com 并登录');
console.log('2. 对于上述每个包：');
console.log('   a. 进入包页面 → Settings → Publishing access');
console.log('   b. 点击 "Add a trusted publisher"');
console.log('   c. 填写以下信息：');
console.log('      - Provider: GitHub Actions');
console.log('      - Repository owner: zhinjs');
console.log('      - Repository name: zhin');
console.log('      - Workflow filename: ci.yml');
console.log('      - Environment name: (留空)');
console.log('   d. 点击 "Add trusted publisher"');
console.log('3. (推荐) 在 Publishing access 页面选择');
console.log('   "Require 2FA and disallow tokens"');
console.log('\n💡 详细说明请查看: .github/TRUSTED_PUBLISHING_SETUP.md\n');

// 生成 CSV 格式（方便导入或批量处理）
console.log('\n📄 CSV 格式（可用于批量处理）:');
console.log('─'.repeat(60));
console.log('Package Name,Version,Path,npm URL');
for (const pkg of packages) {
  console.log(`${pkg.name},${pkg.version},${pkg.path},https://www.npmjs.com/package/${pkg.name}/access`);
}

console.log('\n✅ 配置完成后，使用 Changesets 工作流发布：');
console.log('   pnpm changeset              # 创建变更记录');
console.log('   git add . && git commit -m "chore: add changeset"');
console.log('   git push origin main        # 推送后 CI 自动创建版本 PR');
console.log('   # 合并 PR 后自动发布到 npm\n');

