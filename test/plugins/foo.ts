import { command, options, middleware } from 'zhin';
options({
  name: 'foo',
});
command('foo')
  .hidden()
  .action(({ bot }) => {
    return 'bar';
  });
command('bar')
  .hidden()
  .action(() => {
    return '我不知道该说啥呀';
  });
middleware((a, b, e) => {});
