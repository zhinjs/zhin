// @ts-nocheck — 说明性骨架：复制到真实插件包的 src/models/profile.ts。

export interface ProfileRow {
  id?: number;
  user_id: string;
  nickname: string;
  points: number;
  metadata?: unknown;
}

export const PROFILE_MODEL = 'plugin_profiles';

/**
 * 保持为纯函数：plugin.ts 在 setup(context) 取得 databaseHostToken 后调用。
 * 表定义归 owner generation；能力文件只读取 owner 提供的 store Resource。
 */
export function defineProfileTable(db: {
  define(name: string, definition: Record<string, unknown>): void;
}): void {
  db.define(PROFILE_MODEL, {
    id: { type: 'integer', primary: true, autoIncrement: true },
    user_id: { type: 'text', nullable: false },
    nickname: { type: 'text', nullable: false },
    points: { type: 'integer', nullable: false, default: 0 },
    metadata: { type: 'json' },
  });
}
