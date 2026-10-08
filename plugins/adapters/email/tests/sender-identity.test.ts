import { simpleParser } from 'mailparser';
import { parseEmailMessage, emailInboundConversation } from '../src/protocol.js';

it('matches a display-name sender to its mailbox identity using actual mail parsing', async () => {
  const parsed = await simpleParser('From: admin <sender@example.com>\r\nTo: bot@example.com\r\nMessage-ID: <fixture@example.com>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n/acceptance probe:email0002');
  const email = parseEmailMessage(parsed, 1);
  expect(email.from).toBe('sender@example.com');
  expect(emailInboundConversation('root/email\0test-bot', email).id).toBe('sender@example.com');
  expect(email.text.trim()).toBe('/acceptance probe:email0002');
});
