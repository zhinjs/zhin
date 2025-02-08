import { registerMiddleware, useCommand, defineMetadata } from 'zhin';
defineMetadata({
  name: 'foo',
});
useCommand('foo')
  .hidden()
  .action(({ bot }) => {
    return 'bar1';
  });

useCommand('bar')
  .hidden()
  .action(() => {
    return '我不知道该说啥呀';
  });

registerMiddleware((_adapter, _bot, message, next) => {
  // console.log(_adapter, _bot, message);
  next();
});
