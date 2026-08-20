// @ts-nocheck — 说明性骨架：assets/ 不属于任何 package/tsconfig，下面的 import 在此目录无法解析。
// 请复制到真实插件包中使用。
//
// 数据库装配放在 plugin.ts 的 setup()：先 define 表，再 provide 成 owner Resource，
// 命令只从执行上下文读取，不 import 模块级单例（参考 plugins/utils/lottery）。
//
//   my-plugin/
//     plugin.ts               ← 本文件的 default export
//     commands/profile.ts     ← 见文件末尾
import { createToken, definePlugin, databaseHostToken } from 'zhin.js';

export const PROFILE_MODEL = 'plugin_profiles';

export interface ProfileRow {
  id?: number;
  user_id: string;
  nickname: string;
  points: number;
  metadata?: unknown;
}

export interface ProfileStore {
  list(userId: string): Promise<ProfileRow[]>;
  create(row: ProfileRow): Promise<unknown>;
}

export const profileStoreToken = createToken<ProfileStore>('my-plugin.profile-store');

export default definePlugin({
  name: 'my-plugin',
  metadata: {
    displayName: 'My Plugin',
  },
  setup(context) {
    // DatabaseHost 是可选资源：未安装时降级或直接跳过。
    if (!context.resources.has(databaseHostToken)) return;
    const db = context.resources.use(databaseHostToken);

    // 表结构必须在 Host start() 之前 define。
    db.define(PROFILE_MODEL, {
      user_id: { type: 'string' },
      nickname: { type: 'string' },
      points: { type: 'integer' },
      metadata: { type: 'json' },
    });

    const store: ProfileStore = {
      async list(userId) {
        return (await db.models.get(PROFILE_MODEL)?.select({ user_id: userId })) ?? [];
      },
      async create(row) {
        return db.models.get(PROFILE_MODEL)?.create(row);
      },
    };

    context.resources.provide(profileStoreToken, store);
  },
});

// ── commands/profile.ts ──────────────────────────────────────────────────────
// import { defineCommand } from 'zhin.js/command';
// import { profileStoreToken } from '../plugin.js';
//
// export default defineCommand({
//   description: 'Show current user profile',
//   async execute(context) {
//     const store = context.resources.use(profileStoreToken);
//     const [profile] = await store.list(context.input.sender.id);
//     return profile ? `${profile.nickname}: ${profile.points}` : 'profile not found';
//   },
// });
