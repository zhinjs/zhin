import type { PluginSetupContext } from '@zhin.js/plugin-runtime';
import { defineSchedule } from '../../src/index.js';

declare const setup: PluginSetupContext<{ interval: number }>;
setup.addSchedule('typed', defineSchedule<{ interval: number }>({
  cron: '* * * * * *',
  execute(ctx) { const interval: number = ctx.config.interval; void interval; },
}));
// @ts-expect-error A schedule registered during setup must use that plugin's config.
setup.addSchedule('unrelated', defineSchedule<{ different: string }>({
  cron: '* * * * * *', execute() {},
}));
