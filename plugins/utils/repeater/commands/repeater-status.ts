import { defineCommand } from '@zhin.js/command';
import {
  getRepeaterEngine,
  resolveRepeaterConfig,
  type RepeaterConfig,
} from '../src/engine.js';

export default defineCommand<RepeaterConfig>({
  description: '查看复读机的运行状态',
  execute({ config }) {
    return getRepeaterEngine().statusLines(resolveRepeaterConfig(config));
  },
});
