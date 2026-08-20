import { databaseHostToken } from 'zhin.js/plugin-runtime';
import { defineCommand } from 'zhin.js/command';

interface ShowcaseConfig {
  greeting: string;
}

/** stats [name] —— 问候 + 数据库计数（演示命令侧 use(databaseHostToken) 与配置注入） */
export default defineCommand<ShowcaseConfig, Promise<string>>({
  description: '问候并累计呼叫次数（showcase_counter 表）',
  params: { name: { type: 'string', default: 'world' } },
  async execute({ config, params, use }) {
    const name = typeof params.name === 'string' && params.name ? params.name : 'world';
    const db = use(databaseHostToken);
    const model = db.models.get('showcase_counter');
    if (!model) return `${config.greeting}，${name}！（database 未启用，计数跳过）`;

    const rows = await model.select().where({ name });
    const next = rows[0] ? Number(rows[0].count) + 1 : 1;
    if (rows[0]) {
      await model.update({ count: next }).where({ name });
    } else {
      await model.insert({ name, count: next });
    }
    return `${config.greeting}，${name}！这是你第 ${next} 次呼叫`;
  },
});
