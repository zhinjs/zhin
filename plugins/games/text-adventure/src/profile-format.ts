import { achievementById, ACHIEVEMENTS, totalAchievements } from './achievements.js';
import {
  endingIds,
  endingLabel,
  MAP_ZONES,
  playableSceneIds,
  regionLabel,
} from './story-catalog.js';
import type { AdvProfileRow } from './models.js';
import { parseStringSet } from './profile-parse.js';

export function formatProgressCompact(profile: AdvProfileRow): string {
  const visited = parseStringSet(profile.visited_scenes).size;
  const endings = parseStringSet(profile.endings_seen).size;
  const achievements = parseStringSet(profile.achievements).size;
  const totalRegions = playableSceneIds().length;
  const totalEndings = endingIds().length;
  return `🗺️ ${visited}/${totalRegions}  ·  🎬 ${endings}/${totalEndings}  ·  🏅 ${achievements}/${totalAchievements()}`;
}

export function formatMapProgress(profile: AdvProfileRow): string {
  const visited = parseStringSet(profile.visited_scenes);
  const total = playableSceneIds().length;
  const pct = total ? Math.round((visited.size / total) * 100) : 0;
  const lines = [
    `🗺️ **探索进度** ${visited.size}/${total}（${pct}%）`,
    '',
  ];

  for (const zone of MAP_ZONES) {
    const parts = zone.sceneIds.map((id) => {
      const mark = visited.has(id) ? '✅' : '⬜';
      return `${mark} ${regionLabel(id)}`;
    });
    lines.push(`**${zone.name}**`);
    lines.push(parts.join('  '));
    lines.push('');
  }

  const endings = parseStringSet(profile.endings_seen);
  const allEndings = endingIds();
  lines.push(`**结局图鉴** ${endings.size}/${allEndings.length}`);
  lines.push(
    allEndings
      .map((id) => `${endings.has(id) ? '✅' : '⬜'} ${endingLabel(id)}`)
      .join('  '),
  );
  return lines.join('\n').trimEnd();
}

export function formatAchievements(profile: AdvProfileRow, showHidden = false): string {
  const unlocked = parseStringSet(profile.achievements);
  const lines = [
    `🏅 **成就** ${unlocked.size}/${totalAchievements()}`,
    `完成局数：${profile.runs_completed}  ·  生涯步数：${profile.total_steps}`,
    '',
  ];

  for (const def of ACHIEVEMENTS) {
    const got = unlocked.has(def.id);
    if (def.hidden && !got && !showHidden) continue;
    const mark = got ? '✅' : '⬜';
    lines.push(`${mark} ${def.icon} **${def.title}** — ${def.description}`);
  }
  return lines.join('\n');
}

export function formatNewAchievements(ids: string[]): string {
  if (!ids.length) return '';
  const lines = ['', '🏅 **新成就解锁！**'];
  for (const id of ids) {
    const def = achievementById(id);
    if (def) lines.push(`${def.icon} ${def.title} — ${def.description}`);
  }
  return lines.join('\n');
}
