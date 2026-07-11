/**
 * Request 抽象层测试
 */
import { Request, RequestBase } from '../src/request.js';
import { formatSideEventName } from '../src/side-event/base.js';

describe('Request', () => {
  describe('Request.from()', () => {
    it('应合并原始数据与基础结构', () => {
      const raw = { flag: 'abc123', extra_data: 42 };
      const base: RequestBase = {
        $id: 'req_001',
        $adapter: 'onebot11' as any,
        $endpoint: 'bot1',
        $type: 'request',
        $scene_id: '100',
        $scene_type: 'friend',
        $sub_type: 'add',
        $actor: { id: '200', name: '请求者' },
        $comment: '请加我好友',
        $timestamp: 1000,
        $approve: async () => {},
        $reject: async () => {},
      };
      const request = Request.from(raw, base);

      expect(formatSideEventName(request)).toBe('request.friend.add');
      expect(request.$actor).toEqual({ id: '200', name: '请求者' });
      expect(request.flag).toBe('abc123');
    });
  });

  describe('$approve() 和 $reject()', () => {
    it('调用 $approve 应执行同意逻辑', async () => {
      let approved = false;
      const request = Request.from({}, {
        $id: 'req_approve',
        $adapter: 'onebot11' as any,
        $endpoint: 'bot1',
        $type: 'request',
        $scene_id: '100',
        $scene_type: 'friend',
        $sub_type: 'add',
        $actor: { id: '200', name: '用户' },
        $timestamp: 0,
        $approve: async () => { approved = true; },
        $reject: async () => {},
      });

      await request.$approve('备注名');
      expect(approved).toBe(true);
    });
  });
});
