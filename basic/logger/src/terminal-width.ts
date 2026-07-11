import stringWidth from 'string-width';

/** 终端显示宽度（CJK / emoji 等按 wcwidth；忽略 ANSI） */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

export function displayWidth(text: string): number {
  return stringWidth(text);
}

export function padDisplayEnd(text: string, targetWidth: number): string {
  const gap = targetWidth - displayWidth(text);
  return gap > 0 ? text + ' '.repeat(gap) : text;
}

export function padDisplayStart(text: string, targetWidth: number): string {
  const gap = targetWidth - displayWidth(text);
  return gap > 0 ? ' '.repeat(gap) + text : text;
}

/** 按显示宽度截断，超出时追加 …（按 Unicode 码点，不拆开 emoji） */
export function truncateDisplayEnd(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (displayWidth(text) <= maxWidth) return text;
  if (maxWidth <= 1) return '…';
  let result = '';
  for (const ch of stripAnsi(text)) {
    const candidate = result + ch;
    if (displayWidth(candidate) > maxWidth - 1) break;
    result = candidate;
  }
  return result + '…';
}

/** 按显示宽度换行（按 Unicode 码点，不拆开 emoji） */
export function wrapDisplayText(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0 || displayWidth(text) <= maxWidth) return [text];
  const lines: string[] = [];
  let current = '';
  for (const ch of text) {
    const candidate = current + ch;
    if (displayWidth(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = ch;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}
