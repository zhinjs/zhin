import type { Database, Models, RelatedModel } from '@zhin.js/core';
import { evaluateAchievements, type AchievementContext } from './achievements.js';
import type { AdvModelName, AdvProfileRow } from './models.js';
import { parseStringSet, serializeStringSet } from './profile-parse.js';
import { playableSceneIds } from './story-catalog.js';
import type { AdvDatabase } from './session-service.js';

const PLAYABLE = new Set(playableSceneIds());

type AdvModel<K extends AdvModelName> = RelatedModel<unknown, Models, K>;

function getModel<K extends AdvModelName>(db: AdvDatabase, name: K): AdvModel<K> {
  const model = db.models.get(name);
  if (!model) throw new Error(`Model ${name} is not registered`);
  return model as AdvModel<K>;
}

export class ProfileService {
  constructor(private readonly db: AdvDatabase) {}

  async get(playerId: string): Promise<AdvProfileRow | null> {
    return getModel(this.db, 'adv_profiles').findOne({ player_id: playerId });
  }

  async getOrCreate(playerId: string, playerName: string): Promise<AdvProfileRow> {
    const existing = await this.get(playerId);
    if (existing) {
      if (playerName && existing.player_name !== playerName) {
        await this.patch(playerId, { player_name: playerName });
        return (await this.get(playerId))!;
      }
      return existing;
    }
    const now = Date.now();
    const row: AdvProfileRow = {
      player_id: playerId,
      player_name: playerName || playerId,
      visited_scenes: '[]',
      endings_seen: '[]',
      items_found: '[]',
      achievements: '[]',
      runs_started: 0,
      runs_completed: 0,
      total_steps: 0,
      best_step_count: 0,
      updated_at: now,
      created_at: now,
    };
    await getModel(this.db, 'adv_profiles').create(row);
    return row;
  }

  async patch(playerId: string, patch: Partial<AdvProfileRow>): Promise<void> {
    await getModel(this.db, 'adv_profiles').updateWhere(
      { player_id: playerId },
      { ...patch, updated_at: Date.now() },
    );
  }

  async onRunStarted(playerId: string, playerName: string): Promise<AdvProfileRow> {
    const profile = await this.getOrCreate(playerId, playerName);
    await this.patch(playerId, { runs_started: profile.runs_started + 1 });
    return (await this.get(playerId))!;
  }

  /** 记录进入场景、步数、背包变化；返回新解锁成就 ID */
  async onStep(
    playerId: string,
    playerName: string,
    sceneId: string,
    inventory: string[],
  ): Promise<string[]> {
    const profile = await this.getOrCreate(playerId, playerName);
    const visited = parseStringSet(profile.visited_scenes);
    const items = parseStringSet(profile.items_found);
    let changed = false;
    if (PLAYABLE.has(sceneId) && !visited.has(sceneId)) {
      visited.add(sceneId);
      changed = true;
    }
    for (const item of inventory) {
      if (!items.has(item)) {
        items.add(item);
        changed = true;
      }
    }
    const patch: Partial<AdvProfileRow> = {
      total_steps: profile.total_steps + 1,
    };
    if (changed) {
      patch.visited_scenes = serializeStringSet(visited);
      patch.items_found = serializeStringSet(items);
    }
    await this.patch(playerId, patch);
    const updated = (await this.get(playerId))!;
    return this.unlockPending(updated);
  }

  /** 局终：记录结局、完成数、最佳步数 */
  async onRunCompleted(
    playerId: string,
    playerName: string,
    endingId: string,
    stepCount: number,
    inventory: string[],
  ): Promise<string[]> {
    const profile = await this.getOrCreate(playerId, playerName);
    const endings = parseStringSet(profile.endings_seen);
    const items = parseStringSet(profile.items_found);
    if (endingId) endings.add(endingId);
    for (const item of inventory) items.add(item);

    await this.patch(playerId, {
      endings_seen: serializeStringSet(endings),
      items_found: serializeStringSet(items),
      runs_completed: profile.runs_completed + 1,
      best_step_count: Math.max(profile.best_step_count, stepCount),
    });

    const updated = (await this.get(playerId))!;
    return this.unlockPending(updated, { stepCount, inventory, endingId });
  }

  private async unlockPending(
    profile: AdvProfileRow,
    lastRun?: AchievementContext['lastRun'],
  ): Promise<string[]> {
    const ctx: AchievementContext = {
      visited: parseStringSet(profile.visited_scenes),
      endings: parseStringSet(profile.endings_seen),
      itemsFound: parseStringSet(profile.items_found),
      runsCompleted: profile.runs_completed,
      bestStepCount: profile.best_step_count,
      lastRun,
    };
    const current = [...parseStringSet(profile.achievements)];
    const newly = evaluateAchievements(current, ctx);
    if (!newly.length) return [];

    const merged = new Set(current);
    for (const id of newly) merged.add(id);
    await this.patch(profile.player_id, {
      achievements: serializeStringSet(merged),
    });
    return newly;
  }
}

export function createProfileService(db: AdvDatabase): ProfileService {
  return new ProfileService(db);
}
