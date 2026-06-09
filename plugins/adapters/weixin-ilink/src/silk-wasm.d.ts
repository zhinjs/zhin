declare module "silk-wasm" {
  export function decode(
    buf: Buffer,
    sampleRate: number,
  ): Promise<{ data: Uint8Array; duration: number }>;
}
