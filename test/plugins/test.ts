import { Plugin, Message } from 'zhin';
import '@zhinjs/plugin-sandbox';
import * as path from 'path';
import type { } from '@zhinjs/web';

const test = new Plugin('测试插件'); // 定义插件
test.required('functionManager', 'component'); // 声明插件必须依赖的服务
test
  .command('test-confirm') // 插件功能
  .hidden()
  .action(async runtime => {
    const isConfirm = await runtime.prompt.confirm('确认吗');
    return `${isConfirm ? '已确认' : '已取消'}:${isConfirm} ${typeof isConfirm}`;
  });
test
  .command('test-text [test:number] [abc:boolean]')
  .hidden()
  .action(async ({ adapter, message, prompt }, text) => {
    const input = await prompt.text('请输入文本');
    return `inputResult:${input} ${typeof input}`;
  });
test
  .command('test-number')
  .hidden()
  .action(async runtime => {
    const input = await runtime.prompt.number('请输入数值');
    return `inputResult:${input} ${typeof input}`;
  });
test
  .command('test-list')
  .hidden()
  .action(async runtime => {
    const input = await runtime.prompt.list('请输入', {
      type: 'text',
    });
    return `inputResult:${input} ${typeof input}`;
  });
test
  .command('test-pick')
  .hidden()
  .action(async ({ prompt }) => {
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
test.required('web');
test.command('域名比价 [domain:string]')
  .option('-t <type:string>', 'new')
  .sugar(/^哪儿注册([a-z]+)便宜$/, { args: ['$1'] })
  .sugar(/^哪儿续费([a-z]+)便宜$/, { args: ['$1'], options: { type: 'renew' } })
  .action(async ({ options, prompt }, domain) => {
    if (!domain) domain = await prompt.text('请输入域名后缀')
    const url = new URL('https://www.nazhumi.com/api/v1')
    url.searchParams.set('domain', domain)
    url.searchParams.set('order', options.type || 'new')
    const result = await fetch(url).then(r => r.json())
    const list = result.data?.price || []
    if (!list?.length) return
    return list.map((item: any, idx: number) => {
      return [
        idx + 1,
        `服务商：${item.registrarname}`,
        `官网：${item.registrarweb}`,
        `注册:${item.new}${item.currencyname}`,
        `续费:${item.renew}${item.currencyname}`,
        `转入:${item.transfer}${item.currencyname}`,
      ].join('\n')
    }).join('\n==============\n')
  })
test.mounted(() => {
  test.web.addEntry(path.resolve(__dirname, '../client/index.ts'));
  test.component({
    name: 'test2',
    render(_, context) {
      return `<slot/>,一天天的就知道钓鱼，该上学上学，该上班上班`;
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
      context.$message.bot.unique_id;
      return `不务正业!${context.who}`;
    },
  });
});
// test
//   .command('钓鱼')
//   .alias('🎣')
//   .sugar(/^.(钓鱼)|(🎣)$/)
//   .action(({ message }) => `<test2><test who="${message.sender.user_id}"/></test2>`);
test.mounted(async () => {
  test.register('hello', function (this: Message, foo, bar, isExist = false) {
    return `receive from ${this.message_type},args is ${foo},${bar},${isExist}`;
  });
});
class Stack<T = any> extends Array<T> {
  peek() {
    return this[this.length - 1]
  }
  get size() {
    return this.length
  }
  get isEmpty() {
    return !this.length
  }
}
class Queue<T = any> extends Stack<T> {
  override pop() {
    return this.shift()
  }
}
class ListNode<T = any> {
  constructor(public val: T) { }
  next: ListNode | null = null
}
function removeRepeat(str: string) {
  /**
   * use regexp
   */
  // return str.replace(/(.)\1+/g,'$1')
  /**
   * use endsWith
   */
  // let result=''
  // for(let char of str){
  //     if(!result.endsWith(char)) result+=char
  // }
  // return result
  /**
   * use stack
   */
  const stack = new Stack<string>()
  for (const char of str) {
    if (stack.peek() !== char) stack.push(char)
  }
  return stack.join('')
}
// console.log(removeRepeat('abbb  aac'))
var t = [
  [
    0, 9, 10, 19,//i+j*i
    1, 8, 11, 18,
    2, 7, 12, 17,
    3, 6, 13, 16,
    4, 5, 14, 15
  ]
]
export default test; // 最后导出
