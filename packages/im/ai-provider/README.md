# @zhin.js/ai-provider

Plugin Runtime integration for the AI Provider contracts in `@zhin.js/ai/provider`.

Provider plugins publish all their definitions in one setup call:
`provideAiProviders(context.resources, [definition, anotherDefinition])`.
Repeated registration in the same Scope is rejected; declarations become immutable when setup seals.
Definitions keep their exact plugin owner. Host integrations resolve them from the operation's
held snapshot with `createSnapshotProviderResolver`; another plugin with the same driver name
cannot replace a saved Service's owner.

This package owns no model loop, accounts, credentials, network access or global registration.
An operation's `aiInferenceClientToken` contains only its already authorized `InferenceClient`.
SDKs remain optional dependencies of the actual Provider implementation.

Commands and Agent Tools receive independent operation clients through `context.use(aiInferenceClientToken)`.
The Host supplies the exact generation, identity and model graph; callers cannot pass an owner or account override.
Checking availability or acquiring the client does not open a model or consume quota. Streams start only when
consumed, and their owner closes escaped or unused runs when execution ends. A Tool never closes its parent turn.

Driver `profileSchema({service, model})` describes and validates the selected protocol's actual parameters.
Use one typed pure schema resolver for parsing and Console input metadata; keep Account secrets out of both.
