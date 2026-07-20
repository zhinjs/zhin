const keywords = new Map<string, string>();

export function addKeyword(keyword: string, reply: string, store = keywords): void {
  store.set(keyword, reply);
}

export function removeKeyword(keyword: string, store = keywords): boolean {
  return store.delete(keyword);
}

export function listKeywords(store = keywords): Array<[string, string]> {
  return Array.from(store.entries());
}

export function matchKeyword(text: string, store = keywords): string | null {
  for (const [keyword, reply] of store) {
    if (text.includes(keyword)) return reply;
  }
  return null;
}

export function resetKeywords(): void {
  keywords.clear();
}
