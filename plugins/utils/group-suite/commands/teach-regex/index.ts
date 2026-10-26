import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { resolveGroupSuiteConfig, type GroupSuiteConfig } from '../../src/config.js';
import { teachAdd } from '../../src/teach-lib.js';
import { resolveGroupSuiteRuntime } from '../../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  permit: ['group()', 'role(owner,admin,master,trusted)'],
  description: '教我正则问答', descriptionI18n: { en: "Teach a regular-expression question and answer pair" },
  execute({ config, input, args, owner, use, locale }) {
    return teachAdd({ ...input, locale }, resolveGroupSuiteConfig(config), args.join(' '), true, resolveGroupSuiteRuntime({ owner, use }));
  },
});
