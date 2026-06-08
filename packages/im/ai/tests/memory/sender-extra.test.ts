import { describe, it, expect } from 'vitest';
import { createUserMessage } from '../../src/llm/types/agent-message.js';
import {
  applySenderExtraToUserMessage,
  buildSenderPrefix,
  CURRENT_USER_MESSAGE_MARKER,
  normalizeUserMessageForStorage,
  QUOTED_MESSAGE_CONTEXT_MARKER,
  renderUserMessageForLlm,
  splitQuoteFromUserText,
  stripSenderPrefixFromText,
} from '../../src/memory/sender-extra.js';
import { agentMessageRowToLlm, serializeAgentMessage } from '../../src/memory/agent-db-models.js';

describe('sender-extra', () => {
  const sender = {
    id: '1659488338',
    name: '归雨',
    roles: ['master', 'group_admin'],
    scope: 'group' as const,
  };

  it('buildSenderPrefix formats group sender label', () => {
    expect(buildSenderPrefix(sender)).toBe(
      '[sender:id=1659488338 name=归雨 roles=master,group_admin]',
    );
  });

  it('normalizeUserMessageForStorage splits sender and quote into extra', () => {
    const quoteBlock = `${QUOTED_MESSAGE_CONTEXT_MARKER}\ncontent: hi\n\n${CURRENT_USER_MESSAGE_MARKER}\n你是谁`;
    const prefixed = createUserMessage(
      `[sender:id=1659488338 name=归雨 roles=master,group_admin] ${quoteBlock}`,
    );
    const stored = normalizeUserMessageForStorage(prefixed);
    expect(stored.extra?.sender?.id).toBe('1659488338');
    expect(stored.extra?.quote?.block).toContain(QUOTED_MESSAGE_CONTEXT_MARKER);
    if (stored.message.role === 'user') {
      expect(stored.message.content[0]).toMatchObject({ type: 'text', text: '你是谁' });
    }
  });

  it('agentMessageRowToLlm re-applies sender + quote from extra', () => {
    const row = serializeAgentMessage(createUserMessage('你是谁'), {
      sender,
      quote: { block: `${QUOTED_MESSAGE_CONTEXT_MARKER}\ncontent: hi` },
    });
    row.session_id = 's1';
    row.id = 1;
    const llm = agentMessageRowToLlm(row);
    expect(llm?.role).toBe('user');
    if (llm?.role === 'user') {
      const text = llm.content.find((b) => b.type === 'text');
      expect(text?.type === 'text' && text.text).toContain(QUOTED_MESSAGE_CONTEXT_MARKER);
      expect(text?.type === 'text' && text.text).toContain('[sender:id=1659488338');
      expect(text?.type === 'text' && text.text).toContain('你是谁');
    }
  });

  it('splitQuoteFromUserText parses legacy combined content', () => {
    const combined = `${QUOTED_MESSAGE_CONTEXT_MARKER}\ncontent: x\n\n${CURRENT_USER_MESSAGE_MARKER}\nhello`;
    const split = splitQuoteFromUserText(combined);
    expect(split.body).toBe('hello');
    expect(split.quote?.block).toContain(QUOTED_MESSAGE_CONTEXT_MARKER);
  });

  it('renderUserMessageForLlm does not double-prefix', () => {
    const msg = createUserMessage('继续');
    const out = renderUserMessageForLlm(msg, { sender });
    if (out.role === 'user') {
      expect(out.content[0]).toMatchObject({
        type: 'text',
        text: '[sender:id=1659488338 name=归雨 roles=master,group_admin] 继续',
      });
    }
  });

  it('stripSenderPrefixFromText parses legacy embedded prefix', () => {
    const { body, sender: parsed } = stripSenderPrefixFromText(
      '[sender:id=907624307 name=橘猫 roles=user] hello',
    );
    expect(body).toBe('hello');
    expect(parsed?.name).toBe('橘猫');
  });

  it('applySenderExtraToUserMessage adds prefix only', () => {
    const msg = createUserMessage('继续');
    const out = applySenderExtraToUserMessage(msg, { sender });
    if (out.role === 'user') {
      expect(out.content[0]).toMatchObject({
        type: 'text',
        text: '[sender:id=1659488338 name=归雨 roles=master,group_admin] 继续',
      });
    }
  });
});
