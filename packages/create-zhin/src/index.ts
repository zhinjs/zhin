#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

// 获取当前文件目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 计算CLI的绝对路径（优先通过模块解析，其次回退到常见路径）
const require = createRequire(import.meta.url);

function resolveCliPath() {
  try {
    return require.resolve('@zhin.js/cli/lib/cli.js');
  } catch {
    const candidates = [
      // 在已发布环境中（node_modules 扁平结构）
      join(__dirname, '..', '..', '@zhin.js', 'cli', 'lib', 'cli.js'),
      // 在本地 monorepo 开发环境（packages/cli）
      join(__dirname, '..', '..', '..', 'cli', 'lib', 'cli.js')
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    throw new Error('无法定位 @zhin.js/cli 的入口文件');
  }
}

const cliPath = resolveCliPath();

// 直接调用 CLI 的 init 命令
const args = process.argv.slice(2);
const initArgs = ['init', ...args];

const child = spawn(process.execPath, [cliPath, ...initArgs], {
  stdio: 'inherit',
  cwd: process.cwd()
});

child.on('close', (code) => {
  process.exit(code || 0);
});

child.on('error', (error) => {
  // console.error 已替换为注释
  process.exit(1);
}); 