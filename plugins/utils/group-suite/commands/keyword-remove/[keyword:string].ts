import { defineCommand } from '@zhin.js/command';
import { removeKeyword } from '../../src/keyword-store.js';
import type { GroupSuiteConfig } from '../../src/config.js';
import { resolveGroupSuiteRuntime } from '../../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig>({
  description: '删除关键词自动回复',
  execute({ params, owner, use }) {
    const keyword = String(params.keyword ?? '');
    if (!keyword) return '请提供要删除的关键词';
    if (!removeKeyword(keyword, resolveGroupSuiteRuntime({ owner, use })?.keywords)) return `关键词「${keyword}」不存在`;
    return `已删除关键词「${keyword}」`;
  },
});
