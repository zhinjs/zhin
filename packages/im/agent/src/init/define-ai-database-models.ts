/**
 * Register ADR 0009 AI persistence tables on a Host/plugin `define` surface.
 * Used by legacy `registerDbModels` and Plugin Runtime Agent Host.
 */
import {
  AGENT_SESSION_MODEL,
  AGENT_MESSAGE_MODEL,
  AGENT_SUMMARY_MODEL,
  MEMORY_ENTRY_MODEL,
} from '@zhin.js/ai';
import { AI_USER_PROFILE_MODEL } from '../user-profile.js';
import { WORKROOM_EVENT_MODEL } from '../workroom/journal-model.js';
import { WORKROOM_CATALOG_MODEL } from '../workroom/catalog.js';
import { WORKROOM_ASSIGNMENT_AUTHORITY_GRANT_MODEL } from '../workroom/assignment-authority-grant-repository.js';
import { PORTFOLIO_CONTROL_OUTBOX_MODEL } from '../portfolio/database-capacity-control-outbox.js';
import { PAYLOAD_LIFECYCLE_EVENT_MODEL } from '../data-governance/database-payload-lifecycle-repository.js';
import {
  ENCRYPTED_PAYLOAD_VAULT_AUDIT_MODEL,
  ENCRYPTED_PAYLOAD_VAULT_OBJECT_MODEL,
} from '../data-governance/encrypted-database-payload-vault.js';
import {
  PAYLOAD_VAULT_HANDOFF_MODEL,
  PAYLOAD_VAULT_HANDOFF_RETIREMENT_MODEL,
} from '../data-governance/payload-vault-storage-handoff.js';
import { WORKROOM_PROJECT_KNOWLEDGE_MODEL } from '../workroom/database-project-knowledge-journal.js';
import { WORKROOM_OVERLAY_PACK_PROMOTIONS_MODEL } from '../plugin-runtime/database-overlay-pack-promotion-repository.js';

export type AiDatabaseModelDefiner = (
  name: string,
  definition: Record<string, unknown>,
) => void;

const AI_DATABASE_MODELS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['agent_sessions', AGENT_SESSION_MODEL],
  ['agent_messages', AGENT_MESSAGE_MODEL],
  ['agent_summaries', AGENT_SUMMARY_MODEL],
  ['ai_user_profiles', AI_USER_PROFILE_MODEL],
  ['workroom_events', WORKROOM_EVENT_MODEL],
  ['workroom_catalog', WORKROOM_CATALOG_MODEL],
  ['workroom_assignment_authority_grants', WORKROOM_ASSIGNMENT_AUTHORITY_GRANT_MODEL],
  ['portfolio_control_outbox', PORTFOLIO_CONTROL_OUTBOX_MODEL],
  ['payload_lifecycle_events', PAYLOAD_LIFECYCLE_EVENT_MODEL],
  ['payload_vault_objects', ENCRYPTED_PAYLOAD_VAULT_OBJECT_MODEL],
  ['payload_vault_audit', ENCRYPTED_PAYLOAD_VAULT_AUDIT_MODEL],
  ['payload_vault_handoffs', PAYLOAD_VAULT_HANDOFF_MODEL],
  ['payload_vault_handoff_retirements', PAYLOAD_VAULT_HANDOFF_RETIREMENT_MODEL],
  ['workroom_project_knowledge', WORKROOM_PROJECT_KNOWLEDGE_MODEL],
  ['workroom_overlay_pack_promotions', WORKROOM_OVERLAY_PACK_PROMOTIONS_MODEL],
  ['memory_entries', MEMORY_ENTRY_MODEL],
];

/** Define all AI and orchestration tables (idempotent per Host generation). */
export function defineAiDatabaseModels(define: AiDatabaseModelDefiner): number {
  for (const [name, definition] of AI_DATABASE_MODELS) {
    define(name, definition);
  }
  return AI_DATABASE_MODELS.length;
}
