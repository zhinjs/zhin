/**
 * Reads the inbox-policy markers of a mail (ADR 0048 H3).
 *
 * Only `human` mail carries markers (`MailBody.human`). Every other kind is
 * an ordinary, non-plain, non-mergeable mail from its transport sender, so
 * actor / timer / event mail is never merged into, superseded by, or used to
 * stop a human's turn.
 */
import { senderOf, type Mail } from '../contracts.js';

export interface InboxMarkers {
  readonly senderId: string;
  readonly senderName?: string;
  readonly text: string;
  readonly messageId?: string;
  readonly human: boolean;
  readonly plainText: boolean;
  readonly mergeable: boolean;
  readonly live: boolean;
  readonly isMaster: boolean;
  readonly isStop: boolean;
  readonly unaddressed: boolean;
}

function textOf(mail: Mail): string {
  const body = mail.body;
  switch (body.kind) {
    case 'human': return body.text;
    case 'ask': return body.question;
    case 'delegate': return body.brief;
    case 'tell': return body.content;
    case 'result': return body.content;
    case 'timer': return body.content;
    default: return '';
  }
}

export function inboxMarkers(mail: Mail): InboxMarkers {
  const senderId = senderOf(mail);
  const text = textOf(mail);
  const body = mail.body;
  if (body.kind !== 'human') {
    return { senderId, text, human: false, plainText: false, mergeable: false, live: false, isMaster: false, isStop: false, unaddressed: false };
  }
  return {
    senderId,
    ...(body.senderName ? { senderName: body.senderName } : {}),
    text,
    ...(body.messageId ? { messageId: body.messageId } : {}),
    human: true,
    plainText: body.plainText === true,
    mergeable: body.mergeable === true,
    live: body.live === true,
    isMaster: body.isMaster === true,
    isStop: body.isStop === true,
    unaddressed: body.unaddressed === true,
  };
}
