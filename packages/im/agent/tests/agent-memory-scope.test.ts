import { describe, it, expect } from 'vitest';
import { resolveAgentScopedSessionId } from '@zhin.js/ai';

const BASE_SESSION = 'icqq:bot123:group:group456';

describe('resolveAgentScopedSessionId', () => {
  describe('session scope (default)', () => {
    it('returns base session ID unchanged', () => {
      const result = resolveAgentScopedSessionId(BASE_SESSION, 'researcher', 'session');
      expect(result).toBe(BASE_SESSION);
    });

    it('defaults to session scope when omitted', () => {
      const result = resolveAgentScopedSessionId(BASE_SESSION, 'researcher');
      expect(result).toBe(BASE_SESSION);
    });
  });

  describe('agent scope', () => {
    it('prefixes with agent name for isolation', () => {
      const result = resolveAgentScopedSessionId(BASE_SESSION, 'researcher', 'agent');
      expect(result).toBe(`agent:researcher:${BASE_SESSION}`);
    });

    it('different agents in same session get different keys', () => {
      const key1 = resolveAgentScopedSessionId(BASE_SESSION, 'researcher', 'agent');
      const key2 = resolveAgentScopedSessionId(BASE_SESSION, 'planner', 'agent');
      expect(key1).not.toBe(key2);
      expect(key1).toContain('researcher');
      expect(key2).toContain('planner');
    });

    it('falls back to base session when agent name is undefined', () => {
      const result = resolveAgentScopedSessionId(BASE_SESSION, undefined, 'agent');
      expect(result).toBe(BASE_SESSION);
    });
  });

  describe('user scope', () => {
    it('extracts user-level key from session ID', () => {
      const result = resolveAgentScopedSessionId(BASE_SESSION, 'researcher', 'user');
      expect(result).toBe('user:icqq:bot123:group:group456');
    });

    it('isolates private vs group sessions with the same scene id', () => {
      const groupKey = resolveAgentScopedSessionId('icqq:bot123:group:999', 'researcher', 'user');
      const privateKey = resolveAgentScopedSessionId('icqq:bot123:private:999', 'researcher', 'user');
      expect(groupKey).not.toBe(privateKey);
    });

    it('same user across different groups gets same key', () => {
      const session1 = 'icqq:bot123:group:groupA';
      const session2 = 'icqq:bot123:group:groupB';
      const key1 = resolveAgentScopedSessionId(session1, 'researcher', 'user');
      const key2 = resolveAgentScopedSessionId(session2, 'researcher', 'user');
      expect(key1).not.toBe(key2);
    });

    it('private session extracts user ID', () => {
      const privateSession = 'icqq:bot123:private:user789';
      const result = resolveAgentScopedSessionId(privateSession, 'agent', 'user');
      expect(result).toBe('user:icqq:bot123:private:user789');
    });

    it('handles minimal session ID', () => {
      const result = resolveAgentScopedSessionId('a:b', 'agent', 'user');
      expect(result).toBe('user:a:b:b');
    });

    it('handles single segment session ID', () => {
      const result = resolveAgentScopedSessionId('single', 'agent', 'user');
      expect(result).toBe('user:single');
    });
  });

  describe('isolation guarantees', () => {
    it('session scope: same agent same session → same key', () => {
      const key1 = resolveAgentScopedSessionId(BASE_SESSION, 'agent1', 'session');
      const key2 = resolveAgentScopedSessionId(BASE_SESSION, 'agent2', 'session');
      expect(key1).toBe(key2);
    });

    it('agent scope: same agent same session → same key', () => {
      const key1 = resolveAgentScopedSessionId(BASE_SESSION, 'agent1', 'agent');
      const key2 = resolveAgentScopedSessionId(BASE_SESSION, 'agent1', 'agent');
      expect(key1).toBe(key2);
    });

    it('agent scope: different agent same session → different key', () => {
      const key1 = resolveAgentScopedSessionId(BASE_SESSION, 'agent1', 'agent');
      const key2 = resolveAgentScopedSessionId(BASE_SESSION, 'agent2', 'agent');
      expect(key1).not.toBe(key2);
    });
  });
});
