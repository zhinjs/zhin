#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// 获取当前文件目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 计算CLI的绝对路径
const cliPath = join(__dirname, '../../cli/lib/cli.js');

// 直接调用 CLI 的 init 命令
const args = process.argv.slice(2);
const initArgs = ['init', ...args];

const child = spawn('node', [cliPath, ...initArgs], {
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