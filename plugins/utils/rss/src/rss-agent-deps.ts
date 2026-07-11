export interface RssAgentDeps {
  getSubs: () => { select: () => Promise<unknown[]> } | null;
  fetchFeed: (url: string) => Promise<{ title: string; items: Array<{ title: string; link: string }> }>;
}

let deps: RssAgentDeps | null = null;

export function setRssAgentDeps(next: RssAgentDeps): void {
  deps = next;
}

export function getRssAgentDeps(): RssAgentDeps {
  if (!deps) throw new Error('rss agent deps not initialized');
  return deps;
}
