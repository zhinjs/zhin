import {
  Message,
  MessageCommand,
  getActionFromMessage,
  type Plugin,
} from 'zhin.js';
import {
  buildChoiceFallbackMap,
  channelKey,
  normalizeAdvAction,
  parseChoicePayload,
  registerGameTextMiddleware,
  resolveGameChoice,
  resolveGameTextPayload,
} from '@zhin.js/game-shared';
import { runAdvCommand } from './adv-command.js';
import { handleChoice } from './game-flow.js';
import { ADV_PREFIX, getScene, stateFromSession, visibleChoices } from './story.js';
import type { GameServices } from './session-service.js';

async function resolveAdvChoice(
  message: Message<any>,
  services: GameServices,
): Promise<{ sessionId: string; choiceId: string } | null> {
  const restart = await resolveGameChoice({
    message,
    gamePrefix: ADV_PREFIX,
    validChoiceIds: ['restart'],
    getById: (id) => services.sessions.getById(id),
    getActiveForUser: (ch, uid) => services.sessions.getActiveForUser(ch, uid),
    getByBoardMessageId: (mid) => services.sessions.getActiveByBoardMessageId(mid),
  });
  if (restart) return restart;

  const action = getActionFromMessage(message);
  if (!action) return null;

  const fromPayload = parseChoicePayload(action.payload, ADV_PREFIX);
  if (fromPayload) {
    return { sessionId: fromPayload.sessionId, choiceId: fromPayload.choiceId };
  }

  const choiceId = action.id || action.payload;
  if (!choiceId) return null;

  const ch = channelKey(message);
  const session =
    await services.sessions.getActiveForUser(ch, message.$sender.id)
    ?? (action.sourceMessageId
      ? await services.sessions.getActiveByBoardMessageId(action.sourceMessageId)
      : null);
  if (!session || session.channel_key !== ch) return null;

  const scene = getScene(session.scene_id);
  if (!scene) return null;
  const state = stateFromSession(session);
  const choices = visibleChoices(scene, state);
  if (!choices.some((c) => c.id === choiceId)) return null;

  return { sessionId: session.id, choiceId };
}

export function registerCommands(
  plugin: Plugin,
  getServices: () => GameServices | null,
): void {
  registerAdvPattern(plugin, '/adv [action:word]', '秘境探险（adv）', getServices);
  registerAdvPattern(plugin, '/冒险 [action:word]', '秘境探险（中文）', getServices);
  registerAdvPattern(plugin, '/秘境 [action:word]', '秘境探险（简称）', getServices);
}

function registerAdvPattern(
  plugin: Plugin,
  pattern: string,
  desc: string,
  getServices: () => GameServices | null,
): void {
  plugin.addCommand(
    new MessageCommand(pattern)
      .desc(desc)
      .action(async (message, result) => {
        const services = getServices();
        if (!services) return '文字冒险需要启用 database 配置。';
        const raw = (result.params.action as string | undefined) ?? '';
        return runAdvCommand(plugin, services, message, normalizeAdvAction(raw));
      }),
  );
}

async function handleAdvAction(
  plugin: Plugin,
  getServices: () => GameServices | null,
  message: Message<any>,
): Promise<boolean> {
  const services = getServices();
  if (!services) return false;
  const choice = await resolveAdvChoice(message, services);
  if (!choice) return false;
  const err = await handleChoice(plugin, services, message, choice.sessionId, choice.choiceId);
  if (err) await message.$reply?.(err);
  return true;
}

export function registerInteractive(
  plugin: Plugin,
  getServices: () => GameServices | null,
): void {
  plugin.registerInteractiveHandler(`${ADV_PREFIX}:`, (message) =>
    handleAdvAction(plugin, getServices, message),
  );
}

export function registerTextFallback(
  plugin: Plugin,
  getServices: () => GameServices | null,
): void {
  registerGameTextMiddleware(plugin, async (message, next) => {
    const services = getServices();
    if (!services) return next();

    const action = getActionFromMessage(message);
    if (action?.payload.startsWith(`${ADV_PREFIX}:`)) return next();

    const raw = message.$raw?.trim() ?? '';
    const ch = channelKey(message);

    const payloadFromText = resolveGameTextPayload(raw);
    if (payloadFromText?.startsWith(`${ADV_PREFIX}:`)) {
      const parsed = parseChoicePayload(payloadFromText, ADV_PREFIX);
      if (parsed) {
        const session = await services.sessions.getById(parsed.sessionId);
        if (session?.channel_key === ch) {
          const err = await handleChoice(plugin, services, message, parsed.sessionId, parsed.choiceId);
          if (err) await message.$reply?.(err);
          return;
        }
      }
    }

    const session = await services.sessions.getActiveForUser(ch, message.$sender.id);
    if (!session) return next();

    const scene = getScene(session.scene_id);
    if (!scene) return next();
    const state = stateFromSession(session);
    const choices = visibleChoices(scene, state);
    const map = buildChoiceFallbackMap(ADV_PREFIX, session.id, choices);
    const payload = resolveGameTextPayload(raw, map);
    const parsed = payload ? parseChoicePayload(payload, ADV_PREFIX) : null;
    if (!parsed || parsed.sessionId !== session.id) return next();

    const err = await handleChoice(plugin, services, message, session.id, parsed.choiceId);
    if (err) await message.$reply?.(err);
  }, 'adv:text');
}
