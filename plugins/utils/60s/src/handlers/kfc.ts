import type { SixtySClient } from '../client.js';

export default async function (client: SixtySClient) {
  const data = await client.fetch('/kfc');
  return `🍗 疯狂星期四\n\n${data.kfc || data.content || data.text || (typeof data === 'string' ? data : '')}`;
}
