import { Command } from 'commander';
import { formatPluginUseCases } from '../plugin-management/use-cases.js';

export const useCasesCommand = new Command('use-cases')
  .description('按用途找到插件、配置步骤与适用范围（只读，不安装或发送）')
  .argument('[id]', 'reminder / group-welcome / keyword-reply')
  .action((id?: string) => { console.log(formatPluginUseCases(id)); });
