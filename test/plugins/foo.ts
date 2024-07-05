import { registerCommand, useContext, definePluginOptions, registerMiddleware } from 'zhin';
definePluginOptions({
  name: 'setup 测试插件',
});
registerCommand('foo')
  .hidden()
  .action(({ bot }) => {
    return 'bar';
  });

registerCommand('bar')
  .hidden()
  .action(() => {
    return '我不知道该说啥呀';
  });

registerMiddleware((_adapter, _bot, message, next) => {
  // console.log(_adapter, _bot, message);
  next();
});
