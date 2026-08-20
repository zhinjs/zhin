// @ts-nocheck — 说明性骨架：assets/ 不属于任何 package/tsconfig，下面的 import 在此目录无法解析。
// 请复制到真实插件包中使用。
//
// 组件按目录发现，一个文件一个组件，default export；**文件名即组件名**。
//   my-plugin/
//     components/
//       user-badge.tsx     ← 本文件，供消息侧以组件调用引用
import { defineComponent } from 'zhin.js/component';

interface UserBadgeProps {
  name: string;
  level?: number;
}

export default defineComponent<UserBadgeProps>({
  // render(props, context)；context 为 ComponentContext（含 config 与 requester）
  render(props, context) {
    return `👤 ${props.name} Lv.${props.level ?? 1}`;
  },
});
