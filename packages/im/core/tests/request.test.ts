/**
 * Request 抽象层测试
 */
import { Request, RequestBase, RequestType } from '../src/request.js';

describe('Request', () => {
  // ============================================================================
  // Request.from()
  // ============================================================================
  describe('Request.from()', () => {
    it('应合并原始数据与基础结构', () => {
      const raw = { flag: 'abc123', extra_data: 42 };
      const base: RequestBase = {
        $id: 'req_001',
        $adapter: 'onebot11' as any,
        $bot: 'bot1',
        $type: 'friend_add',
        $channel: { id: '100', type: 'private' },
        $sender: { id: '200', name: '请求者' },
        $comment: '请加我好友',
        $timestamp: 1000,
        $approve: async () => {},
        $reject: async () => {},
      };
      const request = Request.from(raw, base);

      expect(request.$id).toBe('req_001');
      expect(request.$adapter).toBe('onebot11');
      expect(request.$bot).toBe('bot1');
      expect(request.$type).toBe('friend_add');
      expect(request.$channel.type).toBe('private');
      expect(request.$sender).toEqual({ id: '200', name: '请求者' });
      expect(request.$comment).toBe('请加我好友');
      expect(request.$timestamp).toBe(1000);
      // 原始字段保留
      expect(request.flag).toBe('abc123');
      expect(request.extra_data).toBe(42);
    });

    it('$comment 和 $subType 应可以为 undefined', () => {
      const request = Request.from({}, {
        $id: 'req_002',
        $adapter: 'icqq' as any,
        $bot: 'bot1',
        $type: 'group_add',
        $channel: { id: '300', type: 'group' },
        $sender: { id: '400', name: '申请者' },
        $timestamp: 2000,
        $approve: async () => {},
        $reject: async () => {},
      });

      expect(request.$comment).toBeUndefined();
      expect(request.$subType).toBeUndefined();
    });
  });

  // ============================================================================
  // $approve / $reject
  // ============================================================================
  describe('$approve() 和 $reject()', () => {
    it('调用 $approve 应执行同意逻辑', async () => {
      let approved = false;
      let approveRemark: string | undefined;
      const request = Request.from({}, {
        $id: 'req_approve',
        $adapter: 'onebot11' as any,
        $bot: 'bot1',
        $type: 'friend_add',
        $channel: { id: '100', type: 'private' },
        $sender: { id: '200', name: '用户' },
        $timestamp: 0,
        $approve: async (remark?: string) => {
          approved = true;
          approveRemark = remark;
        },
        $reject: async () => {},
      });

      await request.$approve('备注名');
      expect(approved).toBe(true);
      expect(approveRemark).toBe('备注名');
    });

    it('调用 $reject 应执行拒绝逻辑', async () => {
      let rejected = false;
      let rejectReason: string | undefined;
      const request = Request.from({}, {
        $id: 'req_reject',
        $adapter: 'onebot11' as any,
        $bot: 'bot1',
        $type: 'group_invite',
        $channel: { id: '300', type: 'group' },
        $sender: { id: '400', name: '邀请者' },
        $timestamp: 0,
        $approve: async () => {},
        $reject: async (reason?: string) => {
          rejected = true;
          rejectReason = reason;
        },
      });

      await request.$reject('不接受邀请');
      expect(rejected).toBe(true);
      expect(rejectReason).toBe('不接受邀请');
    });

    it('$approve 无参数调用应不报错', async () => {
      let called = false;
      const request = Request.from({}, {
        $id: 'req_noarg',
        $adapter: 'onebot11' as any,
        $bot: 'bot1',
        $type: 'friend_add',
        $channel: { id: '1', type: 'private' },
        $sender: { id: '2', name: 'user' },
        $timestamp: 0,
        $approve: async () => { called = true; },
        $reject: async () => {},
      });

      await request.$approve();
      expect(called).toBe(true);
    });
  });

  // ============================================================================
  // RequestType
  // ============================================================================
  describe('RequestType', () => {
    it('应接受所有预定义类型', () => {
      const types: RequestType[] = ['friend_add', 'group_add', 'group_invite'];
      expect(types).toHaveLength(3);
    });

    it('应接受自定义扩展类型', () => {
      const customType: RequestType = 'custom_request_type';
      expect(customType).toBe('custom_request_type');
    });
  });

  // ============================================================================
  // 典型场景
  // ============================================================================
  describe('典型场景', () => {
    it('好友添加请求', async () => {
      let approvedFlag: string | undefined;
      const raw = { flag: 'friend_flag_001', user_id: 12345 };
      const request = Request.from(raw, {
        $id: 'friend_flag_001',
        $adapter: 'onebot11' as any,
        $bot: 'mybot',
        $type: 'friend_add',
        $subType: 'add',
        $channel: { id: '12345', type: 'private' },
        $sender: { id: '12345', name: '新朋友' },
        $comment: '你好，加个好友吧',
        $timestamp: Date.now(),
        $approve: async (remark?: string) => {
          approvedFlag = raw.flag;
        },
        $reject: async () => {},
      });

      expect(request.$type).toBe('friend_add');
      expect(request.$comment).toBe('你好，加个好友吧');
      expect(request.flag).toBe('friend_flag_001');
      expect(request.user_id).toBe(12345);

      await request.$approve();
      expect(approvedFlag).toBe('friend_flag_001');
    });

    it('入群申请', async () => {
      let rejected = false;
      const raw = { flag: 'group_flag_001', user_id: 111, group_id: 222, comment: '想加群' };
      const request = Request.from(raw, {
        $id: 'group_flag_001',
        $adapter: 'icqq' as any,
        $bot: 'bot2',
        $type: 'group_add',
        $subType: 'add',
        $channel: { id: '222', type: 'group' },
        $sender: { id: '111', name: '申请者' },
        $comment: '想加群',
        $timestamp: Date.now(),
        $approve: async () => {},
        $reject: async (reason?: string) => { rejected = true; },
      });

      expect(request.$type).toBe('group_add');
      expect(request.group_id).toBe(222);
      
      await request.$reject('暂不接受');
      expect(rejected).toBe(true);
    });

    it('群邀请', async () => {
      let approved = false;
      const raw = { flag: 'invite_001', user_id: 333, group_id: 444, group_name: '测试群' };
      const request = Request.from(raw, {
        $id: 'invite_001',
        $adapter: 'onebot11' as any,
        $bot: 'bot1',
        $type: 'group_invite',
        $subType: 'invite',
        $channel: { id: '444', type: 'group' },
        $sender: { id: '333', name: '邀请者' },
        $timestamp: Date.now(),
        $approve: async () => { approved = true; },
        $reject: async () => {},
      });

      expect(request.$type).toBe('group_invite');
      expect(request.group_name).toBe('测试群');

      await request.$approve();
      expect(approved).toBe(true);
    });
  });
});
