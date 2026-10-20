# Ticket #12 prototype notes

Decision-map ticket #12 is answered by the executable customer-support and
investment-research fixtures in this directory. This is evidence for the
contract, not a production privacy subsystem.

## Facts established

- `classification` is only confidentiality. Data category, tenant/Project
  scope, allowed purpose, subject linkage, residency, retention window and
  lineage are orthogonal fields in a `Data Descriptor`; no single risk label may
  stand in for all of them.
- Context View, Evidence Port, Workroom/Sponsor projection, Console and A2A use
  the same `evaluateDisclosure(descriptor, envelope, purpose, destination,
  current policy)` decision. Adapters cannot invent weaker local redaction rules.
- The decision lattice is fail closed: full, metadata-only, trusted transform
  required, exact approval required, or deny. Tenant/residency/credential/unknown
  classification denials are not Sponsor-overridable.
- The recipient set and IM membership revision are part of the request digest.
  A group becoming broader stales an old decision/approval even when the message
  text is unchanged.
- Context Digest, summary, Report and Agent hand-off inherit the strictest source
  classification/categories, the intersection of purposes/regions, lineage and
  the source retention window. LLM rewriting never declassifies data.
- Redaction/minimization is a trusted, versioned deterministic transform that
  produces a new immutable Data Object and verifier-visible lineage. Masking or
  pseudonymization remains subject-linked; only a policy-declared verified
  deidentification transform may break subject linkage.
- A Disclosure Approval binds the exact source hash, purpose, channel,
  destination, membership and policy revision. It does not expand Tool authority
  or authorize re-disclosure. A materialized output gets a Disclosure Manifest.
- Data Governance Policy is a monotonic safety overlay. Profile Packs intersect
  regions/destinations/retention windows, raise classification floors and select
  only trusted transforms; they cannot weaken baseline. A governance revision
  change stales cached Views, manifests-in-progress and approvals immediately.
- Event sourcing stores a content-free Data Header/Journals, hashes, lineage,
  decisions and purge receipts. Sensitive body lives in a Payload Vault. Purge
  removes every declared payload/index location (or remains reconciliation on
  unknown outcome) while preserving minimal non-content audit facts.
- Retention uses both minimum and maximum time. A Retention Hold can extend
  storage and requires owner/reason/reviewAt/release, but never grants read
  access. Subject erasure cannot violate an active hold or policy minimum.
- Purged/expired Evidence may make later verification impossible; lifecycle emits
  a fact and the owning Project/Acceptance policy decides stale/block/rework. The
  retention module must not silently rewrite accepted Project State.

## Production cautions

- Data category classification needs trusted schema rules plus a quarantine path
  for unknown bytes. Agent-provided labels may raise sensitivity or propose a
  review, never lower the policy-derived floor.
- Payload Vault implementations need envelope encryption/key destruction,
  replica/search/cache/backup location manifests, idempotent purge outboxes and
  authenticated receipts. `outcome_unknown` must remain visible.
- Model providers, IM platforms and A2A peers are processing destinations with
  explicit trust domain, contract, training/logging behavior and processing
  regions. A local-looking adapter name is not proof of locality.
- External disclosure is an Effect: persist the approved manifest before send.
  Deletion/recall at a processor is another best-effort Effect with its own
  receipt; an irreversible prior disclosure is never erased from audit history.
- Field/span classification can reduce over-classification, but only through a
  typed parser and content-addressed segment manifest. Free-form LLM annotations
  must not select which bytes bypass policy.
