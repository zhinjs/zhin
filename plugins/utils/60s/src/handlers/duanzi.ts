import type { SixtySClient } from '../client.js';

export default async function (client: SixtySClient) {
  const data = await client.fetch('/duanzi');
  return `😂 段子\n\n${data.duanzi || data.content || data.text || (typeof data === 'string' ? data : '')}`;
}
