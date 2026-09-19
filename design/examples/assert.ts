/** Compile-time equality check. `tsc` fails if `A` and `B` differ. */
export type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export declare const assertType: <T extends true>() => void;
