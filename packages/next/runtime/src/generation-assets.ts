import {
  DisposeStack,
  SharedLifetime,
  type Dispose,
} from '@zhin.js/next-kernel';

export class GenerationAssets {
  readonly #scopeLifetime: SharedLifetime;
  readonly #disposers = new DisposeStack();

  private constructor(
    scopeLifetime: SharedLifetime,
    projectionDisposers: Iterable<Dispose>,
  ) {
    this.#scopeLifetime = scopeLifetime;
    const scopeLease = scopeLifetime.acquire();
    // DisposeStack unwinds in reverse: projections must stop using resources
    // before this generation releases its shared Plugin Scope ownership.
    this.#disposers.add(() => scopeLease.release());
    for (const dispose of projectionDisposers) this.#disposers.add(dispose);
    this.#disposers.seal();
  }

  static create(
    disposeScopes: Dispose,
    projectionDisposers: Iterable<Dispose>,
  ): GenerationAssets {
    return new GenerationAssets(
      new SharedLifetime(disposeScopes),
      projectionDisposers,
    );
  }

  fork(projectionDisposers: Iterable<Dispose>): GenerationAssets {
    return new GenerationAssets(this.#scopeLifetime, projectionDisposers);
  }

  dispose(): Promise<void> {
    return this.#disposers.dispose();
  }
}
