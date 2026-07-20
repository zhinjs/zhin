import { definePlugin } from '@zhin.js/plugin-runtime';

export interface SixtySConfig {
  readonly apiBase?: string;
}

const DEFAULT_API_BASE = 'https://60s.viki.moe';

export default definePlugin<SixtySConfig>({
  name: 'sixty-s',
  metadata: {
    displayName: '60s API',
  },
  setup(context) {
    const apiBase = context.config.get().apiBase?.trim() || DEFAULT_API_BASE;
    process.env.ZHIN_60S_API = apiBase;
  },
});
