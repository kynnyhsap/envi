import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";

/** The SHA-256 digest of a text as hex. WebCrypto exists on Node and on Bun. */
export const sha256Hex = (text: string): Effect.Effect<string> =>
  Effect.map(
    Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
    (digest) => Encoding.encodeHex(new Uint8Array(digest)),
  );
