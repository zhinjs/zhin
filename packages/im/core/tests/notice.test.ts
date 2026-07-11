/**
 * Notice 抽象层测试
 */
import { Notice, NoticeBase } from '../src/notice.js';
import { formatSideEventName } from '../src/side-event/base.js';

describe('Notice', () => {
  describe('Notice.from()', () => {
    it('应合并原始数据与基础结构', () => {
      const raw = { original_field: 'test', group_id: 12345 };
      const base: NoticeBase = {
        $id: 'n_001',
        $adapter: 'onebot11' as any,
        $endpoint: 'bot1',
        $type: 'notice',
        $scene_id: '12345',
        $scene_type: 'group',
        $sub_type: 'member_increase',
        $timestamp: 1000,
      };
      const notice = Notice.from(raw, base);

      expect(notice.$id).toBe('n_001');
      expect(formatSideEventName(notice)).toBe('notice.group.member_increase');
      expect(notice.original_field).toBe('test');
    });

    it('应保留可选字段 $actor 和 $target', () => {
      const base: NoticeBase = {
        $id: 'n_002',
        $adapter: 'icqq' as any,
        $endpoint: 'bot2',
        $type: 'notice',
        $scene_id: '67890',
        $scene_type: 'group',
        $sub_type: 'member_decrease',
        $actor: { id: '111', name: '管理员' },
        $target: { id: '222', name: '被踢者' },
        $timestamp: 2000,
      };
      const notice = Notice.from({}, base);

      expect(notice.$sub_type).toBe('member_decrease');
      expect(notice.$actor).toEqual({ id: '111', name: '管理员' });
      expect(notice.$target).toEqual({ id: '222', name: '被踢者' });
    });
  });
});
