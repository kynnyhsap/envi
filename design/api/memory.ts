// Type-only sketch of the in-memory provider for tests.
import type { Provider, Source } from "envi";

export declare const mem: (key: string) => Source<string>;

export interface MemoryProvider extends Provider<{ readonly mem: typeof mem }> {
  /** One entry per `resolveMany` call. A test asserts the batch rule with this list. */
  readonly calls: () => ReadonlyArray<ReadonlyArray<string>>;
}

export declare const memoryProvider: (secrets: Readonly<Record<string, string>>) => MemoryProvider;
