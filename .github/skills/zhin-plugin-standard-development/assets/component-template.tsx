// @ts-nocheck — 复制到真实插件的 components/user-badge/index.tsx。
// tsconfig: jsx=react-jsx, jsxImportSource=zhin.js。
import { defineComponent } from 'zhin.js/component';
import type { JSXRenderable } from 'zhin.js/jsx';

interface UserBadgeProps {
  name: JSXRenderable;
  level?: number;
}

export default defineComponent<UserBadgeProps>({
  render({ name, level = 1 }) {
    return <span><strong>{name}</strong> Lv.{level}</span>;
  },
});
