// JSX 运行时入口文件
import { jsx, jsxs, Fragment, renderJSX } from './jsx.js';

export { jsx, jsxs, Fragment, renderJSX };
export type { JSX } from './jsx.js';

// 默认导出 JSX 运行时
export default {
    jsx,
    jsxs,
    Fragment,
    renderJSX
};
