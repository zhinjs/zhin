import { defineGamePlugin, type InMemoryGameDb } from '@zhin.js/game-kit';
import {
  outboundHostToken,
  scheduleHostToken,
  type PluginSetupContext,
} from 'zhin.js';
import type { RouletteConfig } from './src/config.js';
import { expireOverdueSessions, type ExpiredSessionNotice } from './src/game-flow.js';
import { ROULETTE_TABLES, defineHostTables, type RouletteSessionRow } from './src/models.js';
import { resolveRouletteFlow, rouletteServicesToken } from './src/runtime.js';
import {
  createServices,
  type RouletteDatabase,
  type RouletteServices,
} from './src/session-service.js';

/** Turn and lobby deadlines are checked every five seconds. */
const DEADLINE_CRON = '*/5 * * * * *';

/**
 * Plugin Runtime wiring:
 * - `commands/roulette` and the `轮盘` alias middleware share one action runner.
 * - `middlewares/roulette-fire` lets the player on turn just say 「开枪」.
 * - Sessions use the host database when installed, otherwise memory.
 * - A schedule job enforces turn and lobby timeouts and posts the result.
 * - Results feed game-hub records, so 「战绩」 and 「排行 轮盘」 work.
 */
export default defineGamePlugin<RouletteServices, RouletteSessionRow, Partial<RouletteConfig>>({
  name: 'roulette',
  metadata: {
    displayName: 'Russian Roulette',
  },
  game: {
    id: 'roulette',
    title: '俄罗斯轮盘',
    icon: '🔫',
    description: '多人轮流开枪，中弹者输；可按群开启禁言惩罚',
    commandPrefix: '/轮盘',
    quickStart: '开局',
    aliases: ['轮盘赌', 'roulette'],
    menus: [
      { id: 'open', label: '🎮 开局' },
      { id: 'join', label: '🙋 加入' },
      { id: 'help', label: '📖 玩法说明' },
    ],
  },
  tables: ROULETTE_TABLES,
  servicesToken: rouletteServicesToken,
  defineHostTables,
  createServices: (database: InMemoryGameDb) =>
    createServices(database as unknown as RouletteDatabase),
  session: (services) => services.sessions,
  stale: false,
  setup: (context) => registerDeadlineJob(context),
});

function registerDeadlineJob(context: PluginSetupContext<Partial<RouletteConfig>>): void {
  if (!context.resources.has(scheduleHostToken)) return;
  const schedule = context.resources.use(scheduleHostToken);
  context.lifecycle.add(schedule.register({
    id: 'roulette/deadlines',
    cron: DEADLINE_CRON,
    description: 'End roulette turns and lobbies that ran out of time',
    async execute() {
      const flow = resolveRouletteFlow({
        use: (token) => context.resources.use(token),
        config: context.config.get(),
      });
      const notices = await expireOverdueSessions(flow, Date.now());
      for (const notice of notices) {
        await announce(context, notice);
      }
    },
  }));
}

async function announce(
  context: PluginSetupContext<Partial<RouletteConfig>>,
  notice: ExpiredSessionNotice,
): Promise<void> {
  if (!context.resources.has(outboundHostToken)) return;
  const outbound = context.resources.use(outboundHostToken);
  const session = notice.session;
  try {
    await outbound.send({
      adapter: session.adapter,
      endpointKey: session.endpoint,
      conversation: {
        kind: session.channel_type as 'group' | 'channel',
        id: session.channel_id,
      },
      content: notice.text,
    });
  } catch {
    // The result is already stored; a failed notice must not stop the other sessions.
  }
}
