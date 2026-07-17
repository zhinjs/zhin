export type Dispose = () => void | Promise<void>;

export class DisposeStack {
  readonly #items: Dispose[] = [];
  #sealed = false;
  #disposed = false;

  add(dispose: Dispose): Dispose {
    if (this.#sealed) throw new Error('DisposeStack is sealed');
    if (this.#disposed) throw new Error('DisposeStack is disposed');
    this.#items.push(dispose);
    return dispose;
  }

  seal(): void {
    if (this.#disposed) throw new Error('DisposeStack is disposed');
    this.#sealed = true;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#sealed = true;

    const errors: unknown[] = [];
    for (const dispose of this.#items.splice(0).reverse()) {
      try {
        await dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'One or more disposers failed');
    }
  }
}
