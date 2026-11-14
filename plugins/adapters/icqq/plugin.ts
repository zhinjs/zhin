import { definePlugin } from 'zhin.js';
import { registerSensitiveExecCommand } from '@zhin.js/agent';
import { createIcqqConsoleRpc } from './src/console.js';
import { icqqSensitiveExecRule } from './src/sensitive-commands.js';

export default definePlugin({
  name: 'icqq',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  setup(context) {
    const disposeExecRule = registerSensitiveExecCommand(icqqSensitiveExecRule);
    return {
      consoleRpc: createIcqqConsoleRpc(() => context.config.get()),
      dispose: () => {
        disposeExecRule();
      },
    };
  },
});
