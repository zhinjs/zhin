import { printHarnessError } from './harness-error-output.mjs';

describe('harness error output', () => {
  it('keeps the final failure summary after verbose test output', () => {
    const lines: string[] = [];
    const output = `${'passing test\n'.repeat(10000)}Failed Tests 2\nexit code: 1`;
    printHarnessError(output, (line: string) => lines.push(line));
    expect(lines.join('\n')).toBe(output);
    expect(lines.slice(-2)).toEqual(['Failed Tests 2', 'exit code: 1']);
  });

  it('bounds individual writes without discarding long diagnostic lines', () => {
    const lines: string[] = [];
    const output = 'x'.repeat(10000);
    printHarnessError(output, (line: string) => lines.push(line));
    expect(lines.every(line => line.length <= 2000)).toBe(true);
    expect(lines.join('')).toBe(output);
  });

  it('preserves supplementary characters across separately encoded UTF-8 writes', () => {
    const lines: string[] = [];
    const output = `${'x'.repeat(1999)}😀${'y'.repeat(4500)}𠮷`;
    printHarnessError(output, (line: string) => lines.push(line));
    expect(lines.every(line => line.length <= 2000)).toBe(true);
    expect(Buffer.concat(lines.map(line => Buffer.from(line, 'utf8'))).toString('utf8'))
      .toBe(output);
  });
});
