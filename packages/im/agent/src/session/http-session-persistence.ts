/**
 * JSON file persistence for HTTP agent sessions (ADR 0040 P3).
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentStreamEvent } from '@zhin.js/ai/agent-stream';
import type { AgentStepCheckpoint } from '@zhin.js/ai/agent-step-checkpoint';
import type { HttpAgentSessionStatus } from './http-agent-session-store.js';

export interface PersistedHttpSessionSnapshot {
  sessionId: string;
  continuationToken: string;
  status: HttpAgentSessionStatus;
  events: AgentStreamEvent[];
  steps: AgentStepCheckpoint[];
  parked: boolean;
  pendingRequestIds: string[];
  turnRunning: boolean;
  updatedAt: number;
}

export interface HttpSessionPersistence {
  save(snapshot: PersistedHttpSessionSnapshot): Promise<void>;
  load(sessionId: string): Promise<PersistedHttpSessionSnapshot | null>;
  listSessionIds(): Promise<string[]>;
}

export class FileHttpSessionPersistence implements HttpSessionPersistence {
  constructor(private readonly dataDir: string) {}

  private sessionPath(sessionId: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.dataDir, `${safe}.json`);
  }

  async save(snapshot: PersistedHttpSessionSnapshot): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const payload = {
      ...snapshot,
      turnRunning: false,
      updatedAt: Date.now(),
    };
    await writeFile(this.sessionPath(snapshot.sessionId), `${JSON.stringify(payload)}\n`, 'utf8');
  }

  async load(sessionId: string): Promise<PersistedHttpSessionSnapshot | null> {
    try {
      const raw = await readFile(this.sessionPath(sessionId), 'utf8');
      const parsed = JSON.parse(raw) as PersistedHttpSessionSnapshot;
      if (!parsed?.sessionId) return null;
      return { ...parsed, turnRunning: false };
    } catch {
      return null;
    }
  }

  async listSessionIds(): Promise<string[]> {
    try {
      const names = await readdir(this.dataDir);
      const ids: string[] = [];
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        try {
          const raw = await readFile(join(this.dataDir, name), 'utf8');
          const parsed = JSON.parse(raw) as PersistedHttpSessionSnapshot;
          if (parsed?.sessionId) ids.push(parsed.sessionId);
        } catch {
          /* skip corrupt */
        }
      }
      return ids;
    } catch {
      return [];
    }
  }
}
