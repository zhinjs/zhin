import { describe, expect, it } from 'vitest';
import { parseAgentToolDefinition } from '@zhin.js/tool';
import {
  createModerationConsoleRpc,
  MODERATION_READ_PERMISSION,
  ModerationEngine,
  moderationEngineToken,
  type ModerationCheckTextResult,
  type ModerationConsoleStatus,
} from '../src/index.js';
import moderationCheckTool from '../skills/content-moderation/tools/moderation_check/index.ts';
import moderationStatusTool from '../skills/content-moderation/tools/moderation_status/index.ts';
import Page, { meta } from '../pages/index/index.ts';

function createConfiguredEngine(): ModerationEngine {
  const engine = new ModerationEngine();
  engine.configure({
    enabled: true,
    onError: 'open',
    inbound: {
      whitelist: {
        userIds: ['u1', 'u2'],
        conversationIds: ['g1'],
      },
    },
    sources: [
      {
        id: 'local-main',
        type: 'local',
        words: [{ word: 'forbiddenword', severity: 'high' }],
        severity: 'high',
        includeBuiltin: false,
      },
    ],
  });
  return engine;
}

describe('@zhin.js/plugin-content-moderation AI Skill Tools, Console RPC & Page', () => {
  it('exports declarative page metadata and component', () => {
    expect(meta.title).toBe('内容审核');
    expect(meta.titleI18n).toEqual({ en: 'Content Moderation' });
    expect(meta.icon).toBe('ShieldAlert');
    expect(meta.order).toBe(55);
    expect(meta.requiredPermissions).toEqual([MODERATION_READ_PERMISSION]);
    expect(typeof Page).toBe('function');
  });

  it('brands and executes moderation_check and moderation_status tools', async () => {
    expect(parseAgentToolDefinition(moderationCheckTool)).toBe(moderationCheckTool);
    expect(parseAgentToolDefinition(moderationStatusTool)).toBe(moderationStatusTool);
    expect(moderationCheckTool.readOnly).toBe(true);
    expect(moderationStatusTool.readOnly).toBe(true);

    const engine = createConfiguredEngine();
    const ctx = {
      use: <T>(token: unknown): T => (token === moderationEngineToken ? (engine as T) : (undefined as T)),
    } as never;

    const cleanSummary = await moderationCheckTool.execute({ text: 'hello world' }, ctx);
    expect(String(cleanSummary)).toContain('passed');

    const flaggedSummary = await moderationCheckTool.execute({ text: 'contains forbiddenword here' }, ctx);
    expect(String(flaggedSummary)).toContain('flagged');
    expect(String(flaggedSummary)).toContain('high');
    expect(String(flaggedSummary)).toContain('forbiddenword');

    const statusSummary = await moderationStatusTool.execute({}, ctx);
    expect(String(statusSummary)).toContain('enabled');
    expect(String(statusSummary)).toContain('local-main');
    expect(String(statusSummary)).toContain('high');
  });

  it('exposes Console RPC status and checkText dry-run action', async () => {
    const engine = createConfiguredEngine();
    const rpc = createModerationConsoleRpc();

    const statusMethod = rpc.methods.get('status');
    expect(statusMethod).toBeDefined();
    expect(statusMethod?.page).toBe('index');
    expect(statusMethod?.requiredPermissions).toEqual([MODERATION_READ_PERMISSION]);

    const callContext = {
      signal: new AbortController().signal,
      runtime: {
        owner: 'root/content-moderation' as never,
        generation: 1,
        operator: true,
        project: () => undefined,
        use: <T>(token: unknown): T => (token === moderationEngineToken ? (engine as T) : (undefined as T)),
      } as never,
    };

    const status = (await statusMethod!.handler({}, callContext)) as unknown as ModerationConsoleStatus;
    expect(status.enabled).toBe(true);
    expect(status.sensitivity).toBe('high');
    expect(status.providersCount).toBe(1);
    expect(status.whitelistCount).toBe(3);
    expect(status.pendingReviewsCount).toBe(0);
    expect(status.providers).toEqual([
      {
        id: 'local-main',
        type: 'local',
        enabled: true,
        onError: 'open',
      },
    ]);

    const checkAction = rpc.methods.get('checkText') ?? rpc.methods.get('check-text');
    expect(checkAction).toBeDefined();
    expect(checkAction?.page).toBe('index');
    expect(checkAction?.requiredPermissions).toEqual([MODERATION_READ_PERMISSION]);

    const allowRes = (await checkAction!.handler({ text: 'safe sample' }, callContext)) as unknown as ModerationCheckTextResult;
    expect(allowRes.passed).toBe(true);
    expect(allowRes.decision).toBe('allow');
    expect(allowRes.severity).toBe('pass');

    const blockRes = (await checkAction!.handler({ text: 'this has forbiddenword' }, callContext)) as unknown as ModerationCheckTextResult;
    expect(blockRes.passed).toBe(false);
    expect(blockRes.decision).toBe('block');
    expect(blockRes.severity).toBe('high');
    expect(blockRes.categories).toContain('local-main:high');
    expect(engine.pendingReviewsCount).toBe(0);
    expect(engine.groupReviewQueue.pendingCount).toBe(0);

    await expect(() => checkAction!.handler({ text: '   ' }, callContext)).rejects.toThrow(/Sample text is required/);
  });
});
