#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';

import { InitOptions } from './types.js';
import { generateRandomPassword, getCurrentUsername, getDatabaseDisplayName } from './utils.js';
import { configureDatabaseOptions } from './database.js';
import { createWorkspace } from './workspace.js';
import { ensurePnpmInstalled, installDependencies } from './install.js';

async function main() {
  const args = process.argv.slice(2);
  
  const options: InitOptions = {
    yes: args.includes('-y') || args.includes('--yes')
  };
  
  const projectNameArg = args.find(arg => !arg.startsWith('-'));
  
  if (options.yes) {
    options.config = 'ts';
    options.runtime = 'node';
    options.httpUsername = getCurrentUsername();
    options.httpPassword = generateRandomPassword(6);
    options.database = {
      dialect: 'sqlite',
      filename: './data/bot.db',
      mode: 'wal'
    };
  }
  
  // 检测并安装 pnpm
  await ensurePnpmInstalled();
  
  try {
    let name = projectNameArg;
    
    if (!name) {
      const { projectName: inputName } = await inquirer.prompt([
        {
          type: 'input',
          name: 'projectName',
          message: '请输入项目名称:',
          default: 'my-zhin-bot',
          validate: (input: string) => {
            if (!input.trim()) return '项目名称不能为空';
            if (!/^[a-zA-Z0-9-_]+$/.test(input)) {
              return '项目名称只能包含字母、数字、横线和下划线';
            }
            return true;
          }
        }
      ]);
      name = inputName;
    }
    
    if (!options.runtime) {
      const { runtime } = await inquirer.prompt([
        {
          type: 'list',
          name: 'runtime',
          message: '选择运行时:',
          choices: [
            { name: 'Node.js (推荐)', value: 'node' },
            { name: 'Bun', value: 'bun' }
          ],
          default: 'node'
        }
      ]);
      options.runtime = runtime;
    }
    
    if (!options.config) {
      const { configFormat } = await inquirer.prompt([
        {
          type: 'list',
          name: 'configFormat',
          message: '选择配置文件格式:',
          choices: [
            { name: 'TypeScript (推荐)', value: 'ts' },
            { name: 'JavaScript', value: 'js' },
            { name: 'YAML', value: 'yaml' },
            { name: 'JSON', value: 'json' }
          ],
          default: 'ts'
        }
      ]);
      options.config = configFormat;
    }
    
    // HTTP 认证配置
    if (!options.httpUsername || !options.httpPassword) {
      console.log('');
      console.log(chalk.blue('🔐 配置 Web 控制台登录信息'));
      
      const defaultUsername = getCurrentUsername();
      const defaultPassword = generateRandomPassword(6);
      
      const httpConfig = await inquirer.prompt([
        {
          type: 'input',
          name: 'username',
          message: 'Web 控制台用户名:',
          default: defaultUsername,
          validate: (input: string) => {
            if (!input.trim()) return '用户名不能为空';
            return true;
          }
        },
        {
          type: 'input',
          name: 'password',
          message: 'Web 控制台密码:',
          default: defaultPassword,
          validate: (input: string) => {
            if (!input.trim()) return '密码不能为空';
            if (input.length < 6) return '密码至少需要 6 个字符';
            return true;
          }
        }
      ]);
      
      options.httpUsername = httpConfig.username;
      options.httpPassword = httpConfig.password;
    }
    
    // 数据库配置
    if (!options.database) {
      console.log('');
      console.log(chalk.blue('🗄️  配置数据库'));
      
      const databaseConfig = await configureDatabaseOptions();
      options.database = databaseConfig;
    }

    if (!name) {
      console.error(chalk.red('项目名称不能为空'));
      process.exit(1);
    }

    const projectPath = path.resolve(process.cwd(), name);
    const realName = path.basename(projectPath);
    
    if (fs.existsSync(projectPath)) {
      console.error(chalk.red(`目录 ${realName} 已存在`));
      process.exit(1);
    }

    console.log(chalk.blue(`正在创建 pnpm workspace 项目 ${realName}...`));
    
    await createWorkspace(projectPath, realName, options);
    
    console.log(chalk.green(`✓ 项目结构创建成功！`));
    console.log('');
    
    console.log(chalk.blue('📦 正在安装依赖...'));
    await installDependencies(projectPath);
    
    console.log('');
    console.log(chalk.green('🎉 项目初始化完成！'));
    console.log('');
    console.log(chalk.blue('🔐 Web 控制台登录信息：'));
    console.log(`  ${chalk.gray('URL:')} ${chalk.cyan('http://localhost:8086')}`);
    console.log(`  ${chalk.gray('用户名:')} ${chalk.cyan(options.httpUsername)}`);
    console.log(`  ${chalk.gray('密码:')} ${chalk.cyan(options.httpPassword)}`);
    console.log(`  ${chalk.yellow('⚠ 登录信息已保存到')} ${chalk.cyan('.env')} ${chalk.yellow('文件')}`);
    
    // 显示数据库配置信息
    if (options.database) {
      console.log('');
      console.log(chalk.blue('🗄️  数据库配置：'));
      console.log(`  ${chalk.gray('类型:')} ${chalk.cyan(getDatabaseDisplayName(options.database.dialect))}`);
      
      if (options.database.dialect === 'sqlite') {
        console.log(`  ${chalk.gray('文件:')} ${chalk.cyan(options.database.filename)}`);
        if (options.database.mode) {
          console.log(`  ${chalk.gray('模式:')} ${chalk.cyan(options.database.mode.toUpperCase())}`);
        }
      } else {
        console.log(`  ${chalk.yellow('⚠ 数据库连接信息已保存到')} ${chalk.cyan('.env')} ${chalk.yellow('文件')}`);
        console.log(`  ${chalk.gray('请根据实际情况修改数据库连接参数')}`);
      }
    }
    
    console.log('');
    console.log('📝 下一步操作：');
    console.log(`  ${chalk.cyan(`cd ${realName}`)}`);
    if(options.database.dialect ==='sqlite'){
      console.log(`  ${chalk.cyan('pnpm approve-builds sqlite3')} ${chalk.gray('# 批准 sqlite3 原生模块构建如遇错误，请检查系统是否已安装C++编译器(g++)')}`);
    }
    console.log('');
    console.log(chalk.yellow('开发环境：'));
    console.log(`  ${chalk.cyan('pnpm dev')} ${chalk.gray('# 开发模式（自动监听，使用 tsx 文件）')}`);
    console.log('');
    console.log(chalk.yellow('生产环境：'));
    console.log(`  ${chalk.cyan('pnpm build')} ${chalk.gray('# 构建客户端代码和所有插件')}`);
    console.log(`  ${chalk.cyan('pnpm start')} ${chalk.gray('# 生产环境启动')}`);
    console.log(`  ${chalk.cyan('pnpm daemon')} ${chalk.gray('# 后台运行')}`);
    console.log(`  ${chalk.cyan('pnpm stop')} ${chalk.gray('# 停止后台服务')}`);
    console.log('');
    console.log(chalk.yellow('插件开发：'));
    console.log(`  ${chalk.cyan('zhin new <plugin-name>')} ${chalk.gray('# 创建新插件')}`);
    
    console.log('');
    console.log('📚 相关文档：');
    console.log(`  ${chalk.cyan('https://github.com/zhinjs/zhin')}`);
    console.log(`  ${chalk.cyan('https://zhinjs.github.io')}`);
    
  } catch (error) {
    console.error(chalk.red(`创建项目失败: ${error}`));
    process.exit(1);
  }
}

main();