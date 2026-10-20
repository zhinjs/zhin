/** Process composition guard: dependency watchers must not interrupt a mutation. */
export class PluginManagementActivity {
  #operations = 0;

  get active(): boolean { return this.#operations > 0; }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    this.#operations += 1;
    try { return await operation(); }
    finally { this.#operations -= 1; }
  }
}
