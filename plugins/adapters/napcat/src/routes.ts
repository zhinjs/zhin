import type { Router } from '@zhin.js/host-router';
import type { NapCatAdapter } from './adapter.js';

export function registerRoutes(router: Router, napcat: NapCatAdapter): void {
  router.get('/api/napcat/bots', async (ctx) => {
    try {
      const bots = Array.from(napcat.bots.values());
      if (bots.length === 0) {
        ctx.body = { success: true, data: [], message: '暂无 NapCat 机器人实例' };
        return;
      }
      const result = await Promise.all(
        bots.map(async (bot) => {
          try {
            const connection = (bot.$config as any).connection ?? 'ws';
            const base: Record<string, unknown> = {
              name: bot.$config.name,
              connected: bot.$connected || false,
              connection,
              status: bot.$connected ? 'online' : 'offline',
              lastActivity: new Date().toISOString(),
            };
            if (bot.$connected) {
              try {
                const friends = await bot.getFriendList();
                const groups = await bot.getGroupList();
                base.friendCount = Array.isArray(friends) ? friends.length : 0;
                base.groupCount = Array.isArray(groups) ? groups.length : 0;
              } catch {
                base.friendCount = 0;
                base.groupCount = 0;
              }
            } else {
              base.friendCount = 0;
              base.groupCount = 0;
            }
            return base;
          } catch {
            return {
              name: bot.$config.name,
              connected: false,
              connection: 'unknown',
              status: 'error',
              friendCount: 0,
              groupCount: 0,
            };
          }
        }),
      );
      ctx.body = { success: true, data: result, timestamp: new Date().toISOString() };
    } catch (error) {
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: 'NAPCAT_API_ERROR',
        message: '获取机器人数据失败',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
      };
    }
  });
}
