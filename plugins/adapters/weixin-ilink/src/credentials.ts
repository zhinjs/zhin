import fs from 'node:fs';
import path from 'node:path';

export interface WeixinIlinkCredentials {
  botToken: string;
  ilinkUserId?: string;
  ilinkBotId?: string;
  baseUrl?: string;
  updatedAt?: string;
}

/** Endpoint-owned persistence for credentials, cursors, context tokens, and media. */
export class WeixinIlinkStateStore {
  readonly endpointId: string;
  readonly rootDir: string;

  constructor(
    endpointId: string,
    rootDir: string,
  ) {
    if (!/^[A-Za-z0-9_.-]+$/u.test(endpointId)) {
      throw new TypeError('Weixin iLink state endpoint id is invalid');
    }
    if (!rootDir.trim()) throw new TypeError('Weixin iLink state root is required');
    this.endpointId = endpointId;
    this.rootDir = rootDir;
  }

  endpointDirectory(): string {
    return path.join(this.rootDir, this.endpointId);
  }

  credentialsPath(): string {
    return path.join(this.endpointDirectory(), 'credentials.json');
  }

  loadCredentials(): WeixinIlinkCredentials | null {
    const file = this.credentialsPath();
    try {
      if (!fs.existsSync(file)) return null;
      const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as WeixinIlinkCredentials;
      return data.botToken?.trim() ? data : null;
    } catch {
      return null;
    }
  }

  saveCredentials(credentials: WeixinIlinkCredentials): void {
    const file = this.credentialsPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ ...credentials, updatedAt: new Date().toISOString() }, null, 2),
      'utf-8',
    );
  }

  syncBufPath(): string {
    return path.join(this.endpointDirectory(), 'sync-buf');
  }

  loadSyncBuf(): string {
    const file = this.syncBufPath();
    try {
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
    } catch {
      return '';
    }
  }

  saveSyncBuf(value: string): void {
    const file = this.syncBufPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value, 'utf-8');
  }

  contextTokensPath(): string {
    return path.join(this.endpointDirectory(), 'context-tokens.json');
  }

  mediaDirectory(subdir: string): string {
    if (subdir !== 'inbound' && subdir !== 'outbound') {
      throw new TypeError(`Unsupported Weixin iLink media directory: ${subdir}`);
    }
    return path.join(this.endpointDirectory(), 'media', subdir);
  }
}
