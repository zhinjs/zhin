import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { rollDice } from '../lib/dice.js';

export default defineAgentTool<{ count?: number; faces?: number }>({
  description: 'Roll N dice with F faces (cryptographically weak; kitchen-sink utility)',
  approval: 'never',
  inputSchema: z.object({
    count: z.number().int().min(1).max(20).default(1),
    faces: z.number().int().min(2).max(1000).default(6),
  }),
  execute: (input) => {
    const count = input.count ?? 1;
    const faces = input.faces ?? 6;
    try {
      return rollDice(count, faces);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },
});
