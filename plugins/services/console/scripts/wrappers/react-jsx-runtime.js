// 重新导出 react/jsx-runtime 的所有命名导出
import * as JSXRuntime from 'react/jsx-runtime';

export const {
  jsx,
  jsxs,
  Fragment,
} = JSXRuntime;

export default JSXRuntime;

