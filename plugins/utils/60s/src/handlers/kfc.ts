import { fetchApi } from '../api.js';

export default async function () {
  const data = await fetchApi('/kfc');
  return `🍗 疯狂星期四\n\n${data.kfc || data.content || data.text || (typeof data === 'string' ? data : '')}`;
}
