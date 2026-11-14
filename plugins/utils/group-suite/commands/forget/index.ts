import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import type { GroupSuiteConfig } from '../../src/config.js';
import { teachForget } from '../../src/teach-lib.js';
import { resolveGroupSuiteRuntime } from '../../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  permit: ['group()', 'trusted'],
  description: '忘记问答（删除 teach 学会的问答对；关键词回复用 keyword-remove）', descriptionI18n: { en: "Delete a pair learned with teach (use keyword-remove for keyword replies)" },
  execute({ input, args, owner, use, locale }) {
    return teachForget({ ...input, locale }, args.join(' '), resolveGroupSuiteRuntime({ owner, use }));
  },
});
