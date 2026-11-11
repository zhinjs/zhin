import { it, expect } from 'vitest';
import { loadHostHttpConfig } from '/home/user/zhin/basic/cli/src/utils/host-http.js';
it('missing env', async () => {
  expect(JSON.stringify(await loadHostHttpConfig(process.env.HH_DIR!).catch((e) => ({ err: String(e) })))).toBe('x');
});
