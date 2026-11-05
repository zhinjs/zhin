/**
 * ADR 0048 §3.4 Guard Kernel — mail admission (H1).
 *
 * `admitMail` is pure: it reads the mail, the engagement graph and the
 * context, and returns the first denial in a fixed order (or allow). It never
 * looks at prompt text except to normalize content for duplicate detection.
 *
 * Order (first failure wins):
 * 1. engagement known            → `unknown_engagement`
 * 2. causation (invariant 3)     → `missing_causation`
 * 3. authority (invariant 1)     → `authority_not_attenuated` / `missing_causation` (forged result / signal)
 * 4. contacts and acceptance     → `contact_not_allowed` / `not_accepted_by_target`
 * 5. depth (invariant 5)         → `depth_exceeded`             (escalates)
 * 6. fanout                      → `fanout_exceeded`            (escalates)
 * 7. pair round trips            → `pair_round_trips_exceeded`  (escalates)
 * 8. duplicates                  → `duplicate_mail`             (escalates)
 */

import {
  scopeHas,
  type ActorId,
  type Authority,
  type Engagement,
  type EngagementGraphView,
  type GuardContext,
  type GuardDecision,
  type GuardDenyCode,
  type GuardKernel,
  type Mail,
  type MailId,
  type MailSender,
} from './contracts.js';

export interface GuardKernelOptions {
  /** `true` when `child` grants nothing beyond `parent` (supplied by the authority module). */
  isAttenuationOf(child: Authority, parent: Authority): boolean;
}

const ALLOW: GuardDecision = Object.freeze({ allow: true });

function deny(code: GuardDenyCode, reason: string, escalate = false): GuardDecision {
  return Object.freeze({ allow: false, code, reason, escalate });
}

/** Builds a read-only, id-indexed view over an engagement's admitted mails. */
export function createEngagementGraph(engagement: Engagement, mails: readonly Mail[]): EngagementGraphView {
  const list = Object.freeze([...mails]);
  const byId = new Map<MailId, Mail>();
  for (const mail of list) {
    if (!byId.has(mail.id)) byId.set(mail.id, mail);
  }
  return Object.freeze({
    engagement,
    mails: list,
    get: (id: MailId) => byId.get(id),
  });
}

/** Agent definition name of an actor id (`<agent>` or `<agent>#<instance>`). */
function agentOf(actor: ActorId): string {
  const hash = actor.indexOf('#');
  return hash === -1 ? actor : actor.slice(0, hash);
}

function describeSender(from: MailSender): string {
  switch (from.kind) {
    case 'actor':
      return `actor ${from.actor}`;
    case 'human':
      return `human ${from.principal.id}`;
    case 'system':
      return `system ${from.source}`;
  }
}

function senderKey(from: MailSender): string {
  switch (from.kind) {
    case 'actor':
      return `actor:${from.actor}`;
    case 'human':
      return `human:${from.principal.id}`;
    case 'system':
      return `system:${from.source}`;
  }
}

function isAskOrDelegate(mail: Mail): boolean {
  return mail.kind === 'ask' || mail.kind === 'delegate';
}

function isHop(mail: Mail): boolean {
  return mail.from.kind === 'actor' && isAskOrDelegate(mail);
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Text compared for duplicate detection; `undefined` for kinds that are not checked. */
function contentOf(mail: Mail): string | undefined {
  switch (mail.body.kind) {
    case 'ask':
      return normalize(mail.body.question);
    case 'delegate':
      return normalize(mail.body.brief);
    case 'tell':
      return normalize(mail.body.content);
    default:
      return undefined;
  }
}

/** Number of actor-sent ask/delegate hops from `mail` back to the root, including `mail`. */
function depthOf(mail: Mail, graph: EngagementGraphView): number {
  let depth = 0;
  const seen = new Set<MailId>();
  let current: Mail | undefined = mail;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (isHop(current)) depth += 1;
    current = current.causationId === undefined ? undefined : graph.get(current.causationId);
  }
  return depth;
}

function checkResult(mail: Mail, sender: ActorId, graph: EngagementGraphView): GuardDecision | undefined {
  if (mail.body.kind !== 'result') return undefined;
  const original = graph.get(mail.body.inReplyTo);
  if (!original) {
    return deny('missing_causation', `Result ${mail.id} from actor ${sender} replies to unknown mail ${mail.body.inReplyTo}`);
  }
  if (!isAskOrDelegate(original)) {
    return deny(
      'missing_causation',
      `Result ${mail.id} from actor ${sender} replies to ${original.kind} mail ${original.id}, not an ask or delegate`,
    );
  }
  if (original.to !== sender) {
    return deny(
      'missing_causation',
      `Result ${mail.id} from actor ${sender} replies to mail ${original.id} that was addressed to ${original.to}`,
    );
  }
  const rootActor = graph.get(graph.engagement.rootMailId)?.to;
  const sentByTarget =
    original.from.kind === 'actor' ? original.from.actor === mail.to : mail.to === rootActor;
  if (!sentByTarget) {
    return deny(
      'missing_causation',
      `Result ${mail.id} from actor ${sender} is addressed to ${mail.to}, but mail ${original.id} was sent by ${describeSender(original.from)}`,
    );
  }
  return undefined;
}

export function createGuardKernel(options: GuardKernelOptions): GuardKernel {
  const { isAttenuationOf } = options;

  function admitMail(mail: Mail, ctx: GuardContext): GuardDecision {
    const { graph, limits, targetCeiling, senderAuthority } = ctx;
    const who = describeSender(mail.from);

    // 1. Engagement
    if (!graph) {
      return deny('unknown_engagement', `Mail ${mail.id} from ${who} names unknown engagement ${mail.engagementId}`);
    }
    if (mail.engagementId !== graph.engagement.id) {
      return deny(
        'unknown_engagement',
        `Mail ${mail.id} from ${who} names engagement ${mail.engagementId}, but was routed into ${graph.engagement.id}`,
      );
    }

    // 2. Causation (invariant 3)
    if (mail.causationId === undefined) {
      if (mail.id !== graph.engagement.rootMailId) {
        return deny(
          'missing_causation',
          `Mail ${mail.id} from ${who} to ${mail.to} has no causation and is not the root mail of engagement ${graph.engagement.id}`,
        );
      }
    } else if (!graph.get(mail.causationId)) {
      return deny(
        'missing_causation',
        `Mail ${mail.id} from ${who} to ${mail.to} cites unknown causation ${mail.causationId}`,
      );
    }

    // 3. Authority (invariant 1); results and signals are checked structurally instead
    if (mail.from.kind === 'actor') {
      const sender = mail.from.actor;
      if (mail.body.kind === 'result') {
        const forged = checkResult(mail, sender, graph);
        if (forged) return forged;
      } else if (mail.body.kind === 'signal') {
        if (!graph.get(mail.body.target)) {
          return deny(
            'missing_causation',
            `Signal ${mail.id} from actor ${sender} targets unknown mail ${mail.body.target}`,
          );
        }
      } else if (
        !senderAuthority
        || !isAttenuationOf(mail.authority, senderAuthority)
        || mail.authority.chain.at(-1) !== sender
      ) {
        return deny(
          'authority_not_attenuated',
          senderAuthority
            ? `Mail ${mail.id} from actor ${sender} to ${mail.to} carries authority wider than the sender's own`
            : `Mail ${mail.id} from actor ${sender} to ${mail.to} has no sender authority to attenuate from`,
        );
      }
    }

    // 4. Contacts and target acceptance
    const targetAgent = agentOf(mail.to);
    const contactKind = mail.kind === 'ask' || mail.kind === 'delegate' || mail.kind === 'tell';
    if (mail.from.kind === 'actor' && contactKind) {
      // senderAuthority is present here: step 3 denied otherwise.
      if (!senderAuthority || !scopeHas(senderAuthority.contacts, targetAgent)) {
        return deny(
          'contact_not_allowed',
          `Actor ${mail.from.actor} may not contact agent ${targetAgent} (not in its contacts)`,
        );
      }
      const fromAgent = agentOf(mail.from.actor);
      if (!scopeHas(targetCeiling.acceptsFrom, fromAgent)) {
        return deny(
          'not_accepted_by_target',
          `Agent ${targetAgent} does not accept ${mail.kind} mail from agent ${fromAgent}`,
        );
      }
    } else if (mail.from.kind === 'human' && mail.kind === 'human') {
      if (!scopeHas(targetCeiling.acceptsFrom, 'human')) {
        return deny(
          'not_accepted_by_target',
          `Agent ${targetAgent} does not accept mail from humans (sender ${mail.from.principal.id})`,
        );
      }
    }

    // 5–7 apply to ask / delegate only
    if (isAskOrDelegate(mail)) {
      // 5. Depth (invariant 5)
      const depth = depthOf(mail, graph);
      if (depth > limits.maxDepth) {
        return deny(
          'depth_exceeded',
          `${mail.kind} from ${who} to ${mail.to} would reach delegation depth ${depth}, above the limit of ${limits.maxDepth}`,
          true,
        );
      }

      // 6. Fanout
      const fanout = graph.mails.filter(isAskOrDelegate).length + 1;
      if (fanout > limits.maxFanout) {
        return deny(
          'fanout_exceeded',
          `${mail.kind} from ${who} to ${mail.to} would be ask/delegate #${fanout} in engagement ${graph.engagement.id}, above the limit of ${limits.maxFanout}`,
          true,
        );
      }

      // 7. Pair round trips
      if (mail.from.kind === 'actor') {
        const a = mail.from.actor;
        const b = mail.to;
        const exchanged = graph.mails.filter(
          (m) =>
            isAskOrDelegate(m) &&
            m.from.kind === 'actor' &&
            ((m.from.actor === a && m.to === b) || (m.from.actor === b && m.to === a)),
        ).length;
        if (exchanged + 1 > limits.maxPairRoundTrips) {
          return deny(
            'pair_round_trips_exceeded',
            `Actors ${a} and ${b} would exchange ask/delegate #${exchanged + 1}, above the limit of ${limits.maxPairRoundTrips}`,
            true,
          );
        }
      }
    }

    // 8. Duplicates
    const content = contentOf(mail);
    if (content !== undefined) {
      const key = senderKey(mail.from);
      const sent = graph.mails.filter(
        (m) => m.kind === mail.kind && m.to === mail.to && senderKey(m.from) === key && contentOf(m) === content,
      ).length;
      if (sent + 1 > limits.maxDuplicates) {
        return deny(
          'duplicate_mail',
          `${who} would send the same ${mail.kind} to ${mail.to} ${sent + 1} times, above the limit of ${limits.maxDuplicates}`,
          true,
        );
      }
    }

    return ALLOW;
  }

  return Object.freeze({ admitMail });
}
