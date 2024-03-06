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
function xml2Json(xmlText: string) {
  const parse = (xmlText: string) => {
    xmlText = xmlText.replace(/\s+/g, '');
    const xmlRegexp = /<([^>]+)>([^<>]+)<\/\1>/;
    const result: Record<string, any> = {};
    while (xmlText.length) {
      const match = xmlRegexp.exec(xmlText);
      if (!match) break;
      const [, tagName, content] = match;
      if (/(\$\{[^}]+})/.test(content)) {
        const [...matches] = content.matchAll(/(\$\{[^}]+})/g);
        const keys = matches.map(([item]) => item);
        const obj = Object.fromEntries(
          keys
            .map(key => {
              return [key.slice(2, -1), result[key.slice(2, -1)]];
            })
            .filter(([_, value]) => value !== undefined),
        );
        const ks = Object.keys(obj);
        if (ks.length) {
          result[tagName] = obj;
          for (const key of ks) {
            delete result[key];
          }
        } else {
          if (result[tagName]) {
            result[tagName] = [result[tagName], content];
          } else {
            result[tagName] = content;
          }
        }
        delete result[content.slice(2, -1)];
      } else {
        if (result[tagName]) {
          result[tagName] = [result[tagName], content];
        } else {
          result[tagName] = content;
        }
      }
      xmlText = xmlText.replace(`<${tagName}>${content}<${tagName}>`, `\${${tagName}}`);
    }
    return result;
  };
  if (!/^<xml>(.+)<\/xml>$/.test(xmlText)) throw new Error('Invalid XML string');
  const temp = xmlText.match(/^<xml>(.+)<\/xml>$/) as RegExpMatchArray;
  return parse(temp[1]);
}
export function json2Xml(content: any, level = 0): string {
  const _stringify = (content: any) => {
    if (typeof content !== 'object') return content;
    return Object.entries(content)
      .map(([key, value]) => {
        if (Array.isArray(value)) return value.map(v => `<${key}>${json2Xml(v, level + 1)}</${key}>`).join('\n');
        if (typeof value === 'object') return `<${key}>\n${json2Xml(value, level + 1)}\n</${key}>`;
        return `<${key}>${value}</${key}>`;
      })
      .join('\n');
  };
  return `<xml>${_stringify(content)}</xml>`;
}
// console.log(
//   xml2Json(
//     `
// <xml>
// <test>123</test>
// <foo>
//     <bar>
//         <a1>b2</a1>
//     </bar>
//     <bar>abc</bar>
// </foo>
// </xml>
// `.trimStart(),
//   ),
// );
// console.log(
//   json2Xml({
//     test: 123,
//     foo: {
//       bar: [{ a1: 'b2' }, 'abc'],
//     },
//   }),
// );
export default test;
