import { definePlugin } from 'zhin.js';
import { SixtySClient, sixtySClientToken } from './src/client.js';

export interface SixtySConfig {
  readonly apiBase?: string;
}

export default definePlugin<SixtySConfig>({
  name: 'sixty-s',
  metadata: {
    displayName: '60s API',
  },
  setup(context) {
    context.resources.provide(
      sixtySClientToken,
      new SixtySClient(() => context.config.get().apiBase),
    );
  },
});
