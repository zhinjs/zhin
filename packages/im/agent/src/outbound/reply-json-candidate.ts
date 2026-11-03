/** Internal JSON-prefix cursor. Message validation remains in structured-reply.ts. */
interface Node {
  readonly kind: 'object' | 'array' | 'string' | 'primitive';
  readonly parent?: Node;
  readonly properties?: Map<string, Node>;
  readonly items?: Node[];
  value?: unknown;
  complete: boolean;
  version: number;
  cachedVersion?: number;
  cachedValue?: unknown;
}

interface Frame {
  readonly node: Node;
  phase: 'key' | 'colon' | 'value' | 'comma';
  key?: string;
  afterComma?: boolean;
}

interface Token {
  readonly kind: 'key' | 'string' | 'number' | 'literal';
  readonly node?: Node;
  text: string;
  escape: boolean;
  unicode?: string;
}

export class ReplyJsonCandidate {
  #raw = '';
  #root?: Node;
  readonly #stack: Frame[] = [];
  #token?: Token;
  #version = 0;
  #fallback = false;
  #nonObject = false;
  #scannedCharacters = 0;
  #materializedNodes = 0;
  #stringFragments = 0;

  get raw(): string { return this.#raw; }
  get fallback(): boolean { return this.#fallback; }
  get nonObject(): boolean { return this.#nonObject; }
  /** Internal counters used by deterministic complexity tests, not runtime admission. */
  get work(): Readonly<{ scannedCharacters: number; materializedNodes: number; stringFragments: number }> {
    return { scannedCharacters: this.#scannedCharacters, materializedNodes: this.#materializedNodes, stringFragments: this.#stringFragments };
  }

  append(delta: string): void {
    this.#raw += delta;
    if (this.#fallback || this.#nonObject) return;
    this.#version++;
    // Literal U+0000–U+001F must reach JSON's invalid-string path, not the plain-text run.
    // eslint-disable-next-line no-control-regex -- This range is the JSON string grammar's control-character exclusion.
    const stringBoundary = /["\\\u0000-\u001f]/g;
    for (let offset = 0; offset < delta.length;) {
      const token = this.#token;
      if ((token?.kind === 'key' || token?.kind === 'string') && !token.escape && token.unicode === undefined) {
        // A provider may deliver an entire answer in one delta. Keep plain string runs intact
        // instead of allocating a concatenation node and touching ancestors per character.
        stringBoundary.lastIndex = offset;
        const end = stringBoundary.exec(delta)?.index ?? delta.length;
        if (end > offset) {
          this.#text(delta.slice(offset, end), token);
          this.#scannedCharacters += end - offset;
          offset = end;
          if (offset === delta.length) break;
        }
      }
      const char = delta[offset++]!;
      this.#scannedCharacters++;
      this.#consume(char);
      if (this.#fallback || this.#nonObject) break;
    }
  }

  get whole(): boolean { return this.#root?.complete === true && !this.#token && !this.#stack.length; }

  get closedReaction(): string | undefined {
    const rootFrame = this.#stack[0];
    if (rootFrame && rootFrame.node === this.#root && rootFrame.key === 'reaction' && rootFrame.phase === 'value') return undefined;
    const node = this.#root?.properties?.get('reaction');
    return node?.kind === 'string' && node.complete ? node.value as string : undefined;
  }

  /** Inspect one root field without materializing a withheld message body. */
  reaction(): unknown {
    const node = this.#root?.properties?.get('reaction');
    return node ? this.#materialize(node) : undefined;
  }

  value(): unknown { return this.#root ? this.#materialize(this.#root) : undefined; }

  #touch(node: Node): void {
    let current: Node | undefined = node;
    while (current && current.version !== this.#version) {
      current.version = this.#version;
      current = current.parent;
    }
  }

  #materialize(node: Node): unknown {
    const pending = [{ node, visited: false }];
    while (pending.length) {
      const next = pending.pop()!;
      if (next.node.cachedVersion === next.node.version) continue;
      if (!next.visited) {
        pending.push({ node: next.node, visited: true });
        const children = next.node.properties?.values() ?? next.node.items ?? [];
        for (const child of children) if (child.cachedVersion !== child.version) pending.push({ node: child, visited: false });
        continue;
      }
      const current = next.node;
      this.#materializedNodes++;
      current.cachedValue = current.kind === 'object'
        ? Object.fromEntries([...current.properties!].map(([key, child]) => [key, child.cachedValue]))
        : current.kind === 'array'
          ? current.items!.map(child => child.cachedValue)
          : current.value;
      current.cachedVersion = current.version;
    }
    return node.cachedValue;
  }

  #consume(char: string): void {
    const token = this.#token;
    if (token?.kind === 'key' || token?.kind === 'string') {
      this.#string(char, token);
      return;
    }
    if (token) {
      if (token.kind === 'number' && /[0-9eE.\-+]/.test(char)) {
        // SDK repair has special exponent/trailing-number semantics. Preserve that path.
        if (char < '0' || char > '9' || token.text === '0') { this.#fallback = true; return; }
        token.text += char;
        const number = Number(token.node!.value) * 10 + Number(char);
        if (!Number.isSafeInteger(number)) { this.#fallback = true; return; }
        token.node!.value = number; this.#touch(token.node!);
        return;
      }
      if (token.kind === 'literal' && /[a-z]/.test(char)) {
        token.text += char;
        if (!['true', 'false', 'null'].some(word => word.startsWith(token.text))) this.#fallback = true;
        return;
      }
      if (token.kind === 'literal' && !['true', 'false', 'null'].includes(token.text)) { this.#fallback = true; return; }
      token.node!.complete = true; this.#touch(token.node!); this.#token = undefined;
      // Number/literal terminators also belong to the enclosing container.
    }
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') return;
    const frame = this.#stack.at(-1);
    if (!frame) {
      if (this.#root) { this.#fallback = true; return; }
      if (char !== '{') { this.#nonObject = true; return; }
      this.#start(char);
      return;
    }
    if (frame.phase === 'key') {
      if (char === '"') this.#token = { kind: 'key', text: '', escape: false };
      else if (char === '}' && !frame.afterComma) this.#close(frame);
      else this.#fallback = true;
    } else if (frame.phase === 'colon') {
      if (char === ':') frame.phase = 'value';
      else this.#fallback = true;
    } else if (frame.phase === 'comma') {
      if (char === ',') { frame.phase = frame.node.kind === 'object' ? 'key' : 'value'; frame.afterComma = true; }
      else if (char === (frame.node.kind === 'object' ? '}' : ']')) this.#close(frame);
      else this.#fallback = true;
    } else if (char === ']' && frame.node.kind === 'array' && !frame.afterComma) this.#close(frame);
    else this.#start(char);
  }

  #start(char: string): void {
    // A dangling negative duplicate value keeps the previous property in SDK repair.
    if (char === '-') { this.#fallback = true; return; }
    const frame = this.#stack.at(-1), parent = frame?.node;
    const kind = char === '{' ? 'object' : char === '[' ? 'array' : char === '"' ? 'string'
      : /[0-9tfn]/.test(char) ? 'primitive' : undefined;
    if (!kind) { this.#fallback = true; return; }
    const node: Node = { kind, parent, complete: false, version: this.#version,
      ...(kind === 'object' ? { properties: new Map() } : kind === 'array' ? { items: [] } : {}) };
    if (frame) {
      if (parent!.kind === 'object') parent!.properties!.set(frame.key!, node);
      else parent!.items!.push(node);
      this.#touch(parent!); frame.phase = 'comma'; frame.afterComma = false;
    } else this.#root = node;
    if (kind === 'object' || kind === 'array') this.#stack.push({ node, phase: kind === 'object' ? 'key' : 'value' });
    else if (kind === 'string') {
      node.value = '';
      this.#token = { kind: 'string', node, text: '', escape: false };
    } else {
      const literal = char === 't' || char === 'f' || char === 'n';
      node.value = literal ? char === 't' ? true : char === 'f' ? false : null : Number(char);
      this.#token = { kind: literal ? 'literal' : 'number', node, text: char, escape: false };
    }
  }

  #close(frame: Frame): void {
    frame.node.complete = true; this.#touch(frame.node); this.#stack.pop();
  }

  #string(char: string, token: Token): void {
    if (token.unicode !== undefined) {
      if (!/^[0-9a-fA-F]$/.test(char)) { this.#fallback = true; return; }
      token.unicode += char;
      if (token.unicode.length === 4) {
        this.#text(String.fromCharCode(parseInt(token.unicode, 16)), token);
        token.unicode = undefined;
      }
    } else if (token.escape) {
      token.escape = false;
      if (char === 'u') token.unicode = '';
      else {
        const escaped: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (!(char in escaped)) { this.#fallback = true; return; }
        this.#text(escaped[char]!, token);
      }
    } else if (char === '\\') {
      // The installed SDK's repair scanner treats escaped keys specially; use its exact semantics.
      if (token.kind === 'key') { this.#fallback = true; return; }
      token.escape = true;
    } else if (char === '"') {
      if (token.kind === 'key') {
        // Retain the SDK secure-JSON checks, including duplicate-key recovery.
        if (token.text === '__proto__' || token.text === 'constructor') { this.#fallback = true; return; }
        const frame = this.#stack.at(-1)!;
        frame.key = token.text; frame.phase = 'colon';
      } else { token.node!.complete = true; this.#touch(token.node!); }
      this.#token = undefined;
    } else if (char.charCodeAt(0) < 0x20) this.#fallback = true;
    else this.#text(char, token);
  }

  #text(char: string, token: Token): void {
    if (token.kind === 'key') token.text += char;
    else { this.#stringFragments++; token.node!.value = String(token.node!.value) + char; this.#touch(token.node!); }
  }
}
