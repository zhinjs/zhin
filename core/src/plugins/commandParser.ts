import { Plugin } from '@/plugin';
import { segment } from '@/message';

const CP = new Plugin('指令解析器');
CP.middleware(async (adapter, bot, message, next) => {
  const commands = CP.app!.getSupportCommands(adapter, bot, message);
  for (const command of commands) {
    const result = await command.execute(adapter, bot, message, message.raw_message);
    if (result) return message.reply(result);
  }
  return next();
});
CP.command('帮助 [name:string]')
  .scope('private', 'group', 'guild', 'direct')
  .desc('显示指令帮助')
  .alias('help')
  .sugar(/^(\S+)帮助$/, { args: ['$1'] })
  .option('-H [showHidden:boolean] 显示隐藏指令')
  .action(({ options, adapter, bot, message }, target) => {
    const supportCommands = CP.app!.getSupportCommands(adapter, bot, message);
    if (!target) {
      const commands = supportCommands.filter(cmd => {
        if (options.showHidden) return cmd.parent === null;
        return !cmd.config.hidden && cmd.parent === null;
      });
      const output = commands
        .map(command =>
          command.help(
            {
              ...options,
              simple: true,
              dep: 0,
            },
            supportCommands,
          ),
        )
        .flat();
      output.push('输入 “帮助 [command name]” 展示指定指令帮助');
      return segment('text', {
        text: output.filter(Boolean).join('\n'),
      });
    }

    return segment('text', {
      text: CP.app!
        .findCommand(target)
        ?.help({ ...options, dep: 1 }, supportCommands)
        .concat('输入 “帮助 [command name]” 展示指定指令帮助')
        .join('\n'),
    });
  });
export default CP;
