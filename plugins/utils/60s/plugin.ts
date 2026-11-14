import { definePlugin } from 'zhin.js';
import { SixtySClient, sixtySClientStore } from './src/client.js';

export interface SixtySConfig {
  readonly apiBase?: string;
}

export default definePlugin<SixtySConfig>({
  name: 'sixty-s',
  setup(context) {
    sixtySClientStore.provide(
      context,
      new SixtySClient(() => context.config.get().apiBase),
    );
  },
});
