// Public entry point for the vendored @c8y/dataprep-types package.
// Re-exports the Data Preparation Smart Function type declarations and declares
// the globals provided by the (restricted) Smart Function runtime.
export * from './dataprep';

declare global {
  /** Console provided by the Smart Function runtime. */
  const console: {
    log(...data: unknown[]): void;
    info(...data: unknown[]): void;
    warn(...data: unknown[]): void;
    error(...data: unknown[]): void;
    debug(...data: unknown[]): void;
  };

  /** Decodes byte streams (e.g. a message payload) into strings; UTF-8 by default. */
  class TextDecoder {
    constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
    readonly encoding: string;
    decode(input?: Uint8Array | ArrayBuffer, options?: { stream?: boolean }): string;
  }

  /** Encodes strings into UTF-8 byte streams. */
  class TextEncoder {
    constructor();
    readonly encoding: string;
    encode(input?: string): Uint8Array;
    encodeInto(source: string, destination: Uint8Array): { read: number; written: number };
  }
}
