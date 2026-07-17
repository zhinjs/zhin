import { MessageCommand } from 'zhin.js';

export const legacyHello = new MessageCommand('hello <name:text>')
  .action((_message, result) => `hello ${result.params.name}`);
