import { fetchApi } from '../api.js';

export default async function () {
  const data = await fetchApi<any>('/duanzi');
  return `😂 段子\n\n${data.duanzi || data.content || data.text || (typeof data === 'string' ? data : '')}`;
}
