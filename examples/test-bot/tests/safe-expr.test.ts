import { describe, expect, it } from 'vitest';
import { evaluateArithmetic, ExprError } from '../lib/safe-expr.js';

describe('evaluateArithmetic', () => {
  it('evaluates precedence and parentheses', () => {
    expect(evaluateArithmetic('2 + 3 * 4')).toBe(14);
    expect(evaluateArithmetic('(2 + 3) * 4')).toBe(20);
    expect(evaluateArithmetic('-3 + 5')).toBe(2);
    expect(evaluateArithmetic('10 % 3')).toBe(1);
  });

  it('rejects unsafe or invalid input', () => {
    expect(() => evaluateArithmetic('2; process.exit(1)')).toThrow(ExprError);
    expect(() => evaluateArithmetic('1 / 0')).toThrow(/zero/);
    expect(() => evaluateArithmetic('')).toThrow(ExprError);
  });
});
