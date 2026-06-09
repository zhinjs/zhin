import { describe, it, expect } from 'vitest';
import { jsx, renderJSX } from '../src/jsx.js';
import { defineComponent, renderComponents } from '../src/component.js';
import type { MessageComponent } from '../src/message.js';
import type { SendOptions } from '../src/types.js';

describe('JSX 出站管线', () => {
  it('renderComponents 应执行命令返回的 JSX 而非序列化函数体', async () => {
    const Test = defineComponent(async function Test() {
      throw new Error('测试异步组件错误处理');
    }, 'Test');

    const element = jsx(Test, {}) as MessageComponent<any>;
    const options: SendOptions = {
      content: element,
      type: 'private',
      context: 'test',
      bot: 'test',
      id: 'user-1',
    };

    const result = await renderComponents(new Map(), options);
    const text = typeof result.content === 'string'
      ? result.content
      : Array.isArray(result.content)
        ? result.content.map((c) => (typeof c === 'string' ? c : (c.data as { text?: string }).text ?? '')).join('')
        : '';

    expect(text).toBe('❌ 组件渲染失败: 测试异步组件错误处理');
    expect(text).not.toContain('async function');
  });

  it('renderJSX 与 renderComponents 对 Promise reject 行为一致', async () => {
    const Test = defineComponent(async function Test() {
      return new Promise<string>((_resolve, reject) => {
        reject(new Error('测试异步组件错误处理'));
      });
    }, 'Test');

    const element = jsx(Test, {}) as MessageComponent<any>;
    const direct = await renderJSX(element);
    const piped = await renderComponents(new Map(), {
      content: element,
      type: 'private',
      context: 'test',
      bot: 'test',
      id: 'user-1',
    });

    expect(direct).toBe('❌ 组件渲染失败: 测试异步组件错误处理');
    const pipedText = Array.isArray(piped.content)
      && piped.content[0]?.type === 'text'
      ? (piped.content[0].data as { text: string }).text
      : piped.content;
    expect(pipedText).toBe(direct);
  });
});
