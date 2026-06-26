import type { SendContent } from 'zhin.js';
import { buildChoiceKeyboard } from '@zhin.js/game-shared';
import type { AdvProfileRow, AdvSessionRow } from './models.js';
import { formatProgressCompact } from './profile-format.js';
import {
  ADV_PREFIX,
  getScene,
  sceneNarrative,
  stateFromSession,
  visibleChoices,
} from './story.js';

export function buildSceneInteractive(
  session: AdvSessionRow,
  extraNarrative = '',
  profile?: AdvProfileRow,
): SendContent | null {
  const scene = getScene(session.scene_id);
  if (!scene) return null;

  const state = stateFromSession(session);
  const choices = visibleChoices(scene, state);
  const terminal = scene.terminal || session.status !== 'active';

  let narrative = sceneNarrative(scene, state);
  if (profile && !terminal) {
    narrative = `${formatProgressCompact(profile)}\n\n${narrative}`;
  }
  if (extraNarrative) {
    narrative += extraNarrative;
  }

  return buildChoiceKeyboard({
    gamePrefix: ADV_PREFIX,
    sessionId: session.id,
    narrative,
    choices: choices.map((c) => ({
      id: c.id,
      label: c.label,
      style: c.style,
    })),
    terminal,
    buttonsPerRow: 2,
    fallbackHint: '回复数字选择（仅编号）',
  });
}
