/**
 * Core service tokens — typed Token 替代 legacy string-based inject('x')。
 *
 * Slice 2：Token 指向当前 Feature 实例（双写窗口）。
 * Slice 4：Feature 删除后，Token 类型改为 Runtime projection 接口。
 */

import { createToken } from '@zhin.js/plugin-runtime';
import type { CommandFeature } from '../../built/command.js';
import type { ComponentFeature } from '../../built/component.js';
import type { ScheduleFeature } from '../../built/schedule.js';
import type { ConfigFeature } from '../../built/config.js';
import type { SchemaFeature } from '../../built/schema-feature.js';
import type { MessageDispatcherService } from '../../built/dispatcher.js';

export const commandServiceToken = createToken<CommandFeature>(
  'zhin.im.command-service',
);

export const componentServiceToken = createToken<ComponentFeature>(
  'zhin.im.component-service',
);

export const schedulerServiceToken = createToken<ScheduleFeature>(
  'zhin.im.scheduler-service',
);

export const configServiceToken = createToken<ConfigFeature>(
  'zhin.im.config-service',
);

export const schemaServiceToken = createToken<SchemaFeature>(
  'zhin.im.schema-service',
);

export const dispatcherServiceToken = createToken<MessageDispatcherService>(
  'zhin.im.dispatcher-service',
);
