export const WORKROOM_EVENT_MODEL = {
  id: { type: 'text' as const, primary: true, nullable: false },
  run_id: { type: 'text' as const, nullable: false },
  sequence: { type: 'integer' as const, nullable: false },
  version: { type: 'integer' as const, nullable: false },
  type: { type: 'text' as const, nullable: false },
  payload_json: { type: 'text' as const, nullable: false },
  occurred_at: { type: 'integer' as const, nullable: false },
  stored_event_digest: { type: 'text' as const, nullable: false },
  row_binding_digest: { type: 'text' as const, nullable: false },
};
