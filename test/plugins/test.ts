import { Plugin } from 'zhin';
import * as path from 'path';
import '@zhinjs/plugin-sandbox';
import type {} from '@zhinjs/client/src';
const test = new Plugin('测试插件');
test.command('test-confirm').action(async runtime => {
  const isConfirm = await runtime.prompt.confirm('确认吗');
  return `${isConfirm ? '已确认' : '已取消'}:${isConfirm} ${typeof isConfirm}`;
});
test.command('test-text [test:number] [abc:boolean]').action(async ({ adapter, prompt }, text) => {
  const input = await prompt.text('请输入文本');
  return `inputResult:${input} ${typeof input}`;
});
test.command('test-number').action(async runtime => {
  const input = await runtime.prompt.number('请输入数值');
  return `inputResult:${input} ${typeof input}`;
});
test.command('test-list').action(async runtime => {
  const input = await runtime.prompt.list('请输入', {
    type: 'text',
  });
  return `inputResult:${input} ${typeof input}`;
});
test.command('test-pick').action(async ({ prompt }) => {
  const input = await prompt.pick('请选择你喜欢的水果', {
    type: 'text',
    multiple: true,
    options: [
      {
        label: '苹果',
        value: 'apple',
      },
      {
        label: '香蕉',
        value: 'banana',
      },
      {
        label: '橙子',
        value: 'orange',
      },
    ],
  });
  return `inputResult:${input} ${typeof input}`;
});
test.required('addEntry');
test.mounted(() => {
  test.addEntry(path.resolve(__dirname, '../client/index.ts'));
  test.component({
    name: 'test2',
    render(_, context) {
      return `<slot/>,我在这儿`;
    },
  });
  test.component({
    name: 'test',
    props: {
      who: {
        type: String,
        default: '张三',
      },
    },
    render(props, context) {
      return `hello!${context.who}`;
    },
  });
});
test.command('钓鱼').action(() => '一天天的就知道钓鱼，该上学上学，该上班上班');
export default test;
