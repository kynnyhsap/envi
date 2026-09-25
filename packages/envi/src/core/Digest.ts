import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";

/** The SHA-256 digest of a text. WebCrypto exists on Node and on Bun. */
export const sha256 = (text: string): Effect.Effect<Uint8Array> =>
  Effect.map(
    Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
    (digest) => new Uint8Array(digest),
  );

/** The SHA-256 digest of a text as hex. */
export const sha256Hex = (text: string): Effect.Effect<string> =>
  Effect.map(sha256(text), Encoding.encodeHex);
