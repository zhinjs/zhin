/**
 * Notice 抽象层测试
 */
import { Notice, NoticeBase, NoticeType } from '../src/notice.js';

describe('Notice', () => {
  // ============================================================================
  // Notice.from()
  // ============================================================================
  describe('Notice.from()', () => {
    it('应合并原始数据与基础结构', () => {
      const raw = { original_field: 'test', group_id: 12345 };
      const base: NoticeBase = {
        $id: 'n_001',
        $adapter: 'onebot11' as any,
        $bot: 'bot1',
        $type: 'group_member_increase',
        $channel: { id: '12345', type: 'group' },
        $timestamp: 1000,
      };
      const notice = Notice.from(raw, base);

      expect(notice.$id).toBe('n_001');
      expect(notice.$adapter).toBe('onebot11');
      expect(notice.$bot).toBe('bot1');
      expect(notice.$type).toBe('group_member_increase');
      expect(notice.$channel.id).toBe('12345');
      expect(notice.$channel.type).toBe('group');
      expect(notice.$timestamp).toBe(1000);
      // 原始字段保留
      expect(notice.original_field).toBe('test');
      expect(notice.group_id).toBe(12345);
    });

    it('应保留可选字段 $operator 和 $target', () => {
      const raw = {};
      const base: NoticeBase = {
        $id: 'n_002',
        $adapter: 'icqq' as any,
        $bot: 'bot2',
        $type: 'group_member_decrease',
        $subType: 'kick',
        $channel: { id: '67890', type: 'group' },
        $operator: { id: '111', name: '管理员' },
        $target: { id: '222', name: '被踢者' },
        $timestamp: 2000,
      };
      const notice = Notice.from(raw, base);

      expect(notice.$subType).toBe('kick');
      expect(notice.$operator).toEqual({ id: '111', name: '管理员' });
      expect(notice.$target).toEqual({ id: '222', name: '被踢者' });
    });

    it('$operator 和 $target 应可以为 undefined', () => {
      const notice = Notice.from({}, {
        $id: 'n_003',
        $adapter: 'onebot11' as any,
        $bot: 'bot1',
        $type: 'friend_add',
        $channel: { id: '100', type: 'private' },
        $timestamp: 3000,
      });

      expect(notice.$operator).toBeUndefined();
      expect(notice.$target).toBeUndefined();
      expect(notice.$subType).toBeUndefined();
    });
  });

  // ============================================================================
  // NoticeType
  // ============================================================================
  describe('NoticeType', () => {
    it('应接受所有预定义类型', () => {
      const types: NoticeType[] = [
        'group_member_increase',
        'group_member_decrease',
        'group_admin_change',
        'group_ban',
        'group_recall',
        'friend_recall',
        'friend_add',
        'group_poke',
        'friend_poke',
        'group_transfer',
      ];
      expect(types).toHaveLength(10);
    });

    it('应接受自定义扩展类型', () => {
      const customType: NoticeType = 'custom_adapter_event';
      expect(customType).toBe('custom_adapter_event');
    });
  });

  // ============================================================================
  // NoticeChannel
  // ============================================================================
  describe('NoticeChannel', () => {
    it('应支持 group 类型', () => {
      const notice = Notice.from({}, {
        $id: '1',
        $adapter: 'onebot11' as any,
        $bot: 'b',
        $type: 'group_member_increase',
        $channel: { id: '123', type: 'group' },
        $timestamp: 0,
      });
      expect(notice.$channel.type).toBe('group');
    });

    it('应支持 private 类型', () => {
      const notice = Notice.from({}, {
        $id: '2',
        $adapter: 'onebot11' as any,
        $bot: 'b',
        $type: 'friend_add',
        $channel: { id: '456', type: 'private' },
        $timestamp: 0,
      });
      expect(notice.$channel.type).toBe('private');
    });

    it('应支持 channel 类型', () => {
      const notice = Notice.from({}, {
        $id: '3',
        $adapter: 'kook' as any,
        $bot: 'b',
        $type: 'group_member_increase',
        $channel: { id: '789', type: 'channel' },
        $timestamp: 0,
      });
      expect(notice.$channel.type).toBe('channel');
    });
  });

  // ============================================================================
  // 典型场景
  // ============================================================================
  describe('典型场景', () => {
    it('群成员入群通知', () => {
      const raw = { group_id: 12345, user_id: 67890, operator_id: 11111 };
      const notice = Notice.from(raw, {
        $id: 'inc_001',
        $adapter: 'onebot11' as any,
        $bot: 'mybot',
        $type: 'group_member_increase',
        $subType: 'approve',
        $channel: { id: '12345', type: 'group' },
        $operator: { id: '11111', name: '管理员' },
        $target: { id: '67890', name: '新成员' },
        $timestamp: Date.now(),
      });

      expect(notice.$type).toBe('group_member_increase');
      expect(notice.$subType).toBe('approve');
      expect(notice.group_id).toBe(12345);
      expect(notice.user_id).toBe(67890);
    });

    it('群消息撤回通知', () => {
      const raw = { group_id: 100, user_id: 200, operator_id: 300, message_id: 'msg_42' };
      const notice = Notice.from(raw, {
        $id: 'recall_001',
        $adapter: 'icqq' as any,
        $bot: 'bot1',
        $type: 'group_recall',
        $subType: 'recall',
        $channel: { id: '100', type: 'group' },
        $operator: { id: '300', name: '撤回者' },
        $target: { id: '200', name: '消息发送者' },
        $timestamp: Date.now(),
      });

      expect(notice.$type).toBe('group_recall');
      expect(notice.message_id).toBe('msg_42');
    });

    it('好友戳一戳通知', () => {
      const raw = { user_id: 100, operator_id: 100, target_id: 200, action: '戳了戳' };
      const notice = Notice.from(raw, {
        $id: 'poke_001',
        $adapter: 'icqq' as any,
        $bot: 'bot1',
        $type: 'friend_poke',
        $subType: 'poke',
        $channel: { id: '100', type: 'private' },
        $operator: { id: '100', name: '操作者' },
        $target: { id: '200', name: '被戳者' },
        $timestamp: Date.now(),
      });

      expect(notice.$type).toBe('friend_poke');
      expect(notice.action).toBe('戳了戳');
    });
  });
});
