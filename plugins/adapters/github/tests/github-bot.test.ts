import { describe, it, expect } from 'vitest';
import { Message } from 'zhin.js';
import {
  parseMarkdown,
  enrichGithubInboundMessage,
  shouldAutoReplyRepo,
} from '../src/endpoint.js';
import { issueBranchName, parseMessageChannel } from '../src/github-channel-context.js';
import { GhClient } from '../src/gh-client.js';

describe('parseMarkdown bot mentions', () => {
  it('parses @slug[bot] as at segment', () => {
    const segs = parseMarkdown('hey @zhin-ai[bot] please fix');
    const at = segs.find(s => s.type === 'at');
    expect(at?.data.id).toBe('zhin-ai[bot]');
  });
});

describe('shouldAutoReplyRepo', () => {
  it('matches case-insensitive repo list', () => {
    expect(shouldAutoReplyRepo({ context: 'github', name: 'b', auto_reply_repos: ['Owner/Repo'] }, 'owner/repo')).toBe(true);
    expect(shouldAutoReplyRepo({ context: 'github', name: 'b', auto_reply_repos: ['other/x'] }, 'owner/repo')).toBe(false);
  });
});

describe('enrichGithubInboundMessage', () => {
  it('prepends synthetic @bot for auto_reply repos', () => {
    const gh = { getBotLogin: () => 'zhin-ai[bot]' } as GhClient;
    const msg = Message.from({}, {
      $id: '1',
      $adapter: 'github',
      $endpoint: 'bot',
      $sender: { id: 'user', name: 'user' },
      $channel: { id: 'owner/repo/issues/1', type: 'group' },
      $content: [{ type: 'text', data: { text: 'hello' } }],
      $raw: 'hello',
      $timestamp: Date.now(),
    });
    enrichGithubInboundMessage(msg, { context: 'github', name: 'bot', auto_reply_repos: ['owner/repo'] }, gh, 'owner/repo');
    expect(msg.$content[0]?.type).toBe('at');
    expect(msg.$content[0]?.data.id).toBe('zhin-ai[bot]');
  });
});

describe('github-channel-context', () => {
  it('issue branch naming', () => {
    expect(issueBranchName(42)).toBe('zhin/bot/issue-42');
  });

  it('parseMessageChannel from message', () => {
    const msg = Message.from({}, {
      $id: '1',
      $adapter: 'github',
      $endpoint: 'bot',
      $sender: { id: 'u', name: 'u' },
      $channel: { id: 'o/r/pull/9', type: 'group' },
      $content: [],
      $raw: '',
      $timestamp: 0,
    });
    const ctx = parseMessageChannel(msg);
    expect(ctx?.type).toBe('pr');
    expect(ctx?.number).toBe(9);
  });
});

describe('GhClient bot identity', () => {
  it('builds noreply email from slug and user id', () => {
    const gh = new GhClient({ appAuth: { appId: 1, privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----' } });
    (gh as any)._appSlug = 'zhin-ai';
    (gh as any)._user = 'zhin-ai[bot]';
    (gh as any)._botUserId = 12345;
    const id = gh.getBotIdentitySync();
    expect(id?.email).toBe('12345+zhin-ai[bot]@users.noreply.github.com');
    expect(id?.login).toBe('zhin-ai[bot]');
  });
});
