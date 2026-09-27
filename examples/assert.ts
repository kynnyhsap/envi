/** Compile-time equality check. `tsc` fails if `A` and `B` differ. */
export type Equal<A, B> =
  // The type parameters of this idiom exist only to compare `A` with `B` exactly.
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Fails to compile unless `T` is `true`. */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters, eslint/no-unused-vars
export declare const assertType: <T extends true>() => void;
