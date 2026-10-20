# Workroom Profile governance prototype

> THROWAWAY PROTOTYPE for decision-map ticket #10. Delete the TUI after the contract is absorbed into production.

Question: can immutable domain/competency/integration/policy Capability Packs compose heterogeneous Workroom Profiles, prove Workflow requirements, produce minimal Assignment snapshots, and evolve from accepted knowledge without silently expanding tools, external access, authority, or automatic acceptance?

Run the interactive model:

```bash
pnpm prototype:workroom-profile
```

Run the executable scenarios:

```bash
pnpm prototype:workroom-profile:check
```

The fixtures deliberately use two different domains—software development and content production—while sharing the same evidence-analysis Competency Pack. Useful TUI actions:

1. Switch between software/content and inspect the exact pinned packs, compiled Workflow diagnostics, glossary, and memory fields.
2. Resolve a Task to see that its Assignment snapshot contains only the requirement closure, not every Profile capability.
3. Apply accepted terminology/work-method learning through policy; then try an external Tool/Integration/authority/auto-acceptance expansion and observe that only Sponsor can activate it.
4. Pin a Run, activate another Profile Revision, and rollback. The Run remains pinned and rollback creates a new revision rather than deleting history.

This prototype has no persistence and is not a production Profile registry.
