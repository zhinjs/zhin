/**
 * Safe arithmetic expression evaluator (no eval / Function).
 * Supports + - * / % and parentheses; numbers are finite floats.
 */

export class ExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExprError';
  }
}

export function evaluateArithmetic(source: string): number {
  const input = source.trim();
  if (!input) throw new ExprError('empty expression');
  if (input.length > 200) throw new ExprError('expression too long');

  let index = 0;

  const peek = (): string => input[index] ?? '';
  const consume = (): string => input[index++] ?? '';

  const skipSpaces = (): void => {
    while (peek() === ' ' || peek() === '\t') index += 1;
  };

  const parseNumber = (): number => {
    skipSpaces();
    const start = index;
    if (peek() === '+' || peek() === '-') {
      // unary handled in parseFactor
    }
    while ((peek() >= '0' && peek() <= '9') || peek() === '.') {
      consume();
    }
    if (start === index) throw new ExprError(`expected number at ${index}`);
    const raw = input.slice(start, index);
    if (!/^\d+(\.\d+)?$/u.test(raw)) throw new ExprError(`invalid number: ${raw}`);
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new ExprError(`invalid number: ${raw}`);
    return value;
  };

  const parseFactor = (): number => {
    skipSpaces();
    const sign = peek();
    if (sign === '+' || sign === '-') {
      consume();
      const value = parseFactor();
      return sign === '-' ? -value : value;
    }
    if (peek() === '(') {
      consume();
      const value = parseExpr();
      skipSpaces();
      if (peek() !== ')') throw new ExprError('missing )');
      consume();
      return value;
    }
    return parseNumber();
  };

  const parseTerm = (): number => {
    let left = parseFactor();
    for (;;) {
      skipSpaces();
      const op = peek();
      if (op !== '*' && op !== '/' && op !== '%') break;
      consume();
      const right = parseFactor();
      if (op === '*') left *= right;
      else if (op === '/') {
        if (right === 0) throw new ExprError('division by zero');
        left /= right;
      } else {
        if (right === 0) throw new ExprError('modulo by zero');
        left %= right;
      }
      if (!Number.isFinite(left)) throw new ExprError('overflow');
    }
    return left;
  };

  const parseExpr = (): number => {
    let left = parseTerm();
    for (;;) {
      skipSpaces();
      const op = peek();
      if (op !== '+' && op !== '-') break;
      consume();
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
      if (!Number.isFinite(left)) throw new ExprError('overflow');
    }
    return left;
  };

  const value = parseExpr();
  skipSpaces();
  if (index < input.length) {
    throw new ExprError(`unexpected trailing input: ${input.slice(index)}`);
  }
  return value;
}

export function formatArithmeticResult(expression: string): string {
  try {
    const value = evaluateArithmetic(expression);
    return `${expression.trim()} = ${value}`;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `calc failed: ${detail}`;
  }
}
