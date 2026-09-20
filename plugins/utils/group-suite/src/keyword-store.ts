export function addKeyword(keyword: string, reply: string, store: Map<string, string>): void {
  store.set(keyword, reply);
}

export function removeKeyword(keyword: string, store: Map<string, string>): boolean {
  return store.delete(keyword);
}

export function listKeywords(store: Map<string, string>): Array<[string, string]> {
  return Array.from(store.entries());
}

export function matchKeyword(text: string, store: Map<string, string>): string | null {
  for (const [keyword, reply] of store) {
    if (text.includes(keyword)) return reply;
  }
  return null;
}
