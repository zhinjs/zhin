import { defineCommand } from '@zhin.js/command';
import { rollDice } from '../lib/dice.js';

export default defineCommand({
  description: '掷骰子：dice [count] [faces]',
  execute: ({ args }) => {
    const count = args[0] === undefined ? 1 : Number(args[0]);
    const faces = args[1] === undefined ? 6 : Number(args[1]);
    if (!Number.isFinite(count) || !Number.isFinite(faces)) {
      return '用法: dice [count] [faces]  例: dice 2 6';
    }
    try {
      return rollDice(count, faces);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },
});
