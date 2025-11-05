#!/usr/bin/env node
/**
 * 生产环境配置检查脚本
 * 用于检测可能导致服务器卡死的配置问题
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

console.log('🔍 检查 Zhin.js 生产环境配置...\n');

let hasErrors = false;
let hasWarnings = false;

// 检查配置文件
const configFiles = [
  'zhin.config.ts',
  'zhin.config.js',
  'zhin.config.yml',
  'zhin.config.yaml',
  'zhin.config.json'
];

const foundConfig = configFiles.find(file => 
  fs.existsSync(path.join(projectRoot, file))
);

if (!foundConfig) {
  console.error('❌ 未找到配置文件');
  process.exit(1);
}

console.log(`📄 配置文件: ${foundConfig}\n`);

// 读取配置内容
const configPath = path.join(projectRoot, foundConfig);
const configContent = fs.readFileSync(configPath, 'utf-8');

// 检查 plugin_dirs 配置
console.log('🔍 检查 plugin_dirs 配置...');

const nodeModulesPatterns = [
  /plugin_dirs[:\s]*\[[\s\S]*?['"]node_modules['"]/,
  /plugin_dirs[:\s]*\[[\s\S]*?['"]node_modules\/@zhin\.js['"]/,
  /plugin_dirs[:\s]*=[\s\S]*?['"]node_modules['"]/
];

for (const pattern of nodeModulesPatterns) {
  if (pattern.test(configContent)) {
    console.error('❌ 发现危险配置: plugin_dirs 中包含 node_modules');
    console.error('   这会导致监听大量文件，可能造成服务器卡死！\n');
    hasErrors = true;
    
    // 显示匹配的行
    const lines = configContent.split('\n');
    lines.forEach((line, index) => {
      if (line.includes('plugin_dirs') || line.includes('node_modules')) {
        console.log(`   第 ${index + 1} 行: ${line.trim()}`);
      }
    });
    console.log('');
    break;
  }
}

if (!hasErrors) {
  console.log('✅ plugin_dirs 配置正常\n');
}

// 检查 debug 模式
console.log('🔍 检查 debug 配置...');
if (/debug[:\s]*true/.test(configContent)) {
  console.warn('⚠️  警告: debug 模式已启用');
  console.warn('   建议在生产环境中设置 debug: false\n');
  hasWarnings = true;
} else {
  console.log('✅ debug 配置正常\n');
}

// 检查环境变量
console.log('🔍 检查环境变量...');
if (!process.env.NODE_ENV) {
  console.warn('⚠️  警告: 未设置 NODE_ENV 环境变量');
  console.warn('   建议设置 NODE_ENV=production\n');
  hasWarnings = true;
} else if (process.env.NODE_ENV === 'production') {
  console.log('✅ NODE_ENV 已设置为 production\n');
} else {
  console.log(`ℹ️  当前 NODE_ENV: ${process.env.NODE_ENV}\n`);
}

// 检查 .env 文件
console.log('🔍 检查敏感信息保护...');
const envFiles = ['.env', '.env.production'];
const gitignorePath = path.join(projectRoot, '.gitignore');

if (fs.existsSync(gitignorePath)) {
  const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
  
  for (const envFile of envFiles) {
    if (fs.existsSync(path.join(projectRoot, envFile))) {
      if (!gitignore.includes('.env')) {
        console.error(`❌ ${envFile} 未添加到 .gitignore`);
        console.error('   敏感信息可能被提交到版本控制！\n');
        hasErrors = true;
      }
    }
  }
  
  if (!hasErrors) {
    console.log('✅ 敏感信息保护正常\n');
  }
} else {
  console.warn('⚠️  警告: 未找到 .gitignore 文件\n');
  hasWarnings = true;
}

// 统计潜在的监听文件数量
console.log('🔍 统计 node_modules 文件数量...');
const nodeModulesPath = path.join(projectRoot, 'node_modules');

if (fs.existsSync(nodeModulesPath)) {
  try {
    // 使用 find 命令统计（仅在 Unix 系统）
    const { execSync } = await import('child_process');
    const count = execSync(
      `find "${nodeModulesPath}" -type f \\( -name "*.js" -o -name "*.ts" -o -name "*.jsx" -o -name "*.tsx" \\) 2>/dev/null | wc -l`,
      { encoding: 'utf-8' }
    ).trim();
    
    console.log(`ℹ️  node_modules 中约有 ${count} 个 JS/TS 文件`);
    
    if (parseInt(count) > 10000 && hasErrors) {
      console.error(`⚠️  如果监听这些文件，将严重影响性能！\n`);
    } else {
      console.log('');
    }
  } catch (error) {
    console.log('ℹ️  无法统计文件数量（可能不支持 find 命令）\n');
  }
}

// 提供修复建议
if (hasErrors) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔧 修复建议：\n');
  console.log('1. 修改配置文件，移除 plugin_dirs 中的 node_modules：');
  console.log('   ```typescript');
  console.log('   plugin_dirs: [');
  console.log("     './plugins',  // ✅ 仅监听项目插件");
  console.log("     // 'node_modules',  // ❌ 移除此行");
  console.log('   ]');
  console.log('   ```\n');
  
  console.log('2. 或者使用环境变量区分开发和生产配置：');
  console.log('   ```typescript');
  console.log('   plugin_dirs: process.env.NODE_ENV === "production"');
  console.log("     ? ['./plugins']");
  console.log("     : ['./plugins', 'node_modules']");
  console.log('   ```\n');
  
  console.log('3. 重启应用：');
  console.log('   NODE_ENV=production pnpm start\n');
  
  console.log('详细文档: docs/guide/production-deployment.md');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

// 输出总结
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (hasErrors) {
  console.error('❌ 发现配置错误，请立即修复！');
  process.exit(1);
} else if (hasWarnings) {
  console.warn('⚠️  发现配置警告，建议优化');
  process.exit(0);
} else {
  console.log('✅ 配置检查通过，可以安全部署');
  process.exit(0);
}

