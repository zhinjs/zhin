import { describe, it, expect } from 'vitest';
import {
  enrichInboundContent,
  shouldAutoReplyRepo,
} from '../src/protocol.js';
import { issueBranchName, parseMessageChannel } from '../src/github-channel-context.js';
import { GhClient } from '../src/gh-client.js';

describe('shouldAutoReplyRepo', () => {
  it('matches case-insensitive repo list', () => {
    expect(shouldAutoReplyRepo({ autoReplyRepos: ['Owner/Repo'] }, 'owner/repo')).toBe(true);
    expect(shouldAutoReplyRepo({ autoReplyRepos: ['other/x'] }, 'owner/repo')).toBe(false);
  });
});

describe('enrichInboundContent', () => {
  it('prepends synthetic @bot for auto_reply repos', () => {
    const content = enrichInboundContent(
      'hello',
      { autoReplyRepos: ['owner/repo'], botLogin: 'zhin-ai[bot]' },
      'zhin-ai[bot]',
      'owner/repo',
    );
    expect(content.startsWith('@zhin-ai[bot]')).toBe(true);
  });
});

describe('github-channel-context', () => {
  it('issue branch naming', () => {
    expect(issueBranchName(42)).toBe('zhin/bot/issue-42');
  });

  it('parseMessageChannel from message', () => {
    const msg = {
      $channel: { id: 'o/r/pull/9', type: 'group' },
    } as Parameters<typeof parseMessageChannel>[0];
    const ctx = parseMessageChannel(msg);
    expect(ctx?.type).toBe('pr');
    expect(ctx?.number).toBe(9);
  });
});

describe('GhClient bot identity', () => {
  it('builds noreply email from slug and user id', () => {
    const gh = new GhClient({
      appAuth: {
        appId: 1,
        privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----',
      },
    });
    (gh as any)._appSlug = 'zhin-ai';
    (gh as any)._user = 'zhin-ai[bot]';
    (gh as any)._botUserId = 12345;
    const id = gh.getBotIdentitySync();
    expect(id?.email).toBe('12345+zhin-ai[bot]@users.noreply.github.com');
    expect(id?.login).toBe('zhin-ai[bot]');
  });
});
