import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

/**
 * In a Markdown table an unescaped `|` ends the cell even inside a code span, so
 * `` `<adapter> endpoint add|remove` `` leaves `<adapter>` as raw HTML and the VitePress
 * build fails ("Element is missing end tag"). Code spans in table rows must write `\|`.
 */
function brokenTableCodeSpans(text: string): number[] {
  const lines: number[] = [];
  let fenced = false;
  text.split('\n').forEach((line, index) => {
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced;
      return;
    }
    if (fenced || !line.trimStart().startsWith('|')) return;
    for (const match of line.replace(/\\\|/gu, '\u0000').matchAll(/`([^`]*)`/gu)) {
      if (match[1]!.includes('|')) lines.push(index + 1);
    }
  });
  return lines;
}

describe('Markdown tables', () => {
  it('escape | inside code spans so the docs site builds', () => {
    const files = execFileSync('git', ['ls-files', '*.md'], { cwd: root, encoding: 'utf8' })
      .split('\n').filter((file) => file.startsWith('docs/') || /^plugins\/.*README\.md$/u.test(file));
    const broken = files.flatMap((file) => brokenTableCodeSpans(readFileSync(`${root}/${file}`, 'utf8')).map((line) => `${file}:${line}`));
    expect(broken).toEqual([]);
  });

  it('detects an unescaped pipe in a table code span', () => {
    expect(brokenTableCodeSpans('| a | `x add|remove` |')).toEqual([1]);
    expect(brokenTableCodeSpans('| a | `x add\\|remove` |')).toEqual([]);
    expect(brokenTableCodeSpans('```\n| `a|b` |\n```')).toEqual([]);
  });
});
