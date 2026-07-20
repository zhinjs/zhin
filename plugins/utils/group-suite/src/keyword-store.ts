const keywords = new Map<string, string>();

export function addKeyword(keyword: string, reply: string): void {
  keywords.set(keyword, reply);
}

export function removeKeyword(keyword: string): boolean {
  return keywords.delete(keyword);
}

export function listKeywords(): Array<[string, string]> {
  return Array.from(keywords.entries());
}

export function matchKeyword(text: string): string | null {
  for (const [keyword, reply] of keywords) {
    if (text.includes(keyword)) return reply;
  }
  return null;
}

export function resetKeywords(): void {
  keywords.clear();
}
