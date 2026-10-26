import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import type { GroupSuiteConfig } from '../../src/config.js';
import { teachForget } from '../../src/teach-lib.js';
import { resolveGroupSuiteRuntime } from '../../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  permit: ['group()', 'role(owner,admin,master,trusted)'],
  description: '忘记问答（删除问答对）', descriptionI18n: { en: "Delete a learned question and answer pair" },
  execute({ input, args, owner, use, locale }) {
    return teachForget({ ...input, locale }, args.join(' '), resolveGroupSuiteRuntime({ owner, use }));
  },
});
