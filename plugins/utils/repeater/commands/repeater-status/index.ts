import { defineCommand } from 'zhin.js/command';
import {
  type RepeaterConfig,
} from '../../src/engine.js';
import { repeaterEngineToken } from '../../src/runtime.js';

export default defineCommand<RepeaterConfig>({
  description: '查看复读机的运行状态', descriptionI18n: { en: "View repeater status" },
  execute({ config, use, locale }) {
    return use(repeaterEngineToken).statusLines(config, locale);
  },
});
