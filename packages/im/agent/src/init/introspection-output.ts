/**
 * 内省指令输出：超长按行拆条
 */

const DEFAULT_MAX_CHARS = 3500;

export function splitIntrospectionText(text: string, maxChars = DEFAULT_MAX_CHARS): string[] {
  if (text.length <= maxChars) return [text];

  const lines = text.split('\n');
  const chunks: string[] = [];
  let current = '';

  const pushChunk = () => {
    if (current.trim()) chunks.push(current.trimEnd());
    current = '';
  };

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxChars && current) {
      pushChunk();
      if (line.length > maxChars) {
        let i = 0;
        while (i < line.length) {
          chunks.push(line.slice(i, i + maxChars));
          i += maxChars;
        }
      } else {
        current = line;
      }
    } else if (candidate.length > maxChars) {
      let i = 0;
      while (i < line.length) {
        chunks.push(line.slice(i, i + maxChars));
        i += maxChars;
      }
    } else {
      current = candidate;
    }
  }
  pushChunk();

  if (chunks.length <= 1) return chunks.length ? chunks : [text];

  const total = chunks.length;
  return chunks.map((chunk, idx) => `(${idx + 1}/${total})\n${chunk}`);
}

export function buildIntrospectionReply(formatted: string): string | string[] {
  const parts = splitIntrospectionText(formatted);
  return parts.length === 1 ? parts[0]! : parts;
}
