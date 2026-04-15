// async-jsx.ts - 异步 JSX 增强工具

import { SendContent } from "zhin.js";

/**
 * 异步组件包装器
 * 类似 Next.js 的异步组件支持
 */
export function AsyncComponent<P = any>(
  Component: (props: P) => Promise<SendContent>
): (props: P) => SendContent {
  // 返回一个同步函数，但内部处理是异步的
  return (props: P) => {
    // 创建一个特殊的标记对象
    const asyncMarker = {
      __async: true,
      component: Component,
      props,
      execute: () => Component(props)
    };
    
    // TypeScript 类型断言
    return asyncMarker as any as SendContent;
  };
}

/**
 * 渲染异步内容
 * 检查是否是异步标记，如果是则执行
 */
export async function renderAsync(content: any): Promise<SendContent> {
  if (content && typeof content === 'object' && content.__async) {
    return await content.execute();
  }
  if (content && typeof content.then === 'function') {
    return await content;
  }
  return content;
}

/**
 * Suspense 组件工厂
 * 用于包装异步组件并提供 fallback
 */
export function createSuspense(fallback: string = '加载中...') {
  return async function Suspense(props: { children: any }): Promise<SendContent> {
    try {
      return await renderAsync(props.children);
    } catch (error) {
      console.error('Suspense error:', error);
      return fallback;
    }
  };
}
