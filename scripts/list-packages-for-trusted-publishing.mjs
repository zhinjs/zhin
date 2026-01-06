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
console.log('      - Workflow filename: publish.yml');
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
  console.log(`${pkg.name},${pkg.version},${pkg.path},https://www.npmjs.com/package/${pkg.name}`);
}

console.log('\n✅ 配置完成后，可以通过以下方式触发发布：');
console.log('   git tag v2.0.0');
console.log('   git push origin v2.0.0\n');

