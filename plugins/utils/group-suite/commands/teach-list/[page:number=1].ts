import { defineCommand } from '@zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { resolveGroupSuiteConfig, type GroupSuiteConfig } from '../../src/config.js';
import { teachList } from '../../src/teach-lib.js';
import { resolveGroupSuiteRuntime } from '../../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  description: '查看问答列表',
  execute({ config, input, params, owner, use }) {
    const page = Number(params.page ?? 1);
    return teachList(input ?? {}, resolveGroupSuiteConfig(config), page, resolveGroupSuiteRuntime({ owner, use }));
  },
});
