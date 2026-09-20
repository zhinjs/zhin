import { defineCommand } from 'zhin.js/command';
import {
  resolveRepeaterConfig,
  type RepeaterConfig,
} from '../../src/engine.js';
import { repeaterEngineToken } from '../../src/runtime.js';

export default defineCommand<RepeaterConfig>({
  description: '查看复读机的运行状态',
  execute({ config, use }) {
    return use(repeaterEngineToken).statusLines(resolveRepeaterConfig(config));
  },
});
