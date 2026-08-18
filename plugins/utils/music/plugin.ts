import { definePlugin, databaseHostToken } from '@zhin.js/plugin-runtime';
import { cleanExpired } from './src/session.js';
import { cleanExpiredLogins } from './src/login/index.js';
import {
  MUSIC_CREDENTIALS_TABLE,
  provideCredentialDb,
} from './src/credential-store.js';

function defineCredentialTable(
  db: { define: (name: string, schema: Record<string, unknown>) => void },
): void {
  db.define(MUSIC_CREDENTIALS_TABLE, {
    source: { type: 'text', nullable: false },
    key: { type: 'text', nullable: false },
    value: { type: 'text', nullable: false },
    updated_at: { type: 'text', default: '' },
  });
}

export default definePlugin({
  name: 'music',
  metadata: {
    displayName: 'Music',
  },
  setup(context) {
    if (context.resources.has(databaseHostToken)) {
      const host = context.resources.use(databaseHostToken);
      defineCredentialTable(host);
      provideCredentialDb(context, host);
    }

    const timer = setInterval(() => {
      cleanExpired();
      cleanExpiredLogins();
    }, 60_000);
    return () => clearInterval(timer);
  },
});
