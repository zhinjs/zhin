// A local RSS 2.0 feed whose items the scenario controls; the RSS plugin fetches it over real HTTP.
import { createServer } from 'node:http';

function escapeXml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function renderFeed(title, items) {
  const renderedItems = items.map(item => [
    '<item>',
    `<title>${escapeXml(item.title)}</title>`,
    `<link>https://example.test/${escapeXml(item.guid)}</link>`,
    `<guid>${escapeXml(item.guid)}</guid>`,
    '</item>',
  ].join(''));
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${escapeXml(title)}</title>${renderedItems.join('')}</channel></rss>`;
}

export async function startLocalFeedServer() {
  /** @type {Map<string, { title: string, items: { guid: string, title: string }[] }>} */
  const feeds = new Map();
  let requestCount = 0;
  const server = createServer((request, response) => {
    requestCount += 1;
    const feed = feeds.get(request.url ?? '');
    if (!feed) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' });
    response.end(renderFeed(feed.title, feed.items));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: path => `http://127.0.0.1:${port}${path}`,
    /** Newest item first, as feeds usually list them. */
    publish(path, title, items) {
      feeds.set(path, { title, items });
    },
    get requestCount() {
      return requestCount;
    },
    close: () => new Promise(resolve => server.close(resolve)),
  };
}
