# Risk-tier Acceptance prototype

> THROWAWAY PROTOTYPE for decision-map ticket #7. Delete the TUI after the contract is absorbed into production.

Question: can deterministic checks, policy auto-acceptance, independent Reviewer Assignments and Sponsor Gates form one replayable acceptance pipeline without letting an Executor self-accept or turning every small task into a review?

Run the interactive model:

```bash
pnpm prototype:risk-acceptance
```

Run the executable scenarios:

```bash
pnpm prototype:risk-acceptance:check
```

The TUI exposes five profiles and the individual transitions. A useful sequence is:

1. `l → c → x → e`: a low-risk mechanical result passes a trusted check; Executor self-evaluation is rejected, then the pinned policy auto-accepts without a Reviewer.
2. `m → c → e → r`: a canonical Project write is medium risk and receives an independent Reviewer Assignment. The verdict dispositions claims individually.
3. `h → c → e → t → o → a`: an irreversible external intent waits at a digest-bound Sponsor Gate; expiry is recoverable, and approval authorizes the intent rather than pretending the effect already happened.
4. `j → c → e → r → d`: qualitative high-risk work requires Reviewer then Sponsor; requested changes return it to rework.
5. `u → c → e → k`: incomplete risk facts fail closed but remain cancellable.
6. `l → f → e`: a failed deterministic criterion requests rework and never creates a Sponsor override.

The matrix uses a maximum-risk lattice, not a weighted model score. Unknown facts fail closed. A domain policy may add review/sponsor tiers or deny capabilities, but cannot weaken the baseline. Contracts and policies are versioned facts; check results, review verdicts and approvals bind the exact candidate hash. `task_result` and `integration_candidate` end in `accepted`, while an `effect_intent` ends in `authorized`; actual external completion remains the Effect Ledger's job from ticket #6.
