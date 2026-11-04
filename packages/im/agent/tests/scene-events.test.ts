import { describe, expect, it, vi } from 'vitest';
import {
  formatSceneEventsBlock,
  SCENE_EVENTS_HEADER,
  SCENE_EVENTS_MAX_CHARS,
  SCENE_WAKE_METADATA_KEY,
} from '../src/scene-events.js';
import { SceneEventsContextBuilder } from '../src/context/default-builders.js';
import { recordRelationTurn } from '../src/user-relation-turn.js';
import { AMBIENT_ENGAGEMENT_METADATA_KEY } from '../src/context/turn-envelope.js';

const imOrigin = { kind: 'im', platform: 'icqq', endpoint: '10000', scope: 'group', sceneId: 'g1' } as const;

describe('#996 [Scene events] block', () => {
  it('keeps at most 5 lines and ≤200 chars of body, newest first as given', () => {
    const lines = Array.from({ length: 8 }, (_, index) => `event ${index} ${'x'.repeat(50)}`);
    const block = formatSceneEventsBlock(lines);
    const body = block.split('\n').slice(1);
    expect(block.startsWith(SCENE_EVENTS_HEADER)).toBe(true);
    expect(body.length).toBeLessThanOrEqual(5);
    expect(body[0]).toContain('event 0');
    expect(body.join('\n').length).toBeLessThanOrEqual(SCENE_EVENTS_MAX_CHARS + body.length);
  });

  it('is empty without lines and flattens control characters', () => {
    expect(formatSceneEventsBlock([])).toBe('');
    expect(formatSceneEventsBlock(undefined)).toBe('');
    expect(formatSceneEventsBlock(['a\nb'])).toBe(`${SCENE_EVENTS_HEADER}\n- a b`);
  });

  it('builder puts the turn input lines into the envelope', async () => {
    const envelope: Record<string, string> = {};
    await new SceneEventsContextBuilder().build({
      envelope,
      turn: { origin: imOrigin, input: { text: 'hi', sceneEvents: ['阿强 joined', 'you muted 10m by 2'] } },
    } as any);
    expect(envelope.sceneEvents).toBe(`${SCENE_EVENTS_HEADER}\n- 阿强 joined\n- you muted 10m by 2`);
  });

  it('is ephemeral: shown to the model, never stored in agent_messages', async () => {
    const { createUserMessage, serializeAgentMessage } = await import('@zhin.js/ai');
    const { buildTurnContextBlocks } = await import('../src/context/turn-envelope.js');
    const { appendTurnContextBlocks } = await import('../src/context/turn-user-message.js');
    const blocks = buildTurnContextBlocks({ sceneEvents: formatSceneEventsBlock(['阿强 joined']) });
    const sceneBlock = blocks.find((block) => block.text.includes('[Scene events]'));
    expect(sceneBlock?.ephemeral).toBe(true);
    const [prompt] = appendTurnContextBlocks([createUserMessage('(scene events)')], blocks, {} as any);
    expect(JSON.stringify(prompt)).toContain('[Scene events]');
    const row = serializeAgentMessage(prompt!);
    expect(row.payload).not.toContain('[Scene events]');
    expect(row.payload).not.toContain('阿强 joined');
  });

  it('scene-wake turns get their own engagement line instead of the ambient one', async () => {
    const { buildTurnContextBlocks } = await import('../src/context/turn-envelope.js');
    const turn = {
      origin: imOrigin,
      principal: { subjectId: 'scene-events', roles: ['user'] },
      session: { key: 'icqq:10000:group:g1' },
      input: { text: '(scene events)', metadata: { [AMBIENT_ENGAGEMENT_METADATA_KEY]: 'ambient', [SCENE_WAKE_METADATA_KEY]: true } },
    } as any;
    const text = buildTurnContextBlocks({ turn }).map((block) => block.text).join('\n');
    expect(text).toContain('Engagement: scene events.');
    expect(text).not.toContain('Engagement: ambient.');
  });

  it('scene-wake turns never touch affinity / relations', () => {
    const relations = { recordTurn: vi.fn(async () => undefined) } as any;
    recordRelationTurn(relations, {
      origin: imOrigin,
      principal: { subjectId: 'scene-events', roles: ['user'] },
      session: { key: 'k' },
      input: { text: '(scene events)', metadata: { [SCENE_WAKE_METADATA_KEY]: true } },
    } as any, {});
    expect(relations.recordTurn).not.toHaveBeenCalled();
  });
});
