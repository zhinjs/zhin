import { definePlugin, databaseHostToken } from 'zhin.js';
import { MusicSearchSessions } from './src/session.js';
import { QrLoginRuntime } from './src/login/index.js';
import {
  CredentialStore,
  createInMemoryCredentialDb,
  MUSIC_CREDENTIALS_TABLE,
} from './src/credential-store.js';
import { createMusicServices } from './src/sources/index.js';
import { musicRuntimeToken } from './src/runtime.js';

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
    const db = context.resources.has(databaseHostToken) ? (() => {
      const host = context.resources.use(databaseHostToken);
      defineCredentialTable(host);
      return host;
    })() : createInMemoryCredentialDb();
    const credentials = new CredentialStore(db);
    const runtime = Object.freeze({
      credentials,
      services: Object.freeze(createMusicServices(credentials)),
      sessions: new MusicSearchSessions(),
      logins: new QrLoginRuntime(credentials),
    });
    context.resources.provide(musicRuntimeToken, runtime);

    const timer = setInterval(() => {
      runtime.sessions.pruneExpired();
      runtime.logins.pruneExpired();
    }, 60_000);
    return () => {
      clearInterval(timer);
      runtime.sessions.dispose();
      runtime.logins.dispose();
    };
  },
});
