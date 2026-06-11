import type { Router } from '@zhin.js/host-router';
import type { NapCatAdapter } from './adapter.js';

export function registerRoutes(router: Router, napcat: NapCatAdapter): void {
  router.get('/api/napcat/endpoints', async (ctx) => {
    try {
      const endpoints = Array.from(napcat.endpoints.values());
      if (endpoints.length === 0) {
        ctx.body = { success: true, data: [], message: '暂无 NapCat Endpoint 实例' };
        return;
      }
      const result = await Promise.all(
        endpoints.map(async (endpoint) => {
          try {
            const connection = (endpoint.$config as any).connection ?? 'ws';
            const base: Record<string, unknown> = {
              name: endpoint.$config.name,
              connected: endpoint.$connected || false,
              connection,
              status: endpoint.$connected ? 'online' : 'offline',
              lastActivity: new Date().toISOString(),
            };
            if (endpoint.$connected) {
              try {
                const friends = await endpoint.getFriendList();
                const groups = await endpoint.getGroupList();
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
              name: endpoint.$config.name,
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
        message: '获取 Endpoint 数据失败',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
      };
    }
  });
}
