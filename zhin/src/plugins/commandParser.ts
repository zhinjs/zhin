import { Message, Plugin, segment } from '@zhinjs/core';
declare module '@zhinjs/core' {
  namespace App {
    interface Services {
      executeCommand: typeof executeCommand;
    }
  }
}
const executeCommand = async (message: Message) => {
  let template = message.raw_message;
  if (message.bot.command_prefix) {
    if (!template.startsWith(message.bot.command_prefix)) return;
    template = template.replace(message.bot.command_prefix, '');
  }
  const commands = commandParser.app!.getSupportCommands(message.adapter.name);
  for (const command of commands) {
    const result = await command.execute(message, template);
    if (result) {
      await message.reply(result);
      return true;
    }
  }
};
const commandParser = new Plugin('commandParser');
commandParser.middleware(async (_a, _b, message, next) => {
  const result = await executeCommand(message);
  if (result) return;
  return next();
});
commandParser
  .command('提示 [name:string]')
  .scope('private', 'group', 'guild', 'direct')
  .desc('输出指令提示文本')
  .alias('tip')
  .option('-H [showHidden:boolean] 显示隐藏指令')
  .action(({ options, message }, target) => {
    const supportCommands = commandParser.app!.getSupportCommands(message.adapter.name);
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
