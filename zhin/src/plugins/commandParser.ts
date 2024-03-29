import { Plugin, segment } from '@zhinjs/core';

const commandParser = new Plugin('指令解析器');
commandParser.middleware(async (adapter, bot, message, next) => {
  const commands = commandParser.app!.getSupportCommands(adapter, bot, message);
  for (const command of commands) {
    const result = await command.execute(adapter, bot, message, message.raw_message);
    if (result) return message.reply(result);
  }
  return next();
});
commandParser
  .command('提示 [name:string]')
  .scope('private', 'group', 'guild', 'direct')
  .desc('显示指令文本')
  .alias('tip')
  .sugar(/^(\S+)提示$/, { args: ['$1'] })
  .option('-H [showHidden:boolean] 显示隐藏指令')
  .action(({ options, adapter, bot, message }, target) => {
    const supportCommands = commandParser.app!.getSupportCommands(adapter, bot, message);
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
      output.push('输入 “提示 [command name]” 展示指定指令提示');
      return segment.text(output.filter(Boolean).join('\n'));
    }

    return segment.text(
      commandParser
        .app!.findCommand(target)
        ?.help({ ...options, dep: 1 }, supportCommands)
        .concat('输入 “提示 [command name]” 展示指定指令提示')
        .join('\n'),
    );
  });
export default commandParser;
