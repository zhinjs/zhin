/**
 * 引号归一化 + 模糊匹配（参考 Claude Code FileEditTool/utils.ts），供 edit_file 使用。
 */

/** 将弯引号归一化为直引号 */
export function normalizeQuotes(str: string): string {
  return str
    .replace(/\u2018/g, "'") // '
    .replace(/\u2019/g, "'") // '
    .replace(/\u201C/g, '"') // "
    .replace(/\u201D/g, '"'); // "
}

export interface FuzzyMatchResult {
  /** 文件中实际匹配到的字符串 */
  actual: string;
  /** 匹配次数 */
  count: number;
  /** 是否通过引号归一化匹配 */
  wasNormalized: boolean;
}

/**
 * 在文件内容中查找字符串，支持精确匹配和引号归一化模糊匹配。
 * 参考 Claude Code `findActualString`。
 */
export function findActualStringInFile(fileContent: string, searchString: string): FuzzyMatchResult | null {
  const exactCount = fileContent.split(searchString).length - 1;
  if (exactCount > 0) {
    return { actual: searchString, count: exactCount, wasNormalized: false };
  }

  const normalizedSearch = normalizeQuotes(searchString);
  const normalizedFile = normalizeQuotes(fileContent);
  const idx = normalizedFile.indexOf(normalizedSearch);
  if (idx !== -1) {
    const actual = fileContent.substring(idx, idx + searchString.length);
    const normalizedCount = normalizedFile.split(normalizedSearch).length - 1;
    return { actual, count: normalizedCount, wasNormalized: true };
  }

  return null;
}

/**
 * 将 new_string 中的直引号替换为文件中原始的弯引号风格。
 * 参考 Claude Code `preserveQuoteStyle`。
 */
export function preserveQuoteStyleInEdit(oldString: string, actualOldString: string, newString: string): string {
  if (oldString === actualOldString) return newString;

  const hasDouble = actualOldString.includes('\u201C') || actualOldString.includes('\u201D');
  const hasSingle = actualOldString.includes('\u2018') || actualOldString.includes('\u2019');
  if (!hasDouble && !hasSingle) return newString;

  let result = newString;
  if (hasDouble) {
    const chars = [...result];
    const out: string[] = [];
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === '"') {
        const prev = i > 0 ? chars[i - 1] : ' ';
        const isOpening = /[\s(\[{]/.test(prev) || i === 0;
        out.push(isOpening ? '\u201C' : '\u201D');
      } else {
        out.push(chars[i]);
      }
    }
    result = out.join('');
  }
  if (hasSingle) {
    const chars = [...result];
    const out: string[] = [];
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === "'") {
        const prev = i > 0 ? chars[i - 1] : ' ';
        const next = i < chars.length - 1 ? chars[i + 1] : ' ';
        if (/\p{L}/u.test(prev) && /\p{L}/u.test(next)) {
          out.push('\u2019');
        } else {
          const isOpening = /[\s(\[{]/.test(prev) || i === 0;
          out.push(isOpening ? '\u2018' : '\u2019');
        }
      } else {
        out.push(chars[i]);
      }
    }
    result = out.join('');
  }
  return result;
}
