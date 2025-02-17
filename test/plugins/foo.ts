import { registerMiddleware, useCommand, defineCommand, defineMetadata } from 'zhin';
const testCommand = defineCommand('foo');

defineMetadata({
  name: 'foo',
});
useCommand(testCommand);

useCommand('bar')
  .hidden()
  .action(() => {
    return '我不知道该说啥呀';
  });

registerMiddleware((message, next) => {
  next();
});
