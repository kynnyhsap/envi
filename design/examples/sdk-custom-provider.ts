// SDK: a custom provider in plain TypeScript, plus the in-memory provider in a test.
import * as Schema from "effect/Schema";
import { createEnvi, defineConfig, defineProvider, reference, ReferenceFailure } from "envi";
import type { ReferenceResult } from "envi";
import { memoryProvider } from "envi/memory";

// 1. The reference schema. The type comes from the schema.
const AwsReference = Schema.Struct({
  name: Schema.String,
  region: Schema.optional(Schema.String),
});

type AwsReference = typeof AwsReference.Type;

// 2. The descriptor helper for config files.
export const aws = (name: string, region?: string) =>
  reference("aws-secrets", region === undefined ? { name } : { name, region });

// 3. The provider. Results are matched by request key, not by position.
declare const fetchAwsSecret: (ref: AwsReference) => Promise<string | undefined>;

export const awsSecretsProvider = defineProvider({
  id: "aws-secrets",
  Reference: AwsReference,
  describe: (ref) => `aws://${ref.region ?? "default"}/${ref.name}`,
  cacheKey: (ref) => `${ref.region ?? "default"}/${ref.name}`,
  resolveMany: async (requests) => {
    const results: Record<string, ReferenceResult> = {};

    await Promise.all(
      requests.map(async (request) => {
        const found = await fetchAwsSecret(request.reference);

        results[request.key] =
          found === undefined
            ? { ok: false, reason: ReferenceFailure.NotFound }
            : { ok: true, value: found };
      }),
    );

    return results;
  },
  // `vars` receives these helpers as parameters.
  helpers: { aws },
});

// 4. Use: one config mixes two providers. `vars` gets `mem` and `aws` from the providers.
const memory = memoryProvider({ "db/url": "postgres://localhost/app" });

const config = defineConfig({
  providers: [memory, awsSecretsProvider],
  cache: false,
  vars: ({ mem, aws: awsSecret }) => ({
    DATABASE_URL: mem("db/url"),
    API_KEY: awsSecret("prod/api-key", "eu-west-1").schema(Schema.NonEmptyString),
  }),
});

export const env = await createEnvi(config).load();

// 5. A test replaces the providers of a real config through the second argument.
const fake = memoryProvider({ "db/url": "postgres://localhost/test" });

export const testEnv = await createEnvi(config, { providers: [fake, awsSecretsProvider] }).load();

// 6. A test asserts the batch rule: one `resolveMany` call for the whole config.
export const batchCount = memory.calls().length;
