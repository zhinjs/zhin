import { defineMiddleware } from '@zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';

/**
 * 游戏 legacy 命令别名路由。
 *
 * 插件运行时迁移后，约定式命令以 `<instanceKey> <localName>` 限定名注册（ADR 0043），
 * 旧的短命令（如 `/21点 开始`、`/猜数 开始`）在 runtime 中不存在。
 * 各游戏插件用本 helper 在 `middlewares/` 下注册一个入站中间件，
 * 把命中别名的首词消息转发到与限定名命令完全相同的处理逻辑。
 */
export interface GameCommandAliasRoute {
  /** 首词命中即接管（不含前导 `/`），如 `['21点', 'bj']`。 */
  readonly aliases: readonly string[];
  /**
   * 与 `commands/<cmd>/[action:string=].ts` 的 execute 逻辑保持一致：
   * action 为别名后剩余文本（无参数时为 ''）；返回回复文本，null/undefined 表示放行。
   */
  run(action: string, input: unknown): Promise<string | null | undefined>;
}

export function defineGameCommandAliasMiddleware(route: GameCommandAliasRoute) {
  return defineMiddleware<Message>({
    target: 'inbound',
    async handle(context, next) {
      const raw = context.input.content?.trim() ?? '';
      const text = raw.startsWith('/') ? raw.slice(1) : raw;
      const [head, ...rest] = text.split(/\s+/).filter(Boolean);
      if (!head || !route.aliases.includes(head)) {
        await next();
        return;
      }
      const reply = await route.run(rest.join(' '), context.input);
      if (reply) {
        await context.input.$reply(reply);
        return;
      }
      await next();
    },
  });
}
