import { context, setOptions } from 'zhin';
setOptions({
  name: 'setup 测试插件',
});
const { useMiddleware, useCommand } = context;
useCommand('foo')
  .hidden()
  .action(({ bot }) => {
    return 'bar';
  });

useCommand('bar')
  .hidden()
  .action(() => {
    return '我不知道该说啥呀';
  });

useMiddleware((_adapter, _bot, message, next) => {
  // console.log(_adapter, _bot, message);
  next();
});
