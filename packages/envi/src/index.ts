// The public API of Envi. Everything else in `core` is internal and can change in any release.

// Config: the typed config and its descriptors.
export {
  defineConfig,
  schemaOf,
  type CacheSettings,
  type Config,
  type Env,
  type RawEnv,
  type StageOf,
  type VarsOf,
} from "./core/Config.ts";

export {
  custom,
  derive,
  fromEnv,
  reference,
  value,
  type Decoded,
  type Raw,
} from "./core/Source.ts";

export { BooleanFromString } from "./core/Codecs.ts";

// The plain client.
export { createEnvi, syncAll, type AnyEnvi, type EnviClient } from "./client.ts";

// The Effect API: the service, and the layer of the service on Node or Bun.
export * as Envi from "./core/Envi.ts";

export { layer, type EnviOptions } from "./layer.ts";

// Reports and errors.
export * from "./core/Reports.ts";

export * from "./core/Errors.ts";

// Extension points: custom providers and custom cache storage. They are unstable until a second
// real provider proves them.
export * as Cache from "./core/Cache.ts";

export * as FileCache from "./core/FileCache.ts";

export * as Provider from "./core/Provider.ts";

export * as Source from "./core/Source.ts";

export * as Timing from "./core/Timing.ts";
